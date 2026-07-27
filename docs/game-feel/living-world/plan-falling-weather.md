# Falling weather — design + implementation plan (living-world follow-up)

_Drafted 2026-07-24 · branch `feature/interactive-fight-scene`_
_Status: **implemented (2026-07-24).** See
[CURRENT-STATE.md](../CURRENT-STATE.md#falling-weather-sky-band-2026-07-24)
for the shipped snapshot (all four tasks, 1064 tests pass — including an
independent post-implementation audit of Tasks 0-3, not just this doc's own
self-report). Depended on
[design-ground-weather.md](design-ground-weather.md) and
[plan-ground-weather.md](plan-ground-weather.md) shipping first — this doc
assumed both were present in the working tree (the ground row is uncommitted
but present) and reuses their D1 schedule mechanism verbatim rather than
re-deriving it._

**Baseline (as of this doc, 2026-07-24):** `bun test` → **1044 pass, 0 fail**;
`bunx tsc --noEmit` → clean; `bash -n statusline/buddy-status.sh` → clean.
Working tree has the living-ground row (`server/ground.ts`) and its ground-weather
follow-up (D1–D5, `pickSessionWeather`/`isWeatherActive`/`buildWeatherTile`)
uncommitted but fully present, plus the still-uncommitted `worldDressing` toggle.
This plan builds on top of that tree as-is.

---

## 1. Recap — what's shipped vs. what this doc adds

**Shipped (static, not what this doc designs).** The living-ground row
(`server/ground.ts`) paints a FIXED, full-width terrain strip beneath the whole
widget — grass/field/water/sand/stone/tundra, session-seeded off `startedAt`.
Layered on top: `pickSessionWeather(seed)` decides once per session whether/
when/what-kind of weather occurs (~1-in-10 sessions, 30s–10min start, 2–8min
duration); `isWeatherActive(schedule, elapsedMs)` is a pure per-write boundary
check with zero reroll; `buildWeatherTile` weaves `+` (snow) / `:` (rain)
specks into a longer repeating tile period. The shell (`buddy-status.sh`)
recolors those glyphs in place with a bounded `${var//lit/repl}` substitution
(`design-ground-weather.md` §D5, `plan-ground-weather.md` Task 3). **This is a
static speckle pattern** — the same woven tile string is re-rendered
identically every ~1s tick for the whole window. Nothing about it moves.

**What this doc adds.** Genuine falling motion — flakes/drops that visibly
descend across successive renders — during the exact same weather window the
ground row already schedules. This is new architectural territory: every prior
piece of motion in this codebase (wander, gait, kick, combat, flourish) reads
a pre-baked *sequence* of discrete frame/offset variants; nothing has ever
needed to depict continuous downward travel through open space above the
sprite. §2 works out whether/how that fits the existing invariants; §3
resolves the open design questions; §4 is the task-by-task plan.

---

## 2. Analysis

### 2.1 The architecture invariant this must honor

Per `docs/game-feel/CURRENT-STATE.md`'s "Architecture invariants" section:
**"Server bakes, bash cycles."** Every animation is a pre-baked frame/offset
sequence written into `status.json`; `buddy-status.sh` is a dumb `NOW % len`
cycler, never a live loop. New motion must be a new baked sequence, not new
shell logic that computes anything live. This is non-negotiable — falling
weather is not exempt.

### 2.2 The refresh-cadence ceiling (measured, not assumed)

`docs/game-feel/living-world/design.md`'s "P0 findings (measured 2026-07-18)"
section shim-logged 2,457 real statusline invocations: **64.9% land in a
0.9–1.1s "heartbeat" bucket, mean 0.9954s ± 21ms**, with the longest
uninterrupted idle run at 455 ticks (~7.5 min). Per the official statusline
docs quoted there, `refreshInterval`'s minimum is 1 second and this is the
**platform floor**, not a tunable. `CURRENT-STATE.md`'s "Sprite-animation
expansion" section explicitly deferred a sub-second tick for exactly this
reason: "The sub-second tick that would make all of this *fluid* rather than
1 fps stop-motion remains deferred (needs the harness refresh ceiling
measured first...)" — and P0's own closing line in `design.md` states the
ceiling is now measured and the finding is **FAIL-permanently**
(`CURRENT-STATE.md`: "Task 10 (the one sanctioned `buddy-status.sh`
sub-second-tick change) is dropped, not deferred").

**Consequence for this feature:** falling weather will read as gentle,
stop-motion drift — at best a flake shifts one row every few seconds, not a
smooth fall. This doc is honest about that up front rather than overselling
"snow falling" as something visually fluid. It is the same tradeoff every
other baked motion in this codebase already accepted (wander steps one cell
per `stepEvery` ticks; the kick slides one column per gait step-tick); falling
weather is not a worse case, just a newer one.

### 2.3 Row-budget facts, verified in the real files

- **The sprite art is a multi-line block held in `ART_LINES`**
  (`statusline/buddy-status.sh:252-255`): built by `while IFS= read -r line; do
  ART_LINES+=("$line"); done <<< "$FRAME_BODY"`, where `FRAME_BODY` is the
  base64-decoded, server-baked frame string (`buddy-status.sh:229`, decoding
  `$_FRAME_B64`). Whichever channel jq selected — idle (`.frames`),
  flourish (`.flourishFrames`), or combat (`.combatFrames`) — is picked by a
  single priority ladder at `buddy-status.sh:128-132` (`$combat_on` wins, then
  `$celeb_fresh && $has_fl`, else plain idle `frameSequence`/`frames`) and
  decoded into exactly **one** `FRAME_BODY`. There is currently no
  compositing of two independently-baked flipbooks onto one frame — only
  selection between them.
- **`ALL_LINES`/`ART_COUNT`** (`buddy-status.sh:578-635`): `ART_LINES`
  (the raw sprite rows) plus an appended `NAME_LINE`, optional `TITLE_LINE`,
  optional `BADGE_LINE` — `ART_COUNT=${#ALL_LINES[@]}`. A typical idle stack
  is ~5 sprite rows (the "standard 5-row frame," per the `_FACE_ROW` comment
  at `buddy-status.sh:264-266`) + 1 name row, sometimes −1 for the P1
  dead-row reclaim (`CURRENT-STATE.md`: "11 free-row species render one row
  shorter at rest"), +1 title, +1 badge when both are on. Call it **4–8
  rows** before hop headroom.
- **`HOP_RESERVE`/`WANDER_ROW`/`WANDER_ROW_MAX`/`ART_TOP`**
  (`buddy-status.sh:1017-1039`): a *variable* number of blank rows reserved
  above the art, capped at `HOP_CAP=2`, and the whole reservation collapses to
  0 if `ART_COUNT + HOP_RESERVE > HOP_BUDGET` where **`HOP_BUDGET=12`**
  (`buddy-status.sh:1029-1033`). This is the codebase's own stated ceiling for
  how tall the art column is allowed to get — the closest existing "row
  budget" precedent, and this doc reuses it (§3, D9 below).
- **The ground row** is printed **after** the whole per-line block, once, at
  full terminal width (`buddy-status.sh:1159-1213`) — it does not ride
  `WANDER_PAD_ART`/`ART_TOP` and its width (`_GRND_W = COLS - RIGHT_SAFETY -
  STATS_LEFT_MARGIN`) is only known in bash at render time
  (`design-ground-weather.md` §"The constraint that governs everything").
- **`STATS_LINES`** (a left-hand column, not a row below the art — confirmed
  by the per-row loop at `buddy-status.sh:1093-1157`, where `line_out` is
  built as `SPACER + [stats column] + [bubble] + [art]` on *every* row index
  `i`, with `MAX_LINES = max(ART_COUNT_TOTAL, TOTAL_BUBBLE, TOTAL_STATS)`).
  Typical `STATS_COUNT` is ~6 (5 stat bars + 1 XP row,
  `buddy-status.sh:703,747,814`). Because it's a column, not a stacked row, it
  does not compete for the same vertical travel budget a falling flake would
  use — only `ART_COUNT_TOTAL` does.

**Net travel distance available today, without adding anything:** roughly
4–8 (art+name/title/badge) + 0–2 (hop) = **4–10 rows**, capped at 12 total by
`HOP_BUDGET`. A flake genuinely falling top-to-bottom through that whole
stack, at the measured ~1 row/several-seconds cadence (§2.2), would take
tens of seconds to cross — feasible, but only if it has somewhere real to
fall *through* without corrupting the sprite it's falling past.

### 2.4 Why "falling through the sprite's own art" is the wrong first cut

The obvious reading of "falling snow" is flakes drifting down across the
buddy's own body — through its hat, its held weapon, its gear. This doc
explicitly evaluated and rejects that as phase-1 scope:

- **Collision risk is real and already load-bearing elsewhere.** `applyGear`
  and `applyPropKicked` only ever composite into cells verified **blank in
  every frame of the flipbook** (`GEAR_ANCHORS`/`PROP_ANCHORS`,
  `art.ts`) — and even that discipline needed **two real fix rounds**
  documented in `CURRENT-STATE.md`'s "The step-kick — Task 4's saga": a
  first landing's "aggregate blank-cell probe" wasn't actually
  per-species-safe, and a follow-up fix introduced a fresh eye-flicker
  regression. Falling flakes drifting through 20 species' worth of art, at
  any of several equipped-gear/hat/emotion combinations, is the same class
  of problem at a **larger combinatorial surface** (flake position × species
  × emotion × gear × hat × prop), not a smaller one.
- **The combinatorial baking cost is real.** `frameSequence` only cycles
  through a handful of *distinct* pre-baked sprite variants (idle/blink/
  glance/happy neutral — indices 0–5 per `STATUS_FRAME_SEQUENCE`,
  `art.ts:709-711`) repeated across an 18-tick loop. To have a flake visibly
  occupy a *different* row on each of those ticks while still respecting
  every species' blank-cell contract, the server would need to bake a
  weather-augmented variant of **every** sprite frame variant already in
  play, for every tick of the fall period — multiplying baked payload and
  reintroducing exactly the blank-cell-probe fragility the step-kick saga
  already burned two fix rounds on.
- **It fights the ethos, not just the mechanics.** `overlayFxRow`
  (`art.ts:808-829`) — the codebase's one existing "ambient FX drifting near
  the buddy" precedent (`WEATHER_OFFSETS = [1, -2, 3, -4]`, `art.ts:785`) —
  keeps its glyphs on a **dedicated row above the sprite**, explicitly
  carving out a buffer around the emote glyph rather than touching the body
  (`art.ts:817-823`, the `occupied` set). The pattern the codebase already
  trusts for "weather-ish ambient marks near the buddy" is *adjacent to*
  the sprite, not *through* it.

**Recommended phase-1 scope:** flakes fall through a small, dedicated
**"sky band"** — a fixed handful of rows immediately above the sprite, not
through the sprite's own cells at all. This sidesteps the collision problem
entirely (nothing ever composites onto buddy pixels), sidesteps the
combinatorial-baking problem (the band is independent of which sprite variant
is currently showing), and is a direct generalization of `overlayFxRow`'s
already-proven "one extra row, paid only while active" pattern to N rows
instead of 1. §3 works out the mechanism; §5 records what's explicitly
deferred (through-the-sprite motion, multi-row ground-level accumulation
animation, etc.).

### 2.5 A genuine simplification the ground-weather plan didn't have available

Ground-weather's hardest problem (`design-ground-weather.md` §D5, §"The
constraint that governs everything") was **color**: the ground row is one
plain-hex-tinted string the shell dims with a single escape, so making one
glyph read a different color needed new shell surface (a bounded
`${var//lit/repl}` substitution, verified against real UTF-8 glyphs as a
DECISION GATE).

**Sprite frames don't have this problem.** Frame art is already exempt from
the jq control-character sanitizer specifically because it's allowed to carry
literal embedded ANSI — the wyvern's fire tail is real embedded SGR baked
directly into its frame string (`CURRENT-STATE.md`'s hardening-pass section:
"Frame art stays exempt (base64'd raw — wyvern's flame is legitimate ANSI)";
confirmed in `buddy-status.sh:229` — `FRAME_BODY` is a straight `base64 -d`
with no jq sanitizer pass, unlike every other free-text field). **This means
a falling-weather band can bake its own per-glyph SGR color directly into the
row string server-side**, with zero new shell-side recoloring mechanism. This
is a real, useful simplification over ground-weather's D5 — flagged
explicitly here so a future reader doesn't assume falling weather needs its
own version of that substitution work.

### 2.6 What *is* still a genuine, non-trivial shell change

Unlike ground-weather's Task 3 (a single bounded substitution on an existing
row), compositing a new band **above** whichever frame the priority ladder
selected is new *stacking* behavior the shell doesn't do today (§2.3: today
there is selection between `frames`/`flourishFrames`/`combatFrames`, never
compositing of two independently-baked flipbooks onto one visual block).
§3/§4 scope this precisely and flag it honestly as **the one real shell change
in this plan** — smaller than it could be (a second base64-decode-and-prepend
step, mirroring the existing `FRAME_BODY` decode loop almost verbatim) but
real, and not "zero `buddy-status.sh` changes" the way P4's props/weather-FX
work was.

