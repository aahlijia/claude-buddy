/**
 * Pure building blocks for the `claude-buddy play` TUI (cli/play.ts): speed
 * settings, the fight action bar, key legends, banner/reveal/shimmer frames
 * and the diffing painter. Kept here (not in the CLI) so they're testable.
 * See docs/game-feel/buddy-quest/design-animation.md §4.
 */

import { displayWidth } from "../art";
import { CONSUMABLES, SKILLS, type ConsumableId } from "./data";
import type { RpgState } from "./store";

// ─── Speed ──────────────────────────────────────────────────────────────────

export type AnimSpeed = "cinematic" | "normal" | "fast" | "off";
export const SPEEDS: readonly AnimSpeed[] = ["cinematic", "normal", "fast", "off"];
const SCALE: Record<AnimSpeed, number> = { cinematic: 1.6, normal: 1, fast: 0.55, off: 0 };

export function nextSpeed(s: AnimSpeed): AnimSpeed {
  return SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length];
}

/** The configured speed, else one that follows the game-feel level.
 *  `BUDDY_REDUCED_MOTION` always wins. */
export function defaultSpeed(
  configured: unknown,
  gameFeel: string | undefined,
  env: Record<string, string | undefined> = {},
): AnimSpeed {
  const rm = env.BUDDY_REDUCED_MOTION;
  if (rm && rm !== "0") return "off";
  if (SPEEDS.includes(configured as AnimSpeed)) return configured as AnimSpeed;
  return gameFeel === "off" ? "off" : gameFeel === "full" ? "normal" : "fast";
}

export interface Timed {
  text: string;
  ms: number;
}

/** A screen that may be built on demand (HD frames rasterize lazily). */
export type Lazy = string | (() => string);

/** Build a lazy thunk that runs `make` at most once. */
export function memo(make: () => string): () => string {
  let v: string | undefined;
  return () => (v ??= make());
}

export function force(l: Lazy): string {
  return typeof l === "string" ? l : l();
}

/** A timed frame whose text is only built when first read (and kept). */
export function lazyTimed(make: () => string, ms: number): Timed {
  const get = memo(make);
  return {
    ms,
    get text() {
      return get();
    },
  };
}

/** Rescale frame durations; "off" drops the animation entirely. A floor of
 *  16 ms keeps fast mode from outrunning the terminal. Frames stay lazy. */
export function scaleFrames(frames: readonly Timed[], speed: AnimSpeed): Timed[] {
  const k = SCALE[speed];
  if (!k) return [];
  return frames.map((f) => lazyTimed(() => f.text, Math.max(16, Math.round(f.ms * k))));
}

// ─── Fight action bar ───────────────────────────────────────────────────────

export interface FightAction {
  cmd: string;
  label: string;
  desc: string;
  /** Why it can't be used right now (cooldown…), if so. */
  blocked?: string;
  hotkey: string;
}

const ITEM_KEYS: Record<ConsumableId, string> = { potion: "p", elixir: "e", bomb: "o", smoke: "z" };

/** Every action available in the current fight, in bar order. */
export function fightActions(s: Pick<RpgState, "battle" | "skills" | "items">): FightAction[] {
  const b = s.battle;
  if (!b || b.over) return [];
  const out: FightAction[] = [
    { cmd: ";a", label: "Attack", desc: "a basic hit — crits on luck", hotkey: "a" },
    {
      cmd: ";d",
      label: "Defend",
      desc: b.foe.boss === "heisenbug" ? "brace (−60% damage, +5% HP) and observe the Heisenbug" : "brace: −60% damage this turn, +5% HP",
      hotkey: "d",
    },
  ];
  s.skills.forEach((id, i) => {
    const cd = b.hero.cd[id];
    out.push({
      cmd: `;s${i + 1}`,
      label: SKILLS[id].name,
      desc: SKILLS[id].desc,
      blocked: cd ? `cooldown ${cd}` : undefined,
      hotkey: String(i + 1),
    });
  });
  for (const id of Object.keys(CONSUMABLES) as ConsumableId[]) {
    const n = s.items[id] ?? 0;
    if (n <= 0) continue;
    const c = CONSUMABLES[id];
    const bossSmoke = id === "smoke" && !!b.foe.boss;
    out.push({ cmd: `;i ${id}`, label: `${c.icon}${n}`, desc: `${c.name}: ${c.desc}`, hotkey: ITEM_KEYS[id], blocked: bossSmoke ? "bosses block the exit" : undefined });
  }
  out.push({
    cmd: ";f",
    label: "Flee",
    desc: "try to run — speed helps",
    hotkey: "f",
    blocked: b.foe.boss ? "bosses block the exit" : undefined,
  });
  return out;
}

