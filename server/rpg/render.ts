/**
 * Text renderers for the RPG — shared by the zero-token prompt hook (plain
 * text: hook output isn't ANSI-rendered) and the `claude-buddy play` TUI
 * (colored). Pure.
 */

import type { Eye, Hat, Rarity, Species } from "../engine";
import { composePose } from "../combat";
import { trimBlankTopRows } from "../art";
import { foeIntent, type Battle } from "./battle";
import {
  CONSUMABLES,
  FLOORS_PER_ZONE,
  RARITY_ANSI,
  SKILLS,
  zoneById,
  type ConsumableId,
  type SkillId,
} from "./data";
import { statLine, type GearItem } from "./gear";

export interface Paint {
  color: boolean;
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
  return paint(p, RARITY_ANSI[g.rarity], `${tag} ${g.name}`) + (g.locked ? " 🔒" : "");
}

export function gearLine(p: Paint, g: GearItem): string {
  return `${gearName(p, g)} ${paint(p, C.dim, `i${g.ilvl}`)}  ${statLine(g.stats)}`;
}

export function bar(cur: number, max: number, width: number = 10): string {
  const n = max > 0 ? Math.round((Math.max(0, cur) / max) * width) : 0;
  return "█".repeat(n) + "░".repeat(width - n);
}

export function hpBar(p: Paint, cur: number, max: number, width: number = 10): string {
  const ratio = max > 0 ? cur / max : 0;
  const col = ratio > 0.5 ? C.green : ratio > 0.25 ? C.yellow : C.red;
  return `♥ ${cur}/${max} ${paint(p, col, bar(cur, max, width))}`;
}

export interface Look {
  name: string;
  species: Species;
  eye: Eye;
  hat: Hat;
}

/** The two-sprite scene (buddy vs. mirrored foe), reusing the status-line
 *  combat composer so the art matches the idle fights exactly. */
export function scene(look: Look, foeSpecies: Species, crown: boolean, strike: boolean): string {
  try {
    const art = composePose(
      look.species,
      foeSpecies,
      { pEye: look.eye, eEye: "×" as Eye, strike },
      "/",
      undefined,
      { hat: look.hat },
      crown,
    );
    // Drop the hat row when it's empty on both sprites.
    return trimBlankTopRows([art]).join("");
  } catch {
    return "";
  }
}

export function battleTitle(b: Battle): string {
  if (b.kind === "tower") return `Endless Tower · Floor ${b.floor}`;
  const z = zoneById(b.zone);
  if (b.kind === "boss") return `${z?.name ?? "?"} · BOSS`;
  return `${z?.name ?? "?"} · Floor ${b.floor}/${FLOORS_PER_ZONE}`;
}

export function battleScreen(
  p: Paint,
  b: Battle,
  look: Look,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
): string {
  const out: string[] = [];
  out.push(paint(p, C.bold, `⚔ ${battleTitle(b)} · Turn ${b.turn}`));
  const art = scene(look, b.foe.species, !!b.foe.boss, b.turn > 0 && !b.over);
  if (art) out.push(art);
  const foeName = b.foe.boss ? paint(p, C.yellow, `♛ ${b.foe.name}`) : b.foe.name;
  out.push(`${look.name.padEnd(14)} ${hpBar(p, b.hero.hp, b.hero.maxHp)}`);
  out.push(`${foeName} Lv${b.foe.level}  ${hpBar(p, b.foe.hp, b.foe.maxHp)}`);
  const intent = foeIntent(b);
  const status: string[] = [];
  if (b.hero.fx.poison) status.push("poisoned");
  if (b.hero.fx.blind) status.push("cursed aim");
  if (b.hero.fx.buff) status.push(`ATK↑${b.hero.fx.buff}`);
  if (intent) out.push(paint(p, C.yellow, `  foe: ${intent}`));
  if (status.length) out.push(paint(p, C.magenta, `  you: ${status.join(", ")}`));
  for (const l of b.log) out.push(`» ${l}`);
  if (!b.over) out.push(actionHints(p, b, skills, items));
  return out.join("\n");
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
