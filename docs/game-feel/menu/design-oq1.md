# Design — OQ-1: Fold `buddy:choices` into `buddy:nav`

> Status: **Implemented** (2026-06-26). All OQs resolved and built. Resolves the
> deferred open question from [`design-mechanize.md §11`](./design-mechanize.md)
> (OQ-1). See [`testing-oq1.md`](./testing-oq1.md) for the user testing guide.

Grounded against `feature/interactive-menu` post-roadmap close (635 tests green):
`server/menu.ts` (`AskQuestion`, `MenuEnvelope`, `navMarker`, `askFor`,
`advance`), `server/shop.ts` (`ShopChoice`, `choicesMarker`, `buyableChoices`),
`server/index.ts` (SHOP MENUS + MENU NAVIGATION directives, `buddy_shop` browse
path, `buddy_upgrades` browse path), `server/registry.ts`.

---

## 1. The problem — two channels, two directives

The codebase currently maintains two independent hidden-marker channels:

| Channel | Emitted by | Directive | Model action |
|---|---|---|---|
| `<!-- buddy:choices [...] -->` | `buddy_shop` browse | SHOP MENUS | AskUserQuestion → `buddy_shop buy=<id>` |
| `<!-- buddy:nav {...} -->` | `buddy_menu` | MENU NAVIGATION | AskUserQuestion / do-instruction |

MENU NAVIGATION already has a seam for `buddy:choices`: *"if there is NO
`buddy:nav` marker, the result is a tool's output — print it verbatim (a
`buddy:choices` marker, if present, follows the SHOP MENUS rule)."* This
cross-directive dependency means the model must reason about two channels
simultaneously when the shop is reached from the menu.

The deeper structural mismatch: `buddy:nav ask` carries the *exact
AskUserQuestion payload* (verbatim copy). `buddy:choices` carries *just the
items* and delegates the AskUserQuestion shape to the SHOP MENUS directive. One
channel is a **courier**, the other is an **interpreter**.

**Goal:** make `buddy:nav` the single picker channel. Every tool that needs an
interactive pick emits `buddy:nav`. SHOP MENUS is removed; MENU NAVIGATION
absorbs its one remaining responsibility. `buddy_upgrades` gains the same
interactive browse flow from day one — no migration needed.

---

## 2. Scope

**In scope:**

- Rename `AskQuestion` → `NavAsk` in `menu.ts` (cleaner name for a
  now-general type). *(OQ-1b: resolved — NavAsk)*
- Generalize `NavAsk` with a `then: NavContinuation` field and an optional
  `value` on options.
- Extract `shopAsk()` to `shop.ts` as a pure helper. *(OQ-1a: resolved — yes)*
- Add `upgradesAsk()` to `index.ts` (or a new `server/upgrades.ts`) for the
  upgrades interactive browse. *(OQ-1d: resolved — yes, add interactive flow)*
- Retire `choicesMarker` / `ShopChoice` from `shop.ts`; `buddy_shop` browse
  emits `buddy:nav`.
- `buddy_upgrades` browse emits `buddy:nav` (new behavior, no prior channel).
- Remove top-level `page` from `MenuEnvelope` — absorbed into
  `ask.then.args.page` for menu asks.
- Rewrite MENU NAVIGATION to cover the unified channel; remove SHOP MENUS.
- Update `menu.test.ts`, `shop.test.ts`, add upgrades browse test.

**Explicit non-goals:**

- No new menu pages, shop items, or upgrade catalog entries.
- No change to `do` directives (`prompt`/`shell`/`sequence`).
- No change to `then.args` typing — stays `Record<string, unknown>`. *(OQ-1c: resolved — keep)*
- No `buddy_upgrades` pagination. Cap affordable options at 4 (AskUserQuestion
  bound). *(OQ-1d scope)*

---

## 3. The generalized `NavAsk` — `server/menu.ts`

```ts
/** Value to call the continuation tool with; defaults to label when absent. */
export interface NavOption {
  label: string;
  description: string;
  /** The pick_arg value to pass on selection. When absent, label is used. */
  value?: string;
}

/**
 * What to call when the user makes a pick. Always present on a nav ask.
 *   tool     — the MCP tool to call
 *   args     — fixed args always merged in (e.g. { page: "gear" })
 *   pick_arg — the arg name to bind the chosen value to
 *
 * On pick: tool({ ...args, [pick_arg]: option.value ?? option.label })
 */
export interface NavContinuation {
  tool: string;
  args?: Record<string, unknown>;
  pick_arg: string;
}

/** Renamed from AskQuestion — now the general nav-ask shape. */
export interface NavAsk {
  question: string;
  header: string;
  multiSelect: false;
  options: NavOption[];
  /** Always present — the model executes this, not a separate directive. */
  then: NavContinuation;
}
```

