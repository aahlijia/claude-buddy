# Design — Idle RPG · Phase 2: Merchant + Interactive Menus

> ✅ **Implemented & tested** (see [`status.md`](status.md)). This is the
> as-designed spec; the build matched it. Files: `server/shop.ts`, `buyShopItem`
> in `xp.ts`, `buddy_shop`, the SHOP-MENU directive in `getInstructions()`.

Status: Component design (output of `/sc:design phase 2`). Detailed spec for the
**second** phase of [[design]]: a **merchant** (`buddy_shop`) that sells the
`items.ts` catalog for **skill points**, and the **interactive selection menu**
("like Claude Code asking for input") that drives browsing/buying. Builds
directly on the Phase 1 equipment system. No combat (Phase 3), no status-line
changes. No production code here; signatures are interface sketches, build with
`/sc:implement`.

Grounded against actual source as of `develop` (post-Phase-1):
`server/items.ts` (`Item`, `ITEMS`, `Item.cost`, `findItem`), `server/xp.ts`
(`availablePoints:612`, `pointsSpent`, `inventory`, `grantItem`, the
`spendUnlock` buy pattern, private `loadXpState`/`saveXpState`),
`server/equipment.ts` (the loadout card style to mirror), and
`server/index.ts` (`getInstructions():105` — the directive channel the assistant
already obeys; `buddy_upgrades:1034` — the catalog-card pattern to mirror).

**Locked decisions** (from [[design]]): **reuse skill points** (one shared
economy, no new currency); **static catalog** first (rotation deferred);
docs-first.

---

## 1. Scope & non-goals

**In scope (Phase 2):**
- A `buddy_shop` tool: browse the catalog (owned / affordable / locked), and buy.
- A pure `shop.ts` (validation + listing + card render) and a thin `buyShopItem`
  I/O wrapper in `xp.ts` (next to `spendUnlock`/`grantItem`).
- The **interactive menu**: a deterministic `buddy:choices` marker emitted by the
  tool + a new `getInstructions()` directive that turns it into an
  `AskUserQuestion`, routing the pick back to `buddy_shop buy=<id>`.
- An optional `level?` gate on items (so rarer cosmetics unlock with progression).

**Explicit non-goals:**
- Earning items from combat (drops) → Phase 3.
- Rendering bought gear on the live status line beyond what Phase 1 already does.
- Selling / refunding items → OQ-P2.1 (deferred; see §11).
- Rotating / daily stock → OQ-P2.2 (static catalog this phase).

---

## 2. What already exists (reuse, don't reinvent)

- **The economy is done.** `availablePoints(state) = pointsTotal + bonusPoints −
  pointsSpent` (`xp.ts:612`). A purchase is just `pointsSpent += cost` — already
  flows through `availablePoints`, the `buddy_xp` card, and backfill clamping.
  **No new currency, no new field.**
- **The grant path is done.** `grantItem(id)` (Phase 1) already validates the id
  and appends to `inventory` (skipping equipped/duplicate). The buy wrapper is
  `grantItem` + a points debit + an ownership check.
- **The buy pattern exists.** `spendUnlock` (`xp.ts:1164`) is the exact template:
  load → validate via a pure `*Error` → mutate → `saveXpState` → return a result.
  `buyShopItem` mirrors it line-for-line.
- **The catalog card exists.** `buddy_upgrades`' listing
  (owned ✅ / locked 🔒 Lvl / affordable 🟢 / too-poor 💸, `xp.ts`/`index.ts:1149`)
  is the shop card, re-skinned for items with rarity stars + blurbs.
- **The directive channel exists.** `getInstructions()` (`index.ts:105`) already
  injects behavior the assistant follows verbatim (NAME REACTIONS, PAIR-
  PROGRAMMING, END-OF-TURN comment). The interactive menu is **one more
  directive** there — not new infrastructure. This is the project's established
  way to make the assistant do something in response to a tool.
- **The item model exists.** `Item` already carries `cost`, `rarity`, `icon`,
  `blurb`, `effect`. Phase 2 adds only an optional `level?` gate.

---

## 3. Economy & ownership model

- **One shared wallet.** Skill points fund upgrades *and* gear. Buying a Foam
  Sword (3 pt) leaves 3 fewer points for `buddy_upgrades`. This is the honest
  consequence of the locked "reuse skill points" decision — the shop card states
  it plainly ("points are shared with `buddy_upgrades`") so the tradeoff is
  visible, and item costs stay modest (1–6 pt) so cosmetics never starve
  progression. Power-bearing gear is capped at `stat:+1..+2` (the no-power-creep
  ceiling), so points spent on gear buy *flavor*, not advantage.
- **Owned = one per account.** An item is *owned* if it sits in `inventory`
  **or** any equipment slot. Owned items can't be re-bought (like upgrades).
  ```ts
  function ownedItems(state: XpState): Set<ItemId>; // inventory ∪ equipped slots
  ```
- **No consumables.** Every catalog item is a durable cosmetic/gear piece.
  (Combat consumables, if ever, are a separate later concern.)

