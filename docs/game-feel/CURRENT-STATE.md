# Game-Feel — Current State

A single top-level snapshot of the **whole** game-feel system as it stands today,
tying together the arcs that each have their own design/status docs. For the
per-arc detail, follow the links in [Doc map](#doc-map).

_Last updated: 2026-07-18 · branch `feature/interactive-fight-scene`_
_Baseline: **874 tests, all pass** · `tsc --noEmit` clean · `bash -n` clean._
_Status: everything through
[stat-leveling v2](#stat-leveling-v2--every-stat-behavioral-learning-wisdom-visible-gains-2026-07-17)
is **committed**. Newest on top:
[living-world arc — P1 movement vocabulary](#living-world-arc--p1-movement-vocabulary-2026-07-18)
(mood gaits, event-choreography stingers, edge/panel lean/peek posture, plus
the same-day D14 fix reviving the angry gait and the sprite-animation-round-1
`!` emote from an auto-quiet coupling that made them unreachable) —
**committed** through `cb7d061`; this docs pass is the remaining piece. No PR
opened yet._

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
- **Living-world arc**: P1 (movement vocabulary) is implemented and committed
  (see above). Task 1's tick-ceiling measurement (P0 — how fast Claude Code
  actually repaints the status line) is still pending and needs a
  user-in-the-loop capture session; Task 10 (the one sanctioned
  `buddy-status.sh` sub-second-tick change) is gated on that finding reading
  PASS. P2 (encounter variety — boss bugs, wild buddy visitors) is the next
  planned phase; no plan doc for it yet.
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
| [idle-rpg/design-attack-animation.md](idle-rpg/design-attack-animation.md) | skirmish bouts + damage pops (**implemented** 2026-07-10) |
| [idle-rpg/design-sprite-animation.md](idle-rpg/design-sprite-animation.md) | idle emote row + dodge/parry bouts (**implemented** 2026-07-17) |
| [idle-rpg/design-sprite-animation-v2.md](idle-rpg/design-sprite-animation-v2.md) | round 2: crit/counter bouts, per-kind flourish, idle glance, pilot art frame (**implemented** 2026-07-17) |
| [idle-rpg/testing-guide.md](idle-rpg/testing-guide.md) | hands-on verification harnesses |
| [living-world/design.md](living-world/design.md) | idle-RPG + animation + movement arc, P0-P4 (**P1 implemented** 2026-07-18, P0 measurement pending) |
| [living-world/plan-p0-p1.md](living-world/plan-p0-p1.md) | phased P0/P1 implementation plan + task-by-task tracker |
| [menu/](menu/) | interactive menu + nav channel |
| [anaylsis.md](anaylsis.md) | earlier analysis notes |
