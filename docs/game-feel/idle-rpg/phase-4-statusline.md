# Design — Idle RPG · Phase 4: Statusline Render + Opt-Out Gate

> ✅ **Implemented & tested** (see [`status.md`](status.md)). This is the
> as-designed spec; the build matched it. Files: `server/state.ts`
> (`StatusState.enemyGlyph?`/`encounterAt?`, encounter read + emotion bias),
> `server/session.ts` (`off` opt-out ×2), `statusline/buddy-status.sh`
> (`$enc_fresh` in the single pass + margin placement — **zero new forks**).

Status: Component design (output of `/sc:design phase 4`). The final phase of
[[design]]: **render the baked fight on the status line** (the buddy makes a
fight face while the enemy glyph hovers in its margin), and **wire the opt-out
gate** still owed from [[stat-leveling]]. This is the **only** phase that touches
`buddy-status.sh`. No production code here; sketches are interface design only,
build with `/sc:implement`.

Grounded against actual source as of `develop` (post-Phase-3):
`statusline/buddy-status.sh` (the single-pass `jq` read at `:93`, the flourish
frame-source branch `:106-115`, the celebration TTL `:94-105`, the wander gate
`:119-129`, the art compose `:412-457`, `ART_W`/`MARGIN` lane), `server/state.ts`
(`writeStatusState`, `resolveEmotion`/`emotion` at `:805`, `getStatusFrames`
call `:819`, `StatusState` `:625`, `effectiveGameFeel`), `server/combat.ts`
(`readEncounter` — the transient side-channel from Phase 3),
`server/session.ts` (`maybeFightBug`, `accrueSessionStats` — the two mechanics to
gate).

**Locked decisions** (from [[design]]): **statusline is a dumb cycler** (zero new
forks); **render only at `gameFeel === full`**; the layout invariant is sacred.

---

## 1. Scope & non-goals

**In scope (Phase 4):**
- Surface a fresh encounter on the status line: the buddy adopts a **fight face**
  (reusing the emotion-frame pipeline) and the **enemy glyph** sits in the
  reclaimed wander margin, for the encounter's TTL.
