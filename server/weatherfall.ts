/**
 * Falling weather (living-world follow-up to ground-weather).
 * See docs/game-feel/living-world/plan-falling-weather.md (Task 1) and
 * design-weather-frontlayer.md (which retired the reserved sky rows).
 *
 * Pure, seeded core: bakes a short flipbook of weather frames depicting
 * flakes/drops falling top-to-bottom with staggered phases, then respawning.
 * The shell composites them over the whole widget block as a front layer.
 * `buddy-status.sh` cycles the returned frames by `NOW % period`, identically
 * to every other baked sequence in this codebase — this module never reads
 * the clock and performs no I/O.
 */
import { hashString, mulberry32 } from "./engine.ts";
import type { GroundWeather } from "./ground.ts";
import type { Theme } from "./theme.ts";

// Step 2 GATE (RESOLVED 2026-07-24): both glyphs verified via a real
// displayWidth()/mirrorFrame() probe — `❄` (U+2744) measures width 1 (not
// the 2 the plan worried dingbat-range codepoints might carry), `` ` `` is
// plain ASCII. Both are disjoint from every existing glyph set (ground
// terrains `„.,~▂·`, ground-weather `+:`, idle-FX weather `'*`) and from
// `MIRROR_SWAP`'s keys.
// Exported (plan-fullwidth-weather.md §4.2, no behavior change): state.ts's
// gap-band bake needs the active kind's plain glyph/hex to drive the shell's
// post-clip recolor step (D3) — the same shape ground.ts already exports for
// its own weather glyph.
export const SKY_FALL_GLYPH: Record<GroundWeather, string> = {
  snow: "❄",
  rain: "`",
};
// Theme-aware (2026-07-24 follow-up): the dark-theme snow value is a pale
// white-blue, nearly invisible on a light/white terminal background —
// mirrors `ground.ts`'s identical fix (same palette, kept in sync since
// the ground specks and falling flakes should read as one coherent scene).
export const SKY_FALL_COLOR: Record<Theme, Record<GroundWeather, string>> = {
  dark: {
    snow: "e8f0f7",
    rain: "5f8fc7",
  },
  light: {
    snow: "4a6f94",
    rain: "2f5c8f",
  },
};
export const ALL_SKY_FALL_GLYPHS: readonly string[] =
  Object.values(SKY_FALL_GLYPH);

// FALL_PERIOD picked at the recommended midpoint (Step 1 GATE, 2026-07-24):
// long enough that the loop point isn't glaringly obvious at ~1s/tick without
// ballooning the baked payload (contrast wander.ts's DEFAULT_LENGTH=180, not
// needed here). Exported so state.ts and buddy-status.sh reference one number.
export const FALL_PERIOD = 12;
const FALL_GAP_TICKS_MIN = 2; // ticks a flake waits offscreen before respawning
const FALL_GAP_TICKS_RANGE = 3;

// design-weather-frontlayer.md F1/F2/F6: the weather is no longer a band of
// reserved sky rows above the sprite — it is a front layer over the WHOLE
// widget block, so the bake has to be at least as tall as the tallest block
// the shell will ever print. `HOP_BUDGET=12` is that ceiling for the art
// stack; 14 clears it with room for a stats/bubble column that outgrows the
// art. Rows past the block's real height are simply never sliced.
//
// F7: the extra rows are free. Measured 10-render averages against the live
// script were 54 / 53 / 52 ms at 3 / 12 / 14 rows (status.json 10.0 → 22.1 →
// 24.8 KB) — tick cost here is process startup, not the size of the JSON jq
// walks. Sparse encoding was rejected on that evidence.
export const SKY_FALL_ROWS = 14;

