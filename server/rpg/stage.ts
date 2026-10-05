/**
 * The fight stage: a fixed-size cell canvas the battle scene is drawn on.
 *
 * Replaces string-splicing for the RPG scene so actors can move freely
 * (lunges, knockback, hops, slide-ins, sinking KOs), be tinted (hit flash,
 * heal glow, KO dim) and carry particles (damage pops, sparkles, stun stars,
 * projectiles) without the scene ever changing size: the static battle
 * screen and every animation frame render through the same geometry.
 * Pure — no clock, no I/O. See docs/game-feel/buddy-quest/design-animation.md.
 */

import type { Eye, Hat, Species } from "../engine";
import { applyBossCrown, applyHat, displayWidth, eyeRowIndex, getArtFrame, mirrorFrame, rectFrame } from "../art";
import type { Battle, Side } from "./battle";

// ─── Palette ────────────────────────────────────────────────────────────────

/** SGR parameter strings, by role. */
export const INK = {
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  dim: "2",
  gray: "90",
  white: "1;97",
  gold: "1;33",
  crit: "1;93",
  hurt: "1;31",
  heal: "1;32",
  shield: "1;36",
} as const;
export type Ink = keyof typeof INK;

/** Whole-sprite recolors. */
export type Tint = "flash" | "hurt" | "heal" | "glow" | "dim" | "poison" | "rage" | "magic";
const TINT_INK: Record<Tint, string> = {
  flash: INK.white,
  hurt: INK.hurt,
  heal: INK.heal,
  glow: INK.gold,
  dim: "2;90",
  poison: "32",
  rage: "31",
  magic: "1;35",
};

// ─── Canvas ─────────────────────────────────────────────────────────────────

interface Cell {
  /** "" marks the right half of a double-width glyph. */
  ch: string;
  sgr: string;
}

const SGR_RE = /^\x1b\[([0-9;]*)m/;

/** A grid of cells with clipping, transparency and wide-glyph safety. */
export class Canvas {
  readonly rows: Cell[][];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: " ", sgr: "" })));
  }

  private set(x: number, y: number, ch: string, sgr: string): void {
    const row = this.rows[y];
    // Never leave half a wide glyph behind.
    if (row[x].ch === "" && x > 0) row[x - 1] = { ch: " ", sgr: "" };
    if (x + 1 < this.width && row[x + 1].ch === "") row[x + 1] = { ch: " ", sgr: "" };
    row[x] = { ch, sgr };
  }

  /**
   * Draw `text` with its left edge at (x, y). Embedded SGR escapes are parsed
   * into cell styles; `ink` (when given) overrides them. Spaces are
   * transparent unless `opaque`. Anything off-canvas is clipped.
   */
  put(x: number, y: number, text: string, ink?: string, opaque = false): void {
    if (y < 0 || y >= this.height) return;
    let sgr = "";
    let cx = x;
    for (let i = 0; i < text.length; ) {
      const m = text[i] === "\x1b" ? SGR_RE.exec(text.slice(i)) : null;
      if (m) {
        sgr = m[1] === "0" || m[1] === "" ? "" : m[1];
        i += m[0].length;
        continue;
      }
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      i += ch.length;
      const w = displayWidth(ch);
      if (w === 0) continue;
      if (ch === " " && !opaque) {
        cx += 1;
        continue;
      }
      if (cx >= 0 && cx + w <= this.width) {
        this.set(cx, y, ch, ink ?? sgr);
        if (w === 2) this.set(cx + 1, y, "", ink ?? sgr);
      }
      cx += w;
    }
  }

  /** Recolor every non-blank cell in a rectangle. */
  tint(x0: number, y0: number, w: number, h: number, sgr: string): void {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) {
        const c = this.rows[y][x];
        if (c.ch !== " " && c.ch !== "") c.sgr = sgr;
      }
    }
  }

  lines(color: boolean): string[] {
    return this.rows.map((row) => {
      let out = "";
      let cur = "";
      for (const c of row) {
        if (c.ch === "") continue;
        // Spaces keep the running style (fg-only inks don't show on blanks).
        const want = c.ch === " " ? cur : c.sgr;
        if (color && want !== cur) {
          out += want ? `\x1b[0m\x1b[${want}m` : "\x1b[0m";
          cur = want;
        }
        out += c.ch;
      }
      if (color && cur) out += "\x1b[0m";
      return out;
    });
  }
}

