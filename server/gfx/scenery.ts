/**
 * Scenery strokes for the diorama (H4, docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 * A biome is data (biomes.ts); this module paints it. Everything is measured
 * in scene *units* (`u` pixels each; the panel is always 18 units tall), so
 * one biome description renders crisply at every tier: 1 px per unit in
 * half-blocks, 4 px per unit in kitty. Strokes are drawn in *world* x, so a
 * layer can be panned (parallax) by any number of pixels and stays seamless:
 * ridges are seeded noise, prop rows are seeded per slot.
 */

import { Framebuffer, hex, mix, type RGBA } from "./framebuffer.ts";
import { shade, type Light } from "./sky.ts";

/** Scene height in units (the panel is always 18 units tall). */
export const SCENE_UNITS = 18;
/** Where the sky meets the land (units from the top). */
export const HORIZON = 14.5;
/** The buddy's feet (units from the top). */
export const FEET = 16.2;

export interface Geo {
  w: number;
  h: number;
  /** Pixels per unit. */
  u: number;
  /** World-x of the left screen edge, in pixels (parallax pan). */
  pan: number;
  /** The screen width landmarks are placed against (`w` may be a wider strip). */
  world: number;
}

export function geo(w: number, h: number, pan = 0): Geo {
  return { w, h, u: h / SCENE_UNITS, pan, world: w };
}

// ─── Seeded noise ───────────────────────────────────────────────────────────

/** 0..1 hash of (seed, i, salt), stable across runs. */
export function rand(seed: number, i: number, salt: number): number {
  let h = (seed ^ Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 1D value noise in 0..1: smooth (cosine) or jagged (linear) between knots. */
function noise(seed: number, x: number, jag: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand(seed, i, 1);
  const b = rand(seed, i + 1, 1);
  const smooth = (1 - Math.cos(Math.PI * f)) / 2;
  const k = jag * f + (1 - jag) * smooth;
  return a + (b - a) * k;
}

function ridgeHeight(seed: number, x: number, jag: number): number {
  return 0.65 * noise(seed, x, jag) + 0.35 * noise(seed + 7, x * 2.3, Math.min(1, jag + 0.2));
}

// ─── Strokes ────────────────────────────────────────────────────────────────

export type TreeKind =
  | "round" | "pine" | "blossom" | "dead" | "cactus" | "lollipop" | "kelp" | "coral"
  | "palm" | "grave" | "pillar" | "crystal" | "lamp" | "rock" | "mushroom" | "snowpine" | "code";

export type Stroke =
  /** A mountain/hill/dune silhouette standing on the horizon. */
  | { type: "ridge"; base: number; amp: number; scale: number; jag: number; color: string; cap?: string; capAt?: number; rim?: string }
  /** City blocks with windows that light up at night (always lit if `neon`). */
  | { type: "skyline"; minH: number; maxH: number; minW: number; maxW: number; color: string; windows: string; neon?: boolean; base?: number }
  /** A row of props on the horizon, one per `spacing` units (with jitter). */
  | { type: "props"; kind: TreeKind; spacing: number; size: number; colors: readonly string[]; odds?: number; base?: number }
  /** A sea band from the horizon down `depth` units, with glints. */
  | { type: "water"; depth: number; color: string; deep: string; glint: string; top?: number }
  /** Cloud banks at height `y` (units from the top). */
  | { type: "clouds"; y: number; size: number; spacing: number; color: string; shade: string }
  /** Slanted light shafts (underwater, cloud kingdom), daylight only. */
  | { type: "rays"; color: string; spacing: number }
  /** One big mountain at `at` of the world width: snow cap or a glowing crater. */
  | { type: "peak"; at: number; height: number; width: number; color: string; cap?: string; capAt?: number; lava?: string }
  /** A planet hanging in the sky (space), with an optional ring. */
  | { type: "planet"; at: number; y: number; r: number; color: string; shadow: string; ring?: string };

export type GroundTexture = "grass" | "sand" | "snow" | "stone" | "stripes" | "grid" | "cloud" | "crater" | "moss" | "street" | "magma";

export interface Ground {
  /** Lit edge, body, deep. */
  colors: readonly [string, string, string];
  texture: GroundTexture;
  /** Speck colors for the texture (tufts, pebbles, sparkles). */
  specks: readonly string[];
}

/** One structure op, in units: x from the structure's left foot, `top` = units above the ground line. */
export type Op =
  | ["rect", number, number, number, number, string]
  /** Isosceles roof: apex at (x + w/2, top), base `h` lower. */
  | ["roof", number, number, number, number, string]
  /** A window: dark glass by day, warm light at night (with a halo). */
  | ["win", number, number, number, number]
  /** Always-lit emissive rect (neon, lava, crystal). */
  | ["neon", number, number, number, number, string]
  /** Filled disc centered at (cx, cy above ground). */
  | ["disc", number, number, number, string]
  /** Half disc sitting on `base` (domes, igloos). */
  | ["dome", number, number, number, string]
  /** A lighthouse beam fanning from (cx, cy), night only. */
  | ["beam", number, number, string];

export interface Structure {
  /** Left foot position as a fraction of the world width. */
  at: number;
  ops: readonly Op[];
}

// ─── Painting helpers ───────────────────────────────────────────────────────

const C = (s: string) => hex(s);

function rectPx(fb: Framebuffer, x0: number, y0: number, x1: number, y1: number, c: RGBA, alpha = 1): void {
  const xa = Math.max(0, Math.round(x0));
  const xb = Math.min(fb.width, Math.round(x1));
  const ya = Math.max(0, Math.round(y0));
  const yb = Math.min(fb.height, Math.round(y1));
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) alpha >= 1 ? fb.set(x, y, c) : fb.blend(x, y, c, alpha);
}

function discPx(fb: Framebuffer, cx: number, cy: number, r: number, c: RGBA, top = false): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    if (top && y + 0.5 > cy) continue;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) fb.set(x, y, c);
    }
  }
}

