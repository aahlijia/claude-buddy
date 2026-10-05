/**
 * The buddy-shell diorama panel (H4, docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 * Everything buddy-shell needs to show server/gfx/diorama.ts in its bottom
 * panel, kept free of the PTY so it can be tested: the gates, the pacing
 * (fps, idle, sleep, a byte budget), the text overlay (name card, speech
 * bubble), reactions to Claude Code hooks, and the three ways of putting
 * pixels on screen:
 *
 *   kitty      sky, far, mid and near layers uploaded once per light change,
 *              panned with source rectangles (parallax for ~60 bytes); the
 *              buddy swaps between cached frame images; the weather loop is
 *              uploaded once and, in kitty itself, played by the terminal.
 *   iterm      the composed picture as an inline PNG, at a low frame rate.
 *   halfblock  the composed picture as ▀ cells; only changed cells are sent.
 *
 * `paint()` returns the bytes for one frame; the caller writes them. Every
 * write is wrapped in save/restore cursor and positioned absolutely below
 * the child's rows, so the child's region is never touched.
 */

import type { Rarity, Species } from "../server/engine.ts";
import { BIOME_SCENES } from "../server/gfx/biomes.ts";
import { tmuxWrap, type Tier } from "../server/gfx/detect.ts";
import type { HdGear } from "../server/gfx/gear.ts";
import {
  PARALLAX,
  REACTION_SECONDS,
  SCENE_WEATHERS,
  beatAt,
  buddySprite,
  cameraFor,
  composeDiorama,
  dioramaLight,
  dioramaSpec,
  hasFront,
  paintFront,
  paintLayer,
  paintPlate,
  paintSkyLayer,
  panMargin,
  reactionFor,
  stepBeat,
  wanderZone,
  type Activity,
  type Beat,
  type DioramaSpec,
  type Hold,
  type LayerName,
  type Plate,
  type SceneWeather,
} from "../server/gfx/diorama.ts";
import { CellGrid, diffCells, halfblockCells, narrow, overlayText, type TextRun } from "../server/gfx/encode/cells.ts";
import type { ColorMode } from "../server/gfx/encode/halfblock.ts";
import { encodeIterm } from "../server/gfx/encode/iterm.ts";
import { kittyDelete, kittyFrame, kittyLoop, kittyPlace, kittyUnplace, kittyUpload } from "../server/gfx/encode/kitty.ts";
import { Framebuffer, hex, type RGBA } from "../server/gfx/framebuffer.ts";
import { hasHd } from "../server/gfx/hd.ts";
import { FIELD_LOOP } from "../server/gfx/particles.ts";
import { hourOf } from "../server/gfx/sky.ts";

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** The slice of status.json the panel reads. */
export interface PanelStatus {
  name?: string;
  species?: string;
  rarity?: string;
  shiny?: boolean;
  stars?: string;
  level?: number;
  reaction?: string;
  muted?: boolean;
  sceneWeather?: string;
  gameFeel?: string;
  /** The HD look's hat, weapon and trinket (status.json `hdGear`). */
  hdGear?: HdGear;
}

export interface PanelStats {
  stats?: Record<string, number>;
  peak?: string;
  dump?: string;
}

export interface PanelConfig {
  gameFeel?: string;
  reduceMotion?: boolean;
}

export interface PanelLayout {
  cols: number;
  rows: number;
  /** Rows the child owns (1..code); the panel is code+1..rows. */
  code: number;
}

export interface PanelOptions {
  tier: Tier;
  color: ColorMode;
  tmux: boolean;
  /** The terminal plays kitty animations itself (kitty proper, not every kitty-protocol terminal). */
  kittyNative?: boolean;
  biome?: string;
  /** Pin the clock (previews, screenshots). */
  hour?: number;
  weather?: string;
  /** Byte budget per second (default 48 KiB). */
  maxBytesPerSec?: number;
}

