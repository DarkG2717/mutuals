-- ==========================================================
-- MUTUALS — AVATAR STORAGE + BIO + PROFILE POLISH
--
-- Adds the storage bucket the profile page uploads to, and the
-- constraints the new UI relies on.
--
-- Safe to run more than once: bucket upsert, policies dropped first,
-- constraints guarded.
-- ==========================================================

begin;

-- ---------------------------------------------------------------
-- 1. AVATARS BUCKET
-- Public read because avatar URLs are shown to every signed-in user
-- (Discover cards, message threads). Writes are owner-only via policy.
-- 5 MB ceiling and image-only mime types keep it from becoming a CDN.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------
-- 2. STORAGE POLICIES
-- Path shape is `${auth.uid()}/avatar.jpg`, so the first folder segment
-- is the owner. Users can only touch their own folder.
-- ---------------------------------------------------------------
drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "Users upload their own avatar" on storage.objects;
create policy "Users upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update their own avatar" on storage.objects;
create policy "Users update their own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete their own avatar" on storage.objects;
create policy "Users delete their own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------
-- 3. BIO
-- The UI caps at 160; the column enforces it so a direct API call
-- cannot store a wall of text into a card.
-- ---------------------------------------------------------------
update public.profiles
set bio = null
where bio is not null and btrim(bio) in ('', 'No Bio Set');

alter table public.profiles
  drop constraint if exists profiles_bio_length;

alter table public.profiles
  add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 160);

-- ---------------------------------------------------------------
-- 4. PHOTO IS REQUIRED TO BE DISCOVERABLE
-- Not a NOT NULL on the column: Google sign-in creates a profile row
-- before onboarding, and auth must never fail because of a missing photo.
-- The discover feed is what gets gated, in SQL, so a stale client build
-- cannot hand out cards for photo-less profiles either.
-- ---------------------------------------------------------------
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
    and p.avatar_url is not null
    and btrim(p.avatar_url) <> ''
    and p.id <> auth.uid()
$$;

revoke all on function public.get_interest_pool() from public;
grant execute on function public.get_interest_pool() to authenticated;

commit;

-- ==========================================
-- Verify after applying:
--   select id, public from storage.buckets where id = 'avatars';      -- 1 row, t
--   select polname from pg_policies
--     where schemaname = 'storage' and tablename = 'objects';          -- 4 rows
--   select public.get_interest_pool() limit 1;                         -- avatars only
-- ==========================================
