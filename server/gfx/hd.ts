/**
 * HD species registry — one call renders any HD buddy playing any of the
 * shared animations: `renderHd(species, anim, t, opts)`. Rigged species
 * (cat, dragon) go through rig.ts + motion.ts; the blob keeps its
 * procedural jelly renderer, driven by the same animation names and timings.
 *
 * Species without HD art yet return null, and callers fall back to ASCII.
 */

import type { Rarity, Species } from "../engine.ts";
import { BLOB_H, BLOB_W, RIM_BLOB, SPARK, backdrop, blobBody, blobPalette, blobRaster, glow, motes, renderBlob } from "./blob.ts";
import { HD_HEADROOM, drawBlobGear, drawTrinket, equipRig, gearPose, needsHeadroom, type HdGear } from "./gear.ts";
import { Framebuffer } from "./framebuffer.ts";
import { ANIM_INFO, poseRig, type Anim } from "./motion.ts";
import { anchorOf, rasterRig, renderRig, type Pose, type RigDef, type RigRaster } from "./rig.ts";
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
  /** Hat, held weapon and trinket (gear.ts). */
  gear?: HdGear;
}

export { HD_HEADROOM, type HdGear } from "./gear.ts";

/** Rows from a frame's ground line to its bottom edge (every HD frame). */
export const HD_FOOT = BLOB_H - 51;

/** The ground line of an HD frame (hatted frames are taller: align by this). */
export function groundOf(fb: Framebuffer): number {
  return fb.height - HD_FOOT;
}

export { ANIM_INFO, ANIMS, type Anim } from "./motion.ts";

/** Render one frame; `t` is seconds since the animation started. */
export function renderHd(species: Species, anim: Anim, t: number, opts: HdOptions = {}): Framebuffer | null {
  const seed = opts.seed ?? 1;
  const rarity = opts.rarity ?? "common";
  const gear = opts.gear;
  if (species === "blob") {
    const bo = { rarity, shiny: opts.shiny, seed, backdrop: opts.backdrop, anim, palette: opts.hue ? blobPalette(opts.hue) : undefined };
    let fb = renderBlob(t, bo);
    if (gear) {
      // Hats get the taller canvas (see HD_HEADROOM): shift the blob down.
      const pad = needsHeadroom(gear) ? HD_HEADROOM : 0;
      if (pad) {
        const tall = new Framebuffer(fb.width, fb.height + pad);
        tall.draw(fb, 0, pad);
        fb = tall;
      }
      if (gear.trinket) behind(fb, (l) => drawTrinket(l, gear.trinket!, restLeft("blob"), BLOB_GROUND + pad));
      const body = blobBody(t, bo);
      drawBlobGear(fb, gear, { ...body, cy: body.cy + pad }, t);
    }
    return opts.flip ? flipX(fb) : fb;
  }
  const base = RIGS[species];
  if (!base) return null;
  const rig = equipRig(base, gear);
  const pose = gearPose(poseRig(rig, anim, t, seed), gear, t);
  const fb = new Framebuffer(rig.width, rig.height);
  if (opts.backdrop) backdrop(fb, t, seed);
  // Same rarity dressing as the blob: legendary aura, epic+ motes.
  if (rarity === "legendary") glow(fb, rig.width / 2, rig.ground - 14 - (pose.lift ?? 0), 28, RIM_BLOB.legendary!, 0.45 * (0.75 + 0.25 * Math.sin(t * 2.2)));
  const moteCount = rarity === "legendary" ? 8 : rarity === "epic" ? 5 : 0;
  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], false);
  if (gear?.trinket) {
    // The trinket rests on the ground behind the buddy (mirrored for foes).
    const layer = new Framebuffer(rig.width, rig.height);
    drawTrinket(layer, gear.trinket, restLeft(species), rig.ground);
    fb.draw(opts.flip ? flipX(layer) : layer, 0, 0);
  }
  fb.draw(renderRig(rig, pose, { rarity, shiny: opts.shiny, flip: opts.flip }), 0, 0);
  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], true);
  return fb;
}

/**
 * An HD buddy before lighting (rig.ts `RigRaster`), for renderers that
 * resolve at their own size (the mini status sprite). Gear renderHd draws
 * as pixels rather than rig parts comes along as layers: `under` (the
 * trinket) and `over` (the blob's hat and weapon), each `dy` rows above the
 * raster (a hat's headroom). Null for species without HD art.
 */
export interface HdRaster {
  rig: RigDef;
  pose: Pose;
  raster: RigRaster;
  under: Framebuffer | null;
  over: Framebuffer | null;
  /** Raster row of the layers' top row (≤ 0). */
  dy: number;
}

export function rasterHd(species: Species, anim: Anim, t: number, opts: HdOptions = {}): HdRaster | null {
  const gear = opts.gear;
  if (species === "blob") {
    const bo = { rarity: opts.rarity, shiny: opts.shiny, seed: opts.seed ?? 1, anim, palette: opts.hue ? blobPalette(opts.hue) : undefined };
    const { rig, pose, raster } = blobRaster(t, bo);
    if (!gear) return { rig, pose, raster, under: null, over: null, dy: 0 };
    const pad = needsHeadroom(gear) ? HD_HEADROOM : 0;
    const body = blobBody(t, bo);
    let under: Framebuffer | null = null;
    if (gear.trinket) {
      under = new Framebuffer(rig.width, rig.height + pad);
      drawTrinket(under, gear.trinket, restLeft("blob"), BLOB_GROUND + pad);
    }
    const over = new Framebuffer(rig.width, rig.height + pad);
    drawBlobGear(over, gear, { ...body, cy: body.cy + pad }, t);
    return { rig, pose, raster, under, over, dy: -pad };
  }
  const base = RIGS[species];
  if (!base) return null;
  const rig = equipRig(base, gear);
  const pose = gearPose(poseRig(rig, anim, t, opts.seed ?? 1), gear, t);
  let under: Framebuffer | null = null;
  if (gear?.trinket) {
    under = new Framebuffer(rig.width, rig.height);
    drawTrinket(under, gear.trinket, restLeft(species), rig.ground);
  }
  return { rig, pose, raster: rasterRig(rig, pose), under, over: null, dy: 0 };
}

const BLOB_GROUND = 51;

/** Draw onto a layer, then under what's already there (the blob's trinket). */
function behind(fb: Framebuffer, paint: (layer: Framebuffer) => void): void {
  const layer = new Framebuffer(fb.width, fb.height);
  paint(layer);
  layer.draw(fb, 0, 0);
  fb.data.set(layer.data);
}

const leftMemo = new Map<Species, number>();

/** The buddy's leftmost opaque column at rest (trinkets sit clear of it). */
function restLeft(species: Species): number {
  const hit = leftMemo.get(species);
  if (hit !== undefined) return hit;
  const fb = renderHd(species, "idle", 0);
  let left = 8;
  if (fb) {
    outer: for (let x = 0; x < fb.width; x++) for (let y = 0; y < fb.height - 4; y++) if (fb.get(x, y)[3] >= 200) { left = x; break outer; }
  }
  leftMemo.set(species, left);
  return left;
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
