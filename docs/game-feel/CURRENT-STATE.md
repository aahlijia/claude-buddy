# Game-Feel — Current State

A single top-level snapshot of the **whole** game-feel system as it stands today,
tying together the arcs that each have their own design/status docs. For the
per-arc detail, follow the links in [Doc map](#doc-map).

_Last updated: 2026-07-08 · branch `feature/interactive-fight-scene`_
_Baseline: **755 tests pass** · `tsc --noEmit` clean · `bash -n` clean_
_Status: the idle-RPG arc through P5 plus the rewards/derive-on-read passes are
**committed** on `feature/interactive-fight-scene` (through `711103d`/`39d44da`,
2026-07-07/08). Newest work, **uncommitted** on top: the
[Combat spawn signal broadened](#combat-spawn-signal-broadened--classifier-fixes-2026-07-08)
fix and the fully-landed
[Pending encounter](#pending-encounter--the-standoff-2026-07-08) arc
(Phases 1–4). No PR opened yet._

> **What "game-feel" is.** A layer of optional juice on top of the buddy
> companion: celebratory feedback, an expressive idle status line, light RPG
> progression, and an idle-combat minigame — all governed by one intensity gate
> so it can be as loud or as silent as the user wants. Nothing here changes the
> companion's core behavior; it's all delighters that degrade gracefully.

---

## The intensity gate (the cross-cutting control)

Everything routes through one knob: **`gameFeel` ∈ {`off`, `subtle`, `full`}**
(config `gameFeel`, set via `buddy_gamefeel` / `/buddy gamefeel`). It is read
once per status write through **`effectiveGameFeel()`**, which applies a
transient clamp before anything renders:

| Level | Celebrations / toasts | Emotion + idle animation | Idle-RPG combat |
| --- | --- | --- | --- |
| `off` | none | none (classic static line) | **opt-out** — no fight is even resolved or written |
| `subtle` | brief toasts only | no animation | fight resolves + loot toast, **no on-line scene** |
| `full` | toasts + animation | emotion frames, free-roam wander, flourish | full two-sprite combat scene on the line |

**Auto-quiet (FR-E1).** With `autoQuietFocus` on, a long error-free flow state
clamps `full → subtle` automatically so animation never interrupts deep focus;
`subtle`/`off` are left untouched. The clamp is in `state.ts` (§"Auto-quiet")
and is the same value the wander/flourish/scene branches already consult, so the
whole line goes quiet with no extra wiring.

`off` is a true opt-out, not just a render suppressor: `session.ts` /
`accrueSessionStats` and `maybeFightBug` early-return, so an `off` user accrues
no stat drift and spawns no encounters.

---

## What's in the system

### 1. Celebratory feedback
- **Celebration channel** (`state.ts` `buildCelebration`) — gate-gated toasts for
  level-ups, XP gains, loot, achievements; rides a guarded side-channel so a roll
  failure never breaks the status write.
- **XP bar + "+N XP" toast** on the status line (the Lv row).
- **Brag card** (FR-E2), **memory-narrated milestones** (FR-E3), **self-announcing
  discovery** (FR-E4), **easter egg** (name ×10 → hidden flag + celebration).
- **Loot drops** persist a transient `lastDrop` (TTL'd), surfaced as a toast.

### 2. Expressive idle line
- **Emotion frames** (FR-A4) — `neutral/happy/angry/bored/surprised`, derived at
  render time from species art by eye substitution + a short micro-cycle (no new
  per-species frame data). Server bakes the frame sequence; bash just cycles it.
- **Ascension flourish** (FR-A3) — opt-in celebratory frame set, animated only
  while a celebration is fresh, then self-reverts to neutral frames.
- **Free-roam wander** (movement, §11) — see [§4](#4-idle-movement-free-roam).
- **Rare idle / surprise bubbles** (D2), **seasonal cosmetic hat** (C2, fills an
  empty slot only), **age tell** 🌱→🌿→🌳 (C3), **shiny hatch** (D4).

### 3. Stats & leveling
- XP/level/title/prestige/streak, surfaced in `buddy_xp` and the status line.
- **Stat leveling** — five stats (DEBUGGING/PATIENCE/CHAOS/WISDOM/SNARK) rise from
  coding signals, accrued once per commit at zero per-event cost. Optional stats
  panel (`showStats` / `buddy-stats`).
- **Cosmetic sets** (C1) grant a flavor title on completion; **achievement
  progress** shows `n/target` fractions.

### 4. Idle movement (free-roam)
- Pure seeded random walk in `wander.ts` (`buildWanderSequence` / `moodWalkOpts`):
  mood + level map to a walk personality; the server bakes a per-tick offset
  sequence, bash cycles it. `full`-gated + `wanderEnabled` opt-out.
- **Free-roam layout** (`buddy-status.sh`, design-movement §11): stats are
  left-anchored; the **cluster `[bubble · connector · art]` travels as one rigid
  block** between the stats panel and the window edge, clamped to stay fully
  in-window (no clipping). The bubble travels with the buddy by default; the
  connector stays attached. Bubble-drop degradation when the terminal is too
  narrow (sprite visibility wins).
- Optional **vertical hop** (`wanderHop`, costs one reserved row).
- The retired right-margin **corridor** model (and its `wanderWide`/`wanderBubble`
  flags) was **removed** — see [Recent changes](#recent-changes-2026-06-30).

### 5. Idle-RPG arc (P1–P5, see [idle-rpg/status.md](idle-rpg/status.md))
- **Equipment** (P1) — weapon/headgear/trinket slots; derive-on-read appearance
  (innate bones never mutated); equipped headgear shows on the live line.
- **Merchant + interactive menus** (P2) — `buddy_shop`; the hidden
  `buddy:choices` / `buddy:nav` marker channel turns tool output into
  `AskUserQuestion` menus (the assistant drives it via `getInstructions`, since
  MCP tools can't call `AskUserQuestion` themselves).
- **Bugs as enemies + baked combat** (P3) — errors spawn a tiered bug;
  `resolveCombat` is pure/seeded → outcome + drop. Buddies never die (worst case
  flee).
- **Statusline render + opt-out** (P4).
- **Two-sprite combat scene + free-roam** (P5) — the bug renders as a **mirrored
  second creature** beside the buddy; a constant-width
  ready→wind-up→strike(clash)→resolve flipbook (`bakeScene` in `combat.ts`,
  `mirrorFrame`/`eyeRowIndex` in `art.ts`). The frames Phase 4 baked-but-discarded
  are now consumed as the render.
- **Pending encounter / standoff** (design-pending-encounter, 2026-07-08) — the
  enemy now appears at the **first error** and stands its ground (a strike-less
  `bakePendingScene` flipbook in its own no-TTL `pending-encounter.json`) until a
  commit fights the pinned bug; a *commit nudge*. See
  [the standoff section](#pending-encounter--the-standoff-2026-07-08).

### 6. Interactive menu
- `buddy_menu` + a unified nav channel route `/buddy` sub-commands through
  `AskUserQuestion` menus (shop, upgrades, etc.). See [menu/](menu/).
- **Fixed-set picks now *act* (`kind:"choice"`, 2026-06-30):** theme, style,
  position, rarity, game-feel, wander, status-line, stat-panel, and badge are
  picker-driven setters — a pick calls the tool with the chosen value (a real
  boolean for the on/off toggles), riding the **validated** tool-call path. The
  unvalidated in-process `runTool` path is bounded to the tree's `kind:"tool"`
  leaves via an allowlist. See [menu/analysis-current.md](menu/analysis-current.md).

---

## Architecture invariants

These hold across every surface above and are the reason it stays cheap and
testable:

1. **Server bakes, bash cycles.** Every animation (idle frames, emotion, flourish,
   wander, combat scene) is a **pre-baked frame/offset sequence** written into
   `status.json`. `buddy-status.sh` is a dumb frame-cycler indexed by `NOW % len`
   — never a live loop. New motion = a new baked sequence, not new shell logic.
2. **Pure cores, seeded RNG.** `wander.ts`, `combat.ts`, `bugs.ts`, and the
   `art.ts` frame helpers take an injected seed and do no I/O or clock reads →
   deterministic and unit-testable. Thin I/O wrappers persist results.
3. **Derive-on-read.** Equipment/seasonal/gear **and owned upgrades**
   (`ownedUpgradeEffects` + `resolveAppearance`, see
   [design-derive-upgrades.md](idle-rpg/design-derive-upgrades.md)) fold into
   the *rendered* appearance on read; innate bones are never mutated. A
   one-time migration rebases any pre-existing state where an upgrade's effect
   was still baked into bones.
4. **Guarded writes.** `writeStatusState` wraps every optional subsystem in a lazy
   `require` + try/catch, so first-install / version-skew never breaks the line.
   Writes are atomic (`tmp` + `rename`) — three processes touch `status.json`.
5. **One gate.** `effectiveGameFeel()` (incl. the auto-quiet clamp) is the single
   read every delighter consults.
6. **Real-estate budget (NFR6) + graceful degradation (NFR7).** Hop headroom,
   bubble-drop, and the in-window clamp keep the block within `COLS`.

---

## Config & command surface

| Config key | Command | Default | Effect |
| --- | --- | --- | --- |
| `gameFeel` | `/buddy gamefeel <off\|subtle\|full>` | `subtle` | the intensity gate |
| `autoQuietFocus` | (config) | `false` | clamp `full→subtle` during error-free flow |
| `wanderEnabled` | `/buddy wander <on\|off>` | `true` | idle free-roam amble (`full`-gated) |
| `wanderHop` | `/buddy wander hop` | `false` | vertical hop (costs one row) |
| `showStats` | `/buddy-stats` | `false` | stats panel (left column) |
| `showPrestigeBadge` | (config) | `false` | prestige/streak badge line |
| `useCombinedStatus` | (config) | `false` | model/ctx/usage/reset header line |
| `bubbleMargin` | `/buddy margin` | `8` | right-edge reserve / roam cushion |

> Note: `/buddy wander` no longer takes `wide`/`bubble` — both were removed
> (free-roam makes the whole line the lane and the bubble always travels).

---

## Recent changes (2026-06-30)

Two `/sc:analyze` → `/sc:implement` passes, both **uncommitted** on
`feature/free-roam-combat`. Plans:
[`workflow_game-feel-fixes.md`](../../claudedocs/workflow_game-feel-fixes.md),
[`workflow_menu-fixes.md`](../../claudedocs/workflow_menu-fixes.md).

### Game-feel fixes

1. **Removed the dead `wide`/`bubble` wander flags.** `wanderBubble` was inert and
   `wanderWide` reported a retired "corridor" while only widening roam. Deleted the
   `wanderWide`/`wanderBubble` config keys, the `WANDER_RANGE_WIDE` constant, and
   the `wide`/`bubble` args on `buddy_wander` (across `index.ts`, `state.ts`,
   `buddy-status.sh`, the render test, and `design-movement.md`). Roam distance is
   now governed solely by `moodWalkOpts` clamped to `SPAN`.
2. **Fixed the combat-scene clash row.** `bakeScene` placed the sword clash at the
   block center, which misaligns for species whose eyes aren't centered
   (goose/snail row 1, mushroom row 3, 6-line wyvern). Added `eyeRowIndex()` to
   `art.ts` (derives the eye row from the art) and a top-padding adjustment in
   `bakeScene`; added a wyvern-player regression test.
3. **Gated a per-tick fork.** The emoji-width data grep now runs only when there's
   bubble text to measure, saving a `grep`+`tr`+`dirname` fork per second on the
   bubble-less idle path. Documented the intentional ~1s TTL-granularity skew in
   `combat.ts`.

### Menu fixes (3 phases)

1. **Retired the stale `wander-modes` menu option** + the `wander wide`/`wander
   bubble` rows in `skills/buddy/SKILL.md` (fallout from the wander-flag removal).
2. **Picks now act** — new `MenuAction` `kind:"choice"` turns 9 fixed-set leaves
   (theme/style/position/rarity/gamefeel/wander/statusline/panel/badge) into
   setters; on/off toggles carry real booleans, no schema coercion.
3. **`runTool` allowlist** — in-process dispatch is bounded to the tree's
   `kind:"tool"` leaves (`menuToolLeaves()`), so an off-menu/denylisted handler
   can't be reached even though `registerTool` captures every tool.

Tests across both passes: **666 pass**, `tsc` + `bash -n` clean.

### Combat-toast clobber fix (2026-07-02)

`maybeFightBug` wrote the fight-summary toast itself, but `award-xp.ts` writes
status again immediately after `awardSessionComplete` returns — overwriting the
toast before it ever rendered. At `full` only the summary text was lost (the
scene survives via `encounter.json`); at `subtle`, where the toast is the *only*
combat surface, fights were completely invisible. Fix: `maybeFightBug` no longer
writes status and instead **returns the summary**; `awardSessionComplete`
threads it out (`SessionCompletion.fightSummary`), and `pickCelebration` — moved
from `award-xp.ts` into `state.ts` beside `buildCelebration` and now unit-tested
— gives the fight a slot in the ladder (level-up > whim > **fight** > discovery),
mirroring `CELEB_PRIORITY`. A fight also suppresses the once-ever discovery
announce so the intro isn't consumed unseen. Verified end-to-end: the toast and
the `+N XP` toast now land in the same final write, and the bubble renders at
`subtle`. Tests: **672 pass**, `tsc` clean. Uncommitted.

### Hardening + fold-ins (2026-07-02, same pass)

The remaining `/sc:analyze` findings, all verified end-to-end (hostile reaction
string through the real renderer from a glob-bait directory):

1. **Bubble word-wrap no longer globs** — `WORDS=($BUBBLE_TEXT)` →
   `read -ra WORDS`; reactions canonically contain `*asterisks*`, and the
   unquoted expansion pattern-matched them against the CWD.
2. **Control chars sanitized on the render path** — the jq free-text `gsub`
   class widened from `[\t\n\r]` to `[\x01-\x1f\x7f]` (ESC included), and now
   also covers `celebration.text` and the sticky-bubble reaction-file fallback.
   Frame art stays exempt (base64'd raw — wyvern's flame is legitimate ANSI).
3. **Wyvern hats now render on the status line** — `renderSpeciesFrame` routes
   through `applyHat` (the card path's renderer, which knows the wyvern's
   between-the-horns placement) instead of its own blank-row-0-only logic.
   Non-wyvern output is byte-identical (snapshot unchanged).
4. **`writeStatusState` reads once** — one `loadConfig()` + one `loadReaction()`
   per write, shared by the clamp/emotion/wander branches (was ~3×/2×); new pure
   `autoQuietReasonFor()` core, `autoQuietReason()` is now a thin reading shell.
   Also renamed the wander branch's shadowing `opts` → `walkOpts`.
5. **`config.json` + reaction writes are atomic** (tmp+rename, same idiom as
   status/manifest) — bash re-reads config every tick.
6. **`gameFeel` is enum-coerced on load** (`coerceGameFeel`, mirrors the bash
   validation) so a hand-edited value can't half-pass the TS gates.

Tests: **679 pass**, `tsc` + `bash -n` clean, snapshot byte-identical.

### Merge into `feature/interactive-menu` (2026-07-06)

Everything above — the full idle-RPG P5 combat-scene/free-roam arc plus the
combat-toast fix and hardening pass — was merged from `feature/free-roam-combat`
into `feature/interactive-menu` (merge commit `fa8cc6f`), landing alongside the
`/buddy menu` interactive browser and its three menu-fixes phases (see
[menu/analysis-current.md](menu/analysis-current.md)). Both arcs now share one
branch and one test baseline (679 pass). No pull request has been opened for
this branch yet.

### Rewards/leveling fix pass (2026-07-06, `/sc:analyze` → `/sc:improve`)

Two correctness bugs plus smaller cleanups, all **uncommitted**:

1. **Loot cosmetics never applied — and could crash a commit.** `rollLoot`
   persisted the applied cosmetic via the *append-only* `saveCompanionSlot`,
   which **throws** for an existing slot — so every cosmetic drop on a live
   buddy failed. Swallowed at most call sites (cosmetics silently never worked),
   but the streak-milestone call in `session.ts` is unwrapped: ~12% of every 3rd
   commit crashed `award-xp` *before* the session re-baselined (double-counting
   the next session). Now `updateCompanionSlot`, the whole apply block is
   guarded, and a drop only counts (owned/logged/toast) once a companion
   actually received it — no companion ⇒ points-only, cosmetic stays in the
   pool. New fresh-process regression test exercises the real-slot path.
2. **Post-ascension refunds corrupted stats/hats and credited nothing.**
   `applyAscension` reopens respec with `pointsSpent = 0` while every
   pre-ascension unlock stays owned, so `refundError` allowed refunding plain
   L11+ upgrades: a stat bought at the 100 cap under-refunded (permanent innate
   loss), a hat revert set `bones.hat="none"` (clobbering innate/loot hats), and
   the "+N pt" credit was a no-op (`max(0, 0−cost)`). Two new guards: lossy
   (hat/stat) upgrades are never refundable, and a refund requires
   `pointsSpent >= cost` (the current budget actually paid for it). Fresh
   post-ascension purchases stay refundable. +5 regression tests.
3. **`bubbleWidth` default drift** — bash fell back to 44 where
   `DEFAULT_CONFIG` says 28, so the first config write visibly narrowed the
   bubble. Aligned to 28; `DEFAULT_CONFIG` is now exported and a new parity
   test pins every bash fallback (jq `//` defaults + pre-read initializers) to
   it.
4. **Smaller:** `tickWhim` no longer rewrites `whims.json` on every XP event
   (saves only on the fulfilled→rewarded flip); prestige-badge centering
   accounts for 🔥's double width; `saveXpState` imports `renameSync` normally;
   `autoQuietReasonFor`'s dead `hasFreshError` re-check is a literal `false`.

Tests: **685 pass** (679 + 8 new − 3 rewritten to the corrected loot
semantics), `tsc` + `bash -n` clean.

### Derive-on-read for upgrades (2026-07-06)

Root-fixed the mutation model the rewards fix pass above had papered over with
guards. Full design: [design-derive-upgrades.md](idle-rpg/design-derive-upgrades.md).

Upgrade purchases used to mutate `companion.bones` directly
(`applyUpgradeEffect`/`revertUpgradeEffect`), the same bug class equipment
solved back in idle-RPG Phase 1 with derive-on-read. Four phases, in order
(each a working-tree checkpoint, tests green throughout):

1. **Resolver extension (inert).** `resolveAppearance`/`gearedBones`
   (equipment.ts) gained an `upgradeEffects` param, defaulting to `[]` so
   nothing changed yet; `ownedUpgradeEffects(state)` (xp.ts) maps
   `unlockedUpgrades` to their catalog effects in purchase order.
2. **Migration machinery (inert).** New `server/migrate.ts`: a pure per-slot
   rebase (subtract baked stat amounts on the active slot only; reset a
   baked-in hat unless an owned loot cosmetic also grants it; undo the aura's
   shiny only where it's actually set) plus the I/O entry point
   (`migrateUpgradeEffects`, lazy-requires the companion store, guarded
   try/catch). Two new markers — `XpState.upgradeEffectsDerived`,
   `Companion.effectsRebased` — but **not yet wired** into `loadXpState`, so
   still fully inert.
3. **The flip.** `loadXpState` now runs the migration once per un-migrated
   state; all six consumer sites (status write, `buddy_show` card, combat,
   `sets.ts` set-completion, spend/refund) rewired to fold owned-upgrade
   effects in at read time. `applyUpgradeEffect`/`revertUpgradeEffect`,
   `UnlockResult.companionChanged`, and the vestigial `active` field on the
   upgrade catalog are all deleted. `refundError`'s hat/stat "can't be cleanly
   reverted" guard (added in the rewards fix pass, above) is gone — refunds
   are exact now, so the two guard regression tests from that pass **flipped**
   to expect success instead of rejection.
4. **Docs + validation (this).** README semantic-delta note (unlocks now
   apply menagerie-wide and hat/stat refunds work like any other), a
   testing-guide section with a live buy/refund/migration harness, this
   snapshot, and a full-suite + `tsc`/`bash -n` re-verification.

User-visible deltas: an owned upgrade now affects **every** companion (global
ownership, matching equipment), not just whoever was active at purchase; hat
precedence is a stable rule (last-purchased upgrade → equipped item → loot
base) instead of "whatever mutated bones last"; a naturally-shiny buddy that
buys `shiny_aura` now also completes the Twinkle set (previously impossible).

Tests: **724 pass** (685 + 39 new across equipment/xp/migrate/combat/sets/
statusline), `tsc --noEmit` + `bash -n` clean. Uncommitted.

### Combat spawn signal broadened + classifier fixes (2026-07-08)

Field report: months at `gameFeel=full`, zero fight scenes. Live state showed
why — `encounter.json` had never been written and lifetime `errors_seen` was
**1** against 31 commits, while `lint_fails` sat at 30. Two stacked causes,
both fixed:

1. **The spawn read the one starved counter.** `maybeFightBug` keyed off
   `delta.errors_seen` alone. `SessionCounters` now also carries
   `tests_failed`/`type_errors`/`lint_fails`/`build_fails`, and a new pure
   `combatErrorCount(delta)` (session.ts) sums all five as the spawn signal —
   tier cutoffs unchanged. Bonus scoring (`computeSessionBonus`) and stat
   accrual are untouched. `counterDelta` treats counters missing from an
   on-disk baseline as delta-0 so pre-upgrade snapshots can't credit a
   lifetime of lint failures to one session.
2. **react.sh's classifier starved `errors_seen` and the test counters.** The
   `lint-fail` pattern contained a bare `error:` alternation four branches
   ahead of `test-fail`/`error`, so any output with `error:` — including bun
   test failures (`error: expect(...)`) — became a lint fail. Bare `error:`
   removed. The test patterns also missed bun's summary shapes: `test-fail`
   now matches `N fail` (leading non-zero digit) and `all-green` matches
   `0 fail` (leading `\b` so `20 fail` can't match its trailing zero) — so
   test outcomes in bun projects finally feed `tests_failed`/`all_green`
   (and their achievements/quests/WISDOM accrual, starved by the same bug).

Verified: classifier smoke through the real `react.sh` (six output shapes →
six correct counters) and an e2e in a temp `CLAUDE_CONFIG_DIR`
(`tests_failed`+2 → `session_complete` → `encounter.json` baked → statusline
renders the two-sprite scene). Tests: **729 pass** (+5 in session.test.ts),
`tsc` + `bash -n` clean.

### Pending encounter — the standoff (2026-07-08)

The fight was invisible until it was over. Now the enemy appears the moment the
**first error-ish event** lands and stands its ground on the status line until a
commit resolves it — a persistent standoff that doubles as a *commit nudge* (a
bug on your line means uncommitted, error-marked work). Full spec:
[idle-rpg/design-pending-encounter.md](idle-rpg/design-pending-encounter.md).
Four phases, all landed and **uncommitted** on `feature/interactive-fight-scene`:

1. **P1 — Bake + I/O (inert).** `bakePendingScene` (ready + periodic-glare poses,
   no strike/clash — shares `bakeScene`'s row composer via the extracted
   `composePose`), the `PendingEncounter` type, and
   `write/read/clearPendingEncounter` in `combat.ts` (a **separate**
   `pending-encounter.json` side-channel — no TTL — so the resolved phase's 10s
   contract is untouched). `TRANSIENT_PREFIXES` gains the prefix; `BugId` +
   `bugById` added to `bugs.ts`.
2. **P2 — Lifecycle.** Pure `pendingAction` (spawn/escalate/no-op) + `sightBug`
   in `session.ts`; a `bug_sighted` verb (no XP) in `award-xp.ts`; `react.sh`
   fires it on the five error-ish reasons (backgrounded-bun idiom). `maybeFightBug`
   now fights the **pinned** enemy (G4), tier-upgrades it if the final count
   outgrew the standoff, and **clears the pending file unconditionally** (G5 —
   even at `off`/zero-delta); `startSession` clears it too.
3. **P3 — Render.** `writeStatusState` gained a pending branch (surfaces the
   scene through the same `combatFrames`/`artWidth` fields plus a new
   `combatSticky: 1` bit, gated `full` + `startedAt`-match; resolved always
   outranks pending). `buddy-status.sh`: folds `combatSticky` into `$combat_on`
   (full-gated), **freezes wander** during any scene (D3), and **suppresses the
   reaction bubble only in the 10s resolved phase** (D4) — the standoff keeps its
   normal chatter. (Folds in the old "stop the chat bubble during a fight" item.)
4. **P4 — Docs + validation (this).** README "Bug fights" rewrite (standoff +
   nudge semantics), testing-guide §3b pending harness + §6 cleanup, this
   snapshot.

User-visible delta: at `full`, errors summon a standing enemy that escalates and
persists until commit; fixing the error does **not** dismiss it (nudge semantics,
D6). `subtle` is unchanged (resolve-toast only); `off` shows nothing. No new
config — it all rides the existing `gameFeel` knob.

Verified: **755 pass** (+14: 5 `pendingAction`, 9 pending-render), `tsc` +
`bash -n` clean, plus a fresh-process e2e through the real `award-xp.ts`
(sighting → sticky scene with no `encounterAt`; escalation across a tier cutoff;
same-tier repeat no-op; `session_complete` resolves + clears; `session_start`
clears an orphan).

---

## Going live

The installed status-line script lags the repo until reinstalled. To see the
current state live:

```
bun run install-buddy   # copies the repo script into place
# then restart Claude Code
```

`buddy_gamefeel full` shows the full animation set; `subtle`/`off` for less.

---

## Open follow-ups

- ~~Commit the 2026-06-30 fixes~~ **done** — merged into `feature/interactive-menu`
  via `fa8cc6f` on 2026-07-06 (see above). Opening a PR for that branch is the
  next step.
- Commit the rewards/leveling fix pass **and** the derive-on-read upgrades work
  (both above) — currently uncommitted on the same branch.
- Leftward-roam magnitude tune (`moodWalkOpts` ranges) — intentionally conservative.
- Idle-RPG niceties: sell/refund gear (buy-only today), inventory cap, gear-bonus
  delta in `buddy_xp`, post-TTL encounter inspection command.
- Hat wardrobe (design-derive-upgrades.md §9): with multiple owned hat
  upgrades, let the user pick which one is worn instead of purchase-order
  default. Deferred as a follow-up — derive-on-read makes it a pure
  preference field to add later.
- ~~**Pending encounter** (designed 2026-07-08, awaiting `/sc:implement`)~~
  **done 2026-07-08** — persistent standoff from first error-ish event until
  commit, escalating tier, resolved-phase bubble suppression folded in. See
  [Pending encounter — the standoff](#pending-encounter--the-standoff-2026-07-08).
  Uncommitted on `feature/interactive-fight-scene`.
- The stale top-level [`status.md`](status.md) is a point-in-time artifact for the
  quick-wins sub-arc (440 tests, `feature/leveling-system`) — superseded by this
  doc for the current picture.

---

## Doc map

| Doc | Scope |
| --- | --- |
| **CURRENT-STATE.md** (this) | top-level snapshot of the whole system |
| [requirements.md](requirements.md) | game-feel quick-wins FRs/NFRs |
| [design.md](design.md) · [design-stretch.md](design-stretch.md) | quick-wins design |
| [design-movement.md](design-movement.md) | idle wander + free-roam (§11) |
| [idle-rpg/design.md](idle-rpg/design.md) · [idle-rpg/status.md](idle-rpg/status.md) | idle-RPG arc + tracker |
| [idle-rpg/phase-{1..5}-*.md](idle-rpg/) | per-phase idle-RPG specs |
| [idle-rpg/design-derive-upgrades.md](idle-rpg/design-derive-upgrades.md) | derive-on-read for upgrades (bones-mutation fix) |
| [idle-rpg/design-pending-encounter.md](idle-rpg/design-pending-encounter.md) | persistent standoff until commit (**implemented** 2026-07-08, P1–4) |
| [idle-rpg/testing-guide.md](idle-rpg/testing-guide.md) | hands-on verification harnesses |
| [menu/](menu/) | interactive menu + nav channel |
| [anaylsis.md](anaylsis.md) | earlier analysis notes |
