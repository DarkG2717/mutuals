/**
 * MUTUALS — matching engine audit.
 *
 * Not a unit test. This is a simulation: it builds a synthetic student body with a
 * realistic (zipf-shaped) interest distribution, runs the real deck builder for every
 * user, and reports the numbers the product actually feels — score spread, 100% rate,
 * deck composition, ordering violations, duplicates.
 *
 * Run: node scripts/audit-matching.mjs
 */

import {
  buildInterestVectors,
  buildIdfMap,
  scorePair,
  sharedWeight,
  confidenceFactor,
  compatibilityPercent,
  compatibilityPercentWith,
  filterCandidates,
  buildDeck
} from "../assets/js/matching.js";

const adjusted = (a, b) => scorePair(a, b) * confidenceFactor(sharedWeight(a, b));

/* ---------- deterministic rng ---------- */
function makeRng(seed = 20261120) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/* ---------- synthetic student body ---------- */
const rng = makeRng();

const INTERESTS = [
  ["Music", 100], ["Movies", 92], ["Football", 88], ["Gaming", 80], ["Food", 78],
  ["Travel", 70], ["Fashion", 66], ["Photography", 60], ["Reading", 55], ["Gym", 52],
  ["Anime", 48], ["Afrobeats", 46], ["Startups", 40], ["Coding", 38], ["Art", 34],
  ["Podcasts", 30], ["Cooking", 28], ["Basketball", 24], ["Poetry", 20], ["Chess", 18],
  ["Film", 16], ["Design", 14], ["Volunteering", 12], ["Debate", 10], ["Hiking", 9],
  ["Jazz", 7], ["Thrifting", 6], ["Astronomy", 4], ["Beekeeping", 2], ["Fencing", 1]
].map(([name, weight]) => ({ name, weight }));

const N_USERS = 200;

function pickInterests() {
  const count = 3 + Math.floor(rng() * 8); // 3..10 interests, per onboarding
  const chosen = new Set();
  const total = INTERESTS.reduce((sum, i) => sum + i.weight, 0);

  while (chosen.size < count) {
    let roll = rng() * total;
    for (const interest of INTERESTS) {
      roll -= interest.weight;
      if (roll <= 0) { chosen.add(interest.name); break; }
      if (chosen.size >= count) break;
    }
  }
  return [...chosen];
}

const users = [];
for (let i = 0; i < N_USERS; i += 1) {
  users.push({ id: `u${i}`, name: `User ${i}`, interests: pickInterests() });
}

/* ---------- idf, exactly as refresh_interest_stats() computes it ---------- */
const counts = new Map();
for (const user of users) {
  for (const name of user.interests) counts.set(name, (counts.get(name) || 0) + 1);
}
const statsRows = INTERESTS.map(i => ({
  interest_name: i.name,
  user_count: counts.get(i.name) || 0,
  idf: Math.log(1 + N_USERS / Math.max(counts.get(i.name) || 0, 1))
}));

const idfMap = buildIdfMap(statsRows);
const poolRows = users.flatMap(u => u.interests.map(interest_name => ({ user_id: u.id, interest_name })));
const vectors = buildInterestVectors(poolRows, idfMap);

/* ---------- run the deck for every user ---------- */
const percentiles = [];
const problems = [];
let totalCards = 0;
let hundredPercentCards = 0;
let zeroPercentCards = 0;

for (const viewer of users) {
  const candidates = filterCandidates(viewer.id, users, [], []);
  const deck = buildDeck(viewer.id, candidates, vectors, { size: 20, rng });

  const ids = deck.map(c => c.profile.id);
  if (new Set(ids).size !== ids.length) problems.push(`${viewer.id}: duplicate cards in deck`);
  if (ids.includes(viewer.id)) problems.push(`${viewer.id}: deck contains self`);
  if (deck.length > 20) problems.push(`${viewer.id}: deck longer than size (${deck.length})`);

  // only the ranked slice must be sorted; the explore tail is random by design
  const ranked = Math.min(deck.length, Math.round(20 * 0.7));
  for (let i = 1; i < ranked; i += 1) {
    if (deck[i].score > deck[i - 1].score + 1e-12) {
      problems.push(`${viewer.id}: ranked slice not sorted at index ${i}`);
      break;
    }
  }

  for (const card of deck) {
    totalCards += 1;
    percentiles.push(card.percent);
    if (card.percent === 100) hundredPercentCards += 1;
    if (card.percent === 0) zeroPercentCards += 1;

    const expected = compatibilityPercent(card.score);
    if (expected !== card.percent) {
      problems.push(`${viewer.id}: percent mismatch ${card.percent} vs ${expected}`);
    }
  }
}

