import { describe, expect, test } from "bun:test";

import { HATS, RARITIES } from "./engine";
import {
  ITEMS,
  SLOTS,
  STARTER_INVENTORY,
  findItem,
  itemStars,
  type Item,
} from "./items";

describe("item catalog integrity", () => {
  test("ids are unique", () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every item has a known slot and rarity", () => {
    for (const item of ITEMS) {
      expect(SLOTS).toContain(item.slot);
      expect(RARITIES).toContain(item.rarity);
    }
  });

  test("icons and names are non-empty", () => {
    for (const item of ITEMS) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.cost).toBeGreaterThanOrEqual(0);
    }
  });

  test("headgear effects reference valid engine hats", () => {
    for (const item of ITEMS) {
      if (item.effect?.type === "hat") {
        expect(HATS).toContain(item.effect.hat);
        expect(item.slot).toBe("headgear");
      }
    }
  });

  test("only weapons carry render art", () => {
    for (const item of ITEMS) {
      if (item.art) expect(item.slot).toBe("weapon");
    }
  });

  test("starter inventory ids exist in the catalog", () => {
    for (const id of STARTER_INVENTORY) {
      expect(findItem(id)).toBeDefined();
    }
  });
});

describe("lookups", () => {
  test("findItem returns the matching item or undefined", () => {
    expect(findItem("rubber_duck")?.slot).toBe("trinket");
    expect(findItem("does_not_exist")).toBeUndefined();
  });

  test("itemStars scales with rarity", () => {
    const common: Item = { ...ITEMS[0], rarity: "common" };
    const legendary: Item = { ...ITEMS[0], rarity: "legendary" };
    expect(itemStars(common)).toBe("★");
    expect(itemStars(legendary)).toBe("★★★★★");
  });
});
