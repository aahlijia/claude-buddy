/**
 * Day-seeded ambient prop selection — the pure core of P4 world dressing
 * (living-world). Given an injected date and the buddy's species, picks the
 * ground prop that rides the idle sprite (a daily-constant sprout/mushroom
 * by the feet, a pebble ahead — `art.ts`'s `PropArt`) and a time-of-day
 * palette/flavor key. No I/O, no clock reads inside this module — the
 * caller injects the `Date`, exactly like `activeSeasonal(now = new
 * Date())` in art.ts (P4 Task 3 supplies the one impure `new Date()` call,
 * at the `writeStatusState` write site — this module never calls it).
 *
 * A standalone module rather than folded beside `activeSeasonal` in art.ts,
 * so the selection core stays independently testable without pulling in
 * art.ts's render-path surface — the same rationale `visitor.ts` used for
 * the P2 wild-visitor core (pure roll, wired in by a later task).
 *
 * DECISION GATE (plan-p4.md Task 2 Step 1 — "what is season?") — **Branch
 * A**: reuse the existing `activeSeasonal` date-window calendar (art.ts)
 * rather than inventing a month→meteorological-season map. design.md's
 * "varies by time-of-day and season" reads as holiday-flavored — the only
 * season concept anywhere in the codebase is the tiny windowed `SEASONAL`
 * calendar already used for the beanie hat — not meteorological, and adding
 * a four-season map would be genuinely new, unmaintained content the design
 * doesn't ask for. A live `SEASONAL` window swaps the `feet` motif to a
 * matching glyph instead of drawing from the base set.
 */

import { hashString, mulberry32, type Species } from "./engine.ts";
import { activeSeasonal, type PropArt } from "./art.ts";

// ─── Curated glyph sets (tiny — dated/flavor content is a maintenance tail) ──

/**
 * Daily-constant ground growth motifs for the `feet` anchor (sprout /
 * clover / flower family). Hand-verified: ANSI-free, a single display
 * cell, and absent from `MIRROR_SWAP` (props.test.ts pins both — the idle
 * buddy is never mirrored, but it's a cheap defensive check).
 */
const FEET_PROPS: readonly string[] = [
  "⚘", // ⚘ flower
  "♣", // ♣ clover
  "✿", // ✿ flower
  "☘", // ☘ shamrock
];

/**
 * The kicked pebble for the `ahead` anchor. P4 Task 4 advances its baked
 * *column*; the glyph itself is a daily constant, drawn here.
 */
const AHEAD_PROPS: readonly string[] = [
  ".", // pebble
  "∘", // ∘ pebble
  "◦", // ◦ pebble
  "•", // • pebble
];

/**
 * Seasonal override for `feet`: when a `SEASONAL` window (art.ts) is
 * active, its label swaps the daily growth motif for a matching glyph
 * instead of drawing from `FEET_PROPS` — the season "shows through" the
 * prop the same way it already shows through the beanie hat.
 */
const SEASONAL_FEET_PROP: Readonly<Record<string, string>> = {
  winter: "❅", // ❅ snowflake
  "new-year": "✧", // ✧ sparkle
};

/** Every glyph this module can ever place — for the ANSI/mirror-safety test. */
export const ALL_PROP_GLYPHS: readonly string[] = [
  ...FEET_PROPS,
  ...AHEAD_PROPS,
  ...Object.values(SEASONAL_FEET_PROP),
];

// ─── Time-of-day palette buckets ──────────────────────────────────────────

/**
 * A time-of-day flavor key for the prop's palette. Deliberately distinct
 * from `getTimeOfDayMood` (mood.ts): that bucketer reads the clock directly
 * (impure) and buckets hours for a different purpose (mood, not prop
 * flavor) — this one takes an injected hour, mirroring `activeSeasonal`.
 */
export type TimeBucket = "dawn" | "day" | "dusk" | "night";

function timeBucket(hour: number): TimeBucket {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 18) return "day";
  if (hour >= 18 && hour < 21) return "dusk";
  return "night";
}

const PALETTE_BY_BUCKET: Readonly<Record<TimeBucket, string>> = {
  dawn: "pastel",
  day: "bright",
  dusk: "amber",
  night: "dim",
};

// ─── Selection core ────────────────────────────────────────────────────────

/**
 * The day's prop + flavor for one species. `prop` feeds `applyProp` (art.ts)
 * directly; `palette` is a flavor label for downstream consumers, not an
 * ANSI/SGR code — prop glyphs stay plain text so a colored cell never
 * ANSI-taints the row `overlayGlyph`'s refusal check inspects (a tainted
 * row would silently refuse every later overlay on that line, including
 * gear).
 */
export interface DayProp {
  prop: PropArt;
  palette: string;
}

function pick(rng: () => number, arr: readonly string[]): string {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Pick the day's ambient prop + time-of-day palette for `species`. PURE:
 * the date is injected and never read from the clock in here, mirroring
 * `activeSeasonal(now = new Date())`. The `feet` and `ahead` glyphs are
 * daily constants — identical for every hour of the same calendar day —
 * while `palette` varies with the injected hour.
 *
 * @param now - The date/time to derive today's prop and the palette from.
 * @param species - The buddy's species, folded into the day-seed so
 *   different species don't necessarily render an identical prop on the
 *   same day.
 * @returns The day's `PropArt` (feet + ahead) and a palette flavor key.
 */
export function pickDayProp(now: Date, species: Species): DayProp {
  const dayKey =
    `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const rng = mulberry32(hashString(`prop:${dayKey}:${species}`));
  // Fixed draw order regardless of season, so the rng cadence never shifts
  // shape between seasonal and non-seasonal days: draw feet, then ahead,
  // then apply the seasonal override (if any) to the feet result.
  const feetDraw = pick(rng, FEET_PROPS);
  const ahead = pick(rng, AHEAD_PROPS);
  const season = activeSeasonal(now);
  const feet = (season && SEASONAL_FEET_PROP[season.label]) || feetDraw;
  const palette = PALETTE_BY_BUCKET[timeBucket(now.getHours())];
  return { prop: { feet, ahead }, palette };
}
