# Analysis — Mechanized Navigation Loop (Phases A+B)

> Status: Code analysis (output of `/sc:analyze`). Findings + roadmap for the
> implementation of [`design-mechanize.md`](./design-mechanize.md). No code
> changes here — apply via `/sc:implement` / `/sc:improve`.

Scope: `server/menu.ts` (envelope, `resolveSelect`, `askFor`, `navMarker`), the
`buddy_menu` handler + `registerTool`/`runTool`/`MENU_TOOLS` registry in
`server/index.ts`, and `server/menu.test.ts`. Grounded against source on
`feature/interactive-menu` as of 2026-06-26. Baseline: **623 tests green, `tsc`
clean, server boots clean.**

---

## Verdict

Solid, well-factored implementation. The pure/impure split is clean
(`resolveSelect`/`askFor`/`navMarker` are pure and testable; the tool is thin
wiring), type safety is preserved through a **single documented escape**
(`as unknown as CapturedHandler`), and both `switch`es (`resolveSelect`,
`directiveCard`) are compile-time exhaustive. The findings below are mostly
**latent risks and one testability gap** — none block the change.

---

## Findings (severity-rated)

### 🟡 MEDIUM — The `buddy_menu` handler's decision logic is untested

`resolveSelect` is unit-tested in isolation, but the handler's branching
(`tool`→`runTool`, `directive`→envelope, `page`→render, `miss`→re-render,
no-select→render) is not — because `index.ts` is **not unit-importable**:
`getInstructions()` runs at `McpServer` construction (`index.ts:185`, touches the
filesystem) and there is a top-level `await server.connect` (`index.ts:~1965`).
By-construction parity covers `runTool` identity but not the handler's control
flow. `index.ts:1347-1381`.

- **Recommendation (highest value):** lift the pure decision into `menu.ts`, e.g.
  `advance(page, select, name): MenuEnvelope | { route: { tool; args? } }`. The
  `index.ts` handler shrinks to "call `advance`; if `route`, `runTool`; else emit
  the envelope." Every branch becomes testable with **zero** server import, and
  it unblocks the Low items below.

### 🟢 LOW — `runTool` bypasses Zod validation/coercion

`runTool(tool, args)` calls the captured handler directly, skipping the schema
parse `server.tool` normally performs. All current `MENU` `kind:"tool"` actions
are **arg-free**, so this is latent — but a future action carrying `args` would
deliver them unvalidated, and any `.default()` / `.transform()` in the tool's
schema would silently not run. `index.ts:runTool`, `menu.ts:541-542`.

- **Recommendation:** keep `kind:"tool"` actions arg-free (assert in a test +
  document the invariant), or parse `args` against the registered schema inside
  `runTool`.

### 🟢 LOW — `CapturedHandler` drops the `extra` param

The cast types handlers as `(args) => …`, and `runTool` invokes them with one
argument. Safe today (verified no menu-reachable handler reads `extra`), but it's
an undocumented coupling — a future handler using request context would break
**only** on the in-process path. `index.ts:registerTool`/`CapturedHandler`.

- **Recommendation:** one-line comment on `CapturedHandler` stating
  menu-reachable handlers must not depend on `extra`.

### 🟢 LOW — Label-addressable `select` is sensitive to label mutation

`resolveSelect` matches `id` first (robust), then `label`. The MENU NAVIGATION
directive tells the model to echo the chosen **label** (emoji + text). Any
harness/model alteration (emoji normalization, casing) → `miss` → silent
re-render. `.trim()` covers whitespace only. Graceful (no crash) but could read
as a confusing no-op loop. `menu.ts:530-534`.

- **Recommendation:** acceptable as-is; optionally fall back to a
  case-insensitive label match before declaring `miss`.

### 🟢 LOW — `KNOWN_TOOLS` is hand-mirrored from registrations

`menu.test.ts:16` keeps a manual set "in sync when the tree grows." `registerTool`
now centralizes registration, so the duplication is avoidable — but closing it
requires importing the registry (same blocker as the Medium finding).

- **Recommendation:** after the `advance()` refactor, assert tree tool-leaves
  against exported registered names instead of a hand-list.

---

## Security review — clean, with one guardrail to add

- ✅ **No new destructive surface.** `runTool` only ever runs with the (empty)
  args in the `MENU` action, so in-process execution is *identical* to Phase A's
  assistant-issued no-arg call — no behavior regression.
- ✅ **`buddy_uninstall` is not in-process-reachable.** It is `kind:"sequence"`
  (assistant-orchestrated, multi-step), never a `kind:"tool"` leaf, so it cannot
  auto-run via `runTool`.
- ⚠️ **Note:** `buddy_summon`, `buddy_save`, `buddy_dismiss` *are* `kind:"tool"`
  leaves (`menu.ts:360/348/384`). Their no-arg forms are non-destructive (show
  usage / random summon), but selecting "Summon" now one-click-swaps the active
  buddy with no confirm. Pre-existing semantics (Phase A did the same), not a
  vuln.
- **Recommendation:** add a **denylist invariant test** — assert no `MENU`
  `kind:"tool"` target is in `{ buddy_uninstall, … }` — so a future edit can't
  accidentally wire an irreversible tool to silent in-process execution.

---

## Performance — net positive, one cosmetic nit

- ✅ In-process `runTool` removes a full assistant round-trip per tool-leaf — the
  core latency/cost win of Phase B.
- `resolveSelect` is two linear scans over ≤4 options; `navMarker` stringifies a
  tiny payload — both negligible.
- 🟢 **Metric nit:** a menu→tool selection increments `commands_run` twice
  (`buddy_menu` at `index.ts:1350` + the routed tool, e.g. `buddy_stats` at
  `:390`). Phase A also produced two increments (two real tool calls), so it is
  **not a regression** — but one user-perceived menu action still counts as two.
  Tighten only if `commands_run` feeds anything user-facing.

---

## Quality / maintainability

- ✅ Single documented type-escape; generics otherwise preserve per-handler arg
  inference (`registerTool<Args extends ZodRawShapeCompat>`).
- ✅ Compile-time exhaustiveness on `resolveSelect` (5 `MenuAction` kinds) and
  `directiveCard` (3 `MenuDirective` kinds) — a new kind fails `tsc`.
- ℹ️ `directiveCard` restates a little of the `do` semantics also encoded in the
  directive text; acceptable.

---

## Prioritized roadmap

1. **Extract `advance()` into `menu.ts`** (Medium) — makes the loop fully
   unit-testable, unblocks #4–#5, shrinks `index.ts` wiring. Highest leverage.
2. **Denylist test** for in-process tool-leaves (Security guardrail) — cheap,
   prevents a future foot-gun.
3. **Arg-free invariant** test/doc for `kind:"tool"` (Low) — closes the
   `runTool` validation gap.
4. **`extra`-independence comment** on `CapturedHandler` (Low).
5. **Replace `KNOWN_TOOLS`** hand-list with exported registry names (Low) —
   after #1.

Items 1–3 are the ones worth acting on. Next: `/sc:implement` the `advance()`
extraction + the two guardrail tests, or `/sc:improve` for the Low items.
