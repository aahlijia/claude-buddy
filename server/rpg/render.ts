/**
 * Text renderers for the RPG — shared by the zero-token prompt hook (plain
 * text: hook output isn't ANSI-rendered) and the `claude-buddy play` TUI
 * (colored). Pure.
 */

import type { Eye, Hat, Rarity, Species } from "../engine";
import { applyHat, displayWidth, getArtFrame, rectFrame } from "../art";
import { afterglow, type Cue } from "./anim";
import { foeIntent, type Battle } from "./battle";
import { marksOf, stageFor, type Stage, type StageState } from "./stage";
import {
  STAGE_COLS,
  STAGE_ROWS,
  encodeStage,
  frameTimes,
  ghostAt,
  hdCast,
  hdTimeline,
  restScene,
  sceneAt,
  type HdPaint,
  type HdScene,
} from "./hdstage";
import { lazyTimed, memo } from "./playkit";
import { THEME, type RGB, type Ui } from "../ui/color.ts";
import { meter } from "../ui/meter.ts";
import { panel as kitPanel } from "../ui/panel.ts";
import {
  CONSUMABLES,
  FLOORS_PER_ZONE,
  RARITY_ANSI,
  SKILLS,
  UNIQUES,
  zoneById,
  type ConsumableId,
  type SkillId,
} from "./data";
import { gearStats, statLine, type GearItem } from "./gear";

export interface Paint {
  color: boolean;
  /** Also bake attack-animation frames (TUI only; the hook can't animate). */
  anim?: boolean;
  /** The UI kit's rich face (TUI only; see ui/color.ts). */
  ui?: Ui;
  /** Draw fights on the HD pixel stage (TUI only, when the terminal can show
   *  it). The zero-token hook never sets this, so it never renders pixels. */
  hd?: HdPaint;
}

const RESET = "\x1b[0m";
export const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

export function paint(p: Paint, code: string, text: string): string {
  return p.color ? `${code}${text}${RESET}` : text;
}

const RARITY_TAG: Record<Rarity, string> = {
  common: "C",
  uncommon: "U",
  rare: "R",
  epic: "E",
  legendary: "L",
};

export function gearName(p: Paint, g: GearItem): string {
  const tag = `[${RARITY_TAG[g.rarity]}]`;
  const plus = g.plus ? ` +${g.plus}` : "";
  return paint(p, RARITY_ANSI[g.rarity], `${tag} ${g.name}${plus}`) + (g.locked ? " 🔒" : "");
}

export function gearLine(p: Paint, g: GearItem): string {
  const u = g.unique ? `  ${paint(p, C.yellow, `★ ${UNIQUES[g.unique].desc}`)}` : "";
  return `${gearName(p, g)} ${paint(p, C.dim, `i${g.ilvl}`)}  ${statLine(gearStats(g))}${u}`;
}

/** A progress bar: classic `█░` (unpainted — callers color it), or the
 *  kit's meter in the TUI. */
export function progressBar(p: Paint, cur: number, max: number, width: number = 10): string {
  return p.ui && p.color ? meter(p.ui, cur, max, width, { kind: "progress" }) : paint(p, C.green, bar(cur, max, width));
}

export function bar(cur: number, max: number, width: number = 10): string {
  const n = max > 0 ? Math.round((Math.max(0, cur) / max) * width) : 0;
  return "█".repeat(n) + "░".repeat(width - n);
}

/** An HP bar. `was` (HP before this turn) draws the lost chunk as a ghost
 *  segment `▓`, so a glance shows what the last turn cost. */
export function hpBar(p: Paint, cur: number, max: number, width: number = 10, was?: number, pulse?: number): string {
  if (p.ui && p.color) return `♥ ${cur}/${max} ${meter(p.ui, cur, max, width, { kind: "hp", ghost: was, pulse })}`;
  const ratio = max > 0 ? cur / max : 0;
  const col = ratio > 0.5 ? C.green : ratio > 0.25 ? C.yellow : C.red;
  const fill = (v: number) => (max > 0 ? Math.round((Math.max(0, Math.min(v, max)) / max) * width) : 0);
  const n = fill(cur);
  const ghost = was !== undefined && was > cur ? Math.max(0, fill(was) - n) : 0;
  const seg = (code: string, ch: string, k: number) => (k > 0 ? paint(p, code, ch.repeat(k)) : "");
  return `♥ ${cur}/${max} ${seg(col, "█", n)}${seg(GHOST, "▓", ghost)}${"░".repeat(width - n - ghost)}`;
}

const GHOST = "\x1b[2;31m";

export interface Look {
  name: string;
  species: Species;
  eye: Eye;
  hat: Hat;
  /** HD art only: rarity lighting and the shiny palette. */
  rarity?: Rarity;
  shiny?: boolean;
}

// ─── Frames & panels ────────────────────────────────────────────────────────

const PANEL_W = 58;

/** An open-right panel (see ui/panel.ts): classic rules and border for the
 *  hook, the kit's rich face in the TUI. `accent` tints the rich edge. */
