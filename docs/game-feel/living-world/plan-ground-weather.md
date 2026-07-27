# Ground Weather — Implementation Plan (living-world follow-up)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship **ground weather** — occasional, randomized, mid-session snow/rain
that starts and stops genuinely mid-session, layered onto the existing fixed
"living ground" terrain row as sparse, per-glyph-tinted flakes/drops — per
`design-ground-weather.md`'s resolved D1–D5 decisions.

**Architecture:** This is a pure extension of the "server bakes, bash cycles"
invariant, not a new pattern. The whole feature is: (1) a pure, seeded core in
`server/ground.ts` that decides — once, off the session's `startedAt`, exactly
like `pickSessionGround` already does — *whether* a session gets weather, and
if so *when* it starts and how long it lasts (`WeatherSchedule`); (2) a second
pure comparison, `isWeatherActive`, that any write can call with `elapsedMs =
Date.now() - startedAt` to ask "is the window open right now" — no reroll, no
new randomness per write, matching the "zero per-event cost" constraint the
rest of this arc holds to; (3) at the existing `idleGate === "full" &&
cfg.groundEnabled` write site in `writeStatusState`, when the window is open,
`GROUND_TILE` becomes a longer, RNG-woven period (mostly terrain glyphs, a
few weather glyphs) instead of the plain terrain unit, and two new plain-string
fields (`groundWeatherGlyph`, `groundWeatherColor`) travel alongside it; (4)
the shell — which already tiles/clips `GROUND_TILE` verbatim and knows nothing
about weather — gains one small, bounded string-substitution step that
recolors just the weather glyph wherever it lands in the row it already built.
Bash never rolls anything; it only ever splices in strings the server decided.
When no window is open, `GROUND_TILE` and the render path are byte-identical
to today's plain-terrain output — this is the single most important invariant
every task below must protect and prove.

**Tech Stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), bash
statusline (`bash -n statusline/buddy-status.sh`). One shell change is in
scope for this plan (Task 3) — everything else is TS.

**Read first:**
- `docs/game-feel/living-world/design-ground-weather.md` (full — this plan
  implements its resolved D1–D5 decisions and its D1/D5 mechanism sketches
  verbatim where possible).
- `server/ground.ts` and `server/ground.test.ts` (the module and test shape
  this plan extends — read in full, not summarized).
- `docs/game-feel/living-world/plan-p4.md` (structural sibling — this plan's
  task/GATE/commit format mirrors it).
- `docs/game-feel/CURRENT-STATE.md` — note it currently has **no section on
  the living-ground row itself** (that row shipped this session and is still
  uncommitted); Task 4 adds the first CURRENT-STATE coverage for both ground
  and ground-weather together.

**Baseline (verified 2026-07-24, working tree includes the uncommitted living-ground row):**
- `bun test 2>&1 | tail -5` → **1027 pass, 0 fail** (1 snapshot, 40718
  `expect()` calls, 33 files, ~10.3s).
- `bunx tsc --noEmit` → clean, no output.
- `bash -n statusline/buddy-status.sh` → clean (exit 0).
- `git status --porcelain` shows `server/ground.ts`, `server/ground.test.ts`,
  and `docs/game-feel/living-world/design-ground-weather.md` as untracked, and
  `server/state.ts`, `server/state_wander.test.ts`,
  `server/statusline_render.test.ts`, `statusline/buddy-status.sh`,
  `server/index.ts`, `server/menu.ts`, `skills/buddy/SKILL.md` as modified —
  the living-ground row is fully present in the working tree but **not yet
  committed**. This plan builds on top of that working tree as-is; committing
  the ground-row work itself is out of this plan's scope (each task below
  commits only the weather-specific diff it adds).

---

## Recon facts the tasks below rely on

- **`pickSessionGround`** (`server/ground.ts:75-78`) is the exact shape to
  mirror: `mulberry32(hashString(\`ground:${seed}\`))` against a fixed table,
  pure, no clock/disk read inside the module. `TERRAINS` (`ground.ts:47-54`)
  is the 6-entry table; `ALL_GROUND_GLYPHS` (`ground.ts:58-62`) derives the
  full glyph set from it for the ANSI/mirror-safety test — the new weather
  glyphs need an equivalent export.
- **`ground.test.ts`** (51 lines, full file read) pins five properties every
  new pure function in this module should also satisfy: same-seed
  determinism (`toEqual`), no-clock purity, a seed sweep proving the table
  isn't pinned to one output, every output's shape (non-empty tile / 6-hex
  color), and a glyph-safety pair (`displayWidth(g) === 1`,
  `mirrorFrame([...]).toContain(g)` — imported straight from `art.ts`).
