# Design — `/buddy menu`: Mechanize the Navigation Loop

> Status: **Fully implemented** (Phase A + Phase B + post-ship roadmap, 2026-06-26).
> Original component design from `/sc:design`; all five roadmap items from
> [`analysis-mechanize.md`](./analysis-mechanize.md) are closed. See that doc for
> the implementation record. Below is the design as written — still accurate as a
> spec, with §9 updated to reflect the actual shipped tests.

Grounded against actual source as of `feature/interactive-menu`:
`server/menu.ts` (`MenuAction:17`, `MenuPage:34`, `MENU:44`, `getMenuPage:417`,
`menuMarker:425`, `renderMenuCard:435`), `server/index.ts`
(`buddy_menu:1273`, `buddy_shop:1295`, the `MENU NAVIGATION` directive at
`getInstructions():~140`, `choicesMarker` import at `:98`), and
`skills/buddy/SKILL.md` (the thin router + the `CRITICAL OUTPUT RULES`).

**Locked decisions** (the three improvements being designed):

- **#1 Server-side dispatch.** `buddy_menu` gains a `select` arg and resolves the
  picked action *in-process*. Page-drills and tool-leaves stop being assistant
  branches; the server returns the next thing to show.
- **#2 `AskUserQuestion`-ready payload.** The marker stops carrying the menu's
  *internal* shape (`{title, options}`) and carries the harness's exact
  `questions[]` shape instead — copied, never reshaped.
- **#3 Two-field envelope.** Every response splits cleanly into a visible
  `display` (printed verbatim) and a hidden, pre-shaped `ask` / `do`. The
  assistant runs a fixed 3-line procedure, not a 5-way `action.kind` switch.

---

## 1. The problem — Claude is in the loop as an interpreter, not a courier

Today every menu level costs three *deterministic* interpretive steps on the
assistant side (see `MENU NAVIGATION`, `index.ts:~140`):

1. **Find + strip** the hidden `<!-- buddy:menu {...} -->` comment from the card.
2. **Reshape** the payload — `menuMarker` (`menu.ts:425`) emits
   `{page, title, options:[{label, description, action}]}`, but `AskUserQuestion`
   wants `{question, header, multiSelect, options:[{label, description}]}`. The
   assistant maps `title→question`, invents a `header`, sets `multiSelect:false`,
   and drops `action`/`id` from each option.
3. **Branch on `action.kind`** across five arms (`page`/`tool`/`prompt`/`shell`/
   `sequence`) to dispatch the pick.

None of steps 1–3 needs a language model. They are pure data transforms the
server can do. The **one** thing that genuinely cannot leave the assistant:
`AskUserQuestion` is a harness control — the MCP server cannot render it, and the
user's pick returns only to the assistant. So **one assistant round-trip per
level is irreducible.** The goal of this design is to make that round-trip a
**verbatim copy + echo with zero reshaping and no `kind` switch.**

---

## 2. Scope & non-goals

**In scope:**

- A `select` parameter on `buddy_menu` + in-process action resolution.
- A response **envelope**: visible `display` text + a hidden, pre-shaped
  `buddy:nav` marker carrying `{ask?, do?, page}`.
- A new `askFor(page)` helper in `menu.ts` that emits the exact
  `AskUserQuestion` `questions[]` shape.
