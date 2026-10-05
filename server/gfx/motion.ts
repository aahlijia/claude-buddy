/**
 * Motion library — the six core animations, written once against part
 * *roles* (body, head, ear, tail segment, wing, legs, eyes, mouth) so every
 * rigged species gets them for free (brainstorm §1.3, §2).
 *
 * Twelve principles in miniature: anticipation before the lunge, squash and
 * stretch on every contact, follow-through on tails and ears (each tail
 * segment lags the one before it), and springs instead of linear returns.
 *
 * Pure: `poseRig(rig, anim, t, seed)` is a function of its arguments.
 */

import { blinkAt } from "./blob.ts";
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, lerp, span, springDecay } from "./ease.ts";
import type { PartDef, PartPose, Pose, RigDef } from "./rig.ts";

export const ANIMS = ["idle", "walk", "attack", "hit", "ko", "victory"] as const;
export type Anim = (typeof ANIMS)[number];

export interface AnimInfo {
  /** Loops forever (idle/walk/victory) or plays once and holds (attack/hit/ko). */
  loop: boolean;
  /** Seconds per loop, or until the final pose. */
  duration: number;
  /** When the blow lands (attack): H2 hangs hit-stop, particles and the
   *  defender's hit reaction off this moment. */
  impact?: number;
}

export const ANIM_INFO: Record<Anim, AnimInfo> = {
  idle: { loop: true, duration: 2.6 },
  walk: { loop: true, duration: 0.7 },
  attack: { loop: false, duration: 0.85, impact: 0.36 },
  hit: { loop: false, duration: 0.55 },
  ko: { loop: false, duration: 1.1 },
  victory: { loop: true, duration: 1.1 },
};

const TAU = Math.PI * 2;

/** Mutable pose builder: accumulate per-part offsets by role. */
class Builder {
  readonly parts: Record<string, PartPose> = {};
  lift = 0;
  flash = 0;
  ko = false;
  constructor(readonly rig: RigDef) {}

  each(role: PartDef["role"], fn: (p: PartDef) => PartPose): void {
    for (const p of this.rig.parts) if (p.role === role) this.add(p.name, fn(p));
  }

  add(name: string, d: PartPose): void {
    const cur = (this.parts[name] ??= {});
    if (d.dx) cur.dx = (cur.dx ?? 0) + d.dx;
    if (d.dy) cur.dy = (cur.dy ?? 0) + d.dy;
    if (d.rot) cur.rot = (cur.rot ?? 0) + d.rot;
    if (d.sx !== undefined) cur.sx = (cur.sx ?? 1) * d.sx;
    if (d.sy !== undefined) cur.sy = (cur.sy ?? 1) * d.sy;
    if (d.variant) cur.variant = d.variant;
    if (d.hide) cur.hide = true;
  }

  body(d: PartPose): void {
    this.each("body", () => d);
  }

  face(eye: string, mouth: string): void {
    this.each("eye", () => ({ variant: eye }));
    this.each("mouth", () => ({ variant: mouth }));
  }

  build(): Pose {
    return { parts: this.parts, lift: this.lift, flash: this.flash, ko: this.ko };
  }
}

