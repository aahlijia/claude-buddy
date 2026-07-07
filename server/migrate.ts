/**
 * One-time migration folding upgrade effects baked into companion bones
 * (docs/game-feel/idle-rpg/design-derive-upgrades.md, D3 "clean-break
 * rebase") into the new derive-on-read model. Ownership (`unlockedUpgrades`)
 * stays untouched — this only subtracts/resets the *display-mutation*
 * side effects `applyUpgradeEffect` baked into `companion.bones` before
 * derive-on-read existed, so re-deriving them on top doesn't double-count.
 *
 * `migrateUpgradeEffects` is invoked from `loadXpState()` once wired
 * (Phase 3 of the design) — inert until then. Companion/loot-store access
 * is lazy-required (guarded try/catch), the same cross-module idiom xp.ts
 * already uses elsewhere, so this module stays free of a static import
 * cycle back into state.ts.
 */
import type { Companion, Hat } from "./engine.ts";
import type { LootCosmetic } from "./loot.ts";
import { ownedUpgradeEffects, type UpgradeEffect, type XpState } from "./xp.ts";

/** A companion shape good enough to probe a loot cosmetic's `apply()`. */
function probeCompanion(): Companion {
  return {
    name: "probe",
    personality: "",
    hatchedAt: 0,
    userId: "",
    bones: {
      rarity: "common",
      species: "cactus",
      eye: "·",
      hat: "none",
      shiny: false,
      stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
      peak: "SNARK",
      dump: "WISDOM",
    },
  };
}

/**
 * Which hats/shiny an *owned* loot-cosmetic pool can independently grant.
 * Determined by simulation (each owned id applied to a fresh probe) rather
 * than a hardcoded id list, so a new loot cosmetic never needs a migration
 * update. Pure.
 */
export function lootGrantedAppearance(
  ownedLootCosmetics: readonly string[],
  catalog: readonly LootCosmetic[],
): { lootHats: Set<Hat>; lootShiny: boolean } {
  const lootHats = new Set<Hat>();
  let lootShiny = false;
  for (const id of ownedLootCosmetics) {
    const cosmetic = catalog.find((c) => c.id === id);
    if (!cosmetic) continue;
    const probe = probeCompanion();
    cosmetic.apply(probe);
    if (probe.bones.hat !== "none") lootHats.add(probe.bones.hat);
    if (probe.bones.shiny) lootShiny = true;
  }
  return { lootHats, lootShiny };
}

/**
 * Rebase one companion's baked-in bones against a set of owned upgrade
 * effects (D3). Mutates `companion` in place — this is the deliberate,
 * one-time exception to the "bones are never mutated by upgrades" rule that
 * the migration itself exists to establish going forward. Pure otherwise (no
 * I/O); the caller persists.
 *
 * - Hat: an owned-upgrade hat is stripped back to "none" unless an owned
 *   loot cosmetic independently grants the same hat (loot is innate; a
 *   later upgrade refund must not strip it).
 * - Shiny: undone only when the aura marker is present, no owned loot
 *   cosmetic independently grants shiny, and this slot is currently shiny
 *   (skips naturally-shiny buddies with no aura purchase).
 * - Stat: only the active slot ever received the mutation at purchase time,
 *   so only it gets the subtraction — clamped to 1..100 like the resolver.
 *   Known imprecision: a purchase that clamped on-apply under-subtracts by
 *   the clamped remainder (requires peak >= 96 at buy time).
 */
export function rebaseCompanionBones(
  companion: Companion,
  stripAuraShiny: boolean,
  effects: readonly UpgradeEffect[],
  isActive: boolean,
  lootHats: ReadonlySet<Hat>,
): void {
  const ownedHats = new Set<Hat>(
    effects
      .filter((e): e is Extract<UpgradeEffect, { type: "hat" }> => e.type === "hat")
      .map((e) => e.hat),
  );
  const statTotal = effects
    .filter((e): e is Extract<UpgradeEffect, { type: "stat" }> => e.type === "stat")
    .reduce((sum, e) => sum + e.amount, 0);

  if (ownedHats.has(companion.bones.hat) && !lootHats.has(companion.bones.hat)) {
    companion.bones.hat = "none";
  }

  if (stripAuraShiny && companion.bones.shiny) {
    companion.bones.shiny = false;
  }

  if (isActive && statTotal > 0) {
    companion.bones.stats[companion.bones.peak] = Math.max(
      1,
      Math.min(100, companion.bones.stats[companion.bones.peak] - statTotal),
    );
  }
}

/**
 * Entry point: rebase every un-migrated companion slot against `state`'s
 * owned upgrades, then mark the state migrated. No-op (same reference) once
 * `upgradeEffectsDerived` is already true. Crash-safe/idempotent: each slot
 * is flagged (`effectsRebased`) and persisted individually before the state
 * marker is set, so a crash mid-run re-enters and only touches un-flagged
 * slots on the next call.
 */
export function migrateUpgradeEffects(state: XpState): XpState {
  if (state.upgradeEffectsDerived) return state;

  const effects = ownedUpgradeEffects(state);
  const ownedFlags = new Set(
    effects
      .filter((e): e is Extract<UpgradeEffect, { type: "flag" }> => e.type === "flag")
      .map((e) => e.flag),
  );
  let cosmeticFlags = state.cosmeticFlags.filter((f) => !ownedFlags.has(f));

  const { lootHats, lootShiny } = loadOwnedLootAppearance();
  const stripAuraShiny = cosmeticFlags.includes("aura_shiny") && !lootShiny;
  if (stripAuraShiny) {
    cosmeticFlags = cosmeticFlags.filter((f) => f !== "aura_shiny");
  }

  try {
    const { listCompanionSlots, loadActiveSlot, updateCompanionSlot } =
      require("./state.ts") as typeof import("./state.ts");
    const activeSlot = loadActiveSlot();
    for (const { slot, companion } of listCompanionSlots()) {
      if (companion.effectsRebased) continue;
      rebaseCompanionBones(
        companion,
        stripAuraShiny,
        effects,
        slot === activeSlot,
        lootHats,
      );
      companion.effectsRebased = true;
      updateCompanionSlot(slot, companion);
    }
  } catch {
    // Menagerie state is optional during first install / version skew —
    // nothing to rebase if there's no companion store yet.
  }

  return { ...state, cosmeticFlags, upgradeEffectsDerived: true };
}

function loadOwnedLootAppearance(): { lootHats: Set<Hat>; lootShiny: boolean } {
  try {
    const { loadLoot, LOOT_COSMETICS } =
      require("./loot.ts") as typeof import("./loot.ts");
    return lootGrantedAppearance(loadLoot().ownedLootCosmetics, LOOT_COSMETICS);
  } catch {
    return { lootHats: new Set(), lootShiny: false };
  }
}
