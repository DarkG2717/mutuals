# What Tinder does that Mutuals should (and shouldn't) copy

Source: Hello Interview — "Tinder" system design breakdown
(https://www.hellointerview.com/learn/system-design/problem-breakdowns/tinder)
Written 2026-11-21 · Owner: Forge · Status: proposal, nothing built yet

## 1. What the article actually specifies

Functional: (a) profile with preferences — age range, interests, max distance; (b) a
feed/stack of candidates that respects those preferences and location; (c) swipe yes/no
one profile at a time; (d) notify both people when a swipe is mutual.

Non-functional: strong consistency on swiping (a mutual swipe must produce a match and a
notification, not silently vanish), low-latency stack load (<300ms), and never re-show a
profile the user already swiped.

Its deep dives are all about scale: Cassandra partitioned by swiper, or Redis + Lua for the
atomic "write my swipe and read theirs" step, Elasticsearch for feed queries, pre-computed
feeds + TTL for staleness, a client-side cache of recent swipes, and a bloom filter for
users with huge swipe histories.

## 2. What Mutuals already has (verified against the live project, 2026-11-21)

| Article requirement | Our state |
|---|---|
| Profile | `profiles` with full_name, nickname, age, birth_year, gender, hall, faculty, department, level, bio, avatar_url, onboarding_completed |
| Preferences | **missing** — no `interested_in`, no age range, no hall/level preference |
| Stack/feed | built **client-side**: `discover.html` downloads every profile, `get_interest_pool()` (every onboarded student's interests), `interest_stats` idf weights, then scores in the browser |
| Swipe | `swipes` (swiper_id, swiped_id, decision like/pass, unique pair) |
| Match on mutual like | trigger `create_match_on_mutual_like` — atomic, single transaction, plus block check. **This already satisfies the article's strong-consistency requirement.** |
| Notify both users | **half missing** — the second swiper gets a toast and now a redirect to chat; the first swiper is never told anything |
| Never re-show swiped profiles | done **client-side** via `filterCandidates()`; correct but only as fresh as the client's snapshot |
| Undo | already better than Tinder's paywalled Rewind — free, 8-second window, nothing written until it expires |

## 3. What to take, in order

### P0 — preferences (article FR1)
Add to `profiles`: `interested_in` ('male'|'female'|'both'), `age_min`, `age_max`
(default 16–40). Feed filters on them. At Babcock this is not cosmetic: halls are
single-sex, the university is Adventist, and getting this wrong produces real complaints.
Effort: one migration + two form fields.

### P0 — move the feed server-side (article FR2 + deep dive 2)
Today every student's interests are shipped to every browser. On a campus of a few
thousand people that is a privacy hole with a small community attached to it — the pool
endpoint effectively publishes who is interested in what. Replace with
`get_deck(p_limit int)` as a SECURITY DEFINER RPC that:
- filters by `interested_in`, age range, hall/faculty scope, not-self, not-swiped
  (NOT EXISTS against `swipes`), not-blocked, `onboarding_completed`
- scores with the same cosine + IDF + confidence formula, but in SQL
- returns only display fields + score + shared interests
Keep `matching.js` as the reference implementation and test oracle: the SQL must agree
with it, and the 10 unit tests stay green.
Effort: one RPC + rewrite of `loadDeck()`. This is also the only P0 that removes a risk
rather than adding a feature.

### P1 — notify the first swiper (article FR4)
The article's Person A problem, which we have verbatim: if I liked you three days ago and
you like me back today, I'm never told. Minimal version for a web app:
- `notifications` table (user_id, kind, match_id, read_at, created_at)
- insert from the match trigger
- badge in the discover header + realtime subscription so it appears without a refresh
Push notifications can wait until there's an installed-app story.

### P1 — prefetch the next stack (article deep dive 2)
`DECK_SIZE` is 20 with no refill. Pull the next batch when ~5 cards remain so the deck
never visibly runs out. Cheap: one call, client keeps a decided-ID set to de-dupe.

### P1 — hall and level as first-class filters
This is our replacement for Tinder's distance radius, and it's a better filter: distance
on a single campus is meaningless, but "same hall" or "same faculty" is how students
actually meet. Add as optional preferences, defaulting to off so the deck stays large.

### P2 — profile quality (article: photos/prompts, listed out of scope)
Multiple photos, two or three prompts ("My hall's worst rule is…"), and a
verification-lite signal (student ID domain check on signup). Prompts are the single
cheapest way to make a chat opener possible, which is the actual failure point of a
campus matching app.

### P2 — activity freshness
`last_active_at` on profiles, and rank recently-active users higher inside the same score
band. Nothing kills trust like matching with someone who graduated.

## 4. What not to copy

- **Cassandra / Redis+Lua**: we are one Postgres database for one university. The swipe
  trigger is already atomic; there is nothing to fix.
- **Elasticsearch / OpenSearch**: `get_deck` at this scale is a single indexed query.
- **Feed pre-computation + TTL caching**: unnecessary and it introduces the staleness
  problem the article then spends a section solving.
- **Bloom filters**: only meaningful past millions of swipes because contains-checks get
  slow. Our `NOT EXISTS` on an indexed table is fine for years.
- **Premium gates on Undo/Super Like/Boost**: we already give Undo free. Paid mechanics
  on a campus app invite resentment and, at Babcock, scrutiny.

## 5. Where Mutuals can beat the source material

Tinder's whole feed problem comes from open-world geography. Ours is closed-world: the
candidate set is a few thousand known students with shared halls, faculties and courses.
That means we can do things Tinder structurally cannot:

- match on **shared interests with rarity weighting** (already built — this is the app's
  actual differentiator, not the swipe UI)
- explain the match ("you both like Afrobeat and you're both 300 level in Law") — Tinder
  can only show a percentage
- surface **second-degree context** (same hall as two of your friends) from data we
  already hold
- treat safety as a first-class feature: blocks and reports exist, but reporting a single
  message and blocking silently from chat should both be one tap away

## 6. Sequencing

1. `interested_in` + age range migration, form fields, feed filter
2. `get_deck()` RPC + `loadDeck()` rewrite, tests against `matching.js`
3. `notifications` + match trigger insert + header badge + realtime
4. Prefetch at 5 remaining
5. Hall/level preferences
6. Prompts + multi-photo
