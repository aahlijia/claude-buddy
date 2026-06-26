/**
 * Equipment logic for claude-buddy's idle-RPG layer (design-rpg Phase 1).
 *
 * Pure core: equip / unequip / swap operate on plain `Equipment` + `inventory`
 * values and return fresh copies (no in-place mutation), so they compose
 * cleanly and unit-test as data assertions. `resolveAppearance` folds the
 * buddy's innate `bones` and equipped items into a display view **without ever
 * mutating bones** — this is the design's no-clobber / no-drift guarantee.
 *
 * Persistence lives in xp.ts (next to the other xp.json writers); this file
 * stays free of I/O.
 */

import type { BuddyBones, BuddyStats, Hat } from "./engine";
import {
  ITEMS,
  SLOTS,
  findItem,
  itemStars,
  type Equipment,
  type Item,
  type ItemId,
  type Slot,
} from "./items";

// ─── Pure equip / unequip ─────────────────────────────────────────────────────

export interface EquipOutcome {
  ok: boolean;
  message: string;
  /** Next loadout (unchanged on failure). */
  equipment: Equipment;
  /** Next inventory (unchanged on failure). */
  inventory: ItemId[];
}

/** Validation message for equipping `id` from `inventory`, or null when allowed. */
export function equipError(
  inventory: readonly ItemId[],
  id: ItemId,
  catalog: readonly Item[] = ITEMS,
): string | null {
  const item = findItem(id, catalog);
  if (!item) return `Unknown item "${id}".`;
  if (!inventory.includes(id)) return `${item.name} isn't in your inventory.`;
  return null;
}

/**
 * Equip an owned item into its slot. Any current occupant of that slot returns
 * to inventory (swap). No-op (ok) when the item is already equipped. Inputs are
 * never mutated — fresh copies are returned.
 */
export function equipItem(
  equipment: Equipment,
  inventory: readonly ItemId[],
  id: ItemId,
  catalog: readonly Item[] = ITEMS,
): EquipOutcome {
  const item = findItem(id, catalog);
  const err = equipError(inventory, id, catalog);
  if (err || !item) {
    return {
      ok: false,
      message: err ?? `Unknown item "${id}".`,
      equipment,
      inventory: [...inventory],
    };
  }

  const slot = item.slot;
  if (equipment[slot] === id) {
    return {
      ok: true,
      message: `${item.name} is already equipped.`,
      equipment: { ...equipment },
      inventory: [...inventory],
    };
  }

  const nextInventory = inventory.filter((x) => x !== id);
  const displaced = equipment[slot];
  if (displaced) nextInventory.push(displaced);

  return {
    ok: true,
    message: `Equipped ${item.name}${
      displaced ? ` (swapped out ${findItem(displaced, catalog)?.name ?? displaced})` : ""
    }.`,
    equipment: { ...equipment, [slot]: id },
    inventory: nextInventory,
  };
}

/** Unequip whatever is in `slot` back to inventory. No-op (ok) when empty. */
export function unequipSlot(
  equipment: Equipment,
  inventory: readonly ItemId[],
  slot: Slot,
  catalog: readonly Item[] = ITEMS,
): EquipOutcome {
  const current = equipment[slot];
  if (!current) {
    return {
      ok: true,
      message: `Nothing equipped in ${slot}.`,
      equipment: { ...equipment },
      inventory: [...inventory],
    };
  }
  const next: Equipment = { ...equipment };
  delete next[slot];
  return {
    ok: true,
    message: `Unequipped ${findItem(current, catalog)?.name ?? current}.`,
    equipment: next,
    inventory: [...inventory, current],
  };
}

// ─── Appearance resolver (derive-on-read) ─────────────────────────────────────

