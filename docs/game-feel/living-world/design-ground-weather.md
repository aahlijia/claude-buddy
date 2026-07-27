# Ground weather — design (living-world follow-up)

_Drafted 2026-07-24 · branch `feature/interactive-fight-scene`_
_Status: **implemented (2026-07-24).** See
[CURRENT-STATE.md](../CURRENT-STATE.md#living-ground--ground-weather-2026-07-24)
for the shipped snapshot (all four tasks of
[plan-ground-weather.md](plan-ground-weather.md), 1044 tests pass). Depended on
the uncommitted "living ground" row (`server/ground.ts`, `cfg.groundEnabled`)
landing first — this doc treated that as its baseline, and both remain
uncommitted together on this branch._

**Goal:** when the user has the living-ground floor on, let a session
occasionally be snowy or rainy, with genuine mid-session start/stop — tiny
flakes/drops scattered across that fixed terrain row, in their own tint — as
a randomized ambient event, not a permanent per-terrain decoration.

---

## Recap: what "living ground" already does (undocumented elsewhere)

No design doc exists yet for the ground row itself — it shipped directly this
session. For this doc's purposes:

- `server/ground.ts`: `pickSessionGround(seed)` is a pure core —
  `mulberry32(hashString("ground:${seed}"))` picks one of 6 hand-picked
  `Terrain` entries (`{name, tile, color}`) from a tiny table (meadow/field/
  water/sand/stone/tundra). `seed` is the session's `startedAt`, never the
  clock — the terrain is constant for the whole session and only re-rolls on
  a new one.
- `server/state.ts` (`writeStatusState`): gated on `idleGate === "full" &&
  cfg.groundEnabled`; reads `loadSnapshot()?.startedAt`, calls
  `pickSessionGround`, writes `ground` (the tile string) + `groundColor` (a
  plain 6-hex string, never SGR) into `status.json`. Best-effort — a failure
  just leaves the floor bare.
- `statusline/buddy-status.sh`: re-gates to `full` + no active combat scene in
  jq, then — **after** the whole widget block, not per-frame, not riding the
  wander offset — computes `_GRND_W = COLS - RIGHT_SAFETY -
  STATS_LEFT_MARGIN`, repeats `GROUND_TILE` to fill it
  (`while len(_grow) < W: _grow += TILE`, then clip), and prints it once with
  a single dim RGB escape derived from `GROUND_COLOR`.

The load-bearing detail for this doc: **the row's width is only known in
bash, at render time** (it depends on `$COLUMNS`), unlike every sprite frame
in this codebase, which is a fixed-width baked string. That's why the ground
row is filled by *repeating* a short server-baked unit rather than printing a
literal server-baked line.

---

## The constraint that governs everything

Because bash fills the row by repeating `GROUND_TILE`, "sparse, scattered
flakes" cannot be achieved by baking a flake into the 1–2-glyph terrain unit
itself — repeating a 2-cell unit with a flake in it produces a flake every 1–2
cells: dense and regular, not sparse and drifting. And because the shell
applies exactly **one** color escape to the whole printed row today, a flake
baked into the tile would inherit the terrain's own tint (a green-tinted
snowflake on meadow) unless the shell is taught to recolor individual
glyphs — which the resolved design below asks it to do.

Layered on top of the arc's standing constraints this follow-up already
honors (server bakes / bash cycles, pure seeded cores, zero per-event cost,
guarded writes): no live randomness in bash, and — critically — **no reroll
on every ~1s status write**, or weather would flicker on and off every render
the way a naive "roll each write" implementation would. The resolved design
satisfies this by scheduling weather once, at session-seed time, and merely
*checking the clock against that schedule* on each write — the schedule
itself never re-rolls mid-session.

---

## Recon facts

