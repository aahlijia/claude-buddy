/**
 * Rig — part-based HD buddies (H1, docs/game-feel/hd-overhaul/brainstorm.md §1.1).
 *
 * A species is a small hierarchy of parts. Big masses are primitives
 * (ellipses, polygons); details (eyes, mouths, ear tufts, wing webbing) are
 * palette-indexed text grids, so the art stays reviewable in a diff. Every
 * part is posed with a real 2D transform (move, rotate, squash/stretch
 * around its pivot) and inherits its parent's transform.
 *
 * Nothing is hand-shaded: the renderer lights every part with the same
 * top-left light, quantizes to the material's ramp with a narrow dither band,
 * separates overlapping parts with an inner line, then applies the sel-out
 * outline and the rarity rim light. That shared pipeline is the style bible:
 * 20 species drawn as flat shapes still look like one game.
 *
 * Pure: `renderRig(rig, pose, opts)` depends on its arguments only.
 */

import type { Rarity } from "../engine.ts";
import { Framebuffer, hex, mix, type RGBA } from "./framebuffer.ts";

// ─── Definitions ────────────────────────────────────────────────────────────

export interface Material {
  /** Dark → light lighting ramp (4–5 steps). */
  ramp: readonly RGBA[];
  /** Ramp used for shiny buddies (falls back to `ramp`). */
  shiny?: readonly RGBA[];
  /** Unlit: always the brightest ramp step (ink, eye whites, sparks). */
  flat?: boolean;
  /** Specular strength (0 = matte). */
  gloss?: number;
  /** Opacity, 0..1 (ghosts). Translucent materials shimmer with `Pose.alpha`. */
  alpha?: number;
}

export type Shape =
  /** Superellipse: p = 2 is an ellipse, higher is boxier. */
  | { kind: "ellipse"; rx: number; ry: number; p?: number; mat: string }
  /** Filled polygon, points in shape-local pixels. */
  | { kind: "poly"; pts: readonly (readonly [number, number])[]; mat: string }
  /** Text grid: one material key per pixel, `.` is empty. */
  | { kind: "grid"; rows: readonly string[] };

export type Role =
  | "body"
  | "belly"
  | "head"
  | "snout"
  | "ear"
  | "horn"
  | "eye"
  | "mouth"
  | "tail"
  | "wing"
  | "legF"
  | "legB"
  | "detail";

export interface PartDef {
  name: string;
  role: Role;
  /** Parent part name; omitted for the single root part. */
  parent?: string;
  /** Attach point: parent-local pixels (or world pixels for the root). */
  at: readonly [number, number];
  /** Pivot in this part's shape-local pixels. */
  pivot: readonly [number, number];
  shape: Shape;
  /** Alternate shapes (eyes: open/half/closed/happy/x/angry; mouths). */
  variants?: Readonly<Record<string, Shape>>;
  /** Draw order; higher is in front. */
  z: number;
  /** Rest rotation (radians). */
  rot?: number;
  /** Parts sharing a group merge without an inner line. */
  group?: string;
  /** -1 = far side, +1 = near side (motion phases legs/ears by side). */
  side?: -1 | 1;
  /** Tail/wing segment index from the base. */
  seg?: number;
  /** Brightness multiplier (far-side limbs sit in shade). */
  shade?: number;
  /** Phase offset (radians) for chains that sway together: tentacles. */
  phase?: number;
}

export interface RigDef {
  id: string;
  width: number;
  height: number;
  /** Ground line (y) the contact shadow sits on. */
  ground: number;
  materials: Readonly<Record<string, Material>>;
  parts: readonly PartDef[];
  /** Outline color sel-out darkens toward. */
  outline: RGBA;
  /** Contact-shadow half width at rest. */
  shadowRx: number;
  /** Per-species motion flavor (motion.ts); omitted = the plain library. */
  feel?: Feel;
}

/**
 * Species flavor as a handful of numbers instead of new frames
 * (brainstorm §1.1): the ghost floats, the robot moves in servo steps,
 * snails and turtles take their time, ducks waddle, rabbits hop.
 */
export interface Feel {
  /** Hover height in px; the buddy bobs there and sinks on KO. */
  float?: number;
  /** Servo steps per second: idle, walk and victory snap between poses. */
  servo?: number;
  /** Time scale for idle and walk (< 1 is slower). */
  tempo?: number;
  /** Body roll (radians) while walking. */
  waddle?: number;
  /** Walk as hops this many px high. */
  hop?: number;
}

export interface PartPose {
  dx?: number;
  dy?: number;
  rot?: number;
  sx?: number;
  sy?: number;
  variant?: string;
  hide?: boolean;
}

