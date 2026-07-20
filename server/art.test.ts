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
  applyProp,
  applyPropKicked,
  PROP_ANCHORS,
  PROP_KICK_COLUMNS,
  SPECIES_ART,
  propKickDepth,
  propKickFrameSequence,
  applyBossCrown,
  LOOTDASH_ITEM_GLYPH,
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
  gaitFrameSequence,
  eyeRowIndex,
  type Emotion,
} from "./art.ts";
import { SPECIES, type BuddyBones } from "./engine.ts";
import type { GaitPhase } from "./wander.ts";

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

    test("appends lean (~) and peek (<) frames and reports indices", () => {
      const base = getStatusFrames(bones());
      const g = getStatusFrames(bones(), "neutral", undefined, undefined, true);
      // +2 for lean/peek, +1 for the Task 5 inspect frame (always appended
      // last when gaitVariants is requested — see the dedicated describe
      // block below for its own coverage).
      expect(g.frames.length).toBe(base.frames.length + 3);
      expect(g.gaitIdx).toEqual({
        bob: 1,
        lean: base.frames.length,
        peek: base.frames.length + 1,
      });
      expect(g.frames[g.gaitIdx!.lean]).toBe(renderSpeciesFrame(bones(), 0, "~"));
      expect(g.frames[g.gaitIdx!.peek]).toBe(renderSpeciesFrame(bones(), 0, "<"));
      expect(g.frames.slice(0, base.frames.length)).toEqual(base.frames);
      expect(g.frameSequence).toEqual(base.frameSequence);
    });

    test("emotion branch also carries variants when requested", () => {
      const g = getStatusFrames(bones(), "angry", undefined, undefined, true);
      expect(g.gaitIdx).toEqual({ bob: 1, lean: 2, peek: 3 });
      // Collision guard: lean must not match the angry frame (different eye)
      expect(g.frames[g.gaitIdx!.lean]).not.toBe(g.frames[0]);
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

// ─── applyProp (ground props — living-world P4 Task 1) ───────────────────────
//
// Structural twin of applyGear/GEAR_ANCHORS above, but a parallel table
// (PROP_ANCHORS): props are ambient world-dressing, not owned gear, so the
// two systems stay independently testable. Wired into renderSpeciesFrame /
// getStatusFrames as of P4 Task 3 — see the "threads a prop" block below for
// the wired-in coverage; these first tests still exercise applyProp directly.

describe("applyProp (ground props — living-world P4)", () => {
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
  // Neither glyph occurs in any species art, so containment proves it landed
  // (a collision would silently skip the overlay).
  const PROP = { feet: "❦", ahead: "•" };

  test("every species' prop anchors are blank across all three idle frames", () => {
    for (const species of SPECIES) {
      for (let f = 0; f < 3; f++) {
        const art = getArtFrame(species, "°", f);
        applyProp(species, art, PROP);
        const joined = art.join("\n");
        expect(joined).toContain(PROP.feet);
        expect(joined).toContain(PROP.ahead);
      }
    }
  });

  test("the P7 stretch frame's prop anchors are also blank (duck/cat/robot)", () => {
    for (const species of ["duck", "cat", "robot"] as const) {
      const art = getArtFrame(species, "°", 3);
      applyProp(species, art, PROP);
      const joined = art.join("\n");
      expect(joined).toContain(PROP.feet);
      expect(joined).toContain(PROP.ahead);
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
      expect(joined).toContain(PROP.ahead);
    }
  });

  test("overlays only ever fill blank cells — body pixels are never clobbered", () => {
    for (const species of SPECIES) {
      for (let f = 0; f < 3; f++) {
        const base = getArtFrame(species, "°", f);
        const propped = getArtFrame(species, "°", f);
        applyProp(species, propped, PROP);
        for (let r = 0; r < propped.length; r++) {
          const b = [...(base[r] ?? "")];
          const p = [...propped[r]];
          for (let c = 0; c < p.length; c++) {
            if ((b[c] ?? " ") !== p[c]) {
              // Changed cell ⇒ it must have been blank (or past end) before.
              expect(b[c] ?? " ").toBe(" ");
            }
          }
        }
      }
    }
  });

  test("wyvern: prop lands and the ANSI fire frame stays intact (wyvern rule)", () => {
    const art = getArtFrame("wyvern", "°", 1); // frame 1 carries the ANSI fire tail
    const fireLineBefore = art[art.length - 1];
    applyProp("wyvern", art, PROP);
    expect(art.join("\n")).toContain(PROP.feet);
    expect(art.join("\n")).toContain(PROP.ahead);
    expect(art[art.length - 1]).toBe(fireLineBefore); // ANSI row untouched
  });

  test("no prop (undefined or empty) leaves the frame untouched", () => {
    const base = getArtFrame("cactus", "°", 0);
    const noProp = getArtFrame("cactus", "°", 0);
    applyProp("cactus", noProp);
    expect(noProp).toEqual(base);
    const emptyProp = getArtFrame("cactus", "°", 0);
    applyProp("cactus", emptyProp, {});
    expect(emptyProp).toEqual(base);
  });

  test("chosen prop glyphs are absent from MIRROR_SWAP (defensive) — survive mirroring unchanged", () => {
    // The idle buddy is never mirrored (only the enemy sprite in combat is),
    // so this is a cheap defensive assertion, not a hard blocker.
    const art = getArtFrame("duck", "°", 0);
    applyProp("duck", art, PROP);
    const mirrored = mirrorFrame(art).join("\n");
    expect(mirrored).toContain(PROP.feet);
    expect(mirrored).toContain(PROP.ahead);
  });

  test("gait lean/peek postures keep the prop anchors blank", () => {
    for (const species of SPECIES) {
      const { frames, gaitIdx } = getStatusFrames(
        bones({ species }),
        "neutral",
        undefined,
        undefined,
        true,
      );
      expect(gaitIdx).toBeDefined();
      for (const idx of [gaitIdx!.lean, gaitIdx!.peek]) {
        const rows = frames[idx].split("\n");
        applyProp(species, rows, PROP);
        const joined = rows.join("\n");
        expect(joined).toContain(PROP.feet);
        expect(joined).toContain(PROP.ahead);
      }
    }
  });

  test("getStatusFrames without a prop arg stays byte-identical (back-compat pin)", () => {
    // Task 3 wires applyProp into the render path via a trailing optional
    // param — omitting it (or passing undefined) must render exactly what it
    // did before Task 3, protecting the render snapshots.
    const before = getStatusFrames(bones());
    const after = getStatusFrames(bones());
    expect(after).toEqual(before);
    const explicitUndefined = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(explicitUndefined).toEqual(before);
  });

  // ── Wired in: P4 Task 3 threads `prop` through renderSpeciesFrame /
  // getStatusFrames's resolveFrame closure, so every returned frame carries
  // it — idle 0-2, blink/glance, the P7 stretch frame, and the appended gait
  // lean/peek postures.

  test("getStatusFrames threads a prop into every idle frame, incl. blink/glance", () => {
    const { frames } = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      undefined,
      false,
      PROP,
    );
    expect(frames).toHaveLength(5); // cactus has no stretch frame
    for (const body of frames) {
      expect(body).toContain(PROP.feet);
      expect(body).toContain(PROP.ahead);
    }
  });

  test("emotion micro-cycles keep the prop on", () => {
    const { frames } = getStatusFrames(
      bones(),
      "happy",
      undefined,
      undefined,
      false,
      PROP,
    );
    for (const body of frames) {
      expect(body).toContain(PROP.feet);
      expect(body).toContain(PROP.ahead);
    }
  });

  test("prop reaches the P7 stretch frame and the gait lean/peek postures", () => {
    // P4 Task 4 (the step-kick) does NOT touch lean/peek — the kick fires on
    // phase===1 step ticks only (`propKickFrameSequence`); lean/peek keep the
    // plain `prop`, identical to Task 3's original behavior.
    for (const species of ["duck", "cat", "robot"] as const) {
      const { frames, gaitIdx } = getStatusFrames(
        bones({ species }),
        "neutral",
        undefined,
        undefined,
        true,
        PROP,
      );
      expect(gaitIdx).toBeDefined();
      // stretch is the frame right before lean, regardless of whether kick
      // frames were appended after peek (duck has kick frames; cat/robot are
      // cramped and don't — `gaitIdx.lean` is the stable reference either way).
      const stretchIdx = gaitIdx!.lean - 1;
      for (const idx of [stretchIdx, gaitIdx!.lean, gaitIdx!.peek]) {
        expect(frames[idx]).toContain(PROP.feet);
        expect(frames[idx]).toContain(PROP.ahead);
      }
    }
  });

  test("gear (applied first) and prop coexist through getStatusFrames — no clobber", () => {
    const { frames } = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      { trinket: ",>" },
      false,
      PROP,
    );
    for (const body of frames) {
      expect(body).toContain(",>");
      expect(body).toContain(PROP.feet);
      expect(body).toContain(PROP.ahead);
    }
  });
});

