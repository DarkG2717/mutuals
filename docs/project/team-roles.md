# MUTUALS — Team Roles & Work Split

Companion to `matching-spec.md`. One owner per area. No two people edit the same file.
Map your names onto the roles below; the roles are the contract, not the people.

---

## The blocking chain

```
DB migrations  →  matching.js (pure fns + tests)  →  discover.html wiring  →  QA pass
      │                    │
      └── RPC contract ────┴── API contract ──→ Frontend builds UI on fixtures in parallel
```

Only the DB is truly serial. Everyone else can work in parallel if the two contracts
below are frozen first.

**Contract 1 (DB → JS):** `get_interest_pool() returns (user_id uuid, interest_name text)`
**Contract 2 (JS → UI):** the five exports in `matching-spec.md` §5.

Freeze both, then nobody is blocked waiting on anyone.

---

## Role 1 — Database / Supabase owner

Owns: `supabase/migrations/*`, Supabase project config, keys, seeds, RLS.

Deliverables:
1. Migration adding `interest_stats` + refresh function (§3 of spec).
2. Migration adding `get_interest_pool()` with `security definer` (§2).
3. Migration adding `create_match_on_mutual_like()` trigger (§6).
4. Persist interest selection: signup-interests.html currently dead-ends at "will be
   connected by the backend developer". Needs a write path into `user_interests`
   (RPC or direct insert + RLS check).
5. Seed script: 20 fake onboarded profiles with varied interests, so scoring has
   something to chew on before real users exist.
6. Two Supabase projects: `mutuals-staging` and `mutuals-prod`. Keys never in git.

Rules:
- Migrations only, versioned files. No schema changes clicked in the dashboard — the
  next `db push` will silently diverge and cost a day.
- Verify RLS from the client, not from the SQL editor (editor bypasses RLS and lies).

Definition of done: migrations apply clean to a fresh DB; a logged-in test user gets
non-empty rows from `get_interest_pool()` and empty rows from everyone else's `swipes`.

---

## Role 2 — Matching engine (Forge)

Owns: `assets/js/matching.js` only.

Deliverables:
1. Five pure functions per spec §5, no network calls inside.
2. `node --test` suite, the 8 cases in spec §7, green.
3. One worked example: two fixture profiles in, deck out, printed — so the team can see
   the engine behave without running the app.

Definition of done: tests green, `Discovered deck never contains self/swiped/blocked` proven
by test 6, score symmetry proven by test 5.

Depends on: nothing to start (fixtures). Swaps to real pool once Contract 1 lands.

---

## Role 3 — Frontend

Owns: `pages/discover.html`, `pages/profile.html`, `pages/login.html`, and the CSS files
for those pages.

All three HTML files are currently **0 bytes**. This is the biggest visible gap.

Deliverables:
1. `discover.html`: profile card (avatar, name, hall, dept, bio), interest chips,
   visible compatibility badge, like/pass controls, swipe/keyboard interaction.
2. Empty state: fewer than 5 candidates left — "you've seen everyone in your hall" style
   copy, not a blank screen.
3. Loading + error states. A failed pool fetch must not look like "no matches".
4. `profile.html`: read-only view of own profile + interests.
5. Wire `matching.js` against **mock fixtures first** — do not wait for the DB.

Rules:
- Never compute a score in the UI. Call `buildDeck()`. If a percentage appears anywhere
  that didn't come from `compatibilityPercent()`, it's a bug.
- Mobile first. This is a phone app experience rendered as web; test at 390px width.

Definition of done: full swipe loop works on fixtures with no network, then again with
staging Supabase.

---

## Role 4 — Product / Design

Owns: `docs/marketing/*`, card design decisions, copy.

Deliverables:
1. `brand-guide.md` (empty file) — colours, type, tone. The CSS already has a direction;
   document it so the frontend stops guessing.
2. Decide the three open questions in spec §8 (curve / deck mix / percent visibility) and
   write the answers into the spec. Someone must own these, or they get relitigated weekly.
3. Empty-state and error-state copy — the places users decide the app is dead.
4. Onboarding funnel review: signup → details → interests. Where do people drop, and is
   "pick 7" the right bar?

Definition of done: §8 answered in writing; copy handed to frontend as final text, not
placeholders.

---

## Role 5 — QA

Owns: `docs/testing/test-plan.md`, `docs/testing/bug-reports.md` (both empty).

Deliverables:
1. Test plan from spec §7 plus UI flows.
2. **Security checks, non-negotiable:**
   - user A cannot read user B's `swipes`, `matches`, `blocks`, `reports` (must return
     empty, not an error).
   - user A cannot insert a swipe as user B.
   - `get_interest_pool()` returns nothing for non-onboarded profiles.
   - a blocked user never appears in the deck.
3. Match integrity: two accounts swiping each other produce exactly one row in `matches`.
   Race test: both swipe simultaneously, confirm no duplicate and no missed match.
4. Bug reports with reproduction steps, expected vs actual, account used.

Definition of done: every security check passes on staging; sign-off written in
`bug-reports.md` before anything is called launch-ready.

---

## Coordination rules

- **One owner per file.** If two people need to change one file, the owner does it.
- **Contracts before code.** Contract 1 and 2 frozen, in the repo, in writing.
- **Staging only for tests.** Nobody tests against prod data, ever.
- **No dashboard schema edits.** Migrations or it didn't happen.
- **Demo cadence:** everyone shows working output, not progress reports. A green test run
  or a clickable screen counts. "I'm 80% done" doesn't.

## The honest risk

Five roles, four empty HTML files, and one commit in the repo. The plan above only works
if the DB owner lands migrations first and the frontend builds against fixtures instead of
waiting. If the frontend waits for the backend, you lose a week and ship the same thing
slower.
