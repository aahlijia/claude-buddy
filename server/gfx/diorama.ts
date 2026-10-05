/**
 * The buddy-shell diorama (H4, docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 * A small pixel world under the shell: the biome's sky, three parallax
 * layers (far, mid, near), the HD buddy wandering on the near ground and
 * reacting to Claude Code, and a front layer of weather particles.
 *
 *   spec (biome, size, hour, weather, buddy, seed)
 *     ├─ paintSky / paintFar / paintMid / paintNear   (slow: the light changes by the minute)
 *     ├─ beatAt(t, activity) → buddySprite            (the buddy: wander, react, think)
 *     └─ paintFront(t)                                 (weather, loops every FIELD_LOOP s)
 *   composeDiorama() stacks them into one Framebuffer (half-block and iTerm
 *   tiers, tests, the contact sheet); the kitty tier sends the layers as
 *   separate images instead (cli/diorama-panel.ts).
 *
 * Pure: no clock, no I/O. `t` is seconds on the panel's clock, `hour` the
 * wall-clock hour (0–24) the caller read.
 */

import type { Rarity, Species } from "../engine.ts";
import { biomeScene, type BiomeScene } from "./biomes.ts";
import { Framebuffer, hex, mix, type RGBA } from "./framebuffer.ts";
import { ANIM_INFO, HD_H, HD_W, headAt, renderHd, type Anim } from "./hd.ts";
import type { HdGear } from "./gear.ts";
import { FIELD_LOOP, drawField, type Field } from "./particles.ts";
import { FEET, HORIZON, biomeSeed, geo, paintGround, paintSky, paintStrokes, paintStructure, rand, type Geo } from "./scenery.ts";
import { lightAt, type Light } from "./sky.ts";

// ─── Spec ───────────────────────────────────────────────────────────────────

/** Living-world weather, as status.json's `sceneWeather` carries it. */
export const SCENE_WEATHERS = ["rain", "snow", "storm", "drizzle", "sparkle"] as const;
export type SceneWeather = (typeof SCENE_WEATHERS)[number];

export interface DioramaBuddy {
  species: Species;
  rarity: Rarity;
  shiny: boolean;
  /** Hat, weapon and trinket (gear.ts). */
  gear?: HdGear;
}

export interface DioramaSpec {
  biome: BiomeScene;
  /** Scene size in pixels. */
  w: number;
  h: number;
  /** Wall-clock hour, 0–24 (the biome may pin its own). */
  hour: number;
  weather: SceneWeather | null;
  buddy: DioramaBuddy;
  seed: number;
  /** Lightning allowed (gameFeel full, no reduceMotion). */
  flash: boolean;
  /** Particle count multiplier (half-blocks thin the weather: every drop costs cells). */
  particles: number;
}

export function dioramaSpec(o: {
  biome?: string;
  rarity: Rarity;
  species: Species;
  shiny?: boolean;
  gear?: HdGear;
  w: number;
  h: number;
  hour: number;
  weather?: SceneWeather | null;
  seed?: number;
  flash?: boolean;
  particles?: number;
}): DioramaSpec {
  return {
    biome: biomeScene(o.rarity, o.biome),
    w: o.w,
    h: o.h,
    hour: o.hour,
    weather: o.weather ?? null,
    buddy: { species: o.species, rarity: o.rarity, shiny: !!o.shiny, ...(o.gear ? { gear: o.gear } : {}) },
    seed: (o.seed ?? 1) >>> 0,
    flash: !!o.flash,
    particles: o.particles ?? 1,
  };
}

/** Parallax factors: how far each layer moves per pixel of camera pan. */
export const PARALLAX = { far: 0.25, mid: 0.55, near: 1 } as const;
export type LayerName = keyof typeof PARALLAX;

/** Extra world width each side of the screen so a panned layer never shows an edge. */
export function panMargin(w: number): number {
  return Math.ceil(w * 0.08) + 2;
}

// ─── Light ──────────────────────────────────────────────────────────────────

