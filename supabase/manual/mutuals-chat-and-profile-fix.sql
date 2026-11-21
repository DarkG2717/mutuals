-- ==========================================================
-- MUTUALS — paste-and-run script (Supabase SQL editor)
--
-- Applies, in one transaction:
--   1. messaging  (messages, match_reads, RLS, realtime, reports.message_id, get_my_threads)
--   2. profile cleanup (updated_at trigger, age -> birth_year derivation)
--
-- Safe to run more than once: tables use IF NOT EXISTS, policies and triggers are
-- dropped before being recreated, and the realtime publication is added only if
-- it is missing. Nothing here deletes data.
--
-- Generated from:
--   supabase/migrations/20261120230000_mutuals_messaging.sql
--   supabase/migrations/20261120232000_mutuals_profiles_cleanup.sql
-- ==========================================================

begin;


-- ============ 1. MESSAGING ============

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

-- ==========================================
-- Verify after applying:
--   select count(*) from public.messages;                      -- 0
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime';                     -- includes messages
--   select public.is_match_participant(<match_id>, auth.uid());
-- ==========================================

-- ============ 2. PROFILE CLEANUP ============

-- ---------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists on_profile_touch on public.profiles;
create trigger on_profile_touch
before update on public.profiles
for each row
execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- 2. age is the source of truth; birth_year is derived
-- ---------------------------------------------------------------
create or replace function public.sync_birth_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.age is not null then
    new.birth_year := extract(year from now())::integer - new.age;
  end if;
  return new;
end $$;

-- Backfill before the trigger takes over, so existing rows converge.
update public.profiles
set birth_year = extract(year from now())::integer - age
where age is not null
  and (birth_year is null
       or birth_year <> extract(year from now())::integer - age);

drop trigger if exists on_profile_sync_birth_year on public.profiles;
create trigger on_profile_sync_birth_year
before insert or update of age on public.profiles
for each row
execute function public.sync_birth_year();

-- birth_year must stay optional: Google sign-in creates a profile with no age.
alter table public.profiles
  alter column birth_year drop not null;

-- ==========================================
-- Verify after applying:
--   select count(*) from public.profiles where age is not null
--     and birth_year <> extract(year from now())::integer - age;   -- 0
--   update public.profiles set bio = bio where id = <id>;
--   -- updated_at should move
-- ==========================================

commit;
