# Falling weather during combat — design (living-world follow-up)

_Drafted 2026-07-24 · branch `feature/interactive-fight-scene`_
_Status: **implemented (2026-07-24).** See
[CURRENT-STATE.md](../CURRENT-STATE.md#falling-weather-during-combat-2026-07-24)
for the shipped snapshot (all 3 tasks, 1068 tests pass). Depended on
[plan-falling-weather.md](plan-falling-weather.md) (shipped, all 4 tasks,
1064 tests) and [design-ground-weather.md](design-ground-weather.md)/
[plan-ground-weather.md](plan-ground-weather.md) (shipped, 1044 tests) —
this doc extends both without re-deriving their schedule mechanism._

**Goal:** the user watched a live bug fight while falling snow/rain was
(correctly, per the current gating) invisible the entire time. Make the
falling-weather sky band — and, as a bundled companion decision, the ground
row's weather specks — render *during* an active combat scene, not just idle.

---

## 1. Recap — what's suppressing weather during combat today

Every weather-related field the shell reads is re-gated against `$combat_on`
in the single `jq` pass (`statusline/buddy-status.sh:88-229`):

| Field | Gate today | Line(s) |
| --- | --- | --- |
| `$ground` / `$gcolor` (terrain strip) | `$gf=="full" and $combat_on!=1` | `buddy-status.sh:172-173` |
| `$gwglyph` / `$gwcolor` (ground weather specks) | `$gf=="full" and $combat_on!=1` | `buddy-status.sh:177-178` |
| `$wf` / `$wfseq` → `$wfframe` (sky band) | `$gf=="full" and $celeb_fresh!=1 and $combat_on!=1` | `buddy-status.sh:190-193` |

`$combat_on` is 1 whenever the server baked a non-empty `combatFrames` array
into `status.json` for *this* write (`buddy-status.sh:122-124`) — true for
all three combat producers in `server/state.ts:1068-1200`: a resolved fight
(`readEncounter`), the persistent pre-fight standoff (`readPendingEncounter`,
`combatSticky`), and the wild-visitor greet cameo (`readVisitor`). All three
share one `combatFrames`/`combatSequence`/`artWidth` triple
(`state.ts:1064-1066`), so whatever we design against "combat" covers all
three producers automatically, with no per-producer branching.

**Confirmed: this is a pure gating problem, not a structural one.** The
sky-band prepend mechanism (`buddy-status.sh:1083-1102`) operates generically
on `ALL_LINES`/`ALL_COLORS` — whatever frame source jq selected into
`FRAME_BODY` (idle `.frames`, `.flourishFrames`, or `.combatFrames` — the
priority ladder at `buddy-status.sh:128-133`), the band prepend code neither
knows nor cares which one it is. Today `WF_LINES` is simply always empty
during combat because jq zeroes `$wfframe` before the shell ever sees it
(§ table above) — the shell-side mechanism was never combat-aware and never
needed to be aware of it, since the gate did all the suppressing upstream.

---

## 2. Real combat-scene layout, verified empirically (not guessed)

### 2.1 Width

`server/combat.ts`'s `composePose` (lines 294-335) lays out every combat
frame as `player + SCENE_GAP(4) + mirroredEnemy`, bottom-aligned
(`alignHeights`, lines 164-173). `server/state.ts`'s `sceneWidth` helper
(`state.ts:1073-1080`) takes the max `displayWidth` across every line of
every baked frame and writes it as `artWidth` (`state.ts:1129,1166,1191`).

I ran `bakePendingScene` for all 21 species × 21 species = **441 pairs**
(seed 42, tier 1) and measured `displayWidth` across every frame/line:

- **Min width: 22** (only pairs involving `wyvern`, whose narrowest
  own-line width is 6-9 per Task 0 of `plan-falling-weather.md`).
- **Max width: 28** (every other species pair — 12 + 4 + 12).
- **Every single-species diagonal** (both fighters the same species) is 28,
  except wyvern-vs-wyvern at 22.

**This is always wider than `SKY_FALL_WIDTH=14`** (`server/weatherfall.ts:51`,
the constant `buildFallingWeatherBand` is baked at today for idle). A
14-wide band prepended above a 22-28-wide combat tableau would print only
its own 14 characters per row (real content is never padded — confirmed by
`plan-falling-weather.md` Task 0: `art_part` is the rightmost thing on each
printed line, nothing pads a short line to a wider one) — visually reading
as snow falling only over roughly the left half of the screen (over the
player, never reaching the enemy), not over the whole fight. This is the
concrete evidence behind Decision D3 below.

(Corroborating fact already in the shell: `buddy-status.sh:665-667`
widens `ART_W` to `$ART_WIDTH` specifically *because* combat scenes are
routinely wider than the idle default of 14 — that code wouldn't exist if
`artWidth` were usually ≤ 14.)

### 2.2 Height

Measuring line-count across the same 441×frames sweep (post-`trimBlankTopRows`,
`combat.ts:379,631`): **min 4 rows, max 6 rows** for the bare two-sprite
tableau. On top of that, `state.ts`'s `captionFrames` (lines 1096-1114)
unconditionally unshifts one caption row ("Bug fight in `<project>`!" or an
override), and the render loop always appends one `NAME_LINE`
(`buddy-status.sh:623`), optionally a `TITLE_LINE` (`:628-634`) and a
`BADGE_LINE` (`:641-658`). So real `ART_COUNT` during combat ranges:

```
bare tableau (4-6) + caption (1) + name (1) [+ title (1)] [+ badge (1)]
= 6-10 rows, typically 6-8 (title/badge are both opt-in and often absent)
```

This is the concrete input to the row-budget analysis in §3 D5.

---

## 3. Resolved decisions

| # | Question | Decision |
| --- | --- | --- |
| **D1** | Should combat suppress the sky band at all? | **No — relax the gate.** Drop `and $combat_on != 1` from the sky-band extraction (`buddy-status.sh:190-193`), keeping only `$gf=="full" and $celeb_fresh!=1`. Combat becomes a third context (alongside plain idle and the pending standoff) the band can render over — mirroring how the band already renders identically over all three `combatFrames` producers today via the shared field, with zero new branching needed. |
| **D2** | Should the ground row (terrain strip + its weather specks) also stop being suppressed by combat? | **Yes — relax the same way.** Drop `combat_on != 1` from `buddy-status.sh:172,173,177,178`. Reasoning: (a) coherence — `design-ground-weather.md` D1 established "falling snow above a floor with matching landed specks is one coherent picture, not a redundant one"; suppressing the ground's specks while showing the sky band would break exactly that coherence the moment a fight starts. (b) zero layout risk — the ground row prints once, full terminal width, *after* the entire per-line art/bubble/stats loop (`buddy-status.sh:1227-1237`, outside `ART_COUNT`/`HOP_BUDGET` entirely), so it cannot collide with or budget-compete against the (wider, taller) combat tableau the way the sky band does. This is a smaller, safer change than D1, bundled in because it shares the exact same `combat_on` gate mechanism the user's report points at. |
| **D3** | What width does the band bake at during combat? | **`artWidth` (the combat scene's own server-emitted width) when a combat scene is active this write; `SKY_FALL_WIDTH=14` otherwise.** §2.1's probe (22-28 across all 441 pairs) confirms a fixed-14 band would visually truncate over just the player. Both `combatFrames` and `artWidth` are *already* computed as local `let` variables earlier in the same `writeStatusState` function (`state.ts:1064-1066`, populated by 1129/1166/1191) — the weather-bake call later in the same function (`state.ts:1573-1578`) can reference them directly with **zero reordering, zero new module, zero new schedule read**: `buildFallingWeatherBand` is already parameterized on `width` (`weatherfall.ts:82-89`), so this is a one-line ternary, not new baking machinery. |
| **D4** | Row count / flake density during combat? | **Reuse `SKY_BAND_ROWS=3` and `FLAKE_COUNT=4` unchanged, no width-based scaling.** A wider band (22-28 vs. 14) with the same 4 flakes reads sparser per unit area, but per `design-ground-weather.md`'s own explicit framing ("ambient decoration, not simulation"), this is an acceptable, deliberately-not-engineered tradeoff — adding a density-scaling formula would be new complexity for a cosmetic difference nobody has actually observed and complained about yet. Revisit only if it reads badly in the Task 4 e2e pass. |
| **D5** | Row-budget interaction with `HOP_BUDGET=12`? | **No shell change needed — already correct by construction.** The degrade check (`buddy-status.sh:1083-1102`) reuses `ART_COUNT` generically, whatever produced `ALL_LINES` (idle or combat). Since wander/hop is already zeroed during combat (jq zeroes `wanderRowSequence`-derived fields whenever `$combat_on==1`, `buddy-status.sh:146-156`), `HOP_RESERVE` is always 0 during combat, so the check collapses to `ART_COUNT + 3 <= 12` ⇔ `ART_COUNT <= 9`. Per §2.2's measured range (6-10, typically 6-8), the band shows in the common case and gracefully degrades away only in the rare worst case (a 6-row tableau + caption + title + badge all present at once = 10). This is the exact same degrade-before-hop priority D9 (`plan-falling-weather.md`) already defined — combat just exercises it for the first time, with no new number, no new branch. |
| **D6** | Does the weather schedule itself need to change (reroll/pause on combat start/stop)? | **No — confirmed unchanged.** `pickSessionWeather`/`isWeatherActive` (`ground.ts`) derive purely from the session's `startedAt`, computed inside the ground/weather block (`state.ts:1533-1584`), which is gated (`idleGate==="full" && cfg.groundEnabled`) entirely independently of the combat block's own gate (`gate !== "off"`, `state.ts:1068`). Both blocks already run unconditionally whenever their own gate holds — `weatherFallFrames`/`ground`/`groundWeatherGlyph` are written into `status.json` **today**, even while a fight is active; only the shell throws them away. Combat starting/stopping mid-weather-window therefore already has zero effect on *whether* weather is scheduled, confirming the premise D1/D2 assumed — this doc changes DISPLAY only. |
| **D7** | Legibility — does falling weather over/through a fight scene read as noise? | **Reads as atmosphere, not noise, because the band never shares a row with the fight.** The band occupies a strictly separate, higher block of `ALL_LINES` indices than anything `composePose`/`bakeScene` writes to (prepended, not merged — same "own dedicated rows above the sprite" contract as idle, `plan-falling-weather.md` §2.4/D3). One observed side effect: the caption line (`state.ts` `captionFrames`, unshifted into row 0 of the combat frame itself) ends up sandwiched directly between the sky band and the fight tableau — i.e. `[sky band rows][caption][fight rows][name]`. This is more vertical stacking than idle's `[sky band][sprite][name]`, but it's adjacency, not collision; accepted as-is, not polished further in scope. |
| **D8** | Species/enemy-glyph collision risk? | **None, by construction.** The band composites via array prepend (`ALL_LINES=("${WF_LINES[@]}" "${ALL_LINES[@]}")`, `buddy-status.sh:1096`), never touching a combat sprite's own cells the way `applyGear`/`applyPropKicked` composite onto *verified-blank* cells elsewhere. This is a structurally different (safer) code path than gear overlay — the same reasoning `plan-falling-weather.md` §2.4 used to reject "falling through the sprite" for idle applies unchanged here, because the mechanism is identical; only the gate moved. |

---

## 4. What does *not* change

- `server/weatherfall.ts` — **zero changes.** `buildFallingWeatherBand` is
  already generically parameterized on `width`/`rows`/`period`; combat just
  calls it with a different `width` argument.
- `server/ground.ts` — **zero changes.** `pickSessionWeather`/
  `isWeatherActive`/`buildWeatherTile` are untouched (D6).
- The sky-band prepend/degrade mechanism (`buddy-status.sh:1083-1102`) —
  **zero changes.** It already operates generically on whatever `ART_COUNT`/
  `ALL_LINES` currently hold.
- `HOP_BUDGET=12` — **unchanged, no second/larger number for combat**,
  mirroring `plan-falling-weather.md`'s own D9 finding that a separate,
  larger ceiling for a second reservation defeats the point of having one.

The real surface area of this change is: one ternary in `state.ts` (D3), and
four `jq` gate edits in `buddy-status.sh` dropping `combat_on != 1` clauses
(D1, D2).

---

## 5. Task-by-task implementation plan

> For agentic workers: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. `- [ ]` checkboxes for tracking.

**Read first:** this doc in full; `server/combat.ts`'s `composePose`/
`bakeScene`/`bakePendingScene` (already read for this doc — no new
per-species branching needed, §2); `server/state.ts:1064-1200` (combat
block) and `:1518-1584` (ground/weather block) — note `combatFrames`/
`artWidth` are `let`-scoped at the top of `writeStatusState` and already
populated by the time the weather block runs, so no reordering is required;
`statusline/buddy-status.sh:88-229` (jq gates) and `:1050-1102` (HOP_BUDGET/
sky-band prepend, unmodified by this plan).

### Task 1: `server/state.ts` — width-aware band bake (D3)

**Files:** Modify `server/state.ts`. Test: extend
`server/state_wander.test.ts`'s existing ground-weather describe block
(same `stubGroundWeather` idiom `plan-falling-weather.md` Task 2 used).

- [ ] Failing tests: combat active (stub `readEncounter`/`readPendingEncounter`
  to return a fixture) + weather active (stub schedule) + `groundEnabled`
  ⇒ `weatherFallFrames`' lines measure `displayWidth === artWidth`, not 14.
  Idle-only (no combat) + weather active ⇒ unchanged, lines measure 14
  (regression pin against the shipped behavior).
- [ ] Verify failure (current code always passes `SKY_FALL_WIDTH`).
- [ ] Implement: in the existing bake call (`state.ts:1573-1578`), swap the
  literal `SKY_FALL_WIDTH` argument for a small ternary:
  ```ts
  const bandWidth =
    combatFrames !== undefined && typeof artWidth === "number" && artWidth > 0
      ? artWidth
      : SKY_FALL_WIDTH;
  weatherFallFrames = buildFallingWeatherBand(
    schedule!.kind, startedAt, bandWidth, SKY_BAND_ROWS, FALL_PERIOD,
  );
  ```
  Add a one-line comment citing this doc's D3 and the 22-28 measured range
  so a future reader doesn't mistake the ternary for dead code.
- [ ] Full `bun test` + `bunx tsc --noEmit` clean.
- [ ] Commit (pending user go-ahead, per this repo's convention).

### Task 2: `statusline/buddy-status.sh` — relax the four gates (D1, D2)

**Files:** Modify `statusline/buddy-status.sh`. Test: extend
`server/statusline_render.test.ts`.

- [ ] Failing tests: a fixture with `combatFrames` + `weatherFallFrames`/
  `weatherFallSequence` present, `combatSticky` or a fresh `encounterAt` ⇒
  the sky band renders above the combat scene (assert a flake glyph appears
  in the output). Same fixture with `ground`/`groundColor`/
  `groundWeatherGlyph`/`groundWeatherColor` present ⇒ the ground row also
  renders (currently these tests would need to assert it does NOT — invert
  them to assert it DOES). A `$celeb_fresh` fixture (flourish) still
  suppresses the sky band even with combat/weather fields present (D1 only
  drops the combat clause, not the celebration one).
- [ ] Verify failure against the unmodified script.
- [ ] Implement: drop `and $combat_on != 1` from
  `buddy-status.sh:172,173,177,178,190,192` (5 edits — note line 191 has no
  `combat_on` clause of its own, it's the `then`/`else` continuation of 190's
  `if`, so only 190/192's conditions need editing, not a 6th line). Update
  the comments immediately above each edited line (they currently explain
  the old combat-suppression rationale — e.g. `:167-171`'s "the combat
  tableau owns the whole art column" framing needs to change to point at
  this doc's D1/D2 instead).
- [ ] `bash -n statusline/buddy-status.sh` clean; targeted tests pass; full
  `bun test` green.
- [ ] Manually verify the width math end-to-end with a real decoded
  band + a real decoded combat `FRAME_BODY` (mirroring
  `plan-falling-weather.md` Task 3 Step 1's probe discipline) — confirm the
  band's rows, now baked at `artWidth`, line up flush with the combat rows'
  own width (no ragged left edge), and that `HOP_BUDGET`'s existing degrade
  check (unmodified) correctly drops the band on a constructed
  6-row-tableau + caption + title + badge fixture (`ART_COUNT=10 > 9`,
  §3 D5) while leaving the combat tableau itself fully intact.
- [ ] Commit (pending user go-ahead).

### Task 3: e2e + docs

> ## ⚠️ Same `CLAUDE_CONFIG_DIR` safety warning as every prior task in this
> arc (`plan-ground-weather.md`/`plan-falling-weather.md` Task 4): prefix
> the env var before the command word, verify it points at a fresh
> `mktemp -d` before any write, never run a state-writing command without
> confirming the temp dir is in effect for *that exact command*.

- [ ] Manual e2e (temp `CLAUDE_CONFIG_DIR`): hand-build/force a pending
  standoff or resolved fight (`BUDDY_FORCE_WEATHER=snow|rain` already exists,
  `state.ts:1552`, for forcing the weather half) and render several
  successive ticks through the real shell. Confirm: (a) the band visibly
  falls above the fight tableau at the fight's own width, not truncated;
  (b) the ground row + its specks also show beneath the fight; (c) a fresh
  flourish/celebration still suppresses both; (d) `groundEnabled: false`
  still shows neither regardless of combat/schedule; (e) the tall-stack
  case (caption+title+badge) degrades the band, not the fight tableau.
- [ ] `bun test && bunx tsc --noEmit && bash -n statusline/buddy-status.sh` —
  full green, record the new total.
- [ ] `CURRENT-STATE.md` new dated section: what (weather now visible during
  combat), why (D1/D2's bundled-gate reasoning, D3's measured-width fix),
  mechanism (one ternary + four dropped jq clauses), honest tradeoffs (D4's
  no-density-scaling, D7's caption adjacency).
- [ ] This doc's own header flips to "implemented" once shipped.
- [ ] Commit (pending user go-ahead).

---

## 6. Deferred / explicitly out of scope

- **Flake density scaling with `artWidth`.** Rejected (D4) — cosmetic-only,
  adds a tunable for a difference nobody has observed complaining about yet.
- **A combat-specific `SKY_BAND_ROWS`/`FALL_PERIOD`.** Not warranted — §2.2's
  measured heights leave enough headroom in the common case without a
  smaller band, and a second set of constants would duplicate `plan-falling-
  weather.md`'s own already-resolved D9/D7 numbers for no observed benefit.
- **Polishing the caption/band adjacency (D7)'s extra vertical stacking.**
  Noted, accepted, not addressed — would require either shrinking the
  caption's own row contribution or re-deriving where in the stack the band
  visually "belongs" relative to a caption, neither of which this doc's
  scope (make it show up) requires solving.
- **A separate, larger `HOP_BUDGET` for combat.** Rejected for the same
  reason `plan-falling-weather.md` D9 rejected it for idle — a larger
  ceiling makes the degrade check nearly unreachable, defeating its purpose.
- **Wind/drift, accumulation feedback, or a visually-linked "landing"
  moment during combat specifically.** Same out-of-scope items
  `plan-falling-weather.md` §5 already deferred for idle; nothing about
  combat changes that calculus.
