/**
 * Auto-idle combat for the idle-RPG layer (design-rpg Phase 3).
 *
 * `resolveCombat` is pure & deterministic: given the buddy, a bug, the equipped
 * loadout, and a seed, it returns the outcome, a baked frame flipbook, and a
 * drop spec — no I/O, no clock. The buddy never dies; the worst case is `flee`.
 *
 * The thin I/O wrappers (`applyCombatDrops`, `writeEncounter`, `readEncounter`)
 * persist the durable rewards and the transient encounter side-channel
 * (`encounter.json`, mirroring loot's `lastDrop`). The status-line *rendering*
 * of the baked frames is Phase 4.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

import {
  RARITY_WEIGHTS,
  mulberry32,
  renderFace,
  type BuddyBones,
  type Eye,
} from "./engine";
import { buddyStateDir } from "./path";
import { resolveAppearance } from "./equipment";
import { ITEMS, findItem, type Equipment, type ItemId } from "./items";
import { grantBonusPoints, grantItem } from "./xp";
import type { Bug } from "./bugs";

// ─── Tunable win curve (design-rpg-phase3 OQ-P3.4) ────────────────────────────

/** Base win probability before stat/gear/tier adjustments. */
export const WIN_BASE = 0.5;
/** Each bug tier above 1 subtracts this much win probability. */
export const TIER_STEP = 0.15;
/** Flat bonus for having any weapon equipped (on top of its stat effect). */
export const WEAPON_PRESENCE_BONUS = 0.05;
/** Win-probability floor/ceiling — a fight is never certain either way. */
export const WIN_FLOOR = 0.05;
export const WIN_CEIL = 0.98;
/** Per-tier chance of an item drop on a win. */
export const ITEM_DROP_PER_TIER = 0.1;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Outcome = "win" | "flee";

export interface DropSpec {
  /** Skill points granted on a win (0 on flee). */
  points: number;
  /** Optional item id dropped on a win. */
  itemId?: ItemId;
}

export interface CombatResult {
  outcome: Outcome;
  /** Baked fight flipbook — Phase 4 cycles these. */
  frames: string[];
  /** Playback indices (NOW % len). */
  sequence: number[];
  /** The bug's glyph, placed in the margin by Phase 4. */
  enemyGlyph: string;
  drop: DropSpec;
  /** One-line celebration text for the toast. */
  summary: string;
}

export interface EncounterRecord {
  frames: string[];
  sequence: number[];
  enemyGlyph: string;
  at: number; // Date.now() — TTL freshness, like loot's lastDrop.at
}

// ─── Win odds ─────────────────────────────────────────────────────────────────

/**
 * Win probability from the buddy's effective DEBUGGING (which already folds in a
 * weapon's stat effect), a flat bonus for having a weapon equipped, and the bug
 * tier. Clamped so no fight is ever a foregone conclusion.
 */
export function winChance(
  effectiveDebug: number,
  weaponEquipped: boolean,
  tier: number,
): number {
  const p =
    WIN_BASE +
    effectiveDebug / 200 +
    (weaponEquipped ? WEAPON_PRESENCE_BONUS : 0) -
    (tier - 1) * TIER_STEP;
  return Math.max(WIN_FLOOR, Math.min(WIN_CEIL, p));
}

// ─── Frame baking ─────────────────────────────────────────────────────────────

/**
 * Bake a short fight flipbook from existing art (eye substitution + the weapon
 * glyph), so we draw almost no net-new ASCII. Single-line buddy poses; Phase 4
 * owns placement of the enemy glyph in the margin.
 */
function bakeFrames(
  bones: BuddyBones,
  weaponArt: string,
  outcome: Outcome,
): { frames: string[]; sequence: number[] } {
  // Fight expressions reuse renderFace's {E} substitution with non-standard
  // eye glyphs (">", "^", "-"); cast past the strict Eye union deliberately.
  const eye = (e: string): Eye => e as Eye;
  const w = weaponArt ? `${weaponArt} ` : "";
  const ready = renderFace(bones.species, bones.eye);
  const swing = `${w}${renderFace(bones.species, eye(">"))}`;
  const strike = `${w}${renderFace(bones.species, eye(">"))}!`;
  const finish =
    outcome === "win"
      ? renderFace(bones.species, eye("^")) // triumphant
      : renderFace(bones.species, eye("-")); // unbothered retreat
  const frames = [ready, swing, strike, finish];
  // Gentle oscillation: ready, wind-up, strike, strike, resolve, resolve.
  const sequence = [0, 1, 2, 2, 3, 3];
  return { frames, sequence };
}

