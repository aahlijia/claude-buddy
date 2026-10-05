#!/usr/bin/env bun
/**
 * Roster contact sheet for the H6 HD species (docs/game-feel/hd-overhaul/h6-roster.md).
 *
 *   bun run scripts/h6-sheet.ts [out.png] [--species a,b,c] [--scale n]
 *
 * One row per species. Columns: idle, walk, attack wind-up, attack impact,
 * hit flash, hit recoil, KO, victory hop, then a shiny legendary idle on the
 * night-meadow backdrop.
 */

import { writeFileSync } from "node:fs";
import type { Species } from "../server/engine.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { Framebuffer, hex } from "../server/gfx/framebuffer.ts";
import { drawText } from "../server/gfx/font.ts";
import { HD_H, HD_SPECIES, HD_W, renderHd, type Anim } from "../server/gfx/hd.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "docs/game-feel/hd-overhaul/h6-sheet.png";
const species = (opt("species")?.split(",") ?? HD_SPECIES) as Species[];
const scale = Number(opt("scale") ?? 2);

const COLS: { anim: Anim; t: number; label: string; legend?: boolean }[] = [
  { anim: "idle", t: 0.3, label: "IDLE" },
  { anim: "walk", t: 0.17, label: "WALK" },
  { anim: "attack", t: 0.25, label: "WIND-UP" },
  { anim: "attack", t: 0.4, label: "IMPACT" },
  { anim: "hit", t: 0.03, label: "FLASH" },
  { anim: "hit", t: 0.2, label: "RECOIL" },
  { anim: "ko", t: 1.1, label: "KO" },
  { anim: "victory", t: 0.35, label: "VICTORY" },
  { anim: "idle", t: 0.9, label: "SHINY", legend: true },
];

const LABEL = 46;
const HEAD = 9;
const sheet = new Framebuffer(LABEL + COLS.length * HD_W, HEAD + species.length * HD_H);
sheet.fill(hex("#16131f"));
COLS.forEach((c, i) => drawText(sheet, c.label, LABEL + i * HD_W + 2, 2, hex("#8a84a0")));
species.forEach((sp, row) => {
  const y = HEAD + row * HD_H;
  drawText(sheet, sp.toUpperCase(), 2, y + HD_H / 2 - 2, hex("#d8d0f0"));
  COLS.forEach((c, i) => {
    const x = LABEL + i * HD_W;
    const cell = new Framebuffer(HD_W, HD_H);
    cell.fill(hex(i % 2 ? "#1f1b2b" : "#24202f"));
    const fb = renderHd(sp, c.anim, c.t, c.legend ? { seed: 5, rarity: "legendary", shiny: true, backdrop: true } : { seed: 5, rarity: "rare" });
    if (fb) cell.draw(fb, 0, 0);
    sheet.draw(cell, x, y);
  });
});
writeFileSync(out, encodePng(sheet.upscale(scale)));
console.log(`wrote ${out} (${species.length} species)`);
