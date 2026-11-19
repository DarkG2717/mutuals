import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInterestVectors,
  scorePair,
  compatibilityPercent,
  filterCandidates,
  buildDeck,
  buildIdfMap
} from "../assets/js/matching.js";

const rows = userId => interestName => [{ user_id: userId, interest_name: interestName }];

function vectorFor(userId, names) {
  return buildInterestVectors(names.map(interest_name => ({ user_id: userId, interest_name })));
}

test("identical interests score 1.0 and display 100", () => {
  const names = ["Music", "Gaming", "Poetry"];
  const a = vectorFor("a", names).get("a");
  const b = vectorFor("b", names).get("b");

  assert.equal(scorePair(a, b), 1);
  assert.equal(compatibilityPercent(scorePair(a, b)), 100);
});

test("zero overlap scores 0 and displays 0", () => {
  const a = vectorFor("a", ["Music", "Gaming"]).get("a");
  const b = vectorFor("b", ["Law", "Swimming"]).get("b");

  assert.equal(scorePair(a, b), 0);
  assert.equal(compatibilityPercent(scorePair(a, b)), 0);
});

test("7 vs 20 interests with 5 shared is normalised by count", () => {
  const shared = ["A", "B", "C", "D", "E"];
  const small = vectorFor("small", shared).get("small");
  const large = vectorFor("large", shared.concat(
    ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"]
  )).get("large");

  const score = scorePair(small, large);

  assert.ok(score < 1, "subset must not score a perfect match");
  assert.ok(score > 0.28, `expected a meaningful score, got ${score}`);
  // 5 of 20 shared against a 5-norm gives 5 / (sqrt(5)*sqrt(20)) = 0.5
  assert.ok(Math.abs(score - 0.5) < 1e-9, `expected 0.5, got ${score}`);
});

test("a rare shared interest beats three common shared ones", () => {
  const idfMap = new Map([
    ["Music", 0.7],
    ["Movies", 0.75],
    ["Gaming", 0.8],
    ["Law", 1.1],
    ["Swimming", 1.4],
    ["Niche", 3.2]
  ]);

  // Share one rare interest, differ elsewhere.
  const rareA = buildInterestVectors(
    [{ user_id: "a", interest_name: "Niche" }, { user_id: "a", interest_name: "Music" }], idfMap
  ).get("a");
  const rareB = buildInterestVectors(
    [{ user_id: "b", interest_name: "Niche" }, { user_id: "b", interest_name: "Law" }], idfMap
  ).get("b");

  // Share three common interests, differ elsewhere.
  const commonA = buildInterestVectors([
    { user_id: "c", interest_name: "Music" },
    { user_id: "c", interest_name: "Movies" },
    { user_id: "c", interest_name: "Gaming" },
    { user_id: "c", interest_name: "Law" }
  ], idfMap).get("c");
  const commonB = buildInterestVectors([
    { user_id: "d", interest_name: "Music" },
    { user_id: "d", interest_name: "Movies" },
    { user_id: "d", interest_name: "Gaming" },
    { user_id: "d", interest_name: "Swimming" }
  ], idfMap).get("d");

  const rarePair = scorePair(rareA, rareB);
  const commonPair = scorePair(commonA, commonB);

  assert.ok(rarePair > 0.9, `rare pair should score high, got ${rarePair}`);
  assert.ok(commonPair < 0.6, `common pair should score lower, got ${commonPair}`);
  assert.ok(rarePair > commonPair, "rarity must win");
});

test("score is symmetric across 100 random pairs", () => {
  let seed = 1234567;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const catalogue = Array.from({ length: 12 }, (_, index) => `Interest ${index}`);

  for (let round = 0; round < 100; round += 1) {
    const pick = () => catalogue.filter(() => random() > 0.6);
    const a = vectorFor(`a${round}`, pick()).get(`a${round}`);
    const b = vectorFor(`b${round}`, pick()).get(`b${round}`);

    const forward = scorePair(a, b);
    const backward = scorePair(b, a);

    assert.equal(forward, backward, `round ${round} broke symmetry`);
    assert.ok(forward >= 0 && forward <= 1);
  }
});

test("deck never contains self, already swiped, or blocked users", () => {
  const viewerId = "viewer";
  const profiles = [
    { id: viewerId, onboarding_completed: true },
    { id: "swiped", onboarding_completed: true },
    { id: "blocker", onboarding_completed: true },
    { id: "blocked", onboarding_completed: true },
    { id: "not-onboarded", onboarding_completed: false },
    { id: "stranger", onboarding_completed: true }
  ];

  const swipes = [{ swiper_id: viewerId, swiped_id: "swiped", decision: "pass" }];
  const blocks = [
    { blocker_id: viewerId, blocked_id: "blocked" },
    { blocker_id: "blocker", blocked_id: viewerId }
  ];

  const survivors = filterCandidates(viewerId, profiles, swipes, blocks).map(profile => profile.id);

  assert.deepEqual(survivors, ["stranger"]);
});

test("deck mix lands near 70/30 on a 200 candidate fixture", () => {
  const viewerId = "viewer";
  const poolRows = [{ user_id: viewerId, interest_name: "Shared" }];

  const candidates = [];
  for (let index = 0; index < 200; index += 1) {
    const id = `user-${index}`;
    // 70 candidates share the interest and score 1.0; 130 score 0.
    poolRows.push({ user_id: id, interest_name: index < 70 ? "Shared" : `Solo ${index}` });
    candidates.push({ id, onboarding_completed: true });
  }

  const vectors = buildInterestVectors(poolRows);

  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const deck = buildDeck(viewerId, candidates, vectors, { size: 100, rng });

  assert.equal(deck.length, 100);

  const top = deck.slice(0, 70);
  const explore = deck.slice(70);

  assert.equal(top.length, 70);
  assert.equal(explore.length, 30);
  assert.ok(top.every(card => card.score === 1), "top slice should be the strongest pairs");
  assert.ok(explore.every(card => card.score === 0), "explore slice should be drawn from the remainder");
  assert.equal(new Set(deck.map(card => card.profile.id)).size, 100, "no duplicate cards");
});

test("compatibilityPercent is monotonic", () => {
  let previous = -1;
  for (let step = 0; step <= 100; step += 1) {
    const percent = compatibilityPercent(step / 100);
    assert.ok(percent >= previous, `percent went backwards at ${step / 100}`);
    assert.ok(percent >= 0 && percent <= 100);
    previous = percent;
  }
});

test("buildIdfMap tolerates both column namings", () => {
  const map = buildIdfMap([
    { interest_name: "Music", idf: 0.7 },
    { interestName: "Poetry", idf: 2.4 },
    { name: "Law", idf: 1.1 }
  ]);

  assert.equal(map.get("Music"), 0.7);
  assert.equal(map.get("Poetry"), 2.4);
  assert.equal(map.get("Law"), 1.1);
});

test("empty viewer vector produces an empty deck", () => {
  const vectors = buildInterestVectors([{ user_id: "other", interest_name: "Music" }]);
  assert.deepEqual(buildDeck("viewer", [{ id: "other" }], vectors), []);
});
