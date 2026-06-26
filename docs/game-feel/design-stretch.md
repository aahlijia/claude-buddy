# Design — Game-Feel Stretch Items (FR-E1 auto-quiet · FR-A3 frame flourish)

Status: Design (output of `/sc:design`). Implements the two items
[`design.md`](./design.md) and the `game-feel` memory flag as **deferred /
optional**, not as unfinished base requirements. No production code here —
type/signature sketches are interface design only; build with `/sc:implement`.

Grounded against actual source as of `feature/game-feel` (commit `0930986`):
`server/{state,art,reactions,index}.ts`, `hooks/react.sh`,
`statusline/buddy-status.sh`. Both items were explicitly carved out of the first
cut: E1 auto-quiet as "out of scope for the first cut" (design §2.5), A3 frame
flourish as "optional … bubble text alone satisfies the FR" (design §FR-A3).

---

## 0. What already shipped (don't rebuild)

- **FR-E1 base** — the `off | subtle | full` gate: `BuddyConfig.gameFeel`,
  `gameFeelLevel()` (`state.ts:449`), `buddy_gamefeel` tool + `/buddy gamefeel`,
  doctor line. The clamp below is the *missing balancing loop* §2.5 named.
- **FR-A3 base** — the ascension **bubble**: `index.ts:1006-1021` writes
  `celebration{kind:"ascension", text:"🌟 PRESTIGE N 🌟"}`. The flourish below is
  the optional **animation** layer on top of that same one-shot.
- **FR-A4 mechanism (reused by both)** — `getStatusFrames(bones, emotion,
  seasonalHat)` (`art.ts:265`) derives frames by eye-substitution + a micro-cycle
  (`EMOTION_EYE`, `EMOTION_FRAME_SEQUENCE`); neutral stays byte-identical.

---

## 1. Design principles (trace to the existing NFRs)

