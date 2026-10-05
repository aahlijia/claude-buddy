#!/usr/bin/env bun
/**
 * A quest fight with a geared hero (docs/game-feel/hd-overhaul/hd-gear.md):
 * rest, the Power Strike cut-in (the close-up wears the hat), wind-up,
 * impact, and the end of the turn.
 *
 *   bun run scripts/gear-fight.ts [out.png]
 */

import { writeFileSync } from "node:fs";
import type { BuddyStats } from "../server/engine.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { Framebuffer } from "../server/gfx/framebuffer.ts";
import { direct } from "../server/rpg/anim.ts";
import { act, makeMonster, startBattle } from "../server/rpg/battle.ts";
import { ZONES } from "../server/rpg/data.ts";
import { composeFrame, hdCast, hdTimeline, sceneAt } from "../server/rpg/hdstage.ts";
import { deriveHero } from "../server/rpg/hero.ts";
import { stageGeometry, type Look } from "../server/rpg/render.ts";
const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const look = { name: "Pip", species: "cat", eye: "·", hat: "wizard", rarity: "rare", gear: { hat: "wizard", weapon: "blade", weaponRarity: "epic", trinket: "duck" } } as Look;
const h = deriveHero(1, 0, STATS, {}, [], "cat");
const b0 = startBattle("explore", 1, 1, h, h.maxHp, makeMonster(ZONES[0].monsters[2], 3), 5);
b0.hero.hp = b0.hero.maxHp = 500;
const b1 = act(b0, { type: "skill", id: "strike" });
const g = stageGeometry(b1, look);
const tl = hdTimeline(direct(b0, b1, g), hdCast(b1, look)!, { shake: false, flash: false, camera: true, cutin: true }, { maxHp: [500, b1.foe.maxHp], cell: g });
const hold = tl.holds[0];
const imp = tl.starts[tl.cues.findIndex((c) => c.stage.hd?.impact?.by === "hero")];
const times = [0, hold.at + 300, imp - 80, imp, tl.total - 1];
const sheet = new Framebuffer(120 * times.length + 8, 60);
times.forEach((T, i) => sheet.draw(composeFrame(tl.cast, sceneAt(tl, T), false), i * 122, 0));
writeFileSync(process.argv[2] ?? "docs/game-feel/hd-overhaul/hd-gear-fight.png", encodePng(sheet.upscale(2)));