/** Pixels per cell in each tier. */
export const DENSITY: Record<"kitty" | "iterm" | "halfblock", { cx: number; cy: number }> = {
  kitty: { cx: 4, cy: 8 },
  iterm: { cx: 2, cy: 4 },
  halfblock: { cx: 1, cy: 2 },
};

/** Frames per second while active, by tier (iTerm re-sends whole PNGs). */
const FPS: Record<"kitty" | "iterm" | "halfblock", number> = { kitty: 12, iterm: 4, halfblock: 12 };
/** No input or child output for this long → half rate. */
export const IDLE_MS = 30_000;
/** …and for this long → stop animating until something happens. */
export const SLEEP_MS = 5 * 60_000;
/** How long a new speech bubble stays up. */
export const BUBBLE_MS = 20_000;
/** Child output this soon after a keystroke is just the echo, not Claude working. */
const ECHO_MS = 300;
/** Claude is "thinking" while it has written output in the last this-many ms. */
const THINK_MS = 1500;

const STATS_W = 22;
/** Fewest panel rows worth a diorama: half-blocks need room for a ~10 px buddy. */
const MIN_ROWS: Record<string, number> = { kitty: 4, iterm: 4, halfblock: 7 };

const RARITY_RGB: Record<string, RGBA> = {
  common: hex("#b8b8c0"),
  uncommon: hex("#6ee07a"),
  rare: hex("#6aa8ff"),
  epic: hex("#e07aff"),
  legendary: hex("#ffd25a"),
};

/** Kitty image ids: one block per panel so two shells never collide. */
const KITTY_BASE = 0x6b40_0000;
const ID = { sky: 1, far: 2, mid: 3, near: 4, plates: 5, front: 6, frontFrames: 100, buddy: 1000 } as const;
const Z: Record<string, number> = { sky: -60, far: -50, mid: -40, near: -30, buddy: -20, front: -10, plates: -5 };
const BUDDY_CACHE = 160;
const FRONT_FPS = 6;

/**
 * Whether the diorama replaces the ASCII panel. `gameFeel` off, species
 * without HD art, a text-only terminal or a tiny panel all keep today's panel.
 */
export function dioramaEnabled(tier: Tier, status: PanelStatus | null, cfg: PanelConfig, layout: PanelLayout): boolean {
  if (!status || tier === "ascii") return false;
  const feel = status.gameFeel ?? cfg.gameFeel ?? "subtle";
  if (feel === "off") return false;
  if (!status.species || !hasHd(status.species as Species)) return false;
  return layout.rows - layout.code - 1 >= (MIN_ROWS[tier] ?? 7) && layout.cols >= 40;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of narrow(text).split(/\s+/).filter(Boolean)) {
    const w = word.length > width ? word.slice(0, width - 1) + "…" : word;
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = out[maxLines - 1].slice(0, width - 1) + "…";
  }
  return out;
}

// ─── The panel ──────────────────────────────────────────────────────────────

interface Overlay {
  runs: TextRun[];
  plates: Plate[];
  key: string;
}

export class DioramaPanel {
  readonly tier: "kitty" | "iterm" | "halfblock";
  private status: PanelStatus = {};
  private stats: PanelStats | null = null;
  private cfg: PanelConfig = {};
  private layout: PanelLayout = { cols: 80, rows: 24, code: 19 };
  private start = 0;
  private holds: Hold[] = [];
  private heldBefore = 0;
  private lastInput = -Infinity;
  private lastActivity = 0;
  private lastOutput = -Infinity;
  private focused = true;
  /** Panel time stops while asleep, so waking up resumes the scene where it was. */
  private pausedMs = 0;
  private sleepingSince: number | null = null;
  private bubbleText = "";
  private bubbleUntil = 0;
  private focusHint = false;
  private message = "";
  // Pacing
  private sent: [number, number][] = [];
  private tokens: number;
  private tokensAt = 0;
  private totalBytes = 0;
  private lastFrameKey = "";
  // Half-block / iTerm state
  private grid: CellGrid | null = null;
  // Kitty state
  private sceneKey = "";
  private frontKey = "";
  private frontReady = 0;
  private frontFrames = 0;
  private frontShown = -1;
  private platesKey = "";
  private placedPans: Partial<Record<LayerName, number>> = {};
  private buddyIds = new Map<string, number>();
  private nextBuddyId: number = ID.buddy;
  private buddyShown: { id: number; col: number; row: number } | null = null;
  private uploaded = new Set<number>();

