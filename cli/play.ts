#!/usr/bin/env bun
/**
 * cli/play.ts — Buddy Quest, full-screen.
 *
 * The same game as the zero-token `;` prompt commands, in its own terminal
 * pane with single-key controls. Redraws only on a keypress — no render loop,
 * no timers — so it costs nothing while idle.
 *
 * Usage:  bun run play   |   claude-buddy play
 */

import { run } from "../server/rpg/cli.ts";
import { loadRpg } from "../server/rpg/store.ts";

if (!process.stdin.isTTY) {
  console.error("Buddy Quest needs an interactive terminal. In Claude Code, type ;help instead.");
  process.exit(1);
}

const ESC = "\x1b[";
const out = (s: string) => process.stdout.write(s);

let last = run(";help", true);
let typing: string | null = null;

const TOWN_KEYS: Record<string, string> = {
  x: ";x",
  b: ";boss",
  t: ";tower",
  m: ";map",
  i: ";bag",
  s: ";shop",
  g: ";train",
  r: ";rest",
  c: ";me",
  k: ";skills",
  l: ";log",
  h: ";help",
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

function inFight(): boolean {
  try {
    return !!loadRpg().battle;
  } catch {
    return false;
  }
}

function legend(fight: boolean): string {
  return fight
    ? "[a]ttack [d]efend [1-7] skills  [p]otion [e]lixir b[o]mb [z] smoke  [f]lee   [:] command  [q]uit"
    : "e[x]plore [b]oss [t]ower [m]ap  [i] bag [s]hop [g] train [r]est  [c]har s[k]ills [l]og [h]elp   [:] command  [q]uit";
}

function draw(): void {
  const cols = process.stdout.columns || 80;
  const fight = inFight();
  const title = " BUDDY QUEST ";
  const rule = "─".repeat(Math.max(0, Math.floor((cols - title.length) / 2)));
  const status = fight ? "" : `\n${run(";", true)}\n${"─".repeat(Math.min(cols, 60))}`;
  out(`${ESC}H${ESC}2J`);
  out(`${ESC}1;35m${rule}${title}${rule}${ESC}0m${status}\n${last}\n\n`);
  if (typing !== null) out(`${ESC}36m;${typing}${ESC}0m█`);
  else out(`${ESC}2m${legend(fight)}${ESC}0m`);
}

function quit(): void {
  out(`${ESC}?25h${ESC}?1049l`);
  process.stdin.setRawMode(false);
  process.exit(0);
}

function exec(cmd: string): void {
  try {
    last = run(cmd, true);
  } catch (e) {
    last = `Error: ${(e as Error).message}`;
  }
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
out(`${ESC}?1049h${ESC}?25l`);
process.stdout.on("resize", draw);
draw();

process.stdin.on("data", (chunk: string) => {
  // Arrow/function keys arrive as escape sequences — ignore them whole. Other
  // chunks (fast typing, paste) are fed through one character at a time.
  if (chunk.length > 1 && chunk.startsWith("\u001b")) return;
  for (const key of chunk) onKey(key);
  draw();
});

function onKey(key: string): void {
  if (key === "\u0003") return quit(); // Ctrl+C
  if (typing !== null) {
    if (key === "\r") {
      const cmd = typing.trim();
      typing = null;
      if (cmd) exec(`;${cmd}`);
    } else if (key === "\u001b") typing = null;
    else if (key === "\u007f") typing = typing.slice(0, -1);
    else if (key >= " ") typing += key;
    return;
  }
  if (key === "q" || key === "\u001b") return quit();
  if (key === ":" || key === ";") {
    typing = "";
    return;
  }
  const fight = inFight();
  if (fight && /^[1-7]$/.test(key)) exec(`;s${key}`);
  else {
    const cmd = (fight ? FIGHT_KEYS : TOWN_KEYS)[key];
    if (cmd) exec(cmd);
  }
}
