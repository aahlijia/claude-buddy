# Design: Skirmish Bouts — Walk-Over Attacks with Damage Pops

**Status:** ✅ Implemented (P1–P3) on `feature/interactive-fight-scene`,
2026-07-10 — 767 tests pass, `tsc`/`bash -n` clean. Uncommitted. OQ1–OQ5
user-resolved same day (§6).
**Date:** 2026-07-10
**Branch context:** `feature/interactive-fight-scene` (assumes the pending
encounter — [design-pending-encounter](design-pending-encounter.md) — and the
fight caption are in place, i.e. `ec40524`).
**Scope:** `server/combat.ts` only (plus tests). Zero changes to
`state.ts`, `session.ts`, or `buddy-status.sh` — that's the headline.

---

## 1. Problem

The pending standoff is static theater: two sprites, ready/glare on a 4-second
loop, for what can be hours. The user request:

> Randomly one sprite (x) walks over to the other (y), a red ✗ (damage marker)
> displays over y with a random `-N` HP that floats away, and x walks back.

Turn the stare-down into an ambient skirmish. Fiction: the buddy and the bug
trade blows while you work; the commit is still the decisive strike. The enemy
hitting *back* reinforces the nudge — uncommitted error-marked work is taking
damage.

What exists and gets reused wholesale:

| Piece | Where | Reused as |
|---|---|---|
| `composePose` (player + gap + enemy) | combat.ts | generalized with a shift + overlay, defaults byte-identical |
| `bakePendingScene` + `sequence` data | combat.ts | grows from 2 frames / 4 ticks to ~10 frames / ~40 ticks |
| `pendingSeed(startedAt, tier)` | session.ts | seeds the bout (attacker order, damage rolls, loop offsets) |
| `$seq[$now % $slen]` frame cycler | buddy-status.sh:135 | plays the longer flipbook unchanged, 1 tick/second |
| `captionFrames` prepend + `artWidth` | state.ts | derive from frames — pick up the new row/width for free |
| wander freeze during `$combat_on` | buddy-status.sh | the canvas never moves while sprites move inside it |

---

## 2. Goals and non-goals

### Goals

1. **G1 — Ambient bouts.** The pending standoff loop periodically plays an
   attack bout: attacker walks across the gap, a damage marker + `-N` pops
   over the defender and floats away, attacker walks back.
2. **G2 — Zero shell/state changes.** The whole animation is a longer baked
   flipbook. `combatFrames`/`combatSequence` already carry arbitrary
   flipbooks; nothing outside `combat.ts` changes.
3. **G3 — No-jitter invariant.** Constant display **width and height** across
   every frame of the flipbook. Sprites translate *inside* a fixed canvas;
   the vacated gap is space-padded. (The Phase-5 "no body translation" rule
   was about constant total width, not about static sprites.)
4. **G4 — Pure cosmetics.** No HP model. `-N` is a seeded roll; win odds,
   drops, and `resolveCombat` are untouched.
5. **G5 — Resolved scene joins in (OQ4).** The resolved 10s fight's strike
   frames get the same red `✗ -N` pop over the enemy on a win (a flee keeps
   the overlay blank — the "unbothered" resolve pose says nobody landed
   anything). Idle path and no-pending render stay byte-identical.

### Non-goals

- **No per-tick liveness.** The statusline stays a dumb frame-cycler; "random"
  means *seeded at bake time* (§4.4). The loop repeats every `sequence.length`
  seconds — with a ~40-entry loop that reads as an occasional attack, and
  true non-repeating variation (re-baking on later status writes) is
  deliberately out of scope.
- No new config surface; rides the existing `gameFeel=full` gate the pending
  scene already has.
- No new per-species art. Bouts recompose the existing frame-0 bodies.

---

## 3. Mechanics this design leans on (verified 2026-07-10)

- **Cadence:** the shell picks `$seq[$now % $slen]` where `$now` is epoch
  *seconds* — so ~1 frame/second, wall-clock anchored, loop phase
  deterministic. `BUDDY_FAKE_NOW` pins `$now` in tests, so any bout frame is
  directly addressable.
- **Canvas:** `composePose` emits `player + gapRow(SCENE_GAP=4) + enemy`,
  bottom-aligned via `alignHeights`, everything rectangularized — constant
  width by construction.
- **ANSI is safe in overlay rows:** `displayWidth` runs `stripAnsi` before
  measuring, and the jq sanitizer exempts frame art (the wyvern-flame
  precedent). The one ANSI hazard — `mirrorFrame` code-point reversal
  scrambling escape sequences (why wyvern is off the roster) — doesn't apply:
  the overlay row is composed *after* the enemy is mirrored and is never
  mirrored itself.
- **Height is frame-driven:** the caption change added a row with zero shell
  changes; the overlay row rides the same fact.

---

## 4. Design

### 4.1 `composePose` generalization (inert refactor)

