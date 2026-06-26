# Design — Idle RPG (equipment, bug-enemies, baked combat, merchant)

> 📍 **Implementation status:** see [`status.md`](status.md). Phases 1–2
> (equipment, merchant) are built & tested; Phases 3–4 (bugs/combat, statusline)
> are designed but not yet implemented.

Status: Design (output of `/sc:design`). A new game-feel arc that turns the
buddy into an **idle RPG**: it carries **equipment** (weapon / hat / trinket),
**bugs spawn as enemies** on the status line, the buddy **auto-fights** them in a
**server-baked animation**, drops are spent at a **merchant**, and selection
flows through **interactive menus**. No production code here — type/signature
sketches are interface design only; build with `/sc:implement`.

Grounded against actual source as of `develop`:
`server/engine.ts` (`BuddyBones`, `HATS`/`HAT_ART`, `renderFace`,
`mulberry32`), `server/xp.ts` (`UnlockableUpgrade`, `UpgradeEffect`,
skill-point economy, `buddy_upgrades` equip/unequip), `server/loot.ts`
(rarity-rolled drops), `server/state.ts` (`StatusState`, `Celebration`,
`writeStatusState`, `effectiveGameFeel`), `server/session.ts`
(`awardSessionComplete` — once-per-commit accrual), and
`statusline/buddy-status.sh` (the dumb cycler + flourish branch). It reuses the
**pre-baked-sequence + `NOW % len` cycler** pattern those files establish.

**Locked decisions** (from the design conversation, 2026-06-25):
- **Economy:** reuse **skill points** — one economy for upgrades, gear, and the
  merchant. No new currency. Bugs drop skill points (+ occasional items).
- **Combat:** **auto-idle**. The buddy fights on its own; the server bakes the
  fight frames once. **Zero per-tick cost.** No interactive turns.
- **Docs-first:** this spec lands before any code, per the project's workflow.

---

## 0. What already exists (reuse, don't reinvent)

- **Equipment is "hats, generalized."** `bones.hat` + `HAT_ART`
  (`engine.ts:85-106`) is already a single cosmetic slot composited over the
  face in `renderBuddy`/`renderCompact`. Equipment slots are the same
  mechanism widened to N named slots.
- **The catalog + reversible-effect pattern.** `UnlockableUpgrade` +
  `UpgradeEffect` (`xp.ts:180-200`) is a data-driven catalog of buyable items
  with `flag`/`shiny`/`hat`/`stat` effects, applied/reverted by
  `applyUpgradeEffect`/`revertUpgradeEffect`, equipped via `buddy_upgrades`.
  Items and the merchant are this pattern re-skinned — **not a new system.**
- **Skill-point economy.** Costs (`cost: number`), affordability, and gating by
  `level`/`prestigeLevel` already exist in the upgrade flow. The merchant reuses
  it verbatim.
- **Drops.** `loot.ts` already rolls rarity-weighted rewards on a cadence. Bug
  defeats hook the same roller for skill-point + item drops.
- **Once-per-commit accrual, zero per-event cost.** `awardSessionComplete`
  (`session.ts`) already computes `delta` counters (incl. `errors_seen`) once
  per git commit — the exact accrual point [[stat-leveling]] uses. Bug spawns
  ride this; no per-event hook, no hot-path work.
- **Baked-animation playback.** `flourishFrames?`/`flourishSequence?`
  (`state.ts:660-661`, `buddy-status.sh` flourish branch) is already a
  "play this baked cycle while fresh, then fall back to idle frames" mechanism.
  The fight animation is a second producer on that exact pattern.
- **The transient celebration slot.** `Celebration{kind:"loot"}`
  (`state.ts:673-685`) already surfaces "you got something." A bug defeat is a
  new producer, not a new channel.
- **The gate.** `effectiveGameFeel()` (`off | subtle | full`, with auto-quiet
  clamp) wraps all ambient motion. Encounters render only at `full`.
- **Interactive selection.** `buddy_pick` already does numbered text selection;
  `AskUserQuestion` (assistant-side) does true prompts. Menus reuse both — no
  new infrastructure.

---

