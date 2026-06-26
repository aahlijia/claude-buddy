# Design — Idle RPG · Phase 3: Bugs as Enemies + Baked Combat

> ✅ **Implemented & tested** (see [`status.md`](status.md)). This is the
> as-designed spec; the build matched it. Files: `server/bugs.ts`,
> `server/combat.ts`, `maybeFightBug` in `session.ts`. The fight *renders* in
> Phase 4 — Phase 3 bakes/persists it and surfaces a toast. **No bash here.**

Status: Component design (output of `/sc:design phase 3`). Detailed spec for the
**third** phase of [[design]]: bugs **spawn as enemies** from the session's
error count, the buddy **auto-fights** them in a **server-baked animation**, and
victories **drop** skill points and the occasional item. This phase produces and
persists the fight — the **status-line rendering of it is Phase 4**. No
production code here; signatures are interface sketches, build with
`/sc:implement`.

Grounded against actual source as of `develop` (post-Phase-2):
`server/session.ts` (`awardSessionComplete:243` — the once-per-commit accrual
point; `counterDelta`, `delta.errors_seen`, `elapsedSec`, `rollLoot` already
wired), `server/engine.ts` (`mulberry32`, `hashString`, `BuddyBones`,
`renderFace`), `server/loot.ts` (`rollLoot`, `LOOT_BONUS_POINTS`),
`server/xp.ts` (`grantBonusPoints:872`, `grantItem`, `availablePoints`),
`server/items.ts` (`ITEMS`, `Rarity`, `RARITY_WEIGHTS`),
`server/state.ts` (`writeStatusState`, the loot `lastDrop` side-channel,
`flourishFrames?` baked-playback, `Celebration`), `server/equipment.ts`
(`resolveAppearance` — weapon/stat effects feed the win odds).

**Locked decisions** (from [[design]]): **auto-idle** (server bakes once, zero
per-tick cost); **reuse skill points**; **statusline is a dumb cycler**.

---

## 1. Scope & non-goals

**In scope (Phase 3):**
- `server/bugs.ts` — enemy catalog + spawn from the `errors_seen` delta.
- `server/combat.ts` — pure, deterministic `resolveCombat` → outcome + **baked
  frames** + a drop spec. Seeded; no clock in the core.
- Drops: skill points (`grantBonusPoints`) + occasional item (`grantItem`),
  rarity-weighted, reusing the loot vocabulary.
- A transient **encounter side-channel** (`encounter.json`, mirroring loot's
  `lastDrop`) that carries the baked fight + a TTL, plus an immediate
  `Celebration` so the defeat is observable now.
- Hook into `awardSessionComplete` — once per commit, **zero per-event cost**.

**Explicit non-goals:**
- **Rendering the fight on the status line** (`buddy-status.sh` encounter branch,
  the new `enemyGlyph` placement) → **Phase 4**.
- Wiring the game-feel **opt-out gate** for encounters → Phase 4 (still owed from
  [[stat-leveling]]).
- Interactive / multi-turn combat — explicitly out (auto-idle only).
- Bosses, status effects, consumables — future, not this phase.

---

## 2. What already exists (reuse, don't reinvent)

- **The accrual point is done.** `awardSessionComplete` (`session.ts:243`)
  already computes `delta` (incl. `delta.errors_seen`), `elapsedSec`, the active
  `slot`/companion, and calls `rollLoot`. Combat is **one more block** there,
  reusing the delta already in hand — the exact discipline of [[stat-leveling]].
- **Deterministic RNG exists.** `mulberry32(hashString(seed))` (`engine.ts`) is
  the project's seeded PRNG. Combat seeds from it → reproducible, unit-testable,
  no `Date.now()` in the core.
- **The baked-playback mechanism exists.** `flourishFrames?`/`flourishSequence?`
  (`state.ts`) already are "play this baked cycle while fresh, then fall back."
  The fight is a sibling producer; Phase 4's render branch mirrors the flourish
  branch.
- **The transient side-channel pattern exists.** Loot's `lastDrop` (a small file
  `writeStatusState` reads and surfaces while fresh) is the robust way to carry a
  one-shot event across unrelated status writes. The encounter reuses this
  pattern verbatim — survives intervening writes for its TTL.
