/**
 * Display-width tests — covers the U+2600-U+27BF split between Emoji_Presentation
 * (2 cols) and text-presentation (1 col), plus VS16 upgrades. Keeps bubble
 * padding and companion-card alignment stable when reactions/achievements
 * contain emoji.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  displayWidth,
  getStatusFrames,
  flourishFrames,
  mirrorFrame,
  rectFrame,
  getArtFrame,
  applyGear,
  renderCompanionCard,
  renderCompanionCardMarkdown,
  STATUS_FRAME_SEQUENCE,
  ageTell,
  activeSeasonal,
} from "./art.ts";
import { SPECIES, type BuddyBones } from "./engine.ts";

describe("displayWidth", () => {
  test("ASCII has width equal to character count", () => {
    expect(displayWidth("")).toBe(0);
    expect(displayWidth("hola")).toBe(4);
    expect(displayWidth("hola  ")).toBe(6);
  });

  test("non-BMP emoji (U+1F000+) count as 2", () => {
    expect(displayWidth("\u{1F3C6}")).toBe(2); // 🏆
    expect(displayWidth("\u{1F9F9}")).toBe(2); // 🧹
  });

  test("Emoji_Presentation codepoints in U+2600-U+27BF count as 2", () => {
    expect(displayWidth("\u2705")).toBe(2); // ✅
    expect(displayWidth("\u274C")).toBe(2); // ❌
    expect(displayWidth("\u26A1")).toBe(2); // ⚡
    expect(displayWidth("\u2728")).toBe(2); // ✨
  });

  test("text-presentation symbols in U+2600-U+27BF stay 1 without VS16", () => {
    expect(displayWidth("\u2605")).toBe(1);           // ★
    expect(displayWidth("\u2605\u2605\u2605\u2605\u2605")).toBe(5); // ★★★★★ (rarity stars)
    expect(displayWidth("\u2660")).toBe(1);           // ♠
    expect(displayWidth("\u2764")).toBe(1);           // ❤ plain
  });

  test("VS16 upgrades narrow symbols in U+2600-U+27BF to 2", () => {
    expect(displayWidth("\u2764\uFE0F")).toBe(2); // ❤️
    expect(displayWidth("\u2600\uFE0F")).toBe(2); // ☀️
  });

  test("VS16 after an already-wide emoji does not add width", () => {
    expect(displayWidth("\u2705\uFE0F")).toBe(2);      // ✅ + VS16
    expect(displayWidth("\u{1F3C6}\uFE0F")).toBe(2);   // 🏆 + VS16
  });

  test("zero-width joiner and variation selectors don't add width", () => {
    expect(displayWidth("\u200D")).toBe(0);
    expect(displayWidth("\uFE00")).toBe(0);
  });

  test("ANSI escape sequences are stripped", () => {
    expect(displayWidth("\x1b[31mhola\x1b[0m")).toBe(4);
  });

  test("mixed ASCII + emoji matches terminal columns", () => {
    // "🏆 ✅ Good Buddy" → 2+1+2+1+10 = 16
    expect(displayWidth("\u{1F3C6} \u2705 Good Buddy")).toBe(16);
  });
});

describe("getStatusFrames", () => {
  const bones = (overrides: Partial<BuddyBones> = {}): BuddyBones => ({
    rarity: "common",
    species: "capybara",
    eye: "\u00b0",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "PATIENCE",
    ...overrides,
  });

  test("produces 4 frames and a 15-tick sequence", () => {
    const { frames, frameSequence } = getStatusFrames(bones());
    expect(frames).toHaveLength(4);
    expect(frameSequence).toEqual([...STATUS_FRAME_SEQUENCE]);
  });

  test("every species produces 4 frames, each with 5-6 lines", () => {
    for (const species of SPECIES) {
      const { frames } = getStatusFrames(bones({ species }));
      expect(frames).toHaveLength(4);
      for (const body of frames) {
        const lines = body.split("\n").length;
        expect(lines).toBeGreaterThanOrEqual(5);
        expect(lines).toBeLessThanOrEqual(6);
      }
    }
  });

  test("eye is replaced in idle frames", () => {
    const { frames } = getStatusFrames(bones({ species: "capybara", eye: "@" }));
    expect(frames[0]).toContain("@");
    expect(frames[0]).not.toContain("{E}");
  });

  test("blink frame (index 3) replaces the configured eye with '-'", () => {
    const { frames } = getStatusFrames(bones({ species: "capybara", eye: "@" }));
    expect(frames[3]).not.toContain("@");
    expect(frames[3]).toContain("-");
  });

  test("hat overlays line 0 when the species frame has no line-0 content", () => {
    // duck's frame 0 line 0 is blank — hat should appear there.
    const { frames } = getStatusFrames(bones({ species: "duck", hat: "crown" }));
    const line0 = frames[0].split("\n")[0];
    expect(line0).toContain("\\^^^/");
  });

  test("hat does not override species line-0 content", () => {
    // capybara frame 2 has ripples on line 0 — hat should not replace them.
    const { frames } = getStatusFrames(bones({ species: "capybara", hat: "crown" }));
    const line0 = frames[2].split("\n")[0];
    expect(line0).not.toContain("\\^^^/");
    expect(line0).toContain("~");
  });

  test("frame sequence references only valid frame indices", () => {
    const { frames, frameSequence } = getStatusFrames(bones());
    for (const idx of frameSequence) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(frames.length);
    }
  });

  // ── Emotion frames (game-feel FR-A4) ──────────────────────────────────────

  test("neutral is the default and is byte-identical to the no-arg call", () => {
    expect(getStatusFrames(bones(), "neutral")).toEqual(getStatusFrames(bones()));
  });

  test("each emotion yields a 2-frame micro-cycle with the emotion's eye", () => {
    const eyes: Record<string, string> = {
      happy: "^",
      angry: ">",
      bored: "-",
      surprised: "O",
    };
    for (const [emotion, eye] of Object.entries(eyes)) {
      const { frames, frameSequence } = getStatusFrames(
        bones({ species: "capybara", eye: "@" }),
        emotion as "happy",
      );
      expect(frames).toHaveLength(2);
      expect(frames[0]).toContain(eye);
      expect(frames[0]).not.toContain("@"); // the configured eye is overridden
      // sequence only references valid indices
      for (const idx of frameSequence) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(frames.length);
      }
    }
  });

  // ── Seasonal overlay (game-feel FR-C2) ────────────────────────────────────

  test("seasonalHat overlays a hatless line 0, but never a worn hat", () => {
    // duck frame 0 line 0 is blank → seasonal hat appears there.
    const withSeasonal = getStatusFrames(
      bones({ species: "duck", hat: "none" }),
      "neutral",
      "beanie",
    );
    expect(withSeasonal.frames[0].split("\n")[0]).toContain("(___)"); // beanie art
    // a worn hat (crown) is not overridden by the seasonal hat.
    const withWornHat = getStatusFrames(
      bones({ species: "duck", hat: "crown" }),
      "neutral",
      "beanie",
    );
    expect(withWornHat.frames[0].split("\n")[0]).toContain("\\^^^/"); // crown, not beanie
  });

  // ── Wyvern hat (renderSpeciesFrame ↔ applyHat unification) ────────────────

  test("a wyvern's worn hat renders between the horns on status frames", () => {
    // Regression: renderSpeciesFrame used to apply hats only to a blank line 0,
    // which a wyvern never has — cards showed the hat, the status line didn't.
    const { frames } = getStatusFrames(bones({ species: "wyvern", hat: "crown" }));
    expect(frames[0].split("\n")[0]).toBe("} \\^^^/ {");
  });

  test("a hatless wyvern keeps its horn row (seasonal fills it too)", () => {
    const bare = getStatusFrames(bones({ species: "wyvern", hat: "none" }));
    expect(bare.frames[0].split("\n")[0]).toBe("}       {");
    const seasonal = getStatusFrames(
      bones({ species: "wyvern", hat: "none" }),
      "neutral",
      "beanie",
    );
    expect(seasonal.frames[0].split("\n")[0]).toBe("} (___) {");
  });
});

describe("flourishFrames (game-feel FR-A3)", () => {
  const bones = (overrides: Partial<BuddyBones> = {}): BuddyBones => ({
    rarity: "common",
    species: "capybara",
    eye: "°",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "PATIENCE",
    ...overrides,
  });

  test("every species yields non-empty frames + a valid sequence", () => {
    for (const species of SPECIES) {
      const { frames, frameSequence } = flourishFrames(bones({ species }));
      expect(frames.length).toBeGreaterThan(0);
      expect(frameSequence.length).toBeGreaterThan(0);
      for (const body of frames) {
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain("{E}"); // eye placeholder always resolved
      }
      for (const idx of frameSequence) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(frames.length);
      }
    }
  });

  test("uses celebratory eyes, not the configured idle eye", () => {
    const { frames } = flourishFrames(bones({ species: "capybara", eye: "@" }));
    expect(frames.join("")).not.toContain("@");
    expect(frames.join("")).toContain("*"); // the spark eye
  });

  test("does not mutate or replace the neutral idle frames", () => {
    // Baking a flourish must leave getStatusFrames byte-identical (R3).
    const before = getStatusFrames(bones());
    flourishFrames(bones());
    expect(getStatusFrames(bones())).toEqual(before);
  });
});

describe("rectFrame / mirrorFrame (idle-RPG Phase 5)", () => {
  test("rectFrame pads every line to the frame's max display width", () => {
    const r = rectFrame(["abc", "de", "f"]);
    const widths = new Set(r.map((l) => displayWidth(l)));
    expect(widths.size).toBe(1);
    expect(displayWidth(r[0])).toBe(3);
  });

  test("mirrorFrame output lines are all equal width", () => {
    const m = mirrorFrame(["( ·  · )", "(    )", "  --"]);
    const widths = new Set(m.map((l) => displayWidth(l)));
    expect(widths.size).toBe(1);
  });

  test("swaps directional glyphs", () => {
    expect(mirrorFrame(["()"])[0]).toBe("()"); // ")(" reversed → "()"
    expect(mirrorFrame(["<>"])[0]).toBe("<>");
    expect(mirrorFrame(["/\\"])[0]).toBe("/\\");
    expect(mirrorFrame(["(>"])[0]).toBe("<)"); // ">(" rev → swap → "<)"
    expect(mirrorFrame(["[a]"])[0]).toBe("[a]");
  });

  test("preserves symmetric glyphs and is width-stable on a real sprite", () => {
    const art = getArtFrame("dragon", "·", 0);
    const m = mirrorFrame(art);
    expect(m.length).toBe(art.length);
    const rectW = displayWidth(rectFrame(art)[0]);
    for (const line of m) expect(displayWidth(line)).toBe(rectW);
  });

  test("double-mirror restores the rectangularized frame (involution)", () => {
    const art = rectFrame(getArtFrame("blob", "·", 0));
    expect(mirrorFrame(mirrorFrame(art))).toEqual(art);
  });

  test("reverses by code point (surrogate-pair safe)", () => {
    // A non-BMP glyph must survive a round-trip intact, not split.
    const m = mirrorFrame(["a\u{1F409}b"]);
    expect([...m[0]]).toContain("\u{1F409}");
  });
});

describe("ageTell (game-feel FR-C3)", () => {
  const DAY = 86_400_000;
  const now = 1_000_000_000_000;
  test("sprout → growing → mature by days since hatch", () => {
    expect(ageTell(now - 0 * DAY, now)).toBe("\u{1F331}"); // 🌱
    expect(ageTell(now - 10 * DAY, now)).toBe("\u{1F33F}"); // 🌿
    expect(ageTell(now - 40 * DAY, now)).toBe("\u{1F333}"); // 🌳
  });
});

describe("activeSeasonal (game-feel FR-C2)", () => {
  test("returns the winter cosmetic inside its window and null outside", () => {
    expect(activeSeasonal(new Date(2026, 11, 25))?.hat).toBe("beanie"); // Dec 25
    expect(activeSeasonal(new Date(2026, 0, 1))?.hat).toBe("beanie"); // Jan 1
    expect(activeSeasonal(new Date(2026, 5, 15))).toBeNull(); // Jun 15
  });
});

describe("statusline/emoji-widths.data", () => {
  test("matches Unicode Emoji_Presentation in U+2600-U+27BF (regenerate via 'bun run gen:emoji-widths')", () => {
    const data = readFileSync(
      join(import.meta.dir, "..", "statusline", "emoji-widths.data"),
      "utf8",
    );
    const fileList = data
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .join(" ")
      .trim()
      .split(/\s+/)
      .map(Number);

    const re = /\p{Emoji_Presentation}/u;
    const expected: number[] = [];
    for (let cp = 0x2600; cp <= 0x27BF; cp++) {
      if (re.test(String.fromCodePoint(cp))) expected.push(cp);
    }
    expect(fileList).toEqual(expected);
  });
});

// ─── Gear overlays (equipped weapon / trinket on the sprite) ─────────────────

describe("applyGear (gear overlays)", () => {
  const bones = (overrides: Partial<BuddyBones> = {}): BuddyBones => ({
    rarity: "common",
    species: "cactus",
    eye: "°",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "PATIENCE",
    ...overrides,
  });
  // Distinctive glyphs: neither "†" nor ",>" occurs in any species art, so a
  // containment check proves the overlay actually landed (a collision skips it).
  const GEAR = { weapon: "†", trinket: ",>" };

  test("every species' anchors are clear in all three idle frames", () => {
    for (const species of SPECIES) {
      for (let f = 0; f < 3; f++) {
        const art = getArtFrame(species, "°", f);
        applyGear(species, art, GEAR);
        const joined = art.join("\n");
        expect(joined).toContain(GEAR.weapon);
        expect(joined).toContain(GEAR.trinket);
      }
    }
  });

  test("overlays only ever fill blank cells — body pixels are never clobbered", () => {
    for (const species of SPECIES) {
      for (let f = 0; f < 3; f++) {
        const base = getArtFrame(species, "°", f);
        const geared = getArtFrame(species, "°", f);
        applyGear(species, geared, GEAR);
        for (let r = 0; r < geared.length; r++) {
          const b = [...(base[r] ?? "")];
          const g = [...geared[r]];
          for (let c = 0; c < g.length; c++) {
            if ((b[c] ?? " ") !== g[c]) {
              // Changed cell ⇒ it must have been blank (or past end) before.
              expect(b[c] ?? " ").toBe(" ");
            }
          }
        }
      }
    }
  });

  test("no gear (undefined or empty) leaves the frame untouched", () => {
    const base = getArtFrame("cactus", "°", 0);
    const noGear = getArtFrame("cactus", "°", 0);
    applyGear("cactus", noGear);
    expect(noGear).toEqual(base);
    const emptyGear = getArtFrame("cactus", "°", 0);
    applyGear("cactus", emptyGear, {});
    expect(emptyGear).toEqual(base);
  });

  test("getStatusFrames threads gear into every idle frame, incl. blink", () => {
    const { frames } = getStatusFrames(bones(), "neutral", undefined, GEAR);
    expect(frames).toHaveLength(4);
    for (const body of frames) {
      expect(body).toContain(GEAR.weapon);
      expect(body).toContain(GEAR.trinket);
    }
  });

  test("emotion micro-cycles keep the gear on", () => {
    const { frames } = getStatusFrames(bones(), "happy", undefined, GEAR);
    for (const body of frames) {
      expect(body).toContain(GEAR.weapon);
      expect(body).toContain(GEAR.trinket);
    }
  });

  test("gear coexists with a hat overlay (different rows)", () => {
    const { frames } = getStatusFrames(
      bones({ species: "duck", hat: "crown" }),
      "neutral",
      undefined,
      GEAR,
    );
    expect(frames[0]).toContain("\\^^^/");
    expect(frames[0]).toContain(GEAR.weapon);
    expect(frames[0]).toContain(GEAR.trinket);
  });

  test("omitting gear is byte-identical to the pre-gear render", () => {
    const before = getStatusFrames(bones());
    const after = getStatusFrames(bones(), "neutral", undefined, undefined);
    expect(after).toEqual(before);
  });

  test("wyvern: gear lands and the ANSI fire frame stays intact", () => {
    const { frames } = getStatusFrames(bones({ species: "wyvern" }), "neutral", undefined, GEAR);
    for (const body of frames) {
      expect(body).toContain(GEAR.weapon);
      expect(body).toContain(GEAR.trinket);
    }
    // Frame index 1 carries the colored fire on its last line — untouched.
    expect(frames[1]).toContain("\x1b[38;2;255;120;0m//|\\\\\x1b[0m");
  });

  test("companion cards composite gear onto the art block", () => {
    const md = renderCompanionCardMarkdown(bones(), "Waffle", "spiky", undefined, 0, GEAR);
    expect(md).toContain(GEAR.weapon);
    expect(md).toContain(GEAR.trinket);
    const ansi = renderCompanionCard(bones(), "Waffle", "spiky", undefined, 0, 40, GEAR);
    expect(ansi).toContain(GEAR.weapon);
    expect(ansi).toContain(GEAR.trinket);
  });
});
