import { describe, expect, test } from "bun:test";

import { ITEMS, type Equipment, type ItemId } from "./items";
import {
  buyError,
  buyStatus,
  buyableChoices,
  shopAsk,
  ownedItems,
  renderShopCard,
  shopListing,
  type ShopState,
} from "./shop";

function state(overrides: Partial<ShopState> = {}): ShopState {
  return {
    level: 20,
    inventory: [],
    equipment: {},
    available: 100,
    ...overrides,
  };
}

describe("ownedItems", () => {
  test("unions inventory and every equipped slot", () => {
    const inv: ItemId[] = ["rubber_duck"];
    const eq: Equipment = { weapon: "debug_wand", headgear: "lucky_hat" };
    const owned = ownedItems(inv, eq);
    expect(owned.has("rubber_duck")).toBe(true);
    expect(owned.has("debug_wand")).toBe(true);
    expect(owned.has("lucky_hat")).toBe(true);
    expect(owned.size).toBe(3);
  });
});

describe("buyError precedence", () => {
  test("unknown id first", () => {
    expect(buyError(state(), "nope")).toContain("Unknown");
  });

  test("already owned (in inventory)", () => {
    expect(buyError(state({ inventory: ["foam_sword"] }), "foam_sword")).toContain(
      "already own",
    );
  });

  test("already owned (equipped) is blocked too", () => {
    const s = state({ equipment: { weapon: "foam_sword" } });
    expect(buyError(s, "foam_sword")).toContain("already own");
  });

  test("level gate before affordability", () => {
    // compiler_crown: level 6, cost 6 — low level + plenty of points
    const s = state({ level: 1, available: 100 });
    expect(buyError(s, "compiler_crown")).toContain("level 6");
  });

  test("affordability when level is met", () => {
    const s = state({ level: 20, available: 2 }); // foam_sword costs 3
    expect(buyError(s, "foam_sword")).toContain("costs 3");
  });

  test("null when allowed", () => {
    expect(buyError(state(), "foam_sword")).toBeNull();
  });
});

describe("buyStatus / shopListing", () => {
  test("classifies owned, affordable, tooPoor, locked", () => {
    const s = state({
      level: 3,
      available: 3,
      inventory: ["rubber_duck"],
    });
    const byId = Object.fromEntries(
      shopListing(s).map((r) => [r.item.id, r.status]),
    );
    expect(byId.rubber_duck).toBe("owned");
    expect(byId.foam_sword).toBe("affordable"); // lvl 3, cost 3, have 3
    expect(byId.compiler_crown).toBe("locked"); // lvl 6 > 3
    // debug_wand is cost 1 → affordable; lucky_hat lvl3 cost3 → affordable
    expect(byId.debug_wand).toBe("affordable");
  });

  test("tooPoor when level met but points short", () => {
    const s = state({ level: 6, available: 0 });
    expect(buyStatus(s, ITEMS.find((i) => i.id === "compiler_crown")!)).toBe(
      "tooPoor",
    );
  });

  test("sorted by level then cost", () => {
    const rows = shopListing(state());
    const levels = rows.map((r) => r.item.level ?? 0);
    const sorted = [...levels].sort((a, b) => a - b);
    expect(levels).toEqual(sorted);
  });
});

describe("buyableChoices", () => {
  test("includes only affordable, unowned, unlocked items", () => {
    const s = state({ level: 3, available: 3, inventory: ["debug_wand"] });
    const ids = buyableChoices(shopListing(s)).map((c) => c.id);
    expect(ids).toContain("foam_sword");
    expect(ids).toContain("lucky_hat");
    expect(ids).not.toContain("debug_wand"); // owned
    expect(ids).not.toContain("compiler_crown"); // locked
  });
});

describe("shopAsk", () => {
  test("returns undefined when nothing is buyable", () => {
    const broke = state({ available: 0, level: 1 });
    expect(shopAsk(buyableChoices(shopListing(broke)))).toBeUndefined();
  });

  test("builds a NavAsk with value=ItemId and buddy_shop continuation", () => {
    const choices = buyableChoices(shopListing(state()));
    const ask = shopAsk(choices)!;
    expect(ask).toBeDefined();
    expect(ask.then.tool).toBe("buddy_shop");
    expect(ask.then.pick_arg).toBe("buy");
    expect(ask.then.args).toEqual({});
    expect(ask.multiSelect).toBe(false);
    // value carries the ItemId (not the display label)
    for (const [i, opt] of ask.options.entries()) {
      expect(opt.value).toBe(choices[i].id);
      expect(opt.label).toBe(choices[i].label);
      expect(opt.description).toBe(choices[i].description);
    }
  });

  test("caps options at 4 (AskUserQuestion bound)", () => {
    // Synthesize >4 affordable choices to verify the cap.
    const many: import("./shop").ShopChoice[] = Array.from(
      { length: 6 },
      (_, i) => ({ id: `item_${i}` as import("./items").ItemId, label: `Item ${i}`, description: "" }),
    );
    const ask = shopAsk(many)!;
    expect(ask.options).toHaveLength(4);
  });
});

describe("renderShopCard", () => {
  test("shows the shared-economy note, balance, and ids", () => {
    const s = state({ available: 8 });
    const card = renderShopCard("Waffle", shopListing(s), 8);
    expect(card).toContain("Waffle's Shop — 8 skill point(s)");
    expect(card).toContain("shared with `buddy_upgrades`");
    expect(card).toContain("`foam_sword`");
    expect(card).toContain("buddy_shop buy=<id>");
  });
});