---

## 4. Data-model change (`items.ts`)

Add **one** optional, backfilled field — a level gate so rarer cosmetics arrive
with progression rather than being buyable at level 1:

```ts
export interface Item {
  // ...existing...
  /** Minimum buddy level to purchase. Omitted ⇒ available from level 1. */
  level?: number;
}
```

Suggested gating (tuning is OQ-P2.3): commons ungated; `foam_sword`/`lucky_hat`
~Lvl 3; `compiler_crown` (rare) ~Lvl 6. No new persisted state anywhere — the
shop reads `state.level`, `availablePoints`, `inventory`, `equipment`.

---

## 5. Pure core (`server/shop.ts`)

```ts
export type BuyStatus =
  | "owned"
  | "affordable"
  | "tooPoor"
  | "locked";          // level-gated

export interface ShopRow {
  item: Item;
  status: BuyStatus;
  /** Why it's unbuyable, for the card (e.g. "Lvl 6", "6 pt"). */
  note: string;
}

/** Items owned (inventory ∪ equipped). Pure. */
export function ownedItems(
  inventory: readonly ItemId[],
  equipment: Equipment,
): Set<ItemId>;

/** Validation message for buying `id`, or null when allowed. Order: unknown id →
 *  already owned → level gate → affordability. Mirrors purchaseError's shape. */
export function buyError(
  state: Pick<XpState, "level" | "inventory" | "equipment"> & { available: number },
  id: ItemId,
  catalog?: readonly Item[],
): string | null;

/** The full catalog annotated with per-item buy status, sorted level→cost
 *  (mirrors the buddy_upgrades catalog sort). Pure → snapshot-testable. */
export function shopListing(
  state: Pick<XpState, "level" | "inventory" | "equipment"> & { available: number },
  catalog?: readonly Item[],
): ShopRow[];

/** Markdown shop card (mirrors the buddy_upgrades / loadout card style). */
export function renderShopCard(name: string, rows: ShopRow[], available: number): string;

/** The machine-readable choice list for the interactive menu (§7): affordable,
 *  unowned items only. Empty when nothing is buyable. */
export function buyableChoices(rows: ShopRow[]): {
  id: ItemId; label: string; description: string;
}[];
```

`shop.ts` imports only `items.ts` + the `XpState` *type* — no I/O, no cycle.

---

## 6. I/O wrapper (`server/xp.ts`, beside `spendUnlock`/`grantItem`)

```ts
export interface BuyResult { ok: boolean; message: string; state: XpState; }

/** Buy a catalog item with skill points: validate via shop.buyError, debit
 *  pointsSpent, grant to inventory, persist on success. The shop analog of
 *  spendUnlock — same load→validate→mutate→save shape. */
export function buyShopItem(id: ItemId): BuyResult;
```

Behavior: `loadXpState()` → `buyError({level, inventory, equipment, available:
availablePoints(state)}, id)`; on pass, `state.pointsSpent += item.cost`,
`state.inventory.push(id)`, `saveXpState`. Returns the new balance in `message`.
No companion mutation (gear is derive-on-read from Phase 1).

---

## 7. The interactive menu (the "like Claude Code asking" part)

**Why it needs a convention.** An MCP tool returns `{ content }` — it **cannot**
invoke `AskUserQuestion`; only the assistant can. So the interactivity lives at
the assistant boundary, activated by a directive the assistant already obeys.

**Mechanism (two small pieces):**

1. **The tool emits a deterministic marker.** `buddy_shop` (no buy arg) returns
   the shop card text followed by a hidden, machine-readable line — mirroring the
   project's existing `<!-- buddy: ... -->` side-channel convention:
   ```
   <!-- buddy:choices [{"id":"foam_sword","label":"Foam Sword ★★ (3 pt)","description":"Soft, but you swing it with conviction."}, ...] -->
   ```
   Built from `buyableChoices(rows)`. Absent/empty when nothing is affordable.

2. **`getInstructions()` gains a SHOP MENU directive** (`index.ts:105`), in the
   same voice as the existing ones:
   > SHOP MENUS: When a `buddy_shop` result contains a `buddy:choices` block,
   > present those options to the user with `AskUserQuestion` (one single-select
   > question, "What would you like to buy?"). On their pick, call
   > `buddy_shop buy=<id>`. If they decline, do nothing. Never invent items not
   > in the block.

This is deterministic (marker-driven, not vibes), reuses the one channel that
already makes the assistant act, and degrades gracefully: a client/assistant
that ignores the marker still shows a perfectly usable text catalog with
`buddy_shop buy=<id>` instructions (the `buddy_pick` numbered-selection fallback).

**Sequence:**
```
user "open the shop"
   └─ assistant → buddy_shop()                      [no arg]
        └─ returns: shop card  +  <!-- buddy:choices [...] -->
   └─ assistant (per SHOP MENU directive)
        └─ AskUserQuestion("What would you like to buy?", choices)
   user picks "Foam Sword"
   └─ assistant → buddy_shop(buy="foam_sword")
        └─ buyShopItem: −3 pt, +inventory, save
        └─ returns "Bought Foam Sword (−3 pt). 5 left." + updated card
   └─ assistant offers: "Equip it? → buddy_equip equip=foam_sword"
```