export function panel(p: Paint, title: string, right: string, body: string[], footer?: string, minW = PANEL_W, accent?: RGB): string {
  return kitPanel(p.color, p.ui, { title, right, body, footer, minW, accent });
}

/** Greedy word wrap on display width (keeps panels from stretching). */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && displayWidth(line) + displayWidth(w) + 1 > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

// ─── Sprites ────────────────────────────────────────────────────────────────

/** The buddy alone (town/title screens): hat applied, blank top rows
 *  trimmed. `pose` picks an idle frame or a blink for the ambient loop. */
export function buddySprite(look: Look, pose: 0 | 1 | "blink" = 0): string[] {
  try {
    const art = getArtFrame(look.species, pose === "blink" ? ("-" as Eye) : look.eye, pose === "blink" ? 0 : pose);
    if (look.hat && look.hat !== "none") applyHat(look.species, look.hat, art);
    const rows = rectFrame(art);
    while (rows.length > 1 && !rows[0].trim()) rows.shift();
    return rows;
  } catch {
    return [];
  }
}

/** One animation frame's worth of overrides for the battle screen. */
export interface BattleView {
  stage: StageState;
  /** HP shown on the bars [hero, foe]. */
  hp: [number, number];
  /** Log lines revealed so far (the rest render blank — same height). */
  lines: number;
  /** HD stage: the resolved scene, and the HP bars' draining ghost. */
  hd?: HdScene;
  ghost?: [number, number];
  fresh?: [boolean, boolean];
  /** 0..1 phase of the low-HP pulse (idle loops). */
  pulse?: number;
}

/** The fight scene at rest: idle pose, persistent marks, this turn's damage. */
export function restStage(b: Battle): StageState {
  return { marks: marksOf(b), motes: afterglow(b) };
}

/** Center the stage under the panel title. */
function stageLines(p: Paint, st: Stage, state: StageState): string[] {
  const indent = " ".repeat(Math.max(0, Math.floor((PANEL_W - 2 - st.width) / 2)));
  return st.render(state, p.color).map((l) => indent + l);
}

/** Every directed cue as a full battle screen (TUI playback). On the HD
 *  stage each cue is split into ~30 fps sub-frames that tween between the
 *  director's poses; those frames are built lazily, when played. */
export function battleFrames(
  p: Paint,
  b: Battle,
  look: Look,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
  cues: readonly Cue[],
): { text: string; ms: number }[] {
  const st = stageFor(b, look);
  const cast = p.hd ? hdCast(b, look) : null;
  if (p.hd && cast && cues.length) {
    const tl = hdTimeline(cues, cast, p.hd.feel, { maxHp: [b.hero.maxHp, b.foe.maxHp], cell: { width: st.width, height: st.height } });
    const frames = frameTimes(tl).map(([T, ms]) =>
      lazyTimed(() => {
        const c = tl.cues[Math.min(tl.cues.length - 1, cueIndex(tl.starts, T))];
        const { ghost, fresh } = ghostAt(tl, T);
        return battleScreen(p, b, look, skills, items, { stage: c.stage, hp: c.hp, lines: c.lines, hd: sceneAt(tl, T), ghost, fresh }, st);
      }, ms),
    );
    // End exactly on the resting screen (what the command prints), so the
    // player can reveal reward lines under it.
    frames.push(lazyTimed(() => battleScreen(p, b, look, skills, items, undefined, st), 0));
    return frames;
  }
  return cues.map((c) => ({ text: battleScreen(p, b, look, skills, items, c, st), ms: c.ms }));
}

function cueIndex(starts: readonly number[], T: number): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= T) i++;
  return i;
}

/** HD resting loop: the idle cycle at a few frames per second (lazy). */
export function hdAmbientFrames(
  p: Paint,
  b: Battle,
  look: Look,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
  count: number,
  ms: number,
): (() => string)[] {
  return Array.from({ length: count }, (_, i) => memo(() => battleScreen(p, b, look, skills, items, undefined, undefined, (i * ms) / 1000)));
}

/** Whether this fight draws on the HD stage. */
export function usesHd(p: Paint, b: Battle, look: Look): boolean {
  return !!p.hd && !!hdCast(b, look);
}

/** Stage geometry for the director. */
export function stageGeometry(b: Battle, look: Look): { width: number; height: number; eyeY: number } {
  const st = stageFor(b, look);
  return { width: st.width, height: st.height, eyeY: st.eyeY };
}

export function battleTitle(b: Battle): string {
  if (b.kind === "tower") return `🗼 Endless Tower · Floor ${b.floor}`;
  if (b.kind === "hunt") return "🐛 Bug Hunt";
  if (b.kind === "event") return "✦ Mimic!";
  const z = zoneById(b.zone);
  if (b.kind === "boss") return `♛ ${z?.name ?? "?"} · BOSS`;
  return `⚔ ${z?.name ?? "?"} · Floor ${b.floor}/${FLOORS_PER_ZONE}`;
}

