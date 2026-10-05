#!/usr/bin/env bun
/**
 * cli/play.ts — Buddy Quest, full-screen.
 *
 * The same game (and save) as the zero-token `;` prompt commands, in its own
 * terminal pane: single-key controls, a cursor-driven action bar in fights,
 * and fully choreographed animations (see
 * docs/game-feel/buddy-quest/design-animation.md).
 *
 * Playback is skippable (any key jumps to the end, then still counts), speed
 * is a setting (`~`), and painting only rewrites changed rows inside a
 * synchronized-output batch — no flicker. It draws in response to a key; the
 * only timers are a playing animation and a gentle idle loop that sleeps when
 * the terminal loses focus or after IDLE_BUDGET_MS without input, so it
 * costs nothing while you're coding in the other pane.
 *
 * Usage:  bun run play   |   claude-buddy play
 */

import { loadBuddyCtx, runFull, type RunResult } from "../server/rpg/cli.ts";
import { buddySprite } from "../server/rpg/render.ts";
import { loadRpg, type RpgState } from "../server/rpg/store.ts";
import {
  actionBar,
  bannerFrames,
  center,
  defaultSpeed,
  diffPaint,
  fightActions,
  flow,
  force,
  lazyTimed,
  nextSpeed,
  resultsCard,
  resultsFrames,
  revealFrames,
  scaleFrames,
  type AnimSpeed,
  type Lazy,
  type Timed,
} from "../server/rpg/playkit.ts";
import { detectTier, tmuxWrap } from "../server/gfx/detect.ts";
import { kittyDelete } from "../server/gfx/encode/kitty.ts";
import { KITTY_STAGE_ID, STAGE_COLS, hdFeel, type HdPaint } from "../server/rpg/hdstage.ts";

if (!process.stdin.isTTY) {
  console.error("Buddy Quest needs an interactive terminal. In Claude Code, type ;help instead.");
  process.exit(1);
}

const ESC = "\x1b[";
const out = (s: string) => process.stdout.write(s);
const cols = () => process.stdout.columns || 80;
const rows = () => process.stdout.rows || 30;

/** Idle loops stop this long after the last key (and whenever focus leaves). */
const IDLE_BUDGET_MS = 30_000;

const LOGO = [
  "█▀▄ █ █ █▀▄ █▀▄ █ █   █▀█ █ █ █▀▀ █▀▀ ▀█▀",
  "█▀▄ █ █ █ █ █ █  █    █ █ █ █ █▀▀ ▀▀█  █ ",
  "▀▀  ▀▀▀ ▀▀  ▀▀   ▀    ▀▀█ ▀▀▀ ▀▀▀ ▀▀▀  ▀ ",
];

// ─── Settings ───────────────────────────────────────────────────────────────

function loadSpeed(): AnimSpeed {
  try {
    const { loadConfig } = require("../server/state.ts") as typeof import("../server/state.ts");
    const c = loadConfig();
    return defaultSpeed(c.questAnim, c.gameFeel, process.env);
  } catch {
    return defaultSpeed(undefined, undefined, process.env);
  }
}

/** The HD stage needs room: its 15 rows plus the bars, log and action bar. */
const HD_MIN_ROWS = 34;
const HD_MIN_COLS = STAGE_COLS + 6;

const gfx = detectTier(process.env);

/** HD paint settings for this terminal, or undefined for the ASCII stage
 *  (gameFeel off, no pixel tier, or a terminal too small to fit it). */
function hdPaint(): HdPaint | undefined {
  if (gfx.tier === "ascii" || rows() < HD_MIN_ROWS || cols() < HD_MIN_COLS) return undefined;
  let gameFeel: string | undefined;
  let reduce = !!process.env.BUDDY_REDUCED_MOTION && process.env.BUDDY_REDUCED_MOTION !== "0";
  try {
    const { loadConfig } = require("../server/state.ts") as typeof import("../server/state.ts");
    const c = loadConfig();
    gameFeel = c.gameFeel;
    reduce ||= !!c.reduceMotion;
  } catch {
    /* defaults */
  }
  const feel = hdFeel(gameFeel, reduce);
  return feel ? { tier: gfx.tier, color: gfx.color, tmux: gfx.tmux, feel } : undefined;
}