- `writeStatusState` reads `encounter.json` (Phase 3's side-channel), and while
  fresh: biases `emotion → angry` and writes the new optional
  `StatusState.enemyGlyph?`/`encounterAt?` fields.
- `buddy-status.sh`: **one** new freshness+placement branch in the existing
  single `jq` pass — no second file read, **zero new forks**.
- **Wire the opt-out gate:** `effectiveGameFeel() === "off"` disables the whole
  idle-RPG loop — combat spawns **and** behavioral stat accrual (closing the
  stat-leveling debt). A refinement of [[design]] §1 (see §4).

**Explicit non-goals:**
- A bespoke combat frame cycler / multi-line fight choreography → deferred
  (OQ-P4.1). v1 reuses emotion frames + the glyph — richer and proven.
- Changing combat resolution, drops, or the catalog (Phases 1–3 are frozen).
- Weapon/trinket glyphs on the status line beyond the equipped-headgear hat that
  Phase 1 already renders (out of scope; OQ-P4.4).

---

## 2. What already exists (reuse, don't reinvent)

- **The single-pass `jq` read** (`buddy-status.sh:93`) already resolves frame
  source + celebration freshness + wander offsets in **one** fork. The encounter
  adds a couple of derived vars to this same pass — no new `jq`, no new file
  read (the data rides `status.json`, written by `writeStatusState`).
- **The freshness idiom exists.** `$celeb_fresh` (`:94-105`) is the exact TTL/age
  pattern, gameFeel-gated, the encounter freshness copies.
- **The emotion-frame pipeline exists.** `writeStatusState` derives an `emotion`
  (`state.ts:805`) and feeds it to `getStatusFrames` (`:819`); `"angry"` already
  substitutes a `>` eye + micro-cycle (`art.ts`). The "fight face" is **this**,
  with no new ASCII — so we render combat by *choosing* a frame set, not by
  baking a parallel one. (Server bakes which frames; bash still just cycles.)
- **The margin is already free during a fight.** Wander is suppressed when a
  celebration is fresh (`:119` `gf=="full" and celeb_fresh != 1`). A combat write
  sets a fresh `Celebration{kind:"loot"}` (Phase 3), so the wander corridor is
  already idle — the enemy glyph occupies it without contending.
- **The side-channel exists.** `readEncounter(maxAgeMs)` (Phase 3) already
  TTL-checks `encounter.json`. `writeStatusState` calls it the same way it reads
  xp/streak/seasonal state today.
- **The opt-out flag exists.** `effectiveGameFeel()` (`off | subtle | full`,
  with auto-quiet clamp) is the dial. "Wiring the gate" = reading it in two more
  places, not inventing a flag.

---

## 3. The render-model decision: emotion frames + glyph, not a bespoke cycler

Phase 3 bakes `frames[]` into `encounter.json`, but those are simple single-line
poses, while `status.json.frames` are multi-line 12-col art. Rather than teach
bash a second frame format + a second cycler branch (more forks risk, format
skew), **v1 renders the fight by reusing the emotion pipeline**:

- A fresh encounter ⇒ `writeStatusState` sets `emotion = "angry"` ⇒
  `getStatusFrames` emits the angry micro-cycle into the normal `.frames`. The
  existing cycler animates it. **No new frame source in bash.**
- The only genuinely new visual is the **enemy glyph**, surfaced as one field and
  placed in the margin.

Phase 3's baked `frames`/`sequence` in `encounter.json` become a **forward-compat
carrier** — unused by the v1 renderer, available if OQ-P4.1 (bespoke
choreography) is ever pursued. This keeps bash a dumb cycler and adds the
smallest possible surface. Net new to the hot path: **two derived `jq` vars and
one string field. Zero forks.**

---

## 4. Gate model (and the opt-out wiring)

A small, honest refinement of [[design]] §1. The master doc said off/subtle both
"resolve in state, don't animate." Phase 4 splits them so **off is a true
opt-out** — which is what [[stat-leveling]] actually needs:

| `gameFeel` | Combat spawns + drops | Stat accrual | Toast | Fight animation |
| --- | :---: | :---: | :---: | :---: |
| `off` | ❌ (opt-out) | ❌ (opt-out) | ❌ | ❌ |
| `subtle` | ✅ resolve in state | ✅ | ✅ (TTL 6) | ❌ |
| `full` | ✅ | ✅ | ✅ (TTL 10) | ✅ glyph + fight face |

- **`off` is the opt-out.** `maybeFightBug` and `accrueSessionStats` both early-
  return when `effectiveGameFeel() === "off"`. This is the gate owed since
  stat-leveling — wired with the **existing** flag, no new config. Note auto-quiet
  clamps `full→subtle` during error spikes/focus, so a tense session keeps the
  drops but quiets the animation — correct behavior.
- **`subtle`** keeps the mechanics (you still earn points/stats, still see the
  toast) but no ambient animation. **`full`** adds the fight face + glyph.

This closes the [[stat-leveling]] "opt-out gate unwired" item as a side effect.

---

## 5. Server changes (`server/state.ts`)

**New optional `StatusState` fields** (additive, backfilled — the
`wanderSequence?` precedent):
```ts
interface StatusState {
  // ...existing...
  /** The bug glyph to hover in the margin during a fresh fight. Absent ⇒ none. */
  enemyGlyph?: string;
  /** Date.now() of the encounter, for the statusline TTL (like celebration.at). */
  encounterAt?: number;
}
```

**`writeStatusState`** gains a small block, beside where it already reads
xp/streak/seasonal and derives `emotion`:
```ts
// Idle-RPG encounter (Phase 4): a fresh fight biases the face angry and surfaces
// the enemy glyph. Render is gated to full in the shell; off already produced no
// encounter.json (opt-out). Read is event-frequency, not per tick — cheap.
let enemyGlyph: string | undefined;
let encounterAt: number | undefined;
if (gate !== "off") {
  try {
    const { readEncounter } = require("./combat.ts") as typeof import("./combat.ts");
    const enc = readEncounter();           // TTL'd; null when stale/absent
    if (enc) { enemyGlyph = enc.enemyGlyph; encounterAt = enc.at; emotion = "angry"; }
  } catch { /* combat optional during install / version skew */ }
}
```
`enemyGlyph`/`encounterAt` are spread into the written `StatusState` only when
present (the optional-field idiom).

---

## 6. Statusline changes (`statusline/buddy-status.sh`)

**(a) In the single `jq` pass** (`:93`), add encounter freshness — a copy of the
`$celeb_fresh` math, gated to `full` (animation is full-only):
```jq
| (if $gf == "full"
   then ((.encounterAt // 0) as $ea
         | (.enemyGlyph // "") as $eg
         | if ($eg != "" and $ea > 0
               and ($now - ($ea/1000 | floor)) >= 0
               and ($now - ($ea/1000 | floor)) <= 12)
           then 1 else 0 end)
   else 0 end) as $enc_fresh
```
and emit two more fields in the `join("")` array: `$enc_fresh` and
`(.enemyGlyph // "")`. Read them into `_ENC_FRESH ENEMY_GLYPH` in the existing
`IFS=$'\x1f' read`. **No new `jq` invocation.**

**(b) In the art compose** (`:412`), when `_ENC_FRESH = 1`, append the glyph to
the buddy's **face line** within the reclaimed margin:
```sh
# Enemy hovers in the (already wander-free) right margin — rightmost on the line,
# so its width can't shift anything to its left. Gap keeps it off the art.
if [ "$_ENC_FRESH" = 1 ] && [ -n "$ENEMY_GLYPH" ]; then
    ALL_LINES[$FACE_ROW]="${ALL_LINES[$FACE_ROW]}    ${ENEMY_GLYPH}"
fi
```
`FACE_ROW` is the art's eye row (the frame's middle line; a fixed index into the
art block). Wander is already suppressed (celeb fresh), so the margin is the
glyph's to use.

