-- ==========================================
-- MUTUALS: MESSAGING (review draft — not applied)
--
-- Design decisions baked in here, for the record:
--
-- 1. No conversations table. A match IS the conversation. `matches` already
--    guarantees one row per pair (unique(user_one, user_two)), so a separate
--    membership table would only duplicate that invariant and create a second
--    source of truth.
-- 2. Threads are implicit: nothing exists until the first message. Matches with
--    no messages never appear in a chat list, so the app doesn't open onto dead
--    threads.
-- 3. Messages are immutable. No update or delete policies on purpose — editing
--    history is a moderation tool, not a user right. Reporting is the escape
--    hatch (see the reports column added at the end).
-- 4. Blocking is enforced in the database, not the client. `blocks` RLS only
--    exposes your own outgoing blocks, so the check has to run in a
--    security definer function or a blocked user could still write into a
--    match from the client.
-- 5. Realtime respects RLS: subscribers only receive message rows they are
--    allowed to select, so the publication entry alone is not a leak.
-- ==========================================

begin;

-- ---------------------------------------------------------------
-- 1. MESSAGES
-- ---------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  -- created_at ties at millisecond resolution and is client-adjacent; seq is the
  -- only ordering the client may trust.
  seq        bigint generated always as identity,
  constraint messages_body_length check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists messages_match_seq_idx on public.messages (match_id, seq desc);
create index if not exists messages_sender_idx    on public.messages (sender_id);

-- ---------------------------------------------------------------
-- 2. READ STATE (unread counts, seen ticks)
-- ---------------------------------------------------------------
create table if not exists public.match_reads (
  match_id      uuid not null references public.matches(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- seq is the ordering the client trusts, so read state is tracked by seq.
  -- last_read_at is display sugar ("seen 2m ago"), never used for counting.
  last_read_seq bigint not null default 0,
  last_read_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists match_reads_user_idx on public.match_reads (user_id);

-- ---------------------------------------------------------------
-- 3. HELPERS
-- RLS on messages needs two facts that the caller's own RLS would hide:
-- "is this user in this match" and "have these two blocked each other".
-- Both live in security definer functions with a fixed search_path.
-- ---------------------------------------------------------------
create or replace function public.is_match_participant(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (m.user_one = p_user_id or m.user_two = p_user_id)
  );
$$;

create or replace function public.other_participant(p_match_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
           when m.user_one = p_user_id then m.user_two
           when m.user_two = p_user_id then m.user_one
         end
  from public.matches m
  where m.id = p_match_id;
$$;

create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

revoke all on function public.is_match_participant(uuid, uuid) from public;
revoke all on function public.other_participant(uuid, uuid)   from public;
revoke all on function public.is_blocked_between(uuid, uuid)  from public;

grant execute on function public.is_match_participant(uuid, uuid) to authenticated;
grant execute on function public.other_participant(uuid, uuid)   to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid)  to authenticated;

-- Defense in depth: the insert policy already checks the sender, but a trigger
-- means a future policy mistake cannot let a stranger write into a match.
create or replace function public.validate_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row record;
begin
  select m.user_one, m.user_two into match_row
  from public.matches m
  where m.id = new.match_id;

  if not found then
    raise exception 'Message references an unknown match' using errcode = '23503';
  end if;

  if new.sender_id is distinct from match_row.user_one
     and new.sender_id is distinct from match_row.user_two then
    raise exception 'Sender is not part of this match' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists on_message_validate_sender on public.messages;
create trigger on_message_validate_sender
before insert on public.messages
for each row
execute function public.validate_message_sender();

-- ---------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------
alter table public.messages    enable row level security;
alter table public.match_reads enable row level security;

drop policy if exists "Participants read their messages" on public.messages;
create policy "Participants read their messages"
on public.messages for select
to authenticated
using (
  public.is_match_participant(match_id, auth.uid())
  and not public.is_blocked_between(auth.uid(), public.other_participant(match_id, auth.uid()))
);

drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_match_participant(match_id, auth.uid())
  and not public.is_blocked_between(auth.uid(), public.other_participant(match_id, auth.uid()))
);

-- No update/delete policies: history is immutable by design.

drop policy if exists "Users read their own read state" on public.match_reads;
create policy "Users read their own read state"
on public.match_reads for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users write their own read state" on public.match_reads;
create policy "Users write their own read state"
on public.match_reads for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_match_participant(match_id, auth.uid())
  -- a thread only exists once something has been said in it
  and exists (
    select 1 from public.messages msg where msg.match_id = match_reads.match_id
  )
);

drop policy if exists "Users update their own read state" on public.match_reads;
create policy "Users update their own read state"
on public.match_reads for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.is_match_participant(match_id, auth.uid())
);

-- ---------------------------------------------------------------
-- 5. REALTIME
-- Subscribers still only receive rows their SELECT policy permits.
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 6. REPORTS: allow reporting a single message
-- ---------------------------------------------------------------
alter table public.reports
  add column if not exists message_id uuid references public.messages(id) on delete set null;

create index if not exists reports_message_idx on public.reports (message_id);

-- ---------------------------------------------------------------
-- 7. THREAD LIST
-- One round trip for the inbox: match, the other person, last message, unread
-- count. Only threads that actually have a message are returned.
-- ---------------------------------------------------------------
create or replace function public.get_my_threads()
returns table (
  match_id     uuid,
  other_id     uuid,
  other_name   text,
  other_avatar text,
  last_body    text,
  last_sender  uuid,
  last_at      timestamptz,
  unread       integer
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      m.id as match_id,
      case when m.user_one = auth.uid() then m.user_two else m.user_one end as other_id,
      m.created_at
    from public.matches m
    where m.user_one = auth.uid() or m.user_two = auth.uid()
  ),
  last_msg as (
    select distinct on (msg.match_id)
      msg.match_id, msg.body, msg.sender_id, msg.created_at, msg.seq
    from public.messages msg
    order by msg.match_id, msg.seq desc
  )
  select
    mine.match_id,
    mine.other_id,
    p.full_name,
    p.avatar_url,
    last_msg.body,
    last_msg.sender_id,
    last_msg.created_at,
    coalesce((
      select count(*)
      from public.messages x
      where x.match_id = mine.match_id
        and x.sender_id <> auth.uid()
        and x.seq > coalesce((
          select r.last_read_seq from public.match_reads r
          where r.match_id = mine.match_id and r.user_id = auth.uid()
        ), 0)
    ), 0)::integer as unread
  from mine
  join public.profiles p on p.id = mine.other_id
  join last_msg on last_msg.match_id = mine.match_id
  where auth.uid() is not null
    and not public.is_blocked_between(auth.uid(), mine.other_id)
  order by last_msg.created_at desc;
$$;

revoke all on function public.get_my_threads() from public;
grant execute on function public.get_my_threads() to authenticated;

commit;

-- ==========================================
-- Verify after applying:
--   select count(*) from public.messages;                      -- 0
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime';                     -- includes messages
--   select public.is_match_participant(<match_id>, auth.uid());
-- ==========================================
