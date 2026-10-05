#!/usr/bin/env bun
/**
 * gfx-demo — H0 spike for the HD overhaul (docs/game-feel/hd-overhaul/).
 *
 * Plays the HD buddies live in whatever render tier this terminal supports:
 * kitty graphics → iTerm2 inline images → truecolor half-blocks → ASCII.
 *
 *   bun run gfx-demo                       auto-detect tier, interactive
 *   bun run gfx-demo --species octopus     any of the 20 species (c cycles)
 *   bun run gfx-demo --tier halfblock      force a tier (kitty|iterm|halfblock|ascii)
 *   bun run gfx-demo --rarity legendary --shiny --bg
 *   bun run gfx-demo --snapshot --anim hit --t 0.1   print one frame and exit
 *   bun run gfx-demo --png out/ --anim attack --frames 30  dump PNG frames
 *
 * Keys: 1–6 idle/walk/attack/hit/ko/victory · space victory hop · c species
 *       h hatch · l loot reveal (H6 cinematics, current species and rarity)
 *       e gear (cycles hats, weapons and the rubber duck)
 *       r rarity · s shiny · g backdrop · t tier · q quit
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { getArtFrame } from "../server/art.ts";
import { RARITIES, type Rarity } from "../server/engine.ts";
import { getRarityColor } from "../server/theme.ts";
import { ANIMS, ANIM_INFO, HD_H as BLOB_H, HD_SPECIES, HD_W as BLOB_W, renderHd, type Anim } from "../server/gfx/hd.ts";
import type { Species } from "../server/engine.ts";
import { detectTier, isTier, tmuxWrap, TIERS, type Tier } from "../server/gfx/detect.ts";
import { encodeHalfblock } from "../server/gfx/encode/halfblock.ts";
import { encodeIterm } from "../server/gfx/encode/iterm.ts";
import { encodeKitty, kittyDelete } from "../server/gfx/encode/kitty.ts";
import { encodePng } from "../server/gfx/encode/png.ts";
import { HATCH_MS, LOOT_MS, cineFeel, renderHatch, renderLoot, type LootSlot } from "../server/gfx/cinema.ts";
import { Framebuffer } from "../server/gfx/framebuffer.ts";
import { HD_HEADROOM, type HdGear } from "../server/gfx/gear.ts";

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

const speciesArg = (opt("species") ?? "blob") as Species;
if (!HD_SPECIES.includes(speciesArg)) {
  console.error(`No HD art for "${speciesArg}" yet. Try one of: ${HD_SPECIES.join(", ")}`);
  process.exit(1);
}
const animArg = (opt("anim") ?? "idle") as Anim;
if (!(ANIMS as readonly string[]).includes(animArg)) {
  console.error(`Unknown animation "${animArg}". Use one of: ${ANIMS.join(", ")}`);
  process.exit(1);
}

const detected = detectTier(process.env, tierArg);
const state = {
  tier: detected.tier as Tier,
  rarity: rarityArg as Rarity,
  shiny: flag("shiny"),
  backdrop: flag("bg"),
  species: speciesArg,
  anim: animArg,
  /** When the current animation started (seconds on the demo clock). */
  animStart: 0,
  /** An H6 cinematic playing over the buddy (h / l), or null. */
  cine: null as { kind: "hatch" | "loot"; start: number } | null,
  /** Gear preset (e cycles; 0 = none). */
  gear: 0,
  /** Loot reveals cycle the item slot (each press, the next one). */
  slot: -1,
};
const LOOT: readonly { slot: LootSlot; name: string }[] = [
  { slot: "weapon", name: "Segfault Saber" },
  { slot: "armor", name: "Mutex Mail" },
  { slot: "charm", name: "Lucky Commit" },
];
/** The demo plays the cinematics at full feel (reduce-motion still applies). */
const CINE_FEEL = cineFeel("full", !!process.env.BUDDY_REDUCED_MOTION && process.env.BUDDY_REDUCED_MOTION !== "0")!;
/** The cinematic frame at demo time `t`, or null once it has played (plus a beat). */
function cineFrame(t: number): Framebuffer | null {
  const c = state.cine;
  if (!c) return null;
  const ms = (t - c.start) * 1000;
  const total = c.kind === "hatch" ? HATCH_MS : LOOT_MS;
  if (ms > total + 1200) return null;
  const at = Math.min(ms, total);
  if (c.kind === "hatch") return renderHatch({ species: state.species, rarity: state.rarity, shiny: state.shiny, seed }, at, CINE_FEEL);
  const item = LOOT[Math.max(0, state.slot)];
  return renderLoot({ ...item, rarity: state.rarity, seed }, at, CINE_FEEL);
}
const fps = Math.max(1, Math.min(60, Number(opt("fps") ?? 30)));
const seed = Number(opt("seed") ?? 7);

/** Gear presets for `e`: every hat, then weapons and the trinket. */
const GEAR: readonly (HdGear | undefined)[] = [
  undefined,
  ...(["crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"] as const).map((hat) => ({ hat })),
  { weapon: "wand", trinket: "duck" },
  { weapon: "sword", hat: "beanie" },
  { weapon: "blade", weaponRarity: "legendary", hat: "crown" },
];
const gearName = (g?: HdGear) => (g ? [g.hat, g.weapon, g.trinket].filter(Boolean).join("+") : "none");

/** Every frame on one canvas, bottom-aligned (hats make frames taller). */
const FRAME_H = BLOB_H + HD_HEADROOM;
function padded(fb: Framebuffer): Framebuffer {
  if (fb.height === FRAME_H) return fb;
  const out = new Framebuffer(fb.width, FRAME_H);
  out.draw(fb, 0, FRAME_H - fb.height);
  return out;
}

