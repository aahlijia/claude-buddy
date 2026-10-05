/**
 * The HD fight stage (H2, docs/game-feel/hd-overhaul/h2-quest-player.md).
 *
 * The cell stage (stage.ts) draws characters; this one draws pixels. Both
 * are driven by the same director cues (anim.ts), so the choreography stays
 * the single source of truth for *what* happens and *when*. This module adds
 * the console-game layer on top:
 *
 *   cues ──► hdTimeline() ──► sceneAt(ms) ──► renderScene() ──► encodeStage()
 *            (anim segments,   (one instant:   (Framebuffer,     (half-block lines,
 *             hit-stop,         actors, fx,     SCENE_W×SCENE_H)  or a kitty /
 *             camera, shake,    pops, bars)                       iTerm image)
 *             particles, bars)
 *
 * Everything here is pure: a scene is a function of the cues, the cast and a
 * time in ms. The only state is a bounded cache of rendered actor frames.
 */

import type { Rarity, Species } from "../engine";
import { glow } from "../gfx/blob.ts";
import { easeInOutCubic, easeOutBack, easeOutCubic, span } from "../gfx/ease.ts";
import type { ColorMode } from "../gfx/encode/halfblock.ts";
import { encodeHalfblock } from "../gfx/encode/halfblock.ts";
import { encodeIterm } from "../gfx/encode/iterm.ts";
import { encodeKitty } from "../gfx/encode/kitty.ts";
import { drawText, textWidth } from "../gfx/font.ts";
import { Framebuffer, hex, mix, type RGBA } from "../gfx/framebuffer.ts";
import { ANIM_INFO, hasHd, headAt, renderHd, topAt, type Anim } from "../gfx/hd.ts";
import { drawParticles, particleLife, particlesAt, type Emitter } from "../gfx/particles.ts";
import { tmuxWrap } from "../gfx/detect.ts";
import type { Cue } from "./anim";
import type { Battle, Side } from "./battle";
import { EYES, marksOf, restPose, type ActorState, type Ink, type Marks, type Mote, type StageState, type Tint } from "./stage";

// ─── Geometry ───────────────────────────────────────────────────────────────

/** Logical scene size in pixels. */
export const SCENE_W = 120;
export const SCENE_H = 60;
/** The terminal box the stage occupies in every tier (half-block shows the
 *  scene at half resolution: one pixel per column, two per row). */
export const STAGE_COLS = SCENE_W / 2;
export const STAGE_ROWS = SCENE_H / 4;

/** Actor canvases are the 64×56 HD canvas; their top sits this far down. */
const ACTOR_TOP = 4;
/** Ground line in scene pixels (rig ground 51 + ACTOR_TOP). */
export const GROUND_Y = 55;
const HOME: Record<Side, number> = { hero: 0, foe: 56 };
/** Body center (x) of each side at rest, in scene pixels. */
const CENTER: Record<Side, number> = { hero: 30, foe: 89 };
/** Rough top of the head per species (scene y at rest), for marks and pops.
 *  The H1 pilots keep their hand-tuned values; the rest are measured. */
const HEAD_Y: Partial<Record<Species, number>> = { blob: 22, cat: 19, dragon: 15 };
const headTop = (species: Species): number => HEAD_Y[species] ?? Math.max(10, (topAt(species) ?? 18) + ACTOR_TOP);
/** Body middle (scene y), where blows land. */
const BODY_Y = 38;
/** One stage cell of director offset, in scene pixels. */
const CELL_PX = 4;

// ─── Cast and feel ──────────────────────────────────────────────────────────

export interface HdFighter {
  species: Species;
  rarity: Rarity;
  shiny: boolean;
  /** A stand-in: the HD blob recolored by this hue (foes without a rig). */
  hue?: number;
}

export interface HdCast {
  hero: HdFighter;
  foe: HdFighter;
  boss: boolean;
  kind: Battle["kind"];
  seed: number;
}

/** Which juice is allowed (the accessibility gate). */
export interface HdFeel {
  shake: boolean;
  flash: boolean;
  camera: boolean;
  /** Special-move cut-ins (full only: they interrupt the fight ~700 ms). */
  cutin: boolean;
}

/**
 * gameFeel `off` → no HD at all (ASCII, as before); `subtle` → HD with the
 * camera but no shake, no flashes and no cut-ins; `full` → everything.
 * `reduceMotion` keeps the HD art but drops shake, flashes, camera moves and
 * cut-ins.
 */
export function hdFeel(gameFeel: string | undefined, reduceMotion = false): HdFeel | null {
  if (gameFeel === "off") return null;
  if (reduceMotion) return { shake: false, flash: false, camera: false, cutin: false };
  if (gameFeel === "full") return { shake: true, flash: true, camera: true, cutin: true };
  return { shake: false, flash: false, camera: true, cutin: false };
}

/** Hue for a stand-in foe: stable per species, never the hero's mint. */
export function standInHue(species: Species): number {
  let h = 0;
  for (const ch of species) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 70 + (h % 220);
}

/**
 * Who gets drawn in HD. The hero needs real HD art (we never stand in for
 * the player's own buddy). A foe without a rig is drawn as a recolored HD
 * blob — a "bug slime" — so one scene never mixes pixels and ASCII.
 * Returns null when the fight stays on the ASCII stage.
 */
export function hdCast(b: Battle, look: { species: Species; rarity?: Rarity; shiny?: boolean }): HdCast | null {
  if (!hasHd(look.species)) return null;
  const real = hasHd(b.foe.species);
  return {
    hero: { species: look.species, rarity: look.rarity ?? "common", shiny: !!look.shiny },
    foe: {
      species: real ? b.foe.species : "blob",
      rarity: b.foe.boss ? "epic" : "common",
      shiny: false,
      hue: real ? undefined : standInHue(b.foe.species),
    },
    boss: !!b.foe.boss,
    kind: b.kind,
    seed: b.seed >>> 0,
  };
}

// ─── Scene ──────────────────────────────────────────────────────────────────

export interface HdActor {
  anim: Anim;
  /** Seconds into `anim`. */
  t: number;
  /** Offset from home, scene pixels. */
  x: number;
  y: number;
  tint?: Tint;
  hidden?: boolean;
}

export interface HdPop {
  text: string;
  x: number;
  y: number;
  color: RGBA;
  /** Center on x (default) or left-align. */
  left?: boolean;
}

export interface HdProjectile {
  kind: "bomb" | "duck";
  x: number;
  y: number;
}

/** One instant of the fight, fully resolved. */
export interface HdScene {
  hero: HdActor;
  foe: HdActor;
  marks: Marks;
  /** Particle clock (seconds) and the bursts alive around it. */
  pt: number;
  emitters: Emitter[];
  pops: HdPop[];
  projectiles: HdProjectile[];
  /** Camera: zoom about (cx, cy) in scene pixels. */
  cam: { zoom: number; cx: number; cy: number };
  /** Shake offset in scene pixels. */
  shake: [number, number];
  /** Full-screen white flash, 0..1. */
  flash: number;
  /** Encounter wipe progress 0..1 (undefined = none). */
  wipe?: number;
  /** Ambient clock (seconds) for orbiting stars and pulses. */
  clock: number;
  /** A special-move cut-in playing: progress 0..1 (undefined = none). */
  cutin?: { name: string; by: Side; k: number };
  /** A boss phase change playing: progress 0..1 (undefined = none). */
  phase?: number;
}

