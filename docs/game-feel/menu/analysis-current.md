# Menu — Implementation Analysis (current)

**Target:** the interactive command-browser (`/buddy menu`) implementation.
**Date:** 2026-06-30 · branch `feature/free-roam-combat`
**Scope:** `server/menu.ts` (646 LOC) · `server/registry.ts` (27) · the
`buddy_menu` / `buddy_shop` / `upgrades` wiring + MENU-NAVIGATION directive in
`server/index.ts` · `server/menu.test.ts` (31 tests).
**Baseline:** menu suite **31 pass / 0 fail**; whole repo 658 pass, `tsc` clean.

> Source of truth for intent: [`design.md`](design.md),
> [`design-mechanize.md`](design-mechanize.md) (Phase B in-process dispatch),
> [`design-oq1.md`](design-oq1.md) (unified nav channel).

---

## Overall: a well-architected, security-conscious design

The menu is one of the cleaner subsystems in the codebase. The split is textbook:

- **`menu.ts` — pure.** Holds the static `MENU` tree (single source of truth) and
  a pure decision function `advance(page, select, name)` that returns either a
  `MenuEnvelope` (print + follow) or a `RouteResult` (caller runs a tool). No I/O,
  no clock → fully unit-testable, and it is thoroughly tested.
- **`index.ts` — thin handler.** `buddy_menu` calls `advance`, then either runs
  the resolved tool in-process (`runTool`) or emits `display + navMarker`.
- **`registry.ts` — in-process dispatch.** `registerTool` captures each handler
  into `MENU_TOOLS` so a tool-leaf resolves without a second assistant turn,
  byte-identical to a direct call (same handler reference).

**The marker channel is the right shape for LLM-driven menus.** The server
pre-shapes a complete `AskUserQuestion` (`NavAsk`) and the assistant copies it
verbatim — `question`/`header`/`multiSelect`/`options` with a `then` continuation.
Minimizing assistant-side reshaping is a reliability win: the model echoes rather
than re-derives, so menu behavior is deterministic regardless of model variance.

### Security model is the headline strength

`runTool` delivers args **directly** to the handler, bypassing Zod parse and any
`.default()`/`.transform()` coercion. That gap is closed by **two test-enforced
invariants** (`menu.test.ts` "MENU security invariants"):

1. **Denylist** — no `kind:"tool"` leaf may target an irreversible tool
   (`buddy_uninstall`); it must be `kind:"sequence"` so the assistant orchestrates
   the multi-step flow with its natural confirmation surface.
2. **Arg-free tool-leaves** — every `kind:"tool"` leaf carries no `args`, so there
   is nothing to validate or coerce on the unvalidated path.

Args-bearing continuations (shop/upgrades `then.tool` with `buy=<id>`) correctly
go through the **normal, Zod-validated** assistant tool-call path, not `runTool`.
This split — unvalidated path is arg-free, validated path carries the args — is
coherent and deliberate. Good design.

Other strengths: tree invariants enforced by tests (page key == id, 2..4 options,
no dangling targets, all pages reachable from root, unique ids/labels); graceful
degradation everywhere (unknown page → root, miss → re-render, unknown tool →
plain text); `resolveSelect` matches by id *then* label so both the
AskUserQuestion label hand-back and a typed id resolve.

---

## Findings

### 🟠 MEDIUM — `motion` page advertises removed wander features  ✅ RESOLVED (2026-06-30)

> Fixed: `wander-modes` option retired from `menu.ts`; `wander wide`/`wander
> bubble` rows removed from `skills/buddy/SKILL.md`; `design.md` tree diagram
> updated; regression guard added (`menu.test.ts`). 659 tests pass.
`menu.ts:250-254`, the `wander-modes` option:

```
label:       "🤸 Wander modes"
description: "Hop, wide roam, bubble-follow"
action:      { kind: "tool", tool: "buddy_wander" }
```

The **`wide` and `bubble` wander modes were removed** (2026-06-30 game-feel fixes —
`wanderWide`/`wanderBubble` deleted; free-roam makes the whole line the lane and
the bubble always travels). So this option:

- **Describes features that no longer exist** ("wide roam, bubble-follow").
- Is now **near-duplicate** of the `wander` option directly above it — both route
  to `buddy_wander` with no args, so both just render the wander status. With only
  `hop` left as a mode, a separate "modes" leaf no longer earns its slot.

**Fix:** either retire `wander-modes` and add a hop-specific entry, or reword to
`description: "Hop (vertical bob)"`. This is fallout from the wander-flag removal;
the menu surface was missed in that change. (Sibling stale surface, outside this
dir: the `/buddy` **skill routing table** still lists `wander wide` / `wander
bubble` rows — worth cleaning in the same pass.)

### 🟡 MEDIUM (UX) — granular labels, coarse actions on the `style` page  ✅ RESOLVED (2026-06-30)

> Fixed via the locked "picks act" option: added `MenuAction` `kind:"choice"` (a
> fixed-set setter → second-picker `NavAsk`). theme/style/position/rarity/
> gamefeel/wander/statusline/panel/badge now set values on pick. Boolean-arg
> setters carry real booleans through the validated tool-call path (no schema
> coercion). 664 tests pass. `rainbow` stays a coarse `tool` leaf (multi-hex).
On the `style` page all four options — `frame`, `position`, `rainbow`, `rarity` —
route to `buddy_style` with **no args** (`menu.ts:205-228`). Selecting "📍 Position
(top/left)" doesn't set position; it renders the `buddy_style` status card. Same
for the others. The labels imply a granular setter, but the action is "open the
tool." The `motion` page has the same shape (`wander` and `wander-modes` both →
`buddy_wander`).

This is consistent with the design's "command **browser**" framing (the menu
surfaces commands; the tool does the work), and is safe — but the labels
**over-promise** relative to what a pick delivers. Options:
- Accept it and soften labels to read as "open X" (e.g. "📍 Position settings"), or
- Promote the common toggles to `kind:"prompt"` leaves that actually pass the
  chosen value (more menu plumbing, better payoff).

Low-risk either way; flagging the expectation gap, not a bug.

### 🟡 LOW — `MENU_TOOLS` captures every tool, broader than the menu needs  ✅ RESOLVED (2026-06-30)

> Fixed: `runTool` now guards against an allowlist (`menuToolLeaves()`) derived
> from the tree's `kind:"tool"` leaves before dispatching — an off-menu name
> (e.g. `buddy_uninstall`) degrades to the graceful miss even though
> `registerTool` still captures it. The unvalidated path is now structurally
> bounded to menu tool-leaves. +2 tests. 666 tests pass.
`registerTool` (`index.ts:203`) writes **every** registered tool into
`MENU_TOOLS`, while `registry.ts` documents the contract "menu-reachable handlers
must not read `extra`." In practice `runTool` is only ever called from `advance`
with tool-leaves that exist in the `MENU` tree (and those are arg-free + denylist-
checked), so the live surface is safe. But the capture is wider than the
guarantee: a future `runTool(someTool)` call with an off-tree name would invoke a
handler that may read `extra` or expect validated args.

**Defense-in-depth:** scope `MENU_TOOLS` to an explicit allowlist (the set of
tools that actually appear as `kind:"tool"` leaves), or assert membership at
`runTool` entry. Not urgent — current call paths can't reach an unsafe handler.

### ⓘ INFO — minor, no action
- `headerFor` truncates a derived chip to 12 chars (AskUserQuestion bound) and
  could cut mid-word, but every current title derives cleanly; tested.
- `advance`'s "miss → re-render same page" silently swallows an unmatched select.
  Fine for a picker (the user just re-picks), but there's no signal that the
  select was unrecognized — acceptable.

---

## Recommendation

Only **Finding 1 (stale `wander-modes`)** is worth acting on promptly — it's a
correctness/freshness issue and a direct consequence of the wander-flag removal,
so it belongs in that same cleanup (alongside the skill routing table). Finding 2
is a design-intent call for the owner (browser vs. setter). Finding 3 is optional
hardening.

The core architecture — pure tree + decision function, in-process dispatch, and
the two-invariant security model around the unvalidated path — is sound and
well-tested. No structural changes needed.

**Next step:** `/sc:improve` or a focused edit to retire/reword `wander-modes`
(and the skill table), then re-run `bun test server/menu.test.ts`.
