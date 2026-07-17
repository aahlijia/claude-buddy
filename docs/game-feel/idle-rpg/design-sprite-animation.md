# Sprite animation expansion — shared FX primitives + bout variety

_Designed + implemented 2026-07-17 · branch `feature/interactive-fight-scene`_
_Status: **implemented** (P0–P3), 821 tests pass, `tsc` + `bash -n` clean,
zero shell changes. Uncommitted._

Two goals, one shared foundation: make the **idle** buddy more expressive and the
**bug fight** less scripted, without authoring a single new species art frame.

Both ride machinery that already exists and is already tested — it's just walled
inside `combat.ts`. This design extracts it, then spends it on both surfaces.

---

## 1 · The constraint that governs everything

`buddy-status.sh:30` reads `NOW=$(date +%s)` and picks a frame with
`$seq[$now % $slen]`. That is the whole animation engine:

- **1 frame per second.** `refreshInterval` is 1 and the tick is epoch *seconds*.
  More frames make a loop **longer**, never smoother.
- **Phase-locked to the wall clock**, not to a playhead. Nothing "starts" — the
  loop always runs and the buddy joins it mid-stride.

So neither goal here can be met by adding frames for their own sake. The wins
come from **more distinct states per loop** (bout outcomes) and **a channel that
doesn't exist yet on the idle path** (the FX row).

Raising the frame rate is the real multiplier, and it is explicitly **out of
scope** — it depends on how often Claude Code re-invokes the script, which is
unmeasured, and it would respend the fork budget `c134b20` just recovered.

---

## 2 · The row-budget audit (2026-07-17)

`trimBlankTopRows` was added 2026-07-15 for the combat scenes and is called
**only** from `bakeScene` and `bakePendingScene` (`combat.ts:379,500`). The idle
path never got it. Auditing row 0 across all 20 species, bare-headed:

| Row 0 state | Count | Species |
| --- | --- | --- |
| **Blank in every idle frame** — dead row, reclaimable | 11 | duck goose blob cat owl turtle snail axolotl rabbit chonk pikachu |
| **Used by art frame 2 only** — the accent frame | 8 | dragon `~ ~` · octopus `o` · penguin body-shift · ghost `~ ~` · capybara `~ ~` · cactus `n n` · robot `*` · mushroom `. o .` |
| **Used in every frame** — structural | 1 | wyvern (horns `}       {`) |

So **11 of 20 species are currently wasting a row on the idle line** — exactly
the waste the combat trim was written to eliminate. That reclaimed row is what
pays for the FX row.

---

## 3 · The extraction (P0)

Two pure frame-geometry functions move from `combat.ts` to `art.ts`, beside
`rectFrame` / `mirrorFrame` / `eyeRowIndex` / `displayWidth`, which is where the
rest of the frame geometry already lives.

**`trimBlankTopRows`** moves as-is, plus a shared-drop-set variant (§4.1).

**`overlayRow`** generalizes. Today its signature bakes in the two-sprite scene:

```ts
overlayRow(overlay: { text, over: "player" | "enemy" }, playerW, enemyW)
```

It becomes span-addressed, so a caller with one sprite can use it too:

```ts
overlayRow(text: string | null, spanStart: number, spanW: number, totalW: number)
```

- combat, over the enemy: `overlayRow(text, playerW + SCENE_GAP, enemyW, total)`
- combat, over the player: `overlayRow(text, 0, playerW, total)`
- idle, over the buddy: `overlayRow(text, 0, artW, artW)`

`PoseExtras.shift` is **not** extracted. For a single idle sprite "shift" would
mean translating within its own block, which needs a block wider than the art and
would collide with the wander offset channel (`wanderSequence`), which already
moves the idle cluster and is shell-applied. Idle positional motion is a solved
problem; the FX row is the gap. Revisit only if in-place shuffle is wanted
*alongside* roam.

**Gate:** combat output must stay byte-identical — all 86 statusline snapshots
unchanged after P0.

---

## 4 · Idle FX row (P1)

An emote glyph rides a row above the sprite: `!` when angry, `zZz` when bored,
`♪` when happy, `?` when surprised, nothing when neutral.

The trigger is **`resolveEmotion(activeReason, gate)`** — already computed in
`state.ts:961` and already driving the eyes. The emote visualizes what the eyes
already say, so there is **zero new signal plumbing**; it is a second read of an
existing decision.

### 4.1 · The shared drop set — the load-bearing detail

`getStatusFrames` (`state.ts:1100`) and `flourishFrames` (`state.ts:1159`) are
baked **independently** into the same `status.json`, and the shell swaps between
them on `$celeb_fresh` (`buddy-status.sh:129-134`) within seconds. Both are 5
rows today, so the swap is currently seamless.

**Trimming idle alone would make the line jump a row the moment a celebration
fires** — and the two flipbooks do not use the same rows (idle plays art frames
0/1/2, flourish only 0/1, so bare-headed cactus's `n n` exists in idle and never
in flourish → different drop sets → different heights).

So the trim runs **once, over the union of every co-present flipbook**, and the
same drop set is applied to all of them:

```
finalize(idle, flourish?, emote):
  1. unshift an FX row on EVERY frame of BOTH   (idle: the emote or blank;
                                                 flourish: always blank)
  2. compute drop = rows blank in every frame of idle ∪ flourish
  3. apply the same drop to both
```

This preserves the two properties the existing trim relies on — only rows blank
in *every* frame go, and identical rows are dropped from every frame — extended
across flipbooks rather than within one. Flourish stays bare of gear (existing
intentional behavior, unchanged); only its geometry is coupled.

