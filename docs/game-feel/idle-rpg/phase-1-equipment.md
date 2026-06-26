# Design — Idle RPG · Phase 1: Items + Equipment Slots

> ✅ **Implemented & tested** (see [`status.md`](status.md)). This is the
> as-designed spec; the build matched it. Files: `server/items.ts`,
> `server/equipment.ts`, `buddy_equip`, geared renders in `buddy_show` + statusline.

Status: Component design (output of `/sc:design phase 1`). Detailed spec for the
**first** phase of [[design]]: give the buddy **equipment slots**
(`weapon` / `headgear` / `trinket`), a small **item catalog**, an
**inventory**, and `buddy_equip` to manage a loadout. No combat, no merchant, no
status-line/bash changes — those are Phases 2–4. No production code here;
signatures are interface sketches, build with `/sc:implement`.

Grounded against actual source as of `develop`:
`server/xp.ts` (`XpState:554`, `applyUpgradeEffect:1036`,
`revertUpgradeEffect:1067`, `UpgradeEffect:180`, `availablePoints:598`,
sanitize/migrate at `:628`), `server/engine.ts` (`BuddyBones:116`,
`HATS`/`HAT_ART:85`, `renderFace:407`, `renderBuddy:411`, `renderCompact:440`),
`server/state.ts` (`StatusState`, `writeStatusState`).

---

## 1. Scope & non-goals

**In scope (Phase 1):**
- A `Slot` set and an `Equipment` loadout persisted in `xp.json`.
- A small, data-driven `Item` catalog (`items.ts`).
- An `inventory: ItemId[]` of owned-but-unequipped items, seeded with a starter
  loadout on migration so equipment is exercisable before the merchant exists.
- Pure equip / unequip / swap with validation.
- A **derive-on-read appearance resolver** — equipment never mutates `bones`.
- A `buddy_equip` tool + a loadout card; equipment surfaced in `buddy_show`.
- Compositing into the **markdown card renders only**.

**Explicit non-goals (later phases):**
- Buying items (merchant) → Phase 2.
- Earning items from combat → Phase 3.
- Rendering weapon/trinket glyphs on the **live status line** (`buddy-status.sh`)
  → Phase 4. *Exception:* `headgear` rides the existing `status.json.hat` field,
  so it shows on the status line for free without touching bash (see §6.3).

---

## 2. The central design decision: derive-on-read, not apply-on-store

The existing **upgrades** model *applies* an effect into the companion at
buy-time (`applyUpgradeEffect` mutates `bones`/`cosmeticFlags`) and *reverts* it
at refund-time. That model is wrong for equipment, for two concrete reasons
found in the current code:

1. **Hat clobber.** `revertUpgradeEffect` for a `hat` effect does
   `companion.bones.hat = "none"` (`xp.ts:1086`). A buddy can roll an **innate**
   hat at hatch (`engine.ts:282`). Unequipping headgear would erase it.
2. **Stat drift.** `applyUpgradeEffect` for `stat` does
   `bones.stats[peak] = min(100, +amount)` and reverts by `max(0, −amount)`
   (`xp.ts:1057,1088`). Equipment swaps freely; repeated equip/unequip against
   the 100-clamp loses information and drifts the base value.

**Decision.** Equipment is the **source of truth**; the *appearance* is
**derived on read** and never stored into `bones`. A single pure resolver folds
innate identity + equipped items into a display view:

```ts
interface ResolvedAppearance {
  hat: Hat;                       // equipped headgear overrides innate bones.hat
  weaponArt: string;              // "" when no weapon
  flags: string[];               // innate cosmeticFlags ∪ item flags
  shiny: boolean;                // innate shiny ∨ any item shiny
  stats: BuddyStats;             // base bones.stats + Σ item stat bonuses, clamped
}

function resolveAppearance(
  bones: BuddyBones,
  equipment: Equipment,
  catalog: Item[] = ITEMS,
): ResolvedAppearance;
```

Properties this buys us, all testable as pure assertions:
- **No clobber** — `bones.hat` is untouched; headgear is an *overlay*. Unequip
  returns the display to the innate hat automatically.
- **No drift** — stat bonuses are summed fresh each read from immutable base.
  `equip→unequip→equip` is idempotent by construction.
- **Free reversal** — equip/unequip mutate only the `Equipment` record. No
  inverse-effect bookkeeping, no `pointsSpent`-style ledger for gear.

