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

// ─── Weather and ambient fields (H4 diorama) ────────────────────────────────
//
// A burst lives a second; a field lives forever: rain over the whole panel,
// snow, falling leaves or petals, twinkles, rising embers and bubbles,
// fireflies. Same rules as bursts — closed form in `t`, seeded, no state —
// plus one more: every field repeats exactly every FIELD_LOOP seconds (each
// particle makes a whole number of trips per loop), so the kitty tier can
// upload one loop of frames and let the terminal play it.

export const FIELD_KINDS = ["rain", "snow", "leaves", "sparkles", "embers", "bubbles", "fireflies"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Every field is periodic with this period (seconds). */
export const FIELD_LOOP = 6;

export interface Field {
  kind: FieldKind;
  seed: number;
  /** Count multiplier (1 = the kind's normal density). */
  density?: number;
  colors?: readonly RGBA[];
  /** Horizontal drift per trip, as a fraction of the height (rain slant, leaf wind). */
  wind?: number;
}

interface FieldSpec {
  /** Particles per scene unit of width, at a reference height of 18 units. */
  perUnit: number;
  /** Whole trips per loop: [min, max]. 0 = stationary (twinkles, fireflies). */
  trips: [number, number];
  /** Rises instead of falls. */
  up?: boolean;
  /** Side-to-side sway amplitude, in units. */
  sway: number;
  colors: readonly RGBA[];
  glow: boolean;
  wind: number;
}

const FIELD: Record<FieldKind, FieldSpec> = {
  rain: { perUnit: 1.3, trips: [10, 13], sway: 0, colors: ["#d0e0ff", "#a8c0e8", "#e8f0ff"].map(hex), glow: false, wind: 0.18 },
  snow: { perUnit: 1.1, trips: [1, 2], sway: 1.4, colors: ["#ffffff", "#e8f0ff", "#d0dcf0"].map(hex), glow: false, wind: 0.1 },
  leaves: { perUnit: 0.12, trips: [1, 1], sway: 2.6, colors: ["#e0902a", "#c8582a", "#e8c040", "#a8682a"].map(hex), glow: false, wind: -0.6 },
  sparkles: { perUnit: 0.22, trips: [0, 0], sway: 0, colors: ["#ffffff", "#fff2b0", "#c8e8ff"].map(hex), glow: true, wind: 0 },
  embers: { perUnit: 0.16, trips: [1, 2], up: true, sway: 1.2, colors: ["#fff0a0", "#ffb040", "#ff6020", "#c02810"].map(hex), glow: true, wind: 0.15 },
  bubbles: { perUnit: 0.09, trips: [1, 2], up: true, sway: 0.8, colors: ["#e0f8ff", "#a0e0f8", "#70c0e8"].map(hex), glow: false, wind: 0 },
  fireflies: { perUnit: 0.06, trips: [0, 0], sway: 0, colors: ["#f0ff90", "#c8f060", "#fff8c0"].map(hex), glow: true, wind: 0 },
};

export interface FieldParticle extends Particle {
  /** Rain: streak length in pixels, and its horizontal slant per pixel of fall. */
  len?: number;
  slant?: number;
}

/** Every particle of a field at time `t` on a `w`×`h` canvas whose scene unit is `unit` px. */
export function fieldAt(f: Field, w: number, h: number, t: number, unit: number): FieldParticle[] {
  const spec = FIELD[f.kind];
  const colors = f.colors ?? spec.colors;
  const rng = mulberry32((f.seed ^ Math.imul(FIELD_KINDS.indexOf(f.kind) + 11, 0x85ebca6b)) >>> 0);
  const n = Math.max(1, Math.round(spec.perUnit * (w / unit) * (h / unit / 18) * (f.density ?? 1)));
  const u = (((t % FIELD_LOOP) + FIELD_LOOP) % FIELD_LOOP) / FIELD_LOOP; // loop phase 0..1
  const TAU = Math.PI * 2;
  const wind = (f.wind ?? spec.wind) * h;
  const out: FieldParticle[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = rng() * w;
    const y0 = rng();
    const ph = rng();
    const trips = spec.trips[0] + Math.floor(rng() * (spec.trips[1] - spec.trips[0] + 1));
    const swayK = 1 + Math.floor(rng() * 3);
    const near = rng(); // depth: near particles are bigger and brighter
    const color = colors[Math.floor(rng() * colors.length)];
    const pulseK = 1 + Math.floor(rng() * 3);
    const big = near > 0.72;
    if (f.kind === "sparkles") {
      const a = Math.max(0, Math.sin(TAU * (pulseK * u + ph))) ** 6;
      if (a < 0.05) continue;
      out.push({ x: x0, y: y0 * h * 0.85, color, alpha: a, size: unit >= 2 ? Math.max(1, Math.round(unit * (big ? 0.5 : 0.3))) : 1, glow: true });
      continue;
    }
    if (f.kind === "fireflies") {
      const x = x0 + Math.sin(TAU * (swayK * u + ph)) * 3 * unit;
      const y = h * (0.35 + 0.5 * y0) + Math.sin(TAU * (pulseK * u + near)) * 1.5 * unit;
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(TAU * (pulseK * u + ph * 2))) ** 2;
      out.push({ x: ((x % w) + w) % w, y, color, alpha: a, size: 1, glow: true });
      continue;
    }
    const margin = Math.max(2, unit * 3);
    const span = h + margin * 2;
    const frac = (((trips * u + ph) % 1) + 1) % 1; // trip progress 0..1
    let y = frac * span - margin;
    if (spec.up) y = h + margin - frac * span;
    let x = x0 + wind * frac + Math.sin(TAU * (swayK * u + ph)) * spec.sway * unit;
    x = ((x % w) + w) % w;
    const p: FieldParticle = { x, y, color, alpha: 0.55 + 0.45 * near, size: 1, glow: spec.glow };
    if (f.kind === "rain") {
      p.len = Math.max(2, Math.round(unit * (big ? 3 : 2)));
      p.slant = f.wind ?? spec.wind;
      p.alpha = 0.45 + 0.45 * near;
    } else if (f.kind === "snow" || f.kind === "leaves") {
      p.size = Math.max(1, Math.round(unit * (big ? 0.8 : 0.45)));
      if (f.kind === "leaves") {
        // Flutter: show the pale underside half the time.
        if (Math.sin(TAU * (swayK * 2 * u + ph)) > 0.3) p.color = mix(color, hex("#fff0c0"), 0.35);
        p.size = Math.max(1, Math.round(unit * 0.55));
      }
    } else if (f.kind === "embers") {
      p.alpha = (spec.up ? frac : 1 - frac) < 0.15 ? 0 : 1 - frac * 0.8;
      p.color = mix(colors[0], colors[colors.length - 1], frac);
      p.size = Math.max(1, Math.round(unit * 0.3));
    } else if (f.kind === "bubbles") {
      p.size = Math.max(1, Math.round(unit * (big ? 0.6 : 0.35)));
      p.alpha = 0.5 + 0.3 * near;
    }
    out.push(p);
  }
  return out;
}