  constructor(private readonly opts: PanelOptions) {
    this.tier = opts.tier === "kitty" || opts.tier === "iterm" ? opts.tier : "halfblock";
    this.tokens = this.budget;
  }

  private get budget(): number {
    return this.opts.maxBytesPerSec ?? 48 * 1024;
  }

  // ── Events from the shell ────────────────────────────────────────────────

  /** Fresh status.json, menagerie stats and config. */
  update(now: number, status: PanelStatus, stats: PanelStats | null, cfg: PanelConfig): void {
    if (!this.start) this.start = now;
    const said = !status.muted && status.reaction ? status.reaction : "";
    if (said !== this.bubbleText) {
      this.bubbleText = said;
      this.bubbleUntil = said ? now + BUBBLE_MS : 0;
      this.wake(now);
    }
    this.status = status;
    this.stats = stats;
    this.cfg = cfg;
  }

  resize(layout: PanelLayout): void {
    this.layout = layout;
    this.invalidate();
  }

  /** A Claude Code hook fired (reaction.json changed): flinch, cheer or nod. */
  react(reason: string | null | undefined, now: number): void {
    const kind = reactionFor(reason);
    this.wake(now);
    if (!kind) return;
    const t = this.t(now);
    this.holds.push({ kind, from: t, to: t + REACTION_SECONDS[kind] });
  }

  /** The user typed. */
  input(now: number): void {
    this.lastInput = now;
    this.wake(now);
  }

  /** The child wrote output (Claude working, unless it's the keystroke echo). */
  output(now: number): void {
    if (now - this.lastInput < ECHO_MS) return;
    this.wake(now);
    const t = this.t(now);
    if (now - this.lastOutput > THINK_MS) this.holds.push({ kind: "think", from: t, to: Infinity });
    this.lastOutput = now;
  }

  focus(on: boolean, now: number): void {
    if (!on) this.sleepingSince ??= now;
    this.focused = on;
    if (on) this.wake(now);
  }

  private wake(now: number): void {
    this.lastActivity = now;
    if (this.sleepingSince === null) return;
    this.pausedMs += Math.max(0, now - this.sleepingSince);
    this.sleepingSince = null;
  }

  private asleep(now: number): boolean {
    return !this.focused || now - this.lastActivity > SLEEP_MS;
  }

  /** Asleep: the clock stops (from when the quiet began), so a repair repaint shows the same frame. */
  private settle(now: number): void {
    if (this.asleep(now)) this.sleepingSince ??= Math.min(now, this.focused ? this.lastActivity + SLEEP_MS : now);
  }

  /** The focus hint and the menu line come from the shell's own state. */
  setChrome(focus: boolean, message: string): void {
    this.focusHint = focus;
    this.message = message;
  }

  /** Forget what's on screen: the next paint redraws everything. */
  invalidate(): void {
    this.grid = null;
    this.sceneKey = "";
    this.platesKey = "";
    this.placedPans = {};
    this.buddyShown = null;
    this.frontShown = -1;
    this.lastFrameKey = "";
  }

  // ── Clocks and gates ─────────────────────────────────────────────────────

  private t(now: number): number {
    if (!this.start) this.start = now;
    const asleepFor = this.sleepingSince !== null ? Math.max(0, now - this.sleepingSince) : 0;
    return (now - this.start - this.pausedMs - asleepFor) / 1000;
  }

  private get still(): boolean {
    return !!this.cfg.reduceMotion;
  }

  private get feel(): string {
    return this.status.gameFeel ?? this.cfg.gameFeel ?? "subtle";
  }

