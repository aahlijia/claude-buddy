# Game-Feel — Current State

A single top-level snapshot of the **whole** game-feel system as it stands today,
tying together the arcs that each have their own design/status docs. For the
per-arc detail, follow the links in [Doc map](#doc-map).

_Last updated: 2026-07-20 · branch `feature/interactive-fight-scene`_
_Baseline: **1003 tests, all pass** · `tsc --noEmit` clean · `bash -n` clean._
_Status: everything through
[living-world arc — P4 world dressing](#living-world-arc--p4-world-dressing-2026-07-20)
is **committed** (Tasks 1-7 on `feature/interactive-fight-scene`, code
review approved on every task). Newest on top: P4's ground props (daily
sprout + kickable pebble), the prop step-kick, a loot-dash inspect beat
over a dropped item, and sparse weather FX — all e2e-verified through the
real shell in a throwaway profile (Task 7, this docs pass). **This closes
the living-world arc** — P0, P1, P2, and P4 are all implemented and
verified; P3 (idle economy) was never built, see
[Open follow-ups](#open-follow-ups). No PR opened yet._

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
- **Stat leveling** — all five stats (DEBUGGING/PATIENCE/CHAOS/WISDOM/SNARK) rise
  from coding signals, accrued once per commit at zero per-event cost. Optional
  stats panel (`showStats` / `buddy-stats`). **v2 (2026-07-17):** SNARK now maps
  to pet interaction, WISDOM rewards a session-over-session drop in mistake rate
  (not just raw clean runs), a stat-up toast + panel value-flash surface each
  whole-point gain, and the PATIENCE runaway-bank bug is fixed. See
  [stats-leveling-v2.md](../leveling-system/stats-leveling-v2.md).
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
Four phases, all landed on `feature/interactive-fight-scene` (committed as
`22f6733`):

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

#### Fix: auto-quiet suppressed every sighting (2026-07-09)

Live playtesting never showed a standoff, and the cause was deterministic:
`sightBug` gated on `effectiveGameFeel() === "full"`, but a sighting fires on
the **exact five error-family reasons** in `SPIKE_REASONS` — the reaction
`react.sh` writes just before firing `bug_sighted` trips the auto-quiet
error-spike clamp (FR-E1), and `reactionTTL` defaults to `0` (the reaction
never expires), so the clamped read was `"subtle"` by construction. Every
spawn was suppressed; the P1-4 e2e missed it because it invoked
`award-xp.ts bug_sighted` directly without the reaction write that the live
`react.sh` path always performs first.

Fix: the standoff is **exempt from auto-quiet** (it exists *because* of
errors) — `sightBug` and `writeStatusState`'s pending branch now gate on the
**configured** level (`gameFeelLevel()` / `cfg.gameFeel`), not the clamped
one. The resolved-phase scene and every other delight producer keep the clamp.
Regression pinned by a fresh-process test in `combat.test.ts` that writes a
spike reaction before sighting (red on the old gates, green now). **756 pass**,
`tsc` clean.

#### Caption: "Bug fight in \<project\>!" (2026-07-09)

Encounter state is global, so a scene sighted in one project follows the buddy
into every other instance's status line — confusing without context. Both
encounter records now carry an optional `project` (hook-cwd basename, captured
by `currentProject()` in `combat.ts`: control chars stripped — frame art is
exempt from the shell-side jq sanitizer — and clamped to 24 chars), and
`writeStatusState` prepends a centered "Bug fight in \<project\>!" caption line
to the surfaced `combatFrames` (both standoff and resolved). **Zero shell
changes** — art height/width already derive from the frames. Records written
before the field render caption-less (back-compat). e2e-verified through the
real `react.sh` chain for both scenes; **757 pass**, `tsc` clean.

### Skirmish bouts — walk-over attacks + damage pops (2026-07-10)

Design: [idle-rpg/design-attack-animation.md](idle-rpg/design-attack-animation.md)
(OQ1–OQ5 user-resolved same day). The standoff is no longer static theater:
twice per loop one sprite **walks across the gap and swings** at the other — a
red ANSI `✗ -N` damage pop appears over the victim (hurt `x` eyes) and floats
away, then the attacker walks back. The resolved 10s fight gets the same pop
over the bug on a win (strike + triumph frames); a flee keeps the row blank.

Entirely `combat.ts` (+ tests) — **zero `state.ts`/shell changes**, the whole
animation is a longer baked flipbook played by the existing
`$seq[$now % $slen]` cycler:

- `composePose` gains optional `PoseExtras` — `shift` (attacker translation
  into the gap, vacated space padded on the far side ⇒ constant width by
  construction) and `overlay` (a pop row above the scene; when a flipbook uses
  overlays every frame carries one, blank or not ⇒ constant height). Defaults
  are byte-identical to the old output.
- `bakeBoutFrames`: walk-in (half gap) → impact (adjacent, `✗ -N`) → back-off
  (`-N` floats); defender never moves. `bakePendingScene` grows to 8 frames +
  a seeded ~34–55-entry sequence: attacker order, damage (bug 1..3·tier,
  buddy 1..9) and calm-gap lengths all rolled from the existing per-(session,
  tier) `pendingSeed` — "random" lives at bake time, the loop repeats.
- `resolveCombat` rolls the resolved-scene pop from a derived seed
  (`seed ^ 0x2717`) so the existing outcome/jitter/item rng stream is
  untouched for old seeds.
- ANSI safety: `displayWidth` strips SGR before measuring, the overlay is
  composed *after* `mirrorFrame` (never mirrored), and frame art is exempt
  from the jq sanitizer (wyvern precedent). Verified end-to-end: the red
  escape survives the real renderer.

Tests: +10 (constant width AND height across all frames, pop placement/range,
attacker alternation, seeded variation, resolved win-vs-flee, real-shell
render of a pinned impact frame incl. strict no-clip). **767 pass**, `tsc` +
`bash -n` clean.

### Dynamic chat bubble — fit-to-width (2026-07-13)

The speech bubble adapts its **size and shape** to the room the cluster has in
the current terminal instead of being a fixed `bubbleWidth` box the in-window
clamp dropped whole the moment it didn't fit. Full design:
[design-movement.md §11.1](design-movement.md#111--dynamic-bubble-sizing-fit-to-width-2026-07-13).
Entirely `buddy-status.sh` — the sizing is computed once per tick just before the
word-wrap, sharing the layout clamp's cluster-geometry terms
(`FIT_INNER = COLS − STATS_BLOCK − RIGHT_SAFETY − ART_W − CONNECTOR_W − 4`), so a
kept bubble is guaranteed in-window:

- **Shrink** — when the configured width won't fit, `INNER_W` narrows so the same
  text wraps to more, shorter rows (the box gets taller).
- **Grow** — when a lone word is wider than the configured box, `INNER_W` widens
  to that word (a word can't wrap inside itself; floor is `max(8, widest word)`).
- **Drop** — only when even the narrowest usable box won't fit; the sprite stays
  visible (the old binary drop, now the last resort + a defensive backstop).

Recomputed every tick, so a resize — or the same global buddy appearing in a
wider window — re-grows the bubble toward `bubbleWidth` when the room returns.
Also fixed a latent `dwidth()` bug: `od -An -tu4` collapses runs of ≥16 identical
codepoints into a `*` line, under-measuring text with long repeats (`!!!!!!`, a
long token) and mis-wrapping the box; added `od -v`. Verified end-to-end
(shrink/grow/drop rendered through the real script at multiple widths). Tests:
**777 pass** (+6 dynamic-bubble render cases), `tsc` + `bash -n` clean.
Committed as `e18196e`.

---

### Gear renders on the sprite (2026-07-15)

Equipped items now show on the buddy itself, everywhere the sprite renders —
status-line idle/emotion/blink frames and both companion cards (`buddy_show`'s
markdown card + the ANSI card). Before this, only headgear rendered (as the
hat); a weapon's `art` glyph appeared solely mid-combat-swing, and trinkets
never rendered at all. Now all three slots are visible:

- **Weapon** — its `art` glyph composited beside the body at hand height, so it
  reads as held (debug_wand `/`, foam_sword `†`).
- **Trinket** — a new `art` glyph resting on the ground at the buddy's feet
  (rubber_duck `,>` — a tiny duck by consistency with the `tinyduck` hat).
- **Headgear** — unchanged (hat effect via `applyHat`).

Mechanics: `GEAR_ANCHORS` in `art.ts` is a hand-tuned per-species table of
`[row, col]` anchor cells (all 20 species; every anchor verified blank in all
three idle frames by test, so gear never flickers as the cycle plays). The
`applyGear` compositor only ever fills blank cells — a shifted animation frame
skips the overlay rather than clobbering body pixels — and refuses to splice
into ANSI lines (the wyvern's fire tail; its anchors avoid that row).
Derive-on-read throughout: `resolveAppearance` gains `trinketArt`, and the new
`gearArtOf` helper maps an appearance to the renderer's `GearArt` shape.
Plumbed through `writeStatusState` (status frames) and `buddy_show`. Flourish
frames (ascension) intentionally stay bare.

**Bug fights too:** the combat scenes render the player's full look. A new
`PlayerLook` (`{ hat, gear }`) threads through `composePose` →
`bakeScene`/`bakeBoutFrames`/`bakePendingScene`, applied identically to every
frame so the constant-width/height (no-jitter) guarantees hold — `applyGear`
runs before `rectFrame`, and gear rides the bout shift as the attacker walks
the gap. `resolveCombat` builds the look from the appearance it already
resolves; `sightBug` resolves it best-effort (a failed xp read ⇒ bare sprite,
never a lost standoff). This also fixes hats never rendering in fights — the
worn hat (equipped, upgrade, or innate) now shows in both the standoff and the
resolved scene. The enemy bug never gets a look. `applyHat` is now exported
from art.ts.

Files: `art.ts`, `items.ts`, `equipment.ts`, `state.ts`, `index.ts`,
`combat.ts`, `session.ts` + tests. Verified end-to-end through the real
`buddy-status.sh` (geared cactus rendered with `†` at the arm, `,>` at the
feet) and by rendering the full geared standoff flipbook. Tests: **797 pass**
(+20), `tsc` clean. Committed as `6211430`.

### Revert: the fight caption is its own row again (2026-07-15)

`78cc206` had folded the "Bug fight in \<project\>!" caption onto the
combined-status metrics header row to save a scene row. Reverted by user
request: the caption reads better **centered on its own row directly above the
two sprites**, which is where the server already puts it (frame row 0, per the
[Caption](#caption-bug-fight-in-project-2026-07-09) entry) — the fold was the
only thing moving it.

The revert is a clean reverse-apply of `78cc206` and touches nothing else: the
`combatCaption` signal field (`state.ts`), the `$combat_caption` jq field +
`_COMBAT_CAPTION` read + `MERGED_HEADER` fold block (`buddy-status.sh`), and the
4 inline-caption render tests all go away. The caption itself (`captionFrames`
in `writeStatusState`) is untouched, so **zero behavior change to how the
caption is produced** — only where the shell draws it. With no metrics header
the render was already byte-identical, so only combined-status mode changes:
row 0 is metrics alone and the caption returns to the top of the scene block.

Verified through the real `buddy-status.sh` in both modes (combined on/off).
Tests: **793** (−4), `tsc` + `bash -n` clean. Committed as `6211430`.

### Scene top-row trim (2026-07-15)

With the caption back on its own row, the gap under it was obvious: **two**
mostly-dead rows sat between the caption and the sprites. Both are optional and
neither was being paid for — the species art reserves its row 0 for the hat
(`applyHat` fills it only when one is worn) and `composePose` unshifts the
damage-pop row above that. Bare-headed, the hat row is pure waste; the pop row
is blank on every calm frame but earns its keep on impacts.

`trimBlankTopRows` (combat.ts) drops, from the top, every row **no frame in the
flipbook uses**, applied at the end of `bakeScene` and `bakePendingScene`. Two
properties make it safe: only rows blank in *every* frame go (a hat, a bout's
`✗ -N` ⇒ the row is kept for the whole loop), and the same rows are dropped from
every frame, so the constant-height/no-jitter guarantee still holds. The scan
stops at the first row every frame uses — the top of the bottom-aligned sprite
bodies — so an intentional blank row *inside* a sprite is unreachable no matter
what art is added later. Blank means blank of content: the pop's ANSI bytes
survive `.trim()`.

Net effect: a bare standoff loses one row (hat), a hatted one keeps it, and a
pop-less resolved scene (a flee never pops) loses both. Four `bakeScene` tests
that hardcoded the old row offsets now derive the eye row **from the bottom**
(sprites are bottom-aligned and only unused top rows are ever dropped), which is
what they always meant; the wyvern case additionally asserts the clash row isn't
the block center. Verified e2e through the real `buddy-status.sh` (bare, impact,
and wizard-hat frames). Tests: **798** (+5), `tsc` + `bash -n` clean.
Committed (with the two sections above) as `6211430`, 2026-07-15.

---

### Hardening pass — bug + statusline perf fixes (2026-07-16)

An `/sc:analyze` (bugs + performance) over the whole system, then `/sc:improve`
applying everything found. Four bug fixes, four perf fixes, and the
migrate-test isolation — **802 tests, all pass** (+4 mute regressions, the
migrate case fixed), `tsc` + `bash -n` clean, all **86 statusline render
snapshots byte-identical** (the perf work provably changed no output).

**Bugs.**

- **Mute didn't stick** (`state.ts` + new `state_muted.test.ts`). `muted` lives
  only in `status.json`, and every `writeStatusState` without `opts.muted`
  reset it to false — so any XP award or bug sighting silently unmuted the
  buddy, usually within a minute of active coding. The write now carries the
  on-disk value forward; only `buddy_mute`/`buddy_unmute` set it explicitly.
- **Commits were swallowed by the reaction cooldown** (`react.sh`). The 30s
  cooldown (and mute) early-exits ran *before* classification, so a commit
  landing within 30s of any reaction — the classic error→fix→commit flow —
  lost the session bonus, the fight, **and** the pending-standoff clear (the
  G5 "commit dismisses the nudge" invariant). A cheap commit sniff (the
  classifier's own regex) now runs before the gates; commits always pass.
  Mute still suppresses the visible bubble writes at the dispatch tail, but
  lifecycle work runs. Verified e2e in a sandbox: commit-during-cooldown goes
  through, muted commit stays silent but counts, non-commits still cool down.
- **Non-atomic hook writes** (`react.sh` + `file-type-react.sh` +
  `buddy-comment.sh` + `mood-react.sh` + `name-react.sh`). Every jq patch used
  `mktemp` in `/tmp` — on another filesystem `mv` degrades to copy+unlink, so
  a concurrent statusline tick could read a torn `status.json`/`events.json`.
  All temps are now same-dir (`.status.patch.XXXXXX`/`.events.patch.XXXXXX`,
  cleaned on jq failure, in `TRANSIENT_PREFIXES`); the reaction file write is
  tmp+mv instead of a bare redirect. *Known-but-unfixed:* `mood-react.sh` and
  `file-type-react.sh` hardcode `$HOME/.claude-buddy` instead of sourcing
  `paths.sh` — they miss a custom `CLAUDE_CONFIG_DIR` (follow-up below).
- **Statusline edge cases** (`buddy-status.sh`). A malformed `rainbowColors`
  hex hit `16#` arithmetic and spammed stderr every tick — entries are
  validated now (all-invalid falls back to the default palette). Non-ASCII
  buddy names are measured with `dwidth` for centering (ASCII names stay
  fork-free).

**Performance** (the statusline reruns every ~1s; with a visible bubble this
pass takes a tick from ~60–70 forks to ~8).

- **`dwidth` batch**: bubble word widths were measured one `iconv|od|awk`
  pipeline *per word*, plus a second per-line pass for padding. New
  `dwidth_batch()` measures every word in one pipeline (newline codepoint
  delimits), and the wrap loop records each line's width as it builds it, so
  padding needs no second measurement at all.
- **PTY cache**: the terminal-width lookup walked the process tree with up to
  ten `ps`/`stty` forks per tick. The controlling-TTY *device* never changes
  within a session — only its size does — so `.tty.$SID` caches
  `"<ppid> <device>"` and a hit costs one `stty` read (still resize-robust; a
  PPID mismatch or dead device falls through to the walk, which re-caches).
- **Fork diet**: `printf -v` replaces `$(printf …)` subshells throughout,
  `${var// /-}` replaces the `printf|tr` border pair, `$OSTYPE` replaces two
  `$(uname -s)` forks, and the render loop's blank fillers are precomputed.
- **`writeStatusState` dedup** (`state.ts`): `loadReaction(cfg?)` takes the
  already-parsed config so the TTL check doesn't re-parse `config.json`, and
  `captionFrames` returns `{frames, width}` so `sceneWidth` runs once.

**Migrate-test isolation** (`migrate.test.ts`). The aura_shiny case asserted a
"no loot store" premise its own process couldn't guarantee — it read the
developer's real store and failed wherever a shiny cosmetic was owned. It now
runs in a fresh subprocess with a temp `CLAUDE_CONFIG_DIR` (the same idiom as
the companion-store suite in the file). Beyond CI hygiene this was quietly
ruining game-feel on this machine: every local `bun test` printed `1 fail`,
which the classifier scored as **test-fail** (+5 XP and a fresh bug standoff)
instead of **all-green** (+20 XP and a celebration) — a large part of why XP
gains felt dead.

*Side-finding, not fixed:* `xp.json`'s `statProgress.PATIENCE` has banked 114+
fractional points (the per-session cap banks overflow instead of dropping it,
and a multi-day session snapshot yields huge elapsed-time gains). Harmless but
it will drip +2 PATIENCE per commit for dozens of commits; a cap on the bank is
the likely fix.

---

### Sprite-animation expansion — idle emote + dodge/parry bouts (2026-07-17)

More dynamic sprite motion on both surfaces, built entirely on the existing
"server bakes, bash cycles" machinery — **zero `buddy-status.sh` changes**. Full
design: [idle-rpg/design-sprite-animation.md](idle-rpg/design-sprite-animation.md).
Four phases, all **uncommitted**:

**P0 — shared FX primitives.** `overlayRow` (now span-addressed:
`text, spanStart, spanW, totalW`) and `trimBlankTopRows` moved out of `combat.ts`
into `art.ts`, beside the other frame geometry. New `trimSharedBlankTopRows`
takes *all co-present flipbooks at once* and applies one drop set. Combat output
stayed byte-identical (all render snapshots unchanged).

**P1 — idle emote row + dead-row reclaim.** An emote glyph rides a row above the
idle sprite, driven by the existing `resolveEmotion` (angry `!` / bored `zZz` /
happy `♪` / surprised `?` / neutral → blank → trimmed) — a second read of a
decision already made, so no new signal plumbing. `finalizeIdleBlock` unshifts
the row and reclaims dead top rows across the **idle *and* flourish** flipbooks
under one shared drop set, because the shell swaps between them on `$celeb_fresh`
within seconds — trimming them independently would jump the line a row when a
celebration fired. Order matters: **trim-then-unshift** (a constant emote would
otherwise satisfy the "row every frame uses" test and strand the dead row).
Emote is `full`-only; `subtle` still gets the reclaim. Net effect: the 11
free-row species render **one row shorter at rest** than before (the reclaim
the 7/15 combat trim never reached on the idle path), and a neutral buddy never
pays for the feature. The render snapshots are unaffected — they inject fixed
frames and test the cycler, not the bake — so this is covered by `art.test.ts`
unit tests plus an end-to-end render through the real shell (emote centered over
the sprite; celebration swap holds height; neutral reclaims the row).

**P2 — dodge + parry bouts.** Each skirmish bout now rolls **hit 50% / dodge 25%
/ parry 25%** from the same `pendingSeed`. Dodge: the attacker over-commits to a
full lunge that whiffs, defender wears `O` eyes, no damage. Parry: the blades
clash `/\` in the gap (a real `strike` frame), no damage — the clash sword is the
player's equipped weapon, read from the `look.gear` the standoff already carries
(no new call-site plumbing). Two implementation constraints shaped the poses: the
`shift` primitive only moves a sprite *toward* the gap (so the defender can't
lean away — the dodge reads through eyes + the absent pop), and the clash glyph
needs gap width ≥ 3 (so parry lands near center at `shift ≤ 1`). Constant width
AND height verified across 2160 geared flipbooks; both new outcomes rendered
through the real shell at 125 cols with no clipping.

**P3 — docs + validation.** This entry, the design doc, and full re-validation.
Tests: **821 pass** (+19: 17 art-primitive/idle, +2 net combat after the bout
tests were made outcome-aware), `tsc --noEmit` + `bash -n` clean.

Follow-ups this opens: the 7/15 scene-trim precedent is now generalized, so a
future FX row (idle sweat/sparks, a "thinking" glyph) is a one-line
`emoteFor`-style addition. The sub-second tick that would make all of this
*fluid* rather than 1 fps stop-motion remains deferred (needs the harness
refresh ceiling measured first, and would respend the `c134b20` fork budget).

### Sprite-animation expansion, round 2 — bout variety, celebration flavor, idle life (2026-07-17)

Same day, same branch, spending the P0–P3 primitives further across four axes
the user picked together (not a sequential OQ menu this time — all four at
once). Full design:
[idle-rpg/design-sprite-animation-v2.md](idle-rpg/design-sprite-animation-v2.md).
**Uncommitted**, same as round 1.

**P4 — `crit` + `counter` bout outcomes.** `BoutOutcome` grows from
`hit/dodge/parry` to add two more, mixed **40/20/20/10/10**, with **zero new
rng draws** — only the bucket boundaries and what `bakeBoutFrames` does with
the already-rolled damage number changed. `crit`: same beats as `hit`, damage
doubled, pop reads bold `‼ -N` instead of `✗ -N`, eyes read heavier (attacker
`*` spark, defender `X` KO'd-wide). `counter`: reuses parry's lunge+clash
beats, but the third beat lands the *defender's* pop on the *attacker*
instead of a clean recoil — the first outcome to set the overlay's `over`
target to the attacker rather than the defender.

**P5 — celebration-kind-specific flourish.** `flourishFrames(bones, kind)`
now looks up a per-`CelebrationKind` eye cycle instead of one fixed
`^,O,*,^` cycle for everything. `ascension` keeps the original (still the
biggest); `shiny` goes sparkle-forward; `levelup`/`whim` get short, snappy
bobs; `loot` gets a 2-frame happy blink; `discovery` stays unflourished by
choice. `award-xp.ts`'s level-up and loot/whim writes now opt into flourish
too (`flourish: celebration != null && kind !== "discovery"`) — round 1 kept
flourish reserved for the two big moments because it always cost a row;
`finalizeIdleBlock`'s shared drop set (P1) now makes it free when idle, so
the common-case exclusion no longer held. `CelebrationKind`'s canonical
definition moved from `state.ts` to `art.ts` (flourish is its only
kind-varying consumer); `state.ts` re-exports it, so no other call site
changed.

**P6 — idle glance.** A second micro-expression alongside the existing blink:
frame 0 re-rendered with eye glyph `'` instead of `-`, at a new sequence
index placed well clear of the blink beat. Exactly blink's own derivation
(eye substitution over frame 0, which every species already carries `{E}`
on), so it's unconditionally safe across all 20 species with zero new art.
`STATUS_FRAME_SEQUENCE` grew from 15 to 18 ticks.

**P7 — a real new art frame (pilot: duck/cat/robot).** The one axis that
deliberately breaks derive-on-read: a genuine 4th `SPECIES_ART` frame
("stretch") for 3 species, gated on `SPECIES_ART[species].length > 3` so the
other 17 species are byte-identical to before. Two hard constraints, both
satisfied by construction and unit-tested: **row 0 stays blank** (a hatted
buddy would silently lose its hat otherwise — `applyHat` only fills row 0
when blank) and **the species' `GEAR_ANCHORS` cell stays blank** in whatever
row it lands on, same contract as frames 0-2. `getStatusFrames` now picks
between `STATUS_FRAME_SEQUENCE` and a `_STRETCH` variant (one extra, rare
beat) based on raw art-frame count rather than a global flag.

**Validation.** **832 tests pass** (+11 over round 1's 821: 2 combat outcome
tests + seed fixups the new bucket boundaries forced, 4 flourish-per-kind
tests, 2 glance tests, 3 P7 anchor/row0/hat tests), `tsc --noEmit` + `bash -n`
clean, zero `statusline/` diff. An e2e harness drove real `writeStatusState` →
the real shell for all four phases (crit/counter bout frames, a hatted duck's
stretch frame, levelup vs loot flourish cycles) — no clipping, hats render
correctly on the new frame, deleted after use.

Existing seed-pinned tests (`combat.test.ts`, `statusline_render.test.ts`)
that hardcoded seed 42 as "hit+dodge" broke, because the new bucket
boundaries reclassified that seed to dodge+parry — reminder that any bout
test pinned to a literal seed is implicitly pinned to the outcome mix, not
just the RNG stream. Fixed by re-deriving seeds against the new thresholds
rather than adjusting assertions to match whatever seed 42 now rolls.

### Stat-leveling v2 — every stat behavioral, learning WISDOM, visible gains (2026-07-17)

A follow-up pass on the behavioral stat system (v1 mapped 4 of 5 stats and
surfaced nothing). Full design + resolved OQs:
[stats-leveling-v2.md](../leveling-system/stats-leveling-v2.md). Four phases,
all in the once-per-commit session-complete path (the zero-per-event invariant
holds):

- **P0 — PATIENCE runaway-bank fix.** The fractional bank hoarded whole points
  the per-session cap refused, so a multi-day session snapshot banked 100+
  PATIENCE (114 on the live store) that dripped +2/commit for ~57 commits. Fixed
  at the source (`elapsedSec` clamped to `PATIENCE_MAX_MINUTES=480`) and with a
  backstop (`STAT_BANK_CAP=1` — capped overflow is discarded, not banked); a
  one-time clamp in `sanitizeStatProgress` dissipates the existing hoard on load.
- **P1 — SNARK ← pets.** The last unmapped stat now rises from interaction
  (`+0.25`/pet). `pets` is per-slot, so `SessionCounters` sources from
  `loadEvents(slot)` and `startSession` threads the active slot to baseline it.
- **P2 — WISDOM learning delta.** Beyond the reduced clean-run floor
  (`+0.10`/`all_green`), WISDOM now gains proportional to a **drop in mistake
  rate** (failures per commit) session-over-session — the "reflects learning"
  idea v1 deferred. One persisted float (`lastErrorRate`), refreshed every
  session-complete.
- **P4 — visible gains.** `SessionCompletion.statIncrements` threads the
  applied whole points out; `award-xp.ts` surfaces a `statup` toast
  (`📈 DEBUGGING +1 · SNARK +2`, the lowest celebration rung) and a **panel
  value brighten** (SGR-only, ~10s TTL, no ▲ collision with "peak", no width
  change).

Verified end-to-end through the real award path (4 pets → SNARK 10→11 + toast;
two-session WISDOM delta; rate persistence) and the real shell (fresh raise bold,
stale dim, layout intact). Tests: **844 pass** (+12), `tsc` + `bash -n` clean,
render snapshots byte-identical. Uncommitted.

### Living-world arc — P1 movement vocabulary (2026-07-18)

Ships the first phase of the living-world arc's motion vocabulary — mood
gaits, event-choreography stingers, edge/panel lean/peek posture — entirely
on the existing "server bakes, bash cycles" machinery: **zero
`buddy-status.sh` changes**. Full design + resolved decisions:
[living-world/design.md](living-world/design.md); phased plan:
[living-world/plan-p0-p1.md](living-world/plan-p0-p1.md).

- **Mood gaits** (`wander.ts` `gaitWalkOpts`/`EMOTION_GAIT`; `art.ts`
  `gaitFrameSequence` + lean `~`/peek `<` posture frames via
  `getStatusFrames(..., gaitVariants)`): angry = tight rapid pacing, bored =
  long-dwell shuffle, happy = 2-cell skip steps. Body frames stay in
  lockstep with the walk — `frameSequence` is remapped to the walk's length
  and indexed by the same `NOW` as `wanderSequence`. Lean posture fires at
  the roam edge; peek `<` at long home dwells when the stats panel is on.
  Lean is `~`, not `>` — `>` is the angry emotion's own eye glyph, and a
  colliding posture glyph would go invisible during the one gait that needs
  it most.
- **Stingers** (`wander.ts` `stingerArc`/`spliceStingerArc`,
  `STINGER_DELAY_TICKS=12`; `award-xp.ts` triggers): phase-anchored one-shot
  arcs spliced into `wanderSequence` at the wall-clock index the shell
  reaches once celebration freshness lapses. **victory** (a won fight — a
  fled fight fires nothing), **lootdash** (a genuine loot toast only),
  **walkon** (session start, anchors immediately at delay 0 via a new
  `writeStatusState` call on that path).
- **Startle beat** (`combat.ts` `bakePendingScene`): the standoff flipbook
  opens with 3 ticks of an O-eyed recoil pose, recurring each loop as a
  re-glare.
- **D14 — angry gait/emote pierce the auto-quiet spike clamp (same-day fix,
  `cb7d061`).** Found by this task's own e2e pass, not by any unit test:
  `REASON_EMOTION` maps the `error`/`test-fail` reasons to angry emotion, and
  `SPIKE_REASONS` (the pre-existing auto-quiet clamp, FR-E1) contains the
  *identical* reasons — so a live error reaction always clamped a configured
  `full` down to `subtle` before the full-only gait/emote could bake. Angry
  gait, and the sprite-animation-round-1 `!` emote it shares the gate with,
  were unreachable by construction, for any `reactionTTL`. Fixed by having
  the angry idle expression read the *configured* level instead of the
  clamped one — mirroring the standoff's existing auto-quiet exemption
  (`sightBug`, 2026-07-09): an error-born expression must survive the clamp
  the error itself causes. Every other producer (celebrations, flourish,
  combat) still respects the clamp. See design.md's D14 decision row.

**Verified end-to-end** through the real award path (temp
`CLAUDE_CONFIG_DIR`, no shell changes): **walkon** — `session_start` enters
from the arc head (offset 3 descending to 0) anchored at the write's own
wall-clock second; **angry gait + `!` emote** — a persisted `error`-reason
reaction at configured `full` now bakes the 180-tick gaited walk and the
emote row (previously silently absent — the D14 bug caught mid-task);
**victory lap** — a real won fight (subprocess seed search, reusing
`session.test.ts`'s fresh-process technique) stays celebration-frozen for
the first ~10s, then sweeps the two-lap victory arc (offsets
`1,2,3,2,1,0,1,2,3,2,1,0`) once the toast fades. Tests: **874 pass** (+3
over the 871 baseline: 1 pinned lean-posture render test, 2 D14 regression
tests), `tsc --noEmit` + `bash -n` clean, zero `statusline/` diff.

Commits: `eec901d`/`69ec9a9` (gait profiles), `c9abc33`/`b6a9708`/`584d52a`
(lean/peek posture), `420b369`/`c064faa` (gaitFrameSequence wiring),
`6f9400e`/`3d7c7e7` (gait remap + frameSequence contract),
`1359653`/`6d0211d` (phase-anchored stinger arcs), `1598f96`/`0c09750`/
`8457e39` (stinger triggers), `6b11d28` (startle beat), `cb7d061` (D14 fix).
This docs pass is the remaining uncommitted piece.

### Living-world arc — P2 encounter variety (2026-07-20)

Ships the second phase of the living-world arc — multi-stage **boss bugs**
and **wild buddy visitors** — as an upgrade of the existing pending-encounter
standoff and a new sibling side-channel, both still riding the "server
bakes, bash cycles" invariant: **zero `buddy-status.sh` changes**. Full
design + resolved decisions: [living-world/design.md](living-world/design.md)
§P2; phased plan: [living-world/plan-p2.md](living-world/plan-p2.md).

- **Boss bugs** (`session.ts` `BOSS_THRESHOLD=12`, `bossStages`,
  `pendingAction`'s new `"boss"` decision; `combat.ts` `bossPips`,
  `bossDrop`; `art.ts` `applyBossCrown`). When a standoff's error count
  crosses the threshold it upgrades — deterministically, never rolled (D13)
  — to a 2–3-stage boss (`kind: "boss"`), rendering a `♛` crown and a pip
  caption (`BOSS in <project>! ▰▱`). Each commit fights **one stage** through
  the existing seeded `resolveCombat`; a win advances the pips and the
  standoff stays on the line, a flee leaves it untouched. The final stage
  clears the standoff, guarantees a rare+ drop at well above a normal
  tier-4 reward (`bossDrop`), unlocks the new **Boss Slayer** 👑 achievement
  (`bosses_beaten` global counter), and plays the resolved kill scene.
- **The G5 revision.** The original standoff invariant (G5) was "any commit
  clears the pending encounter unconditionally" — true for an ordinary
  standoff to this day. A boss revises it: `maybeFightBug` (session.ts)
  branches on `pending?.kind === "boss"` *before* the unconditional clear,
  resolves exactly one stage, and only calls `clearPendingEncounter()` on
  the final-stage win (or on a vanished bug ID). **D12 is unchanged** —
  `startSession`'s unconditional `clearPendingEncounter()` still fires
  first thing, orphan or mid-boss alike, on every fresh session; a boss
  that outlives its session dies quietly like any standoff always has.
  A second chosen behavior from the Task 4 review: **`gameFeel off`
  mid-boss discards the standoff** rather than freezing it for a later
  re-enable — `maybeFightBug`'s `off` branch calls
  `clearPendingEncounter()` unconditionally, boss or not, because opt-out
  means opt-out: there is no stage-fight surface at `off` for a boss to
  persist toward.
- **Three-reader staleness exemption.** An ordinary standoff is dismissed as
  "stale" whenever its `startedAt` no longer matches the live session
  snapshot — necessary because an abandoned standoff from a dead session
  shouldn't linger. A boss cannot use that guard: `awardSessionComplete`
  rebaselines `startedAt` to "now" after **every** commit, so a literal
  staleness check would kill a mid-fight boss at the very first commit
  boundary — the exact persistence the feature exists to provide. One rule
  — bosses are dismissed only by explicit lifecycle events (`startSession`'s
  clear, the `off` clear, the final-stage kill), never by segment staleness
  — is carried by **three separate reader call sites**, each independently
  exempting `kind === "boss"` from its own `startedAt` match: `sightBug`'s
  `sameSession` filter (session.ts, so a mid-boss error event doesn't get
  treated as stale and spawn a fresh standoff over it), `maybeFightBug`'s
  boss branch (session.ts, so the stage fight itself resolves regardless of
  elapsed time), and `writeStatusState`'s pending-render branch (state.ts,
  so the boss keeps *rendering* across the same gap — without this one the
  boss would still resolve correctly but silently stop appearing on the
  line the moment real time passed after a stage win). All three carry a
  code comment cross-referencing the other two so a future edit can't drop
  the exemption at just one site.
- **Wild buddy visitors** (`server/visitor.ts`, new pure module + bake;
  `session.ts` `maybeVisitBuddy`; own `visitor.json` side-channel, `state.ts`
  render branch, `art.ts` `CelebrationKind: "visitor"`). At `session_complete`,
  when this commit's own combat slot is untouched (no fight/boss-stage
  resolved, no live standoff, no fresh resolved scene — combat always
  outranks a visitor, checked in both `maybeVisitBuddy` and independently
  again at render time), a ~1-in-12 seeded roll spawns a different-species
  buddy that walks on, plays a short greet flipbook (a `♥` overlay pop
  instead of damage), and walks off — ~25% of visits carry a small points
  reward. `subtle` gets the toast only (`🐾 a wild <name> stopped by! left
  <n> pts!`); `full` gets the toast plus the on-line scene.
- **Caption override seam** (`combat.ts` — both `PendingEncounter` and
  `EncounterRecord` gain an optional `caption` field). Landed first (Task 1)
  so boss pips and visitor captions could both override the classic
  "Bug fight in \<project\>!" text without a second render path; a
  caption-less record still renders exactly the old text (back-compat pin).

**Verified end-to-end** through the real award path in a throwaway
`CLAUDE_CONFIG_DIR` profile, on the real shell: (a) 12 error events spawn a
boss standoff — `♛` crown, caption `BOSS in claude-buddy! ▱▱`; (b) a winning
commit advances the pips (`▰▱`, toast `⚔️ Stage 1/2 down — the boss
staggers!`) while the standoff stays on the line, and the next winning
commit clears it, plays the `👑 BOSS DOWN` kill scene, credits a guaranteed
drop, and unlocks `boss_slayer` in `unlocked.json`; (c) a seed-searched
visitor commit bakes and renders the octopus greet scene (walk-on → `♥` pop
→ walk-off) with the toast `🐾 a wild octopus stopped by! left 4 pts!`.
Tests: **927 pass** (unchanged from the P1 baseline — Task 8 is
verification-only, no production code touched), `tsc --noEmit` + `bash -n`
clean.

**Known follow-ups, not fixed here (out of scope for Task 8 — docs only):**
1. `applyBossCrown` (art.ts) silently no-ops if a tier-4 bug's row 0 is ever
   non-blank — safe today because the only tier-4 entry (segfault_dragon)
   has a blank row 0, but nothing guards or tests the invariant if the
   tier-4 roster grows.
2. `VisitorSpec.shiny` is rolled at the normal shiny-hatch odds but never
   surfaced — `bakeVisitorScene` ignores it and the toast has no shiny
   indicator, so a shiny visitor is indistinguishable from a normal one.
3. (Carried forward from the Task 4 review.) `readVisitor()`'s render
   branch in `writeStatusState` runs even at `gameFeel=subtle` — an extra
   disk read discarded because the shell only surfaces scene fields at
   `full`. Minor perf/cleanliness nit, not a bug.

### Living-world arc — P4 world dressing (2026-07-20)

Ships the fourth and **final** phase of the living-world arc — ambient
**ground props**, **prop interaction** (a step-kick + a loot-dash inspect
beat), and **weather FX** — still riding the "server bakes, bash cycles"
invariant: **zero `buddy-status.sh` changes**, the arc's shell stays frozen.
Full design + resolved decisions:
[living-world/design.md](living-world/design.md) §P4; phased plan:
[living-world/plan-p4.md](living-world/plan-p4.md).

- **Zero-rows, by construction.** There is no scenery layer — props are
  extra glyphs composited into the **idle** flipbook through the exact
  `applyGear` blank-cells-only / ANSI-refused contract (`overlayGlyph`,
  art.ts), so they never flicker or clobber body pixels, and they never
  compete in the render priority ladder: idle frames and combat/pending/
  visitor scenes are separate baked channels (`writeStatusState`,
  state.ts) — the shell shows one or the other, so a prop simply isn't
  drawn while a scene is up.
- **Prop anchors** (`PROP_ANCHORS`, art.ts — Task 1) are a **parallel
  table** beside `GEAR_ANCHORS`, not an extra field on it: props are
  ambient world-dressing, gear is owned equipment, and the two systems
  test independently. `ahead` is `[4, 11]` (the last column of every
  species' box) for all 20 species; `feet` is hand-placed per species,
  clear of both `ahead` and the two-cell footprint the one existing
  trinket (`rubber_duck`, `,>`) occupies — verified blank across every
  idle frame, the P7 stretch frame, and the gait lean/peek postures by the
  same blank-cell probe methodology `GEAR_ANCHORS` used originally.
- **Prop selection** (`server/props.ts`, new pure module — Task 2):
  `pickDayProp(now, species)` day-seeds a daily-constant sprout/clover/
  flower motif for `feet` and a pebble glyph for `ahead`
  (`hashString`+`mulberry32`, the established seed seam), plus a
  time-of-day palette bucket (dawn/day/dusk/night) from the injected hour.
  Season GATE Branch A: reuses the existing `activeSeasonal` holiday-window
  calendar (the beanie hat's own mechanism) rather than inventing a
  meteorological month→season map — a live seasonal window swaps the
  `feet` motif to a matching glyph (❅ winter, ✧ new-year). Pure: the date
  is injected, never read from the clock inside the module — `new Date()`
  is called exactly once, at the `writeStatusState` write site (Task 3).
- **Wired into the idle bake** (Task 3) gated on `idleGate === "full"` —
  the already-clamped gate that also carries the D14 angry-auto-quiet
  exemption "for free," so an error-driven angry idle still gets its prop.
  **No new persisted file** — the prop is re-derived from the current date
  on every write, so nothing was added to `TRANSIENT_PREFIXES`.
- **The step-kick — Task 4's saga.** The pebble's `ahead` glyph slides
  through per-species columns on the walk's own step ticks
  (`PROP_KICK_COLUMNS`, `applyPropKicked`, `propKickFrameSequence`,
  art.ts). This is the one task in P4 that needed **two real fix rounds**
  after its first landing, both caught by code review reading the actual
  rendered behavior rather than trusting the commit message — worth
  recording in detail for whoever next touches gait/prop code:
  1. **First landing (`d1bc9a3`)** implemented "Branch B": the pebble
     stayed pinned to its single anchor and was *withheld* (removed
     entirely, then redrawn) on the walk's lean/peek direction-flip
     frames. It was justified with "no species has a safe second column"
     — but that blank-cell probe had checked columns 7–11 in **aggregate
     across all 20 species** instead of **per-species** with each
     species' own `feet` column excluded, so it never found the columns
     that were actually free.
  2. **Fix round 1 (`efc7b59`)** — a code review of `d1bc9a3` caught two
     real bugs: the "kick" fired on `phase===2/3`, the ticks where the
     buddy has **stopped** — the literal inverse of "a kick as the buddy
     ambles," inverting the design's own step-tick trigger; and
     withholding a static glyph (removing it, then redrawing it
     unmoved) reads as flicker, which design.md §P4 explicitly forbids.
     Re-running the corrected **per-species** probe found 11 of 20
     species genuinely have a spare column (duck, goose, owl, penguin,
     turtle, snail, axolotl, cactus, mushroom, wyvern, pikachu); the fix
     implemented real sliding motion for those 11 via
     `PROP_KICK_COLUMNS` + `applyPropKicked`, keyed to `phase===1` (the
     actual step tick) through `propKickFrameSequence`. The other 9
     species (blob, cat, dragon, octopus, ghost, capybara, robot,
     rabbit, chonk) are genuinely cramped and keep the single static
     anchor — no kick, never withheld.
  3. **Fix round 2 (`656879b`)** — a code review of the fix **itself**
     caught a fresh regression the first fix had introduced: the
     appended kick frames hardcoded `bones.eye` instead of the active
     emotion's eye. During any non-neutral emotional walk on a kick
     species, this flipped the buddy's eyes
     emotion→neutral→emotion on every single step tick — a real
     per-tick expression flicker, invisible in every prior test because
     they all used `emotion: "neutral"`, where `bones.eye` and the
     emotion eye happen to coincide. Fixed by threading the actual base
     eye the caller's cycle was using into the kick-frame bake instead
     of re-deriving (or hardcoding) it.
  The lesson for future gait/prop work: a per-species blank-cell claim
  needs a genuinely per-species check (not an aggregate one), a "withheld
  glyph" is flicker even if the position never seems to move, and a fix
  for one flicker bug needs the same "render it and look" scrutiny the
  original bug did — the second regression shipped inside the very commit
  meant to fix the first.
- **Loot-dash inspect beat** (`server/wander.ts` `stingerInspectOffsets`,
  `server/art.ts` `inspectIdx`, Task 5): the loot-dash stinger's 3-tick
  pause at max reach now poses the buddy in the existing peek (`<`)
  posture with a dropped-item glyph (`◇`) composited at the `ahead` prop
  anchor — no new frame art, reuses P1's peek pose + Task 1's compositor.
  `stingerInspectOffsets(kind, range)` is a standalone accessor (not a
  change to `stingerArc`'s return shape), reporting `[r, r+1, r+2]` for
  `lootdash` and an empty span for `victory`/`walkon`.
- **Weather FX** (`server/art.ts` `overlayFxRow`, Task 6): a sparse
  drizzle mark (`'`) during a rough error streak, drifting sparkles (`*`)
  during a clean one — composited into the **same** idle FX row the emote
  glyph already uses (Branch A of the task's decision gate), so it costs
  zero new rows: the row is non-blank and kept only while weather is
  active, reclaimed by `trimSharedBlankTopRows` otherwise, exactly the
  emote row's own contract. Drizzle reads the session's live error count
  (`combatErrorCount`, thresholded at `tierForErrors ≥ 2`) and rides the
  D14 angry-exemption; sparkle reads the account-scoped clean streak and
  takes the plain clamped gate, no exemption — a simultaneous rough count
  wins over a streak (bad news is the more actionable signal).

**Verified end-to-end** through the real render path in a throwaway
`CLAUDE_CONFIG_DIR` profile, on the real shell, with a cactus buddy
wearing a crown hat and an equipped rubber-duck trinket (the crowded-
sprite worst case): (a) the day's prop (`♣` clover at feet) rendered on
every idle tick alongside the still-intact trinket (`,>`) — no clobber;
(b) across ticks the pebble (`∘`) visibly kicked inward column-by-column
(`col 11 → col 10 → …`), confirmed on the rendered line, not just the
baked JSON; (c) a forced loot-dash stinger showed the peek posture
(`<  <` eyes) with the dropped-item glyph (`◇`) replacing the pebble for
exactly the pause's 3 ticks, then reverted; (d) an error-count fixture
(`errors_seen: 4`, tier 2) rendered a drizzle row (`' '    ' '`) above the
sprite, and — after resetting the session baseline and setting a clean
streak — the same profile rendered sparkles (`* *    * *`) instead, both
adding exactly one row with no clipping; (e) both a forced bug standoff
and a seed-searched wild visitor scene rendered with the feet prop, the
pebble, and the weather row all absent — only the combat/visitor frames
showed, confirming props/weather ride idle frames exclusively. All five
checks rendered exactly as designed. Tests: **1003 pass** (up from the 927
P2 baseline — 76 net new across Tasks 1-6, plus the two Task 4 fix-round
deltas folded in),
`tsc --noEmit` + `bash -n` clean. No production code touched by this
docs/verification pass (Task 7).

**No known follow-ups from this pass** — code review approved every task
(Task 4 needed the two fix rounds above before approval; every other task
passed clean or with only non-blocking notes), and the e2e sweep above
found nothing to report.

---

### Living ground + ground weather (2026-07-24)

A follow-up shipped after the living-world arc closed above — not one of its
five original phases, and P3 (idle economy) remains the arc's only never-built
piece. This is this doc's **first coverage of the living-ground row itself**:
it shipped mid-session on 2026-07-24 with no design doc of its own (the ground-
weather design doc's [Recap section](living-world/design-ground-weather.md)
is the closest thing to a spec for it), and both it and this weather layer
remain **uncommitted** on `feature/interactive-fight-scene` as of this writing.

**What.** A FIXED, full-width terrain strip (`server/ground.ts`) painted
beneath the whole buddy widget — grass/field/water/sand/stone/tundra,
session-seeded off `startedAt` so it's constant within a session and re-rolls
on the next one. Layered on top: occasional, randomized, genuinely
mid-session snow or rain — sparse, per-glyph-tinted specks woven into that
same row, starting and stopping while a session is still running rather than
being a fixed per-terrain decoration. Full design + resolved D1–D5 decisions:
[design-ground-weather.md](living-world/design-ground-weather.md); full
task-by-task implementation record:
[plan-ground-weather.md](living-world/plan-ground-weather.md).

**Why (D1–D5, resolved).** D1: the schedule is *derived*, not persisted — no
new side-channel file, unlike `combat.ts`'s `writeEncounter`/TTL precedent
(Branch B2 over the rejected Branch B1), because the whole schedule is
reconstructible from the session's already-loaded `startedAt`. D2: a new
`GroundWeather` type (`"snow" | "rain"`), deliberately distinct from `art.ts`'s
unrelated idle-FX-row `Weather` (`"drizzle" | "sparkle"`) — same English word,
different rows, different signals, never imported into each other. D3:
piggybacks the existing `groundEnabled` toggle — no new config key. D4: the
weather glyph rides a longer *woven* tile period (not the shell's plain
tile-repeat loop, which is untouched) so specks read as sparse rather than
turning the whole floor one color. D5: the shell recolors only the glyph,
resuming the terrain's own tint afterward (not a plain reset), via a plain
`${var//lit/repl}` substitution — verified against the real `+`/`:` glyphs in
this repo's actual shell before relying on it (Task 3's DECISION GATE); no
`sed`/loop fallback was needed.

**Mechanism, task by task:**

1. **Pure core** (`server/ground.ts`): `pickSessionWeather(seed)` — a
   `ground-weather:` hash-prefixed independent RNG stream from
   `pickSessionGround`'s `ground:` stream (the `props.ts` "distinct seed
   prefix per draw" idiom) — decides once per session whether/when/what-kind
   (~1-in-10 sessions, mirroring `visitor.ts`'s `VISITOR_ODDS` order of
   magnitude; start 30s–10min in, duration 2–8min so both edges of the
   window are actually observed mid-session). `isWeatherActive(schedule,
   elapsedMs)` is a pure boundary comparison, zero reroll. `buildWeatherTile`
   weaves the terrain's own repeating unit into a longer period (its own
   `ground-weather-weave:` stream) and scatters `+` (snow) / `:` (rain) into
   it — both glyphs verified disjoint from `ALL_GROUND_GLYPHS` (including the
   `field` terrain's own `,`, the exact collision the design doc's `,`
   placeholder would have hit), `MIRROR_SWAP`'s keys, and `art.ts`'s
   unrelated `WEATHER_GLYPH` set.
2. **Wiring** (`server/state.ts`, `writeStatusState`): extends the existing
   ground write site — same `startedAt` load, same try/catch, same
   `groundEnabled` gate. One bug caught during implementation: `startedAt` is
   epoch **seconds** (`session.ts`) while `Date.now()` is epoch **ms** — the
   elapsed-time check is `Date.now() - startedAt * 1000`, not a bare
   subtraction. Two new `StatusState` fields, `groundWeatherGlyph`/
   `groundWeatherColor`, written only while a window is open;
   `groundColor` is left as the terrain's own colour throughout.
3. **Shell recolor** (`statusline/buddy-status.sh`): the only shell change.
   `$gwglyph`/`$gwcolor` extracted with the same full/no-combat gate as
   `$ground`/`$gcolor`, appended to the existing joined-array/`IFS=$'\x1f'
   read` pipeline, then a bounded substitution recolors the glyph everywhere
   it lands in the already-tiled/clipped row and resumes the terrain's dim
   tint immediately after each occurrence.
4. **e2e + docs** (this section): a manual e2e through the real script (hand-
   built `status.json` fixtures under a temp `CLAUDE_CONFIG_DIR`, per the
   standing `CLAUDE_CONFIG_DIR`-prefix safety requirement) confirmed: no
   weather fields ⇒ byte-identical plain-terrain output; an active window ⇒
   the glyph renders in its own tint with the terrain tint resumed between
   specks; the window closing (fields absent on a later write) leaves no
   stale glyph/colour; an active combat scene fully suppresses the row; and
   `groundEnabled: false` (i.e. the server never writes ground fields in the
   first place) renders nothing. One test-methodology mistake caught and
   fixed along the way: a first draft of the `groundEnabled:false` e2e check
   hand-wrote `status.json` with ground/weather fields present *and*
   `groundEnabled:false` in config — an inconsistent combination the real
   server would never produce (the shell doesn't re-check `groundEnabled` at
   all; only `writeStatusState` does), so it wasn't actually testing D3.
   Corrected to omit the fields entirely, matching real server behavior.

**Zero-cost invariants held:** no new config key (D3), no new persisted state
or `TRANSIENT_PREFIXES` entry (D1 — the schedule is fully derived, nothing to
clean up on uninstall), zero per-event cost (`isWeatherActive` is one
comparison per write, no reroll).

Tests: **1044 pass** (1027 baseline at this doc's last update + 17 across the
four tasks), `tsc --noEmit` + `bash -n` clean. All four tasks (and the base
living-ground row before them) remain uncommitted on
`feature/interactive-fight-scene`, layered on top of the still-uncommitted
`worldDressing` opt-out toggle in the same files — deliberately left that way
pending a decision on commit granularity (the weather work is textually
interleaved with that prior uncommitted work in `state.ts`, so a clean
weather-only commit isn't possible without committing the base row first).

---

### Falling weather sky band (2026-07-24)

A direct follow-up to the ground-weather layer above, shipped the same day on
the same still-uncommitted branch. Where ground-weather is *static* — the same
woven speck pattern re-rendered identically every tick — this adds genuine
falling motion: flakes/drops that visibly descend across successive renders,
during the exact same weather window the ground row already schedules. Full
design + resolved D1–D11 decisions:
[plan-falling-weather.md](living-world/plan-falling-weather.md) (this plan
combines analysis and task-by-task tracking in one doc, unlike the ground-
weather design/plan split).

**What.** A dedicated "sky band" — `SKY_BAND_ROWS=3` rows, `FLAKE_COUNT=4`
flakes, `FALL_PERIOD=12` distinct baked ticks — prepended directly above the
sprite's own art, independent of whichever species/emotion/gear is currently
showing. Snow uses `❄`, rain uses `` ` ``, each with its own embedded color.
The band never touches the sprite's own glyph cells.

**Why (D1–D11, resolved).** D1: **layer, not replace** — the sky band is
precipitation in transit, the ground specks are precipitation already landed;
both share one cause and one schedule, so the two together read as one
coherent picture rather than a redundant one. D2: reuse the *same*
`pickSessionWeather`/`isWeatherActive` schedule/elapsedMs the ground-weather
block already computed — no second roll, so the band and the ground specks can
never disagree about whether weather is happening (independently confirmed by
inspection during this feature's audit: `state.ts` calls `pickSessionWeather`
exactly once). D3/D4/D5: a dedicated fixed-row band, independent of the
sprite's own frame variant, baked as a short closed set of pre-rendered
strings (`buildFallingWeatherBand`) — cheaper than a raw per-tick coordinate
table bash would have to draw, and required by the "server bakes, bash
cycles" invariant either way. D6: **embedded SGR, no shell recoloring** — the
band bakes its own literal ANSI directly into the row string, reusing the
wyvern-flame precedent (frame art is exempt from the jq control-character
sanitizer). This is a genuine simplification over ground-weather's D5, which
needed a bounded `${var//lit/repl}` shell substitution to recolor a plain-text
glyph in place; the sky band needs no equivalent mechanism at all — confirmed
by inspection: no per-glyph shell substitution exists anywhere in the
falling-weather shell code, unlike the ground row's `_grow="${_grow//...}"`
line. D7: 4 staggered flakes, phase-offset so they don't fall in lockstep,
respawning after a short gap. D8: a new independent shell channel
(`weatherFallFrames`/`weatherFallSequence`), decoded and prepended above
`ART_LINES`, not fused combinatorially into every sprite-frame variant. D9:
**the sky band degrades before hop does** under row-budget pressure — the
band's own budget check runs strictly *after* hop's collapse decision has
already finalized `HOP_RESERVE`, reusing `HOP_BUDGET=12` directly (not a
separate, larger ceiling); when both can't fit, the band drops and hop's
reservation is left completely untouched. Verified live through the real
script during this feature's e2e pass: a 3-row band alongside a 2-row hop
reservation on a 6-row sprite+name stack renders 11 total lines with the
flake present; a 6-row band in the same slot renders 8 lines (6 + hop's 2,
unchanged) with the flake fully absent — the band alone degrades, never hop.
D10: **suppression mirrors the wander-style three-part gate** (`$gf=="full"
and $celeb_fresh!=1 and $combat_on!=1`), not the ground row's looser
combat-only gate — a fresh celebration suppresses the band even though it
does *not* suppress the ground row, because the sky band shares the sprite's
own visual column (which a flourish already swaps to a taller flipbook) while
the ground row is a fully separate full-width strip below everything.
Confirmed live: an active combat scene and a fresh celebration each
independently suppress the band with zero flake glyphs rendered, even with
`weatherFallFrames` present in `status.json`. D11: piggybacks the same
`groundEnabled` toggle — no new config key.

**Mechanism, task by task:**

1. **Pure core** (`server/weatherfall.ts`): `buildFallingWeatherBand(kind,
   seed, width, rows, period)` bakes `period` distinct band frames off an
   independent `sky-fall:` hash-prefixed RNG stream (never rerolls whether/
   when weather happens — only how the band looks). Width is fixed at
   `SKY_FALL_WIDTH=14`, reusing the shell's existing `ART_W` layout-budget
   constant rather than any species-derived value — a real-frame-width probe
   (Task 0) found sprite content is NOT a single width across species (6–12
   display cells, 3/19 species ragged even within one frame, including a
   deliberately tapering wyvern silhouette), so no per-species width exists
   to borrow.
2. **Wiring** (`server/state.ts`, `writeStatusState`): extends the ground/
   weather block in place, inside the same `if (isWeatherActive(schedule,
   elapsedMs))` branch the ground-weather tile already lives in — the two
   new fields (`weatherFallFrames`, `weatherFallSequence`) are written only
   while that one shared window is open, same "absent ⇒ off" contract
   `groundWeatherGlyph` already uses.
3. **Shell prepend** (`statusline/buddy-status.sh`) — the one real shell
   change in this plan. The band is decoded the same way `FRAME_BODY` is
   (base64 → `while IFS= read -r line` → array), then prepended onto
   `ALL_LINES`/`ALL_COLORS` — deliberately *after* the rarity/shiny coloring
   loop, not into raw `ART_LINES` before it, with an empty color wrapper
   (the band already carries its own complete SGR). Prepending before the
   coloring loop was rejected once actually traced through: it would waste
   escapes wrapping already-colored band rows, and would offset a SHINY
   buddy's rainbow-cycle phase on the sprite rows below purely because
   unrelated band rows consumed cycle steps first. `HOP_BUDGET` was hoisted
   to a top-level constant so the band's own D9 degrade check could share
   the exact same ceiling hop's own collapse logic already uses.
4. **e2e + docs** (this section): hand-built `status.json` fixtures under a
   temp `CLAUDE_CONFIG_DIR` (per the standing prefix-safety requirement),
   rendered through the real script. Confirmed live: the flake genuinely
   changes row across successive `NOW` ticks (not a static repeat); the
   sprite's own rows are byte-for-byte identical whether or not the band is
   present; no falling-weather fields render a plain 6-line idle block with
   zero flake glyphs; combat and a fresh celebration each independently
   suppress the band; and the D9 degrade renders exactly as predicted
   (11 lines when the band fits, 8 when it doesn't — hop's reservation
   intact either way).

**The honest cadence note.** At this codebase's measured ~1s refresh floor
(`design.md`'s P0 finding — the platform minimum, not a tunable, and marked
FAIL-permanently), this motion reads as gentle stop-motion drift, not a
smooth fall. That's a deliberate, already-accepted tradeoff, the same one
every other baked motion in this codebase already lives with (wander steps
one cell per `stepEvery` ticks; the kick slides one column per gait
step-tick) — not a shortcoming unique to this feature.

**Zero-cost invariants held:** no new config key (D11), no new persisted
state (the band is fully derived from the same `startedAt`-seeded schedule
ground-weather already reconstructs), one shared schedule so the two effects
can never disagree about whether weather is happening (D2).

Tests: **1064 pass** (1044 baseline at this plan's start + 20 across Tasks
1–3: 8 in `weatherfall.test.ts`, 5 in `state_wander.test.ts`, 7 in
`statusline_render.test.ts`), `tsc --noEmit` + `bash -n` clean — all
independently re-verified during this feature's audit, not just taken on the
prior session's word. Remains uncommitted on `feature/interactive-fight-scene`
alongside the ground-weather layer and the `worldDressing` toggle it builds
on top of, pending the user's go-ahead to commit.

---

### Falling weather during combat (2026-07-24)

A direct follow-up to the two weather layers above, closing the gap the user
actually reported: watching a live bug fight while falling snow/rain was
invisible the entire time. Full design + resolved D1–D8 decisions:
[design-combat-weather.md](living-world/design-combat-weather.md).

**What.** Both weather layers now render during an active combat scene — a
resolved fight, the persistent pre-fight standoff, or a wild-visitor cameo,
all three sharing one `combatFrames`/`artWidth` triple. The sky band bakes at
the fight's own `artWidth` (22–28 measured across all 441 species pairs, per
the design doc's probe) instead of the fixed idle `SKY_FALL_WIDTH=14`, so it
lines up flush with the wider tableau instead of covering only the player.
The ground row and its woven-in specks render beneath the fight exactly as
they do at idle.

**Why (D1–D3, the load-bearing ones).** D1/D2: this was a pure gating
problem, not a structural one — every weather field was already being
computed and written into `status.json` during combat (D6 confirmed
`pickSessionWeather`/`isWeatherActive` never depend on `combat_on` at all);
only the shell's `jq` pass was throwing four of those fields away via a
`combat_on != 1` clause. Dropping that clause from the ground row + its
weather glyph (2 fields) and the sky band (2 fields) was the entire fix on
the shell side. D3: a fixed-14 band would have visually truncated over just
the player, since every measured combat tableau is 22–28 cells wide — the
server now bakes the band at `combatFrames !== undefined ? artWidth :
SKY_FALL_WIDTH`, a one-line ternary, reusing `combatFrames`/`artWidth` that
`writeStatusState` already computes earlier in the same function (zero
reordering).

**Mechanism.** One ternary in `server/state.ts`'s existing weather-bake call
site (D3); four `combat_on != 1` clauses dropped from four `jq` gates in
`statusline/buddy-status.sh` (D1/D2) — the ground tile, its weather glyph,
and the sky band's frame + sequence lookups. The sky-band prepend mechanism
itself (`buddy-status.sh`'s `WF_LINES` array + `HOP_BUDGET` degrade check)
and `server/weatherfall.ts`'s `buildFallingWeatherBand` needed **zero**
changes — both were already generic over whatever width/frame-source jq
handed them; only the gate moved. Tasks 1–2 shipped with their own unit
coverage (5 tests in `state_wander.test.ts`, 7 in
`statusline_render.test.ts`, folded into the 1068 baseline below); this
section covers Task 3 — manual e2e + docs only, no new automated tests.

**e2e, live through the real script** (temp `CLAUDE_CONFIG_DIR`, a genuine
`bakePendingScene`-baked two-sprite standoff — not a synthetic one-line
fixture — plus `BUDDY_FORCE_WEATHER=snow` to force the window open on
demand): (a) confirmed at the byte level, not just visually — a cactus-vs-
dragon standoff baked `artWidth: 28`, and every decoded `weatherFallFrames`
line measured exactly 28 characters, matching `combatFrames`' own line
width; four successive ticks (`BUDDY_FAKE_NOW` 1000→1003) showed the flake
genuinely change row each tick, not a static repeat. (b) the ground row's
`~`/`+` weather specks rendered on their own full-width line beneath the
fight in the same run. (c) patching a fresh `celebration` field onto that
same real `status.json` suppressed the sky band (zero flake glyphs) while
leaving the combat tableau fully intact (combat still wins frame-source
priority over a flourish) **and leaving the ground row's specks rendering
unaffected** — confirming the design doc's own D10 finding (from
`plan-falling-weather.md`) that a fresh celebration suppresses only the sky
band, never the ground row, since the ground row's gate never carried a
`celeb_fresh` clause to begin with. (d) a second real combat+forced-weather
fixture with `groundEnabled: false` in config produced a `status.json` with
`ground`/`groundColor`/`groundWeatherGlyph`/`groundWeatherColor`/
`weatherFallFrames`/`weatherFallSequence` **all absent** (the server-side
gate, not the shell, is what suppresses them) — rendered output showed
neither the band nor the ground row, with the fight tableau untouched. (e) a
real duck-vs-wyvern standoff (the tallest species pair found by sweeping all
400 pairs: 6 raw tableau rows) plus a caption row, name, an equipped title,
and a prestige/streak badge pushed `ART_COUNT` to 10 — one over the
`ART_COUNT + HOP_RESERVE + 3 <= HOP_BUDGET(12)` ceiling (combat always zeros
`HOP_RESERVE`, so the check collapses to `ART_COUNT <= 9`, exactly as D5
predicted) — and the band silently dropped to zero rows while the six-row
tableau, caption, name, title, and badge all rendered intact. An A/B control
(same 6-row tableau, title/badge removed, `ART_COUNT=8`) confirmed the band
renders normally at that lower count, isolating the degrade to the row
budget rather than to the species pair.

**Honest tradeoff / judgment call.** The design doc's own Task 3 checklist
phrases confirmation (c) as "a fresh flourish/celebration still suppresses
*both*" — read literally against the actual shipped Task 1/2 gates (and
against `plan-falling-weather.md`'s own D10, which explicitly documents that
a fresh celebration does **not** suppress the ground row), that wording is
imprecise. The live render above confirms the real, intentional behavior:
only the sky band shares the sprite's own visual column that a flourish
swaps out, so only the sky band is celebration-gated; the ground row is a
fully separate full-width strip with no such gate, by design (D2's own
"zero layout risk" reasoning). Reported here rather than silently
"fixed" to match the checklist wording, since Tasks 1–2 (and their tests)
are out of scope for this task and already correct.

**Zero-cost invariants held:** no new config key, no new persisted state, no
shell mechanism changes (D1/D2 are pure gate relaxations; D3 is a one-line
server-side ternary) — matching D4's explicit no-density-scaling and D7's
accepted caption/band adjacency, both left as documented tradeoffs, not
"fixed" here.

Tests: **1068 pass, 0 fail** (up from the falling-weather section's own last
recorded 1064 — the delta is Tasks 1–2 of `design-combat-weather.md`'s own
unit coverage in `state_wander.test.ts` and `statusline_render.test.ts`,
already shipped before this Task 3 pass began; Task 3 itself adds zero new
automated tests, only this manual e2e sweep), `tsc --noEmit` + `bash -n`
clean — all three re-run and independently verified during this pass, not
taken on a prior session's word. Remains uncommitted on
`feature/interactive-fight-scene`, layered on the still-uncommitted
ground-weather/falling-weather/`worldDressing` work above, pending the
user's go-ahead to commit.

---

### Full-width falling weather (2026-07-26)

A direct follow-up to the theme-color fix above: once the user could
actually SEE the falling snow, they noticed it only ever appears in a
narrow ~14-28 column strip directly above the buddy sprite/combat cluster —
never over the large blank gap between the stats panel and that cluster.
Full design + resolved D1-D11 decisions:
[plan-fullwidth-weather.md](living-world/plan-fullwidth-weather.md).

**What.** A second, independent flipbook — the "gap band" — now fills the
guaranteed-blank horizontal space between the stats column and the roaming
buddy/combat cluster (`statusline/buddy-status.sh`'s `MID_SPACER`/`SPACER`
tail), on the exact same rows the existing narrow sky band already
occupies. The two bands run side by side on the same lines: the gap band on
the left (stats-adjacent), the original narrow band on the right (still
directly above the sprite, unchanged). Live-rendered check across
`COLS ∈ {80, 125, 160}` confirmed flakes now appear from a few columns past
the stats panel all the way out toward the sprite — not just the last
14-28 columns — with the stats text, bubble, and sprite/combat art
completely untouched.

**Why (D1-D3, the load-bearing ones).** D1: the gap segment between the
stats column and the roaming cluster is PROVABLY blank on every row,
always — confirmed by reading the actual per-line string-concatenation
order (`buddy-status.sh:1162-1226`), not assumed. That's what makes this
safe to fill without any 2D collision logic: there is nothing there to
collide with. D2: unlike the living-ground row (a static repeating tile
that can be generated at any width for free), the sky band is an
*absolute-position animated flipbook* — flake positions can't be
"repeated" to fill an unknown width. The resolved fix generalizes the
ground row's own live-clip trick (bake wide, `${str:0:N}` clip in bash at
render time) to a full multi-row flipbook instead of one repeating string:
bake a second band at a generous fixed `MAX_GAP_WIDTH=110` (covers the
realistic 80-160 column range and the script's own 125-col fallback
default, empirically swept), left-anchor-clip it to the live `ROAM` value
every render. D3: the ORIGINAL sky band embeds ANSI color codes directly
into its baked strings — safe because it's never sliced, only printed
whole. That assumption would break for a band that DOES need slicing:
bash's `${str:0:N}` counts raw characters, not display cells, so an
embedded ~20-character escape sequence would eat most of a column budget
and risks a mid-escape cut that bleeds color into whatever prints next.
The gap band sidesteps this by baking PLAIN, ANSI-free content and
recoloring AFTER clipping — reusing the exact clip-then-recolor order the
living-ground row already proved safe in this codebase.

**Mechanism.** `server/weatherfall.ts` gained `buildFallingWeatherGapBand`
(plain-output twin of `buildFallingWeatherBand`, distinct `sky-fall-gap:`
seed stream so the two layers don't visually lock-step) plus three named
constants: `FLAKE_DENSITY` (the original band's own flake-per-column ratio,
reused rather than re-tuned), `MAX_GAP_WIDTH=110`, `GAP_FLAKE_COUNT=31`.
`server/state.ts` bakes it alongside the existing band in the same
weather-active block (same schedule, same theme, no second schedule read)
and always at the fixed `MAX_GAP_WIDTH` regardless of idle/combat — the
combat tableau's own wider `artWidth` only affects the narrow band, not
this one, since the two are now genuinely independent flipbooks.
`statusline/buddy-status.sh` decodes the new frames, clips them to `ROAM`
(the same width the free-roaming cluster's own home-position math already
computes), recolors the flake glyph post-clip, and splices the result into
whichever segment (`MID_SPACER` with a stats panel, `SPACER`'s tail
without) the per-line loop already uses for that guaranteed-blank space —
zero new rows, zero change to `HOP_BUDGET`'s existing degrade math (the gap
band shares the same activity/degrade signal as the original band, so if
one disappears under row-budget pressure, so does the other).

**Verification.** Implemented via a single dispatched Fable 5 agent working
through all 4 tasks of the plan doc in sequence (TDD throughout, per the
doc's own house style) — the agent hit its own session's usage limit partway
through Task 4 (docs) after Tasks 0-3 (the width-confirmation probe, the
`weatherfall.ts` core, the `state.ts` wiring, and the `buddy-status.sh` shell
change) were already complete and tested. I independently re-verified
everything landed correctly before finishing Task 4 myself: re-ran the full
suite (1087 pass, 0 fail — 1070 baseline + 17 new), `tsc --noEmit` and
`bash -n` clean, confirmed no commits were made. Then built a real sandboxed
render (`CLAUDE_CONFIG_DIR` pointed at a fresh `mktemp -d`, never touching
the real profile) across `COLS ∈ {80, 125, 160}` and measured actual flake
column positions in the decoded output — confirmed genuine spread (e.g. at
`COLS=160`, flakes landed at columns 6 through 140 of a 152-wide printed
line, versus the old band's confinement to the final ~14-28 columns) with
the stats/name/ground rows byte-for-byte unaffected.

**Honest tradeoffs (accepted, not fixed).** D4: flake density is NOT
re-tuned for the much wider canvas — the same sparse ratio the narrow band
already reads as "ambient, not simulation" (per `design-combat-weather.md`
D4) just spreads over more columns, so it can look even sparser on very
wide terminals; not addressed here, consistent with this whole arc's
repeated posture on density. D11: on an unusually wide terminal (`ROAM`
exceeding the baked 110-column budget) the far side of the gap — closest to
the sprite, itself already covered by the original band — goes unpopulated
rather than mathematically extending `MAX_GAP_WIDTH`; judged rare enough
to accept. Compositing weather into the stats column's or bubble's own
blank filler rows (rather than only the guaranteed-blank gap between them)
was evaluated and explicitly deferred — real and tractable, but meaningfully
more shell logic for content whose blank/filled state varies per row and
per config, and the user's actual complaint (a narrow column, not missing
coverage beside specific rows) is already resolved without it.

**Follow-up hardening pass (2026-07-27).** Re-walked the plan doc's own
task checklists end-to-end rather than trusting the "implemented" header.
The shipped shell/server code proved correct throughout — but two of the
plan's checkboxes had not actually been satisfied, and the tests written for
it had real holes:

- **Task 0's empirical sweep had never been run against the live script.**
  Done now (72 renders through an instrumented copy): §4.1's hand-worked
  table reproduces *exactly*, but its prose estimate of where `ROAM` outgrows
  the baked 110 columns ("~185") is wrong — the real crossover is
  **`COLS=162`** with stats on and **`COLS=133`** with stats off (the table
  never considered the stats-off case at all). The constant still stands;
  the safety margin is just thinner than the doc implied.
- **Task 3's render tests did not exist** — only the fixture override fields
  had been added, with nothing consuming them. Added an 11-test block, then
  **mutation-tested it**: deleting D11's right-pad and deleting the post-clip
  recolor *both initially survived*. The first because no test exceeded
  `ROAM=110`; the second because the ART-band fixture embedded the same snow
  SGR the gap band gets, making the assertion vacuous. Both fixed and
  re-confirmed to fail under mutation.
- **`state.ts`'s theme threading was unpinned** — `SKY_FALL_COLOR[theme][kind]`
  could have been hardcoded to the dark palette with every test still green.
  That is precisely the line behind this arc's "snow is invisible on my white
  background" bug, so it now has its own light/auto pins.

Tests: **1100 pass, 0 fail** (1087 → +2 theme pins, +11 gap-band render
tests), `tsc --noEmit` + `bash -n` clean — re-verified independently, not
taken on the dispatched agent's word alone. Remains uncommitted on
`feature/interactive-fight-scene`, layered on the entire prior uncommitted
stack.

### Weather becomes a front layer, and gives back its three rows (2026-07-27)

Two requests that turned out to be one change — see
[design-weather-frontlayer.md](living-world/design-weather-frontlayer.md):
_"remove ~3 lines from the statusline"_ and _"the chat bubble is the back
layer, the snowflake is the front layer as it falls."_

The three extra lines **were** the falling-weather feature. It reserved
`SKY_BAND_ROWS = 3` blank-but-for-flakes rows above the sprite, for exactly one
reason: to give flakes somewhere to fall that wasn't already occupied. The
second request removes that reason, so both were satisfied by deleting the
reserved sky and compositing the weather over the block that was already there.

**What changed.** The SGR-carrying ART band is **gone** — `weatherfall.ts`'s
`buildFallingWeatherBand`, `SKY_FALL_WIDTH`, `SKY_BAND_ROWS`, `FLAKE_COUNT`,
`state.ts`'s `weatherFallFrames` payload field, the shell's `WF_LINES`, its
prepend, and the `HOP_BUDGET` degrade branch that existed only because the band
competed for rows. One layer survives: the plain, line-wide field, now baked at
`SKY_FALL_ROWS = 14` and composited by a new `_wx_overlay` shell function in
which **a flake may replace a space and nothing else** — which makes the
composite width-preserving by construction rather than by assertion.

Two prior design decisions dissolved rather than being carried forward:
`design-combat-weather.md`'s scene-width-aware bake (a full-width field cannot
be outgrown by any scene) and `plan-falling-weather.md` D9's row budget (a
front layer consumes no rows).

**Measured at the reporting user's real geometry:** block 11 rows → **8**;
weather on 3 rows → **all 8**; flakes now pass in front of the bubble and over
the sprite; line widths identical to the unweathered render at `COLS`
40/60/80/104/125/160/200; tick time 49 ms → 50 ms. `status.json` grows 10 → 23
KB, which measured as free (10-render averages of 54/53/52 ms at 3/12/14 rows —
tick cost here is process startup, not JSON size), so a sparse re-encoding was
considered and rejected on that evidence.

**Deliberately kept plain:** the stats column's own content rows. The bars are
read as data rather than looked at as scenery, so they are exempt — pinned by a
test, not left to hold by accident.

The mutation audit caught one real bug the suite could not see: the field's row
index had to become the block row, and the old `i - ART_TOP` mapping survived
every existing test because it only misbehaves once the hop headroom makes
`ART_TOP` non-zero. Added a test that combines hop with a known-row field; now
caught.

Tests: **1107 pass, 0 fail**, `tsc --noEmit` + `bash -n` clean. Still
uncommitted on `feature/interactive-fight-scene`.

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
- ~~Commit the rewards/leveling fix pass **and** the derive-on-read upgrades
  work~~ **done** — committed by 2026-07-07 (`711103d` and prior).
- ~~**Test-isolation bug in `migrate.test.ts`**~~ **fixed 2026-07-16** — the
  aura_shiny case now runs in a fresh subprocess with a temp
  `CLAUDE_CONFIG_DIR`; the suite is fully green locally. See the
  [hardening pass](#hardening-pass--bug--statusline-perf-fixes-2026-07-16).
- **`mood-react.sh` / `file-type-react.sh` hardcode `$HOME/.claude-buddy`**
  (found 2026-07-16, not fixed): they don't source `scripts/paths.sh`, so a
  custom `CLAUDE_CONFIG_DIR` profile misses their reactions/counters.
- ~~**`statProgress.PATIENCE` runaway bank**~~ **fixed 2026-07-17** (stat-leveling
  v2 §P0): `elapsedSec` is clamped to `PATIENCE_MAX_MINUTES`, the bank is capped
  at `STAT_BANK_CAP=1`, and `sanitizeStatProgress` dissipates the existing 114+
  hoard on load. See [stats-leveling-v2.md](../leveling-system/stats-leveling-v2.md).
- **react.sh classifier newline weakness** (found 2026-07-09, not fixed):
  `\b`/`^`-anchored patterns can't match past the first line of a tool
  response in some shapes; test-fail under-fires. (Tracked in the idle-rpg
  notes; folding it here so this list is complete.)
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
  Committed on `feature/interactive-fight-scene` (`22f6733`).
- ~~**Living-world arc**~~ **complete 2026-07-20** — P0 (measured), P1
  (movement vocabulary), P2 (encounter variety — boss bugs, wild buddy
  visitors), and P4 (world dressing — props, prop-kick, inspect beat,
  weather FX) are all implemented, e2e-verified, and committed on
  `feature/interactive-fight-scene` (see above). Task 1's tick-ceiling
  measurement (P0 — how fast Claude Code actually repaints the status
  line) came back FAIL-permanently (see
  [design.md's P0 findings](living-world/design.md#p0-findings-measured-2026-07-18));
  Task 10 (the one sanctioned `buddy-status.sh` sub-second-tick change) is
  dropped, not deferred. **P3 (idle economy — expeditions,
  gear-economy round-out) was never implemented** — deprioritized in favor
  of jumping straight to P4 (plan-p4.md's own recon confirms
  `server/expedition.ts` doesn't exist and no P4 task assumes it landed
  first); no plan doc for P3 was ever written, and none is currently
  planned. The arc closes at four of its five originally-designed phases.
- The stale top-level [`status.md`](status.md) is a point-in-time artifact for the
  quick-wins sub-arc (440 tests, `feature/leveling-system`) — superseded by this
  doc for the current picture.
- **Living-world P2 latent notes** (found in code-quality review, 2026-07-20,
  not fixed — see the
  [P2 section](#living-world-arc--p2-encounter-variety-2026-07-20) for
  detail): `applyBossCrown` silently no-ops if a future tier-4 bug's row 0
  is ever non-blank (no guard/test today, safe only because the one
  existing tier-4 entry happens to have a blank row 0); `VisitorSpec.shiny`
  is rolled but never surfaced in the scene or toast; `readVisitor()`'s
  render branch runs a discarded extra disk read at `gameFeel=subtle`.

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
| [idle-rpg/design-attack-animation.md](idle-rpg/design-attack-animation.md) | skirmish bouts + damage pops (**implemented** 2026-07-10) |
| [idle-rpg/design-sprite-animation.md](idle-rpg/design-sprite-animation.md) | idle emote row + dodge/parry bouts (**implemented** 2026-07-17) |
| [idle-rpg/design-sprite-animation-v2.md](idle-rpg/design-sprite-animation-v2.md) | round 2: crit/counter bouts, per-kind flourish, idle glance, pilot art frame (**implemented** 2026-07-17) |
| [idle-rpg/testing-guide.md](idle-rpg/testing-guide.md) | hands-on verification harnesses |
| [living-world/design.md](living-world/design.md) | idle-RPG + animation + movement arc — **arc complete**: P0 measured/FAIL (Task 10 dropped), P1 + P2 + P4 implemented; P3 never built |
| [living-world/plan-p0-p1.md](living-world/plan-p0-p1.md) | phased P0/P1 implementation plan + task-by-task tracker |
| [living-world/plan-p2.md](living-world/plan-p2.md) | phased P2 (boss bugs + wild visitors) implementation plan + task-by-task tracker |
| [living-world/plan-p4.md](living-world/plan-p4.md) | phased P4 (props, prop-kick, inspect beat, weather FX) implementation plan + task-by-task tracker |
| [living-world/design-ground-weather.md](living-world/design-ground-weather.md) | living-ground follow-up: mid-session snow/rain design + resolved D1–D5 (**implemented** 2026-07-24) |
| [living-world/plan-ground-weather.md](living-world/plan-ground-weather.md) | ground-weather implementation plan + task-by-task tracker |
| [living-world/plan-falling-weather.md](living-world/plan-falling-weather.md) | falling-weather sky band: design + resolved D1–D11 + task-by-task tracker in one doc (**implemented** 2026-07-24) |
| [living-world/design-combat-weather.md](living-world/design-combat-weather.md) | falling weather + ground weather during active combat scenes: resolved D1–D8 + task-by-task plan (**implemented** 2026-07-24) |
| [living-world/plan-fullwidth-weather.md](living-world/plan-fullwidth-weather.md) | falling weather spans the full stats-to-sprite gap, not just a narrow strip: resolved D1–D11 + task-by-task plan in one doc (**implemented** 2026-07-26) |
| [living-world/design-weather-frontlayer.md](living-world/design-weather-frontlayer.md) | weather stops reserving sky rows and becomes a front layer over the whole block: resolved F1–F10 + tasks + mutation audit (**implemented** 2026-07-27) |
| [menu/](menu/) | interactive menu + nav channel |
| [anaylsis.md](anaylsis.md) | earlier analysis notes |