- **Drops are done.** `grantBonusPoints(n)` (`xp.ts:872`) credits the shared
  wallet; `grantItem(id)` (Phase 1) appends to inventory. No new economy.
- **Gear already affects outcomes.** `resolveAppearance(...).stats` (Phase 1)
  folds a weapon's `stat:+N` into the effective DEBUGGING the win formula reads —
  so equipping the Foam Sword *matters*, without new plumbing.
- **Animation primitives exist.** Emotion frames (`art.ts`, eye substitution +
  micro-cycle) supply the "swing" pose; we draw almost no net-new ASCII.

---

## 3. Design principles (trace to the NFRs)

- **Once per commit, zero per-event cost (perf).** Spawn + resolve + bake + drop
  all run inside `awardSessionComplete`, reusing `delta`. Baking a handful of
  frame strings is negligible; nothing touches the per-tick path.
- **Server bakes, bash cycles (NFR2).** `resolveCombat` emits `frames[]` +
  `sequence[]`. The status line (Phase 4) only indexes `NOW % len`. No HP math,
  no enemy AI, no loop in the shell — ever.
- **Deterministic & testable.** `resolveCombat(bones, bug, equipment, seed)` is
  pure: same inputs → same outcome + frames. The I/O wrapper supplies the seed;
  tests pass it explicitly.
- **Buddies never die.** Worst case is `flee` (smaller/no drop). No HP bar for
  the buddy, no损 state, no failure the user must recover from. The loop only
  ever adds.
- **No power creep.** Gear shifts win odds by a few percent (the `stat:+1..+2`
  ceiling); drops are skill points + cosmetic gear, never raw stat injections.
  Combat is *flavor and pacing*, not a power economy.
- **Resolve in state, defer the render (gate).** Spawns resolve and drops land
  regardless of `gameFeel`. Only the **animation** is gated — and that gating
  lives in Phase 4's render branch + `writeStatusState`. Phase 3 always writes
  the encounter side-channel (cheap); Phase 4 decides whether to show it.
- **Additive, transient state.** The only new persisted artifact is a small,
  TTL'd `encounter.json` side-channel (like `lastDrop`). Durable outcomes
  (points, items) flow into existing fields. No schema growth on `XpState`.

---

## 4. Enemy model (`server/bugs.ts`, pure)

```ts
export interface Bug {
  id: string;
  name: string;
  glyph: string;        // 1 status-line cell (width-checked, like item icons)
  tier: 1 | 2 | 3 | 4;  // severity → toughness
  reward: number;       // base skill-point bounty on defeat
}

/** Severity-ranked catalog (tuning is OQ-P3.3). */
export const BUGS: readonly Bug[]; // e.g.
//  t1 typo-gremlin 🐛 reward 1
//  t2 null-wraith  👾 reward 2
//  t3 race-condition 🕷 reward 3
//  t4 segfault-dragon 🐉 reward 4

/**
 * Pick the bug a session spawns from its error count, or null when the session
 * saw no errors (no spawn). Tier scales with severity: more / repeated errors →
 * a tougher bug. Pure & deterministic given (errorsSeen, seed).
 */
export function spawnBug(errorsSeen: number, seed: number): Bug | null;
```

Mapping (tunable): `errorsSeen === 0 → null`; `1–2 → t1`; `3–5 → t2`; `6–9 → t3`;
`10+ → t4`. A little seeded jitter picks among same-tier bugs for variety.

---

## 5. Combat resolution (`server/combat.ts`, pure)

```ts
export type Outcome = "win" | "flee";

export interface DropSpec {
  points: number;        // skill points to grant on win (0 on flee)
  itemId?: ItemId;       // optional item drop (win only)
}

export interface CombatResult {
  outcome: Outcome;
  frames: string[];      // the baked fight flipbook
  sequence: number[];    // playback indices, NOW % len (Phase 4 cycles these)
  enemyGlyph: string;    // the bug's glyph, placed in the margin (Phase 4)
  drop: DropSpec;
  summary: string;       // one-line celebration text, e.g. "🗡 squashed a null-wraith! +2 pt"
}

/**
 * Resolve a single encounter deterministically. Pure — no I/O, no clock.
 *   P(win) = clamp(BASE + effDebug/200 + weaponBonus − (tier−1)·TIER_STEP, .05, .98)
 * where effDebug is resolveAppearance(bones, equipment).stats.DEBUGGING (so gear
 * matters) and weaponBonus comes from the equipped weapon's stat effect.
 */
export function resolveCombat(
  bones: BuddyBones,
  bug: Bug,
  equipment: Equipment,
  seed: number,
): CombatResult;
```