---

## 7. The layout invariant (the whole job)

The enemy glyph must live **entirely in the reclaimed right margin** — the same
lane wander roams. Concretely:
- It is appended **after** all of the art line's own content, so it is the
  rightmost thing on that row. A double-width emoji therefore cannot shift any
  aligned column to its left (stats panel, gap, bubble, name, art) — the exact
  reasoning the stats panel uses to keep emoji out of *aligned* columns but
  permits them at the right edge.
- `TOTAL_W`/`PAD` and every column left of the art's right edge are
  **byte-identical** with and without a fresh encounter.
- It consumes margin the wander corridor isn't using this tick (wander is gated
  off while the fight's celebration is fresh), so there is no contention and no
  new width budget.

**Invariant test (bash):** render a frame with `_ENC_FRESH=0` vs `=1` (same
status.json otherwise) and assert the bubble/stats/name substrings and their
start columns are unchanged — only trailing margin content differs.

---

## 8. Opt-out wiring (`server/session.ts`)

Two early-returns, reusing the imported `effectiveGameFeel`:
```ts
export function maybeFightBug(slot, errorsSeen, startedAt): void {
  if (effectiveGameFeel() === "off") return;   // ← opt-out
  // ...existing spawn/resolve/drop/write...
}

export function accrueSessionStats(slot, delta, elapsedSec) {
  if (effectiveGameFeel() === "off") return {}; // ← the stat-leveling gate, finally wired
  // ...existing accrual...
}
```
`effectiveGameFeel` is already exported from `state.ts`; `session.ts` adds it to
its existing state import.

---

## 9. Files changed

