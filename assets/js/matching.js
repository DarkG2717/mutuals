/**
 * MUTUALS — matching engine.
 *
 * Pure functions only: no network, no Supabase, no DOM.
 * The caller fetches the interest pool + idf stats and hands the rows in.
 * That is what makes this testable in node without a database.
 *
 * Spec: docs/project/matching-spec.md
 */

export const DISPLAY_EXPONENT = 0.6;
export const TOP_SLICE = 0.7;
export const EXPLORE_SLICE = 0.3;
export const DEFAULT_DECK_SIZE = 20;

/**
 * Confidence knob. A cosine score can only be as trustworthy as the evidence
 * behind it: two users sharing a single interest always score 1.0 no matter how
 * common that interest is. Dividing that evidence down by (weight + K) turns
 * "one thing in common" into a mediocre match and leaves four or five genuine
 * overlaps near their real score.
 *
 * Higher K = pickier product. 1.2 was chosen deliberately: no pair can display
 * 100%, and the badge only goes high when the overlap is wide.
 */
export const CONFIDENCE_K = 1.2;

/**
 * @param {Array<{user_id?: string, userId?: string, interest_name?: string, interestName?: string}>} poolRows
 * @param {Map<string, number>} idfMap interest name -> idf weight
 * @returns {Map<string, {vector: Map<string, number>, norm: number}>}
 */
export function buildInterestVectors(poolRows, idfMap = new Map()) {
  const vectors = new Map();

  for (const row of poolRows) {
    const userId = row.user_id ?? row.userId;
    const name = row.interest_name ?? row.interestName;
    if (!userId || !name) continue;

    let entry = vectors.get(userId);
    if (!entry) {
      entry = { vector: new Map(), norm: 0 };
      vectors.set(userId, entry);
    }

    // interest_stats.idf defaults to 0 and is only filled by the nightly refresh.
    // A 0 (or NaN/negative) weight would zero the vector norm and silently score
    // every pair 0%, so an unusable weight falls back to the neutral 1.
    const raw = idfMap.get(name);
    const weight = Number.isFinite(raw) && raw > 0 ? raw : 1;
    entry.vector.set(name, weight);
  }

  for (const entry of vectors.values()) {
    let sumSquared = 0;
    for (const weight of entry.vector.values()) sumSquared += weight * weight;
    entry.norm = Math.sqrt(sumSquared);
  }

  return vectors;
}

/**
 * Rarity-weighted overlap: the dot product of the two vectors, i.e. how much
 * weight the pair actually has in common. This is the "evidence" the cosine
 * score is built from, and the input to confidenceFactor.
 * @param {{vector: Map<string, number>, norm: number}} a
 * @param {{vector: Map<string, number>, norm: number}} b
 * @returns {number}
 */
export function sharedWeight(a, b) {
  if (!a || !b) return 0;
  const [small, large] = a.vector.size <= b.vector.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [name, weight] of small.vector) {
    const other = large.vector.get(name);
    if (other !== undefined) dot += weight * other;
  }
  return dot;
}

/**
 * Shrinks a score towards zero when the shared evidence is thin.
 * One shared common interest -> ~0.29. Four shared common interests -> ~0.62.
 * @param {number} weight rarity-weighted overlap (see sharedWeight)
 * @param {number} k
 * @returns {number} 0..1
 */
export function confidenceFactor(weight, k = CONFIDENCE_K) {
  const w = Number.isFinite(weight) && weight > 0 ? weight : 0;
  const knob = Number.isFinite(k) && k > 0 ? k : CONFIDENCE_K;
  return w / (w + knob);
}

/**
 * Cosine similarity between two interest vectors. Symmetric, bounded 0..1.
 * @param {{vector: Map<string, number>, norm: number}} a
 * @param {{vector: Map<string, number>, norm: number}} b
 * @returns {number}
 */
export function scorePair(a, b) {
  if (!a || !b || !a.norm || !b.norm) return 0;

  const dot = sharedWeight(a, b);
  const denominator = a.norm * b.norm;
  if (denominator === 0) return 0;

  return Math.min(1, Math.max(0, dot / denominator));
}

/**
 * Turns a 0..1 score into the percentage shown on the card.
 * The curve lifts the low band so a genuine 0.31 pair doesn't read as rejection.
 *
 * Deliberately single-argument: an earlier version took the exponent as a second
 * positional parameter, which made `scores.map(compatibilityPercent)` silently
 * pass the array index as the exponent. Tune the curve with
 * `compatibilityPercentWith` instead, and leave this one safe to pass around.
 *
 * @param {number} score
 * @returns {number} integer 0..100
 */