/* ---------- all-pairs score distribution ---------- */
const pairScores = [];
for (let i = 0; i < users.length; i += 1) {
  for (let j = i + 1; j < users.length; j += 1) {
    pairScores.push(adjusted(vectors.get(users[i].id), vectors.get(users[j].id)));
  }
}
const pairPercents = pairScores.map(s => compatibilityPercent(s)).sort((a, b) => a - b);

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/* ---------- hazard 1: stats table never refreshed (idf defaults to 0) ---------- */
const staleIdfMap = buildIdfMap(statsRows.map(r => ({ interest_name: r.interest_name, idf: 0 })));
const staleVectors = buildInterestVectors(poolRows, staleIdfMap);
const staleDeck = buildDeck("u0", filterCandidates("u0", users, [], []), staleVectors, { size: 20, rng });

/* ---------- hazard 2: single shared interest is always a perfect match ---------- */
const pairA = buildInterestVectors([{ user_id: "a", interest_name: "Music" }], idfMap).get("a");
const pairB = buildInterestVectors([{ user_id: "b", interest_name: "Music" }], idfMap).get("b");
const singleShared = compatibilityPercent(scorePair(pairA, pairB));

/* ---------- hazard 3: identical interest sets, however tiny ---------- */
const tinyA = buildInterestVectors(
  [{ user_id: "a", interest_name: "Food" }, { user_id: "a", interest_name: "Music" }], idfMap).get("a");
const tinyB = buildInterestVectors(
  [{ user_id: "b", interest_name: "Food" }, { user_id: "b", interest_name: "Music" }], idfMap).get("b");

/* ---------- hazard 4: swap an interest for an equally rare one ---------- */
const swapA = buildInterestVectors(
  [{ user_id: "a", interest_name: "Beekeeping" }, { user_id: "a", interest_name: "Music" }], idfMap).get("a");
const swapB = buildInterestVectors(
  [{ user_id: "b", interest_name: "Fencing" }, { user_id: "b", interest_name: "Music" }], idfMap).get("b");

/* ---------- shared-interest evidence + proposed confidence factor ---------- */
const sharedCounts = new Map();
const proposed = [];
for (let i = 0; i < users.length; i += 1) {
  for (let j = i + 1; j < users.length; j += 1) {
    const va = vectors.get(users[i].id);
    const vb = vectors.get(users[j].id);
    let sharedWeight = 0;
    let sharedCount = 0;
    const [small, large] = va.vector.size <= vb.vector.size ? [va, vb] : [vb, va];
    for (const [name, weight] of small.vector) {
      const other = large.vector.get(name);
      if (other !== undefined) { sharedWeight += weight * other; sharedCount += 1; }
    }
    sharedCounts.set(sharedCount, (sharedCounts.get(sharedCount) || 0) + 1);
    const confidence = sharedWeight / (sharedWeight + 1.2);
    proposed.push(compatibilityPercent(scorePair(va, vb) * confidence));
  }
}
const proposedSorted = proposed.sort((a, b) => a - b);

/* ---------- report ---------- */
const line = (label, value) => console.log(`${label.padEnd(44)} ${value}`);

console.log("\n=== MUTUALS matching audit ===");
console.log(`users simulated: ${N_USERS}   interests: ${INTERESTS.length}   cards scored: ${totalCards}\n`);