**Baked frames (§FR-C2 of [[design]]).** A short cycle reusing existing art:
approach → swing (emotion "angry"/"surprised" eye pose) → enemy hit-flash →
defeat poof (or, on flee, a retreat pose). The enemy `glyph` rides in the
reclaimed wander margin beside the buddy — **inside its own lane** (Phase 4
enforces the layout invariant). `sequence` is a gentle oscillation like
`EMOTION_FRAME_SEQUENCE`.

**Win formula constants** live in a tunable block (`BASE`, `TIER_STEP`, weapon
coefficient) — balance is OQ-P3.4.

---

## 6. Drops (reuse the economy)

On `win`, the I/O wrapper applies `DropSpec`:
- **Points:** `grantBonusPoints(drop.points)` — credits the shared wallet
  (`bonusPoints`), exactly like loot. `drop.points = bug.reward` (+ seeded jitter).
- **Item:** with chance `~0.10·tier`, roll a **rarity-weighted** item from `ITEMS`
  (reusing `RARITY_WEIGHTS`), skipping ones already owned, and `grantItem(id)`.
  `grantItem` already no-ops on dupes/equipped, so the skip is belt-and-braces.

On `flee`, `drop = { points: 0 }` — no reward, no penalty. The loop never
subtracts.

---

## 7. Write path — the encounter side-channel

The fight is **transient**, so it rides a small side file, not `XpState`:

```ts
// encounter.json (in buddyStateDir), mirroring loot's lastDrop:
interface EncounterRecord {
  frames: string[];
  sequence: number[];
  enemyGlyph: string;
  at: number;            // Date.now() — TTL freshness, like lastDrop.at
}
```

- **`combat.ts` I/O wrapper** writes `encounter.json` and returns the result.
- **`writeStatusState`** (Phase 4 edit) reads `encounter.json`; while fresh **and**
  `gameFeel === full`, it spreads the baked frames into the new optional
  `StatusState.encounterFrames?`/`encounterSequence?`/`enemyGlyph?` fields. The
  shell's new branch (Phase 4) cycles them, then falls back to flourish → idle.
- **Observable now (Phase 3):** the same wrapper also surfaces `result.summary`
  through the existing `Celebration{kind:"loot"}` channel via the
  `awardSessionComplete` write, so the defeat is visible (a bubble toast) the
  moment combat lands — before the Phase 4 render branch exists.

This decouples "a fight happened" from "a status write occurred," surviving
intervening writes for the TTL window — the loot pattern, proven.

---

## 8. Integration into `awardSessionComplete`

One block, after the existing stat accrual, reusing `delta`/`slot`/`rarity`:

```ts
// Idle-RPG combat (Phase 3): a session's errors spawn a bug the buddy fights.
// Once per commit, reusing the delta already computed — zero per-event cost.
const seed = hashString(`${resolveUserId()}:${snapshot?.startedAt ?? 0}:${delta.errors_seen}`);
const bug = spawnBug(delta.errors_seen, seed);
if (bug) {
  const companion = slot ? loadCompanionSlot(slot) : loadCompanion();
  if (companion) {
    const { equipment } = getXpState();
    const result = resolveCombat(companion.bones, bug, equipment, seed);
    applyCombatDrops(result.drop, slot);        // grantBonusPoints + maybe grantItem
    writeEncounter(result);                      // encounter.json side-channel
    // surface the toast now; Phase 4 adds the animation
    writeStatusState(companion, {
      celebration: { text: result.summary, kind: "loot", at: Date.now() },
      cause: "loot",
    });
  }
}
```

Seed note: there's no git SHA in scope here, so the per-commit seed is
`userId : session.startedAt : errorsSeen` — deterministic for a given commit,
varied across commits. Tests pass an explicit seed to `resolveCombat`/`spawnBug`.

---

## 9. Files changed