export function glowPx(fb: Framebuffer, cx: number, cy: number, r: number, c: RGBA, strength: number): void {
  if (strength <= 0 || r <= 0) return;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) fb.add(x, y, c, strength * (1 - d) * (1 - d));
    }
  }
}

const WARM = C("#ffd27a");
const GLASS = C("#2c3650");

// ─── Sky ────────────────────────────────────────────────────────────────────

export interface SkyOpts {
  sun: boolean;
  moon: boolean;
  /** Star density (0 = none). */
  stars: number;
  seed: number;
}

/** Gradient, stars, sun or moon. Screen-fixed (the sky never pans). */
export function paintSky(fb: Framebuffer, g: Geo, light: Light, o: SkyOpts): void {
  const hz = HORIZON * g.u;
  for (let y = 0; y < fb.height; y++) {
    const c = mix(light.top, light.horizon, Math.min(1, y / hz));
    for (let x = 0; x < fb.width; x++) fb.set(x, y, c);
  }
  const night = Math.max(light.phase.night, light.phase.dusk * 0.25);
  if (o.stars > 0 && night > 0.05) {
    const n = Math.round((o.stars * g.w * hz) / (g.u * g.u * 30));
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rand(o.seed, i, 21) * g.w);
      const y = Math.floor(rand(o.seed, i, 22) * hz * 0.85);
      const a = night * (0.35 + 0.65 * rand(o.seed, i, 23));
      fb.add(x, y, C("#fff6d8"), a);
      if (g.u >= 3 && rand(o.seed, i, 24) > 0.85) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) fb.add(x + dx, y + dy, C("#fff6d8"), a * 0.4);
      }
    }
  }
  const r = Math.max(1.2, 1.3 * g.u);
  if (o.sun && light.sun) {
    const sx = light.sun.x * g.w;
    const sy = light.sun.y * hz;
    const warm = light.phase.dusk;
    const core = mix(C("#fff4c8"), C("#ff9a50"), warm);
    glowPx(fb, sx, sy, r * 4, mix(C("#fff0b0"), C("#ff8040"), warm), 0.35);
    discPx(fb, sx, sy, r, core);
  }
  if (o.moon && light.moon) {
    const mx = light.moon.x * g.w;
    const my = light.moon.y * hz;
    glowPx(fb, mx, my, r * 3, C("#c8d8ff"), 0.18 * Math.max(light.phase.night, 0.3));
    discPx(fb, mx, my, r, C("#eef0ff"));
    // Crescent: a disc of sky color bites the moon.
    discPx(fb, mx + r * 0.55, my - r * 0.25, r * 0.85, mix(light.top, light.horizon, my / hz));
  }
}

