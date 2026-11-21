-- ==========================================================
-- MUTUALS — gender is male/female and required
--
-- Paste-and-run in the Supabase SQL editor. Safe to re-run.
--
-- 1. Tightens profiles_gender_check to ('male','female') as NOT VALID so it
--    applies to every new/updated row without deleting or rewriting the
--    existing test rows that still hold 'non-binary' / 'prefer-not-to-say'.
--    Validate it later (see the bottom) once those rows are cleaned up.
-- 2. Applies NOT NULL only when there are no null rows left, so this script
--    never fails halfway on a dev database. If rows are still null it raises a
--    notice telling you how many, and the rest of the script still commits.
-- ==========================================================

begin;

alter table public.profiles
  drop constraint if exists profiles_gender_check;

alter table public.profiles
  add constraint profiles_gender_check
  check (gender in ('male', 'female')) not valid;

do $$
declare
  null_count integer;
begin
  select count(*) into null_count
  from public.profiles
  where gender is null;

  if null_count = 0 then
    execute 'alter table public.profiles alter column gender set not null';
    raise notice 'profiles.gender is now NOT NULL';
  else
    raise notice 'profiles.gender still has % null row(s) — NOT NULL not applied', null_count;
  end if;
end $$;

commit;

-- ----------------------------------------------------------
-- Check what is left to clean up:
--   select id, full_name, gender from public.profiles
--   where gender is null or gender not in ('male','female');
--
-- Once that returns zero rows, lock it down fully:
--   alter table public.profiles validate constraint profiles_gender_check;
--   alter table public.profiles alter column gender set not null;
-- ----------------------------------------------------------