function saveSpeed(s: AnimSpeed): void {
  try {
    const { saveConfig } = require("../server/state.ts") as typeof import("../server/state.ts");
    saveConfig({ questAnim: s });
  } catch {
    /* the setting still applies for this session */
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

let mode: "title" | "game" = "title";
let body = "";
let banner = "";
let typing: string | null = null;
let speed = loadSpeed();
let snap: RpgState | null = null;
let cursor = 0;
let focused = true;
let lastInput = Date.now();
/** The idle loop that belongs to `body` (restarted when focus returns). */
let lastLoop: RunResult["loop"];

/** A playing animation: frames are full screens. */
let reel: { frames: Timed[]; i: number; timer: ReturnType<typeof setTimeout> | null; done: () => void } | null = null;
/** The idle loop for the current screen (HD frames are built on demand). */
let loop: { frames: Lazy[]; ms: number; i: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

function refreshSnap(): void {
  try {
    snap = loadRpg();
  } catch {
    snap = null;
  }
}

// ─── Painting ───────────────────────────────────────────────────────────────

let painted: string[] = [];

/** A pixel-tier image (kitty / iTerm2) is on screen. */
const hasImage = (lines: readonly string[]) => lines.some((l) => l.includes("\x1b_G") || l.includes("\x1b]1337;"));

function paint(screen: string): void {
  // Keep the bottom rows if the screen is taller than the terminal: the
  // newest text (rewards, the action bar) matters most.
  const lines = screen.split("\n").slice(-rows());
  if (hasImage(painted) && !hasImage(lines)) {
    // Leaving the HD stage: drop the image and repaint from scratch so no
    // pixels linger under unchanged rows.
    clearImage();
    out(`${ESC}H${ESC}2J`);
    painted = [];
  }
  out(diffPaint(painted, lines));
  painted = lines;
}

function clearImage(): void {
  if (gfx.tier === "kitty") out(gfx.tmux ? tmuxWrap(kittyDelete(KITTY_STAGE_ID)) : kittyDelete(KITTY_STAGE_ID));
}

function repaintAll(screen: string): void {
  painted = [];
  out(`${ESC}H${ESC}2J`);
  paint(screen);
}

const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const cyan = (s: string) => `${ESC}36m${s}${ESC}0m`;

function footer(playing = !!reel): string[] {
  const w = cols();
  if (typing !== null) return [`${cyan(`;${typing}`)}█`, dim("[enter] run · [esc] cancel")];
  if (playing) return [dim(`[space] skip · any key acts · [~] animation: ${speed}`)];
  const fight = !!snap?.battle && !snap.battle.over;
  if (fight) {
    const actions = fightActions(snap!);
    cursor = Math.min(cursor, actions.length - 1);
    return [
      ...actionBar(actions, cursor, w, true),
      ...flow(["[←→] select", "[enter] act", "[a]ttack [d]efend [1-7] skills [p][e][o][z] items [f]lee", "[:] command", `[~] anim: ${speed}`, "[q]uit"], w).map(dim),
    ];
  }
  if (snap?.event) return flow(["[1] / [2] choose", "[c]har", "[i] bag", "[:] command", "[q]uit"], w).map(dim);
  return flow(
    [
      "e[x]plore",
      "[b]oss",
      "[t]ower",
      "h[u]nt",
      "[m]ap",
      "[i] bag",
      "[s]hop",
      "[f]orge",
      "[g] train",
      "[r]est",
      "[c]har",
      "s[k]ills",
      "[v] feats",
      "bou[n]ties",
      "[l]og",
      "[h]elp",
      "[:] cmd",
      `[~] anim: ${speed}`,
      "[q]uit",
    ],
    w,
  ).map(dim);
}

function compose(text: string, bannerLine = banner, playing = !!reel): string {
  return [...(bannerLine ? [bannerLine] : []), text, "", ...footer(playing)].join("\n");
}

function draw(): void {
  if (mode === "title") return paint(loop ? force(loop.frames[loop.i]) : titleScreen(titleState));
  paint(compose(loop ? force(loop.frames[loop.i]) : body));
}

// ─── Playback ───────────────────────────────────────────────────────────────

function play(frames: Timed[], done: () => void): void {
  stopLoop();
  if (!frames.length) return done();
  reel = { frames, i: 0, timer: null, done };
  const step = () => {
    const r = reel!;
    paint(r.frames[r.i].text);
    const ms = r.frames[r.i].ms;
    if (++r.i >= r.frames.length) {
      r.timer = setTimeout(finish, ms);
    } else r.timer = setTimeout(step, ms);
  };
  step();
}

/** End the current animation now (skip) or naturally. */
function finish(): void {
  const r = reel;
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  reel = null;
  r.done();
}

function startLoop(frames: readonly Lazy[] | undefined, ms: number): void {
  stopLoop();
  if (!frames?.length || speed === "off" || !focused) return;
  loop = { frames: [...frames], ms, i: 0, timer: null };
  const tick = () => {
    const l = loop;
    if (!l) return;
    if (!focused || Date.now() - lastInput > IDLE_BUDGET_MS) return stopLoop(true);
    l.i = (l.i + 1) % l.frames.length;
    draw();
    l.timer = setTimeout(tick, l.ms);
  };
  loop.timer = setTimeout(tick, ms);
}

function stopLoop(repaint = false): void {
  if (!loop) return;
  if (loop.timer) clearTimeout(loop.timer);
  loop = null;
  if (repaint) draw();
}

// ─── Banners ────────────────────────────────────────────────────────────────

function bannerFor(text: string): { text: string; sgr: string } | null {
  if (text.includes("LEVEL UP")) return { text: "⭐  L E V E L   U P  ⭐", sgr: "1;33" };
  if (text.includes("T H E   E N D")) return { text: "★  T H E   E N D  ★", sgr: "1;35" };
  if (text.includes("defeated for the first time")) return { text: "♛  B O S S   D O W N  ♛", sgr: "1;33" };
  if (text.includes("Victory")) return { text: "★  V I C T O R Y  ★", sgr: "1;32" };
  if (text.includes("Knocked out")) return { text: "✖  D E F E A T E D  ✖", sgr: "1;31" };
  if (text.includes("You slip away") || text.includes("vanish in smoke")) return { text: "~  E S C A P E D  ~", sgr: "1;36" };
  return null;
}

// ─── Commands ───────────────────────────────────────────────────────────────

function exec(cmd: string): void {
  stopLoop();
  let res: RunResult;
  try {
    res = runFull(cmd, true, true, Date.now(), hdPaint());
  } catch (e) {
    banner = "";
    body = `Error: ${(e as Error).message}`;
    lastLoop = undefined;
    return draw();
  }
  const wasFight = !!snap?.battle;
  refreshSnap();
  if (!wasFight && snap?.battle) cursor = 0;
  banner = "";
  const bn = bannerFor(res.out);

  // Every playback frame is a full screen with the "skip" footer (built
  // when played: HD frames rasterize on demand).
  const frame = (f: Timed, bannerLine = ""): Timed => lazyTimed(() => compose(f.text, bannerLine, true), f.ms);
  // A won fight ends on its results card.
  const final = res.results ? `${res.out}\n${resultsCard(res.results, 1, true).join("\n")}` : res.out;

  // 1 · the turn / intro choreography
  const frames: Timed[] = scaleFrames(res.anim, speed).map((f) => frame(f));

  // 2 · reward lines land one at a time after a fight resolves
  const last = res.anim[res.anim.length - 1]?.text;
  if (speed !== "off" && last && res.out.startsWith(last) && res.out.length > last.length) {
    const tail = res.out.slice(last.length).replace(/^\n/, "").split("\n");
    frames.push(...scaleFrames(revealFrames(last, tail), speed).map((f) => frame(f)));
  }

  // 3 · the results card counts up under the rewards
  if (res.results && speed !== "off") {
    frames.push(...scaleFrames(resultsFrames(res.out, res.results, true), speed).map((f) => frame(f)));
  }

  // 4 · the banner opens over the final screen
  if (bn && speed !== "off") {
    frames.push(...scaleFrames(bannerFrames(bn.text, bn.sgr, cols()), speed).map((f) => frame({ text: final, ms: f.ms }, f.text)));
  }

  const land = () => {
    body = final;
    banner = bn ? center(`${ESC}${bn.sgr}m${bn.text}${ESC}0m`, cols()) : "";
    lastLoop = res.loop;
    draw();
    if (res.loop) startLoop(res.loop.frames, res.loop.ms);
  };
  play(frames, land);
}

// ─── Title ──────────────────────────────────────────────────────────────────

interface TitleState {
  /** Logo columns revealed. */
  reveal: number;
  /** Shimmer band position (−1 = none). */
  shine: number;
  pose: 0 | 1 | "blink";
  prompt: boolean;
}

let titleState: TitleState = { reveal: 0, shine: -1, pose: 0, prompt: false };
const ctx = loadBuddyCtx();

function titleScreen(t: TitleState): string {
  const w = cols();
  const lines: string[] = ["", ""];
  for (const l of LOGO) {
    const chars = [...l].slice(0, t.reveal);
    let row = "";
    chars.forEach((ch, i) => {
      const lit = t.shine >= 0 && i >= t.shine && i < t.shine + 4 && ch !== " ";
      row += lit ? `${ESC}1;97m${ch}${ESC}0m` : `${ESC}1;35m${ch}${ESC}0m`;
    });
    lines.push(" ".repeat(Math.max(0, Math.floor((w - LOGO[0].length) / 2))) + row);
  }
  lines.push("", dim(center("a turn-based RPG that lives inside Claude Code", w)), "");
  const sprite = buddySprite(ctx, t.pose);
  const ref = buddySprite(ctx, 0);
  const sw = Math.max(...[...sprite, ...ref].map((l) => l.length));
  for (let i = 0; i < Math.max(sprite.length, ref.length); i++) {
    lines.push(cyan(" ".repeat(Math.max(0, Math.floor((w - sw) / 2))) + (sprite[i] ?? "").padEnd(sw)));
  }
  lines.push("", center(`${ctx.name} is ready.`, w), "");
  const prompt = "— press any key —";
  lines.push(t.prompt ? `${ESC}1;33m${center(prompt, w)}${ESC}0m` : dim(center(prompt, w)));
  lines.push("", dim(center(`[~] animation: ${speed}   [q] quit`, w)));
  return lines.join("\n");
}

function playTitle(): void {
  const frames: Timed[] = [];
  const width = LOGO[0].length;
  if (speed !== "off") {
    for (let c = 0; c <= width; c += 4) frames.push({ text: titleScreen({ reveal: c, shine: c - 4, pose: 0, prompt: false }), ms: 30 });
    for (let s = -4; s <= width; s += 3) frames.push({ text: titleScreen({ reveal: width, shine: s, pose: 0, prompt: false }), ms: 26 });
  }
  play(scaleFrames(frames, speed), () => {
    titleState = { reveal: width, shine: -1, pose: 0, prompt: true };
    draw();
    titleLoop();
  });
}

/** Breathe, blink, pulse the prompt — within the idle budget. */
function titleLoop(): void {
  const poses = [0, 1, 0, "blink"] as const;
  // On the title the loop frames are whole screens, not bodies (see draw).
  startLoop(
    poses.map((pose, i) => titleScreen({ ...titleState, pose, prompt: i % 2 === 0 })),
    650,
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────

const TOWN_KEYS: Record<string, string> = {
  x: ";x",
  b: ";boss",
  t: ";tower",
  u: ";hunt",
  n: ";daily",
  m: ";map",
  i: ";bag",
  s: ";shop",
  g: ";train",
  f: ";forge",
  r: ";rest",
  c: ";me",
  k: ";skills",
  v: ";feats",
  l: ";log",
  h: ";help",
  "1": ";1",
  "2": ";2",
  "\r": ";",
};

const FIGHT_KEYS: Record<string, string> = {
  a: ";a",
  d: ";d",
  f: ";f",
  p: ";i potion",
  e: ";i elixir",
  o: ";i bomb",
  z: ";i smoke",
};

function quit(): void {
  stopLoop();
  if (hasImage(painted)) clearImage();
  if (reel?.timer) clearTimeout(reel.timer);
  out(`${ESC}?1004l${ESC}?7h${ESC}?25h${ESC}?1049l`);
  process.stdin.setRawMode(false);
  process.exit(0);
}

type Key = string | "left" | "right" | "up" | "down" | "focus-in" | "focus-out" | "esc";

function onKey(key: Key): void {
  if (key === "focus-in") {
    focused = true;
    lastInput = Date.now();
    if (!reel && !loop) restartLoop();
    return;
  }
  if (key === "focus-out") {
    focused = false;
    return stopLoop(true);
  }
  lastInput = Date.now();
  if (key === "\u0003") return quit(); // Ctrl+C

  // Skip a playing animation; space/enter/esc only skip, anything else
  // then also counts as input (mash `a` to keep attacking).
  if (reel) {
    finish();
    if (key === " " || key === "\r" || key === "esc") return;
  }

  if (key === "~") {
    speed = nextSpeed(speed);
    saveSpeed(speed);
    if (speed === "off") stopLoop();
    else if (!loop) restartLoop();
    return draw();
  }

  if (mode === "title") {
    if (key === "q") return quit();
    stopLoop();
    mode = "game";
    out(`${ESC}H${ESC}2J`);
    painted = [];
    return exec(";");
  }

  if (typing !== null) {
    if (key === "\r") {
      const cmd = typing.trim();
      typing = null;
      if (cmd) return exec(`;${cmd}`);
    } else if (key === "esc") {
      typing = null;
      draw();
      return restartLoop();
    } else if (key === "\u007f") typing = typing.slice(0, -1);
    else if (key.length === 1 && key >= " ") typing += key;
    return draw();
  }
  if (key === "q" || key === "esc") return quit();
  if (key === ":" || key === ";") {
    stopLoop();
    typing = "";
    return draw();
  }

  const fight = !!snap?.battle && !snap.battle.over;
  if (fight) {
    const actions = fightActions(snap!);
    if (key === "left" || key === "h" || key === "up") {
      cursor = (cursor - 1 + actions.length) % actions.length;
      return draw();
    }
    if (key === "right" || key === "l" || key === "down" || key === "\t") {
      cursor = (cursor + 1) % actions.length;
      return draw();
    }
    if (key === "\r") return exec(actions[cursor]?.cmd ?? ";");
    const cmd = /^[1-7]$/.test(key) ? `;s${key}` : FIGHT_KEYS[key];
    if (cmd) {
      // Show the choice on the bar too.
      const at = actions.findIndex((a) => a.cmd === cmd);
      if (at >= 0) cursor = at;
      return exec(cmd);
    }
    return;
  }
  const cmd = TOWN_KEYS[key];
  if (cmd) exec(cmd);
}

/** Restart the idle loop for the current screen (focus back, speed on). */
function restartLoop(): void {
  if (mode === "title") return titleLoop();
  if (lastLoop && typing === null) startLoop(lastLoop.frames, lastLoop.ms);
}

/** Split a raw stdin chunk into keys: CSI/SS3 sequences become named keys
 *  (arrows, focus events) or are dropped whole; everything else is fed one
 *  character at a time (fast typing, paste). */
function* keys(chunk: string): Generator<Key> {
  for (let i = 0; i < chunk.length; ) {
    if (chunk[i] === "\x1b") {
      const csi = /^\x1b\[[0-9;]*[@-~]/.exec(chunk.slice(i)) ?? /^\x1bO[A-Z]/.exec(chunk.slice(i));
      if (csi) {
        const fin = csi[0][csi[0].length - 1];
        const named: Record<string, Key> = { A: "up", B: "down", C: "right", D: "left", I: "focus-in", O: "focus-out", Z: "left" };
        const k = csi[0].length === 3 || csi[0].startsWith("\x1bO") ? named[fin] : undefined;
        if (k) yield k;
        i += csi[0].length;
        continue;
      }
      yield "esc";
      i++;
      continue;
    }
    const ch = String.fromCodePoint(chunk.codePointAt(i)!);
    yield ch;
    i += ch.length;
  }
}

// ─── Boot ───────────────────────────────────────────────────────────────────

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
// Alt screen, hidden cursor, no autowrap (rows stay rows), focus reporting.
out(`${ESC}?1049h${ESC}?25l${ESC}?7l${ESC}?1004h${ESC}H${ESC}2J`);
process.stdout.on("resize", () => {
  if (mode === "title") return repaintAll(titleScreen(titleState));
  repaintAll(reel ? reel.frames[Math.max(0, reel.i - 1)].text : compose(loop ? force(loop.frames[loop.i]) : body));
});
process.on("exit", () => out(`${ESC}?1004l${ESC}?7h${ESC}?25h`));
refreshSnap();
playTitle();

process.stdin.on("data", (chunk: string) => {
  for (const k of keys(chunk)) onKey(k);
});
