/**
 * Cell grids: the half-block tier as a grid of terminal cells, with text
 * overlaid and only the changed cells re-sent (H4 diorama).
 *
 * The diorama repaints at up to 12 fps, but between two frames only the
 * buddy and the weather move, so the panel is kept as a grid of
 * (glyph, fg, bg) cells and each frame emits just the cells that differ
 * from the last one — cursor jumps and color changes included.
 */

import { mix, type Framebuffer, type RGBA } from "../framebuffer.ts";
import { to256, type ColorMode } from "./halfblock.ts";

export interface Cell {
  ch: string;
  /** SGR parameters (without ESC[ and m), "" for the default. */
  sgr: string;
}

export class CellGrid {
  readonly cells: Cell[];
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: cols * rows }, () => ({ ch: " ", sgr: "" }));
  }
  at(col: number, row: number): Cell {
    return this.cells[row * this.cols + col];
  }
  set(col: number, row: number, c: Cell): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    this.cells[row * this.cols + col] = c;
  }
}

function color(kind: 38 | 48, c: RGBA, mode: ColorMode): string {
  return mode === "256" ? `${kind};5;${to256(c[0], c[1], c[2])}` : `${kind};2;${c[0]};${c[1]};${c[2]}`;
}

/**
 * An opaque framebuffer (height = 2 × rows) as half-block cells. Also returns
 * each cell's mean color, the background text drawn over it should use.
 */
export function halfblockCells(fb: Framebuffer, mode: ColorMode = "truecolor"): { grid: CellGrid; under: RGBA[] } {
  const rows = Math.ceil(fb.height / 2);
  const grid = new CellGrid(fb.width, rows);
  const under: RGBA[] = new Array(fb.width * rows);
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < fb.width; x++) {
      const t = fb.get(x, r * 2);
      const b = r * 2 + 1 < fb.height ? fb.get(x, r * 2 + 1) : t;
      const ft = color(38, t, mode);
      const bb = color(48, b, mode);
      // A solid cell is a space on a background: shorter, and it diffs cleanly.
      grid.set(x, r, ft.slice(3) === bb.slice(3) ? { ch: " ", sgr: bb } : { ch: "▀", sgr: `${ft};${bb}` });
      under[r * fb.width + x] = mix(t, b, 0.5);
    }
  }
  return { grid, under };
}

/** Terminal-narrow version of a string: wide glyphs (emoji, CJK) become `*`. */
export function narrow(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "✨") out += "✦";
    else if (cp < 0x20 || cp === 0x7f) out += " ";
    else if (cp > 0xffff || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) out += "*";
    else if (cp >= 0x300 && cp <= 0x36f) continue; // combining marks
    else out += ch;
  }
  return out;
}

export interface TextRun {
  row: number;
  col: number;
  text: string;
  fg: RGBA;
  bold?: boolean;
}

/** Write text into the grid, each glyph on the color already under it. */
export function overlayText(grid: CellGrid, under: readonly RGBA[], run: TextRun, mode: ColorMode = "truecolor"): void {
  let col = run.col;
  for (const ch of narrow(run.text)) {
    if (col >= grid.cols) break;
    if (col >= 0 && run.row >= 0 && run.row < grid.rows) {
      const bg = under[run.row * grid.cols + col];
      grid.set(col, run.row, { ch, sgr: `${run.bold ? "1;" : ""}${color(38, run.fg, mode)};${color(48, bg, mode)}` });
    }
    col++;
  }
}

/**
 * The bytes that turn `prev` into `next` on screen, with the grid's top-left
 * at 1-based (`row0`, `col0`). `prev` null repaints everything. Writes only
 * inside the grid's rectangle, and never past its last column (so the
 * cursor never wraps or scrolls).
 */
export function diffCells(prev: CellGrid | null, next: CellGrid, row0: number, col0: number): string {
  const same = prev && prev.cols === next.cols && prev.rows === next.rows ? prev : null;
  let out = "";
  let cur = "\u0000"; // SGR state on the wire (unknown at start)
  for (let r = 0; r < next.rows; r++) {
    let at = -1; // column the cursor sits at, -1 = unknown
    for (let c = 0; c < next.cols; c++) {
      const n = next.at(c, r);
      if (same) {
        const p = same.at(c, r);
        if (p.ch === n.ch && p.sgr === n.sgr) continue;
      }
      if (at !== c) out += `\x1b[${row0 + r};${col0 + c}H`;
      if (n.sgr !== cur) {
        out += `\x1b[0${n.sgr ? ";" + n.sgr : ""}m`;
        cur = n.sgr;
      }
      out += n.ch;
      at = c + 1;
    }
  }
  if (out) out += "\x1b[0m";
  return out;
}