| File | Change | New/Edit |
| --- | --- | --- |
| `server/state.ts` | `StatusState.enemyGlyph?`/`encounterAt?`; read `encounter.json` + bias emotion in `writeStatusState` | edit |
| `server/session.ts` | `off` opt-out in `maybeFightBug` + `accrueSessionStats` | edit |
| `statusline/buddy-status.sh` | `$enc_fresh` in the single pass + glyph placement in compose | edit |
| `server/state.test.ts` | encounter fields written when fresh; absent at off / when stale; opt-out returns | edit |
| `server/session.test.ts` | `off` short-circuits combat + accrual (pure-gate assertions) | edit |
| `statusline/*` test | layout-invariant snapshot (glyph stays in margin) | new/edit |

No changes to Phases 1–3 modules (`items`/`equipment`/`shop`/`bugs`/`combat`).

---

## 10. Data flow (fight → pixels)

```
maybeFightBug (Phase 3) ─► writeEncounter(encounter.json) + toast
        │
        ▼  (next status write, within TTL)
writeStatusState ── readEncounter() fresh? ──► emotion="angry"
        │                                      enemyGlyph, encounterAt → status.json
        ▼
status.json: { frames:<angry cycle>, enemyGlyph:"🐉", encounterAt, celebration }
        │
        ▼  (every ~1s tick — ONE jq pass)
buddy-status.sh: $enc_fresh (gf==full && TTL) ─► cycle angry frames
        └─► append ENEMY_GLYPH to FACE_ROW in the wander-free margin
        (off ⇒ no encounter.json ever ⇒ nothing here; subtle ⇒ toast only)
```

---

## 11. Test plan

- **`state.ts`** — with a fresh `encounter.json`: `writeStatusState` sets
  `enemyGlyph`/`encounterAt` and `emotion==="angry"` frames; with a stale/absent
  one: fields absent, normal emotion; at `gameFeel==="off"`: never reads it.
- **`session.ts`** — `effectiveGameFeel()==="off"` ⇒ `maybeFightBug` no-ops (no
  encounter file, no drop) and `accrueSessionStats` returns `{}` (the
  stat-leveling gate).
- **`buddy-status.sh`** — `_ENC_FRESH=1` renders the glyph; **layout invariant**:
  columns left of the art's right edge byte-identical vs `_ENC_FRESH=0`;
  `gf!=full` ⇒ no glyph even with a fresh encounter; `bash -n` clean; no new
  process forks vs baseline (grep the script: still one `jq` over `$STATE`).
- Gate: `tsc --noEmit` clean, full `bun test` green, fresh-process smoke — a
  commit-with-errors at `full` shows the glyph + angry face for the TTL, then
  reverts to idle.

---

## 12. Open questions

- **OQ-P4.1 — Bespoke fight choreography.** v1 = angry emotion + hovering glyph.
  A richer multi-frame swing (consuming Phase 3's baked `frames`) is a deferred
  enhancement; would need a second cycler branch + multi-line encounter frames.
  Recommend ship v1, revisit if it feels flat.
- **OQ-P4.2 — Glyph width / `FACE_ROW` index.** Bug glyphs are emoji (often
  double-width); placing them rightmost avoids alignment breakage, but confirm
  `FACE_ROW` is a stable index across species art and that the glyph never wraps
  at small `COLS` (clamp: drop the glyph if `MARGIN` < glyph width).
- **OQ-P4.3 — TTL alignment.** Encounter render TTL (12s here) vs the celebration
  toast TTL (10 at full). Keep them close so the glyph and toast fade together;
  exact value is tuning.
- **OQ-P4.4 — Weapon/trinket on the status line.** Still deferred (Phase 1 left
  weapon glyphs to "Phase 4," but they're lower-value than the enemy; recommend a
  separate follow-up, not bundled here).
- **OQ-P4.5 — Master-doc amendment.** §4 refines [[design]] §1 (off = full
  opt-out). Fold that wording back into `design.md` on implement so the arc doc
  stays the source of truth.
