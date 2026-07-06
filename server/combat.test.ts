import { describe, expect, test } from "bun:test";

import type { BuddyBones } from "./engine";
import { displayWidth, getArtFrame, mirrorFrame } from "./art";
import type { Equipment } from "./items";
import type { Bug } from "./bugs";
import {
  WIN_CEIL,
  WIN_FLOOR,
  resolveCombat,
  winChance,
} from "./combat";

function bones(debug: number, overrides: Partial<BuddyBones> = {}): BuddyBones {
  return {
    rarity: "common",
    species: "cactus",
    eye: "·",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: debug, PATIENCE: 40, CHAOS: 30, WISDOM: 20, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "WISDOM",
    ...overrides,
  };
}

const t1: Bug = { id: "x", name: "typo gremlin", glyph: "🐛", tier: 1, reward: 1, species: "blob" };
const t4: Bug = { id: "y", name: "segfault dragon", glyph: "🐉", tier: 4, reward: 5, species: "dragon" };

/** Win frequency over many seeds — Monte-Carlo the deterministic resolver. */
function winRate(b: BuddyBones, bug: Bug, eq: Equipment, n = 400): number {
  let wins = 0;
  for (let s = 0; s < n; s++) {
    if (resolveCombat(b, bug, eq, s).outcome === "win") wins++;
  }
  return wins / n;
}

describe("winChance", () => {
  test("rises with DEBUGGING, falls with tier", () => {
    expect(winChance(80, false, 1)).toBeGreaterThan(winChance(20, false, 1));
    expect(winChance(50, false, 4)).toBeLessThan(winChance(50, false, 1));
  });

  test("an equipped weapon helps", () => {
    expect(winChance(50, true, 2)).toBeGreaterThan(winChance(50, false, 2));
  });

  test("clamped to [floor, ceil]", () => {
    expect(winChance(1000, true, 1)).toBeLessThanOrEqual(WIN_CEIL);
    expect(winChance(0, false, 4)).toBeGreaterThanOrEqual(WIN_FLOOR);
  });
});

describe("resolveCombat", () => {
  test("is deterministic for a given seed", () => {
    const a = resolveCombat(bones(50), t1, {}, 42);
    const b = resolveCombat(bones(50), t1, {}, 42);
    expect(a.outcome).toBe(b.outcome);
    expect(a.frames).toEqual(b.frames);
    expect(a.drop).toEqual(b.drop);
    expect(a.summary).toBe(b.summary);
  });

  test("bakes a non-empty, index-safe flipbook", () => {
    const r = resolveCombat(bones(50), t1, {}, 7);
    expect(r.frames.length).toBeGreaterThan(0);
    expect(r.sequence.length).toBeGreaterThan(0);
    for (const i of r.sequence) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(r.frames.length);
    }
    expect(r.enemyGlyph).toBe(t1.glyph);
  });

  test("higher DEBUGGING wins more often", () => {
    expect(winRate(bones(90), t1, {})).toBeGreaterThan(winRate(bones(10), t1, {}));
  });

  test("tougher bugs win less often", () => {
    expect(winRate(bones(50), t4, {})).toBeLessThan(winRate(bones(50), t1, {}));
  });

  test("equipping a stat weapon raises the win rate", () => {
    const bare = winRate(bones(50), t1, {});
    const armed = winRate(bones(50), t1, { weapon: "foam_sword" });
    expect(armed).toBeGreaterThan(bare);
  });

  test("a win drops points ≥ the bug's reward", () => {
    // seed search for a guaranteed win at high DEBUGGING vs a t1
    const b = bones(95);
    let win = resolveCombat(b, t1, {}, 0);
    for (let s = 0; win.outcome !== "win" && s < 50; s++) {
      win = resolveCombat(b, t1, {}, s);
    }
    expect(win.outcome).toBe("win");
    expect(win.drop.points).toBeGreaterThanOrEqual(t1.reward);
    expect(win.summary).toContain("squashed");
  });

  test("never drops an item the player already owns (no phantom loot)", () => {
    const everything = new Set(
      // all catalog ids — nothing left to drop
      ["rubber_duck", "debug_wand", "foam_sword", "lucky_hat", "compiler_crown"],
    );
    const b = bones(95);
    // Even across many guaranteed-win seeds, an owned item is never granted and
    // the summary never claims a find.
    for (let s = 0; s < 100; s++) {
      const r = resolveCombat(b, t1, {}, s, everything);
      if (r.outcome !== "win") continue;
      expect(r.drop.itemId).toBeUndefined();
      expect(r.summary).not.toContain("found");
    }
  });

  test("a flee yields no points and no item", () => {
    const b = bones(1);
    let flee = resolveCombat(b, t4, {}, 0);
    for (let s = 0; flee.outcome !== "flee" && s < 50; s++) {
      flee = resolveCombat(b, t4, {}, s);
    }
    expect(flee.outcome).toBe("flee");
    expect(flee.drop.points).toBe(0);
    expect(flee.drop.itemId).toBeUndefined();
    expect(flee.summary).toContain("scuttled off");
  });
});

describe("two-sprite combat scene (Phase 5)", () => {
  test("every line of every frame is the same display width (no jitter)", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    const widths = new Set<number>();
    for (const frame of r.frames) {
      for (const line of frame.split("\n")) widths.add(displayWidth(line));
    }
    // A constant-width scene ⇒ exactly one width across all rows of all frames.
    expect(widths.size).toBe(1);
  });

  test("the scene is wider than a single sprite (two creatures present)", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    const sceneW = displayWidth(r.frames[0].split("\n")[0]);
    const playerW = Math.max(
      ...getArtFrame("cactus", "·", 0).map((l) => displayWidth(l)),
    );
    expect(sceneW).toBeGreaterThan(playerW * 2);
  });

  test("the enemy half is the mirror of its species art", () => {
    // Explicit resting eye so the comparison is codepoint-stable.
    const sceneBug: Bug = { ...t4, eye: "·" };
    const r = resolveCombat(bones(50), sceneBug, {}, 3);
    const enemyMirror = mirrorFrame(getArtFrame("dragon", "·", 0));
    const ready = r.frames[0].split("\n");
    // Each scene line ends with the mirrored enemy block (rightmost element).
    for (let i = 0; i < enemyMirror.length; i++) {
      const sceneLine = ready[ready.length - enemyMirror.length + i];
      expect(sceneLine.endsWith(enemyMirror[i])).toBe(true);
    }
  });

  test("the strike frame clashes blades on the eye row", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    // sequence is [0,1,2,2,3,3]; frame index 2 is the strike.
    const strike = r.frames[2].split("\n");
    const eyeRow = strike[Math.floor(strike.length / 2)];
    // Default blade "/" leans right; its mirror "\\" leans left — they meet.
    expect(eyeRow).toContain("/\\");
  });

  test("clash lands on the eye row for a 6-line player (wyvern), not center", () => {
    // wyvern art is 6 lines with eyes on row index 2 — Math.floor(6/2)=3 would
    // drop the clash a row below the eyes. The fix derives the row from the art.
    const r = resolveCombat(bones(50, { species: "wyvern" }), t4, {}, 3);
    const strike = r.frames[2].split("\n");
    expect(strike[2]).toContain("/\\"); // blades clash on the actual eye row
    expect(strike[Math.floor(strike.length / 2)]).not.toContain("/\\"); // center is row 3
  });

  test("determinism extends to the multi-line scene frames", () => {
    const a = resolveCombat(bones(50), t4, {}, 11);
    const b = resolveCombat(bones(50), t4, {}, 11);
    expect(a.frames).toEqual(b.frames);
  });
});
