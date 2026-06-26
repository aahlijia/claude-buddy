import { describe, expect, test } from "bun:test";

import type { BuddyBones } from "./engine";
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

const t1: Bug = { id: "x", name: "typo gremlin", glyph: "🐛", tier: 1, reward: 1 };
const t4: Bug = { id: "y", name: "segfault dragon", glyph: "🐉", tier: 4, reward: 5 };

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