/** The biome's light at the spec's hour, dulled by overcast weather. */
export function dioramaLight(spec: DioramaSpec): Light {
  const l = lightAt(spec.biome.sky, spec.biome.hour ?? spec.hour);
  const overcast = spec.weather === "storm" ? 0.5 : spec.weather === "rain" || spec.weather === "snow" ? 0.3 : spec.weather === "drizzle" ? 0.15 : 0;
  if (!overcast || spec.biome.hour !== undefined) return l;
  const gray = hex("#8a92a0");
  const k = 1 - overcast * 0.35;
  return {
    ...l,
    top: mix(l.top, mix(gray, l.top, 0.4 + 0.6 * (1 - l.phase.day)), overcast),
    horizon: mix(l.horizon, gray, overcast * 0.8),
    ambient: [l.ambient[0] * k, l.ambient[1] * k, l.ambient[2] * k * 1.03],
    sun: overcast >= 0.3 ? null : l.sun,
  };
}

// ─── Layers ─────────────────────────────────────────────────────────────────

/** The sky (screen-fixed, opaque). */
export function paintSkyLayer(fb: Framebuffer, spec: DioramaSpec, light = dioramaLight(spec)): void {
  const b = spec.biome;
  paintSky(fb, geo(spec.w, spec.h), light, { sun: b.sun, moon: b.moon, stars: b.stars, seed: biomeSeed(b.name) ^ spec.seed });
}

/**
 * One parallax layer, transparent, onto `fb` whose left edge is world-x
 * `pan` (in that layer's own pixels). `fb` may be wider than the screen.
 */
export function paintLayer(fb: Framebuffer, spec: DioramaSpec, layer: LayerName, pan: number, light = dioramaLight(spec)): void {
  const b = spec.biome;
  const g: Geo = { ...geo(spec.w, spec.h, pan), w: fb.width };
  const seed = biomeSeed(b.name);
  if (layer === "far") paintStrokes(fb, g, light, b.far, 0.42, seed + 1);
  else if (layer === "mid") paintStrokes(fb, g, light, b.mid, 0.16, seed + 2);
  else {
    paintGround(fb, g, light, b.ground, seed + 3);
    paintStructure(fb, g, light, b.structure, spec.w);
    if (b.props) paintStrokes(fb, g, light, b.props, 0, seed + 4);
  }
}

/** The weather fields a spec shows (biome ambience plus living-world weather). */
export function fieldsFor(spec: DioramaSpec, light = dioramaLight(spec)): Field[] {
  const seed = (biomeSeed(spec.biome.name) ^ spec.seed) >>> 0;
  const out: Field[] = [];
  const amb = spec.biome.ambient;
  const night = light.phase.night + light.phase.dusk * 0.5;
  if (amb && (!amb.nightOnly || night > 0.5)) {
    out.push({ kind: amb.kind, seed: seed + 11, density: amb.density, colors: amb.colors?.map(hex) });
  }
  switch (spec.weather) {
    case "rain":
      out.push({ kind: "rain", seed: seed + 21 });
      break;
    case "storm":
      out.push({ kind: "rain", seed: seed + 21, density: 1.7, wind: 0.32 });
      break;
    case "drizzle":
      out.push({ kind: "rain", seed: seed + 21, density: 0.4 });
      break;
    case "snow":
      out.push({ kind: "snow", seed: seed + 22 });
      break;
    case "sparkle":
      out.push({ kind: "sparkles", seed: seed + 23, density: 1.1, colors: ["#ffffff", "#ffe890", "#b0ffd0"].map(hex) });
      break;
  }
  return out;
}

/** Lightning strength at loop time `t` (storms only, gated by `flash`). */
export function lightningAt(spec: DioramaSpec, t: number): number {
  if (spec.weather !== "storm" || !spec.flash) return 0;
  const u = (((t % FIELD_LOOP) + FIELD_LOOP) % FIELD_LOOP) / FIELD_LOOP;
  // One strike per loop (every 6 s): a bright flash and a dimmer flicker.
  if (u >= 0.62 && u < 0.645) return 1;
  if (u >= 0.67 && u < 0.69) return 0.55;
  return 0;
}

