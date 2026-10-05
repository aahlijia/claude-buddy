/**
 * Gear instances — rolled with a seeded rng: slot, tier-named base, rarity,
 * and rarity-scaled affixes. Pure.
 */

import { RARITIES, type Rarity } from "../engine";
import {
  AFFIXES,
  GEAR_BASES,
  GEAR_SLOTS,
  RARITY_AFFIXES,
  RARITY_POWER,
  type AffixStat,
  type GearSlot,
} from "./data";

export interface GearItem {
  uid: number;
  slot: GearSlot;
  name: string;
  rarity: Rarity;
  /** Item level — the monster level it dropped from. */
  ilvl: number;
  stats: Partial<Record<AffixStat, number>>;
  locked?: boolean;
}

/** Drop-rarity weights; `luck` (0..1) shifts weight toward the top end. */
export function rollRarity(rng: () => number, luck: number = 0, floor: Rarity = "common"): Rarity {
  const weights: Record<Rarity, number> = {
    common: 55 * (1 - luck * 0.6),
    uncommon: 28,
    rare: 12 + luck * 10,
    epic: 4 + luck * 6,
    legendary: 1 + luck * 3,
  };
  const minIdx = RARITIES.indexOf(floor);
  const pool = RARITIES.slice(minIdx);
  const total = pool.reduce((s, r) => s + weights[r], 0);
  let roll = rng() * total;
  for (const r of pool) {
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return pool[pool.length - 1];
}

function baseStats(slot: GearSlot, ilvl: number, power: number): Partial<Record<AffixStat, number>> {
  switch (slot) {
    case "weapon":
      return { atk: Math.round((1 + ilvl * 0.8) * power) };
    case "armor":
      return {
        def: Math.round((1 + ilvl * 0.6) * power),
        hp: Math.round(ilvl * 3 * power),
      };
    case "charm":
      return {
        hp: Math.round((3 + ilvl * 1.5) * power),
        crit: Math.min(12, Math.round((1 + ilvl / 8) * power)),
      };
  }
}

/** Gear tier (0-based base-name index) for an item level. */
export function tierFor(ilvl: number): number {
  return Math.max(0, Math.min(5, Math.floor((ilvl - 1) / 4)));
}

export function rollGear(
  rng: () => number,
  ilvl: number,
  uid: number,
  opts: { slot?: GearSlot; rarity?: Rarity; luck?: number; floor?: Rarity } = {},
): GearItem {
  const slot = opts.slot ?? GEAR_SLOTS[Math.floor(rng() * GEAR_SLOTS.length)];
  const rarity = opts.rarity ?? rollRarity(rng, opts.luck ?? 0, opts.floor);
  const power = RARITY_POWER[rarity];
  const stats = baseStats(slot, ilvl, power);

  const pool = [...AFFIXES];
  const prefixes: string[] = [];
  for (let n = 0; n < RARITY_AFFIXES[rarity] && pool.length; n++) {
    const a = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    let v = (a.lo + ilvl * a.per) * (0.75 + rng() * 0.5) * power;
    if (a.cap !== undefined) v = Math.min(a.cap, v);
    const val = Math.max(1, Math.round(v));
    stats[a.stat] = (stats[a.stat] ?? 0) + val;
    prefixes.push(a.prefix);
  }

  const base = GEAR_BASES[slot][tierFor(ilvl)];
  const name =
    rarity === "legendary"
      ? `${base} of Legend`
      : prefixes.length
        ? `${prefixes[0]} ${base}`
        : base;
  return { uid, slot, name, rarity, ilvl, stats };
}

/** Rough single-number value for comparisons and sorting. */
export function gearScore(g: GearItem): number {
  const s = g.stats;
  return Math.round(
    (s.atk ?? 0) * 3 +
      (s.def ?? 0) * 2.5 +
      (s.hp ?? 0) * 0.5 +
      (s.spd ?? 0) * 2 +
      (s.crit ?? 0) * 2 +
      (s.leech ?? 0) * 2.5 +
      (s.gold ?? 0) * 0.5,
  );
}

export function sellValue(g: GearItem): number {
  return Math.max(1, Math.round((4 + g.ilvl * 3) * RARITY_POWER[g.rarity] ** 2));
}

const STAT_LABEL: Record<AffixStat, string> = {
  atk: "ATK",
  def: "DEF",
  hp: "HP",
  spd: "SPD",
  crit: "CRIT%",
  leech: "LEECH%",
  gold: "GOLD%",
};

export function statLine(stats: Partial<Record<AffixStat, number>>): string {
  return (Object.keys(STAT_LABEL) as AffixStat[])
    .filter((k) => stats[k])
    .map((k) => `+${stats[k]} ${STAT_LABEL[k]}`)
    .join(" ");
}