// ─── prop kick (living-world P4 Task 4 — the step-kick) ──────────────────────
//
// DECISION GATE (plan-p4.md Task 4 Step 1), CORRECTED 2026-07-20: an earlier
// pass of this task concluded no species had a safe second `ahead` column and
// shipped a present/withheld toggle on lean/peek instead — code review caught
// two problems with that: (a) the toggle fired on phase 2/3 (the buddy
// STOPPED), the literal inverse of "a kick as the buddy ambles" (phase===1),
// and (b) a glyph that disappears and reappears with no visible cause is
// flicker, which design.md §P4 explicitly forbids. The review also found the
// "no safe column" conclusion itself was wrong: it checked cols 7-11 in
// aggregate across all 20 species rather than per-species with each species'
// own `PROP_ANCHORS.feet` column excluded.
//
// The corrected per-species blank-cell probe (row 4, cols 7-10, every idle
// frame + the P7 stretch frame + lean/peek, `feet`'s own column excluded —
// Task 1's methodology, pinned as the "every declared kick column is blank"
// test below rather than left as a one-off script) found:
//
//   duck [9]         goose [10,9,8]     owl [10,9]        penguin [10,9,8]
//   turtle [10]       snail [10]        axolotl [10]      cactus [10,9,7]
//   mushroom [10,9]   wyvern [10,9,8]   pikachu [10,9,8,7]
//
// — 11 of 20 species DO have room (`PROP_KICK_COLUMNS`, art.ts). The other 9
// (blob/cat/dragon/octopus/ghost/capybara/robot/rabbit/chonk) are genuinely
// cramped — `feet` already occupies their one otherwise-blank column (or, for
// robot/chonk, `feet` was moved to row 3 in Task 1 specifically because row 4
// had no third column to spare) — and get NO kick at all: the single static
// anchor, exactly Task 3's original behavior, the pebble never withheld.
//
// ⇒ Partial Branch A: species with room get a real sliding pebble —
// `PROP_KICK_COLUMNS[species]` frames, nearest-`ahead`-first, appended after
// lean/peek (`getStatusFrames`'s `kickIdx`) — driven by `propKickDepth`
// (phases → per-tick "steps since the last non-travel tick") and
// `propKickFrameSequence` (the parallel-index overlay onto an already
// gait-remapped `frameSequence`, structurally identical to
// `gaitFrameSequence`). It fires on phase===1 (step) ticks — motion tied to
// actual motion — advances monotonically within a travel run, holds at the
// fully-kicked-in position once maxed within that run, and resets to rest on
// EVERY non-step tick (dwell, edge-dwell, AND home-linger alike — phase 0/2/3
// all reset it): `propKickFrameSequence` only ever overrides the rendered
// frame on a phase===1 tick in the first place, so a "held" depth through the
// edge pause was never actually visible — a subtlety this task's own
// implementation caught and fixed once already; see `propKickDepth`'s
// docstring in art.ts. The glyph is NEVER removed once drawn — every frame
// this task produces still contains `PROP.ahead`.
// Cramped species get no `kickIdx`, so `propKickFrameSequence` is a no-op for
// them and their walk renders exactly as Task 3 left it.