export interface Pose {
  parts: Readonly<Record<string, PartPose>>;
  /** Pixels the whole buddy is lifted off the ground (shadow shrinks). */
  lift?: number;
  /** White hit-flash, 0..1. */
  flash?: number;
  /** Desaturate (knocked out). */
  ko?: boolean;
  /** Opacity multiplier for translucent materials (ghost shimmer). */
  alpha?: number;
}

export interface RenderOptions {
  rarity?: Rarity;
  shiny?: boolean;
  /** Mirror to face left (enemies). */
  flip?: boolean;
  /** Skip the contact shadow (compositing onto a scene that draws its own). */
  noShadow?: boolean;
}

// ─── Shape rasterization (cached per shape) ─────────────────────────────────

interface Mask {
  w: number;
  h: number;
  /** Material key per cell, "" = empty. */
  key: string[];
  /** Unit normal per cell (shape-local, y down, z toward viewer). */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

const maskCache = new WeakMap<Shape, Mask>();

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function pointInPoly(x: number, y: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function shapeMask(shape: Shape): Mask {
  const hit = maskCache.get(shape);
  if (hit) return hit;
  let w: number;
  let h: number;
  let keyAt: (x: number, y: number) => string;
  if (shape.kind === "ellipse") {
    w = Math.ceil(shape.rx * 2);
    h = Math.ceil(shape.ry * 2);
    const p = shape.p ?? 2;
    keyAt = (x, y) => {
      const dx = (x + 0.5 - shape.rx) / shape.rx;
      const dy = (y + 0.5 - shape.ry) / shape.ry;
      return Math.pow(Math.abs(dx), p) + Math.pow(Math.abs(dy), p) <= 1 ? shape.mat : "";
    };
  } else if (shape.kind === "poly") {
    w = Math.ceil(Math.max(...shape.pts.map((q) => q[0])));
    h = Math.ceil(Math.max(...shape.pts.map((q) => q[1])));
    keyAt = (x, y) => (pointInPoly(x + 0.5, y + 0.5, shape.pts) ? shape.mat : "");
  } else {
    w = Math.max(...shape.rows.map((r) => r.length));
    h = shape.rows.length;
    keyAt = (x, y) => {
      const ch = shape.rows[y]?.[x] ?? ".";
      return ch === "." || ch === " " ? "" : ch;
    };
  }
  const n = w * h;
  const key = new Array<string>(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) key[y * w + x] = keyAt(x, y);

  // Height field from a chamfer distance transform: interior cells rise like
  // a pillow, so any silhouette gets plausible rounded normals.
  const INF = 1e9;
  const dist = new Float32Array(n).fill(INF);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && key[y * w + x] !== "";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y)) dist[y * w + x] = 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dist[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      dist[i] = Math.min(dist[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  }
  let maxD = 1;
  for (let i = 0; i < n; i++) if (dist[i] < INF) maxD = Math.max(maxD, dist[i]);
  const R = Math.max(2, Math.min(maxD, 7));
  const height = (x: number, y: number) => {
    const d = Math.min(at(x, y), R) / R;
    return Math.sqrt(Math.max(0, 1 - (1 - d) * (1 - d))) * R;
  };

  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!key[i]) continue;
      let v: [number, number, number];
      if (shape.kind === "ellipse") {
        // Analytic dome normals read cleaner than a distance field.
        const dx = (x + 0.5 - shape.rx) / shape.rx;
        const dy = (y + 0.5 - shape.ry) / shape.ry;
        v = norm3(dx, dy * 0.9, Math.sqrt(Math.max(0, 1 - Math.min(1, dx * dx + dy * dy))) + 0.15);
      } else {
        const gx = height(x + 1, y) - height(x - 1, y);
        const gy = height(x, y + 1) - height(x, y - 1);
        v = norm3(-gx * 0.9, -gy * 0.9, 1.1);
      }
      nx[i] = v[0];
      ny[i] = v[1];
      nz[i] = v[2];
    }
  }
  const m: Mask = { w, h, key, nx, ny, nz };
  maskCache.set(shape, m);
  return m;
}

// ─── Transforms ─────────────────────────────────────────────────────────────

/** 2×3 affine: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = [number, number, number, number, number, number];

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const rotate = (r: number): Mat => [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
const scale = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];

const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface Placed {
  part: PartDef;
  shape: Shape;
  world: Mat;
  /** Accumulated rotation (for turning normals into world space). */
  angle: number;
}