// ─── Stage state ────────────────────────────────────────────────────────────

export interface ActorState {
  /** Horizontal offset from the rest position, in cells (+ = rightward). */
  x?: number;
  /** Vertical offset (− = up). */
  y?: number;
  eye?: Eye;
  /** Idle-animation frame (0 or 1; "blink" closes the eyes). */
  frame?: 0 | 1 | "blink";
  tint?: Tint;
  /** KO: rows sunk into the ground. */
  sink?: number;
  hidden?: boolean;
  /** HD hint: the actor is travelling on foot (intro, flee). The cell stage
   *  ignores it. */
  act?: "walk";
}

/** A particle: text anchored to an actor's center, the gap, or the canvas. */
export interface Mote {
  at: Side | "gap" | "abs";
  /** Column offset from the anchor center (or absolute column for "abs"). */
  dx?: number;
  /** Absolute row (0 = top of the headroom). Negative counts up from the ground. */
  y: number;
  text: string;
  ink?: Ink;
  /** Left-align at the anchor instead of centering. */
  left?: boolean;
}

/** Persistent conditions drawn at rest (the static screen shows them too). */
export interface Marks {
  guard?: boolean;
  charge?: number;
  stun?: boolean;
  poison?: boolean;
  blind?: boolean;
  buff?: boolean;
  foeShield?: boolean;
  enraged?: boolean;
  /** How the fight ended — KO pose / empty spot. */
  over?: Battle["over"];
}

export interface StageState {
  hero?: ActorState;
  foe?: ActorState;
  motes?: Mote[];
  /** Whole-stage horizontal jolt (−1, 0, 1). */
  shake?: number;
  marks?: Marks;
  /** Encounter wipe: the stripe band's leading column (undefined = none). */
  wipe?: number;
  /** Ambient tick, rotates the stun stars / pulses the charge. */
  tick?: number;
  /** HD hints the cell stage ignores: the contact moment of a blow, which
   *  the HD stage hangs hit-stop, sparks, shake and the camera on; a
   *  special-move cut-in or a boss phase change played before this cue. */
  hd?: { impact?: Impact; cutin?: CutinHint; phase?: boolean };
}

export interface CutinHint {
  /** The move's name, in big type on the panel. */
  name: string;
  by: Side;
}

export interface Impact {
  by: Side;
  dmg: number;
  crit: boolean;
  heavy: boolean;
  /** Bombs, the duck, thorns: no lunge, the blow arrives from range. */
  ranged?: boolean;
}

export function marksOf(b: Battle): Marks {
  return {
    guard: b.hero.guard && !b.over,
    charge: b.foe.charge ? 3 : 0,
    stun: !!b.foe.fx.stun && !b.over,
    poison: !!b.hero.fx.poison,
    blind: !!b.hero.fx.blind,
    buff: !!b.hero.fx.buff,
    foeShield: !!b.foe.fx.shield,
    enraged: !!b.foe.fx.enraged,
    over: b.over,
  };
}

// ─── Stage ──────────────────────────────────────────────────────────────────

export interface StageCast {
  species: Species;
  eye: Eye;
  hat: string;
  foeSpecies: Species;
  boss: boolean;
}

/** Rows above the sprites for pops and status marks. */
export const HEADROOM = 2;
/** Cells between the two sprite slots. */
export const GAP = 6;
/** Margin either side, so knockback and flee have somewhere to go. */
export const PAD = 2;

export const FOE_EYE = "×" as Eye;
export const EYES = {
  attack: ">" as Eye,
  hurt: "x" as Eye,
  ko: "x" as Eye,
  stun: "@" as Eye,
  happy: "^" as Eye,
  blink: "-" as Eye,
  shock: "°" as Eye,
};

interface Sprite {
  rows: string[];
  width: number;
}

/**
 * One fight's fixed geometry plus a sprite cache. Build once per battle and
 * render as many states as needed; every render is width × height.
 */
