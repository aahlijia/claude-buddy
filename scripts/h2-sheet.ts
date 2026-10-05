#!/usr/bin/env bun
/**
 * Contact sheet for the H2 HD fight stage (docs/game-feel/hd-overhaul/h2-quest-player.md).
 *
 *   bun run scripts/h2-sheet.ts [out.png]
 *
 * Rows: the encounter (wipe → flash → walk-in → ready), a strike (wind-up →
 * impact under hit-stop → sparks → recoil and ghost-bar drain), a crit on a
 * boss (camera push-in, flash), a KO (collapse → victory hop, confetti), and
 * the same strike in the half-block tier.
 */

import { writeFileSync } from "node:fs";
import type { BuddyStats } from "../server/engine.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { Framebuffer } from "../server/gfx/framebuffer.ts";
import { direct, directIntro, type Cue } from "../server/rpg/anim.ts";
import { act, makeBoss, makeMonster, startBattle, type Battle, type FoeSide } from "../server/rpg/battle.ts";
import { ZONES } from "../server/rpg/data.ts";
import { SCENE_H, SCENE_W, composeFrame, hdCast, hdTimeline, sceneAt, type Timeline } from "../server/rpg/hdstage.ts";
import { deriveHero } from "../server/rpg/hero.ts";
import { stageGeometry, type Look } from "../server/rpg/render.ts";

const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const FULL = { shake: true, flash: true, camera: true };

function battle(look: Look, foe: FoeSide, seed: number, kind: Battle["kind"] = "explore"): Battle {
  const h = deriveHero(1, 0, STATS, {}, [], look.species);
  const b = startBattle(kind, 1, 1, h, h.maxHp, foe, seed);
  b.hero.hp = b.hero.maxHp = 500;
  return b;
}

function tl(look: Look, b0: Battle, cues: (g: ReturnType<typeof stageGeometry>) => Cue[], b1 = b0): Timeline {
  const g = stageGeometry(b1, look);
  return hdTimeline(cues(g), hdCast(b1, look)!, FULL, { maxHp: [b1.hero.maxHp, b1.foe.maxHp], cell: g });
}

/** First seed whose turn satisfies `want`. */
function find(look: Look, foe: () => FoeSide, want: (b: Battle) => boolean, kind: Battle["kind"] = "explore", prep?: (b: Battle) => void): [Battle, Battle] {
  for (let seed = 1; seed < 2000; seed++) {
    const b0 = battle(look, foe(), seed, kind);
    prep?.(b0);
    const b1 = act(b0, { type: "attack" });
    if (want(b1)) return [b0, b1];
  }
  throw new Error("no matching turn");
}

const impact = (t: Timeline) => t.starts[t.cues.findIndex((c) => c.stage.hd?.impact?.by === "hero")];
const heroStrike = (crit: boolean) => (b: Battle) => (b.beats ?? []).some((x) => x.t === "strike" && x.by === "hero" && x.crit === crit);

const cat: Look = { name: "Pip", species: "cat", eye: "·", hat: "none", rarity: "rare" };
const dragon: Look = { name: "Ember", species: "dragon", eye: "·", hat: "none", rarity: "legendary" };
const blob: Look = { name: "Goo", species: "blob", eye: "·", hat: "none", rarity: "epic", shiny: true };

const rows: { t: Timeline; at: number[]; half?: boolean }[] = [];

// 1 · encounter
{
  const b = battle(cat, makeMonster(ZONES[0].monsters[2], 3), 9);
  const t = tl(cat, b, (g) => directIntro(b, g));
  const walk = t.segments.hero.find((s) => s.anim === "walk")!.start;
  rows.push({ t, at: [80, 200, walk, walk + 70, walk + 150, t.cueMs - 1] });
}
// 2 · a strike on a stand-in slime
const [s0, s1] = find(cat, () => makeMonster(ZONES[0].monsters[2], 3), heroStrike(false));
{
  const t = tl(cat, s0, (g) => direct(s0, s1, g), s1);
  const j = impact(t);
  rows.push({ t, at: [j - 70, j, j + 60, j + 140, j + 260, j + 420] });
}
// 3 · a crit on the Segfault Dragon (boss)
{
  const [b0, b1] = find(dragon, () => makeBoss("segfault", 4), heroStrike(true), "boss");
  const t = tl(dragon, b0, (g) => direct(b0, b1, g), b1);
  const j = impact(t);
  rows.push({ t, at: [j - 60, j, j + 50, j + 110, j + 200, j + 360] });
}
// 4 · KO and victory
{
  const [b0, b1] = find(blob, () => makeMonster(ZONES[0].monsters[1], 3), (b) => b.over === "win", "explore", (b) => (b.foe.hp = 2));
  const t = tl(blob, b0, (g) => direct(b0, b1, g), b1);
  const j = impact(t);
  rows.push({ t, at: [j, j + 300, j + 600, t.total - 500, t.total - 250, t.total - 1] });
}
// 5 · the strike again, half-block tier
{
  const t = tl(cat, s0, (g) => direct(s0, s1, g), s1);
  const j = impact(t);
  rows.push({ t, at: [j - 70, j, j + 60, j + 140, j + 260, j + 420], half: true });
}

const COLS = 6;
const GAP = 2;
const sheet = new Framebuffer(COLS * (SCENE_W + GAP), rows.length * (SCENE_H + GAP));
sheet.fill([16, 14, 24, 255]);
rows.forEach((r, y) => {
  r.at.forEach((T, x) => {
    let fb = composeFrame(r.t.cast, sceneAt(r.t, Math.max(0, T)), !!r.half);
    if (r.half) fb = fb.upscale(2);
    sheet.draw(fb, x * (SCENE_W + GAP), y * (SCENE_H + GAP));
  });
});
const out = process.argv[2] ?? "docs/game-feel/hd-overhaul/h2-sheet.png";
writeFileSync(out, encodePng(sheet.upscale(2)));
console.log(`wrote ${out}`);
