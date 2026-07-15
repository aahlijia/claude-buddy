/**
 * Item catalog and equipment-slot definitions for claude-buddy's idle-RPG
 * layer (design-rpg Phase 1).
 *
 * Dependency-free by design: this module owns the data types (`Slot`, `Item`,
 * `Equipment`) and the catalog, so both `equipment.ts` (pure logic) and `xp.ts`
 * (persistence) can import from it without forming a cycle.
 *
 * Items reuse the engine's `Rarity`/`Hat`/`StatName` vocabulary and the same
 * declarative effect shape as upgrades (`UpgradeEffect`). Unlike upgrades —
 * which are *applied* into the companion at buy-time — item effects are
 * interpreted on read by `resolveAppearance` (derive-on-read), so equipping is
 * freely reversible and never mutates `bones`.
 */

import type { Hat, Rarity } from "./engine";
import type { UpgradeEffect } from "./xp";

// ─── Slots ──────────────────────────────────────────────────────────────────

/** The fixed equipment slots a buddy can fill. One item per slot. */
export const SLOTS = ["weapon", "headgear", "trinket"] as const;
export type Slot = (typeof SLOTS)[number];

export type ItemId = string;

/** Per-slot loadout. An absent slot is empty (today's appearance). */
export interface Equipment {
  weapon?: ItemId;
  headgear?: ItemId;
  trinket?: ItemId;
}

// ─── Items ────────────────────────────────────────────────────────────────────

export interface Item {
  id: ItemId;
  slot: Slot;
  name: string;
  /** Single status-line glyph (kept narrow; combat glyphs land in Phase 4). */
  icon: string;
  /** Reuses the engine rarity for ★ display and (later) drop weighting. */
  rarity: Rarity;
  /** Skill-point price — consumed by the Phase 2 merchant, unused in Phase 1. */
  cost: number;
  /**
   * Declarative effect, interpreted by `resolveAppearance` on read (NOT applied
   * into the companion). `headgear` items use a `hat` effect; trinkets use
   * `flag`/`shiny`; gear may add a small `stat` bonus (flavor, not power creep).
   */
  effect?: UpgradeEffect;
  /**
   * Narrow glyph composited onto the sprite in geared renders: weapons read as
   * held beside the body, trinkets rest at the buddy's feet (anchor cells are
   * per-species, see art.ts `GEAR_ANCHORS`). Headgear renders via its `hat`
   * effect instead.
   */
  art?: string;
  /** Flavor line for the loadout card. */
  blurb?: string;
  /** Minimum buddy level to purchase at the merchant. Omitted ⇒ from level 1. */
  level?: number;
}

/**
 * The starter catalog — small and cosmetic-first (design-rpg OQ5). The two
 * `common` items are seeded into a fresh inventory so equipment is exercisable
 * before the merchant (Phase 2) and drops (Phase 3) exist.
 */
export const ITEMS: readonly Item[] = [
  {
    id: "rubber_duck",
    slot: "trinket",
    name: "Rubber Duck",
    icon: "\u{1F986}", // 🦆
    rarity: "common",
    cost: 1,
    art: ",>",
    effect: { type: "flag", flag: "trinket_duck" },
    blurb: "A loyal debugging companion. Quacks at race conditions.",
  },
  {
    id: "debug_wand",
    slot: "weapon",
    name: "Debug Wand",
    icon: "✨",
    rarity: "common",
    cost: 1,
    art: "/",
    blurb: "Points at the bug. Does not fix it for you.",
  },
  {
    id: "foam_sword",
    slot: "weapon",
    name: "Foam Sword",
    icon: "⚔", // ⚔
    rarity: "uncommon",
    cost: 3,
    art: "†", // †
    effect: { type: "stat", amount: 1 },
    blurb: "Soft, but you swing it with conviction.",
    level: 3,
  },
  {
    id: "lucky_hat",
    slot: "headgear",
    name: "Lucky Beanie",
    icon: "\u{1F9E2}", // 🧢
    rarity: "uncommon",
    cost: 3,
    effect: { type: "hat", hat: "beanie" },
    blurb: "Overlays your innate hat. Statistically warmer.",
    level: 3,
  },
  {
    id: "compiler_crown",
    slot: "headgear",
    name: "Compiler Crown",
    icon: "\u{1F451}", // 👑
    rarity: "rare",
    cost: 6,
    effect: { type: "hat", hat: "crown" },
    blurb: "Worn by those who have appeased the type checker.",
    level: 6,
  },
] as const;

/** Ids seeded into a fresh buddy's inventory (design-rpg-phase1 §3.3). */
export const STARTER_INVENTORY: readonly ItemId[] = ["rubber_duck", "debug_wand"];

// ─── Lookups ────────────────────────────────────────────────────────────────

/** The item with this id, or undefined if it isn't in the catalog. */
export function findItem(
  id: ItemId,
  catalog: readonly Item[] = ITEMS,
): Item | undefined {
  return catalog.find((i) => i.id === id);
}

/** ★-string for an item's rarity, e.g. "★★" for uncommon. */
export function itemStars(item: Item): string {
  // RARITY_STARS lives in engine; importing the const would be a value import.
  // Keep items.ts dependency-free and derive the count from the rarity index.
  const order: Record<Rarity, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
  };
  return "★".repeat(order[item.rarity]);
}
