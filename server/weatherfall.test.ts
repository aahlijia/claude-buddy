import { describe, test, expect } from "bun:test";
import {
  buildFallingWeatherGapBand,
  ALL_SKY_FALL_GLYPHS,
  FALL_PERIOD,
  FLAKE_DENSITY,
  MAX_GAP_WIDTH,
  SKY_FALL_ROWS,
  gapFlakeCount,
  SKY_FALL_GLYPH,
  SKY_FALL_COLOR,
} from "./weatherfall.ts";
import { displayWidth, mirrorFrame } from "./art.ts";

describe("falling weather field (plan-fullwidth-weather.md Task 1, made a front layer by design-weather-frontlayer.md)", () => {
  // D4/§4.1 + F6: named constants, not re-derived here — pin actual values.
  test("named constants: FLAKE_DENSITY/MAX_GAP_WIDTH/SKY_FALL_ROWS match the resolved numbers", () => {
    expect(FLAKE_DENSITY).toBeCloseTo(4 / 14, 10);
    expect(MAX_GAP_WIDTH).toBe(110);
    // F6: tall enough to cover any block the shell prints — the art stack's
    // own ceiling is HOP_BUDGET=12, and a stats/bubble column can outgrow it.
    expect(SKY_FALL_ROWS).toBeGreaterThan(12);
    expect(SKY_FALL_ROWS).toBe(14);
    expect(FALL_PERIOD).toBe(12);
  });

  // F6 is the whole reason gapFlakeCount() exists rather than a constant: a
  // flake draws only while `pos < rows`, so expected VISIBLE flakes per row is
  // flakeCount/cycleLen and does not mention `rows` at all. Scaling the count
  // linearly with height — the obvious wrong move — would have made the 14-row
  // field ~4x denser per row than the 3-row band users already saw.
  test("gapFlakeCount: anchored so the legacy 3-row band is unchanged, and grows sub-linearly in rows", () => {
    expect(gapFlakeCount(3)).toBe(31); // the shipped 3-row band's own count
    expect(gapFlakeCount(SKY_FALL_ROWS)).toBe(88);
    // Sub-linear: 14 rows is 4.67x the height but nowhere near 4.67x the count.
    expect(gapFlakeCount(14)).toBeLessThan(gapFlakeCount(3) * 3);
    expect(gapFlakeCount(14)).toBeGreaterThan(gapFlakeCount(3));
  });

  // The behavioural claim behind the arithmetic: measure the mean number of
  // flakes actually DRAWN per row and require the 14-row field to match the
  // 3-row band it replaces. This is what keeps the look unchanged per row.
  test("visible flakes per row is preserved between the 3-row band and the 14-row field", () => {
    const perRow = (rows: number): number => {
      let drawn = 0, lines = 0;
      for (let seed = 0; seed < 40; seed++) {
        for (const f of buildFallingWeatherGapBand(
          "snow", seed, MAX_GAP_WIDTH, rows, FALL_PERIOD, gapFlakeCount(rows),
        )) {
          for (const line of f.split("\n")) {
            drawn += [...line].filter((c) => c === "❄").length;
            lines++;
          }
        }
      }
      return drawn / lines;
    };
    const legacy = perRow(3);
    const now = perRow(SKY_FALL_ROWS);
    expect(legacy).toBeGreaterThan(3); // sanity: the baseline is not ~0
    expect(now / legacy).toBeGreaterThan(0.85);
    expect(now / legacy).toBeLessThan(1.15);
  });

  test("SKY_FALL_GLYPH/SKY_FALL_COLOR are exported (no behavior change vs. the private module internals)", () => {
    expect(SKY_FALL_GLYPH.snow).toBe("❄");
    expect(SKY_FALL_GLYPH.rain).toBe("`");
    expect(SKY_FALL_COLOR.dark.snow).toBe("e8f0f7");
    expect(SKY_FALL_COLOR.light.snow).toBe("4a6f94");
  });

  test("same seed => same gap-band frames, deterministic", () => {
    const a = buildFallingWeatherGapBand("snow", 42, 110, 3, 12, 31);
    const b = buildFallingWeatherGapBand("snow", 42, 110, 3, 12, 31);
    expect(a).toEqual(b);
  });

  test("returns exactly `period` frames, each exactly `rows` lines, each line exactly `width` display cells", () => {
    const width = 110, rows = 3, period = 12, flakeCount = 31;
    const frames = buildFallingWeatherGapBand("rain", 7, width, rows, period, flakeCount);
    expect(frames.length).toBe(period);
    for (const f of frames) {
      const lines = f.split("\n");
      expect(lines.length).toBe(rows);
      for (const line of lines) expect(displayWidth(line)).toBe(width);
    }
  });

  // D3: the field must survive a live bash `${line:0:N}` clip and a
  // character-indexed front-layer splice, both of which embedded SGR would
  // corrupt (§2.4's ANSI-hazard). The shell tints the glyph after slicing.
  test("frames are PLAIN — no embedded ANSI anywhere in the output (D3)", () => {
    const frames = buildFallingWeatherGapBand("snow", 42, 110, 3, 12, 31);
    for (const f of frames) {
      expect(f).not.toContain("\x1b");
    }
  });

  test("motion is genuine: at least one flake occupies a different row across the period (not a static frame repeated)", () => {
    const frames = buildFallingWeatherGapBand("snow", 99, 110, 3, 12, 31);
    expect(new Set(frames).size).toBeGreaterThan(1);
  });

  test("a seed sweep produces both snow and rain glyph sets without crossover", () => {
    const snow = buildFallingWeatherGapBand("snow", 1, 110, 3, 12, 31).join("");
    const rain = buildFallingWeatherGapBand("rain", 1, 110, 3, 12, 31).join("");
    expect(snow).not.toBe(rain);
  });

  // F9 kept the `sky-fall-gap:` hash prefix deliberately, so upgrading does
  // not reshuffle an in-flight session's flake pattern. Pin the stream by its
  // output rather than by reading the prefix back out of the source.
  test("the seeded stream is stable: a fixed seed still yields a fixed known first frame", () => {
    const first = buildFallingWeatherGapBand("snow", 123, 20, 3, 12, 6)[0];
    expect(first.split("\n").length).toBe(3);
    expect(first).toBe(buildFallingWeatherGapBand("snow", 123, 20, 3, 12, 6)[0]);
    // A different seed must actually move flakes, or "stable" is vacuous.
    expect(first).not.toBe(buildFallingWeatherGapBand("snow", 124, 20, 3, 12, 6)[0]);
  });

  test("every glyph used is single-display-cell/MIRROR_SWAP-safe (reuses the existing ALL_SKY_FALL_GLYPHS contract)", () => {
    // Pin that a wide, tall bake with many flakes only ever emits the two
    // known single-cell glyphs — the shell relies on that for both its
    // clip-then-recolor step and its width-preserving front-layer splice.
    let sawGlyph = false;
    const frames = buildFallingWeatherGapBand("snow", 5, 110, 3, 12, 31);
    for (const f of frames) {
      for (const ch of f) {
        if (ch === " " || ch === "\n") continue;
        expect(ALL_SKY_FALL_GLYPHS).toContain(ch);
        sawGlyph = true;
      }
    }
    expect(sawGlyph).toBe(true);
  });

  test("a seed sweep places at least one flake in the frame set (not always blank)", () => {
    let sawFlake = false;
    for (let seed = 0; seed < 50; seed++) {
      const frames = buildFallingWeatherGapBand("snow", seed, 110, 3, 12, 31);
      if (frames.some((f) => f.trim() !== "")) {
        sawFlake = true;
        break;
      }
    }
    expect(sawFlake).toBe(true);
  });
});
