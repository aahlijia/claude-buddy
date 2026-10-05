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
  /** Gear anchors (gear.ts), when the measured ones don't suit the species:
   *  `hat` sits on the crown of a part, `hand` holds the weapon. */
  anchors?: { hat?: GearAnchor; hand?: GearAnchor };
}

/** A gear attachment point: a part and a point in its shape pixels. */
export interface GearAnchor {
  part: string;
  /** Shape pixels; omitted = measured (the part's crown for a hat). */
  at?: readonly [number, number];
  /** Tilt of what hangs there (radians). */
  rot?: number;
  /** Parts the gear replaces (a hat instead of the capybara's yuzu). */
  hides?: readonly string[];
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
  dither = true,
  floor = 0,
  ambient = 0.22,
): RGBA {
  const ramp = (shiny && mat.shiny) || mat.ramp;
  const top = ramp.length - 1;
  if (mat.flat) return ramp[top];
  const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const v = Math.min(1, (ambient + 0.9 * lambert) * bright) * top;
  const lo = Math.floor(v);
  const threshold = dither ? 0.5 + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.45 : 0.5;
  let c = ramp[Math.min(top, Math.max(Math.min(floor, top - 1), v - lo > threshold ? lo + 1 : lo))];
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

/**
 * What the rasterizer knows about each pixel before any lighting: which part
 * owns it, its material and its surface normal. Resolving a raster (light,
 * inner lines, rim, outline) is the style pipeline; keeping the two apart
 * lets the mini status sprite shrink the raster and light it at its own
 * size instead of averaging finished pixels (statussprite.ts).
 */
export interface RigRaster {
  width: number;
  height: number;
  /** Index into `placed` per pixel, -1 = empty. */
  owner: Int16Array;
  /** Material key per pixel ("" = empty). */
  key: string[];
  nx: Float64Array;
  ny: Float64Array;
  nz: Float64Array;
  /** The owning part's brightness (`PartDef.shade`). */
  bright: Float64Array;
  placed: Placed[];
}

/** Rasterize a posed rig: ownership, materials and normals, no color yet. */
export function rasterRig(rig: RigDef, pose: Pose): RigRaster {
  const W = rig.width;
  const H = rig.height;
  const r: RigRaster = {
    width: W,
    height: H,
    owner: new Int16Array(W * H).fill(-1),
    key: new Array<string>(W * H).fill(""),
    nx: new Float64Array(W * H),
    ny: new Float64Array(W * H),
    nz: new Float64Array(W * H),
    bright: new Float64Array(W * H),
    placed: place(rig, pose),
  };
  r.placed.forEach((pl, idx) => {
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
        if (!k || !rig.materials[k]) continue;
        // Normals rotate with the part; the light stays put.
        const o = y * W + x;
        r.owner[o] = idx;
        r.key[o] = k;
        r.nx[o] = m.nx[i] * ca - m.ny[i] * sa;
        r.ny[o] = m.nx[i] * sa + m.ny[i] * ca;
        r.nz[o] = m.nz[i];
        r.bright[o] = pl.part.shade ?? 1;
      }
    }
  });
  return r;
}

export interface ResolveOptions extends RenderOptions {
  /** Ordered dither between ramp steps (off for tiny sprites, where it's noise). */
  dither?: boolean;
  /** How far inner lines darken toward the outline (0.55; tiny sprites want less). */
  innerLine?: number;
  /** Lowest lighting-ramp step used: 1 keeps the darkest step for the
   *  outline, so a tiny sprite's shadows don't read as holes. */
  rampFloor?: number;
  /** Ambient light (0.22): tiny sprites read better a little brighter. */
  ambient?: number;
}