/** The front layer: weather and ambience, plus lightning. Periodic in FIELD_LOOP. */
export function paintFront(fb: Framebuffer, spec: DioramaSpec, t: number, light = dioramaLight(spec)): void {
  const u = spec.h / 18;
  for (const f of fieldsFor(spec, light)) drawField(fb, { ...f, density: (f.density ?? 1) * spec.particles }, t, u);
  const strike = lightningAt(spec, t);
  if (strike > 0) {
    // A pale wash over the scene and a forked bolt from the cloud base.
    for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) fb.blend(x, y, hex("#e8f0ff"), 0.22 * strike);
    const seed = spec.seed + 977;
    let x = fb.width * (0.3 + 0.5 * rand(seed, 0, 1));
    const bottom = HORIZON * u;
    for (let y = 0; y < bottom; y++) {
      if (y % Math.max(2, Math.round(u * 1.5)) === 0) x += (rand(seed, y, 2) - 0.5) * u * 2.2;
      fb.add(Math.round(x), y, hex("#ffffff"), strike);
      fb.add(Math.round(x) + 1, y, hex("#c8d8ff"), strike * 0.5);
    }
  }
}

/** Does the front layer have anything to draw (else kitty skips it)? */
export function hasFront(spec: DioramaSpec): boolean {
  return fieldsFor(spec).length > 0;
}

// ─── The buddy's director ───────────────────────────────────────────────────