**Why `value` on `NavOption`?** `AskUserQuestion` returns the chosen *label*
string, not a hidden id. Menu nav uses the label as the `select` arg (fine —
the server matches by label). Shop uses an `ItemId` as `buy`. Upgrades uses an
unlock id as `buy`. Storing `value` lets the server pre-compute the correct arg
without the model doing any lookup.

**Why `then` on `NavAsk`?** SHOP MENUS is eliminated entirely. All future
interactive-pick tools use the same channel and rule. The model instruction
shrinks to one line: *"call `then.tool({ ...then.args, [then.pick_arg]: option.value ?? option.label })`."*

---

## 4. Updated `MenuEnvelope` — `server/menu.ts`

The top-level `page` field is **removed** — absorbed into `ask.then.args.page`
for menu asks. Non-menu tools (shop, upgrades) never needed it.

```ts
export interface MenuEnvelope {
  display: string;
  ask?: NavAsk;         // renamed from AskQuestion; carries its own continuation
  do?: MenuDirective;
  // `page` removed — lives in ask.then.args for menu navigation asks
}
```

`navMarker` payload shrinks from `{ page, ask?, do? }` to `{ ask?, do? }`.

---

## 5. Updated `askFor()` — `server/menu.ts`

```ts
export function askFor(page: MenuPage): NavAsk {
  return {
    question: page.title,
    header: headerFor(page),
    multiSelect: false,
    options: page.options.map((o) => ({
      label: o.label,
      description: o.description,
      // No value — menu nav uses label as the select arg
    })),
    then: {
      tool: "buddy_menu",
      args: { page: page.id },
      pick_arg: "select",
    },
  };
}
```

`advance()` stays structurally unchanged. The returned `MenuEnvelope` loses
`page` at the top level; `ask.then.args.page` carries it instead.

---

## 6. `shopAsk()` — `server/shop.ts`  *(OQ-1a)*

Extracted pure helper — keeps `index.ts` thin and makes the shape testable
without importing the server.

```ts
/**
 * Build the NavAsk for a shop browse: affordable items as interactive options.
 * `value` is the ItemId (buy arg); label is the display string.
 * Returns undefined when nothing is affordable.
 */
export function shopAsk(choices: readonly ShopChoice[]): NavAsk | undefined {
  if (choices.length === 0) return undefined;
  return {
    question: "What would you like to buy?",
    header: "Buy",
    multiSelect: false,
    options: choices.map((c) => ({
      label: c.label,
      description: c.description,
      value: c.id,
    })),
    then: { tool: "buddy_shop", args: {}, pick_arg: "buy" },
  };
}
```

`ShopChoice` and `buyableChoices` are kept — `shopAsk` consumes them.
`choicesMarker` alone is retired.

---

## 7. `buddy_shop` browse — `server/index.ts`

**Before:**
```ts
const marker = choicesMarker(buyableChoices(rows));
return text(marker ? `${card}\n\n${marker}` : card);
```

**After:**
```ts
const ask = shopAsk(buyableChoices(rows));
if (!ask) return text(card);
const env: MenuEnvelope = { display: card, ask };
return text(`${env.display}\n\n${navMarker(env)}`);
```

Imports: add `shopAsk` from `./shop`; remove `choicesMarker`.

---

## 8. `upgradesAsk()` and `buddy_upgrades` browse  *(OQ-1d)*

The upgrades browse path is currently text-only. It gains the same interactive
pattern as the shop. AskUserQuestion caps at 4, so we take the first 4
affordable unlocks (sorted by level then cost, matching existing catalog order).

**`upgradesAsk()` helper** — in `server/index.ts` (or extracted to a new
`server/upgrades.ts` if the file grows):