describe("prop kick (living-world P4 Task 4)", () => {
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
  const PROP = { feet: "❦", ahead: "•" };
  const KICK_SPECIES = Object.keys(PROP_KICK_COLUMNS) as (keyof typeof PROP_KICK_COLUMNS)[];
  const CRAMPED_SPECIES = SPECIES.filter((s) => !PROP_KICK_COLUMNS[s]);

  test("sanity: the corrected split is 11 species with room, 9 cramped", () => {
    expect(KICK_SPECIES.length).toBe(11);
    expect(CRAMPED_SPECIES.length).toBe(9);
  });

  // ── Task 1-style blank-cell probe, pinned (not a one-off script) ──────────
  test("every declared kick column is blank across idle frames, the P7 stretch frame, and lean/peek", () => {
    for (const species of KICK_SPECIES) {
      const cols = PROP_KICK_COLUMNS[species]!;
      // Lean/peek substitute "~"/"<" for the eye, outside the normal `Eye`
      // union getArtFrame's public type accepts — reconstruct them the same
      // way renderSpeciesFrame does (raw frame 0, `{E}` replaced directly).
      const altEye = (eye: string): string[] =>
        SPECIES_ART[species][0].map((line) => line.replace(/\{E\}/g, eye));
      const framesToCheck = [
        getArtFrame(species, "°", 0),
        getArtFrame(species, "°", 1),
        getArtFrame(species, "°", 2),
        getArtFrame(species, "°", 3), // wraps to frame 0 for non-P7 species; harmless
        altEye("~"), // lean's underlying frame
        altEye("<"), // peek's underlying frame
      ];
      for (const col of cols) {
        for (const art of framesToCheck) {
          const rows = art.map((r) => r);
          applyPropKicked(species, rows, PROP, col);
          expect(rows.join("\n")).toContain(PROP.ahead);
          expect(rows.join("\n")).toContain(PROP.feet);
        }
      }
    }
  });

  test("declared kick columns are distinct from that species' own feet column", () => {
    for (const species of KICK_SPECIES) {
      const cols = PROP_KICK_COLUMNS[species]!;
      const anchors = PROP_ANCHORS[species];
      const feetCol = anchors.feet[0] === anchors.ahead[0] ? anchors.feet[1] : null;
      for (const col of cols) expect(col).not.toBe(feetCol);
    }
  });

  test("propKickDepth: increments on step ticks, resets on every non-step tick — monotonic within a travel run", () => {
    // dwell, step, step, step, edge-dwell, edge-dwell, step, home-linger, dwell
    const phases: GaitPhase[] = [0, 1, 1, 1, 2, 2, 1, 3, 0];
    expect(propKickDepth(phases)).toEqual([0, 1, 2, 3, 0, 0, 1, 0, 0]);
  });

  test("propKickDepth: pure — same input twice is deep-equal", () => {
    const phases: GaitPhase[] = [1, 1, 0, 1];
    expect(propKickDepth(phases)).toEqual(propKickDepth(phases));
  });

  test("propKickFrameSequence: overrides only phase===1 ticks, capped at the species' kick depth, passthrough elsewhere", () => {
    const phases: GaitPhase[] = [0, 1, 1, 1, 1, 2, 3, 0];
    const baseSeq = [0, 0, 1, 0, 1, 5, 6, 0]; // stand-in gaitFrameSequence output
    const kickIdx = [10, 11, 12]; // 3 kick frames for a hypothetical species
    const out = propKickFrameSequence(phases, baseSeq, kickIdx);
    // Non-step ticks pass through baseSeq untouched.
    expect(out[0]).toBe(baseSeq[0]);
    expect(out[5]).toBe(baseSeq[5]);
    expect(out[6]).toBe(baseSeq[6]);
    expect(out[7]).toBe(baseSeq[7]);
    // Step ticks (indices 1-4) climb through kickIdx, capping at the last
    // entry once depth exceeds the species' available columns (depth 4 at
    // index 4 still maps to kickIdx[2], the last/fully-kicked-in frame).
    expect(out[1]).toBe(kickIdx[0]);
    expect(out[2]).toBe(kickIdx[1]);
    expect(out[3]).toBe(kickIdx[2]);
    expect(out[4]).toBe(kickIdx[2]);
  });

  test("propKickFrameSequence: undefined/empty kickIdx is a no-op passthrough (cramped species)", () => {
    const phases: GaitPhase[] = [0, 1, 1, 2, 3];
    const baseSeq = [0, 1, 0, 5, 6];
    expect(propKickFrameSequence(phases, baseSeq, undefined)).toEqual(baseSeq);
    expect(propKickFrameSequence(phases, baseSeq, [])).toEqual(baseSeq);
  });

  test("getStatusFrames: species with room get kickIdx frames appended after lean/peek; the pebble is never absent from any frame", () => {
    for (const species of KICK_SPECIES) {
      const { frames, gaitIdx, kickIdx } = getStatusFrames(
        bones({ species }),
        "neutral",
        undefined,
        undefined,
        true,
        PROP,
      );
      expect(gaitIdx).toBeDefined();
      expect(kickIdx).toBeDefined();
      expect(kickIdx!.length).toBe(PROP_KICK_COLUMNS[species]!.length);
      // Appended strictly after peek, in order.
      for (let i = 0; i < kickIdx!.length; i++) {
        expect(kickIdx![i]).toBe(gaitIdx!.peek + 1 + i);
      }
      // The pebble is present on EVERY frame — never withheld — EXCEPT the
      // Task 5 inspect frame, always the last appended, which intentionally
      // overrides `ahead` to the dropped-item glyph instead (its own
      // describe block below covers that swap).
      for (const frame of frames.slice(0, -1)) {
        expect(frame).toContain(PROP.ahead);
        expect(frame).toContain(PROP.feet);
      }
    }
  });

  test("kick frames use the ACTIVE emotion's eye, not bones.eye — no eye flicker during an emotional walk (W-NEW-1)", () => {
    // bones.eye defaults to "°" in this file's `bones()` helper, distinct
    // from every EMOTION_EYE value, so a mismatch is unambiguous. An earlier
    // pass of this task hardcoded `bones.eye` into the kick-frame bake,
    // which every existing kick test missed because they all used
    // emotion:"neutral" (where bones.eye and the resolved eye coincide) —
    // code review caught it by rendering a real angry/happy walk.
    for (const [emotion, expectedEye] of Object.entries({
      angry: ">",
      happy: "^",
      bored: "-",
      surprised: "O",
    }) as [Emotion, string][]) {
      for (const species of KICK_SPECIES) {
        const { frames, kickIdx } = getStatusFrames(
          bones({ species }),
          emotion,
          undefined,
          undefined,
          true,
          PROP,
        );
        expect(kickIdx).toBeDefined();
        for (const idx of kickIdx!) {
          const eyeRow = frames[idx].split("\n")[eyeRowIndex(species)];
          expect(eyeRow).toContain(expectedEye);
          // The neutral eye must NOT appear where the emotion eye should —
          // this is the flicker itself, made explicit.
          if (expectedEye !== "°") expect(eyeRow).not.toContain("°");
        }
      }
    }
  });

  test("getStatusFrames: cramped species get no kickIdx — untouched by Task 4, identical to Task 3", () => {
    for (const species of CRAMPED_SPECIES) {
      const withProp = getStatusFrames(
        bones({ species }),
        "neutral",
        undefined,
        undefined,
        true,
        PROP,
      );
      expect(withProp.kickIdx).toBeUndefined();
      // Same carve-out as the KICK_SPECIES test above: the last frame is the
      // Task 5 inspect frame, which intentionally shows the item glyph
      // instead of the pebble at `ahead`.
      for (const frame of withProp.frames.slice(0, -1)) {
        expect(frame).toContain(PROP.ahead);
        expect(frame).toContain(PROP.feet);
      }
    }
  });

  test("no gait variants (gaitVariants=false) ⇒ getStatusFrames is unaffected by the kick — byte-identical to Task 3", () => {
    const withKick = getStatusFrames(bones(), "neutral", undefined, undefined, false, PROP);
    const before = getStatusFrames(bones(), "neutral", undefined, undefined, false, PROP);
    expect(withKick).toEqual(before);
    expect(withKick.kickIdx).toBeUndefined();
    for (const frame of withKick.frames) {
      expect(frame).toContain(PROP.ahead);
      expect(frame).toContain(PROP.feet);
    }
  });

  test("no prop ⇒ kick logic is a no-op (no crash, no kickIdx, gaitIdx still present)", () => {
    const { gaitIdx, kickIdx } = getStatusFrames(bones(), "neutral", undefined, undefined, true);
    expect(gaitIdx).toBeDefined();
    expect(kickIdx).toBeUndefined();
  });
});

