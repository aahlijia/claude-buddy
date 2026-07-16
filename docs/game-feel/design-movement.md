# Design — Buddy Movement (idle wander on the status line)

> **⚠️ Partly superseded (2026-06-30).** The right-margin **corridor** model and
> its **`wanderWide` / `wanderBubble`** modes described below are **retired** —
> the buddy free-roams the whole line and the bubble always travels with it. The
> two flags + `WANDER_RANGE_WIDE` were deleted from the code. See the §11
> free-roam addendum near the end of this doc, and
> [`CURRENT-STATE.md`](CURRENT-STATE.md) for the live picture. The §2–§6 base
> wander, §7.A hop, §7.C resize, and §7.D mood expressiveness still hold.

Status: Design (output of `/sc:design`). A new game-feel item: the buddy ambles
**back and forth on the status line at random intervals** while the speech
bubble, stats panel, name/title/badge, and every other element stay exactly
where they are. No production code here — type/signature sketches are interface
design only; build with `/sc:implement`.

This doc covers the **base horizontal wander** (§2–§6) and four **extended
movement modes** (§7), rolled in from what was previously out of scope: a
vertical **hop / path arc**, a **wide two-sided** corridor, **resize
robustness**, and a read-only **mood/level-expressive** walk. Every mode is
opt-in, gate-gated, and obeys the same per-tick layout invariant.

Grounded against actual source as of `feature/game-feel`:
`statusline/buddy-status.sh` (the dumb cycler), `server/art.ts`
(`getStatusFrames`, `flourishFrames`, `*_FRAME_SEQUENCE`), and
`server/state.ts` (`writeStatusState`, `StatusState`, `BuddyConfig`,
`effectiveGameFeel`, `moodStr`). It reuses the **pre-baked-sequence +
`NOW % len` cycler** pattern those files already establish for frame animation.

---

## 0. What already exists (reuse, don't reinvent)

- **Tick cycler.** `buddy-status.sh:92-95` picks the current art frame with
  `frameSequence[$now % len]`. Wander uses the *same* mechanism with a second
  sequence — no new timing primitive, no per-tick state file.
- **Server pre-bakes, bash stays dumb.** `getStatusFrames`/`flourishFrames`
  (`art.ts:297,349`) compute frames + a playback sequence in TS; bash only
  indexes. Wander follows suit: a pure `buildWanderSequence` in TS, one jq
  index in bash.
- **The gate.** `effectiveGameFeel()` (`state.ts:586`) already wraps the
  `off | subtle | full` dial with the auto-quiet clamp. Wander reads it; it
  never invents its own intensity logic.
- **Mood/emotion already flavors animation.** `writeStatusState` reads `moodStr`
  (`state.ts:817-818`) and derives `emotion` to pick frames (`art.ts:297`). The
  expressive walk (§7.D) is the *same kind of read* — cosmetic, one-way, no new
  coupling.
- **The celebration channel + flourish.** `_CELEB_FRESH` (`buddy-status.sh:69-79`)
  already marks "the buddy has something to say" and swaps in `flourishFrames`.
  Wander hooks this one signal to return home and reattach the connector.
- **Optional, backfilled fields.** `flourishFrames?`/`flourishSequence?`
  (`state.ts:641-642`) show the exact pattern: optional `StatusState` fields,
  spread in only when present, read in bash with a `// []` jq default.

---

## 1. Design principles (trace to the existing NFRs)

- **The layout invariant is the whole job (NFR6).** The buddy's motion must be
  absorbed **entirely within its own lane**. Not one column left of the art —
  bubble, connector, stats, `PAD`, `MID_SPACER` — may move by a single cell on
  any tick. This is the same invariant the XP-toast fix defends
  (`buddy-status.sh:398-424`): width changes are folded into slack, never
  pushed onto neighbors. The wander offset changes only *which* slack column the
  art occupies, so `TOTAL_W` and `PAD` are literally unchanged by it. The
  extended modes obey the same rule: any layout cost (a headroom row, a wider
  corridor) is a **one-time, offset-independent** change computed before the
  render loop — never a per-tick shift of a neighbor.
