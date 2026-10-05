/**
 * HD blob — the H0 pilot buddy (docs/game-feel/hd-overhaul/brainstorm.md §8).
 *
 * A procedural "rig": the body is a lit jelly dome (lambert + specular,
 * quantized to a 5-step pixel-art ramp with light ordered dithering, then a
 * sel-out outline pass); the face is small palette-indexed pixel sprites
 * riding on the body. Motion is all pose math: breathing squash/stretch,
 * seeded blinks and glances, and a happy-bounce with anticipation, stretch,
 * landing squash and a springy settle. Rarity adds rim light, aura and
 * motes; shiny swaps the palette and adds twinkles.
 *
 * Pure: `renderBlob(t, opts)` is a function of time and seed only.
 */

import { mulberry32, type Rarity } from "../engine.ts";
import { easeInCubic, easeInOutCubic, easeOutCubic, lerp, span, springDecay } from "./ease.ts";
import { Framebuffer, blit, hex, mix, sprite, type RGBA, type Sprite } from "./framebuffer.ts";

export const BLOB_W = 64;
export const BLOB_H = 56;

const CX = 32;
const GROUND = 51;
const RX = 20;
const RY = 16;
const JUMP = 14;
export const BOUNCE_SECONDS = 1.15;

// ─── Palettes ────────────────────────────────────────────────────────────────

export interface BodyPalette {
  /** Dark → bright lighting ramp. */
  ramp: readonly RGBA[];
  /** Warm light bounced up from the ground onto the underside. */
  bounce: RGBA;
  /** What sel-out outlines darken toward. */
  outline: RGBA;
  blush: RGBA;
}

const MINT: BodyPalette = {
  ramp: ["#1d4a5c", "#277a80", "#40b2a3", "#7cdeb8", "#c4f7d6"].map(hex),
  bounce: hex("#9df0c8"),
  outline: hex("#10202e"),
  blush: hex("#ff7a9a"),
};

const SHINY: BodyPalette = {
  ramp: ["#4a1e5c", "#80348c", "#c45cbe", "#f096dc", "#ffd6f0"].map(hex),
  bounce: hex("#ffc0e8"),
  outline: hex("#24102e"),
  blush: hex("#ffdf6a"),
};

/** Rotate a color's hue by `deg` (keeps lightness, so ramps stay ramps). */
export function hueShift(c: RGBA, deg: number): RGBA {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Rotation about the gray axis in RGB space.
  const k = (1 - cos) / 3;
  const s3 = Math.sqrt(1 / 3) * sin;
  const m = [cos + k, k - s3, k + s3, k + s3, cos + k, k - s3, k - s3, k + s3, cos + k];
  const [r, g, b] = c;
  const ch = (i: number) => Math.max(0, Math.min(255, Math.round(m[i] * r + m[i + 1] * g + m[i + 2] * b)));
  return [ch(0), ch(3), ch(6), c[3]];
}

/** The mint jelly recolored by `deg` — HD stand-ins for foes without a rig. */
export function blobPalette(deg: number): BodyPalette {
  return {
    ramp: MINT.ramp.map((c) => hueShift(c, deg)),
    bounce: hueShift(MINT.bounce, deg),
    outline: MINT.outline,
    blush: MINT.blush,
  };
}

/** Rim light per rarity (null = flat). Echoes theme.ts rarity colors. */
export const RIM_BLOB: Record<Rarity, RGBA | null> = {
  common: null,
  uncommon: hex("#7ee69a"),
  rare: hex("#b1b9f9"),
  epic: hex("#c8a0ff"),
  legendary: hex("#ffd25a"),
};

export const SPARK: Record<Rarity, RGBA> = {
  common: hex("#ffffff"),
  uncommon: hex("#a0ffb8"),
  rare: hex("#c8d0ff"),
  epic: hex("#d8b4ff"),
  legendary: hex("#ffe28a"),
};

// ─── Face parts (palette-indexed pixel sprites) ─────────────────────────────

const FACE_INK: Record<string, RGBA> = {
  "#": hex("#1e1830"),
  o: hex("#ffffff"),
  p: hex("#4a3f86"),
  r: hex("#e05a74"),
};

export type EyeState = "open" | "half" | "closed" | "happy" | "angry" | "x";