  /** Milliseconds until the next frame is due, or null to sleep until an event. */
  nextDelay(now: number): number | null {
    if (this.still || this.asleep(now)) return null;
    const quiet = now - this.lastActivity;
    const fps = FPS[this.tier] / (quiet > IDLE_MS ? 2 : 1);
    return Math.round(1000 / fps);
  }

  /** Bytes/second over the last 10 s, and the total (for `BUDDY_DIORAMA_STATS`). */
  rate(now: number): { bps: number; total: number } {
    const recent = this.sent.filter(([at]) => now - at < 10_000);
    this.sent = recent;
    return { bps: Math.round(recent.reduce((s, [, n]) => s + n, 0) / 10), total: this.totalBytes };
  }

  private spend(now: number, bytes: number): void {
    this.sent.push([now, bytes]);
    this.totalBytes += bytes;
    this.tokens -= bytes;
  }

  private refill(now: number): void {
    this.tokens = Math.min(this.budget, this.tokens + ((now - this.tokensAt) / 1000) * this.budget);
    this.tokensAt = now;
  }

  // ── Scene ────────────────────────────────────────────────────────────────

  private get density() {
    return DENSITY[this.tier];
  }

  /** Content rows (below the separator) and their first screen row. */
  private get box() {
    const { cols, rows, code } = this.layout;
    return { top: code + 2, rows: rows - code - 1, cols };
  }

  private spec(now: number, wallClock: Date): DioramaSpec {
    const { cx, cy } = this.density;
    const weather = (this.opts.weather ?? this.status.sceneWeather) as SceneWeather | undefined;
    return dioramaSpec({
      biome: this.opts.biome,
      rarity: (this.status.rarity ?? "common") as Rarity,
      species: (this.status.species ?? "blob") as Species,
      shiny: this.status.shiny,
      gear: this.status.hdGear,
      w: this.box.cols * cx,
      h: this.box.rows * cy,
      hour: this.opts.hour ?? hourOf(wallClock, 5),
      weather: weather && (SCENE_WEATHERS as readonly string[]).includes(weather) ? weather : null,
      seed: fnv(this.status.name ?? "buddy"),
      flash: this.feel === "full" && !this.still,
      particles: this.tier === "halfblock" ? 0.3 : 1,
    });
  }

  private activity(t: number): Activity {
    // Close a think hold once Claude has been quiet for a while.
    for (const h of this.holds) {
      const quietAt = this.t(this.lastOutput) + THINK_MS / 1000;
      if (h.kind === "think" && h.to === Infinity && quietAt < t) h.to = Math.max(h.from + 1, quietAt);
    }
    // Fold holds that ended long ago into the offset.
    const keep: Hold[] = [];
    for (const h of this.holds) {
      if (h.to < t - 60) this.heldBefore += h.to - h.from;
      else keep.push(h);
    }
    this.holds = keep;
    return { holds: this.holds, heldBefore: this.heldBefore };
  }

  private zone(spec: DioramaSpec): [number, number] {
    return wanderZone(spec.w, (STATS_W + 2) * this.density.cx);
  }

  // ── Overlay: name card, stats, speech bubble, menu ───────────────────────

