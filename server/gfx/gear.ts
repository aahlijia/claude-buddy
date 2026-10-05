/**
 * HD gear — hats, held weapons and trinkets on the rigs (brainstorm §1.1:
 * "gear and hats snap to anchors").
 *
 * Equipment is just more parts. `equipRig(rig, gear)` returns the rig with
 * the hat parented to the head and the weapon to the near front paw (or held
 * at the chest when there is none), so every hat and weapon rides every
 * species through every animation for free: the hat bobs with the head and
 * hops with the victory, the weapon swings with the attack's reach. Being
 * parts, they go through the same lighting, inner lines and sel-out outline
 * as the body, so they look painted in, not pasted on.
 *
 * Anchors are measured from the rig (the top of the head shape, the tip of
 * the near front limb, the front of the body); a rig can override them with
 * `RigDef.anchors`. The blob has no rig, so its gear is composited from the
 * body's geometry instead (`drawBlobGear`). Trinkets rest on the ground
 * behind the buddy.
 *
 * Pure: everything is cached by identity and depends only on its arguments.
 */

import type { Hat, Rarity } from "../engine.ts";
import { Framebuffer, hex, mix, type RGBA } from "./framebuffer.ts";
import { ramp, renderRig, shapeMask, type GearAnchor, type Material, type PartDef, type PartPose, type Pose, type RigDef, type Shape } from "./rig.ts";

/** What the buddy wears and holds, as the HD renderer needs it. */
export interface HdGear {
  hat?: Hat;
  weapon?: HdWeapon;
  /** Quest blades glow in their drop's rarity. */
  weaponRarity?: Rarity;
  trinket?: HdTrinket;
}

export const HD_WEAPONS = ["wand", "sword", "blade"] as const;
export type HdWeapon = (typeof HD_WEAPONS)[number];
export const HD_TRINKETS = ["duck"] as const;
export type HdTrinket = (typeof HD_TRINKETS)[number];

/**
 * The HD gear for a resolved appearance (equipment.ts): the hat, and the
 * weapon and trinket from their status-line glyphs (`/` the Debug Wand,
 * `†` the Foam Sword, `,>` the Rubber Duck). An unknown weapon glyph is
 * drawn as a sword, an unknown trinket as the duck.
 */
export function hdGearOf(a: { hat?: Hat; weaponArt?: string; trinketArt?: string }): HdGear | undefined {
  const g: HdGear = {};
  if (a.hat && a.hat !== "none") g.hat = a.hat;
  if (a.weaponArt) g.weapon = a.weaponArt === "/" ? "wand" : "sword";
  if (a.trinketArt) g.trinket = "duck";
  return g.hat || g.weapon || g.trinket ? g : undefined;
}

/** Stable key for caches (sprite bakes, frames). */
export function gearKey(g?: HdGear): string {
  if (!g) return "";
  return [g.hat ?? "", g.weapon ?? "", g.weaponRarity ?? "", g.trinket ?? ""].join(",");
}

// ─── Art ────────────────────────────────────────────────────────────────────

/**
 * Gear materials use Greek-letter keys so they never collide with a rig's
 * own (rigs use ASCII). The grids below are authored with readable letters
 * and remapped through `LEGEND`.
 */
const LEGEND: Record<string, string> = {
  g: "α", // gold
  r: "β", // ruby
  k: "γ", // black felt
  c: "δ", // band red
  b: "ε", // beanie blue
  w: "ζ", // white (pompom, wool)
  y: "η", // duck yellow
  o: "θ", // beak orange
  p: "ι", // wizard purple
  s: "κ", // star (flat)
  h: "λ", // halo (flat glow)
  n: "μ", // wood
  f: "ν", // foam blue
  m: "ξ", // steel
  G: "ο", // rarity guard (per rarity)
  i: "π", // ink (eyes)
  t: "ρ", // teal knit
  P: "σ", // propeller blades
};