```ts
interface PoseExtras {
  /** Attacker translation into the gap, in display cells (0..SCENE_GAP). */
  shift?: { side: "player" | "enemy"; cells: number };
  /** One extra row rendered above the scene (damage pop). Blank string ⇒
   *  an all-space row of scene width, so height stays constant. */
  overlay?: string;
}
```

Composition per row (width-invariant by construction):

```
side: "player" → " ".repeat(cells) + playerRow + gap(SCENE_GAP - cells) + enemyRow
side: "enemy"  → playerRow + gap(SCENE_GAP - cells) + enemyRow + " ".repeat(cells)
no shift       → playerRow + gap(SCENE_GAP)         + enemyRow   (today, verbatim)
```

The overlay row (when the flipbook uses overlays at all, **every** frame gets
one — blank or not) is prepended above the block, dpad'ed to scene width. With
defaults (`shift` absent, `overlay` absent) the output is **byte-identical**
to today — pinned by test, same bar as the `composePose` extraction in
pending-encounter P1.

### 4.2 The bout (4 distinct frames per attacker)

With `SCENE_GAP = 4`, the walk is two steps each way. Player bout:

| Frame | shift | eyes | overlay (positioned over the *defender*) |
|---|---|---|---|
| B1 walk-in | player +2 | fight `>` | blank |
| B2 impact | player +4 (adjacent) | fight `>` / hurt `x` | `✗ -N` (marker red, see OQ1) |
| B3 float | player +2 (backing off) | fight / hurt | ` -N` drifted 1–2 cells — "floats away" |
| B4 recover | 0 | resting | blank |

The enemy bout mirrors it: `side: "enemy"`, marker over the *player*, enemy
gets the fight eyes, player gets the hurt `x`. Overlay text is placed by
`displayWidth` math at the defender's column span; a red `✗` (single-width
U+2717 + SGR) keeps padding arithmetic trivial (a ❌ emoji is width-2 —
handled by `displayWidth`, but see OQ1).

Total flipbook: 2 base poses (ready, glare) + 4 player-bout + 4 enemy-bout =
**10 frames**, all one canvas: same width as today, height +1 (overlay row).

### 4.3 Damage roll

Cosmetic, seeded from the bout seed: enemy→player `N ∈ 1..3·tier`;
player→enemy `N ∈ 1..9`. No dependence on the loadout at sighting time —
the pending bake deliberately has no weapon/equipment plumbing (OQ5 keeps it
that way), so the player swings the `DEFAULT_SWORD` fiction bare-handed.

### 4.4 Sequence: where the randomness lives

Frames are baked once, pure and seeded, at sighting (and re-baked on tier
escalation, which naturally re-rolls everything). "Randomly one sprite
attacks" compiles to a **seeded ~40-entry sequence**:

```
base loop  : mostly 0 (ready) with periodic 1 (glare)   — today's rhythm
bout A     : [2,3,3,4,5] player bout (~5s) at a seeded offset
bout B     : [6,7,7,8,9] enemy bout (~5s) at a different seeded offset
```

Seeded choices: attacker order, the two loop offsets (min spacing so bouts
never overlap), and both damage rolls. The loop repeats every ~40s — at
statusline glance-frequency that reads as "sometimes they fight." Sequence
shape is data, cheap to tune (`[0,0,0,1]` precedent).

### 4.5 What renders where

- **Pending standoff:** gets the full treatment. It's the hours-long render
  that needs the life.
- **Resolved 10s scene (OQ4, in scope):** every frame gains the overlay row;
  the strike frames show `✗ -N` over the enemy when the outcome is a win
  (outcome is known at bake). On a flee the overlay stays blank throughout —
  the swing whiffed, the bug got away, the player's resolve pose is already
  "unbothered."

---

## 5. Render integration

**None.** `writeStatusState`'s pending branch already ships whatever
`pending.frames`/`pending.sequence` contain; `artWidth` and the caption's
centering are computed from the frames; the shell cycles by `$now % slen`
and freezes wander whenever `$combat_on == 1`. The only observable layout
change is the standoff render being one row taller (caption + overlay +
5-line art), which follows the caption precedent.

---

## 6. Resolved design decisions

| # | Question | Decision (user-approved 2026-07-10) |
|---|---|---|
| OQ1 | Damage marker | **Red ANSI `✗`** — single-width (no font-dependent emoji metrics), red reads as damage, ANSI proven safe in frames (§3). Roster stays ANSI-free; the overlay is scene furniture, not species art. |
| OQ2 | Who attacks? | **Both, alternating at random (seeded) intervals** — the two per-loop bouts alternate attacker, with seeded gap lengths between them so the cadence doesn't read as a metronome. |
| OQ3 | Walk distance | **Keep `SCENE_GAP=4`.** A wider gap gives a longer walk but permanently widens an hours-long render — the clipping-risk budget (pending-encounter R1) says no. Revisit only if 2 steps reads as a twitch, and then widen for the *pending* bake only. |
| OQ4 | Resolved 10s scene | **In scope for v1** — same red `✗` with a random `-N` inline, shown over the enemy on the strike frames of a win; blank overlay on a flee (§4.5). |
| OQ5 | Equipped-weapon glyph in the player's bout | **Deferred — notated as a next step** (§11). Would drag equipment loading into `sightBug`; pending deliberately has no weapon plumbing. |