const REST_CAM = { zoom: 1, cx: SCENE_W / 2, cy: SCENE_H / 2 };

const INK_RGB: Record<Ink, RGBA> = {
  red: hex("#ff5a5a"),
  green: hex("#6ee07a"),
  yellow: hex("#ffe066"),
  blue: hex("#6aa8ff"),
  magenta: hex("#ff7ae0"),
  cyan: hex("#6ae8ff"),
  dim: hex("#9a96b0"),
  gray: hex("#b0b0b0"),
  white: hex("#ffffff"),
  gold: hex("#ffd25a"),
  crit: hex("#fff07a"),
  hurt: hex("#ff4a4a"),
  heal: hex("#7cff8e"),
  shield: hex("#7ae8ff"),
};

const TINT_RGB: Record<Tint, [RGBA, number]> = {
  flash: [hex("#ffffff"), 0.7],
  hurt: [hex("#ff3030"), 0.22],
  heal: [hex("#60ff80"), 0.35],
  glow: [hex("#ffd040"), 0.3],
  dim: [hex("#302c40"), 0.45],
  poison: [hex("#40d040"), 0.4],
  rage: [hex("#ff2020"), 0.3],
  magic: [hex("#e050ff"), 0.35],
};

const SKY: Record<Battle["kind"], [string, string]> = {
  explore: ["#120e2c", "#3c2a5c"],
  boss: ["#1e0a14", "#5a1a2a"],
  tower: ["#0a1430", "#2a3a6a"],
  hunt: ["#0c1e1a", "#2a4a3a"],
  event: ["#1e1408", "#5a3a1a"],
};

// ─── Actor frames (cached) ──────────────────────────────────────────────────

const FPS = 60;
const cache = new Map<string, Framebuffer>();
const CACHE_MAX = 600;