/** Seeded 0..1 for (seed, slot). */
function rnd(seed: number, slot: number): number {
  let a = (seed ^ Math.imul(slot + 7, 0x9e3779b1)) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Tail and wing follow-through: each segment lags its parent. */
function sway(b: Builder, t: number, amp: number, period: number, lag = 0.6): void {
  b.each("tail", (p) => ({ rot: amp * Math.sin((TAU * t) / period - (p.seg ?? 0) * lag) }));
}

/** Occasional quick ear twitch (seeded slots, ~0.12 s each). */
function earTwitch(b: Builder, t: number, seed: number): void {
  const SLOT = 3.1;
  const slot = Math.floor(t / SLOT);
  const at = slot * SLOT + rnd(seed, slot) * 2.4;
  const u = t - at;
  const which = rnd(seed, slot + 100) < 0.5 ? -1 : 1;
  if (u > 0 && u < 0.16) {
    const k = Math.sin((Math.PI * u) / 0.16);
    b.each("ear", (p) => (p.side === which ? { rot: -0.3 * k } : {}));
  }
}

function idle(b: Builder, t: number, seed: number): void {
  const br = Math.sin((TAU * t) / 2.6);
  b.body({ sx: 1 - 0.02 * br, sy: 1 + 0.03 * br, dy: -0.4 * br });
  b.each("head", () => ({ dy: -0.5 * Math.sin((TAU * t) / 2.6 - 0.6), rot: 0.03 * Math.sin((TAU * t) / 5.2) }));
  b.each("wing", () => ({ rot: -0.06 * (1 + br) }));
  sway(b, t, 0.12, 2.2);
  earTwitch(b, t, seed);
  b.face(blinkAt(t, seed), "smile");
}

function walk(b: Builder, t: number, seed: number): void {
  const p = (TAU * t) / ANIM_INFO.walk.duration;
  b.body({ dy: -1.2 * Math.abs(Math.sin(p)), rot: 0.03 * Math.sin(p) });
  b.each("legF", (q) => ({ rot: 0.45 * Math.sin(p + (q.side === 1 ? 0 : Math.PI)) }));
  b.each("legB", (q) => ({ rot: 0.45 * Math.sin(p + (q.side === 1 ? Math.PI : 0)) }));
  b.each("head", () => ({ dy: -0.7 * Math.abs(Math.sin(p - 0.5)) }));
  b.each("ear", () => ({ rot: 0.08 * Math.sin(2 * p) }));
  b.each("wing", () => ({ rot: -0.15 * (1 + Math.sin(2 * p)) }));
  sway(b, t, 0.18, 0.7, 0.8);
  b.face(blinkAt(t, seed), "smile");
}

function attack(b: Builder, t: number): void {
  const IMPACT = ANIM_INFO.attack.impact!;
  let dx = 0;
  let rot = 0;
  let sx = 1;
  let sy = 1;
  let reach = 0;
  if (t < 0.28) {
    // Anticipation: coil backward.
    const k = easeOutCubic(t / 0.28);
    dx = -3 * k;
    rot = -0.1 * k;
    sx = 1 - 0.06 * k;
    sy = 1 + 0.07 * k;
    reach = -0.35 * k;
  } else if (t < IMPACT) {
    // Lunge: fast, stretched.
    const k = easeInCubic(span(t, 0.28, IMPACT));
    dx = lerp(-3, 9, k);
    rot = lerp(-0.1, 0.14, k);
    sx = lerp(0.94, 1.14, k);
    sy = lerp(1.07, 0.9, k);
    reach = lerp(-0.35, -0.75, k);
  } else if (t < 0.5) {
    // Impact: hold the extension with a jolt.
    const k = span(t, IMPACT, 0.5);
    dx = 9 - 1.2 * Math.sin(Math.PI * k);
    rot = 0.14;
    sx = 1.08 - 0.08 * k;
    sy = 0.93 + 0.07 * k;
    reach = -0.75;
  } else {
    // Recover with a little overshoot.
    const k = easeInOutCubic(span(t, 0.5, ANIM_INFO.attack.duration));
    dx = lerp(9, 0, k) + 1.2 * Math.sin(Math.PI * k);
    rot = lerp(0.14, 0, k);
    reach = lerp(-0.75, 0, k);
  }
  b.body({ dx, rot, sx, sy });
  b.each("legF", () => ({ rot: reach }));
  b.each("legB", () => ({ rot: -reach * 0.5 }));
  b.each("head", () => ({ rot: rot * 0.6 }));
  b.each("ear", () => ({ rot: t < IMPACT ? -0.25 : -0.1 }));
  b.each("wing", () => ({ rot: t < IMPACT ? -0.5 * easeOutCubic(span(t, 0.1, IMPACT)) : -0.5 * (1 - span(t, 0.5, 0.85)) }));
  b.each("tail", (p) => ({ rot: (t < IMPACT ? 0.3 : -0.25) * (1 + (p.seg ?? 0) * 0.2) }));
  b.face("angry", t > 0.26 && t < 0.6 ? "open" : "frown");
}

function hit(b: Builder, t: number): void {
  b.flash = t < 0.12 ? 1 - t / 0.12 : 0;
  const k = t < 0.07 ? easeOutCubic(t / 0.07) : springDecay(t - 0.07, 2.4, 7);
  b.body({ dx: -5 * k, rot: -0.12 * k, sx: 1 + 0.1 * k, sy: 1 - 0.1 * k });
  b.each("head", () => ({ rot: -0.15 * k, dy: 1 * k }));
  b.each("ear", () => ({ rot: -0.5 * Math.max(0, k) }));
  b.each("wing", () => ({ rot: 0.3 * k }));
  b.each("tail", (p) => ({ rot: 0.35 * k * (1 + (p.seg ?? 0) * 0.15) }));
  b.face(t < 0.32 ? "closed" : "half", "frown");
}

function ko(b: Builder, t: number): void {
  if (t < 0.15) return hit(b, t);
  const fall = easeInCubic(span(t, 0.15, 0.7));
  const settle = t > 0.7 ? springDecay(t - 0.7, 2.2, 6) : 0;
  b.body({ dy: 3 * fall - 1.2 * settle, sy: 1 - 0.18 * fall + 0.06 * settle, sx: 1 + 0.08 * fall, rot: -0.08 * fall });
  b.each("head", () => ({ rot: 0.55 * fall, dy: 3 * fall }));
  b.each("legF", (p) => ({ rot: (p.side === 1 ? -0.9 : 0.6) * fall }));
  b.each("legB", (p) => ({ rot: (p.side === 1 ? 0.9 : -0.6) * fall }));
  b.each("ear", () => ({ rot: -0.7 * fall }));
  b.each("wing", () => ({ rot: 0.6 * fall }));
  b.each("tail", (p) => ({ rot: 0.25 * fall * (1 + (p.seg ?? 0) * 0.1) }));
  b.ko = t > 0.6;
  b.face("x", "frown");
}

function victory(b: Builder, t: number): void {
  const u = t % ANIM_INFO.victory.duration;
  let lift = 0;
  let sx = 1;
  let sy = 1;
  if (u < 0.15) {
    const k = easeOutCubic(u / 0.15);
    sy = 1 - 0.12 * k;
    sx = 1 + 0.1 * k;
  } else if (u < 0.6) {
    const k = span(u, 0.15, 0.6);
    lift = 8 * Math.sin(Math.PI * k);
    sy = 1 + 0.12 * (1 - k) * (k < 0.5 ? 1 : 0.3);
    sx = 1 - 0.08 * (1 - k);
  } else {
    const w = 0.14 * springDecay(u - 0.6, 2.6, 6);
    sy = 1 - w;
    sx = 1 + w * 0.8;
  }
  b.lift = lift;
  b.body({ dy: -lift, sx, sy });
  const air = lift > 0.5;
  b.each("legF", () => ({ rot: air ? -0.5 : 0 }));
  b.each("legB", () => ({ rot: air ? 0.4 : 0 }));
  b.each("head", () => ({ rot: -0.08 * easeOutBack(Math.min(1, lift / 8)) }));
  b.each("ear", (p) => ({ rot: 0.12 * (p.side ?? 1) }));
  b.each("wing", () => ({ rot: -0.7 * Math.abs(Math.sin((TAU * u) / 0.55)) }));
  b.each("tail", (p) => ({ rot: 0.35 * Math.sin((TAU * u) / 0.3 - (p.seg ?? 0) * 0.5) }));
  b.face("happy", "open");
}

/** The pose of `rig` playing `anim` at `t` seconds. */
export function poseRig(rig: RigDef, anim: Anim, t: number, seed = 1): Pose {
  const info = ANIM_INFO[anim];
  const tt = info.loop ? t : Math.min(Math.max(0, t), info.duration);
  const b = new Builder(rig);
  switch (anim) {
    case "idle":
      idle(b, tt, seed);
      break;
    case "walk":
      walk(b, tt, seed);
      break;
    case "attack":
      attack(b, tt);
      break;
    case "hit":
      hit(b, tt);
      break;
    case "ko":
      ko(b, tt);
      break;
    case "victory":
      victory(b, tt);
      break;
  }
  return b.build();
}
