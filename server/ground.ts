/**
 * Session-seeded ground / environment selection — the pure core of the
 * "living ground" row (living-world follow-up, 2026-07-24). Given a session
 * seed (the session's `startedAt` epoch, injected by the `writeStatusState`
 * write site — this module never reads the clock or disk), picks the terrain
 * that paints the FIXED, full-width ground row beneath the whole buddy widget.
 *
 * The terrain is constant WITHIN a session and re-rolls the moment a new
 * session starts (a fresh `startedAt`), satisfying the requirement that "the
 * ground can change on new sessions". Crucially the seed is NOT `new Date()`
 * (props.ts uses that, but the status line rewrites ~1×/s, so a clock seed
 * would make the ground flicker every tick) — it is the session-stable
 * `startedAt`, exactly the value `pendingSeed` (session.ts) already seeds off.
 *
 * A standalone module (mirrors `props.ts` / `visitor.ts`): the selection core
 * stays independently testable without importing art.ts's render surface.
 * Unlike props (which composite glyphs INTO the sprite frames and so must obey
 * `overlayGlyph`'s ANSI-free contract), the ground is a separate status.json
 * field the shell tiles + colours itself — so a colour rides alongside the
 * glyph tile here, kept as a plain hex string (never an SGR code) so nothing
 * downstream mistakes it for pre-tainted art.
 */

import { hashString, mulberry32 } from "./engine.ts";
import type { Theme } from "./theme.ts";

/** One environment the ground row can render as. */
export interface Terrain {
  /** Stable id — for tests / telemetry, never shown to the user. */
  name: string;
  /** The repeating unit the shell lays edge-to-edge to fill the row. Every
   *  glyph MUST be a single display cell and ANSI-free: the shell tiles and
   *  clips by code-point count, which only equals the column count when each
   *  code point is exactly one column wide. */
  tile: string;
  /** 6-hex RGB the shell dims and applies to the whole row. A plain hex string,
   *  never an SGR/ANSI code (see the module note). */
  color: string;
}

/**
 * The environment table. Deliberately tiny — hand-picked single-width,
 * ANSI-free glyphs (verified absent from `MIRROR_SWAP`; the ground row is
 * never mirrored, but it's a cheap defensive check the test pins). Distinct
 * textures AND colours so two sessions on different terrains read apart at a
 * glance. Grass leads because the requirement did.
 */
const TERRAINS: readonly Terrain[] = [
  { name: "meadow", tile: "„.", color: "4a7c3f" }, // grass — green
  { name: "field", tile: ".,", color: "8a7c3f" }, // dry field — olive
  { name: "water", tile: "~ ", color: "3f6f8a" }, // ripples — blue
  { name: "sand", tile: ". ", color: "b0995f" }, // dunes — tan
  { name: "stone", tile: "▂▂", color: "7a7a7a" }, // rock — gray
  { name: "tundra", tile: "· ", color: "8a9aa5" }, // frost — pale blue
];

/** Every glyph this module can ever place (tiles minus spaces) — for the
 *  ANSI/mirror-safety test, mirroring props.ts's `ALL_PROP_GLYPHS`. */
export const ALL_GROUND_GLYPHS: readonly string[] = [
  ...new Set(
    TERRAINS.flatMap((t) => Array.from(t.tile)).filter((g) => g !== " "),
  ),
];

/**
 * Pick the session's terrain. PURE: the seed is injected and never read from
 * the clock/disk in here. Deterministic per seed — the same `startedAt` always
 * yields the same terrain (stable for the whole session), a different
 * `startedAt` re-rolls it (a new session can change the ground).
 *
 * @param seed - The session's `startedAt` epoch (session.ts's
 *   `SessionSnapshot.startedAt`). Any finite number is accepted; the hash
 *   folds it into the RNG so adjacent session starts still scatter well.
 * @returns The chosen `Terrain` (tile + colour).
 */
export function pickSessionGround(seed: number): Terrain {
  const rng = mulberry32(hashString(`ground:${seed}`));
  return TERRAINS[Math.floor(rng() * TERRAINS.length)];
}

// ─── Ground weather (living-world follow-up) ─────────────────────────────────
//
// Occasional, randomized, mid-session snow/rain layered onto the fixed
// terrain row as sparse, per-glyph-tinted specks. Two independent pure
// pieces, mirroring `props.ts`'s "distinct seed prefix per draw" idiom so
// each roll is its own RNG stream off the same session `startedAt`:
//
//   1. `pickSessionWeather` — ONCE per session, decides whether this session
//      gets weather at all, and if so which kind + when it starts/ends.
//   2. `isWeatherActive` — a pure comparison against `elapsedMs`, called on
//      every write with no reroll (zero per-event cost, matching the rest of
//      this arc). `buildWeatherTile` then weaves the chosen glyph into a
//      longer period so the terrain's own repeating unit stays intact between
//      specks.

/** A kind of ground weather. Distinct from `art.ts`'s idle-FX-row `Weather`
 *  type (`"drizzle" | "sparkle"`, driven by coding-session signals) — these
 *  are unrelated concepts that happen to share the English word "weather"
 *  and live on different rows; this module never imports that one. */
export type GroundWeather = "snow" | "rain";

/** When (and for how long, and as what) a session's ground weather runs.
 *  `null` from `pickSessionWeather` means the session has no weather at all. */
export interface WeatherSchedule {
  kind: GroundWeather;
  /** Offset from session start (ms) at which the weather window opens. */
  startMs: number;
  /** How long the window stays open (ms) once it opens. */
  durationMs: number;
}

