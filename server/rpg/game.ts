/**
 * RPG command engine — one text command in, one text screen out. Shared by
 * the zero-token prompt hook (`;cmd` in Claude Code) and the `claude-buddy
 * play` TUI. Pure over its inputs: callers load/save state and apply the
 * returned buddy-XP side effect.
 */

import { hashString, mulberry32, type BuddyStats, type Species } from "../engine";
import { displayWidth } from "../art";
import {
  act,
  actionError,
  bossLevel,
  makeBoss,
  makeMonster,
  startBattle,
  towerFoe,
  type Action,
  type Battle,
} from "./battle";
import {
  BOSSES,
  CONSUMABLE_STACK,
  CONSUMABLES,
  COST_BOSS,
  COST_EXPLORE,
  COST_REST,
  COST_TOWER,
  ENERGY_MAX,
  FLOORS_PER_ZONE,
  FLOOR_WINS,
  GEAR_SLOTS,
  INVENTORY_CAP,
  KO_GOLD_LOSS,
  SKILLS,
  SPECIES_PASSIVES,
  TRAINABLE,
  UNIQUES,
  TRAIN_GAIN,
  ZONES,
  zoneById,
  type ConsumableId,
  type GearSlot,
  type SkillId,
  type TrainStat,
} from "./data";
import { gearScore, rollGear, sellValue, statLine, type GearItem } from "./gear";
import { deriveHero, trainCost, trainError, type HeroStats } from "./hero";
import {
  C,
  wrap,
  animScenes,
  battleScreen,
  buddySprite,
  panel,
  gearLine,
  gearName,
  hpBar,
  paint,
  bar,
  type Look,
  type Paint,
} from "./render";
import { currentHp, journal, nextEnergyIn, settle, settleEnergy, type RpgState } from "./store";
import { bountyReward, bountyText, dayKey, progress, syncDaily } from "./bounty";
import { EVENTS, EVENT_CHANCE, resolveEvent, rollEventId, type EventOutcome } from "./events";
import { ENDING, PROLOGUE, ZONE_ARRIVAL, fill } from "./story";
import { FORGE_CHANCE, FORGE_MAX, forgeCost, forgeError, strike } from "./forge";
import { FEATS, checkFeats, unlockedTitles } from "./feats";

/** The bug currently standing off on the status line (idle-RPG pending
 *  encounter), if any — `;hunt` fights its shadow. */
export interface Standoff {
  /** Stable per-standoff key (bugId:startedAt) — one hunt per standoff. */
  key: string;
  name: string;
  species: Species;
  tier: number;
  boss: boolean;
}

/** The companion-side inputs the RPG layers on top of. */
export interface BuddyCtx extends Look {
  level: number;
  prestige: number;
  stats: BuddyStats;
  standoff?: Standoff | null;
}

export interface CommandResult {
  out: string;
  /** Buddy XP earned this command (caller awards it via xp.ts). */
  xp: number;
  /** State was mutated and should be saved. */
  changed: boolean;
  /** Attack-animation screens to flash before `out` (only with `Paint.anim`). */
  anim?: string[];
}

/** Final tier: the Endless Tower unlocks once zone 6's boss falls. */
export const TOWER_UNLOCK = ZONES.length + 1;

export function heroOf(s: RpgState, ctx: BuddyCtx): HeroStats {
  return deriveHero(ctx.level, ctx.prestige, ctx.stats, s.training, equippedList(s), ctx.species);
}

function equippedList(s: RpgState): GearItem[] {
  return GEAR_SLOTS.map((k) => s.equipped[k]).filter((g): g is GearItem => !!g);
}

function nextSeed(s: RpgState, now: number): number {
  s.seq++;
  return hashString(`rpg:${s.seq}:${now}`);
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  "": "status",
  "?": "help",
  h: "help",
  c: "me",
  char: "me",
  stats: "me",
  hero: "me",
  e: "explore",
  x: "explore",
  fight: "explore",
  b: "boss",
  t: "tower",
  m: "map",
  zones: "map",
  go: "travel",
  zone: "travel",
  a: "attack",
  atk: "attack",
  d: "defend",
  def: "defend",
  guard: "defend",
  f: "flee",
  run: "flee",
  s: "skill",
  i: "item",
  use: "item",
  inv: "bag",
  inventory: "bag",
  g: "bag",
  gear: "bag",
  eq: "equip",
  wear: "equip",
  uneq: "unequip",
  remove: "unequip",
  r: "rest",
  l: "log",
  journal: "log",
  q: "daily",
  quests: "daily",
  bounty: "daily",
  bounties: "daily",
  bugs: "hunt",
  achievements: "feats",
  ach: "feats",
  titles: "title",
  smith: "forge",
  anvil: "forge",
};