- **The gate comes first (NFR0).** Ambient motion is a *delighter*, not a
  signal. It reads `effectiveGameFeel()` and runs **only at `full`**. `off` and
  `subtle` keep the buddy planted — and because auto-quiet clamps `full → subtle`
  during an error spike or deep focus, the buddy **stops pacing when the work
  gets tense.** That fall-out is the feature behaving correctly.
- **No numbers that matter (NFR1).** Position is cosmetic. It never touches XP,
  stats, mood, or any persisted gameplay value. The expressive walk (§7.D)
  *reads* mood/level to choose an animation style; it **writes nothing and
  grants no advantage** — identical in spirit to `emotion → frames` today.
- **Server bakes, bash cycles (NFR2).** "Random intervals" is a *seeded random
  walk* generated once per status write in TS (pure, testable). Bash never
  rolls dice; it indexes `wanderSequence[$now % len]` exactly like frames.
- **Additive, lazy, swallowed (NFR4).** The walk is built behind a guarded lazy
  `require`, like loot/flourish. A generator failure leaves the sequences absent
  and the buddy static — the write still completes.
- **Backfill the new fields (NFR3).** `StatusState` gains optional
  `wanderSequence?` / `wanderRowSequence?`; bash reads both with `// []`
  defaults. Older `status.json` ⇒ no fields ⇒ offset 0 ⇒ today's exact
  behavior, byte-for-byte.
- **Degrade cleanly (NFR7).** Corridors are reclaimed from existing slack; if
  the terminal is too narrow the corridor collapses to zero and the buddy
  doesn't wander. Hop headroom collapses too. Plain spaces only (mid-line) — no
  Braille-Blank width hazard.
- **Tested core (NFR5).** `buildWanderSequence`, the mood→opts map, and the
  clamp are pure exported functions, unit-tested with a fixed seed — no I/O.

---

## 2. The geometry — where the buddy is allowed to move

### 2.1 Today's line (right-aligned, unchanged)

```
SPACER · [STATS · STATS_GAP · MID_SPACER] · [BUBBLE · connector(3)] · ART
└─LEAD_PAD─┘                                                          └ART_W=14┘
                                                          art ends at  COLS − MARGIN ┘
```

`buddy-status.sh:594-707`. The bubble+art block is flush to the right; the art's
right edge sits `MARGIN` (config `bubbleMargin`, default 8) cells from the screen
edge. `TOTAL_W` and `PAD = COLS − TOTAL_W − MARGIN` decide everything to the left.

### 2.2 The corridor — reclaimed from the right margin

The buddy paces in a corridor **carved out of the existing right margin**, to the
*right* of its home position. Home (offset 0) is exactly today's spot, connector
attached. The buddy can step right into the margin by up to `WANDER_MAX` cells:

```
offset 0 (home):   …BUBBLE ──ART············|   ← connector attached
offset 3:          …BUBBLE   ···ART·········|   ← connector retracted, buddy ambled right
offset WANDER_MAX: …BUBBLE   ······ART······|   ← still WANDER_SAFETY cells off the edge
                                            ^ screen edge
```

```
WANDER_MAX = max(0, min(WANDER_RANGE, MARGIN − WANDER_SAFETY))
```

With defaults `MARGIN=8`, `WANDER_RANGE=6`, `WANDER_SAFETY=2` ⇒ `WANDER_MAX=6`.

**Why rightward-only (base mode).** Left of home lies the 3-cell connector then
the bubble; travelling left would collide with it. Keeping the base corridor on
the right is what guarantees the bubble never moves. "Back and forth" is
satisfied by oscillation along `home ⟷ right`. §7.B extends the corridor to the
left for users who want a wider amble, at the cost of a one-time bubble shift.

### 2.3 The mechanic — one insertion, one retraction

Per tick, with current `offset`:

1. **Insert** `offset` plain spaces immediately before the art segment on
   *every* output line (art rows, name/title/badge rows, and blank filler rows
   alike, so the whole block translates as a unit and the name stays centered
   under the buddy).
2. **Retract the connector** while `offset > 0`: the per-line `"-- "` becomes
   `"   "`. The bubble box itself is untouched — it stays whole, it just stops
   pointing at thin air. At `offset == 0` the connector reattaches.

`TOTAL_W`, `PAD`, `LEAD_PAD`, `MID_SPACER`, `STATS_W`, `BOX_W` are all computed
**before** and **independent of** `offset`. The insertion lands in the formerly-
empty right margin; nothing to the left can observe it. That is the invariant,
by construction.

