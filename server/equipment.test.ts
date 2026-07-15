import { describe, expect, test } from "bun:test";

import type { BuddyBones } from "./engine";
import { ITEMS } from "./items";
import type { Equipment, ItemId } from "./items";
import {
  equipError,
  equipItem,
  gearArtOf,
  gearedBones,
  renderLoadoutCard,
  resolveAppearance,
  unequipSlot,
} from "./equipment";

function bones(overrides: Partial<BuddyBones> = {}): BuddyBones {
  return {
    rarity: "common",
    species: "cactus",
    eye: "·",
    hat: "tophat", // innate hat — guards the no-clobber test
    shiny: false,
    stats: {
      DEBUGGING: 50,
      PATIENCE: 40,
      CHAOS: 30,
      WISDOM: 20,
      SNARK: 60,
    },
    peak: "SNARK",
    dump: "WISDOM",
    ...overrides,
  };
}

describe("equipItem / unequipSlot (pure)", () => {
  test("equips an inventory item into its slot", () => {
    const r = equipItem({}, ["debug_wand"], "debug_wand");
    expect(r.ok).toBe(true);
    expect(r.equipment.weapon).toBe("debug_wand");
    expect(r.inventory).toEqual([]);
  });

  test("rejects an item not in inventory", () => {
    const r = equipItem({}, [], "debug_wand");
    expect(r.ok).toBe(false);
    expect(r.equipment).toEqual({});
    expect(r.inventory).toEqual([]);
  });

  test("rejects an unknown item id", () => {
    const r = equipItem({}, ["mystery"], "mystery");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Unknown");
  });

  test("swaps the occupant of a slot back to inventory", () => {
    const r = equipItem(
      { weapon: "debug_wand" },
      ["foam_sword"],
      "foam_sword",
    );
    expect(r.ok).toBe(true);
    expect(r.equipment.weapon).toBe("foam_sword");
    expect(r.inventory).toContain("debug_wand");
    expect(r.inventory).not.toContain("foam_sword");
  });

  test("equipping an already-equipped item is an idempotent no-op", () => {
    const r = equipItem(
      { weapon: "debug_wand" },
      ["debug_wand"],
      "debug_wand",
    );
    expect(r.ok).toBe(true);
    expect(r.equipment.weapon).toBe("debug_wand");
    // inventory keeps its copy; nothing was consumed twice
    expect(r.inventory).toEqual(["debug_wand"]);
  });

  test("unequip returns the item to inventory", () => {
    const r = unequipSlot({ weapon: "debug_wand" }, [], "weapon");
    expect(r.ok).toBe(true);
    expect(r.equipment.weapon).toBeUndefined();
    expect(r.inventory).toEqual(["debug_wand"]);
  });

  test("unequip of an empty slot is a no-op", () => {
    const r = unequipSlot({}, ["x"], "headgear");
    expect(r.ok).toBe(true);
    expect(r.equipment).toEqual({});
    expect(r.inventory).toEqual(["x"]);
  });

  test("inputs are never mutated", () => {
    const eq: Equipment = { weapon: "debug_wand" };
    const inv: ItemId[] = ["foam_sword"];
    equipItem(eq, inv, "foam_sword");
    expect(eq).toEqual({ weapon: "debug_wand" });
    expect(inv).toEqual(["foam_sword"]);
  });

  test("equipError surfaces the validation reason", () => {
    expect(equipError([], "debug_wand")).toContain("inventory");
    expect(equipError(["debug_wand"], "debug_wand")).toBeNull();
  });
});

