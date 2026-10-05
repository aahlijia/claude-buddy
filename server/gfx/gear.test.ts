import { describe, expect, test } from "bun:test";

import { HATS, SPECIES } from "../engine.ts";
import { crc32 } from "./encode/png.ts";
import type { Framebuffer } from "./framebuffer.ts";
import { GEAR_MATERIAL_KEYS, HD_HEADROOM, anchorsOf, equipRig, gearKey, hdGearOf, type HdGear } from "./gear.ts";
import { ANIMS, ANIM_INFO, HD_H, RIGS, groundOf, renderHd } from "./hd.ts";

const hash = (fb: Framebuffer) => crc32(new Uint8Array(fb.data));
const HAT_LIST = HATS.filter((h) => h !== "none");

/** Opaque pixels that differ between two same-size frames. */
function diff(a: Framebuffer, b: Framebuffer): { n: number; cx: number; cy: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const p = a.get(x, y);
      const q = b.get(x, y);
      if (p[3] < 200 || (p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3])) continue;
      n++;
      sx += x;
      sy += y;
    }
  }
  return { n, cx: sx / Math.max(1, n), cy: sy / Math.max(1, n) };
}

/** The frame without its top headroom (same size as a bare one). */
function crop(fb: Framebuffer): Framebuffer {
  if (fb.height === HD_H) return fb;
  const pad = fb.height - HD_H;
  const out = new (fb.constructor as typeof Framebuffer)(fb.width, HD_H);
  for (let y = 0; y < HD_H; y++) for (let x = 0; x < fb.width; x++) out.set(x, y, fb.get(x, y + pad));
  return out;
}

describe("gear from equipment", () => {
  test("hdGearOf maps hats and glyphs; nothing worn is undefined", () => {
    expect(hdGearOf({ hat: "none" })).toBeUndefined();
    expect(hdGearOf({ hat: "crown", weaponArt: "/", trinketArt: ",>" })).toEqual({ hat: "crown", weapon: "wand", trinket: "duck" });
    expect(hdGearOf({ weaponArt: "†" })).toEqual({ weapon: "sword" });
    expect(hdGearOf({ weaponArt: "?" })).toEqual({ weapon: "sword" });
    expect(gearKey(undefined)).toBe("");
    expect(gearKey({ hat: "halo" })).not.toBe(gearKey({ hat: "crown" }));
  });
});

describe("equipping rigs", () => {
  test("no gear is the rig itself; equipping is cached", () => {
    const cat = RIGS.cat!;
    expect(equipRig(cat)).toBe(cat);
    expect(equipRig(cat, { trinket: "duck" })).toBe(cat);
    expect(equipRig(cat, { hat: "crown" })).toBe(equipRig(cat, { hat: "crown" }));
  });

  test("a hat is a part on the head; the canvas grows upward by the headroom", () => {
    const cat = RIGS.cat!;
    const worn = equipRig(cat, { hat: "crown" });
    const hat = worn.parts.find((p) => p.name === "gear:hat")!;
    expect(hat.parent).toBe(anchorsOf(cat).hat.part);
    expect(worn.height).toBe(cat.height + HD_HEADROOM);
    expect(worn.ground).toBe(cat.ground + HD_HEADROOM);
    // A weapon alone needs no headroom.
    expect(equipRig(cat, { weapon: "sword" }).height).toBe(cat.height);
  });

  test("gear materials never collide with a rig's own", () => {
    for (const rig of Object.values(RIGS)) for (const k of GEAR_MATERIAL_KEYS) expect(rig!.materials[k], `${rig!.id} uses ${k}`).toBeUndefined();
  });

  test("a hat replaces what the rig says it hides", () => {
    const capy = equipRig(RIGS.capybara!, { hat: "beanie" }).parts.map((p) => p.name);
    expect(capy).not.toContain("yuzu");
    expect(capy).not.toContain("leaf");
    expect(equipRig(RIGS.cactus!, { hat: "crown" }).parts.map((p) => p.name)).not.toContain("head");
    expect(RIGS.capybara!.parts.map((p) => p.name)).toContain("yuzu");
  });
});