export function parse(input: string): { cmd: string; args: string[] } {
  const body = input.trim().replace(/^;+/, "").trim().toLowerCase();
  const parts = body.split(/\s+/).filter(Boolean);
  let head = parts.shift() ?? "";
  // `;s2` → skill 2
  const sk = /^s(\d)$/.exec(head);
  if (sk) return { cmd: "skill", args: [sk[1], ...parts] };
  if (/^[12]$/.test(head)) return { cmd: "choose", args: [head] };
  head = ALIASES[head] ?? head;
  return { cmd: head, args: parts };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function execute(
  s: RpgState,
  ctx: BuddyCtx,
  input: string,
  now: number,
  p: Paint,
): CommandResult {
  const r = dispatch(s, ctx, input, now, p);
  const feats = checkFeats(s);
  if (feats.length) {
    r.out += `\n${paint(p, C.yellow, feats.join("\n"))}`;
    r.changed = true;
  }
  // First contact: the prologue opens the game, whatever was typed.
  if (!s.seen.includes(0)) {
    s.seen.push(0);
    r.out = `${paint(p, C.dim, fill(PROLOGUE, ctx.name))}\n\n${r.out}`;
    r.changed = true;
  }
  return r;
}

function dispatch(
  s: RpgState,
  ctx: BuddyCtx,
  input: string,
  now: number,
  p: Paint,
): CommandResult {
  const hero = heroOf(s, ctx);
  settle(s, now, hero.maxHp);
  const { cmd, args } = parse(input);
  const r: CommandResult = { out: "", xp: 0, changed: true };

  const inBattle = !!s.battle;
  const battleCmds = new Set(["attack", "defend", "flee", "skill"]);
  if (battleCmds.has(cmd) && !inBattle) {
    r.out = s.event
      ? `No foe here — decide first:\n${eventScreen(s, p)}`
      : "Not in a fight. ;x to explore, ;boss for the zone boss, ;help for commands.";
    r.changed = false;
    return r;
  }

  switch (cmd) {
    case "help":
      r.out = helpText(p);
      r.changed = false;
      return r;
    case "status":
      r.out = s.battle ? screen(s, ctx, p) : s.event ? eventScreen(s, p) : statusText(s, ctx, hero, now, p);
      return r;
    case "choose":
      return choose(s, ctx, hero, Number(args[0]) as 1 | 2, now, p, r);
    case "forge":
      return forge(s, ctx, args[0], now, p, r);
    case "title":
      return title(s, args[0], p, r);
    case "feats":
      r.out = featsText(s, p);
      r.changed = false;
      return r;
    case "story":
      r.out = fill(PROLOGUE, ctx.name);
      r.changed = false;
      return r;
    case "me":
      r.out = sheet(s, ctx, hero, now, p);
      return r;
    case "attack":
      return turn(s, ctx, { type: "attack" }, now, p, r);
    case "defend":
      return turn(s, ctx, { type: "defend" }, now, p, r);
    case "flee":
      return turn(s, ctx, { type: "flee" }, now, p, r);
    case "skill": {
      const id = resolveSkill(s, args[0]);
      if (!id) {
        r.out = `Pick a skill: ${s.skills.map((k, i) => `;s${i + 1} ${SKILLS[k].name}`).join("  ")}`;
        return r;
      }
      return turn(s, ctx, { type: "skill", id }, now, p, r);
    }
    case "item":
      return useItem(s, ctx, hero, args[0], now, p, r);
    case "explore":
      return startFight(s, ctx, hero, "explore", now, p, r);
    case "boss":
      return startFight(s, ctx, hero, "boss", now, p, r);
    case "tower":
      return startFight(s, ctx, hero, "tower", now, p, r);
    case "hunt":
      return startFight(s, ctx, hero, "hunt", now, p, r);
    case "daily":
      r.out = dailyText(s, now, p);
      return r;
    case "map":
      r.out = mapText(s, p);
      return r;
    case "travel":
      return travel(s, args[0], p, r);
    case "bag":
      r.out = bagText(s, p);
      return r;
    case "equip":
      return equip(s, ctx, args[0], p, r);
    case "unequip":
      return unequip(s, args[0], r);
    case "sell":
      return sell(s, args, p, r);
    case "lock":
      return lock(s, args[0], p, r);
    case "shop":
      r.out = shopText(s, now, p);
      return r;
    case "buy":
      return buy(s, args, now, p, r);
    case "train":
      return train(s, ctx, args[0], p, r);
    case "rest":
      return rest(s, hero, now, r);
    case "log":
      r.out = s.journal.length ? s.journal.join("\n") : "Nothing notable yet.";
      r.changed = false;
      return r;
    case "skills":
      r.out = skillsText(s, p);
      r.changed = false;
      return r;
    default:
      r.out = `Unknown command ";${cmd}". Try ;help`;
      r.changed = false;
      return r;
  }
}

// ─── Screens ────────────────────────────────────────────────────────────────

export function helpText(p: Paint): string {
  const h = (t: string) => paint(p, C.bold, t);
  return [
    h("Buddy Quest — commands (zero tokens: these never reach Claude)"),
    "  ;            status / current fight      ;me      character sheet",
    "  ;x           explore (fight next floor)   ;boss    zone boss",
    "  ;tower       endless tower (post-game)    ;map     zones · ;go <n> travel",
    "  ;hunt        fight the bug on your status line   ;daily  bounty board",
    "  ;1 / ;2      choose at an event (chests, shrines, strangers)   ;story",
    h("In a fight"),
    "  ;a attack  ;d defend  ;s1..;s7 skills  ;i <item>  ;f flee",
    h("Gear & town"),
    "  ;bag  ;equip <n>  ;unequip <slot>  ;sell <n|junk>  ;lock <n>",
    "  ;shop  ;buy <n> [qty]  ;train [atk|def|hp|spd|crit]  ;rest  ;skills  ;log",
    "  ;forge [slot|n]  enhance gear +1..+10   ;feats achievements   ;title [n] wear a title",
    "  ;hud on|off   status-line HUD     (or play full-screen: claude-buddy play)",
    paint(p, C.dim, "Coding fuels the game: commits restore ⚡ energy and pay gold; won bug fights pay a bounty."),
  ].join("\n");
}

function screen(s: RpgState, ctx: BuddyCtx, p: Paint): string {
  return s.battle ? battleScreen(p, s.battle, ctx, s.skills, s.items) : "";
}

function energyText(s: RpgState, now: number, p: Paint): string {
  const next = nextEnergyIn(s, now);
  return `${paint(p, C.yellow, `⚡ ${Math.floor(s.energy)}/${ENERGY_MAX}`)}${next ? paint(p, C.dim, ` (+1 in ${next}m)`) : ""}`;
}

function statusText(s: RpgState, ctx: BuddyCtx, hero: HeroStats, now: number, p: Paint): string {
  const z = zoneById(s.zone);
  const hp = currentHp(s, hero.maxHp);
  const floors = s.floors[String(s.zone)] ?? 0;
  const info: string[] = [
    paint(p, C.bold, ctx.name) + (s.title ? paint(p, C.magenta, ` «${s.title}»`) : "") + paint(p, C.dim, `  Power Lv${hero.level}`),
    hpBar(p, hp, hero.maxHp, 12),
    `${energyText(s, now, p)}   ${paint(p, C.yellow, `◎ ${s.gold}g`)}   ☕×${s.items.potion ?? 0}`,
  ];
  if (s.zone >= TOWER_UNLOCK) {
    info.push(`📍 Endless Tower  floor ${s.tower.floor} · best ${s.tower.best}  ;tower`);
  } else if (z) {
    const wins = s.floorWins[String(s.zone)] ?? 0;
    const next = floors >= FLOORS_PER_ZONE ? paint(p, C.yellow, "♛ boss ready ;boss") : `floor ${floors + 1} · ${wins}/${FLOOR_WINS} ;x`;
    info.push(`📍 ${z.name} ${paint(p, C.green, bar(floors, FLOORS_PER_ZONE, FLOORS_PER_ZONE))} ${next}`);
  }
  syncDaily(s, now);
  const done = s.daily.tasks.filter((b) => b.done).length;
  const extras = [`📜 bounties ${done}/${s.daily.tasks.length} ;daily`];
  if (s.blessing) extras.push(paint(p, C.magenta, `✨ ${s.blessing.name}`));
  info.push(extras.join("   "));
  if (ctx.standoff && s.hunted !== ctx.standoff.key) {
    info.push(paint(p, C.red, `🐛 ${ctx.standoff.name} is on your status line! ;hunt`));
  }
  // Sprite on the left, info on the right — the "town" screen.
  const sprite = buddySprite(ctx);
  const sw = sprite.reduce((m, l) => Math.max(m, displayWidth(l)), 0);
  const rows = Math.max(sprite.length, info.length);
  const top = Math.max(0, Math.floor((rows - sprite.length) / 2));
  const body: string[] = [];
  for (let i = 0; i < rows; i++) {
    const art = sprite[i - top] ?? "";
    body.push(`${paint(p, C.cyan, art + " ".repeat(sw - displayWidth(art)))}   ${info[i] ?? ""}`);
  }
  return panel(p, "✦ BUDDY QUEST", "", body, paint(p, C.dim, ";x explore · ;bag · ;shop · ;help"));
}

function dailyText(s: RpgState, now: number, p: Paint): string {
  syncDaily(s, now);
  const lines = [paint(p, C.bold, `📜 Bounty board — ${s.daily.day}`) + paint(p, C.dim, `  (+${bountyReward(s)}g ☕ each, all three: +🥤)`)];
  for (const b of s.daily.tasks) {
    const mark = b.done ? paint(p, C.green, "✓") : " ";
    lines.push(` ${mark} ${bountyText(b).padEnd(38)} ${b.progress}/${b.target}`);
  }
  if (s.daily.bonus) lines.push(paint(p, C.green, "Board cleared — new bounties tomorrow."));
  return lines.join("\n");
}

function sheet(s: RpgState, ctx: BuddyCtx, hero: HeroStats, now: number, p: Paint): string {
  const hp = currentHp(s, hero.maxHp);
  const lines = [
    paint(p, C.bold, `${ctx.name} the ${ctx.species}${s.title ? ` «${s.title}»` : ""} — Power Lv${hero.level}`) +
      paint(p, C.dim, ` (buddy Lv${ctx.level}${ctx.prestige ? ` · P${ctx.prestige}` : ""})`),
    `${hpBar(p, hp, hero.maxHp, 16)}   ${energyText(s, now, p)}   ${paint(p, C.yellow, `◎ ${s.gold}g`)}`,
    `ATK ${hero.atk}  DEF ${hero.def}  SPD ${hero.spd}  CRIT ${hero.crit}%` +
      (hero.leech ? `  LEECH ${hero.leech}%` : "") +
      (hero.gold ? `  GOLD +${hero.gold}%` : ""),
    paint(p, C.dim, `Training: ${TRAINABLE.map((k) => `${k.toUpperCase()} ${s.training[k] ?? 0}`).join(" · ")}`),
  ];
  for (const slot of GEAR_SLOTS) {
    const g = s.equipped[slot];
    lines.push(`${slot.padEnd(6)} ${g ? gearLine(p, g) : paint(p, C.dim, "—")}`);
  }
  const passive = SPECIES_PASSIVES[ctx.species];
  if (passive) lines.push(`Passive: ${paint(p, C.cyan, passive.name)} — ${passive.desc}`);
  if (hero.uniques.length) {
    lines.push(`Uniques: ${hero.uniques.map((u) => `${paint(p, C.yellow, UNIQUES[u].name)} (${UNIQUES[u].desc})`).join(", ")}`);
  }
  lines.push(`Skills: ${s.skills.map((k) => SKILLS[k].name).join(", ")}`);
  lines.push(
    paint(
      p,
      C.dim,
      `Bosses ${s.bossKills.length}/${ZONES.length} · kills ${s.stats.kills} · KOs ${s.stats.deaths} · tower best ${s.tower.best} · feats ${s.feats.length}/${FEATS.length}`,
    ),
  );
  return lines.join("\n");
}

function mapText(s: RpgState, p: Paint): string {
  const lines = [paint(p, C.bold, "World map  (;go <n> to travel)")];
  for (const z of ZONES) {
    const open = z.id <= s.unlocked;
    const f = s.floors[String(z.id)] ?? 0;
    const killed = s.bossKills.includes(z.boss);
    const here = s.zone === z.id ? "▶" : " ";
    const label = `${here}${z.id}. ${z.name.padEnd(17)} Lv${z.base}+`;
    lines.push(
      open
        ? `${label} [${bar(f, FLOORS_PER_ZONE, FLOORS_PER_ZONE)}] ${killed ? paint(p, C.green, `✓ ${BOSSES[z.boss].name}`) : paint(p, C.yellow, `♛ ${BOSSES[z.boss].name}`)}`
        : paint(p, C.dim, `${label} 🔒`),
    );
  }
  const towerOpen = s.unlocked >= TOWER_UNLOCK;
  lines.push(
    towerOpen
      ? `${s.zone >= TOWER_UNLOCK ? "▶" : " "}7. Endless Tower       best floor ${s.tower.best}`
      : paint(p, C.dim, " 7. Endless Tower       🔒"),
  );
  return lines.join("\n");
}

function skillsText(s: RpgState, p: Paint): string {
  return (Object.keys(SKILLS) as SkillId[])
    .map((id) => {
      const k = SKILLS[id];
      const idx = s.skills.indexOf(id);
      return idx >= 0
        ? `;s${idx + 1} ${k.name} — ${k.desc} (cd ${k.cooldown})`
        : paint(p, C.dim, `🔒 ${k.name} — ${k.desc}`);
    })
    .join("\n");
}

function bagText(s: RpgState, p: Paint): string {
  const lines = [paint(p, C.bold, `Bag ${s.bag.length}/${INVENTORY_CAP}`) + `   ◎ ${s.gold}g`];
  for (const slot of GEAR_SLOTS) {
    const g = s.equipped[slot];
    lines.push(`  ${slot.padEnd(6)} ${g ? gearLine(p, g) : paint(p, C.dim, "—")}`);
  }
  s.bag.forEach((g, i) => {
    const cur = s.equipped[g.slot];
    const delta = gearScore(g) - (cur ? gearScore(cur) : 0);
    const arrow = delta > 0 ? paint(p, C.green, `▲${delta}`) : delta < 0 ? paint(p, C.red, `▼${-delta}`) : "=";
    lines.push(`${String(i + 1).padStart(2)}. ${g.slot.padEnd(6)} ${gearLine(p, g)} ${arrow}`);
  });
  const cons = (Object.keys(CONSUMABLES) as ConsumableId[])
    .filter((id) => (s.items[id] ?? 0) > 0)
    .map((id) => `${CONSUMABLES[id].icon} ${id}×${s.items[id]}`);
  if (cons.length) lines.push(`Items: ${cons.join("  ")}`);
  if (!s.bag.length) lines.push(paint(p, C.dim, "  (no spare gear — monsters drop it)"));
  return lines.join("\n");
}

// ─── Fights ─────────────────────────────────────────────────────────────────

function startFight(
  s: RpgState,
  ctx: BuddyCtx,
  hero: HeroStats,
  kind: "explore" | "boss" | "tower" | "hunt",
  now: number,
  p: Paint,
  r: CommandResult,
): CommandResult {
  if (kind === "hunt") {
    const so = ctx.standoff;
    if (!so) {
      r.out = "No bug on your status line right now. They appear when Claude hits errors — then ;hunt it.";
      r.changed = false;
      return r;
    }
    if (s.hunted === so.key && !s.battle) {
      r.out = `You already squashed the ${so.name}'s shadow. Commit to banish the real one.`;
      r.changed = false;
      return r;
    }
  }
  if (s.battle) {
    r.out = "You're already in a fight!\n" + screen(s, ctx, p);
    return r;
  }
  if (s.event) {
    r.out = `Decide first:\n${eventScreen(s, p)}`;
    r.changed = false;
    return r;
  }
  const hp = currentHp(s, hero.maxHp);
  if (hp <= 0) {
    r.out = "You're knocked out. ;rest or drink coffee (;i potion) first.";
    return r;
  }
  if (kind === "tower" || (kind === "explore" && s.zone >= TOWER_UNLOCK)) {
    if (s.unlocked < TOWER_UNLOCK) {
      r.out = `The Endless Tower opens after defeating the ${BOSSES.segfault.name}.`;
      return r;
    }
    kind = "tower";
  }
  const cost = kind === "boss" ? COST_BOSS : kind === "tower" ? COST_TOWER : COST_EXPLORE; // hunt = explore cost
  if (s.energy < cost) {
    r.out = `Out of energy (${energyText(s, now, p)}). Commit some code or wait — commits restore ⚡.`;
    return r;
  }
  const seed = nextSeed(s, now);
  const rng = mulberry32(seed);
  let battle: Battle;
  if (kind === "tower") {
    const floor = s.tower.floor + 1;
    battle = startBattle("tower", 0, floor, hero, hp, towerFoe(floor, rng), seed);
  } else if (kind === "hunt") {
    const so = ctx.standoff!;
    const top = zoneById(Math.min(s.unlocked, ZONES.length))!;
    const level = top.base + 1 + so.tier;
    const foe = makeMonster(
      { id: `bug:${so.key}`, name: so.boss ? `Boss ${so.name}` : so.name, species: so.species,
        hp: (so.boss ? 2.4 : 1) + 0.15 * so.tier, atk: 1 + 0.05 * so.tier, def: 1, spd: 1.1 },
      level,
    );
    battle = startBattle("hunt", top.id, 0, hero, hp, foe, seed);
  } else {
    const z = zoneById(s.zone);
    if (!z) {
      r.out = "Unknown zone. ;map";
      return r;
    }
    const cleared = s.floors[String(z.id)] ?? 0;
    if (kind === "boss") {
      if (cleared < FLOORS_PER_ZONE) {
        r.out = `Clear all ${FLOORS_PER_ZONE} floors first (${cleared}/${FLOORS_PER_ZONE}). ;x`;
        return r;
      }
      battle = startBattle("boss", z.id, FLOORS_PER_ZONE + 1, hero, hp, makeBoss(z.boss, bossLevel(z)), seed);
    } else {
      const floor = Math.min(cleared + 1, FLOORS_PER_ZONE);
      const arrival = arrive(s, z.id, p);
      // Some floors open on a room event instead of a monster. Events are
      // free (no energy) and never twice in a row.
      if (!s.lastEvent && rng() < EVENT_CHANCE) {
        s.lastEvent = true;
        s.event = { id: rollEventId(rng), zone: z.id, level: z.base + floor - 1, seed };
        r.out = [arrival, eventScreen(s, p)].filter(Boolean).join("\n\n");
        return r;
      }
      s.lastEvent = false;
      const def = z.monsters[Math.floor(rng() * z.monsters.length)];
      const foe = makeMonster(def, z.base + floor - 1);
      // The last win on an uncleared floor is its guardian: tougher, named.
      const guardian = cleared < FLOORS_PER_ZONE && (s.floorWins[String(z.id)] ?? 0) >= FLOOR_WINS - 1;
      if (guardian) {
        foe.name = `Guardian ${foe.name}`;
        foe.hp = foe.maxHp = Math.round(foe.maxHp * 1.6);
        foe.atk = Math.round(foe.atk * 1.15);
      }
      battle = startBattle("explore", z.id, floor, hero, hp, foe, seed);
      if (guardian) {
        battle.guardian = true;
        battle.log.push(`🛡  The floor ${floor} guardian blocks the stairs down!`);
      }
      if (arrival) battle.log.unshift(arrival);
    }
  }
  s.energy -= cost;
  bless(s, battle);
  s.battle = battle;
  s.stats.battles++;
  r.out = screen(s, ctx, p);
  return r;
}

/** Zone arrival text, once per zone. */
function arrive(s: RpgState, zone: number, p: Paint): string {
  if (s.seen.includes(zone)) return "";
  s.seen.push(zone);
  const t = ZONE_ARRIVAL[zone];
  return t ? paint(p, C.cyan, `📍 ${t}`) : "";
}

/** Apply an active blessing to a fresh battle. */
function bless(s: RpgState, b: Battle): void {
  const bl = s.blessing;
  if (!bl) return;
  if (bl.stat === "atk") b.hero.atk = Math.round(b.hero.atk * (1 + bl.amount / 100));
  if (bl.stat === "def") b.hero.def = Math.round(b.hero.def * (1 + bl.amount / 100));
  if (bl.stat === "crit") b.hero.crit = Math.min(75, b.hero.crit + bl.amount);
  b.log.push(`✨ Blessed: ${bl.name} (${bl.fights} fight${bl.fights === 1 ? "" : "s"} left)`);
}

// ─── Events ─────────────────────────────────────────────────────────────────


export function eventScreen(s: RpgState, p: Paint): string {
  const ev = s.event;
  if (!ev) return "";
  const def = EVENTS[ev.id];
  const body = [...def.art.map((l) => paint(p, C.yellow, `   ${l}`)), "", ...wrap(def.text, 54)];
  return `${panel(p, `✦ ${def.title}`, "", body)}\n${paint(p, C.cyan, `;1 ${def.options[0]}    ;2 ${def.options[1]}`)}`;
}

function choose(
  s: RpgState,
  ctx: BuddyCtx,
  hero: HeroStats,
  option: 1 | 2,
  now: number,
  p: Paint,
  r: CommandResult,
): CommandResult {
  const ev = s.event;
  if (!ev) {
    r.out = "Nothing to choose right now.";
    r.changed = false;
    return r;
  }
  const rng = mulberry32((ev.seed ^ (option * 0x5bd1e995)) >>> 0);
  const out = resolveEvent(ev, option, rng, { gold: s.gold, potions: s.items.potion ?? 0 });
  if (out.blocked) {
    r.out = `${out.text}\n${eventScreen(s, p)}`;
    r.changed = false;
    return r;
  }
  s.event = null;
  s.stats.events = (s.stats.events ?? 0) + 1;
  const lines = [out.text, ...applyOutcome(s, hero, ev.level, out, now, p, r)];
  if (out.mimic) {
    const foe = makeMonster(
      { id: "mimic", name: "Mimic Chest", species: "robot", hp: 1.3, atk: 1.15, def: 1.1, spd: 0.9, move: "double" },
      ev.level + 1,
    );
    const b = startBattle("event", ev.zone, 0, hero, currentHp(s, hero.maxHp), foe, nextSeed(s, now));
    bless(s, b);
    s.battle = b;
    s.stats.battles++;
    lines.push(screen(s, ctx, p));
  } else {
    lines.push(paint(p, C.dim, ";x to press on"));
  }
  r.out = lines.join("\n");
  return r;
}

function applyOutcome(
  s: RpgState,
  hero: HeroStats,
  level: number,
  o: EventOutcome,
  now: number,
  p: Paint,
  r: CommandResult,
): string[] {
  const lines: string[] = [];
  if (o.cost?.gold) s.gold -= o.cost.gold;
  if (o.cost?.item) s.items[o.cost.item] = Math.max(0, (s.items[o.cost.item] ?? 0) - 1);
  if (o.gold) {
    s.gold += o.gold;
    s.stats.goldEarned += o.gold;
    lines.push(paint(p, C.yellow, `+${o.gold}g`));
    lines.push(...progress(s, "gold", o.gold, now));
  }
  const hp = currentHp(s, hero.maxHp);
  if (o.fullHeal) s.hp = null;
  if (o.hpPct) {
    const next = Math.max(1, Math.min(hero.maxHp, hp + Math.round(hero.maxHp * o.hpPct)));
    s.hp = next >= hero.maxHp ? null : next;
    lines.push(hpBar(p, next, hero.maxHp));
  }
  s.hpAt = now;
  if (o.item) {
    s.items[o.item] = Math.min(CONSUMABLE_STACK, (s.items[o.item] ?? 0) + 1);
    lines.push(`${CONSUMABLES[o.item].icon} +1 ${CONSUMABLES[o.item].name}`);
  }
  if (o.gear) {
    const rng = mulberry32(nextSeed(s, now));
    lines.push(addToBag(s, rollGear(rng, level, s.nextUid++, { luck: o.gear.luck, floor: o.gear.floor }), p));
  }
  if (o.blessing) {
    s.blessing = { ...o.blessing };
    lines.push(paint(p, C.magenta, `✨ ${o.blessing.name} for your next ${o.blessing.fights} fights`));
  }
  if (o.xp) {
    r.xp += o.xp;
    lines.push(paint(p, C.dim, `+${o.xp} buddy XP`));
  }
  return lines;
}

function resolveSkill(s: RpgState, arg: string | undefined): SkillId | null {
  if (!arg) return null;
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= s.skills.length) return s.skills[n - 1];
  const hit = s.skills.find((k) => k === arg || SKILLS[k].name.toLowerCase().replace(/\s+/g, "").startsWith(arg));
  return hit ?? null;
}