const INV = "\x1b[7m";
const DIM_SGR = "2";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

/** The bar (cursor in reverse video) + a description line for the focus.
 *  Items flow onto more lines rather than overflow narrow terminals. */
export function actionBar(actions: readonly FightAction[], cursor: number, cols: number, color: boolean): string[] {
  const at = Math.max(0, Math.min(cursor, actions.length - 1));
  const cells = actions.map((a, i) => {
    const text = ` ${a.label}${a.blocked && a.blocked.startsWith("cooldown") ? `(${a.blocked.slice(9)})` : ""} `;
    if (!color) return i === at ? `[${text.trim()}]` : ` ${text.trim()} `;
    if (i === at) return `${INV}${text}${RESET}`;
    return a.blocked ? `${DIM}${text}${RESET}` : text;
  });
  const lines = flow(cells, cols, " ");
  const a = actions[at];
  if (a) {
    const keyHint = `[${a.hotkey}]`;
    const desc = a.blocked ? `${a.desc} — ${a.blocked}` : a.desc;
    lines.push(color ? `${CYAN}▸ ${desc}${RESET} ${DIM}${keyHint}${RESET}` : `> ${desc} ${keyHint}`);
  }
  return lines;
}

/** Flow items into lines no wider than `cols`. */
export function flow(items: readonly string[], cols: number, sep = "  "): string[] {
  const lines: string[] = [];
  let line = "";
  for (const it of items) {
    if (line && displayWidth(line) + displayWidth(sep) + displayWidth(it) > cols) {
      lines.push(line);
      line = it;
    } else line = line ? line + sep + it : it;
  }
  if (line) lines.push(line);
  return lines;
}

// ─── Banners, reveals, shimmer ──────────────────────────────────────────────

/** Center `text` in `cols` columns. */
export function center(text: string, cols: number): string {
  return " ".repeat(Math.max(0, Math.floor((cols - displayWidth(text)) / 2))) + text;
}

/** A banner opening from its center outwards, then a bright flash. */
export function bannerFrames(text: string, sgr: string, cols: number): Timed[] {
  const chars = [...text];
  const mid = chars.length / 2;
  const frames: Timed[] = [];
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const half = Math.ceil((mid * i) / steps);
    const shown = chars.map((c, j) => (Math.abs(j + 0.5 - mid) <= half ? c : " ")).join("");
    frames.push({ text: center(`\x1b[${sgr}m${shown}${RESET}`, cols), ms: 35 });
  }
  frames.push({ text: center(`\x1b[1;97m${text}${RESET}`, cols), ms: 90 });
  frames.push({ text: center(`\x1b[${sgr}m${text}${RESET}`, cols), ms: 0 });
  return frames;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A bright band sweeping across a line (loot, level-ups). The last frame is
 *  the original line untouched. */
export function shimmerFrames(line: string, baseSgr: string): Timed[] {
  const plain = [...stripAnsi(line)];
  const frames: Timed[] = [];
  const band = 4;
  for (let at = -band; at < plain.length + band; at += 3) {
    let out = "";
    plain.forEach((ch, i) => {
      const inBand = i >= at && i < at + band;
      out += inBand ? `\x1b[1;97m${ch}${RESET}` : `\x1b[${baseSgr}m${ch}${RESET}`;
    });
    frames.push({ text: out, ms: 28 });
  }
  frames.push({ text: line, ms: 0 });
  return frames;
}