/** Light and line a raster into pixels: the shared style pipeline. */
export function resolveRig(rig: RigDef, r: RigRaster, pose: Pose, opts: ResolveOptions = {}): Framebuffer {
  const W = r.width;
  const H = r.height;
  const fb = new Framebuffer(W, H);
  const { owner, placed } = r;
  const color: RGBA[] = new Array(W * H);
  const flatBuf = new Uint8Array(W * H);
  const alphaBuf = new Float32Array(W * H).fill(1);
  const shimmer = pose.alpha ?? 1;
  const nxBuf = new Float32Array(W * H);
  const groups = placed.map((p) => p.part.group ?? p.part.name);
  const dither = opts.dither ?? true;

  for (let o = 0; o < W * H; o++) {
    if (owner[o] < 0) continue;
    const mat = rig.materials[r.key[o]];
    color[o] = shadeCell(mat, !!opts.shiny, [r.nx[o], r.ny[o], r.nz[o]], o % W, Math.floor(o / W), r.bright[o], dither, opts.rampFloor ?? 0, opts.ambient ?? 0.22);
    nxBuf[o] = mat.flat ? 0 : r.nx[o];
    flatBuf[o] = mat.flat ? 1 : 0;
    alphaBuf[o] = mat.alpha === undefined ? 1 : Math.max(0, Math.min(1, mat.alpha * shimmer));
  }

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
            c = mix(c, outline, opts.innerLine ?? 0.55);
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

/** Render one posed frame at the rig's own size. */
export function renderRig(rig: RigDef, pose: Pose, opts: RenderOptions = {}): Framebuffer {
  return resolveRig(rig, rasterRig(rig, pose), pose, opts);
}

function mirror(fb: Framebuffer): Framebuffer {
  const out = new Framebuffer(fb.width, fb.height);
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) out.set(fb.width - 1 - x, y, fb.get(x, y));
  return out;
}

/** Shorthand for authoring ramps. */
export const ramp = (...colors: string[]): RGBA[] => colors.map(hex);

// ─── Mini (status-line) sprites ────────────────────────────────────────────

/** How strongly a role claims a shrunken pixel it shares with others: the
 *  face wins over fur, so a snout or an ear tip survives the shrink. */
const ROLE_WEIGHT: Partial<Record<Role, number>> = { eye: 1.5, mouth: 1.2, snout: 1.3, horn: 1.4, ear: 1.2 };

/** Roles whose lone top pixels are trimmed (round masses, not tips). */
const MASS = new Set<Role>(["body", "head", "belly"]);

/** Eyes smaller than this many mini pixels are drawn as a designed dot. */
const EYE_DOT = 2.5;

/**
 * Shrink a posed raster by `f` (any real factor ≥ 1) into a `w`×`h` window
 * whose top-left sits at source pixel (`ox`, `oy`), ready to be resolved
 * (lit, lined, outlined) at its own size.
 *
 * Each output pixel samples a 4×4 grid: it's solid when enough samples land
 * on the buddy, owned by the part with the heaviest vote, and keeps that
 * part's dominant material and averaged normal — flat ramp colors, never an
 * average of finished pixels. Eyes too small to survive that are redrawn the
 * way a pixel artist would: a 1×2 ink dot that drops to one pixel when the
 * eye closes, centered where the eye was.
 */
