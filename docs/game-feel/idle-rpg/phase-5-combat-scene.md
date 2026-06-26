# Design — Idle RPG · Phase 5: Two-Sprite Combat Scene + Free-Roam Layout

> Status: Component design (output of `/sc:design phase 5`). Resolves
> **OQ-P4.1** ([[phase-4-statusline]]): the "bespoke fight choreography consuming
> Phase 3's baked frames" deferred in v1 is built here. No production code in this
> doc; sketches are interface design only — build with `/sc:implement`.

The v1 fight ([[phase-4-statusline]]) is a single hovering enemy **glyph** plus an
angry buddy face. Phase 3 already bakes a fight **flipbook** into `encounter.json`,
but the v1 renderer throws it away (`state.ts` reads only `enc.enemyGlyph`/`.at`).
Phase 5 makes the fight real: the bug renders as a **full second creature** — "a
buddy of a different kind" — beside the player buddy, with a short **sword-swing**
flipbook (ready → wind-up → strike → resolve).

Realizing that exposed the layout's rigidity, so Phase 5 also re-architects the
status line to a **free-roam** model. Grounded against source as of
`feature/free-roam-combat`: `statusline/buddy-status.sh` (single-pass `jq` `:93`,
flourish source branch `:106-115`, wander clamp `:323-363`, `TOTAL_W`/`PAD`
`:763-797`, art compose `:415-487`, per-line assembly `:855-926`), `server/state.ts`
(`writeStatusState`, encounter block `:815-834`, `getStatusFrames` `:873`),
`server/combat.ts` (`bakeFrames`/`resolveCombat`/`EncounterRecord`),
`server/bugs.ts` (`Bug`), `server/art.ts` (`SPECIES_ART`, `renderSpeciesFrame`,
`displayWidth`), `server/wander.ts` (`buildWanderSequence`/`moodWalkOpts`).

**Locked decisions** (inherited): **statusline is a dumb cycler** (server bakes
which frames, bash only indexes `NOW % len`); **scene/roam only at
`gameFeel === full`**; **idle `.frames` stay byte-identical** (the `flourishFrames`
separate-frame-set precedent).

---

## 1. Scope & non-goals

**In scope (Phase 5):**
- **Free-roam layout.** Retire the hard-right-aligned 3-column block. The buddy is
  a **variable-width sprite** the status line positions between the stats panel
  (left bound) and the window edge (right bound), **always fully in-window**. The
  **speech bubble travels with the buddy** as one rigid cluster.