- **`Weather` already exists** (`art.ts`, `type Weather = "drizzle" |
  "sparkle"`) — but it's unrelated to what's being proposed here: it's driven
  by *coding-session signals* (error tier / clean streak), rendered as sparse
  glyphs on the **idle FX row** via `overlayFxRow`, at **fixed, non-random**
  offsets (`[1, -2, 3, -4]`). Snow/rain must not reuse this name or row — it's
  a different signal (chance, not performance) painted on a different row
  (ground, not the sprite's FX row).
- **Precedent for a randomized, persisted, event-triggered mechanism**:
  `visitor.ts`'s `rollVisitor` — seeded **per-commit**
  (`hashString("visitor:${user}:${startedAt}")`), not per status write;
  persisted via a `writeEncounter`-style side-channel file, registered in
  `TRANSIENT_PREFIXES`, TTL-checked at read (`readEncounter`). **Not used
  here** — see D1 below; it was evaluated and rejected as overkill (no
  natural "cause" to hang a weather trigger off, and real new persistence
  surface) in favor of a cheaper derived-schedule approach.
- **Precedent for a randomized, session-scoped, unpersisted "event"**: the
  ground terrain itself. One roll off `startedAt`, re-derived identically on
  every write, zero state file, zero TTL logic. This *is* the shape reused
  for the weather schedule (D1) — just with a time-window check layered on.
- **Precedent for the one sanctioned impure clock read at a write site**:
  `pickDayProp(new Date(), ...)` in `state.ts` — the pure core takes an
  injected `Date`, and `writeStatusState` is the one place that calls
  `new Date()`. The weather schedule's `elapsedMs = Date.now() - startedAt`
  check reuses this exact idiom.
- No row anywhere in the shell is currently recolored per-glyph — every
  colored span (ground, stats, art) gets exactly one escape sequence.
  Per-glyph coloring (D5) is new shell surface, not a reuse of an existing
  idiom, though bash's `${var//search/replace}` literal-substring
  parameter expansion looks like the natural tool for it — **to be verified
  against real multi-byte glyphs during planning**, not assumed here.
- `ground.test.ts` already pins the contract new weather glyphs must also
  satisfy: single display cell, ANSI-free, and absent from `MIRROR_SWAP`
  (defensive — the ground row is never actually mirrored).

---

## Resolved decisions

| # | Question | Decision |
| --- | --- | --- |
| D1 | Session-scoped only, or mid-session start/stop? | **Mid-session start/stop, via Branch B2 — a pre-scheduled, fully derived window (no persistence).** See mechanism below. |
| D2 | New type or reuse `Weather`? | **New type**, `GroundWeather = "snow" \| "rain"` in `ground.ts`, fully separate from `art.ts`'s `Weather`. |
| D3 | New config key or piggyback on `groundEnabled`? | **Piggyback** — weather only ever schedules when `groundEnabled` is true. No new toggle. |
| D4 | How does a sparse pattern get baked into one repeatable tile string? | **Bake a longer period** (roughly 24–40 cells) woven by the seeded RNG — mostly terrain glyphs, a handful of weather glyphs at scattered offsets — as `GROUND_TILE` for the duration of an active window. Zero shell changes for the tiling/fill itself (bash already repeats an arbitrary-length string). |
| D5 | Single row-wide tint, or per-glyph color? | **Branch B — per-glyph recoloring.** The shell gains a small, bounded substitution step so weather glyphs render in their own color, distinct from the terrain tint. |

---

## D1 mechanism — the derived weather schedule (Branch B2)

No new file, no TTL, no `TRANSIENT_PREFIXES` entry, no trigger-call-site
question. The session's weather (if any) is decided **once**, purely, from
the same seed family as the terrain — then every write just asks "is now
inside the scheduled window?"

```ts
// server/ground.ts

export type GroundWeather = "snow" | "rain";

export interface WeatherSchedule {
  kind: GroundWeather;
  /** Offset from session start (ms) at which weather begins. */
  startMs: number;
  /** How long the window stays open (ms). */
  durationMs: number;
}

/** Pure. A distinct seed prefix from `pickSessionGround`'s so the two draws
 *  are independent streams off the same `startedAt`. Low, tunable odds of
 *  any weather at all; snow/rain roughly even; start offset + duration drawn
 *  from small fixed ranges (exact numbers are a planning-time GATE, not
 *  decided here). */
export function pickSessionWeather(seed: number): WeatherSchedule | null {
  const rng = mulberry32(hashString(`ground-weather:${seed}`));
  // ... gate roll, kind roll, startMs/durationMs roll — ranges TBD in plan.
}

/** Pure. The only thing checked on every write. */
export function isWeatherActive(
  schedule: WeatherSchedule | null,
  elapsedMs: number,
): boolean {
  if (!schedule) return false;
  return elapsedMs >= schedule.startMs
    && elapsedMs < schedule.startMs + schedule.durationMs;
}
```

At the `writeStatusState` write site (mirroring the `pickDayProp(new
Date(), ...)` idiom exactly): read `startedAt` (already loaded for the
terrain draw), call `pickSessionWeather(startedAt)` once, compute `elapsedMs
= Date.now() - startedAt`, and gate the woven-tile bake (D4) + recolor data
(D5) on `isWeatherActive(schedule, elapsedMs)`. When false — before the
window, after it, or no schedule at all — `GROUND_TILE` is exactly today's
plain terrain tile, byte-identical to the no-weather path.

This means weather is **deterministic and replayable**: the same session
(same `startedAt`) always gets the same schedule, so a test can inject any
`now` and assert the exact on/off state — no flakiness, no live randomness,
and the "zero per-event cost" constraint holds trivially (it's one extra
pure comparison per write, not a new roll).

Trade-off accepted: the schedule can't react to anything happening in the
session (a commit, an error streak) — it's purely time-based. That matches
"randomized weather events," not "weather caused by your coding," which is
what was asked for.

---

## D5 mechanism — per-glyph recoloring (Branch B)

Rather than baking explicit column positions, the server exposes **which
glyph(s) mean weather** and **what color they get**; the shell recolors by
matching those glyphs wherever they land in the (already server-baked,
already-tiled) row string:

- New `status.json` fields, present only while a window is active:
  `groundWeatherGlyph` (the glyph(s) to recolor, e.g. `"+"` or `","`) and
  `groundWeatherColor` (a plain 6-hex string, same shape as `groundColor`).
- Shell: after building `_grow` (the tiled/clipped row) exactly as today,
  wrap each occurrence of the weather glyph with a second color escape
  before the base terrain escape resumes — bash's `${_grow//"$WGLYPH"/...}`
  literal-substring parameter expansion is the natural tool, since glyphs
  are already guaranteed single-cell and ANSI-free (`ground.test.ts`'s
  contract, extended to weather glyphs). **Exact syntax against real
  multi-byte UTF-8 glyphs needs verification during planning** — flagged in
  Recon facts, not assumed proven here.
- Still zero *live* randomness in bash — every value substituted was decided
  server-side; the shell is only ever splicing in strings it's told to.

---

## Proposed mechanism (end to end)

1. `ground.ts` gains `GroundWeather`, `WeatherSchedule`,
   `pickSessionWeather` (D1), and a woven-tile builder for D4 (mostly
   terrain glyphs, sparse weather glyphs, ~24–40 cells).
2. At the existing `idleGate === "full" && cfg.groundEnabled` try/catch in
   `writeStatusState`: after picking the terrain, also call
   `pickSessionWeather(startedAt)` and `isWeatherActive(schedule,
   Date.now() - startedAt)`.
   - Inactive/no schedule ⇒ `ground`/`groundColor` exactly as today; no new
     fields written.
   - Active ⇒ `ground` becomes the woven tile; `groundColor` unchanged;
     `groundWeatherGlyph` + `groundWeatherColor` are added.
3. `buddy-status.sh`: unchanged tiling/fill logic (D4 needs none); gains the
   small glyph-substitution step (D5) only when the two new fields are
   present. Still re-gated on `gf == "full" && combat_on != 1`, same as
   today.
4. Glyphs: their own single-width/ANSI-free/`MIRROR_SWAP`-safe set, distinct
   from both the `TERRAINS` glyphs and the idle-row's existing `*`/`'`.
   Candidates to verify: `+` for snow, `,` for rain.
5. No attempt at diegetic plausibility (rain over sand, snow over water) —
   ambient decoration, not simulation.

---

## Testing approach

- Pure-core determinism, mirroring `ground.test.ts` and `props.test.ts`'s
  injected-input shape:
  - same seed ⇒ same schedule (or same "no weather"); a sweep of seeds
    produces both outcomes.
  - `isWeatherActive` boundary tests: just before `startMs` (false), exactly
    at `startMs` (true), just before `startMs + durationMs` (true), at/after
    the end (false) — a fixed schedule swept across injected `elapsedMs`
    values, no wall-clock dependency.
  - every candidate weather glyph is single-cell, ANSI-free, and
    `MIRROR_SWAP`-safe.
- `state_wander.test.ts`-style fixture with an injected/fixed `now`: full +
  `groundEnabled` + a weather-forcing seed + `now` inside the window renders
  a `GROUND_TILE` containing a weather glyph plus the two new color fields;
  the same seed with `now` outside the window renders the plain tile with
  neither new field; `groundEnabled: false` never schedules weather
  regardless of seed; `subtle`/`off` still render no ground row at all.
- No-weather-scheduled path renders byte-identical to current
  `pickSessionGround` output (back-compat pin).
- Shell-level test (extending this session's `statusline_render.test.ts`
  additions): the glyph-substitution step recolors only the weather glyph,
  leaves row width/clipping/margins unchanged, and is a no-op when the two
  new fields are absent.

---

## Deferred / explicitly out of scope

- **Branch B1** (persisted, event-triggered weather, visitor-style) —
  evaluated and rejected in favor of B2: bigger footprint (new file, TTL/
  duration persistence, `TRANSIENT_PREFIXES` entry, uninstall-cleanup test)
  and no natural trigger event to hang a "weather just started" roll off.
- Weather touching anything beyond the ground row (e.g. the buddy's own idle
  frames reading as "wet" or "snowy") — stays a ground-row-only effect, no
  coupling into `art.ts`'s sprite compositing.
- Any precedence/interaction rule between ground-weather and the existing
  code-signal `Weather` (drizzle/sparkle) — the two are visually independent,
  live on different rows, and are allowed to simply coexist.
- Multiple weather windows in one session — still cheap under B2 if wanted
  later (draw N windows instead of 1, still pure/derived), just not needed
  for a first cut.

---

## Remaining unknowns for the implementation plan (not design blockers)

- Exact odds of any weather occurring in a session, exact start-offset and
  duration ranges, and the snow-vs-rain split — placeholder numbers only,
  to be picked (and made easily tunable) during planning.
- Final glyph choices (`+`/`,` are candidates, not committed) — subject to
  the blank-cell/ANSI-free/`MIRROR_SWAP` probe the same way `ground.ts`'s
  terrain glyphs were chosen.
- The exact bash substitution mechanics for D5 (verify `${var//lit/repl}`
  behaves correctly against the chosen multi-byte glyphs in this shell
  environment) — a recon step for Task 1 of the plan, not resolved here.