function resolveItem(arg: string | undefined): ConsumableId | null {
  if (!arg) return null;
  const ids = Object.keys(CONSUMABLES) as ConsumableId[];
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= ids.length) return ids[n - 1];
  return (
    ids.find((k) => k === arg || CONSUMABLES[k].name.toLowerCase().startsWith(arg)) ??
    (arg === "coffee" ? "potion" : null)
  );
}

function useItem(
  s: RpgState,
  ctx: BuddyCtx,
  hero: HeroStats,
  arg: string | undefined,
  now: number,
  p: Paint,
  r: CommandResult,
): CommandResult {
  const id = resolveItem(arg);
  if (!id) {
    r.out = `Use which item? ${(Object.keys(CONSUMABLES) as ConsumableId[]).map((k) => `${k}×${s.items[k] ?? 0}`).join("  ")}`;
    r.changed = false;
    return r;
  }
  if ((s.items[id] ?? 0) <= 0) {
    r.out = `No ${CONSUMABLES[id].name} left. ;shop`;
    r.changed = false;
    return r;
  }
  if (s.battle) return turn(s, ctx, { type: "item", id }, now, p, r);
  // Out of combat: only healing items make sense.
  const hp = currentHp(s, hero.maxHp);
  if (id === "potion" || id === "elixir") {
    if (hp >= hero.maxHp) {
      r.out = "Already at full HP.";
      r.changed = false;
      return r;
    }
    const heal = id === "elixir" ? hero.maxHp : Math.round(hero.maxHp * 0.4);
    const next = Math.min(hero.maxHp, hp + heal);
    s.items[id] = (s.items[id] ?? 0) - 1;
    s.hp = next >= hero.maxHp ? null : next;
    s.hpAt = now;
    r.out = `${CONSUMABLES[id].icon} ${hpBar(p, next, hero.maxHp)}`;
    return r;
  }
  r.out = `${CONSUMABLES[id].name} only works in a fight.`;
  r.changed = false;
  return r;
}