/** How special a reward line is → its shimmer color (or none). */
export function shimmerTone(line: string): string | null {
  const t = stripAnsi(line);
  if (/\[L\]|LEVEL UP|T H E {3}E N D/.test(t)) return "1;33";
  if (/\[E\]|👑|New skill/.test(t)) return "1;35";
  return null;
}

/**
 * Reveal `tail` (the lines after a fight's last frame) one line at a time
 * under `base`; special lines get a shimmer as they land.
 */
export function revealFrames(base: string, tail: readonly string[]): Timed[] {
  const frames: Timed[] = [];
  const shown: string[] = [];
  for (const line of tail) {
    const tone = line.trim() ? shimmerTone(line) : null;
    if (tone) {
      for (const f of shimmerFrames(line, tone)) {
        if (f.ms) frames.push({ text: [base, ...shown, f.text].join("\n"), ms: f.ms });
      }
    }
    shown.push(line);
    frames.push({ text: [base, ...shown].join("\n"), ms: line.trim() ? (tone ? 160 : 85) : 30 });
  }
  return frames;
}

// ─── Results card ───────────────────────────────────────────────────────────

export interface CardResults {
  gold: number;
  xp: number;
  drops: readonly string[];
  boss: boolean;
}

/** The victory results card; `k` (0..1) counts the numbers up. */
export function resultsCard(r: CardResults, k: number, color: boolean): string[] {
  const c = (sgr: string, t: string) => (color ? `\x1b[${sgr}m${t}${RESET}` : t);
  const n = (v: number) => Math.round(v * Math.max(0, Math.min(1, k)));
  const W = 34;
  const title = r.boss ? " ♛ R E S U L T S ♛ " : " ★ R E S U L T S ★ ";
  const rows = [
    `${c(DIM_SGR, "Gold")}   ${c("1;33", `+${n(r.gold)}g`)}`,
    `${c(DIM_SGR, "XP")}     ${c("1;36", `+${n(r.xp)}`)} ${c(DIM_SGR, "buddy XP")}`,
    ...(r.drops.length ? r.drops : [c(DIM_SGR, "—")]).map((d, i) => `${c(DIM_SGR, i ? "      " : "Loot")}${i ? "" : "  "} ${k >= 1 ? d : c(DIM_SGR, "· · ·")}`),
  ];
  const fill = Math.max(2, W - displayWidth(title) - 2);
  return [
    c(DIM_SGR, "╭─") + c("1;33", title) + c(DIM_SGR, "─".repeat(fill) + "╮"),
    ...rows.map((l) => `${c(DIM_SGR, "│")} ${l}`),
    c(DIM_SGR, `╰${"─".repeat(W)}╯`),
  ];
}

/** The card counting up, then the loot landing (each with a shimmer). */
export function resultsFrames(base: string, r: CardResults, color: boolean): Timed[] {
  const frames: Timed[] = [];
  const steps = 8;
  for (let i = 1; i <= steps; i++) frames.push({ text: [base, ...resultsCard(r, i / steps, color)].join("\n"), ms: 40 });
  const card = resultsCard(r, 1, color);
  frames.push({ text: [base, ...card].join("\n"), ms: 0 });
  return frames;
}

// ─── Painter ────────────────────────────────────────────────────────────────

/**
 * Escape sequence that turns `prev` into `next` on screen: only changed rows
 * are rewritten (cursor-addressed, cleared to EOL), stale rows below are
 * cleared, and the batch is wrapped in synchronized-output markers so the
 * terminal shows it atomically. No full-screen wipe ⇒ no flicker.
 */
export function diffPaint(prev: readonly string[], next: readonly string[]): string {
  let buf = "";
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== prev[i]) buf += `\x1b[${i + 1};1H${next[i]}\x1b[0m\x1b[K`;
  }
  if (prev.length > next.length) buf += `\x1b[${next.length + 1};1H\x1b[J`;
  return buf ? `\x1b[?2026h${buf}\x1b[?2026l` : "";
}
