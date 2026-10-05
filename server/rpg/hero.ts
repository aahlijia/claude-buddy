/**
 * Hero stat derivation — the RPG layers ON TOP of the companion: buddy level,
 * prestige and the five personality stats feed combat stats, then gold-bought
 * training ranks and equipped gear stack on. Pure.
 */

import type { BuddyStats, Species } from "../engine";
import {
  SPECIES_PASSIVES,
  TRAIN_GAIN,
  TRAIN_MAX,
  TRAINABLE,
  type AffixStat,
  type TrainStat,
  type UniqueId,
} from "./data";
import type { GearItem } from "./gear";

export interface HeroStats {
  /** Power level: buddy level + 20 per prestige (monotonic across ascension). */
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  /** Percent. */
  crit: number;
  /** Percent of damage dealt healed back. */
  leech: number;
  /** Percent bonus gold. */
  gold: number;
  /** Legendary unique powers from equipped gear. */
  uniques: UniqueId[];
}

export type Training = Partial<Record<TrainStat, number>>;

export const CRIT_CAP = 60;
export const LEECH_CAP = 25;

export function powerLevel(buddyLevel: number, prestige: number): number {
  return Math.max(1, buddyLevel) + 20 * Math.max(0, prestige);
}

/** Sum of a stat across equipped gear (base stats + affixes). */
export function gearBonus(gear: readonly GearItem[]): Record<AffixStat, number> {
  const out: Record<AffixStat, number> = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, leech: 0, gold: 0 };
  for (const g of gear) {
    for (const [k, v] of Object.entries(g.stats) as [AffixStat, number][]) {
      out[k] += v;
    }
  }
  return out;
}

export function deriveHero(
  buddyLevel: number,
  prestige: number,
  stats: BuddyStats,
  training: Training,
  gear: readonly GearItem[],
  species?: Species,
): HeroStats {
  const level = powerLevel(buddyLevel, prestige);
  const l = level - 1;
  const t = (k: TrainStat) => (training[k] ?? 0) * TRAIN_GAIN[k];
  const g = gearBonus(gear);
  const ps = species ? SPECIES_PASSIVES[species] : undefined;
  const pct = (k: "atk" | "def" | "hp", v: number) => Math.round(v * (1 + (ps?.pct?.[k] ?? 0) / 100));
  const flat = (k: "spd" | "crit" | "leech" | "gold") => ps?.flat?.[k] ?? 0;
  return {
    level,
    maxHp: pct("hp", 45 + 7 * l + stats.PATIENCE / 2 + t("hp") + g.hp),
    atk: pct("atk", 9 + 1.6 * l + stats.DEBUGGING / 8 + t("atk") + g.atk),
    def: pct("def", 3 + 0.9 * l + stats.WISDOM / 10 + t("def") + g.def),
    spd: Math.max(1, Math.round(10 + stats.CHAOS / 10 + t("spd") + g.spd + flat("spd"))),
    crit: Math.min(CRIT_CAP, Math.round(5 + stats.SNARK / 10 + t("crit") + g.crit + flat("crit"))),
    leech: Math.min(LEECH_CAP, g.leech + flat("leech")),
    gold: g.gold + flat("gold"),
    uniques: gear.flatMap((x) => (x.unique ? [x.unique] : [])),
  };
}

/** Gold cost of the next training rank given ranks already bought. */
export function trainCost(rank: number): number {
  return Math.round(20 * Math.pow(1.22, rank));
}

export function trainError(training: Training, stat: string, gold: number): string | null {
  if (!(TRAINABLE as readonly string[]).includes(stat)) {
    return `Unknown stat "${stat}". Train one of: ${TRAINABLE.join(", ")}.`;
  }
  const rank = training[stat as TrainStat] ?? 0;
  if (rank >= TRAIN_MAX) return `${stat.toUpperCase()} is fully trained.`;
  const cost = trainCost(rank);
  if (gold < cost) return `Need ${cost}g to train ${stat.toUpperCase()} (have ${gold}g).`;
  return null;
}