- **Terrain-glyph collision risk (load-bearing, not called out in the design
  doc's own placeholder):** `TERRAINS`' six tiles use the glyphs `„ . , ~ ▂ ·`
  and space (`ground.ts:47-54`). The design doc's placeholder rain glyph is
  `,` — but `,` is **already the second glyph of the `field` terrain's own
  tile** (`{ name: "field", tile: ".,", ... }`, `ground.ts:49`). Task 3's shell
  recolor step matches the weather glyph by literal string content wherever
  it appears in the already-tiled `_grow` row — it cannot distinguish a `,`
  the weave placed as a weather speck from a `,` that's just part of the
  `field` terrain's own repeating unit. Picking `,` for rain on a `field`
  session would recolor *every* comma in the row, turning "sparse, scattered
  drops" into "the entire floor is rain-colored" — silently defeats D4/D5.
  Task 1's glyph GATE must resolve this before any code is written.
- **`server/state.ts` config wiring** (`state.ts:428-441`): `worldDressing`
  (P4 sprite props/weather-on-idle-row, already shipped and unrelated) and
  `groundEnabled` (the ground row's own opt-out, `DEFAULT_CONFIG.groundEnabled
  = true` at `state.ts:471`) are **separate toggles** — D3 piggybacks weather
  on `groundEnabled` specifically, not `worldDressing`.
- **The ground write site** (`state.ts:1496-1521`, inside `writeStatusState`):
  gated `if (idleGate === "full" && cfg.groundEnabled)`; loads
  `startedAt` via `const { loadSnapshot } = require("./session.ts"); const
  startedAt = loadSnapshot()?.startedAt;` (`state.ts:1509-1510`), guards the
  whole block in try/catch ("a failure leaves the floor bare"), and writes
  `ground` (tile) + `groundColor` into the `StatusState` object conditionally
  at `state.ts:1564` (`...(ground ? { ground, groundColor } : {})`). This is
  the exact block Task 2 extends — same `startedAt`, same try/catch, no new
  gate.
- **The `pickDayProp(new Date(), ...)` idiom** (`state.ts:1244-1245`, inside
  the *different* `cfg.worldDressing` block just above the ground block) is
  the repo's one sanctioned "impure clock read at a write site" pattern: the
  pure core (`props.ts`'s `pickDayProp`) takes an injected `Date`, and
  `writeStatusState` is the only caller that ever constructs `new Date()`.
  The weather schedule's `elapsedMs = Date.now() - startedAt` check reuses
  this same idiom, one call site, one try/catch.
- **`statusline/buddy-status.sh` jq extraction** (`buddy-status.sh:167-204`):
  `$ground`/`$gcolor` are computed at lines 172-173, gated `$gf == "full" and
  $combat_on != 1` (re-gating belt-and-suspenders on top of the TS-side
  `idleGate`), appended into the TSV-ish joined array at lines 200-201, and
  read back into bash as `GROUND_TILE GROUND_COLOR` in the `IFS=$'\x1f' read`
  at `buddy-status.sh:206-212` (right before `_FRAME_B64`). Two new fields
  need the identical three-step treatment (jq `$gwglyph`/`$gwcolor` → append
  to the array → new bash var names in the same `read`).
- **The render block** (`buddy-status.sh:1151-1188`): builds `_grow` by
  repeating `GROUND_TILE` to `_GRND_W = COLS - RIGHT_SAFETY -
  STATS_LEFT_MARGIN` cells then clipping (`buddy-status.sh:1164-1168`), then
  wraps it in exactly **one** dim-RGB escape `_GC` derived from
  `GROUND_COLOR` (`buddy-status.sh:1177-1185`) and prints
  `"${_GLEAD}${_GC}${_grow}${NC}"` (`buddy-status.sh:1186`). The recolor step
  goes between building `_grow` (line 1168) and the final `echo` (line 1186):
  substitute each weather-glyph occurrence with `${_WC}${glyph}${_GC}` — NOT
  `${NC}` — so the row *resumes* the terrain's dim color after each glyph
  instead of losing it entirely (`_GC` is already computed by the time the
  substitution needs to run; a weather-color escape `_WC` is the new
  parallel piece built the same way from `GROUND_WEATHER_COLOR`). No dwidth
  fork is needed today (`ground.test.ts` already pins single-display-cell,
  ANSI-free glyphs), but D5 needs the actual `${var//lit/repl}` behavior
  verified against a real multi-byte glyph in this shell — that's Task 3's GATE.
- **`server/art.ts`'s `Weather` type is unrelated** (`art.ts:770`): `type
  Weather = "drizzle" | "sparkle"`, driven by *coding-session* signals
  (`WEATHER_GLYPH` at `art.ts:775-778` uses `'`/`*`, `WEATHER_OFFSETS` at
  `art.ts:785` are fixed non-random offsets `[1, -2, 3, -4]`), rendered on the
  idle **FX row** via `finalizeIdleBlock`/`overlayRow`, not the ground row.
  Ground weather must use a new type name (`GroundWeather`, per D2) and must
  not import from or collide conceptually with this one — they're allowed to
  simply coexist per the design doc's explicit deferral. `'`/`*` are
  candidates worth avoiding for ground-weather glyphs too, purely to keep the
  two "weather" concepts visually distinct even though they live on different
  rows (soft preference, not a hard collision).
- **`MIRROR_SWAP`** (`art.ts:580-591`) only swaps `( ) < > [ ] { } / \` —
  none of these overlap `TERRAINS`' glyphs or the art.ts `Weather` glyphs
  either, so the safe glyph space is wide open; `displayWidth`
  (`art.ts:522-545`) is the width-1 check both `ground.test.ts` and the new
  weather tests must use.
- **`server/props.ts`** (full file read) is the precedent for a pure core
  taking an injected `Date`/seed with a paired test file of fixed injected
  inputs — its own header explicitly documents the "distinct seed prefix so
  the two draws are independent streams" pattern
  (`pick(rng, FEET_PROPS)`/`pick(rng, AHEAD_PROPS)` drawn off one
  `mulberry32(hashString(\`prop:${dayKey}:${species}\`))` stream,
  `props.ts:135-147`) — the exact idiom `pickSessionWeather`'s
  `ground-weather:${seed}` prefix (distinct from `pickSessionGround`'s
  `ground:${seed}`) and the weave builder's own distinct prefix should both
  follow.
- **`server/combat.ts`'s persisted-event pattern was evaluated and
  rejected** for this feature (design doc's Deferred §, Branch B1):
  `writeEncounter`/`readEncounter` (`combat.ts:773-820`) persist a side-channel
  file (tmp+rename, `combat.ts:781-789`) with a fixed `ENCOUNTER_TTL_MS =
  10_000` (`combat.ts:802`) read back and TTL-checked
  (`combat.ts:809-820`), and every such side-channel is registered in
  `TRANSIENT_PREFIXES` (`state.ts:1636-1652`, e.g. `"pending-encounter."`,
  `"visitor."`) so `cleanupPluginState` (`state.ts:1664-1690`) can sweep it on
  uninstall. **Ground weather adds none of this** — no new file, no TTL check
  at read time, no `TRANSIENT_PREFIXES` entry — because the schedule is fully
  derived from `startedAt`, which is already loaded for the terrain draw.
  This is the D1-resolved Branch B2 vs. rejected Branch B1 tradeoff; Task 2
  must not accidentally reach for `writeEncounter`-style persistence.
- **The state_wander.test.ts stub-loader idiom is the load-bearing test seam
  for Task 2**, not date injection. `pickDayProp(new Date(), ...)` at the
  `worldDressing` write site (`state.ts:1244-1245`) has **no injection point**
  either — real wall clock, always — yet `state_wander.test.ts` tests it
  deterministically via a **child-local Bun loader plugin** that swaps the
  whole module for a stub source string at `spawnSync` time
  (`state_wander.test.ts:180-198`, the `stubProp` block; see also
  `stubPhases` at `state_wander.test.ts:206-221` and `throwWander` at
  `state_wander.test.ts:169-178` — all three share one `import { plugin }
  from "bun"` per `state_wander.test.ts:222-225`, since importing it twice in
  one process is a `SyntaxError`). Ground weather's schedule is seeded off
  `startedAt` — the *same* value that also determines `elapsedMs = Date.now()
  - startedAt` — so picking a `startedAt` that lands "inside the window" by
  brute-force search is circular (the hash-based RNG isn't continuous in the
  seed). The clean fix is the same stub-loader idiom: a `stubGroundWeather`
  test option that swaps `server/ground.ts`'s module contents for a fixed
  `pickSessionWeather`/`isWeatherActive` (and `buildWeatherTile`, once it
  exists) return, exactly like `stubProp` does for `props.ts`. **Gotcha for
  whoever writes this stub:** the same `ground.ts` module is *also* required
  for `pickSessionGround` in the very same write-site block
  (`state.ts:1512-1517`) — a stub that only re-implements the weather
  functions and forgets to re-export `pickSessionGround` will break terrain
  rendering in that test, not just weather. The stub source string must
  export all of `pickSessionGround`, `pickSessionWeather`, `isWeatherActive`,
  and the weave builder.
- **`statusline_render.test.ts`'s `renderStatus`/`StatusOverrides` fixture
  helper** (`statusline_render.test.ts:27-90+`) already has a `ground`/
  `groundColor` override pair (`statusline_render.test.ts:100-103`, mapped
  into the JSON fixture at `statusline_render.test.ts:182-184`) and a full
  `describe("buddy-status.sh living ground …")` block
  (`statusline_render.test.ts:1571-1647`) covering full/subtle/off/combat
  gating and the fixed-left/no-overflow invariant — Task 3's shell tests
  extend this exact `describe` block/helper rather than inventing a new
  fixture path. `groundWeatherGlyph`/`groundWeatherColor` need the same
  override-then-map treatment.

---

### Task 1: Pure weather-schedule core + woven-tile builder (`ground.ts`)

Lands the whole feature's pure heart: given a session seed, decide whether/
when weather happens, and how to weave it into a tile string. Inert — no
caller yet, so `ground.test.ts`'s existing assertions and every downstream
render stay byte-identical.

**Files:** Modify `server/ground.ts`, `server/ground.test.ts`.

- [x] **Step 1 — DECISION GATE: odds and ranges for the schedule.**

  Run: `grep -n "VISITOR_ODDS\|rng() >= 1 /" server/visitor.ts` and re-read
  `visitor.ts:49,64,81` — the repo's one existing "rare session/commit event"
  magnitude precedent: `VISITOR_ODDS = 12`, gated `rng() >= 1 / VISITOR_ODDS`
  (~1-in-12). The design doc leaves exact odds/ranges as "placeholder
  numbers only, to be picked (and made easily tunable) during planning"
  (`design-ground-weather.md` §Remaining unknowns).

  - **Branch A — mirror `VISITOR_ODDS`'s magnitude, tuned for visible
    start/stop within a normal session.** A `GROUND_WEATHER_ODDS` constant
    around 8–12 (≈1-in-10 sessions get weather at all); snow/rain 50/50;
    `startMs` drawn from an early-ish window (e.g. 30s–10min after session
    start, so it isn't already running before the buddy even renders once);
    `durationMs` drawn from a multi-minute window (e.g. 2–8 min) short enough
    relative to a typical working session that both the start *and* the stop
    are actually observed.
  - **Branch B — rarer and longer** (≈1-in-30+ sessions, duration spanning
    most of a session) — reads as a session-defining mood rather than a
    passing shower.

  Prefer **Branch A**: the design doc's own emphasis is "genuine mid-session
  start/stop" (D1) — a schedule long/rare enough that it rarely completes
  its window within an actual session mostly shows only the "start" half,
  undermining the exact behavior D1 asked for. Export every threshold as a
  named constant (not inlined) so it's easy to retune later, per the design
  doc's "easily tunable" ask.

- [x] **Step 2 — DECISION GATE: weather glyphs, collision-checked against `TERRAINS`.**

  Run: `grep -n "tile: \"" server/ground.ts` (confirms the six tile strings)
  and `grep -n "MIRROR_SWAP\|WEATHER_GLYPH" server/art.ts`. Per the Recon
  facts above, the design doc's own `,` rain placeholder collides with the
  `field` terrain's own tile glyph — a naive per-glyph shell substitution
  (Task 3) would recolor *every* comma on a `field` session, not just the
  sparse weather specks.

  - **Branch A — a fixed pair disjoint from `ALL_GROUND_GLYPHS`, `MIRROR_SWAP`,
    and `art.ts`'s existing `WEATHER_GLYPH` set.** E.g. `+` for snow, `:` for
    rain — neither appears in any of the six `TERRAINS` tiles (`„ . , ~ ▂ ·`
    + space), neither is a `MIRROR_SWAP` key, and neither collides with the
    idle-FX-row `'`/`*` weather glyphs. Cheapest: one glyph pair, correct
    regardless of which terrain is active, verified once by a test that
    checks disjointness against `ALL_GROUND_GLYPHS` directly (so a future
    `TERRAINS` addition that happens to reuse `+`/`:` fails loudly instead of
    silently misbehaving).
  - **Branch B — terrain-aware glyph selection inside the weave builder**
    (a per-terrain fallback glyph if the chosen weather glyph happens to
    collide with that terrain's own tile). More robust against future
    `TERRAINS` growth, but real branching complexity for a problem Branch A's
    disjoint fixed set already solves for all six current entries.

  Prefer **Branch A** — simpler, and the disjointness test it requires
  (`ALL_GROUND_GLYPHS.includes(weatherGlyph)` must be false) is cheap
  insurance against the exact bug this GATE exists to prevent. State the two
  chosen glyphs in your report.

- [x] **Step 3 — failing tests** (`ground.test.ts`, extend the existing
  `describe`/add a sibling one, mirroring the file's existing five-test shape):

```ts
import {
  pickSessionGround,
  pickSessionWeather,
  isWeatherActive,
  buildWeatherTile,
  ALL_GROUND_GLYPHS,
  ALL_GROUND_WEATHER_GLYPHS,
  type WeatherSchedule,
} from "./ground.ts";

describe("ground weather schedule (living-world follow-up)", () => {
  test("same session seed ⇒ same schedule (or same no-weather), deterministic", () => {
    const a = pickSessionWeather(1_700_000_000);
    const b = pickSessionWeather(1_700_000_000);
    expect(a).toEqual(b);
  });

  test("a seed sweep produces both weather and no-weather sessions", () => {
    let sawWeather = false, sawNone = false;
    for (let s = 0; s < 500; s++) {
      if (pickSessionWeather(s) === null) sawNone = true;
      else sawWeather = true;
    }
    expect(sawWeather).toBe(true);
    expect(sawNone).toBe(true);
  });

  test("a seed sweep produces both snow and rain", () => {
    const kinds = new Set<string>();
    for (let s = 0; s < 500; s++) {
      const sched = pickSessionWeather(s);
      if (sched) kinds.add(sched.kind);
    }
    expect(kinds.has("snow")).toBe(true);
    expect(kinds.has("rain")).toBe(true);
  });

  test("isWeatherActive: boundary sweep on a fixed schedule", () => {
    const sched: WeatherSchedule = { kind: "snow", startMs: 60_000, durationMs: 120_000 };
    expect(isWeatherActive(sched, 59_999)).toBe(false); // just before start
    expect(isWeatherActive(sched, 60_000)).toBe(true);  // exactly at start
    expect(isWeatherActive(sched, 179_999)).toBe(true); // just before end
    expect(isWeatherActive(sched, 180_000)).toBe(false); // exactly at end
  });

  test("isWeatherActive: null schedule is always inactive", () => {
    expect(isWeatherActive(null, 0)).toBe(false);
    expect(isWeatherActive(null, 999_999)).toBe(false);
  });

  test("buildWeatherTile: same seed ⇒ same woven tile (deterministic, replayable)", () => {
    const terrain = pickSessionGround(42);
    const a = buildWeatherTile(terrain, "rain", 42);
    const b = buildWeatherTile(terrain, "rain", 42);
    expect(a).toEqual(b);
  });

  test("buildWeatherTile: woven tile is longer than the plain terrain unit and contains the weather glyph", () => {
    const terrain = pickSessionGround(42);
    const woven = buildWeatherTile(terrain, "snow", 42);
    expect(woven.tile.length).toBeGreaterThan(terrain.tile.length);
    expect(woven.tile).toContain(woven.glyph);
  });

  test("weather glyphs never collide with any TERRAINS glyph (the field/',' bug this GATE exists to prevent)", () => {
    for (const g of ALL_GROUND_WEATHER_GLYPHS) {
      expect(ALL_GROUND_GLYPHS).not.toContain(g);
    }
  });

  test("every weather glyph is ANSI-free, single display cell, and MIRROR_SWAP-safe", () => {
    for (const g of ALL_GROUND_WEATHER_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(displayWidth(g)).toBe(1);
      const mirrored = mirrorFrame([`  ${g}  `]).join("\n");
      expect(mirrored).toContain(g);
    }
  });
});
```

  (Add the `displayWidth`/`mirrorFrame` import alongside the file's existing
  `art.ts` import at `ground.test.ts:3`.)

- [x] **Step 4 — verify failure:** `bun test server/ground.test.ts` → FAIL
  (`pickSessionWeather`, `isWeatherActive`, `buildWeatherTile`,
  `ALL_GROUND_WEATHER_GLYPHS` not exported).

- [x] **Step 5 — implement** in `server/ground.ts`, following the design
  doc's D1 mechanism sketch and this task's GATE outcomes:

```ts
export type GroundWeather = "snow" | "rain";

export interface WeatherSchedule {
  kind: GroundWeather;
  /** Offset from session start (ms) at which weather begins. */
  startMs: number;
  /** How long the window stays open (ms). */
  durationMs: number;
}

const GROUND_WEATHER_ODDS = 10; // ~1-in-10 sessions get weather at all (Step 1 GATE)
const WEATHER_START_MIN_MS = 30_000;
const WEATHER_START_RANGE_MS = 9 * 60_000; // 30s .. ~10min
const WEATHER_DURATION_MIN_MS = 2 * 60_000;
const WEATHER_DURATION_RANGE_MS = 6 * 60_000; // 2min .. 8min

const WEATHER_GLYPH: Record<GroundWeather, string> = {
  snow: "+",
  rain: ":",
}; // Step 2 GATE — disjoint from ALL_GROUND_GLYPHS, MIRROR_SWAP, art.ts's WEATHER_GLYPH

const WEATHER_COLOR: Record<GroundWeather, string> = {
  snow: "e8f0f7", // pale white-blue
  rain: "5f8fc7", // steel blue
};

export const ALL_GROUND_WEATHER_GLYPHS: readonly string[] =
  Object.values(WEATHER_GLYPH);

/** Pure. Distinct seed prefix from `pickSessionGround`'s (`ground:`) so the
 *  two draws are independent streams off the same `startedAt` — the
 *  `props.ts` "independent streams" idiom (props.ts:135-147). */
export function pickSessionWeather(seed: number): WeatherSchedule | null {
  const rng = mulberry32(hashString(`ground-weather:${seed}`));
  if (rng() >= 1 / GROUND_WEATHER_ODDS) return null;
  const kind: GroundWeather = rng() < 0.5 ? "snow" : "rain";
  const startMs = WEATHER_START_MIN_MS + Math.floor(rng() * WEATHER_START_RANGE_MS);
  const durationMs = WEATHER_DURATION_MIN_MS + Math.floor(rng() * WEATHER_DURATION_RANGE_MS);
  return { kind, startMs, durationMs };
}

/** Pure. The only thing checked on every write — no reroll. */
export function isWeatherActive(schedule: WeatherSchedule | null, elapsedMs: number): boolean {
  if (!schedule) return false;
  return elapsedMs >= schedule.startMs && elapsedMs < schedule.startMs + schedule.durationMs;
}

export interface WeatherTile {
  /** The woven period (terrain glyphs + scattered weather glyphs) — replaces
   *  the plain terrain.tile as GROUND_TILE while a window is active. */
  tile: string;
  glyph: string;
  color: string;
}

const WEAVE_PERIOD_MIN = 24;
const WEAVE_PERIOD_RANGE = 17; // 24..40
const WEAVE_SPECK_DIVISOR = 7; // roughly 1 speck per 7 cells

/** Pure. Distinct seed prefix again — an independent stream from both
 *  `pickSessionGround` and `pickSessionWeather`, so changing the weave
 *  doesn't reroll whether/when weather happens, and vice versa. */
export function buildWeatherTile(
  terrain: Terrain,
  weather: GroundWeather,
  seed: number,
): WeatherTile {
  const rng = mulberry32(hashString(`ground-weather-weave:${seed}`));
  const glyph = WEATHER_GLYPH[weather];
  const color = WEATHER_COLOR[weather];
  const period = WEAVE_PERIOD_MIN + Math.floor(rng() * WEAVE_PERIOD_RANGE);
  const unit = Array.from(terrain.tile);
  const cells: string[] = [];
  while (cells.length < period) cells.push(...unit);
  cells.length = period;
  const speckCount = Math.max(2, Math.round(period / WEAVE_SPECK_DIVISOR));
  for (let i = 0; i < speckCount; i++) {
    cells[Math.floor(rng() * period)] = glyph;
  }
  return { tile: cells.join(""), glyph, color };
}
```

  Keep every constant named and exported-or-local per your judgment, but
  **not inlined magic numbers** — the design doc explicitly asks these stay
  tunable.

- [x] **Step 6:** targeted PASS (`bun test server/ground.test.ts`); full
  `bun test`; `bunx tsc --noEmit`. No caller yet, so no render snapshot can
  have moved — confirm the full suite's pass count is baseline (1027) + this
  task's new test count, nothing else changed.

- [x] **Step 7:** Commit: `feat(living-world): ground-weather schedule + woven-tile core` (+ trailer).

---

### Task 2: Wire the schedule into `writeStatusState` (derive-on-read, zero new state)

Fold the schedule check into the existing ground write site: same
`startedAt`, same try/catch, same `groundEnabled` gate (D3) — just one extra
pure comparison per write.

**Files:** Modify `server/state.ts`, Test `server/state_wander.test.ts`.

- [x] **Step 1 — failing tests** (`state_wander.test.ts`, new `describe`,
  reusing the file's temp-`CLAUDE_CONFIG_DIR` `beforeEach` and adding a
  `stubGroundWeather` option to `RenderCase` following the exact `stubProp`
  idiom at `state_wander.test.ts:180-198`):

```ts
// In RenderCase interface, beside stubProp:
/** Stub server/ground.ts's pickSessionWeather/isWeatherActive/buildWeatherTile
 *  to a fixed result (living-world ground-weather Task 2) — same idiom as
 *  stubProp; MUST also re-export pickSessionGround or terrain rendering
 *  breaks in the same write-site block (state.ts:1512-1517). */
stubGroundWeather?: { active: boolean; glyph?: string; color?: string; tile?: string };
```

```ts
// In the render() helper, alongside propsStubBlock (state_wander.test.ts:185-198):
const groundWeatherStubBlock = c.stubGroundWeather
  ? `
plugin({ name: "stub-ground-weather", setup(b) {
  b.onLoad({ filter: /ground\\.ts$/ }, () => ({
    loader: "js",
    contents: ${JSON.stringify(`
export function pickSessionGround(seed){
  const T=[{name:"meadow",tile:"„.",color:"4a7c3f"}];
  return T[0];
}
export function pickSessionWeather(){ return ${c.stubGroundWeather.active} ? {kind:"snow",startMs:0,durationMs:999999} : null; }
export function isWeatherActive(){ return ${c.stubGroundWeather.active}; }
export function buildWeatherTile(){ return {
  tile: ${JSON.stringify(c.stubGroundWeather.tile ?? "„.+„.")},
  glyph: ${JSON.stringify(c.stubGroundWeather.glyph ?? "+")},
  color: ${JSON.stringify(c.stubGroundWeather.color ?? "e8f0f7")},
}; }
`)},
  }));
}});
`
  : "";
```

```ts
describe("ground weather wiring (living-world follow-up, writeStatusState)", () => {
  test("full + groundEnabled + active window ⇒ status.json carries the woven tile + weather fields", () => {
    const out = render({
      config: { gameFeel: "full", groundEnabled: true },
      stubGroundWeather: { active: true, glyph: "+", color: "e8f0f7", tile: "„.+„." },
    });
    expect(out.status.ground).toBe("„.+„.");
    expect(out.status.groundWeatherGlyph).toBe("+");
    expect(out.status.groundWeatherColor).toBe("e8f0f7");
  });

  test("full + groundEnabled + inactive window ⇒ plain terrain tile, no weather fields", () => {
    const out = render({
      config: { gameFeel: "full", groundEnabled: true },
      stubGroundWeather: { active: false },
    });
    expect(out.status.ground).toBe("„."); // plain pickSessionGround terrain, unchanged
    expect(out.status.groundWeatherGlyph).toBeUndefined();
    expect(out.status.groundWeatherColor).toBeUndefined();
  });

  test("groundEnabled: false ⇒ no ground field at all regardless of the schedule (D3)", () => {
    const out = render({
      config: { gameFeel: "full", groundEnabled: false },
      stubGroundWeather: { active: true },
    });
    expect(out.status.ground).toBeUndefined();
    expect(out.status.groundWeatherGlyph).toBeUndefined();
  });

  test("subtle/off ⇒ no ground field, no weather fields, regardless of the schedule", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const out = render({ config: { gameFeel, groundEnabled: true }, stubGroundWeather: { active: true } });
      expect(out.status.ground).toBeUndefined();
    }
  });
});
```

  (Adapt to however `render()`/`out.status` actually shape the parsed
  `status.json` in the real file — mirror the existing ground `describe`
  block's own request/parse pattern in `state_wander.test.ts`, don't invent a
  new one.)

- [x] **Step 2 — verify failure:** the active-window test fails (no
  `groundWeatherGlyph`/`groundWeatherColor` written yet; `ground` still the
  plain terrain tile even when the stub says active).

- [x] **Step 3 — implement.** Extend the existing block at
  `state.ts:1505-1521` in place — do not duplicate the try/catch or the
  `startedAt` load:

```ts
let ground: string | undefined;
let groundColor: string | undefined;
let groundWeatherGlyph: string | undefined;
let groundWeatherColor: string | undefined;
if (idleGate === "full" && cfg.groundEnabled) {
  try {
    const { loadSnapshot } = require("./session.ts") as typeof import("./session.ts");
    const startedAt = loadSnapshot()?.startedAt;
    if (typeof startedAt === "number") {
      const { pickSessionGround, pickSessionWeather, isWeatherActive, buildWeatherTile } =
        require("./ground.ts") as typeof import("./ground.ts");
      const terrain = pickSessionGround(startedAt);
      ground = terrain.tile;
      groundColor = terrain.color;
      const schedule = pickSessionWeather(startedAt);
      if (isWeatherActive(schedule, Date.now() - startedAt)) {
        // schedule is non-null here (isWeatherActive(null, _) is always false).
        const woven = buildWeatherTile(terrain, schedule!.kind, startedAt);
        ground = woven.tile; // replaces the plain terrain tile for the render
        groundWeatherGlyph = woven.glyph;
        groundWeatherColor = woven.color;
        // groundColor is left as the terrain's own color, unchanged.
      }
    }
  } catch {
    // Ground is a best-effort delighter — a failure leaves the floor bare.
  }
}
```

  And add the two new fields to the `StatusState` object at `state.ts:1564`,
  matching the existing conditional-spread style:

```ts
...(ground ? { ground, groundColor } : {}),
...(groundWeatherGlyph ? { groundWeatherGlyph, groundWeatherColor } : {}),
```

  Also add `groundWeatherGlyph?: string; groundWeatherColor?: string;` to the
  `StatusState` interface fields documented at `state.ts:768-777`, following
  the existing `ground`/`groundColor` doc-comment style exactly (note they're
  "present iff a weather window is active", mirroring "present iff `ground`
  is" for `groundColor`).

- [x] **Step 4:** targeted PASS; full `bun test`; `bunx tsc --noEmit`.
  Confirm the pre-existing ground tests in `state_wander.test.ts` (terrain
  gating, `groundEnabled` opt-out) are still green **unstubbed** — i.e. this
  change must not require `stubGroundWeather` to be set for ordinary ground
  rendering to keep working, since most sessions have no active schedule.

- [x] **Step 5:** Commit: `feat(living-world): weave weather into the baked ground tile at write time` (+ trailer).

---

### Task 3: Shell-side per-glyph recolor

The only shell change in this plan. Bash already tiles/clips `GROUND_TILE`
verbatim (Task 2 made that string carry weather glyphs when active); this
task teaches the shell to recolor just those glyphs, and to do nothing at all
when the two new fields are absent.

**Files:** Modify `statusline/buddy-status.sh`, Test `server/statusline_render.test.ts`.

- [x] **Step 1 — DECISION GATE: verify `${var//lit/repl}` against the real chosen glyphs.**

  The design doc explicitly flags this as unverified (`design-ground-weather.md`
  §D5 mechanism, §Remaining unknowns). Run this throwaway probe with the
  actual glyphs Task 1 chose (`+`/`:`), in this repo's actual shell:

  ```bash
  _grow="„.„.+„.„.:„.„."
  W='+'; WC=$'\033[38;2;232;240;247m'
  GC=$'\033[2;38;2;74;124;63m'
  NC=$'\033[0m'
  _grow2="${_grow//$W/${WC}${W}${GC}}"
  printf '%s%s%s\n' "$GC" "$_grow2" "$NC" | cat -A | head -5
  echo "orig display-cell count: $(printf '%s' "$_grow" | wc -m)"
  echo "post-sub display-cell count (glyph-for-glyph, ignoring escapes): manually inspect the -A dump above"
  ```

  Confirm: (a) every literal `+` was replaced and no `:`/other glyph was
  touched, (b) no multi-byte terrain glyph (`„`) was corrupted or split
  mid-codepoint by the substitution, (c) the escape sequences the `-A` dump
  shows are well-formed (paired `$'\033[...m'` blocks, no stray bytes).

  - **Branch A — `${var//lit/repl}` behaves correctly.** This is bash's
    literal-substring parameter expansion; when the shell's locale is
    UTF-8-aware (check `echo $LANG $LC_ALL` in the probe too), pattern
    matching operates on characters, not raw bytes, so a single-cell glyph
    like `+`/`:`/`„` substitutes cleanly. If the probe confirms this, use it
    directly — cheapest, matches this file's existing style (it already uses
    `${_grow:0:_GRND_W}` slicing at `buddy-status.sh:1168`), no new
    dependency.
  - **Branch B — it misbehaves** (e.g. under a non-UTF-8 locale, or a
    multi-byte terrain glyph gets corrupted by an adjacent substitution).
    Fall back to a `sed`-based substitution
    (`sed "s/$W/${WC}${W}${GC}/g" <<< "$_grow"`, with `LC_ALL=en_US.UTF-8`
    forced for that one invocation) or, as a last resort, an explicit
    per-codepoint loop (`while IFS= read -r -n1 ch; do ...; done` over
    `_grow`) — slower, but the row is only ~80 cells and this runs once per
    render, so it's still cheap.

  Run the probe, state which branch the real environment needs, and proceed
  with that branch's mechanism. Prefer Branch A unless the probe disproves it.

- [x] **Step 2 — failing tests** (`statusline_render.test.ts`, extend the
  `describe("buddy-status.sh living ground …")` block at
  `statusline_render.test.ts:1571-1647` and its `StatusOverrides` interface):

```ts
// StatusOverrides, beside ground/groundColor (statusline_render.test.ts:100-103):
groundWeatherGlyph?: string;
groundWeatherColor?: string;
```

```ts
// In the fixture-building function, beside the ground/groundColor mapping
// (statusline_render.test.ts:182-184):
if (overrides.groundWeatherGlyph) {
  status.groundWeatherGlyph = overrides.groundWeatherGlyph;
  status.groundWeatherColor = overrides.groundWeatherColor ?? "e8f0f7";
}
```

```ts
test("active weather: the weather glyph renders in its own color, distinct from the terrain tint", () => {
  const out = renderStatus({
    gameFeel: "full",
    ground: "„.+„.+„.",
    groundColor: "4a7c3f",
    groundWeatherGlyph: "+",
    groundWeatherColor: "e8f0f7",
    columns: 80,
    showStats: false,
  });
  const g = groundLine(out); // reuse the existing local helper, statusline_render.test.ts:1575-1578
  expect(g).toContain("+");
  // The row must contain at least two distinct SGR color spans (terrain dim
  // color AND weather color) — assert the raw (non-stripped) output has more
  // than one distinct \033[...m escape sequence around the printed row.
  const raw = out.split("\n").filter((l) => l.includes("+"))[0] ?? "";
  const escapes = raw.match(/\x1b\[[0-9;]*m/g) ?? [];
  expect(new Set(escapes).size).toBeGreaterThan(1);
});

test("weather glyph substitution does not corrupt row width/clipping", () => {
  for (const columns of [40, 80, 120]) {
    const out = renderStatus({
      gameFeel: "full",
      ground: "„.+„.+„.",
      groundColor: "4a7c3f",
      groundWeatherGlyph: "+",
      groundWeatherColor: "e8f0f7",
      columns,
      showStats: false,
    });
    const g = stripAnsi(groundLine(out));
    expect([...g].length).toBeLessThanOrEqual(columns);
  }
});

test("no weather fields ⇒ ground row renders byte-identical to the current plain-terrain path", () => {
  const before = renderStatus({
    gameFeel: "full", ground: "„.", groundColor: "4a7c3f", columns: 80, showStats: false,
  });
  const after = renderStatus({
    gameFeel: "full", ground: "„.", groundColor: "4a7c3f", columns: 80, showStats: false,
    groundWeatherGlyph: undefined, groundWeatherColor: undefined,
  });
  expect(after).toBe(before);
});

test("subtle/off/combat still suppress the whole row even with weather fields present", () => {
  for (const gameFeel of ["subtle", "off"] as const) {
    const out = renderStatus({
      gameFeel, ground: "„.+", groundWeatherGlyph: "+", groundWeatherColor: "e8f0f7",
      columns: 80, showStats: false,
    });
    expect(stripAnsi(out)).not.toContain("+");
  }
});
```

- [x] **Step 3 — verify failure:** the color-span and glyph tests fail (no
  substitution logic exists yet; the row renders with exactly one escape as
  today).

- [x] **Step 4 — implement**, per the Step 1 GATE's chosen branch. Add jq
  extraction mirroring `$ground`/`$gcolor` (`buddy-status.sh:172-173`):

```
| (if $gf == "full" and $combat_on != 1 then (.groundWeatherGlyph // "") else "" end) as $gwglyph
| (if $gf == "full" and $combat_on != 1 then (.groundWeatherColor // "") else "" end) as $gwcolor
```

  Append to the joined array right after `$gcolor` (`buddy-status.sh:200-201`):

```
($gwglyph | gsub("[\\x01-\\x1f\\x7f]"; " ")),
($gwcolor | gsub("[\\x01-\\x1f\\x7f]"; " ")),
```

  Add `GROUND_WEATHER_GLYPH GROUND_WEATHER_COLOR` to the `IFS=$'\x1f' read`
  right after `GROUND_TILE GROUND_COLOR` (`buddy-status.sh:212`), before
  `_FRAME_B64`.

  In the render block (`buddy-status.sh:1151-1188`), after `_grow` is built
  and clipped (line 1168) and `_GC` is computed (lines 1177-1185), add the
  recolor step (guarded on the new fields being non-empty) before the final
  `echo` at line 1186:

```bash
if [ -n "$GROUND_WEATHER_GLYPH" ]; then
    _WC=$'\033[2m'
    case "$GROUND_WEATHER_COLOR" in
        [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])
            printf -v _WC '\033[38;2;%d;%d;%dm' \
                "$(( 16#${GROUND_WEATHER_COLOR:0:2} ))" \
                "$(( 16#${GROUND_WEATHER_COLOR:2:2} ))" \
                "$(( 16#${GROUND_WEATHER_COLOR:4:2} ))"
            ;;
    esac
    # Resume _GC (the terrain color), NOT NC, after each glyph — the row must
    # stay terrain-tinted between weather specks.
    _grow="${_grow//$GROUND_WEATHER_GLYPH/${_WC}${GROUND_WEATHER_GLYPH}${_GC}}"
fi
echo "${_GLEAD}${_GC}${_grow}${NC}"
```

  (Adjust the literal mechanics per whichever branch Step 1 settled on — if
  Branch B, replace the `${_grow//...}` line with the `sed`/loop equivalent,
  keeping the same `_WC`/`_GC` resume behavior.)

- [x] **Step 5:** targeted PASS (`bun test server/statusline_render.test.ts`);
  full `bun test`; `bunx tsc --noEmit`; `bash -n statusline/buddy-status.sh`.
  Confirm the byte-identical no-weather-fields test (Step 2) passes — this is
  the back-compat pin for every session without an active window, i.e. the
  overwhelming majority of renders.

- [x] **Step 6:** Commit: `feat(living-world): shell recolors ground-weather glyphs per-glyph` (+ trailer).

---

### Task 4: e2e + docs

**Files:** `docs/game-feel/CURRENT-STATE.md` (new dated section covering
living-ground + ground-weather together, since neither is documented there
yet), `docs/game-feel/living-world/design-ground-weather.md` (status header
→ implemented).

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

- [x] **Step 1 — manual e2e** (temp `CLAUDE_CONFIG_DIR`, the warning above in force):
  ```bash
  export CLAUDE_CONFIG_DIR="$(mktemp -d)"; echo "$CLAUDE_CONFIG_DIR"   # verify temp!
  # adopt/seed a buddy at gameFeel=full, groundEnabled=true, wander on
  # then, since the real schedule is seeded off a real session's startedAt
  # (not directly injectable from the CLI), use the same stub-loader idiom
  # Task 2's tests use, or hand-write status.json directly with a forced
  # ground/groundWeatherGlyph/groundWeatherColor triple, to render a few
  # simulated ticks and see:
  for tile in '„.' '„.+„.+' '„.'; do
    # simulate window closed / open / closed-again by hand-editing status.json
    # between renders (read-only against the temp dir's own status.json — this
    # is writing to the TEMP fixture, not real state, so it's fine under the
    # warning above)
    echo '{}' | CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" statusline/buddy-status.sh
  done
  ```
  Confirm: (a) no weather fields ⇒ the ground row renders exactly as it does
  today (plain repeating terrain, one dim color); (b) weather fields present
  ⇒ the weather glyph is visibly a different tint from the terrain glyphs,
  sparse (not every-other-cell dense), row width/margins unchanged; (c) the
  window "closing" (fields removed on a subsequent write) returns the row to
  plain terrain without leaving a stale weather-colored glyph behind; (d) an
  active combat scene still fully suppresses the row (Task 3's existing
  gate); (e) `groundEnabled: false` never shows weather regardless of the
  schedule (D3). STOP/BLOCKED on any failure. Delete the temp dir after.

- [x] **Step 2 — full validation sweep:** `bun test && bunx tsc --noEmit &&
  bash -n statusline/buddy-status.sh` — all green; record the exact new
  total (baseline 1027 + this plan's additions).

- [x] **Step 3 — docs.** `CURRENT-STATE.md` gets a new dated section (its
  first ever coverage of both the living-ground row and ground-weather
  together, since the ground row itself predates any CURRENT-STATE write-up)
  covering: what (fixed terrain row + occasional mid-session snow/rain), why
  (D1–D5 resolved decisions), mechanism (session-seeded schedule, derived
  `isWeatherActive` check, woven tile, per-glyph shell recolor), and tests
  (pure-core determinism/boundary sweep, `writeStatusState` wiring via the
  stub-loader idiom, shell render byte-identity pin). Explicitly note: zero
  new config keys (piggybacks `groundEnabled`, D3), zero new persisted state
  / `TRANSIENT_PREFIXES` entries (derived-schedule, D1 Branch B2 — B1
  rejected), zero per-event cost (one comparison per write, no reroll).
  `design-ground-weather.md`'s status header flips from "design resolved —
  ready for an implementation plan" to "implemented".

- [x] **Step 4:** Commit: `docs(living-world): ground weather shipped` (+ trailer).

---

## Self-review checklist (run after writing, before executing)

- **Every D-decision covered:**
  - D1 (mid-session start/stop, Branch B2 derived schedule, no persistence) — Task 1 (`pickSessionWeather`/`isWeatherActive`), Task 2 (wiring, explicitly no `writeEncounter`-style file).
  - D2 (new `GroundWeather` type, separate from `art.ts`'s `Weather`) — Task 1, called out in Recon facts as a hard naming/row separation.
  - D3 (piggyback `groundEnabled`, no new toggle) — Task 2 Step 3/4 tests pin this explicitly.
  - D4 (woven longer-period tile, zero shell changes for the fill/tiling itself) — Task 1's `buildWeatherTile`; Task 3 confirms the existing `_grow` fill loop (`buddy-status.sh:1166-1168`) is untouched.
  - D5 (per-glyph shell recoloring, Branch B) — Task 3 in full, including its DECISION GATE for the unverified `${var//lit/repl}` mechanics.
- **Standing constraints honored:** server bakes / bash cycles (all randomness lives in `ground.ts`, the shell only splices strings it's told); pure seeded cores with injected seed/date (Task 1's `pickSessionWeather`/`buildWeatherTile` take `seed`, Task 2's `elapsedMs = Date.now() - startedAt` is the one sanctioned impure read, mirroring `pickDayProp`); zero new rows (weather rides the existing ground row, no new line printed); the `groundEnabled` gate per D3 (no new config key); zero per-event cost (one derived comparison, no reroll per write — confirmed against the rejected `writeEncounter`/TTL precedent in Recon facts); guarded try/catch writes (Task 2 extends the existing try/catch, doesn't add a second one); no new `TRANSIENT_PREFIXES` entry since ground weather has no persistence (explicitly called out in Task 4's docs step and the Recon facts' B1-vs-B2 comparison).
- **No invented APIs:** every uncertain shape has a grep/read recon step and a stated branch — schedule odds/ranges (Task 1 Step 1, grounded in `VISITOR_ODDS`), weather glyph choice (Task 1 Step 2, grounded in the real `TERRAINS`/`MIRROR_SWAP`/`WEATHER_GLYPH` collision check), bash substitution mechanics (Task 3 Step 1, a real throwaway probe against the real glyphs). No function signature or line number above was guessed — every one was read or grepped from the actual working tree during planning.
- **Back-compat pins present:** Task 2 Step 4 (unstubbed ground tests still pass), Task 3 Step 2/5 (byte-identical no-weather-fields render test), Task 4 e2e (a).
- **Safety:** the verbatim `CLAUDE_CONFIG_DIR`-corruption warning is carried into Task 4 and marked a standing requirement.