const EYE: Record<EyeState, Sprite> = {
  open: sprite(["..##..", ".####.", "#oo###", "#oo###", "######", "##pp##", ".####.", "..##.."], FACE_INK),
  half: sprite(["......", "......", "......", ".####.", "######", "##pp##", ".####.", "......"], FACE_INK),
  closed: sprite(["......", "......", "......", "......", "#....#", ".####.", "......", "......"], FACE_INK),
  happy: sprite(["......", "......", "..##..", ".#..#.", "#....#", "......", "......", "......"], FACE_INK),
  angry: sprite(["##....", ".###..", "..####", "#oo###", "######", "##pp##", ".####.", "..##.."], FACE_INK),
  x: sprite(["......", "#....#", ".#..#.", "..##..", "..##..", ".#..#.", "#....#", "......"], FACE_INK),
};

export type MouthState = "smile" | "open" | "frown";

const MOUTH: Record<MouthState, Sprite> = {
  smile: sprite(["#...#", ".###."], FACE_INK),
  open: sprite([".##.", "#rr#", ".##."], FACE_INK),
  frown: sprite([".###.", "#...#"], FACE_INK),
};

// ─── Pose ───────────────────────────────────────────────────────────────────

export interface BlobPose {
  /** Horizontal / vertical body scale (squash & stretch). */
  sx: number;
  sy: number;
  /** Pixels above the ground. */
  lift: number;
  eye: EyeState;
  mouth: MouthState;
  /** Gaze, -1 (left) … 1 (right). */
  look: number;
  /** Horizontal offset (lunges, recoils). */
  dx?: number;
  /** White hit-flash, 0..1. */
  flash?: number;
  /** Desaturate (knocked out). */
  ko?: boolean;
}

export interface BlobOptions {
  rarity?: Rarity;
  shiny?: boolean;
  seed?: number;
  /** Start times (seconds) of happy-bounces. */
  bounces?: readonly number[];
  /** Paint a sky + ground behind the buddy (otherwise transparent). */
  backdrop?: boolean;
  /** Play one of the shared motion-library animations (H1) instead of idle;
   *  `t` is then the time since the animation started. */
  anim?: "idle" | "walk" | "attack" | "hit" | "ko" | "victory";
  /** Body palette override (stand-in foes); `shiny` is ignored when set. */
  palette?: BodyPalette;
}