export const REACTIONS = ["flinch", "cheer", "nod"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** How long each reaction plays (seconds); wandering pauses for it. */
export const REACTION_SECONDS: Record<Reaction, number> = { flinch: 0.9, cheer: 2.2, nod: 1.1 };

/** A span when the buddy stands still: a reaction, or Claude thinking. */
export interface Hold {
  kind: "think" | Reaction;
  from: number;
  /** End time; Infinity while still open. */
  to: number;
}

export interface Activity {
  holds: readonly Hold[];
  /** Total held seconds from holds already pruned (they still delay the wander clock). */
  heldBefore: number;
}

export const NO_ACTIVITY: Activity = { holds: [], heldBefore: 0 };

/** Which hook reasons make the buddy react (reactions.ts reasons). */
export function reactionFor(reason: string | null | undefined): Reaction | null {
  if (!reason) return null;
  if (/^(error|test-fail|lint-fail|type-error|build-fail|merge-conflict|security-warning|marathon-error|late-night-error|marathon-test-fail|weekend-conflict|debug-loop|frustrated)$/.test(reason)) return "flinch";
  if (/^(all-green|success|deploy|release|coverage|pet|buddy_pet|happy|streak-\d+|recovery-from-.*)$/.test(reason)) return "cheer";
  if (/^(commit|push|tag|late-night-commit|friday-push|branch|rebase|stash)$/.test(reason)) return "nod";
  return null;
}

export interface Beat {
  anim: Anim;
  /** Seconds into `anim`. */
  t: number;
  /** World x of the buddy's center, in near-layer pixels. */
  x: number;
  /** Face left. */
  flip: boolean;
  /** Extra downward offset in pixels (the nod). */
  dy: number;
  /** Claude is working: show the thought dots. */
  think: boolean;
  /** Seconds into the current think hold (for the dots' rhythm). */
  thinkT: number;
}

/** The wander zone (near-layer world px): right of the landmark, left of the stats card. */
export function wanderZone(w: number, reserveRight: number): [number, number] {
  const lo = Math.round(w * 0.3);
  const hi = Math.max(lo + 1, Math.round(w - reserveRight - w * 0.06));
  return [lo, hi];
}

const SEGMENT = 9; // seconds per wander leg (idle, then walk)
const WALK_UNITS_PER_S = 3.2;

function heldUntil(act: Activity, t: number): number {
  let s = act.heldBefore;
  for (const h of act.holds) if (h.from < t) s += Math.min(t, h.to) - h.from;
  return s;
}

/**
 * Where the buddy is and what it's doing at panel time `t`. Wandering runs
 * on its own clock that stops during holds, so a reaction or a long think
 * freezes the buddy in place and the walk resumes where it left off.
 */
export function beatAt(spec: DioramaSpec, t: number, zone: [number, number], act: Activity = NO_ACTIVITY, still = false): Beat {
  const [lo, hi] = zone;
  const u = spec.h / 18;
  const open = act.holds.filter((h) => h.from <= t && t < h.to);
  const react = open.filter((h) => h.kind !== "think").at(-1);
  const think = open.find((h) => h.kind === "think");
  const thinkT = think ? t - think.from : 0;
  if (still) {
    // reduceMotion: one still pose per state, standing mid-zone.
    const x = Math.round((lo + hi) / 2);
    if (react) return { anim: react.kind === "flinch" ? "hit" : react.kind === "cheer" ? "victory" : "idle", t: react.kind === "flinch" ? 0.2 : 0.3, x, flip: false, dy: 0, think: false, thinkT: 0 };
    return { anim: "idle", t: 0, x, flip: false, dy: 0, think: !!think, thinkT: 1 };
  }
  const wc = Math.max(0, t - heldUntil(act, t));
  const seed = spec.seed ^ 0x51ed;
  const at = (i: number) => lo + rand(seed, i, 1) * (hi - lo);
  const i = Math.floor(wc / SEGMENT);
  const local = wc - i * SEGMENT;
  const from = at(i);
  const to = at(i + 1);
  const speed = WALK_UNITS_PER_S * u;
  const walkDur = Math.min(SEGMENT - 2.5, Math.abs(to - from) / speed);
  const walkStart = SEGMENT - walkDur - 0.3;
  const prevDir = Math.sign(from - at(i - 1)) || 1;
  let x = from;
  let anim: Anim = "idle";
  let animT = local;
  let flip = prevDir < 0;
  if (local >= walkStart && local < walkStart + walkDur && walkDur > 0.2) {
    const k = (local - walkStart) / walkDur;
    // Ease in and out of the walk so starts and stops have weight.
    const e = k < 0.15 ? (k * k) / 0.3 : k > 0.85 ? 1 - ((1 - k) * (1 - k)) / 0.3 : (k - 0.075) / 0.85;
    x = from + (to - from) * Math.max(0, Math.min(1, e));
    anim = "walk";
    animT = local - walkStart;
    flip = to < from;
  } else if (local >= walkStart + walkDur) {
    x = to;
    flip = to < from;
    animT = local - walkStart - walkDur;
  }
  let dy = 0;
  if (react) {
    const rt = t - react.from;
    if (react.kind === "flinch") { anim = "hit"; animT = rt; }
    else if (react.kind === "cheer") { anim = "victory"; animT = rt; }
    else { anim = "idle"; animT = rt; dy = Math.max(0, Math.sin((2 * Math.PI * rt) / 0.5)) * u * 0.7 * (rt < 1 ? 1 : 0); }
  } else if (think && anim !== "walk") {
    anim = "idle";
  }
  return { anim, t: animT, x, flip, dy, think: !!think, thinkT };
}

/**
 * The beat with its pose time stepped to the frame rate the tiers animate at
 * (idle 8 fps, everything else 12), so a frame cache can key on it. Returns
 * the frame index too.
 */
export function stepBeat(beat: Beat): { beat: Beat; frame: number } {
  const info = ANIM_INFO[beat.anim];
  const fps = beat.anim === "idle" ? 8 : 12;
  const n = Math.max(1, Math.round(info.duration * fps));
  const frame = info.loop ? Math.floor(beat.t * fps) % n : Math.min(n, Math.floor(beat.t * fps));
  const t = info.loop ? (frame / n) * info.duration : frame / fps;
  const dots = beat.think ? Math.floor((beat.thinkT / 0.45) % 4) : 0;
  return { beat: { ...beat, t, thinkT: dots * 0.45 + 0.01 }, frame };
}

/** The camera pan (near-layer px) that keeps the buddy loosely centered. */
export function cameraFor(spec: DioramaSpec, beatX: number): number {
  const m = panMargin(spec.w);
  return Math.max(-m, Math.min(m, Math.round((beatX - spec.w * 0.5) * 0.2)));
}

// ─── The buddy sprite ───────────────────────────────────────────────────────

/** Integer downscale that fits the buddy into the panel (1 in kitty, 3 in half-blocks). */
export function buddyScale(h: number): number {
  return Math.max(1, Math.ceil(40 / (h * 0.8)));
}

/** Box-filter downscale by an integer factor, alpha-weighted (no dark fringes). */
export function downscale(src: Framebuffer, f: number): Framebuffer {
  if (f <= 1) return src;
  const out = new Framebuffer(Math.ceil(src.width / f), Math.ceil(src.height / f));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = 0; j < f; j++) {
        for (let i = 0; i < f; i++) {
          const c = src.get(x * f + i, y * f + j);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
          n++;
        }
      }
      // Crisp coverage: a pixel is either the block's average color or empty,
      // so the shrunken sprite keeps a hard pixel-art edge instead of a halo.
      if (a / n >= 110) out.set(x, y, [Math.round(r / a), Math.round(g / a), Math.round(b / a), 255]);
    }
  }
  return out;
}

