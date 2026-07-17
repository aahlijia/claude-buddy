# Sprite animation expansion, round 2 — bout variety, celebration flavor, idle life

_Designed + implemented 2026-07-17 · branch `feature/interactive-fight-scene`,
atop the uncommitted P0–P3 pass (`design-sprite-animation.md`)_
_Status: **implemented** (P4–P7), 832 tests pass, `tsc` + `bash -n` clean,
zero shell changes. Uncommitted._

The first pass (P0–P3) extracted the frame-geometry primitives and spent them
on an idle emote row plus dodge/parry bout variety. This pass spends the same
primitives further, across four independent axes the user chose to pursue
together:

1. **P4 — more bout outcomes**: `crit` and `counter`, alongside the existing
   `hit`/`dodge`/`parry`.
2. **P5 — richer celebrations**: each `CelebrationKind` gets its own flourish
   flavor, and the common cases (level-up, loot, whim) opt into a small one
   instead of going unflourished.
3. **P6 — idle micro-behavior**: a rare "glance" distinct from the existing
   blink, derived the same way blink is (eye substitution over frame 0).
4. **P7 — new per-species art**: a genuine 4th art frame (a "stretch" pose)
   for a small pilot batch of species — the one axis that deliberately breaks
   the "derive-on-read, no new art" invariant the rest of the system holds to.

Same governing constraint as round 1: `NOW=$(date +%s)`, 1 frame/second,
phase-locked to the wall clock. Nothing here changes that; every addition is
either a new baked eye-substitution state (P6) or a widened/differentiated
existing flipbook (P4, P5), except P7's real new art.

---

## P4 — Bout outcomes: `crit` + `counter`

Today `BoutOutcome` is `"hit" | "dodge" | "parry"`, rolled once per bout via a
single `rng()` call in `bakePendingScene` (`combat.ts:473-476`), mixed
50/25/25. This adds two more buckets **without adding any new RNG draws** —
the fixed draw order (`first, outA, dmgA, outB, dmgB, gaps`) that
`combat.test.ts`'s `bouts(seed)` helper depends on is unchanged; only the
outcome-bucket boundaries and what `bakeBoutFrames` does with the *existing*
rolled damage number change.

```ts
export type BoutOutcome = "hit" | "dodge" | "parry" | "crit" | "counter";

const outcome = (): BoutOutcome => {
  const r = rng();
  return r < 0.4 ? "hit"
    : r < 0.6 ? "dodge"
    : r < 0.8 ? "parry"
    : r < 0.9 ? "crit"
    : "counter";
};
```

(New mix: hit 40 / dodge 20 / parry 20 / crit 10 / counter 10 — hit stays the
plurality outcome, the two new ones are rare accents.)

### `crit` — a heavier hit

Same three beats as `hit` (walk-in → impact → back-off); the difference is
entirely cosmetic, reusing the damage number `roll(attacker)` already rolled
for the bout, scaled at bake time (no new rng call):

- Impact/triumph eyes: attacker `*` (spark) instead of `>`, defender `X`
  (KO'd-wide) instead of `x` — reads heavier than a plain hit.
- Pop glyph: `‼ -N` (bold+red) instead of `✗ -N`, `N = damage * 2`.
- Frame structure identical to `hit` otherwise — same `shift` beats, same
  overlay-carries-every-frame rule.

### `counter` — a punished parry

Reuses `parry`'s first two beats (lunge in, clash) but the third beat isn't a
clean recoil — the **defender's** follow-through lands on the **original
attacker**, using the same rolled damage number reinterpreted as the
counter's damage (still no new rng draw):

```
lunge (shift 2, attacker eyes >)
clash (shift 1, strike: true — blades meet)
counter-impact (shift 0, pop over the ATTACKER, attacker eye O, defender eye ^)
```

`bakeBoutFrames`'s `at()` helper already parameterizes which side an overlay
lands on (`over: defender`); `counter` is the first outcome to set
`over: attacker` instead — a one-line change, no new primitive.

### Gate

`combat.test.ts`'s outcome-aware tests get two new dedicated cases (crit,
counter), and the existing bucket-boundary assertions move to the new
thresholds. Constant W/H across all frames re-verified (same mechanism as
dodge/parry, so this is a re-run of the existing invariant, not a new one).

---

## P5 — Celebration-kind-specific flourish

Today `flourishFrames(bones)` is one fixed cycle
(`FLOURISH_EYES = ["^","O","*","^"]`, 6-tick bob) used identically for every
`CelebrationKind`, and only two call sites opt in at all — `shiny` and
`ascension` (`index.ts:247,1190`). Level-up, loot, and whim were deliberately
left unflourished ("never the common case") when flourish was still an
untrimmed, always-costs-a-row feature. `finalizeIdleBlock` (P1) now makes a
flourish row free whenever there's nothing to show, so extending coverage no
longer has the row-cost objection it did in round 1.