export class Stage {
  readonly width: number;
  readonly height: number;
  readonly heroW: number;
  readonly foeW: number;
  readonly heroX: number;
  readonly foeX: number;
  readonly bodyH: number;
  /** Canvas row of the hero's eyes — where clashes and shields sit. */
  readonly eyeY: number;
  private readonly cache = new Map<string, Sprite>();

  constructor(readonly cast: StageCast) {
    const probe = [0, 1].flatMap((f) => [this.raw("hero", cast.eye, f), this.raw("foe", FOE_EYE, f)]);
    this.heroW = Math.max(...[0, 1].map((f) => this.raw("hero", cast.eye, f).width));
    this.foeW = Math.max(...[0, 1].map((f) => this.raw("foe", FOE_EYE, f).width));
    const tall = Math.max(...probe.map((s) => s.rows.length));
    // Trim rows blank in every frame of both sprites (bottom-aligned).
    let trim = 0;
    while (
      trim < tall - 1 &&
      probe.every((s) => {
        const i = trim - (tall - s.rows.length);
        return i < 0 || !s.rows[i].trim();
      })
    )
      trim++;
    this.bodyH = tall - trim;
    this.height = HEADROOM + this.bodyH;
    const heroRows = this.raw("hero", cast.eye, 0).rows.length;
    this.eyeY = Math.max(HEADROOM, this.height - heroRows + eyeRowIndex(cast.species));
    this.heroX = PAD;
    this.foeX = PAD + this.heroW + GAP;
    this.width = this.foeX + this.foeW + PAD;
  }

