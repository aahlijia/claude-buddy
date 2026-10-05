/**
 * Cinematics — the hatch and the loot reveal (H6, brainstorm §3.6–§3.7).
 *
 * Both are pure functions of time: `renderHatch(look, ms, feel)` and
 * `renderLoot(loot, ms, feel)` return one frame, so the CLIs can play them
 * at any frame rate, skip them, and tests can hash any instant.
 *
 *   hatch  egg wobble that builds → cracks glowing in the rarity's color →
 *          light leaks, beams → shockwave reveal → victory hop; shiny
 *          buddies get a sparkle sting
 *   loot   chest shakes → lid pops → a rarity-colored beam shoots up → the
 *          item rises on it; legendary gets a flash and a slow spin
 *
 * Gates (`CineFeel`): no shake and no flashes at gameFeel subtle; reduce
 * motion also drops the wobble and the spin. gameFeel off never plays them.
 */

import type { Hat, Rarity, Species } from "../engine.ts";
import { glow } from "./blob.ts";
import { easeInCubic, easeOutBack, easeOutCubic, span } from "./ease.ts";
import { drawText, textWidth } from "./font.ts";
import { Framebuffer, hex, mix, type RGBA } from "./framebuffer.ts";
import { HD_W, renderHd, type Anim } from "./hd.ts";
import { renderRig, ramp, type RigDef } from "./rig.ts";

/** Scene size for both cinematics (half-block: 72 columns × 28 rows). */
export const CINE_W = 72;
export const CINE_H = 56;

export interface CineFeel {
  shake: boolean;
  flash: boolean;
  /** Wobble, spin and other big motion (off under reduce-motion). */
  motion: boolean;
}

/** gameFeel → what the cinematics may do; null = don't play them. */
export function cineFeel(gameFeel: string | undefined, reduceMotion = false): CineFeel | null {
  if (gameFeel === "off") return null;
  if (reduceMotion) return { shake: false, flash: false, motion: false };
  if (gameFeel === "full") return { shake: true, flash: true, motion: true };
  return { shake: false, flash: false, motion: true };
}

/** The rarity's light: crack glow, beams, shockwave, text. */
export const RARITY_LIGHT: Record<Rarity, RGBA> = {
  common: hex("#e8e4f4"),
  uncommon: hex("#6ee68a"),
  rare: hex("#7aa8ff"),
  epic: hex("#c070ff"),
  legendary: hex("#ffc83a"),
};

const WHITE = hex("#ffffff");
const INK = hex("#120c1e");

// ─── Shared pieces ──────────────────────────────────────────────────────────

/** Dark stage with a soft vignette and a floor glow in `tint`. */
function stage(tint: RGBA, light: number): Framebuffer {
  const fb = new Framebuffer(CINE_W, CINE_H);
  const center = mix(hex("#221a3a"), tint, 0.25 * light);
  const edge = hex("#07050e");
  for (let y = 0; y < CINE_H; y++) {
    for (let x = 0; x < CINE_W; x++) {
      const d = Math.hypot((x + 0.5 - CINE_W / 2) / (CINE_W * 0.62), (y + 0.5 - CINE_H * 0.62) / (CINE_H * 0.7));
      fb.set(x, y, mix(center, edge, Math.min(1, d)));
    }
  }
  // Floor: a lit oval under the subject.
  fb.ellipse(CINE_W / 2, GROUND + 1, 26, 4.5, mix(hex("#2e2450"), tint, 0.3 * light), 0.9);
  return fb;
}

const GROUND = 47;

/** Expanding shockwave ring (k: 0..1). */
function ring(fb: Framebuffer, cx: number, cy: number, k: number, c: RGBA): void {
  if (k <= 0 || k >= 1) return;
  const r = 4 + 44 * easeOutCubic(k);
  const w = 2.5 * (1 - k) + 0.6;
  const a = 0.9 * (1 - k);
  for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++) {
    for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
      // Flattened: the ring lies on the floor plane a little.
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.35);
      const e = 1 - Math.abs(d - r) / w;
      if (e > 0) fb.add(x, y, c, a * e);
    }
  }
}

