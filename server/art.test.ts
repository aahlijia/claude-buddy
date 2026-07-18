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
  overlayRow,
  trimBlankTopRows,
  trimSharedBlankTopRows,
  emoteFor,
  finalizeIdleBlock,
  renderCompanionCard,
  renderCompanionCardMarkdown,
  STATUS_FRAME_SEQUENCE,
  ageTell,
  activeSeasonal,
  renderSpeciesFrame,
} from "./art.ts";
import { SPECIES, type BuddyBones } from "./engine.ts";

const heights = (frames: string[]): Set<number> =>
  new Set(frames.map((f) => f.split("\n").length));
const maxWidth = (frames: string[]): number =>
  Math.max(...frames.flatMap((f) => f.split("\n").map(displayWidth)));

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

  // design-sprite-animation-v2 §P7 pilot: these 3 species carry a genuine 4th
  // raw art frame (stretch), so their neutral flipbook is one entry longer
  // than everyone else's.
  const STRETCH_SPECIES = new Set(["duck", "cat", "robot"]);

  test("produces 5 frames (idle ×3 + blink + glance) and an 18-tick sequence", () => {
    const { frames, frameSequence } = getStatusFrames(bones());
    expect(frames).toHaveLength(5); // capybara has no stretch frame
    expect(frameSequence).toEqual([...STATUS_FRAME_SEQUENCE]);
  });

  test("every species produces 5-6 frames, each with 5-6 lines", () => {
    for (const species of SPECIES) {
      const { frames } = getStatusFrames(bones({ species }));
      expect(frames).toHaveLength(STRETCH_SPECIES.has(species) ? 6 : 5);
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

  test("glance frame (index 4) replaces the configured eye with \"'\", distinct from blink (design-sprite-animation-v2 §P6)", () => {
    const { frames } = getStatusFrames(bones({ species: "capybara", eye: "@" }));
    expect(frames[4]).not.toContain("@");
    expect(frames[4]).toContain("'");
    expect(frames[4]).not.toBe(frames[3]); // reads as a different beat than blink
  });

  test("stretch species (duck/cat/robot) get a 6th frame; a worn hat still shows on it", () => {
    const { frames } = getStatusFrames(
      bones({ species: "duck", hat: "crown" }),
      "neutral",
    );
    expect(frames).toHaveLength(6);
    expect(frames[5]).toContain("\\^^^/"); // crown art on the stretch frame's row 0
  });

  test("every species' glance frame is anchor-safe (reuses frame 0's layout)", () => {
    // Same code path blink already relies on (frame 0, eye substitution) —
    // gear anchors are already validated for frame 0, so this is mechanical.
    for (const species of SPECIES) {
      const { frames } = getStatusFrames(bones({ species }));
      const glance = frames[4].split("\n");
      const idle0 = getArtFrame(species, "°", 0);
      expect(glance.length).toBe(idle0.length);
    }
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

  describe("gait frame variants (living-world P1)", () => {
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

    test("absent unless requested; stable base output", () => {
      const base = getStatusFrames(bones());
      expect((base as { gaitIdx?: unknown }).gaitIdx).toBeUndefined();
    });

    test("appends lean (>) and peek (<) frames and reports indices", () => {
      const base = getStatusFrames(bones());
      const g = getStatusFrames(bones(), "neutral", undefined, undefined, true);
      expect(g.frames.length).toBe(base.frames.length + 2);
      expect(g.gaitIdx).toEqual({
        bob: 1,
        lean: base.frames.length,
        peek: base.frames.length + 1,
      });
      expect(g.frames[g.gaitIdx!.lean]).toBe(renderSpeciesFrame(bones(), 0, ">"));
      expect(g.frames[g.gaitIdx!.peek]).toBe(renderSpeciesFrame(bones(), 0, "<"));
      expect(g.frames.slice(0, base.frames.length)).toEqual(base.frames);
      expect(g.frameSequence).toEqual(base.frameSequence);
    });

    test("emotion branch also carries variants when requested", () => {
      const g = getStatusFrames(bones(), "angry", undefined, undefined, true);
      expect(g.gaitIdx).toEqual({ bob: 1, lean: 2, peek: 3 });
    });
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

  // ── Per-kind cycles (design-sprite-animation-v2 §P5) ──────────────────────
  describe("per-CelebrationKind cycles", () => {
    const KINDS = [
      "ascension",
      "shiny",
      "levelup",
      "loot",
      "whim",
      "discovery",
    ] as const;

    test("every kind yields a valid, non-empty flipbook for every species", () => {
      for (const kind of KINDS) {
        for (const species of SPECIES) {
          const { frames, frameSequence } = flourishFrames(
            bones({ species }),
            kind,
          );
          expect(frames.length).toBeGreaterThan(0);
          expect(frameSequence.length).toBeGreaterThan(0);
          for (const idx of frameSequence) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(frames.length);
          }
        }
      }
    });

    test("ascension stays the biggest cycle; the common kinds are shorter", () => {
      const lenOf = (kind: (typeof KINDS)[number]): number =>
        flourishFrames(bones(), kind).frames.length;
      expect(lenOf("ascension")).toBeGreaterThan(lenOf("levelup"));
      expect(lenOf("levelup")).toBeGreaterThan(lenOf("loot"));
    });

    test("no kind arg defaults to ascension (round-1 call sites unaffected)", () => {
      expect(flourishFrames(bones())).toEqual(flourishFrames(bones(), "ascension"));
    });

    test("distinct kinds bake distinct eye sequences", () => {
      const eyesOf = (kind: (typeof KINDS)[number]): string =>
        flourishFrames(bones(), kind).frames.join("|");
      const ascension = eyesOf("ascension");
      const levelup = eyesOf("levelup");
      const loot = eyesOf("loot");
      expect(levelup).not.toBe(ascension);
      expect(loot).not.toBe(ascension);
      expect(loot).not.toBe(levelup);
    });
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

  test("the P7 stretch frame's anchors are also clear (duck/cat/robot)", () => {
    // design-sprite-animation-v2 §P7: frame 3 must satisfy the same
    // anchor-blank contract as frames 0-2.
    for (const species of ["duck", "cat", "robot"] as const) {
      const art = getArtFrame(species, "°", 3);
      applyGear(species, art, GEAR);
      const joined = art.join("\n");
      expect(joined).toContain(GEAR.weapon);
      expect(joined).toContain(GEAR.trinket);
    }
  });

  test("the P7 stretch frame's row 0 stays blank (hats must still render)", () => {
    // applyHat only writes row 0 when it's currently blank; a non-blank row 0
    // on the stretch frame would silently drop the hat while it plays.
    for (const species of ["duck", "cat", "robot"] as const) {
      const art = getArtFrame(species, "°", 3);
      expect(art[0].trim()).toBe("");
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
    expect(frames).toHaveLength(5); // cactus has no stretch frame
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

// ─── Shared frame-geometry primitives (design-sprite-animation P0) ───────────

describe("overlayRow (span-addressed FX row)", () => {
  test("null text ⇒ a full-width blank row", () => {
    expect(overlayRow(null, 0, 12, 12)).toBe(" ".repeat(12));
    expect(overlayRow(null, 5, 4, 20)).toBe(" ".repeat(20));
  });

  test("row is always exactly totalW display cells wide", () => {
    for (const [t, s, w, tot] of [
      ["!", 0, 12, 12],
      ["zZz", 0, 12, 14],
      ["✗ -9", 8, 12, 20],
    ] as const) {
      expect(displayWidth(overlayRow(t, s, w, tot))).toBe(tot);
    }
  });

  test("text is centered over its span", () => {
    // span [0,12): a 1-wide glyph centers at col floor((12-1)/2)=5.
    expect(overlayRow("!", 0, 12, 12)).toBe(" ".repeat(5) + "!" + " ".repeat(6));
    // enemy span in a two-sprite scene: start 16, width 12 ⇒ col 16+5=21.
    const r = overlayRow("!", 16, 12, 28);
    expect([...r].indexOf("!")).toBe(21);
  });

  test("a glyph wider than its span is clamped inside the row", () => {
    const r = overlayRow("wide!", 0, 2, 5);
    expect(displayWidth(r)).toBe(5);
    expect(r).toBe("wide!");
  });
});

describe("trimSharedBlankTopRows / trimBlankTopRows", () => {
  test("drops a row blank across every frame of every flipbook", () => {
    const a = ["   \nbody", "   \nbody"];
    const b = ["   \narms", "   \narms"];
    const [ta, tb] = trimSharedBlankTopRows([a, b]);
    expect(heights(ta)).toEqual(new Set([1]));
    expect(heights(tb)).toEqual(new Set([1]));
  });

  test("keeps a row any single frame of any flipbook uses", () => {
    // The dead row is used by exactly one frame of the second flipbook ⇒ kept
    // for BOTH, so the swap-time height contract holds.
    const a = ["   \nbody", "   \nbody"];
    const b = ["!  \narms", "   \narms"];
    const [ta, tb] = trimSharedBlankTopRows([a, b]);
    expect(heights(ta)).toEqual(new Set([2]));
    expect(heights(tb)).toEqual(new Set([2]));
  });

  test("stops at the first row every frame uses (inner blanks unreachable)", () => {
    // Row 0 dead, row 1 always used, row 2 blank-in-all but BELOW a used row.
    const f = ["   \nXXX\n   \nYYY", "   \nXXX\n   \nZZZ"];
    const t = trimBlankTopRows(f);
    expect(heights(t)).toEqual(new Set([3])); // only row 0 dropped
  });

  test("ANSI-only rows count as used (a pop is never mistaken for blank)", () => {
    const f = ["\x1b[31m-9\x1b[0m\nbody", "        \nbody"];
    const t = trimBlankTopRows(f);
    expect(heights(t)).toEqual(new Set([2])); // pop row kept
  });

  test("all-dead input keeps at least the last row", () => {
    expect(trimBlankTopRows(["   \n   ", "   \n   "])).toEqual(["   ", "   "]);
  });
});

// ─── Idle FX row + shared trim (design-sprite-animation P1) ──────────────────

describe("emoteFor", () => {
  test("neutral ⇒ null, each emotion ⇒ its glyph", () => {
    expect(emoteFor("neutral")).toBeNull();
    expect(emoteFor("angry")).toBe("!");
    expect(emoteFor("bored")).toBe("zZz");
    expect(emoteFor("happy")).toBe("♪");
    expect(emoteFor("surprised")).toBe("?");
  });
});

describe("finalizeIdleBlock", () => {
  const bones = (o: Partial<BuddyBones> = {}): BuddyBones => ({
    rarity: "common",
    species: "duck",
    eye: "°",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "PATIENCE",
    ...o,
  });

  test("neutral, no flourish: reclaims the dead row for a free-row species", () => {
    const idle = getStatusFrames(bones(), "neutral").frames;
    const r = finalizeIdleBlock(idle, undefined, null);
    expect(heights(idle)).toEqual(new Set([5]));
    expect(heights(r.idle)).toEqual(new Set([4])); // duck row 0 is dead
    expect(r.flourish).toBeUndefined();
  });

  test("emote is net-free for a free-row species (trim −1, FX +1)", () => {
    const idle = getStatusFrames(bones(), "angry").frames;
    const r = finalizeIdleBlock(idle, undefined, emoteFor("angry"));
    expect(heights(r.idle)).toEqual(new Set([5]));
    expect(r.idle[0].split("\n")[0]).toContain("!");
  });

  test("the emote sits on the top row, centered over the sprite", () => {
    const idle = getStatusFrames(bones(), "bored").frames;
    const r = finalizeIdleBlock(idle, undefined, emoteFor("bored"));
    for (const f of r.idle) expect(f.split("\n")[0]).toContain("zZz");
  });

  test("shared drop set: idle and flourish keep one height across all species", () => {
    for (const species of SPECIES) {
      for (const hat of ["none", "wizard"] as const) {
        for (const emo of ["neutral", "angry", "bored", "happy", "surprised"] as const) {
          const b = bones({ species, hat });
          const r = finalizeIdleBlock(
            getStatusFrames(b, emo).frames,
            flourishFrames(b).frames,
            emoteFor(emo),
          );
          const all = [...r.idle, ...(r.flourish ?? [])];
          expect(heights(all).size).toBe(1);
        }
      }
    }
  });

  test("never widens the block past the raw art (trim/FX add no columns)", () => {
    for (const species of SPECIES) {
      const idle = getStatusFrames(bones({ species }), "angry").frames;
      const r = finalizeIdleBlock(idle, undefined, emoteFor("angry"));
      expect(maxWidth(r.idle)).toBe(maxWidth(idle));
    }
  });

  test("null emote is pure trim — no FX row added", () => {
    const idle = getStatusFrames(bones({ species: "cactus" }), "neutral").frames;
    const r = finalizeIdleBlock(idle, undefined, null);
    // cactus draws into row 0 (frame 2), so nothing is reclaimed and no row added.
    expect(heights(r.idle)).toEqual(heights(idle));
  });

  test("wyvern: structural row 0 is never dropped, emote stacks above it", () => {
    const idle = getStatusFrames(bones({ species: "wyvern" }), "surprised").frames;
    const neutral = finalizeIdleBlock(
      getStatusFrames(bones({ species: "wyvern" }), "neutral").frames,
      undefined,
      null,
    );
    expect(heights(neutral.idle)).toEqual(new Set([6])); // unchanged
    const r = finalizeIdleBlock(idle, undefined, emoteFor("surprised"));
    expect(heights(r.idle)).toEqual(new Set([7])); // +1 for the emote row
    for (const f of r.idle) expect(f.split("\n")[0]).toContain("?");
  });
});