describe("every species wears every hat", () => {
  for (const species of SPECIES) {
    test(species, () => {
      for (const hat of HAT_LIST) {
        const at = (anim: (typeof ANIMS)[number], t: number) => renderHd(species, anim, t, { gear: { hat } })!;
        // The hat shows, and the feet stay on the ground line.
        const worn = at("idle", 0.3);
        expect(groundOf(worn)).toBe(groundOf(renderHd(species, "idle", 0.3)!) + HD_HEADROOM);
        const d = diff(crop(worn), renderHd(species, "idle", 0.3)!);
        expect(d.n, `${species}/${hat}`).toBeGreaterThan(10);
        // Never clipped by the top edge, even at the top of the victory hop.
        for (const anim of ANIMS) {
          for (const t of [0, 0.2, 0.4, ANIM_INFO[anim].duration]) {
            const fb = at(anim, t);
            for (let x = 0; x < fb.width; x++) expect(fb.get(x, 0)[3], `${species}/${hat}/${anim}@${t}`).toBeLessThan(128);
          }
        }
      }
    });
  }
});

describe("weapons and trinkets", () => {
  test("a held weapon swings toward the foe on the attack", () => {
    for (const species of ["cat", "robot", "duck", "blob", "octopus"] as const) {
      const g: HdGear = { weapon: "sword" };
      const rest = diff(renderHd(species, "attack", 0, { gear: g })!, renderHd(species, "attack", 0)!);
      const hit = diff(renderHd(species, "attack", ANIM_INFO.attack.impact! + 0.02, { gear: g })!, renderHd(species, "attack", ANIM_INFO.attack.impact! + 0.02)!);
      expect(rest.n, species).toBeGreaterThan(15);
      expect(hit.cx, species).toBeGreaterThan(rest.cx + 3);
    }
  });

  test("the trinket rests on the ground behind the buddy, mirrored for foes", () => {
    const bare = renderHd("cat", "idle", 0)!;
    const d = diff(renderHd("cat", "idle", 0, { gear: { trinket: "duck" } })!, bare);
    expect(d.n).toBeGreaterThan(20);
    expect(d.cx).toBeLessThan(16);
    expect(d.cy).toBeGreaterThan(groundOf(bare) - 8);
    const flipped = diff(renderHd("cat", "idle", 0, { gear: { trinket: "duck" }, flip: true })!, renderHd("cat", "idle", 0, { flip: true })!);
    expect(flipped.cx).toBeGreaterThan(48);
  });

  test("quest blades glow in their rarity", () => {
    const a = renderHd("cat", "idle", 0, { gear: { weapon: "blade", weaponRarity: "common" } })!;
    const b = renderHd("cat", "idle", 0, { gear: { weapon: "blade", weaponRarity: "legendary" } })!;
    expect(hash(a)).not.toBe(hash(b));
  });

  test("the propeller spins", () => {
    const f = (t: number) => hash(renderHd("cat", "idle", t, { gear: { hat: "propeller" } })!);
    const frames = new Set([0, 1 / 16, 2 / 16, 3 / 16].map(f));
    expect(frames.size).toBeGreaterThan(1);
  });
});

/**
 * Golden pixel hashes. After an intentional art change, run
 *   GOLDEN=print bun test server/gfx/gear.test.ts
 * and paste the printed table here.
 */
const GOLDEN: Record<string, number> = {
  "cat/crown": 582013482,
  "dragon/wizard+blade": 2545674111,
  "blob/tophat+wand+duck": 2744432618,
  "robot/sword": 2142596673,
  "capybara/beanie": 3572952132,
};

describe("golden frames", () => {
  const cases: [string, Parameters<typeof renderHd>][] = [
    ["cat/crown", ["cat", "idle", 0.3, { seed: 9, rarity: "rare", gear: { hat: "crown" } }]],
    ["dragon/wizard+blade", ["dragon", "victory", 0.35, { seed: 9, rarity: "epic", gear: { hat: "wizard", weapon: "blade", weaponRarity: "legendary" } }]],
    ["blob/tophat+wand+duck", ["blob", "idle", 0.3, { seed: 9, gear: { hat: "tophat", weapon: "wand", trinket: "duck" } }]],
    ["robot/sword", ["robot", "attack", 0.4, { seed: 9, gear: { weapon: "sword" } }]],
    ["capybara/beanie", ["capybara", "walk", 0.2, { seed: 9, gear: { hat: "beanie" } }]],
  ];
  const actual: Record<string, number> = {};
  for (const [k, args] of cases) actual[k] = hash(renderHd(...args)!);
  test("match the recorded hashes", () => {
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    for (const [k, v] of Object.entries(GOLDEN)) expect(actual[k], k).toBe(v);
    expect(Object.keys(GOLDEN).length).toBe(cases.length);
  });
});