// ─── Item-drop roll (rarity-weighted) ─────────────────────────────────────────

/**
 * Roll a rarity-weighted item the player does NOT already own. Pure (rng
 * injected). Returns undefined when nothing droppable remains — so the summary
 * never announces loot the grant would silently no-op.
 */
function rollItemDrop(
  rng: () => number,
  owned: ReadonlySet<ItemId>,
): ItemId | undefined {
  const pool = ITEMS.filter((i) => !owned.has(i.id));
  const total = pool.reduce((sum, i) => sum + (RARITY_WEIGHTS[i.rarity] ?? 0), 0);
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const item of pool) {
    roll -= RARITY_WEIGHTS[item.rarity] ?? 0;
    if (roll < 0) return item.id;
  }
  return pool[pool.length - 1]?.id;
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve one encounter deterministically. Same inputs ⇒ same result. Gear
 * matters: effective DEBUGGING reads the equipped weapon's stat effect via
 * resolveAppearance, and an equipped weapon adds a flat bonus. `owned` (the
 * player's inventory ∪ equipped) is excluded from item drops so the summary
 * never announces loot the grant would silently skip.
 */
export function resolveCombat(
  bones: BuddyBones,
  bug: Bug,
  equipment: Equipment,
  seed: number,
  owned: ReadonlySet<ItemId> = new Set(),
): CombatResult {
  // Seeded once, consumed in a fixed order ⇒ reproducible resolution.
  const rng = mulberry32(seed);

  const appearance = resolveAppearance(bones, equipment);
  const effDebug = appearance.stats.DEBUGGING;
  const weaponEquipped = Boolean(equipment.weapon);
  const p = winChance(effDebug, weaponEquipped, bug.tier);

  const outcome: Outcome = rng() < p ? "win" : "flee";
  const { frames, sequence } = bakeFrames(bones, appearance.weaponArt, outcome);

  let drop: DropSpec;
  let summary: string;
  if (outcome === "win") {
    const jitter = Math.floor(rng() * 2); // 0..1 bonus point
    const points = bug.reward + jitter;
    const itemId =
      rng() < ITEM_DROP_PER_TIER * bug.tier
        ? rollItemDrop(rng, owned)
        : undefined;
    drop = { points, itemId };
    const itemName = itemId ? findItem(itemId)?.name : undefined;
    summary = `\u{1F5E1} squashed a ${bug.name}! +${points} pt${
      itemName ? ` & found a ${itemName}` : ""
    }`;
  } else {
    drop = { points: 0 };
    summary = `${bug.glyph} a ${bug.name} scuttled off.`;
  }

  return {
    outcome,
    frames,
    sequence,
    enemyGlyph: bug.glyph,
    drop,
    summary,
  };
}

// ─── I/O wrappers ─────────────────────────────────────────────────────────────

/** Apply a win's drop: credit skill points and (maybe) grant an item. */
export function applyCombatDrops(drop: DropSpec): void {
  if (drop.points > 0) grantBonusPoints(drop.points);
  if (drop.itemId) grantItem(drop.itemId);
}

function encounterFile(): string {
  return join(buddyStateDir(), "encounter.json");
}

/** Persist the baked encounter to the transient side-channel (like lastDrop). */
export function writeEncounter(result: CombatResult): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const record: EncounterRecord = {
    frames: result.frames,
    sequence: result.sequence,
    enemyGlyph: result.enemyGlyph,
    at: Date.now(),
  };
  const file = encounterFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(record));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(record));
  }
}

/**
 * How long a baked encounter stays fresh (ms). Kept in sync with the
 * `$enc_fresh` window in buddy-status.sh and the full-gate celebration TTL, so
 * the glyph, the fight face, and the toast all fade together (≈10s).
 */
export const ENCOUNTER_TTL_MS = 10_000;

/**
 * Read the encounter side-channel if present and fresh. Returns null when
 * missing, malformed, or older than `maxAgeMs`. Phase 4's status write consumes
 * this; exposed now for tests.
 */
export function readEncounter(
  maxAgeMs: number = ENCOUNTER_TTL_MS,
): EncounterRecord | null {
  try {
    const rec = JSON.parse(
      readFileSync(encounterFile(), "utf8"),
    ) as EncounterRecord;
    if (!Array.isArray(rec.frames) || typeof rec.at !== "number") return null;
    if (Date.now() - rec.at > maxAgeMs) return null;
    return rec;
  } catch {
    return null;
  }
}