## 1. Design principles (trace to the existing NFRs)

- **Server bakes, bash cycles (NFR2).** No combat loop, HP math, or enemy AI
  runs in the status line. The server computes the entire fight — frames +
  playback sequence + outcome — once, on commit, and writes them like
  `flourishFrames`. Bash gains **one** indexing branch and **zero** new forks.
  Any design asking the shell to "step the fight" is rejected on sight; it would
  regress [[statusline-perf]].
- **The accrual point is `awardSessionComplete` (perf-first).** Spawns, fights,
  and drops all resolve once per commit, reusing the `delta` already computed
  there. **Zero per-event cost** — identical discipline to [[stat-leveling]].
- **The layout invariant holds (NFR6).** An enemy glyph and the fight render
  **inside the buddy's own lane** (the reclaimed wander margin). Bubble,
  connector, stats panel, `PAD`, `MID_SPACER` do not move one cell on any tick.
  Encounter width is folded into existing slack, never pushed onto neighbors —
  the same rule the wander + XP-toast work already defend.
- **The gate comes first (NFR0).** Encounters are a `full`-only delighter. At
  `off`/`subtle` (or when auto-quiet clamps `full→subtle` during an error
  spike) bugs still *spawn and resolve in state* — drops still land — but the
  **fight does not render**. The buddy quietly wins; you see the loot, not the
  brawl. That fall-out is correct behavior, not a bug.
- **One economy, honestly separated (clean code).** Skill points fund
  everything, but item effects stay in their lane: merchant gear is
  **cosmetic + small stat flavor**, never power creep, mirroring the existing
  "flavor, not power creep" ceiling on rarity/prestige multipliers.
- **Outcomes are deterministic & testable (NFR).** Combat resolution is seeded
  by `mulberry32(hashString(userId + commitSha))` — reproducible, unit-testable,
  no `Date.now()` in the core. Pure core + thin I/O wrapper, colocated tests,
  the house pattern.
- **Additive, backfilled state.** Every new `StatusState`/companion field is
  optional and spread in only when present, read in bash with a `// default`
  jq fallback — the `wanderSequence?`/`flourishFrames?` precedent. Old state
  files keep working; a server/bash version skew degrades gracefully.

---

## 2. Equipment slots (FR-E)

**FR-E1 — Slots.** Introduce a fixed, named slot set:
`type Slot = "weapon" | "headgear" | "trinket"`. `headgear` supersedes the
existing single `bones.hat` (which stays as the rendered result; equipment is
the *source* that sets it). Weapon and trinket are new.

**FR-E2 — Equipment state.** Add an optional, backfilled record on the
companion (or `XpState`, wherever upgrades already persist):
```ts
interface Equipment { weapon?: ItemId; headgear?: ItemId; trinket?: ItemId; }
```
Absent ⇒ all slots empty ⇒ identical to today's render. One slot holds at most
one item; equipping into an occupied slot **swaps** (old item returns to
inventory, fully reverted).

**FR-E3 — Items are catalog entries (reuse `UpgradeEffect`).**
```ts
interface Item {
  id: ItemId;
  slot: Slot;
  name: string;
  icon: string;             // single status-line glyph (width-checked)
  rarity: Rarity;           // reuse engine Rarity for drop weighting + stars
  cost: number;             // skill-point price at the merchant
  effect?: UpgradeEffect;   // reuse: flag | shiny | hat | stat (reversible)
  art?: string;             // optional weapon glyph composited beside the face
}
```
Reuse `applyUpgradeEffect`/`revertUpgradeEffect` so equip/unequip stays a clean,
reversible mutation. No new effect engine.

**FR-E4 — Render compositing.** A pure helper in `equipment.ts` composites
equipped art onto the existing face: headgear → the current `HAT_ART` slot;
weapon → a glyph appended to the compact line (e.g. `(·>  ⚔`); trinket →
cosmetic flag/shimmer only. `renderFace` is untouched; compositing wraps it.