export function shrinkRig(rig: RigDef, r: RigRaster, pose: Pose, f: number, ox: number, oy: number, w: number, h: number, cover = 0.45): RigRaster {
  const n = w * h;
  const out: RigRaster = {
    width: w,
    height: h,
    owner: new Int16Array(n).fill(-1),
    key: new Array<string>(n).fill(""),
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    nz: new Float64Array(n),
    bright: new Float64Array(n),
    placed: r.placed,
  };

  // Eye extents at full size (to pick dots over shrinking).
  const eyes = new Map<number, { x0: number; y0: number; x1: number; y1: number; sx: number; n: number; ink: string }>();
  for (let o = 0; o < r.width * r.height; o++) {
    const own = r.owner[o];
    if (own < 0 || r.placed[own].part.role !== "eye") continue;
    const x = o % r.width;
    const y = Math.floor(o / r.width);
    const e = eyes.get(own) ?? { x0: x, y0: y, x1: x, y1: y, sx: 0, n: 0, ink: r.key[o] };
    e.x0 = Math.min(e.x0, x);
    e.y0 = Math.min(e.y0, y);
    e.x1 = Math.max(e.x1, x);
    e.y1 = Math.max(e.y1, y);
    e.sx += x;
    e.n++;
    if (luma(rig, r.key[o]) < luma(rig, e.ink)) e.ink = r.key[o];
    eyes.set(own, e);
  }
  const dots = new Set<number>();
  for (const [own, e] of eyes) if ((e.x1 - e.x0 + 1) / f < EYE_DOT && (e.y1 - e.y0 + 1) / f < EYE_DOT) dots.add(own);

  const S = 4;
  const votes = new Map<number, number>();
  const sample = (x: number, y: number, i: number, j: number): number => {
    const sx = Math.floor(ox + (x + (i + 0.5) / S) * f);
    const sy = Math.floor(oy + (y + (j + 0.5) / S) * f);
    return sx < 0 || sy < 0 || sx >= r.width || sy >= r.height ? -1 : sy * r.width + sx;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      votes.clear();
      let filled = 0;
      let dotted = -1;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const o = sample(x, y, i, j);
          if (o < 0 || r.owner[o] < 0) continue;
          filled++;
          const own = r.owner[o];
          // A dotted eye's pixels count as the head under it (redrawn below).
          if (dots.has(own)) dotted = own;
          else votes.set(own, (votes.get(own) ?? 0) + (ROLE_WEIGHT[r.placed[own].part.role] ?? 1));
        }
      }
      if (filled < cover * S * S) continue;
      let best = -1;
      let bestV = 0;
      for (const [own, v] of votes) if (v > bestV || (v === bestV && own > best)) [best, bestV] = [own, v];
      if (best < 0) best = parentOf(r.placed, dotted);
      // The winner's dominant material and mean normal.
      const keys = new Map<string, number>();
      let ax = 0, ay = 0, az = 0, br = 1, cnt = 0;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const o = sample(x, y, i, j);
          if (o < 0 || r.owner[o] !== best) continue;
          keys.set(r.key[o], (keys.get(r.key[o]) ?? 0) + 1);
          ax += r.nx[o];
          ay += r.ny[o];
          az += r.nz[o];
          br = r.bright[o];
          cnt++;
        }
      }
      let key = "";
      let kc = 0;
      for (const [k, c] of keys) if (c > kc) [key, kc] = [k, c];
      if (!cnt) {
        // Only dotted eye under this pixel: borrow the head's material.
        key = firstKey(rig, r.placed[best]) ?? "";
        az = 1;
      }
      const l = Math.hypot(ax, ay, az) || 1;
      const o = y * w + x;
      out.owner[o] = best;
      out.key[o] = key;
      out.nx[o] = ax / l;
      out.ny[o] = ay / l;
      out.nz[o] = az / l;
      out.bright[o] = br;
    }
  }

  // Silhouette cleanup: a lone pixel poking up from a body or head (the
  // crown of a shrunk ellipse) is a nub, not a feature. Ears, horns and
  // antennas keep their tips.
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && out.owner[y * w + x] >= 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (out.owner[o] < 0 || !MASS.has(r.placed[out.owner[o]].part.role)) continue;
      if (solid(x, y + 1) && !solid(x, y - 1) && !solid(x - 1, y) && !solid(x + 1, y)) out.owner[o] = -1;
    }
  }

  // Dot columns, left to right; two eyes of one face keep a pixel between them.
  const cols = new Map<number, number>();
  const order = [...dots].sort((a, b) => eyes.get(a)!.sx / eyes.get(a)!.n - eyes.get(b)!.sx / eyes.get(b)!.n);
  order.forEach((own, i) => {
    const e = eyes.get(own)!;
    let x = Math.floor((e.sx / e.n + 0.5 - ox) / f);
    const prev = order[i - 1];
    if (prev !== undefined && x - cols.get(prev)! < 2) {
      // Push the pair apart, away from the face's middle.
      const px = cols.get(prev)!;
      if (px - 1 >= 0) cols.set(prev, px - 1);
      x = Math.max(x, cols.get(prev)! + 2);
    }
    cols.set(own, x);
  });

  // The dots: a column over the eye's ink rows (two at most), one pixel
  // when the eye is a lid line (closed, half, happy).
  for (const own of dots) {
    const e = eyes.get(own)!;
    const variant = pose.parts[r.placed[own].part.name]?.variant ?? "open";
    const x = cols.get(own)!;
    const yb = Math.floor((e.y1 + 0.5 - oy) / f);
    const yt = Math.floor((e.y0 + 0.5 - oy) / f);
    const rows = variant === "happy" ? [yt] : variant === "closed" || variant === "half" ? [yb] : yt < yb ? [yb - 1, yb] : [yb];
    for (const y of rows) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = y * w + x;
      out.owner[o] = own;
      out.key[o] = e.ink;
      out.nx[o] = 0;
      out.ny[o] = 0;
      out.nz[o] = 1;
      out.bright[o] = 1;
    }
  }
  return out;
}

function luma(rig: RigDef, key: string): number {
  const mat = rig.materials[key];
  if (!mat) return Infinity;
  const c = mat.ramp[mat.ramp.length - 1];
  return c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
}

function parentOf(placed: readonly Placed[], idx: number): number {
  const name = placed[idx]?.part.parent;
  const p = placed.findIndex((pl) => pl.part.name === name);
  return p >= 0 ? p : idx;
}

function firstKey(rig: RigDef, pl: Placed): string | undefined {
  const s = pl.shape;
  if (s.kind !== "grid") return s.mat;
  for (const row of s.rows) for (const ch of row) if (ch !== "." && ch !== " " && rig.materials[ch]) return ch;
  return undefined;
}
