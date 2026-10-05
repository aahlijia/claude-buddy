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
import { ANIM_INFO, hasHd, renderHd, type Anim } from "./hd.ts";
import type { HdGear } from "./gear.ts";

export const STATUS_SPRITES = ["off", "mini", "full"] as const;
export type StatusSprite = (typeof STATUS_SPRITES)[number];

/** Target sprite height in pixels (two per row): mini ≈ 6 rows, full ≈ 12. */
const TARGET_PX: Record<Exclude<StatusSprite, "off">, number> = { mini: 12, full: 24 };

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