---

## 8. Tool API: `buddy_shop` (`server/index.ts`)

Sibling to `buddy_upgrades`/`buddy_equip`. Parameters (all optional):

| param | type | behavior |
| --- | --- | --- |
| _(none)_ | — | Render the shop card + emit the `buddy:choices` marker. |
| `buy` | `ItemId` | Purchase via `buyShopItem`; return confirmation + updated card. On success, hint `buddy_equip equip=<id>`. |

**Shop card** (markdown, mirrors `buddy_upgrades`):
```
### 🛒 Waffle's Shop — 8 skill point(s)
_Points are shared with `buddy_upgrades`._

🟢 3 pt · ⚔ Foam Sword ★★ — Soft, but you swing it with conviction.  `foam_sword`
🟢 3 pt · 🧢 Lucky Beanie ★★ — Overlays your innate hat.  `lucky_hat`
🔒 Lvl 6 · 👑 Compiler Crown ★★★ — Appease the type checker.  `compiler_crown`
✅ owned · 🦆 Rubber Duck ★ — A loyal debugging companion.  `rubber_duck`

Buy with `buddy_shop buy=<id>`.
```

---

## 9. Files changed

| File | Change | New/Edit |
| --- | --- | --- |
| `server/shop.ts` | `ownedItems`, `buyError`, `shopListing`, `renderShopCard`, `buyableChoices` | **new** |
| `server/shop.test.ts` | status classification, ownership, gating, choices, card snapshot | **new** |
| `server/items.ts` | optional `Item.level`; set gates on a few items | edit |
| `server/xp.ts` | `buyShopItem` wrapper | edit |
| `server/xp.test.ts` | (light) buy debits + grants + rejects owned/poor/locked | edit |
| `server/index.ts` | register `buddy_shop`; add SHOP MENU directive to `getInstructions()` | edit |

No `state.ts`, no `statusline/*.sh` changes.

---

## 10. Data flow (browse → buy → equip)

```
buddy_shop()                      buddy_shop(buy=foam_sword)
   │                                   │
   ▼                                   ▼
getXpState() ─► shopListing(...)   loadXpState ─► buyError(...)   [pure]
   │              (pure rows)          │  ok? pointsSpent+=3
   ▼                                   ▼  inventory.push
renderShopCard + buyableChoices    saveXpState
   │                                   │
   ▼                                   ▼
card + <!-- buddy:choices -->     "Bought … (−3 pt)" + card
   │                                   │
   ▼  (SHOP MENU directive)            ▼
AskUserQuestion ── pick ───────────────┘   then → buddy_equip equip=foam_sword
```

`bones`/companion untouched throughout; only `pointsSpent`/`inventory` change.

---

## 11. Test plan (colocated, `bun test`)

- **`shop.ts` pure** — `ownedItems` unions inventory + equipped; `buyError`
  precedence (unknown → owned → level → affordability); `shopListing` status per
  item across point/level fixtures; `buyableChoices` excludes owned/locked/poor;
  `renderShopCard` snapshot.
- **`buyShopItem`** — happy path debits exactly `cost` and grants to inventory;
  rejects an owned item (no debit); rejects when `available < cost`; rejects a
  level-gated item below level; balance reflected in `availablePoints`.
- **Interactive marker** — `buddy_shop` (no arg) text contains a parseable
  `buddy:choices` block; it omits owned/locked items; empty block when broke.
- Gate: `tsc --noEmit` clean, full `bun test` green, fresh-process smoke of
  `buddy_shop` browse + buy + `buddy_equip` of the bought item.

---

## 12. Open questions

- **OQ-P2.1 — Sell / refund.** Allow selling gear back for partial points? Clean
  (reverse the debit, return to wallet) but adds a `sell` path + a refund-value
  rule. Recommend **defer**; buy-only this phase. If added, mirror the
  respec-open gate or make it a flat 50% buyback.
- **OQ-P2.2 — Rotating stock.** Static catalog now. A date-seeded daily rotation
  (like the seasonal/whim systems) is a fast-follow that makes the merchant feel
  alive; revisit once the catalog is larger.
- **OQ-P2.3 — Level-gate tuning.** Exact per-item `level` values are balance,
  deferred to implementation with a tunable block.
- **OQ-P2.4 — Shared-budget UX.** Is one wallet for upgrades + gear the right
  long-term feel, or will players resent cosmetics competing with progression?
  Watch in playtest; a separate "Bug Bounty" currency (the original [[design]]
  alternative) remains the escape hatch if it chafes — but is explicitly out of
  scope here.
- **OQ-P2.5 — Marker robustness.** If a future client strips HTML comments from
  tool output, switch the marker to a fenced ```buddy:choices code block. The
  text-catalog fallback makes this non-blocking either way.