/** Light beams fanning out of a point (k: strength 0..1). */
function beams(fb: Framebuffer, cx: number, cy: number, k: number, c: RGBA, count: number, spin: number): void {
  if (k <= 0) return;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + spin;
    const len = 40 * k;
    for (let s = 2; s < len; s += 0.5) {
      const w = 0.6 + s * 0.08;
      const fall = (1 - s / len) * k;
      for (let o = -w; o <= w; o += 0.5) {
        const x = cx + Math.cos(a) * s - Math.sin(a) * o;
        const y = cy + Math.sin(a) * s + Math.cos(a) * o;
        fb.add(Math.floor(x), Math.floor(y), c, 0.18 * fall * (1 - Math.abs(o) / (w + 0.01)));
      }
    }
  }
}

/** A four-point sparkle star. */
function star(fb: Framebuffer, x: number, y: number, size: number, c: RGBA, a: number): void {
  if (a <= 0) return;
  const xi = Math.round(x);
  const yi = Math.round(y);
  fb.add(xi, yi, WHITE, a);
  for (let i = 1; i <= size; i++) {
    const f = a * (1 - i / (size + 1));
    fb.add(xi + i, yi, c, f);
    fb.add(xi - i, yi, c, f);
    fb.add(xi, yi + i, c, f);
    fb.add(xi, yi - i, c, f);
  }
}

function flashOver(fb: Framebuffer, a: number): void {
  if (a <= 0) return;
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) fb.blend(x, y, WHITE, a);
}

function shakeOf(ms: number, amount: number, seed: number): [number, number] {
  if (amount <= 0) return [0, 0];
  const n = (f: number, p: number) => Math.sin(ms * f + p) * 0.6 + Math.sin(ms * f * 2.3 + p * 1.7) * 0.4;
  return [Math.round(amount * n(0.09, seed % 7)), Math.round(amount * 0.5 * n(0.11, 3 + (seed % 5)))];
}

function shifted(src: Framebuffer, dx: number, dy: number): Framebuffer {
  if (!dx && !dy) return src;
  const out = new Framebuffer(src.width, src.height);
  out.fill(src.get(0, 0));
  out.draw(src, dx, dy);
  return out;
}

function centeredText(fb: Framebuffer, text: string, y: number, c: RGBA, a: number): void {
  if (a <= 0) return;
  const x = Math.round((fb.width - textWidth(text)) / 2);
  drawText(fb, text, x, Math.round(y), c, { outline: INK, opacity: Math.min(1, a) });
}

// ─── Hatch ──────────────────────────────────────────────────────────────────

export const HATCH_MS = 3800;
/** The shell bursts here (ms). */
export const HATCH_BURST = 2100;

export interface HatchLook {
  species: Species;
  rarity: Rarity;
  shiny: boolean;
  seed?: number;
  /** Born with a hat (the innate one): it hatches wearing it. */
  hat?: Hat;
}

/** Crack lines, appearing in three stages (egg-local pixels, 24 × 30 egg). */
const CRACKS: readonly string[][] = [
  ["..........cc............", ".........ccc............", "........cc.cc...........", ".........cc.ccc.........", "..........c...cc........", "...............c........"],
  ["....cc..................", ".....ccc................", "......cc..c.............", ".......ccccc............", "...........c............"],
  ["...............cc.......", "..............cc.c......", ".............cc..cc.....", "............cc....cc....", "...........cc......c...."],
];
const CRACK_AT: readonly [number, number][] = [[0, 8], [1, 15], [2, 12]];
const CRACK_MS = [700, 1300, 1750];

const eggCache = new Map<Rarity, RigDef>();