function turn(
  s: RpgState,
  ctx: BuddyCtx,
  a: Action,
  now: number,
  p: Paint,
  r: CommandResult,
): CommandResult {
  const b = s.battle!;
  if (a.type === "skill" && !s.skills.includes(a.id)) {
    r.out = "You haven't learned that skill.";
    r.changed = false;
    return r;
  }
  const err = actionError(b, a);
  if (err) {
    r.out = `${err}\n${screen(s, ctx, p)}`;
    r.changed = false;
    return r;
  }
  if (a.type === "item") s.items[a.id] = Math.max(0, (s.items[a.id] ?? 0) - 1);
  const next = act(b, a);
  s.battle = next;
  if (p.anim) {
    r.anim = animScenes(p, next, ctx).map((sc) => battleScreen(p, next, ctx, s.skills, s.items, sc));
  }
  const news = a.type === "skill" ? progress(s, "skills", 1, now) : [];
  if (!next.over) {
    r.out = [screen(s, ctx, p), ...news].join("\n");
    return r;
  }
  if (news.length) next.log.push(...news);
  const out = battleScreen(p, next, ctx, s.skills, s.items);
  const tail = conclude(s, next, ctx, now, p, r);
  r.out = `${out}\n${tail}`;
  return r;
}

/** Settle a finished battle: rewards, progress, drops, KO penalties. */
function conclude(
  s: RpgState,
  b: Battle,
  ctx: BuddyCtx,
  now: number,
  p: Paint,
  r: CommandResult,
): string {
  s.battle = null;
  s.hpAt = now;
  const hero = heroOf(s, ctx);
  const lines: string[] = [];
  if (s.blessing && --s.blessing.fights <= 0) {
    lines.push(paint(p, C.dim, `Your blessing (${s.blessing.name}) fades.`));
    s.blessing = null;
  }

  if (b.over === "lose") {
    const lost = Math.floor(s.gold * KO_GOLD_LOSS);
    s.gold -= lost;
    s.hp = Math.max(1, Math.round(hero.maxHp * 0.25));
    s.stats.deaths++;
    if (b.kind === "tower") s.tower.floor = 0;
    lines.push(paint(p, C.red, `💀 Knocked out! Dropped ${lost}g. You limp back to camp.`));
    if (b.kind === "tower") lines.push("Tower run reset to floor 1.");
    lines.push(paint(p, C.dim, "Tip: ;train, upgrade gear (;bag / ;shop), or ;rest before retrying."));
    return lines.join("\n");
  }

  s.hp = b.hero.hp >= hero.maxHp ? null : b.hero.hp;
  if (b.over === "fled") {
    if (b.kind === "tower") {
      s.tower.floor = 0;
      lines.push("You left the tower. The run resets.");
    }
    return lines.join("\n");
  }

  // ── Win ──
  const L = b.foe.level;
  const isBoss = !!b.foe.boss;
  const rng = mulberry32(nextSeed(s, now));
  let gold = Math.round((4 + 2 * L) * (0.85 + rng() * 0.3) * (isBoss ? 6 : 1) * (b.kind === "tower" ? 1.5 : 1));
  gold = Math.round(gold * (1 + hero.gold / 100) * (hero.uniques.includes("midas") ? 1.5 : 1) * (b.kind === "hunt" || b.kind === "event" ? 2 : 1));
  s.gold += gold;
  s.stats.goldEarned += gold;
  s.stats.kills++;
  r.xp += isBoss ? 25 + 3 * L : 2 + Math.floor(L / 2);
  lines.push(paint(p, C.yellow, `🏆 Victory! +${gold}g`) + paint(p, C.dim, `  +${r.xp} buddy XP`));
  const bounties = [
    ...progress(s, "kills", 1, now),
    ...progress(s, "gold", gold, now),
    ...(b.hero.hp >= b.hero.maxHp / 2 ? progress(s, "flawless", 1, now) : []),
    ...(isBoss ? progress(s, "boss", 1, now) : []),
    ...(b.kind === "hunt" ? progress(s, "hunt", 1, now) : []),
  ];

  let dropChance = 0.28;
  let floorRarity: GearItem["rarity"] | undefined;
  let luck = 0.04 * Math.min(6, b.zone || 6);

  if (b.kind === "explore") {
    const key = String(b.zone);
    const cleared = s.floors[key] ?? 0;
    if (b.floor > cleared && b.guardian) {
      s.floors[key] = b.floor;
      s.floorWins[key] = 0;
      dropChance = 0.5;
      lines.push(
        b.floor >= FLOORS_PER_ZONE
          ? paint(p, C.magenta, `Floor ${b.floor} cleared — the boss awaits! ;boss`)
          : paint(p, C.green, `Floor ${b.floor} cleared! The stairs lead down. ;x for floor ${b.floor + 1}`),
      );
    } else if (b.floor > cleared) {
      const wins = (s.floorWins[key] ?? 0) + 1;
      s.floorWins[key] = wins;
      lines.push(
        wins >= FLOOR_WINS - 1
          ? paint(p, C.yellow, `Floor ${b.floor} · ${wins}/${FLOOR_WINS} — the guardian stirs. ;x`)
          : `Floor ${b.floor} · ${wins}/${FLOOR_WINS}. ;x`,
      );
    } else if (b.floor >= FLOORS_PER_ZONE) dropChance = 0.35;
  } else if (b.kind === "boss") {
    s.stats.bosses++;
    dropChance = 1;
    const first = !s.bossKills.includes(b.foe.boss!);
    floorRarity = first ? "rare" : "uncommon";
    luck += first ? 0.3 : 0.1;
    if (first) {
      s.bossKills.push(b.foe.boss!);
      const def = BOSSES[b.foe.boss!];
      s.unlocked = Math.max(s.unlocked, b.zone + 1);
      lines.push(paint(p, C.magenta, `👑 ${def.name} defeated for the first time! Title: "${def.title}"`));
      journal(s, `Defeated ${def.name}`);
      if (def.unlocks && !s.skills.includes(def.unlocks)) {
        s.skills.push(def.unlocks);
        lines.push(paint(p, C.cyan, `✨ New skill: ${SKILLS[def.unlocks].name} — ${SKILLS[def.unlocks].desc} (;s${s.skills.length})`));
      }
      const nz = zoneById(b.zone + 1);
      lines.push(nz ? `🗺  ${nz.name} unlocked! ;go ${nz.id}` : "🗼 The Endless Tower is open! ;tower");
      if (!nz) lines.push("", paint(p, C.magenta, fill(ENDING, ctx.name)));
      s.items.potion = Math.min(CONSUMABLE_STACK, (s.items.potion ?? 0) + 2);
    }
  } else if (b.kind === "event") {
    dropChance = 1;
    luck += 0.2;
    lines.push("The mimic coughs up its hoard.");
  } else if (b.kind === "hunt") {
    if (ctx.standoff) s.hunted = ctx.standoff.key;
    s.stats.hunts = (s.stats.hunts ?? 0) + 1;
    dropChance = 0.6;
    luck += 0.15;
    lines.push(paint(p, C.green, "🐛 Bug squashed (in spirit). The real one still needs a commit to banish."));
    journal(s, `Hunted a ${b.foe.name}`);
  } else {
    s.tower.floor = b.floor;
    if (b.floor > s.tower.best) {
      s.tower.best = b.floor;
      if (b.floor % 5 === 0) journal(s, `Tower: reached floor ${b.floor}`);
    }
    dropChance = isBoss ? 1 : b.floor % 5 === 0 ? 0.7 : 0.35;
    floorRarity = isBoss ? "epic" : undefined;
    luck = Math.min(0.8, 0.3 + b.floor * 0.01);
    lines.push(`Tower floor ${b.floor} cleared (best ${s.tower.best}). ;tower to climb`);
  }

  if (rng() < dropChance) {
    const g = rollGear(rng, L, s.nextUid++, { luck, floor: floorRarity });
    lines.push(addToBag(s, g, p));
    if (g.rarity === "epic" || g.rarity === "legendary") journal(s, `Found ${g.name} (${g.rarity})`);
  }
  if (rng() < 0.12) {
    s.items.potion = Math.min(CONSUMABLE_STACK, (s.items.potion ?? 0) + 1);
    lines.push("☕ Found a Coffee.");
  }
  lines.push(...bounties);
  return lines.join("\n");
}

