#!/usr/bin/env bun
/**
 * cli/play.ts — Buddy Quest, full-screen.
 *
 * The same game (and save) as the zero-token `;` prompt commands, in its own
 * terminal pane with single-key controls, a title screen, and attack
 * animations. It draws only in response to a keypress (plus the few frames
 * of an attack animation right after one) — no idle loop, no timers, so it
 * costs nothing while you're coding in the other pane.
 *
 * Usage:  bun run play   |   claude-buddy play
 */

import { loadBuddyCtx, runFull } from "../server/rpg/cli.ts";
import { buddySprite } from "../server/rpg/render.ts";
import { loadRpg } from "../server/rpg/store.ts";

if (!process.stdin.isTTY) {
  console.error("Buddy Quest needs an interactive terminal. In Claude Code, type ;help instead.");
  process.exit(1);
}

const ESC = "\x1b[";
const out = (s: string) => process.stdout.write(s);
const FRAME_MS = 85;

const LOGO = [
  "█▀▄ █ █ █▀▄ █▀▄ █ █   █▀█ █ █ █▀▀ █▀▀ ▀█▀",
  "█▀▄ █ █ █ █ █ █  █    █ █ █ █ █▀▀ ▀▀█  █ ",
  "▀▀  ▀▀▀ ▀▀  ▀▀   ▀    ▀▀█ ▀▀▀ ▀▀▀ ▀▀▀  ▀ ",
];

let screen: "title" | "game" = "title";
let last = "";
let banner = "";
let typing: string | null = null;
let animating = false;

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
  "\r": ";",
};

function state(): { fight: boolean; event: boolean } {
  try {
    const s = loadRpg();
    return { fight: !!s.battle, event: !!s.event };
  } catch {
    return { fight: false, event: false };
  }
}

function legend(): string {
  const { fight, event } = state();
  if (fight) return "[a]ttack [d]efend [1-7] skills  [p]otion [e]lixir b[o]mb [z] smoke  [f]lee   [:] command  [q]uit";
  if (event) return "[1] / [2] choose   [c]har [i] bag   [:] command  [q]uit";
  return "e[x]plore [b]oss [t]ower h[u]nt [m]ap  [i] bag [s]hop [f]orge [g] train [r]est  [c]har s[k]ills [v] feats bou[n]ties [l]og [h]elp  [:] cmd  [q]uit";
}

function center(line: string, cols: number, w = line.length): string {
  return " ".repeat(Math.max(0, Math.floor((cols - w) / 2))) + line;
}

function drawTitle(): void {
  const cols = process.stdout.columns || 80;
  const ctx = loadBuddyCtx();
  const sprite = buddySprite(ctx);
  const sw = sprite.reduce((m, l) => Math.max(m, l.length), 0);
  out(`${ESC}H${ESC}2J\n\n`);
  for (const l of LOGO) out(`${ESC}1;35m${center(l, cols, 41)}${ESC}0m\n`);
  out(`\n${ESC}2m${center("a turn-based RPG that lives inside Claude Code", cols)}${ESC}0m\n\n`);
  for (const l of sprite) out(`${ESC}36m${center(l.padEnd(sw), cols, sw)}${ESC}0m\n`);
  out(`\n${center(`${ctx.name} is ready.`, cols)}\n\n`);
  out(`${ESC}1;33m${center("— press any key —", cols)}${ESC}0m`);
}

function draw(body = last, withLegend = true): void {
  if (screen === "title") return drawTitle();
  const cols = process.stdout.columns || 80;
  out(`${ESC}H${ESC}2J`);
  if (banner) out(`${banner}\n`);
  out(`${body}\n\n`);
  if (!withLegend) return;
  if (typing !== null) out(`${ESC}36m;${typing}${ESC}0m█`);
  else out(`${ESC}2m${legend().slice(0, Math.max(20, cols * 2))}${ESC}0m`);
}

function bannerFor(text: string): string {
  const cols = process.stdout.columns || 80;
  if (text.includes("LEVEL UP")) return `${ESC}1;33m${center("⭐  L E V E L   U P  ⭐", cols, 22)}${ESC}0m`;
  if (text.includes("T H E   E N D")) return `${ESC}1;35m${center("★  T H E   E N D  ★", cols, 19)}${ESC}0m`;
  if (text.includes("defeated for the first time")) return `${ESC}1;33m${center("♛  B O S S   D O W N  ♛", cols, 23)}${ESC}0m`;
  if (text.includes("Victory")) return `${ESC}1;32m${center("★  V I C T O R Y  ★", cols, 19)}${ESC}0m`;
  if (text.includes("Knocked out")) return `${ESC}1;31m${center("✖  D E F E A T E D  ✖", cols, 21)}${ESC}0m`;
  return "";
}

function quit(): void {
  out(`${ESC}?25h${ESC}?1049l`);
  process.stdin.setRawMode(false);
  process.exit(0);
}

function exec(cmd: string): void {
  let res;
  try {
    res = runFull(cmd, true, true);
  } catch (e) {
    last = `Error: ${(e as Error).message}`;
    banner = "";
    return draw();
  }
  banner = "";
  if (!res.anim.length) {
    last = res.out;
    banner = bannerFor(res.out);
    return draw();
  }
  // Play the attack animation, then land on the final screen.
  animating = true;
  res.anim.forEach((frame, i) => setTimeout(() => draw(frame, false), i * FRAME_MS));
  setTimeout(() => {
    animating = false;
    last = res.out;
    banner = bannerFor(res.out);
    draw();
  }, res.anim.length * FRAME_MS);
}

function onKey(key: string): void {
  if (key === "\u0003") return quit(); // Ctrl+C
  if (screen === "title") {
    if (key === "q") return quit();
    screen = "game";
    return exec(";");
  }
  if (animating) return; // swallow keys mid-animation
  if (typing !== null) {
    if (key === "\r") {
      const cmd = typing.trim();
      typing = null;
      if (cmd) return exec(`;${cmd}`);
    } else if (key === "\u001b") typing = null;
    else if (key === "\u007f") typing = typing.slice(0, -1);
    else if (key >= " ") typing += key;
    return draw();
  }
  if (key === "q" || key === "\u001b") return quit();
  if (key === ":" || key === ";") {
    typing = "";
    return draw();
  }
  const { fight } = state();
  if (fight && /^[1-7]$/.test(key)) return exec(`;s${key}`);
  const cmd = (fight ? FIGHT_KEYS : TOWN_KEYS)[key];
  if (cmd) exec(cmd);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
out(`${ESC}?1049h${ESC}?25l`);
process.stdout.on("resize", () => draw());
draw();

process.stdin.on("data", (chunk: string) => {
  // Arrow/function keys arrive as escape sequences — ignore them whole. Other
  // chunks (fast typing, paste) are fed through one character at a time.
  if (chunk.length > 1 && chunk.startsWith("\u001b")) return;
  for (const key of chunk) onKey(key);
});
