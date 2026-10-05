/**
 * Half-block encoder (tier T1): two vertical pixels per terminal cell via
 * `▀` with a truecolor (or 256-color) foreground + background. Works
 * anywhere truecolor does, including Claude Code's status line.
 */

import { type Framebuffer, type RGBA } from "../framebuffer.ts";

export type ColorMode = "truecolor" | "256";

export interface HalfblockOptions {
  color?: ColorMode;
  /** Pixels at or above this alpha are drawn; the rest show the terminal background. */
  alphaCutoff?: number;
  /** Composite onto this color first (makes every pixel opaque). */
  background?: RGBA;
}

/** Nearest xterm-256 index for an RGB color (6×6×6 cube or the gray ramp). */
export function to256(r: number, g: number, b: number): number {
  const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const steps = [0, 95, 135, 175, 215, 255];
  const [ri, gi, bi] = [level(r), level(g), level(b)];
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const cubeErr = (steps[ri] - r) ** 2 + (steps[gi] - g) ** 2 + (steps[bi] - b) ** 2;
  const avg = (r + g + b) / 3;
  const gi2 = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const grayErr = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  return grayErr < cubeErr ? 232 + gi2 : cube;
}

function sgr(kind: "fg" | "bg", c: RGBA, mode: ColorMode): string {
  const base = kind === "fg" ? 38 : 48;
  return mode === "256" ? `${base};5;${to256(c[0], c[1], c[2])}` : `${base};2;${c[0]};${c[1]};${c[2]}`;
}

function over(c: RGBA, bg: RGBA): RGBA {
  const a = c[3] / 255;
  return [
    Math.round(c[0] * a + bg[0] * (1 - a)),
    Math.round(c[1] * a + bg[1] * (1 - a)),
    Math.round(c[2] * a + bg[2] * (1 - a)),
    255,
  ];
}

/** Encode to one string per terminal row (ceil(height / 2) rows), each ending in a reset. */
export function encodeHalfblock(fb: Framebuffer, opts: HalfblockOptions = {}): string[] {
  const mode = opts.color ?? "truecolor";
  const cutoff = opts.alphaCutoff ?? 96;
  const px = (x: number, y: number): RGBA | null => {
    if (y >= fb.height) return opts.background ? over([0, 0, 0, 0], opts.background) : null;
    const c = fb.get(x, y);
    if (opts.background) return over(c, opts.background);
    return c[3] >= cutoff ? c : null;
  };
  // Compare in output space: two pixels that quantize to the same 256-color
  // index are one solid cell.
  const same = (a: RGBA, b: RGBA) => sgr("fg", a, mode) === sgr("fg", b, mode);

  const lines: string[] = [];
  for (let y = 0; y < fb.height; y += 2) {
    let out = "";
    let cur = ""; // current SGR state, to skip redundant escapes
    const emit = (state: string, ch: string) => {
      if (state !== cur) {
        out += `\x1b[0${state ? ";" + state : ""}m`;
        cur = state;
      }
      out += ch;
    };
    for (let x = 0; x < fb.width; x++) {
      const t = px(x, y);
      const b = px(x, y + 1);
      if (!t && !b) emit("", " ");
      else if (t && !b) emit(sgr("fg", t, mode), "▀");
      else if (!t && b) emit(sgr("fg", b, mode), "▄");
      else if (same(t!, b!)) emit(sgr("fg", t!, mode), "█");
      else emit(`${sgr("fg", t!, mode)};${sgr("bg", b!, mode)}`, "▀");
    }
    lines.push(out + "\x1b[0m");
  }
  return lines;
}