export interface ResolvedAppearance {
  /** Equipped headgear overrides the innate hat; falls back to bones.hat. */
  hat: Hat;
  /** Equipped weapon's art glyph, or "" when no weapon. */
  weaponArt: string;
  /** innate shiny ∨ any item shiny effect. */
  shiny: boolean;
  /** innate cosmeticFlags ∪ item flag effects (deduped). */
  flags: string[];
  /** base bones.stats + Σ item stat bonuses (on the peak stat), clamped 1..100. */
  stats: BuddyStats;
}

/**
 * Fold innate identity + equipped items into a display view. Pure and
 * idempotent: `bones` is read-only, so equip→unequip→equip yields identical
 * output (no drift) and the innate hat is never clobbered (no-clobber).
 *
 * Items are read in slot order (weapon, headgear, trinket) for stable stacking.
 */
export function resolveAppearance(
  bones: BuddyBones,
  equipment: Equipment,
  cosmeticFlags: readonly string[] = [],
  catalog: readonly Item[] = ITEMS,
): ResolvedAppearance {
  let hat: Hat = bones.hat;
  let weaponArt = "";
  let shiny = bones.shiny;
  const flags = new Set<string>(cosmeticFlags);
  const stats: BuddyStats = { ...bones.stats };

  for (const slot of SLOTS) {
    const id = equipment[slot];
    if (!id) continue;
    const item = findItem(id, catalog);
    if (!item) continue;
    if (item.art && slot === "weapon") weaponArt = item.art;
    const effect = item.effect;
    if (!effect) continue;
    switch (effect.type) {
      case "hat":
        hat = effect.hat;
        break;
      case "shiny":
        shiny = true;
        break;
      case "flag":
        flags.add(effect.flag);
        break;
      case "stat":
        stats[bones.peak] = Math.max(
          1,
          Math.min(100, stats[bones.peak] + effect.amount),
        );
        break;
    }
  }

  return { hat, weaponArt, shiny, flags: [...flags], stats };
}

/**
 * A `bones`-shaped view with equipment folded in, for passing to the existing
 * card renderer without teaching it about equipment. The innate `bones` is
 * untouched; this is a fresh object.
 */
export function gearedBones(
  bones: BuddyBones,
  equipment: Equipment,
  cosmeticFlags: readonly string[] = [],
  catalog: readonly Item[] = ITEMS,
): BuddyBones {
  const a = resolveAppearance(bones, equipment, cosmeticFlags, catalog);
  return { ...bones, hat: a.hat, shiny: a.shiny, stats: a.stats };
}

// ─── Loadout card ─────────────────────────────────────────────────────────────

const SLOT_LABEL: Record<Slot, string> = {
  weapon: "⚔ Weapon  ",
  headgear: "🎩 Headgear",
  trinket: "🔮 Trinket ",
};

/** Markdown loadout card for `buddy_equip` (mirrors the buddy_upgrades style). */
export function renderLoadoutCard(
  name: string,
  equipment: Equipment,
  inventory: readonly ItemId[],
  catalog: readonly Item[] = ITEMS,
): string {
  const lines: string[] = [];
  lines.push(`### 🎒 ${name}'s Loadout`);
  lines.push("");
  for (const slot of SLOTS) {
    const id = equipment[slot];
    const item = id ? findItem(id, catalog) : undefined;
    const body = item
      ? `${item.name} ${itemStars(item)}  \`${item.id}\``
      : "_(empty)_";
    lines.push(`- ${SLOT_LABEL[slot]} — ${body}`);
  }
  lines.push("");
  if (inventory.length > 0) {
    const inv = inventory
      .map((id) => {
        const item = findItem(id, catalog);
        return item
          ? `${item.name} ${itemStars(item)} \`${item.id}\``
          : `\`${id}\``;
      })
      .join(" · ");
    lines.push(`**Inventory:** ${inv}`);
  } else {
    lines.push("**Inventory:** _(empty)_");
  }
  lines.push("");
  lines.push(
    "Equip with `buddy_equip equip=<id>`, remove with `buddy_equip unequip=<slot>`.",
  );
  return lines.join("\n");
}
