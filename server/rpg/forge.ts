/**
 * The forge — enhance gear +1..+10 for gold. Each level is +10% to every
 * stat. Safe up to +5; past that a failed strike keeps the item but eats the
 * gold. Pure.
 */

import { RARITY_POWER } from "./data";
import type { GearItem } from "./gear";

export const FORGE_MAX = 10;

/** Chance to go from +n to +n+1. */
export const FORGE_CHANCE: readonly number[] = [1, 1, 1, 1, 1, 0.85, 0.7, 0.55, 0.4, 0.3];

export function forgeCost(g: GearItem): number {
  const n = g.plus ?? 0;
  return Math.round((6 + g.ilvl * 2.5) * RARITY_POWER[g.rarity] * Math.pow(n + 1, 1.35));
}

export function forgeError(g: GearItem, gold: number): string | null {
  const n = g.plus ?? 0;
  if (n >= FORGE_MAX) return `${g.name} is already +${FORGE_MAX}. Perfection.`;
  const cost = forgeCost(g);
  if (gold < cost) return `Forging to +${n + 1} costs ${cost}g (have ${gold}g).`;
  return null;
}

/** Strike the anvil: mutates `g.plus` on success. Returns success. */
export function strike(g: GearItem, rng: () => number): boolean {
  const n = g.plus ?? 0;
  if (rng() < FORGE_CHANCE[n]) {
    g.plus = n + 1;
    return true;
  }
  return false;
}