/** Deterministic 0–1 value for (seed, slot, channel). */
function rand(seed: number, slot: number, channel = 0): number {
  return mulberry32((seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0)();
}

const BLINK_SLOT = 3.6;
const LOOK_SLOT = 5;

/** Eye state from blinks alone: one blink per slot, sometimes a double. */
export function blinkAt(t: number, seed: number): EyeState {
  const slot = Math.floor(t / BLINK_SLOT);
  const start = slot * BLINK_SLOT + 0.4 + rand(seed, slot) * 2.6;
  const stage = (dt: number): EyeState | null =>
    dt < 0 || dt >= 0.18 ? null : dt < 0.04 ? "half" : dt < 0.13 ? "closed" : "half";
  const first = stage(t - start);
  if (first) return first;
  if (rand(seed, slot, 1) < 0.25) return stage(t - start - 0.28) ?? "open";
  return "open";
}

function lookAt(t: number, seed: number): number {
  const dirs = [-1, 0, 0, 1, 0];
  const slot = Math.floor(t / LOOK_SLOT);
  const dir = (s: number) => dirs[Math.floor(rand(seed, s, 2) * dirs.length)];
  const k = easeInOutCubic(span(t - slot * LOOK_SLOT, 0, 0.35));
  return lerp(dir(slot - 1), dir(slot), k);
}

export function blobPose(t: number, opts: BlobOptions = {}): BlobPose {
  const seed = opts.seed ?? 1;
  const breath = Math.sin((2 * Math.PI * t) / 2.6);
  let sx = 1 - 0.025 * breath;
  let sy = 1 + 0.035 * breath;
  let lift = 0;
  let eye = blinkAt(t, seed);
  let mouth: MouthState = "smile";

  const start = [...(opts.bounces ?? [])].filter((b) => b <= t && t - b < BOUNCE_SECONDS).pop();
  if (start !== undefined) {
    const u = t - start;
    let bx = 1;
    let by = 1;
    if (u < 0.14) {
      // anticipation: crouch
      const k = easeOutCubic(u / 0.14);
      by = lerp(1, 0.8, k);
      bx = lerp(1, 1.16, k);
    } else if (u < 0.46) {
      // launch: stretched, slowing toward the apex
      const k = easeOutCubic(span(u, 0.14, 0.46));
      lift = JUMP * k;
      by = lerp(1.18, 1, k);
      bx = lerp(0.88, 1, k);
    } else if (u < 0.72) {
      // fall: accelerate, stretch into the landing
      const k = easeInCubic(span(u, 0.46, 0.72));
      lift = JUMP * (1 - k);
      by = lerp(1, 1.12, k);
      bx = lerp(1, 0.92, k);
    } else {
      // land: squash, then jelly-wobble back to rest
      const w = 0.22 * springDecay(u - 0.72, 2.6, 6);
      by = 1 - w;
      bx = 1 + w * 0.8;
    }
    sx *= bx;
    sy *= by;
    if (u > 0.1 && u < 0.95) eye = "happy";
    if (u > 0.14 && u < 0.72) mouth = "open";
  }
  const pose: BlobPose = { sx, sy, lift, eye, mouth, look: lookAt(t, seed) };
  return opts.anim && opts.anim !== "idle" ? animate(pose, opts.anim, t) : pose;
}

/** The shared animation set on the blob's jelly body (same timings as
 *  motion.ts ANIM_INFO, so a blob and a rig stay in sync in one fight). */
function animate(p: BlobPose, anim: NonNullable<BlobOptions["anim"]>, t: number): BlobPose {
  switch (anim) {
    case "walk": {
      const u = (t % 0.7) / 0.7;
      const hop = Math.sin(Math.PI * u);
      const land = u < 0.12 ? 1 - u / 0.12 : 0;
      return { ...p, lift: 3 * hop, sx: p.sx * (1 + 0.1 * land - 0.04 * hop), sy: p.sy * (1 - 0.1 * land + 0.06 * hop) };
    }
    case "attack": {
      let dx = 0;
      let sx = 1;
      let sy = 1;
      if (t < 0.28) {
        const k = easeOutCubic(t / 0.28);
        dx = -3 * k;
        sx = 1 + 0.12 * k;
        sy = 1 - 0.14 * k;
      } else if (t < 0.36) {
        const k = easeInCubic(span(t, 0.28, 0.36));
        dx = lerp(-3, 10, k);
        sx = lerp(1.12, 1.22, k);
        sy = lerp(0.86, 0.82, k);
      } else if (t < 0.5) {
        dx = 10 - 1.5 * Math.sin(Math.PI * span(t, 0.36, 0.5));
        sx = 1.18;
        sy = 0.86;
      } else {
        const k = easeInOutCubic(span(t, 0.5, 0.85));
        dx = lerp(10, 0, k);
        const w = 0.12 * springDecay(t - 0.5, 2.6, 6);
        sx = 1 + w;
        sy = 1 - w;
      }
      return { ...p, dx, sx: p.sx * sx, sy: p.sy * sy, eye: "angry", mouth: t > 0.26 && t < 0.6 ? "open" : "frown" };
    }
    case "hit": {
      const k = t < 0.07 ? easeOutCubic(t / 0.07) : springDecay(t - 0.07, 2.4, 7);
      return {
        ...p,
        dx: -5 * k,
        sx: p.sx * (1 + 0.16 * k),
        sy: p.sy * (1 - 0.16 * k),
        flash: t < 0.12 ? 1 - t / 0.12 : 0,
        eye: t < 0.32 ? "closed" : "half",
        mouth: "frown",
      };
    }
    case "ko": {
      if (t < 0.15) return animate(p, "hit", t);
      const k = easeInCubic(span(t, 0.15, 0.7));
      const w = t > 0.7 ? 0.08 * springDecay(t - 0.7, 2.2, 6) : 0;
      return { ...p, sx: 1 + 0.28 * k - w, sy: 1 - 0.38 * k + w, lift: 0, eye: "x", mouth: "frown", ko: t > 0.6 };
    }
    case "victory": {
      const cycle = 1.1;
      const start = Math.floor(t / cycle) * cycle;
      return { ...blobPose(t, { bounces: [start] }), look: 0, eye: "happy" };
    }
  }
  return p;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** 4×4 Bayer thresholds in (0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const LIGHT = norm([-0.5, -0.72, 0.5]);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const WHITE = hex("#ffffff");
const smooth = (a: number, b: number, x: number) => {
  const k = span(x, a, b);
  return k * k * (3 - 2 * k);
};

function drawBody(fb: Framebuffer, pose: BlobPose, pal: BodyPalette, rim: RGBA | null): { cx: number; cy: number; rx: number; ry: number } {
  const rx = RX * pose.sx;
  const ry = RY * pose.sy;
  const cx = CX + (pose.dx ?? 0);
  const cy = GROUND - pose.lift - ry;
  const layer = new Framebuffer(fb.width, fb.height);
  const top = pal.ramp.length - 1;

  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      // Dome on top, flatter jelly base below.
      const p = dy > 0 ? 2.7 : 2;
      const d = Math.pow(Math.pow(Math.abs(dx), p) + Math.pow(Math.abs(dy), p), 1 / p);
      if (d > 1) continue;

      const n = norm([dx, dy * 0.9, Math.sqrt(Math.max(0, 1 - Math.min(1, dx * dx + dy * dy))) + 0.15]);
      const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const shade = Math.min(1, 0.22 + 0.9 * lambert);

      // Quantize to the ramp; dither only a narrow band between steps.
      const v = shade * top;
      const lo = Math.floor(v);
      const frac = v - lo;
      const threshold = 0.5 + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.45;
      let c = pal.ramp[Math.min(top, frac > threshold ? lo + 1 : lo)];

      // Ground bounce light on the underside.
      if (n[1] > 0.3) c = mix(c, pal.bounce, 0.35 * smooth(0.3, 0.9, n[1]));
      // Rarity rim light from behind-right.
      if (rim) c = mix(c, rim, 0.85 * smooth(0.74, 0.97, d) * Math.max(0, n[0] * 0.75 + n[1] * 0.25 + 0.15));
      // Glossy specular spot.
      const spec = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 40);
      if (spec > 0.7) c = WHITE;
      else if (spec > 0.42) c = mix(c, WHITE, 0.45);

      layer.set(x, y, c);
    }
  }

  // Sel-out: outline pixels take a darkened tone of the body they border.
  const solid = (x: number, y: number) => layer.get(x, y)[3] > 0;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      if (solid(x, y)) continue;
      const nbrs = [layer.get(x - 1, y), layer.get(x + 1, y), layer.get(x, y - 1), layer.get(x, y + 1)].filter((c) => c[3] > 0);
      if (!nbrs.length) continue;
      const avg: RGBA = [0, 1, 2, 3].map((k) => Math.round(nbrs.reduce((s, c) => s + c[k], 0) / nbrs.length)) as unknown as RGBA;
      fb.set(x, y, mix(avg, pal.outline, 0.72));
    }
  }
  fb.draw(layer, 0, 0);
  return { cx, cy, rx, ry };
}