```ts
interface UpgradeChoice {
  id: string;
  label: string;   // e.g. "🟢 6 pt · 💬 "Nice work!""
  description: string;
}

function upgradesAsk(choices: UpgradeChoice[]): NavAsk | undefined {
  if (choices.length === 0) return undefined;
  return {
    question: "Which upgrade would you like to buy?",
    header: "Buy unlock",
    multiSelect: false,
    options: choices.slice(0, 4).map((c) => ({   // AskUserQuestion cap
      label: c.label,
      description: c.description,
      value: c.id,
    })),
    then: { tool: "buddy_upgrades", args: {}, pick_arg: "buy" },
  };
}
```

**Affordable unlock detection** — mirror the existing catalog loop logic:

```ts
const affordableChoices: UpgradeChoice[] = catalog
  .filter(
    (i) =>
      !owned.has(i.id) &&
      state.level >= i.level &&
      (!i.prestigeLevel || state.prestigeLevel >= i.prestigeLevel) &&
      avail >= i.cost,
  )
  .map((i) => ({
    id: i.id,
    label: `${i.cost} pt · ${i.label}`,
    description: `Costs ${i.cost} skill point${i.cost !== 1 ? "s" : ""}`,
  }));
```

**Updated browse path:**
```ts
// After building `lines` and rendering the catalog text:
const card = lines.join("\n");
const ask = upgradesAsk(affordableChoices);
if (ask) {
  const env: MenuEnvelope = { display: card, ask };
  return text(`${env.display}\n\n${navMarker(env)}`);
}
return text(card);
```

**Cap note:** When more than 4 unlocks are affordable, the first 4 (by level
then cost) are shown in the picker. The full text catalog above the marker still
lists everything, so the user can type `buddy_upgrades buy=<id>` directly for
items not shown in the picker.

---

## 9. Unified directive — MENU NAVIGATION

**Replaces** SHOP MENUS + current MENU NAVIGATION. Verbatim intent:

> **MENU NAVIGATION:** `buddy_menu` returns either a routed tool's normal output,
> or a visible card followed by a hidden `buddy:nav` marker. If there is **NO**
> `buddy:nav` marker, print the result verbatim. Otherwise print everything before
> the marker verbatim, NEVER print the marker, and act on its JSON:
> - If it has **`ask`** — call `AskUserQuestion` with `ask` **verbatim** (already
>   complete; do not add, drop, or rename fields). On pick, call
>   `ask.then.tool` with `ask.then.args` merged with
>   `{ [ask.then.pick_arg]: option.value ?? option.label }`. Nothing else.
> - If it has **`do`** — perform exactly that one instruction: `prompt` → ask the
>   user `do.ask`, call `do.tool` with the answer as `do.arg`; `shell` → tell the
>   user to run `` `! do.command` ``; `sequence` → run the named orchestration.
> - If the user picks **Other** and types a buddy command, route it as if typed
>   after `/buddy`; `back`/`menu` → `buddy_menu` (no args).

SHOP MENUS is **removed**.

---

## 10. Test changes

### `server/menu.test.ts`

1. **`NavAsk` / `askFor` shape** — update import (`NavAsk` replaces
   `AskQuestion`). Assert `ask.then.tool === "buddy_menu"`,
   `ask.then.pick_arg === "select"`, `ask.then.args.page === page.id`. Assert
   options have only `label`/`description` (no `value` for menu nav).

2. **`navMarker` round-trip** — payload is now `{ ask?, do? }` (no top-level
   `page`). Assert `payload.page` absent; assert `payload.ask.then.args.page`
   for menu asks.

3. **`advance` tests** — `(r as MenuEnvelope).page` is gone. Check
   `(r as MenuEnvelope).ask?.then.args?.page` instead.

4. **Security invariants** — unchanged.

### `server/shop.test.ts`

5. **`shopAsk` shape** — options have `value === ShopChoice.id`, `label` and
   `description` unchanged, `then.tool === "buddy_shop"`,
   `then.pick_arg === "buy"`, `then.args` is `{}`. Returns `undefined` when
   `choices` is empty.

6. **`choicesMarker` removed** — delete or skip tests that exercised it.

### Upgrades browse test (new)

7. **`upgradesAsk` shape** — returns `undefined` when no affordable choices;
   options capped at 4; `value === unlock.id`; `then.tool === "buddy_upgrades"`,
   `then.pick_arg === "buy"`.

---

## 11. Edge cases & decisions

- **Cap at 4 for upgrades.** The full text catalog still lists all unlocks above
  the marker. Users can always type `buddy_upgrades buy=<id>` for any item.