console.log("-- pairwise compatibility (all pairs) --");
line("pairs", pairScores.length);
const sortedScores = pairScores.slice().sort((a, b) => a - b);
line("raw score    min / p50 / p90 / max", `${pct(sortedScores, 0).toFixed(3)} / ${pct(sortedScores, 0.5).toFixed(3)} / ${pct(sortedScores, 0.9).toFixed(3)} / ${pct(sortedScores, 1).toFixed(3)}`);
line("display %    p10 / p50 / p90", `${pct(pairPercents, 0.1)}% / ${pct(pairPercents, 0.5)}% / ${pct(pairPercents, 0.9)}%`);
line("pairs scoring 100%", `${pairPercents.filter(p => p === 100).length} (${((pairPercents.filter(p => p === 100).length / pairPercents.length) * 100).toFixed(2)}%)`);
line("pairs scoring 0%", `${pairPercents.filter(p => p === 0).length} (${((pairPercents.filter(p => p === 0).length / pairPercents.length) * 100).toFixed(1)}%)`);
line("pairs displayed >= 70%", `${pairPercents.filter(p => p >= 70).length} (${((pairPercents.filter(p => p >= 70).length / pairPercents.length) * 100).toFixed(2)}%)`);
line("pairs displayed >= 80%", `${pairPercents.filter(p => p >= 80).length} (${((pairPercents.filter(p => p >= 80).length / pairPercents.length) * 100).toFixed(2)}%)`);

console.log("\n-- deck composition (20 per user) --");
line("cards at 100%", hundredPercentCards);
line("cards at 0%", zeroPercentCards);
line("deck size min / max", `${Math.min(...users.map(u => buildDeck(u.id, filterCandidates(u.id, users), vectors, { size: 20, rng }).length))} / 20`);
line("invariant violations", problems.length ? problems.slice(0, 5).join("; ") : "none");

console.log("\n-- shared-interest evidence (pairs) --");
[...sharedCounts.entries()].sort((a, b) => a[0] - b[0])
  .forEach(([count, pairs]) => line(`  pairs sharing ${count} interest(s)`, pairs));

console.log("\n-- confidence factor sweep  k in sharedWeight/(sharedWeight+k) --");
for (const k of [0.4, 0.6, 0.8, 1.2, 2.0]) {
  const out = [];
  for (let i = 0; i < users.length; i += 1) {
    for (let j = i + 1; j < users.length; j += 1) {
      const va = vectors.get(users[i].id); const vb = vectors.get(users[j].id);
      let sw = 0; let sc = 0;
      const [sm, lg] = va.vector.size <= vb.vector.size ? [va, vb] : [vb, va];
      for (const [n, w] of sm.vector) { const o = lg.vector.get(n); if (o !== undefined) { sw += w * o; sc += 1; } }
      out.push(compatibilityPercent(scorePair(va, vb) * (sw / (sw + k))));
    }
  }
  out.sort((a, b) => a - b);
  line(`  k=${k.toFixed(1)}  p50/p90/p99`, `${pct(out, .5)}% / ${pct(out, .9)}% / ${pct(out, .99)}%  |  >=70%: ${((out.filter(v => v >= 70).length / out.length) * 100).toFixed(2)}%  |  100%: ${out.filter(v => v === 100).length}`);
}

console.log("\n-- with confidence factor  sharedWeight/(sharedWeight+1.2) --");
line("display %    p50 / p90 / p99", `${pct(proposedSorted, 0.5)}% / ${pct(proposedSorted, 0.9)}% / ${pct(proposedSorted, 0.99)}%`);
line("pairs displayed >= 70%", `${proposedSorted.filter(p => p >= 70).length} (${((proposedSorted.filter(p => p >= 70).length / proposedSorted.length) * 100).toFixed(2)}%)`);
line("pairs displayed 100%", proposedSorted.filter(p => p === 100).length);

console.log("\n-- hazards --");
line("stale stats (idf = 0, no refresh)", `deck=${staleDeck.length}, percents=${[...new Set(staleDeck.map(c => c.percent))].join(",")}%`);
line("one shared interest only", `${singleShared}%`);
line("identical 2-interest sets", `${compatibilityPercent(scorePair(tinyA, tinyB))}%`);
line("equally rare but disjoint", `${compatibilityPercent(scorePair(swapA, swapB))}%`);
line("map(compatibilityPercent) arity trap", `${[0.5, 0.5, 0.5].map(compatibilityPercent).join(", ")} (exponent becomes index)`);

console.log("\n-- slowest deck (u0, first 8) --");
for (const card of buildDeck("u0", filterCandidates("u0", users), vectors, { size: 20, rng }).slice(0, 8)) {
  console.log(`  ${card.percent.toString().padStart(3)}%  ${card.profile.id.padEnd(5)} shared=${card.score.toFixed(3)}`);
}
console.log("");