function addToBag(s: RpgState, g: GearItem, p: Paint): string {
  if (s.bag.length >= INVENTORY_CAP) {
    const v = sellValue(g);
    s.gold += v;
    return `🎁 ${gearName(p, g)} — bag full, auto-sold for ${v}g.`;
  }
  s.bag.push(g);
  const cur = s.equipped[g.slot];
  const delta = gearScore(g) - (cur ? gearScore(cur) : 0);
  const hint = delta > 0 ? paint(p, C.green, ` ▲ upgrade! ;equip ${s.bag.length}`) : "";
  return `🎁 Loot: ${gearLine(p, g)}${hint}`;
}

// ─── Town ───────────────────────────────────────────────────────────────────

function travel(s: RpgState, arg: string | undefined, p: Paint, r: CommandResult): CommandResult {
  if (s.battle) {
    r.out = "Finish the fight first.";
    r.changed = false;
    return r;
  }
  const n = arg === "tower" ? TOWER_UNLOCK : Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > TOWER_UNLOCK) {
    r.out = "Travel where? ;go <1-7>  (;map)";
    r.changed = false;
    return r;
  }
  if (n > s.unlocked) {
    r.out = "That zone is still locked — beat the previous boss.";
    r.changed = false;
    return r;
  }
  s.zone = n;
  const arrival = arrive(s, n, p);
  r.out = (n >= TOWER_UNLOCK ? "🗼 You stand before the Endless Tower. ;tower" : `🗺  Travelled to ${zoneById(n)!.name}. ;x to explore`) + (arrival ? `\n${arrival}` : "");
  return r;
}