/** Resolve every visible part's world transform for a pose. */
export function place(rig: RigDef, pose: Pose): Placed[] {
  const byName = new Map(rig.parts.map((p) => [p.name, p]));
  const memo = new Map<string, { world: Mat; angle: number }>();
  const resolve = (p: PartDef): { world: Mat; angle: number } => {
    const hit = memo.get(p.name);
    if (hit) return hit;
    const pp = pose.parts[p.name] ?? {};
    const parent = p.parent ? byName.get(p.parent) : undefined;
    const base = parent ? resolve(parent) : { world: IDENT, angle: 0 };
    const rot = (p.rot ?? 0) + (pp.rot ?? 0);
    const local = mul(
      mul(mul(translate(p.at[0] + (pp.dx ?? 0), p.at[1] + (pp.dy ?? 0)), rotate(rot)), scale(pp.sx ?? 1, pp.sy ?? 1)),
      translate(-p.pivot[0], -p.pivot[1]),
    );
    const out = { world: mul(base.world, local), angle: base.angle + rot };
    memo.set(p.name, out);
    return out;
  };
  const out: Placed[] = [];
  for (const p of rig.parts) {
    const pp = pose.parts[p.name] ?? {};
    const r = resolve(p);
    if (pp.hide) continue;
    const shape = (pp.variant && p.variants?.[pp.variant]) || p.shape;
    out.push({ part: p, shape, world: r.world, angle: r.angle });
  }
  // Stable sort by z (definition order breaks ties).
  return out
    .map((pl, i) => ({ pl, i }))
    .sort((a, b) => a.pl.part.z - b.pl.part.z || a.i - b.i)
    .map((x) => x.pl);
}

/** World position of a part's pivot (attach points for effects, H2). */
export function anchorOf(rig: RigDef, pose: Pose, name: string): [number, number] | null {
  const pl = place(rig, { ...pose, parts: { ...pose.parts, [name]: { ...pose.parts[name], hide: false } } }).find(
    (p) => p.part.name === name,
  );
  return pl ? apply(pl.world, pl.part.pivot[0], pl.part.pivot[1]) : null;
}

// ─── Lighting ───────────────────────────────────────────────────────────────

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const LIGHT = norm3(-0.5, -0.72, 0.5);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const WHITE = hex("#ffffff");

/** Rarity rim light (null = none). Mirrors the H0 blob. */
export const RIM: Record<Rarity, RGBA | null> = {
  common: null,
  uncommon: hex("#7ee69a"),
  rare: hex("#b1b9f9"),
  epic: hex("#c8a0ff"),
  legendary: hex("#ffd25a"),
};