  private overlay(now: number): Overlay {
    const { cols, rows } = this.box;
    const { cx, cy } = this.density;
    const runs: TextRun[] = [];
    const plates: Plate[] = [];
    const s = this.status;
    const card = hex("#100e1c");
    const plate = (col: number, row: number, w: number, h: number, c: RGBA, a: number) =>
      plates.push({ x: col * cx, y: row * cy, w: w * cx, h: h * cy, color: [c[0], c[1], c[2], Math.round(a * 255)] });

    // Name card (top right).
    const clr = RARITY_RGB[s.rarity ?? "common"] ?? RARITY_RGB.common;
    const lines: TextRun[] = [];
    const left = cols - STATS_W;
    lines.push({ row: 0, col: left + 1, text: `${s.name ?? "buddy"}${s.shiny ? " ✦" : ""}`, fg: clr, bold: true });
    lines.push({ row: 1, col: left + 1, text: `${(s.rarity ?? "").toUpperCase()} ${s.species ?? ""} ${s.stars ?? ""}`.trim(), fg: clr });
    for (const [k, v] of Object.entries(this.stats?.stats ?? {})) {
      const mark = k === this.stats?.peak ? "▲" : k === this.stats?.dump ? "▼" : " ";
      const fg = k === this.stats?.peak ? hex("#6ee07a") : k === this.stats?.dump ? hex("#ff6a6a") : hex("#a8a4c0");
      lines.push({ row: lines.length, col: left + 1, text: `${k.padEnd(10)} ${String(v).padStart(3)}${mark}`, fg });
    }
    const shown = lines.slice(0, rows);
    for (const l of shown) l.text = l.text.slice(0, STATS_W - 2);
    plate(left, 0, STATS_W, shown.length, card, 0.72);
    runs.push(...shown);

    // Menu and message (top and bottom left).
    const menu = `${this.focusHint ? "▸ " : "  "}Dashboard`;
    plate(0, 0, menu.length + 2, 1, card, this.focusHint ? 0.85 : 0.45);
    runs.push({ row: 0, col: 1, text: menu, fg: this.focusHint ? hex("#ffd25a") : hex("#8a86a0"), bold: this.focusHint });
    if (this.message) {
      const m = `✓ ${this.message}`;
      plate(0, rows - 1, m.length + 2, 1, card, 0.8);
      runs.push({ row: rows - 1, col: 1, text: m, fg: hex("#6ee07a") });
    }

    // Speech bubble: pale card upper-left of the wander zone, for BUBBLE_MS.
    if (this.bubbleText && now < this.bubbleUntil) {
      const zoneLeft = Math.floor(cols * 0.3);
      const maxW = Math.max(8, Math.min(36, cols - STATS_W - zoneLeft - 4));
      const text = wrap(this.bubbleText, maxW, Math.max(1, rows - 3));
      const w = Math.max(...text.map((l) => l.length)) + 2;
      const col = Math.max(1, Math.min(zoneLeft - 2, cols - STATS_W - w - 2));
      plate(col, 0, w, text.length, hex("#f4f0e8"), 0.94);
      // A little tail under the bubble, toward the buddy.
      plates.push({ x: (col + w - 3) * cx, y: text.length * cy, w: Math.max(1, cx), h: Math.max(1, Math.round(cy / 2)), color: [244, 240, 232, 240] });
      text.forEach((line, i) => runs.push({ row: i, col: col + 1, text: line, fg: hex("#2a2438") }));
    }
    const key = JSON.stringify([runs.map((r) => [r.row, r.col, r.text, r.fg, r.bold]), plates]);
    return { runs, plates, key };
  }

  /** The overlay text for tiers whose pixels sit under the text (kitty). */
  private textBytes(o: Overlay): string {
    const { top } = this.box;
    let out = "";
    for (const r of o.runs) {
      out += `\x1b[${top + r.row};${r.col + 1}H\x1b[0${r.bold ? ";1" : ""};38;2;${r.fg[0]};${r.fg[1]};${r.fg[2]}m${narrow(r.text)}`;
    }
    return out + "\x1b[0m";
  }

  /** What the scene would show at `now` (tests, previews). */
  peek(now: number, wallClock: Date): { spec: DioramaSpec; beat: Beat } {
    this.settle(now);
    const spec = this.spec(now, wallClock);
    const t = this.t(now);
    return { spec, beat: beatAt(spec, this.still ? 0 : t, this.zone(spec), this.activity(t), this.still) };
  }

  // ── Paint ────────────────────────────────────────────────────────────────