---

## 3. Data model

```ts
// state.ts — StatusState gains optional fields (mirror flourishSequence)
interface StatusState {
  // …existing fields…
  /** Idle-wander: per-tick horizontal offset (cells, ≥0) the buddy art is
   *  nudged right within the reclaimed margin. Indexed by NOW % length, like
   *  frameSequence. Absent unless gameFeel === "full" and wander is on. */
  wanderSequence?: number[];
  /** Idle-wander hop (§7.A): per-tick vertical offset (rows, 0..hopHeight),
   *  same index. Present only when wanderHop is on; absent ⇒ floor-only. */
  wanderRowSequence?: number[];
}

// state.ts — BuddyConfig gains toggles (gate still rules; all default-calm)
interface BuddyConfig {
  // …existing fields…
  /** Opt out of idle wander without dropping gameFeel below "full". Default
   *  true; wander still only animates when effectiveGameFeel() === "full". */
  wanderEnabled: boolean;
  /** §7.A vertical hop / path arc. Costs one reserved headroom row, so default
   *  false (NFR6 real-estate). */
  wanderHop: boolean;
  /** §7.B wide two-sided corridor. Shifts the bubble left by a constant to open
   *  a left lane. Default false. */
  wanderWide: boolean;
}
```

No new JSON file. No persisted position — the walk is regenerated each write, so
nothing to corrupt or migrate. The expressive walk (§7.D) adds **no** field — it
only shapes the generator's inputs from values already read.

---

## 4. Server interface — the seeded random walk (pure core)

A new pure module `server/wander.ts` (peer of `art.ts`), unit-testable with a
fixed seed:

```ts
export interface WanderOpts {
  range: number;        // max horizontal offset; walk stays in [0, range]
  length: number;       // sequence length == loop period in seconds
  dwellMin: number;     // min seconds parked at a waypoint
  dwellMax: number;     // max seconds parked at a waypoint
  stepEvery: number;    // ticks per 1-cell step (1 = brisk, 2 = slow shuffle)
  hopHeight: number;    // max vertical rows; 0 disables hops (§7.A)
  seed: number;         // injected; Date.now() in prod, fixed in tests
}

/** Build a deterministic "amble": pick a random waypoint in [0, range], step
 *  toward it every `stepEvery` ticks, occasionally arc up to `hopHeight` and
 *  back (a parabolic hop = the "path"), park for a random dwell, repeat — until
 *  `length` ticks are produced. Pure; no I/O. */
export function buildWanderSequence(opts: WanderOpts): {
  horizontal: number[];           // → wanderSequence
  vertical: number[] | undefined; // → wanderRowSequence (undefined when hopHeight 0)
};

/** §7.D — map the buddy's current mood + level to a walk personality. Pure,
 *  read-only; the OUTPUT is WanderOpts, the input is values writeStatusState
 *  already has in hand (moodStr, xpLevel). Never writes mood/level. */
export function moodWalkOpts(mood: string, level: number, seed: number): WanderOpts;
```

- **Step rate `stepEvery`** controls walk speed → reads as walking, never
  teleporting; `melancholy` shuffles at `stepEvery=2`.
- **Random dwell** in `[dwellMin, dwellMax]` → the "random intervals." Long
  dwells dominate, so the buddy mostly stands still and occasionally strolls.
- **Seeded RNG** (e.g. `mulberry32`) so prod gets fresh pacing each write while
  tests pin the seed and assert the exact arrays.
- **Loop length** default 180 ⇒ a 3-minute loop; `status.json` is rewritten on
  every reaction/XP event anyway, reseeding well before the loop completes.

### Integration into `writeStatusState` (`state.ts:842-857`, beside flourish)

