/**
 * RPG save state (`rpg.json` in the buddy state dir) — load/coerce/save plus
 * the lazy, clock-driven regen. Nothing ticks in the background: energy and
 * HP are settled from timestamps whenever the state is read.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "../path";
import type { Battle } from "./battle";
import {
  CONSUMABLES,
  ENERGY_MAX,
  ENERGY_REGEN_MIN,
  HP_REGEN_PER_MIN,
  STARTER_SKILLS,
  type BossId,
  type BountyKind,
  type ConsumableId,
  type GearSlot,
  type SkillId,
} from "./data";
import type { GearItem } from "./gear";
import type { Blessing, PendingEvent } from "./events";
import type { Training } from "./hero";

export interface RpgState {
  v: 1;
  gold: number;
  energy: number;
  /** ms timestamp energy was last settled at. */
  energyAt: number;
  /** Current HP, or null for "full" (resolved against max HP on read). */
  hp: number | null;
  hpAt: number;
  /** Zone the hero is exploring. */
  zone: number;
  /** Highest zone unlocked. */
  unlocked: number;
  /** Floors cleared per zone (0..FLOORS_PER_ZONE). */
  floors: Record<string, number>;
  bossKills: BossId[];
  skills: SkillId[];
  items: Partial<Record<ConsumableId, number>>;
  bag: GearItem[];
  equipped: Partial<Record<GearSlot, GearItem>>;
  nextUid: number;
  training: Training;
  tower: { floor: number; best: number };
  battle: Battle | null;
  /** Monotonic counter folded into every new seed. */
  seq: number;
  stats: {
    battles: number;
    kills: number;
    deaths: number;
    bosses: number;
    goldEarned: number;
    hunts?: number;
    boards?: number;
    events?: number;
  };
  /** Achievement ids earned (feats.ts). */
  feats: string[];
  /** Equipped title, or null. */
  title: string | null;
  /** Last few lines of notable events (drops, level-ups) for `;log`. */
  journal: string[];
  /** Today's merchant stock slots already bought (stock is day-seeded). */
  shop: { day: string; bought: number[] };
  /** Today's bounty board (rolled lazily on first touch each day). */
  daily: { day: string; tasks: Bounty[]; bonus: boolean };
  /** Key of the status-line standoff already hunted (one hunt per standoff). */
  hunted: string;
  /** An exploration event awaiting ;1 / ;2. */
  event: PendingEvent | null;
  /** True when the last explore was an event (the next one is always a fight). */
  lastEvent: boolean;
  /** Temporary buff from a shrine/duck, counted down per fight. */
  blessing: Blessing | null;
  /** Zones whose arrival text has been shown; 0 = prologue shown. */
  seen: number[];
}

export interface Bounty {
  kind: BountyKind;
  target: number;
  progress: number;
  done: boolean;
}

export function freshState(now: number): RpgState {
  return {
    v: 1,
    gold: 30,
    energy: ENERGY_MAX,
    energyAt: now,
    hp: null,
    hpAt: now,
    zone: 1,
    unlocked: 1,
    floors: {},
    bossKills: [],
    skills: [...STARTER_SKILLS],
    items: { potion: 3 },
    bag: [],
    equipped: {},
    nextUid: 1,
    training: {},
    tower: { floor: 0, best: 0 },
    battle: null,
    seq: 0,
    stats: { battles: 0, kills: 0, deaths: 0, bosses: 0, goldEarned: 0 },
    journal: [],
    shop: { day: "", bought: [] },
    daily: { day: "", tasks: [], bonus: false },
    hunted: "",
    event: null,
    // A new player's first explore is always a fight.
    lastEvent: true,
    blessing: null,
    seen: [],
    feats: [],
    title: null,
  };
}

