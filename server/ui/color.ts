/**
 * The buddy UI kit's color layer (H3, docs/game-feel/hd-overhaul/h3-ui-kit.md).
 *
 * The kit has two faces. Without a `Ui` (the zero-token hook, one-shot CLI
 * output, tests) every component renders exactly what the game printed
 * before H3. With a `Ui` (the full-screen play TUI and the Ink dashboard)
 * components use truecolor (or 256-color) gradients, pills and accents.
 * Pure: strings in, strings out.
 */

import type { Rarity } from "../engine";
import { to256, type ColorMode } from "../gfx/encode/halfblock.ts";

export type RGB = readonly [number, number, number];

/** The rich face's settings. Absent ⇒ the classic plain/ANSI output. */
export interface Ui {
  mode: ColorMode;
  /** Animate (slide-ins, sweeps, pulses, typewriter). */
  motion: boolean;
  /** Full-screen or banner flashes are allowed. */
  flash: boolean;
}

export const RESET = "\x1b[0m";

export function rgb(hex: string): RGB {
  const h = hex.replace(/^#/, "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

/** Scale brightness (k < 1 darkens). */
export function shade(c: RGB, k: number): RGB {
  return [Math.min(255, Math.round(c[0] * k)), Math.min(255, Math.round(c[1] * k)), Math.min(255, Math.round(c[2] * k))];
}

/** SGR parameter for a foreground / background color in the UI's mode. */
export function fg(ui: Pick<Ui, "mode">, c: RGB): string {
  return ui.mode === "256" ? `38;5;${to256(c[0], c[1], c[2])}` : `38;2;${c[0]};${c[1]};${c[2]}`;
}

export function bg(ui: Pick<Ui, "mode">, c: RGB): string {
  return ui.mode === "256" ? `48;5;${to256(c[0], c[1], c[2])}` : `48;2;${c[0]};${c[1]};${c[2]}`;
}

/** Wrap text in SGR parameters, then reset. */
export function style(text: string, ...params: string[]): string {
  const p = params.filter(Boolean);
  return p.length ? `\x1b[${p.join(";")}m${text}${RESET}` : text;
}

/** Per-character foreground gradient (skips spaces; keeps width). */
export function gradient(ui: Pick<Ui, "mode">, text: string, from: RGB, to: RGB, extra = ""): string {
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  let out = "";
  chars.forEach((ch, i) => {
    out += ch === " " ? ch : `\x1b[${extra ? `${extra};` : ""}${fg(ui, lerpRgb(from, to, i / n))}m${ch}`;
  });
  return out + RESET;
}

/** The kit palette: one place for every surface's colors. */
export const THEME = {
  text: rgb("#e8e4f4"),
  dim: rgb("#8a86a0"),
  faint: rgb("#4a4660"),
  edge: rgb("#6a6488"),
  shadow: rgb("#2e2a40"),
  track: rgb("#2a2838"),
  chip: rgb("#3a3654"),
  chipKey: rgb("#f4f0ff"),
  select: rgb("#3c3466"),
  selectHi: rgb("#6a5aa8"),
  accent: rgb("#b58cff"),
  gold: rgb("#ffd25a"),
  hpHigh: rgb("#6ee07a"),
  hpMid: rgb("#f0d050"),
  hpLow: rgb("#f05a5a"),
  ghost: rgb("#8a1c28"),
  ghostFresh: rgb("#ffffff"),
  xpFrom: rgb("#4ab8ff"),
  xpTo: rgb("#9a7aff"),
  boss: rgb("#ff5a6a"),
} as const;

export const RARITY_RGB: Record<Rarity, RGB> = {
  common: rgb("#b0b0b8"),
  uncommon: rgb("#7ee69a"),
  rare: rgb("#7aa8ff"),
  epic: rgb("#c8a0ff"),
  legendary: rgb("#ffd25a"),
};

/** Strip SGR escapes (for measuring and tests). */
export function stripSgr(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
