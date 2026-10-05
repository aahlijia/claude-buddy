/**
 * HD species registry — one call renders any HD buddy playing any of the
 * shared animations: `renderHd(species, anim, t, opts)`. Rigged species
 * (cat, dragon) go through rig.ts + motion.ts; the blob keeps its
 * procedural jelly renderer, driven by the same animation names and timings.
 *
 * Species without HD art yet return null, and callers fall back to ASCII.
 */

import type { Rarity, Species } from "../engine.ts";
import { BLOB_H, BLOB_W, RIM_BLOB, SPARK, backdrop, blobPalette, glow, motes, renderBlob } from "./blob.ts";
import { Framebuffer } from "./framebuffer.ts";
import { ANIM_INFO, poseRig, type Anim } from "./motion.ts";
import { anchorOf, renderRig, type RigDef } from "./rig.ts";
import { CAT } from "./species/cat.ts";
import { DRAGON } from "./species/dragon.ts";
import { DUCK } from "./species/duck.ts";
import { GOOSE } from "./species/goose.ts";
import { PENGUIN } from "./species/penguin.ts";
import { OWL } from "./species/owl.ts";
import { CACTUS } from "./species/cactus.ts";
import { MUSHROOM } from "./species/mushroom.ts";
import { RABBIT } from "./species/rabbit.ts";
import { CHONK } from "./species/chonk.ts";
import { WYVERN } from "./species/wyvern.ts";
import { SPARKIT } from "./species/sparkit.ts";
import { TURTLE } from "./species/turtle.ts";
import { SNAIL } from "./species/snail.ts";
import { AXOLOTL } from "./species/axolotl.ts";
import { CAPYBARA } from "./species/capybara.ts";
import { GHOST } from "./species/ghost.ts";
import { OCTOPUS } from "./species/octopus.ts";
import { ROBOT } from "./species/robot.ts";

export const HD_W = BLOB_W;
export const HD_H = BLOB_H;

/** Every rigged species (the blob has its own jelly renderer). */
export const RIGS: Partial<Record<Species, RigDef>> = {
  cat: CAT,
  dragon: DRAGON,
  octopus: OCTOPUS,
  ghost: GHOST,
  robot: ROBOT,
  duck: DUCK,
  goose: GOOSE,
  penguin: PENGUIN,
  owl: OWL,
  cactus: CACTUS,
  mushroom: MUSHROOM,
  rabbit: RABBIT,
  chonk: CHONK,
  wyvern: WYVERN,
  sparkit: SPARKIT,
  turtle: TURTLE,
  snail: SNAIL,
  axolotl: AXOLOTL,
  capybara: CAPYBARA,
};

export const HD_SPECIES: readonly Species[] = ["blob", ...(Object.keys(RIGS) as Species[])];

export function hasHd(species: Species): boolean {
  return HD_SPECIES.includes(species);
}

export interface HdOptions {
  rarity?: Rarity;
  shiny?: boolean;
  seed?: number;
  /** Face left (enemies). */
  flip?: boolean;
  /** Paint the night-meadow backdrop. */
  backdrop?: boolean;
  /** Blob only: recolor the jelly by this many degrees of hue (stand-ins). */
  hue?: number;
}

export { ANIM_INFO, ANIMS, type Anim } from "./motion.ts";

/** Render one frame; `t` is seconds since the animation started. */
export function renderHd(species: Species, anim: Anim, t: number, opts: HdOptions = {}): Framebuffer | null {
  const seed = opts.seed ?? 1;
  const rarity = opts.rarity ?? "common";
  if (species === "blob") {
    const fb = renderBlob(t, { rarity, shiny: opts.shiny, seed, backdrop: opts.backdrop, anim, palette: opts.hue ? blobPalette(opts.hue) : undefined });
    return opts.flip ? flipX(fb) : fb;
  }
  const rig = RIGS[species];
  if (!rig) return null;
  const pose = poseRig(rig, anim, t, seed);
  const fb = new Framebuffer(rig.width, rig.height);
  if (opts.backdrop) backdrop(fb, t, seed);
  // Same rarity dressing as the blob: legendary aura, epic+ motes.
  if (rarity === "legendary") glow(fb, rig.width / 2, rig.ground - 14 - (pose.lift ?? 0), 28, RIM_BLOB.legendary!, 0.45 * (0.75 + 0.25 * Math.sin(t * 2.2)));
  const moteCount = rarity === "legendary" ? 8 : rarity === "epic" ? 5 : 0;
  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], false);
  fb.draw(renderRig(rig, pose, { rarity, shiny: opts.shiny, flip: opts.flip }), 0, 0);
  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], true);
  return fb;
}

/** Whether a one-shot animation has reached its final pose. */
export function animDone(anim: Anim, t: number): boolean {
  const info = ANIM_INFO[anim];
  return !info.loop && t >= info.duration;
}

function flipX(fb: Framebuffer): Framebuffer {
  const out = new Framebuffer(fb.width, fb.height);
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) out.set(fb.width - 1 - x, y, fb.get(x, y));
  return out;
}

/** Where the head sits at rest (rig pixels, facing right): the pivot of
 *  the head part, which rigs put at the neck. The blob is all head. */
export function headAt(species: Species): [number, number] | null {
  if (species === "blob") return [BLOB_W / 2, 38];
  const rig = RIGS[species];
  if (!rig) return null;
  return anchorOf(rig, poseRig(rig, "idle", 0, 1), "head");
}

const topMemo = new Map<Species, number | null>();

/** Topmost opaque row of the rest pose (rig pixels): the tip of the ears,
 *  horns or antenna. Stages hang marks and pops above it. */
export function topAt(species: Species): number | null {
  if (topMemo.has(species)) return topMemo.get(species)!;
  const fb = renderHd(species, "idle", 0);
  let top: number | null = null;
  if (fb) {
    for (let y = 0; y < fb.height && top === null; y++) for (let x = 0; x < fb.width; x++) if (fb.get(x, y)[3] >= 200) { top = y; break; }
  }
  topMemo.set(species, top);
  return top;
}