/** One actor frame. `t` is quantized to 1/60 s so renders are cacheable. */
export function actorFrame(f: HdFighter, anim: Anim, t: number, flip: boolean, seed: number): Framebuffer {
  const q = Math.max(0, Math.round(t * FPS));
  const key = `${f.species}|${f.rarity}|${f.shiny ? 1 : 0}|${f.hue ?? ""}|${anim}|${q}|${flip ? 1 : 0}|${seed}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const fb = renderHd(f.species, anim, q / FPS, { rarity: f.rarity, shiny: f.shiny, seed, flip, hue: f.hue }) ?? new Framebuffer(64, 56);
  cache.set(key, fb);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return fb;
}

function tinted(src: Framebuffer, tint: Tint): Framebuffer {
  const [c, k] = TINT_RGB[tint];
  const out = new Framebuffer(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3];
    if (!a) continue;
    let r = src.data[i];
    let g = src.data[i + 1];
    let b = src.data[i + 2];
    if (tint === "dim") {
      const l = r * 0.3 + g * 0.55 + b * 0.15;
      r = g = b = l;
    }
    out.data[i] = r + (c[0] - r) * k;
    out.data[i + 1] = g + (c[1] - g) * k;
    out.data[i + 2] = b + (c[2] - b) * k;
    out.data[i + 3] = a;
  }
  return out;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function drawBackdrop(fb: Framebuffer, cast: HdCast): void {
  const [top, bottom] = SKY[cast.kind] ?? SKY.explore;
  fb.gradient(hex(top), hex(bottom));
  // A few fixed stars, seeded per fight.
  let s = cast.seed || 1;
  for (let i = 0; i < 18; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const x = s % SCENE_W;
    const y = (s >>> 8) % (GROUND_Y - 22);
    fb.add(x, y, hex("#fff6d0"), 0.25 + ((s >>> 16) % 50) / 100);
  }
  // Floor: lit edge, two-tone dither, darker toward the front.
  const lit = hex("#5a5078");
  const g1 = hex("#2e2846");
  const g2 = hex("#1e1a30");
  for (let y = GROUND_Y; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const deep = y - GROUND_Y > 2 || (y - GROUND_Y === 2 && (x + y) % 2 === 0);
      fb.set(x, y, y === GROUND_Y ? lit : deep ? g2 : g1);
    }
  }
}

function drawActor(fb: Framebuffer, cast: HdCast, side: Side, a: HdActor): void {
  if (a.hidden) return;
  const f = cast[side];
  let frame = actorFrame(f, a.anim, a.t, side === "foe", cast.seed ^ (side === "foe" ? 0x5f3 : 0));
  if (a.tint) frame = tinted(frame, a.tint);
  fb.draw(frame, HOME[side] + Math.round(a.x), ACTOR_TOP + Math.round(a.y));
}

function headY(cast: HdCast, side: Side): number {
  return headTop(cast[side].species);
}

/** Persistent conditions, drawn in pixels: shields, stars, auras. */
function drawMarks(fb: Framebuffer, s: HdScene, cast: HdCast, front: boolean): void {
  const mk = s.marks;
  const hx = CENTER.hero + s.hero.x;
  const fx = CENTER.foe + s.foe.x;
  if (!front) {
    if (cast.boss || mk.enraged) {
      const pulse = 0.7 + 0.3 * Math.sin(s.clock * 3);
      glow(fb, fx, BODY_Y - 4 + s.foe.y, 30, hex(mk.enraged ? "#ff3030" : "#c03050"), (mk.enraged ? 0.5 : 0.3) * pulse);
    }
    if (mk.charge) glow(fb, fx, BODY_Y + s.foe.y, 24, hex("#ffb040"), 0.18 * mk.charge * (0.75 + 0.25 * Math.sin(s.clock * 9)));
    if (mk.buff && !s.hero.hidden) glow(fb, hx, BODY_Y + s.hero.y, 22, hex("#ffd25a"), 0.18);
    return;
  }
  const shield = (x: number, y: number, c: RGBA, dir: number) => {
    for (let dy = -13; dy <= 13; dy++) {
      const bulge = Math.round(4 * Math.cos((dy / 13) * (Math.PI / 2)));
      const px = x + dir * bulge;
      fb.add(px, y + dy, c, 0.75);
      fb.blend(px - dir, y + dy, c, 0.25);
      fb.blend(px - 2 * dir, y + dy, c, 0.12);
    }
  };
  if (mk.guard && !s.hero.hidden) shield(hx + 24, BODY_Y + s.hero.y, INK_RGB.shield, 1);
  if (mk.foeShield) shield(fx - 25, BODY_Y + s.foe.y, INK_RGB.cyan, -1);
  if (mk.stun) {
    const y0 = headY(cast, "foe") - 3 + s.foe.y;
    for (let i = 0; i < 3; i++) {
      const a = s.clock * 4 + (i * Math.PI * 2) / 3;
      const x = Math.round(fx + Math.cos(a) * 10);
      const y = Math.round(y0 + Math.sin(a) * 2.5);
      const c = INK_RGB.yellow;
      fb.set(x, y, c);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) fb.add(x + ox, y + oy, c, 0.6);
    }
  }
  if (mk.poison && !s.hero.hidden) {
    // A slow periodic trickle of bubbles: one burst per 0.9 s slot.
    const slot = Math.floor(s.clock / 0.9);
    for (const k of [slot - 1, slot]) {
      for (const p of particlesAt({ kind: "bubble", x: hx, y: headY(cast, "hero") + 4, t0: k * 0.9, seed: k, count: 3 }, s.clock)) {
        fb.blend(Math.round(p.x), Math.round(p.y), p.color, p.alpha);
      }
    }
  }
}

/** Marks that read as text (charge `!!!`, cursed `?`, buff `↑`). */
function markPops(s: HdScene, cast: HdCast): HdPop[] {
  const out: HdPop[] = [];
  const mk = s.marks;
  if (mk.charge) {
    const n = Math.max(1, Math.min(3, mk.charge - (Math.floor(s.clock * 2) % 2)));
    out.push({ text: "!".repeat(n), x: CENTER.foe + s.foe.x, y: headY(cast, "foe") - 10 + s.foe.y, color: INK_RGB.gold });
  }
  if (!s.hero.hidden) {
    const tags: [string, RGBA][] = [];
    if (mk.blind) tags.push(["?", INK_RGB.magenta]);
    if (mk.buff) tags.push(["↑", INK_RGB.yellow]);
    tags.forEach(([t, c], i) => out.push({ text: t, x: CENTER.hero + s.hero.x - 8 + i * 6, y: headY(cast, "hero") - 9 + s.hero.y, color: c }));
  }
  return out;
}

function drawProjectile(fb: Framebuffer, p: HdProjectile): void {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (p.kind === "bomb") {
    fb.ellipse(x, y, 3.5, 3.5, hex("#2a2838"));
    fb.set(x - 1, y - 2, hex("#8a88a0"));
    fb.set(x + 2, y - 4, hex("#ffd25a"));
    fb.add(x + 3, y - 5, hex("#ff8a30"), 0.8);
  } else {
    fb.ellipse(x, y, 4, 3, hex("#ffd84a"));
    fb.ellipse(x + 2, y - 3, 2.2, 2, hex("#ffe070"));
    fb.set(x + 3, y - 3, hex("#1e1830"));
    fb.set(x + 5, y - 2, hex("#ff8a30"));
    fb.set(x + 4, y - 2, hex("#ff8a30"));
  }
}

/** Rasterize a scene at logical resolution (no camera, no text yet). */
export function renderScene(cast: HdCast, s: HdScene): Framebuffer {
  const fb = new Framebuffer(SCENE_W, SCENE_H);
  drawBackdrop(fb, cast);
  drawMarks(fb, s, cast, false);
  // The attacker draws over the defender while it's in the defender's space.
  const heroFront = s.hero.x > 0 || s.hero.anim === "attack";
  // Boss phase change: everything but the boss sinks into shadow, and a
  // pulsing glow swells behind it.
  const order: Side[] = s.phase === undefined && heroFront && s.foe.anim !== "attack" ? ["foe", "hero"] : ["hero", "foe"];
  for (const side of order) {
    if (s.phase !== undefined && side === "foe") phaseBackdrop(fb, s);
    drawActor(fb, cast, side, s[side]);
  }
  drawMarks(fb, s, cast, true);
  for (const p of s.projectiles) drawProjectile(fb, p);
  drawParticles(fb, s.emitters, s.pt);
  return fb;
}

/** Phase-change dim (0 → 0.6 → 0) and the boss's swelling red glow. */
function phaseBackdrop(fb: Framebuffer, s: HdScene): void {
  const k = s.phase!;
  const dim = 0.72 * Math.min(easeOutCubic(span(k, 0, 0.25)), 1 - easeInOutCubic(span(k, 0.8, 1)));
  const shade = hex("#05030a");
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) fb.blend(x, y, shade, dim);
  const swell = easeOutCubic(span(k, 0.15, 0.55)) * (1 - easeInOutCubic(span(k, 0.85, 1)));
  const pulse = 0.8 + 0.2 * Math.sin(k * 40);
  glow(fb, CENTER.foe + s.foe.x, BODY_Y - 8 + s.foe.y, 22 + 18 * swell, hex("#ff3050"), 0.9 * swell * pulse);
}

/** Camera + shake: resample around (cx, cy). Identity is a no-op. */
function camera(src: Framebuffer, cam: HdScene["cam"], shake: [number, number]): Framebuffer {
  const sx = Math.round(shake[0]);
  const sy = Math.round(shake[1]);
  if (cam.zoom === 1 && cam.cx === SCENE_W / 2 && cam.cy === SCENE_H / 2 && !sx && !sy) return src;
  const out = new Framebuffer(src.width, src.height);
  const w = src.width;
  const h = src.height;
  for (let y = 0; y < h; y++) {
    const yy = Math.max(0, Math.min(h - 1, Math.floor(cam.cy + (y + 0.5 - h / 2) / cam.zoom + sy)));
    for (let x = 0; x < w; x++) {
      const xx = Math.max(0, Math.min(w - 1, Math.floor(cam.cx + (x + 0.5 - w / 2) / cam.zoom + sx)));
      const si = (yy * w + xx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

/** 2×2 box downsample (alpha-weighted) for the half-block tier. */
export function downsample2(src: Framebuffer): Framebuffer {
  const out = new Framebuffer(Math.floor(src.width / 2), Math.floor(src.height / 2));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const si = ((2 * y + j) * src.width + 2 * x + i) * 4;
          const sa = src.data[si + 3];
          r += src.data[si] * sa;
          g += src.data[si + 1] * sa;
          b += src.data[si + 2] * sa;
          a += sa;
        }
      }
      const di = (y * out.width + x) * 4;
      if (a) {
        out.data[di] = r / a;
        out.data[di + 1] = g / a;
        out.data[di + 2] = b / a;
        out.data[di + 3] = a / 4;
      }
    }
  }
  return out;
}

/**
 * The finished frame for a tier: scene → camera/shake → (half-block:
 * downsample) → text pops → flash. Text is drawn after the camera at the
 * output resolution, so it stays crisp in every tier.
 */
export function composeFrame(cast: HdCast, s: HdScene, half: boolean): Framebuffer {
  let fb = camera(renderScene(cast, s), s.cam, s.shake);
  if (half) fb = downsample2(fb);
  const k = half ? 0.5 : 1;
  const scale = half ? 1 : 2;
  const toOut = (x: number, y: number): [number, number] => [
    ((x - s.cam.cx - s.shake[0]) * s.cam.zoom + SCENE_W / 2) * k,
    ((y - s.cam.cy - s.shake[1]) * s.cam.zoom + SCENE_H / 2) * k,
  ];
  for (const p of [...markPops(s, cast), ...s.pops]) {
    const [ox, oy] = toOut(p.x, p.y);
    const w = textWidth(p.text, scale);
    const x = Math.max(0, Math.min(fb.width - w, p.left ? ox : ox - w / 2));
    const y = Math.max(1, Math.min(fb.height - 5 * scale - 1, oy));
    drawText(fb, p.text, Math.round(x), Math.round(y), p.color, { scale, outline: hex("#140c1e") });
  }
  if (s.wipe !== undefined) drawWipe(fb, s.wipe, cast.boss);
  if (s.cutin) drawCutin(fb, cast, s.cutin, half);
  if (s.phase !== undefined) drawPhaseTitle(fb, s.phase, half);
  if (s.flash > 0) {
    const white = hex("#ffffff");
    for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) fb.blend(x, y, white, s.flash);
  }
  return fb;
}

/**
 * The special-move cut-in (brainstorm §3.4): a diagonal panel slams in from
 * the attacker's side with the buddy's close-up, speed lines streak across
 * it, the move name lands in big type, and the panel exits the far side.
 * Drawn at output resolution over the frozen fight.
 */
function drawCutin(fb: Framebuffer, cast: HdCast, c: NonNullable<HdScene["cutin"]>, half: boolean): void {
  const W = fb.width;
  const H = fb.height;
  const u = W / SCENE_W; // 1 at full res, 0.5 at half
  const k = c.k;
  const foe = c.by === "foe";
  const enter = easeOutCubic(span(k, 0, 0.16));
  const leave = easeInOutCubic(span(k, 0.84, 1));
  const shift = (1 - enter) * -W * 1.2 + leave * W * 1.2;
  // The fight behind darkens while the panel is up.
  const dim = 0.5 * Math.min(enter, 1 - leave);
  const shade = hex("#05030a");
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fb.blend(x, y, shade, dim);

  // The panel is laid out for the hero (entering from the left); a foe's
  // is the mirror image, entering from the right with a red edge.
  const f = cast[c.by];
  const accent = foe ? hex("#ff5a6a") : hex(RIM_HEX[f.rarity]);
  const top = Math.round(H * 0.2);
  const bot = Math.round(H * 0.8);
  const slant = Math.round(14 * u);
  const edge = (y: number) => slant * (1 - (y - top) / Math.max(1, bot - top)); // left edge leans
  const ink = hex("#120c22");
  const band = foe ? hex("#4a1c2a") : hex("#2a1c4a");
  const layer = new Framebuffer(W, H);
  for (let y = top; y < bot; y++) {
    const x0 = Math.round(edge(y) + shift);
    const x1 = Math.round(W - slant + edge(y) + shift);
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      const stripe = (x + y * 2) % Math.round(10 * u + 2) < 2;
      layer.set(x, y, y === top || y === bot - 1 ? accent : stripe ? mix(band, ink, 0.4) : mix(band, ink, (y - top) / (bot - top)));
    }
  }
  // Speed lines: fast streaks racing across the band.
  for (let i = 0; i < 12; i++) {
    const y = top + 2 + Math.floor(((i * 37) % 97) / 97 * (bot - top - 4));
    const len = Math.round((10 + ((i * 13) % 20)) * u);
    const x = Math.round(((i * 53 + k * 900 * u * (1 + (i % 3))) % (W + len)) - len + shift);
    for (let j = 0; j < len; j++) layer.blend(x + j, y, hex("#ffffff"), 0.25 + 0.5 * (j / len));
  }
  // The close-up: the fighter's bust (facing right), drifting forward a little.
  const bust = portraitFor(f, half);
  const px = Math.round(W * 0.06 + shift + k * 4 * u);
  if (bust) layer.draw(bust, px, Math.round(bot - bust.height));
  fb.draw(foe ? flipH(layer) : layer, 0, 0);

  // The move name, sliding in a beat after the panel, beside the bust:
  // big type, wrapped onto two lines when it doesn't fit on one.
  const name = c.name.toUpperCase();
  const left = Math.round(W * 0.06 + (bust?.width ?? 0) + 4 * u);
  const room = W - left - 3;
  const scale = half ? 1 : 2;
  const lines = textWidth(name, scale) <= room ? [name] : wrapWords(name, (w) => textWidth(w, scale) <= room);
  const lh = 6 * scale + 1;
  const land = easeOutBack(span(k, 0.12, 0.34));
  const tw = Math.max(...lines.map((l) => textWidth(l, scale)));
  const heroX = Math.round(Math.min(W - tw - 2, left) + (1 - land) * W * 0.5 + leave * W * 1.2);
  const tx = foe ? W - heroX - tw : heroX;
  const ty = Math.round(H / 2 - (lines.length * lh) / 2 + 3 * u);
  lines.forEach((l, i) => {
    // Right-align a foe's lines against the bust.
    const lx = foe ? tx + tw - textWidth(l, scale) : tx;
    drawText(fb, l, lx + scale, ty + i * lh + scale, ink, { scale });
    drawText(fb, l, lx, ty + i * lh, hex("#fff6c8"), { scale, outline: ink });
  });
  const label = foe ? "DANGER" : "SPECIAL";
  drawText(fb, label, foe ? tx + tw - textWidth(label) : tx, ty - 8, accent, { scale: 1, outline: ink, opacity: Math.min(1, land) });
}

function flipH(src: Framebuffer): Framebuffer {
  const out = new Framebuffer(src.width, src.height);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) out.set(src.width - 1 - x, y, src.get(x, y));
  return out;
}

/** Greedy word wrap: as many words per line as `fits` allows. */
function wrapWords(text: string, fits: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (const w of text.split(" ")) {
    const last = out[out.length - 1];
    if (last !== undefined && fits(`${last} ${w}`)) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  return out;
}

const RIM_HEX: Record<Rarity, string> = { common: "#c8c4d8", uncommon: "#7ee69a", rare: "#b1b9f9", epic: "#c8a0ff", legendary: "#ffd25a" };

const bustCache = new Map<string, Framebuffer | null>();

/** The fighter's head and shoulders, cut from its idle pose. */
function portraitFor(f: HdFighter, half: boolean): Framebuffer | null {
  const key = `${f.species}|${f.rarity}|${f.shiny}|${f.hue ?? ""}|${half}`;
  if (bustCache.has(key)) return bustCache.get(key)!;
  const full = renderHd(f.species, "idle", 0, { rarity: f.rarity, shiny: f.shiny, hue: f.hue });
  let out: Framebuffer | null = null;
  if (full) {
    // Crop the top of the sprite: the head and shoulders.
    let top = full.height;
    let x0 = full.width;
    let x1 = 0;
    for (let y = 0; y < full.height; y++) for (let x = 0; x < full.width; x++) if (full.get(x, y)[3] >= 200) { top = Math.min(top, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    // Center on the head (rigs pivot it at the neck, under the face).
    const W = 34;
    const H = 34;
    const head = headAt(f.species);
    const cx = Math.round(head ? head[0] + 3 : (x0 + x1) / 2);
    out = new Framebuffer(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = full.get(cx - W / 2 + x, top - 1 + y);
      if (c[3]) out.set(x, y, c);
    }
    if (half) out = downsample2(out);
  }
  bustCache.set(key, out);
  return out;
}

/** "PHASE 2" lands over the dimmed stage while the boss powers up. */
function drawPhaseTitle(fb: Framebuffer, k: number, half: boolean): void {
  const show = Math.min(easeOutBack(span(k, 0.3, 0.5)), 1 - easeInOutCubic(span(k, 0.85, 1)));
  if (show <= 0) return;
  const scale = half ? 1 : 2;
  const text = "PHASE 2";
  const w = textWidth(text, scale);
  const x = Math.round((fb.width - w) / 2);
  const y = Math.round(fb.height * 0.12 - (1 - show) * 6 * scale);
  drawText(fb, text, x, y, hex("#ff5a6a"), { scale, outline: hex("#14040a"), opacity: Math.min(1, show) });
}

function drawWipe(fb: Framebuffer, w: number, boss: boolean): void {
  const span2 = fb.width + 2 * fb.height + 30;
  const pos = w * span2;
  const unit = fb.width / SCENE_W; // stripes keep their size at half res
  const [c1, c2] = boss ? [hex("#ff3a4a"), hex("#7a1020")] : [hex("#d070ff"), hex("#4a2080")];
  const black = hex("#06040c");
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const d = pos - (x + 2 * y);
      if (d >= 30 * unit) continue;
      const c = d < 0 ? black : d < 18 * unit ? (Math.floor((x - y) / (3 * unit)) % 2 ? c1 : c2) : mix(c2, black, 0.5);
      fb.set(x, y, c);
    }
  }
}

// ─── Encoding ───────────────────────────────────────────────────────────────

export type PixelTier = "kitty" | "iterm" | "halfblock";

export interface HdPaint {
  tier: PixelTier;
  color: ColorMode;
  tmux: boolean;
  feel: HdFeel;
}

/** Kitty image id the stage reuses (each frame swaps in place). */
export const KITTY_STAGE_ID = 4242;

export interface StageOut {
  /** STAGE_ROWS lines, each STAGE_COLS cells wide (plain spaces for pixel tiers). */
  lines: string[];
  /** Pixel tiers: appended to the stage's last line after layout — places
   *  the image over the reserved box and returns the cursor. */
  suffix?: string;
}

/** Encode a scene for the terminal tier. */
export function encodeStage(cast: HdCast, s: HdScene, hd: Pick<HdPaint, "tier" | "color" | "tmux">): StageOut {
  if (hd.tier === "halfblock") {
    return { lines: encodeHalfblock(composeFrame(cast, s, true), { color: hd.color }) };
  }
  const fb = composeFrame(cast, s, false);
  let img = hd.tier === "kitty" ? encodeKitty(fb, { id: KITTY_STAGE_ID, placement: 1, cols: STAGE_COLS, rows: STAGE_ROWS }) : encodeIterm(fb, { cols: STAGE_COLS, rows: STAGE_ROWS });
  if (hd.tmux) img = tmuxWrap(img);
  const up = STAGE_ROWS - 1;
  const ESC = "\x1b[";
  return {
    lines: Array.from({ length: STAGE_ROWS }, () => " ".repeat(STAGE_COLS)),
    suffix: `${ESC}${STAGE_COLS}D${up ? `${ESC}${up}A` : ""}${img}${up ? `${ESC}${up}B` : ""}${ESC}${STAGE_COLS}C`,
  };
}

// ─── Timeline: cues → scenes ────────────────────────────────────────────────

/** Sub-frame step: the cell stage holds a pose per cue; HD tweens between. */
export const STEP_MS = 33;
/** Hit-stop range (ms), scaled by damage. */
export const HITSTOP_MIN = 60;
export const HITSTOP_MAX = 120;
/** Never more than 3 full-screen flashes per second (photosensitivity). */
export const FLASH_GAP_MS = 334;
const SHAKE_MAX = 3;

export interface Segment {
  anim: Anim | "hidden";
  /** Real ms the segment starts. */
  start: number;
  /** Attack only: the real ms the blow lands (anim time = impact here). */
  impactAt?: number;
}

interface Freeze {
  at: number;
  ms: number;
}

/** A cinematic beat inserted before a cue: real time passes, motion stops. */
export interface Hold {
  at: number;
  ms: number;
  kind: "cutin" | "phase";
  name?: string;
  by?: Side;
}

/** Special-move cut-in length (ms): slide in, hold the name, slide out. */
export const CUTIN_MS = 700;
/** Boss phase change: the stage dims, the boss glows, then it roars. */
export const PHASE_MS = 1100;

interface CamEvent {
  at: number;
  until: number;
  zoom: number;
  cx: number;
  cy: number;
}

interface Trauma {
  at: number;
  amount: number;
}

export interface Timeline {
  cast: HdCast;
  cues: readonly Cue[];
  /** Real start ms of each cue. */
  starts: number[];
  /** Length of the directed cues (ms). */
  cueMs: number;
  /** Cue length plus a settle tail that lets one-shot animations finish. */
  total: number;
  freezes: Freeze[];
  /** Cut-ins and boss phase changes (each also a freeze). */
  holds: Hold[];
  segments: Record<Side, Segment[]>;
  emitters: Emitter[];
  cams: CamEvent[];
  traumas: Trauma[];
  flashes: number[];
  /** Resolved actor state per cue (rest pose + cue overrides). */
  actors: Record<Side, ActorState[]>;
  /** Stage geometry of the cell stage (maps mote rows/cols to pixels). */
  cell: { width: number; height: number };
  maxHp: [number, number];
}

/** Hit-stop length for a blow: 60–120 ms, scaled by the share of HP it took. */
export function hitStopMs(dmg: number, maxHp: number, crit: boolean, heavy: boolean): number {
  const share = maxHp > 0 ? Math.min(1, (3 * dmg) / maxHp) : 0;
  const ms = HITSTOP_MIN + (HITSTOP_MAX - HITSTOP_MIN) * share + (crit ? 25 : heavy ? 12 : 0);
  return Math.round(Math.max(HITSTOP_MIN, Math.min(HITSTOP_MAX, ms)));
}

const other = (s: Side): Side => (s === "hero" ? "foe" : "hero");
const dirOf = (s: Side) => (s === "hero" ? 1 : -1);

function seedOf(base: number, i: number, salt: number): number {
  return (Math.imul(base ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ salt) >>> 0;
}

/** Map director cues to an HD timeline. Pure. */
export function hdTimeline(
  cues: readonly Cue[],
  cast: HdCast,
  feel: HdFeel,
  opts: { maxHp: [number, number]; cell: { width: number; height: number } },
): Timeline {
  const starts: number[] = [];
  const holds: Hold[] = [];
  let acc = 0;
  for (const c of cues) {
    const hd = c.stage.hd;
    if (hd?.phase && cast.boss) {
      holds.push({ at: acc, ms: PHASE_MS, kind: "phase" });
      acc += PHASE_MS;
    }
    if (hd?.cutin && feel.cutin) {
      holds.push({ at: acc, ms: CUTIN_MS, kind: "cutin", name: hd.cutin.name, by: hd.cutin.by });
      acc += CUTIN_MS;
    }
    starts.push(acc);
    acc += c.ms;
  }
  const cueMs = acc;
  const actors: Record<Side, ActorState[]> = { hero: [], foe: [] };
  for (const c of cues) {
    const mk = c.stage.marks ?? {};
    for (const side of ["hero", "foe"] as const) actors[side].push({ ...restPose(side, mk), ...c.stage[side] });
  }

  // Hit-stop freezes and impacts; cinematic holds freeze the fight too.
  const freezes: Freeze[] = holds.map((h) => ({ at: h.at, ms: h.ms }));
  const emitters: Emitter[] = [];
  const cams: CamEvent[] = [];
  const traumas: Trauma[] = [];
  const flashCandidates: number[] = [];
  const impacts: { i: number; by: Side; ranged: boolean }[] = [];
  cues.forEach((c, i) => {
    const im = c.stage.hd?.impact;
    if (!im) return;
    const def = other(im.by);
    const ms = Math.min(hitStopMs(im.dmg, opts.maxHp[def === "hero" ? 0 : 1], im.crit, im.heavy), Math.max(0, c.ms - 16));
    if (ms > 0) freezes.push({ at: starts[i], ms });
    impacts.push({ i, by: im.by, ranged: !!im.ranged });
  });
  const motion = (T: number) => {
    let m = T;
    for (const f of freezes) m -= Math.max(0, Math.min(T, f.at + f.ms) - f.at);
    return m;
  };

  // Particles, camera, shake and flashes for each impact.
  for (const { i, by } of impacts) {
    const im = cues[i].stage.hd!.impact!;
    const def = other(by);
    const k = dirOf(by);
    const fz = freezes.find((f) => f.at === starts[i]);
    const resume = starts[i] + (fz?.ms ?? 0);
    const dx = actors[def][i].x ?? 0;
    emitters.push({
      kind: "spark",
      x: CENTER[def] + dx * CELL_PX - k * 14,
      y: BODY_Y - 2,
      t0: motion(resume) / 1000,
      seed: seedOf(cast.seed, i, 1),
      count: im.crit ? 18 : im.heavy ? 14 : 10,
      dir: k,
      colors: im.crit ? ["#ffffff", "#fff07a", "#ffd25a", "#ff9a30"].map(hex) : undefined,
    });
    if (im.crit || im.heavy) traumas.push({ at: starts[i], amount: im.crit ? 1 : 0.7 });
    if (im.crit || (cast.boss && by === "foe" && im.heavy)) {
      cams.push({ at: starts[i], until: resume + 140, zoom: im.crit ? 1.16 : 1.1, cx: CENTER[def], cy: BODY_Y - 6 });
    }
    if (im.crit) flashCandidates.push(starts[i]);
  }

  // Per-cue rules: shake flags, landings, heals, poison, KOs, confetti.
  cues.forEach((c, i) => {
    const T = starts[i];
    if (c.stage.shake && !c.stage.hd?.impact) traumas.push({ at: T, amount: 0.5 });
    for (const side of ["hero", "foe"] as const) {
      const a = actors[side][i];
      const p = i > 0 ? actors[side][i - 1] : undefined;
      const x = CENTER[side] + (a.x ?? 0) * CELL_PX;
      if (a.hidden) continue;
      if (p && (p.y ?? 0) < 0 && (a.y ?? 0) === 0) {
        emitters.push({ kind: "dust", x, y: GROUND_Y - 1, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 2 + (side === "foe" ? 1 : 0)), count: (p.y ?? 0) <= -2 ? 10 : 6 });
        if ((p.y ?? 0) <= -2) {
          traumas.push({ at: T, amount: 0.6 });
          flashCandidates.push(T);
          cams.push({ at: T, until: T + 220, zoom: 1.08, cx: CENTER[side], cy: BODY_Y - 6 });
        }
      }
      if (a.tint === "heal" && p?.tint !== "heal") {
        emitters.push({ kind: "heal", x, y: BODY_Y + 4, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 4) });
      }
      if (a.tint === "poison" && p?.tint !== "poison") {
        emitters.push({ kind: "bubble", x, y: BODY_Y, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 5) });
      }
      if ((a.sink ?? 0) > 0 && !((p?.sink ?? 0) > 0)) {
        emitters.push({ kind: "dust", x, y: GROUND_Y - 1, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 6), count: 9 });
      }
      if (a.act === "walk" && p?.act !== "walk" && side === "hero" && (a.x ?? 0) < 0 && i > 0 && !(p?.hidden)) {
        emitters.push({ kind: "dust", x: x + 6, y: GROUND_Y - 1, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 7), count: 5 });
      }
    }
    const mk = c.stage.marks ?? {};
    const prevMk = i > 0 ? cues[i - 1].stage.marks ?? {} : {};
    if (mk.over === "win" && prevMk.over !== "win") {
      emitters.push({ kind: "confetti", x: 0, y: -2, w: SCENE_W, t0: motion(T) / 1000, seed: seedOf(cast.seed, i, 8) });
    }
    if (mk.charge === 3 && prevMk.charge !== 3) cams.push({ at: T, until: T + c.ms, zoom: 1.08, cx: CENTER.foe, cy: BODY_Y - 6 });
    // The encounter wipe ends in a flash.
    if (c.stage.wipe === undefined && i > 0 && cues[i - 1].stage.wipe !== undefined) flashCandidates.push(T);
  });

  // Boss phase change: push in on the boss, then the roar shakes the stage.
  for (const h of holds) {
    if (h.kind !== "phase") continue;
    cams.push({ at: h.at, until: h.at + h.ms - 200, zoom: 1.12, cx: CENTER.foe, cy: BODY_Y - 8 });
    traumas.push({ at: h.at + Math.round(h.ms * 0.55), amount: 1 });
    emitters.push({ kind: "dust", x: CENTER.foe, y: GROUND_Y - 1, t0: motion(h.at + Math.round(h.ms * 0.55)) / 1000, seed: seedOf(cast.seed, 0, 9), count: 12 });
  }

  // Flashes: capped at 3 per second.
  const flashes: number[] = [];
  for (const at of flashCandidates.sort((a, b) => a - b)) {
    if (!flashes.length || at - flashes[flashes.length - 1] >= FLASH_GAP_MS) flashes.push(at);
  }

  const segments = { hero: buildSegments("hero"), foe: buildSegments("foe") };

  function buildSegments(side: Side): Segment[] {
    // Which cues belong to an attack by this side: from just after the
    // previous impact (anticipation) through the recoil that follows.
    const attackOf: (number | undefined)[] = cues.map(() => undefined);
    impacts.forEach(({ i, by, ranged }, n) => {
      if (by !== side || ranged) return;
      const floor = n > 0 ? impacts[n - 1].i + 1 : 0;
      let a = i;
      while (a - 1 >= floor && actors[side][a - 1].eye === EYES.attack && !actors[side][a - 1].hidden) a--;
      for (let j = a; j <= i; j++) attackOf[j] = i;
      for (let j = i + 1; j < cues.length && actors[side][j].eye === EYES.attack && !cues[j].stage.hd?.impact; j++) attackOf[j] = i;
    });
    const segs: Segment[] = [];
    const push = (s: Segment) => {
      const last = segs[segs.length - 1];
      if (last && last.anim === s.anim && last.impactAt === s.impactAt && s.anim !== "hit") return;
      segs.push(s);
    };
    cues.forEach((c, i) => {
      const a = actors[side][i];
      const T = starts[i];
      const mk = c.stage.marks ?? {};
      const winner = (mk.over === "win" && side === "hero") || (mk.over === "lose" && side === "foe");
      const impactHere = c.stage.hd?.impact;
      if (a.hidden) return push({ anim: "hidden", start: T });
      // ("x" eyes mean both hurt and KO on the cell stage; HP tells them apart.)
      if ((a.sink ?? 0) > 0 || c.hp[side === "hero" ? 0 : 1] <= 0) return push({ anim: "ko", start: T });
      if (a.act === "walk") return push({ anim: "walk", start: T });
      if (impactHere && impactHere.by !== side) return segs.push({ anim: "hit", start: T });
      if (attackOf[i] !== undefined) {
        const j = attackOf[i]!;
        const last = segs[segs.length - 1];
        if (last?.anim === "attack" && last.impactAt === starts[j]) return;
        return segs.push({ anim: "attack", start: T, impactAt: starts[j] });
      }
      const hurt = a.eye === EYES.hurt && (a.tint === "flash" || a.tint === "hurt" || a.tint === "poison");
      if (hurt) {
        const last = segs[segs.length - 1];
        if (last?.anim === "hit" && T - last.start < ANIM_INFO.hit.duration * 1000) return;
        return segs.push({ anim: "hit", start: T });
      }
      if (winner) return push({ anim: "victory", start: T });
      push({ anim: "idle", start: T });
    });
    // One-shots (attack, hit) finish before idle or victory take over.
    for (let n = 1; n < segs.length; n++) {
      const prev = segs[n - 1];
      const cur = segs[n];
      if ((prev.anim === "attack" || prev.anim === "hit") && (cur.anim === "idle" || cur.anim === "victory")) {
        cur.start = Math.max(cur.start, segEnd(prev));
      }
    }
    return segs.filter((s, n) => n === segs.length - 1 || segs[n + 1].start > s.start || s.anim === "hidden");
  }

  /** Real ms when a one-shot segment reaches its final pose. */
  function segEnd(s: Segment): number {
    const from = s.anim === "attack" ? s.impactAt! : s.start;
    const left = s.anim === "attack" ? (ANIM_INFO.attack.duration - ANIM_INFO.attack.impact!) * 1000 : ANIM_INFO[s.anim as Anim].duration * 1000;
    return realTime(freezes, motion(from) + left);
  }

  // Let the last one-shots play out after the final cue.
  let total = cueMs;
  for (const side of ["hero", "foe"] as const) {
    for (const seg of segments[side]) {
      if (seg.anim === "attack" || seg.anim === "hit") total = Math.max(total, Math.ceil(segEnd(seg)));
      // An idle/victory held back for a one-shot to finish.
      if (seg.start > cueMs) total = Math.max(total, Math.ceil(seg.start));
    }
  }

  return {
    cast,
    cues,
    starts,
    cueMs,
    total,
    // Hit-stop is timing, not motion: it stays even under reduce-motion.
    freezes,
    holds,
    segments,
    emitters,
    cams: feel.camera ? cams : [],
    traumas: feel.shake ? traumas : [],
    flashes: feel.flash ? flashes : [],
    actors,
    cell: opts.cell,
    maxHp: opts.maxHp,
  };
}

/** Motion ms → the real ms it is reached (inverse of motionTime). */
function realTime(freezes: readonly Freeze[], m: number): number {
  let T = m;
  for (const f of [...freezes].sort((a, b) => a.at - b.at)) if (f.at <= T) T += f.ms;
  return T;
}

/** Real ms → motion ms (the clock that stops during hit-stop). */
export function motionTime(tl: Pick<Timeline, "freezes">, T: number): number {
  let m = T;
  for (const f of tl.freezes) m -= Math.max(0, Math.min(T, f.at + f.ms) - f.at);
  return m;
}

/** Index of the cue playing at real time T (the last cue holds the tail). */
export function cueAt(tl: Timeline, T: number): number {
  let i = 0;
  while (i + 1 < tl.starts.length && tl.starts[i + 1] <= T) i++;
  return i;
}

/** The animation and its local time for one side at T. */
export function animAt(tl: Timeline, side: Side, T: number): { anim: Anim; t: number; hidden: boolean } {
  const segs = tl.segments[side];
  let s: Segment | undefined;
  for (const x of segs) if (x.start <= T) s = x;
  if (!s) return { anim: "idle", t: motionTime(tl, T) / 1000, hidden: false };
  if (s.anim === "hidden") return { anim: "idle", t: 0, hidden: true };
  const M = motionTime(tl, T);
  if (s.anim === "attack") {
    const imp = ANIM_INFO.attack.impact!;
    const m0 = motionTime(tl, s.start);
    const mi = motionTime(tl, s.impactAt!);
    if (M < mi) return { anim: "attack", t: mi > m0 ? (imp * (M - m0)) / (mi - m0) : imp, hidden: false };
    return { anim: "attack", t: Math.min(ANIM_INFO.attack.duration, imp + (M - mi) / 1000), hidden: false };
  }
  const t = (M - motionTime(tl, s.start)) / 1000;
  const info = ANIM_INFO[s.anim];
  return { anim: s.anim, t: info.loop ? t % info.duration : Math.min(info.duration, t), hidden: false };
}

function actorPx(a: ActorState, attacking: boolean): [number, number] {
  return [(a.x ?? 0) * CELL_PX * (attacking ? 0.5 : 1), (a.y ?? 0) * CELL_PX];
}

/** Map a cell-stage mote to a pixel pop or projectile (or drop it: clash
 *  glyphs, bursts and confetti are drawn as particles instead). */
function motePx(tl: Timeline, m: Mote, hero: HdActor, foe: HdActor): { x: number; y: number } {
  const kx = SCENE_W / Math.max(1, tl.cell.width);
  const anchor = m.at === "abs" ? 0 : m.at === "gap" ? (CENTER.hero + hero.x + CENTER.foe + foe.x) / 2 : m.at === "hero" ? CENTER.hero + hero.x : CENTER.foe + foe.x;
  const x = anchor + (m.dx ?? 0) * kx;
  const row = m.y < 0 ? tl.cell.height + m.y : m.y;
  const side = m.at === "foe" ? "foe" : "hero";
  const top = headTop(tl.cast[side].species);
  // Rows 0–1 are the headroom over the heads; lower rows map onto bodies.
  const y = row <= 1 ? top - 16 + row * 6 : top + ((row - 2) / Math.max(1, tl.cell.height - 2)) * (GROUND_Y - top);
  return { x, y };
}

const TEXTY = /[A-Za-z0-9]|^[!? ]+$/;

/** Resolve the scene at real time T (ms). Pure. */
export function sceneAt(tl: Timeline, T: number): HdScene {
  const i = cueAt(tl, T);
  const cue = tl.cues[i];
  const M = motionTime(tl, T);
  const local = M - motionTime(tl, tl.starts[i]);
  const k = easeOutCubic(span(local, 0, Math.min(90, Math.max(1, cue.ms))));
  const mk = cue.stage.marks ?? {};

  const actor = (side: Side): HdActor => {
    const a = tl.actors[side][i];
    const prev = i > 0 ? tl.actors[side][i - 1] : a;
    // Appearing from hidden is a cut, not a slide from home.
    const p = prev.hidden ? a : prev;
    const st = animAt(tl, side, T);
    const atk = st.anim === "attack";
    const [x1, y1] = actorPx(a, atk);
    const [x0, y0] = actorPx(p, atk);
    return {
      anim: st.anim,
      t: st.t,
      x: x0 + (x1 - x0) * k,
      y: y0 + (y1 - y0) * k,
      // The rig's own hit reaction flashes white; don't paint over it.
      tint: ((a.tint === "flash" || a.tint === "hurt") && st.anim === "hit") || (a.tint === "dim" && st.anim === "ko") ? undefined : a.tint,
      hidden: st.hidden || a.hidden,
    };
  };
  const hero = actor("hero");
  const foe = actor("foe");

  const pops: HdPop[] = [];
  const projectiles: HdProjectile[] = [];
  const rise = 3 * easeOutCubic(span(local, 0, Math.max(1, cue.ms)));
  for (const m of cue.stage.motes ?? []) {
    const { x, y } = motePx(tl, m, hero, foe);
    if (m.text === "●" || m.text === ">o") {
      projectiles.push({ kind: m.text === "●" ? "bomb" : "duck", x, y: BODY_Y - 6 + (y < BODY_Y - 10 ? -4 : 0) });
      continue;
    }
    if (!TEXTY.test(m.text)) continue;
    const crit = m.ink === "crit";
    const pop = 1 - easeOutBack(span(local, 0, 70)); // overshoot, then settle
    const jitter = crit && local < 120 ? (Math.floor(local / 30) % 2 ? 1 : -1) : 0;
    pops.push({ text: m.text.trim(), x: x + jitter, y: y - rise + pop * 2, color: INK_RGB[m.ink ?? "white"], left: m.left });
  }

  // Camera: strongest active push-in, eased in and out.
  let cam = { ...REST_CAM };
  for (const e of tl.cams) {
    const inK = easeOutCubic(span(T, e.at, e.at + 70));
    const outK = 1 - easeInOutCubic(span(T, e.until, e.until + 260));
    const w = Math.min(inK, outK);
    if (w <= 0) continue;
    const zoom = 1 + (e.zoom - 1) * w;
    if (zoom <= cam.zoom) continue;
    const half = SCENE_W / 2 / zoom;
    const halfH = SCENE_H / 2 / zoom;
    const cx = Math.max(half, Math.min(SCENE_W - half, SCENE_W / 2 + (e.cx - SCENE_W / 2) * w));
    const cy = Math.max(halfH, Math.min(SCENE_H - halfH, SCENE_H / 2 + (e.cy - SCENE_H / 2) * w));
    cam = { zoom, cx, cy };
  }

  // Trauma-based shake: decays fast, squared, smooth noise.
  let trauma = 0;
  for (const tr of tl.traumas) if (T >= tr.at) trauma = Math.max(trauma, tr.amount * (1 - (T - tr.at) / 300));
  trauma = Math.max(0, trauma);
  const amp = Math.min(SHAKE_MAX, SHAKE_MAX * trauma * trauma);
  const nz = (f: number, ph: number) => Math.sin(T * f + ph) * 0.6 + Math.sin(T * f * 2.3 + ph * 1.7) * 0.4;
  const shake: [number, number] = amp ? [amp * nz(0.09, tl.cast.seed % 7), amp * 0.6 * nz(0.11, 3 + (tl.cast.seed % 5))] : [0, 0];

  let flash = 0;
  for (const f of tl.flashes) if (T >= f && T < f + 100) flash = Math.max(flash, 0.6 * (1 - (T - f) / 100));

  const pt = M / 1000;
  const emitters = tl.emitters.filter((e) => pt >= e.t0 && pt <= e.t0 + particleLife(e.kind) + 0.5);
  const wipe = cue.stage.wipe !== undefined ? Math.min(1, cue.stage.wipe / (tl.cell.width + 2 * tl.cell.height + 9)) : undefined;
  const hold = tl.holds.find((h) => T >= h.at && T < h.at + h.ms);
  const scene: HdScene = { hero, foe, marks: mk, pt, emitters, pops, projectiles, cam, shake, flash, wipe, clock: T / 1000 };
  if (hold?.kind === "cutin") return { ...scene, pops: [], cutin: { name: hold.name ?? "", by: hold.by ?? "hero", k: (T - hold.at) / hold.ms } };
  if (hold?.kind === "phase") return { ...scene, pops: [], phase: (T - hold.at) / hold.ms };
  return scene;
}

/** Sub-frame times for playback: every cue is split into ≤ STEP_MS slices,
 *  then the settle tail. Each frame is [startMs, durationMs]. */
export function frameTimes(tl: Timeline): [number, number][] {
  const out: [number, number][] = [];
  tl.cues.forEach((c, i) => {
    const s = tl.starts[i];
    if (c.ms <= 0) return;
    for (let t = 0; t < c.ms; t += STEP_MS) out.push([s + t, Math.min(STEP_MS, c.ms - t)]);
  });
  for (const h of tl.holds) for (let t = 0; t < h.ms; t += STEP_MS) out.push([h.at + t, Math.min(STEP_MS, h.ms - t)]);
  out.sort((a, b) => a[0] - b[0]);
  for (let t = tl.cueMs; t < tl.total; t += STEP_MS) out.push([t, Math.min(STEP_MS, tl.total - t)]);
  return out;
}

// ─── HP bars ────────────────────────────────────────────────────────────────

/** Ghost HP per side at T: after a hit the lost chunk lingers 250 ms, then
 *  drains over 300 ms. `fresh` = the first 120 ms (drawn white). */
export function ghostAt(tl: Timeline, T: number): { ghost: [number, number]; fresh: [boolean, boolean] } {
  const ghost: [number, number] = [0, 0];
  const fresh: [boolean, boolean] = [false, false];
  for (const k of [0, 1] as const) {
    let g = tl.cues[0]?.hp[k] ?? 0;
    let from = g;
    let at = -Infinity;
    for (let i = 0; i < tl.cues.length && tl.starts[i] <= T; i++) {
      const hp = tl.cues[i].hp[k];
      const prev = i > 0 ? tl.cues[i - 1].hp[k] : hp;
      if (hp < prev) {
        from = Math.max(drain(from, prev, at, tl.starts[i]), prev);
        at = tl.starts[i];
      } else if (hp > prev) {
        from = hp;
        at = -Infinity;
      }
      g = hp;
    }
    ghost[k] = Math.max(g, drain(from, g, at, T));
    fresh[k] = T - at < 120 && ghost[k] > g;
  }
  return { ghost, fresh };
}

function drain(from: number, to: number, at: number, T: number): number {
  if (!Number.isFinite(at)) return to;
  const k = easeInOutCubic(span(T - at, 250, 550));
  return from + (to - from) * k;
}

// ─── Rest and ambient scenes ────────────────────────────────────────────────

/** The fight at rest (the static screen): idle poses, persistent marks,
 *  this turn's damage totals. KO'd sides lie in their final pose. */
export function restScene(b: Battle, motes: readonly Mote[], cell: { width: number; height: number }, cast: HdCast, clock = 0): HdScene {
  const marks = marksOf(b);
  const tl = hdTimeline([{ stage: { marks, motes: [...motes] }, hp: [b.hero.hp, b.foe.hp], lines: b.log.length, ms: 1 }], cast, { shake: false, flash: false, camera: false, cutin: false }, {
    maxHp: [b.hero.maxHp, b.foe.maxHp],
    cell,
  });
  const s = sceneAt(tl, 0);
  const pose = (side: Side, a: HdActor): HdActor => {
    const st = tl.actors[side][0];
    if (st.hidden) return { ...a, hidden: true };
    if ((st.sink ?? 0) > 0) return { ...a, anim: "ko", t: ANIM_INFO.ko.duration, tint: undefined };
    const winner = (marks.over === "win" && side === "hero") || (marks.over === "lose" && side === "foe");
    if (winner) return { ...a, anim: "victory", t: 0 };
    return { ...a, anim: "idle", t: clock };
  };
  return { ...s, hero: pose("hero", s.hero), foe: pose("foe", s.foe), clock };
}