The upgrades' apply/revert path is left exactly as-is (different lifecycle:
upgrades are permanent purchases; gear is swappable). The two systems share data
*types* (`UpgradeEffect`, `Rarity`) but not the mutation path — a deliberate
separation of duties.

---

## 3. Data model

### 3.1 Slots & items (`server/items.ts`, pure)

```ts
export type Slot = "weapon" | "headgear" | "trinket";
export const SLOTS = ["weapon", "headgear", "trinket"] as const;

export type ItemId = string;

export interface Item {
  id: ItemId;
  slot: Slot;
  name: string;
  icon: string;            // 1-cell status glyph; width-checked vs emoji-widths.data
  rarity: Rarity;          // reuse engine Rarity (drop weighting + ★ display)
  cost: number;            // skill-point price (consumed by Phase 2 merchant)
  /** Reuse UpgradeEffect for flag/shiny/stat; headgear additionally sets `hat`.
   *  Interpreted by resolveAppearance (derive-on-read), NOT applyUpgradeEffect. */
  effect?: UpgradeEffect;
  /** Weapon-only: glyph composited beside the face in renders. */
  art?: string;
  /** Flavor line for the loadout card. */
  blurb?: string;
}
```

A starter catalog (small, cosmetic-first per [[design]] OQ5):

| id | slot | rarity | effect | note |
| --- | --- | --- | --- | --- |
| `rubber_duck` | trinket | common | `flag: trinket_duck` | starter, seeded |
| `debug_wand` | weapon | common | — (art only) | starter, seeded |
| `foam_sword` | weapon | uncommon | `stat:+1` | merchant stock later |
| `lucky_hat` | headgear | uncommon | `hat: beanie` | overlays innate hat |
| `compiler_crown` | headgear | rare | `hat: crown` + `stat:+2` | merchant stock later |

`headgear` items carry a `hat: Hat` effect whose value comes from the existing
`HATS` enum — we reuse `HAT_ART` for rendering, **zero** new hat art.

### 3.2 Loadout & inventory (extend `XpState`, `server/xp.ts`)

Additive, optional, backfilled — the `statProgress?`/`bonusPoints` precedent:

```ts
export interface Equipment {
  weapon?: ItemId;
  headgear?: ItemId;
  trinket?: ItemId;
}

export interface XpState {
  // ...existing fields unchanged...
  /** Equipped item per slot. Absent ⇒ empty loadout ⇒ today's appearance. */
  equipment: Equipment;
  /** Owned-but-unequipped items. Source: starter seed (P1), merchant (P2),
   *  drops (P3). Equipping moves an id from here into a slot; unequip moves back. */
  inventory: ItemId[];
}
```

Why `XpState` (xp.json) and not the companion file: ownership/economy state
already lives here (`unlockedUpgrades`, `cosmeticFlags`, `pointsSpent`).
Equipment is economy/progress, not innate identity — `bones` stays pristine.

### 3.3 Migration (`sanitize`/`migrate` at `xp.ts:628`)

Extend the existing normalizer so legacy `xp.json` loads cleanly:
- `equipment` ← `coerceEquipment(p.equipment)` — keep only known slots whose
  value is a known `ItemId`; drop anything stale (forward/back compat).
- `inventory` ← array of known `ItemId`s, deduped.
- **Starter seed:** if the blob predates equipment (`p.equipment === undefined`)
  **and** owns nothing yet, seed `inventory = ["rubber_duck", "debug_wand"]` so a
  first-run buddy has gear to equip and tests have a populated state. Guarded by a
  one-time flag (e.g. reuse `cosmeticFlags` marker `seeded_starter_kit`) so it
  never re-grants after the player ditches the items.
- **Invariant repair:** any id present in both a slot and `inventory` is removed
  from `inventory` (a slot owns its item); any equipped id not in the catalog is
  unequipped.

---

## 4. Core operations (`server/equipment.ts`, pure core + I/O wrapper)

### 4.1 Pure core

