/**
 * RPG command engine — one text command in, one text screen out. Shared by
 * the zero-token prompt hook (`;cmd` in Claude Code) and the `claude-buddy
 * play` TUI. Pure over its inputs: callers load/save state and apply the
 * returned buddy-XP side effect.
 */

import { hashString, mulberry32, type BuddyStats } from "../engine";
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
  GEAR_SLOTS,
  INVENTORY_CAP,
  KO_GOLD_LOSS,
  SKILLS,
  TRAINABLE,
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
  battleScreen,
  gearLine,
  gearName,
  hpBar,
  paint,
  bar,
  type Look,
  type Paint,
} from "./render";
import { currentHp, journal, nextEnergyIn, settle, settleEnergy, type RpgState } from "./store";

/** The companion-side inputs the RPG layers on top of. */
export interface BuddyCtx extends Look {
  level: number;
  prestige: number;
  stats: BuddyStats;
}

export interface CommandResult {
  out: string;
  /** Buddy XP earned this command (caller awards it via xp.ts). */
  xp: number;
  /** State was mutated and should be saved. */
  changed: boolean;
}

/** Final tier: the Endless Tower unlocks once zone 6's boss falls. */
export const TOWER_UNLOCK = ZONES.length + 1;

export function heroOf(s: RpgState, ctx: BuddyCtx): HeroStats {
  return deriveHero(ctx.level, ctx.prestige, ctx.stats, s.training, equippedList(s));
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
};

export function parse(input: string): { cmd: string; args: string[] } {
  const body = input.trim().replace(/^;+/, "").trim().toLowerCase();
  const parts = body.split(/\s+/).filter(Boolean);
  let head = parts.shift() ?? "";
  // `;s2` → skill 2
  const sk = /^s(\d)$/.exec(head);
  if (sk) return { cmd: "skill", args: [sk[1], ...parts] };
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
  const hero = heroOf(s, ctx);
  settle(s, now, hero.maxHp);
  const { cmd, args } = parse(input);
  const r: CommandResult = { out: "", xp: 0, changed: true };

  const inBattle = !!s.battle;
  const battleCmds = new Set(["attack", "defend", "flee", "skill"]);
  if (battleCmds.has(cmd) && !inBattle) {
    r.out = "Not in a fight. ;x to explore, ;boss for the zone boss, ;help for commands.";
    r.changed = false;
    return r;
  }

  switch (cmd) {
    case "help":
      r.out = helpText(p);
      r.changed = false;
      return r;
    case "status":
      r.out = s.battle ? screen(s, ctx, p) : statusText(s, ctx, hero, now, p);
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
    case "map":
      r.out = mapText(s, p);
      return r;
    case "travel":
      return travel(s, args[0], r);
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
    h("In a fight"),
    "  ;a attack  ;d defend  ;s1..;s7 skills  ;i <item>  ;f flee",
    h("Gear & town"),
    "  ;bag  ;equip <n>  ;unequip <slot>  ;sell <n|junk>  ;lock <n>",
    "  ;shop  ;buy <n> [qty]  ;train [atk|def|hp|spd|crit]  ;rest  ;skills  ;log",
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
  const lines = [
    paint(p, C.bold, `${ctx.name} · Power Lv${hero.level}`) +
      `  ${hpBar(p, hp, hero.maxHp)}  ${energyText(s, now, p)}  ${paint(p, C.yellow, `◎ ${s.gold}g`)}`,
  ];
  if (s.zone >= TOWER_UNLOCK) {
    lines.push(`📍 Endless Tower — best floor ${s.tower.best}`);
  } else if (z) {
    const next = floors >= FLOORS_PER_ZONE ? "boss ready! ;boss" : `next: floor ${floors + 1} ;x`;
    lines.push(`📍 ${z.name} [${bar(floors, FLOORS_PER_ZONE, FLOORS_PER_ZONE)}] ${next}`);
  }
  lines.push(paint(p, C.dim, ";help for commands"));
  return lines.join("\n");
}

function sheet(s: RpgState, ctx: BuddyCtx, hero: HeroStats, now: number, p: Paint): string {
  const hp = currentHp(s, hero.maxHp);
  const lines = [
    paint(p, C.bold, `${ctx.name} the ${ctx.species} — Power Lv${hero.level}`) +
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
  lines.push(`Skills: ${s.skills.map((k) => SKILLS[k].name).join(", ")}`);
  lines.push(
    paint(
      p,
      C.dim,
      `Bosses ${s.bossKills.length}/${ZONES.length} · kills ${s.stats.kills} · KOs ${s.stats.deaths} · tower best ${s.tower.best}`,
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
  kind: "explore" | "boss" | "tower",
  now: number,
  p: Paint,
  r: CommandResult,
): CommandResult {
  if (s.battle) {
    r.out = "You're already in a fight!\n" + screen(s, ctx, p);
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
  const cost = kind === "boss" ? COST_BOSS : kind === "tower" ? COST_TOWER : COST_EXPLORE;
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
      const def = z.monsters[Math.floor(rng() * z.monsters.length)];
      battle = startBattle("explore", z.id, floor, hero, hp, makeMonster(def, z.base + floor - 1), seed);
    }
  }
  s.energy -= cost;
  s.battle = battle;
  s.stats.battles++;
  r.out = screen(s, ctx, p);
  return r;
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
  if (!next.over) {
    r.out = screen(s, ctx, p);
    return r;
  }
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
  gold = Math.round(gold * (1 + hero.gold / 100));
  s.gold += gold;
  s.stats.goldEarned += gold;
  s.stats.kills++;
  r.xp += isBoss ? 25 + 3 * L : 2 + Math.floor(L / 2);
  lines.push(paint(p, C.yellow, `🏆 Victory! +${gold}g`) + paint(p, C.dim, `  +${r.xp} buddy XP`));

  let dropChance = 0.28;
  let floorRarity: GearItem["rarity"] | undefined;
  let luck = 0.04 * Math.min(6, b.zone || 6);

  if (b.kind === "explore") {
    const key = String(b.zone);
    const cleared = s.floors[key] ?? 0;
    if (b.floor > cleared) {
      s.floors[key] = b.floor;
      lines.push(
        b.floor >= FLOORS_PER_ZONE
          ? paint(p, C.magenta, `Floor ${b.floor} cleared — the boss awaits! ;boss`)
          : `Floor ${b.floor} cleared. ;x for floor ${b.floor + 1}`,
      );
    }
    if (b.floor >= FLOORS_PER_ZONE) dropChance = 0.4;
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
      s.items.potion = Math.min(CONSUMABLE_STACK, (s.items.potion ?? 0) + 2);
    }
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

function travel(s: RpgState, arg: string | undefined, r: CommandResult): CommandResult {
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
  r.out = n >= TOWER_UNLOCK ? "🗼 You stand before the Endless Tower. ;tower" : `🗺  Travelled to ${zoneById(n)!.name}. ;x to explore`;
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

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

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
  return `+${gold}g${e > 0 ? ` +${e}⚡` : ""}`;
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