/** The egg as a one-part rig: shaded, outlined and lit like every buddy. */
function eggRig(rarity: Rarity): RigDef {
  const hit = eggCache.get(rarity);
  if (hit) return hit;
  const L = RARITY_LIGHT[rarity];
  const toHex = (c: RGBA) => `#${[0, 1, 2].map((i) => c[i].toString(16).padStart(2, "0")).join("")}`;
  const crackGrid = (rows: readonly string[]) => ({ kind: "grid" as const, rows });
  const rig: RigDef = {
    id: "egg",
    width: CINE_W,
    height: CINE_H,
    ground: GROUND,
    shadowRx: 11,
    outline: hex("#1a1228"),
    materials: {
      e: { ramp: ramp("#2e2440", "#54456e", "#7e6c9c", "#a896c4", "#d0c2ea"), gloss: 0.5 },
      s: { ramp: ramp("#1e2a4a", "#2e4070", "#46609a", "#6684c0", "#8eaae0") },
      c: { ramp: [L, L, L, mix(L, WHITE, 0.4), mix(L, WHITE, 0.7)].map((c) => hex(toHex(c))), flat: true },
    },
    parts: [
      { name: "body", role: "body", at: [CINE_W / 2, GROUND], pivot: [12, 30], z: 1, shape: { kind: "ellipse", rx: 12, ry: 15, p: 2, mat: "e" } },
      { name: "spots", role: "detail", parent: "body", at: [3, 6], pivot: [0, 0], z: 1.1, group: "body", shape: { kind: "grid", rows: ["....ss..........", "...ssss.....s...", "....ss.....sss..", "............s...", "..s.............", ".sss.......ss...", "..s.......ssss..", "...........ss..."] } },
      ...CRACKS.map((rows, i) => ({ name: `crack${i}`, role: "detail" as const, parent: "body", at: CRACK_AT[i], pivot: [0, 0] as const, z: 1.2 + i * 0.01, group: "body", shape: crackGrid(rows) })),
    ],
  };
  eggCache.set(rarity, rig);
  return rig;
}

/** The egg wobble: three bursts, each wider and faster than the last. */
function wobble(ms: number): number {
  const bursts: [number, number, number, number][] = [
    [150, 550, 0.08, 9],
    [800, 1250, 0.14, 12],
    [1400, 1900, 0.22, 16],
  ];
  for (const [a, b, amp, hz] of bursts) {
    if (ms < a || ms > b) continue;
    const u = (ms - a) / (b - a);
    return amp * Math.sin(u * Math.PI) * Math.sin(((ms - a) / 1000) * hz * Math.PI * 2);
  }
  // The last beat before the burst: a fast shiver.
  if (ms > 1900 && ms < HATCH_BURST) return 0.06 * Math.sin((ms / 1000) * 40 * Math.PI * 2);
  return 0;
}