---

## 3. Resolved decisions

| # | Question | Decision |
| --- | --- | --- |
| **D1** | Layer on the static ground specks, or replace them? | **Layer.** The sky band is precipitation *in transit*; the existing woven ground-tile specks read as precipitation *already landed* (snow/rain accumulated on the terrain). Both effects share one cause and one schedule (D2) — falling snow above a floor with snow specks on it is a coherent single picture, not a redundant one. |
| **D2** | Reuse `pickSessionWeather`/`isWeatherActive`, or a second schedule? | **Reuse verbatim, no second schedule.** Both the ground row and the sky band call `pickSessionWeather(startedAt)`/`isWeatherActive(schedule, elapsedMs)` from the *same* `writeStatusState` call site the ground block already has (`state.ts:1518-1549`) — one schedule, one on/off boundary, so falling motion and ground specks can never disagree about whether weather is currently happening. |
| **D3** | What rows do flakes travel through? | **A dedicated "sky band"** of `SKY_BAND_ROWS` (recommend 2–3) rows, prepended directly above `ART_LINES` — *not* through the sprite's own glyph cells, *not* the full-width ground row. Per §2.4, routing through the sprite is rejected as phase-1 scope (collision risk + combinatorial baking cost); routing through the ground row is rejected because that row's width is only known in bash at render time (§2.3), which the sky band — fixed at the idle art's own known width — avoids entirely. |
| **D4** | How is position baked? | **A short, independent per-tick flipbook**, exactly the `frameSequence`/`wanderSequence` pattern already proven at `art.ts:709-711` and `wander.ts:93-145`: `buildFallingWeatherBand(kind, seed, width, rows, period)` (pure, seeded, new — §4 Task 1) precomputes `period` distinct band strings (each `rows`-many `\n`-joined lines, `width` display cells wide), one per tick 0..period−1, with a small fixed number of flakes at seeded columns and phase-offset vertical positions so they don't all fall in lockstep. `buddy-status.sh` indexes it `NOW % period`, identically to every other baked sequence — **no live position math in the shell, ever**. |
| **D5** | Per-flake (row,col) table, or a formula bash derives? | **Neither literally — a small closed set of fully pre-rendered band strings** (D4), which is cheaper than a raw per-tick (row,col) table (bash would still need to *draw* those coordinates into a row, which is exactly the kind of "shell computes/composites motion" the invariant forbids) and far cheaper than trying to give bash a live formula (forbidden outright by the "server bakes, bash cycles" invariant). `period` need only be large enough to avoid an obviously-repeating loop being noticed at ~1s/tick — 10–16 is plenty; contrast `wander.ts`'s `DEFAULT_LENGTH = 180`, which affords far more headroom than this needs since the whole point here is a small, cheap addition to `status.json`, not a long-period sequence. |
| **D6** | Color/glyph mechanism? | **Embed literal SGR directly into the baked band string**, reusing the wyvern-flame precedent (§2.5) — `buildFallingWeatherBand` writes real `\x1b[38;2;r;g;bm` escapes around each flake glyph in the line it constructs, the same way `frames`/`combatFrames` already carry embedded ANSI today. **No new bash-side recoloring mechanism is needed** — this is the one place this feature is genuinely *simpler* than ground-weather's D5, and it should stay that way (do not reinvent a shell substitution step for this). |
| **D7** | Density/speed/lifecycle per flake? | Small fixed flake count (recommend 3–4, tunable named constant, mirroring `buildWeatherTile`'s "cheap, named, not inlined" idiom), columns spread across the band width via the seeded RNG (mulberry32, distinct hash-prefix stream off the same `startedAt` — the `props.ts`/`ground.ts` "independent draws off one seed" idiom, e.g. `sky-fall:${seed}`), each with its own phase offset so falls stagger rather than sync. A flake that reaches the band's bottom row simply respawns at the top after a short gap tick (same "arc surrounded by baseline, so it reads as a complete cycle" idea `hopArc` already uses, `wander.ts:76-83`) — pure and cheap; no persisted per-flake state. |
| **D8** | New shell channel or fuse into `frames`? | **New, small, independent channel** — `weatherFallFrames`/`weatherFallSequence` — decoded and **prepended** above the already-decoded `ART_LINES`, not fused combinatorially into every sprite-frame variant (§2.6 explains why fusing is the expensive/fragile option). This is the one real (if modest) shell change in this plan; see Task 3. |
| **D9** (row-budget policy) | What happens when the sky band would blow the height budget? | **The sky band degrades before hop does.** Mirror `HOP_RESERVE`'s own collapse rule (`buddy-status.sh:1029-1033`, budget `HOP_BUDGET=12`) but apply it to `ART_COUNT + HOP_RESERVE + SKY_BAND_ROWS`: if that sum exceeds a (slightly larger, since it now covers two independent reservations) budget, drop the sky band first — hop is an explicit opt-in the user turned on; weather is "ambient decoration, not simulation" (the ground-weather design doc's own framing), so it yields. |
| **D10** (interaction w/ combat/flourish/gate) | When does the band suppress? | **Mirror the wander/gait suppression condition exactly**, not the ground row's slightly different one. The jq wander gate is `$gf == "full" and $celeb_fresh != 1 and $combat_on != 1` (`buddy-status.sh:150,154`) — weather uses the identical three-part condition (full-only, no fresh celebration, no combat scene) rather than the ground row's `$gf == "full" and $combat_on != 1` (which does *not* suppress during a celebration). Rationale: the sky band sits directly above the sprite in the same visual column wander/gait/emote already own, and a flourish already swaps that whole area to a different, taller flipbook (`flourishFrames`) — stacking a band on top of a flourish frame was never validated and isn't worth the risk for a first cut. The ground row, by contrast, is a fully separate full-width strip below everything, which is why it only needed the combat suppression. |
| **D11** (config) | New toggle or piggyback? | **Piggyback `groundEnabled`**, same as the ground-weather layer itself (`design-ground-weather.md` D3). No new config key — falling weather is switched by the same lever that already controls whether the ground shows weather at all, since D1 ties them to one schedule and one "weather is happening" concept. |

