/**
 * Text renderers for the RPG — shared by the zero-token prompt hook (plain
 * text: hook output isn't ANSI-rendered) and the `claude-buddy play` TUI
 * (colored). Pure.
 */

import type { Eye, Hat, Rarity, Species } from "../engine";
import { composePose, type PoseExtras } from "../combat";
import { applyHat, displayWidth, getArtFrame, rectFrame, trimSharedBlankTopRows } from "../art";
import { foeIntent, type Battle, type Hit } from "./battle";
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

// ─── Frames & panels ────────────────────────────────────────────────────────

const PANEL_W = 58;

/** An open-right panel: rules on top and bottom, a left border on every
 *  body line. Open on the right on purpose — emoji widths differ between
 *  terminals, and a misaligned right border looks worse than none. */
export function panel(p: Paint, title: string, right: string, body: string[], footer?: string): string {
  const w = Math.max(PANEL_W, ...body.map((l) => displayWidth(l) + 2));
  const t = ` ${title} `;
  const rt = right ? ` ${right} ` : "";
  const fill = Math.max(2, w - displayWidth(t) - displayWidth(rt) - 2);
  const edge = (x: string) => paint(p, C.dim, x);
  const out = [edge("╭─") + paint(p, C.bold, t) + edge("─".repeat(fill)) + rt + edge("─╮")];
  for (const l of body) out.push(`${edge("│")} ${l}`);
  const foot = footer ? ` ${footer} ` : "";
  out.push(edge("╰─") + foot + edge("─".repeat(Math.max(2, w - displayWidth(foot) - 1))) + edge("╯"));
  return out.join("\n");
}

// ─── Sprites ────────────────────────────────────────────────────────────────

/** The buddy alone (town screen): hat applied, blank top rows trimmed. */
export function buddySprite(look: Look): string[] {
  try {
    const art = getArtFrame(look.species, look.eye, 0);
    if (look.hat && look.hat !== "none") applyHat(look.species, look.hat, art);
    const rows = rectFrame(art);
    while (rows.length > 1 && !rows[0].trim()) rows.shift();
    return rows;
  } catch {
    return [];
  }
}

interface ScenePose {
  pEye?: Eye;
  eEye?: Eye;
  strike?: boolean;
  shift?: PoseExtras["shift"];
}

function composeScene(look: Look, foeSpecies: Species, crown: boolean, pose: ScenePose): string {
  return composePose(
    look.species,
    foeSpecies,
    { pEye: pose.pEye ?? look.eye, eEye: pose.eEye ?? ("×" as Eye), strike: !!pose.strike },
    "/",
    pose.shift ? { shift: pose.shift } : undefined,
    { hat: look.hat },
    crown,
  );
}

/** The two-sprite scene (buddy vs. mirrored foe), reusing the status-line
 *  combat composer so the art matches the idle fights exactly. */
export function scene(look: Look, foeSpecies: Species, crown: boolean, strike: boolean): string {
  try {
    return trimSharedBlankTopRows([[composeScene(look, foeSpecies, crown, { strike })]])[0][0];
  } catch {
    return "";
  }
}

/** Damage-number text for one side of a turn. */
function popText(p: Paint, hits: readonly Hit[]): string {
  if (!hits.length) return "";
  const dmg = hits.reduce((a, h) => a + h.dmg, 0);
  if (dmg === 0) return paint(p, C.dim, "miss");
  const crit = hits.some((h) => h.crit);
  return paint(p, crit ? C.yellow : C.red, `${crit ? "CRIT " : ""}-${dmg}`);
}

/** A row of damage numbers: what the hero took over the hero, what the foe
 *  took over the foe. Blank when nothing landed. */
function popRow(width: number, heroPop: string, foePop: string): string {
  const place = (center: number, text: string) => Math.max(0, Math.round(center - displayWidth(text) / 2));
  let row = "";
  if (heroPop) row += " ".repeat(place(width * 0.22, heroPop)) + heroPop;
  if (foePop) {
    const at = place(width * 0.75, foePop);
    row += " ".repeat(Math.max(1, at - displayWidth(row))) + foePop;
  }
  return row;
}

/** Attack animation for the latest turn's hits: each strike is a lunge
 *  (2 cells), an impact (4 cells + the damage number), and a step back.
 *  Every frame is the same height, so the TUI can swap them in place. */