```ts
export interface EquipOutcome {
  ok: boolean;
  message: string;
  equipment: Equipment;   // next loadout (unchanged on failure)
  inventory: ItemId[];    // next inventory
}

/** Equip an owned item into its slot. Swaps any current occupant back to
 *  inventory. Validates: known id, item in inventory, slot match. Pure. */
export function equipItem(
  equipment: Equipment,
  inventory: ItemId[],
  id: ItemId,
  catalog?: Item[],
): EquipOutcome;

/** Unequip whatever is in `slot` back to inventory. No-op (ok:true) if empty. */
export function unequipSlot(
  equipment: Equipment,
  inventory: ItemId[],
  slot: Slot,
  catalog?: Item[],
): EquipOutcome;

/** Validation message, or null when the equip is allowed. (Mirrors
 *  purchaseError's shape for consistency.) */
export function equipError(
  inventory: ItemId[],
  id: ItemId,
  catalog?: Item[],
): string | null;
```

Edge cases the core must handle (each a unit test):
- equip an id not in inventory → fail, loadout unchanged.
- equip into an occupied slot → succeeds, old item returns to inventory (swap).
- equip an unknown / catalog-missing id → fail.
- unequip an empty slot → ok, no-op.
- equip an item already equipped in the same slot → ok, no-op (idempotent).

`equipItem`/`unequipSlot` return **new** arrays/objects (no in-place mutation of
inputs) so they compose cleanly and are trivially testable.

### 4.2 Appearance resolver

`resolveAppearance` (§2) lives in `equipment.ts`. Rules:
- `hat`: last equipped headgear's `hat` effect, else `bones.hat`.
- `weaponArt`: equipped weapon's `art`, else `""`.
- `shiny`: `bones.shiny || any item shiny-effect`.
- `flags`: `state.cosmeticFlags ∪ {each item flag-effect}` (deduped).
- `stats`: `for each stat: clamp(base + Σ item stat-effect-on-peak, 1..100)`.
  (Stat effects target the peak stat, matching the upgrade convention; resolver
  reads `bones.peak`.)
- Deterministic ordering (slot order `weapon, headgear, trinket`) so stacking is
  stable and snapshot-testable.

### 4.3 I/O wrapper

A thin wrapper (in `equipment.ts` or alongside the other xp.json writers) loads
`XpState`, calls the pure op, writes back **only on change**, and reports whether
anything changed — mirroring `UnlockResult.companionChanged` / the
once-per-change discipline used elsewhere. Returns a card-ready result.

---

## 5. Tool API: `buddy_equip` (`server/index.ts`)

A new tool, sibling to `buddy_upgrades` (separation: upgrades = permanent
progression; equip = swappable gear). Parameters (all optional):

| param | type | behavior |
| --- | --- | --- |
| _(none)_ | — | Render the current **loadout card** (slots + inventory). |
| `equip` | `ItemId` | Equip the item; swap-out handled. Returns updated card. |
| `unequip` | `Slot` | Unequip the slot back to inventory. |
| `list` | `true` | List inventory as **interactive choices** (see below). |

**Result shape** (text card always; choices opt-in), reusing the
[[design]] §6 assistant-boundary convention:

```ts
{
  content: [{ type: "text", text: <loadout card markdown> }],
  // Optional — when listing, the assistant raises AskUserQuestion with these,
  // and routes the pick back as buddy_equip equip=<id>. Server stays pure.
  choices?: { id: ItemId; label: string; description: string }[];
}
```

**Loadout card** (markdown, mirrors the `buddy_upgrades` card style):
```
🎒 Waffle's Loadout
  ⚔ Weapon    Debug Wand        ★
  🎩 Headgear (empty)
  🔮 Trinket  Rubber Duck       ★

Inventory: Foam Sword ★★ · Lucky Hat ★★
Equip with `buddy_equip equip=<id>`.
```

**`buddy_show` integration:** call `resolveAppearance` and render the resolved
hat/weapon/stats so the show card reflects gear. No new render primitive — pass
resolved values into the existing `renderBuddy` path (§6).

---

## 6. Rendering (markdown cards only in Phase 1)

### 6.1 `engine.ts` render functions stay innate-only

`renderBuddy`/`renderFace`/`renderCompact` keep taking `bones` and remain pure
and equipment-unaware. We do **not** thread equipment into them.

### 6.2 A compositing wrapper

Add a thin wrapper (in `equipment.ts`) that renders **from a
`ResolvedAppearance`** rather than raw bones:

```ts
/** Render the buddy card using resolved (geared) appearance: overlay headgear
 *  hat, append weapon art beside the face, show effective stats. */
export function renderGearedBuddy(
  bones: BuddyBones,
  appearance: ResolvedAppearance,
  name: string,
): string;
```