| File | Change | New/Edit |
| --- | --- | --- |
| `server/bugs.ts` | `Bug`, `BUGS` catalog, `spawnBug` | **new** |
| `server/combat.ts` | `resolveCombat`, frame baker, `DropSpec`, write/drop I/O wrappers | **new** |
| `server/bugs.test.ts` | catalog integrity, tier mapping, no-spawn at 0 | **new** |
| `server/combat.test.ts` | seeded determinism, win-odds monotonicity, gear effect, frames non-empty, flee path, drop spec | **new** |
| `server/session.ts` | the §8 combat block in `awardSessionComplete` | edit |
| `server/session.test.ts` | combat fires on error delta; no-op at 0; drops applied | edit |
| `server/state.ts` | `EncounterRecord` read + optional `StatusState.encounter*` fields **(deferred to Phase 4 render; Phase 3 may land the type only)** | edit (light) |

No `statusline/*.sh` changes in Phase 3.

---

## 10. Data flow (commit → fight → drop)

```
git commit ─► awardSessionComplete(delta, slot, rarity)
                 │  delta.errors_seen
                 ▼
            spawnBug(errorsSeen, seed) ──► null? ─► done (no fight)
                 │ Bug
                 ▼
   resolveCombat(bones, bug, equipment, seed)        [pure, seeded]
        │  win odds = f(effective DEBUGGING + weapon, tier)
        ├─► drop: grantBonusPoints(+pts) [+ grantItem]   (durable)
        ├─► writeEncounter(frames,seq,glyph,at)          (encounter.json, transient)
        └─► writeStatusState(celebration "squashed …")   (toast now)
                 │
                 ▼  (Phase 4)
   writeStatusState reads encounter.json while fresh && gameFeel=full
        → StatusState.encounterFrames → buddy-status.sh cycles them
```

`bones` is read-only; only `bonusPoints`/`inventory` (durable) and
`encounter.json` (transient) are written.

---

## 11. Test plan (colocated, `bun test`)

- **`bugs.ts`** — catalog ids unique, glyphs width-OK, tiers in 1..4;
  `spawnBug(0,*) === null`; tier mapping across error counts; same seed →
  same pick.
- **`combat.ts`** — same `(bones,bug,equipment,seed)` → identical result
  (determinism); P(win) rises with DEBUGGING and falls with tier (sample many
  seeds, assert monotonic frequency); equipping a stat weapon raises win rate;
  `frames`/`sequence` non-empty and index-safe; `flee` yields `points:0`;
  `win` drop points == reward (+jitter bounds).
- **`session.ts`** — a positive `errors_seen` delta triggers a fight and a
  points grant; zero delta → no fight, no encounter file; the drop lands in
  `availablePoints`.
- **Side-channel** — `writeEncounter` then read yields the same frames; a stale
  record (old `at`) is ignored by the freshness check.
- Gate: `tsc --noEmit` clean, full `bun test` green, fresh-process smoke of a
  commit-with-errors producing a toast + a points bump.

---

## 12. Open questions

- **OQ-P3.1 — Encounter render timing.** Phase 3 makes the fight *observable* via
  a toast; the animation is Phase 4. Confirm we don't want a minimal render in
  Phase 3 (recommend keeping the split — Phase 4 owns all bash).
- **OQ-P3.2 — Seed source.** `userId:startedAt:errorsSeen` (no git SHA in scope).
  Good enough for per-commit variety; revisit if a SHA becomes available.
- **OQ-P3.3 — Bug catalog / tier thresholds.** Names, glyphs, and error→tier
  cutoffs are flavor/balance — tunable block, defer.
- **OQ-P3.4 — Win-curve constants.** `BASE`, `TIER_STEP`, weapon coefficient —
  balance, defer with a tunable block. Target feel: a geared mid-level buddy wins
  most t1–t2 fights, sweats t3, rarely beats t4.
- **OQ-P3.5 — Item-drop rate.** `~0.10·tier` is a guess; watch inventory flood
  once drops compound (ties to the Phase-1 inventory-cap OQ).
- **OQ-P3.6 — Multiple errors, one bug.** One spawn per commit (design §3 FR-B3).
  Confirm we don't want a small "horde" for big error spikes (recommend single +
  higher tier — simpler, no queue state).