// ─── Strokes ────────────────────────────────────────────────────────────────

/** Paint strokes in world space (pannable) onto a transparent or sky layer. */
export function paintStrokes(fb: Framebuffer, g: Geo, light: Light, strokes: readonly Stroke[], haze: number, seed: number): void {
  strokes.forEach((s, k) => paintStroke(fb, g, light, s, haze, (seed + k * 7919) >>> 0));
}

function paintStroke(fb: Framebuffer, g: Geo, light: Light, s: Stroke, haze: number, seed: number): void {
  const { u } = g;
  const hz = HORIZON * u;
  const lit = (c: string, extra = 0) => shade(C(c), light, Math.min(1, haze + extra));
  switch (s.type) {
    case "ridge": {
      const body = lit(s.color);
      const cap = s.cap ? lit(s.cap) : null;
      const rim = s.rim ? lit(s.rim) : null;
      for (let x = 0; x < g.w; x++) {
        const wx = (x + g.pan) / u;
        const hU = s.base + s.amp * ridgeHeight(seed, wx / s.scale, s.jag);
        const top = hz - hU * u;
        for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(hz + u); y++) {
          const depth = (y - top) / u;
          let c = body;
          if (cap && hU - depth > (s.capAt ?? s.base + s.amp * 0.6)) c = cap;
          else if (rim && depth < 0.6) c = rim;
          fb.set(x, y, c);
        }
      }
      return;
    }
    case "skyline": {
      const base = hz - (s.base ?? 0) * u;
      const body = lit(s.color);
      // Slots of maxW units; each holds one building of seeded width/height.
      const slot = s.maxW;
      const first = Math.floor(g.pan / u / slot) - 1;
      const last = Math.ceil((g.pan + g.w) / u / slot) + 1;
      for (let i = first; i <= last; i++) {
        const bw = s.minW + rand(seed, i, 31) * (s.maxW - s.minW);
        const bh = s.minH + rand(seed, i, 32) * (s.maxH - s.minH);
        const bx = (i * slot + rand(seed, i, 33) * (slot - bw)) * u - g.pan;
        rectPx(fb, bx, base - bh * u, bx + bw * u, base + u, body);
        // Windows: a grid, each lit by its own threshold so the city wakes up
        // gradually. Below 2 px per unit a full grid is noise: go sparse.
        if (!s.windows) continue;
        const step = Math.max(2, Math.round(u * 1.2));
        const wsz = Math.max(1, Math.round(u * 0.5));
        const sparse = u < 2 ? 0.45 : 0;
        for (let wy = base - bh * u + step * 0.6; wy < base - step * 0.6; wy += step) {
          for (let wx = bx + step * 0.5; wx < bx + bw * u - step * 0.5; wx += step) {
            const r = rand(seed, i * 977 + Math.round(wx * 13 + wy * 7), 34);
            const on = s.neon ? r > 0.35 + sparse : r < light.lamps * (0.8 - sparse);
            if (!on && u < 2) continue;
            const wc = on ? C(s.windows) : mix(body, C("#000000"), 0.25);
            rectPx(fb, wx, wy, wx + wsz, wy + wsz, wc);
          }
        }
      }
      return;
    }
    case "props": {
      const first = Math.floor(g.pan / u / s.spacing) - 1;
      const last = Math.ceil((g.pan + g.w) / u / s.spacing) + 1;
      for (let i = first; i <= last; i++) {
        if (rand(seed, i, 41) > (s.odds ?? 1)) continue;
        const wx = (i + 0.2 + rand(seed, i, 42) * 0.6) * s.spacing;
        const size = s.size * (0.75 + rand(seed, i, 43) * 0.5);
        const x = wx * u - g.pan;
        const colors = s.colors.map((c) => lit(c));
        drawProp(fb, s.kind, x, hz - (s.base ?? 0) * u, size * u, colors, light, rand(seed, i, 44));
      }
      return;
    }
    case "water": {
      const top = hz - (s.top ?? 0) * u;
      const body = lit(s.color);
      const deep = lit(s.deep);
      const glint = lit(s.glint);
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(fb.height, top + s.depth * u); y++) {
        const k = (y - top) / (s.depth * u);
        const c = mix(body, deep, k);
        for (let x = 0; x < g.w; x++) {
          const wx = Math.floor((x + g.pan) / Math.max(1, u * 0.5));
          const row = Math.floor((y - top) / Math.max(1, u * 0.5));
          fb.set(x, y, rand(seed, wx * 31 + row, 51) > 0.93 ? glint : c);
        }
      }
      return;
    }
    case "clouds": {
      const first = Math.floor(g.pan / u / s.spacing) - 1;
      const last = Math.ceil((g.pan + g.w) / u / s.spacing) + 1;
      const body = lit(s.color, -haze * 0.5);
      const under = lit(s.shade, -haze * 0.5);
      for (let i = first; i <= last; i++) {
        const cx = ((i + rand(seed, i, 61)) * s.spacing) * u - g.pan;
        const cy = (s.y + (rand(seed, i, 62) - 0.5) * 1.5) * u;
        const r = s.size * (0.7 + rand(seed, i, 63) * 0.6) * u;
        // Three puffs and a flat belly.
        discPx(fb, cx - r * 0.9, cy + r * 0.25, r * 0.7, under);
        discPx(fb, cx + r * 0.9, cy + r * 0.25, r * 0.7, under);
        discPx(fb, cx, cy, r, body);
        discPx(fb, cx - r * 0.9, cy + r * 0.15, r * 0.62, body);
        discPx(fb, cx + r * 0.9, cy + r * 0.15, r * 0.62, body);
        rectPx(fb, cx - r * 1.5, cy + r * 0.5, cx + r * 1.5, cy + r * 0.85, under);
      }
      return;
    }
    case "peak": {
      const cx = s.at * g.world - g.pan;
      const body = lit(s.color);
      const cap = s.cap ? lit(s.cap) : null;
      const half = (s.width / 2) * u;
      const crater = s.lava ? s.height * 0.08 : 0;
      for (let x = Math.floor(cx - half); x < cx + half; x++) {
        const k = 1 - Math.abs(x + 0.5 - cx) / half; // 0 at the foot, 1 at the summit
        // Concave slopes, flattened at the top for a crater.
        const wx = x + g.pan;
        const hU = s.height * Math.min(1 - crater / s.height, k ** 1.6 + 0.02 * Math.sin(wx * 0.7));
        const top = hz - hU * u;
        for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(hz + u); y++) {
          const fromTop = (y - top) / u;
          let c = body;
          // A ragged snow line: the cap reaches a little lower on some columns.
          if (cap && hU - fromTop - (s.capAt ?? s.height * 0.7) > -rand(seed, Math.floor((x + g.pan) / Math.max(1, u)), 91) * 0.9) c = cap;
          if (s.lava && hU - fromTop > s.height * 0.75 && Math.abs(Math.sin(wx * 0.9 + y * 0.3)) < 0.18) c = C(s.lava);
          fb.set(x, y, c);
        }
      }
      if (s.lava) {
        const topY = hz - (s.height - crater) * u;
        glowPx(fb, cx, topY, u * 5, C(s.lava), 0.55);
        rectPx(fb, cx - u * 1.2, topY - 1, cx + u * 1.2, topY + Math.max(1, u * 0.4), C(s.lava));
      }
      return;
    }
    case "planet": {
      const cx = s.at * g.world - g.pan;
      const cy = s.y * u;
      const r = s.r * u;
      const body = C(s.color);
      const dark = C(s.shadow);
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = (x + 0.5 - cx) / r;
          const dy = (y + 0.5 - cy) / r;
          if (dx * dx + dy * dy > 1) continue;
          // Lit from the upper left; banded like a gas giant.
          const lightK = Math.max(0, Math.min(1, 0.6 - dx * 0.6 - dy * 0.4));
          const band = Math.sin(dy * 9 + Math.sin(dx * 3)) > 0.55 ? 0.12 : 0;
          fb.set(x, y, mix(mix(dark, body, lightK), C("#ffffff"), band));
        }
      }
      if (s.ring) {
        const ring = C(s.ring);
        for (let a = 0; a < Math.PI * 2; a += 0.6 / Math.max(r, 1)) {
          const x = cx + Math.cos(a) * r * 1.7;
          const y = cy + Math.sin(a) * r * 0.38;
          const behind = Math.sin(a) < 0 && Math.hypot((x - cx) / r, (y - cy) / r) < 1;
          if (!behind) fb.blend(Math.round(x), Math.round(y), ring, 0.85);
        }
      }
      return;
    }
    case "rays": {
      const day = light.phase.day + light.phase.dusk * 0.5;
      if (day <= 0) return;
      const c = C(s.color);
      const sp = s.spacing * u;
      for (let y = 0; y < hz; y++) {
        for (let x = 0; x < g.w; x++) {
          const v = (x + g.pan * 0.5 + y * 0.6) / sp;
          const f = v - Math.floor(v);
          if (f < 0.22) fb.add(x, y, c, 0.08 * day * (1 - y / hz) * Math.sin((Math.PI * f) / 0.22));
        }
      }
      return;
    }
  }
}