const GEAR_MATERIALS: Record<string, Material> = {
  α: { ramp: ramp("#6a4210", "#a8701c", "#e0a830", "#ffd25a", "#fff2b0"), gloss: 0.9 },
  β: { ramp: ramp("#ff4a6a"), flat: true },
  γ: { ramp: ramp("#0c0a12", "#1a1624", "#2a2438", "#3e3650", "#5a5070"), gloss: 0.3 },
  δ: { ramp: ramp("#5a1018", "#981c2a", "#d0303e", "#f05a5a", "#ff9090") },
  ε: { ramp: ramp("#102a5a", "#1c4a96", "#2e6ad0", "#5a96f0", "#9ac4ff") },
  ζ: { ramp: ramp("#8a8a9a", "#c4c4d0", "#ececf4", "#ffffff", "#ffffff") },
  η: { ramp: ramp("#8a6010", "#c8961c", "#f0c830", "#ffe46a", "#fff6b0") },
  θ: { ramp: ramp("#ff8a2a"), flat: true },
  ι: { ramp: ramp("#2a1050", "#46207e", "#6a34b0", "#9a5ad8", "#c890f4") },
  κ: { ramp: ramp("#fff07a"), flat: true },
  λ: { ramp: ramp("#ffe680"), flat: true },
  μ: { ramp: ramp("#3a2210", "#5e3a1c", "#86562c", "#a8743e", "#c89458") },
  ν: { ramp: ramp("#1a4a6a", "#2a7aa8", "#46aee0", "#7ad4f8", "#c0f0ff") },
  ξ: { ramp: ramp("#3a4250", "#6a7486", "#a4aec0", "#d4dce8", "#ffffff"), gloss: 1 },
  π: { ramp: ramp("#141018"), flat: true },
  ρ: { ramp: ramp("#0e3a3a", "#18605e", "#26908a", "#4cc0b4", "#90ecdc") },
  σ: { ramp: ramp("#e8e8f0"), flat: true },
};

/** Rarity light for quest blades' guards (matches the cinematics). */
const GUARD: Record<Rarity, string> = {
  common: "#c8c4d8",
  uncommon: "#6ee68a",
  rare: "#7aa8ff",
  epic: "#c070ff",
  legendary: "#ffc83a",
};

const art = (rows: readonly string[]): Shape => ({
  kind: "grid",
  rows: rows.map((r) => [...r].map((ch) => (ch === "." ? "." : LEGEND[ch] ?? ch)).join("")),
});

interface HatArt {
  shape: Shape;
  /** Rows that sink into the head (the brim sits on it, not above it). */
  sink: number;
  /** Floats this far above the head instead (the halo). */
  float?: number;
  /** Extra animated part on top (the propeller), by variant. */
  top?: { at: readonly [number, number]; frames: readonly Shape[] };
}

/** Hats: bottom row is the brim, centered on the head's crown. */
const HATS: Record<Exclude<Hat, "none">, HatArt> = {
  crown: {
    sink: 2,
    shape: art([
      "g.....g.....g",
      "gg...ggg...gg",
      "ggg.ggrgg.ggg",
      "ggggggggggggg",
      "grgggggggggrg",
      "ggggggggggggg",
    ]),
  },
  tophat: {
    sink: 2,
    shape: art([
      "..kkkkkkkk..",
      "..kkkkkkkk..",
      "..kkkkkkkk..",
      "..kkkkkkkk..",
      "..kkkkkkkk..",
      "..cccccccc..",
      "..kkkkkkkk..",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
    ]),
  },
  propeller: {
    sink: 2,
    shape: art([
      "....rr....",
      "..bbrrbb..",
      ".bbbrrbbb.",
      "bbbbrrbbbb",
      "bbbbbbbbbb",
    ]),
    top: {
      at: [5, -1],
      frames: [
        art(["PPPPP.nn.PPPPP"]),
        art(["...PPPnnPPP..."]),
        art(["......nn......"]),
        art(["...PPPnnPPP..."]),
      ],
    },
  },
  halo: {
    sink: 0,
    float: 3,
    shape: art(["..hhhhhhhh..", ".hh......hh.", "..hhhhhhhh.."]),
  },
  wizard: {
    sink: 2,
    shape: art([
      "pp............",
      ".ppp..........",
      "..pppp........",
      "...ppppp......",
      "....pppp......",
      "...pppspp.....",
      "...pppppp.....",
      "..ppppppp.....",
      "..ppppppps....",
      "..pppppppppp..",
      "pppppppppppppp",
      "pppppppppppppp",
    ]),
  },
  beanie: {
    sink: 3,
    shape: art([
      ".....ww.....",
      "....wwww....",
      "...tttttt...",
      "..tttttttt..",
      ".tttttttttt.",
      ".tttttttttt.",
      "wtwtwtwtwtww",
      "wwwwwwwwwwww",
    ]),
  },
  tinyduck: {
    sink: 1,
    shape: art([
      "...yyy...",
      "..yyyyy..",
      "..yyiyyoo",
      "..yyyyyo.",
      "yyyyyyy..",
      "yyyyyyyy.",
      ".yyyyyy..",
    ]),
  },
};

