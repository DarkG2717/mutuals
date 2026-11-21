-- ==========================================
-- MUTUALS: PROFILE CLEANUP (review draft — not applied)
--
-- Separate from messaging on purpose: this touches existing user rows and can be
-- applied, verified and rolled back on its own.
--
-- What it does NOT do, and why:
--   * hall stays NOT NULL. The signup form still collects it
--     (pages/signup-details.html) and auth.js writes it, so there is no drift to
--     fix — dropping the constraint would only weaken the data.
--   * level stays text with the ('100'…'700','other') check. The form's select
--     uses exactly those values; the integer levels in the demo build are a
--     client-side display thing, not a schema mismatch.
--
-- What is actually broken:
--   1. profiles.updated_at exists but nothing has ever maintained it — there is
--      no touch trigger anywhere in the migrations.
--   2. age and birth_year are written independently by the client and can
--      disagree (age is stored, birth_year is derived in auth.js). Two sources
--      of truth for the same fact.
-- ==========================================

begin;

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

commit;

-- ==========================================
-- Verify after applying:
--   select count(*) from public.profiles where age is not null
--     and birth_year <> extract(year from now())::integer - age;   -- 0
--   update public.profiles set bio = bio where id = <id>;
--   -- updated_at should move
-- ==========================================