function shadeCell(
  mat: Material,
  shiny: boolean,
  n: [number, number, number],
  x: number,
  y: number,
  bright: number,
): RGBA {
  const ramp = (shiny && mat.shiny) || mat.ramp;
  const top = ramp.length - 1;
  if (mat.flat) return ramp[top];
  const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const v = Math.min(1, (0.22 + 0.9 * lambert) * bright) * top;
  const lo = Math.floor(v);
  const threshold = 0.5 + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.45;
  let c = ramp[Math.min(top, v - lo > threshold ? lo + 1 : lo)];
  // Warm bounce light on undersides.
  if (n[1] > 0.35) c = mix(c, ramp[Math.max(0, top - 1)], 0.25 * Math.min(1, (n[1] - 0.35) / 0.5));
  if (mat.gloss) {
    const spec = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 36) * mat.gloss;
    if (spec > 0.7) c = WHITE;
    else if (spec > 0.4) c = mix(c, WHITE, 0.4);
  }
  return c;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderRig(rig: RigDef, pose: Pose, opts: RenderOptions = {}): Framebuffer {
  const W = rig.width;
  const H = rig.height;
  const fb = new Framebuffer(W, H);
  const owner = new Int16Array(W * H).fill(-1);
  const color: RGBA[] = new Array(W * H);
  const flatBuf = new Uint8Array(W * H);
  const alphaBuf = new Float32Array(W * H).fill(1);
  const shimmer = pose.alpha ?? 1;
  const nxBuf = new Float32Array(W * H);
  const placed = place(rig, pose);
  const groups = placed.map((p) => p.part.group ?? p.part.name);

  placed.forEach((pl, idx) => {
    const m = shapeMask(pl.shape);
    const inv = invert(pl.world);
    const corners = [apply(pl.world, 0, 0), apply(pl.world, m.w, 0), apply(pl.world, 0, m.h), apply(pl.world, m.w, m.h)];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    const ca = Math.cos(pl.angle);
    const sa = Math.sin(pl.angle);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sxf, syf] = apply(inv, x + 0.5, y + 0.5);
        const sx = Math.floor(sxf);
        const sy = Math.floor(syf);
        if (sx < 0 || sy < 0 || sx >= m.w || sy >= m.h) continue;
        const i = sy * m.w + sx;
        const k = m.key[i];
        if (!k) continue;
        const mat = rig.materials[k];
        if (!mat) continue;
        // Normals rotate with the part; the light stays put.
        const nx = m.nx[i] * ca - m.ny[i] * sa;
        const ny = m.nx[i] * sa + m.ny[i] * ca;
        const o = y * W + x;
        color[o] = shadeCell(mat, !!opts.shiny, [nx, ny, m.nz[i]], x, y, pl.part.shade ?? 1);
        owner[o] = idx;
        nxBuf[o] = mat.flat ? 0 : nx;
        flatBuf[o] = mat.flat ? 1 : 0;
        alphaBuf[o] = mat.alpha === undefined ? 1 : Math.max(0, Math.min(1, mat.alpha * shimmer));
      }
    }
  });

  // Inner lines: where a part overlaps one behind it (different group),
  // darken its edge so limbs and heads read as separate masses.
  const outline = rig.outline;
  const final: (RGBA | null)[] = new Array(W * H).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      const me = owner[o];
      if (me < 0) continue;
      let c = color[o];
      // Flat details (eyes, ink) are already crisp; don't line them.
      if (!flatBuf[o]) {
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const other = owner[yy * W + xx];
          if (other >= 0 && other < me && groups[other] !== groups[me]) {
            c = mix(c, outline, 0.55);
            break;
          }
        }
      }
      final[o] = c;
    }
  }

  // Rarity rim light on the silhouette's lit-from-behind edge (right/bottom).
  const rim = RIM[opts.rarity ?? "common"];
  if (rim) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (!final[o]) continue;
        const edgeR = x + 1 >= W || owner[o + 1] < 0;
        const edgeR2 = x + 2 >= W || owner[o + 2] < 0;
        const edgeB = y + 1 >= H || owner[o + W] < 0;
        if (edgeR || (edgeB && nxBuf[o] > -0.2)) final[o] = mix(final[o]!, rim, 0.75);
        else if (edgeR2 && nxBuf[o] > 0.1) final[o] = mix(final[o]!, rim, 0.35);
      }
    }
  }

  // Contact shadow first (behind everything).
  if (!opts.noShadow) {
    const lift = pose.lift ?? 0;
    const k = Math.max(0, 1 - lift / 14);
    let minX = W;
    let maxX = 0;
    for (let i = 0; i < W * H; i++) {
      if (owner[i] >= 0) {
        minX = Math.min(minX, i % W);
        maxX = Math.max(maxX, i % W);
      }
    }
    const cx = minX <= maxX ? (minX + maxX) / 2 : W / 2;
    fb.ellipse(cx, rig.ground + 0.5, rig.shadowRx * (0.65 + 0.35 * k), 2.4 * (0.7 + 0.3 * k), hex("#0c0818"), 0.42 * (0.5 + 0.5 * k));
  }

  // Sel-out outline outside the silhouette.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      if (final[o]) continue;
      const nb: RGBA[] = [];
      if (x > 0 && final[o - 1]) nb.push(final[o - 1]!);
      if (x < W - 1 && final[o + 1]) nb.push(final[o + 1]!);
      if (y > 0 && final[o - W]) nb.push(final[o - W]!);
      if (y < H - 1 && final[o + W]) nb.push(final[o + W]!);
      if (!nb.length) continue;
      const avg = [0, 1, 2].map((k) => Math.round(nb.reduce((s, c) => s + c[k], 0) / nb.length));
      const a = Math.max(...[o - 1, o + 1, o - W, o + W].map((j) => (j >= 0 && j < W * H && final[j] ? alphaBuf[j] : 0)));
      if (a >= 1) fb.set(x, y, mix([avg[0], avg[1], avg[2], 255], outline, 0.72));
      else fb.blend(x, y, mix([avg[0], avg[1], avg[2], 255], outline, 0.72), a);
    }
  }

  const flash = Math.max(0, Math.min(1, pose.flash ?? 0));
  for (let o = 0; o < W * H; o++) {
    let c = final[o];
    if (!c) continue;
    if (pose.ko) {
      const g = Math.round(c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15);
      c = mix(c, [g, g, g, 255], 0.45);
    }
    if (flash) c = mix(c, WHITE, flash * 0.85);
    if (alphaBuf[o] < 1) fb.blend(o % W, Math.floor(o / W), c, alphaBuf[o]);
    else fb.set(o % W, Math.floor(o / W), c);
  }

  return opts.flip ? mirror(fb) : fb;
}

function mirror(fb: Framebuffer): Framebuffer {
  const out = new Framebuffer(fb.width, fb.height);
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) out.set(fb.width - 1 - x, y, fb.get(x, y));
  return out;
}

/** Shorthand for authoring ramps. */
export const ramp = (...colors: string[]): RGBA[] => colors.map(hex);
