#!/usr/bin/env bun
/**
 * gfx-demo — H0 spike for the HD overhaul (docs/game-feel/hd-overhaul/).
 *
 * Plays the HD blob live in whatever render tier this terminal supports:
 * kitty graphics → iTerm2 inline images → truecolor half-blocks → ASCII.
 *
 *   bun run gfx-demo                       auto-detect tier, interactive
 *   bun run gfx-demo --tier halfblock      force a tier (kitty|iterm|halfblock|ascii)
 *   bun run gfx-demo --rarity legendary --shiny --bg
 *   bun run gfx-demo --snapshot            print one half-block frame and exit
 *   bun run gfx-demo --png out/ --frames 60  dump frames as PNGs and exit
 *
 * Keys: space bounce · r rarity · s shiny · g backdrop · t tier · q quit
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { getArtFrame } from "../server/art.ts";
import { RARITIES, type Rarity } from "../server/engine.ts";
import { getRarityColor } from "../server/theme.ts";
import { BLOB_H, BLOB_W, BOUNCE_SECONDS, renderBlob, type BlobOptions } from "../server/gfx/blob.ts";
import { detectTier, isTier, tmuxWrap, TIERS, type Tier } from "../server/gfx/detect.ts";
import { encodeHalfblock } from "../server/gfx/encode/halfblock.ts";
import { encodeIterm } from "../server/gfx/encode/iterm.ts";
import { encodeKitty, kittyDelete } from "../server/gfx/encode/kitty.ts";
import { encodePng } from "../server/gfx/encode/png.ts";

// ─── Args ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2).filter((a) => a !== "gfx-demo");
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const tierArg = opt("tier");
if (tierArg && tierArg !== "auto" && !isTier(tierArg)) {
  console.error(`Unknown tier "${tierArg}". Use one of: auto, ${TIERS.join(", ")}`);
  process.exit(1);
}
const rarityArg = opt("rarity") ?? "rare";
if (!(RARITIES as readonly string[]).includes(rarityArg)) {
  console.error(`Unknown rarity "${rarityArg}". Use one of: ${RARITIES.join(", ")}`);
  process.exit(1);
}

const detected = detectTier(process.env, tierArg);
const state = {
  tier: detected.tier as Tier,
  rarity: rarityArg as Rarity,
  shiny: flag("shiny"),
  backdrop: flag("bg"),
  bounces: [] as number[],
};
const fps = Math.max(1, Math.min(60, Number(opt("fps") ?? 30)));
const seed = Number(opt("seed") ?? 7);

const options = (): BlobOptions => ({
  rarity: state.rarity,
  shiny: state.shiny,
  backdrop: state.backdrop,
  bounces: state.bounces,
  seed,
});

// ─── Non-interactive modes ──────────────────────────────────────────────────

const pngDir = opt("png");
if (pngDir) {
  const frames = Math.max(1, Number(opt("frames") ?? 60));
  const scale = Math.max(1, Number(opt("scale") ?? 4));
  mkdirSync(pngDir, { recursive: true });
  // Bounce once in the middle so a dump shows both idle and motion.
  state.bounces = [(frames / fps) * 0.4];
  for (let i = 0; i < frames; i++) {
    const file = join(pngDir, `blob-${String(i).padStart(4, "0")}.png`);
    await Bun.write(file, encodePng(renderBlob(i / fps, options()).upscale(scale)));
  }
  console.log(`Wrote ${frames} frames (${BLOB_W * scale}×${BLOB_H * scale}) to ${pngDir}`);
  process.exit(0);
}

if (flag("snapshot") || !process.stdout.isTTY || !process.stdin.isTTY) {
  const fb = renderBlob(Number(opt("t") ?? 0), options());
  console.log(encodeHalfblock(fb, { color: detected.color }).join("\n"));
  process.exit(0);
}

// ─── Interactive player ─────────────────────────────────────────────────────

const out = process.stdout;
const ESC = "\x1b[";
const TOP = 3; // sprite's first terminal row
const LEFT = 3;
const KITTY_ID = 4242;
/** Cells the pixel tiers occupy: square pixels at a ~1:2 cell aspect. */
const PIX_COLS = 48;
const PIX_ROWS = Math.round((PIX_COLS * BLOB_H) / BLOB_W / 2);
const ROWS = (tier: Tier) => (tier === "kitty" || tier === "iterm" ? PIX_ROWS : tier === "ascii" ? 5 : Math.ceil(BLOB_H / 2));

const graphics = (seq: string) => (detected.tmux ? tmuxWrap(seq) : seq);
let prevLines: string[] = [];
let measured = 0;
let frameCount = 0;
let lastMeasure = performance.now();
const started = performance.now();
const now = () => (performance.now() - started) / 1000;