interface WeaponArt {
  shape: Shape;
  /** Grip point in shape pixels (where the paw holds it). */
  grip: readonly [number, number];
}

/** Weapons stand upright; the anchor tilts them forward. */
const WEAPONS: Record<HdWeapon, WeaponArt> = {
  wand: {
    grip: [2.5, 14],
    shape: art([
      "..s..",
      ".sss.",
      "sssss",
      ".sss.",
      ".s.s.",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      "..n..",
      ".nnn.",
    ]),
  },
  sword: {
    grip: [3.5, 17],
    shape: art([
      "...f...",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "..fff..",
      "ggggggg",
      ".ggggg.",
      "...n...",
      "...n...",
      "...n...",
      "...n...",
      "..ggg..",
    ]),
  },
  blade: {
    grip: [3.5, 18],
    shape: art([
      "...m...",
      "...mm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "..mmm..",
      "GGGGGGG",
      ".GGGGG.",
      "...n...",
      "...n...",
      "...n...",
      "...n...",
      "..GGG..",
    ]),
  },
};

const TRINKETS: Record<HdTrinket, Shape> = {
  duck: art([
    "...yyy....",
    "..yyyyy...",
    "..yyiyyoo.",
    "..yyyyyoo.",
    "yy.yyyyy..",
    "yyyyyyyyy.",
    "yyyyyyyyy.",
    ".yyyyyyy..",
  ]),
};

// ─── Anchors ────────────────────────────────────────────────────────────────

export type Anchor = GearAnchor;

/** The crown of a part's shape: the middle of its topmost solid row. */
function crownOf(shape: Shape): [number, number] {
  const m = shapeMask(shape);
  for (let y = 0; y < m.h; y++) {
    const xs: number[] = [];
    for (let x = 0; x < m.w; x++) if (m.key[y * m.w + x]) xs.push(x);
    if (xs.length >= 2 || (xs.length && y > 1)) {
      // Average over the top two rows so a single tip pixel doesn't win.
      const next: number[] = [];
      for (let x = 0; x < m.w && y + 1 < m.h; x++) if (m.key[(y + 1) * m.w + x]) next.push(x);
      const all = [...xs, ...next];
      return [all.reduce((a, b) => a + b, 0) / all.length + 0.5, y];
    }
  }
  return [m.w / 2, 0];
}

/** Bottom tip of a limb shape (where a paw is). */
function tipOf(shape: Shape): [number, number] {
  const m = shapeMask(shape);
  for (let y = m.h - 1; y >= 0; y--) {
    const xs: number[] = [];
    for (let x = 0; x < m.w; x++) if (m.key[y * m.w + x]) xs.push(x);
    if (xs.length) return [xs.reduce((a, b) => a + b, 0) / xs.length + 0.5, y - 1.5];
  }
  return [m.w / 2, m.h - 2];
}

/** Front of a shape at 55% of its height (holding at the chest). */
function frontOf(shape: Shape): [number, number] {
  const m = shapeMask(shape);
  const y = Math.round(m.h * 0.55);
  let x = m.w - 1;
  while (x > 0 && !m.key[y * m.w + x]) x--;
  return [x - 2.5, y];
}

/** The hat and hand anchors of a rig (measured, or the rig's overrides). */
export function anchorsOf(rig: RigDef): { hat: Required<Pick<Anchor, "part" | "at">> & Anchor; hand: Required<Pick<Anchor, "part" | "at">> & Anchor } {
  const byName = (n: string) => rig.parts.find((p) => p.name === n)!;
  const head = rig.parts.find((p) => p.role === "head") ?? rig.parts.find((p) => !p.parent)!;
  const o = rig.anchors?.hat;
  const hatPart = o ? byName(o.part) : head;
  const hat = { ...o, part: hatPart.name, at: o?.at ?? crownOf(hatPart.shape) };
  const paw = rig.parts.find((p) => p.role === "legF" && p.side === 1);
  const body = rig.parts.find((p) => !p.parent)!;
  const h = rig.anchors?.hand;
  const hand = h
    ? { ...h, part: h.part, at: h.at ?? tipOf(byName(h.part).shape) }
    : paw
      ? { part: paw.name, at: tipOf(paw.shape), rot: 0.8 }
      : { part: body.name, at: frontOf(body.shape), rot: 0.7 };
  return { hat, hand };
}

// ─── Equipping a rig ────────────────────────────────────────────────────────