/** One frame of the hatch at `ms`. Pure. */
export function renderHatch(look: HatchLook, ms: number, feel: CineFeel): Framebuffer {
  const L = RARITY_LIGHT[look.rarity];
  const seed = look.seed ?? 1;
  const burstK = span(ms, HATCH_BURST, HATCH_BURST + 900);
  const leak = ms < HATCH_BURST ? easeInCubic(span(ms, 600, HATCH_BURST)) : 1 - easeOutCubic(burstK);
  const fb = stage(L, ms < HATCH_BURST ? leak * 0.6 : 0.6 + 0.4 * (1 - burstK));
  const ex = CINE_W / 2;
  const ey = GROUND - 15;

  if (ms < HATCH_BURST) {
    // Light leaking from the cracks, then beams just before it bursts.
    glow(fb, ex, ey, 10 + 14 * leak, L, 0.55 * leak);
    beams(fb, ex, ey, easeInCubic(span(ms, 1750, HATCH_BURST)), L, 7, ms / 900);
    const rig = eggRig(look.rarity);
    const rot = feel.motion ? wobble(ms) : 0;
    const parts: Record<string, { rot?: number; hide?: boolean; sx?: number; sy?: number }> = { body: { rot } };
    // A squash just before the burst.
    if (feel.motion && ms > 1900) parts.body = { rot, sx: 1 + 0.06 * span(ms, 1900, HATCH_BURST), sy: 1 - 0.05 * span(ms, 1900, HATCH_BURST) };
    CRACK_MS.forEach((at, i) => {
      if (ms < at) parts[`crack${i}`] = { hide: true };
    });
    fb.draw(renderRig(rig, { parts }), 0, 0);
    // Each new crack pops a little puff of light.
    CRACK_MS.forEach((at, i) => {
      const k = span(ms, at, at + 220);
      if (k > 0 && k < 1) glow(fb, ex + [-1, -6, 4][i], ey - [4, 0, 2][i], 6 + 6 * k, L, 0.7 * (1 - k));
    });
    const sh = feel.shake && ms > 1900 ? shakeOf(ms, 1, seed) : [0, 0];
    return shifted(fb, sh[0], sh[1]);
  }

  // ── The reveal ──
  const t = (ms - HATCH_BURST) / 1000;
  beams(fb, ex, ey, 1 - easeOutCubic(span(t, 0, 0.7)), L, 9, ms / 900);
  glow(fb, ex, ey, 26, L, 0.5 * (1 - easeOutCubic(span(t, 0, 1.4))) + 0.12);
  ring(fb, ex, GROUND - 2, span(t, 0, 0.75), L);
  ring(fb, ex, GROUND - 2, span(t, 0.12, 0.95), mix(L, WHITE, 0.5));

  // The buddy: a victory hop, then it settles into idle.
  const anim: Anim = t < 1.1 ? "victory" : "idle";
  const at = t < 1.1 ? t : t - 1.1;
  const gear = look.hat && look.hat !== "none" ? { hat: look.hat } : undefined;
  const buddy = renderHd(look.species, anim, at, { rarity: look.rarity, shiny: look.shiny, seed, gear });
  // Bottom-aligned: a hatted frame is taller.
  if (buddy) fb.draw(buddy, Math.round((CINE_W - HD_W) / 2), GROUND - (buddy.height - 5) + 1);

  // Shell shards fly out and fall.
  drawShards(fb, ex, ey, t, seed, L);

  // Shiny sting: sparkles twinkle around the buddy, a chime of light.
  if (look.shiny) {
    const k = span(t, 0.25, 1.6);
    for (let i = 0; i < 7; i++) {
      const ph = span(k, i * 0.09, i * 0.09 + 0.35);
      const a = Math.sin(Math.PI * ph);
      const ang = i * 2.4 + seed;
      const r = 16 + (i % 3) * 5;
      star(fb, ex + Math.cos(ang) * r, ey - 2 + Math.sin(ang) * r * 0.7, 2 + (i % 2), hex("#fff6a0"), a);
    }
    centeredText(fb, "SHINY!", 4 + 3 * (1 - easeOutBack(span(t, 0.3, 0.6))), hex("#fff6a0"), span(t, 0.3, 0.45) * (1 - span(t, 1.5, 1.7)));
  }
  // The rarity, in its own light.
  const label = look.rarity.toUpperCase();
  const lk = easeOutBack(span(t, 0.5, 0.85));
  centeredText(fb, label, CINE_H - 7 + (1 - lk) * 4, L, span(t, 0.5, 0.65));

  // The burst flash (gated) and the impact shake.
  if (feel.flash) flashOver(fb, 0.85 * (1 - span(t, 0, 0.14)));
  const sh = feel.shake ? shakeOf(ms, 2.5 * (1 - span(t, 0, 0.4)), seed) : [0, 0];
  return shifted(fb, sh[0], sh[1]);
}