- **Two-sprite combat scene.** A fresh encounter renders the player buddy + a
  **mirrored enemy creature** (the bug's new `species`) with a sword-swing
  flipbook, by **consuming Phase 3's baked frames** (now widened to a scene).
- **Fix clipping.** When stats + cluster fit in `COLS`, the buddy never wraps/clips.

**Explicit non-goals:**
- No change to combat **resolution** (`winChance`, drops, XP, catalog tuning).
  Pure visual + layout.
- **No new per-tick state files**, no second `jq` fork beyond what the existing
  pass already does. Server bakes, bash cycles.
- **No new per-species art** — the enemy reuses `SPECIES_ART` + eye substitution +
  a new mirror pass.
- Vertical hop (`wanderRowSequence`/`HOP_RESERVE`) is unchanged.

---

## 2. What already exists (reuse, don't reinvent)

- **The separate-frame-set pattern.** `flourishFrames` (`art.ts`) bakes a parallel
  frame set the shell selects *only while fresh*, then falls back to idle `.frames`
  with no second write. The combat scene copies this exactly (`combatFrames` /
  `combatSequence`), which is *why idle stays byte-identical*.
- **The baked fight flipbook.** `resolveCombat` already returns `frames`/`sequence`
  and `writeEncounter` persists them in `encounter.json`; `readEncounter` TTL-checks
  them. Phase 5 changes only **what** `bakeFrames` paints (a 2-sprite scene) and
  **wires the result through** — no I/O change.
- **The cluster-travels-with-buddy mode.** `buddy-status.sh` already has a
  `wanderBubble=true` branch (`:357-363`) that shifts bubble+connector+art as one
  block via `WANDER_PAD_BUBBLE`. Free-roam makes that the default and widens its
  range from a ≤10-cell corridor to the full span.
- **The span bones.** Per-line assembly is already `SPACER(LEAD_PAD) + [stats +
  STATS_GAP + MID_SPACER(MID_PAD)] + WANDER_PAD_BUBBLE + [bubble+connector] +
  WANDER_PAD_ART + art` (`:855-926`). Stats are already left-anchored; `MID_PAD`
  is already the variable gap. Free-roam just *drives* `MID_PAD` with a roam offset
  instead of right-alignment.
- **Width utilities.** `displayWidth` (`art.ts:202`, ANSI-stripping) for the
  server-emitted `artWidth`; `dwidth()` (`buddy-status.sh:684`) only as a last
  resort. `renderSpeciesFrame`/`renderFace` for both creatures. `mulberry32` for
  determinism.

---

## 3. Free-roam layout model

### 3.1 The cluster and the span

The line has two parts: a **left-anchored stats panel** (when shown) and a
**buddy cluster** = `[bubble][connector][sprite]` that travels as one block.

```
STATS_BLOCK = stats? (STATS_LEFT_MARGIN + STATS_W + STATS_GAP) : 0     # fixed, left
CLUSTER_W   = (bubble? BOX_W + GAP : 0) + ART_W                        # ART_W dynamic (§5)
SPAN        = COLS − STATS_BLOCK − CLUSTER_W − RIGHT_SAFETY            # roam range
roam        = clamp(scaledOffset, 0, SPAN)                             # leading gap
```

The cluster's leading gap is `roam`: with stats shown `MID_PAD = roam`; without,
`LEAD_PAD = roam`. The sprite is the cluster's **rightmost** element, so its right
edge `= STATS_BLOCK + roam + CLUSTER_W ≤ COLS` whenever `roam ≤ SPAN`. **That is
the in-window guarantee** — no clip while the cluster fits.

`RIGHT_SAFETY` is a small constant (1–2) replacing the old fixed `MARGIN=8` right
reserve; the reclaimed space becomes roam range, not dead margin.

### 3.2 Degradation (narrow `COLS`)

When `SPAN < 0` the cluster + stats don't fit. Recover in priority order
(**sprite visibility always wins**):
1. **Drop the bubble** (`CLUSTER_W = ART_W`), recompute `SPAN`.
2. If still `< 0`, **drop the stats panel** (`STATS_BLOCK = 0`), recompute.
3. If still `< 0` (terminal narrower than the sprite itself), pin the sprite flush
   right and accept truncation of its left — unavoidable, but the eyes/face (frame
   centre-right) survive.

This is a true ladder, not the old "PAD clamps to 0 and the whole multi-line block
wraps." (OQ-P5.2 confirms the exact thresholds.)

### 3.3 Server bakes a normalized walk; bash scales it

The server can't see `COLS`, so it can't bake absolute cell offsets that fill the
span. `wander.ts` keeps producing a deterministic walk but in a **normalized unit**
`0..WANDER_NORM` (e.g. `WANDER_NORM = 100`, "percent of span"). `state.ts` emits it
as `wanderSequence` (semantics: *normalized*, not raw cells). Each tick bash maps:

```
scaledOffset = WANDER_OFF * SPAN / WANDER_NORM      # then clamp [0, SPAN]
```

Mood still modulates **restlessness** (dwell/step via `moodWalkOpts`); the spatial
amplitude is now the live span. `focused` still ambles a little; `chaotic` paces
the whole line. The old `WANDER_RANGE`/`WANDER_LEFT`/`WANDER_MAX`/`WANDER_SAFETY`/
wide-mode block (`:336-349`) and the `TOTAL_W`/`PAD` right-align math (`:770-797`)
are replaced by §3.1's span math.

> **Byte-identity caveat.** Free-roam changes the *default* layout, so the
> idle/wander snapshot suite is **rewritten**, not preserved (see §8). The
> preserved invariant is narrower: with `gameFeel != full` (no roam) the buddy
> parks and the render is stable; the *combat* path leaves idle `.frames`
> untouched.

---

## 4. Bug as a creature (`server/bugs.ts`)

`Bug` gains a `species` (and an optional fight `eye`); `glyph` stays for the toast
and the degraded-skew fallback.

```ts
export interface Bug {
  id: string; name: string; glyph: string; tier: BugTier; reward: number;
  species: Species;   // NEW — the enemy sprite (rendered + mirrored)
  eye?: Eye;          // NEW — optional fight-eye override
}
```

Mapping (curated to clean **5-line, ANSI-free** species — excludes `wyvern`:
6 lines + raw ANSI in `art.ts`, which mirroring would corrupt; and `pikachu`):

| bug | tier | species |
| --- | :---: | --- |
| typo_gremlin | 1 | `blob` |
| off_by_one | 1 | `snail` |
| null_wraith | 2 | `ghost` |
| type_error | 2 | `robot` |
| race_condition | 3 | `octopus` |
| memory_leak | 3 | `cactus` |
| segfault_dragon | 4 | `dragon` |

**Species is fixed per bug** (deterministic, testable). Variety already comes from
`spawnBug`'s seeded same-tier roll — a second random axis adds nondeterminism
surface for no real payoff (OQ-P5.3).

---

## 5. The combat scene (`server/combat.ts`, `server/art.ts`)

### 5.1 Mirror helper (new, pure, `art.ts`)

```ts
/** Mirror a rendered (ANSI-free, eye-substituted) frame so a creature faces the
 *  opposite way. Pads each line to the frame's max display width, reverses by
 *  CODE POINT (not UTF-16 unit), and swaps directional glyphs. */
export function mirrorFrame(lines: string[]): string[];
```

- Iterate `[...line]` so surrogate pairs stay intact.
- After reversing, swap directional pairs: `(`↔`)`, `<`↔`>`, `[`↔`]`, `{`↔`}`,
  `/`↔`\`. Symmetric glyphs pass through.
- Pad-to-rectangle **before** reversing so the bounding box stays aligned.
- Pleasant side effect: a fight-eye `>` mirrors to `<`, so the enemy's angry eyes
  point **back at the player** for free.

### 5.2 Scene baking — `bakeScene` replaces `bakeFrames`

```ts
function bakeScene(
  playerBones: BuddyBones,
  enemyBones: BuddyBones,
  weaponArt: string,
  outcome: Outcome,
): { frames: string[]; sequence: number[] };
```

- Render player + enemy frames via `renderSpeciesFrame`; `mirrorFrame` the enemy.
  Normalize to a common height (bottom-aligned; top-pad the shorter).
- Each **scene line** = `playerLine + GAP + mirroredEnemyLine`. **Every flipbook
  frame is padded to ONE constant width**: the strike frame narrows the inner `GAP`
  by 1 to lunge but pads the outer edge by 1 — constant total width ⇒ no per-tick
  horizontal jitter (the critical width invariant).
- Flipbook (reuse the `[0,1,2,2,3,3]` sequence idiom):
  1. **ready** — both neutral eyes.
  2. **wind-up** — both eyes `>` (enemy's mirrors to `<`).
  3. **strike** — player's `weaponArt` sword leans into the gap + 1-cell lunge.
  4. **resolve** — *win*: enemy eye `x`/`-`, player `^`; *flee*: player `-`, enemy `^`.
- `resolveCombat` builds a minimal `enemyBones` from `bug.species`/`bug.eye`
  (neutral hat/rarity) and calls `bakeScene`. `bakeScene` stays **pure** (no clock)
  so `combat.test.ts` determinism holds. `enemyGlyph`/`drop`/`summary` and the
  `EncounterRecord` I/O are unchanged.

---

## 6. Wiring + width (`server/state.ts`, `buddy-status.sh`)

**`StatusState`** gains three optional fields (additive, backfilled — the
`flourishFrames?`/`wanderSequence?` precedent):

```ts
combatFrames?: string[];     // the 2-sprite scene flipbook
combatSequence?: number[];   // its playback indices
artWidth?: number;           // active scene display width; absent ⇒ bash keeps ART_W=14
```

**`writeStatusState`** encounter block (`:815-834`): on a fresh `readEncounter()`,
set `combatFrames = enc.frames`, `combatSequence = enc.sequence`,
`artWidth = max(displayWidth(line))` over the scene. **Stop forcing
`emotion="angry"`** — the scene carries its own eyes and idle `.frames` must stay
neutral. Keep writing `enemyGlyph`/`encounterAt` as the degraded-skew fallback.

**`buddy-status.sh`** single `jq` pass (`:106-140`): extend the flourish branch to
a **3-way source priority — combat > flourish > idle**:

```
combat_on = ($enc_fresh == 1) and ((.combatFrames | length) > 0)
$seq  = combat_on ? .combatSequence : (flourish ? .flourishSequence : .frameSequence)
$frms = combat_on ? .combatFrames   : (flourish ? .flourishFrames   : .frames)
```

Emit `artWidth` (default 0) as a new field in the `join` array + the `read`.
Override `ART_W=$artWidth` **only when `combat_on`** (idle keeps `ART_W=14` →
byte-identical). Recompute `ART_CENTER=$(( ART_W / 2 ))` only on the combat path so
the name re-centres under the scene. Make the old margin-glyph append (`:207-218`)
fire **only when `combatFrames` is absent** (degraded skew) so we never draw a
doubled enemy. **No new fork** — still one `jq` over `$STATE`.

---

## 7. Gate model

| `gameFeel` | Combat spawns + drops | Roam | Toast | Fight render |
| --- | :---: | :---: | :---: | :---: |
| `off` | ❌ (opt-out) | ❌ (park) | ❌ | ❌ |
| `subtle` | ✅ | ❌ (park) | ✅ (TTL 6) | ❌ |
| `full` | ✅ | ✅ | ✅ (TTL 10) | ✅ two-sprite scene |

Unchanged from [[phase-4-statusline]] §4 except the `full` render is now the scene,
not glyph+face. Missing `combatFrames`/version skew ⇒ fall back to the single-glyph
margin render + idle frames.

---

## 8. Test plan

- **`art.test.ts`** — `mirrorFrame`: involution on symmetric strings; swaps
  `()<>[]{}/\\`; preserves code points; output lines all equal width.
- **`bugs.test.ts`** — every `Bug.species ∈ SPECIES` and is in the curated roster;
  `spawnBug` still deterministic; species stable per id.
- **`combat.test.ts`** — `bakeScene` determinism (`a.frames toEqual b.frames`);
  every scene frame contains both creatures; **all flipbook frames equal display
  width** (lunge invariant); enemy half equals `mirrorFrame(enemy art)`.
- **`state.test.ts`** — fresh `encounter.json` ⇒ `combatFrames`/`combatSequence`/
  `artWidth` present and idle `.frames` still the **neutral** set (not angry);
  `gameFeel="off"` ⇒ none; stale/absent ⇒ none.
- **`statusline_render.test.ts`** — **rewrite** the right-aligned invariants to
  free-roam ones: cluster fully within `[STATS_BLOCK, COLS]` across a tick sweep;
  constant cluster width per state; **no clip at narrow `COLS`**; new
  `describe("combat scene")` paralleling flourish (animates `combatFrames`, widens
  `ART_W`, reverts after the 10s TTL).
- **`state_wander.test.ts` / `wander.test.ts`** — normalized-offset bounds
  `[0, WANDER_NORM]`; bash scaling lands the cluster in-window at varied `COLS`.
- Gate: `tsc --noEmit` clean; full `bun test` green; `bash -n buddy-status.sh`;
  no new fork (grep: still one `jq` over `$STATE`).

---

## 9. Data flow (fight → pixels)

```
maybeFightBug (P3) ─► resolveCombat ─► bakeScene(player, enemy, weapon, outcome)
        └─► writeEncounter(encounter.json: scene frames + sequence) + toast
                 │  (next status write, within TTL)
                 ▼
writeStatusState ── readEncounter() fresh? ──► combatFrames/Sequence + artWidth → status.json
                 │                              (idle .frames stay neutral)
                 ▼  (every ~1s tick — ONE jq pass)
buddy-status.sh: combat_on ⇒ cycle combatFrames, ART_W=artWidth, cluster clamped in-window
        (off ⇒ no encounter.json; subtle ⇒ toast only; skew ⇒ single-glyph fallback)
```

---

## 10. Open questions & resolutions

- **OQ-P5.1 — Walk unit. RESOLVED → cell-based, not normalized.** Implementation
  kept `wander.ts` emitting integer **cell** offsets and clamps `ROAM = SPAN −
  WANDER_OFF` to `[0, SPAN]` in bash (home = right edge; the offset ambles the
  cluster left). This avoids the sub-cell quantization jitter a percent→cell
  scaling would introduce, at the cost of the *magnitude* of leftward roam being
  bounded by the existing mood ranges (2–8 cells) rather than the full span. The
  roam **capability + clamp + no-clip** are delivered; the magnitude is a one-line
  tunable (`moodWalkOpts` ranges in `wander.ts`) if a wider amble is wanted.
  Deterministic COLS for tests is provided by a new `BUDDY_FAKE_COLS` seam
  (mirrors `BUDDY_FAKE_NOW`).
- **OQ-P5.2 — Degradation. RESOLVED → drop the bubble first.** When stats + the
  full cluster don't fit in `COLS`, the **bubble is dropped** so the buddy sprite
  (rightmost, most important) stays visible; only a terminal narrower than
  stats + the lone sprite clips. The toast is sacrificed before the sprite.
- **OQ-P5.3 — Fixed vs. random enemy species. RESOLVED → fixed per bug.**
- **OQ-P5.4 — Sword glyph & lunge feel.** v1 uses the equipped `weaponArt` when
  it's a printable ASCII char, else a default `/` blade that mirrors to `\` for
  the enemy (the blades clash in the gap on the strike frame). The lunge is the
  clash glyph in a constant-width gap (no body translation) to keep the scene
  jitter-free; a punchier body-lunge is a future refinement.
- **OQ-P5.5 — Master-doc amendment. DONE** — [[design-movement]] §11 records the
  free-roam supersession; [[phase-4-statusline]] OQ-P4.1 is resolved here.
