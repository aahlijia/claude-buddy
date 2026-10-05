import { describe, expect, test } from "bun:test";

import { crc32 } from "./encode/png.ts";
import type { Framebuffer } from "./framebuffer.ts";
import { ANIMS, ANIM_INFO, HD_SPECIES, animDone, hasHd, renderHd, type Anim } from "./hd.ts";
import { poseRig } from "./motion.ts";
import { place, renderRig, shapeMask, type RigDef } from "./rig.ts";
import { CAT } from "./species/cat.ts";
import { DRAGON } from "./species/dragon.ts";

const RIGS: RigDef[] = [CAT, DRAGON];

/** Every variant name the motion library asks a rig for. */
const EYE_VARIANTS = ["half", "closed", "happy", "x", "angry"];
const MOUTH_VARIANTS = ["smile", "open", "frown"];

function solid(fb: Framebuffer): { n: number; cx: number; luma: number; sat: number } {
  let n = 0;
  let sx = 0;
  let luma = 0;
  let sat = 0;
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const [r, g, b, a] = fb.get(x, y);
      if (a < 200) continue;
      n++;
      sx += x;
      luma += 0.3 * r + 0.55 * g + 0.15 * b;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  return { n, cx: sx / Math.max(1, n), luma: luma / Math.max(1, n), sat: sat / Math.max(1, n) };
}

describe("rig definitions (the asset validator)", () => {
  for (const rig of RIGS) {
    describe(rig.id, () => {
      test("exactly one root and every parent exists", () => {
        const names = new Set(rig.parts.map((p) => p.name));
        expect(rig.parts.filter((p) => !p.parent)).toHaveLength(1);
        for (const p of rig.parts) if (p.parent) expect(names.has(p.parent)).toBe(true);
        expect(names.size).toBe(rig.parts.length);
      });

      test("every material key used by a shape is defined", () => {
        for (const p of rig.parts) {
          for (const shape of [p.shape, ...Object.values(p.variants ?? {})]) {
            const keys = shape.kind === "grid" ? [...shape.rows.join("")].filter((c) => c !== "." && c !== " ") : [shape.mat];
            for (const k of keys) expect(rig.materials[k], `${p.name} uses "${k}"`).toBeDefined();
          }
        }
      });

      test("has every expression the motion library uses", () => {
        const eyes = rig.parts.filter((p) => p.role === "eye");
        const mouths = rig.parts.filter((p) => p.role === "mouth");
        expect(eyes.length).toBeGreaterThan(0);
        expect(mouths.length).toBeGreaterThan(0);
        for (const e of eyes) for (const v of EYE_VARIANTS) expect(e.variants?.[v], `${e.name}.${v}`).toBeDefined();
        for (const m of mouths) for (const v of MOUTH_VARIANTS) expect(m.variants?.[v], `${m.name}.${v}`).toBeDefined();
      });

      test("the rest pose stands on the ground and fits the canvas", () => {
        const fb = renderRig(rig, { parts: {} }, { noShadow: true });
        let bottom = 0;
        for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) if (fb.get(x, y)[3]) bottom = Math.max(bottom, y);
        expect(Math.abs(bottom - rig.ground)).toBeLessThanOrEqual(2);
        for (let y = 0; y < fb.height; y++) {
          expect(fb.get(0, y)[3]).toBe(0);
          expect(fb.get(fb.width - 1, y)[3]).toBe(0);
        }
      });
    });
  }
});

describe("rig engine", () => {
  test("shape masks: ellipse, poly and grid", () => {
    expect(shapeMask({ kind: "ellipse", rx: 3, ry: 2, mat: "a" }).w).toBe(6);
    const g = shapeMask({ kind: "grid", rows: ["ab", ".a"] });
    expect(g.key).toEqual(["a", "b", "", "a"]);
    const tri = shapeMask({ kind: "poly", pts: [[0, 4], [2, 0], [4, 4]], mat: "x" });
    expect(tri.key.filter(Boolean).length).toBeGreaterThan(4);
  });

  test("children inherit their parent's transform", () => {
    const base = place(CAT, { parts: {} }).find((p) => p.part.name === "eyeN")!;
    const moved = place(CAT, { parts: { head: { dx: 3 } } }).find((p) => p.part.name === "eyeN")!;
    expect(moved.world[4] - base.world[4]).toBeCloseTo(3, 5);
  });

  test("z order puts the near legs in front of the body and the far ones behind", () => {
    const order = place(CAT, { parts: {} }).map((p) => p.part.name);
    expect(order.indexOf("legFF")).toBeLessThan(order.indexOf("body"));
    expect(order.indexOf("legFN")).toBeGreaterThan(order.indexOf("body"));
  });

  test("flip mirrors the frame", () => {
    const a = renderRig(CAT, { parts: {} }, { noShadow: true });
    const b = renderRig(CAT, { parts: {} }, { noShadow: true, flip: true });
    expect(b.get(a.width - 1 - 30, 40)).toEqual(a.get(30, 40));
  });

  test("shiny swaps ramps; rarity adds rim light", () => {
    const base = renderRig(CAT, { parts: {} });
    expect(crc32(new Uint8Array(renderRig(CAT, { parts: {} }, { shiny: true }).data))).not.toBe(crc32(new Uint8Array(base.data)));
    expect(crc32(new Uint8Array(renderRig(CAT, { parts: {} }, { rarity: "legendary" }).data))).not.toBe(crc32(new Uint8Array(base.data)));
  });
});

