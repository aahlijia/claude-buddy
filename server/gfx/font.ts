/**
 * A 3×5 pixel font for in-scene text: damage numbers, CRIT, MISS, status
 * labels and banners drawn straight into a framebuffer, so they ride the
 * camera and survive every render tier. Lowercase maps to uppercase;
 * characters without a glyph are skipped (their space is kept).
 */

import type { Framebuffer, RGBA } from "./framebuffer.ts";

const G: Record<string, string> = {
  A: ".#.|#.#|###|#.#|#.#",
  B: "##.|#.#|##.|#.#|##.",
  C: ".##|#..|#..|#..|.##",
  D: "##.|#.#|#.#|#.#|##.",
  E: "###|#..|##.|#..|###",
  F: "###|#..|##.|#..|#..",
  G: ".##|#..|#.#|#.#|.##",
  H: "#.#|#.#|###|#.#|#.#",
  I: "###|.#.|.#.|.#.|###",
  J: "..#|..#|..#|#.#|.#.",
  K: "#.#|#.#|##.|#.#|#.#",
  L: "#..|#..|#..|#..|###",
  M: "#.#|###|###|#.#|#.#",
  N: "##.|#.#|#.#|#.#|#.#",
  O: ".#.|#.#|#.#|#.#|.#.",
  P: "##.|#.#|##.|#..|#..",
  Q: ".#.|#.#|#.#|##.|.##",
  R: "##.|#.#|##.|#.#|#.#",
  S: ".##|#..|.#.|..#|##.",
  T: "###|.#.|.#.|.#.|.#.",
  U: "#.#|#.#|#.#|#.#|###",
  V: "#.#|#.#|#.#|#.#|.#.",
  W: "#.#|#.#|###|###|#.#",
  X: "#.#|#.#|.#.|#.#|#.#",
  Y: "#.#|#.#|.#.|.#.|.#.",
  Z: "###|..#|.#.|#..|###",
  "0": "###|#.#|#.#|#.#|###",
  "1": ".#.|##.|.#.|.#.|###",
  "2": "##.|..#|.#.|#..|###",
  "3": "##.|..#|.#.|..#|##.",
  "4": "#.#|#.#|###|..#|..#",
  "5": "###|#..|##.|..#|##.",
  "6": ".##|#..|###|#.#|###",
  "7": "###|..#|.#.|.#.|.#.",
  "8": "###|#.#|###|#.#|###",
  "9": "###|#.#|###|..#|##.",
  "+": "...|.#.|###|.#.|...",
  "-": "...|...|###|...|...",
  "!": ".#.|.#.|.#.|...|.#.",
  "?": "##.|..#|.#.|...|.#.",
  ".": "...|...|...|...|.#.",
  ",": "...|...|...|.#.|#..",
  ":": "...|.#.|...|.#.|...",
  "'": ".#.|.#.|...|...|...",
  "/": "..#|..#|.#.|#..|#..",
  "%": "#.#|..#|.#.|#..|#.#",
  "↑": ".#.|###|.#.|.#.|.#.",
  "✦": ".#.|###|.#.|...|...",
  "♛": "#.#|###|###|...|...",
  "×": "...|#.#|.#.|#.#|...",
};

/** Glyphs are authored as five `|`-separated rows of three pixels. */
const GLYPHS: Record<string, boolean[]> = Object.fromEntries(
  Object.entries(G).map(([k, v]) => [k, [...v.replaceAll("|", "")].map((c) => c === "#")]),
);

export const FONT_W = 3;
export const FONT_H = 5;

/** Whether a character has a glyph. */
export function hasGlyph(ch: string): boolean {
  return ch === " " || ch.toUpperCase() in GLYPHS;
}

/** Text width in pixels at `scale` (1px tracking between glyphs). */
export function textWidth(text: string, scale = 1): number {
  const n = [...text].length;
  return n ? (n * (FONT_W + 1) - 1) * scale : 0;
}

export interface TextOptions {
  scale?: number;
  opacity?: number;
  /** Dark 1px outline so text reads on any background. */
  outline?: RGBA;
}

/** Draw `text` with its top-left at (x, y). */
export function drawText(fb: Framebuffer, text: string, x: number, y: number, color: RGBA, opts: TextOptions = {}): void {
  const s = Math.max(1, Math.floor(opts.scale ?? 1));
  const op = opts.opacity ?? 1;
  const chars = [...text].map((c) => GLYPHS[c.toUpperCase()]);
  const ox = Math.round(x);
  const oy = Math.round(y);
  const plot = (gx: number, gy: number, c: RGBA, o: number) => {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) fb.blend(ox + gx * s + i, oy + gy * s + j, c, o);
  };
  const on = (ci: number, px: number, py: number) => {
    const g = chars[ci];
    return !!g && px >= 0 && px < FONT_W && py >= 0 && py < FONT_H && g[py * FONT_W + px];
  };
  if (opts.outline) {
    chars.forEach((g, ci) => {
      if (!g) return;
      const bx = ci * (FONT_W + 1);
      for (let py = -1; py <= FONT_H; py++) {
        for (let px = -1; px <= FONT_W; px++) {
          if (on(ci, px, py)) continue;
          const near = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => on(ci, px + dx, py + dy)));
          if (near) plot(bx + px, py, opts.outline!, op * 0.85);
        }
      }
    });
  }
  chars.forEach((g, ci) => {
    if (!g) return;
    const bx = ci * (FONT_W + 1);
    for (let py = 0; py < FONT_H; py++) for (let px = 0; px < FONT_W; px++) if (g[py * FONT_W + px]) plot(bx + px, py, color, op);
  });
}