```ts
// Idle wander (movement): gate-gated + opt-out, lazy/guarded like flourish.
let wanderSequence: number[] | undefined;
let wanderRowSequence: number[] | undefined;
if (gate === "full" && loadConfig().wanderEnabled) {
  try {
    const { buildWanderSequence, moodWalkOpts } =
      require("./wander.ts") as typeof import("./wander.ts");
    const cfg = loadConfig();
    const opts = moodWalkOpts(moodStr, xpLevel, Date.now());   // §7.D personality
    if (!cfg.wanderHop) opts.hopHeight = 0;                    // §7.A opt-in
    if (cfg.wanderWide) opts.range = WANDER_RANGE_WIDE;        // §7.B opt-in
    const walk = buildWanderSequence(opts);
    wanderSequence = walk.horizontal;
    wanderRowSequence = walk.vertical;
  } catch {
    // Best-effort delighter; a failure leaves the buddy planted.
  }
}
// …spread present-only into the state object (mirrors flourishFrames):
//   ...(wanderSequence ? { wanderSequence } : {}),
//   ...(wanderRowSequence ? { wanderRowSequence } : {}),
```

`gate` is the already-clamped `effectiveGameFeel()` value (`state.ts:765-770`),
so auto-quiet (`full → subtle`) automatically omits the sequences and the buddy
stops pacing during a spike — no extra wiring.

---

## 5. Bash integration (`statusline/buddy-status.sh`)

The base mode is four small, local edits; §7 modes add bounded deltas to the
same spots. Each defends the invariant.

**(a) Read + pick the offsets** (beside the frame pick, ~`:92`). Mirror the
`frameSequence` jq, default `// []`, gate it, and zero it while a celebration is
fresh so the buddy comes home to talk:

```bash
WANDER_OFF=0 ; WANDER_ROW=0
if [ "$GAME_FEEL" = "full" ] && [ "$_CELEB_FRESH" != 1 ]; then
    WANDER_OFF=$(jq -r --argjson now "$NOW" '
        (.wanderSequence // []) as $w
        | if ($w|length) > 0 then ($w[$now % ($w|length)] // 0) else 0 end
    ' "$STATE" 2>/dev/null || echo 0)
    WANDER_ROW=$(jq -r --argjson now "$NOW" '
        (.wanderRowSequence // []) as $w
        | if ($w|length) > 0 then ($w[$now % ($w|length)] // 0) else 0 end
    ' "$STATE" 2>/dev/null || echo 0)
    case "$WANDER_OFF" in ''|*[!0-9]*) WANDER_OFF=0 ;; esac
    case "$WANDER_ROW" in ''|*[!0-9]*) WANDER_ROW=0 ;; esac
fi
```

**(b) Clamp to the corridor** (after `MARGIN`/`COLS` are known, ~`:211`). Bash
owns the clamp because only bash knows `MARGIN`/`COLS`; the sequence carries raw
offsets. §7.C resize robustness lives here:

```bash
WANDER_RANGE=6 ; WANDER_SAFETY=2
WANDER_MAX=$(( MARGIN - WANDER_SAFETY ))            # base: reclaim from margin
[ "$WANDER_WIDE" = "true" ] && WANDER_MAX=$(( WANDER_MAX + WANDER_LEFT ))  # §7.B
[ "$WANDER_MAX" -lt 0 ] && WANDER_MAX=0
[ "$WANDER_MAX" -gt "$WANDER_RANGE" ] && WANDER_MAX=$WANDER_RANGE
[ "$WANDER_OFF" -gt "$WANDER_MAX" ] && WANDER_OFF=$WANDER_MAX   # §7.C: live clamp
WANDER_PAD=$(printf '%*s' "$WANDER_OFF" '')        # plain spaces — never trimmed
```

**(c) Retract the connector while away** (~`:642`). Reuse the existing "no
connector" sentinel so the bubble stays intact, just unattached. A hop also
detaches (the mouth row moved):

```bash
{ [ "$WANDER_OFF" -gt 0 ] || [ "$WANDER_ROW" -gt 0 ]; } && CONNECTOR_BI=-1
```

**(d) Translate the art block** (render loop, ~`:705`). Insert the horizontal
pad before the art segment; §7.A shifts the art's *starting row* by `WANDER_ROW`
within reserved headroom:

```bash
line_out+="$WANDER_PAD"
line_out+="$art_part"
```

Everything above `TOTAL_W`/`PAD` is untouched. `WANDER_OFF`/`WANDER_ROW` default
to 0 on every failure path (`off`/`subtle`, missing field, narrow terminal,
fresh celebration), so the worst case is *today's* static buddy.

---

## 6. Decisions & alternatives

