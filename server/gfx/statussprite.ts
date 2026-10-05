/**
 * HD buddies for the Claude Code status line (H5,
 * docs/game-feel/hd-overhaul/h5-statusline.md).
 *
 * The status line is a bash script Claude Code runs about once a second; it
 * must never rasterize. So the server bakes the HD buddy into truecolor
 * half-block strings — a handful of *key poses* that read at 1 Hz — and
 * bash cycles them exactly like the ASCII frames (`seq[NOW % len]`).
 *
 * Pure: species, look, size and mood in, strings out. Every frame of a set
 * is cropped to one shared box, so the sprite never jumps between poses.
 */

import type { Rarity, Species } from "../engine.ts";
import { downscale } from "./diorama.ts";
import { encodeHalfblock } from "./encode/halfblock.ts";
import { Framebuffer } from "./framebuffer.ts";
import { blinkAt } from "./blob.ts";
import { ANIM_INFO, hasHd, rasterHd, renderHd, type Anim, type HdRaster } from "./hd.ts";
import type { HdGear } from "./gear.ts";
import { resolveRig, shrinkRig, type RigRaster } from "./rig.ts";

export const STATUS_SPRITES = ["off", "mini", "full"] as const;
export type StatusSprite = (typeof STATUS_SPRITES)[number];

/** Target sprite height in pixels (two per row): mini ≈ 6 rows, full ≈ 12. */
const TARGET_PX: Record<Exclude<StatusSprite, "off">, number> = { mini: 12, full: 24 };

/** Mini: the buddy's tallest pose spans this many pixels, plus a 1-px outline on top. */
const MINI_BODY_PX = TARGET_PX.mini - 1;
/** Mini: widest sprite in cells, outline included. */
const MINI_MAX_W = 16;

/** Moods the status line already tracks (server/state.ts `Emotion`). */
export type SpriteMood = "neutral" | "happy" | "angry" | "bored" | "surprised";

export interface SpriteLook {
  species: Species;
  rarity: Rarity;
  shiny: boolean;
  /** Stable per buddy (blinks and motes). */
  seed: number;
  /** Hat, weapon and trinket (gear.ts). */
  gear?: HdGear;
}

export interface BakedSprite {
  /** Each frame: `rows` lines joined by "\n", every line `width` cells wide. */
  frames: string[];
  /** Indices into `frames`; bash shows `sequence[NOW % len]`. */
  sequence: number[];
  /** Celebration poses (victory), shown while a celebration is fresh. */
  celebFrames: string[];
  celebSequence: number[];
  width: number;
  rows: number;
}

interface Pose {
  anim: Anim;
  t: number;
}

/** The first moment the buddy's eyes are shut (a blink to drop into the loop). */
function blinkTime(seed: number): number {
  for (let t = 0.2; t < 30; t += 0.01) if (blinkAt(t, seed) === "closed") return t;
  return 0;
}

const idleAt = (k: number, n: number): Pose => ({ anim: "idle", t: (k / n) * ANIM_INFO.idle.duration });
const victoryAt = (k: number, n: number): Pose => ({ anim: "victory", t: (k / n) * ANIM_INFO.victory.duration });

/**
 * Key poses per mood, and the 1 Hz sequence through them. Idle is four
 * breaths with a blink; anger flinches once a cycle; happiness hops.
 */
export function keyPoses(mood: SpriteMood, seed: number): { poses: Pose[]; sequence: number[] } {
  const idle = [0, 1, 2, 3].map((k) => idleAt(k, 4));
  const blink: Pose = { anim: "idle", t: blinkTime(seed) };
  switch (mood) {
    case "angry":
      return { poses: [...idle, { anim: "hit", t: 0.12 }, { anim: "hit", t: 0.3 }], sequence: [4, 5, 0, 1, 2, 3] };
    case "happy":
      return { poses: [...idle, victoryAt(1, 4), victoryAt(2, 4)], sequence: [4, 5, 0, 1, 4, 5, 2, 3] };
    case "surprised":
      return { poses: [...idle, { anim: "hit", t: 0.08 }], sequence: [4, 0, 1, 2, 3, 0] };
    default:
      return { poses: [...idle, blink], sequence: [0, 1, 2, 3, 0, 1, 2, 4] };
  }
}

