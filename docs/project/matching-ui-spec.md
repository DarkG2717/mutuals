# Matching deck — vertical card UI

Prototype: `pages/discover-vertical.html` (self-contained, no build step, no deps).
Spec version: 2026-11-20 · Owner: Forge

## Concept

A photo-first card deck like Tinder, but the gesture axis is **vertical**, not horizontal:
**scroll down = connect**, **scroll up = pass**. Vertical reads as "go deeper" / "push away"
on a phone where the thumb already owns the bottom half of the screen, and it frees the
horizontal axis for photo gallery paging later.

Roughly 40% overlap with Tinder: keeps stack, photo dominance, swipe-to-decide, match moment.
Differs on axis, palette, type, language (Connect / Pass, not Like / Nope), and chrome.

## Design tokens

```
--peach-50   #fff8f4   page wash
--peach-100  #ffeade   top radial glow
--peach-200  #ffd6c1   card fallback gradient
--peach-300  #ffbf9f   gradient highlight
--peach-500  #ee7c4c   primary action (Connect)
--peach-600  #d55f2f   hover / accent text
--white      #ffffff   card surface
--ink        #291813   primary text
--ink-soft   #6f584f   secondary text
--muted      #a08a7f   hints, meta
--line       #f2e1d6   hairline borders
--pass-tint  #f3efe9   pass veil
```

Type: **Playfair Display** (names, veil stamps, headline) + **DM Sans** (everything else).
Same pairing as the rest of the site — the deck must not look like a different product.

Radii: card 30px, pills 999px. Shadow: one soft drop, no neon, no glow.

## Structure

1. `hud` — brand + "N nearby" counter.
2. `deck-wrap` — 4 cards rendered, only top 3 visible (`.955` / `.912` scale, 16px / 30px offset).
3. `rail` — hint line, swaps to a live decision ticker while the card is being pulled.
4. `controls` — Undo · Pass · Connect. Buttons exist for a11y and desktop; the gesture is the primary path.

## Gesture model

| Input | Pass | Connect |
|---|---|---|
| Pointer drag | up > 110px | down > 110px |
| Flick | vy < −0.55 px/ms | vy > 0.55 px/ms (with ≥46px travel) |
| Wheel / trackpad | accumulated ≤ −130 | ≥ +130 (220ms idle resets) |
| Keyboard | ↑ | ↓ |
| Button | Pass | Connect |

Rules:
- Card tracks the drag: `translateY(dy)`, `translateX(dx * 0.18)`, rotate `dx*0.02 + dy*-0.012`.
- Veil opacity ramps with travel ÷ threshold, so intent is visible before release.
- Below threshold → spring back with `cubic-bezier(.16,1,.3,1)`.
- Above threshold → fling 130% off-axis at 6°, fade, then advance. Total 300ms.
- `locked` flag blocks double-decisions during the fling.

## States

- **Default** — top card interactive, rail hint visible, one 14px nudge at 900ms.
- **Pulling** — veil + rail ticker ("release to connect" / "release to pass").
- **Deciding** — fling out, controls disabled.
- **Mutual** — full-screen overlay with both avatars, spark, chat CTA.
- **Passed** — toast with **Undo** (restores the card with a pull-down entry).
- **Empty** — dashed card, "That's everyone for now", shuffle reset.

## Integration (real data)

Replace the `PROFILES` array. Everything else stays:

1. `matching.js` already returns `[{ profile, score, percent }]` — map to
   `{ id, name, age, school, level, hall, photo: avatar_url, match: percent, mutual, reason, tags }`.
2. `mutual` must come from the API, not the card. Options:
   - a `matches` row already exists for the pair → mutual, or
   - optimistic: show the overlay after insert only if the other side's swipe row exists.
   Recommended: after `swipes.insert`, `select` the reciprocal row; set `mutual` from that.
3. `reason` can be generated from `sharedInterests`: "You both like **afrobeats** and **thrifting**".
4. Keep the veil + threshold constants in one place so the web deck and the Flutter deck match.

## Known gaps (deliberate, prototype scope)

- Photo pips are decorative — gallery paging not wired.
- `DK` avatar in the mutual overlay is hard-coded.
- Undo is client-side only; it does not delete the `swipes` row.
- No haptics (web); call `navigator.vibrate(8)` on commit if desired.
