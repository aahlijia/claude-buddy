import { describe, expect, test } from "bun:test";

import { SPECIES } from "../engine.ts";
import {
  CINE_H,
  CINE_W,
  HATCH_BURST,
  HATCH_MS,
  LOOT_MS,
  LOOT_POP,
  cineFeel,
  renderHatch,
  renderLoot,
  type CineFeel,
} from "./cinema.ts";
import { crc32 } from "./encode/png.ts";
import type { Framebuffer } from "./framebuffer.ts";

const FULL = cineFeel("full")!;
const SUBTLE = cineFeel("subtle")!;
const STILL = cineFeel("full", true)!;
const CAT = { species: "cat" as const, rarity: "legendary" as const, shiny: false, seed: 3 };
const SWORD = { name: "Segfault Saber", rarity: "legendary" as const, slot: "weapon" as const, seed: 3 };
const hash = (fb: Framebuffer) => crc32(new Uint8Array(fb.data));

function mean(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.data.length; i += 4) n += 0.3 * fb.data[i] + 0.55 * fb.data[i + 1] + 0.15 * fb.data[i + 2];
  return n / (fb.width * fb.height);
}

describe("gates", () => {
  test("off never plays; subtle has no shake or flash; reduce-motion drops motion too", () => {
    expect(cineFeel("off")).toBeNull();
    expect(cineFeel("full")).toEqual({ shake: true, flash: true, motion: true });
    expect(cineFeel("subtle")).toEqual({ shake: false, flash: false, motion: true });
    expect(cineFeel("full", true)).toEqual({ shake: false, flash: false, motion: false });
  });
});

describe("hatch", () => {
  test("pure, and the frame size never changes", () => {
    for (const ms of [0, 900, HATCH_BURST, HATCH_MS]) {
      const a = renderHatch(CAT, ms, FULL);
      expect(a.width).toBe(CINE_W);
      expect(a.height).toBe(CINE_H);
      expect(hash(a)).toBe(hash(renderHatch(CAT, ms, FULL)));
    }
  });

  test("the wobble builds; reduce-motion keeps the egg still", () => {
    const rest = hash(renderHatch(CAT, 0, STILL));
    expect(hash(renderHatch(CAT, 1600, FULL))).not.toBe(hash(renderHatch(CAT, 1600, STILL)));
    // Still: only the cracks and the light change, never the egg's pose.
    expect(hash(renderHatch(CAT, 400, STILL))).toBe(rest);
  });

  test("the cracks glow in the rarity's color", () => {
    // Count warm (gold) and cool (blue) highlights: the cracks are the
    // brightest pixels on the egg and carry the rarity's light.
    const lit = (fb: Framebuffer, warm: boolean) => {
      let n = 0;
      for (let i = 0; i < fb.data.length; i += 4) {
        const [r, , b] = [fb.data[i], fb.data[i + 1], fb.data[i + 2]];
        if (Math.max(r, b) > 200 && (warm ? r - b > 40 : b - r > 40)) n++;
      }
      return n;
    };
    const gold = renderHatch({ ...CAT, rarity: "legendary" }, 1400, SUBTLE);
    const blue = renderHatch({ ...CAT, rarity: "rare" }, 1400, SUBTLE);
    expect(lit(gold, true)).toBeGreaterThan(lit(blue, true) + 5);
    expect(lit(blue, false)).toBeGreaterThan(lit(gold, false) + 5);
  });

  test("the burst flashes only when flashes are allowed", () => {
    const at = HATCH_BURST + 20;
    expect(mean(renderHatch(CAT, at, FULL))).toBeGreaterThan(mean(renderHatch(CAT, at, SUBTLE)) + 60);
  });

  test("shiny buddies get the sparkle sting", () => {
    const at = HATCH_BURST + 700;
    expect(hash(renderHatch({ ...CAT, shiny: true }, at, SUBTLE))).not.toBe(hash(renderHatch(CAT, at, SUBTLE)));
  });

  test("every species hatches", () => {
    for (const species of SPECIES) expect(mean(renderHatch({ ...CAT, species }, HATCH_MS, SUBTLE))).toBeGreaterThan(5);
  });
});

describe("loot", () => {
  test("the chest shakes before the pop; the beam lights the stage after", () => {
    expect(hash(renderLoot(SWORD, 500, SUBTLE))).not.toBe(hash(renderLoot(SWORD, 520, SUBTLE)));
    expect(mean(renderLoot(SWORD, LOOT_POP + 400, SUBTLE))).toBeGreaterThan(mean(renderLoot(SWORD, 200, SUBTLE)) + 5);
  });

  test("only legendary flashes, and only when allowed", () => {
    const at = LOOT_POP + 15;
    expect(mean(renderLoot(SWORD, at, FULL))).toBeGreaterThan(mean(renderLoot(SWORD, at, SUBTLE)) + 60);
    const rare = { ...SWORD, rarity: "rare" as const };
    expect(mean(renderLoot(rare, at, FULL))).toBeLessThan(mean(renderLoot(SWORD, at, FULL)) - 60);
  });

  test("legendary spins; reduce-motion holds it still", () => {
    const a = (feel: CineFeel, ms: number) => hash(renderLoot(SWORD, ms, feel));
    expect(a(SUBTLE, LOOT_MS - 400)).not.toBe(a(SUBTLE, LOOT_MS - 200));
    // Still: the beam pulses but the icon keeps its shape, so only light changes.
    expect(a(STILL, LOOT_MS - 400)).not.toBe(a(SUBTLE, LOOT_MS - 400));
  });

  test("every slot has an icon", () => {
    for (const slot of ["weapon", "armor", "charm"] as const) {
      expect(hash(renderLoot({ ...SWORD, slot }, LOOT_MS, SUBTLE))).not.toBe(hash(renderLoot({ ...SWORD, slot: slot === "weapon" ? "charm" : "weapon" }, LOOT_MS, SUBTLE)));
    }
  });
});

/**
 * Golden pixel hashes. After an intentional art change, run
 *   GOLDEN=print bun test server/gfx/cinema.test.ts
 * and paste the printed table here.
 */
const GOLDEN: Record<string, number> = {
  "hatch/wobble": 2698911086,
  "hatch/burst": 2488020218,
  "hatch/shiny": 488884563,
  "loot/shake": 437385460,
  "loot/beam": 126359493,
  "loot/legendary": 88688548,
};

describe("golden frames", () => {
  const actual: Record<string, number> = {
    "hatch/wobble": hash(renderHatch(CAT, 1500, FULL)),
    "hatch/burst": hash(renderHatch(CAT, HATCH_BURST + 200, SUBTLE)),
    "hatch/shiny": hash(renderHatch({ ...CAT, shiny: true, rarity: "epic" }, HATCH_BURST + 800, SUBTLE)),
    "loot/shake": hash(renderLoot(SWORD, 600, SUBTLE)),
    "loot/beam": hash(renderLoot({ ...SWORD, rarity: "rare", slot: "armor" }, LOOT_POP + 900, SUBTLE)),
    "loot/legendary": hash(renderLoot(SWORD, LOOT_MS, FULL)),
  };
  test("match the recorded hashes", () => {
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    for (const [k, v] of Object.entries(GOLDEN)) expect(actual[k], k).toBe(v);
    expect(Object.keys(GOLDEN).length).toBe(Object.keys(actual).length);
  });
});