/** Eggshell shards: ballistic, closed form, faded as they land. */
function drawShards(fb: Framebuffer, cx: number, cy: number, t: number, seed: number, L: RGBA): void {
  if (t > 1.4) return;
  const shell = [hex("#d0c2ea"), hex("#a896c4"), hex("#7e6c9c")];
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296);
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * (0.1 + 0.8 * rnd());
    const v = 28 + 40 * rnd();
    const x = cx + Math.cos(a) * v * t * (i % 2 ? 1 : -1);
    const y = Math.min(GROUND + 1, cy + Math.sin(a) * v * t + 70 * t * t);
    const c = shell[i % 3];
    const alpha = 1 - span(t, 0.9, 1.4);
    fb.blend(Math.round(x), Math.round(y), c, alpha);
    if (i % 2) fb.blend(Math.round(x) + 1, Math.round(y), c, alpha);
    if (i % 4 === 0) fb.add(Math.round(x), Math.round(y) - 1, L, 0.5 * alpha);
  }
}

// ─── Loot ───────────────────────────────────────────────────────────────────

export const LOOT_MS = 2800;
/** The lid pops here (ms). */
export const LOOT_POP = 800;

export type LootSlot = "weapon" | "armor" | "charm";

export interface LootLook {
  name: string;
  rarity: Rarity;
  slot: LootSlot;
  seed?: number;
}

/** Chest body and lid, authored as palette sprites (24 px wide). */
const CHEST_BODY = [
  "kkkkkkkkkkkkkkkkkkkkkkkk",
  "kwwwwwwwwwwwwwwwwwwwwwwk",
  "kbbbbbbbbbbggbbbbbbbbbbk",
  "kbBBBBBBBBgYYgBBBBBBBBbk",
  "kbBBBBBBBBgYkgBBBBBBBBbk",
  "kbBBBBBBBBBggBBBBBBBBBbk",
  "kbBBBBBBBBBBBBBBBBBBBBbk",
  "kgggggggggggggggggggggk.",
  "kbBBBBBBBBBBBBBBBBBBBBbk",
  "kbbbbbbbbbbbbbbbbbbbbbbk",
  "kkkkkkkkkkkkkkkkkkkkkkkk",
].map((r) => r.padEnd(24, "k").slice(0, 24));
const CHEST_LID = [
  "....kkkkkkkkkkkkkkkk....",
  "..kkwwwwwwwwwwwwwwwwkk..",
  ".kwwbbbbbbbbbbbbbbbbwwk.",
  "kwbbBBBBBBBBBBBBBBBBbbwk",
  "kgggggggggggggggggggggk.",
  "kbBBBBBBBBBggBBBBBBBBBbk",
  "kkkkkkkkkkkkkkkkkkkkkkkk",
].map((r) => r.padEnd(24, "k").slice(0, 24));
const CHEST_PAL: Record<string, RGBA> = {
  k: hex("#1e1018"),
  w: hex("#c08a52"),
  b: hex("#7a4a28"),
  B: hex("#9a6034"),
  g: hex("#e0b04a"),
  Y: hex("#fff0a0"),
};

/** Item icons per slot (16 px), drawn in the item's rarity light. */
const ICONS: Record<LootSlot, readonly string[]> = {
  weapon: [
    "..............kk",
    ".............kwk",
    "............kwLk",
    "...........kwLk.",
    "..........kwLk..",
    ".........kwLk...",
    "........kwLk....",
    "...kk..kwLk.....",
    "...kgkkwLk......",
    "....kgwLk.......",
    ".....kgk........",
    "....kgkgk.......",
    "...kbk.kgk......",
    "..kbk...kk......",
    ".kbk............",
    ".kk.............",
  ],
  armor: [
    "..kkkkkkkkkkkk..",
    ".kwwwwwwwwwwwwk.",
    ".kwLLLLggLLLLwk.",
    ".kwLLLLggLLLLwk.",
    ".kwLLLLggLLLLwk.",
    ".kwggggggggggwk.",
    ".kwggggggggggwk.",
    ".kwLLLLggLLLLwk.",
    ".kwLLLLggLLLLwk.",
    "..kwLLLggLLLwk..",
    "..kwLLLggLLLwk..",
    "...kwLLggLLwk...",
    "....kwLggLwk....",
    ".....kwggwk.....",
    "......kwwk......",
    ".......kk.......",
  ],
  charm: [
    "......kkkk......",
    ".....kg..gk.....",
    "....kg....gk....",
    "....kg....gk....",
    ".....kg..gk.....",
    "......kggk......",
    ".....kkkkkk.....",
    "....kwwLLLLk....",
    "...kwwLLLLLLk...",
    "...kwLLLLLLLk...",
    "...kLLLLLLLbk...",
    "...kLLLLLLbbk...",
    "....kLLLLbbk....",
    ".....kLbbbk.....",
    "......kkkk......",
    "................",
  ],
};

