#!/usr/bin/env bun
/**
 * Contact sheet for the H6 cinematics (docs/game-feel/hd-overhaul/h6-roster.md).
 *
 *   bun run scripts/h6-cinema.ts [out.png]
 *
 * Rows: a legendary shiny hatch, a rare hatch, a legendary loot reveal, an
 * uncommon one, then the fight stage: a special-move cut-in, a foe's
 * mirrored cut-in, and a boss phase change. Rendered at gameFeel subtle (no
 * flashes) so frames read.
 */

import { writeFileSync } from "node:fs";
import type { BuddyStats } from "../server/engine.ts";
import { HATCH_BURST, LOOT_POP, cineFeel, renderHatch, renderLoot } from "../server/gfx/cinema.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { Framebuffer, hex } from "../server/gfx/framebuffer.ts";
import { direct } from "../server/rpg/anim.ts";
import { act, makeBoss, makeMonster, startBattle, type Battle } from "../server/rpg/battle.ts";
import { ZONES } from "../server/rpg/data.ts";
import { composeFrame, hdCast, hdTimeline, sceneAt, type Timeline } from "../server/rpg/hdstage.ts";
import { deriveHero } from "../server/rpg/hero.ts";
import { stageGeometry, type Look } from "../server/rpg/render.ts";

const out = process.argv[2] ?? "docs/game-feel/hd-overhaul/h6-cinema.png";
const feel = cineFeel("subtle")!;
const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const STAGE = { shake: false, flash: false, camera: true, cutin: true };

const rows: Framebuffer[][] = [];
const hatchAt = [300, 1100, 1600, 1950, HATCH_BURST + 80, HATCH_BURST + 300, HATCH_BURST + 700, HATCH_BURST + 1500];
const lootAt = [300, 650, LOOT_POP + 60, LOOT_POP + 250, LOOT_POP + 600, LOOT_POP + 1000, LOOT_POP + 1500, LOOT_POP + 1900];
rows.push(hatchAt.map((ms) => renderHatch({ species: "axolotl", rarity: "legendary", shiny: true, seed: 4 }, ms, feel)));
rows.push(hatchAt.map((ms) => renderHatch({ species: "robot", rarity: "rare", shiny: false, seed: 4 }, ms, feel)));
rows.push(lootAt.map((ms) => renderLoot({ name: "Segfault Saber", rarity: "legendary", slot: "weapon", seed: 4 }, ms, feel)));
rows.push(lootAt.map((ms) => renderLoot({ name: "Mutex Mail", rarity: "uncommon", slot: "armor", seed: 4 }, ms, feel)));

function fight(look: Look, foe: Battle["foe"], seed: number): Battle {
  const h = deriveHero(1, 0, STATS, {}, [], look.species);
  const b = startBattle(foe.boss ? "boss" : "explore", 1, 1, h, h.maxHp, foe, seed);
  b.hero.hp = b.hero.maxHp = 500;
  return b;
}

function timeline(look: Look, b0: Battle, b1: Battle): Timeline {
  const g = stageGeometry(b1, look);
  return hdTimeline(direct(b0, b1, g), hdCast(b1, look)!, STAGE, { maxHp: [b1.hero.maxHp, b1.foe.maxHp], cell: g });
}

const stageRow = (tl: Timeline, at: number[]) => at.map((T) => composeFrame(tl.cast, sceneAt(tl, T), false));

// Cut-in: a penguin's Power Strike.
{
  const look: Look = { name: "Pip", species: "penguin", eye: "·", hat: "none", rarity: "epic" };
  const b0 = fight(look, makeMonster(ZONES[0].monsters[2], 3), 5);
  const tl = timeline(look, b0, act(b0, { type: "skill", id: "strike" }));
  const h = tl.holds[0];
  rows.push(stageRow(tl, [h.at + 40, h.at + 120, h.at + 300, h.at + 560, h.at + 660]));
}
// A foe's special: the mirrored cut-in (a monster's move, first time only).
{
  const look: Look = { name: "Pip", species: "cat", eye: "·", hat: "none", rarity: "rare" };
  const def = ZONES.flatMap((z) => z.monsters).find((m) => m.id === "zalgo")!;
  for (let seed = 1; seed < 400; seed++) {
    const b0 = fight(look, makeMonster(def, 3), seed);
    const b1 = act(b0, { type: "defend" });
    const tl = timeline(look, b0, b1);
    const h = tl.holds.find((x) => x.kind === "cutin" && x.by === "foe");
    if (!h) continue;
    rows.push(stageRow(tl, [h.at + 40, h.at + 120, h.at + 300, h.at + 560, h.at + 660]));
    break;
  }
}
// Boss phase change.
{
  const look: Look = { name: "Ember", species: "wyvern", eye: "·", hat: "none", rarity: "legendary" };
  for (let seed = 1; seed < 400; seed++) {
    const b0 = fight(look, makeBoss("segfault", 4), seed);
    b0.foe.hp = Math.floor(b0.foe.maxHp / 2) + 1;
    const b1 = act(b0, { type: "attack" });
    if (!(b1.beats ?? []).some((x) => x.t === "speech" && x.phase) || b1.over) continue;
    const tl = timeline(look, b0, b1);
    const h = tl.holds.find((x) => x.kind === "phase")!;
    rows.push(stageRow(tl, [h.at - 100, h.at + 200, h.at + 500, h.at + 650, h.at + 1000]));
    break;
  }
}

// Lay out: cinematic rows are 72 × 56 cells, stage rows 120 × 60 (scaled to fit).
const GAP = 2;
const W = Math.max(...rows.map((r) => r.reduce((s, f) => s + f.width + GAP, 0)));
const H = rows.reduce((s, r) => s + r[0].height + GAP, 0);
const sheet = new Framebuffer(W, H);
sheet.fill(hex("#0e0b16"));
let y = 0;
for (const r of rows) {
  let x = 0;
  for (const f of r) {
    sheet.draw(f, x, y);
    x += f.width + GAP;
  }
  y += r[0].height + GAP;
}
writeFileSync(out, encodePng(sheet.upscale(2)));
console.log(`wrote ${out}`);