/** One prop standing at (x, baseY) with height `s` pixels. */
function drawProp(fb: Framebuffer, kind: TreeKind, x: number, baseY: number, s: number, c: readonly RGBA[], light: Light, r: number): void {
  const [a, b = a, d = b] = c;
  const px = Math.max(1, s / 8); // detail pixel
  switch (kind) {
    case "round":
    case "blossom":
    case "mushroom": {
      rectPx(fb, x - px * 0.6, baseY - s * 0.45, x + px * 0.6, baseY + px, kind === "mushroom" ? d : b);
      const cr = s * (kind === "mushroom" ? 0.32 : 0.34);
      const cy = baseY - s * (kind === "mushroom" ? 0.5 : 0.62);
      if (kind === "mushroom") {
        discPx(fb, x, cy, cr, a, true);
        for (let k = 0; k < 3; k++) discPx(fb, x - cr * 0.5 + k * cr * 0.5, cy - cr * 0.45, Math.max(0.6, px * 0.6), d);
      } else {
        discPx(fb, x, cy, cr, a);
        discPx(fb, x - cr * 0.55, cy + cr * 0.3, cr * 0.7, a);
        discPx(fb, x + cr * 0.55, cy + cr * 0.3, cr * 0.7, a);
        // Light from the top-left.
        discPx(fb, x - cr * 0.3, cy - cr * 0.3, cr * 0.45, mix(a, C("#ffffff"), kind === "blossom" ? 0.35 : 0.18));
        if (kind === "blossom") for (let k = 0; k < 4; k++) fb.set(Math.round(x - cr + rand(k, Math.round(x), 71) * cr * 2), Math.round(cy - cr * 0.5 + rand(k, Math.round(x), 72) * cr), d);
      }
      return;
    }
    case "pine":
    case "snowpine": {
      rectPx(fb, x - px * 0.5, baseY - s * 0.2, x + px * 0.5, baseY + px, b);
      for (let k = 0; k < 3; k++) {
        const top = baseY - s * (1 - k * 0.25);
        const w = s * (0.18 + k * 0.1);
        const h = s * 0.42;
        for (let y = Math.floor(top); y < top + h; y++) {
          const half = ((y - top) / h) * w;
          rectPx(fb, x - half, y, x + half + 0.5, y + 1, a);
          if (kind === "snowpine" && y - top < h * 0.3) rectPx(fb, x - half, y, x + half + 0.5, y + 1, d);
        }
      }
      return;
    }
    case "dead": {
      rectPx(fb, x - px * 0.5, baseY - s * 0.8, x + px * 0.5, baseY + px, a);
      for (let k = 0; k < 3; k++) {
        const y = baseY - s * (0.35 + k * 0.17);
        const dir = k % 2 ? 1 : -1;
        for (let j = 0; j < s * 0.25; j++) fb.set(Math.round(x + dir * j), Math.round(y - j * 0.6), a);
      }
      return;
    }
    case "cactus": {
      rectPx(fb, x - px, baseY - s * 0.8, x + px, baseY + px, a);
      rectPx(fb, x - s * 0.25, baseY - s * 0.5, x - px, baseY - s * 0.5 + px * 1.5, a);
      rectPx(fb, x - s * 0.25, baseY - s * 0.68, x - s * 0.25 + px * 1.5, baseY - s * 0.4, a);
      rectPx(fb, x + px, baseY - s * 0.38, x + s * 0.22, baseY - s * 0.38 + px * 1.5, a);
      rectPx(fb, x + s * 0.22 - px * 1.5, baseY - s * 0.58, x + s * 0.22, baseY - s * 0.3, a);
      rectPx(fb, x - px, baseY - s * 0.8, x - px * 0.3, baseY, mix(a, C("#ffffff"), 0.2));
      return;
    }
    case "lollipop": {
      rectPx(fb, x - px * 0.4, baseY - s * 0.55, x + px * 0.4, baseY + px, C("#f4f0e8"));
      const cr = s * 0.25;
      const cy = baseY - s * 0.75;
      discPx(fb, x, cy, cr, a);
      discPx(fb, x, cy, cr * 0.62, b);
      discPx(fb, x, cy, cr * 0.3, a);
      return;
    }
    case "kelp": {
      for (let y = 0; y < s; y++) {
        const sway = Math.sin(y / (s * 0.25) + r * 6) * s * 0.08;
        rectPx(fb, x + sway - px * 0.6, baseY - y, x + sway + px * 0.6, baseY - y + 1, y % Math.max(2, Math.round(px * 3)) === 0 ? b : a);
      }
      return;
    }
    case "coral": {
      for (let k = -1; k <= 1; k++) {
        const h = s * (0.5 + 0.3 * (1 - Math.abs(k)));
        rectPx(fb, x + k * s * 0.18 - px * 0.7, baseY - h, x + k * s * 0.18 + px * 0.7, baseY + px, a);
        discPx(fb, x + k * s * 0.18, baseY - h, px * 1.1, b);
      }
      return;
    }
    case "palm": {
      for (let y = 0; y < s * 0.85; y++) rectPx(fb, x + (y / s) ** 2 * s * 0.2 - px * 0.5, baseY - y, x + (y / s) ** 2 * s * 0.2 + px * 0.5, baseY - y + 1, b);
      const tx = x + 0.72 * 0.72 * s * 0.2;
      const ty = baseY - s * 0.85;
      for (const dir of [-1, -0.5, 0.5, 1]) for (let j = 0; j < s * 0.35; j++) fb.set(Math.round(tx + dir * j), Math.round(ty + Math.abs(dir) * j * j / (s * 0.25) - (dir > -1 && dir < 1 ? j * 0.3 : 0)), a);
      return;
    }
    case "grave": {
      rectPx(fb, x - s * 0.18, baseY - s * 0.35, x + s * 0.18, baseY + px, a);
      discPx(fb, x, baseY - s * 0.35, s * 0.18, a, true);
      rectPx(fb, x - px * 0.4, baseY - s * 0.32, x + px * 0.4, baseY - s * 0.12, b);
      rectPx(fb, x - s * 0.08, baseY - s * 0.26, x + s * 0.08, baseY - s * 0.26 + px * 0.8, b);
      return;
    }
    case "pillar": {
      rectPx(fb, x - s * 0.12, baseY - s, x + s * 0.12, baseY + px, a);
      rectPx(fb, x - s * 0.17, baseY - s, x + s * 0.17, baseY - s + px * 1.2, b);
      rectPx(fb, x - s * 0.12, baseY - s, x - s * 0.06, baseY, mix(a, C("#ffffff"), 0.12));
      return;
    }
    case "crystal": {
      for (let y = 0; y < s * 0.6; y++) {
        const half = Math.min(y, s * 0.6 - y) * 0.35 + px * 0.5;
        rectPx(fb, x - half, baseY - y, x + half, baseY - y + 1, y < s * 0.3 ? a : b);
      }
      glowPx(fb, x, baseY - s * 0.3, s * 0.5, a, 0.25 + 0.35 * light.lamps);
      return;
    }
    case "lamp": {
      rectPx(fb, x - px * 0.4, baseY - s, x + px * 0.4, baseY + px, b);
      rectPx(fb, x - px * 1.2, baseY - s - px * 1.5, x + px * 1.2, baseY - s, light.lamps > 0.3 ? WARM : a);
      if (light.lamps > 0.3) glowPx(fb, x, baseY - s, s * 0.45, WARM, 0.45 * light.lamps);
      return;
    }
    case "rock": {
      discPx(fb, x, baseY, s * 0.3, a, true);
      discPx(fb, x - s * 0.08, baseY - s * 0.06, s * 0.14, mix(a, C("#ffffff"), 0.15), true);
      return;
    }
    case "code": {
      // A falling column of glyph-ish dashes (matrix).
      const step = Math.max(2, Math.round(px * 2));
      for (let y = 0; y < s; y += step) {
        const k = y / s;
        rectPx(fb, x - px * 0.5, baseY - s + y, x + px * 0.5, baseY - s + y + Math.max(1, step - 1), mix(b, a, k));
      }
      return;
    }
  }
}