/** Soft additive glow blob (aura, motes). */
export function glow(fb: Framebuffer, cx: number, cy: number, r: number, c: RGBA, strength: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) fb.add(x, y, c, strength * (1 - d) * (1 - d));
    }
  }
}

export function motes(fb: Framebuffer, t: number, seed: number, count: number, c: RGBA, front: boolean): void {
  const RANGE = 42;
  for (let i = 0; i < count; i++) {
    if ((i % 2 === 0) !== front) continue;
    const speed = 6 + rand(seed, i, 3) * 6;
    const travel = (t * speed + rand(seed, i, 4) * RANGE) % RANGE;
    const f = travel / RANGE;
    const x = CX - 24 + rand(seed, i, 5) * 48 + Math.sin(t * 1.3 + i * 1.7) * 2;
    const y = GROUND - 2 - travel;
    const a = Math.sin(Math.PI * f);
    glow(fb, x, y, 3.2, c, 0.55 * a);
    fb.add(Math.floor(x), Math.floor(y), c, a);
  }
}

/** Four-point star that grows and fades over its 0.5 s life. */
function twinkle(fb: Framebuffer, t: number, seed: number, body: { cx: number; cy: number; rx: number; ry: number }): void {
  const SLOT = 2.2;
  const slot = Math.floor(t / SLOT);
  const life = (t - slot * SLOT - rand(seed, slot, 6) * 1.2) / 0.5;
  if (life < 0 || life > 1) return;
  const ang = -Math.PI * (0.1 + rand(seed, slot, 7) * 0.6);
  const x = Math.round(body.cx + Math.cos(ang) * body.rx * 0.9);
  const y = Math.round(body.cy + Math.sin(ang) * body.ry * 0.9);
  const size = Math.round(Math.sin(Math.PI * life) * 3);
  const white = hex("#ffffff");
  fb.set(x, y, white);
  for (let k = 1; k <= size; k++) {
    const a = 1 - k / (size + 1);
    for (const [ox, oy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) fb.add(x + ox, y + oy, white, a);
  }
}

export function backdrop(fb: Framebuffer, t: number, seed: number): void {
  fb.gradient(hex("#1a1440"), hex("#5a3a78"));
  // twinkling stars
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rand(seed, i, 8) * fb.width);
    const y = Math.floor(rand(seed, i, 9) * (GROUND - 18));
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * (0.8 + rand(seed, i, 10) * 1.5) + i));
    fb.add(x, y, hex("#fff6d0"), a * 0.8);
  }
  // ground: two-tone with a dithered seam
  const g1 = hex("#2c5a3a");
  const g2 = hex("#1c3a28");
  for (let y = GROUND; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const deep = y - GROUND > 2 || (y - GROUND === 2 && (x + y) % 2 === 0);
      fb.set(x, y, deep ? g2 : g1);
    }
  }
  for (let x = 0; x < fb.width; x++) fb.set(x, GROUND, hex("#4c8a52"));
}