function bagIndex(s: RpgState, arg: string | undefined): number {
  const n = Number(arg);
  return Number.isInteger(n) && n >= 1 && n <= s.bag.length ? n - 1 : -1;
}

function equip(s: RpgState, ctx: BuddyCtx, arg: string | undefined, p: Paint, r: CommandResult): CommandResult {
  if (s.battle) {
    r.out = "No changing gear mid-fight!";
    r.changed = false;
    return r;
  }
  const i = bagIndex(s, arg);
  if (i < 0) {
    r.out = "Equip which? ;equip <n> (see ;bag)";
    r.changed = false;
    return r;
  }
  const before = heroOf(s, ctx);
  const g = s.bag.splice(i, 1)[0];
  const prev = s.equipped[g.slot];
  s.equipped[g.slot] = g;
  if (prev) s.bag.splice(i, 0, prev);
  const after = heroOf(s, ctx);
  // Keep the HP ratio sane when max HP shifts.
  if (s.hp !== null) s.hp = Math.min(s.hp, after.maxHp);
  const diff = (["atk", "def", "maxHp", "spd", "crit"] as const)
    .map((k) => {
      const d = after[k] - before[k];
      return d ? `${k === "maxHp" ? "HP" : k.toUpperCase()} ${d > 0 ? "+" : ""}${d}` : "";
    })
    .filter(Boolean)
    .join(", ");
  r.out = `Equipped ${gearName(p, g)}${diff ? ` (${diff})` : ""}${prev ? `. ${gearName(p, prev)} → bag` : ""}`;
  return r;
}