// ─── Ground ─────────────────────────────────────────────────────────────────

/** The near ground band from the horizon down, in world space. */
export function paintGround(fb: Framebuffer, g: Geo, light: Light, gr: Ground, seed: number): void {
  const { u } = g;
  const hz = Math.round(HORIZON * u);
  const [edge, body, deep] = gr.colors.map((c) => shade(C(c), light));
  const specks = gr.specks.map((c) => shade(C(c), light));
  const cell = Math.max(1, Math.round(u * 0.5));
  for (let y = hz; y < fb.height; y++) {
    const dy = (y - hz) / u;
    for (let x = 0; x < g.w; x++) {
      const wx = x + g.pan;
      const cx = Math.floor(wx / cell);
      const cy = Math.floor((y - hz) / cell);
      let c = dy < 0.5 ? edge : mix(body, deep, Math.min(1, (dy - 0.5) / 3));
      const r = rand(seed, cx * 131 + cy, 81);
      switch (gr.texture) {
        case "stripes":
          if (Math.floor((wx / u + dy * 2) / 2) % 2 === 0 && dy >= 0.5) c = mix(c, specks[0], 0.6);
          break;
        case "grid":
          if (dy >= 0.5 && (Math.floor(wx) % Math.max(2, Math.round(u * 3)) === 0 || (y - hz) % Math.max(2, Math.round(u)) === 0)) c = specks[0];
          break;
        case "stone":
        case "street": {
          const bw = Math.max(2, Math.round(u * (gr.texture === "street" ? 6 : 3)));
          const bh = Math.max(2, Math.round(u));
          const row = Math.floor((y - hz) / bh);
          if (dy >= 0.5 && ((y - hz) % bh === 0 || (Math.floor(wx) + row * Math.floor(bw / 2)) % bw === 0)) c = mix(c, deep, 0.6);
          if (gr.texture === "street" && dy > 1.4 && dy < 1.8 && Math.floor(wx / (u * 3)) % 2 === 0) c = specks[0];
          break;
        }
        case "magma":
          if (dy >= 0.5 && r > 0.93) c = specks[0];
          break;
        case "cloud":
          if (r > 0.75) c = mix(c, specks[0], 0.5);
          break;
        default:
          if (dy >= 0.5 && r > 0.94) c = mix(c, specks[Math.floor(rand(seed, cx, 82) * specks.length)], 0.75);
      }
      fb.set(x, y, c);
    }
  }
  // Tufts and pebbles that poke above the edge line.
  if (gr.texture === "grass" || gr.texture === "moss" || gr.texture === "sand" || gr.texture === "snow") {
    const step = Math.max(2, Math.round(u * 1.5));
    for (let wx = Math.floor(g.pan / step) * step; wx < g.pan + g.w + step; wx += step) {
      const i = Math.floor(wx / step);
      if (rand(seed, i, 83) > 0.4) continue;
      const x = wx - g.pan + Math.floor(rand(seed, i, 84) * step);
      const h = Math.max(1, Math.round(u * (0.3 + rand(seed, i, 85) * 0.5)));
      const c = gr.texture === "grass" || gr.texture === "moss" ? edge : specks[0];
      for (let k = 1; k <= h; k++) fb.set(x, hz - k, c);
    }
  }
  if (gr.texture === "magma") glowPx(fb, g.w / 2, fb.height, g.w * 0.6, C("#ff5020"), 0.15);
}