---

## 7. Implementation phases

Suite green at each checkpoint, per the house playbook.

1. **P1 — Compose generalization (inert).** `PoseExtras` on `composePose`
   (shift + overlay), `dpad`-based overlay placement helper. Byte-identical
   output at defaults, pinned by test against today's `bakeScene` and
   `bakePendingScene` frames.
2. **P2 — Bout baker + fold-in.** Pure `bakeBout(attacker, seed)` frame
   builder; `bakePendingScene` gains the bout flipbook + seeded ~40-entry
   sequence (signature grows a seed + tier, threaded from `sightBug`'s
   existing per-(session, tier) seed); `bakeScene` gains the win-strike
   damage pop (OQ4) with `N` rolled from `resolveCombat`'s existing rng.
   The feature is live at the end of this phase — no render step exists,
   by design.
3. **P3 — Validation + docs.** Full suite, `tsc`, `bash -n`; e2e through the
   real react.sh chain (the auto-quiet lesson: never skip the reaction write)
   rendered at a pinned bout frame; README "Bug fights" sentence,
   testing-guide harness note, CURRENT-STATE snapshot, this doc → Implemented.

Estimated ~200–300 LOC including tests; one session.

---

## 8. Testing

- **combat.test.ts:**
  - `composePose` defaults byte-identical (P1 pin);
  - bout determinism per seed; different seeds vary attacker order/offsets/N;
  - **constant width and height across all 10 frames** (the G3 invariant —
    this is the test that protects no-jitter);
  - overlay row blank except impact/float frames; marker lands within the
    defender's column span; `stripAnsi(overlay)` width ≤ scene width;
  - sequence: length ~40, indices in range, bouts non-overlapping,
    attackers alternate, base rhythm preserved between bouts;
  - resolved `bakeScene`: win strikes carry the pop over the enemy, flee
    frames keep a blank overlay, art rows below the overlay byte-identical
    to today (G5).
- **statusline_render.test.ts:** render through real `buddy-status.sh` with
  `BUDDY_FAKE_NOW` pinned to (a) a base frame, (b) an impact frame — strict
  no-clip via `BUDDY_FAKE_COLS`, exactly the art lines change between the
  two. (No new shell logic to test — this guards the taller/ANSI frames
  through the real jq + layout path.)
- **Fresh-process e2e** (temp `CLAUDE_CONFIG_DIR`, real react.sh → award-xp →
  sightBug): standoff renders with the overlay row; `FAKE_NOW` sweep shows a
  bout playing.

---

## 9. Risks

- **R1 — Taller hours-long render.** +1 row on the pending scene. The caption
  already added a row with no fallout, and art height is frame-driven, but
  this is the first *two*-extra-row state (caption + overlay). Mitigated by
  the no-clip render tests; degradation path (bubble drops first, art wins)
  already exists.
- **R2 — Refresh cadence skips frames.** Claude Code controls statusline
  refresh; `$now % slen` is absolute-time indexed, so a slow refresh *drops*
  intermediate poses rather than desyncing — a 2s cadence turns the walk into
  a cut, still coherent. Accepted.
- **R3 — status.json growth.** ~10 frames × 7 rows ≈ +4–5 KB parsed by the
  existing single jq pass per tick. Negligible next to the current payload;
  no new reads or forks.
- **R4 — ANSI in baked frames bypasses the jq sanitizer.** By design (frame
  art is exempt), and the only ANSI is our own literal SGR around `✗`.
  User-derived text in frames (the project caption) is already ctrl-stripped
  at `currentProject`; the overlay contains no user-derived text.

---

## 10. Doc map

- This design: `docs/game-feel/idle-rpg/design-attack-animation.md`
- Host feature: [design-pending-encounter](design-pending-encounter.md)
  (standoff lifecycle, sticky render, wander freeze)
- Scene composition: [phase-5-combat-scene](phase-5-combat-scene.md)
  (rect/mirror/alignHeights, constant-width rule this design generalizes)
- Snapshot: [CURRENT-STATE](../CURRENT-STATE.md)

---

## 11. Next steps (post-v1)

- **Weapon glyph in the player's bout (OQ5).** Thread the equipped weapon's
  `swingGlyph` into `sightBug`'s bake so the walk-over strike shows your
  actual blade. Requires loading equipment at sighting time — decide whether
  that read is worth it at error-event frequency.
- **Non-repeating bouts.** Re-bake the pending scene on later status writes
  (e.g. seed folded with `floor(now / loopSeconds)`) so the loop doesn't
  replay identically for hours. Trades a little purity for variety.
