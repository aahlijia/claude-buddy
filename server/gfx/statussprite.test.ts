import { describe, expect, test } from "bun:test";

import { crc32 } from "./encode/png.ts";
import { HD_SPECIES, rasterHd } from "./hd.ts";
import { shrinkRig } from "./rig.ts";
import { STATUS_SPRITES, bakeStatusSprite, keyPoses, type SpriteLook } from "./statussprite.ts";

const LOOK: SpriteLook = { species: "cat", rarity: "rare", shiny: false, seed: 7 };
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
type RGB = [number, number, number];
const luma = (c: RGB) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;

/** Half-block frame → pixel rows (null = transparent). */
function decode(frame: string): (RGB | null)[][] {
  const out: (RGB | null)[][] = [];
  for (const line of frame.split("\n")) {
    const top: (RGB | null)[] = [];
    const bot: (RGB | null)[] = [];
    let fg: RGB | null = null;
    let bg: RGB | null = null;
    for (const m of line.matchAll(/\x1b\[([0-9;]*)m|([^\x1b])/g)) {
      if (m[1] !== undefined) {
        const c = m[1].split(";").map(Number);
        fg = bg = null;
        for (let k = 0; k < c.length; k++) {
          if (c[k] === 38) (fg = [c[k + 2], c[k + 3], c[k + 4]]), (k += 4);
          else if (c[k] === 48) (bg = [c[k + 2], c[k + 3], c[k + 4]]), (k += 4);
        }
        continue;
      }
      top.push(m[2] === "▀" || m[2] === "█" ? fg : null);
      bot.push(m[2] === "▄" || m[2] === "█" ? fg : m[2] === "▀" ? bg : null);
    }
    out.push(top, bot);
  }
  return out;
}

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

  test("a hat sits on top at the same scale (rows are added, never the buddy shrunk)", () => {
    const bare = bakeStatusSprite(LOOK, "mini")!;
    for (const hat of ["tophat", "wizard", "crown"] as const) {
      const worn = bakeStatusSprite({ ...LOOK, gear: { hat } }, "mini")!;
      expect(worn.frames[0]).not.toBe(bare.frames[0]);
      expect(worn.rows).toBeGreaterThanOrEqual(bare.rows);
      expect(worn.rows).toBeLessThanOrEqual(bare.rows + 2);
      expect(worn.width).toBe(bare.width);
      // The feet are the bare buddy's.
      expect(plain(worn.frames[0]).split("\n").at(-1)).toBe(plain(bare.frames[0]).split("\n").at(-1));
    }
  });

  test("mini fits ~6 rows, full ~12; every frame is the same box", () => {
    for (const species of ["blob", "cat", "dragon"] as const) {
      for (const [size, maxRows, maxW] of [["mini", 6, 16], ["full", 12, 28]] as const) {
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

  test("mini: every species fills the 6-row budget, within 16 cells, feet on the bottom row", () => {
    for (const species of HD_SPECIES) {
      const s = bakeStatusSprite({ ...LOOK, species }, "mini")!;
      expect(s.rows).toBe(6);
      expect(s.width).toBeLessThanOrEqual(16);
      // The bottom row carries the feet in every idle frame.
      for (const f of s.frames) expect(plain(f).split("\n").at(-1)!.trim().length).toBeGreaterThan(0);
    }
  });

  test("mini: drawn at its own size, with a crisp outline and real eyes", () => {
    // The sel-out outline: each row's leftmost pixel is darker than the one
    // inside it (a box-filtered thumbnail has no such edge).
    for (const species of ["cat", "duck", "blob", "capybara"] as const) {
      const px = decode(bakeStatusSprite({ ...LOOK, species }, "mini")!.frames[0]);
      let rows = 0;
      let edged = 0;
      for (const row of px) {
        const x = row.findIndex(Boolean);
        if (x < 0 || !row[x + 1]) continue;
        rows++;
        if (luma(row[x]!) < luma(row[x + 1]!)) edged++;
      }
      expect(edged / rows).toBeGreaterThanOrEqual(0.75);
    }
    // The eyes are ink dots: the cat's eye ink is in the open pose.
    expect(bakeStatusSprite(LOOK, "mini")!.frames[0]).toContain("30;24;48"); // #1e1830
  });

  test("shrinkRig: eyes become 1×2 dots, one pixel when closed, never touching", () => {
    const dots = (t: number) => {
      const r = rasterHd("cat", "idle", t, { seed: 7 })!;
      const m = shrinkRig(r.rig, r.raster, r.pose, 4, 0, 0, 16, 14);
      const px: [number, number][] = [];
      for (let o = 0; o < m.width * m.height; o++) if (m.owner[o] >= 0 && m.placed[m.owner[o]].part.role === "eye") px.push([o % m.width, Math.floor(o / m.width)]);
      return px;
    };
    const open = dots(0);
    expect(open.length).toBe(4);
    const xs = [...new Set(open.map((p) => p[0]))].sort((a, b) => a - b);
    expect(xs.length).toBe(2);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(2);
    const shut = keyPoses("neutral", 7).poses.at(-1)!.t;
    expect(dots(shut).length).toBe(2);
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
  "blob/mini": 1721162281,
  "blob/full": 1925503854,
  "cat/mini": 3504845216,
  "cat/full": 3212951862,
  "dragon/mini": 893375421,
  "dragon/full": 138707025,
};
