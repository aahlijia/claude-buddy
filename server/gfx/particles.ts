/**
 * Particles — a tiny seeded system for hit sparks, landing dust, heal motes,
 * poison bubbles and confetti (brainstorm §2).
 *
 * Pure and `t`-driven: an emitter is a plain description of a burst (where,
 * when, what kind, which seed) and every particle's position is computed in
 * closed form from the time since the burst, so any frame can be rendered
 * on its own, in any order, and two renders of the same `t` are identical.
 * No simulation state, no clock.
 */

import { mulberry32 } from "../engine.ts";
import { hex, mix, type Framebuffer, type RGBA } from "./framebuffer.ts";

export const PARTICLE_KINDS = ["spark", "dust", "heal", "bubble", "confetti"] as const;
export type ParticleKind = (typeof PARTICLE_KINDS)[number];

export interface Emitter {
  kind: ParticleKind;
  /** Burst origin, in pixels. */
  x: number;
  y: number;
  /** Burst time, in seconds on the same clock as `t`. */
  t0: number;
  seed: number;
  /** Particle count (defaults per kind). */
  count?: number;
  /** Horizontal bias: sparks fly away from the attacker (+1 right, −1 left). */
  dir?: number;
  /** Spread width for area emitters (confetti rains across it). */
  w?: number;
  /** Override the kind's palette (e.g. crit sparks in gold). */
  colors?: readonly RGBA[];
}

export interface Particle {
  x: number;
  y: number;
  color: RGBA;
  /** 0..1 opacity. */
  alpha: number;
  /** Square size in pixels. */
  size: number;
  /** Draw additively (light) instead of blending. */
  glow: boolean;
}

interface KindSpec {
  count: number;
  life: [number, number];
  speed: [number, number];
  /** Launch angle range in radians (0 = right, −π/2 = up). */
  angle: [number, number];
  gravity: number;
  drag: number;
  colors: readonly RGBA[];
  size: number;
  glow: boolean;
}

const SPEC: Record<ParticleKind, KindSpec> = {
  spark: {
    count: 10,
    life: [0.18, 0.38],
    speed: [45, 110],
    angle: [-1.25, 1.0],
    gravity: 140,
    drag: 5,
    colors: ["#ffffff", "#fff2a0", "#ffb040", "#ff6a30"].map(hex),
    size: 1,
    glow: true,
  },
  dust: {
    count: 7,
    life: [0.35, 0.7],
    speed: [10, 34],
    angle: [-Math.PI + 0.25, -0.25],
    gravity: -6,
    drag: 4,
    colors: ["#d8c8a8", "#a89878", "#786850"].map(hex),
    size: 2,
    glow: false,
  },
  heal: {
    count: 8,
    life: [0.6, 1.0],
    speed: [14, 26],
    angle: [-Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35],
    gravity: -10,
    drag: 1.5,
    colors: ["#ffffff", "#b8ffc8", "#58e07a", "#2a9a50"].map(hex),
    size: 1,
    glow: true,
  },
  bubble: {
    count: 5,
    life: [0.5, 0.9],
    speed: [8, 18],
    angle: [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5],
    gravity: -12,
    drag: 2,
    colors: ["#c8ffb0", "#7ad860", "#3c9a3a"].map(hex),
    size: 2,
    glow: false,
  },
  confetti: {
    count: 24,
    life: [1.2, 1.8],
    speed: [30, 55],
    angle: [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3],
    gravity: 30,
    drag: 1.2,
    colors: ["#ffd25a", "#ff6aa8", "#5ad8ff", "#7ee69a", "#c8a0ff"].map(hex),
    size: 2,
    glow: false,
  },
};

/** Longest a burst of this kind stays visible (seconds). */
export function particleLife(kind: ParticleKind): number {
  return SPEC[kind].life[1];
}

/** Closed-form drag: distance travelled after `dt` with initial speed `v`. */
function travel(v: number, drag: number, dt: number): number {
  return drag > 0 ? (v * (1 - Math.exp(-drag * dt))) / drag : v * dt;
}

/** Every live particle of one emitter at time `t` (pure). */
export function particlesAt(e: Emitter, t: number): Particle[] {
  const dt = t - e.t0;
  const spec = SPEC[e.kind];
  if (dt < 0 || dt > spec.life[1]) return [];
  const rng = mulberry32((e.seed ^ Math.imul(PARTICLE_KINDS.indexOf(e.kind) + 1, 0x9e3779b1)) >>> 0);
  const colors = e.colors ?? spec.colors;
  const out: Particle[] = [];
  const n = e.count ?? spec.count;
  for (let i = 0; i < n; i++) {
    // Draw every random number up front so particle i never depends on dt.
    const life = spec.life[0] + rng() * (spec.life[1] - spec.life[0]);
    const speed = spec.speed[0] + rng() * (spec.speed[1] - spec.speed[0]);
    let ang = spec.angle[0] + rng() * (spec.angle[1] - spec.angle[0]);
    const jitterX = (rng() - 0.5) * 2;
    const jitterY = (rng() - 0.5) * 2;
    const phase = rng() * Math.PI * 2;
    const delay = e.kind === "confetti" ? rng() * 0.5 : e.kind === "heal" ? rng() * 0.3 : 0;
    const ci = rng();
    const u = (dt - delay) / life;
    if (u < 0 || u > 1) continue;
    const tt = dt - delay;
    if (e.kind === "spark" && (e.dir ?? 0) < 0) ang = Math.PI - ang;
    let x = e.x + jitterX + Math.cos(ang) * travel(speed, spec.drag, tt);
    let y = e.y + jitterY + Math.sin(ang) * travel(speed, spec.drag, tt) + 0.5 * spec.gravity * tt * tt;
    if (e.kind === "confetti") {
      x = e.x + ((i + ci) / n) * (e.w ?? 0) + Math.sin(tt * 5 + phase) * 3;
      y = e.y + Math.sin(ang) * travel(speed, spec.drag, tt) + 0.5 * spec.gravity * tt * tt;
    } else if (e.kind === "heal" || e.kind === "bubble") {
      x += Math.sin(tt * 7 + phase) * 1.5;
    }
    // Color over life: walk the palette from hot to cool.
    const cpos = e.kind === "confetti" ? ci * (colors.length - 1) : u * (colors.length - 1);
    const lo = Math.floor(cpos);
    const color = e.kind === "confetti" ? colors[Math.round(cpos)] : mix(colors[lo], colors[Math.min(colors.length - 1, lo + 1)], cpos - lo);
    const alpha = e.kind === "confetti" ? Math.min(1, (1 - u) * 3) : 1 - u * u;
    const size = e.kind === "dust" ? (u < 0.5 ? 2 : 1) : spec.size;
    out.push({ x, y, color, alpha, size, glow: spec.glow });
  }
  return out;
}

/** Draw every emitter's live particles at time `t`. */
export function drawParticles(fb: Framebuffer, emitters: readonly Emitter[], t: number): void {
  for (const e of emitters) {
    for (const p of particlesAt(e, t)) {
      const x0 = Math.round(p.x);
      const y0 = Math.round(p.y);
      for (let j = 0; j < p.size; j++) {
        for (let i = 0; i < p.size; i++) {
          if (p.glow) fb.add(x0 + i, y0 + j, p.color, p.alpha);
          else fb.blend(x0 + i, y0 + j, p.color, p.alpha);
        }
      }
      // Hot sparks leave a one-pixel streak behind them.
      if (e.kind === "spark" && p.alpha > 0.4) fb.add(x0 - Math.sign(e.dir ?? 1), y0, p.color, p.alpha * 0.5);
    }
  }
}
