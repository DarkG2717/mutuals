-- ==========================================
-- MUTUALS: SYNC INTERESTS WITH LIVE DATA
-- Live project had drifted from migration 0001:
--   40 seeded there, 70 actually in the database,
--   3 of those were accidental duplicates, and
--   7 rows had been moved to different categories.
-- This migration makes any fresh build match production.
-- Safe to run more than once.
-- ==========================================

begin;

-- 1. INTERESTS THAT EXIST LIVE BUT WERE NEVER IN THE REPO (27)
insert into public.interests (name, category) values
  ('Afrobeats', 'Music'),
  ('Artificial intelligence', 'Learning'),
  ('Athletics', 'Sports'),
  ('Badminton', 'Sports'),
  ('Board games', 'Entertainment'),
  ('Eating', 'Lifestyle'),
  ('Esports', 'Entertainment'),
  ('Exploring new places', 'Lifestyle'),
  ('Gardening', 'Lifestyle'),
  ('Gospel music', 'Music'),
  ('K-dramas', 'Entertainment'),
  ('Listening to music', 'Music'),
  ('Making new friends', 'Community'),
  ('Painting', 'Arts'),
  ('Podcasts', 'Entertainment'),
  ('Programming', 'Learning'),
  ('Shopping', 'Lifestyle'),
  ('Singing', 'Music'),
  ('Sleeping', 'Lifestyle'),
  ('Swimming', 'Sports'),
  ('Table tennis', 'Sports'),
  ('Travelling', 'Lifestyle'),
  ('Trying new things', 'Lifestyle'),
  ('Volleyball', 'Sports'),
  ('Watching movies', 'Entertainment'),
  ('Watching series', 'Entertainment'),
  ('Writing', 'Arts')
on conflict (name) do nothing;

-- 2. CATEGORY CORRECTIONS (7 rows moved since 0001)
update public.interests set category = 'Business'
  where name in ('Business', 'Entrepreneurship');

update public.interests set category = 'Learning'
  where name = 'Reading';

update public.interests set category = 'Lifestyle'
  where name in ('Cooking', 'Fitness');

update public.interests set category = 'Sports'
  where name in ('Basketball', 'Football');

-- 3. COLLAPSE THREE ACCIDENTAL DUPLICATES
-- Same interest entered twice with different capitalisation.
-- Keeps the repo-canonical spelling, re-points anyone who picked
-- the duplicate, then removes the duplicate row.
do $$
declare
  pair record;
  keep_id bigint;
  dupe_id bigint;
begin
  for pair in
    select * from (values
      ('Graphic Design', 'Graphic design'),
      ('Content Creation', 'Content creation'),
      ('Public Speaking', 'Public speaking')
    ) as t(keep_name, dupe_name)
  loop
    select id into keep_id from public.interests where name = pair.keep_name;
    select id into dupe_id from public.interests where name = pair.dupe_name;

    if keep_id is not null and dupe_id is not null then
      insert into public.user_interests (user_id, interest_id)
      select user_id, keep_id
      from public.user_interests
      where interest_id = dupe_id
      on conflict do nothing;

      delete from public.user_interests where interest_id = dupe_id;
      delete from public.interests where id = dupe_id;
    end if;
  end loop;
end $$;

commit;

-- Expected result after running: 67 interests.
-- select count(*) from public.interests;