- **Server-baked sequence vs. hash-in-bash (chosen: server-baked).** Keeps bash
  a dumb cycler (the house pattern) and makes the randomness unit-testable. The
  finite loop period is neutralized by frequent reseeding and a 3-minute length.
- **Gate at `full` vs. its own dial (chosen: `full` + opt-out).** Ambient motion
  is the most "chatty" delighter, so it belongs with the loudest tier; the
  `wanderEnabled` opt-out lets motion-sensitive users silence it without losing
  level-up/loot toasts (which live at `subtle`).
- **Pause during celebration (chosen: yes).** Reuses `_CELEB_FRESH`. The buddy
  returns home, the connector reattaches, the flourish bob plays in place — the
  speech moment stays composed instead of fighting the walk.
- **Hop default off (chosen).** It is the only mode that costs a permanent row
  (NFR6); horizontal wander, wide, and expressive all cost zero extra rows.

---

## 7. Extended movement modes (rolled in from former §9)

All four reuse the §4 generator + §5 cycler. None breaks the per-tick invariant:
each pays any layout cost once, before the render loop.

### 7.A — Vertical hop / path arc  (`wanderHop`, default off)

**What.** Occasionally, mid-stroll, the buddy arcs up one or two rows and back —
a little hop. The full 2-D trail (horizontal offset × vertical offset over the
sequence) *is* the "path-following" path; a hop is just a waypoint transition
whose vertical component rises then falls.

**Mechanic.** The generator emits a parallel `wanderRowSequence` (0..`hopHeight`).
Bash reserves `hopHeight` blank **headroom rows above the art** (only when the
mode is on — that is the one-time NFR6 cost) and renders the art block starting
at row `(hopHeight − WANDER_ROW)`, so `WANDER_ROW=0` rests on the floor and
`hopHeight` touches the ceiling.

**Invariant.** The bubble and stats columns are vertically centered against the
**floor baseline** (`(ART_COUNT_total − BUBBLE_COUNT)/2`, where `ART_COUNT_total`
includes the headroom), *not* against the live hop position — so they never bob.
The connector retracts during a hop (§5c). Headroom collapses to 0 if the block
already exceeds the status line's height budget (degrade).

**Tunables.** `hopHeight` default 1 (a polite bunny-hop); 2 for a springier feel.

### 7.B — Wide two-sided corridor  (`wanderWide`, default off) — RETIRED (§11)

> Historical. The `wanderWide` flag and `WANDER_RANGE_WIDE` were removed
> 2026-06-30; free-roam (§11) makes the whole line the lane.

**What.** A longer amble than the right margin alone affords, so the buddy ranges
both well right *and* back past its resting point — a fuller "back and forth."

**Mechanic.** The base corridor is bounded by `MARGIN − WANDER_SAFETY` (≈6 cells).
When wide is on and `WANDER_RANGE_WIDE` exceeds that budget, the deficit
`WANDER_LEFT = max(0, WANDER_RANGE_WIDE − (MARGIN − WANDER_SAFETY))` is reclaimed
by **adding `WANDER_LEFT` to the bubble→art `GAP`** — a one-time shift of the
bubble left by a constant. `TOTAL_W` grows by `WANDER_LEFT`, `PAD` shrinks by it,
once, before the render loop; the per-tick offset still moves nothing left of the
art.

**Honest caveat (stated up front).** The connector attaches only at the
home/left end of the corridor (where the buddy is `GAP`-adjacent to the bubble);
across the rest of the amble it is retracted, same as the base mode. A
variable-length connector that *stretches* to follow the buddy was rejected — it
reads as a broken box, not a tether. So "two-sided" here means *a wider corridor
purchased with a constant bubble shift*, not a centred rest with a rubber-band
connector.

**Tunables.** `WANDER_RANGE_WIDE` default 10; with `MARGIN=8` that shifts the
bubble left 4 cells while wide is enabled.

### 7.C — Resize robustness  (always on; no flag)

**What.** The walk must stay correct and on-screen when the terminal is resized
mid-amble.