Implementation reuses `HAT_ART[appearance.hat]`, `renderFace(species, eye)` +
`appearance.weaponArt`, and the existing stat-bar loop driven by
`appearance.stats`. No duplicated ASCII; it composes the existing helpers.

### 6.3 Headgear on the live status line — for free

`writeStatusState` already writes `hat` into `status.json`, which
`buddy-status.sh` overlays. If the status write path passes
`resolveAppearance(...).hat` (instead of raw `bones.hat`) where it computes the
status hat, **equipped headgear appears on the live status line with zero bash
changes**. Weapon/trinket glyphs need a new `status.json` field + a bash branch
and are therefore **deferred to Phase 4**. This is the one render touch-point in
Phase 1 outside the cards, and it's a single substitution, not new logic.

---

## 7. Files changed

| File | Change | New/Edit |
| --- | --- | --- |
| `server/items.ts` | `Item`, `Slot`, `SLOTS`, `ITEMS` catalog, lookups | **new** |
| `server/equipment.ts` | `equipItem`/`unequipSlot`/`equipError`, `resolveAppearance`, `renderGearedBuddy`, I/O wrapper | **new** |
| `server/items.test.ts` | catalog integrity (unique ids, valid slots, width-checked icons) | **new** |
| `server/equipment.test.ts` | equip/unequip/swap edges, resolver no-clobber/no-drift, render snapshots | **new** |
| `server/xp.ts` | add `equipment`/`inventory` to `XpState`; coerce + starter-seed in sanitize/migrate | edit |
| `server/xp.test.ts` | migration: legacy blob → seeded; invariant repair | edit |
| `server/index.ts` | register `buddy_equip`; pass resolved hat to status write | edit |
| `server/state.ts` | (only if status hat substitution needs a hook) | maybe |

No `statusline/*.sh` changes in Phase 1.

---

## 8. Data flow (equip → display)

```
buddy_equip equip=foam_sword
        │
        ▼
loadXpState(xp.json) ──► equipItem(equipment, inventory, id)   [pure core]
        │                        │ swap-out → inventory
        │                        ▼
        └──────────── writeXpState(only if changed)            [I/O wrapper]
                                 │
         buddy_show / status ───► resolveAppearance(bones, equipment)  [pure]
                                 │  hat overlay · weapon art · effective stats
                                 ▼
                 renderGearedBuddy(...)  +  status.json.hat = appearance.hat
```

`bones` is read-only throughout; only `equipment`/`inventory` are written.

---

## 9. Test plan (colocated, `bun test`)

- **Catalog** — ids unique; every `slot` ∈ `SLOTS`; every `icon` passes the
  emoji-width check; headgear effects reference valid `HATS`.
- **Equip core** — the six §4.1 edge cases as pure assertions; inputs not
  mutated (returns fresh objects).
- **Resolver** — `equip(lucky_hat)` overlays hat but `bones.hat` unchanged;
  `equip→unequip` restores innate hat exactly (no-clobber); `equip→unequip→equip`
  yields identical resolved stats (no-drift); stat bonus clamps at 100.
- **Migration** — legacy blob with no `equipment` and no upgrades seeds the
  starter kit once; re-load does not re-seed; stale equipped id is repaired.
- **Tool** — `buddy_equip` no-arg renders loadout; `equip=` swaps; `list=true`
  emits `choices[]`; failure paths return the validation message unchanged.

Gate each: `tsc --noEmit` clean, `bun test` green, fresh-process smoke of
`buddy_equip` and `buddy_show` rendering geared appearance.

---

## 10. Open questions

- **OQ-P1.1 — Starter kit contents.** Seed `rubber_duck` + `debug_wand`, or
  start empty and rely on Phase 2 merchant? Recommend seeding so Phase 1 ships
  something usable and tests have fixtures.
- **OQ-P1.2 — Effective stats everywhere?** Phase 1 shows effective stats in
  cards only. Should *gameplay* (XP/accrual) ever read effective stats, or stay
  on base? Recommend **base-only for gameplay** (no power creep), effective for
  display — revisit if combat (Phase 3) wants gear to matter.
- **OQ-P1.3 — Inventory cap.** Unbounded for now; a cap (or item stacking)
  becomes relevant once drops (Phase 3) can flood it. Defer.
- **OQ-P1.4 — `buddy_equip` vs. extending `buddy_upgrades`.** This spec assumes a
  separate tool ([[design]] OQ1). Confirm before implementing.