export function animScenes(p: Paint, b: Battle, look: Look): string[] {
  const hits = b.hits ?? [];
  if (!hits.length) return [];
  const crown = !!b.foe.boss;
  const raw: string[] = [];
  const pops: string[] = [];
  for (const h of hits) {
    const side = h.by === "hero" ? "player" : "enemy";
    const atkEye = ">" as Eye;
    const hurt = (h.dmg > 0 ? "x" : undefined) as Eye | undefined;
    const pose = (cells: number, impact: boolean): ScenePose =>
      h.by === "hero"
        ? { pEye: atkEye, eEye: impact ? hurt : undefined, shift: { side, cells }, strike: impact }
        : { eEye: atkEye, pEye: impact ? hurt : undefined, shift: { side, cells }, strike: impact };
    const pop = popText(p, [h]);
    for (const [cells, impact] of [[2, false], [4, true], [2, false]] as const) {
      raw.push(composeScene(look, b.foe.species, crown, pose(cells, impact)));
      pops.push(impact ? (h.by === "hero" ? `|${pop}` : `${pop}|`) : "|");
    }
  }
  raw.push(composeScene(look, b.foe.species, crown, {}));
  pops.push("|");
  const trimmed = trimSharedBlankTopRows([raw])[0];
  return trimmed.map((f, i) => {
    const width = displayWidth(f.split("\n")[0] ?? "");
    const [heroPop, foePop] = pops[i].split("|");
    return `${popRow(width, heroPop, foePop)}\n${f}`;
  });
}

export function battleTitle(b: Battle): string {
  if (b.kind === "tower") return `🗼 Endless Tower · Floor ${b.floor}`;
  if (b.kind === "hunt") return "🐛 Bug Hunt";
  if (b.kind === "event") return "✦ Mimic!";
  const z = zoneById(b.zone);
  if (b.kind === "boss") return `♛ ${z?.name ?? "?"} · BOSS`;
  return `⚔ ${z?.name ?? "?"} · Floor ${b.floor}/${FLOORS_PER_ZONE}`;
}

/** The battle screen. `sceneOverride` swaps in one animation frame. */
export function battleScreen(
  p: Paint,
  b: Battle,
  look: Look,
  skills: readonly SkillId[],
  items: Partial<Record<ConsumableId, number>>,
  sceneOverride?: string,
): string {
  const body: string[] = [];
  let art = sceneOverride;
  if (art === undefined) {
    const s = scene(look, b.foe.species, !!b.foe.boss, false);
    const hits = b.hits ?? [];
    const width = displayWidth(s.split("\n")[0] ?? "");
    const pop = popRow(width, popText(p, hits.filter((h) => h.by === "foe")), popText(p, hits.filter((h) => h.by === "hero")));
    art = s ? `${pop}\n${s}` : "";
  }
  if (art) body.push(...art.split("\n"));
  const foeName = b.foe.boss ? paint(p, C.yellow, `♛ ${b.foe.name}`) : b.foe.name;
  const label = (t: string, w: number) => t + " ".repeat(Math.max(1, w - displayWidth(t)));
  const lw = Math.max(displayWidth(look.name), displayWidth(`${b.foe.boss ? "♛ " : ""}${b.foe.name} Lv${b.foe.level}`)) + 2;
  body.push(label(paint(p, C.bold, look.name), lw) + hpBar(p, b.hero.hp, b.hero.maxHp, 14));
  const intent = foeIntent(b);
  body.push(
    label(`${foeName} Lv${b.foe.level}`, lw) +
      hpBar(p, b.foe.hp, b.foe.maxHp, 14) +
      (intent ? `  ${paint(p, C.yellow, intent)}` : ""),
  );
  const status: string[] = [];
  if (b.hero.fx.poison) status.push("☠ poisoned");
  if (b.hero.fx.blind) status.push("◌ cursed aim");
  if (b.hero.fx.buff) status.push(`↑ATK ${b.hero.fx.buff}`);
  if (status.length) body.push(paint(p, C.magenta, status.join("  ")));
  body.push("");
  for (const l of b.log) body.push(paint(p, C.dim, "» ") + l);
  const out = panel(p, battleTitle(b), `Turn ${b.turn}`, body);
  return b.over ? out : `${out}\n${actionHints(p, b, skills, items)}`;
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