function iconSprite(slot: LootSlot, L: RGBA): Framebuffer {
  const rows = ICONS[slot];
  const pal: Record<string, RGBA> = {
    k: INK,
    w: mix(L, WHITE, 0.75),
    L,
    b: mix(L, INK, 0.45),
    g: hex("#e0b04a"),
  };
  const fb = new Framebuffer(16, 16);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== "." && pal[ch] && fb.set(x, y, pal[ch])));
  return fb;
}

function blitRows(fb: Framebuffer, rows: readonly string[], x: number, y: number, pal: Record<string, RGBA>, rot = 0, px = 0, py = 0): void {
  // Optional rotation about (px, py) in sprite space (the lid's hinge).
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const h = rows.length;
  const w = rows[0].length;
  if (!rot) {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && pal[ch] && fb.set(x + i, y + j, pal[ch])));
    return;
  }
  // Inverse-map the destination box so the rotated lid has no holes.
  const R = Math.ceil(Math.hypot(w, h)) + 2;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const sx = ca * dx + sa * dy + px;
      const sy = -sa * dx + ca * dy + py;
      const i = Math.floor(sx);
      const j = Math.floor(sy);
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const ch = rows[j][i];
      if (ch !== "." && pal[ch]) fb.set(Math.round(x + px + dx), Math.round(y + py + dy), pal[ch]);
    }
  }
}

/** Squash an icon horizontally (a fake 3D spin): |cos| width, back face dimmed. */
function spun(icon: Framebuffer, angle: number): Framebuffer {
  const c = Math.cos(angle);
  const w = icon.width;
  const out = new Framebuffer(w, icon.height);
  const k = Math.max(0.12, Math.abs(c));
  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x + 0.5 - w / 2) / k + w / 2);
      if (sx < 0 || sx >= w) continue;
      let px = icon.get(c < 0 ? w - 1 - sx : sx, y);
      if (!px[3]) continue;
      if (c < 0) px = mix(px, INK, 0.3);
      out.set(x, y, px);
    }
  }
  return out;
}