/** The battle screen. `view` swaps in one animation frame; every frame of a
 *  fight has the same height as the resting screen. */
export function battleScreen(
  p: Paint,
  b: Battle,
  look: Look,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
  view?: BattleView,
  stage?: Stage,
  /** HD resting screens: the idle clock (seconds) for the ambient loop. */
  clock = 0,
): string {
  const body: string[] = [];
  const cast = p.hd ? hdCast(b, look) : null;
  let suffix: string | undefined;
  try {
    const st = stage ?? stageFor(b, look);
    if (p.hd && cast) {
      const scene = view?.hd ?? restScene(b, restStage(b).motes ?? [], { width: st.width, height: st.height }, cast, clock);
      const enc = encodeStage(cast, scene, p.hd);
      suffix = enc.suffix;
      body.push(...enc.lines);
    } else body.push(...stageLines(p, st, view?.stage ?? restStage(b)));
  } catch {
    /* art failure — the bars and log still work */
  }
  const [heroHp, foeHp] = view?.hp ?? [b.hero.hp, b.foe.hp];
  const pulse = view?.pulse ?? (clock > 0 ? clock % 1 : undefined);
  const [heroWas, foeWas] = b.was ?? [heroHp, foeHp];
  const settled = !view || view.lines >= b.log.length;
  const foeName = b.foe.boss ? paint(p, C.yellow, `♛ ${b.foe.name}`) : b.foe.name;
  const label = (t: string, w: number) => t + " ".repeat(Math.max(1, w - displayWidth(t)));
  const lw = Math.max(displayWidth(look.name), displayWidth(`${b.foe.boss ? "♛ " : ""}${b.foe.name} Lv${b.foe.level}`)) + 2;
  // HD: the ghost drains during playback and is gone at rest.
  const bar = (cur: number, max: number, was: number, k: 0 | 1) =>
    cast && p.color
      ? `♥ ${cur}/${max} ${meter(p.ui ?? { mode: p.hd!.color }, cur, max, 14, { kind: "hp", ghost: view?.ghost?.[k] ?? cur, fresh: !!view?.fresh?.[k], pulse })}`
      : hpBar(p, cur, max, 14, was, pulse);
  body.push(label(paint(p, C.bold, look.name), lw) + bar(heroHp, b.hero.maxHp, heroWas, 0));
  const intent = foeIntent(b);
  const foeLine = label(`${foeName} Lv${b.foe.level}`, lw) + bar(foeHp, b.foe.maxHp, foeWas, 1);
  const intentText = intent ? `  ${paint(p, C.yellow, intent)}` : "";
  // The intent shows once the turn has played out, but the panel is sized
  // for it from the first frame so nothing shifts.
  const widest = label(`${foeName} Lv${b.foe.level}`, lw) + hpBar(p, b.foe.maxHp, b.foe.maxHp, 14);
  const minW = Math.max(PANEL_W, displayWidth(widest + intentText) + 2);
  body.push(settled ? foeLine + intentText : foeLine);
  const status: string[] = [];
  if (b.hero.fx.poison) status.push("☠ poisoned");
  if (b.hero.fx.blind) status.push("◌ cursed aim");
  if (b.hero.fx.buff) status.push(`↑ATK ${b.hero.fx.buff}`);
  // The status row doubles as the spacer above the log, so it never shifts it.
  body.push(status.length && settled ? paint(p, C.magenta, status.join("  ")) : "");
  b.log.forEach((l, i) => {
    const shown = !view || i < view.lines;
    wrap(l, PANEL_W - 4).forEach((part, j) => body.push(shown ? (j ? "  " : paint(p, C.dim, "» ")) + part : ""));
  });
  let out = panel(p, battleTitle(b), `Turn ${b.turn}`, body, undefined, minW, b.foe.boss ? THEME.boss : undefined);
  if (suffix) {
    // Pixel tiers: the stage rows are blank in the layout; the image is
    // placed from the end of the last stage row (panel row STAGE_ROWS).
    const rows = out.split("\n");
    rows[STAGE_ROWS] += suffix;
    out = rows.join("\n");
  }
  // The TUI (anim) draws its own action bar instead of the `;` hints.
  return b.over || p.anim ? out : `${out}\n${actionHints(p, b, skills, items)}`;
}

export function actionHints(
  p: Paint,
  b: Battle,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
): string {
  const parts = [";a attack", ";d defend"];
  skills.forEach((id, i) => {
    const cd = b.hero.cd[id];
    parts.push(cd ? paint(p, C.dim, `;s${i + 1} ${SKILLS[id].name}(${cd})`) : `;s${i + 1} ${SKILLS[id].name}`);
  });
  for (const id of Object.keys(CONSUMABLES) as ConsumableId[]) {
    const n = items[id] ?? 0;
    if (n > 0) parts.push(`;i ${id} ${CONSUMABLES[id].icon}×${n}`);
  }
  if (!b.foe.boss) parts.push(";f flee");
  return paint(p, C.cyan, parts.join("  "));
}
