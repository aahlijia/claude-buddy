# Design — `/buddy menu`: Interactive Command Browser

> Status: Component design (output of `/sc:design`). Interface sketches only —
> no production code here; build with `/sc:implement`. Closes the
> [`idle-rpg/todo.md`](../idle-rpg/todo.md) item _"interactive for selecting
> buddy commands"_ (and subsumes _"interactive menus for purchasing items"_,
> which already ships via `buddy_shop`).

Grounded against actual source as of `develop`:
`server/shop.ts` (`ShopChoice`, `buyableChoices:149`, `choicesMarker:164` — the
exact marker pattern this reuses), `server/index.ts`
(`getInstructions():~105` — the directive channel the assistant obeys verbatim;
`buddy_shop:1256` — the tool→marker→`AskUserQuestion` round-trip to mirror),
and `skills/buddy/SKILL.md` (the thin `$ARGUMENTS` router + argument-hint).

**Locked decisions** (from `/sc:design` Q&A):

- **Breadth:** a **full command browser** — every `/buddy` subcommand reachable,
  grouped into a category tree. Not a curated shortlist.
- **Home:** **tool-backed**. A new `buddy_menu` MCP tool owns the tree and emits a
  `buddy:menu` marker, mirroring `buddy_shop`. `SKILL.md` stays a thin router; the
  tree is unit-tested like the rest of the server (600+ tests).

---

## 1. The one hard constraint that shapes everything

Claude Code has **no custom in-chat TUI**. The only native, arrow-key-navigable
picker is **`AskUserQuestion`** — the same control the shop already drives. (The
sole real TUI, `bun run pick`, is a *separate terminal process*, not in-chat.)

`AskUserQuestion` caps options at **2–4 per question** (`minItems: 2`,
`maxItems: 4`), and auto-appends a free-text **"Other"** slot. ~30 buddy commands
cannot live in one flat list. Therefore `/buddy menu` is **a tree of chained
`AskUserQuestion` prompts**, every node holding **≤4 curated options + Other**.

This is not a limitation to work around — it *is* the design: a shallow,
well-grouped category tree whose leaves are existing `buddy_*` tool calls.

---

## 2. Scope & non-goals

**In scope:**

- A `buddy_menu` tool: serves one **page** of the menu tree (default `root`),
  returning a short header + a machine-readable `buddy:menu` marker.
- A pure `server/menu.ts`: the static `MENU` tree, `MenuPage`/`MenuOption`/
  `MenuAction` types, `getMenuPage`, `menuMarker`, `renderMenuCard`, and the
  validation surface the tests assert against.
- One new `getInstructions()` directive — **MENU NAVIGATION** — that turns a
  `buddy:menu` marker into an `AskUserQuestion` and dispatches the pick.
- A `menu` route in `SKILL.md` + the argument-hint.

**Explicit non-goals:**

- **No new shop code.** Selecting *Shop* routes into `buddy_shop`, whose existing
  `buddy:choices` flow takes over unchanged. The menu never re-implements buying.
- **No live status-line render.** The menu is request/response, not a HUD widget.
- **No breadcrumb/explicit Back chrome** this phase (OQ-1; "Other → back/menu"
  covers it). No pagination engine (OQ-2; the tree is hand-balanced to ≤4).

---

## 3. What already exists (reuse, don't reinvent)

- **The marker → `AskUserQuestion` round-trip is done.** `buddy_shop` emits
  `<!-- buddy:choices [...] -->` (`shop.ts:164`); a `getInstructions()` directive
  (`index.ts:131`) tells the assistant to present it as a single-select and route
  the pick back to `buddy_shop buy=<id>`. `buddy:menu` is **the same pattern, one
  level up** — categories instead of items, and the dispatch can target *any*
  tool or another page.
- **The directive channel is the mechanism.** `getInstructions()` already injects
  behavior the assistant follows verbatim (NAME REACTIONS, SHOP MENUS, END-OF-
  TURN). MENU NAVIGATION is **one more directive**, not new infrastructure.