/** Opaque bounding box of a set of frames: [x0, y0, x1, y1) or null if empty. */
function bbox(fbs: readonly Framebuffer[], cutoff: number): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const fb of fbs) {
    for (let y = 0; y < fb.height; y++) {
      for (let x = 0; x < fb.width; x++) {
        if (fb.get(x, y)[3] < cutoff) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x >= x1) x1 = x + 1;
        if (y >= y1) y1 = y + 1;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Below this alpha a pixel is a shadow or a glow fringe: dropped, so the
 *  sprite reads on light and dark terminals alike (no dark smear under it). */
const SOLID = 160;

function crop(fb: Framebuffer, x0: number, y0: number, w: number, h: number): Framebuffer {
  const out = new Framebuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fb.get(x0 + x, y0 + y);
      if (c[3] >= SOLID) out.set(x, y, [c[0], c[1], c[2], 255]);
    }
  }
  return out;
}

/**
 * Bake the status-line sprite set, or null when the species has no HD art
 * (the ASCII frames stay) or the size is "off". `still` (reduceMotion)
 * bakes one pose.
 */
export function bakeStatusSprite(look: SpriteLook, size: StatusSprite, mood: SpriteMood = "neutral", still = false): BakedSprite | null {
  if (size === "off" || !hasHd(look.species)) return null;
  if (size === "mini") return bakeMini(look, mood, still);
  const render = (p: Pose, gear: HdGear | null = look.gear ?? null) => renderHd(look.species, p.anim, p.t, { rarity: look.rarity, shiny: look.shiny, seed: look.seed, gear: gear ?? undefined })!;
  const key = still ? { poses: [idleAt(0, 4)], sequence: [0] } : keyPoses(mood, look.seed);
  const celebPoses = still ? [victoryAt(0, 4)] : [0, 1, 2, 3].map((k) => victoryAt(k, 4));
  const raw = key.poses.map((p) => render(p));
  const celebRaw = celebPoses.map((p) => render(p));

  // One crop box for every pose (incl. the hop), snapped to the downscale grid
  // and to an even pixel height so each half-block row stays whole. The
  // scale comes from the bare buddy, so a hat adds rows instead of shrinking
  // it (frames are bottom-aligned: a hatted one is taller by its headroom).
  const box = bbox([...raw, ...celebRaw], SOLID)!;
  const bare = look.gear ? bbox([...key.poses, ...celebPoses].map((p) => render(p, null)), SOLID)! : box;
  const f = Math.max(1, Math.ceil((bare[3] - bare[1]) / TARGET_PX[size]));
  const step = f * 2;
  const x0 = Math.floor(box[0] / f) * f;
  const x1 = Math.ceil(box[2] / f) * f;
  // Anchor the bottom (the feet) so every size keeps the ground line.
  const y1 = Math.ceil(box[3] / f) * f;
  const y0 = y1 - Math.ceil((y1 - Math.floor(box[1] / f) * f) / step) * step;
  const encode = (fb: Framebuffer) => encodeHalfblock(downscale(crop(fb, x0, y0, x1 - x0, y1 - y0), f), { color: "truecolor" }).join("\n");
  const frames = raw.map(encode);
  return {
    frames,
    sequence: key.sequence,
    celebFrames: celebRaw.map(encode),
    celebSequence: celebPoses.map((_, i) => i),
    width: (x1 - x0) / f,
    rows: (y1 - y0) / f / 2,
  };
}

// ─── Mini: drawn at its own size ───────────────────────────────────────────

/**
 * At 12 px tall, shrinking a finished 64×56 frame averages the outline, the
 * eyes and the shading into mush. Mini instead shrinks the *raster* (which
 * part and material each pixel is, and its normal; rig.ts `shrinkRig`) and
 * runs the style pipeline at the small size: flat ramp colors lit a little
 * brighter and without dither, a crisp 1-px sel-out outline, no inner lines,
 * and eyes redrawn as designed dots. No rarity rim (it would cover half the
 * pixels); the status line already colors the name by rarity.
 * docs/game-feel/hd-overhaul/mini-sprite.md
 */