/** Draw a field at time `t`. */
export function drawField(fb: Framebuffer, f: Field, t: number, unit: number, opacity = 1): void {
  for (const p of fieldAt(f, fb.width, fb.height, t, unit)) {
    const a = p.alpha * opacity;
    if (a <= 0) continue;
    const x0 = Math.round(p.x);
    const y0 = Math.round(p.y);
    if (p.len) {
      // A streak trailing up-and-back from the drop's head.
      for (let k = 0; k < p.len; k++) {
        const fade = 1 - k / p.len;
        fb.blend(Math.round(p.x - (p.slant ?? 0) * k), y0 - k, p.color, a * fade);
      }
      continue;
    }
    if (f.kind === "bubbles" && p.size >= 2) {
      // A ring with a highlight reads as a bubble at pixel scale.
      for (let j = 0; j < p.size; j++) for (let i = 0; i < p.size; i++) {
        const edge = i === 0 || j === 0 || i === p.size - 1 || j === p.size - 1;
        fb.blend(x0 + i, y0 + j, p.color, a * (edge ? 1 : 0.25));
      }
      fb.add(x0 + 1, y0, hex("#ffffff"), a);
      continue;
    }
    for (let j = 0; j < p.size; j++) {
      for (let i = 0; i < p.size; i++) {
        if (p.glow) fb.add(x0 + i, y0 + j, p.color, a);
        else fb.blend(x0 + i, y0 + j, p.color, a);
      }
    }
    if (p.glow && (f.kind === "fireflies" || f.kind === "sparkles")) {
      // A soft cross of light around the core.
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) fb.add(x0 + ox * p.size, y0 + oy * p.size, p.color, a * 0.45);
    }
  }
}