  /**
   * The bytes for one frame. `full` redraws everything (after a resize, a
   * clear, or the dashboard). Returns "" when nothing changed or the frame
   * is over budget.
   */
  paint(now: number, wallClock: Date, full = false): string {
    if (full) this.invalidate();
    this.settle(now);
    this.refill(now);
    if (this.box.rows < 1) return "";
    const t = this.t(now);
    const spec = this.spec(now, wallClock);
    const act = this.activity(t);
    const beat = stepBeat(beatAt(spec, this.still ? 0 : t, this.zone(spec), act, this.still)).beat;
    // Weather steps at FRONT_FPS in every tier (it's what kitty's loop holds,
    // and it halves the half-block cells that change per frame).
    const ft = this.still ? 0 : Math.floor(t * FRONT_FPS) / FRONT_FPS;
    const ov = this.overlay(now);
    let body: string;
    if (this.tier === "kitty") body = this.paintKitty(now, spec, beat, ft, ov);
    else body = this.paintComposed(now, spec, beat, ft, ov, full);
    if (!body) return "";
    const out = `\x1b7${body}\x1b8`;
    this.spend(now, out.length);
    return out;
  }

  /** Half-block and iTerm: compose the whole picture, then encode it. */
  private paintComposed(now: number, spec: DioramaSpec, beat: Beat, t: number, ov: Overlay, full: boolean): string {
    const { top, cols, rows } = this.box;
    const fb = composeDiorama(spec, { t, beat, plates: ov.plates });
    if (this.tier === "halfblock") {
      const { grid, under } = halfblockCells(fb, this.opts.color);
      for (const r of ov.runs) overlayText(grid, under, r, this.opts.color);
      const bytes = diffCells(this.grid, grid, top, 1);
      // Over budget: keep the old grid so the skipped cells go out next time.
      if (!full && this.grid && bytes.length > this.tokens) return "";
      this.grid = grid;
      return bytes;
    }
    // iTerm: one PNG per changed frame, then the text on the card colors.
    const key = `${beat.anim}|${Math.round(beat.t * FPS.iterm)}|${Math.round(beat.x)}|${beat.think}|${Math.round(t * FPS.iterm)}|${ov.key}|${spec.hour}|${spec.weather}`;
    if (!full && key === this.lastFrameKey) return "";
    let img = encodeIterm(fb, { cols, rows });
    if (this.opts.tmux) img = tmuxWrap(img);
    if (!full && img.length > this.tokens) return "";
    this.lastFrameKey = key;
    let text = "";
    for (const r of ov.runs) {
      let col = r.col;
      for (const ch of narrow(r.text)) {
        const c = fb.get(col * this.density.cx + 1, r.row * this.density.cy + 1);
        text += `\x1b[${top + r.row};${col + 1}H\x1b[0${r.bold ? ";1" : ""};38;2;${r.fg[0]};${r.fg[1]};${r.fg[2]};48;2;${c[0]};${c[1]};${c[2]}m${ch}`;
        col++;
      }
    }
    return `\x1b[${top};1H${img}${text}\x1b[0m`;
  }

  private k(seq: string): string {
    return this.opts.tmux ? tmuxWrap(seq) : seq;
  }

  private at(row: number, col = 0): string {
    return `\x1b[${this.box.top + row};${col + 1}H`;
  }

