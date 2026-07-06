import { describe, expect, test } from "bun:test";

import { BUGS, bugsOfTier, spawnBug, tierForErrors } from "./bugs";
import { SPECIES } from "./engine";

// Species curated for the two-sprite scene (Phase 5): clean 5-line, ANSI-free
// sprites. wyvern (6 lines + ANSI) and pikachu (irregular) are excluded so the
// mirror pass in combat.ts stays well-defined.
const COMBAT_ROSTER = new Set(SPECIES);
COMBAT_ROSTER.delete("wyvern");
COMBAT_ROSTER.delete("pikachu");

describe("bug catalog integrity", () => {
  test("ids are unique", () => {
    const ids = BUGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("tiers are 1..4 and rewards are positive", () => {
    for (const bug of BUGS) {
      expect(bug.tier).toBeGreaterThanOrEqual(1);
      expect(bug.tier).toBeLessThanOrEqual(4);
      expect(bug.reward).toBeGreaterThan(0);
      expect(bug.glyph.length).toBeGreaterThan(0);
      expect(bug.name.length).toBeGreaterThan(0);
    }
  });

  test("every tier 1..4 has at least one bug", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(bugsOfTier(tier).length).toBeGreaterThan(0);
    }
  });

  test("every bug has a renderable, curated species (Phase 5)", () => {
    for (const bug of BUGS) {
      expect(SPECIES).toContain(bug.species);
      expect(COMBAT_ROSTER.has(bug.species)).toBe(true);
    }
  });

  test("species is stable per id (deterministic mapping)", () => {
    const byId = new Map(BUGS.map((b) => [b.id, b.species]));
    expect(byId.get("segfault_dragon")).toBe("dragon");
    expect(byId.get("null_wraith")).toBe("ghost");
    // The catalog object is frozen-shaped: re-reading yields the same mapping.
    expect(BUGS.map((b) => b.species)).toEqual(
      BUGS.map((b) => byId.get(b.id)!),
    );
  });
});

describe("tierForErrors", () => {
  test("0 errors → no spawn", () => {
    expect(tierForErrors(0)).toBe(0);
    expect(tierForErrors(-3)).toBe(0);
  });

  test("scales with severity", () => {
    expect(tierForErrors(1)).toBe(1);
    expect(tierForErrors(2)).toBe(1);
    expect(tierForErrors(3)).toBe(2);
    expect(tierForErrors(5)).toBe(2);
    expect(tierForErrors(6)).toBe(3);
    expect(tierForErrors(9)).toBe(3);
    expect(tierForErrors(10)).toBe(4);
    expect(tierForErrors(100)).toBe(4);
  });

  test("is monotonic", () => {
    let prev = 0;
    for (let e = 0; e <= 20; e++) {
      const t = tierForErrors(e);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe("spawnBug", () => {
  test("returns null when there were no errors", () => {
    expect(spawnBug(0, 123)).toBeNull();
  });

  test("spawns a bug of the mapped tier", () => {
    expect(spawnBug(1, 1)?.tier).toBe(1);
    expect(spawnBug(4, 1)?.tier).toBe(2);
    expect(spawnBug(7, 1)?.tier).toBe(3);
    expect(spawnBug(50, 1)?.tier).toBe(4);
  });

  test("is deterministic for a given seed", () => {
    expect(spawnBug(3, 999)?.id).toBe(spawnBug(3, 999)?.id);
  });

  test("seed varies the pick within a tier", () => {
    // tier 1 has 2 bugs — across many seeds we should see both.
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) seen.add(spawnBug(1, s)!.id);
    expect(seen.size).toBeGreaterThan(1);
  });
});