// ─── Loot-dash inspect frame (living-world P4 Task 5) ─────────────────────
//
// The stinger's inspect pause needs a POSE, not just a position — the peek
// ("<") posture P1 already appends, with `ahead` swapped for a dropped-item
// glyph instead of the day's own prop there. `state.ts`'s splice block
// (via wander.ts's `stingerInspectOffsets`) points a lootdash arc's pause
// ticks at this frame; this describe block covers the frame itself, in
// isolation from the stinger/state wiring (server/wander.test.ts and
// state_wander.test.ts cover that end of the seam).

describe("loot-dash inspect frame (living-world P4 Task 5)", () => {
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
  const PROP = { feet: "❦", ahead: "•" };

  test("appended for every species when gaitVariants is requested, and the item glyph actually lands (ahead anchor is blank)", () => {
    for (const species of SPECIES) {
      const { frames, inspectIdx } = getStatusFrames(
        bones({ species }),
        "neutral",
        undefined,
        undefined,
        true,
      );
      expect(inspectIdx).toBeDefined();
      expect(frames[inspectIdx!]).toContain(LOOTDASH_ITEM_GLYPH);
    }
  });

  test("absent when gaitVariants is not requested", () => {
    const { inspectIdx } = getStatusFrames(bones());
    expect(inspectIdx).toBeUndefined();
  });

  test("appended strictly after any kick frames, so kickIdx's own numbering is undisturbed", () => {
    // "duck" has kick columns (PROP_KICK_COLUMNS); confirm inspectIdx lands
    // right after the last kick frame, not spliced in the middle.
    const { kickIdx, inspectIdx } = getStatusFrames(
      bones({ species: "duck" }),
      "neutral",
      undefined,
      undefined,
      true,
      PROP,
    );
    expect(kickIdx).toBeDefined();
    expect(inspectIdx).toBe(kickIdx![kickIdx!.length - 1] + 1);
  });

  test("swaps `ahead` for the item glyph but leaves `feet` untouched (not a wholesale prop swap)", () => {
    const { frames, inspectIdx } = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      undefined,
      true,
      PROP,
    );
    expect(frames[inspectIdx!]).toContain(LOOTDASH_ITEM_GLYPH);
    expect(frames[inspectIdx!]).not.toContain(PROP.ahead); // item replaces the day pebble
    expect(frames[inspectIdx!]).toContain(PROP.feet); // feet untouched
  });

  test("renders even with no day prop supplied — the item glyph doesn't depend on `prop`", () => {
    const { frames, inspectIdx } = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      undefined,
      true,
    );
    expect(frames[inspectIdx!]).toContain(LOOTDASH_ITEM_GLYPH);
  });

  test("uses the peek eye ('<'), never bones.eye — no hardcoded-eye flicker across any emotion", () => {
    // Mirrors the kick frames' own W-NEW-1 regression test: peek is a FIXED
    // pose eye by design (see the lean/peek comment in art.ts), so this
    // confirms the inspect frame follows that same established rule rather
    // than accidentally reintroducing a bones.eye/emotion-eye leak.
    for (const [emotion, otherEye] of Object.entries({
      neutral: "°",
      angry: ">",
      happy: "^",
      bored: "-",
      surprised: "O",
    }) as [Emotion, string][]) {
      const { frames, inspectIdx } = getStatusFrames(
        bones(),
        emotion,
        undefined,
        undefined,
        true,
        PROP,
      );
      const eyeRow = frames[inspectIdx!].split("\n")[eyeRowIndex("cactus")];
      expect(eyeRow).toContain("<");
      if (emotion !== "neutral") expect(eyeRow).not.toContain(otherEye);
    }
  });

  test("LOOTDASH_ITEM_GLYPH is ANSI-free and survives mirrorFrame unchanged (MIRROR_SWAP-safe, defensive)", () => {
    // The idle buddy is never actually mirrored (only the enemy sprite in
    // combat is) — this is the same cheap defensive check props.ts's own
    // glyphs and applyBossCrown's `♛` get.
    expect(LOOTDASH_ITEM_GLYPH).not.toContain("\x1b");
    const { frames, inspectIdx } = getStatusFrames(
      bones(),
      "neutral",
      undefined,
      undefined,
      true,
    );
    const mirrored = mirrorFrame(frames[inspectIdx!].split("\n"));
    expect(mirrored.join("\n")).toContain(LOOTDASH_ITEM_GLYPH);
  });
});