  /** Kitty: layers as separate images; most frames are placement commands only. */
  private paintKitty(now: number, spec: DioramaSpec, beat: Beat, t: number, ov: Overlay): string {
    const { cols, rows } = this.box;
    const { cx, cy } = this.density;
    const id = (n: number) => KITTY_BASE + n;
    let out = "";
    const light = dioramaLight(spec);
    const cam = cameraFor(spec, beat.x);
    const M = panMargin(spec.w);

    // 1 · Backdrop layers, re-sent when the light, the weather's overcast or the size changes.
    const sceneKey = `${spec.biome.name}|${spec.w}x${spec.h}|${spec.hour}|${spec.weather}`;
    if (sceneKey !== this.sceneKey) {
      const sky = new Framebuffer(spec.w, spec.h);
      paintSkyLayer(sky, spec, light);
      out += this.k(kittyUpload(sky, id(ID.sky))) + this.at(0) + this.k(kittyPlace(id(ID.sky), { cols, rows, z: Z.sky }));
      for (const layer of ["far", "mid", "near"] as const) {
        const wide = new Framebuffer(spec.w + 2 * M, spec.h);
        paintLayer(wide, spec, layer, -M, light);
        out += this.k(kittyUpload(wide, id(ID[layer])));
      }
      this.sceneKey = sceneKey;
      this.placedPans = {};
      this.uploaded.add(id(ID.sky));
    }
    for (const layer of ["far", "mid", "near"] as const) {
      const pan = Math.round(cam * PARALLAX[layer]);
      if (this.placedPans[layer] === pan) continue;
      out += this.at(0) + this.k(kittyPlace(id(ID[layer]), { cols, rows, z: Z[layer], src: { x: M + pan, y: 0, w: spec.w, h: spec.h } }));
      this.placedPans[layer] = pan;
      this.uploaded.add(id(ID[layer]));
    }

    // 2 · The buddy: one cached image per (pose frame, sub-cell offset); swapping is a placement.
    // Standing still, snap to a cell so every idle spot reuses one set of frames.
    const snapped: Beat = beat.anim === "walk" ? beat : { ...beat, x: Math.round((beat.x - cam) / cx) * cx + cam };
    const sprite = buddySprite(spec, snapped, cam);
    if (sprite) {
      const col = Math.floor(sprite.x / cx);
      const row = Math.floor(sprite.y / cy);
      const ox = sprite.x - col * cx;
      const oy = sprite.y - row * cy;
      const key = `${snapped.anim}|${snapped.t.toFixed(3)}|${snapped.flip}|${ox}|${oy}|${snapped.think ? snapped.thinkT.toFixed(2) : ""}`;
      let bid = this.buddyIds.get(key);
      if (bid === undefined) {
        const canvas = new Framebuffer(Math.ceil((sprite.fb.width + ox) / cx) * cx, Math.ceil((sprite.fb.height + oy) / cy) * cy);
        canvas.draw(sprite.fb, ox, oy);
        const upload = this.k(kittyUpload(canvas, id(this.nextBuddyId)));
        // Over budget: keep showing the old pose this frame.
        if (this.buddyShown && upload.length > this.tokens - out.length) return out + this.textAndPlates(spec, ov);
        bid = this.nextBuddyId++;
        this.buddyIds.set(key, bid);
        out += upload;
        this.uploaded.add(id(bid));
        if (this.buddyIds.size > BUDDY_CACHE) {
          const [oldKey, oldId] = this.buddyIds.entries().next().value as [string, number];
          if (oldId !== this.buddyShown?.id) {
            this.buddyIds.delete(oldKey);
            out += this.k(kittyDelete(id(oldId)));
            this.uploaded.delete(id(oldId));
          }
        }
      } else {
        // LRU: touch.
        this.buddyIds.delete(key);
        this.buddyIds.set(key, bid);
      }
      const shown = this.buddyShown;
      if (!shown || shown.id !== bid || shown.col !== col || shown.row !== row) {
        // Clip the box to the panel so the image can never reach the child's rows or scroll.
        const boxCols = Math.min(Math.ceil((sprite.fb.width + ox) / cx), cols - Math.max(0, col));
        const boxRows = Math.ceil((sprite.fb.height + oy) / cy);
        const r0 = Math.max(0, row);
        const skip = r0 - row;
        const visRows = Math.min(boxRows - skip, rows - r0);
        if (col >= 0 && boxCols > 0 && visRows > 0) {
          out += this.at(r0, col) + this.k(kittyPlace(id(bid), { cols: boxCols, rows: visRows, z: Z.buddy, src: { x: 0, y: skip * cy, w: boxCols * cx, h: visRows * cy } }));
        }
        if (shown && shown.id !== bid) out += this.k(kittyUnplace(id(shown.id)));
        this.buddyShown = { id: bid, col, row };
      }
    }

    // 3 · Weather: one loop, uploaded once (a few frames per tick, within budget).
    if (hasFront(spec)) {
      const still = this.still;
      const frontKey = `${spec.biome.name}|${spec.w}x${spec.h}|${spec.weather}|${light.phase.night > 0.5}|${spec.flash}|${still}`;
      const frames = still ? 1 : FIELD_LOOP * FRONT_FPS;
      if (frontKey !== this.frontKey) {
        if (this.frontShown >= 0) out += this.k(kittyUnplace(this.frontId(this.frontShown)));
        this.frontKey = frontKey;
        this.frontReady = 0;
        this.frontFrames = frames;
        this.frontShown = -1;
      }
      const native = !!this.opts.kittyNative && !still;
      while (this.frontReady < this.frontFrames) {
        const fb = new Framebuffer(spec.w, spec.h);
        paintFront(fb, spec, this.frontReady / FRONT_FPS, light);
        const gap = 1000 / FRONT_FPS;
        const seq = this.k(native && this.frontReady > 0 ? kittyFrame(fb, id(ID.front), gap) : kittyUpload(fb, this.frontId(this.frontReady)));
        if (out && seq.length > this.tokens - out.length) break;
        out += seq;
        this.uploaded.add(this.frontId(this.frontReady));
        this.frontReady++;
      }
      if (this.frontReady >= this.frontFrames) {
        if (native) {
          if (this.frontShown < 0) {
            out += this.k(kittyLoop(id(ID.front), 1000 / FRONT_FPS)) + this.at(0) + this.k(kittyPlace(id(ID.front), { cols, rows, z: Z.front }));
            this.frontShown = 0;
          }
        } else {
          const f = still ? 0 : Math.floor(t * FRONT_FPS) % this.frontFrames;
          if (f !== this.frontShown) {
            out += this.at(0) + this.k(kittyPlace(this.frontId(f), { cols, rows, z: Z.front }));
            if (this.frontShown >= 0) out += this.k(kittyUnplace(this.frontId(this.frontShown)));
            this.frontShown = f;
          }
        }
      }
    } else if (this.frontKey) {
      if (this.frontShown >= 0) out += this.k(kittyUnplace(this.frontId(this.frontShown)));
      this.frontKey = "";
      this.frontShown = -1;
    }

    return out + this.textAndPlates(spec, ov);
  }