- A handler registry so `buddy_menu` can run a target `buddy_*` tool in-process
  (improvement #1, Phase B).
- A rewritten, shorter `MENU NAVIGATION` directive + the matching `SKILL.md`
  output-rule note.
- New `menu.test.ts` invariants for the envelope and label-addressing.

**Explicit non-goals:**

- **No new menu pages or commands.** The `MENU` tree (`menu.ts:44-414`) is
  unchanged; this is purely how the tree is *delivered*.
- **No removal of the irreducible round-trip.** `AskUserQuestion` stays
  assistant-driven; we cannot and do not try to render it server-side.
- **No change to `prompt`/`shell`/`sequence` semantics.** Those three genuinely
  need the assistant (free text, a user-run command, the uninstall
  orchestration). They become the *only* surviving `do` branch.
- **No structured MCP return channel.** MCP tool results are text. The "two
  fields" are *visible text* + *one hidden marker*; a literal side-channel the
  harness auto-consumes does not exist (§7).

---

## 3. What already exists (reuse, don't reinvent)

- **The marker idiom is established.** `buddy:choices` (shop) and `buddy:menu`
  both ride a hidden HTML comment the directive consumes. `buddy:nav` is the
  *same channel*, with a payload pre-shaped so the assistant copies it.
- **Every tool body is already a thin wrapper over pure logic.** `buddy_shop`
  (`index.ts:1304`) is `buyShopItem` / `shopListing` / `renderShopCard` + a
  `text()` envelope. Routing a tool-leaf in-process is "call the same function
  the registered tool calls," not new behavior — it's the §6 registry.
- **`getMenuPage` already normalizes bad input** (`menu.ts:417`, unknown→root).
  `select` resolution reuses it; an unknown `select` falls back to re-rendering
  the current page (no crash, no dead-end).
- **The directive channel is the mechanism.** `getInstructions()` already injects
  verbatim behavior. Shrinking `MENU NAVIGATION` is editing one existing
  directive, not adding infrastructure.

---

## 4. The envelope — `server/menu.ts` (interface sketch)

```ts
/** One item of AskUserQuestion's `questions[]` — emitted 1:1, never reshaped. */
export interface AskQuestion {
  question: string;       // = page.title
  header: string;         // short chip (≤12 chars), derived in code from page
  multiSelect: false;     // menus are always single-select
  options: { label: string; description: string }[];
}

/** The only dispatch the assistant still performs — fully specified, no lookup. */
export type MenuDirective =
  | { kind: "prompt"; tool: string; arg: string; ask: string }
  | { kind: "shell"; command: string }
  | { kind: "sequence"; sequence: "uninstall" };

/** What buddy_menu returns, split into visible vs. machine halves. */
export interface MenuEnvelope {
  /** Printed verbatim: the page card, OR a routed tool's rendered output. */
  display: string;
  /** Present when the next step is a picker. Copy straight into AskUserQuestion. */
  ask?: AskQuestion;
  /** Present when the next step needs the assistant. Mutually exclusive with ask. */
  do?: MenuDirective;
  /** The page these options belong to — echoed back as `page` on the next select. */
  page: string;
}

/** Build the harness-ready question for a page (improvement #2). */
export function askFor(page: MenuPage): AskQuestion;

/** Hidden marker carrying only the machine half (improvement #3). */
export function navMarker(env: MenuEnvelope): string;
//   => `<!-- buddy:nav ${JSON.stringify({ ask, do, page })} -->`

/** Resolve a selection on a page to the next envelope (improvement #1). */
export function resolveSelect(
  page: MenuPage,
  select: string,            // matches an option by id OR by label
): SelectResolution;

export type SelectResolution =
  | { kind: "page"; page: MenuPage }                 // drill — render the next page
  | { kind: "tool"; tool: string; args?: Record<string, unknown> } // run in-process
  | { kind: "directive"; do: MenuDirective }         // hand back to the assistant
  | { kind: "miss" };                                // unknown select → re-render
```

`MenuAction`, `MenuOption`, `MenuPage`, and the `MENU` tree are **unchanged**.
`menuMarker` (`menu.ts:425`) is retired in favor of `navMarker` + `askFor`;
`renderMenuCard` stays as the `display` builder for a page.

**Why match by id *or* label?** `AskUserQuestion` returns the chosen option's
**label** string (it has no hidden id field). Letting `select` accept the raw
label means the assistant echoes exactly what the harness handed it — no
label→id lookup on the assistant side. Matching id too keeps "Other → typed
command" robust. This makes **label-uniqueness within a page** a new invariant
(§9.4).

---

## 5. The tool — `buddy_menu({ page?, select? })`

```ts
server.tool(
  "buddy_menu",
  "Open or advance the interactive buddy command browser. No args → root page. " +
    "Pass `page` + `select` to advance: the server resolves the pick and returns " +
    "the next page, the routed tool's output, or a do-instruction. The result " +
    "carries a hidden buddy:nav marker — follow MENU NAVIGATION; never print it.",
  {
    page: z.string().optional().describe("Current page id (default: root)"),
    select: z.string().optional().describe("Chosen option label or id"),
  },
  async ({ page, select }) => {
    const companion = ensureCompanion();
    let node = getMenuPage(page);
    incrementEvent("commands_run", 1, activeSlot());

    if (select) {
      const r = resolveSelect(node, select);
      if (r.kind === "tool") return runTool(r.tool, r.args);          // §6, in-process
      if (r.kind === "directive") return navEnvelope(directiveCard(node), undefined, r.do, node.id);
      if (r.kind === "page") node = r.page;                            // fall through, render
      // r.kind === "miss" → fall through, re-render current node
    }
    return navEnvelope(renderMenuCard(node, companion.name), askFor(node), undefined, node.id);
  },
);
```

`navEnvelope(display, ask, do, page)` emits `display + "\n\n" + navMarker(...)`.
The no-arg and bad-input paths behave exactly like today (`getMenuPage`
fallback). The single observable change for a *page* drill: the assistant calls
`buddy_menu page=… select=…` instead of `buddy_menu page=<resolved-by-hand>`.

---

## 6. In-process tool routing — the handler registry (improvement #1, Phase B)

For a `tool`-kind leaf to resolve server-side, `buddy_menu` must produce the
target tool's output without a second assistant turn. Today each tool body is an
inline closure passed to `server.tool(...)`. Refactor each *menu-reachable*
handler into a named async function and register it in a map:

```ts
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const MENU_TOOLS: Record<string, ToolHandler> = {
  buddy_shop:           handleShop,        // already factored over shop.ts
  buddy_equip:          handleEquip,
  buddy_upgrades:       handleUpgrades,
  buddy_stats:          handleStats,
  // … every tool named in MENU's `kind:"tool"` actions
};

function runTool(tool: string, args?: Record<string, unknown>): ToolResult {
  return (MENU_TOOLS[tool] ?? unknownToolCard(tool))(args ?? {});
}
```

`server.tool(name, …, handler)` and `MENU_TOOLS[name]` then reference the **same
function** — zero duplication, no behavior change, outputs byte-identical (the
existing 616 tests guard this). When a routed tool's own output carries a
`buddy:choices` marker (the shop), `buddy_menu` passes it through untouched, so
the shop's buy flow chains exactly as it does now.

**Phasing note.** This registry is the heaviest piece (it touches ~15 tool
registrations). It is isolated to Phase B; Phase A (§12) delivers the
reshape-elimination and page-side server dispatch *without* it, by keeping
`tool`-leaves as a one-line `do:{kind:"call", tool, args}` instruction. If Phase
B is deferred, the assistant still makes a single mechanical "call this tool"
step with no reshape and no 5-way branch.

---

## 7. The directive — `MENU NAVIGATION`, rewritten

Replaces the current five-arm directive. Verbatim intent:

> **MENU NAVIGATION:** `buddy_menu` returns a visible card followed by a hidden
> `buddy:nav` marker. **Print everything before the marker verbatim; never print
> the marker.** Then, from the marker's JSON:
> - If it has **`ask`** — call `AskUserQuestion` with `ask` **verbatim** (it is
>   already a complete `questions[]` item; do not add, drop, or rename fields).
>   When the user picks, call `buddy_menu` with `page=<marker.page>` and
>   `select=<the chosen option's label>`. Nothing else.
> - If it has **`do`** — perform exactly that one instruction: `prompt` → ask the
>   user `do.ask`, then call `do.tool` with the answer as `do.arg`; `shell` →
>   tell the user to run `! do.command`; `sequence` → run the named orchestration
>   (per `SKILL.md`).
> - If the user picks **Other** and types a buddy command, route it as if typed
>   after `/buddy`; `back`/`menu` → `buddy_menu` (no args). Never re-present a
>   menu without the user advancing it.

The assistant's per-level work drops from **find+strip → reshape → 5-way
branch** to **print → (ask: copy & echo | do: one instruction).** A 2-way
test on a pre-built payload, no transformation.

---

## 8. `SKILL.md` changes

- **`CRITICAL OUTPUT RULES`** — replace the `buddy:menu` exception with
  `buddy:nav`: print the card, never the marker; the marker drives
  `AskUserQuestion`/`do` per `MENU NAVIGATION`.
- **Routing table** — the `menu` row is unchanged (still `buddy_menu` no-args →
  root; the directive now carries the loop).

No new routes, no argument-hint change. Router stays thin.

---

## 9. Tests — `server/menu.test.ts` (additions)

Existing invariants (option bounds, no dangling pages, connectivity, real tools)
stay. New ones for the mechanization:

1. **`askFor` shape:** for every page, `askFor(p)` has `question === p.title`,
   `multiSelect === false`, a non-empty `header` ≤12 chars, and
   `options` mapping each `MenuOption` to exactly `{label, description}` — no
   `action`/`id` leakage.
2. **Marker round-trips:** `JSON.parse` of `navMarker(env)`'s payload
   deep-equals `{ask, do, page}` (whichever are present); `ask`/`do` never both
   present.
3. **`resolveSelect` by id and by label:** for every option on every page,
   `resolveSelect(p, opt.id)` and `resolveSelect(p, opt.label)` return the same
   resolution; the resolution's `kind` matches `opt.action.kind`
   (page→page, tool→tool, prompt/shell/sequence→directive).
4. **Label uniqueness (new invariant):** every `MenuPage` has unique option
   **labels** (not just ids), since `select` is label-addressable.
5. **Unknown select → miss → re-render:** `resolveSelect(p, "nope").kind ===
   "miss"`; the tool path re-renders `p` (no throw, no dead-end).
6. **Routed-tool parity (Phase B):** ~~`runTool("buddy_stats", {})` output is
   byte-identical to the registered handler's output.~~ **Not added as a runtime
   test** — `index.ts` is not unit-importable (`getInstructions()` runs at
   `McpServer` construction and touches the filesystem; there is a top-level
   `await server.connect`). Parity is instead **guaranteed by construction**:
   `registerTool` stores the *same handler reference* it passes to `server.tool`,
   so `runTool(name)` and calling the tool by name are the identical function.
   Tool-leaf validity is covered statically by the `buddy_*` naming-convention
   test in `menu.test.ts` (replaced the hand-maintained `KNOWN_TOOLS` set) + `tsc`.
   The registry itself now lives in `server/registry.ts` (importable without the
   server), imported by both `index.ts` and `menu.test.ts`.
7. **Card snapshot:** `renderMenuCard(MENU.root, name)` stays byte-stable
   (existing snapshot unaffected — `display` is the same card).

**Additional tests shipped post-analysis (closed roadmap):**

- `describe("advance", …)` — 9 tests covering all 5 handler branches: no-select,
  tool-leaf (by label + by id), page drill-down, prompt/shell/sequence directives,
  and miss re-render. Pure `menu.ts` import, zero server dependency.
- `describe("MENU security invariants", …)` — denylist scan (no `kind:"tool"` leaf
  targets `{ buddy_uninstall, … }`), positive assertion that `uninstall` is
  `kind:"sequence"`, and arg-free invariant (all `kind:"tool"` leaves have
  `args === undefined`).

---

## 10. Edge cases & decisions

- **Label collision after future edits:** caught by §9.4 at test time, before it
  can make a `select` ambiguous. (Today only ids must be unique.)
- **Unknown / stale `select`:** resolves to `miss` → re-render the current page.
  The assistant never errors; the user just sees the menu again.
- **`ask` and `do` mutual exclusion:** a node is *either* a picker *or* a
  hand-off, never both. Enforced in `navEnvelope` and asserted (§9.2).
- **Routed tool emits its own `buddy:choices` (shop):** passed through verbatim;
  the existing shop directive takes over — chaining is preserved, not
  re-implemented.
- **`prompt` with no usable answer:** unchanged — fall back to the no-arg tool
  behavior (matches `menu/design.md` §10).
- **Backward compatibility:** `buddy:menu`/`menuMarker` are removed in the same
  change as the directive and `SKILL.md` rule, so the assistant never sees a
  stale marker shape. Requires a CC restart to pick up the new server + skill
  (consistent with the menu's existing "needs restart" status).
- **MCP unavailable:** the `SKILL.md` Fallback gate already blocks every buddy
  command, `menu` included — nothing extra needed.

---

## 11. Settled decisions (all resolved)

- **OQ-1 — fold the shop into `buddy:nav`? → FUTURE implementation, not this
  design.** The shop's `buddy:choices` flow already works and is independently
  routed; routing *into* it (§10) is enough for now. Unifying the two markers
  under one envelope is a deferred cleanup — noted for a later phase, explicitly
  out of scope here.
- **OQ-2 — should `select` accept id, label, or both? → BOTH, label preferred.**
  Label-addressing removes the assistant's label→id lookup (§4); id-matching
  keeps "Other → typed command" robust. Cost is the §9.4 label-uniqueness
  invariant — cheap and test-guarded.
- **OQ-3 — Phase B registry now or later? → Design now, ship Phase A first.**
  Phase A already kills the reshape and the 5-way branch (the bulk of the
  "analysis"). Phase B converts the residual "call this tool" step into a
  zero-turn server render and is mechanical follow-through — sequenced after A,
  not abandoned (§12).
- **OQ-4 — derive `header` how? → Explicit optional `MenuPage.header?` with a
  code-side fallback.** Each page may set a short chip (e.g. `"Shop & Gear"`,
  `"Stats"`); when absent, `askFor` derives one from the first word(s) of
  `title`. Explicit where it matters, automatic everywhere else.

---

## 12. Build order (two phases)

**Phase A — reshape-free delivery (the big win, small surface):**

1. `menu.ts` — add `AskQuestion`, `MenuEnvelope`, `MenuDirective`, `askFor`,
   `navMarker`, `resolveSelect`; retire `menuMarker`. Add optional
   `header?` to `MenuPage` (OQ-4).
2. `buddy_menu` — add `select`; resolve `page` server-side; emit `tool`-leaves
   as a `do:{kind:"call"}` instruction (no registry yet).
3. Rewrite `MENU NAVIGATION`; update `SKILL.md` output rule.
4. `menu.test.ts` — §9.1–9.5, 9.7.

**Phase B — in-process tool routing (zero-turn leaves):**

5. Extract menu-reachable tool bodies into named handlers + `MENU_TOOLS` map
   (§6); `runTool` dispatch; drop the `do:{kind:"call"}` shim.
6. `menu.test.ts` — §9.6 routed-tool parity.

No schema migrations, no state changes, no new currency — additive and
refactor-only. Next: `/sc:implement` against this spec (Phase A first).
```