#!/usr/bin/env bun
/**
 * diorama-demo — the H4 buddy-shell diorama without Claude or a PTY
 * (docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 * Runs the same panel buddy-shell shows, in the bottom of this terminal, in
 * whatever tier it supports, and lets you poke it:
 *
 *   bun run diorama-demo                         auto-detect tier
 *   bun run diorama-demo --species dragon --biome volcano --hour 21
 *   BUDDY_GFX=halfblock bun run diorama-demo      force a tier
 *
 * Keys: b biome · h +1 hour · w weather · s species · r rarity
 *       e error (flinch) · p tests pass (cheer) · c commit (nod)
 *       k Claude thinking (toggle) · m reduceMotion · f gameFeel · q quit
 */

import { RARITIES, type Rarity } from "../server/engine.ts";
import { BIOME_NAMES } from "../server/gfx/biomes.ts";
import { detectTier } from "../server/gfx/detect.ts";
import { SCENE_WEATHERS } from "../server/gfx/diorama.ts";
import { HD_SPECIES } from "../server/gfx/hd.ts";
import { DioramaPanel, dioramaEnabled, kittyPlaysAnimations, type PanelConfig, type PanelStatus } from "./diorama-panel.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("diorama-demo needs an interactive terminal.");
  process.exit(1);
}

const gfx = detectTier(process.env);
let biome = opt("biome") ?? "meadow";
let hour = Number(opt("hour") ?? new Date().getHours() + new Date().getMinutes() / 60);
let weather: string | undefined = opt("weather");
let species = opt("species") ?? "cat";
let rarity: Rarity = (opt("rarity") as Rarity) ?? "rare";
let thinking = false;
const cfg: PanelConfig = { gameFeel: "full", reduceMotion: false };
const stats = { stats: { DEBUGGING: 30, PATIENCE: 12, CHAOS: 44, WISDOM: 20, SNARK: 51 }, peak: "SNARK", dump: "PATIENCE" };

let panel = make();
function make(): DioramaPanel {
  return new DioramaPanel({ tier: gfx.tier, color: gfx.color, tmux: gfx.tmux, kittyNative: kittyPlaysAnimations(process.env), biome, hour, weather });
}

function layout() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const panelRows = Math.max(5, Math.floor(rows * 0.2));
  return { cols, rows, code: rows - panelRows };
}

function status(): PanelStatus {
  return { name: "Pip", species, rarity, stars: "★".repeat(RARITIES.indexOf(rarity) + 1), gameFeel: cfg.gameFeel, sceneWeather: weather };
}

const ESC = "\x1b[";
function header(): string {
  const l = layout();
  const lines = [
    `diorama-demo · tier ${gfx.tier} (${gfx.reason})${panel.tier === "kitty" && kittyPlaysAnimations(process.env) ? " · native loops" : ""}`,
    "",
    `biome ${biome}  ·  hour ${hour.toFixed(1)}  ·  weather ${weather ?? "clear"}  ·  ${rarity} ${species}  ·  gameFeel ${cfg.gameFeel}${cfg.reduceMotion ? "  ·  reduceMotion" : ""}`,
    `${(panel.rate(Date.now()).bps / 1024).toFixed(1)} KB/s`,
    "",
    "b biome · h +1 hour · w weather · s species · r rarity",
    "e error (flinch) · p tests pass (cheer) · c commit (nod) · k thinking · m reduceMotion · f gameFeel · q quit",
  ];
  let out = "\x1b7";
  lines.forEach((t, i) => (out += `${ESC}${i + 2};3H${ESC}2K${ESC}${i === 0 ? "1" : "0"}m${t.slice(0, l.cols - 4)}${ESC}0m`));
  out += `${ESC}${l.code + 1};1H${ESC}36m${"─".repeat(l.cols)}${ESC}0m\x1b8`;
  return out;
}

function repaint(full: boolean): void {
  const l = layout();
  if (full) process.stdout.write(`${ESC}2J`);
  if (!dioramaEnabled(gfx.tier, status(), cfg, l)) {
    process.stdout.write(header() + `${ESC}${l.code + 2};3H(the ASCII panel would show here: gameFeel off, no HD art, or a panel too small)`);
    return;
  }
  panel.update(Date.now(), status(), stats, cfg);
  process.stdout.write(header() + panel.paint(Date.now(), new Date(), full));
}

let timer: ReturnType<typeof setTimeout> | null = null;
function tick(): void {
  timer = null;
  if (thinking) panel.output(Date.now());
  repaint(false);
  const d = panel.nextDelay(Date.now());
  timer = setTimeout(tick, d ?? 1000);
}

function rebuild(): void {
  process.stdout.write(panel.hide(true));
  panel = make();
  panel.resize(layout());
  repaint(true);
}

process.stdout.write(`${ESC}?1049h${ESC}?25l`);
process.stdin.setRawMode(true);
process.stdin.resume();
panel.resize(layout());
repaint(true);
tick();

process.stdout.on("resize", () => {
  panel.resize(layout());
  repaint(true);
});

const cycle = <T,>(list: readonly T[], cur: T | undefined): T => list[(list.indexOf(cur as T) + 1) % list.length];

process.stdin.on("data", (buf: Buffer) => {
  const k = buf.toString();
  const now = Date.now();
  panel.input(now - 1000); // keys here aren't typing into Claude; don't count their echo
  if (k === "q" || k === "\x03") {
    if (timer) clearTimeout(timer);
    process.stdout.write(panel.hide(true) + `${ESC}?25h${ESC}?1049l`);
    process.exit(0);
  }
  if (k === "b") { biome = cycle(BIOME_NAMES, biome); return rebuild(); }
  if (k === "h") { hour = (Math.floor(hour) + 1) % 24; return rebuild(); }
  if (k === "w") { weather = cycle([undefined, ...SCENE_WEATHERS], weather); return rebuild(); }
  if (k === "s") { species = cycle(HD_SPECIES, species as never); return rebuild(); }
  if (k === "r") { rarity = cycle(RARITIES, rarity); return rebuild(); }
  if (k === "e") panel.react("error", now);
  if (k === "p") panel.react("all-green", now);
  if (k === "c") panel.react("commit", now);
  if (k === "k") thinking = !thinking;
  if (k === "m") { cfg.reduceMotion = !cfg.reduceMotion; return rebuild(); }
  if (k === "f") { cfg.gameFeel = cycle(["full", "subtle", "off"], cfg.gameFeel); return rebuild(); }
  if (timer) clearTimeout(timer);
  tick();
});