// ─── Structures ─────────────────────────────────────────────────────────────

/** A landmark at `st.at` of the world width, drawn in world space. */
export function paintStructure(fb: Framebuffer, g: Geo, light: Light, st: Structure, worldW: number): void {
  const { u } = g;
  const gy = HORIZON * u + u * 0.6;
  const ox = st.at * worldW - g.pan;
  const P = (x: number) => ox + x * u;
  const Y = (top: number) => gy - top * u;
  const halos: [number, number, number][] = [];
  for (const op of st.ops) {
    switch (op[0]) {
      case "rect": {
        const [, x, top, w, h, c] = op;
        rectPx(fb, P(x), Y(top), P(x + w), Y(top - h), shade(C(c), light));
        break;
      }
      case "roof": {
        const [, x, top, w, h, c] = op;
        const col = shade(C(c), light);
        const y0 = Y(top);
        const y1 = Y(top - h);
        for (let y = Math.floor(y0); y < y1; y++) {
          const k = (y + 0.5 - y0) / (y1 - y0);
          rectPx(fb, P(x + w / 2 - (w / 2) * k), y, P(x + w / 2 + (w / 2) * k), y + 1, col);
        }
        break;
      }
      case "win": {
        const [, x, top, w, h] = op;
        const c = mix(GLASS, WARM, light.lamps);
        rectPx(fb, P(x), Y(top), P(x + w), Y(top - h), shade(c, { ...light, ambient: light.lamps > 0.3 ? [1, 1, 1] : light.ambient }));
        if (light.lamps > 0.3) halos.push([P(x + w / 2), Y(top - h / 2), Math.max(w, h) * u * 1.6]);
        break;
      }
      case "neon": {
        const [, x, top, w, h, c] = op;
        rectPx(fb, P(x), Y(top), P(x + w), Y(top - h), C(c));
        glowPx(fb, P(x + w / 2), Y(top - h / 2), Math.max(w, h) * u * 1.2, C(c), 0.18 + 0.3 * light.lamps);
        break;
      }
      case "disc": {
        const [, cx, cy, r, c] = op;
        discPx(fb, P(cx), Y(cy), r * u, shade(C(c), light));
        break;
      }
      case "dome": {
        const [, cx, base, r, c] = op;
        discPx(fb, P(cx), Y(base), r * u, shade(C(c), light), true);
        break;
      }
      case "beam": {
        const [, cx, cy, c] = op;
        if (light.lamps < 0.3) break;
        const x0 = P(cx);
        const y0 = Y(cy);
        const len = g.w * 0.35;
        for (let i = 0; i < len; i++) {
          const spread = i * 0.12;
          for (let j = -spread; j <= spread; j++) fb.add(Math.round(x0 - i), Math.round(y0 + j), C(c), 0.22 * light.lamps * (1 - i / len));
        }
        glowPx(fb, x0, y0, u * 2, C(c), 0.6 * light.lamps);
        break;
      }
    }
  }
  for (const [x, y, r] of halos) glowPx(fb, x, y, r, WARM, 0.3 * light.lamps);
}

/** Stable per-biome seed. */
export function biomeSeed(name: string): number {
  // FNV-1a: identical under Bun and Node (buddy-shell runs on Node).
  let h = 0x811c9dc5;
  for (const ch of `diorama:${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}