function bakeMini(look: SpriteLook, mood: SpriteMood, still: boolean): BakedSprite {
  const key = still ? { poses: [idleAt(0, 4)], sequence: [0] } : keyPoses(mood, look.seed);
  const celebPoses = still ? [victoryAt(0, 4)] : [0, 1, 2, 3].map((k) => victoryAt(k, 4));
  const all = [...key.poses, ...celebPoses];
  const opts = { rarity: look.rarity, shiny: look.shiny, seed: look.seed };
  const src = all.map((p) => rasterHd(look.species, p.anim, p.t, { ...opts, gear: look.gear })!);

  // The scale comes from the bare buddy's tallest single pose, so a hat adds
  // rows instead of shrinking it, and a hop costs no resolution: hops are
  // clamped into the headroom instead (a 1–2 px hop still reads at 1 Hz).
  const bareSrc = look.gear ? all.map((p) => rasterHd(look.species, p.anim, p.t, opts)!) : src;
  const tallest = Math.max(...bareSrc.map((s) => { const b = rasterBox([s], false)!; return b[3] - b[1]; }));
  const boxes = src.map((s) => rasterBox([s], true)!);
  const bx0 = Math.min(...boxes.map((b) => b[0]));
  const bx1 = Math.max(...boxes.map((b) => b[2]));
  // Long buddies (a dragon's wings, a cat's tail) give up a little height
  // to stay within the mini footprint.
  const f = Math.max(tallest / MINI_BODY_PX, (bx1 - bx0) / (MINI_MAX_W - 2));
  // The ground: where the feet are when nothing hops.
  const by1 = Math.max(...boxes.map((b) => b[3]));
  // An even row count with one row of headroom for the outline; the feet sit
  // on the bottom row (no outline under them: they stand on the line).
  const h = Math.ceil((Math.max(...boxes.map((b) => b[3] - b[1])) / f + 1) / 2) * 2;
  const w = Math.ceil((bx1 - bx0) / f) + 2;
  const ox = bx0 - f;

  const frame = (s: HdRaster, i: number): string => {
    // Lower a pose that would rise past the headroom (the hop's peak).
    const oy = Math.min(by1 - h * f, boxes[i][1] - f);
    const out = new Framebuffer(w, h);
    if (s.under) out.draw(shrinkPixels(s.under, f, ox, oy - s.dy, w, h), 0, 0);
    const mini = shrinkRig(s.rig, s.raster, s.pose, f, ox, oy, w, h);
    out.draw(resolveRig(s.rig, mini, s.pose, { shiny: look.shiny, noShadow: true, dither: false, innerLine: 0, rampFloor: 1, ambient: 0.34 }), 0, 0);
    if (s.over) out.draw(shrinkPixels(s.over, f, ox, oy - s.dy, w, h), 0, 0);
    return encodeHalfblock(out, { color: "truecolor" }).join("\n");
  };
  const frames = src.map(frame);
  return {
    frames: frames.slice(0, key.poses.length),
    sequence: key.sequence,
    celebFrames: frames.slice(key.poses.length),
    celebSequence: celebPoses.map((_, i) => i),
    width: w,
    rows: h / 2,
  };
}

/** Union bounding box of rasters (and, with `layers`, their gear layers). */
function rasterBox(src: readonly HdRaster[], layers: boolean): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const hit = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  };
  for (const s of src) {
    const r: RigRaster = s.raster;
    for (let o = 0; o < r.width * r.height; o++) if (r.owner[o] >= 0) hit(o % r.width, Math.floor(o / r.width));
    if (!layers) continue;
    for (const l of [s.under, s.over]) {
      if (!l) continue;
      for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) if (l.get(x, y)[3] >= SOLID) hit(x, y + s.dy);
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Shrink a pixel layer (gear drawn as pixels) on the same grid as shrinkRig. */
function shrinkPixels(src: Framebuffer, f: number, ox: number, oy: number, w: number, h: number): Framebuffer {
  const out = new Framebuffer(w, h);
  const S = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const c = src.get(Math.floor(ox + (x + (i + 0.5) / S) * f), Math.floor(oy + (y + (j + 0.5) / S) * f));
          if (c[3] < SOLID) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }
      if (n >= 0.45 * S * S) out.set(x, y, [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255]);
    }
  }
  return out;
}
