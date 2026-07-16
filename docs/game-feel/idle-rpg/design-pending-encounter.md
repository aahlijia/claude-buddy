# Design: Pending Encounter — the Standoff That Nudges You to Commit

**Status:** ✅ Implemented (Phases 1–4) on `feature/interactive-fight-scene`,
2026-07-08 — 755 tests pass, `tsc`/`bash -n` clean, e2e smoke green. Uncommitted.
**Date:** 2026-07-08
**Branch context:** `feature/interactive-menu` (follows the 2026-07-08 combat
spawn-signal fix documented in `docs/game-feel/CURRENT-STATE.md` — this design
assumes `combatErrorCount` and the react.sh classifier fixes are in place).
**Scope:** `server/combat.ts`, `server/session.ts`, `server/award-xp.ts`,
`server/state.ts`, `hooks/react.sh`, `statusline/buddy-status.sh`

---

## 1. Problem

Today the fight is invisible until it's over. Errors accrue silently during a
session; at commit, `maybeFightBug` spawns, resolves, and bakes the two-sprite
scene in one shot, and the render lives for 10 seconds (`ENCOUNTER_TTL_MS`).
Blink and you miss the whole idle-RPG loop.

The user-requested inversion: **the enemy should appear when the first
error-ish event lands and stand there until the commit resolves it.** The
persistent standoff doubles as a gameplay nudge — a bug on your status line
means you have uncommitted (and error-marked) work.

What exists and gets reused wholesale:

| Piece | Where | Reused as |
|---|---|---|
| `combatErrorCount(delta)` | session.ts | the sighting/escalation signal |
| `tierForErrors` / `spawnBug` | bugs.ts | tier + enemy choice, unchanged |
| `scenePoses`/`bakeScene` machinery (rect/mirror/alignHeights/gapRow) | combat.ts | the pending bake shares every helper |
| `encounter.json` + 10s TTL | combat.ts / state.ts / buddy-status.sh | the **resolved** phase, byte-for-byte unchanged |
| combat > flourish > idle frame source | buddy-status.sh jq | extended with one sticky bit |

---

## 2. Goals and non-goals

### Goals

1. **G1 — Sighting render.** Within one hook event of the first error-ish
   reaction (`error`, `test-fail`, `type-error`, `lint-fail`, `build-fail`),
   a two-sprite standoff scene appears on the status line at `gameFeel=full`.
2. **G2 — Persistence.** The standoff stays until a commit resolves it. No
   TTL. Fixing the error does *not* dismiss it — only committing does (that's
   the nudge semantics, deliberate).
3. **G3 — Escalation.** More errors in the same session upgrade the enemy:
   the displayed bug's tier tracks `tierForErrors(combatErrorCount)` live.
4. **G4 — Pinned identity.** The enemy you stare down is the enemy you fight.
   Commit-time resolution fights the pending bug, not a fresh roll.
5. **G5 — Clean lifecycle.** Commit clears the pending state unconditionally
   (even a zero-delta commit); `session_start` clears it too. No orphans.
6. **G6 — Idle path byte-identical.** No errors ⇒ no pending file ⇒ every
   frame the renderer emits is identical to today. Resolved-phase render
   (the 10s post-commit flipbook) also byte-identical.

### Non-goals

- No per-tick liveness. The statusline stays a dumb frame-cycler (the
  architecture invariant): the standoff is a baked flipbook indexed by
  `$now % len`, written once per *sighting event*, not per tick.
- No new config surface. Gating rides the existing `gameFeel` knob
  (`full` = scene, `subtle` = resolve-toast only as today, `off` = nothing).
- No HP/damage model. The standoff is theater; win odds still resolve in one
  seeded roll at commit.
- No dismissal-by-fixing. See G2.

---

## 3. Data model

### 3.1 `pending-encounter.json` (new transient side-channel)

A **separate file** from `encounter.json`, so the resolved phase's TTL
contract, `readEncounter` semantics, and every existing test stay untouched.
Same dir, same atomic tmp+rename write idiom, cleaned up by the same
`TRANSIENT_PREFIXES` mechanism (add the prefix in state.ts).

```ts
export interface PendingEncounter {
  bugId: BugId;          // pinned enemy identity (G4)
  tier: BugTier;         // tier at last (re)bake — the escalation watermark
  frames: string[];      // baked standoff flipbook (2 poses)
  sequence: number[];    // e.g. [0, 0, 0, 1] — mostly ready, occasional glare
  sightedAt: number;     // Date.now() of first sighting (display/debug)
  startedAt: number;     // session snapshot startedAt that spawned it —
                         // staleness guard (see §5.3)
}
```

