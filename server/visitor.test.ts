import { describe, expect, test } from "bun:test";

import { displayWidth } from "./art";
import { bakeVisitorScene, rollVisitor, VISITOR_ODDS } from "./visitor";

describe("visitor core (living-world P2)", () => {
  test("roll is seeded, ~1/12, and never the player's species", () => {
    let hits = 0;
    for (let s = 0; s < 1200; s++) {
      const v = rollVisitor(s, "cactus");
      if (v) {
        hits++;
        expect(v.species).not.toBe("cactus");
      }
      expect(rollVisitor(s, "cactus")).toEqual(v); // deterministic
    }
    expect(hits).toBeGreaterThan(60);
    expect(hits).toBeLessThan(140); // ~100 at 1200/VISITOR_ODDS
  });

  test("VISITOR_ODDS is the documented 1-in-12", () => {
    expect(VISITOR_ODDS).toBe(12);
  });

  test("species always comes from the curated BUGS-mirror set", () => {
    // blob/snail/ghost/robot/octopus/cactus/dragon — BUGS' species values,
    // de-duplicated (bugs.ts). Excludes the player's own species (goose is
    // not a bug species, so every hit for a goose player must land here).
    const curated = new Set([
      "blob", "snail", "ghost", "robot", "octopus", "cactus", "dragon",
    ]);
    for (let s = 0; s < 600; s++) {
      const v = rollVisitor(s, "goose");
      if (v) expect(curated.has(v.species)).toBe(true);
    }
  });

  test("reward: ~25% carry points 3-8, the rest are pure visits", () => {
    let rewards = 0;
    for (let s = 0; s < 400; s++) {
      const v = rollVisitor(s, "cactus");
      if (v?.reward) {
        rewards++;
        expect(v.reward.points).toBeGreaterThanOrEqual(3);
        expect(v.reward.points).toBeLessThanOrEqual(8);
      }
    }
    expect(rewards).toBeGreaterThan(0);
  });

  test("greet scene: constant width and height, walks on and off", () => {
    const scene = bakeVisitorScene("cactus", "·", {
      species: "goose",
      shiny: false,
    }, 7);

    expect(scene.frames.length).toBeGreaterThan(0);
    for (const i of scene.sequence) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(scene.frames.length);
    }
    expect(scene.sequence.length).toBeGreaterThanOrEqual(12);
    expect(scene.sequence.length).toBeLessThanOrEqual(16);

    const widths = new Set<number>();
    const heights = new Set<number>();
    for (const frame of scene.frames) {
      const lines = frame.split("\n");
      heights.add(lines.length);
      for (const line of lines) widths.add(displayWidth(line));
    }
    expect(widths.size).toBe(1);
    expect(heights.size).toBe(1);

    // The visitor closes to a fixed gap (greet) and recedes back to rest —
    // proof the "walk on and off" beats actually move: not every frame is
    // identical.
    expect(new Set(scene.frames).size).toBeGreaterThan(1);
  });

  test("greet scene: the heart pop appears on exactly one beat", () => {
    const scene = bakeVisitorScene("cactus", "·", {
      species: "dragon",
      shiny: false,
    }, 7);
    const withHeart = scene.frames.filter((f) => f.includes("♥"));
    expect(withHeart.length).toBe(1);
  });

  test("greet scene is deterministic for a given seed", () => {
    const a = bakeVisitorScene("cactus", "·", {
      species: "blob",
      shiny: true,
    }, 42);
    const b = bakeVisitorScene("cactus", "·", {
      species: "blob",
      shiny: true,
    }, 42);
    expect(a.frames).toEqual(b.frames);
    expect(a.sequence).toEqual(b.sequence);
  });

  test("greet scene: no look ⇒ free of overlay glyphs from PlayerLook (back-compat)", () => {
    const scene = bakeVisitorScene("cactus", "·", {
      species: "octopus",
      shiny: false,
    }, 3);
    for (const frame of scene.frames) {
      expect(frame).not.toContain("\\^^^/"); // crown art, never worn here
    }
  });
});
