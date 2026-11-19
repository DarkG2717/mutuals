-- MUTUALS: PROFILE ONBOARDING FIELDS

alter table public.profiles
  alter column birth_year drop not null;

alter table public.profiles
  add column if not exists nickname text,
  add column if not exists age integer,
  add column if not exists gender text,
  add column if not exists level text;

-- Validate age when supplied.
alter table public.profiles
  drop constraint if exists profiles_valid_age;

alter table public.profiles
  add constraint profiles_valid_age
  check (age is null or age between 13 and 99);

-- Validate gender when supplied.
alter table public.profiles
  drop constraint if exists profiles_valid_gender;

alter table public.profiles
  add constraint profiles_valid_gender
  check (
    gender is null or gender in (
      'male',
      'female',
      'non-binary',
      'self-describe',
      'prefer-not-to-say'
    )
  );

-- Keep profile timestamps current.
create index if not exists profiles_level_idx
  on public.profiles(level);