/** Rig pixels: the ground row and center of the 64×56 HD canvas. */
const HD_GROUND = 51;
const HD_CX = HD_W / 2;

export interface BuddySprite {
  fb: Framebuffer;
  /** Screen position of the sprite's top-left, in scene pixels. */
  x: number;
  y: number;
}

/**
 * The buddy as a standalone sprite (shadow, body, thought dots) and where it
 * goes on screen for a camera pan of `cam`. Returns null for species
 * without HD art.
 */
export function buddySprite(spec: DioramaSpec, beat: Beat, cam: number): BuddySprite | null {
  const raw = renderHd(spec.buddy.species, beat.anim, beat.t, { rarity: spec.buddy.rarity, shiny: spec.buddy.shiny, seed: spec.seed, flip: beat.flip, gear: spec.buddy.gear });
  if (!raw) return null;
  // A hatted frame is taller by its headroom: everything sits that much lower.
  const top = raw.height - HD_H;
  const f = buddyScale(spec.h);
  const u = spec.h / 18;
  // Room above the head for the thought dots.
  const pad = Math.ceil((3 * u) / 1);
  const body = downscale(raw, f);
  const fb = new Framebuffer(body.width, body.height + pad);
  const gx = HD_CX / f;
  const gy = pad + (HD_GROUND + top) / f;
  fb.ellipse(gx, gy, (HD_W * 0.2) / f + 0.5, Math.max(0.6, (HD_H * 0.035) / f), [0, 0, 0, 255], 0.28);
  fb.draw(body, 0, pad);
  if (beat.think) {
    const head = headAt(spec.buddy.species) ?? [HD_CX, 20];
    const hx = (beat.flip ? HD_W - head[0] : head[0]) / f;
    const hy = pad + Math.max(0, head[1] + top - 22) / f;
    const n = Math.floor((beat.thinkT / 0.45) % 4); // 0..3 dots, then reset
    const dot = Math.max(1, Math.round(u * 0.45));
    for (let k = 0; k < n; k++) {
      const x = Math.round(hx + (k - 1) * dot * 2.2 + (beat.flip ? -dot * 2 : dot * 2));
      const y = Math.round(hy - k * dot * 0.6);
      for (let j = 0; j < dot; j++) for (let i = 0; i < dot; i++) fb.set(x + i, y + j, hex("#f4f0ff"));
    }
  }
  const x = Math.round(beat.x - cam - gx);
  const y = Math.round(FEET * u - gy + beat.dy);
  return { fb, x, y };
}

// ─── Compose ────────────────────────────────────────────────────────────────

/** A rounded card behind overlay text (stats, speech bubble), in scene px. */
export interface Plate {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGBA;
}

export function paintPlate(fb: Framebuffer, p: Plate, round = true): void {
  for (let y = p.y; y < p.y + p.h; y++) {
    for (let x = p.x; x < p.x + p.w; x++) {
      const corner = round && (x === p.x || x === p.x + p.w - 1) && (y === p.y || y === p.y + p.h - 1);
      if (!corner) fb.blend(x, y, p.color);
    }
  }
}

export interface Frame {
  t: number;
  beat: Beat;
  plates?: readonly Plate[];
}

/** Every layer stacked into one picture (half-block and iTerm tiers, tests, sheets). */
export function composeDiorama(spec: DioramaSpec, frame: Frame): Framebuffer {
  const light = dioramaLight(spec);
  const fb = new Framebuffer(spec.w, spec.h);
  const cam = cameraFor(spec, frame.beat.x);
  paintSkyLayer(fb, spec, light);
  for (const layer of ["far", "mid", "near"] as const) paintLayer(fb, spec, layer, cam * PARALLAX[layer], light);
  const b = buddySprite(spec, frame.beat, cam);
  if (b) fb.draw(b.fb, b.x, b.y);
  paintFront(fb, spec, frame.t, light);
  for (const p of frame.plates ?? []) paintPlate(fb, p);
  return fb;
}
