-- ==========================================
-- MUTUALS: INITIAL DATABASE SCHEMA
-- ==========================================

create extension if not exists pgcrypto;

-- 1. USER PROFILES
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null,
    birth_year integer not null,
    hall text not null,
    faculty text,
    department text,
    bio text default 'No Bio Set',
    avatar_url text,
    onboarding_completed boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    constraint valid_birth_year check (
        birth_year between 1900 and extract(year from now())::integer
    )
);

-- 2. INTERESTS
create table public.interests (
    id bigint generated always as identity primary key,
    name text unique not null,
    category text not null
);

-- 3. USER INTERESTS
create table public.user_interests (
    user_id uuid references public.profiles(id) on delete cascade,
    interest_id bigint references public.interests(id) on delete cascade,
    created_at timestamptz default now(),
    primary key (user_id, interest_id)
);

-- 4. SWIPES
create table public.swipes (
    id uuid primary key default gen_random_uuid(),
    swiper_id uuid references public.profiles(id) on delete cascade,
    swiped_id uuid references public.profiles(id) on delete cascade,
    decision text not null check (decision in ('like', 'pass')),
    created_at timestamptz default now(),
    unique (swiper_id, swiped_id),
    check (swiper_id <> swiped_id)
);

-- 5. MATCHES
create table public.matches (
    id uuid primary key default gen_random_uuid(),
    user_one uuid references public.profiles(id) on delete cascade,
    user_two uuid references public.profiles(id) on delete cascade,
    created_at timestamptz default now(),
    check (user_one < user_two),
    unique (user_one, user_two)
);

-- 6. BLOCKS
create table public.blocks (
    id uuid primary key default gen_random_uuid(),
    blocker_id uuid references public.profiles(id) on delete cascade,
    blocked_id uuid references public.profiles(id) on delete cascade,
    created_at timestamptz default now(),
    unique (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

-- 7. REPORTS
create table public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid references public.profiles(id) on delete cascade,
    reported_id uuid references public.profiles(id) on delete cascade,
    reason text not null,
    details text,
    created_at timestamptz default now(),
    status text not null default 'pending'
        check (status in ('pending', 'reviewed', 'resolved')),
    check (reporter_id <> reported_id)
);

-- 8. INTEREST CATALOGUE
insert into public.interests (name, category) values
('Music', 'Arts'),
('Photography', 'Arts'),
('Drawing and Painting', 'Arts'),
('Graphic Design', 'Arts'),
('Fashion', 'Arts'),
('Creative Writing', 'Arts'),
('Poetry', 'Arts'),
('Dancing', 'Arts'),
('Movies', 'Entertainment'),
('Anime', 'Entertainment'),
('Gaming', 'Entertainment'),
('Reading', 'Entertainment'),
('Comedy', 'Entertainment'),
('Content Creation', 'Entertainment'),
('K-pop', 'Entertainment'),
('Documentaries', 'Entertainment'),
('Football', 'Activities'),
('Basketball', 'Activities'),
('Fitness', 'Activities'),
('Cooking', 'Activities'),
('Travel', 'Activities'),
('Adventure', 'Activities'),
('Nature', 'Activities'),
('Technology', 'Learning'),
('Science', 'Learning'),
('Entrepreneurship', 'Learning'),
('Business', 'Learning'),
('Medicine and Health', 'Learning'),
('Engineering', 'Learning'),
('Law', 'Learning'),
('Academic Research', 'Learning'),
('Volunteering', 'Community'),
('Student Leadership', 'Community'),
('Equality and Inclusion', 'Community'),
('Religion and Spirituality', 'Community'),
('Cultural Events', 'Community'),
('Public Speaking', 'Community'),
('Languages', 'Community'),
('Environmental Awareness', 'Community'),
('Food and Food Culture', 'Community');

-- 9. INDEXES
create index profiles_hall_idx on public.profiles(hall);
create index user_interests_interest_idx on public.user_interests(interest_id);
create index swipes_swiped_id_idx on public.swipes(swiped_id);
create index matches_user_two_idx on public.matches(user_two);

-- 10. ENABLE ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.interests enable row level security;
alter table public.user_interests enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- 11. PROFILE POLICIES
create policy "Users can view completed profiles"
on public.profiles for select
to authenticated
using (onboarding_completed = true or id = auth.uid());

create policy "Users can create their own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 12. INTEREST POLICIES
create policy "Authenticated users can view interests"
on public.interests for select
to authenticated
using (true);

create policy "Users can view their own selected interests"
on public.user_interests for select
to authenticated
using (user_id = auth.uid());

create policy "Users can add their own interests"
on public.user_interests for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can remove their own interests"
on public.user_interests for delete
to authenticated
using (user_id = auth.uid());

-- 13. SWIPE POLICIES
create policy "Users can view their own swipes"
on public.swipes for select
to authenticated
using (swiper_id = auth.uid());

create policy "Users can create their own swipes"
on public.swipes for insert
to authenticated
with check (swiper_id = auth.uid());

-- 14. MATCH POLICIES
create policy "Matched users can view their matches"
on public.matches for select
to authenticated
using (user_one = auth.uid() or user_two = auth.uid());

-- 15. BLOCK POLICIES
create policy "Users can view their own blocks"
on public.blocks for select
to authenticated
using (blocker_id = auth.uid());

create policy "Users can create their own blocks"
on public.blocks for insert
to authenticated
with check (blocker_id = auth.uid());

create policy "Users can remove their own blocks"
on public.blocks for delete
to authenticated
using (blocker_id = auth.uid());

-- 16. REPORT POLICIES
create policy "Users can submit reports"
on public.reports for insert
to authenticated
with check (reporter_id = auth.uid());

create policy "Users can view their own reports"
on public.reports for select
to authenticated
using (reporter_id = auth.uid());