### 3.2 `status.json` additions

`writeStatusState` surfaces the pending scene through the **same** fields the
resolved scene uses (`combatFrames`, `combatSequence`, `artWidth`) plus one new
bit:

- `combatSticky?: 1` — present only on the pending phase. Tells the shell to
  skip the 10s `$enc_fresh` TTL for the frame-source decision.

Resolved always outranks pending (§5.2), so the two phases never mix fields.

---

## 4. Lifecycle

```
error-ish reaction (react.sh)           git commit (react.sh)
        │                                       │
        ▼                                       ▼
award-xp.ts bug_sighted              award-xp.ts session_complete
        │                                       │
        ▼                                       ▼
session.sightBug()                   awardSessionComplete → maybeFightBug
  count = combatErrorCount(delta)      bug = pending?.bug (tier-upgraded    ── G4
  tier  = tierForErrors(count)               if count says so) ?? spawnBug
  spawn/escalate + bakePendingScene    resolveCombat → writeEncounter (10s)
  writePendingEncounter                clearPendingEncounter()  ALWAYS      ── G5
  writeStatusState (sticky scene)      status write: resolved scene + toast
        │                                       │
        ▼                                       ▼
   [standoff renders,                  [strike/win/flee plays for 10s,
    persists across idles]              then idle resumes]

session_start ──────────────────────► clearPendingEncounter()              ── G5
```

### 4.1 Sighting (`sightBug`, session.ts)

New I/O entry point, called by `award-xp.ts bug_sighted`:

1. Gate: `gameFeelLevel() !== "full"` → no-op. (Pending's *only* surface
   is the scene, which is full-only. `subtle` keeps today's toast-at-resolve;
   `off` keeps nothing.) **Configured level, NOT `effectiveGameFeel()`** —
   the original clamped gate was a bug: a sighting fires on the very
   error-family events whose fresh reaction trips the auto-quiet spike clamp
   (FR-E1), and `reactionTTL` defaults to 0 (never expires), so the clamped
   read was "subtle" by construction and *every* spawn was suppressed. The
   standoff exists *because* of errors; it is exempt from auto-quiet.
2. `count = combatErrorCount(counterDelta(current, snapshot.baseline))`,
   floored at 1 — a sighting event just fired, so even a missing/older
   snapshot (`loadSnapshot() === null`) counts the event that summoned us.
3. `tier = tierForErrors(count)`.
4. Decision (pure helper, unit-testable — `pendingAction(tier, existing)`):
   - no pending file → **spawn**;
   - pending exists, `tier > pending.tier` → **escalate** (new bug at the
     higher tier);
   - otherwise → **no-op** (no re-bake, no status write — keeps event cost
     zero for repeated same-tier errors).
5. On spawn/escalate: `spawnBug(count, seed)` with
   `seed = hashString(\`${userId}:${startedAt}:${tier}\`)` — seeded per
   *(session, tier)* so a re-sighting at the same tier would re-derive the
   same bug (idempotent), while each escalation rolls a fresh same-tier pick.
6. `bakePendingScene(...)` (§4.2), `writePendingEncounter(...)`, then
   `writeStatusState` so the scene lands immediately.
7. Requires a companion (`loadCompanionSlot`/`loadCompanion`); none → no-op,
   same as `maybeFightBug`.

### 4.2 The standoff bake (`bakePendingScene`, combat.ts)

Shares every internal with `bakeScene` (`rectFrame`, `mirrorFrame`,
`alignHeights`, `getArtFrame`, `eyeRowIndex`) — only the pose list differs:

- **Pose 0 — ready:** resting eyes both sides (identical to `scenePoses[0]`).
- **Pose 1 — glare:** fight eyes both sides (`scenePoses[1]` minus strike).
- No strike pose, no resolve pose, no clash glyph — the gap column stays
  blank, so no weapon plumbing is needed at sighting time.
- `sequence: [0, 0, 0, 1]` — a calm loop with a periodic glare. Cheap to tune
  later; it's data.

Same invariants as `bakeScene`: constant display width across frames (body
fixed to art frame 0), bottom-aligned heights, pure and deterministic.

### 4.3 Resolution (`maybeFightBug`, session.ts — small diff)