/**
 * Extra rows a hatted frame gets on top, so tall hats (the wizard's) and a
 * victory hop never clip. A hatted frame is `HD_H + HD_HEADROOM` tall with
 * its ground moved down to match: callers align frames by the ground (the
 * bottom), never by the top.
 */
export const HD_HEADROOM = 16;

/** Whether this gear needs the taller canvas. */
export function needsHeadroom(gear?: HdGear): boolean {
  return !!gear?.hat && gear.hat !== "none";
}

const GEAR_HAT = "gear:hat";
const GEAR_TOP = "gear:top";
const GEAR_WEAPON = "gear:weapon";

const equipCache = new Map<RigDef, Map<string, RigDef>>();
const guardCache = new Map<Rarity, Material>();

function guard(r: Rarity): Material {
  let m = guardCache.get(r);
  if (!m) {
    const c = hex(GUARD[r]);
    const toHex = (x: RGBA) => `#${[0, 1, 2].map((i) => x[i].toString(16).padStart(2, "0")).join("")}`;
    m = { ramp: ramp(toHex(mix(c, hex("#000000"), 0.6)), toHex(mix(c, hex("#000000"), 0.3)), toHex(c), toHex(mix(c, hex("#ffffff"), 0.35)), toHex(mix(c, hex("#ffffff"), 0.7))), gloss: 0.6 };
    guardCache.set(r, m);
  }
  return m;
}

/** The rig wearing `gear` (hat and weapon as parts). Cached per rig and gear. */
export function equipRig(rig: RigDef, gear?: HdGear): RigDef {
  const wantHat = !!gear?.hat && gear.hat !== "none";
  if (!gear || (!wantHat && !gear.weapon)) return rig;
  const key = gearKey(gear);
  let byGear = equipCache.get(rig);
  if (!byGear) equipCache.set(rig, (byGear = new Map()));
  const hit = byGear.get(key);
  if (hit) return hit;

  const { hat, hand } = anchorsOf(rig);
  const zOf = (name: string) => rig.parts.find((p) => p.name === name)?.z ?? 1;
  // A hat can replace parts (and their children): the capybara's yuzu.
  const gone = new Set(wantHat ? hat.hides ?? [] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of rig.parts) if (p.parent && gone.has(p.parent) && !gone.has(p.name)) (gone.add(p.name), (grew = true));
  }
  const parts: PartDef[] = rig.parts.filter((p) => !gone.has(p.name));
  if (wantHat) {
    const h = HATS[gear.hat as Exclude<Hat, "none">];
    const m = shapeMask(h.shape);
    const lift = h.float ?? 0;
    parts.push({
      name: GEAR_HAT,
      role: "detail",
      parent: hat.part,
      at: [hat.at[0], hat.at[1] + h.sink - lift],
      pivot: [m.w / 2, m.h],
      rot: hat.rot,
      // Over the head and its ears.
      z: zOf(hat.part) + 0.45,
      shape: h.shape,
    });
    if (h.top) {
      const t = shapeMask(h.top.frames[0]);
      parts.push({
        name: GEAR_TOP,
        role: "detail",
        parent: GEAR_HAT,
        at: h.top.at,
        pivot: [t.w / 2, 0.5],
        z: zOf(hat.part) + 0.46,
        shape: h.top.frames[0],
        variants: Object.fromEntries(h.top.frames.map((f, i) => [`f${i}`, f])),
      });
    }
  }
  if (gear.weapon) {
    const w = WEAPONS[gear.weapon];
    parts.push({
      name: GEAR_WEAPON,
      role: "detail",
      parent: hand.part,
      at: hand.at,
      pivot: w.grip,
      rot: hand.rot ?? 0.7,
      // In front of everything: held out toward the foe.
      z: Math.max(...rig.parts.map((p) => p.z)) + 0.1,
      shape: w.shape,
    });
  }
  const materials: Record<string, Material> = { ...rig.materials, ...GEAR_MATERIALS };
  if (gear.weapon === "blade") materials[LEGEND.G] = guard(gear.weaponRarity ?? "common");
  // Hats get headroom: the canvas grows upward, everything moves down.
  const pad = needsHeadroom(gear) ? HD_HEADROOM : 0;
  const placed = pad ? parts.map((p) => (p.parent ? p : { ...p, at: [p.at[0], p.at[1] + pad] as const })) : parts;
  const out: RigDef = { ...rig, height: rig.height + pad, ground: rig.ground + pad, parts: placed, materials };
  byGear.set(key, out);
  return out;
}