/** One frame of the loot reveal at `ms`. Pure. */
export function renderLoot(loot: LootLook, ms: number, feel: CineFeel): Framebuffer {
  const L = RARITY_LIGHT[loot.rarity];
  const seed = loot.seed ?? 1;
  const legendary = loot.rarity === "legendary";
  const t = (ms - LOOT_POP) / 1000;
  const open = ms >= LOOT_POP;
  const beamK = open ? easeOutCubic(span(t, 0, 0.35)) : 0;
  const fb = stage(L, open ? 0.5 + 0.5 * beamK : 0.15 * span(ms, 0, LOOT_POP));
  const cx = CINE_W / 2;
  const chestY = GROUND - 10;

  // The beam: a column of light rising from the chest (the ARPG convention).
  if (open) {
    const half = 3 + 5 * beamK + (legendary ? 2 : 0);
    const pulse = 0.85 + 0.15 * Math.sin(ms / 70);
    for (let y = 0; y < chestY + 2; y++) {
      const reach = chestY - y < (chestY + 2) * beamK;
      if (!reach) continue;
      const fade = 0.35 + 0.65 * (y / chestY);
      for (let x = Math.floor(cx - half - 2); x <= cx + half + 2; x++) {
        const d = Math.abs(x + 0.5 - cx) / half;
        const a = d < 1 ? (1 - d * d) * 0.55 : Math.max(0, 1 - (d - 1) * 3) * 0.12;
        fb.add(x, y, mix(L, WHITE, d < 0.3 ? 0.6 : 0), a * fade * pulse);
      }
    }
    glow(fb, cx, chestY - 2, 18 + 6 * beamK, L, 0.5 * beamK);
    ring(fb, cx, GROUND - 1, span(t, 0, 0.6), L);
  }

  // The chest: shakes harder and harder, then the lid pops back.
  let jx = 0;
  let jy = 0;
  if (!open && feel.motion) {
    const build = easeInCubic(span(ms, 100, LOOT_POP));
    jx = Math.round(Math.sin(ms / 28) * 1.6 * build);
    jy = ms > LOOT_POP - 220 ? -Math.round(Math.abs(Math.sin(ms / 40)) * 1.4) : 0;
  }
  const bx = Math.round(cx - 12) + jx;
  // Ground shadow.
  fb.ellipse(cx, GROUND + 0.5, 14, 2.2, hex("#06040c"), 0.5);
  blitRows(fb, CHEST_BODY, bx, chestY - 1 + jy, CHEST_PAL);
  const lidRot = open ? -2.0 * easeOutBack(span(t, 0, 0.3)) : 0;
  const lidY = chestY - 7 + jy - (open ? Math.round(2 * Math.sin(Math.PI * span(t, 0, 0.3))) : 0);
  // Light leaking from the seam while it shakes.
  if (!open) {
    const leak = easeInCubic(span(ms, 300, LOOT_POP));
    for (let x = bx + 2; x < bx + 22; x++) fb.add(x, chestY - 1 + jy, L, 0.7 * leak);
    glow(fb, cx, chestY - 1, 8 + 10 * leak, L, 0.4 * leak);
  }
  blitRows(fb, CHEST_LID, bx, lidY, CHEST_PAL, lidRot, 1, 6);

  if (open) {
    // The item rises on the beam and bobs; legendary spins in slow motion.
    const rise = easeOutCubic(span(t, 0.1, 0.8));
    const bob = Math.sin(t * 3) * 1.2 * span(t, 0.8, 1.2);
    const iy = Math.round(chestY - 6 - 22 * rise + bob);
    let icon = iconSprite(loot.slot, L);
    if (feel.motion && (legendary || loot.rarity === "epic")) icon = spun(icon, (legendary ? 1.2 : 2.4) * Math.max(0, t - 0.1));
    glow(fb, cx, iy + 8, 12, L, 0.6 * rise);
    fb.draw(icon, Math.round(cx - 8), iy, Math.min(1, rise * 3));
    // Motes drifting up the beam.
    for (let i = 0; i < 8; i++) {
      const u = (t * (0.4 + (i % 3) * 0.15) + i / 8) % 1;
      const x = cx + Math.sin(i * 2.1 + t * 2) * (3 + (i % 3) * 2);
      star(fb, x, chestY - 4 - u * 34, i % 3 === 0 ? 1 : 0, L, 0.8 * Math.sin(Math.PI * u) * beamK);
    }
    // The name, then the rarity.
    const nk = span(t, 0.7, 0.9);
    const name = loot.name.length > 17 ? `${loot.name.slice(0, 16)}…` : loot.name;
    centeredText(fb, name.toUpperCase(), 3 + (1 - easeOutBack(nk)) * -3, WHITE, nk);
    centeredText(fb, loot.rarity.toUpperCase(), CINE_H - 7, L, span(t, 0.85, 1.05));
  }

  // Legendary: one gated flash as the lid pops, and the stage jolts.
  if (open && legendary && feel.flash) flashOver(fb, 0.8 * (1 - span(t, 0, 0.16)));
  const sh = feel.shake && open ? shakeOf(ms, (legendary ? 2.5 : 1.2) * (1 - span(t, 0, 0.35)), seed) : [0, 0];
  return shifted(fb, sh[0], sh[1]);
}