### 4.2 · Net row cost

| Case | Today | After |
| --- | --- | --- |
| 11 free-row species, bare, neutral | 5 | **4** (dead row reclaimed) |
| 11 free-row species, bare, emoting | 5 | **5** (trim −1, FX +1 ⇒ free) |
| 11 free-row species, hatted, emoting | 5 | 6 |
| 8 accent-frame species, bare, neutral | 5 | 5 |
| 8 accent-frame species, bare, emoting | 5 | 6 |
| wyvern, emoting | 6 | 7 |

A neutral buddy never pays: the FX row is blank across the whole loop, so step 2
drops it. NFR6 (real-estate budget) is respected — hop headroom
(`WANDER_ROW_MAX`) stacks on top of this as it does today, and the FX row is
`full`-gated with the rest of the emotion channel.

**User-visible delta:** bare-headed buddies of the 11 free-row species render one
row shorter at rest than they do today. This is the intended reclaim, not a
regression, and it means the statusline snapshots **will legitimately change** —
the first time in several passes. Every diff gets reviewed individually.

---

## 5 · Bout variety — dodge + parry (P2)

Today every skirmish bout is identical in structure: walk-in → impact → back-off,
with only the damage number and attacker varying. Over a standoff that can last
hours, the loop reads as scripted.

Each bout now **rolls an outcome** from the existing per-`(session, tier)`
`pendingSeed`, in a fixed draw order (determinism):

| Outcome | Frames | Reads as |
| --- | --- | --- |
| **hit** (existing) | walk-in → impact `✗ -N` → back-off, `-N` floats | a landed blow |
| **dodge** | walk-in → attacker over-commits (full lunge), defender `O` eyes → attacker pulls back `-` | a whiff |
| **parry** | lunge → blades clash `/\` in the gap, both `>` → recoil | a blocked blow |

Both new outcomes are pure `Pose` + `PoseExtras` recombinations, no new
machinery. Two constraints found during implementation shaped the final poses:

- **`shift` only moves a sprite *toward* the gap** (the vacated cells pad the
  sprite's *outer* side). It cannot move the defender *away*, so the planned
  "defender shifts back" dodge isn't expressible without changing the block
  width. The dodge instead reads through the **attacker over-committing to a
  full lunge that lands on nothing** (no pop) while the defender wears surprised
  `O` eyes — honest to the primitive and just as legible at 1 fps.
- **The clash glyph needs gap width ≥ 3**, i.e. attacker `shift ≤ 1`
  (`gapRow` truncates `/\` to `/` at width 2). So parry's clash lands near
  center: `lunge (shift 2) → clash (shift 1, `strike`) → recoil (shift 0)`.
  `strike: true` is what draws the `/\`; it was previously reachable only from
  `bakeScene`. The clash sword is the **player's equipped weapon glyph**, read
  from the `look.gear.weapon` the standoff already carries (`swingGlyph`) —
  **zero new call-site plumbing**; a bare buddy falls back to `DEFAULT_SWORD`.

No pop on dodge or parry (no damage dealt), but the overlay row is still carried
blank on those frames — the constant-height rule is unchanged. Damage is still
rolled on every bout (even the pop-less ones) so loop-gap spacing stays
independent of outcome.

Outcome mix: **hit 50% / dodge 25% / parry 25%**, rolled per bout from the same
`pendingSeed` in a fixed draw order (`first, outA, dmgA, outB, dmgB, gaps`).

Cost: 8 → ~14 frames, loop 34–55 → ~40–60 ticks.

---

## 6 · Invariants (unchanged, must hold)

1. **Server bakes, bash cycles.** No new shell logic on either surface; both are
   longer/richer baked flipbooks played by the existing cycler. **Zero
   `buddy-status.sh` changes are expected in this whole design.**
2. **Constant width AND height across a flipbook.** Every new frame preserves it
   by construction: shift pads the far side, every frame carries the overlay row,
   the drop set is identical across frames *and now across flipbooks* (§4.1).
3. **Pure cores, seeded RNG.** The bout roll draws from `pendingSeed` in a fixed
   order; no clock, no I/O.
4. **Derive-on-read.** No new per-species art. Every new state is eye
   substitution + shift + overlay over the existing 3 frames.
5. **One gate.** The emote row is `full`-gated with the emotion channel it reads.

---

## 7 · Phases

| Phase | Scope | Gate |
| --- | --- | --- |
| **P0** | Extract `overlayRow` (span-addressed) + `trimBlankTopRows` into `art.ts` | 86 snapshots byte-identical |
| **P1** | Idle trim w/ shared drop set + emotion-driven emote row | snapshots reviewed; celebration swap holds height |
| **P2** | Dodge + parry bout roll; weapon glyph plumbed to `bakePendingScene` | constant W/H across all frames |
| **P3** | Docs + full validation | suite green, `tsc`, `bash -n`, e2e render |

---

## 8 · Open questions

Resolved by the user 2026-07-17 before implementation:

- **OQ1 — bout vocabulary.** → dodge + parry (not block/crit; not hit-only).
- **OQ2 — idle row budget.** → unshift + trim, accepting the one-row reclaim for
  the 11 free-row species as a visible change.
- **OQ3 — emote trigger.** → emotion-driven, reusing `resolveEmotion` (not rare
  random, not both).

Deferred:

- **Sub-second tick** (§1) — needs the harness refresh ceiling measured first.
- **Idle in-place shift** (§3) — overlaps the wander offset channel.