/** Render one frame of the HD blob at time `t` (seconds). */
export function renderBlob(t: number, opts: BlobOptions = {}): Framebuffer {
  const seed = opts.seed ?? 1;
  const rarity = opts.rarity ?? "common";
  const pal = opts.palette ?? (opts.shiny ? SHINY : MINT);
  const pose = blobPose(t, opts);
  const fb = new Framebuffer(BLOB_W, BLOB_H);

  if (opts.backdrop) backdrop(fb, t, seed);

  // Legendary aura: a slow golden pulse behind the body.
  if (rarity === "legendary") {
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.2);
    glow(fb, CX, GROUND - pose.lift - RY, 28, RIM_BLOB.legendary!, 0.45 * pulse);
  }

  // Contact shadow shrinks and fades as the body rises.
  const h = pose.lift / JUMP;
  fb.ellipse(CX + (pose.dx ?? 0), GROUND + 0.5, 19 * pose.sx * (1 - 0.35 * h), 2.6 * (1 - 0.3 * h), hex("#0c0818"), 0.42 * (1 - 0.5 * h));

  const moteCount = rarity === "legendary" ? 8 : rarity === "epic" ? 5 : 0;
  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], false);

  const body = drawBody(fb, pose, pal, RIM_BLOB[rarity]);

  // Face rides the body: positions scale with squash, gaze shifts it.
  const gaze = Math.round(pose.look * 1.6);
  const eyeY = Math.round(body.cy - body.ry * 0.12);
  const eyeDX = Math.round(body.rx * 0.36);
  for (const side of [-1, 1]) {
    fb.ellipse(body.cx + side * body.rx * 0.6 + gaze * 0.5, eyeY + 5.5, 3.2, 1.6, pal.blush, 0.4);
    blit(fb, EYE[pose.eye], body.cx + side * eyeDX - 3 + gaze, eyeY - 4);
  }
  const m = MOUTH[pose.mouth];
  blit(fb, m, body.cx - Math.floor(m.width / 2) + Math.round(pose.look), eyeY + 3);

  if (moteCount) motes(fb, t, seed, moteCount, SPARK[rarity], true);
  if (opts.shiny) twinkle(fb, t, seed, body);
  if (pose.flash || pose.ko) {
    const white = hex("#ffffff");
    for (let y = 0; y < fb.height; y++) {
      for (let x = 0; x < fb.width; x++) {
        let c = fb.get(x, y);
        if (!c[3] || (opts.backdrop && y >= GROUND)) continue;
        if (pose.ko) {
          const g = Math.round(c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15);
          c = mix(c, [g, g, g, c[3]], 0.45);
        }
        if (pose.flash) c = mix(c, [white[0], white[1], white[2], c[3]], pose.flash * 0.85);
        fb.set(x, y, c);
      }
    }
  }
  return fb;
}