/** Pose additions for animated gear (the propeller spins). */
export function gearPose(pose: Pose, gear: HdGear | undefined, t: number): Pose {
  if (gear?.hat !== "propeller") return pose;
  const frame = Math.floor(t * 16) % 4;
  const parts: Record<string, PartPose> = { ...pose.parts, [GEAR_TOP]: { ...pose.parts[GEAR_TOP], variant: `f${frame}` } };
  return { ...pose, parts };
}

// ─── Standalone sprites (blob gear, trinkets) ───────────────────────────────

const spriteCache = new Map<string, Framebuffer>();

/** One shape rendered alone with the house lighting and outline. */
function sprite(key: string, shape: Shape, rot = 0, materials: Record<string, Material> = GEAR_MATERIALS): Framebuffer {
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const m = shapeMask(shape);
  const pad = Math.ceil(Math.hypot(m.w, m.h) / 2) + 2;
  const W = m.w + 2 * pad;
  const H = m.h + 2 * pad;
  const rig: RigDef = {
    id: `gear-${key}`,
    width: W,
    height: H,
    ground: H - 1,
    shadowRx: 1,
    outline: hex("#140c1e"),
    materials,
    parts: [{ name: "body", role: "body", at: [W / 2, H / 2], pivot: [m.w / 2, m.h / 2], rot, z: 1, shape }],
  };
  const fb = renderRig(rig, { parts: {} }, { noShadow: true });
  spriteCache.set(key, fb);
  return fb;
}

/** Opaque bounds of a framebuffer: [x0, y0, x1, y1] (inclusive). */
function bounds(fb: Framebuffer): [number, number, number, number] {
  let x0 = fb.width;
  let y0 = fb.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      if (fb.get(x, y)[3] < 128) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

/**
 * The trinket on the ground behind the buddy: `restLeft` is the buddy's
 * leftmost pixel at rest (the trinket sits clear of it, so lunges don't
 * shove it around).
 */
export function drawTrinket(fb: Framebuffer, trinket: HdTrinket, restLeft: number, ground: number): void {
  const s = sprite(`trinket:${trinket}`, TRINKETS[trinket]);
  const [x0, y0, x1, y1] = bounds(s);
  const w = x1 - x0 + 1;
  const x = Math.max(1, Math.round(restLeft - w + 2));
  const y = ground - (y1 - y0);
  // A small contact shadow, then the toy.
  fb.ellipse(x + w / 2, ground + 0.5, w / 2 + 0.5, 1.2, hex("#0c0818"), 0.35);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const c = s.get(i, j);
    if (c[3]) fb.blend(x + i - x0, y + j - y0, c);
  }
}

/** The blob's hat and weapon, placed on its jelly body. */
export function drawBlobGear(fb: Framebuffer, gear: HdGear, body: { cx: number; cy: number; rx: number; ry: number }, t: number): void {
  if (gear.weapon) {
    const w = WEAPONS[gear.weapon];
    const mats = gear.weapon === "blade" ? { ...GEAR_MATERIALS, [LEGEND.G]: guard(gear.weaponRarity ?? "common") } : GEAR_MATERIALS;
    const s = sprite(`weapon:${gear.weapon}:${gear.weaponRarity ?? ""}`, w.shape, 0.7, mats);
    // Held against the front of the jelly, grip low.
    const [x0, , x1, y1] = bounds(s);
    const gx = Math.round(body.cx + body.rx * 0.78 - (x1 - x0) / 2 - x0);
    const gy = Math.round(body.cy + body.ry * 0.35 - y1);
    fb.draw(s, gx, gy);
  }
  if (gear.hat && gear.hat !== "none") {
    const h = HATS[gear.hat];
    const s = sprite(`hat:${gear.hat}`, h.shape);
    const [x0, , x1, y1] = bounds(s);
    const x = Math.round(body.cx - (x1 + x0 + 1) / 2);
    const y = Math.round(body.cy - body.ry - (y1 + 1) + h.sink + 1 - (h.float ?? 0));
    fb.draw(s, x, y);
    if (h.top) {
      const frame = Math.floor(t * 16) % 4;
      const top = sprite(`hattop:${gear.hat}:${frame}`, h.top.frames[frame]);
      const [tx0, ty0, tx1, ty1] = bounds(top);
      const hb = bounds(s);
      fb.draw(top, Math.round(body.cx - (tx1 + tx0 + 1) / 2), y + hb[1] - (ty1 - ty0) - ty0 - 1 + 1);
    }
  }
}

/** Gear keys (for validators): every Greek material key gear can use. */
export const GEAR_MATERIAL_KEYS: readonly string[] = Object.values(LEGEND);
