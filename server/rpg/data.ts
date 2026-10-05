/**
 * RPG mini-game catalog — zones, monsters, bosses, skills, gear bases,
 * affixes, consumables. Pure data, no I/O.
 *
 * Every creature renders as an existing species sprite (art.ts), restricted to
 * the curated 5-line, ANSI-free roster the combat scenes already mirror
 * (bugs.ts excludes wyvern/pikachu for the same reason).
 */

import type { Rarity, Species } from "../engine";

// ─── Zones ──────────────────────────────────────────────────────────────────

export type ZoneId = 1 | 2 | 3 | 4 | 5 | 6;

/** Floors per zone before its boss unlocks. */
export const FLOORS_PER_ZONE = 5;

export interface MonsterDef {
  id: string;
  name: string;
  species: Species;
  /** Stat multipliers over the level curve (1 = baseline). */
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** Optional special move, see `battle.ts` `monsterMove`. */
  move?: MonsterMove;
}

export type MonsterMove = "poison" | "heal" | "enrage" | "shield" | "double";

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** Monster level on floor 1; floor f fights level `base + f - 1`. */
  base: number;
  monsters: MonsterDef[];
  boss: BossId;
}

export type BossId =
  | "semicolon"
  | "lich"
  | "hydra"
  | "heisenbug"
  | "golem"
  | "segfault";

export interface BossDef {
  id: BossId;
  name: string;
  species: Species;
  title: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** One-line tell shown when the fight starts. */
  intro: string;
  /** Skill unlocked on first kill. */
  unlocks?: SkillId;
}

export const ZONES: readonly ZoneDef[] = [
  {
    id: 1,
    name: "Syntax Meadows",
    base: 1,
    boss: "semicolon",
    monsters: [
      { id: "typo", name: "Typo Gremlin", species: "blob", hp: 0.9, atk: 0.9, def: 0.8, spd: 1 },
      { id: "lintmoth", name: "Lint Moth", species: "owl", hp: 0.8, atk: 1, def: 0.7, spd: 1.3 },
      { id: "indent", name: "Indent Snail", species: "snail", hp: 1.2, atk: 0.8, def: 1.3, spd: 0.6 },
    ],
  },
  {
    id: 2,
    name: "Null Marsh",
    base: 5,
    boss: "lich",
    monsters: [
      { id: "wraith", name: "Null Wraith", species: "ghost", hp: 0.9, atk: 1.1, def: 0.8, spd: 1.2 },
      { id: "undef", name: "Undefined Toad", species: "axolotl", hp: 1.1, atk: 0.9, def: 1, spd: 0.9, move: "poison" },
      { id: "nan", name: "NaN Duck", species: "duck", hp: 1, atk: 1, def: 1, spd: 1 },
    ],
  },
  {
    id: 3,
    name: "Callback Caverns",
    base: 9,
    boss: "hydra",
    monsters: [
      { id: "promise", name: "Broken Promise", species: "mushroom", hp: 1, atk: 1, def: 1, spd: 1, move: "poison" },
      { id: "pyramid", name: "Pyramid of Doom", species: "turtle", hp: 1.4, atk: 0.9, def: 1.4, spd: 0.6, move: "shield" },
      { id: "zalgo", name: "Zalgo Bat", species: "penguin", hp: 0.9, atk: 1.2, def: 0.8, spd: 1.3, move: "double" },
    ],
  },
  {
    id: 4,
    name: "Race Rapids",
    base: 13,
    boss: "heisenbug",
    monsters: [
      { id: "deadlock", name: "Deadlock Crab", species: "octopus", hp: 1.2, atk: 1, def: 1.3, spd: 0.8, move: "shield" },
      { id: "flaky", name: "Flaky Test", species: "rabbit", hp: 0.8, atk: 1.2, def: 0.8, spd: 1.5, move: "double" },
      { id: "mutex", name: "Mutex Goose", species: "goose", hp: 1, atk: 1.1, def: 1, spd: 1.1, move: "enrage" },
    ],
  },
  {
    id: 5,
    name: "Leak Mines",
    base: 17,
    boss: "golem",
    monsters: [
      { id: "dangling", name: "Dangling Ref", species: "cactus", hp: 1, atk: 1.1, def: 1.1, spd: 1, move: "poison" },
      { id: "zombie", name: "Zombie Process", species: "capybara", hp: 1.5, atk: 0.9, def: 1, spd: 0.7, move: "heal" },
      { id: "overflow", name: "Stack Overflow", species: "robot", hp: 1, atk: 1.3, def: 1, spd: 1, move: "enrage" },
    ],
  },
  {
    id: 6,
    name: "Kernel Abyss",
    base: 21,
    boss: "segfault",
    monsters: [
      { id: "panic", name: "Kernel Panic", species: "cat", hp: 1.1, atk: 1.3, def: 1, spd: 1.2, move: "double" },
      { id: "fork", name: "Fork Bomb", species: "chonk", hp: 1.4, atk: 1.1, def: 1.1, spd: 0.8, move: "heal" },
      { id: "rootkit", name: "Rootkit Shade", species: "ghost", hp: 1, atk: 1.2, def: 1.2, spd: 1.3, move: "poison" },
    ],
  },
];