function clearAll(): void {
  if (state.tier === "kitty") out.write(graphics(kittyDelete(KITTY_ID)));
  out.write(`${ESC}2J`);
  prevLines = [];
}

function hud(): void {
  const rows = ROWS(state.tier);
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const key = (k: string, label: string) => `\x1b[1;97;48;2;60;56;90m ${k} \x1b[0m ${dim(label)}`;
  const tierNote = state.tier === detected.tier ? `auto: ${detected.reason}` : "manual";
  const lines = [
    `\x1b[1mclaude-buddy · HD spike\x1b[0m  ${dim("tier")} \x1b[1;96m${state.tier}\x1b[0m ${dim(`(${tierNote})`)}  ${dim("fps")} ${measured}  ${dim("rarity")} ${getRarityColor(state.rarity)}${state.rarity}\x1b[0m${state.shiny ? "  \x1b[1;95m✦ shiny\x1b[0m" : ""}`,
    "",
    [key("space", "bounce"), key("r", "rarity"), key("s", "shiny"), key("g", "backdrop"), key("t", "tier"), key("q", "quit")].join("  "),
  ];
  out.write(`${ESC}1;1H${ESC}2K${lines[0]}`);
  out.write(`${ESC}${TOP + rows + 1};1H${ESC}2K${lines[1]}${ESC}${TOP + rows + 2};1H${ESC}2K${lines[2]}`);
}

function drawAscii(t: number): void {
  // T0: today's art, so the fallback is visibly the same buddy.
  const pose = Math.floor(t * 2) % 3;
  const bouncing = state.bounces.some((b) => t >= b && t - b < BOUNCE_SECONDS);
  const lines = getArtFrame("blob", bouncing ? "✦" : "·", bouncing ? 1 : pose);
  const color = getRarityColor(state.rarity);
  lines.forEach((l, i) => out.write(`${ESC}${TOP + i};${LEFT}H${color}${l}\x1b[0m`));
}

function frame(): void {
  const t = now();
  if (state.tier === "ascii") {
    drawAscii(t);
  } else {
    const fb = renderBlob(t, options());
    if (state.tier === "halfblock") {
      const lines = encodeHalfblock(fb, { color: detected.color });
      lines.forEach((l, i) => {
        if (prevLines[i] !== l) out.write(`${ESC}${TOP + i};${LEFT}H${l}`);
      });
      prevLines = lines;
    } else {
      const big = fb.upscale(4);
      const seq =
        state.tier === "kitty"
          ? encodeKitty(big, { id: KITTY_ID, placement: 1, cols: PIX_COLS, rows: PIX_ROWS })
          : encodeIterm(big, { cols: PIX_COLS, rows: PIX_ROWS });
      out.write(`${ESC}${TOP};${LEFT}H${graphics(seq)}`);
    }
  }
  frameCount++;
  const ms = performance.now() - lastMeasure;
  if (ms >= 1000) {
    measured = Math.round((frameCount * 1000) / ms);
    frameCount = 0;
    lastMeasure = performance.now();
  }
  hud();
}

// iTerm2 re-decodes a PNG per frame, so it gets a lower cap.
const interval = () => 1000 / (state.tier === "iterm" ? Math.min(fps, 15) : state.tier === "ascii" ? 10 : fps);
let timer: ReturnType<typeof setTimeout> | null = null;
// Fixed-timestep schedule: aim at absolute deadlines so render time and
// timer slop don't accumulate into a lower frame rate.
let deadline = performance.now();
const loop = () => {
  frame();
  deadline += interval();
  const now = performance.now();
  if (deadline < now - 100) deadline = now; // fell far behind (e.g. suspended): resync
  timer = setTimeout(loop, Math.max(0, deadline - now));
};

function quit(): void {
  if (timer) clearTimeout(timer);
  if (state.tier === "kitty") out.write(graphics(kittyDelete(KITTY_ID)));
  out.write(`\x1b[0m${ESC}?25h${ESC}?1049l`);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key: string) => {
  if (key === "q" || key === "\x1b" || key === "\x03") return quit();
  if (key === " " || key === "b") state.bounces = [...state.bounces.filter((b) => now() - b < BOUNCE_SECONDS), now()];
  else if (key === "r") state.rarity = RARITIES[(RARITIES.indexOf(state.rarity) + 1) % RARITIES.length];
  else if (key === "s") state.shiny = !state.shiny;
  else if (key === "g") state.backdrop = !state.backdrop;
  else if (key === "t") {
    clearAll();
    state.tier = TIERS[(TIERS.indexOf(state.tier) + 1) % TIERS.length];
  }
});
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
out.on("resize", clearAll);

out.write(`${ESC}?1049h${ESC}?25l`);
clearAll();
loop();