// Full-width gap band (plan-fullwidth-weather.md §4.1/D2/D4): widens the sky
// band into the guaranteed-blank gap between the stats panel and the roaming
// cluster (buddy-status.sh's MID_SPACER/SPACER tail — see the plan doc's §2.1
// for why that segment is provably always blank). A second, independent,
// wider flipbook rather than a wider ART band, because the ART band's own
// width is baked to the sprite's own column and printing it wider would blow
// the row budget for no visual gain over the sprite itself.
//
// D4: reuse the ART band's own established flake density (not re-tuned) so
// visible flake count degrades gracefully with the ACTUAL live width bash
// clips to, with zero extra shell-side density logic.
export const FLAKE_DENSITY = 4 / 14; // ≈0.2857 — the original 4-flakes-in-14
// D2/§4.1: resolved from real measured SPAN/ROAM values across a COLS 40-200
// sweep (idle/combat ART_W, bubble present/absent) — covers the realistic
// 80-160 col range and the script's own 125-col fallback default in every
// configuration measured. Re-confirmed empirically against the live script
// during Task 0 of the plan (unchanged from the design doc's own number).
export const MAX_GAP_WIDTH = 110;

/**
 * Pure. Flake count that keeps **visible flakes per row** constant as the
 * baked field gets taller (design-weather-frontlayer.md F6).
 *
 * A flake draws only while `pos < rows`, so its duty cycle is
 * `rows / cycleLen` and the expected number visible on any single row is
 * `flakeCount * (rows / cycleLen) / rows` = `flakeCount / cycleLen` — which
 * does not mention `rows` at all. Preserving the shipped 3-row band's look
 * therefore means scaling by `(rows + meanGap)`, NOT by `rows`: scaling
 * linearly with height would have made a 14-row field ~4x too heavy.
 *
 * Anchored on the shipped 3-row numbers (31 flakes, mean cycle 6) so
 * `gapFlakeCount(3)` still returns 31 and the density this is calibrated
 * against stays visible in the arithmetic.
 *
 * @param rows - Baked field height. Callers should pass `SKY_FALL_ROWS`.
 * @returns Flake count to hand `buildFallingWeatherGapBand`.
 */
export function gapFlakeCount(rows: number): number {
  const meanGap = FALL_GAP_TICKS_MIN + (FALL_GAP_TICKS_RANGE - 1) / 2; // 3
  const perRow = Math.round(MAX_GAP_WIDTH * FLAKE_DENSITY) / (3 + meanGap);
  return Math.round(perRow * (rows + meanGap));
}

/**
 * Pure. Bakes `period` PLAIN (ANSI-free) weather-field frames, with no
 * embedded SGR (D3: `buddy-status.sh` must be able to `${line:0:N}` this
 * safely at render time, which embedded escapes would break — see
 * plan-fullwidth-weather.md §2.4 for the hazard this sidesteps). The shell
 * tints the glyph itself after slicing.
 *
 * Since design-weather-frontlayer.md this is the ONLY weather layer: the
 * separately-baked, SGR-carrying ART band that used to reserve three sky
 * rows above the sprite is gone (F1/F9), and these frames are composited
 * over the whole block as a front layer instead. The `sky-fall-gap:` hash
 * prefix is kept as-is so an in-flight session's flake pattern doesn't
 * reshuffle on upgrade.
 *
 * @param kind - "snow" or "rain", from the shared `WeatherSchedule` (same
 *   schedule the ART band and ground weather already use — no second roll).
 * @param seed - The session's `startedAt`, same seed the ART band uses (an
 *   independent RNG stream off it via the distinct hash prefix above).
 * @param width - Display-cell width of every band line. Callers should pass
 *   `MAX_GAP_WIDTH`.
 * @param rows - Number of lines per frame. Callers should pass
 *   `SKY_FALL_ROWS`.
 * @param period - Number of distinct frames to bake. Callers should pass
 *   `FALL_PERIOD`. The shell cycles these off `weatherFallSequence`.
 * @param flakeCount - Number of flakes drawn across the full baked width.
 *   Callers should pass `gapFlakeCount(rows)`.
 */
export function buildFallingWeatherGapBand(
  kind: GroundWeather,
  seed: number,
  width: number,
  rows: number,
  period: number,
  flakeCount: number,
): string[] {
  const rng = mulberry32(hashString(`sky-fall-gap:${seed}`));
  const g = SKY_FALL_GLYPH[kind];
  const cycleLen = rows + FALL_GAP_TICKS_MIN +
    Math.floor(rng() * FALL_GAP_TICKS_RANGE);
  const flakes = Array.from({ length: flakeCount }, () => ({
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
      if (pos < rows) grid[pos][f.col] = g;
    }
    frames.push(grid.map((r) => r.join("")).join("\n"));
  }
  return frames;
}