---

## 4. Task-by-task implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to execute this task-by-task. Steps use
> `- [ ]` checkbox syntax for tracking.

**Architecture (restated as the contract every task protects):** one pure,
seeded core (`buildFallingWeatherBand`) bakes `period` distinct band strings,
each `rows`-many lines, each line exactly `width` display cells wide, with
per-flake SGR embedded directly in the string (D6) — no bash-side color
mechanism. `writeStatusState` computes this alongside the existing ground/
weather block, reusing the *same* `schedule`/`elapsedMs` (D2) rather than a
second roll, and writes two new plain fields, `weatherFallFrames` (array of
strings) + `weatherFallSequence` (array of indices, `NOW % len` pattern) —
present **only** while `isWeatherActive` is true, exactly the same
"absent ⇒ off" contract `groundWeatherGlyph` already uses. The shell decodes
and **prepends** the selected band's lines above `ART_LINES`, gated on
D10's wander-style condition, before the hop-headroom math runs (so
`ART_COUNT` already reflects the taller stack and every downstream
centering computation — `BUBBLE_START`, `STATS_START`, `ART_TOP` — needs no
special-casing, per §2.3's insertion-point analysis). When no window is
open, `ART_LINES`/`ART_COUNT` and every downstream render are byte-identical
to today.

**Tech stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), bash
statusline (`bash -n statusline/buddy-status.sh`). Task 3 is the one shell
change in scope.

**Read first:**
- This doc in full (§1–3 especially — the D-decisions this plan implements).
- `design-ground-weather.md` and `plan-ground-weather.md` in full — the
  sibling doc/plan this one extends structurally and whose `pickSessionWeather`/
  `isWeatherActive` this plan reuses verbatim, not re-derives.
- `server/ground.ts` (the schedule this plan calls, unmodified).
- `server/art.ts`'s `overlayFxRow`/`emoteFor`/`finalizeIdleBlock`
  (`art.ts:709-829`, read in full) — the nearest existing precedent for "one
  extra row composited above the sprite, paid only while active."
- `server/wander.ts`'s `buildWanderSequence` (`wander.ts:93-145`) — the
  nearest existing precedent for "a pure function baking a per-tick array,
  cycled by the shell via `NOW % length`."
- `statusline/buddy-status.sh:128-132` (the existing frame-source priority
  ladder) and `:229-269` (the `FRAME_BODY` decode → `ART_LINES` build) — the
  exact insertion point Task 3 extends.

---

### Task 0: DECISION GATE — confirm the idle frame's real display width — ✅ RESOLVED 2026-07-24

Every downstream row (`_ART_FILL`, and now the sky band) must be exactly the
idle frame's real display width, or a row of the wrong length will visibly
misalign against the sprite/name/title lines beneath it. `buddy-status.sh`
hardcodes `ART_W=14` for the *bash-side padding/centering* budget
(`buddy-status.sh:628`), but that's a filler-column width, not a proof of the
literal baked frame line width the server emits for idle art. Before writing
`buildFallingWeatherBand`, verify empirically (not by inference) what
`getStatusFrames(...)`'s frame strings actually measure at, per species,
using the real `displayWidth` helper (`art.ts`) against a sample of frames
across a few species (including the wider/odd ones — wyvern, mushroom). State
the confirmed width (or narrowest common width, if it varies per species) in
your task report; `buildFallingWeatherBand`'s `width` parameter must be driven
by that measured value, not by a re-guessed constant. This mirrors
`plan-ground-weather.md` Task 1 Step 2's own "verify empirically, don't reuse
a design-doc placeholder" discipline.

- [x] Run a throwaway probe (`bun run` a one-off script, or a scratch test)
  that calls `getStatusFrames` for every species at neutral emotion and
  measures `displayWidth` on each returned frame's lines; report the min/max/
  mode.