function unequip(s: RpgState, arg: string | undefined, r: CommandResult): CommandResult {
  const slot = GEAR_SLOTS.find((k) => k === arg) as GearSlot | undefined;
  if (!slot || !s.equipped[slot]) {
    r.out = `Unequip which slot? ${GEAR_SLOTS.join(" | ")}`;
    r.changed = false;
    return r;
  }
  if (s.bag.length >= INVENTORY_CAP) {
    r.out = "Bag is full.";
    r.changed = false;
    return r;
  }
  s.bag.push(s.equipped[slot]!);
  delete s.equipped[slot];
  r.out = `Unequipped your ${slot}.`;
  return r;
}

function sell(s: RpgState, args: string[], p: Paint, r: CommandResult): CommandResult {
  if (!args.length) {
    r.out = "Sell what? ;sell <n> [n...] | ;sell junk (common+uncommon) | ;sell all";
    r.changed = false;
    return r;
  }
  let picks: number[];
  if (args[0] === "junk") {
    picks = s.bag.flatMap((g, i) => (!g.locked && (g.rarity === "common" || g.rarity === "uncommon") ? [i] : []));
  } else if (args[0] === "all") {
    picks = s.bag.flatMap((g, i) => (g.locked ? [] : [i]));
  } else {
    picks = [...new Set(args.map((a) => bagIndex(s, a)).filter((i) => i >= 0))];
  }
  const sold = picks.filter((i) => !s.bag[i].locked).sort((a, b) => b - a);
  if (!sold.length) {
    r.out = "Nothing to sell (locked items are kept).";
    r.changed = false;
    return r;
  }
  let total = 0;
  for (const i of sold) {
    total += sellValue(s.bag[i]);
    s.bag.splice(i, 1);
  }
  s.gold += total;
  r.out = `Sold ${plural(sold.length, "item")} for ${paint(p, C.yellow, `${total}g`)} (◎ ${s.gold}g).`;
  return r;
}

function lock(s: RpgState, arg: string | undefined, p: Paint, r: CommandResult): CommandResult {
  const i = bagIndex(s, arg);
  if (i < 0) {
    r.out = "Lock which? ;lock <n> (locked gear is never sold)";
    r.changed = false;
    return r;
  }
  s.bag[i].locked = !s.bag[i].locked;
  r.out = `${gearName(p, s.bag[i])} ${s.bag[i].locked ? "locked" : "unlocked"}.`;
  return r;
}

// ─── Shop ───────────────────────────────────────────────────────────────────

/** Today's gear stock: three day-seeded items scaled to your best zone. */
export function shopStock(s: RpgState, now: number): GearItem[] {
  const day = dayKey(now);
  const top = Math.min(s.unlocked, ZONES.length);
  const ilvl = zoneById(top)!.base + 3;
  const rng = mulberry32(hashString(`shop:${day}:${top}`));
  return [0, 1, 2].map((i) =>
    rollGear(rng, ilvl, -1 - i, { slot: GEAR_SLOTS[i], floor: "uncommon", luck: 0.2 }),
  );
}

function shopPrice(g: GearItem): number {
  return sellValue(g) * 4;
}

function syncShopDay(s: RpgState, now: number): void {
  const day = dayKey(now);
  if (s.shop.day !== day) s.shop = { day, bought: [] };
}

function shopText(s: RpgState, now: number, p: Paint): string {
  syncShopDay(s, now);
  const ids = Object.keys(CONSUMABLES) as ConsumableId[];
  const lines = [paint(p, C.bold, "🏪 Merchant") + `   ◎ ${s.gold}g   (;buy <n> [qty])`];
  ids.forEach((id, i) => {
    const c = CONSUMABLES[id];
    lines.push(`${i + 1}. ${c.icon} ${c.name.padEnd(13)} ${String(c.price).padStart(4)}g  ${paint(p, C.dim, `${c.desc} · have ${s.items[id] ?? 0}`)}`);
  });
  lines.push(paint(p, C.dim, "— today's gear —"));
  shopStock(s, now).forEach((g, i) => {
    const n = ids.length + i + 1;
    const sold = s.shop.bought.includes(i);
    lines.push(
      sold
        ? paint(p, C.dim, `${n}. (sold out)`)
        : `${n}. ${gearLine(p, g)}  ${paint(p, C.yellow, `${shopPrice(g)}g`)}`,
    );
  });
  return lines.join("\n");
}

function buy(s: RpgState, args: string[], now: number, p: Paint, r: CommandResult): CommandResult {
  if (s.battle) {
    r.out = "The merchant won't trade mid-fight.";
    r.changed = false;
    return r;
  }
  syncShopDay(s, now);
  const ids = Object.keys(CONSUMABLES) as ConsumableId[];
  const n = Number(args[0]);
  const byName = resolveItem(args[0]);
  const qty = Math.max(1, Math.min(CONSUMABLE_STACK, Math.floor(Number(args[1]) || 1)));
  if (byName || (Number.isInteger(n) && n >= 1 && n <= ids.length)) {
    const id = byName ?? ids[n - 1];
    const c = CONSUMABLES[id];
    const room = CONSUMABLE_STACK - (s.items[id] ?? 0);
    const q = Math.min(qty, room);
    if (q <= 0) {
      r.out = `You can't carry more ${c.name} (max ${CONSUMABLE_STACK}).`;
      r.changed = false;
      return r;
    }
    if (s.gold < c.price * q) {
      r.out = `Need ${c.price * q}g (have ${s.gold}g).`;
      r.changed = false;
      return r;
    }
    s.gold -= c.price * q;
    s.items[id] = (s.items[id] ?? 0) + q;
    r.out = `Bought ${q}× ${c.icon} ${c.name}. ◎ ${s.gold}g`;
    return r;
  }
  const gi = n - ids.length - 1;
  const stock = shopStock(s, now);
  if (!Number.isInteger(gi) || gi < 0 || gi >= stock.length) {
    r.out = "Buy what? ;shop to browse, then ;buy <n>";
    r.changed = false;
    return r;
  }
  if (s.shop.bought.includes(gi)) {
    r.out = "Sold out — new stock tomorrow.";
    r.changed = false;
    return r;
  }
  const g = { ...stock[gi], uid: s.nextUid++ };
  const price = shopPrice(g);
  if (s.gold < price) {
    r.out = `Need ${price}g (have ${s.gold}g).`;
    r.changed = false;
    return r;
  }
  if (s.bag.length >= INVENTORY_CAP) {
    r.out = "Bag is full — ;sell something first.";
    r.changed = false;
    return r;
  }
  s.gold -= price;
  s.shop.bought.push(gi);
  s.bag.push(g);
  r.out = `Bought ${gearName(p, g)} (${statLine(g.stats)}). ;equip ${s.bag.length}`;
  return r;
}

// ─── Forge, feats & titles ──────────────────────────────────────────────────

/** Resolve a forge target: an equipped slot name, or a bag index. */
function forgeTarget(s: RpgState, arg: string | undefined): GearItem | null {
  const slot = GEAR_SLOTS.find((k) => k === arg);
  if (slot) return s.equipped[slot] ?? null;
  const i = bagIndex(s, arg);
  return i >= 0 ? s.bag[i] : null;
}