export const BOSSES: Record<BossId, BossDef> = {
  semicolon: {
    id: "semicolon", name: "The Missing Semicolon", species: "blob", title: "Parser's Bane",
    hp: 3.6, atk: 1.1, def: 1.1, spd: 0.9,
    intro: "It gathers stray tokens every third turn. Defend through the Parse Error!",
    unlocks: "refactor",
  },
  lich: {
    id: "lich", name: "Null Pointer Lich", species: "ghost", title: "Dereferencer",
    hp: 3.4, atk: 1.1, def: 1, spd: 1.1,
    intro: "Its hits drain your life. Below half HP it curses your aim.",
    unlocks: "breakpoint",
  },
  hydra: {
    id: "hydra", name: "Callback Hydra", species: "octopus", title: "Nester of Hell",
    hp: 3.4, atk: 0.85, def: 1.1, spd: 1,
    intro: "Every head strikes. Each time it drops a quarter HP, a new head grows.",
    unlocks: "duck",
  },
  heisenbug: {
    id: "heisenbug", name: "The Heisenbug", species: "rabbit", title: "Unobservable",
    hp: 2.6, atk: 1.2, def: 0.9, spd: 1.6,
    intro: "It dodges anything it sees coming. Defend to observe it — then strike.",
    unlocks: "gc",
  },
  golem: {
    id: "golem", name: "Leaky Golem", species: "chonk", title: "Heap Hoarder",
    hp: 2.6, atk: 1.1, def: 1.2, spd: 0.7,
    intro: "It grows every turn it is left alone. Stun it to stop the leak.",
    unlocks: "forkbomb",
  },
  segfault: {
    id: "segfault", name: "Segfault Dragon", species: "dragon", title: "Core Dumper",
    hp: 4, atk: 1.2, def: 1.15, spd: 1.1,
    intro: "It inhales before Core Dump. Defend or Breakpoint it. Enrages at 30%.",
  },
};

export function zoneById(id: number): ZoneDef | undefined {
  return ZONES.find((z) => z.id === id);
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export type SkillId =
  | "strike"
  | "hotfix"
  | "refactor"
  | "breakpoint"
  | "duck"
  | "gc"
  | "forkbomb";

export interface SkillDef {
  id: SkillId;
  name: string;
  cooldown: number;
  desc: string;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  strike: { id: "strike", name: "Power Strike", cooldown: 2, desc: "1.7× damage hit" },
  hotfix: { id: "hotfix", name: "Hotfix", cooldown: 4, desc: "heal 35% max HP, cure poison" },
  refactor: { id: "refactor", name: "Refactor", cooldown: 5, desc: "+40% ATK for 3 turns" },
  breakpoint: { id: "breakpoint", name: "Breakpoint", cooldown: 5, desc: "hit + stun 1 turn (breaks charges)" },
  duck: { id: "duck", name: "Rubber Duck", cooldown: 4, desc: "guaranteed 2.5× crit, ignores dodge" },
  gc: { id: "gc", name: "Garbage Collect", cooldown: 5, desc: "hit + 12% of foe's HP, strips buffs" },
  forkbomb: { id: "forkbomb", name: "Fork Bomb", cooldown: 4, desc: "three 0.75× hits" },
};

/** Skills every hero starts with. */
export const STARTER_SKILLS: readonly SkillId[] = ["strike", "hotfix"];

// ─── Consumables ────────────────────────────────────────────────────────────

export type ConsumableId = "potion" | "elixir" | "bomb" | "smoke";

export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  icon: string;
  price: number;
  desc: string;
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  potion: { id: "potion", name: "Coffee", icon: "☕", price: 25, desc: "heal 40% max HP" },
  elixir: { id: "elixir", name: "Energy Drink", icon: "🥤", price: 70, desc: "full heal + reset cooldowns" },
  bomb: { id: "bomb", name: "rm -rf Bomb", icon: "💣", price: 45, desc: "heavy damage, never misses" },
  smoke: { id: "smoke", name: "Ctrl+C Smoke", icon: "💨", price: 20, desc: "escape any non-boss fight" },
};