  private raw(side: Side, eye: Eye, frame: number): Sprite {
    const key = `${side}|${eye}|${frame}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    let rows: string[];
    try {
      if (side === "hero") {
        const art = getArtFrame(this.cast.species, eye, frame);
        if (this.cast.hat && this.cast.hat !== "none") applyHat(this.cast.species, this.cast.hat as Hat, art);
        rows = rectFrame(art);
      } else {
        const art = getArtFrame(this.cast.foeSpecies, eye, frame);
        if (this.cast.boss) applyBossCrown(art);
        rows = mirrorFrame(art);
      }
    } catch {
      rows = ["?"];
    }
    const s = { rows, width: rows.reduce((m, l) => Math.max(m, displayWidth(l)), 0) };
    this.cache.set(key, s);
    return s;
  }

  /** Top-left canvas position of a side at rest. */
  private home(side: Side): number {
    return side === "hero" ? this.heroX : this.foeX;
  }

  private slotW(side: Side): number {
    return side === "hero" ? this.heroW : this.foeW;
  }

  /** Canvas column of a side's center, including its current offset. */
  center(side: Side, a?: ActorState): number {
    return this.home(side) + (a?.x ?? 0) + Math.floor(this.slotW(side) / 2);
  }

  private drawActor(cv: Canvas, side: Side, a: ActorState, shake: number): void {
    if (a.hidden) return;
    const restEye = side === "hero" ? this.cast.eye : FOE_EYE;
    const sp =
      a.frame === "blink" ? this.raw(side, EYES.blink, 0) : this.raw(side, a.eye ?? restEye, a.frame ?? 0);
    const x = this.home(side) + (a.x ?? 0) + shake;
    const sink = a.sink ?? 0;
    // Bottom-align, then apply hop/sink.
    const top = this.height - sp.rows.length + (a.y ?? 0) + sink;
    // Rows above the canvas (the trimmed blank ones) and below the ground
    // (a sinking KO) clip away in `put`.
    sp.rows.forEach((row, i) => cv.put(x, top + i, row));
    if (a.tint) cv.tint(x, top, sp.width, sp.rows.length, TINT_INK[a.tint]);
  }

  private moteX(m: Mote, st: StageState, width: number): number {
    if (m.at === "abs") return m.dx ?? 0;
    const base =
      m.at === "gap" ? this.heroX + this.heroW + Math.floor(GAP / 2) : this.center(m.at, m.at === "hero" ? st.hero : st.foe);
    return base + (m.dx ?? 0) - (m.left ? 0 : Math.floor(width / 2));
  }

  private markMotes(mk: Marks, st: StageState): Mote[] {
    const out: Mote[] = [];
    const t = st.tick ?? 0;
    const eyeRow = this.eyeY;
    if (mk.guard) {
      for (let r = 0; r < 3; r++) out.push({ at: "abs", dx: this.heroX + this.heroW + (st.hero?.x ?? 0), y: eyeRow - 1 + r, text: "▐", ink: "shield" });
    }
    if (mk.foeShield) {
      for (let r = 0; r < 3; r++) out.push({ at: "abs", dx: this.foeX - 1 + (st.foe?.x ?? 0), y: eyeRow - 1 + r, text: "▌", ink: "cyan" });
    }
    if (mk.charge) {
      const n = Math.max(1, Math.min(3, mk.charge - (t % 2)));
      out.push({ at: "foe", y: 1, text: "!".repeat(n), ink: "gold" });
    }
    if (mk.stun) {
      const stars = ["*  ✦  ·", "·  *  ✦", "✦  ·  *"][t % 3];
      out.push({ at: "foe", y: 1, text: stars, ink: "yellow" });
    }
    const heroTags: { text: string; ink: Ink }[] = [];
    if (mk.poison) heroTags.push({ text: t % 2 ? "o°" : "°o", ink: "green" });
    if (mk.blind) heroTags.push({ text: "?", ink: "magenta" });
    if (mk.buff) heroTags.push({ text: "↑", ink: "yellow" });
    if (heroTags.length) {
      let dx = -Math.floor(heroTags.reduce((a, h) => a + displayWidth(h.text) + 1, -1) / 2);
      for (const h of heroTags) {
        out.push({ at: "hero", dx, y: 1, text: h.text, ink: h.ink, left: true });
        dx += displayWidth(h.text) + 1;
      }
    }
    return out;
  }

  /** Render one state to `height` lines of exactly `width` cells. */
  render(st: StageState, color: boolean): string[] {
    const cv = new Canvas(this.width, this.height);
    const mk = st.marks ?? {};
    const shake = st.shake ?? 0;
    const hero: ActorState = { ...restPose("hero", mk), ...st.hero };
    const foe: ActorState = { ...restPose("foe", mk), ...st.foe };
    // Draw the defender first so a lunging attacker overlaps it, not the reverse.
    const heroFront = (hero.x ?? 0) > 0;
    const order: Side[] = heroFront ? ["foe", "hero"] : ["hero", "foe"];
    for (const side of order) this.drawActor(cv, side, side === "hero" ? hero : foe, shake);
    const motes = [...this.markMotes(mk, { ...st, hero, foe }), ...(st.motes ?? [])];
    for (const m of motes) {
      const w = displayWidth(m.text);
      const y = m.y < 0 ? this.height + m.y : m.y;
      cv.put(this.moteX(m, { ...st, hero, foe }, w) + shake, y, m.text, m.ink ? INK[m.ink] : undefined);
    }
    if (st.wipe !== undefined) {
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const d = st.wipe - (x + 2 * y);
          if (d >= 0 && d < 6) cv.put(x, y, d < 2 ? "╱" : d < 4 ? "▚" : "█", INK[this.cast.boss ? "red" : "magenta"]);
          else if (d >= 6 && d < 9) cv.put(x, y, "╱", INK.dim);
        }
      }
    }
    return cv.lines(color);
  }
}

/** The resting pose implied by the marks (KO, stun, flee). */
export function restPose(side: Side, mk: Marks): ActorState {
  if (side === "foe") {
    if (mk.over === "win") return { eye: EYES.ko, sink: 2, tint: "dim" };
    if (mk.stun) return { eye: EYES.stun };
    if (mk.enraged) return { tint: "rage" };
    return {};
  }
  if (mk.over === "lose") return { eye: EYES.ko, sink: 2, tint: "dim" };
  if (mk.over === "fled") return { hidden: true };
  if (mk.over === "win") return { eye: EYES.happy };
  return {};
}

/** Build the stage for a battle. */
export function stageFor(b: Battle, look: { species: Species; eye: Eye; hat: string }): Stage {
  return new Stage({ species: look.species, eye: look.eye, hat: look.hat, foeSpecies: b.foe.species, boss: !!b.foe.boss });
}