// ~1-in-10 sessions get weather at all — same order of magnitude as
// `visitor.ts`'s `VISITOR_ODDS = 12` (the repo's one existing "rare
// session/commit event" precedent), tuned slightly more frequent since a
// session that gets weather must also actually observe both its start AND
// its stop (see the range constants below).
const GROUND_WEATHER_ODDS = 10;
// Starts early enough in the session that it's essentially never already
// running before the buddy renders for the first time, but not so early it
// always fires in the same first few seconds.
const WEATHER_START_MIN_MS = 30_000; // 30s
const WEATHER_START_RANGE_MS = 9 * 60_000; // + up to ~9min ⇒ 30s..~10min
// Short enough relative to a typical coding session that both the start and
// the stop are actually observed mid-session (a window spanning most of the
// session would only ever show its "start" half in practice).
const WEATHER_DURATION_MIN_MS = 2 * 60_000; // 2min
const WEATHER_DURATION_RANGE_MS = 6 * 60_000; // + up to 6min ⇒ 2..8min

// Glyph/colour choice (Task 1 Step 2 GATE): `+` and `:` are disjoint from
// `ALL_GROUND_GLYPHS` (`„ . , ~ ▂ ·`, incl. the `field` terrain's own `,` —
// the collision the design doc's `,` placeholder would have hit), from
// `MIRROR_SWAP`'s keys (`( ) < > [ ] { } / \`), and from `art.ts`'s idle-FX-row
// `WEATHER_GLYPH` set (`' *`) — kept visually distinct from that unrelated
// feature even though the two never share a row. Verified again below by the
// disjointness test at module load (`ALL_GROUND_WEATHER_GLYPHS`).
const WEATHER_GLYPH: Record<GroundWeather, string> = {
  snow: "+",
  rain: ":",
};

// Theme-aware (2026-07-24 follow-up): the dark-theme snow value is a pale
// white-blue, nearly invisible on a light/white terminal background — the
// same problem `theme.ts`'s rarity colors already solve for. Light variants
// are darkened/more-saturated, mirroring that table's dark→light approach.
const WEATHER_COLOR: Record<Theme, Record<GroundWeather, string>> = {
  dark: {
    snow: "e8f0f7", // pale white-blue
    rain: "5f8fc7", // steel blue
  },
  light: {
    snow: "4a6f94", // slate blue — readable on a light background
    rain: "2f5c8f", // deep blue
  },
};

/** Every glyph ground weather can ever place — for the disjointness/ANSI/
 *  mirror-safety tests, mirroring `ALL_GROUND_GLYPHS`. */
export const ALL_GROUND_WEATHER_GLYPHS: readonly string[] =
  Object.values(WEATHER_GLYPH);

/**
 * Decide, once per session, whether this session gets ground weather and —
 * if so — its kind and timing window. PURE: seed injected, no clock/disk
 * read. Distinct hash prefix (`ground-weather:`) from `pickSessionGround`'s
 * (`ground:`) so the two draws are independent streams off the same
 * `startedAt` (the `props.ts` "independent streams" idiom).
 *
 * @param seed - The session's `startedAt` epoch.
 * @returns The session's schedule, or `null` if this session has no weather.
 */
export function pickSessionWeather(seed: number): WeatherSchedule | null {
  const rng = mulberry32(hashString(`ground-weather:${seed}`));
  if (rng() >= 1 / GROUND_WEATHER_ODDS) return null;
  const kind: GroundWeather = rng() < 0.5 ? "snow" : "rain";
  const startMs =
    WEATHER_START_MIN_MS + Math.floor(rng() * WEATHER_START_RANGE_MS);
  const durationMs =
    WEATHER_DURATION_MIN_MS + Math.floor(rng() * WEATHER_DURATION_RANGE_MS);
  return { kind, startMs, durationMs };
}

/**
 * Is the schedule's window open right now? PURE comparison, no reroll — the
 * only thing checked on every write (zero per-event cost).
 *
 * @param schedule - The session's schedule (or `null` for no weather).
 * @param elapsedMs - `Date.now() - startedAt`, computed by the caller.
 */
export function isWeatherActive(
  schedule: WeatherSchedule | null,
  elapsedMs: number,
): boolean {
  if (!schedule) return false;
  return (
    elapsedMs >= schedule.startMs &&
    elapsedMs < schedule.startMs + schedule.durationMs
  );
}

/** A terrain tile woven with sparse weather specks — replaces the plain
 *  `Terrain.tile` as the rendered ground tile while a window is active. */
export interface WeatherTile {
  tile: string;
  glyph: string;
  color: string;
}

const WEAVE_PERIOD_MIN = 24;
const WEAVE_PERIOD_RANGE = 17; // 24..40
const WEAVE_SPECK_DIVISOR = 7; // roughly 1 speck per 7 cells

/**
 * Weave the given terrain's repeating unit into a longer period and scatter
 * a handful of weather glyphs into it. PURE, its own distinct hash prefix
 * (`ground-weather-weave:`) — an independent stream from both
 * `pickSessionGround` and `pickSessionWeather`, so re-weaving never rerolls
 * whether/when weather happens, and vice versa.
 *
 * @param terrain - The session's chosen terrain (`pickSessionGround`).
 * @param weather - Which kind of weather to weave in.
 * @param seed - The session's `startedAt` epoch.
 * @param theme - The active theme (`cfg.theme`, "light" or resolved
 *   "dark"/"auto") — selects a readable color for that background.
 */
export function buildWeatherTile(
  terrain: Terrain,
  weather: GroundWeather,
  seed: number,
  theme: Theme,
): WeatherTile {
  const rng = mulberry32(hashString(`ground-weather-weave:${seed}`));
  const glyph = WEATHER_GLYPH[weather];
  const color = WEATHER_COLOR[theme][weather];
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
