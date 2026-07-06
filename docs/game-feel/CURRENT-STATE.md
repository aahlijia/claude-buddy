# Game-Feel — Current State

A single top-level snapshot of the **whole** game-feel system as it stands today,
tying together the arcs that each have their own design/status docs. For the
per-arc detail, follow the links in [Doc map](#doc-map).

_Last updated: 2026-07-06 · branch `feature/interactive-menu`_
_Baseline: **679 tests pass** · `tsc --noEmit` clean · `bash -n` clean_
_Status: all arcs **done and committed** — `feature/free-roam-combat` was merged into
`feature/interactive-menu` via `fa8cc6f` on 2026-07-06, absorbing everything in
[Recent changes](#recent-changes-2026-06-30) below. No PR opened yet._

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
3. **Derive-on-read.** Equipment/seasonal/gear fold into the *rendered* appearance
   on read; innate bones are never mutated.
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
- Leftward-roam magnitude tune (`moodWalkOpts` ranges) — intentionally conservative.
- Idle-RPG niceties: sell/refund gear (buy-only today), inventory cap, gear-bonus
  delta in `buddy_xp`, post-TTL encounter inspection command.
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
| [idle-rpg/testing-guide.md](idle-rpg/testing-guide.md) | hands-on verification harnesses |
| [menu/](menu/) | interactive menu + nav channel |
| [anaylsis.md](anaylsis.md) | earlier analysis notes |