// ─── applyBossCrown (living-world P2 Task 6 — boss look, decision-gate branch B) ─
//
// Species stays the curated tier-4 bug roster (adding a dedicated boss species
// would leak into the hatch/adopt pools — SPECIES is the pool, not an explicit
// allow-list; see the task's report). The boss look is instead a `♛` crown
// composited onto the enemy's blank row 0, mirroring the `applyHat` blank-cell
// contract used on the player side.

describe("applyBossCrown (boss look, P2 Task 6)", () => {
  test("writes a centered crown into a blank row 0", () => {
    const art = getArtFrame("dragon", "°", 0);
    expect(art[0].trim()).toBe(""); // precondition: dragon frame 0 row 0 is blank
    applyBossCrown(art);
    expect(art[0]).toContain("♛");
    expect(displayWidth(art[0])).toBe(displayWidth(getArtFrame("dragon", "°", 0)[0]));
  });

  test("no-ops when row 0 is already occupied", () => {
    const art = ["taken", "  body  "];
    applyBossCrown(art);
    expect(art[0]).toBe("taken");
  });

  test("♛ is absent from MIRROR_SWAP, so it survives mirrorFrame unchanged", () => {
    const art = getArtFrame("dragon", "°", 0);
    applyBossCrown(art);
    const mirrored = mirrorFrame(art);
    expect(mirrored[0]).toContain("♛");
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

describe("gaitFrameSequence (living-world P1)", () => {
  const idx = { bob: 1, lean: 5, peek: 6 };
  const baseSeq = [0, 0, 1, 0, 2];
  test("dwell ticks follow the base cycle; length matches phases", () => {
    const seq = gaitFrameSequence([0, 0, 0, 0, 0, 0] as GaitPhase[], baseSeq, idx, false);
    expect(seq).toEqual([0, 0, 1, 0, 2, 0]);
  });
  test("step ticks alternate base and bob", () => {
    const seq = gaitFrameSequence([1, 1, 1, 1] as GaitPhase[], baseSeq, idx, false);
    expect(seq).toEqual([0, 1, 1, 1]); // parity: base[0], bob, base[2](=1), bob
  });
  test("edge dwell leans; home linger peeks only with the panel on", () => {
    expect(gaitFrameSequence([2, 2] as GaitPhase[], baseSeq, idx, false)).toEqual([5, 5]);
    expect(gaitFrameSequence([3, 3] as GaitPhase[], baseSeq, idx, true)).toEqual([6, 6]);
    expect(gaitFrameSequence([3] as GaitPhase[], baseSeq, idx, false)).toEqual([0]);
  });
  test("parity advances only on step ticks, spanning phase boundaries", () => {
    // Trace: [0, 1, 2, 1, 3, 1, 1] with baseSeq [0,0,1,0,2], idx {bob:1,lean:5,peek:6}, showStats=false
    // i0 dwell(0) → baseSeq[0]=0, parity stays 0
    // i1 step(1) → parity0++ % 2 = 0, baseSeq[1]=0, parity→1
    // i2 edge(2) → lean=5, parity stays 1
    // i3 step(1) → parity1++ % 2 = 1, bob=1, parity→2
    // i4 linger(3) noStats → baseSeq[4]=2, parity stays 2
    // i5 step(1) → parity2++ % 2 = 0, baseSeq[0]=0, parity→3
    // i6 step(1) → parity3++ % 2 = 1, bob=1, parity→4
    const seq = gaitFrameSequence([0, 1, 2, 1, 3, 1, 1] as GaitPhase[], baseSeq, idx, false);
    expect(seq).toEqual([0, 0, 5, 1, 2, 0, 1]);
  });
});
