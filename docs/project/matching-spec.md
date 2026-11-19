# MUTUALS — Matching Engine Spec

Status: draft for approval. No code written yet.
Scope: interest-based compatibility scoring, discover deck assembly, match detection.
Defaults chosen where the owner hasn't decided yet — override freely.

---

## 1. Product definition

Matching is **interests-only**. No age, no gender, no location weighting, no mutual friends.
The score is **visible** to the user as a percentage.
All scoring math lives in **JavaScript** (`assets/js/matching.js`).

---

## 2. Constraint: RLS blocks client-side scoring

`user_interests` select policy is `user_id = auth.uid()`. `matching.js` cannot read other
users' interests, so any client-side scoring gets empty vectors and silently scores every
pair 0.

**Decision (recommended): Option A — controlled pool function.**

```sql
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
```

Exposure: interest names of onboarded users only — already public product surface.
Does **not** expose swipes, matches, blocks, or reports. Those stay private.

Rejected alternatives:
- Relaxing `user_interests` RLS to `authenticated` — same exposure, less control, one line but leaks the whole table shape.
- Full server-side scorer — contradicts the "logic in JS" requirement.

---

## 3. Scoring formula

Every interest is weighted by rarity. Popular interests carry no signal.

```
N     = number of onboarded users
n_i   = number of users who selected interest i
idf_i = ln(1 + N / n_i)          // ~0.7 for Music, higher for niche interests

x_u,i = idf_i if user u selected i, else 0

score(u,v) = (x_u · x_v) / (||x_u|| * ||x_v||)      // cosine, 0..1
```

Properties:
- Symmetric: score(u,v) == score(v,u), so no ordering bugs.
- Bounded 0..1, so it maps cleanly to a percentage.
- Normalised by magnitude, so 7 interests vs 20 interests isn't punished.
- Two users sharing only niche interests outrank two sharing Music + Movies.

### Display curve

Raw cosine clusters at 0.25–0.45 for genuine pairs. Showing "31% match" reads as rejection.

```
displayPercent = round(100 * score^0.6)
```

Curve lifts the low band, keeps 100 honest, monotonic so ordering never changes.
Exponent lives in one constant (`DISPLAY_EXPONENT`) and gets tuned against real
distributions after launch.

### idf source

`idf_i` needs `N` and `n_i`. Computed server-side into a small stats table, refreshed
by cron (nightly), read by the client. Client never scans the whole DB.

```sql
create table public.interest_stats (
  interest_id bigint primary key references public.interests(id) on delete cascade,
  user_count  integer not null default 0,
  idf         double precision not null default 0,
  refreshed_at timestamptz default now()
);
```

Refresh function recomputes `user_count`, `N`, and `idf` in one pass. Must run after
seed and then nightly.

---

## 4. Deck assembly

### Candidate filter
Exclude:
- self
- anyone already in `swipes` for the viewer (either decision)
- blocks in either direction
- `onboarding_completed = false`
- anyone with zero interests

### Mix
- 70% top-scored candidates
- 30% random sample from the remainder

Rationale: pure score ranking is rich-get-richer. Top users get shown to everyone, new
users get shown to nobody, and the app looks dead to most of the student body in week 2.
Constants: `TOP_SLICE = 0.7`, `EXPLORE_SLICE = 0.3`. Tunable.

### Caching
- Fetch pool + idf once per session, hold in memory (~30KB for 2k users × 7 interests).
- Score locally, rebuild deck from cache after each swipe batch.
- Pool refetch on staleness timer, not per swipe.

### Cold start
New user with nothing swiped: pool is large, order by score then created_at.
If pool < deck size, return everything and surface an empty-state path in the UI
(needs more users in your hall / faculty).

---

## 5. Module API (pure functions, no Supabase inside)

`assets/js/matching.js`

- `buildInterestVectors(poolRows, idfMap)` → `Map<userId, {vector, norm}>`
- `scorePair(vecA, vecB)` → `number` 0..1
- `compatibilityPercent(score, exponent = 0.6)` → `number` 0..100
- `filterCandidates(viewerId, profiles, swipes, blocks)` → `profile[]`
- `buildDeck(viewerId, candidates, vectors, {size, topSlice})` → `{profile, score, percent}[]`

Rule: none of these touch the network. `matching.js` exposes them; a thin caller does
the Supabase reads. This is what makes the engine unit-testable in node without a DB.

---

## 6. Match detection (not scoring, but required)

`matches` has no writer today. Must be a Postgres trigger, not JS:

```sql
create or replace function public.create_match_on_mutual_like()
returns trigger language plpgsql security definer set search_path = public as $$
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
      values (least(new.swiper_id, new.swiped_id), greatest(new.swiper_id, new.swiped_id))
      on conflict (user_one, user_two) do nothing;
    end if;
  end if;
  return new;
end $$;
```

Client-side mutual detection double-fires when both users swipe in the same second and
can create orphan state. Trigger is atomic.

---

## 7. Test plan (before any UI)

Fixtures, no network:
1. Identical interests → score 1.0, percent 100.
2. Zero overlap → score 0, percent 0.
3. 7 vs 20 interests, 5 shared → cosine < 1, not distorted by count.
4. Two users sharing one rare interest beats two sharing three common ones.
5. Symmetry: score(a,b) == score(b,a) on 100 random fixture pairs.
6. Deck never contains self, already-swiped, or blocked user.
7. Deck mix lands near 70/30 on a 200-candidate fixture.
8. `compatibilityPercent` monotonic across sampled scores.

Run with `node --test` on matching.js. No Supabase, no browser.

---

## 8. Open decisions

1. Display curve: `score^0.6` accepted, or raw cosine visible for the first build?
2. Deck mix: 70/30 from day one, or pure-score first?
3. Percent visible on the card pre-swipe, or only revealed after a match?

Until answered, this spec assumes: curve on, 70/30 on, percent visible pre-swipe.

---

## 9. Build order once approved

1. SQL: `interest_stats` + refresh fn, `get_interest_pool()`, match trigger. (needs a migration file)
2. `matching.js` pure functions + node tests green.
3. `discover.html` wiring: profile card, percent badge, like/pass, calls into matching.js.
4. Kill the "backend developer" placeholder in signup-interests.html — persist selection to `user_interests`.
5. Manual pass with 3 seeded accounts, verify mutual like produces a match row.
