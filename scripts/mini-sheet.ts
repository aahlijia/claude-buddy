#!/usr/bin/env bun
/**
 * Contact sheet of the baked status-line sprites, decoded back from the
 * half-block strings the status line prints (docs/game-feel/hd-overhaul/mini-sprite.md).
 *
 *   bun run scripts/mini-sheet.ts [out.png] [--size mini|full] [--species a,b] [--scale n] [--light]
 *
 * One row per species: every idle/mood frame, then the celebration poses.
 * `--light` draws on a light terminal background.
 */

import { writeFileSync } from "node:fs";
import type { Species } from "../server/engine.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { drawText } from "../server/gfx/font.ts";
import { Framebuffer, hex, type RGBA } from "../server/gfx/framebuffer.ts";
import { HD_SPECIES } from "../server/gfx/hd.ts";
import { bakeStatusSprite, type SpriteMood, type StatusSprite } from "../server/gfx/statussprite.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "docs/game-feel/hd-overhaul/mini-sheet.png";
const size = (opt("size") ?? "mini") as StatusSprite;
const species = (opt("species")?.split(",") ?? HD_SPECIES) as Species[];
const scale = Number(opt("scale") ?? 4);
const mood = (opt("mood") ?? "neutral") as SpriteMood;
const light = args.includes("--light");

/** Paint one baked frame (half-block rows) at (x0, y0); returns its pixel width. */
export function paintFrame(fb: Framebuffer, frame: string, x0: number, y0: number): void {
  frame.split("\n").forEach((line, row) => {
    let fg: RGBA | null = null;
    let bg: RGBA | null = null;
    let col = 0;
    const re = /\x1b\[([0-9;]*)m|([^\x1b])/g;
    for (let m; (m = re.exec(line)); ) {
      if (m[1] !== undefined) {
        const c = m[1].split(";").map(Number);
        for (let k = 0; k < c.length; k++) {
          if (c[k] === 0) fg = bg = null;
          else if (c[k] === 38 && c[k + 1] === 2) (fg = [c[k + 2], c[k + 3], c[k + 4], 255]), (k += 4);
          else if (c[k] === 48 && c[k + 1] === 2) (bg = [c[k + 2], c[k + 3], c[k + 4], 255]), (k += 4);
        }
        continue;
      }
      const x = x0 + col++;
      const y = y0 + row * 2;
      if (m[2] === "▀") {
        if (fg) fb.set(x, y, fg);
        if (bg) fb.set(x, y + 1, bg);
      } else if (m[2] === "▄") {
        if (fg) fb.set(x, y + 1, fg);
      } else if (m[2] === "█" && fg) {
        fb.set(x, y, fg);
        fb.set(x, y + 1, fg);
      }
    }
  });
}

if (import.meta.main) {
  const baked = species.map((sp) => bakeStatusSprite({ species: sp, rarity: "rare", shiny: false, seed: 5 }, size, mood)!);
  const cellW = Math.max(...baked.map((b) => b.width)) + 3;
  const cellH = Math.max(...baked.map((b) => b.rows)) * 2 + 3;
  const cols = Math.max(...baked.map((b) => b.frames.length + b.celebFrames.length));
  const LABEL = 46;
  const sheet = new Framebuffer(LABEL + cols * cellW, species.length * cellH);
  sheet.fill(hex(light ? "#f4f1ea" : "#16131f"));
  baked.forEach((b, row) => {
    const y = row * cellH + 2;
    drawText(sheet, species[row].toUpperCase(), 2, y + cellH / 2 - 4, hex(light ? "#4a4458" : "#d8d0f0"));
    [...b.frames, ...b.celebFrames].forEach((f, i) => paintFrame(sheet, f, LABEL + i * cellW + 1, y));
  });
  writeFileSync(out, encodePng(sheet.upscale(scale)));
  console.log(`wrote ${out} (${species.length} species, ${size})`);
}
