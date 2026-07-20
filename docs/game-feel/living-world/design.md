# Living-World Arc — Design

_Drafted 2026-07-17 · branch `feature/interactive-fight-scene` · baseline 844
tests, all pass._
_Status: **Arc complete (2026-07-20) — P4 implemented (2026-07-20); P2
implemented (2026-07-20); P1 implemented (2026-07-18); P0 measured
(2026-07-18) — Task 10 dropped, see P0 findings below. P3 (idle economy —
expeditions) was never implemented: deprioritized in favor of jumping
straight to P4, no plan doc was ever written for it, and
`server/expedition.ts` does not exist. The arc closes here, at four of its
five originally-designed phases — see
[CURRENT-STATE.md's P4 section](../CURRENT-STATE.md#living-world-arc--p4-world-dressing-2026-07-20)
for the full e2e verification.**_

One cohesive, phased expansion across three threads the user asked for
together: **more idle-RPG features, more interactive animations/scenes, more
dynamic buddy movement.** Capability-first: the motion vocabulary is built
before the content that spends it, so every later feature inherits it —
the same reason the sprite-animation round-1 P0 (shared FX primitives) paid
off in round 2.

---

## Resolved design decisions

All resolved with the user during brainstorming, 2026-07-17:

| # | Question | Decision |
| --- | --- | --- |
| D1 | What's missing? | All three threads, as **one arc** |
| D2 | Organizing spine | **Layered, phased** — movement → encounters → economy → world, each independently shippable (no single fiction) |
| D3 | Interactivity level | **Reactive spectacle** — scenes stay autonomous and react to coding events (errors, commits, pets, absence). No mid-scene choices, no new play verbs |
| D4 | Row budget | **Zero new rows.** Idle silhouette keeps today's height; FX use the existing overlay/emote row mechanism (paid only when active); scenes stay within the current combat-scene envelope |
| D5 | Sub-second tick | **In scope as P0** — measure the harness refresh ceiling first; implement only if the ceiling allows; drop cheaply otherwise |
| D6 | RPG feature set | All four: boss bugs, wild buddy visitors, expeditions, gear-economy round-out |
| D7 | Movement feature set | All four: mood gaits, prop interaction, edge/panel awareness, event choreography |
| D8 | Arc structure | **A: capability-first** (over payoff-first and vertical slices) |
| D9 | Boss geometry | Zero-rows ⇒ the boss reads bigger via **width, not height** |
| D10 | Visitor recruitment | **Out of scope** — visitors may drop items/XP; recruitment touches the companion-store lifecycle and deserves its own arc |
| D11 | Stinger vs flourish collision | Priority ladder picks **one** (no queueing): combat scene > stinger > flourish > idle |
| D12 | Boss lifecycle | A boss does **not** survive `startSession` — lifecycle consistency (G5) over drama; multi-commit sessions resolve most bosses naturally |
| D13 | Boss entry | **Deterministic by threshold**, never rolled — a boss is earned |
| D14 | Angry gait/emote vs auto-quiet spike clamp | Exempt — the angry idle expression reads the **configured** level (sightBug precedent): an error-born expression must survive the clamp the error causes. Found by Task 9's e2e; the clamp made angry+full unsatisfiable |

---

## Standing constraints (all inherited, none new)

1. **Server bakes, bash cycles.** Every new motion is a baked frame/offset
   sequence in `status.json`; the shell stays a dumb `NOW % len` cycler. Goal:
   zero `buddy-status.sh` changes in the whole arc **except** the one P0
   sanctions (sub-second indexing, if the measurement supports it).
2. **Pure seeded cores.** All new randomness (gait variation, visitor rolls,
   boss stage outcomes, expedition results) comes from injected seeds; cores do
   no I/O or clock reads. Thin wrappers persist.
3. **Zero new rows** (D4). No new permanent vertical cost anywhere.
4. **One gate.** Everything consults `effectiveGameFeel()`: scenes/motion are
   `full`-only, toasts surface at `subtle`, `off` is a true opt-out — the new
   event kinds (visitor, expedition, boss) are not even *resolved* at `off`,
   matching combat today. The standoff's auto-quiet exemption carries over to
   the boss standoff (it exists *because* of errors); every other new producer
   respects the clamp (the angry idle expression shares the standoff's
   exemption, D14).
5. **Zero per-event cost.** All new rolls/accrual ride existing write moments
   (award-xp events, `session_complete`, `session_start`). Nothing touches the
   per-keystroke path.
6. **Constant width AND height per flipbook.** The no-jitter guarantee extends
   to every new scene family.
7. **Zero new config keys.** Everything gates on `gameFeel` + existing
   toggles. `TICK_MS` (if P0 lands) is baked data in `status.json`, not
   config — users don't tune frame timing.
8. **Guarded writes.** New subsystems enter `writeStatusState` behind the
   lazy-require + try/catch pattern; all new state files are atomic
   (tmp+rename) and registered in `TRANSIENT_PREFIXES`.

---

## Phase map

| Phase | Name | Contents | Ships when |
| --- | --- | --- | --- |
| **P0** | Tick ceiling | Measure CC's statusline re-invocation cadence; sub-second frame indexing only if warranted | Findings documented; ms path (if any) snapshot-clean |
| **P1** | Movement vocabulary | Mood gaits, event choreography (stingers), edge/panel awareness | Gaits + ≥3 stingers render e2e |
| **P2** | Encounter variety | Boss bugs (multi-stage), wild buddy visitors | Boss lifecycle + visitor scene e2e |
| **P3** | Idle economy | Expeditions, gear-economy round-out | Expedition e2e + sell/delta/cap live |
| **P4** | World dressing | Ground props + prop interaction, time/season flavor, weather FX | Props blank-cell-verified, e2e |

Each phase leaves the full suite green, `tsc --noEmit` + `bash -n` clean, and
render snapshots byte-identical where the phase claims no visual change.

---

## P0 — Tick ceiling

**Question:** how often does Claude Code actually re-invoke `buddy-status.sh`,
and is the cadence steady enough to animate against? The cycler indexes on
whole seconds, so a faster repaint is currently wasted.

**Measurement (throwaway, one sitting).** A logging shim prepended to the real
script appends a high-resolution timestamp (`$EPOCHREALTIME`, falling back to a
`python3` fork — it's a throwaway) per invocation. Capture three regimes:

1. active conversation (streaming),
2. idle with terminal focused,
3. idle, unfocused.

The number that matters is the **idle cadence** — that's where wander/gait
animation lives. Record jitter, not just the mean: a 300 ms mean with 2 s gaps
still argues for 1 s indexing. Deliverable: a **P0 findings** subsection added
to this doc.

**Decision gate.** Implement sub-second indexing **only if** the idle ceiling
is reliably < 1 s:

- Frame index becomes `(now_ms / TICK_MS) % slen`. Millisecond time without
  forks needs bash ≥ 5 (`$EPOCHREALTIME`); macOS ships 3.2, so the script
  feature-detects — ms path when available, otherwise the existing seconds
  path, byte-identical to today. No new forks on either path. This is the one
  sanctioned `buddy-status.sh` change in the arc.
- `TICK_MS` is baked per-sequence by the server (constraint 7).
- The render-snapshot suite pins the seconds path; the ms path is tested by
  injecting `EPOCHREALTIME`.

**Non-goals.** The script never self-loops, backgrounds, or otherwise fakes a
faster tick; if CC won't repaint faster, the arc proceeds at 1 fps and every
later phase must read well there anyway (slow-repaint sessions exist
regardless). If measurement shows idle repaints are event-driven only, that
finding is documented as a "how is wander even working" note — no redesign in
this arc.

### P0 findings (measured 2026-07-18)

Shim-logged 2,457 real invocations across active + idle use (perl
ms-timestamps, deltas bucketed; 8 session gaps >10s excluded):

| Bucket | Share | Shape |
| --- | --- | --- |
| 0.9–1.1s "heartbeat" | 64.9% | mean **0.9954s ± 21ms**; longest uninterrupted run **455 ticks (~7.5 min)** — this is the idle regime |
| <0.9s "event bursts" | 34.9% | mean 0.42s, scattered — streaming/tool activity only |
| >1.1s stalls | 0.2% | negligible |

The 1.000s idle cadence is not an accident of this machine — it is the
**platform floor**. Per the official statusline docs: `refreshInterval`
"re-runs your command every N **seconds** … **the minimum is 1**", and
event-driven updates (assistant messages, mode changes) are debounced at
300ms but go quiet at idle. So sub-second repaints exist only during
activity, never in the idle regime where all wander/gait animation lives.

**Task 10 gate: FAIL — permanently.** Sub-second indexing cannot buy idle
animation anything; Task 10 is dropped (not deferred). The arc stays at
1 fps by design, which every P1 sequence was already built to read well at.

**Load-bearing side-finding:** `statusLine.refreshInterval: 1` is what keeps
idle animation alive at all — without it the statusline only repaints on
conversation events and the buddy would freeze between messages. The installer
already sets it (`setBuddyStatusLine` in `state.ts`, `cli/install.ts`, pinned
by `statusline.test.ts`), but this measurement upgrades its status from
"sensible default" to **hard requirement**: removing it silently kills every
wander/gait/scene animation at idle.

---

## P1 — Movement vocabulary

All in `wander.ts` + `art.ts` + `state.ts` bake paths; zero shell changes.

### 1. Mood gaits

`moodWalkOpts` grows from step-range numbers into **gait profiles**, keyed by
the emotion `resolveEmotion` already computes (a second read of a decision
already made — the emote-row trick):

| Emotion | Gait |
| --- | --- |
| `bored` | long dwells (4–8 tick pauses), single-cell shuffle |
| `happy` | 2-cell skip steps + a paired body-bob frame (eye/torso variant, glance-style — no new rows, no new art dependencies) on step ticks |
| `angry` | tight-span rapid pacing, direction flip every 2–3 ticks |
| `surprised` / `neutral` | today's amble, unchanged — a neutral buddy pays nothing |

`buildWanderSequence` bakes offsets **plus a parallel frame-pick sequence**, so
gait and body frame stay in lockstep by construction. Seeded from the existing
wander seed.

### 2. Event choreography — stingers

One-shot movement arcs triggered by events. Initial kinds: **victory-lap**
(fight won: two quick passes), **loot-dash** (drop: dart out + inspect pause),
**walk-on** (session start: enter from the edge to home position — reused by
P3 as the expedition return), and **startle** (first error — different
vehicle, see below).

- **Playback = a phase-anchored arc spliced into the wander track**
  (planning finding, supersedes the earlier "flourish-slot TTL" idea): the
  shell *suppresses* wander offsets while a celebration is fresh or a scene
  is on (the `$celeb_fresh`/`$combat_on` gates), so motion riding the
  flourish slot would never render. Instead the server — which knows
  wall-clock at bake time — splices the arc into `wanderSequence` at the
  index the shell's `NOW % len` will reach *just after* the freshness window
  lapses (`(now + delay) % len`). The toast and per-kind flourish eyes play
  during freshness; the motion follows as the toast fades. Zero shell
  changes, no TTL coupling. Walk-on anchors immediately — its write carries
  no celebration, so wander renders from the first tick.
- Flourish eye-cycles still ride the flourish slot per celebration kind
  (round-2 machinery, unchanged). Collision priority (D11) stands:
  **combat scene > flourish > idle**, with stinger *motion* living outside
  the ladder entirely (it's just wander data).
- **Startle** (self-review finding, revised at planning): the first error
  both fires the startle and sights the bug, and the pending scene would
  bury any idle-side animation. Instead the startle is **baked into the
  pending flipbook itself** — a short startled pose (player `O` eyes, the
  dodge-eye precedent) at the head of the standoff loop, so "recoil, then
  face the enemy" is the scene's own opening beat (and recurs each loop as a
  re-glare, matching the periodic bout grammar). No surface-at delay, no
  lifecycle change; auto-quiet and `subtle` behave exactly as today.

### 3. Edge & panel awareness

The server doesn't know `COLS`, so edge behavior is baked as **intent at roam
extremes**: when a baked offset sits at the sequence's own max/min, the paired
frame-pick selects a lean/peek variant (posture via eye-row substitution). The
shell clamp lands "extreme" at the window cushion — visually the edge. The
left-extreme peek-over-the-stats-panel variant is chosen at bake time from
`showStats` (an input `state.ts` already reads). No layout knowledge leaks
into the shell.

### P1 testing

Determinism + range/clamp units per gait profile; stinger length/TTL
consistency; priority-ladder units; real-shell e2e for one gait, one stinger,
one lean frame; constant-width/height assertions on every new flipbook.

---

## P2 — Encounter variety (implemented 2026-07-20)

### 1. Boss bugs

- **Trigger (D13):** when the standoff's `combatErrorCount` crosses
  `BOSS_THRESHOLD` (≈ 12+ error-ish events — well past tier-3), the pending
  encounter upgrades to `kind: "boss"`. Deterministic, never rolled.
- **Multi-stage:** 2–3 stages (tier-scaled). Each commit fights **one stage**
  through the existing seeded `resolveCombat`: win clears a stage, flee clears
  nothing. The standoff persists between stages; progress renders in the
  caption row the scene already owns: `BOSS in <project>! ▰▰▱`. Buddies never
  die.
- **Sprite (D9):** 2–3 dedicated **wide** boss art pieces within today's scene
  height, through the same mirrored-composite machinery. Stage transitions
  reuse stinger grammar (boss recoils on a stage loss).
- **Reward:** final stage guarantees a rare+ drop plus a one-time badge; XP
  scales with stages.
- **Lifecycle (D12):** same `pending-encounter.json` file, same G5 invariant —
  commits fight, `startSession` clears an orphan. An abandoned boss dies
  quietly with the session.

### 2. Wild buddy visitors

- **Roll:** seeded, at `session_complete` only (zero-per-event holds), odds
  ≈ 1/12, **suppressed entirely** while any encounter is active or fresh —
  combat outranks a social call.
- **Scene:** a random *other* species walks on (mirrored; shiny at the usual
  odds), plays a short greet or friendly-spar flipbook — bout machinery with a
  `♥`/`✦` pop instead of damage — then walks off. TTL ≈ 15 s, like the
  resolved fight. `subtle`: toast only ("a wild goose stopped by — left
  5 XP").
- **Reward:** ~25 % chance of a small drop (points or a common cosmetic via
  the existing loot table) or token XP; the toast names it.
- **Module boundary:** new `server/visitor.ts` (pure core + bake), importing
  `composePose`/`mirrorFrame` from `art.ts`. `combat.ts` grows only the boss.

### P2 testing

Boss lifecycle units (spawn → stage win → stage flee → final clear → orphan
clear); visitor roll determinism + suppression matrix (vs standoff, vs
resolved scene, vs `off`/`subtle`); render e2e for a boss frame and a visitor
greet; constant-width/height across both flipbook families.

---

## P3 — Idle economy

### 1. Expeditions — absence is the adventure

No timers, no background processes; the buddy "was away" exactly when the
user was:

- `session_complete` persists `lastActivityAt`. At the next `session_start`,
  a gap ≥ ~4 h resolves a **seeded expedition retroactively**: destination and
  outcome rolled from the gap, yielding XP, occasionally a loot-table drop,
  and a one-line story toast — "Waffle trekked the Lint Wastes — found a foam
  sword! +30 XP." Flavor from a small seeded destination/outcome table.
- **Hard cap** on credited gap (~24 h) — the PATIENCE runaway-bank lesson
  applied at design time: unbounded elapsed-time input never feeds an
  accumulator.
- The P1 **walk-on stinger is the return scene** (capability-first payoff).
- Gates: `off` never resolves an expedition; `subtle` toast; `full` toast +
  walk-on. An idempotency marker (persisted resolved-at) prevents
  double-resolution.

### 2. Gear-economy round-out

Exactly the three standing backlog items, no more:

1. **Sell gear** at 50 % of price (merchant-menu addition via the existing
   `kind:"choice"` nav channel),
2. **gear-bonus delta** shown in `buddy_xp`,
3. soft **inventory cap** that surfaces the sell option when full.

No item tiers/upgrading — economy sprawl this arc doesn't need.

### P3 testing

Expedition units (gap math incl. cap, determinism, idempotency, gate matrix);
sell/refund round-trip + cap units; e2e: fake `lastActivityAt` → session start
→ toast + walk-on through the real award path.

---

## P4 — World dressing (implemented 2026-07-20)

> **Shipped.** All four bullets below landed across Tasks 1-6 (`server/art.ts`
> `PROP_ANCHORS`/`applyProp`/`applyPropKicked`, `server/props.ts` new pure
> module, `server/wander.ts` `stingerInspectOffsets`, `server/state.ts`
> wiring), e2e-verified through the real shell in a throwaway profile
> (Task 7). Full writeup, the exact rendered verification, and the Task 4
> two-round fix saga:
> [CURRENT-STATE.md §Living-world arc — P4 world dressing](../CURRENT-STATE.md#living-world-arc--p4-world-dressing-2026-07-20).

Zero-rows shapes this hard: **there is no scenery layer** — only things that
live inside blocks that already exist.

- **Props travel with the buddy** inside the baked art frames (a pebble a
  couple of cells ahead, a daily-seeded sprout/mushroom by its feet) under the
  `applyGear` contract — **blank-cells-only, verified across all frames** — so
  props never flicker or clobber body pixels, and ANSI rows are refused
  (wyvern rule).
- **Prop interaction:** the pebble's baked cell advances on step ticks (a kick
  as the buddy ambles); the loot-dash stinger gains an inspect beat over a
  dropped item glyph.
- **Time/season flavor:** the prop set/palette varies by time-of-day and
  season, sampled at bake time. Stale-until-next-event is acceptable and
  already true of everything baked.
- **Weather FX:** a sparse overlay-row effect — drizzle during a rough error
  streak, drifting sparkles during a clean streak — existing overlay-row
  mechanism, present only when active (emote-row precedent).

### P4 testing

Blank-cell anchor verification across all species/frames (the `GEAR_ANCHORS`
test pattern); prop determinism per day-seed; weather gating units; real-shell
e2e with props + gear + hat simultaneously (the crowded-sprite worst case).

---

## File/module impact summary

| File | Change |
| --- | --- |
| `server/wander.ts` | gait profiles, frame-pick sequence |
| `server/art.ts` | stingers, lean/peek variants, prop compositor |
| `server/combat.ts` | boss kind, stages, wide art |
| `server/visitor.ts` | **new** — visitor core + bake |
| `server/expedition.ts` | **new** — expedition core + resolve |
| `server/state.ts` | priority ladder entry, guarded wiring |
| `server/session.ts` / `award-xp.ts` | roll/resolve call sites on existing verbs |
| `statusline/buddy-status.sh` | **P0 only**, if the gate passes |

## Deferred / out of scope

- Visitor **recruitment** (D10) — own arc if ever.
- Item tiers / gear upgrading.
- New play verbs or mid-scene choices (D3).
- Any new config keys.
- Sub-second tick beyond what P0's measurement justifies.
