#!/usr/bin/env bun
/**
 * Contact sheet for HD gear (docs/game-feel/hd-overhaul/hd-gear.md).
 *
 *   bun run scripts/gear-sheet.ts [out.png] [--species a,b] [--scale n]
 *
 * One row per species. Columns: the seven hats at idle, then the Debug Wand
 * and the Rubber Duck at idle, the Foam Sword at attack impact, and a
 * legendary quest blade with a crown on the victory hop.
 */

import { writeFileSync } from "node:fs";
import type { Species } from "../server/engine.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { drawText } from "../server/gfx/font.ts";
import { Framebuffer, hex } from "../server/gfx/framebuffer.ts";
import type { HdGear } from "../server/gfx/gear.ts";
import { HD_H, HD_HEADROOM, HD_SPECIES, HD_W, renderHd, type Anim } from "../server/gfx/hd.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "docs/game-feel/hd-overhaul/hd-gear-sheet.png";
const species = (opt("species")?.split(",") ?? HD_SPECIES) as Species[];
const scale = Number(opt("scale") ?? 2);

const COLS: { gear: HdGear; anim: Anim; t: number; label: string }[] = [
  ...(["crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"] as const).map((hat) => ({ gear: { hat }, anim: "idle" as Anim, t: 0.3, label: hat.toUpperCase() })),
  { gear: { weapon: "wand", trinket: "duck" }, anim: "idle", t: 0.3, label: "WAND+DUCK" },
  { gear: { weapon: "sword", hat: "beanie" }, anim: "attack", t: 0.4, label: "SWORD HIT" },
  { gear: { weapon: "blade", weaponRarity: "legendary", hat: "crown" }, anim: "victory", t: 0.35, label: "BLADE WIN" },
];

const LABEL = 46;
const HEAD = 9;
const CELL_H = HD_H + HD_HEADROOM;
const sheet = new Framebuffer(LABEL + COLS.length * HD_W, HEAD + species.length * CELL_H);
sheet.fill(hex("#16131f"));
COLS.forEach((c, i) => drawText(sheet, c.label, LABEL + i * HD_W + 2, 2, hex("#8a84a0")));
species.forEach((sp, row) => {
  const y = HEAD + row * CELL_H;
  drawText(sheet, sp.toUpperCase(), 2, y + CELL_H / 2 - 2, hex("#d8d0f0"));
  COLS.forEach((c, i) => {
    const cell = new Framebuffer(HD_W, CELL_H);
    cell.fill(hex(i % 2 ? "#1f1b2b" : "#24202f"));
    const fb = renderHd(sp, c.anim, c.t, { seed: 5, rarity: "rare", gear: c.gear });
    // Bottom-align: hatted frames are taller.
    if (fb) cell.draw(fb, 0, CELL_H - fb.height);
    sheet.draw(cell, LABEL + i * HD_W, y);
  });
});
writeFileSync(out, encodePng(sheet.upscale(scale)));
console.log(`wrote ${out} (${species.length} species)`);