- [x] Record the finding as a comment in Task 1's implementation (the actual
  width constant used) rather than leaving it implicit.

**Measured result (520 lines across all 19 species × 5 neutral-emotion
frames, hat `"none"`):** width is **NOT a single number.** Histogram: `6→4,
7→1, 8→10, 9→19, 10→5, 11→11, 12→470`. 16/19 species are a uniform 12 cells
on every line of every frame. Three are not:

- `rabbit`: 10 or 12 depending on the line (one row is narrower — presumably
  the ear/body silhouette).
- `pikachu`: 9, 11, or 12 depending on the line.
- `wyvern`: 6, 7, 8, or 9 depending on the line — genuinely ragged **within
  a single frame**, confirmed by reading its raw art directly
  (`server/art.ts`, `SPECIES_ART.wyvern`): `["}       {", "|\^\`\`\`^/|",
  "\ {E}' '{E} /", " \ } { /", " ≈(° °)≈", "   '-'"]` — a deliberately
  tapering dragon silhouette, not a padding bug. Its rows are different
  lengths by design.

**Why this doesn't break anything today, and why it matters for this plan
specifically:** `buddy-status.sh`'s render loop
(`buddy-status.sh:1093-1157`) prints `art_part` as the **rightmost** thing on
each line (`line_out+="$art_part"` immediately followed by `echo`), with no
per-line padding to `ART_W` or any other width — `_ART_FILL` is only used
for *entirely blank* filler rows (art absent for that row index), never to
pad a *present-but-short* line. So a ragged line like wyvern's `"   '-'"`
(6 cells) prints shorter than its siblings and nothing downstream cares,
because nothing is printed after it on that line. `ART_W=14` is a **layout
budget** other math (`FIT_INNER`, `CLUSTER_W`, combat-scene widening) reasons
about, not a contract every art line satisfies.