const num = (v: unknown, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

/** Backfill a parsed blob into a valid state (hand edits, version skew). */
export function coerceState(raw: unknown, now: number): RpgState {
  const base = freshState(now);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<RpgState>;
  const items: RpgState["items"] = {};
  for (const id of Object.keys(CONSUMABLES) as ConsumableId[]) {
    const n = num(r.items?.[id], 0);
    if (n > 0) items[id] = Math.floor(n);
  }
  return {
    ...base,
    gold: Math.max(0, Math.floor(num(r.gold, base.gold))),
    energy: Math.max(0, Math.min(ENERGY_MAX, num(r.energy, base.energy))),
    energyAt: num(r.energyAt, now),
    hp: r.hp === null || r.hp === undefined ? null : Math.max(0, num(r.hp, 0)),
    hpAt: num(r.hpAt, now),
    zone: Math.max(1, Math.floor(num(r.zone, 1))),
    unlocked: Math.max(1, Math.floor(num(r.unlocked, 1))),
    floors: r.floors && typeof r.floors === "object" ? r.floors : {},
    bossKills: Array.isArray(r.bossKills) ? r.bossKills : [],
    skills: Array.isArray(r.skills) && r.skills.length ? r.skills : base.skills,
    items,
    bag: Array.isArray(r.bag) ? r.bag : [],
    equipped: r.equipped && typeof r.equipped === "object" ? r.equipped : {},
    nextUid: Math.max(1, num(r.nextUid, 1)),
    training: r.training && typeof r.training === "object" ? r.training : {},
    tower: {
      floor: num(r.tower?.floor, 0),
      best: num(r.tower?.best, 0),
    },
    battle: r.battle && typeof r.battle === "object" ? r.battle : null,
    seq: num(r.seq, 0),
    stats: { ...base.stats, ...(r.stats ?? {}) },
    journal: Array.isArray(r.journal) ? r.journal.slice(-10) : [],
    shop: {
      day: typeof r.shop?.day === "string" ? r.shop.day : "",
      bought: Array.isArray(r.shop?.bought) ? r.shop.bought : [],
    },
    daily:
      r.daily && typeof r.daily.day === "string" && Array.isArray(r.daily.tasks)
        ? { day: r.daily.day, tasks: r.daily.tasks, bonus: r.daily.bonus === true }
        : base.daily,
    hunted: typeof r.hunted === "string" ? r.hunted : "",
    event: r.event && typeof r.event === "object" && typeof r.event.id === "string" ? r.event : null,
    lastEvent: r.lastEvent === true,
    blessing: r.blessing && typeof r.blessing === "object" && num(r.blessing.fights, 0) > 0 ? r.blessing : null,
    seen: Array.isArray(r.seen) ? r.seen.filter((n): n is number => typeof n === "number") : [],
    feats: Array.isArray(r.feats) ? r.feats.filter((f): f is string => typeof f === "string") : [],
    title: typeof r.title === "string" ? r.title : null,
  };
}

/**
 * Apply elapsed-time regen: energy +1 per ENERGY_REGEN_MIN, HP +5%/min while
 * out of battle. Partial progress is kept by advancing the timestamps only by
 * whole regen units.
 */
export function settle(s: RpgState, now: number, maxHp: number): void {
  settleEnergy(s, now);
  if (s.battle) {
    s.hpAt = now;
    return;
  }
  const hp = s.hp === null ? maxHp : Math.min(s.hp, maxHp);
  const mins = Math.max(0, (now - s.hpAt) / 60_000);
  const healed = hp + Math.floor(mins * HP_REGEN_PER_MIN * maxHp);
  if (healed >= maxHp) {
    s.hp = null;
    s.hpAt = now;
  } else if (healed > hp) {
    s.hp = healed;
    s.hpAt = now;
  } else {
    s.hp = hp;
  }
}

export function settleEnergy(s: RpgState, now: number): void {
  const step = ENERGY_REGEN_MIN * 60_000;
  if (s.energy >= ENERGY_MAX) {
    s.energyAt = now;
  } else if (now > s.energyAt) {
    const gained = Math.floor((now - s.energyAt) / step);
    if (gained > 0) {
      s.energy = Math.min(ENERGY_MAX, s.energy + gained);
      s.energyAt = s.energy >= ENERGY_MAX ? now : s.energyAt + gained * step;
    }
  }
}

/** Minutes until the next energy point, or 0 when full. */
export function nextEnergyIn(s: RpgState, now: number): number {
  if (s.energy >= ENERGY_MAX) return 0;
  return Math.max(1, Math.ceil((s.energyAt + ENERGY_REGEN_MIN * 60_000 - now) / 60_000));
}

export function currentHp(s: RpgState, maxHp: number): number {
  return s.hp === null ? maxHp : Math.min(s.hp, maxHp);
}

export function journal(s: RpgState, line: string): void {
  s.journal.push(line);
  if (s.journal.length > 10) s.journal.splice(0, s.journal.length - 10);
}

// ─── I/O ────────────────────────────────────────────────────────────────────

export function rpgFile(): string {
  return join(buddyStateDir(), "rpg.json");
}

export function loadRpg(now: number = Date.now()): RpgState {
  const f = rpgFile();
  if (!existsSync(f)) return freshState(now);
  try {
    return coerceState(JSON.parse(readFileSync(f, "utf8")), now);
  } catch {
    return freshState(now);
  }
}

/** Atomic write (tmp + rename), same idiom as status.json. */
export function saveRpg(s: RpgState): void {
  const f = rpgFile();
  mkdirSync(buddyStateDir(), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, f);
}