- Read the pending file (no TTL). If present and its `startedAt` matches the
  current snapshot (§5.3):
  - `bug = BUGS[pending.bugId]`, **tier-upgraded** via the same
    `pendingAction` rule if the final `combatErrorCount` says the session
    outgrew the displayed tier (errors accrued during react.sh's 30s cooldown
    can outrun sightings).
- Else (no pending / stale / feature raced): fall back to today's
  `spawnBug(count, seed)` — behavior identical to the current code.
- Resolve, drop, `writeEncounter` exactly as today.
- **`clearPendingEncounter()` unconditionally** — even when `count === 0`
  and no fight spawns (G5). This is what makes "commit dismisses the nudge"
  a hard invariant rather than a happy-path effect.

### 4.4 Restart (`startSession`, session.ts — one line)

`clearPendingEncounter()` before saving the fresh snapshot. Rationale:
`session_start` re-baselines the counters, so a surviving pending fight would
resolve against a zero delta — a ghost. Chosen over "nag across restarts"
(user-approved): the standoff models *this session's* errors, and the
baseline model agrees.

---

## 5. Render integration

### 5.1 `writeStatusState` (state.ts)

Inside the existing `gate !== "off"` combat block, after the resolved-encounter
read:

```
resolved fresh (readEncounter ≠ null, frames present)
    → combatFrames/… as today                      (no sticky bit)
else if cfg.gameFeel === "full" and pending exists and pending.startedAt matches
    → combatFrames/combatSequence from pending, artWidth computed the same
      way, combatSticky: 1
else → no combat fields                            (byte-identical idle)
```

The pending branch reads the **configured** `cfg.gameFeel`, not the clamped
`gate` — same auto-quiet exemption as §4.1: while the error reaction is fresh
the spike clamp holds `gate` at "subtle", so a clamped gate would strip the
standoff `sightBug` just landed on the very next status write.

Same lazy `require("./combat.ts")` + try/catch (version-skew tolerant); the
pending read is one more `readFileSync` at event frequency, not per tick.

### 5.2 `buddy-status.sh` (one field + two small gates)

- Append `.combatSticky // 0` to the single jq pass (one more `\x1f` field —
  the P1-perf single-read invariant holds).
- Frame source: `$combat_on = ((enc_fresh == 1) or (sticky == 1)) and
  combatFrames present`. Priority stays combat > flourish > idle. Since
  `writeStatusState` never emits sticky alongside a fresh resolved scene,
  resolved-vs-pending needs no shell-side arbitration.