export function compatibilityPercent(score) {
  return compatibilityPercentWith(score, DISPLAY_EXPONENT);
}

/**
 * Same curve, explicit exponent. For tuning runs and audits only.
 * @param {number} score
 * @param {number} exponent
 * @returns {number} integer 0..100
 */
export function compatibilityPercentWith(score, exponent = DISPLAY_EXPONENT) {
  const clamped = Math.min(1, Math.max(0, Number(score) || 0));
  const power = Number.isFinite(exponent) && exponent > 0 ? exponent : DISPLAY_EXPONENT;
  return Math.round(100 * Math.pow(clamped, power));
}

/**
 * Drops anyone the viewer must never see: self, already swiped, blocked either way,
 * not onboarded.
 * @param {string} viewerId
 * @param {Array<object>} profiles
 * @param {Array<object>} swipes rows with swiper_id / swiped_id
 * @param {Array<object>} blocks rows with blocker_id / blocked_id
 * @returns {Array<object>}
 */
export function filterCandidates(viewerId, profiles, swipes = [], blocks = []) {
  const alreadySwiped = new Set();
  for (const swipe of swipes) {
    const swiper = swipe.swiper_id ?? swipe.swiperId;
    const swiped = swipe.swiped_id ?? swipe.swipedId;
    if (swiper === viewerId) alreadySwiped.add(swiped);
  }

  const blocked = new Set();
  for (const block of blocks) {
    const blocker = block.blocker_id ?? block.blockerId;
    const blockedUser = block.blocked_id ?? block.blockedId;
    if (blocker === viewerId) blocked.add(blockedUser);
    if (blockedUser === viewerId) blocked.add(blocker);
  }

  return profiles.filter(profile => {
    const id = profile.id ?? profile.user_id ?? profile.userId;
    if (!id) return false;
    if (id === viewerId) return false;
    if (alreadySwiped.has(id)) return false;
    if (blocked.has(id)) return false;
    if (profile.onboarding_completed === false) return false;
    if (profile.onboardingCompleted === false) return false;
    return true;
  });
}

/**
 * Builds one deck: highest scorers first, then a random slice of the remainder so
 * new users don't get starved by rich-get-richer ranking.
 * @param {string} viewerId
 * @param {Array<object>} candidates
 * @param {Map<string, {vector: Map<string, number>, norm: number}>} vectors
 * @param {{size?: number, topSlice?: number, rng?: () => number}} options
 * @returns {Array<{profile: object, score: number, percent: number}>}
 */
export function buildDeck(viewerId, candidates, vectors, options = {}) {
  const {
    size = DEFAULT_DECK_SIZE,
    topSlice = TOP_SLICE,
    rng = Math.random
  } = options;

  const viewer = vectors.get(viewerId);
  if (!viewer || viewer.vector.size === 0) return [];

  const scored = [];
  for (const profile of candidates) {
    const id = profile.id ?? profile.user_id ?? profile.userId;
    if (!id) continue;

    const candidateVector = vectors.get(id);
    if (!candidateVector || candidateVector.vector.size === 0) continue;

    const score = scorePair(viewer, candidateVector) * confidenceFactor(sharedWeight(viewer, candidateVector));
    scored.push({ profile, score, percent: compatibilityPercent(score) });
  }

  scored.sort((a, b) => b.score - a.score);

  const topCount = Math.min(scored.length, Math.round(size * topSlice));
  const top = scored.slice(0, topCount);
  const remainder = scored.slice(topCount);

  const exploreCount = Math.min(remainder.length, Math.max(0, size - topCount));
  const explore = sampleWithoutReplacement(remainder, exploreCount, rng);

  return top.concat(explore);
}

/**
 * Fisher-Yates partial sample. Deterministic when a seeded rng is passed in.
 */
export function sampleWithoutReplacement(items, count, rng = Math.random) {
  if (count <= 0) return [];

  const pool = items.slice();
  const picked = [];
  const limit = Math.min(count, pool.length);

  for (let i = 0; i < limit; i += 1) {
    const index = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[index]] = [pool[index], pool[i]];
    picked.push(pool[i]);
  }

  return picked;
}

/**
 * Converts the interest_stats rows into the Map the scorer wants.
 * @param {Array<{interest_name?: string, interestName?: string, name?: string, idf: number}>} statRows
 * @returns {Map<string, number>}
 */
export function buildIdfMap(statRows) {
  const idfMap = new Map();
  for (const row of statRows) {
    const name = row.interest_name ?? row.interestName ?? row.name;
    if (!name) continue;
    idfMap.set(name, Number(row.idf) || 0);
  }
  return idfMap;
}