- **No new persisted state for the spike path (NFR3/NFR4).** Auto-quiet reads
  signals that already exist (`loadReaction()`'s self-expiring reason). The
  flourish rides the celebration timestamp already in `status.json`. Nothing new
  to backfill or corrupt.
- **One clamp, read everywhere delight is decided (NFR0).** Mirror the existing
  gate discipline: a single pure resolver `effectiveGameFeel()` wraps
  `gameFeelLevel()`; every *delight* read point switches to it. The raw
  `gameFeelLevel()` survives only for **reporting** the configured value
  (`buddy_gamefeel`, doctor) — auto-quiet is transient and must never be
  persisted as the user's choice.
- **Clamp down by one notch, never silence the core (NFR0/NFR1).** Auto-quiet is
  `full → subtle` only. It never touches `off` (already silent) and never pushes
  `subtle → off` (that would hide level-ups — a regression, not restraint).
  `subtle` already suppresses the chatty producers (D2/E3), so one notch is the
  whole job.
- **Restraint on animation (NFR0/NFR6).** The flourish is **opt-in per write**
  (ascension + shiny only), not auto-applied to every loot toast. Subordinate,
  brief, gate-respecting; it borrows the celebration's own TTL so it self-reverts.
- **Pure core + thin IO wrapper + tests (NFR5).** Both features land as exported
  pure functions (`autoQuietActive`, `effectiveGameFeel`'s core, `flourishFrames`)
  unit-tested without I/O, exactly like `buildCelebration`/`resolveEmotion`.
- **Degrade to today (NFR3/NFR7).** No spike ⇒ `effectiveGameFeel == gameFeel`,
  byte-identical behavior. No flourish opt-in (or `flourishFrames` absent) ⇒ bash
  animates today's `frames`. Older `status.json` and a stale config both render.

---

## 2. FR-E1 — Auto-quiet (transient intensity clamp)

> The control NFR0 demanded and §2.5 deferred: "treat a recent error spike … as
> a temporary `subtle` clamp." This is the system's missing **balancing loop** —
> game-feel turns itself down exactly when the work needs the glance most.

### 2.1 Signals (cheapest first)

| Signal | Source (existing) | New state? | Confidence |
|---|---|---|---|
| **Error spike** (ship this) | `loadReaction()?.reason ∈ {error, test-fail, build-fail, type-error, lint-fail}` — already self-expires past `reactionTTL` | **none** | high — it *is* a fresh error moment |
| Spike *intensity* (refinement) | rolling count of error-family events in the last *N* min | small new file/field | medium |
| Deep focus (defer) | long `SESSION_ELAPSED` (react.sh already computes it) with no recent error + no recent celebration | none, but heuristic | low — speculative; false-quiets easily |

**Recommendation:** ship the **error-spike clamp** (zero new state, high signal).
Deep-focus has no reliable zero-cost signal and the failure mode (over-quieting
during good flow) is exactly what NFR0 says to avoid only when *certain* — design
it (§2.4) but gate it behind a config opt-in and ship it second.

### 2.2 The resolver (pure core + IO wrapper)

```ts
// state.ts — next to gameFeelLevel()
const SPIKE_REASONS = new Set([
  "error", "test-fail", "build-fail", "type-error", "lint-fail",
]);

/** Pure: does the active reaction indicate a fresh error spike? `reason` is the
 *  already-TTL-filtered loadReaction() reason (null/undefined ⇒ no spike). */
export function autoQuietActive(reason: string | null | undefined): boolean {
  return !!reason && SPIKE_REASONS.has(reason);
}

/** Pure: clamp the configured gate by one notch when auto-quiet is active.
 *  full→subtle; subtle/off unchanged. Exported for unit tests. */
export function clampGameFeel(configured: GameFeel, quiet: boolean): GameFeel {
  return quiet && configured === "full" ? "subtle" : configured;
}

/** The gate every *delight* producer should read (vs gameFeelLevel(), which now
 *  reports only the configured value). Guarded — never throws. */
export function effectiveGameFeel(): GameFeel {
  let configured: GameFeel = "subtle";
  try { configured = loadConfig().gameFeel; } catch { /* first install */ }
  let quiet = false;
  try { quiet = autoQuietActive(loadReaction()?.reason); } catch { /* optional */ }
  return clampGameFeel(configured, quiet);
}
```

### 2.3 Where the clamp is read (swap `gameFeel` → `effectiveGameFeel`)

| Site | Today | Change |
|---|---|---|
| `state.ts` `writeStatusState` (line ~606) | `gate = loadConfig().gameFeel` | `gate = effectiveGameFeel()` — feeds `buildCelebration` + `resolveEmotion`. (Emotion is unaffected by a one-notch clamp; only celebration/chatter changes.) |
| `index.ts:256` memory callbacks (E3) | `gameFeelLevel() === "full"` | `effectiveGameFeel() === "full"` — E3 chatter goes silent during a spike (the whole point) |
| `buddy_gamefeel` tool / `doctor` | report `gameFeel` | **keep `gameFeelLevel()`** — report configured value, plus a derived "auto-quieted now?" line (§2.5) |

**Bash side — no change needed.** The only `full`-gated bash producer is the D2
rare-idle bubble in `react.sh`, which fires **exclusively on idle ticks** (no
`$REASON`). An error spike sets `$REASON=error`, which structurally preempts the
idle branch — so the spike and the only thing auto-quiet would suppress in bash
are mutually exclusive. The celebration-TTL difference (6s vs 10s) is cosmetic;
if desired later, the server can stamp the effective TTL into `status.json`
(see §4 optional), but it is **not** required for correctness.

### 2.4 Deep-focus path (designed, ship second, opt-in)

```ts
// optional second signal — config-gated so it can't false-quiet by default
interface BuddyConfig { /* … */ autoQuietFocus?: boolean; } // default false
```

Heuristic (all from existing data, no new persistence): treat as deep focus when
`SESSION_ELAPSED > FOCUS_MIN` (e.g. 25 min) **and** no error-family reason is/has
been fresh **and** no celebration fired in the last *M* min. Because this is
fuzzy, it: (a) is **off by default** (`autoQuietFocus:false`); (b) only clamps
`full→subtle`, same as the spike; (c) is reported by doctor so a confused user
can see *why* it went quiet. Recommend shipping only after the spike clamp has
soaked.

### 2.5 Surface / supportability

- `buddy_gamefeel` (no-arg) and `/buddy doctor` add one derived line:
  `Game-feel: full (auto-quieted → subtle: error spike)` when clamped, else
  `Game-feel: full`. Implemented by comparing `gameFeelLevel()` vs
  `effectiveGameFeel()`. No new persisted field.

### 2.6 Acceptance (measurable)

- Configured `full` + a fresh error-family reaction ⇒ `effectiveGameFeel() ==
  "subtle"`; E3 memory callbacks emit **zero** output for that window; the
  configured value in `config.json` is **unchanged**.
- No fresh error reaction ⇒ `effectiveGameFeel() == gameFeel` (byte-identical to
  today across all three levels). `off`/`subtle` never change under any signal.
- Reaction expired (past `reactionTTL`) ⇒ no clamp (resolver relies on
  `loadReaction()`'s own TTL — no separate timer).
- Doctor/tool reports the clamp without persisting it.

---

## 3. FR-A3 — Ascension frame flourish (self-reverting, TTL-bounded)

> The optional animation atop the shipped ascension bubble. The hard constraint:
> **frames have no TTL** (they persist in `status.json` until the next
> `writeStatusState`), so a naive bake would "stick" past the moment. The design
> borrows the **celebration's** timestamp — which *is* TTL'd in bash — to bound
> the flourish without any extra server write.

### 3.1 Mechanism — dual frame sets, celebration-gated in bash

The server writes today's neutral `frames`/`frameSequence` **and** an optional
flourish set; bash animates the flourish **only while the celebration is fresh**,
then falls back to the neutral `frames` already present in the same file. Because
both arrays live in one `status.json` and bash already computes celebration age,
the flourish **self-reverts on a timer with no second server write**.

```ts
// art.ts — a livelier, all-species cycle reusing eye-substitution (FR-A4 kin)
const FLOURISH_EYES: readonly string[] = ["^", "O", "*", "^"]; // joy→pop→spark
const FLOURISH_FRAME_SEQUENCE: readonly number[] = [0, 1, 2, 3, 2, 1]; // quick bob

/** Pure: a short celebratory cycle for any species. No new per-species art. */
export function flourishFrames(bones: BuddyBones): {
  frames: string[];
  frameSequence: number[];
};
// frames = FLOURISH_EYES.map(eye => resolveFrame(0/1.., eye)); neutral frames are
// produced separately by getStatusFrames — flourish never replaces them in state.
```

```ts
// state.ts — StatusState gains two optional, backfilled fields
interface StatusState { /* … */
  flourishFrames?: string[];      // present only when a flourish was requested
  flourishSequence?: number[];
}
// StatusOpts gains an opt-in (default off — restraint, NFR6)
interface StatusOpts { /* … */ flourish?: boolean; }
```

`writeStatusState`: when `opts.flourish` **and** `effectiveGameFeel() !== "off"`,
also compute `flourishFrames(companion.bones)` and write the two fields; otherwise
omit them (older-reader / off ⇒ today's behavior). The neutral `frames` are
**always** written as today, so the fallback target always exists.

### 3.2 Producer

```ts
// index.ts ascend handler (1006-1021) — one added flag, same single write
writeStatusState(companion, {
  celebration: { text: `🌟 PRESTIGE ${res.state.prestigeLevel} 🌟`,
                 kind: "ascension", at: Date.now() },
  cause: "ascension",
  flourish: true,            // NEW — opt this one write into the animation
});
```

Generalizes cheaply: `shiny` hatch may pass `flourish:true` too (the two "big"
moments). Loot/level-up deliberately **don't** (NFR0/NFR6 — don't animate the
common case).

### 3.3 Render (bash)

```sh
# buddy-status.sh — hoist the celebration-fresh check ABOVE frame selection
#   (today it's computed at ~213, after frame pick at ~57). Compute _CELEB_AGE
#   once early; reuse it for both the flourish gate and the existing bubble gate.
# Frame source: if celebration fresh AND .flourishFrames present → animate those;
# else animate .frames (today's path, unchanged).
FRAME_SRC_FRAMES='.frames'; FRAME_SRC_SEQ='.frameSequence'
if [ "$_CELEB_FRESH" = 1 ] && [ "$_HAS_FLOURISH" = 1 ]; then
  FRAME_SRC_FRAMES='.flourishFrames'; FRAME_SRC_SEQ='.flourishSequence'
fi
FRAME_BODY=$(jq -r --argjson now "$NOW" \
  "${FRAME_SRC_SEQ}[\$now % (${FRAME_SRC_SEQ} | length)] as \$idx | ${FRAME_SRC_FRAMES}[\$idx] // \"\"" "$STATE")
# stale flourishFrames left in the file after the window are simply never selected.
```

The flourish window inherits the celebration TTL automatically (10s full / 6s
subtle), so it shrinks under `subtle` and vanishes under `off` (the server wrote
no flourish fields, and the bubble itself is suppressed) — no separate timer.

### 3.4 Acceptance

- On ascend, during the celebration window the buddy animates the flourish cycle;
  after `CELEB_TTL` it reverts to the neutral idle (the `frames` already in the
  same `status.json`) with **no further server write**.
- `gameFeel=off` ⇒ no `flourishFrames` written, no flourish shown (and the
  ascension bubble is already suppressed).
- `subtle` ⇒ flourish shows for the shorter (6s) window.
- A `status.json` without `flourishFrames` (older writer / non-flourish write)
  animates `frames` exactly as today (byte-identical neutral cycle).

---

## 4. File-by-file change map

| File | Item | Change |
|---|---|---|
| `server/state.ts` | E1 | `SPIKE_REASONS`; pure `autoQuietActive`, `clampGameFeel`; `effectiveGameFeel()` IO wrapper; `writeStatusState` uses `effectiveGameFeel()` for its `gate`; `StatusState.flourishFrames?/flourishSequence?` + `StatusOpts.flourish?`; bake flourish when `flourish && gate!=="off"` |
| `server/art.ts` | A3 | `FLOURISH_EYES`, `FLOURISH_FRAME_SEQUENCE`, pure `flourishFrames(bones)` (reuses the existing `resolveFrame` eye-substitution; neutral path untouched) |
| `server/index.ts` | E1, A3 | memory-callback gate (256) → `effectiveGameFeel()`; `buddy_gamefeel`/doctor "auto-quieted?" line via `gameFeelLevel()` vs `effectiveGameFeel()`; ascend write adds `flourish:true` (+ optional shiny) |
| `cli/doctor.ts` | E1 | report configured + effective gate (auto-quiet status) |
| `hooks/react.sh` | E1 | **none required** (spike preempts the only `full`-gated idle producer); document the rationale |
| `statusline/buddy-status.sh` | A3 | hoist the celebration-fresh/age check above frame selection; choose `flourishFrames`/`flourishSequence` while fresh, else `frames`/`frameSequence` (jq `// ""` fallback keeps old files working) |
| *(optional)* `state.ts` + `buddy-status.sh` | E1 nicety | server stamps effective `celebTtl` so the bubble TTL also honors a spike clamp — **not required**, defer |

---

## 5. Test plan (NFR5)

- **state.test.ts** — `autoQuietActive`: true for each `SPIKE_REASONS` member,
  false for `null`/unmapped (`pet`, `idle`, `commit`). `clampGameFeel`:
  `full`+quiet→`subtle`; `subtle`/`off`+quiet unchanged; any level, not quiet →
  unchanged. `effectiveGameFeel` guarded (no throw when config/reaction absent).
  `writeStatusState` writes `flourishFrames` **only** when `flourish:true` &&
  gate≠`off`, and **always** writes neutral `frames`; with `flourish:false`/off,
  `status.json` carries no flourish fields (older-reader parity).
- **art.test.ts** — `flourishFrames` returns valid non-empty frames for **every**
  species; `getStatusFrames("neutral")` remains byte-identical (regression
  guard); flourish and neutral arrays are independent (baking one never mutates
  the other).
- **statusline_render.test.ts** — extend the `BUDDY_FAKE_NOW` harness: with a
  fresh ascension celebration + `flourishFrames` present, the animated body cycles
  the flourish; past `CELEB_TTL` it reverts to the neutral `frames`; `off` (no
  flourish fields) and an old `status.json` both animate `frames` unchanged;
  `subtle` reverts at 6s.
- **e1 integration (state/index)** — configured `full` + a fresh `error`
  reaction ⇒ `effectiveGameFeel()==="subtle"` and the E3 memory-callback branch
  is not taken; reaction expired ⇒ no clamp; `off`/`subtle` invariant under all
  signals (byte-identity vs a captured baseline).
- Gate: `bun test` green + `tsc --noEmit -p tsconfig.json` clean.

---

## 6. Risks & mitigations

- **R-S1 — Auto-quiet feels like a bug ("why did it go quiet?").** *Mitigation:*
  doctor/`buddy_gamefeel` reports the live clamp + reason; clamp is one notch and
  transient; never persisted.
- **R-S2 — Deep-focus false-quieting good flow.** *Mitigation:* off by default
  (`autoQuietFocus`), ship after the spike clamp soaks; heuristic only clamps
  `full→subtle`.
- **R-S3 — Flourish "sticks" past the moment.** *Mitigation:* bash gates the
  flourish on the celebration's own freshness; neutral `frames` always co-present
  for instant fallback; stale `flourishFrames` are never selected.
- **R-S4 — bash ordering (celeb-age computed after frame pick today).**
  *Mitigation:* hoist the single age computation above frame selection; reuse it
  for both the flourish gate and the existing bubble gate (no duplicate logic).
- **R-S5 — New `status.json` fields break old readers (NFR3).** *Mitigation:*
  both flourish fields optional; bash `// ""`/`//[]` fallbacks; server omits them
  unless opted in.
- **R-S6 — Over-animation (NFR0/NFR6).** *Mitigation:* flourish is opt-in per
  write (ascension/shiny only), inherits the (shorter) `subtle` TTL, fully off
  under `off`.

---

## 7. Sequencing

```
Step 1 (E1 spike clamp):  state.ts autoQuietActive/clampGameFeel/effectiveGameFeel
                          ─► swap writeStatusState + index.ts:256 reads ─► doctor line
Step 2 (A3 flourish):     art.ts flourishFrames ─► state.ts flourish field/opt
                          ─► index.ts ascend flourish:true ─► buddy-status.sh select
Step 3 (E1 deep-focus):   opt-in autoQuietFocus heuristic (after Step 1 soaks)
```

Steps 1 and 2 are independent and each self-contained (no shared file beyond
`state.ts`); either can ship alone. **Definition of Done** (per the base
design §7): new/affected `*.test.ts` green; `tsc` clean; `gameFeel=off`
baseline byte-identity holds; manual check in a fresh terminal (UTF-8 + a
no-color/narrow terminal for NFR7); README/`/buddy` docs updated only if a new
config key (`autoQuietFocus`) ships.

## 8. Next step

`/sc:implement` **Step 1 then Step 2** — neither depends on an open question.
Defer Step 3 (deep-focus) until the spike clamp has real-use soak time.
