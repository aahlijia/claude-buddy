/**
 * Plays an H6 cinematic (server/gfx/cinema.ts: the hatch, the loot reveal)
 * in the terminal: picks the render tier, reserves a box, paints frames in
 * place at ~30 fps and lets any key skip to the end.
 *
 * Gated like the HD stage: nothing plays at gameFeel off, on the ASCII
 * tier, without a TTY, or in a terminal too small for the box.
 */

import { CINE_H, CINE_W, cineFeel, type CineFeel } from "../server/gfx/cinema.ts";
import { detectTier, tmuxWrap, type Detected } from "../server/gfx/detect.ts";
import { encodeHalfblock } from "../server/gfx/encode/halfblock.ts";
import { encodeIterm } from "../server/gfx/encode/iterm.ts";
import { encodeKitty, kittyDelete } from "../server/gfx/encode/kitty.ts";
import type { Framebuffer } from "../server/gfx/framebuffer.ts";

/** Box in terminal cells (half-block: one pixel per column, two per row). */
export const CINE_COLS = CINE_W;
export const CINE_ROWS = CINE_H / 2;
const KITTY_CINE_ID = 4343;
const FRAME_MS = 33;
const ESC = "\x1b[";

export interface CineSetup {
  gfx: Detected;
  feel: CineFeel;
}

/** Whether (and how) a cinematic may play here, or null for the ASCII path. */
export function cineSetup(env: NodeJS.ProcessEnv = process.env): CineSetup | null {
  if (!process.stdout.isTTY) return null;
  const gfx = detectTier(env);
  if (gfx.tier === "ascii") return null;
  if ((process.stdout.columns ?? 0) < CINE_COLS + 2 || (process.stdout.rows ?? 0) < CINE_ROWS + 2) return null;
  let gameFeel: string | undefined;
  let reduce = !!env.BUDDY_REDUCED_MOTION && env.BUDDY_REDUCED_MOTION !== "0";
  try {
    const { loadConfig } = require("../server/state.ts") as typeof import("../server/state.ts");
    const c = loadConfig();
    gameFeel = c.gameFeel;
    reduce ||= !!c.reduceMotion;
  } catch {
    /* defaults */
  }
  const feel = cineFeel(gameFeel, reduce);
  return feel ? { gfx, feel } : null;
}

/** One frame as text: half-block lines, or a pixel image placed at the cursor. */
function encode(fb: Framebuffer, gfx: Detected): string {
  if (gfx.tier === "halfblock") return encodeHalfblock(fb, { color: gfx.color }).join(`${ESC}${CINE_COLS}D${ESC}1B`);
  const big = fb.upscale(4);
  let img = gfx.tier === "kitty" ? encodeKitty(big, { id: KITTY_CINE_ID, placement: 1, cols: CINE_COLS, rows: CINE_ROWS }) : encodeIterm(big, { cols: CINE_COLS, rows: CINE_ROWS });
  if (gfx.tmux) img = tmuxWrap(img);
  return img;
}

export interface CinePlayback {
  /** Resolves when the cinematic ends (or is skipped). */
  done: Promise<void>;
  /** Jump to the final frame and finish. */
  skip(): void;
}

/**
 * Play `render(ms)` for `totalMs` in a box whose top-left is at
 * (`row`, `col`) (1-based), or inline at the cursor when omitted (the box
 * is reserved by printing blank lines; the cursor ends below it).
 */
export function playCinematic(
  setup: CineSetup,
  render: (ms: number) => Framebuffer,
  totalMs: number,
  at?: { row: number; col: number },
): CinePlayback {
  const out = (s: string) => process.stdout.write(s);
  if (!at) out("\n".repeat(CINE_ROWS) + `${ESC}${CINE_ROWS}A`);
  out(`${ESC}?25l`);
  const home = at ? `${ESC}${at.row};${at.col}H` : "\x1b8";
  if (!at) out("\x1b7");
  let skipped = false;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const start = Date.now();
  const paint = (ms: number) => out(home + encode(render(ms), setup.gfx));
  const finish = () => {
    paint(totalMs);
    if (!at) out(`\x1b8${ESC}${CINE_ROWS}B\r`);
    out(`${ESC}?25h`);
    resolve();
  };
  const tick = () => {
    if (skipped) return;
    const ms = Date.now() - start;
    if (ms >= totalMs) return finish();
    paint(ms);
    setTimeout(tick, FRAME_MS);
  };
  tick();
  return {
    done,
    skip() {
      if (skipped) return;
      skipped = true;
      finish();
    },
  };
}

/** Remove a pixel-tier cinematic image (half-blocks are just text). */
export function clearCinematic(setup: CineSetup): void {
  if (setup.gfx.tier !== "kitty") return;
  const del = kittyDelete(KITTY_CINE_ID);
  process.stdout.write(setup.gfx.tmux ? tmuxWrap(del) : del);
}