### Per-kind cycles

```ts
const FLOURISH_BY_KIND: Record<CelebrationKind, {
  eyes: readonly string[];
  frameSequence: readonly number[];
}> = {
  ascension: { eyes: ["^", "O", "*", "^"], frameSequence: [0, 1, 2, 3, 2, 1] }, // unchanged, the biggest
  shiny:     { eyes: ["*", "^", "*", "^"], frameSequence: [0, 1, 2, 3, 2, 1] }, // sparkle-forward
  levelup:   { eyes: ["^", "*", "^"],      frameSequence: [0, 1, 2, 1] },       // a snappy pop
  loot:      { eyes: ["^", "^"],           frameSequence: [0, 1] },             // a small happy blink
  whim:      { eyes: ["^", "-", "^"],      frameSequence: [0, 1, 2, 1] },       // a content nod
  discovery: { eyes: ["^", "^"],           frameSequence: [0, 1] },             // present but minimal
};
```

`flourishFrames(bones: BuddyBones, kind: CelebrationKind = "ascension")` looks
up its cycle from this table instead of the hardcoded constants; the frame
bake itself (`renderSpeciesFrame(bones, i % 2, eye)`) is unchanged.

### Wiring

`state.ts`'s flourish block (`state.ts:1156-1165`) already runs after
`celebration` is built, so `celebration?.kind` is available at the call site:

```ts
const fl = flourishFrames(companion.bones, celebration?.kind ?? "ascension");
```

`award-xp.ts`'s two `writeStatusState` calls (`:134`, `:167`) — level-up,
loot, whim — add `flourish: celebration != null && celebration.kind !== "discovery"`.
Discovery stays unflourished by choice (a one-time system message reads as
the buddy narrating, not performing). `index.ts`'s existing ascension/shiny
call sites are unchanged.

### Gate

