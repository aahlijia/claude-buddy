import { describe, test, expect } from "bun:test";
import { pickDayProp, ALL_PROP_GLYPHS } from "./props.ts";
import {
  getArtFrame,
  applyProp,
  mirrorFrame,
  displayWidth,
} from "./art.ts";

const d = (y: number, m: number, day: number, h = 12): Date =>
  new Date(y, m, day, h);

describe("prop selection (living-world P4)", () => {
  test("same calendar day ⇒ same prop (day-seeded, deterministic)", () => {
    const a = pickDayProp(d(2026, 6, 20), "cactus");
    const b = pickDayProp(d(2026, 6, 20, 23), "cactus"); // same day, later hour
    expect(a.prop).toEqual(b.prop); // the sprout/pebble is a DAILY constant
  });

  test("a different calendar day usually picks a different prop", () => {
    // 2026-07-21 and 2026-07-22 (verified distinct for "cactus" against the
    // real hashString/mulberry32 seam — not every day-pair differs, since
    // the glyph sets are small, but this pair does).
    const day21 = pickDayProp(d(2026, 6, 21), "cactus");
    const day22 = pickDayProp(d(2026, 6, 22), "cactus");
    expect(day22.prop).not.toEqual(day21.prop);
  });

  test("palette / time-of-day flavor varies by time-of-day bucket", () => {
    const morning = pickDayProp(d(2026, 6, 20, 8), "cactus");
    const night = pickDayProp(d(2026, 6, 20, 23), "cactus");
    expect(morning.palette).not.toBe(night.palette);
    // the prop itself stays the daily constant even as the palette shifts
    expect(morning.prop).toEqual(night.prop);
  });

  test("pure: no Date.now / no getHours read internally — same injected Date ⇒ byte-identical output", () => {
    const fixed = d(2026, 0, 1);
    expect(pickDayProp(fixed, "duck")).toEqual(pickDayProp(fixed, "duck"));
  });

  test("a live SEASONAL window (art.ts) swaps the feet motif (Branch A)", () => {
    const winter = pickDayProp(new Date(2026, 11, 25, 12), "duck");
    const newYear = pickDayProp(new Date(2027, 0, 1, 12), "duck");
    const offSeason = pickDayProp(new Date(2026, 5, 15, 12), "duck");
    expect(winter.prop.feet).toBe("❅");
    expect(newYear.prop.feet).toBe("✧");
    expect(offSeason.prop.feet).not.toBe("❅");
    expect(offSeason.prop.feet).not.toBe("✧");
  });

  test("every prop glyph is ANSI-free and exactly one display cell wide", () => {
    expect(ALL_PROP_GLYPHS.length).toBeGreaterThan(0);
    for (const g of ALL_PROP_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(displayWidth(g)).toBe(1);
    }
  });

  test("every prop glyph survives mirrorFrame unchanged (MIRROR_SWAP-safe)", () => {
    // The idle buddy is never mirrored (only the enemy sprite in combat is),
    // so this is a cheap defensive assertion, not a hard blocker — mirrors
    // art.test.ts's identical check for Task 1's applyProp glyphs.
    for (const g of ALL_PROP_GLYPHS) {
      const art = getArtFrame("duck", "°", 0);
      applyProp("duck", art, { feet: g });
      const mirrored = mirrorFrame(art).join("\n");
      expect(mirrored).toContain(g);
    }
  });

  test("output shape feeds applyProp directly (feet/ahead PropArt)", () => {
    const { prop } = pickDayProp(d(2026, 6, 20), "cactus");
    const art = getArtFrame("cactus", "°", 0);
    applyProp("cactus", art, prop);
    const joined = art.join("\n");
    expect(joined).toContain(prop.feet!);
    expect(joined).toContain(prop.ahead!);
  });
});
