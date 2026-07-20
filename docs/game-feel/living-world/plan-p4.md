# Living-World Arc — P4 Implementation Plan (World Dressing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the arc's final phase P4 — **ground props** that travel with the buddy inside existing frames, **prop interaction** (step-kick + a loot-dash inspect beat), **time/season flavor** sampled at bake time, and **weather FX** as a sparse overlay — per `design.md` §P4, on the P0-P2 primitives.

**Architecture:** Zero-rows shapes this hard — there is *no scenery layer*. Props are extra glyphs composited into the **idle** flipbook through the exact `applyGear` blank-cells-only / ANSI-refused contract (`renderSpeciesFrame` → `applyGear`, art.ts), so they never flicker or clobber body pixels and never compete in the render priority ladder (idle frames and combat/pending/visitor scenes are *separate baked channels* — the shell shows one or the other, so a prop simply isn't drawn while a scene is up). Which prop + which palette is chosen by a **pure seeded core** from an injected date (day-seed via `hashString`+`mulberry32`, the established seam), so the same day renders the same sprout with zero new persisted state. Weather is the `overlayRow` mechanism the idle emote row already uses, driven by the error/clean streak signal that already exists. Every new flipbook is constant-width AND -height and reads at 1 fps.

**Tech Stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), bash statusline untouched (`bash -n` still verified). **Zero `buddy-status.sh` changes in this phase** (the arc's one sanctioned shell change was P0's, and P0's gate FAILED — see `design.md` §P0 findings — so the shell is frozen for the rest of the arc).

**Read first:** `design.md` §P4 + §Standing constraints (all 8 apply, none new) + §Resolved decisions (D4 zero-rows, D9 "reads bigger without new rows" precedent, D11 priority ladder); `CURRENT-STATE.md` (the idle-line / emote-row / gear-on-sprite sections); `plan-p2.md` (structural sibling); `plan-p0-p1.md` — **the "House rules that override the usual plan template" block applies here verbatim: ask-once commits, the live-classifier warning, and the per-task validation cadence** (`bun test` full suite, `bunx tsc --noEmit`, and `bash -n statusline/buddy-status.sh` when the shell was touched — it never is this phase, but run it anyway as a tripwire).

**Baseline:** **927 tests pass at `0ce8870`**, `tsc --noEmit` clean, `bash -n statusline/buddy-status.sh` clean. 1 fps is the validated platform floor (P0 findings) — every new flipbook must read at 1 fps.

**No P3 dependency:** `server/expedition.ts` does **not** exist yet (P3 is unimplemented). P4's design bullet references no expedition machinery; the only P1/P3-shared primitive nearby is the **walk-on** stinger, which P4 does not touch. Confirmed no task below assumes P3 landed first. If any step here seems to want an expedition, stop — it has drifted out of P4 scope.

---

## Recon facts the tasks below rely on (verified 2026-07-20 against `0ce8870`)

- **`applyGear` contract** (art.ts:261-270) delegates each glyph to **`overlayGlyph`** (art.ts:242-258): it pads the target line rightward if the anchor sits past its end, then **skips the whole overlay (frame left intact) if the target line contains `\x1b`** (ANSI refused — the wyvern-fire / "wyvern rule") **or if any target cell is non-blank** (`cells[col+i] !== " "` ⇒ return). Only then does it `splice` the glyph in. This is exactly the "blank-cells-only, ANSI-refused" contract P4 props must ride. `applyGear` runs inside **`renderSpeciesFrame`** (art.ts:574) *after* `applyHat` (art.ts:573), so it is on every idle / emotion / gait / flourish frame's render path already.
- **`GEAR_ANCHORS`** (art.ts:210-234) is `Record<Species, { weapon: [number, number]; trinket: [number, number] }>` covering **all 20 species**, but exposes **only two anchor slots** — `weapon` at hand height, `trinket` at **`[4, 0]`** (feet, row 4 col 0) for every species. **There is no "prop ahead of the buddy" or "sprout by the feet" anchor**, and the feet slot is already the trinket's. So P4 needs a *new* anchor point (Task 1 GATE decides: extend the `GEAR_ANCHORS` record with a `prop` field, or a parallel `PROP_ANCHORS` table).
- **The `GEAR_ANCHORS` blank-cell test pattern** the design's §P4 testing bullet names lives at art.test.ts:495-517 ("every species' anchors are clear in all three idle frames" + "the P7 stretch frame's anchors are also clear (duck/cat/robot)") plus art.test.ts:528+ ("overlays only ever fill blank cells — body pixels are never clobbered"). It iterates `SPECIES × frames`, composites, and asserts `.toContain(glyph)`. P4 extends this identical shape to the new prop anchor across **frames 0-2, the P7 stretch frame 3 (duck/cat/robot), and the appended gait lean/peek postures** (`getStatusFrames` gaitVariants, art.ts:594+).
- **`overlayRow`** (art.ts:422-433): `(text: string | null, spanStart: number, spanW: number, totalW: number) => string`. Span-addressed, returns a row exactly `totalW` display cells wide; `null` text ⇒ an all-space row. Genuinely reusable for a sparse weather overlay. It is already the idle FX row's engine via **`finalizeIdleBlock`** (art.ts:701-717), which unshifts **one** FX row carrying `emoteFor(emotion)` (art.ts:537-539, glyphs `♪`/`!`/`zZz`/`?`) above the sprite and reclaims dead top rows through **`trimSharedBlankTopRows`** (art.ts:469+).
- **Day-seeding:** `hashString` (engine.ts:243) + `mulberry32` (engine.ts:252) are the repo's seed seam; the established idiom is `mulberry32(hashString("<prefix>:...:<key>"))` (session.ts:433, 657; visitor at session.ts:772: `hashString("visitor:${resolveUserId()}:${startedAt}")`). **No date-seeded RNG exists yet**, but building one is a one-liner over these. `getTimeOfDayMood` (mood.ts:55-63) buckets `new Date().getHours()` into moods — a time-of-day-bucket **precedent**, but it **reads the clock directly** (not injected), so it is *not* a pure core and cannot be reused as-is under constraint 2; P4's core must take an injected `Date`/hour.
- **A "season" concept already exists** as **`activeSeasonal` / `SEASONAL`** (art.ts:805-832): a tiny date-**window** calendar (`{from:[m,d], to:[m,d], label}`) resolved by an **injected `Date`** (`activeSeasonal(now = new Date())`), pure, wrap-around-aware. It is **holiday-window** seasoning (winter/new-year), **not** meteorological four-seasons. Task 2 GATE decides: reuse this window pattern for prop flavor vs. add a month→season mapping.
- **`MIRROR_SWAP`** (art.ts:365-376): only `() <> [] {} / \` swap; everything else (incl. `♛`, per the `applyBossCrown` note at art.ts:184-186) passes through `mirrorFrame` unchanged. **The idle buddy is never mirrored** — `mirrorFrame` is applied only to the *enemy* sprite in combat/visitor bakes (combat.ts), and props live on the idle line. So idle prop glyphs never reach `MIRROR_SWAP`. Weather glyphs likewise ride the idle overlay row. Design still asks for the check; treat it as a cheap assertion (pick symmetric glyphs; assert absence from `MIRROR_SWAP`) rather than a blocker.
- **The loot-dash stinger** (wander.ts:218-235) `lootdash` branch is `for p 1..r; out.push(r,r,r) /* inspect pause */; for p r-1..0` — a **pure horizontal-offset arc** (position only). `spliceStingerArc` (wander.ts:243+) writes it into **`wanderSequence`** (position); the splice at state.ts:1303 happens *after* the gait `frameSequence` remap and touches **only `wanderSequence`**, never `frameSequence`. So the stinger has **no frame channel today** — "an inspect beat over a dropped-item glyph" needs one. Task 5 GATE resolves how (a baked prop cell the buddy is already beside vs. an appended inspect-pose frame index aligned to the pause).
- **Priority ladder / render channels** (state.ts:1078-1147): the combat block is resolved-fight → pending-standoff → visitor, each writing `combatFrames`/`combatSequence`/`artWidth`; the shell shows the scene (`$combat_on`) and freezes idle wander/frames while one is fresh. **Idle frames** are a separate bake (`getStatusFrames`, state.ts:1207) that only render when *no* scene is up. **`CELEB_PRIORITY`** (state.ts:793-802) orders celebration *toasts*, unrelated to props. ⇒ Props/weather ride idle frames and **do not enter the ladder at all** (confirmed the design's reading). No `combatSticky`, no ladder slot.
- **State footprint:** `TRANSIENT_PREFIXES` (state.ts:1451-1467) registers every transient side-channel. P4 introduces **no new persisted file**: prop + palette + season are re-derived identically from the current date at each bake (stale-until-next-event is fine, constraint per design), and weather is derived from the already-persisted error/clean streak signal. So **nothing is added to `TRANSIENT_PREFIXES`** and no idempotency marker is needed — this is the minimal-footprint bias the arc's `[[living-world]]` philosophy wants. (If any task discovers it truly needs persistence, it must use the atomic tmp+rename idiom and register the prefix — but no task below should.)
- **P7 fourth frame:** duck/cat/robot carry a 4th "stretch" art frame (design-sprite-animation-v2 §P7); `getStatusFrames` picks it by raw art-frame count. Any new prop anchor must satisfy the blank-cell contract on that frame too (already a tested invariant — art.test.ts:507).

---

### Task 1: Prop anchor + compositor (the `applyGear` twin)

Land the prop-placement seam first, inert until a caller passes a prop (Task 3). This is the load-bearing contract task — get the blank-cell / ANSI-refused guarantee and the cross-frame anchor verification right and everything downstream is safe.

**Files:** Modify `server/art.ts` (anchor data + `applyProp`), Test `server/art.test.ts`.

- [ ] **Step 1 — DECISION GATE: where does the prop anchor live?**

  Run: `grep -n "GEAR_ANCHORS\|trinket:" server/art.ts | head` and re-read art.ts:210-234 + art.ts:242-270.

  Question: props need at least **two placements** — a **pebble a couple cells *ahead*** of the sprite (a column at/after the body's right edge, kicked forward on step ticks) and a **sprout/mushroom *by the feet*** — but the existing `trinket` anchor already owns `[4, 0]` (feet, far-left). Distinct anchors are required or a sprout and a rubber-duck trinket would fight for one cell.

  - **Branch A — extend `GEAR_ANCHORS`** with a `prop: [number, number]` (and, if the pebble-ahead cell differs from the feet cell, a second `propAhead`) field per species. Cheapest if every species can spare a *distinct* blank cell near the feet/ahead in all frames. Verify blank-availability first with a throwaway probe (Step 2's test *is* that probe — write it before committing to a cell).
  - **Branch B — a parallel `PROP_ANCHORS: Record<Species, {...}>` table** beside `GEAR_ANCHORS`. Pick this if prop cells are conceptually separate from equippable gear (they are: gear is owned, props are ambient) or if reusing the gear record would force awkward optionality. Keeps the two systems independently testable.

  State the branch and the chosen cells in your report. Whichever branch: the cells **must be a distinct blank cell from the `trinket` `[4,0]`** so props + a trinket co-exist (the crowded-sprite worst case, Task 6).

- [ ] **Step 2 — failing test** (art.test.ts, mirror the art.test.ts:495-517 pattern exactly):

```ts
describe("applyProp (ground props — living-world P4)", () => {
  // A glyph that occurs in NO species art, so containment proves it landed.
  const PROP = { feet: "❦", ahead: "•" }; // adapt to the chosen prop glyphs
  test("every species' prop anchors are blank across all idle + stretch frames", () => {
    for (const species of SPECIES) {
      const frameCount = SPECIES_ART[species].length; // 3, or 4 for P7 species
      for (let f = 0; f < frameCount; f++) {
        const art = getArtFrame(species, "°", f);
        applyProp(species, art, PROP);
        const joined = art.join("\n");
        expect(joined).toContain(PROP.feet);
        expect(joined).toContain(PROP.ahead);
      }
    }
  });
  test("prop coexists with a trinket at [4,0] — neither clobbers the other", () => {
    for (const species of SPECIES) {
      const art = getArtFrame(species, "°", 0);
      applyGear(species, art, { trinket: ",>" });
      applyProp(species, art, PROP);
      const joined = art.join("\n");
      expect(joined).toContain(",>");
      expect(joined).toContain(PROP.feet);
    }
  });
  test("refuses ANSI rows and never clobbers body pixels (wyvern rule)", () => {
    // Reuse art.test.ts:528+ "only ever fill blank cells" structure: diff base
    // vs propped per cell; any changed cell that wasn't blank in base fails.
  });
  test("chosen prop glyphs are absent from MIRROR_SWAP (defensive)", () => {
    // idle is never mirrored, but pin it: Object.keys(MIRROR_SWAP) excludes them.
  });
  test("gait lean/peek postures keep the prop anchors blank", () => {
    // getStatusFrames(bones, "neutral", undefined, undefined, true) appends the
    // lean("~")/peek("<") frames; assert the prop anchor cell is blank in each.
  });
});
```

  (Adapt `SPECIES`, `getArtFrame`, `SPECIES_ART` to the real fixture names already imported in art.test.ts. If a candidate cell fails for some species, adjust that species' anchor and re-run — this test IS the anchor-selection loop, same as gear's was.)

- [ ] **Step 2b — verify failure:** `bun test server/art.test.ts` → FAIL (`applyProp` not exported).

- [ ] **Step 3 — implement.** A `PropArt` shape + `applyProp`, structurally a twin of `applyGear` reusing the same private `overlayGlyph` (which already enforces blank-cell + ANSI-refused):

```ts
/** Ambient ground props composited onto a rendered frame (living-world P4).
 *  `ahead` sits a couple cells past the body (kicked forward on step ticks);
 *  `feet` rests by the buddy — a daily-seeded sprout/mushroom. Distinct from
 *  the owned-gear trinket so both can render at once. */
export interface PropArt {
  ahead?: string;
  feet?: string;
}

/** Composite ambient props at the species' prop anchors, under the identical
 *  blank-cells-only / ANSI-refused contract `applyGear` uses (`overlayGlyph`).
 *  A shifted/occupied cell skips the glyph rather than clobbering it. */
export function applyProp(species: Species, art: string[], prop?: PropArt): void {
  if (!prop) return;
  const anchors = /* PROP_ANCHORS[species] or GEAR_ANCHORS[species] per GATE */;
  if (prop.ahead) overlayGlyph(art, anchors.ahead ?? anchors.prop, prop.ahead);
  if (prop.feet) overlayGlyph(art, anchors.feet ?? anchors.prop, prop.feet);
}
```

  Do **not** call `applyProp` from `renderSpeciesFrame` yet — Task 3 wires it, so this task stays inert and render snapshots stay byte-identical.

- [ ] **Step 4:** targeted PASS; full `bun test`; `tsc`; render snapshots byte-identical (no caller yet).
- [ ] **Step 5:** Commit: `feat(living-world): prop compositor + per-species anchors` (+ trailer).

---

### Task 2: Prop selection + palette core (pure, day/time seeded)

The pure heart of the flavor: given an injected date and seed, pick *which* prop (pebble / sprout / mushroom) and *which* palette, deterministically per day. No I/O, no clock reads — a thin wrapper injects the date at the call site (Task 3), exactly like `activeSeasonal`.

**Files:** Create `server/props.ts` (pure core), Test `server/props.test.ts` (new file). *(If a one-file rule is preferred, the core may instead live beside `activeSeasonal` in `art.ts` — state the choice; a new module keeps props independently testable and is the recommendation.)*

- [ ] **Step 1 — DECISION GATE: what is "season"?**

  Run: `grep -n "SEASONAL\|activeSeasonal\|getTimeOfDayMood" server/art.ts server/mood.ts` and re-read art.ts:805-832 + mood.ts:55-63.

  Design.md wants props/palette to "vary by time-of-day and **season**." A date-window "season" concept already exists (`SEASONAL`, holiday windows), and a time-of-day bucketer exists (`getTimeOfDayMood`, but it reads the clock).

  - **Branch A — reuse the `activeSeasonal` window model:** flavor keys off the same `{from,to,label}` windows (e.g. a pumpkin prop in the spooky window, a snowflake in winter), plus an injected-hour time-of-day bucket. Smallest new surface; consistent with the existing seasonal cosmetic; "season" stays a tiny hand-curated calendar (constraint: dated content is a maintenance tail — keep it 2-4 entries).
  - **Branch B — a month→meteorological-season map** (`spring/summer/autumn/winter` from `date.getMonth()`), independent of the holiday windows. Pick this only if the design's "season" is genuinely meteorological rather than holiday-flavored. It is *new* content the codebase has nowhere today.

  Prefer Branch A unless the design reads unambiguously meteorological — it doesn't (it says "time-of-day and season, sampled at bake time," and the only season primitive present is windowed). State the branch in your report.

- [ ] **Step 2 — failing tests** (props.test.ts):

```ts
describe("prop selection (living-world P4)", () => {
  const d = (y: number, m: number, day: number, h = 12) => new Date(y, m, day, h);
  test("same calendar day ⇒ same prop + palette (day-seeded, deterministic)", () => {
    const a = pickDayProp(d(2026, 6, 20), "cactus");
    const b = pickDayProp(d(2026, 6, 20, 23), "cactus"); // same day, later hour
    expect(a.prop).toEqual(b.prop); // the sprout/mushroom is a DAILY constant
    expect(pickDayProp(d(2026, 6, 21), "cactus").prop).not.toEqual(a.prop); // usually differs
  });
  test("palette / time flavor varies by time-of-day bucket", () => {
    const morning = pickDayProp(d(2026, 6, 20, 8), "cactus");
    const night = pickDayProp(d(2026, 6, 20, 23), "cactus");
    expect(morning.palette).not.toBe(night.palette); // or whatever field carries it
  });
  test("pure: no Date.now / no getHours inside the core (injected only)", () => {
    // structural — the core signature takes a Date; assert via a fixed Date that
    // two calls with the SAME injected Date are byte-identical.
    expect(pickDayProp(d(2026, 0, 1), "duck")).toEqual(pickDayProp(d(2026, 0, 1), "duck"));
  });
  test("every prop glyph is ANSI-free, single visual cell, MIRROR_SWAP-safe", () => {
    for (const g of ALL_PROP_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(Object.keys(MIRROR_SWAP)).not.toContain(g);
    }
  });
});
```

- [ ] **Step 3 — implement.** A small seeded core; day-seed derived from the injected date via the established `hashString`+`mulberry32` seam:

```ts
import { hashString, mulberry32, type Species } from "./engine.ts";

/** The daily prop the buddy carries. `feet` is a daily-constant sprout/mushroom;
 *  `ahead` is the kickable pebble (Task 4 advances its baked column). */
export interface DayProp {
  prop: PropArt;              // {ahead?, feet?} — art.ts PropArt shape
  palette?: string;           // time-of-day flavor key (or an SGR, if colored)
}

/** Pick the day's prop + flavor. PURE — the date is injected (constraint 2), the
 *  way `activeSeasonal` takes its `now`. Same calendar day ⇒ same sprout. */
export function pickDayProp(now: Date, species: Species): DayProp {
  const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const rng = mulberry32(hashString(`prop:${dayKey}:${species}`));
  // draw prop from a small curated, mirror-safe, ANSI-free set; fold in the
  // season window (GATE Branch A) and an injected-hour time bucket for palette.
  // ...fixed, commented draw order...
}
```

  Keep the prop set tiny and hand-verified mirror-safe (`.` `o` `❦` `♣`-style symmetric glyphs — whatever Task 1's blank-cell probe accepted per species). `ALL_PROP_GLYPHS` is exported for the test.

- [ ] **Step 4:** targeted PASS; full suite; `tsc`.
- [ ] **Step 5:** Commit: `feat(living-world): day/season-seeded prop selection core` (+ trailer).

---

### Task 3: Wire props into the idle bake (derive-on-read, full-gated, zero new state)

Fold the day's prop into the idle frames at write time — the derive-on-read seam, exactly like `seasonalHat` and `gearArt` already are.

**Files:** Modify `server/art.ts` (`renderSpeciesFrame` / `getStatusFrames` gain an optional `prop`), `server/state.ts` (`writeStatusState` samples the day prop and threads it), Test `server/art.test.ts` + `server/state_wander.test.ts`.

- [ ] **Step 1 — failing tests.**
  - art.test.ts: `getStatusFrames(bones, "neutral", undefined, undefined, false, prop)` (or however the param lands) composites the prop into every returned frame; without a `prop` arg the output is **byte-identical** to today (back-compat pin — this guards the render snapshots).
  - state_wander.test.ts (mirror its temp-`CLAUDE_CONFIG_DIR` beforeEach exactly): at `full` + `wanderEnabled`, `status.json`'s idle `frames` contain the day's prop glyph; at `subtle`/`off` they do **not** (props are `full`-only idle juice, matching the emote row). Pin one seed/date so the assertion is deterministic (inject via the same seam Task 3 Step 2 uses — see the note below on injecting the date in tests).

- [ ] **Step 2 — implement.**
  - `renderSpeciesFrame` (art.ts:560) gains a trailing optional `prop?: PropArt` and calls `applyProp(bones.species, art, prop)` **after** `applyGear` (art.ts:574) — same blank-cell contract, so a cell a gear glyph took is skipped by the prop (order documented). `getStatusFrames` threads `prop` into its `resolveFrame` closure (art.ts:591) so every frame — idle 0-2, stretch 3, appended lean/peek — carries it.
  - `state.ts` `writeStatusState`: beside the `seasonalHat` sample (state.ts:1148-1157) and gated the same `gate !== "off"` way — but **prop is `full`-only idle juice**, so gate on `idleGate === "full"` (the already-computed clamped-idle gate at state.ts:1004, which also carries the D14 angry exemption for free) — lazily `require("./props.ts")`, call `pickDayProp(new Date(), displayBones.species)`, and pass the result's `prop` into the `getStatusFrames(...)` call at state.ts:1207. **`new Date()` is the thin impure wrapper** (constraint 2 satisfied: the core stays pure, the clock read is one injected call at the write site). Guard it in a try/catch like every other optional subsystem — a props failure must leave the buddy propless, never break the write.
  - **No new state file, nothing added to `TRANSIENT_PREFIXES`** — the prop is re-derived every write.
  - **Test date injection:** if the test needs a fixed date, follow whatever seam state_wander.test.ts already uses to defeat wall-clock nondeterminism (it notes `getTimeOfDayMood()` dependence at state_wander.test.ts:45-69) — reuse that idiom rather than inventing one; if it pins via env/mocked Date, do the same for `pickDayProp`'s date.

- [ ] **Step 3:** targeted PASS; **full suite**; `tsc`; **render snapshots byte-identical** (the render suite injects fixture frames and tests the cycler, not the live bake — a moved snapshot means the prop leaked into a non-full path; stop and investigate).
- [ ] **Step 4 — live sanity (read-only):** `echo '{}' | statusline/buddy-status.sh | head -8` against the user's real state — normal line, no stderr. (Non-destructive read; still, see Task 6's safety warning before ANY write-capable e2e.)
- [ ] **Step 5:** Commit: `feat(living-world): props ride the idle sprite, day-seeded and full-gated` (+ trailer).

---

### Task 4: Prop interaction — the step-kick

The pebble advances a cell as the buddy ambles: a kick, keyed to the gait's own step ticks (`phase === 1`), so motion and prop stay in lockstep by construction — the same lockstep `gaitFrameSequence` gives body frames.

**Files:** Modify `server/art.ts` (a per-tick prop-column resolver) + `server/state.ts` (thread the walk's phases), Test `server/art.test.ts` + `server/state_wander.test.ts`.

- [ ] **Step 1 — DECISION GATE: per-tick prop frames vs. a single kicked column.**

  Run: re-read `gaitFrameSequence` (art.ts, the P1 mapper) and the state.ts wander branch (state.ts:1300-1314) — note the idle `frames` array is a small fixed set and `frameSequence` indexes it per tick.

  A pebble that *moves* across ticks means the propped frame differs per tick (the pebble's column changes), but today the idle `frames` set is tiny (0-2 + variants) and reused cyclically. Two ways to make the pebble travel:

  - **Branch A — a short pre-baked family of pebble-position frames.** Bake, say, 3-4 idle frames each with the pebble one cell further `ahead`, and drive their selection from the walk's `phase===1` step-tick count (a parallel index, like `gaitFrameSequence`). The pebble hops forward each step, resets at the arc's home beat. Constant width/height by construction (pad the vacated cell). Costs a few extra entries in the `frames` array (no new *rows*, so D4 holds), and the anchor-blank test (Task 1) must cover each pebble column.
  - **Branch B — a static pebble that only re-seats at direction flips.** Simpler: the pebble sits at a fixed `ahead` cell and only its side flips when the buddy reverses (reuse the lean/peek edge beats). No per-tick frame family; cheaper; less lively. Choose this if Branch A's extra frames threaten the blank-cell contract for cramped species.

  Prefer Branch A for the "kick as the buddy ambles" the design describes, but fall back to B if any species can't spare the sequence of blank ahead-cells. State the branch + why.

- [ ] **Step 2 — failing tests** (art.test.ts, pure mapper):

```ts
describe("prop kick (living-world P4)", () => {
  test("pebble column advances only on step ticks, resets at home", () => {
    // Branch A: given a phases array [0,0,1,1,0,...], the resolver returns a
    // prop-frame index whose 'ahead' column increments on each phase===1 tick
    // and returns to base on the home-linger phase (3). Assert monotonic within
    // a travel run; constant otherwise.
  });
  test("kicked frames all satisfy the anchor blank-cell contract", () => {
    // every pebble column, every species, stays blank of body pixels — extend
    // Task 1's iteration to the pebble frame family.
  });
});
```

  And a state_wander.test.ts case: at full+wander, the idle `frameSequence` (or a parallel prop-sequence field, per branch) references the pebble frames and the pebble's rendered column differs between two `phase===1` ticks.

- [ ] **Step 3 — implement** per the chosen branch. Reuse the P1 phase track (`walk.phases`) already threaded at state.ts:1312 — the kick consumes the *same* phases the gait frames do, so no new signal. Keep it inside the existing `idleGate === "full"` wander try/catch. If Branch A adds prop frames, append them (never insert) so no existing frame index shifts, mirroring the lean/peek append (art.ts:594+).

- [ ] **Step 4:** targeted PASS; full suite; `tsc`; render snapshots byte-identical for the non-prop / non-full paths.
- [ ] **Step 5:** Commit: `feat(living-world): pebble kick advances on gait step ticks` (+ trailer).

---

### Task 5: Loot-dash inspect beat over a dropped-item glyph

The loot-dash stinger currently darts out, pauses 3 ticks, and returns — pure position. Give the pause a *subject*: a dropped-item glyph the buddy is inspecting.

**Files:** Modify `server/wander.ts` and/or `server/art.ts` (per GATE) + `server/state.ts` (align the inspect frame), Test `server/wander.test.ts` and/or `server/art.test.ts` + `server/state_wander.test.ts`.

- [ ] **Step 1 — DECISION GATE: how does the inspect beat get a glyph?**

  Run: re-read `stingerArc`'s `lootdash` branch (wander.ts:226-229), `spliceStingerArc` (wander.ts:243+), and the splice call site (state.ts:1303, which touches **only `wanderSequence`**, never `frameSequence`). Confirm for yourself the stinger has no frame channel today.

  The `out.push(r, r, r)` pause is three ticks at max reach `r`. To show "a dropped item glyph" during it:

  - **Branch A — bake a dropped-item prop into the `ahead` cell + reuse the peek posture.** During the inspect pause the buddy is already at reach `r`; drop a `◇`/`,` item glyph at the `ahead` prop anchor for those ticks and have the paired frame be the existing **peek (`<`) posture** (already appended by `getStatusFrames` gaitVariants, art.ts:594+ — "looking down at" the item). Needs the stinger to expose *which* ticks are the inspect pause so state.ts can align a frame-pick there — return the pause's tick span from `stingerArc` (or a small helper), then set those `frameSequence` slots to the peek index and composite the item glyph. No new frame art; reuses P1's peek + Task 1's prop cell. Preferred.
  - **Branch B — an appended dedicated "inspect" idle frame.** A new eye-substituted pose (e.g. `v` downward glance) with the item glyph baked in, appended to the idle `frames` and aligned to the pause ticks. Pick this only if Branch A's peek posture reads wrong beside the item for most species. Costs extra frame entries (no new rows).

  Either way, the crux is the same missing seam: **the stinger must report its inspect-beat tick offsets so `frameSequence` can be posed there**, since the shell only cycles baked `frameSequence`. Add that seam minimally (a returned `{arc, inspectAt}` or an exported `lootdashInspectTicks(range)`), keeping `stingerArc`'s existing signature back-compat (the two other kinds return no inspect span). State the branch + the exact seam you added.

- [ ] **Step 2 — failing tests.**
  - wander.test.ts: the loot-dash arc still ends at 0 (no-teleport invariant, wander.test.ts already pins this) AND the new inspect-span accessor reports the 3 pause ticks at reach `r` (or whatever the seam shape is). Other kinds report an empty/absent span.
  - state_wander.test.ts: `writeStatusState(companion, { stinger: "lootdash" })` at full+wander produces a `frameSequence` whose inspect-beat ticks reference the peek/inspect frame, and the corresponding idle frame contains the dropped-item glyph. (Anchor the write's tick the way the existing walkon stinger test does — plan-p0-p1 Task 7's `state_wander.test.ts` case is the template.)

- [ ] **Step 3 — implement** per branch. Keep the change additive: `stingerArc`'s existing three-branch output is unchanged; the inspect-span seam is new and only `lootdash` populates it. Wire the frame-pose + glyph inside the existing stinger splice block (state.ts:1303-ish), after the gait remap, so it composes over the gait sequence rather than fighting it.

- [ ] **Step 4:** targeted PASS; full suite; `tsc`; render snapshots byte-identical (no stinger in the fixture paths).
- [ ] **Step 5:** Commit: `feat(living-world): loot-dash inspect beat over a dropped item` (+ trailer).

---

### Task 6: Weather FX — sparse overlay driven by the streak

A drizzle mark during a rough error streak, drifting sparkles during a clean one — the `overlayRow` mechanism the emote row already uses, present only when active.

**Files:** Modify `server/art.ts` (a weather-row helper + `finalizeIdleBlock` coordination) + `server/state.ts` (derive the weather signal, thread it), Test `server/art.test.ts` + `server/state_wander.test.ts`.

- [ ] **Step 1 — DECISION GATE: does weather share the single emote FX row?**

  Run: re-read `finalizeIdleBlock` (art.ts:701-717) — it unshifts **one** FX row carrying `emoteFor(emotion)` — and `overlayRow` (art.ts:422). Constraint 3 forbids a new permanent row; the emote row is reclaimed when blank (`trimSharedBlankTopRows`).

  Weather (drifting drizzle/sparkle across the line) and the emote (a centered `!`/`♪`) both want an above-sprite overlay row. Options:

  - **Branch A — one shared FX row, weather composited into the emote row's blank cells.** `overlayRow` centers the emote over the sprite span; weather glyphs fill *other* columns of that same full-width row (it's already `totalW` wide). Zero new rows, both visible at once, and neutral+no-weather still reclaims the row. Needs a compositor that lays weather into the row *around* the emote glyph (skip the emote's cells). Preferred — it's the literal "emote-row precedent" the design cites and costs nothing.
  - **Branch B — weather rides the frame body's blank cells like props** (no overlay row at all): sparse marks in existing blank body columns, seeded to drift per tick. No row contention with the emote; but fewer available cells and trickier to make "drift" read. Fallback if Branch A's around-the-emote compositing proves fiddly.

  Prefer Branch A. State the branch and, if A, the rule for emote-vs-weather cell precedence (emote wins its center cells; weather fills the rest).

- [ ] **Step 2 — the weather signal (derive-on-read, no new state).**

  Run: `grep -n "combatErrorCount\|all_green\|errors_seen\|clean\|streak" server/session.ts server/state.ts | head -30` to locate the existing rough/clean signal (the standoff already reads an error count; the streak system already tracks clean runs — reuse one, do **not** add a counter). Weather is `full`-only and gates on the **configured** angry-style read only if it should survive the auto-quiet clamp — decide per design: drizzle exists *because* of errors (like the standoff/angry emote, D14), so it likely shares that exemption; sparkles are a clean-streak reward and take the normal clamp. State which signal you bound to and the gate you chose.

- [ ] **Step 3 — failing tests** (art.test.ts + state_wander.test.ts):

```ts
describe("weather overlay (living-world P4)", () => {
  test("drizzle/sparkle rows are exactly totalW wide (constant geometry)", () => {
    // overlayRow contract: displayWidth === totalW for every weather frame.
  });
  test("weather coexists with an emote in one row without overwriting it", () => {
    // Branch A: compose angry emote '!' + drizzle; assert '!' survives at center
    // and drizzle glyphs occupy other cells; row width unchanged.
  });
  test("no active streak ⇒ no weather ⇒ the FX row still reclaims when neutral", () => {
    // finalizeIdleBlock with null emote + null weather trims the row (height
    // identical to no-feature).
  });
  test("weather glyphs are ANSI-free (or ANSI only where the jq sanitizer exempts frame art) and MIRROR_SWAP-safe", () => {});
});
```

  And a state_wander.test.ts case: a fixture with a rough-streak signal at full renders drizzle in the idle FX row; a clean-streak fixture renders sparkles; `subtle`/`off` render neither.

- [ ] **Step 4 — implement** per branch, inside the existing `finalizeIdleBlock` call at state.ts:1282 (pass a resolved weather glyph-set alongside the emote) or a sibling helper. Keep it in the idle try/catch — a weather failure leaves the line un-rainy, never broken. Constant height: when weather is active the FX row is non-blank and kept; when inactive it's blank and reclaimed, so a resting buddy pays nothing (matches the emote row's own contract).

- [ ] **Step 5:** targeted PASS; full suite; `tsc`; render snapshots byte-identical for non-full / no-streak paths.
- [ ] **Step 6:** Commit: `feat(living-world): sparse weather FX on the idle overlay row` (+ trailer).

---

### Task 7: e2e + docs

**Files:** `docs/game-feel/CURRENT-STATE.md` (new dated P4 section + Doc-map/status header bump), `docs/game-feel/living-world/design.md` (status header → P4 implemented; §P4 "shipped" note), `docs/game-feel/idle-rpg/testing-guide.md` (a P4 props/weather harness section), `README.md` (one line in the game-feel section — props/weather/time flavor — only if the README already lists comparable idle-line features, matching its voice).

> ## ⚠️ CRITICAL SAFETY WARNING — read before ANY manual e2e in this task
>
> Earlier in this arc, an implementer subagent doing manual e2e verification **corrupted the user's real, live `~/.claude-buddy` profile** by writing `CLAUDE_CONFIG_DIR="$CFG"` **after** a command instead of prefixed — bash treated it as a stray argument, not an env assignment, so the command silently ran against the **real save data** instead of the temp fixture. Some of the damage (grown stat levels) was **permanently unrecoverable.**
>
> Therefore, for every command in this task that can write state:
> - **ALWAYS prefix** the env assignment: `CLAUDE_CONFIG_DIR="$CFG" bun run server/award-xp.ts ...` — the assignment MUST come *before* the command word, never after it.
> - **Set and export `CLAUDE_CONFIG_DIR` to a fresh `mktemp -d` first**, and **verify it points at the temp dir** (`echo "$CLAUDE_CONFIG_DIR"`) before running anything that writes.
> - **Never** run a state-writing command without confirming the temp `CLAUDE_CONFIG_DIR` is in effect for *that exact command*.
> - Read-only renders (`echo '{}' | statusline/buddy-status.sh`) against real state are fine; **writes are not.**
>
> This is now a standing requirement for every e2e-touching task in every plan in this repo.

- [ ] **Step 1 — manual e2e** (temp `CLAUDE_CONFIG_DIR`, testing-guide idioms, the warning above in force):
  ```bash
  export CLAUDE_CONFIG_DIR="$(mktemp -d)"; echo "$CLAUDE_CONFIG_DIR"   # verify temp!
  # adopt/seed a buddy at gameFeel=full, wander on, with a hat + gear equipped
  # (the crowded-sprite worst case), then render across a few ticks:
  for i in 0 1 2 3 4; do
    BUDDY_FAKE_NOW=$(( $(date +%s) + i )) statusline/buddy-status.sh <<< '{}'
  done
  ```
  Confirm: (a) the day's prop renders at the feet **and** the trinket still renders (no clobber); (b) the pebble advances across the ticks (Task 4); (c) a forced loot-dash shows the inspect beat over the item glyph (Task 5); (d) a rough-streak fixture shows drizzle, a clean-streak shows sparkles, both without eating a row or clipping (Task 6); (e) props/weather **vanish** while a bug standoff/visitor scene is up (they ride idle frames only). STOP/BLOCKED on any failure. Delete the temp dir after.

- [ ] **Step 2 — full validation sweep:** `bun test && bunx tsc --noEmit && bash -n statusline/buddy-status.sh` — all green; record exact totals (baseline 927 + P4 additions).

- [ ] **Step 3 — docs** in the established voice. CURRENT-STATE gets a "Living-world P4 — world dressing (2026-07-2x)" section (what / why / mechanism / tests) and notes explicitly: **zero shell changes, zero new config keys, zero new state files** (props re-derived per write), props ride idle frames so they're mutually exclusive with scenes by construction, and the weather/emote FX row is shared (Task 6 branch). design.md's status header flips P4 to implemented and the arc to complete; testing-guide gains the Step-1 harness (with the safety warning carried into it).

- [ ] **Step 4:** Commit: `docs(living-world): P4 shipped — world dressing` (+ trailer).

---

## Self-review checklist (run after writing, before executing)

- **Spec coverage vs design.md §P4 bullets:**
  - Props travel inside baked frames under the `applyGear` blank-cells-only / ANSI-refused contract — Tasks 1, 3.
  - Prop interaction: pebble kick on step ticks (Task 4) + loot-dash inspect beat over a dropped item (Task 5).
  - Time/season flavor sampled at bake time — Task 2 (pure core, injected date; season GATE resolved against `activeSeasonal`).
  - Weather FX as a sparse overlay-row effect, present only when active (emote-row precedent) — Task 6.
  - Testing: `GEAR_ANCHORS`-pattern blank-cell verification across species/frames (Task 1), prop determinism per day-seed (Task 2), weather gating units (Task 6), crowded-sprite e2e props+gear+hat[+weather] (Task 7).
- **Standing constraints (all 8):** server bakes / bash cycles + **zero `buddy-status.sh` changes** (all tasks); pure seeded cores with injected date/seed (Tasks 2, 4, 5); **zero new rows** — props ride frame cells, weather shares the reclaimable emote row (Tasks 1, 6); one gate — props/weather `full`-only idle, off = nothing (Task 3, 6); zero per-event cost — derive-on-read at the existing write, no new rolls (all); constant width AND height per flipbook (Tasks 1, 4, 5, 6 tests); **zero new config keys** (all); guarded writes + **no new state files** so `TRANSIENT_PREFIXES` is untouched (Task 3 note).
- **D-decisions:** D4 zero-rows honored throughout; D11 ladder untouched — props/weather don't compete in it (idle vs scene are separate channels, Recon fact 9); D14 angry-exemption reused for the error-born drizzle gate (Task 6 Step 2).
- **No P3 dependency:** confirmed `server/expedition.ts` absent; no task assumes it.
- **No invented APIs:** every uncertain shape has a grep/read step and a stated branch — anchor location (Task 1), season model (Task 2), pebble frames (Task 4), inspect-beat seam (Task 5), weather row sharing (Task 6). Each GATE has a concrete command + ≥2 distinct branches + what to do in each, for the implementer to resolve at execution time.
- **Safety:** the verbatim `CLAUDE_CONFIG_DIR`-corruption warning is carried into Task 7 and marked a standing requirement.