`finalizeIdleBlock` already treats idle+flourish as one shared-drop-set unit
(P1); no changes needed there — a shorter flourish (loot's 2 frames) still
needs the same overlay-row contract flourish already has (blank on frames
that don't carry an emote), which the existing bare-flourish path already
provides (flourish stays bare of gear/emote by design). New unit tests per
kind verify the right cycle is selected and playback length matches the
`frameSequence` table above.

---

## P6 — Idle glance (micro-behavior, no new art)

The existing blink is `resolveFrame(0, "-")` — frame 0's body re-rendered with
a different eye glyph, at sequence index 3. This adds a second, distinct
micro-expression the same way: a "glance" using eye glyph `'` (a subtle
upward/sideways tick, visually different from blink's flat `-`), at a new
sequence index 4.

```ts
// getStatusFrames' neutral branch:
frames: [
  resolveFrame(0, bones.eye), // 0
  resolveFrame(1, bones.eye), // 1
  resolveFrame(2, bones.eye), // 2
  resolveFrame(0, "-"),       // 3 blink
  resolveFrame(0, "'"),       // 4 glance
],
frameSequence: [...STATUS_FRAME_SEQUENCE],
```

```ts
export const STATUS_FRAME_SEQUENCE: readonly number[] = [
  0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 0,
];
```

(15 → 18 ticks; the glance lands well clear of the blink so the two never
read as the same beat.) Every species already carries an `{E}` placeholder on
frame 0 (verified against the full `SPECIES_ART` table — blink already
depends on this), so this is unconditionally safe across all 20 species with
zero new art and zero gear-anchor risk (same frame-0 layout blink already
uses).

### Gate

`art.test.ts` gets a case asserting `emote`/anchor invariants hold for the new
frame index the same way they do for blink — mechanical, since it's the exact
same code path with a different eye glyph.

---

## P7 — New per-species art (pilot: duck, cat, robot)

The one axis that adds real hand-authored art rather than deriving from what
exists. Scoped to **3 species** for this pass — the risk here is entirely in
hand-tuning ASCII columns against `GEAR_ANCHORS`, and the biggest-bang
species-breadth win is expanding the pilot in a follow-up once the mechanism
is proven, not authoring all 20 blind in one pass.

### The frame

A 4th `SPECIES_ART` frame ("stretch") — a distinct body pose, not a palette
swap. Two hard constraints, both satisfied by construction below (verified by
literal column-indexing, not by inspection after the fact):

- **Row 0 stays blank.** `applyHat` only writes a hat into row 0 when it's
  currently blank (`art.ts:162`); a non-blank row 0 on this frame would
  silently drop the hat for any hatted buddy while it plays. Both existing
  optional-row users (hat, combat's damage pop) already respect this; the
  stretch frame must too.
- **The species' `GEAR_ANCHORS` cell stays blank** in whatever row it lands
  on, exactly like the existing 3 frames (`art.test.ts` already enforces this
  for frames 0-2; it gets extended to cover frame 3 for these species).

```ts
duck: [
  // ...existing frames 0-2 unchanged...
  ["            ", "  ~ __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'  ~ "],
],
cat: [
  // ...existing frames 0-2 unchanged...
  ["            ", "  >/\\_/\\<   ", "  ( {E}   {E})  ", "  (  ω  )   ", "  (\")_(\")~  "],
],
robot: [
  // ...existing frames 0-2 unchanged...
  ["            ", "   \\[||]/   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'* "],
],
```

Anchor check (weapon / trinket cells, 0-indexed):

| Species | weapon `[row,col]` | cell in stretch row | trinket `[row,col]` | cell in stretch row |
| --- | --- | --- | --- | --- |
| duck | `[3,1]` | `"   (  ._>   "` col1 = ` ` ✓ | `[4,0]` | `"    `--'  ~ "` col0 = ` ` ✓ |
| cat | `[3,10]` | `"  (  ω  )   "` col10 = ` ` ✓ | `[4,0]` | `"  (\")_(\")~  "` col0 = ` ` ✓ |
| robot | `[3,10]` | `"  [ ==== ]  "` col10 = ` ` ✓ | `[4,0]` | `"  `------'* "` col0 = ` ` ✓ |

All three keep rows 0 and 3 byte-identical to the existing frame 0/2 rows at
those indices specifically so the anchor stays trivially blank — only rows 1
and 4 carry the new pose (raised wing/paws/panel, a small trailing flourish
mark clear of column 0).

### Wiring — dynamic frame count, not a new constant

`getStatusFrames` currently always builds a fixed 5-entry `frames` array
(idle ×3, blink, glance from P6). Species with a 4th raw art frame get a 6th
baked entry and a longer sequence; species without one are untouched:

```ts
const hasStretch = SPECIES_ART[bones.species].length > 3;
const frames = [
  resolveFrame(0, bones.eye),
  resolveFrame(1, bones.eye),
  resolveFrame(2, bones.eye),
  resolveFrame(0, "-"),
  resolveFrame(0, "'"),
  ...(hasStretch ? [resolveFrame(3, bones.eye)] : []),
];
const frameSequence = hasStretch
  ? STATUS_FRAME_SEQUENCE_STRETCH
  : STATUS_FRAME_SEQUENCE;
```

```ts
// One extra beat (index 5) near the end of the loop — the rarest state,
// since it's the most novel pose.
export const STATUS_FRAME_SEQUENCE_STRETCH: readonly number[] = [
  0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 5, 0, 0, 0,
];
```

The other 17 species are byte-identical to P6's output — this is strictly
additive per-species, gated on `SPECIES_ART[species].length`, not a global
flag.

### Gate

`art.test.ts`: new frame's anchor-blank invariant (table above, asserted in
code, not just prose); `getStatusFrames` returns 6 frames with the stretch
sequence for the 3 pilot species and 5 frames with the base sequence for
every other species; row-0-blank assertion for the new frame specifically
(the hat-drop failure mode is silent otherwise). Constant width/height within
each species' own flipbook (existing `rectFrame`/anchor tests already cover
this shape of check).

---

## Invariants (unchanged, must hold)

Same five as round 1 (`design-sprite-animation.md` §6) — server bakes/bash
cycles (zero `buddy-status.sh` changes expected here either), constant
width+height per flipbook, pure cores + seeded RNG, derive-on-read (P4-P6;
P7 is the sanctioned exception, scoped and gated as above), one gate (`full`)
for anything that's a new visual element with a row cost.

---

## Phases

| Phase | Scope | Gate |
| --- | --- | --- |
| **P4** | `crit` + `counter` bout outcomes | constant W/H; outcome-aware tests updated to new bucket boundaries |
| **P5** | Per-`CelebrationKind` flourish cycles; levelup/loot/whim opt in | per-kind cycle/length tests; discovery still unflourished |
| **P6** | Idle glance micro-expression | anchor/emote invariants hold at the new frame index |
| **P7** | New "stretch" art frame, pilot: duck/cat/robot | anchor-blank + row-0-blank tests pass; other 17 species byte-identical |
| **P8** | Docs + full validation | suite green, `tsc`, `bash -n`, e2e render for all four phases |

## Open questions

None outstanding — axes, mix percentages, and the pilot species list are this
document's decisions, made to keep round 2 shippable in one pass rather than
re-opening each as a question. If the outcome mix or pilot roster reads
wrong once rendered, that's a one-line tune, not a re-design.