/** Render the current animation at demo time `t`. One-shot animations hold
 *  their last pose briefly, then hand back to idle (KO stays down). */
function render(t: number) {
  const info = ANIM_INFO[state.anim];
  let local = state.anim === "idle" ? t : t - state.animStart;
  const over = info.loop ? state.anim === "victory" && local > info.duration * 2 : state.anim !== "ko" && local > info.duration + 0.5;
  if (over) {
    state.anim = "idle";
    local = t;
  }
  return padded(
    renderHd(state.species, state.anim, local, {
      rarity: state.rarity,
      shiny: state.shiny,
      backdrop: state.backdrop,
      seed,
      gear: GEAR[state.gear],
    })!,
  );
}

// ─── Non-interactive modes ──────────────────────────────────────────────────

const pngDir = opt("png");
if (pngDir) {
  const frames = Math.max(1, Number(opt("frames") ?? 60));
  const scale = Math.max(1, Number(opt("scale") ?? 4));
  mkdirSync(pngDir, { recursive: true });
  for (let i = 0; i < frames; i++) {
    const file = join(pngDir, `${state.species}-${state.anim}-${String(i).padStart(4, "0")}.png`);
    await Bun.write(file, encodePng(render(i / fps).upscale(scale)));
  }
  console.log(`Wrote ${frames} frames (${BLOB_W * scale}×${FRAME_H * scale}) to ${pngDir}`);
  process.exit(0);
}

if (flag("snapshot") || !process.stdout.isTTY || !process.stdin.isTTY) {
  const fb = render(Number(opt("t") ?? 0));
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
const PIX_ROWS = Math.round((PIX_COLS * FRAME_H) / BLOB_W / 2);
const ROWS = (tier: Tier) => (tier === "kitty" || tier === "iterm" ? PIX_ROWS : tier === "ascii" ? 5 : Math.ceil(FRAME_H / 2));

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
    `\x1b[1mclaude-buddy · HD\x1b[0m  \x1b[1;93m${state.species}\x1b[0m ${dim(state.anim)}  ${dim("tier")} \x1b[1;96m${state.tier}\x1b[0m ${dim(`(${tierNote})`)}  ${dim("fps")} ${measured}  ${dim("rarity")} ${getRarityColor(state.rarity)}${state.rarity}\x1b[0m${state.shiny ? "  \x1b[1;95m✦ shiny\x1b[0m" : ""}  ${dim("gear")} ${gearName(GEAR[state.gear])}`,
    "",
    [key("1-6", "idle walk attack hit ko victory"), key("h", "hatch"), key("l", "loot"), key("e", "gear"), key("c", "species"), key("r", "rarity"), key("s", "shiny"), key("g", "backdrop"), key("t", "tier"), key("q", "quit")].join("  "),
  ];
  out.write(`${ESC}1;1H${ESC}2K${lines[0]}`);
  out.write(`${ESC}${TOP + rows + 1};1H${ESC}2K${lines[1]}${ESC}${TOP + rows + 2};1H${ESC}2K${lines[2]}`);
}

function drawAscii(t: number): void {
  // T0: today's art, so the fallback is visibly the same buddy.
  const pose = Math.floor(t * 2) % 3;
  const busy = state.anim !== "idle";
  const lines = getArtFrame(state.species, busy ? "✦" : "·", busy ? 1 : pose);
  const color = getRarityColor(state.rarity);
  lines.forEach((l, i) => out.write(`${ESC}${TOP + i};${LEFT}H${color}${l}\x1b[0m`));
}

function frame(): void {
  const t = now();
  const cine = state.tier === "ascii" ? null : cineFrame(t);
  if (state.cine && !cine) {
    // The cinematic is over: back to the buddy.
    state.cine = null;
    clearAll();
  }
  if (state.tier === "ascii") {
    drawAscii(t);
  } else {
    const fb = cine ?? render(t);
    if (state.tier === "halfblock") {
      const lines = encodeHalfblock(fb, { color: detected.color });
      lines.forEach((l, i) => {
        if (prevLines[i] !== l) out.write(`${ESC}${TOP + i};${LEFT}H${l}`);
      });
      prevLines = lines;
    } else {
      const big = fb.upscale(4);
      // Keep square pixels: the cinematics are wider than the buddy canvas.
      const cols = Math.round((PIX_ROWS * 2 * fb.width) / fb.height);
      const seq =
        state.tier === "kitty"
          ? encodeKitty(big, { id: KITTY_ID, placement: 1, cols, rows: PIX_ROWS })
          : encodeIterm(big, { cols, rows: PIX_ROWS });
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
  const play = (a: Anim) => {
    state.anim = a;
    state.animStart = now();
  };
  const cinematic = (kind: "hatch" | "loot") => {
    if (state.tier === "ascii") return;
    if (kind === "loot") state.slot = (state.slot + 1) % LOOT.length;
    state.cine = { kind, start: now() };
    clearAll();
  };
  if (key === "h") return cinematic("hatch");
  if (key === "l") return cinematic("loot");
  if (state.cine) {
    // Any other key skips the cinematic.
    state.cine = null;
    clearAll();
  }
  if (key === " " || key === "b") play("victory");
  else if (/^[1-6]$/.test(key)) play(ANIMS[Number(key) - 1]);
  else if (key === "c") {
    state.species = HD_SPECIES[(HD_SPECIES.indexOf(state.species) + 1) % HD_SPECIES.length];
    clearAll();
  } else if (key === "r") state.rarity = RARITIES[(RARITIES.indexOf(state.rarity) + 1) % RARITIES.length];
  else if (key === "s") state.shiny = !state.shiny;
  else if (key === "e") {
    state.gear = (state.gear + 1) % GEAR.length;
    clearAll();
  }
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