**Consequence for `buildFallingWeatherBand`:** unlike the sprite's own art,
the sky band is a *new* rectangle stacked above the sprite and must look
like a coherent falling-snow band — every row the same width, since (unlike
sprite art) it isn't always rightmost-and-unpadded; it sits directly above
whatever width of sprite is beneath it, and a ragged band would look like a
bug, not a silhouette. There is no real per-species "frame width" to borrow
(§ above disproves that premise). **Resolved width: `SKY_FALL_WIDTH = 14`,
reusing `ART_W`'s existing value directly** — not a re-derivation, the same
constant the rest of the layout already treats as the art column's
reserved budget, and safely ≥ the widest real content observed (12). This
also sidesteps needing any per-species branching (already out of scope per
§5's "Species-specific band width/positioning" deferral) — one shared
constant, matching what the shell already reserves.

---

### Task 1: Pure core — `buildFallingWeatherBand` (new module)

Lands the whole feature's pure heart. Inert — no caller yet.

**Files:** New `server/weatherfall.ts` (recommended — keeps `art.ts` from
growing an unrelated concern, mirrors how `ground.ts`/`props.ts` are their
own standalone modules) + `server/weatherfall.test.ts`.

- [x] **Step 1 — DECISION GATE: band height, flake count, and period.**
  **RESOLVED 2026-07-24:** `SKY_BAND_ROWS=3`, `FLAKE_COUNT=4`,
  `FALL_PERIOD=12` — the recommended midpoints, exported as named constants
  from `server/weatherfall.ts`.
  Grounded in §2.3/§3 D9: pick `SKY_BAND_ROWS` (recommend 2–3 — enough to
  read as vertical motion, small enough that `ART_COUNT + HOP_RESERVE +
  SKY_BAND_ROWS` rarely approaches `HOP_BUDGET=12` for a typical 6–8-row
  idle stack), `FLAKE_COUNT` (recommend 3–4, a named constant per D7), and
  `FALL_PERIOD` (recommend 10–16 ticks — long enough that the loop point
  isn't glaringly obvious at ~1s/tick, short enough to keep the baked
  payload small; contrast `wander.ts`'s `DEFAULT_LENGTH=180`, which this
  doesn't need to match since the goal here is a small addition to
  `status.json`, not a long-period walk). Export every threshold as a named
  constant, per this arc's standing "make it easily tunable" convention.

- [x] **Step 2 — DECISION GATE: flake glyph, disjoint from every existing
  glyph set.** Run `grep -n "WEATHER_GLYPH\|MIRROR_SWAP" server/art.ts
  server/ground.ts` and re-derive `ALL_GROUND_GLYPHS`/
  `ALL_GROUND_WEATHER_GLYPHS`/`art.ts`'s idle-FX `WEATHER_GLYPH` set. Since
  the sky band embeds its own SGR (D6) it doesn't strictly need bash-safe
  glyphs the way the ground row's plain-hex-tinted tile does — but it still
  needs to be a **single display cell** (so `rows`-many fixed-width lines
  stay exactly `width` cells regardless of how many flakes land) and **not
  collide with `MIRROR_SWAP`'s keys** (defensive, same posture as every
  other glyph table in this codebase, even though the sky band — like the
  ground row — is never actually mirrored). Candidate glyphs distinct from
  `+`/`:`/`'`/`*` (all already spoken for by sibling features): e.g. `❄` for
  snow (note: verify its `displayWidth` — many dingbat-range codepoints in
  `art.ts`'s width table render 2 cols; if so, fall back to a plain ASCII
  candidate like `.` or `` ` `` instead) and `,` or `` ` `` for rain, checked
  for collision against `art.ts`'s `displayWidth` table before committing.

  **RESOLVED 2026-07-24:** ran a real `displayWidth()`/`mirrorFrame()` probe
  against `❄` (U+2744), `❅`, `❆`, `☃`, `` ` ``, `˙`, `‧`, `。`, `;`. Result:
  `❄` measures **width 1** — the plan's worry about dingbat-range codepoints
  being 2-wide didn't apply here, no fallback needed. Final choice: **snow =
  `❄`, rain = `` ` ``** — both single display cell, both disjoint from every
  existing glyph (ground terrains `„.,~▂·`, ground-weather `+:`, idle-FX
  weather `'*`) and from `MIRROR_SWAP`'s keys, both mirror-safe.

- [x] **Step 3 — failing tests** (`server/weatherfall.test.ts`, mirroring
  `ground.test.ts`'s and `wander.test.ts`'s shapes):

```ts
import {
  buildFallingWeatherBand,
  ALL_SKY_FALL_GLYPHS,
} from "./weatherfall.ts";
import { displayWidth, mirrorFrame } from "./art.ts";

describe("falling weather band (living-world follow-up)", () => {
  test("same seed => same band frames, deterministic", () => {
    const a = buildFallingWeatherBand("snow", 42, 14, 3, 12);
    const b = buildFallingWeatherBand("snow", 42, 14, 3, 12);
    expect(a).toEqual(b);
  });

  test("returns exactly `period` frames, each exactly `rows` lines, each line exactly `width` display cells", () => {
    const width = 14, rows = 3, period = 12;
    const frames = buildFallingWeatherBand("rain", 7, width, rows, period);
    expect(frames.length).toBe(period);
    for (const f of frames) {
      const lines = f.split("\n");
      expect(lines.length).toBe(rows);
      for (const line of lines) expect(displayWidth(line)).toBe(width);
    }
  });

  test("motion is genuine: at least one flake occupies a different row across the period (not a static frame repeated)", () => {
    const frames = buildFallingWeatherBand("snow", 99, 14, 3, 12);
    expect(new Set(frames).size).toBeGreaterThan(1);
  });

  test("a seed sweep produces both snow and rain glyph sets without crossover", () => {
    const snow = buildFallingWeatherBand("snow", 1, 14, 3, 12).join("");
    const rain = buildFallingWeatherBand("rain", 1, 14, 3, 12).join("");
    // strip ANSI before checking glyph presence
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(strip(snow)).not.toBe(strip(rain));
  });

  test("every sky-fall glyph is single display cell, ANSI-free on its own, and MIRROR_SWAP-safe", () => {
    for (const g of ALL_SKY_FALL_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(displayWidth(g)).toBe(1);
      const mirrored = mirrorFrame([`  ${g}  `]).join("\n");
      expect(mirrored).toContain(g);
    }
  });

  test("frames carry embedded SGR around each flake glyph (not plain text)", () => {
    const frames = buildFallingWeatherBand("snow", 42, 14, 3, 12);
    expect(frames.some((f) => f.includes("\x1b["))).toBe(true);
  });
});
```

- [x] **Step 4 — verify failure:** `bun test server/weatherfall.test.ts` →
  FAIL (module doesn't exist yet). Confirmed: `Cannot find module
  './weatherfall.ts'`.

- [x] **Step 5 — implement**, per Steps 1–2's GATE outcomes:

```ts
// server/weatherfall.ts
import { hashString, mulberry32 } from "./engine.ts";
import type { GroundWeather } from "./ground.ts";

const SKY_FALL_GLYPH: Record<GroundWeather, string> = {
  snow: "❄", // Step 2 GATE — verify displayWidth === 1 before committing
  rain: "`",
};
const SKY_FALL_COLOR: Record<GroundWeather, string> = {
  snow: "e8f0f7",
  rain: "5f8fc7",
};
export const ALL_SKY_FALL_GLYPHS: readonly string[] =
  Object.values(SKY_FALL_GLYPH);

const FLAKE_COUNT = 4; // Step 1 GATE
const FALL_GAP_TICKS_MIN = 2; // ticks a flake waits offscreen before respawning
const FALL_GAP_TICKS_RANGE = 3;

// Task 0 (RESOLVED 2026-07-24): real idle-frame content measures 6-12 display
// cells across species (16/19 species are a uniform 12; rabbit/pikachu/wyvern
// vary per-line, wyvern by deliberate tapering silhouette design, not a bug)
// — no single per-species frame width exists to borrow. The sky band reuses
// buddy-status.sh's existing ART_W=14 layout-budget constant instead (≥ the
// widest real content observed), avoiding species branching (out of scope,
// see plan §5). The caller (state.ts) passes this in as SKY_FALL_WIDTH.

function sgr(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}
const RESET = "\x1b[0m";

/**
 * Pure. Bakes `period` distinct sky-band frames (each `rows`-many
 * `\n`-joined lines, each line exactly `width` display cells), depicting
 * `FLAKE_COUNT` flakes falling top-to-bottom with staggered phases, then
 * respawning after a short gap. Distinct hash prefix (`sky-fall:`) from
 * every other ground-weather draw so re-baking the band never rerolls
 * whether/when weather happens (D2).
 */
export function buildFallingWeatherBand(
  kind: GroundWeather,
  seed: number,
  width: number,
  rows: number,
  period: number,
): string[] {
  const rng = mulberry32(hashString(`sky-fall:${seed}`));
  const color = sgr(SKY_FALL_COLOR[kind]);
  const g = SKY_FALL_GLYPH[kind];
  const cycleLen = rows + FALL_GAP_TICKS_MIN +
    Math.floor(rng() * FALL_GAP_TICKS_RANGE);
  const flakes = Array.from({ length: FLAKE_COUNT }, () => ({
    col: Math.floor(rng() * width),
    phase: Math.floor(rng() * cycleLen),
  }));
  const frames: string[] = [];
  for (let t = 0; t < period; t++) {
    const grid: string[][] = Array.from({ length: rows }, () =>
      new Array(width).fill(" "),
    );
    for (const f of flakes) {
      const pos = (t + f.phase) % cycleLen;
      if (pos < rows) grid[pos][f.col] = `${color}${g}${RESET}`;
    }
    frames.push(grid.map((r) => r.join("")).join("\n"));
  }
  return frames;
}
```

  (Sketch only — resolve any width off-by-one during implementation; the
  tests in Step 3 are the actual contract.)

- [x] **Step 6:** targeted PASS (8/8); full `bun test` → **1052 pass** (1044
  baseline + 8 new); `bunx tsc --noEmit` clean. No caller yet — `ground.ts`,
  `state.ts`, and `buddy-status.sh` are all untouched by this task.

- [ ] **Step 7:** Commit: `feat(living-world): falling-weather sky-band core` (+ trailer).
  **Not done** — left uncommitted pending the user's go-ahead (this repo's
  session convention has been to ask before committing rather than commit
  automatically per task).

---

### Task 2: Wire into `writeStatusState`

Extends the existing ground/weather block (`state.ts:1518-1549`) rather than
adding a second try/catch or a second schedule read.

**Files:** Modify `server/state.ts`, Test `server/state_wander.test.ts`.

- [x] **Step 1 — failing tests.** Follow `state_wander.test.ts`'s
  `stubGroundWeather` idiom exactly (`plan-ground-weather.md` Task 2's Recon
  facts entry on the stub-loader gotcha — the stub **must** also re-export
  `pickSessionGround`, or terrain rendering breaks in the same block).
  Extend that same stub to also control the new `buildFallingWeatherBand`
  call, and assert:
  - full + `groundEnabled` + active window ⇒ `status.json` carries
    `weatherFallFrames` (non-empty array) and `weatherFallSequence`
    (array of indices, same length pattern as `frameSequence`).
  - inactive window ⇒ neither field is present (byte-identical to today's
    ground-only render — the existing unstubbed ground tests must keep
    passing without needing `stubGroundWeather` set, mirroring
    `plan-ground-weather.md` Task 2 Step 4's back-compat pin).
  - `groundEnabled: false` ⇒ neither field is present regardless of
    schedule (D11).
  - `subtle`/`off` ⇒ neither field present regardless of schedule.

  **Implementation note:** `buildFallingWeatherBand` (weatherfall.ts) needed
  no NEW stub — it's pure and seeded off `startedAt`/`schedule.kind` only, so
  the existing `stubGroundWeather` plugin (which fixes `ground.ts`'s
  schedule) was sufficient to make the whole write deterministic; the 5 new
  tests landed in a new describe block in `state_wander.test.ts` right after
  the existing ground-weather one, reusing its `STARTED` constant.

- [x] **Step 2 — verify failure.** Confirmed: the "active window" test
  failed (`expect(Array.isArray(state!.weatherFallFrames)).toBe(true)` →
  received `false`) since `state.ts` didn't write the field yet; the
  absence-assertion tests passed trivially (nothing writes the fields yet
  either way), exactly as expected pre-implementation.

- [x] **Step 3 — implement.** Extend the existing block in place — reuse the
  *already-computed* `schedule`/`elapsedMs`/`isWeatherActive(...)` result
  (D2 — do not call `pickSessionWeather` a second time):

```ts
// inside the existing `if (idleGate === "full" && cfg.groundEnabled)` block,
// after the ground-tile weaving block:
let weatherFallFrames: string[] | undefined;
let weatherFallSequence: number[] | undefined;
if (isWeatherActive(schedule, elapsedMs)) {
  const { buildFallingWeatherBand } =
    require("./weatherfall.ts") as typeof import("./weatherfall.ts");
  // SKY_FALL_WIDTH = 14, matching buddy-status.sh's ART_W layout budget —
  // Task 0 measured real idle-frame content at 6-12 cells (no single
  // per-species width exists; 3/19 species are even ragged within their
  // own frame), so the band deliberately reuses the shell's existing
  // ART_W constant rather than any species-derived value (plan-falling-
  // weather.md Task 0).
  const frames = buildFallingWeatherBand(
    schedule!.kind, startedAt, SKY_FALL_WIDTH, SKY_BAND_ROWS, FALL_PERIOD,
  );
  weatherFallFrames = frames;
  weatherFallSequence = Array.from({ length: FALL_PERIOD }, (_, i) => i);
}
```

  Add the two fields to the `StatusState` object (conditional spread,
  matching the existing `ground`/`groundWeatherGlyph` style) and to the
  `StatusState` interface doc-comments (`state.ts:768-786`), following the
  existing `groundWeatherGlyph`/`groundWeatherColor` doc-comment pattern
  ("present iff a weather window is active").

  **Deviation from the sketch:** the real implementation destructures
  `SKY_FALL_WIDTH`/`SKY_BAND_ROWS`/`FALL_PERIOD` straight off the
  `weatherfall.ts` import alongside `buildFallingWeatherBand` (all three are
  exported constants from Task 1), rather than re-declaring them locally in
  `state.ts` as the sketch's comment implied — one source of truth for Task
  2 and Task 3 to both reference, not a duplicate.

- [x] **Step 4:** targeted PASS (5/5); full `bun test` → **1057 pass**
  (1052 baseline + 5 new); `bunx tsc --noEmit` clean; `bash -n
  statusline/buddy-status.sh` clean (untouched this task). Confirmed
  pre-existing ground/weather tests (22 total in that describe block) stay
  green **unstubbed**.

- [ ] **Step 5:** Commit: `feat(living-world): bake the falling-weather band at write time` (+ trailer).
  **Not done** — left uncommitted pending the user's go-ahead, same as
  Task 1's Step 7.

---

### Task 3: Shell — prepend the decoded band above `ART_LINES`

The one real shell change in this plan (§2.6). Small and bounded, but not
"zero" — flag this honestly in the commit/PR description rather than
understating it the way P4's "zero `buddy-status.sh` changes" framing doesn't
apply here.

**Files:** Modify `statusline/buddy-status.sh`, Test
`server/statusline_render.test.ts`.

- [x] **Step 1 — DECISION GATE: verify the prepend + embedded-ANSI + width
  math survives real bash, real `wc`/`${#}` measurement, and the downstream
  `ART_COUNT`/`HOP_RESERVE`/centering arithmetic unmodified.** **RESOLVED
  2026-07-24 — Branch A, with one refinement over the literal sketch.**

  This is the load-bearing unknown for this task — everything downstream
  (`ART_COUNT=${#ALL_LINES[@]}`, `HOP_RESERVE` collapse logic,
  `BUBBLE_START`/`STATS_START` centering) trusts `ART_LINES` to be a clean
  bash array of display-ready lines. Run a throwaway probe with the actual
  band strings Task 1 produces (decode a real `weatherFallFrames[0]` through
  `base64 -d`, split into an array the same way `FRAME_BODY` is split at
  `buddy-status.sh:252-255`, and prepend it ahead of the real `ART_LINES`
  build) and confirm:
  (a) the embedded SGR survives the `while IFS= read -r line` loop
  byte-for-byte (no stripping, no reordering);
  (b) `${#ALL_LINES[@]}` correctly counts the taller array;
  (c) the existing per-line rarity/shiny color wrap
  (`art_part="${ALL_COLORS[$ai]}${ALL_LINES[$ai]}${NC}"`,
  `buddy-status.sh:1098`) composes cleanly with a line that already carries
  its own embedded reset (`\x1b[0m`) mid-string — i.e. a leading `$C`
  escape, then the band line's own color/reset pairs, then the trailing
  `$NC`, renders as intended and doesn't leave a stray un-reset color
  bleeding into the next printed segment. This exact composition (rarity
  wrap around an already-ANSI-bearing line) already happens for the
  wyvern's fire tail today — cite that as the working precedent, but still
  run the probe against the *actual* band-line shape (multiple embedded
  color spans per line, not one long tail) before trusting it.

  - **Branch A — it composes cleanly.** Proceed with the direct
    prepend-and-array-count approach below.
  - **Branch B — some corruption/count issue is found.** Fall back to
    building the band as its own separate small loop that `echo`s directly
    (bypassing `ART_LINES`/the generic centering machinery entirely) —
    strictly worse (loses the "free" `ART_TOP`/centering integration §2.3
    identified), so only take this branch if Branch A genuinely fails the
    probe, and document exactly why.

  State which branch, and the probe's actual output, in your report.

  **Probe results, run against a real baked `buildFallingWeatherBand` frame
  (base64-decoded through the actual `while IFS= read -r line` split, a
  synthetic 5-row `ART_LINES`, and the real `$C`/`$NC`/`$DIM` color vars):**
  - (a) embedded SGR survives byte-for-byte — verified via a literal
    byte-exact comparison (`"$C${WF_LINES[1]}$NC"` reconstructed manually
    equaled the actual composed row string exactly).
  - (b) `${#ALL_LINES[@]}` counted correctly in every variant tried (9 = 3
    band + 5 sprite + 1 name).
  - (c) composition does NOT corrupt anything, confirming the plan's own
    prediction: the flake's embedded `\x1b[0m` mid-line resets the OUTER
    `$C` wrap early, but since only plain spaces follow before the line's
    own trailing `$NC`, there's no visible bleed — reproducibly byte-exact.

  **Branch A confirmed — but Step 1's probe surfaced a real refinement
  worth taking over the LITERAL sketch** (prepend into raw `ART_LINES`
  before the `$C`/rainbow coloring loop at `buddy-status.sh:581-589`):
  doing that would wrap every band line in the rarity/shiny color for no
  reason (harmless on blank cells, since the flake's own embedded escapes
  win, but wasteful) and — more importantly — would offset a **SHINY**
  buddy's rainbow-cycle index (`_arc`) by the band's row count, shifting
  which rainbow color lands on which SPRITE row purely because unrelated
  band rows consumed cycle steps first. Also: the fallback enemy-glyph hover
  (`buddy-status.sh:283-284`, `_FACE_ROW = ${#ART_LINES[@]} / 2`) computes
  its row directly off `ART_LINES`'s own length — literally prepending into
  `ART_LINES` would need extra care to sequence around that fallback path
  too.

  **Adopted instead: prepend into `ALL_LINES`/`ALL_COLORS` AFTER the
  coloring loop**, with an EMPTY color wrapper for band rows (the band
  already carries its own complete embedded SGR per D6 — no wrapper color
  needed at all). This is still "Branch A" in the plan's sense (a direct
  prepend, not the Branch B bypass-loop fallback) — just a more precise
  insertion point discovered by actually tracing the pipeline instead of
  assuming the sketch's literal wording. Verified this produces byte-exact
  output with zero extraneous escapes (`"${WF_LINES[1]}$NC"` — no `$C`
  wrapper at all — matched the composed row exactly). Also sidesteps the
  enemy-glyph fallback interaction entirely, since that logic finishes with
  `ART_LINES` long before the band touches `ALL_LINES`.

  **Two real apostrophe bugs caught and fixed** while writing the new jq
  comments inside the single-quoted jq program (`buddy-status.sh`'s own
  code already warns about this exact trap: "NB: no apostrophes in this
  block — the whole jq program is single-quoted in bash, so a stray quote
  would truncate it" — a warning this session initially failed to heed on
  the first draft): "base64'd raw" and "ground row's looser" both broke the
  quoting and produced a cascading `bash -n` syntax error many lines later
  (at the unrelated `WANDER_ROW` sanitizer `case` statement) — caught by
  `bash -n`, not by inspection; both rephrased to avoid the apostrophe.

  **D9's exact budget number, resolved via empirical probing (not the
  plan's placeholder "slightly larger than `HOP_BUDGET`"):** working the
  arithmetic showed that any `SKY_BAND_BUDGET > HOP_BUDGET` makes the
  degrade check nearly unreachable in realistic cases — hop's own collapse
  logic already guarantees `ART_COUNT + HOP_RESERVE <= HOP_BUDGET(12)`
  whenever hop keeps its reservation, so a "slightly larger" ceiling for the
  BAND's own check would only ever trip in extreme (near-impossible)
  stacks, defeating the point. **Resolved: reuse `HOP_BUDGET` directly (12,
  no extra headroom)** — hoisted out of the `if [ "$WANDER_ROW_MAX" -gt 0 ]`
  block into a top-level constant so both checks share one number. Verified
  end-to-end against the real script with a 5-row sprite + 1 name row
  (`ART_COUNT=6`) and `wanderRowSequence` maxing at 2 (`HOP_RESERVE=2`):
  a 3-row band fits (`6+2+3=11<=12`, band renders, 11 total output lines);
  a 6-row band doesn't (`6+2+6=14>12`), and — the actual point of D9 — the
  band alone drops while hop's reservation stays fully intact (8 total
  lines, matching `ART_COUNT+HOP_RESERVE` with hop UNCHANGED, not the 6
  lines a wrongly-also-dropped hop would produce, nor the 14 a
  wrongly-kept-oversized-band would produce).

- [x] **Step 2 — failing tests** (`statusline_render.test.ts`, extending its
  `renderStatus`/`StatusOverrides` fixture helper, mirroring
  `plan-ground-weather.md` Task 3 Step 2's shape):

  **Implementation note — the sketch's "byte-identical before/after" test
  was deliberately NOT copied verbatim.** It compared two IDENTICAL override
  objects (`{...}` vs `{..., weatherFallFrames: undefined}` — passing
  `undefined` for an already-optional field is a no-op), which is the exact
  same self-referential-tautology mistake a prior audit caught in the
  sibling ground-weather test suite (a test that passes regardless of
  whether the feature works). Replaced with a real absence check: no flake
  glyph anywhere AND an exact expected total-line count for the plain
  fixture (6 = 5 sprite rows + 1 name row), both empirically confirmed
  against the real script first. 7 tests total landed (one more than the
  sketch's 4, splitting "sprite unaffected" from "band sits above sprite"
  and giving D10's combat/celebration/subtle-off suppression each their own
  case rather than one combined test).

```ts
// StatusOverrides:
weatherFallFrames?: string[];
weatherFallSequence?: number[];
```

```ts
test("active falling weather: the band renders above the sprite, sprite unaffected", () => {
  const out = renderStatus({
    gameFeel: "full",
    weatherFallFrames: [/* one fixed 3-row band string */],
    weatherFallSequence: [0],
    columns: 80,
    showStats: false,
  });
  // the sprite's own rows are unchanged vs. a no-weather render at the same seed
});

test("no falling-weather fields => byte-identical to today's plain idle render", () => {
  const before = renderStatus({ gameFeel: "full", columns: 80, showStats: false });
  const after = renderStatus({
    gameFeel: "full", columns: 80, showStats: false,
    weatherFallFrames: undefined, weatherFallSequence: undefined,
  });
  expect(after).toBe(before);
});

test("combat/flourish suppress the band even with fields present (D10)", () => {
  // combat_on=1 and celeb_fresh=1 cases both must render with no band rows
});

test("total block height respects the degrade rule (D9): sky band drops before hop when both would exceed budget", () => {
  // construct a fixture with hop active near HOP_BUDGET and weather fields present;
  // assert the sky band is absent rather than the hop reservation
});
```

- [~] **Step 3 — verify failure.** **Honest process note — this task
  deviated from strict red-green TDD, unlike Tasks 1 and 2.** Step 1's
  DECISION GATE could only be resolved by probing a REAL working shell
  implementation (the whole point was verifying real bash behavior), so the
  jq/decode/prepend/budget code (Step 4) was necessarily written
  concurrently with Step 1's investigation, before Step 2's tests existed.
  The tests were then written and run directly against the ALREADY-modified
  shell and went straight to green — they were never observed failing
  against the pre-implementation script. Mitigated by: (a) the Step 1 probe
  itself already exercised the real behavior these tests assert on, with
  manual byte-exact verification; (b) `bash -n` DID genuinely fail twice
  mid-implementation (the two apostrophe bugs) and was fixed before
  proceeding, so the change wasn't unverified end-to-end; (c) the full test
  suite (1064, including every pre-existing test) stayed green throughout.

- [x] **Step 4 — implement**, per Step 1's chosen branch. Add jq extraction
  mirroring the wander-gate condition (D10 — **not** the ground row's
  gate):

```
| (if $gf == "full" and $celeb_fresh != 1 and $combat_on != 1
   then (.weatherFallFrames // []) else [] end) as $wf
| (if $gf == "full" and $celeb_fresh != 1 and $combat_on != 1
   then (.weatherFallSequence // []) else [] end) as $wfseq
| (if ($wfseq | length) > 0
   then ($wf[$wfseq[$now % ($wfseq | length)]] // "") else "" end) as $wfframe
```

  Append `($wfframe | @base64)` to the joined array alongside `$frame`'s own
  base64 field; add `_WF_B64` to the `IFS=$'\x1f' read`. Decode it right
  where `FRAME_BODY` is decoded (`buddy-status.sh:229`), split it into its
  own array the same way `ART_LINES` is built (`:252-255`), and prepend
  those lines onto `ART_LINES` **before** `ART_COUNT`/the hop-headroom math
  runs, so every downstream computation sees one taller array with no
  special-casing (§2.3's insertion-point analysis; §4 Task 2's shared
  `HOP_BUDGET`-style degrade check per D9 goes here too — compute the
  combined height *before* committing to the prepend, and skip it if over
  budget, mirroring `buddy-status.sh:1030-1033`'s existing collapse
  pattern).

  **Deviations from this sketch, all resolved and documented in Step 1
  above:** (1) the actual insertion point is `ALL_LINES`/`ALL_COLORS`
  *after* the coloring loop, not raw `ART_LINES` before it; (2) `HOP_BUDGET`
  was hoisted to a top-level constant (was previously scoped inside the hop
  `if`-block) so the band's own degrade check could reuse the exact same
  number rather than inventing a second one; (3) the band-budget check runs
  strictly AFTER hop's own collapse decision finishes (not "before
  committing to the prepend" in the sense of racing hop's own logic) — it
  reuses hop's ALREADY-FINALIZED `HOP_RESERVE`, which is what makes "band
  degrades before hop" (D9) actually true rather than accidentally backward.

- [x] **Step 5:** targeted PASS (7/7); full `bun test` → **1064 pass** (1057
  baseline + 7 new); `bunx tsc --noEmit` clean; `bash -n
  statusline/buddy-status.sh` clean. The living-ground/ground-weather
  regression suite (9 tests) stayed green unstubbed. The sketch's original
  "byte-identical no-weather-fields" test was replaced with a real absence
  check (Step 2's implementation note) rather than confirmed as-written,
  since the as-written version was a tautology.

- [ ] **Step 6:** Commit: `feat(living-world): shell prepends the falling-weather sky band above the sprite` (+ trailer).
  **Not done** — left uncommitted pending the user's go-ahead, same as
  Tasks 1-2's commit steps.

---

### Task 4: e2e + docs

**Files:** `docs/game-feel/CURRENT-STATE.md` (new dated section), this doc's
own status header (design → implemented, once shipped).

> ## ⚠️ CRITICAL SAFETY WARNING — read before ANY manual e2e in this task
>
> Carried verbatim from `plan-ground-weather.md` Task 4, because the incident
> it documents (an implementer subagent corrupting the user's real, live
> `~/.claude-buddy` profile by writing `CLAUDE_CONFIG_DIR="$CFG"` **after** a
> command instead of prefixed) is a standing risk for every e2e-touching task
> in every plan in this repo, not a one-off:
>
> - **ALWAYS prefix** the env assignment: `CLAUDE_CONFIG_DIR="$CFG" bun run
>   server/award-xp.ts ...` — the assignment MUST come *before* the command
>   word, never after it.
> - **Set and export `CLAUDE_CONFIG_DIR` to a fresh `mktemp -d` first**, and
>   **verify it points at the temp dir** (`echo "$CLAUDE_CONFIG_DIR"`) before
>   running anything that writes.
> - **Never** run a state-writing command without confirming the temp
>   `CLAUDE_CONFIG_DIR` is in effect for *that exact command*.
> - Read-only renders against real state are fine; **writes are not.**

- [ ] **Step 1 — manual e2e** (temp `CLAUDE_CONFIG_DIR`, warning in force).
  Hand-build `status.json` fixtures (the schedule can't be directly injected
  from the CLI, same limitation `plan-ground-weather.md` Task 4 hit — reuse
  the stub-loader idiom or hand-write the fields) at `gameFeel=full`,
  `groundEnabled=true`, with `weatherFallFrames`/`weatherFallSequence`
  present, and render several successive ticks through the real shell.
  Confirm: (a) the band visibly changes row-to-row across ticks (not a
  static repeat); (b) the sprite's own rows are pixel-for-pixel unaffected
  (no clobbered gear/hat); (c) no falling-weather fields ⇒ byte-identical to
  today's plain idle render; (d) an active combat scene and a fresh
  celebration/flourish both fully suppress the band; (e) `groundEnabled:
  false` never shows it regardless of schedule; (f) the total block height
  never exceeds the intended budget, and when forced near the hop cap, the
  sky band — not the hop reservation — is the one that degrades (D9). STOP/
  BLOCKED on any failure. Delete the temp dir after.

- [ ] **Step 2 — full validation sweep:** `bun test && bunx tsc --noEmit &&
  bash -n statusline/buddy-status.sh` — all green; record the exact new
  total (baseline 1044 + this plan's additions).

- [ ] **Step 3 — docs.** `CURRENT-STATE.md` gets a new dated section
  covering: what (a small sky band above the sprite depicting genuine
  falling motion during the same weather window the ground row already
  schedules), why (D1–D11 resolved decisions, esp. D1's layer-not-replace
  call and D6's embedded-SGR simplification vs. ground-weather's shell
  substitution), mechanism (reused schedule, baked per-tick band flipbook,
  the one real shell prepend change), and the honest cadence framing from
  §2.2 (stop-motion drift at the ~1s platform floor, not smooth animation).
  This doc's own header flips from "planning only" to "implemented" once
  shipped.

- [ ] **Step 4:** Commit: `docs(living-world): falling weather shipped` (+ trailer).

---

## 5. Deferred / explicitly out of scope

- **Flakes falling through the sprite's own art/gear/hat/props.** Evaluated
  and rejected for phase 1 (§2.4) — real collision risk against a discipline
  that already needed two fix rounds elsewhere in this codebase
  (`CURRENT-STATE.md`'s step-kick saga), and real combinatorial baking cost.
  Could be revisited later, but only with its own dedicated per-species
  blank-cell probe (learning the step-kick saga's lesson: aggregate probes
  aren't safe, per-species ones are) and only after phase 1's simpler sky
  band has shipped and been observed in real use.
  Note: the sky-band frames from this plan are **width-matched to the idle
  sprite's own frame width** (Task 0), which is a deliberate design choice to
  keep them visually aligned with the buddy below — this is distinct from
  (and should not be confused with) letting flakes actually drift *across*
  into the buddy's own cells.
- **A sub-second, genuinely smooth fall.** Blocked by the measured platform
  floor (§2.2) — `design.md`'s P0 finding is FAIL-permanently, and
  `CURRENT-STATE.md` records the one sanctioned sub-second-tick change as
  dropped, not deferred. Falling weather ships at the same ~1s stop-motion
  cadence every other baked motion in this codebase already accepts.
- **Falling motion during combat, a fresh celebration/flourish, or `subtle`/
  `off`.** All suppressed per D10 — no attempt to make weather "peek through"
  those states.
- **Wind/drift (horizontal motion while falling), accumulation feedback
  (the sky band influencing how dense the ground specks are), or a
  visually-linked "landing" moment where a falling flake becomes a ground
  speck.** All narratively appealing follow-ups, none in scope — D1's
  "layer, don't couple" decision deliberately keeps the two effects
  independent (same schedule, no shared state beyond that).
- **A second, independent weather schedule** for the sky band alone (e.g. so
  it could run more/less often than the ground effect). Rejected by D2 —
  one schedule, always in sync, per the same "no possibility of
  disagreement" reasoning `design-ground-weather.md` itself values.
- **Species-specific band width/positioning** (e.g. a wider band for a
  wider-than-average sprite). Task 0's width probe **did** find real
  per-species variance (6-12 cells, 3/19 species ragged within one frame —
  see Task 0) — confirming, not just anticipating, that phase 1 correctly
  uses one shared width (`SKY_FALL_WIDTH=14`, matching `ART_W`, not the
  "narrowest common" fallback originally floated here) rather than branching
  per species. That branching remains exactly the kind of complexity §2.4
  already argued against taking on for a first cut.

## 6. Remaining unknowns for implementation

- ~~The Task 0 width probe's actual result~~ **RESOLVED 2026-07-24** — real
  idle-frame content measures 6-12 display cells, not a single number;
  `SKY_FALL_WIDTH=14` reuses the shell's existing `ART_W` layout-budget
  constant rather than any content-derived value. See Task 0.
- **Task 1's exact glyph choice** (`❄` is a candidate, not committed) —
  subject to the `displayWidth`/`MIRROR_SWAP` probe the same way every prior
  glyph table in this codebase was chosen; dingbat/emoji-range codepoints
  are exactly the range `art.ts`'s own width table treats specially, so this
  needs real verification, not assumption.
- **Task 1's exact `FLAKE_COUNT`/`FALL_PERIOD`/`SKY_BAND_ROWS` constants** —
  placeholder numbers only (§3 D3/D7/D9's "recommend" language), to be tuned
  during implementation the same way `plan-ground-weather.md` treated its
  own odds/duration constants as tunable-not-final.
- ~~Task 3's Step 1 DECISION GATE outcome~~ **RESOLVED 2026-07-24** — Branch
  A confirmed via a real probe (byte-exact, no corruption), with one
  refinement: prepend into `ALL_LINES`/`ALL_COLORS` after the coloring loop
  (empty wrapper color) rather than raw `ART_LINES` before it — avoids
  wasting escapes on the rarity/shiny wrap and avoids offsetting a SHINY
  buddy's rainbow-cycle phase. See Task 3 Step 1.
- ~~D9's exact combined-budget number~~ **RESOLVED 2026-07-24** — reuses
  `HOP_BUDGET=12` directly (no extra headroom), hoisted to a top-level
  constant. Working the arithmetic showed any larger number makes the
  degrade check nearly unreachable in realistic stacks (hop's own collapse
  logic already guarantees `ART_COUNT+HOP_RESERVE<=12` whenever hop keeps
  its reservation). Verified end-to-end: a 3-row band fits alongside a
  2-row hop reservation on a 6-row sprite+name stack; a 6-row band doesn't,
  and correctly degrades the band while leaving hop's reservation fully
  intact. See Task 3 Step 1.
- **Whether the sky band should also suppress during `wanderHop`'s own
  active bob**, or stack on top of it. D9 assumes stacking (both reserve
  independently, weather degrades first under budget pressure) but this
  hasn't been rendered and eyeballed yet — worth a specific look during
  Task 4's e2e pass.
