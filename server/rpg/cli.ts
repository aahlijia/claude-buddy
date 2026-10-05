#!/usr/bin/env bun
/**
 * RPG entry point.
 *
 *   bun run server/rpg/cli.ts --hook       UserPromptSubmit hook mode: reads the
 *                                          hook JSON on stdin, answers `;cmd`
 *                                          prompts with {"decision":"block"} so
 *                                          they never reach the model (zero tokens).
 *   bun run server/rpg/cli.ts <cmd...>     one-shot, prints colored output.
 *   bun run server/rpg/cli.ts commit [won] passive reward on a commit (hooks).
 */

import type { BuddyStats, Eye, Hat, Species } from "../engine";
import { execute, hudLine, heroOf, onCommit, type BuddyCtx, type Standoff } from "./game";
import { loadRpg, saveRpg, type RpgState } from "./store";

const FALLBACK_STATS: BuddyStats = { DEBUGGING: 20, PATIENCE: 20, CHAOS: 20, WISDOM: 20, SNARK: 20 };

/** The idle-RPG standoff bug currently on the status line, if any. */
export function loadStandoff(): Standoff | null {
  try {
    const { readPendingEncounter } = require("../combat.ts") as typeof import("../combat.ts");
    const { bugById } = require("../bugs.ts") as typeof import("../bugs.ts");
    const rec = readPendingEncounter();
    const bug = rec ? bugById(rec.bugId) : null;
    if (!rec || !bug) return null;
    return {
      key: `${rec.bugId}:${rec.startedAt}`,
      name: bug.name.replace(/\b\w/g, (ch) => ch.toUpperCase()),
      species: bug.species,
      tier: rec.tier ?? bug.tier,
      boss: rec.kind === "boss",
    };
  } catch {
    return null;
  }
}

/** Build the companion-side context; any failure degrades to a plain blob. */
export function loadBuddyCtx(): BuddyCtx {
  try {
    const { loadCompanion } = require("../state.ts") as typeof import("../state.ts");
    const { getXpState, ownedUpgradeEffects } = require("../xp.ts") as typeof import("../xp.ts");
    const { resolveAppearance } = require("../equipment.ts") as typeof import("../equipment.ts");
    const { ITEMS } = require("../items.ts") as typeof import("../items.ts");
    const c = loadCompanion();
    const xp = getXpState();
    if (!c) throw new Error("no companion");
    const look = resolveAppearance(c.bones, xp.equipment, xp.cosmeticFlags, ITEMS, ownedUpgradeEffects(xp));
    return {
      name: c.name,
      species: c.bones.species,
      eye: c.bones.eye,
      hat: look.hat,
      level: xp.level,
      prestige: xp.prestigeLevel,
      stats: look.stats,
      standoff: loadStandoff(),
    };
  } catch {
    return {
      name: "Buddy",
      species: "blob" as Species,
      eye: "·" as Eye,
      hat: "none" as Hat,
      level: 1,
      prestige: 0,
      stats: FALLBACK_STATS,
    };
  }
}

/** Award buddy XP; returns a level-up fanfare when a level was crossed. */
function awardBuddyXp(amount: number, name: string): string | null {
  if (amount <= 0) return null;
  try {
    const { awardXpAmount, getXpState } = require("../xp.ts") as typeof import("../xp.ts");
    const before = getXpState().level;
    const after = awardXpAmount(amount).level;
    if (after > before) {
      return `⭐ LEVEL UP! ${name} reached buddy Lv${after} — every combat stat grows.`;
    }
  } catch {
    /* XP is a bonus — never fail the command over it */
  }
  return null;
}

/** Patch the RPG HUD into status.json so the status line can show it
 *  without reading another file per tick. Best-effort. */
export function refreshHud(s: RpgState, ctx: BuddyCtx): void {
  try {
    const { readFileSync, writeFileSync, renameSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const { buddyStateDir } = require("../path.ts") as typeof import("../path.ts");
    const f = join(buddyStateDir(), "status.json");
    const status = JSON.parse(readFileSync(f, "utf8"));
    const hud = hudLine(s, heroOf(s, ctx).maxHp);
    if (status.rpgHud === hud) return;
    status.rpgHud = hud;
    const tmp = `${f}.rpg.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(status));
    renameSync(tmp, f);
  } catch {
    /* no status line installed — nothing to patch */
  }
}

/** `;hud on|off` — the one command that touches buddy config, not rpg.json. */
function hudCommand(input: string): string | null {
  const m = /^;*\s*hud\b\s*(on|off)?/i.exec(input.trim());
  if (!m) return null;
  try {
    const { loadConfig, saveConfig } = require("../state.ts") as typeof import("../state.ts");
    const want = m[1] ? m[1].toLowerCase() === "on" : !loadConfig().questHud;
    saveConfig({ questHud: want });
    return `Quest HUD on the status line: ${want ? "on" : "off"}.`;
  } catch (e) {
    return `Couldn't update the HUD setting: ${(e as Error).message}`;
  }
}

export function run(input: string, color: boolean, now: number = Date.now()): string {
  const hud = hudCommand(input);
  if (hud) return hud;
  const ctx = loadBuddyCtx();
  const s = loadRpg(now);
  const r = execute(s, ctx, input, now, { color });
  if (r.changed) {
    saveRpg(s);
    refreshHud(s, ctx);
  }
  const fanfare = awardBuddyXp(r.xp, ctx.name);
  return fanfare ? `${r.out}\n${fanfare}` : r.out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--hook") {
    let prompt = "";
    try {
      prompt = String(JSON.parse(await readStdin()).prompt ?? "");
    } catch {
      return;
    }
    if (!prompt.trimStart().startsWith(";")) return; // not ours — pass through
    let out: string;
    try {
      out = run(prompt.trim(), false);
    } catch (e) {
      out = `Buddy Quest hit an error: ${(e as Error).message}`;
    }
    process.stdout.write(JSON.stringify({ decision: "block", reason: out }));
    return;
  }
  if (argv[0] === "commit") {
    try {
      const s = loadRpg();
      onCommit(s, argv[1] === "won", Date.now());
      saveRpg(s);
      refreshHud(s, loadBuddyCtx());
    } catch {
      /* best-effort */
    }
    return;
  }
  console.log(run(argv.join(" "), process.stdout.isTTY ?? false));
}

if (import.meta.main) await main();