**Mechanic.** `COLS` and `MARGIN` are already recomputed **every tick**
(`buddy-status.sh:163-193`), and the §5b clamp runs against those *live* values,
so a shrink immediately caps `WANDER_OFF` to the new `WANDER_MAX` and the buddy
is never clipped — `WANDER_SAFETY` is enforced against the current width. On a
hard shrink the offset may **snap** left in one tick rather than easing; we
accept the snap deliberately, because easing would require per-tick position
state and the design forbids a new state file (NFR4 principle). The block's
existing `PAD ≥ 0` floor (`:607`) keeps it from underflowing on very narrow
terminals; if `WANDER_MAX` hits 0 the buddy simply parks (degrade, NFR7).

**Tunables.** none — it is the live clamp, not a new knob. (An optional eased
snap via the existing `reaction.$SID.json` session file is noted as a future
nicety, not part of this cut.)

### 7.D — Mood / level-expressive walk  (read-only; no flag)

**What.** The *style* of the amble reflects the buddy's mood and level: an
excited buddy paces briskly across a wide range; a tired one shuffles a step and
rests; a focused one barely moves. Higher levels add the occasional confident
hop (when §7.A is on).

**Mechanic.** `moodWalkOpts(mood, level, seed)` (§4) maps the **values
`writeStatusState` already holds** to `WanderOpts`. Suggested mapping (mirrors
the moods in `buddy-status.sh:276-284`):

| mood | range | dwell (s) | stepEvery | feel |
|---|---|---|---|---|
| `focused` | 0–2 | 12–24 | 1 | near-still, occasional drift |
| `happy` | 4 | 6–16 | 1 | easy strolls |
| `excited` | 6 | 3–9 | 1 | brisk pacing |
| `chaotic` | 6 | 2–7 | 1 | restless, frequent turns |
| `tired` | 2 | 18–30 | 2 | slow shuffle, long rests |
| `melancholy` | 2 | 14–26 | 2 | slow, listless |

Level adds a gentle nudge: `range += min(2, ⌊level/10⌋)` and unlocks an
occasional hop amplitude bump at higher levels — purely flavor.

**NFR1 boundary (explicit).** This is a one-way *read* — mood/level → animation
opts — exactly like `emotion → frames` today (`state.ts:773-793`). It **writes
nothing**, touches no multiplier, and confers no advantage. The buddy expresses
its mood by how it walks; the walk never changes the mood. That is what keeps the
"coupling" inside NFR1 rather than violating it.

---

## 8. Tunables (pin every constant)

| Name | Where | Default | Meaning |
|---|---|---|---|
| `wanderEnabled` | `config.json` | `true` | Per-user opt-out; gate still requires `full`. |
| `wanderHop` | `config.json` | `false` | §7.A vertical hop (costs one headroom row). |
| `wanderWide` | `config.json` | `false` | §7.B wide corridor (shifts bubble left a constant). |
| `WANDER_RANGE` | server + bash | `6` | Base max amble distance (cells). |
| `WANDER_RANGE_WIDE` | server + bash | `10` | §7.B max amble distance when wide. |
| `WANDER_SAFETY` | bash | `2` | Cells kept clear of the screen edge. |
| `hopHeight` | server + bash | `1` | §7.A max hop height (rows); 0 disables. |
| `length` | server | `180` | Sequence length = loop period (seconds). |
| `dwellMin` / `dwellMax` | server | mood-mapped | Random park time per waypoint (§7.D). |
| `stepEvery` | server | mood-mapped | Ticks per 1-cell step (§7.D). |

Derived (not configured):
`WANDER_MAX = clamp(WANDER_RANGE[_WIDE], 0, (MARGIN − WANDER_SAFETY) + WANDER_LEFT)`,
`WANDER_LEFT = max(0, WANDER_RANGE_WIDE − (MARGIN − WANDER_SAFETY))` when wide.

---

## 9. Test plan (NFR5)

Pure unit tests (`server/wander.test.ts`, fixed seed, no I/O):

- `buildWanderSequence` returns `length` horizontal entries, all in `[0, range]`.
- Adjacent horizontal entries differ by ≤ 1 (steps, never teleports); with
  `stepEvery=2`, value changes at most every other tick.
- Contains at least one run ≥ `dwellMin` (waypoints are dwelt).
- Same seed ⇒ identical arrays (deterministic); different seeds ⇒ differ.
- `hopHeight=0` ⇒ `vertical` is `undefined`; `hopHeight>0` ⇒ `vertical` entries
  in `[0, hopHeight]`, each hop rises *and* returns to 0 (a complete arc).