describe("resolveAppearance (derive-on-read)", () => {
  test("equipped headgear overlays without clobbering innate hat", () => {
    const b = bones({ hat: "tophat" });
    const a = resolveAppearance(b, { headgear: "lucky_hat" });
    expect(a.hat).toBe("beanie"); // overlaid
    expect(b.hat).toBe("tophat"); // innate bones untouched
  });

  test("unequipping restores the innate hat exactly (no clobber)", () => {
    const b = bones({ hat: "crown" });
    const equipped = resolveAppearance(b, { headgear: "lucky_hat" });
    const removed = resolveAppearance(b, {});
    expect(equipped.hat).toBe("beanie");
    expect(removed.hat).toBe("crown");
  });

  test("stat gear adds to the peak stat, clamped at 100", () => {
    const b = bones({ peak: "DEBUGGING", stats: { ...bones().stats, DEBUGGING: 99 } });
    const a = resolveAppearance(b, { weapon: "foam_sword" }); // stat:+1
    expect(a.stats.DEBUGGING).toBe(100); // 99 + 1, clamped
  });

  test("equip → unequip → equip yields identical stats (no drift)", () => {
    const b = bones({ peak: "DEBUGGING" });
    const base = b.stats.DEBUGGING;
    const once = resolveAppearance(b, { weapon: "foam_sword" }).stats.DEBUGGING;
    resolveAppearance(b, {}); // unequip view
    const twice = resolveAppearance(b, { weapon: "foam_sword" }).stats.DEBUGGING;
    expect(once).toBe(base + 1);
    expect(twice).toBe(once); // immutable base ⇒ no accumulation
    expect(b.stats.DEBUGGING).toBe(base); // bones never mutated
  });

  test("weapon art and trinket flag surface in the resolved view", () => {
    const a = resolveAppearance(bones(), {
      weapon: "debug_wand",
      trinket: "rubber_duck",
    });
    expect(a.weaponArt).toBe("/");
    expect(a.flags).toContain("trinket_duck");
  });

  test("trinket art surfaces in the resolved view; empty slots yield \"\"", () => {
    const a = resolveAppearance(bones(), { trinket: "rubber_duck" });
    expect(a.trinketArt).toBe(",>");
    expect(a.weaponArt).toBe("");
    const bare = resolveAppearance(bones(), {});
    expect(bare.trinketArt).toBe("");
  });

  test("gearArtOf maps art glyphs to GearArt and collapses a bare loadout", () => {
    const geared = resolveAppearance(bones(), {
      weapon: "foam_sword",
      trinket: "rubber_duck",
    });
    expect(gearArtOf(geared)).toEqual({ weapon: "†", trinket: ",>" });
    // Weapon-only: the empty trinket becomes undefined, not "".
    const swordOnly = resolveAppearance(bones(), { weapon: "foam_sword" });
    expect(gearArtOf(swordOnly)).toEqual({ weapon: "†", trinket: undefined });
    // Nothing renders ⇒ undefined so callers can pass it straight through.
    expect(gearArtOf(resolveAppearance(bones(), {}))).toBeUndefined();
    // Headgear alone has no overlay glyph (it renders via the hat effect).
    expect(
      gearArtOf(resolveAppearance(bones(), { headgear: "lucky_hat" })),
    ).toBeUndefined();
  });

  test("innate cosmetic flags are preserved and merged", () => {
    const a = resolveAppearance(bones(), { trinket: "rubber_duck" }, ["aura_shiny"]);
    expect(a.flags).toContain("aura_shiny");
    expect(a.flags).toContain("trinket_duck");
  });

  test("default upgradeEffects ([]) is byte-identical to omitting the param", () => {
    const b = bones();
    const withDefault = resolveAppearance(b, { headgear: "lucky_hat" }, ["x"]);
    const explicitEmpty = resolveAppearance(b, { headgear: "lucky_hat" }, ["x"], ITEMS, []);
    expect(explicitEmpty).toEqual(withDefault);
  });
});

describe("resolveAppearance (upgrade effects, derive-on-read Phase 1)", () => {
  test("upgrade hats fold in purchase order — later purchase wins", () => {
    const a = resolveAppearance(bones(), {}, [], ITEMS, [
      { type: "hat", hat: "tinyduck" },
      { type: "hat", hat: "crown" },
    ]);
    expect(a.hat).toBe("crown");
  });

  test("equipped headgear overrides an owned upgrade hat", () => {
    const a = resolveAppearance(
      bones(),
      { headgear: "lucky_hat" },
      [],
      ITEMS,
      [{ type: "hat", hat: "crown" }],
    );
    expect(a.hat).toBe("beanie"); // equipment folds last, wins
  });

  test("upgrade and item stat effects both sum onto the peak stat, clamped at 100", () => {
    const b = bones({
      peak: "DEBUGGING",
      stats: { ...bones().stats, DEBUGGING: 97 },
    });
    const a = resolveAppearance(
      b,
      { weapon: "foam_sword" }, // stat:+1
      [],
      ITEMS,
      [{ type: "stat", amount: 3 }],
    );
    expect(a.stats.DEBUGGING).toBe(100); // 97 + 3 clamped to 100, + 1 stays 100
    expect(b.stats.DEBUGGING).toBe(97); // innate bones untouched
  });

  test("an owned shiny upgrade ORs onto innate shiny and implies aura_shiny", () => {
    const b = bones({ shiny: false });
    const a = resolveAppearance(b, {}, [], ITEMS, [{ type: "shiny" }]);
    expect(a.shiny).toBe(true);
    expect(a.flags).toContain("aura_shiny");
    expect(b.shiny).toBe(false); // innate bones untouched
  });

  test("upgrade flags union with innate cosmetic flags", () => {
    const a = resolveAppearance(bones(), {}, ["existing_flag"], ITEMS, [
      { type: "flag", flag: "has_third_eye" },
    ]);
    expect(a.flags).toContain("existing_flag");
    expect(a.flags).toContain("has_third_eye");
  });
});

describe("gearedBones", () => {
  test("produces a fresh bones view with resolved hat/stats", () => {
    const b = bones({ hat: "tophat", peak: "DEBUGGING" });
    const g = gearedBones(b, { headgear: "lucky_hat", weapon: "foam_sword" });
    expect(g.hat).toBe("beanie");
    expect(g.stats.DEBUGGING).toBe(b.stats.DEBUGGING + 1);
    expect(g).not.toBe(b);
    expect(b.hat).toBe("tophat");
  });
});

describe("renderLoadoutCard", () => {
  test("shows equipped slots, inventory, and empties", () => {
    const card = renderLoadoutCard(
      "Waffle",
      { weapon: "debug_wand" },
      ["foam_sword"],
    );
    expect(card).toContain("Waffle's Loadout");
    expect(card).toContain("Debug Wand");
    expect(card).toContain("_(empty)_"); // headgear + trinket empty
    expect(card).toContain("Foam Sword");
  });

  test("notes an empty inventory", () => {
    const card = renderLoadoutCard("Waffle", {}, []);
    expect(card).toContain("**Inventory:** _(empty)_");
  });
});