- **`value` absent ↔ use label.** Menu options intentionally omit `value`.
  Shop/upgrades options must always set `value`. Missing `value` on a
  shop/upgrades option is a bug the shape test catches.

- **`ask` and `do` mutual exclusion.** Unchanged — `navMarker` enforces this.

- **CC restart required.** Changing the MENU NAVIGATION directive and shop
  output format requires a restart. Consistent with every prior directive change.

- **`buddy:choices` in transit.** Old sessions see stale SHOP MENUS directive
  until restart; `buddy:choices` would be unhandled. Restart resolves it.

- **`then` is opaque to `AskUserQuestion`.** The harness only sees `question`,
  `header`, `multiSelect`, `options` — `then` is an extra field the harness
  ignores. `NavAsk` is a superset of the harness-required shape.

- **`then.args` stays `Record<string, unknown>`** — no narrowed typing.
  *(OQ-1c: resolved)*

---

## 12. Settled open questions

| # | Question | Decision |
|---|---|---|
| OQ-1a | Extract `shopAsk()` to `shop.ts`? | ✅ Yes — pure helper, testable without server |
| OQ-1b | Rename `AskQuestion` → `NavAsk`? | ✅ Yes — cleaner for a general type |
| OQ-1c | Type `then.args` narrowly? | ✅ Keep `Record<string, unknown>` |
| OQ-1d | Add `buddy_upgrades` interactive flow? | ✅ Yes — same pattern, cap at 4, day-one nav |

---

## 13. Build order

1. **`menu.ts`** — rename `AskQuestion`→`NavAsk`, add `NavOption`,
   `NavContinuation`; update `MenuEnvelope` (drop `page`); update `askFor`,
   `navMarker`, `advance`.
2. **`menu.test.ts`** — update imports, shape assertions, marker round-trip,
   `advance` tests.
3. **`shop.ts`** — add `shopAsk()`; retire `choicesMarker`.
4. **`shop.test.ts`** — add `shopAsk` shape tests; remove `choicesMarker` tests.
5. **`index.ts`** — update `buddy_shop` browse (use `shopAsk` + `navMarker`);
   add `upgradesAsk()` + update `buddy_upgrades` browse; rewrite MENU NAVIGATION;
   remove SHOP MENUS; remove `choicesMarker` import.
6. **Upgrades browse test** (in `index`-adjacent test or inline).

No schema migrations, no state fields, no new currency. Additive + retire.

**Implementation complete.** 637 tests green, `tsc` clean. See
[`testing-oq1.md`](./testing-oq1.md) for the user testing checklist.

### Build status

1. ✅ `menu.ts` — `NavAsk`, `NavOption`, `NavContinuation`; `MenuEnvelope` drops
   `page`; `askFor` adds `then`; `navMarker` drops top-level `page`; `advance`
   drops `page` from returned envelopes.
2. ✅ `menu.test.ts` — `NavAsk` imported; `askFor` adds `then` assertions;
   `navMarker` round-trips check no top-level `page`; `advance` tests use
   `ask.then.args.page`.
3. ✅ `shop.ts` — `shopAsk()` added; `choicesMarker` retired.
4. ✅ `shop.test.ts` — `shopAsk` shape, undefined-when-broke, 4-option cap tests.
5. ✅ `index.ts` — `buddy_shop` browse emits `buddy:nav`; `upgradesAsk()` added;
   `buddy_upgrades` browse emits `buddy:nav` when affordable unlocks exist;
   MENU NAVIGATION unified; SHOP MENUS removed.

---

## Addendum (2026-06-30) — `kind:"choice"` reuses this channel

The unified nav channel built here is also what powers the new `kind:"choice"`
setter (menu-fixes P2). A `choice` leaf resolves (`resolveSelect`) to a
`SelectResolution` of `kind:"ask"`, and `advance` returns a `MenuEnvelope` whose
`ask` is a second-picker `NavAsk` with `then = { tool: <setter>, args: {},
pick_arg: <arg> }`. No new assistant behavior: the same MENU NAVIGATION directive
(`then.tool({ ...then.args, [then.pick_arg]: option.value ?? option.label })`)
drives it. `NavOption.value` was widened to `string | boolean` so boolean-arg
setters (`enabled`, `showRarity`) pass a real boolean through the validated
tool-call path — `false ?? label` correctly yields `false` (nullish coalescing).
This keeps the unvalidated `runTool` path untouched. Spec: `design.md`
(`MenuAction` `kind:"choice"`).