- `moodWalkOpts`: `excited` yields larger `range` + smaller dwell than `tired`;
  output is a function of inputs only and **never writes** mood/level (asserted
  by spying that no mood/xp setter is called).

Integration / render (snapshot via `BUDDY_FAKE_NOW`, like existing tests):

- **Invariant (horizontal):** sweeping `BUDDY_FAKE_NOW` so `WANDER_OFF` takes
  every value `0..WANDER_MAX`, **every column up to and including the bubble's
  right border is byte-identical** across all frames; only the art segment's
  leading pad changes.
- **Invariant (hop):** sweeping `WANDER_ROW` `0..hopHeight`, the bubble/stats
  rows occupy the **same rows** every frame (centered on the floor baseline);
  only the art block's vertical position changes.
- **Connector:** present only at `WANDER_OFF==0 && WANDER_ROW==0`; bubble box
  bytes unchanged whether attached or retracted.
- **Wide (§7.B):** enabling `wanderWide` shifts the bubble left by exactly
  `WANDER_LEFT` once; that shift is **identical on every tick** (offset-
  independent).
- **Resize (§7.C):** shrinking `COLS` (or `MARGIN`) below the current offset caps
  `WANDER_OFF` to the new `WANDER_MAX` on the next tick and the art never exceeds
  `COLS − WANDER_SAFETY`.
- **Gate:** `gameFeel=off|subtle` ⇒ no sequences written ⇒ offsets 0.
- **Celebration:** while `_CELEB_FRESH`, both offsets forced 0 and connector
  attached.
- **Degrade:** sequences absent (old file) ⇒ byte-identical to today;
  `bubbleMargin ≤ WANDER_SAFETY` and not wide ⇒ `WANDER_MAX=0`, no motion;
  height budget exceeded ⇒ hop headroom collapses to 0.

### Worked Given/When/Then

> **Given** `gameFeel=full`, `wanderEnabled=true`, `bubbleMargin=8`, a baked
> `wanderSequence` whose value at `NOW % len` is `3`, **When** the status line
> renders, **Then** the art block is nudged 3 cells right into the margin, the
> connector is blank, and the stats panel + bubble border occupy the exact same
> columns as at offset 0.

> **Given** `wanderHop=true`, `hopHeight=1`, and `wanderRowSequence` value `1` at
> this tick, **When** the line renders, **Then** the buddy art sits one row
> higher inside its reserved headroom, the connector is retracted, and every
> bubble/stats row is on the same line it occupies when `WANDER_ROW=0`.

> **Given** `wanderWide=true`, `bubbleMargin=8`, `WANDER_RANGE_WIDE=10`, **When**
> any tick renders, **Then** the bubble is shifted exactly 4 cells left of its
> base column on *every* tick, and the buddy ambles across the full 10-cell
> corridor.

> **Given** mood `tired`, **When** the server bakes the walk, **Then**
> `moodWalkOpts` yields range ≤ 2 with long dwell and `stepEvery=2`, so the buddy
> shuffles slowly — and the mood value itself is unchanged after the write.

> **Given** the user narrows the terminal mid-amble so `WANDER_MAX` drops to 2
> while the baked offset is 5, **When** the next tick renders, **Then**
> `WANDER_OFF` is clamped to 2 and the buddy stays fully on-screen.

---

## 10. Out of scope (this cut)

- A rubber-band / variable-length connector that follows the buddy across the
  corridor (§7.B caveat) — rejected as reading like a broken box.
- Eased (non-snapping) resize via a per-session position file (§7.C) — would add
  per-tick state the design avoids; noted as a future nicety only.
- Free 2-D path-following beyond the hop arc (e.g. the buddy leaving its lane to
  roam the whole line) — violates the lane invariant / NFR6 real-estate.
- Any *write-back* coupling where movement changes XP, stats, or mood — forbidden
  by NFR1; §7.D is strictly read-only.

---

## 11. Addendum — Free-roam supersedes the corridor (idle-RPG Phase 5)

> Added 2026-06-26 on `feature/free-roam-combat`. The
> [Phase 5 design](idle-rpg/phase-5-combat-scene.md) §3 re-architects this
> module. The right-margin **corridor** model below (§2.2, §7.B wide mode) is
> **retired**; the buddy now roams the **full span** between the stats panel and
> the window edge. This entry records what changed and why so the corridor
> sections aren't read as current.

