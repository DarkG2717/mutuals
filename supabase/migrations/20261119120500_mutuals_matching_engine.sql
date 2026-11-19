-- ==========================================
-- MUTUALS: PROFILE COLUMNS + MATCHING ENGINE SUPPORT
-- 1. profiles absorbs the fields the signup form already collects
--    (nickname, gender, level) so the existing design needs no edits.
-- 2. interest_stats holds the idf weights the scorer needs.
-- 3. get_interest_pool() exposes only public product surface.
-- 4. Swipe trigger writes matches atomically.
-- Safe to run more than once.
-- ==========================================

begin;

-- 1. PROFILE COLUMNS THE FORM ALREADY ASKS FOR
alter table public.profiles
  add column if not exists nickname text,
  add column if not exists gender text,
  add column if not exists level text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_gender_check'
  ) then
    alter table public.profiles
      add constraint profiles_gender_check check (
        gender is null or gender in (
          'male', 'female', 'non-binary', 'self-describe', 'prefer-not-to-say'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_level_check'
  ) then
    alter table public.profiles
      add constraint profiles_level_check check (
        level is null or level in ('100', '200', '300', '400', '500', '600', '700', 'other')
      );
  end if;
end $$;

-- 2. INTEREST STATS (RARITY WEIGHTS FOR THE SCORER)
create table if not exists public.interest_stats (
  interest_id bigint primary key references public.interests(id) on delete cascade,
  user_count integer not null default 0,
  idf double precision not null default 0,
  refreshed_at timestamptz default now()
);

alter table public.interest_stats enable row level security;

drop policy if exists "Authenticated users can read interest stats" on public.interest_stats;
create policy "Authenticated users can read interest stats"
on public.interest_stats for select
to authenticated
using (true);

-- Recompute user_count and idf for every interest in one pass.
-- idf = ln(1 + N / n_i), with n_i floored at 1 so unseen interests don't divide by zero.
create or replace function public.refresh_interest_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total_users integer;
begin
  select count(distinct ui.user_id) into total_users
  from public.user_interests ui
  join public.profiles p on p.id = ui.user_id
  where p.onboarding_completed = true;

  total_users := greatest(total_users, 1);

  insert into public.interest_stats (interest_id, user_count, idf, refreshed_at)
  select
    i.id,
    coalesce(counts.user_count, 0),
    ln(1 + total_users::double precision / greatest(coalesce(counts.user_count, 0), 1)),
    now()
  from public.interests i
  left join (
    select ui.interest_id, count(*) as user_count
    from public.user_interests ui
    join public.profiles p on p.id = ui.user_id
    where p.onboarding_completed = true
    group by ui.interest_id
  ) counts on counts.interest_id = i.id
  on conflict (interest_id) do update
    set user_count = excluded.user_count,
        idf = excluded.idf,
        refreshed_at = excluded.refreshed_at;
end $$;

-- 3. CONTROLLED POOL (WHAT THE CLIENT IS ALLOWED TO SCORE)
create or replace function public.get_interest_pool()
returns table (user_id uuid, interest_name text)
language sql
security definer
set search_path = public
stable
as $$
  select ui.user_id, i.name
  from public.user_interests ui
  join public.interests i on i.id = ui.interest_id
  join public.profiles p on p.id = ui.user_id
  where p.onboarding_completed = true
    and p.id <> auth.uid()
$$;

-- 4. MATCH DETECTION ON MUTUAL LIKE
create or replace function public.create_match_on_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision = 'like' then
    if exists (
      select 1 from public.swipes s
      where s.swiper_id = new.swiped_id
        and s.swiped_id = new.swiper_id
        and s.decision = 'like'
    ) and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = new.swiper_id and b.blocked_id = new.swiped_id)
         or (b.blocker_id = new.swiped_id and b.blocked_id = new.swiper_id)
    ) then
      insert into public.matches (user_one, user_two)
      values (
        least(new.swiper_id, new.swiped_id),
        greatest(new.swiper_id, new.swiped_id)
      )
      on conflict (user_one, user_two) do nothing;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists on_swipe_create_match on public.swipes;
create trigger on_swipe_create_match
after insert on public.swipes
for each row
execute function public.create_match_on_mutual_like();

-- 5. SEED THE STATS TABLE SO THE CLIENT HAS WEIGHTS IMMEDIATELY
select public.refresh_interest_stats();

commit;

-- Verify after running:
-- select count(*) from public.interest_stats;                       -- should equal interest count
-- select * from public.refresh_interest_stats() is not null;        -- callable