  private frontId(frame: number): number {
    return KITTY_BASE + (this.opts.kittyNative && !this.still ? ID.front : ID.frontFrames + frame);
  }

  /** Kitty: the plates image under the text, and the text, when the overlay changed. */
  private textAndPlates(spec: DioramaSpec, ov: Overlay): string {
    if (ov.key === this.platesKey) return "";
    const { cols, rows, top } = this.box;
    const fb = new Framebuffer(spec.w, spec.h);
    for (const p of ov.plates) paintPlate(fb, p);
    const pid = KITTY_BASE + ID.plates;
    this.platesKey = ov.key;
    this.uploaded.add(pid);
    // Blank the content rows first so old text never lingers (images survive, they're under the text).
    let clear = "";
    for (let r = 0; r < rows; r++) clear += `\x1b[${top + r};1H\x1b[0m\x1b[2K`;
    return clear + this.k(kittyUpload(fb, pid)) + this.at(0) + this.k(kittyPlace(pid, { cols, rows, z: Z.plates })) + this.textBytes(ov);
  }

  /**
   * Take the pictures off screen (the dashboard is about to take over, or
   * the shell is exiting). `free` also deletes the image data.
   */
  hide(free = false): string {
    if (this.tier !== "kitty" || !this.uploaded.size) {
      this.invalidate();
      return "";
    }
    let out = "";
    for (const id of this.uploaded) out += this.k(free ? kittyDelete(id) : kittyUnplace(id));
    if (free) {
      this.uploaded.clear();
      this.buddyIds.clear();
      this.frontKey = "";
      this.frontReady = 0;
    }
    this.invalidate();
    return out;
  }
}

/** Kitty proper plays animations itself; other kitty-protocol terminals may not. */
export function kittyPlaysAnimations(env: Record<string, string | undefined>): boolean {
  return env.TERM === "xterm-kitty" || !!env.KITTY_WINDOW_ID;
}

export const BIOMES = Object.keys(BIOME_SCENES);