**What changed**
- §2.2's reclaimed right-margin corridor (≤6, or ≤10 in wide mode) becomes the
  **whole span**: `SPAN = COLS − STATS_BLOCK − CLUSTER_W − RIGHT_SAFETY`. The
  fixed `MARGIN=8` right reserve shrinks to a small `RIGHT_SAFETY`.
- The **cluster travels as one block by default** — bubble + connector + sprite
  shift together (the former opt-in `wanderBubble` mode, now the default). The
  pinned-bubble / retracting-connector default is retired.
- The §10 "out of scope" line **"the buddy leaving its lane to roam the whole
  line"** is now **in scope** — the lane *is* the whole line. The NFR6
  real-estate concern is met by the in-window clamp (the cluster never grows the
  block past `COLS`), not by confining motion to a margin.
- The baked walk (§4) is now **normalized** (`0..WANDER_NORM`, percent-of-span);
  bash scales it to the live `SPAN` each tick (the server can't see `COLS`).
  `moodWalkOpts` still maps mood→restlessness; the spatial amplitude is the span.

**What carries over unchanged**
- §7.A vertical hop (`wanderRowSequence` / `HOP_RESERVE`).
- §7.C resize robustness — recomputing `SPAN` every tick is the same idea, now
  guaranteeing in-window rather than just clamping a corridor offset.
- §7.D mood/level expressiveness — strictly read-only (NFR1).
- "Server bakes, bash cycles" and the pre-baked-sequence pattern.

**Config flags removed (2026-06-30).** Because the corridor is retired, the
`wanderWide` and `wanderBubble` config flags — and the `WANDER_RANGE_WIDE`
constant and the `wide`/`bubble` args on the `buddy_wander` MCP tool — have been
**deleted** from the code. They no longer matched behavior: `wanderBubble` was a
no-op (the bubble always travels now) and `wanderWide` only widened the baked
range while reporting a "corridor" that no longer exists. Roam distance is now
governed solely by `moodWalkOpts` (§7.D) clamped to `SPAN`. The §7.B / §5e
sections below are historical.

**Still out of scope:** per-session position file for eased resize; write-back
coupling; free *2-D* path-following beyond the hop arc.

### 11.1 — Dynamic bubble sizing (fit-to-width, 2026-07-13)

The speech bubble now adapts its **size and shape** to the room the cluster has
in the current terminal, rather than being a fixed `bubbleWidth` box that the
in-window clamp dropped whole the moment it didn't fit. Purely bash-side (only
bash knows `COLS`), computed once per tick just before the word-wrap, sharing the
same cluster-geometry terms as the layout clamp so a kept bubble is guaranteed
in-window. `INNER_W` is chosen against `FIT_INNER = COLS − STATS_BLOCK −
RIGHT_SAFETY − ART_W − CONNECTOR_W − 4` (box chrome is 4 cols):

- **Shrink** — when the configured width won't fit, narrow `INNER_W` to
  `FIT_INNER` so the same text wraps to more, shorter rows (the box gets taller).
- **Grow** — when a single word is wider than the configured box, widen `INNER_W`
  to that word (up to `FIT_INNER`) so it never spills past the border. A word
  can't wrap inside itself, so the box's floor is `max(8, widest word)`.
- **Drop** — only when even that narrowest usable box won't fit; the sprite (the
  rightmost, most important element) stays visible. This is the same
  sprite-visibility-wins rule the old binary drop enforced, now the last resort.

Recomputed every tick, so a resize — or the same global buddy showing up in a
wider window — re-grows the bubble back toward `bubbleWidth` when the room
returns (§7.C resize robustness, extended to the bubble's own dimensions). The
layout section's drop check is kept as a defensive backstop but no longer the
primary path.

**Incidental fix:** `dwidth()` measured text via `od -An -tu4`, which collapses
runs of ≥16 identical codepoints into a `*` line — so any bubble text with a long
repeat (e.g. `!!!!!!`, `hmmmmmm`, a long token) was under-measured, mis-wrapping
and mis-padding the box. Added `od -v` to disable the collapsing; the fix matters
more now that a lone word's measured width drives the grow/drop decision.
