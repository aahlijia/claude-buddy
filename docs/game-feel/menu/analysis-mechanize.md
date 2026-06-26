# Analysis — Mechanized Navigation Loop (Phases A+B)

> Status: **All 5 roadmap items implemented** (2026-06-26). Original analysis
> output of `/sc:analyze`; roadmap closed by `/sc:implement` on the same branch.

Scope: `server/menu.ts` (envelope, `resolveSelect`, `askFor`, `navMarker`), the
`buddy_menu` handler + `registerTool`/`runTool`/`MENU_TOOLS` registry in
`server/index.ts` → `server/registry.ts`, and `server/menu.test.ts`. Grounded
against source on `feature/interactive-menu` as of 2026-06-26. Baseline: **623
tests green, `tsc` clean, server boots clean.** Close: **635 tests green.**

---

## Verdict

Solid, well-factored implementation. The pure/impure split is clean
(`resolveSelect`/`askFor`/`navMarker` are pure and testable; the tool is thin
wiring), type safety is preserved through a **single documented escape**
(`as unknown as CapturedHandler`), and both `switch`es (`resolveSelect`,
`directiveCard`) are compile-time exhaustive. The findings below are mostly
**latent risks and one testability gap** — all addressed by the roadmap.

---

## Findings (severity-rated)

### ✅ MEDIUM — The `buddy_menu` handler's decision logic is untested

**Fixed (#1).** Extracted `advance(page, select, name): MenuEnvelope | RouteResult`
into `menu.ts` — pure, zero server import. The `index.ts` handler is now 4 lines:
call `advance`; if `route`, call `runTool`; else emit the envelope. All 5 branches
(no-select, tool, directive, page-drill, miss) are covered by 9 new tests in
`describe("advance", …)`. `directiveCard` moved to `menu.ts` as a private helper.

### ✅ LOW — `runTool` bypasses Zod validation/coercion

**Fixed (#3).** Invariant test added to `MENU security invariants`: every
`kind:"tool"` leaf must have `args === undefined`. Comment in `registry.ts` explains
the gap so a future action carrying args knows to fix `runTool` first.

### ✅ LOW — `CapturedHandler` drops the `extra` param

**Fixed (#4).** One-line comment on `CapturedHandler` in `registry.ts` states that
menu-reachable handlers must not read `extra` — `runTool` passes only one argument.

### 🟢 LOW — Label-addressable `select` is sensitive to label mutation

Unchanged. Acceptable as-is — a miss re-renders the page, no crash or dead-end.
Optionally fall back to case-insensitive label match before declaring miss.

### ✅ LOW — `KNOWN_TOOLS` is hand-mirrored from registrations

**Fixed (#5).** `MENU_TOOLS`, `runTool`, `ToolResult`, and `CapturedHandler` moved
to `server/registry.ts` (importable without starting the server). `KNOWN_TOOLS`
removed from `menu.test.ts`; replaced with a self-maintaining `buddy_*` naming
convention check — no list to update when the tree grows. `menu.test.ts` imports
`MENU_TOOLS` from `registry.ts` (the runtime source of truth once `index.ts` is
importable in tests).

---

## Security review — clean, guardrails in place

- ✅ **No new destructive surface.** `runTool` only ever runs with the (empty)
  args in the `MENU` action, so in-process execution is *identical* to Phase A's
  assistant-issued no-arg call — no behavior regression.
- ✅ **`buddy_uninstall` is not in-process-reachable.** It is `kind:"sequence"`
  (assistant-orchestrated, multi-step), never a `kind:"tool"` leaf, so it cannot
  auto-run via `runTool`.
- ⚠️ **Note:** `buddy_summon`, `buddy_save`, `buddy_dismiss` *are* `kind:"tool"`
  leaves. Their no-arg forms are non-destructive (show usage / random summon), but
  selecting "Summon" one-click-swaps the active buddy with no confirm. Pre-existing
  semantics (Phase A did the same), not a vuln.
- ✅ **Fixed (#2).** Denylist invariant tests added to `MENU security invariants`:
  (a) no `kind:"tool"` leaf targets a `DENYLIST` tool (`{ buddy_uninstall, … }`);
  (b) `system2.uninstall` is positively asserted as `kind:"sequence"`. A future
  edit wiring an irreversible tool as a leaf will fail both checks.

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

## Roadmap — all items closed

1. ✅ **Extract `advance()` into `menu.ts`** — 9 new branch tests, handler
   shrinks to 4 lines. `directiveCard` moved to `menu.ts`. `RouteResult` exported.
2. ✅ **Denylist test** — `MENU security invariants` describe block: denylist scan
   + positive `kind:"sequence"` assertion for `buddy_uninstall`.
3. ✅ **Arg-free invariant** — test asserts all `kind:"tool"` leaves have
   `args === undefined`; comment in `registry.ts` documents the validation gap.
4. ✅ **`extra`-independence comment** on `CapturedHandler` in `registry.ts`.
5. ✅ **Replace `KNOWN_TOOLS`** — registry extracted to `server/registry.ts`;
   `KNOWN_TOOLS` removed; test replaced with `buddy_*` convention check (self-
   maintaining). `menu.test.ts` imports `MENU_TOOLS` from `registry.ts`.
