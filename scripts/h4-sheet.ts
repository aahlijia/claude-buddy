#!/usr/bin/env bun
/**
 * Contact sheet for the H4 buddy-shell diorama (docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 *   bun run scripts/h4-sheet.ts [out.png] [--scale 2] [--rows 0-4]
 *
 * One row per biome at noon, dusk and midnight (kitty resolution, 4×8 px per
 * cell), then the weather kinds, the buddy's reactions, and the half-block
 * tier of the same panel.
 */

import { writeFileSync } from "node:fs";
import type { Rarity, Species } from "../server/engine.ts";
import { BIOME_NAMES } from "../server/gfx/biomes.ts";
import { NO_ACTIVITY, beatAt, composeDiorama, dioramaSpec, wanderZone, type Activity, type SceneWeather } from "../server/gfx/diorama.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { Framebuffer, hex } from "../server/gfx/framebuffer.ts";
import { drawText } from "../server/gfx/font.ts";

const COLS = 72;
const ROWS = 8;
const W = COLS * 4;
const H = ROWS * 8;
const GAP = 4;
const LABEL = 9;

type Cell = { fb: Framebuffer; label: string };

function shot(o: { biome: string; hour: number; species?: Species; rarity?: Rarity; weather?: SceneWeather | null; t?: number; act?: Activity; w?: number; h?: number; flash?: boolean }): Framebuffer {
  const w = o.w ?? W;
  const h = o.h ?? H;
  const spec = dioramaSpec({ biome: o.biome, rarity: o.rarity ?? "rare", species: o.species ?? "cat", w, h, hour: o.hour, weather: o.weather, seed: 7, flash: o.flash ?? true });
  const t = o.t ?? 3.2;
  const beat = beatAt(spec, t, wanderZone(w, w * 0.22), o.act ?? NO_ACTIVITY);
  return composeDiorama(spec, { t, beat });
}

const rows: Cell[][] = [];
const species: Species[] = ["cat", "dragon", "blob"];
BIOME_NAMES.forEach((biome, i) => {
  const sp = species[i % 3];
  rows.push([12.5, 18.4, 23.5].map((hour) => ({ fb: shot({ biome, hour, species: sp, t: 2 + i * 1.7 }), label: `${biome} ${hour}h` })));
});
const weathers: SceneWeather[] = ["rain", "storm", "snow", "drizzle", "sparkle"];
rows.push(weathers.slice(0, 3).map((weather) => ({ fb: shot({ biome: "meadow", hour: 14, weather, t: weather === "storm" ? 0.63 * 6 : 2 }), label: `weather ${weather}` })));
rows.push(weathers.slice(3).map((weather) => ({ fb: shot({ biome: "forest", hour: 15, weather, t: 1 }), label: `weather ${weather}` })));
const hold = (kind: "flinch" | "cheer" | "nod" | "think", from: number): Activity => ({ holds: [{ kind, from, to: from + (kind === "think" ? 99 : 2.2) }], heldBefore: 0 });
rows.push([
  { fb: shot({ biome: "meadow", hour: 11, act: hold("flinch", 2.9), t: 3.1 }), label: "flinch (error)" },
  { fb: shot({ biome: "meadow", hour: 11, act: hold("cheer", 2.6), t: 3.1 }), label: "cheer (tests pass)" },
  { fb: shot({ biome: "meadow", hour: 11, act: hold("think", 1), t: 2.5 }), label: "thinking" },
]);
// Half-block tier: 1×2 px per cell, shown upscaled to the same cell box.
const half = (biome: string, hour: number, species: Species) => {
  const fb = shot({ biome, hour, species, w: COLS, h: ROWS * 2 });
  const out = new Framebuffer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(x, y, fb.get(Math.floor(x / 4), Math.floor(y / 4)));
  return out;
};
rows.push([
  { fb: half("meadow", 12.5, "cat"), label: "half-block meadow" },
  { fb: half("cyberpunk", 22, "dragon"), label: "half-block cyberpunk" },
  { fb: half("sakura", 18.3, "blob"), label: "half-block sakura" },
]);

// `--rows 3-7` renders a slice (handy for reviewing at full size).
const range = process.argv[process.argv.indexOf("--rows") + 1]?.match(/^(\d+)-(\d+)$/);
if (process.argv.includes("--rows") && range) rows.splice(0, rows.length, ...rows.slice(+range[1], +range[2] + 1));
const sheet = new Framebuffer(GAP + 3 * (W + GAP), GAP + rows.length * (H + LABEL + GAP));
sheet.fill(hex("#14121c"));
rows.forEach((row, r) => {
  row.forEach((c, i) => {
    const x = GAP + i * (W + GAP);
    const y = GAP + r * (H + LABEL + GAP);
    drawText(sheet, c.label.toUpperCase(), x, y, hex("#c8c0e0"));
    sheet.draw(c.fb, x, y + LABEL);
  });
});
const out = process.argv.find((a) => a.endsWith(".png")) ?? "docs/game-feel/hd-overhaul/h4-sheet.png";
const scale = Number(process.argv[process.argv.indexOf("--scale") + 1]) || 1;
writeFileSync(out, encodePng(sheet.upscale(process.argv.includes("--scale") ? scale : 1)));
console.log(`wrote ${out}`);
