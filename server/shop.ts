/**
 * Merchant logic for claude-buddy's idle-RPG layer (design-rpg Phase 2).
 *
 * Pure: classifies catalog items by buy-status against a wallet/level snapshot,
 * renders the shop card, and produces the interactive choice list. Buying spends
 * skill points (one shared economy — design-rpg locked decision); the actual
 * debit/grant/persist lives in xp.ts (`buyShopItem`), next to `spendUnlock`.
 *
 * `XpState` is imported type-only, so this file forms no runtime cycle with
 * xp.ts (which imports `buyError` as a value).
 */

import type { XpState } from "./xp";
import type { NavAsk } from "./menu";
import {
  ITEMS,
  SLOTS,
  findItem,
  itemStars,
  type Equipment,
  type Item,
  type ItemId,
} from "./items";

/** The wallet/level snapshot the shop reasons about. */
export interface ShopState {
  level: number;
  inventory: readonly ItemId[];
  equipment: Equipment;
  available: number;
}

/** Narrow an XpState into the shop snapshot (used by callers/tests). */
export function shopStateOf(state: XpState, available: number): ShopState {
  return {
    level: state.level,
    inventory: state.inventory,
    equipment: state.equipment,
    available,
  };
}

export type BuyStatus = "owned" | "affordable" | "tooPoor" | "locked";

export interface ShopRow {
  item: Item;
  status: BuyStatus;
  /** Short reason/price for the card (e.g. "Lvl 6", "6 pt", "owned"). */
  note: string;
}

/** Items the player owns: everything in inventory plus everything equipped. */
export function ownedItems(
  inventory: readonly ItemId[],
  equipment: Equipment,
): Set<ItemId> {
  const owned = new Set<ItemId>(inventory);
  for (const slot of SLOTS) {
    const id = equipment[slot];
    if (id) owned.add(id);
  }
  return owned;
}

/**
 * Validation message for buying `id`, or null when the purchase is allowed.
 * Precedence: unknown id → already owned → level gate → affordability.
 */
export function buyError(
  state: ShopState,
  id: ItemId,
  catalog: readonly Item[] = ITEMS,
): string | null {
  const item = findItem(id, catalog);
  if (!item) return `Unknown item "${id}".`;
  if (ownedItems(state.inventory, state.equipment).has(id)) {
    return `You already own ${item.name}.`;
  }
  if (item.level && state.level < item.level) {
    return `${item.name} unlocks at level ${item.level} — you're ${state.level}.`;
  }
  if (state.available < item.cost) {
    return `${item.name} costs ${item.cost} pt — you have ${state.available}.`;
  }
  return null;
}

/** Per-item buy status (the card/choices reason about this, never re-deriving). */
export function buyStatus(state: ShopState, item: Item): BuyStatus {
  if (ownedItems(state.inventory, state.equipment).has(item.id)) return "owned";
  if (item.level && state.level < item.level) return "locked";
  if (state.available < item.cost) return "tooPoor";
  return "affordable";
}

/** The full catalog annotated with buy-status, sorted level→cost (mirrors the
 *  buddy_upgrades catalog sort). Pure → snapshot-testable. */
export function shopListing(
  state: ShopState,
  catalog: readonly Item[] = ITEMS,
): ShopRow[] {
  return [...catalog]
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.cost - b.cost)
    .map((item) => {
      const status = buyStatus(state, item);
      const note =
        status === "owned"
          ? "owned"
          : status === "locked"
            ? `Lvl ${item.level}`
            : `${item.cost} pt`;
      return { item, status, note };
    });
}

const STATUS_ICON: Record<BuyStatus, string> = {
  owned: "✅",
  affordable: "🟢",
  tooPoor: "💸",
  locked: "🔒",
};

/** Markdown shop card (mirrors the buddy_upgrades / loadout card style). */
export function renderShopCard(
  name: string,
  rows: readonly ShopRow[],
  available: number,
): string {
  const lines: string[] = [];
  lines.push(`### 🛒 ${name}'s Shop — ${available} skill point(s)`);
  lines.push("_Points are shared with `buddy_upgrades`._");
  lines.push("");
  for (const { item, status, note } of rows) {
    lines.push(
      `${STATUS_ICON[status]} ${note} · ${item.icon} ${item.name} ${itemStars(item)} — ${item.blurb ?? ""}  \`${item.id}\``,
    );
  }
  lines.push("");
  lines.push("Buy with `buddy_shop buy=<id>`.");
  return lines.join("\n");
}

export interface ShopChoice {
  id: ItemId;
  label: string;
  description: string;
}

/** Affordable, unowned, unlocked items — the interactive menu's options. */
export function buyableChoices(rows: readonly ShopRow[]): ShopChoice[] {
  return rows
    .filter((r) => r.status === "affordable")
    .map((r) => ({
      id: r.item.id,
      label: `${r.item.name} ${itemStars(r.item)} (${r.item.cost} pt)`,
      description: r.item.blurb ?? r.item.name,
    }));
}

/**
 * Build the NavAsk for a shop browse: affordable items as interactive options.
 * `value` carries the ItemId (buy arg); `label` is the display string.
 * Returns undefined when nothing is affordable. Capped at 4 (AskUserQuestion
 * bound); the rendered shop card above the marker lists the full catalog.
 */
export function shopAsk(choices: readonly ShopChoice[]): NavAsk | undefined {
  if (choices.length === 0) return undefined;
  return {
    question: "What would you like to buy?",
    header: "Buy",
    multiSelect: false,
    options: choices.slice(0, 4).map((c) => ({
      label: c.label,
      description: c.description,
      value: c.id,
    })),
    then: { tool: "buddy_shop", args: {}, pick_arg: "buy" },
  };
}