**FR-E5 — Tool surface.** Either extend `buddy_upgrades` with
`equipItem=<id>`/`unequipSlot=<slot>`, or add a focused `buddy_equip` tool.
Recommendation: **`buddy_equip`** — keeps the upgrade tool about progression and
the equip tool about gear (separation of duties), but it shares the
apply/revert core.

---

## 3. Bugs as enemies (FR-B)

**FR-B1 — Enemy catalog.** A small data table in `bugs.ts`, severity-ranked:
```ts
interface Bug { id; name; glyph; tier: 1|2|3|4; hp; reward: number; }
// e.g. typo-gremlin (t1) → null-wraith (t2) → race-condition (t3) → segfault-dragon (t4)
```
`glyph` is a single width-checked status-line cell (reuse the emoji-width
discipline already in `statusline/emoji-widths.data`).

**FR-B2 — Spawn trigger (once per commit, zero per-event cost).** In
`awardSessionComplete`, reuse the `errors_seen` delta already computed for XP:
a positive delta spawns a bug whose **tier scales with severity** (more / repeat
errors → tougher bug). No errors that session ⇒ no spawn. This is the same
counter [[stat-leveling]] reads for DEBUGGING — one read, shared.

**FR-B3 — At most one live encounter.** A spawn writes an `encounter` block to
state; the buddy resolves it the same commit (auto-idle, FR-C). There is no
multi-turn enemy queue and no persisted "wandering monster" — keeps state tiny
and avoids a per-tick liveness check.

---

## 4. Baked combat (FR-C)

**FR-C1 — Deterministic resolution.** `combat.ts` exposes a pure function:
```ts
function resolveCombat(buddy, bug, equipment, seed): {
  outcome: "win" | "flee";        // buddies don't "die" — worst case they flee
  frames: string[];               // the baked fight flipbook
  sequence: number[];             // playback indices, NOW % len
  drop?: LootResult;              // skill points (+ maybe item) on win
}
```
Win probability = f(DEBUGGING stat, equipped weapon effect, bug tier). Seeded by
`mulberry32(hashString(userId + commitSha))` — reproducible and unit-testable,
no clock in the core. A `flee` still ends the encounter (no soft-lock), just
with a smaller / no drop.

**FR-C2 — The flipbook.** `frames` are a short cycle: approach → swing → enemy
hit-flash → defeat poof (reusing the buddy's existing emotion frames for the
"swing" pose where possible, so we draw little net-new ASCII). The enemy glyph
sits in the **reclaimed wander margin** beside the buddy — inside the lane.

**FR-C3 — Drops via `loot.ts`.** On `win`, roll the existing rarity-weighted
loot for skill points and an occasional `Item`. Surface it through the existing
`Celebration{kind:"loot"}` slot. No new reward channel.

**FR-C4 — Write path.** `awardSessionComplete` calls `resolveCombat`, then a
single `writeStatusState` carries the new optional fields:
`encounterFrames?`/`encounterSequence?`/`enemyGlyph?` + the loot celebration —
the companion/inventory is written at most once, only on change (the
once-per-commit discipline).

---

## 5. Statusline render (FR-S)

**FR-S1 — One new branch, zero new forks.** `buddy-status.sh` gains a single
branch in the **existing single-pass `jq` read**: if `encounterFrames` is
present **and fresh** (TTL check, reusing the `_CELEB_FRESH` pattern) **and**
`gameFeel == full`, cycle `encounterFrames[NOW % len]` and place `enemyGlyph` in
the margin. Otherwise fall through to flourish → idle frames exactly as today.
No second `jq` invocation; the fields join the existing `0x1F`-separated read.

**FR-S2 — Lane-locked.** The enemy occupies reclaimed margin columns only.
`TOTAL_W`, `PAD`, `MID_SPACER`, the bubble and stats panel are byte-identical
with and without an encounter on any given tick. (Test: snapshot the rendered
width across encounter/no-encounter — must match.)

**FR-S3 — Graceful degradation.** Missing `encounterFrames` (old state, or
server/bash skew) ⇒ the `// []` jq default ⇒ no encounter, normal render.

---

## 6. Merchant (FR-M)