export const CONSUMABLE_STACK = 9;

// ─── Gear ───────────────────────────────────────────────────────────────────

export const GEAR_SLOTS = ["weapon", "armor", "charm"] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

/** Base names per slot, one per gear tier (tier = zone the item dropped in). */
export const GEAR_BASES: Record<GearSlot, readonly string[]> = {
  weapon: ["Rusty Pointer", "Lint Brush", "Regex Whip", "Async Blade", "Kernel Cleaver", "Quantum Compiler"],
  armor: ["Comfy Hoodie", "Duck-Down Vest", "Try/Catch Mail", "Firewall Plate", "Sandbox Aegis", "Immutable Shell"],
  charm: ["Sticky Note", "Coffee Mug", "Lucky Keycap", "Stack Trace Amulet", "Mechanical Heart", "Singularity Core"],
};

export type AffixStat = "atk" | "def" | "hp" | "spd" | "crit" | "leech" | "gold";

export interface AffixDef {
  stat: AffixStat;
  prefix: string;
  /** Roll range scales with item level: `lo + ilvl*per`, ±25%. */
  lo: number;
  per: number;
  /** Hard cap on a single roll (percent stats). */
  cap?: number;
}

export const AFFIXES: readonly AffixDef[] = [
  { stat: "atk", prefix: "Sharp", lo: 1, per: 0.55 },
  { stat: "def", prefix: "Sturdy", lo: 1, per: 0.4 },
  { stat: "hp", prefix: "Hearty", lo: 4, per: 2.6 },
  { stat: "spd", prefix: "Swift", lo: 1, per: 0.15, cap: 8 },
  { stat: "crit", prefix: "Keen", lo: 2, per: 0.2, cap: 10 },
  { stat: "leech", prefix: "Vampiric", lo: 2, per: 0.15, cap: 8 },
  { stat: "gold", prefix: "Greedy", lo: 5, per: 0.8, cap: 30 },
];

export const RARITY_POWER: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.15,
  rare: 1.3,
  epic: 1.4,
  legendary: 1.6,
};

export const RARITY_AFFIXES: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

/** ANSI color per rarity, matching the status line's rarity palette. */
export const RARITY_ANSI: Record<Rarity, string> = {
  common: "\x1b[37m",
  uncommon: "\x1b[32m",
  rare: "\x1b[34m",
  epic: "\x1b[35m",
  legendary: "\x1b[33m",
};

export const INVENTORY_CAP = 20;

// ─── Economy & pacing ───────────────────────────────────────────────────────

export const ENERGY_MAX = 10;
/** Real-time minutes per regenerated energy point. */
export const ENERGY_REGEN_MIN = 12;
/** Out-of-combat HP regen, fraction of max HP per minute. */
export const HP_REGEN_PER_MIN = 0.05;
export const COST_EXPLORE = 1;
export const COST_BOSS = 2;
export const COST_TOWER = 1;
export const COST_REST = 2;
/** Fraction of gold lost when knocked out. */
export const KO_GOLD_LOSS = 0.1;

/** Trainable hero attributes and what one rank grants. */
export const TRAINABLE = ["atk", "def", "hp", "spd", "crit"] as const;
export type TrainStat = (typeof TRAINABLE)[number];

export const TRAIN_GAIN: Record<TrainStat, number> = {
  atk: 2,
  def: 2,
  hp: 12,
  spd: 1,
  crit: 1,
};

/** Hard cap on training ranks per attribute. */
export const TRAIN_MAX = 30;
