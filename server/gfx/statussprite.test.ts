import { describe, expect, test } from "bun:test";

import { crc32 } from "./encode/png.ts";
import { STATUS_SPRITES, bakeStatusSprite, keyPoses, type SpriteLook } from "./statussprite.ts";

const LOOK: SpriteLook = { species: "cat", rarity: "rare", shiny: false, seed: 7 };
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("status-line sprite", () => {
  test("deterministic", () => {
    expect(bakeStatusSprite(LOOK, "mini")).toEqual(bakeStatusSprite(LOOK, "mini"));
  });

  test("no sprite for species without HD art, or when off", () => {
    expect(bakeStatusSprite({ ...LOOK, species: "nope" as never }, "mini")).toBeNull();
    // H6: every real species now has one.
    expect(bakeStatusSprite({ ...LOOK, species: "duck" }, "mini")).not.toBeNull();
    expect(bakeStatusSprite(LOOK, "off")).toBeNull();
    expect(STATUS_SPRITES).toEqual(["off", "mini", "full"]);
  });

  test("mini fits ~6 rows, full ~12; every frame is the same box", () => {
    for (const species of ["blob", "cat", "dragon"] as const) {
      for (const [size, maxRows, maxW] of [["mini", 6, 14], ["full", 12, 28]] as const) {
        const s = bakeStatusSprite({ ...LOOK, species }, size)!;
        expect(s.rows).toBeLessThanOrEqual(maxRows);
        expect(s.width).toBeLessThanOrEqual(maxW);
        for (const f of [...s.frames, ...s.celebFrames]) {
          const lines = f.split("\n");
          expect(lines.length).toBe(s.rows);
          for (const l of lines) {
            expect(plain(l).length).toBe(s.width);
            expect(l.endsWith("\x1b[0m")).toBe(true); // no color bleeds past the sprite
            expect(l).not.toMatch(/[\n\r\t\x07]/);
          }
        }
      }
    }
  });

  test("sequences index real frames; poses differ; a blink is in the idle loop", () => {
    for (const mood of ["neutral", "happy", "angry", "bored", "surprised"] as const) {
      const s = bakeStatusSprite(LOOK, "mini", mood)!;
      for (const i of s.sequence) expect(s.frames[i]).toBeDefined();
      for (const i of s.celebSequence) expect(s.celebFrames[i]).toBeDefined();
      expect(new Set(s.frames).size).toBeGreaterThan(1);
    }
    expect(keyPoses("neutral", 7).poses.at(-1)!.t).toBeGreaterThan(0);
    // Anger flinches first thing in the cycle; happiness hops.
    expect(keyPoses("angry", 7).poses[keyPoses("angry", 7).sequence[0]].anim).toBe("hit");
    expect(keyPoses("happy", 7).poses[keyPoses("happy", 7).sequence[0]].anim).toBe("victory");
  });

  test("reduceMotion bakes one still pose", () => {
    const s = bakeStatusSprite(LOOK, "full", "angry", true)!;
    expect(s.frames.length).toBe(1);
    expect(s.sequence).toEqual([0]);
    expect(s.celebFrames.length).toBe(1);
  });

  test("only solid pixels: no translucent shadow cells", () => {
    // Every colored cell is a ▀/▄ with real colors; transparent cells are plain spaces.
    const s = bakeStatusSprite({ ...LOOK, species: "blob" }, "full")!;
    for (const f of s.frames) for (const l of f.split("\n")) expect(plain(l)).toMatch(/^[ ▀▄█]+$/);
  });

  test("golden frames", () => {
    const actual: Record<string, number> = {};
    for (const species of ["blob", "cat", "dragon"] as const) {
      for (const size of ["mini", "full"] as const) {
        const s = bakeStatusSprite({ ...LOOK, species }, size)!;
        actual[`${species}/${size}`] = crc32(new TextEncoder().encode([...s.frames, ...s.celebFrames].join("|")));
      }
    }
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    expect(actual).toEqual(GOLDEN);
  });
});

const GOLDEN: Record<string, number> = {
  "blob/mini": 396944532,
  "blob/full": 1925503854,
  "cat/mini": 1939859777,
  "cat/full": 3212951862,
  "dragon/mini": 1940913160,
  "dragon/full": 138707025,
};