- **The pure-module + thin-tool split is the house style.** `shop.ts` (pure:
  listing, choices, marker, card) vs `buddy_shop` (I/O wrapper). `menu.ts` mirrors
  it exactly: the tree and rendering are pure and testable; the tool is a
  three-line lookup.
- **The shop leaf already terminates correctly.** Routing into `buddy_shop`
  reuses its card, its affordability logic, and its `buddy:choices` buy menu.
  Reaching the shop is *just* a `kind:"tool"` action — zero duplication.

---

## 4. Data model — `server/menu.ts` (interface sketch)

```ts
/** What selecting an option does. Discriminated by `kind`. */
export type MenuAction =
  | { kind: "page"; page: string }                 // drill into a submenu
  | { kind: "tool"; tool: string; args?: Record<string, unknown> } // call a buddy_* tool
  | { kind: "prompt"; tool: string; arg: string; ask: string }     // ask for a value, then call
  | { kind: "shell"; command: string }             // tell user to run `! <command>`
  | { kind: "sequence"; sequence: "uninstall" };   // run an orchestration in SKILL.md

export interface MenuOption {
  id: string;          // stable, kebab-case
  label: string;       // shown in the picker (≤ ~40 chars, may carry an emoji)
  description: string; // the AskUserQuestion option description line
  action: MenuAction;
}

export interface MenuPage {
  id: string;          // "root", "gear", ...
  title: string;       // becomes the AskUserQuestion question text
  options: MenuOption[]; // INVARIANT: 2..4 (AskUserQuestion bounds)
}

/** The whole tree, keyed by page id. The single source of truth. */
export const MENU: Record<string, MenuPage>;

export function getMenuPage(id?: string): MenuPage; // unknown/empty → MENU.root

/** Mirror of choicesMarker — the side-channel the directive consumes. */
export function menuMarker(page: MenuPage): string;
//   => `<!-- buddy:menu ${JSON.stringify({page:id,title,options})} -->`

/** ASCII fallback card (the visible header above the picker). */
export function renderMenuCard(page: MenuPage, name: string): string;
```

**Why `kind:"prompt"`?** Four commands need a free-text value — `rename <name>`,
`personality <text>`, `frequency <seconds>`, `rainbow <#hex…>`. The assistant
asks for the value (`ask`), then calls the tool. This keeps those reachable from
the menu without a text-entry control AskUserQuestion doesn't have.

---

## 5. The tool — `buddy_menu`

```ts
server.tool(
  "buddy_menu",
  "Open the interactive buddy command browser. With no argument, returns the " +
    "top-level menu; pass `page` to fetch a submenu. The result carries a hidden " +
    "buddy:menu marker — present it as an interactive menu per your instructions.",
  { page: z.string().optional().describe("Submenu id (default: root)") },
  async ({ page }) => {
    const companion = ensureCompanion();
    const node = getMenuPage(page);            // unknown id falls back to root
    const card = renderMenuCard(node, companion.name);
    incrementEvent("commands_run", 1, activeSlot());
    return text(`${card}\n\n${menuMarker(node)}`);
  },
);
```

Stateless and side-effect-free beyond the existing `commands_run` tick. Identical
shape to `buddy_shop`'s no-arg branch (`index.ts:1286`).

---

## 6. The directive — MENU NAVIGATION (new in `getInstructions()`)

Added beside SHOP MENUS. Verbatim intent:

> **MENU NAVIGATION:** When a tool result contains a `buddy:menu` HTML comment,
> do **not** print it. Parse its `options` and present them with
> `AskUserQuestion` (single-select; use the page `title` as the question, each
> option's `label`/`description` as the choice). Dispatch the user's pick by its
> `action.kind`:
> - `page` → call `buddy_menu page=<action.page>` and present the result.
> - `tool` → call `<action.tool>` with `args`. If *that* result carries its own
>   `buddy:choices` or `buddy:menu` marker, continue the flow (this is how *Shop*
>   chains into the buy menu).
> - `prompt` → ask the user `action.ask`, then call `<action.tool>` with the
>   answer as `<action.arg>`.
> - `shell` → tell the user to run `! <action.command>` themselves.
> - `sequence` → run the named orchestration (e.g. `uninstall`, per SKILL.md).
>
> If the user picks **Other** and types a buddy command, route it as if typed
> after `/buddy`. If they type `back` or `menu`, call `buddy_menu` (root).
> Never loop the menu without the user advancing it.

This makes `buddy:menu` an explicit exception to SKILL.md's "output verbatim"
rule — same way `buddy:choices` already is.

---

## 7. `SKILL.md` changes

- **Routing table** — one row:

  | Input  | Action |
  | ------ | ------ |
  | `menu` | Call `buddy_menu` (no args → root); follow the MENU NAVIGATION directive |

- **Argument-hint** — append `menu` to the pipe-list.

That's the entire skill-side surface. The router stays thin.

---

## 8. The full tree (the spec)

Every node ≤4 options; **Other** (auto) is the universal escape / `back`.
Leaves name the existing tool. `→page` = drill-down; `→tool` = terminal call;
`→prompt` = ask-then-call; `→shell` / `→seq` as noted.

```
root  "What would you like to do?"
├─ 🛒 Shop & Gear            →page gear
├─ 📊 Stats & Progress       →page progress
├─ 🎨 Appearance & Behavior  →page appearance
└─ ⚙️  Manage & System        →page system

gear  "Shop & gear — what next?"
├─ 🛒 Visit the shop         →tool buddy_shop      (→ existing buddy:choices buy menu)
├─ 🎽 Equip / loadout        →tool buddy_equip
└─ ⬆️  Upgrades & titles      →tool buddy_upgrades

progress  "Stats & progress"
├─ 📊 Stats                  →tool buddy_stats
├─ ✨ XP & level             →tool buddy_xp
├─ 🏆 Achievements           →tool buddy_achievements
└─ ⋯  More                   →page progress2

progress2  "More progress"
├─ 🎭 Mood                   →tool buddy_mood
├─ 📣 Brag card              →tool buddy_brag
└─ 🧠 Memory                 →tool buddy_memory

appearance  "Appearance & behavior"
├─ 🎨 Theme (dark/light/auto)→tool buddy_theme
├─ 🧩 Style & position       →page style
├─ ✨ Motion & game-feel     →page motion
└─ 📊 Status-line bits       →page statusbits

style  "Style & position"
├─ 🔲 Style (classic/round)  →tool buddy_style
├─ 📍 Position (top/left)    →tool buddy_style
├─ 🌈 Rainbow colors         →tool buddy_style
└─ 💎 Rarity badge on/off    →tool buddy_style

motion  "Motion & game-feel"
├─ 🎚️  Game-feel intensity    →tool buddy_gamefeel
├─ 🚶 Wander on/off          →tool buddy_wander
└─ 🤸 Wander modes           →tool buddy_wander

statusbits  "Status-line bits"
├─ 📺 Status-line on/off     →tool buddy_statusline
├─ 📊 Stat-bar panel         →tool buddy_stats_panel
├─ 🏅 Prestige badge         →tool buddy_prestige_badge
└─ ⏱️  Frequency (cooldown)   →prompt buddy_frequency (ask "Cooldown seconds?")

system  "Manage & system"
├─ 🪪 Identity               →page identity
├─ 💾 Saves & roster         →page roster
├─ 🔇 Mute / unmute          →page mute
└─ ⋯  More                   →page system2

identity  "Identity"
├─ ✏️  Rename                 →prompt buddy_rename          (ask "New name?")
└─ 🎭 Personality            →prompt buddy_set_personality (ask "Describe the personality:")

roster  "Saves & roster"
├─ 💾 Save current           →tool buddy_save
├─ 📜 List saved             →tool buddy_list
├─ 🔮 Summon                 →tool buddy_summon
└─ 🗑️  Dismiss                →tool buddy_dismiss

mute  "Mute / unmute"
├─ 🔇 Mute                   →tool buddy_mute
└─ 🔊 Unmute                 →tool buddy_unmute

system2  "More system"
├─ ❓ Help                   →tool buddy_help
├─ 🕹️  Pick (terminal TUI)    →shell  bun run pick
└─ 🧨 Uninstall              →seq    uninstall
```

13 pages, every command reachable, no node over 4. `show`/`pet` are intentionally
*not* in the tree — they're the bare `/buddy` and `/buddy pet` everyone already
knows; the menu is for *discovering the rest*. (OQ-3 if we want them in.)

---

## 9. Tests — `server/menu.test.ts`

The tree is data, so the invariants are cheap and high-value:

1. **Option bounds:** every `MenuPage.options.length` is `2..4`.
2. **No dangling pages:** every `kind:"page"` target exists in `MENU`.
3. **Real tools only:** every `kind:"tool"`/`"prompt"` `tool` is in the known
   `buddy_*` set (assert against a list mirrored from `index.ts`).
4. **Connectivity:** BFS from `root` reaches every key in `MENU` (no orphans).
5. **Unique ids:** option `id`s unique within a page; page ids unique.
6. **Marker round-trips:** `JSON.parse` of `menuMarker(p)`'s payload deep-equals
   `{page,title,options}`.
7. **Unknown page → root:** `getMenuPage("nope") === MENU.root`.
8. **Card snapshot:** `renderMenuCard(MENU.root, name)` byte-stable.

---

## 10. Edge cases & decisions

- **Back / escape:** handled via the auto **Other** slot (`back`/`menu` → root,
  or any literal command). No curated slot spent on it this phase (OQ-1).
- **Shop with nothing affordable:** `buddy_shop` emits no `buddy:choices` → the
  assistant just shows the shop card; the flow ends cleanly. No special-casing.
- **`prompt` actions:** assistant collects the value *before* the tool call;
  if the user gives nothing usable, fall back to the no-arg tool behavior.
- **MCP unavailable:** the existing SKILL.md "Fallback" gate already blocks every
  buddy command — `menu` included — so nothing extra is needed.
- **Loop safety:** the directive forbids re-presenting a menu without a user
  advance; depth is bounded by the 2-level-max tree.
- **Output rule reconciliation:** `buddy:menu` joins `buddy:choices` as a
  documented exception to "print tool output verbatim."

---

## 11. Open questions & settled decisions

- **OQ-1 — explicit Back chrome? → Decided: NOT this phase.** An `← Back` option
  would consume one of the ≤4 slots on every non-root node (evicting real
  commands on the already-full pages). Back-navigation rides the auto **Other**
  slot instead (`back`/`menu` → root), at zero slot cost. Revisit only if the
  tree deepens enough that blind back-typing frustrates users.
- **OQ-2 — pagination helper (future).** If any category outgrows 4 leaves,
  generalize the hand-rolled `⋯ More` drill-down into a reusable
  `paginate(options, perPage)` util that auto-chunks a long option list into
  linked sub-pages. Not needed for the current tree (every node is ≤4 by hand) —
  **note for future implementation** when the command surface grows.
- **OQ-3 — surface `show`/`pet` in the tree? → Decided: OMIT.** They stay out as
  redundant with the well-known bare `/buddy` and `/buddy pet`. The menu is for
  discovering the *rest* of the surface.

---

## 12. Build order (one phase)

1. `server/menu.ts` — types, `MENU` tree, `getMenuPage`, `menuMarker`,
   `renderMenuCard`.
2. `server/menu.test.ts` — the §9 invariants.
3. `buddy_menu` tool in `index.ts` (mirror `buddy_shop` no-arg branch).
4. MENU NAVIGATION directive in `getInstructions()`.
5. `SKILL.md` — `menu` route + argument-hint.

No schema migrations, no state changes, no new currency — purely additive.
Next: `/sc:implement` against this spec.