- **Wander freeze (D3):** zero the wander offsets when `$combat_on == 1`
  (today they're only zeroed by `celeb_fresh`). A standoff that ambles around
  undercuts the tension, and pinning it maximizes the roam-math headroom for
  the wide scene during a now-potentially-hours-long render. Idle wander
  unchanged.
- **Bubble suppression, resolved phase only (D4):** while
  `enc_fresh == 1 && combat_on == 1`, skip the *sticky reaction* bubble
  (`.reaction` re-display) but keep the celebration toast — the fight summary
  IS a celebration, and this is the existing "stop the chat bubble during a
  fight" follow-up, folded in. During the **pending** phase the bubble
  behaves normally: muting all reactions for an errors-to-commit window that
  can last hours would silence the buddy's whole personality.

### 5.3 Staleness guard

`pending.startedAt` must equal the live snapshot's `startedAt` for both the
status write (§5.1) and resolution (§4.3). Belt-and-suspenders on top of the
G5 clears: a pending file orphaned by a crash between `session_start`'s clear
and its snapshot save can never render or fight.

**Cross-pane note:** the pending file is global while session snapshots are
per-`$SID` (tmux panes). A commit in any pane clears the standoff for all —
same coarseness as the shared statusline itself. Accepted; the `startedAt`
guard uses the *default* pane semantics already used by `maybeFightBug`.

---

## 6. Resolved design decisions

| # | Question | Decision (user-approved 2026-07-08) |
|---|---|---|
| D1 | Escalation | Pin bug identity at first sighting; upgrade tier (new same-seeded roll at the higher tier) as `combatErrorCount` crosses cutoffs. Resolution fights the pinned bug. |
| D2 | Persistence across restarts | Commit clears unconditionally; `session_start` clears too. No cross-restart nag. |
| D3 | Wander | Frozen while any combat scene renders (pending or resolved). |
| D4 | Bubble | Suppressed only during the 10s resolved scene (folds in the pre-existing open item); normal during pending. |
| D5 | `subtle` mode | No pending surface at all — sighting no-ops below `full`. |
| D6 | Fix-without-commit | Does NOT dismiss the standoff (nudge semantics). Documented user-facing. |

---

## 7. Implementation phases

Each phase is a working-tree checkpoint with the suite green, matching the
derive-upgrades playbook. Order chosen so the render can't go live before the
clears exist (a rendered standoff with no dismissal path would be a regression
worse than the status quo).

1. **P1 — Bake + I/O (inert).** `bakePendingScene`, `PendingEncounter`,
   `writePendingEncounter`/`readPendingEncounter`/`clearPendingEncounter` in
   combat.ts; `TRANSIENT_PREFIXES` entry. Nothing calls them.
2. **P2 — Lifecycle (still invisible).** `sightBug` + pure `pendingAction`
   in session.ts; `bug_sighted` verb in award-xp.ts (new `ENCOUNTER_EVENTS`
   set — no XP attached); react.sh fires it on the five error-ish reasons
   (same backgrounded-bun idiom as `errors_spotted`); `maybeFightBug` pinning
   + unconditional clear; `startSession` clear. Pending files now live full
   lifecycles but never render.
3. **P3 — Render.** `writeStatusState` pending branch + `combatSticky`;
   buddy-status.sh sticky bit, wander freeze, resolved-phase bubble
   suppression. The feature is live at the end of this phase.
4. **P4 — Docs + validation.** README ("Bug fights" section), testing-guide
   §3 pending harness, CURRENT-STATE snapshot, full suite + `tsc` +
   `bash -n` + the e2e smoke below.

Estimated total ~350–550 LOC including tests; one session.

---

## 8. Testing

- **combat.test.ts:** `bakePendingScene` determinism, constant frame width,
  exactly 2 poses / no strike row, sequence shape; pending I/O round-trip +
  clear; `readPendingEncounter` on malformed file → null.
- **session.test.ts:** `pendingAction` pure matrix (none→spawn, same-tier→
  no-op, higher-tier→escalate, lower-count-never-downgrades); seed stability
  per (session, tier).
- **statusline_render.test.ts:** sticky scene renders with **no**
  `encounterAt` (TTL bypass proves out); resolved outranks pending; wander
  offsets zeroed while `$combat_on`; reaction bubble suppressed only when
  `enc_fresh && combat_on`; layout invariant (exactly the art lines change,
  strict no-clip via `BUDDY_FAKE_COLS`); idle path byte-identical when no
  pending file exists.
- **Fresh-process smokes** (temp `CLAUDE_CONFIG_DIR`, established §3 harness):
  1. error event → pending file + standoff renders;
  2. second error crossing a tier cutoff → enemy upgrades;
  3. `session_complete` → resolved scene plays, pending file gone;
  4. zero-error commit with an orphaned pending file → file cleared, no
     fight;
  5. `session_start` → pending cleared.

---

## 9. Risks

- **R1 — Long-lived wide render.** The scene render used to live 10s; now it
  can live hours, so any width/clamp bug becomes chronic instead of blink-and
  -miss. Mitigation: the strict no-clip test at hostile `BUDDY_FAKE_COLS`
  widths, plus the existing bubble-drop degradation path (sprite visibility
  wins) already covers SPAN<0.
- **R2 — react.sh 30s cooldown lag.** Errors landing inside a reaction
  cooldown window don't classify, so the first sighting can lag the first
  error. Accepted: resolution's fallback spawn (§4.3) guarantees the fight
  itself never under-counts; only the nudge is delayed.
- **R3 — One more bun process per error-ish event.** Already the accepted
  pattern (`errors_spotted`, `shift-mood`); `bug_sighted` no-ops fast below
  `full` and on same-tier repeats.
- **R4 — Version skew** (old server, new shell or vice versa). Sticky bit
  absent → shell falls back to TTL semantics (today's behavior); pending file
  unknown to an old server → ignored, cleared by the first new-code commit.

---

## 10. Doc map

- This design: `docs/game-feel/idle-rpg/design-pending-encounter.md`
- Prerequisite fix: CURRENT-STATE.md §"Combat spawn signal broadened" (2026-07-08)
- Resolved-phase design: [phase-5-combat-scene](phase-5-combat-scene.md)
- Trigger/counters: [design](design.md) §Phase 3, testing-guide §3