function forge(s: RpgState, ctx: BuddyCtx, arg: string | undefined, now: number, p: Paint, r: CommandResult): CommandResult {
  if (s.battle) {
    r.out = "The forge is back in town — finish the fight first.";
    r.changed = false;
    return r;
  }
  if (!arg) {
    const lines = [paint(p, C.bold, "⚒  The Forge") + `   ◎ ${s.gold}g   (;forge <weapon|armor|charm|bag n>)`];
    for (const slot of GEAR_SLOTS) {
      const g = s.equipped[slot];
      if (!g) {
        lines.push(`  ${slot.padEnd(6)} ${paint(p, C.dim, "—")}`);
        continue;
      }
      const n = g.plus ?? 0;
      const next = n >= FORGE_MAX ? paint(p, C.green, "MAX") : `→ +${n + 1}  ${forgeCost(g)}g  ${Math.round(FORGE_CHANCE[n] * 100)}%`;
      lines.push(`  ${slot.padEnd(6)} ${gearName(p, g)}  ${next}`);
    }
    lines.push(paint(p, C.dim, "Each + is +10% to every stat. Safe to +5; beyond that a failed strike costs only the gold."));
    r.out = lines.join("\n");
    r.changed = false;
    return r;
  }
  const g = forgeTarget(s, arg);
  if (!g) {
    r.out = "Forge what? ;forge weapon | armor | charm | <bag n>";
    r.changed = false;
    return r;
  }
  const err = forgeError(g, s.gold);
  if (err) {
    r.out = err;
    r.changed = false;
    return r;
  }
  const before = heroOf(s, ctx);
  s.gold -= forgeCost(g);
  const ok = strike(g, mulberry32(nextSeed(s, now)));
  if (!ok) {
    r.out = paint(p, C.red, `🔨 CLANG... the strike goes wrong. ${gearName(p, g)} is unharmed, but the gold is gone. ◎ ${s.gold}g`);
    return r;
  }
  const after = heroOf(s, ctx);
  const diff = (["atk", "def", "maxHp", "spd", "crit"] as const)
    .map((k) => (after[k] - before[k] ? `${k === "maxHp" ? "HP" : k.toUpperCase()} +${after[k] - before[k]}` : ""))
    .filter(Boolean)
    .join(", ");
  if ((g.plus ?? 0) >= FORGE_MAX) journal(s, `Forged ${g.name} to +${FORGE_MAX}`);
  r.out = `${paint(p, C.yellow, "🔨 CLANG! ✨")} ${gearName(p, g)}${diff ? ` (${diff})` : ""}  ◎ ${s.gold}g`;
  return r;
}

function featsText(s: RpgState, p: Paint): string {
  const lines = [paint(p, C.bold, `🏆 Achievements ${s.feats.length}/${FEATS.length}`)];
  for (const f of FEATS) {
    const got = s.feats.includes(f.id);
    const t = f.title ? ` «${f.title}»` : "";
    lines.push(got ? `${paint(p, C.green, "✓")} ${f.name}${t}` : paint(p, C.dim, `· ${f.name} — ${f.desc}${t}`));
  }
  return lines.join("\n");
}

function title(s: RpgState, arg: string | undefined, p: Paint, r: CommandResult): CommandResult {
  const titles = unlockedTitles(s);
  if (!arg) {
    r.out = titles.length
      ? [paint(p, C.bold, "Titles") + "  (;title <n> | ;title none)", ...titles.map((t, i) => `${i + 1}. ${t}${s.title === t ? "  ← worn" : ""}`)].join("\n")
      : "No titles yet — earn them from bosses and achievements (;feats).";
    r.changed = false;
    return r;
  }
  if (arg === "none") {
    s.title = null;
    r.out = "Title removed.";
    return r;
  }
  const t = titles[Number(arg) - 1];
  if (!t) {
    r.out = "No such title. ;title to list yours.";
    r.changed = false;
    return r;
  }
  s.title = t;
  r.out = `You are now known as «${t}».`;
  return r;
}

// ─── Training & rest ────────────────────────────────────────────────────────

function train(s: RpgState, ctx: BuddyCtx, arg: string | undefined, p: Paint, r: CommandResult): CommandResult {
  if (!arg) {
    const lines = [paint(p, C.bold, "🏋 Training hall") + `   ◎ ${s.gold}g   (;train <stat>)`];
    for (const k of TRAINABLE) {
      const rank = s.training[k] ?? 0;
      lines.push(`  ${k.padEnd(4)} rank ${String(rank).padStart(2)}  +${TRAIN_GAIN[k]}${k === "crit" ? "%" : ""}/rank  next ${trainCost(rank)}g`);
    }
    r.out = lines.join("\n");
    r.changed = false;
    return r;
  }
  const err = trainError(s.training, arg, s.gold);
  if (err) {
    r.out = err;
    r.changed = false;
    return r;
  }
  const k = arg as TrainStat;
  const rank = s.training[k] ?? 0;
  s.gold -= trainCost(rank);
  s.training[k] = rank + 1;
  const hero = heroOf(s, ctx);
  r.out = `💪 ${k.toUpperCase()} trained to rank ${rank + 1}. ATK ${hero.atk} DEF ${hero.def} HP ${hero.maxHp} SPD ${hero.spd} CRIT ${hero.crit}%  ◎ ${s.gold}g`;
  return r;
}

function rest(s: RpgState, hero: HeroStats, now: number, r: CommandResult): CommandResult {
  if (s.battle) {
    r.out = "Can't rest mid-fight!";
    r.changed = false;
    return r;
  }
  if (currentHp(s, hero.maxHp) >= hero.maxHp) {
    r.out = "Already at full HP (HP also regenerates 5%/min on its own).";
    r.changed = false;
    return r;
  }
  if (s.energy < COST_REST) {
    r.out = `Resting costs ${COST_REST}⚡. HP regenerates 5%/min on its own.`;
    r.changed = false;
    return r;
  }
  s.energy -= COST_REST;
  s.hp = null;
  s.hpAt = now;
  r.out = `😴 Fully rested: ♥ ${hero.maxHp}/${hero.maxHp}.`;
  return r;
}

// ─── Coding hooks ───────────────────────────────────────────────────────────

/** Commit reward: energy + gold, bounty if the idle bug fight was won. */
export function onCommit(s: RpgState, fightWon: boolean, now: number): string {
  settleEnergy(s, now);
  const energy = 3;
  const gold = 8 + 4 * Math.min(s.unlocked, ZONES.length) + (fightWon ? 12 : 0);
  const before = s.energy;
  s.energy = Math.min(ENERGY_MAX, s.energy + energy);
  if (s.energy >= ENERGY_MAX) s.energyAt = now;
  s.gold += gold;
  s.stats.goldEarned += gold;
  const e = s.energy - before;
  const news = [...progress(s, "commits", 1, now), ...progress(s, "gold", gold, now)];
  return [`+${gold}g${e > 0 ? ` +${e}⚡` : ""}`, ...news].join("\n");
}

/** One-line HUD for the status line: `⚔ Z2 3/5 ♥40/55 ⚡7 ◎120g`. */
export function hudLine(s: RpgState, maxHp: number): string {
  const hp = currentHp(s, maxHp);
  const where =
    s.zone >= TOWER_UNLOCK
      ? `T${s.tower.floor}`
      : `Z${s.zone} ${s.floors[String(s.zone)] ?? 0}/${FLOORS_PER_ZONE}`;
  const fight = s.battle ? ` ⚔ vs ${s.battle.foe.name}` : "";
  return `${where} ♥${hp}/${maxHp} ↯${Math.floor(s.energy)} ◎${s.gold}g${fight}`;
}