describe("motion library", () => {
  test("tail segments lag each other (follow-through)", () => {
    const pose = poseRig(CAT, "idle", 0.4);
    const r = (n: string) => pose.parts[n]?.rot ?? 0;
    expect(r("tail0")).not.toBeCloseTo(r("tail3"), 3);
  });

  test("walk swings near and far legs in opposition", () => {
    const pose = poseRig(DRAGON, "walk", 0.17);
    expect(Math.sign(pose.parts.legFN!.rot!)).toBe(-Math.sign(pose.parts.legFF!.rot!));
  });

  test("one-shot animations hold their final pose", () => {
    expect(poseRig(CAT, "ko", 5)).toEqual(poseRig(CAT, "ko", ANIM_INFO.ko.duration));
    expect(animDone("hit", 1)).toBe(true);
    expect(animDone("idle", 99)).toBe(false);
  });
});

describe("HD species", () => {
  test("registry", () => {
    expect([...HD_SPECIES].sort()).toEqual(["blob", "cat", "dragon"]);
    expect(hasHd("cat")).toBe(true);
    expect(hasHd("sparkit")).toBe(false);
    expect(renderHd("sparkit", "idle", 0)).toBeNull();
  });

  for (const species of HD_SPECIES) {
    describe(species, () => {
      test("every animation renders a substantial, deterministic sprite", () => {
        for (const anim of ANIMS) {
          for (const t of [0, 0.2, 0.4, 0.8]) {
            const a = renderHd(species, anim, t, { seed: 3 })!;
            const b = renderHd(species, anim, t, { seed: 3 })!;
            expect(solid(a).n, `${anim}@${t}`).toBeGreaterThan(300);
            expect(a.data).toEqual(b.data);
          }
        }
      });

      test("attack lunges toward the foe at impact", () => {
        const rest = solid(renderHd(species, "attack", 0)!);
        const impact = solid(renderHd(species, "attack", ANIM_INFO.attack.impact! + 0.02)!);
        expect(impact.cx).toBeGreaterThan(rest.cx + 3);
      });

      test("hit flashes white; KO drains the color", () => {
        const idle = solid(renderHd(species, "idle", 0)!);
        expect(solid(renderHd(species, "hit", 0.01)!).luma).toBeGreaterThan(idle.luma + 40);
        expect(solid(renderHd(species, "ko", 1.1)!).sat).toBeLessThan(idle.sat * 0.8);
      });
    });
  }
});

/**
 * Golden pixel hashes: any change to the art or the renderer shows up here.
 * After an intentional art change, run
 *   GOLDEN=print bun test server/gfx/hd.test.ts
 * and paste the printed table here.
 */
const GOLDEN: Record<string, number> = {
  "blob/idle": 602082898,
  "blob/walk": 674600959,
  "blob/attack": 2618997190,
  "blob/hit": 2643736794,
  "blob/ko": 2922165251,
  "blob/victory": 2525467405,
  "cat/idle": 346578338,
  "cat/walk": 4174336459,
  "cat/attack": 458999107,
  "cat/hit": 1953428639,
  "cat/ko": 1184229755,
  "cat/victory": 3635079475,
  "dragon/idle": 1801961588,
  "dragon/walk": 497064473,
  "dragon/attack": 3686575692,
  "dragon/hit": 2687937462,
  "dragon/ko": 1300912158,
  "dragon/victory": 2432267434,
};

describe("golden frames", () => {
  const frames: [string, Anim, number][] = [];
  for (const species of HD_SPECIES) for (const anim of ANIMS) frames.push([species, anim, 0.3]);
  const actual: Record<string, number> = {};
  for (const [species, anim, t] of frames) {
    actual[`${species}/${anim}`] = crc32(new Uint8Array(renderHd(species as never, anim, t, { seed: 9, rarity: "rare" })!.data));
  }
  test("match the recorded hashes", () => {
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    for (const [k, v] of Object.entries(GOLDEN)) expect(actual[k], k).toBe(v);
    expect(Object.keys(GOLDEN).length).toBe(frames.length);
  });
});