**FR-M1 — `buddy_shop` tool.** A merchant *view* over the `Item` catalog +
skill-point wallet. Lists affordable/locked items with rarity stars and price,
exactly like the `buddy_upgrades` card. Buying calls the shared apply/revert
core and debits skill points.

**FR-M2 — Rotating stock (optional, deferred).** Stock can be a deterministic
daily rotation (seed on date, like the existing seasonal/whim systems) so the
merchant feels alive. Start with a **static catalog**; rotation is an OQ.

**FR-M3 — Interactive selection (the "like Claude Code asking" part).** This is
a **convention at the assistant boundary**, because the MCP server cannot invoke
`AskUserQuestion` — only the assistant can. The contract:
```ts
// buddy_shop returns, alongside its text card:
{ choices?: { id: string; label: string; description: string }[] }
```
When a buddy tool result carries `choices`, the assistant raises an
`AskUserQuestion` with those options; the selection routes back as
`buddy_shop buy=<id>`. The **server stays pure**; interactivity lives where it
belongs. Text-only fallback: `buddy_pick`'s numbered selection already works for
clients without the prompt. Document this `choices[]` contract once so every
future tool (equip, etc.) can opt in consistently.

---

## 7. Module layout (separation of duties)

One file per concern, pure core + thin I/O wrapper, colocated `*.test.ts` —
the house pattern.

| File | Responsibility | Purity |
| --- | --- | --- |
| `server/items.ts` | `Item` type + catalog, slot defs, drop-weight table | **pure** |
| `server/equipment.ts` | equip/unequip/swap, slot validation, render compositing | pure core + I/O wrapper |
| `server/bugs.ts` | enemy catalog, spawn (folded into `awardSessionComplete`) | pure core |
| `server/combat.ts` | `resolveCombat` — seeded outcome + baked frames | **pure** |
| `server/shop.ts` | merchant inventory + purchase/affordability | **pure** |
| `server/session.ts` | (edit) call spawn→resolve once per commit | I/O |
| `server/state.ts` | (edit) extend `StatusState` + `Equipment`, additive | — |
| `server/index.ts` | (edit) `buddy_shop`, `buddy_equip` tools | I/O |
| `statusline/buddy-status.sh` | (edit) one encounter branch in the existing pass | — |

---

## 8. Phasing (each independently shippable + tested)

1. **Items + equipment slots** — `items.ts`, `equipment.ts`, `buddy_equip`,
   render compositing. No combat; you can gear your buddy. Reuses apply/revert.
2. **Merchant** — `shop.ts`, `buddy_shop`, the `choices[]` interactive
   convention. Spend skill points on gear.
3. **Bugs + baked combat** — `bugs.ts`, `combat.ts`, spawn+resolve in
   `awardSessionComplete`, drops via `loot.ts`.
4. **Statusline encounter branch** — render the baked fight; gate under
   `effectiveGameFeel == full`. Wire the game-feel opt-out (still owed from
   [[stat-leveling]]).

Verification each phase: `tsc --noEmit` clean, `bun test` green (new colocated
tests), `bash -n` on the statusline, and a fresh-process smoke for the render.

---

## 9. Open questions

- **OQ1 — `buddy_equip` vs. fold into `buddy_upgrades`.** Recommend a separate
  tool (separation of duties); shares the core regardless.
- **OQ2 — Merchant stock rotation.** Static catalog first; daily deterministic
  rotation (date-seeded, like seasonal/whim) as a fast-follow.
- **OQ3 — Combat balance / win curve.** Exact `P(win)` formula and per-tier HP
  are tuning, deferred to implementation with a tunable constants block.
- **OQ4 — Inventory model.** Do unequipped items persist in an inventory, or is
  equipping a one-way unlock like upgrades? Recommend a small `inventory:
  ItemId[]` so swaps don't destroy gear.
- **OQ5 — Weapon stat effects.** Keep to small flavor (`stat:+N` on the peak,
  capped) to honor the no-power-creep ceiling, or purely cosmetic? Lean flavor.
- **OQ6 — Boss bugs.** A rare high-tier "boss" on big error spikes could justify
  an optional interactive intervene prompt later — explicitly out of scope for
  v1 (auto-idle only).
