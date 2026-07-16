/**
 * Bug-enemy catalog and spawn logic for the idle-RPG layer (design-rpg Phase 3).
 *
 * Pure & dependency-light: a session's error count spawns a bug whose tier
 * scales with severity. Deterministic given (errorsSeen, seed) so combat is
 * reproducible and unit-testable. The buddy fights it in `combat.ts`.
 */

import { mulberry32, type Species, type Eye } from "./engine";

export type BugTier = 1 | 2 | 3 | 4;

/** A bug's stable catalog id (see `BUGS`). Used to pin a pending encounter's
 *  enemy identity across sightings and resolution (design-pending-encounter G4). */
export type BugId = string;

export interface Bug {
  id: BugId;
  name: string;
  /** Single status-line glyph (kept narrow, like item icons). Used in the toast
   *  summary and as the degraded-skew fallback render (Phase 5). */
  glyph: string;
  tier: BugTier;
  /** Base skill-point bounty awarded on defeat. */
  reward: number;
  /** The creature kind the bug renders as in the two-sprite fight scene
   *  (design-rpg Phase 5). Curated to clean 5-line, ANSI-free species so the
   *  mirror pass in `combat.ts` stays well-defined (excludes wyvern/pikachu). */
  species: Species;
  /** Optional resting eye for the enemy sprite; defaults applied at bake time. */
  eye?: Eye;
}

/** Severity-ranked catalog (tuning is design-rpg-phase3 OQ-P3.3). The `species`
 *  mapping (Phase 5) is thematic and FIXED per bug — variety already comes from
 *  `spawnBug`'s seeded same-tier roll (OQ-P5.3). */
export const BUGS: readonly Bug[] = [
  { id: "typo_gremlin", name: "typo gremlin", glyph: "\u{1F41B}", tier: 1, reward: 1, species: "blob" }, // 🐛
  { id: "off_by_one", name: "off-by-one", glyph: "\u{1FAB0}", tier: 1, reward: 1, species: "snail" }, // 🪰
  { id: "null_wraith", name: "null wraith", glyph: "\u{1F47B}", tier: 2, reward: 2, species: "ghost" }, // 👻
  { id: "type_error", name: "type error", glyph: "\u{1F47E}", tier: 2, reward: 2, species: "robot" }, // 👾
  { id: "race_condition", name: "race condition", glyph: "\u{1F577}️", tier: 3, reward: 3, species: "octopus" }, // 🕷️
  { id: "memory_leak", name: "memory leak", glyph: "\u{1F9A0}", tier: 3, reward: 3, species: "cactus" }, // 🦠
  { id: "segfault_dragon", name: "segfault dragon", glyph: "\u{1F409}", tier: 4, reward: 5, species: "dragon" }, // 🐉
] as const;

/**
 * Map a session's error count to a bug tier, or 0 for "no spawn". Cutoffs are
 * tunable (OQ-P3.3): 0 errors → none, 1–2 → t1, 3–5 → t2, 6–9 → t3, 10+ → t4.
 */
export function tierForErrors(errorsSeen: number): 0 | BugTier {
  if (errorsSeen <= 0) return 0;
  if (errorsSeen <= 2) return 1;
  if (errorsSeen <= 5) return 2;
  if (errorsSeen <= 9) return 3;
  return 4;
}

/** All bugs at a given tier. */
export function bugsOfTier(tier: BugTier): Bug[] {
  return BUGS.filter((b) => b.tier === tier);
}

/** Look up a bug by its catalog id, or null for an unknown id (renamed/removed
 *  catalog entry). Used to fight the exact enemy a pending encounter pinned. */
export function bugById(id: BugId): Bug | null {
  return BUGS.find((b) => b.id === id) ?? null;
}

/**
 * The bug a session spawns from its error count, or null when there were no
 * errors. Tier scales with severity; a seeded roll picks among same-tier bugs
 * for variety. Pure & deterministic given (errorsSeen, seed).
 */
export function spawnBug(errorsSeen: number, seed: number): Bug | null {
  const tier = tierForErrors(errorsSeen);
  if (tier === 0) return null;
  const pool = bugsOfTier(tier);
  if (pool.length === 0) return null;
  const rng = mulberry32(seed);
  return pool[Math.floor(rng() * pool.length)];
}
