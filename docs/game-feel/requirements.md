# Requirements Brief — "Game-Feel" Quick Wins

Status: Requirements only (output of `/sc:brainstorm`). No architecture or
implementation decisions made here — see Next Step.

Branch: `feature/leveling-system`. Builds on the shipped leveling system,
additional-rewards system, and the partially-shipped emotion-animations plan.

---

## Goal

Make claude-buddy *feel* more like a game — more juice, more reasons to come
back, more to collect, more surprise — **without** adding mechanical power.
Every reward in this round is visual/identity only: zero impact on XP rate,
stats, or balance. Each item layers onto an existing system so it's shippable
on `feature/leveling-system` without new infrastructure.

Scope decisions made during discovery:

- **Dimensions:** all four — visual juice/animations, goals & challenges, new
  progression/collection, surprise & discovery.
- **Power philosophy:** stay cosmetic/flavor only (hold the codebase's stated
  "flavor, not power creep" line).
- **Appetite:** quick wins on the current branch — small, additive, shippable.

---

## Scope guardrails (non-functional requirements)

- **NFR0 — The work is sacred.** *(Highest priority — gates every other
  requirement.)* The buddy is ancillary to the developer's primary task and may
  never compromise focus. No game-feel element interrupts at a cost: nothing
  steals the glance during an error spike, and anything that animates or toasts
  must be subordinate, brief, and silenceable. When in doubt, do less. See
  FR-E1 (intensity dial) for the user-facing control this principle requires.
- **NFR1 — Flavor only.** No new XP/stat multipliers or gameplay advantages.
  Collection "bonuses" are titles/cosmetics, not numbers.
- **NFR2 — Terminal-native.** Animation = tick-based frame cycling
  (`frames`/`frameSequence` in `status.json`) + transient timestamp-gated
  toasts (the existing `+N XP` mechanism). No reliance on anything the status
  line can't render per-prompt.
- **NFR3 — Backward-compatible state.** New fields on `xp.json` /
  `status.json` / new small JSON files must backfill cleanly (follow
  `backfillXpState`'s pattern); a fresh install and a version-skewed old state
  both render without throwing.
- **NFR4 — Best-effort, never breaks the core.** Like `fireLoot`, any new
  delighter swallows its own failures — a quest or animation glitch must never
  break XP awarding or the status line.
- **NFR5 — Tested.** Each item ships with `bun test` coverage (render/timing/
  backfill) and stays `tsc --noEmit` clean.
- **NFR6 — Status-line real-estate budget.** The status line is a message with a
  hierarchy, not a dashboard. Every element competes for one glance (name,
  stars, mood, title, badge, stat panel, XP bar, metrics — already crowded).
  New surfaces must declare their priority and prefer *transient* presentation
  over permanent chrome; the celebration channel (one bubble line) is favored
  over adding rows. No net increase in always-on elements without removing one.
- **NFR7 — Graceful degradation.** Game-feel must degrade cleanly in
  no-color / narrow-width / non-interactive / screen-reader / shared-screen
  contexts: emoji and animation fall back to plain text or nothing, never
  garbled output. Honor the existing width helpers (`displayWidth`,
  `emoji-widths.data`).

---

## Functional requirements by dimension

### A. Visual juice / animations

*Builds on emotion-animations step 1 (server bakes frames, bash cycles) + the
toast mechanism.*

- **FR-A1 — Level-up celebration toast.** When `levelUpAchieved` flips true,
  surface a transient `✨ LEVEL N ✨` toast (~10s) in the status line, then
  `clearLevelUpFlag`.
  *Acceptance:* toast appears once per level-up, expires on its own, never
  persists across sessions. *(S)*
- **FR-A2 — Loot reveal toast.** When `rollLoot` yields a drop, show a
  transient `🎁 <item>` toast.
  *Acceptance:* fires at all 4 existing loot sites; no toast on an empty roll.
  *(S)*
- **FR-A3 — Ascension flourish.** A one-shot celebratory bubble line + brief
  frame flourish on `ascend()`.
  *Acceptance:* shows once per ascension; reuses existing frame-cycle, no new
  art pipeline. *(S)*
- **FR-A4 — Emotion animations, scoped to the active species only.** Finish
  emotion-animations steps 2–4 but **only for the buddy's current species**
  (not all 18 — 162 frames is not a quick win). Reasons mapped: `pet→happy`,
  `error→angry`, `idle→bored`.
  *Acceptance:* active buddy shows emotion frames on those events; other
  species fall back to neutral idle; emotion clears on `reactionTTL` expiry.
  *(M)*

### B. Goals & challenges

*New tiny `quests.json`; surfaces via `buddy_xp` + status line.*

> **Strategic-review reframe (panel debate, resolved):** the original "daily
> quest + streak" framing imports gamification's failure mode — extrinsic goals
> crowding out the intrinsic companion job, metric-gaming ("commit 3×" →
> junk commits), and streak-anxiety in a tool that should *reduce* cognitive
> load. The de-coerced version below keeps the return-loop while defusing the
> dark pattern.

- **FR-B1 — "Today's whim" (de-coerced daily).** Once per local day the buddy
  *offers* one optional, in-character suggestion from a small pool (e.g. "feel
  like landing a few commits today?"). **No streak, no punishment, no shame
  bar, no FOMO** — missing a day is frictionless and silent. Tracked in
  `quests.json`, resets at local midnight.
  *Acceptance:* the whim text (and quiet progress if relevant) is visible in
  `buddy_xp`; absence of activity is never surfaced as failure; survives
  restart same day; clean midnight rollover. *(M)*
- **FR-B2 — Whim completion = quiet delight.** Fulfilling the whim fires a
  single loot roll (existing system) + one celebration-channel message — no
  direct stat/XP bonus beyond loot, and **no escalating reward for "keeping it
  up."**
  *Acceptance:* reward fires exactly once; re-opening a completed day re-grants
  nothing; nothing tracks or rewards consecutive completions. *(S)*
- **FR-B3 — Progress-bearing achievements.** Show `n/target` progress on
  countable achievements in the achievements view instead of binary locked/
  unlocked.
  *Acceptance:* in-progress achievements render a progress fraction; already-
  earned ones unchanged. *(S)*

### C. New progression / collection

*Uses `cosmeticFlags`, hats, menagerie — no new mechanics.*

- **FR-C1 — Cosmetic sets.** Group existing cosmetics into named sets (e.g.
  "Arcane" = wizard hat + glow + constellation). Completing a set grants a
  flavor **title** only.
  *Acceptance:* set progress shows in `buddy_xp`/`buddy_list`; completion
  grants an equippable title, no multiplier. *(S–M)*
- **FR-C2 — Seasonal/dated cosmetic.** A cosmetic flag that only renders inside
  a date window (e.g. a festive hat in late December).
  *Acceptance:* renders only within the window; absent otherwise; no migration
  breakage off-season. *(S)*
- **FR-C3 — Buddy growth/age tell.** A purely visual change keyed to
  days-since-hatch (e.g. a subtle marker at 7/30 days).
  *Acceptance:* visual only, derived from existing hatch timestamp, no stat
  effect. *(S)*

### D. Surprise & discovery

*Extends `loot.ts` pool + reaction/idle paths.*

- **FR-D1 — Expanded loot pool.** Add rare **cosmetic-only** drops to the
  6-item pool.
  *Acceptance:* new drops are cosmetic flags/flair, never points/multipliers;
  rarity weighting keeps them rare. *(S)*
- **FR-D2 — Rare idle event.** Low-probability "the buddy does something
  unexpected" bubble during idle ticks.
  *Acceptance:* probability low enough to feel special (not spammy); cosmetic
  text only. *(S)*
- **FR-D3 — Easter egg unlock.** A hidden trigger (e.g. calling the buddy's
  name N times, or a secret subcommand) unlocks a hidden cosmetic.
  *Acceptance:* undiscoverable by accident-spam; grants a cosmetic flag once;
  idempotent. *(S–M)*
- **FR-D4 — "Shiny" variant at hatch.** Very-low-odds cosmetic variant marker
  on new companions (à la shiny Pokémon).
  *Acceptance:* purely a visual marker recorded at hatch; no stat/rarity-tier
  change. *(S)*

### E. Companion, sharing & control *(added by strategic review)*

*The panel found the original four dimensions optimize the **mechanical** job
(toasts/loot/quests) while under-serving the **emotional** job (a companion that
witnesses your work) and the **social** job (something worth sharing) — and that
those are the real differentiator and the only infinite well. This dimension
fills those gaps and adds the control NFR0 demands.*

- **FR-E1 — Game-feel intensity dial.** A global control —
  `off / subtle / full` — for all game-feel output (toasts, animations, whims,
  badges), defaulting **conservative** (matches the existing `showStats:false`
  posture). Optional stretch: auto-quiet during detected deep focus / error
  spikes. This is the user-facing expression of NFR0 and the system's missing
  balancing loop.
  *Acceptance:* `off` fully silences new game-feel without affecting core
  XP/state; default is unobtrusive; setting persists in `config.json`. *(S–M)*
- **FR-E2 — Shareable brag card.** A `/buddy brag` (or `buddy_show`-adjacent)
  command that emits a paste-able ASCII/markdown card — buddy art + name +
  level/prestige + a milestone line — sized for a PR comment, Slack, or socials.
  *Highest-leverage growth feature: turns private delight into word-of-mouth for
  an OSS tool.*
  *Acceptance:* output is copy-paste clean (no raw ANSI) and renders in common
  surfaces; no private data leaked; works offline. *(M)*
- **FR-E3 — Memory-narrated milestones.** Reuse the existing memory/reaction
  system so the buddy occasionally references *shared history* ("we've squashed
  100 bugs together", "remember that 3am merge?") rather than only generic
  flair. *The compounding, never-exhausted well — the more you use it, the more
  it has to say.*
  *Acceptance:* callbacks are drawn from real recorded history; degrade silently
  when history is thin (fresh install); flavor only. *(M)*
- **FR-E4 — Self-announcing discovery.** New systems (loot, whims, sets) are
  surfaced by the buddy *transiently in-character* via the celebration channel,
  then vanish — discovery without adding permanent status-line chrome (honors
  NFR6).
  *Acceptance:* each system announces itself at most once; no persistent UI added
  for discovery. *(S)*

---

## Recommended quick-win starter set

Re-prioritized after the strategic review — control and shareability now lead,
because they gate (NFR0) and grow (word-of-mouth) everything else:

1. **FR-E1** — intensity dial + conservative defaults. *Ships first: NFR0
   requires the off-switch to exist before anything interrupts.*
2. **FR-A1, FR-A2** — instant celebratory feedback, reuse the celebration
   channel (now gated by FR-E1).
3. **FR-E2** — shareable brag card. *Highest growth leverage for an OSS tool.*
4. **FR-D1** — more loot variety, trivial.
5. **FR-B1 + FR-B2** — the de-coerced "Today's whim" return-loop.
6. **FR-E3 / FR-A4** — the "witness" job (memory callbacks) + emotion frames.

Everything else is additive whenever.

---

## Open questions — all resolved

1. **Whim reward (FR-B2):** ✅ **loot roll only** — no whim-exclusive cosmetic.
2. **Whim cadence (FR-B1):** ✅ **daily only**, non-coercive.
3. **Shiny variant (FR-D4):** ✅ the 1% hatch roll already exists; FR-D4 is
   "mark + announce it," no backfill.
4. **Easter egg (FR-D3):** ✅ trigger = **name called 10×**.
5. **Seasonal (FR-C2):** ✅ **a small multi-occasion list** (lowest priority —
   dated content is a fragile maintenance tail).
6. **Brag card scope (FR-E2):** ✅ **default markdown** (PR/Slack) primary,
   `plain` is the opt-in.
7. **Intensity default (FR-E1):** ✅ **`subtle`** for fresh and upgrading users.

---

## Next step

This is requirements only. When ready:

- `/sc:design` — architect the chosen items (state shape, render wiring, frame
  data).
- `/sc:workflow` — sequence the starter set into commits.

Pick the FRs that make the cut and hand off to one of the above.

---

## Appendix — Strategic Review (business panel synthesis)

Source: `/sc:business-panel` (Drucker, Christensen, Godin, Meadows, Taleb,
Doumont, Kim & Mauborgne, Collins). Framing: claude-buddy is a free, local,
privacy-first companion *inside* a developer's active workflow — so "value" =
felt experience mid-work, "market" = OSS word-of-mouth, and there is no
telemetry (success is qualitative, not dashboarded).

### Panel consensus
1. **The work is sacred** — no game-feel may compromise focus (→ NFR0).
2. **Restraint > addition** — extend the product's existing opt-in discipline
   (`showStats:false`, `reactionTTL`, mute, cooldowns) to every new element
   (→ FR-E1, NFR6).
3. **The emotional "witness" job is the real differentiator and the infinite
   well** — mechanics (loot/quests) are table stakes (→ FR-E3).
4. **No sharing surface = the biggest growth gap** for an OSS tool (→ FR-E2).
5. **Strip coercion from dailies/streaks** (→ FR-B1/B2 reframe).

### Gap checklist → where addressed
| Gap | Lens | Now addressed by |
|---|---|---|
| No "never distract" principle / off-switch | Drucker, Taleb | **NFR0, FR-E1** |
| No sharing / virality surface | Godin, Kim&Mauborgne | **FR-E2** |
| Emotional "witness" job under-served | Christensen, Collins | **FR-E3** |
| Dailies risk coercion / FOMO / metric-gaming | Taleb, Meadows | **FR-B1/B2 reframe** |
| No status-line hierarchy / budget | Doumont | **NFR6** |
| No graceful degradation spec | Doumont, Taleb | **NFR7** |
| No discovery path (without clutter) | Godin, Doumont | **FR-E4** |
| Collection is finite → flywheel stalls | Collins | **FR-E3** (infinite well) |
| Seasonal = fragile maintenance tail | Taleb | OQ5 (de-prioritized) |

### ERRC grid (value innovation)
- **Eliminate:** streak-guilt and any absence-punishment; redundant numeric chrome.
- **Reduce:** toast/animation frequency; status-line density; the *mechanical*
  emphasis of quests.
- **Raise:** genuine personality & surprise; user control over intensity;
  graceful degradation.
- **Create:** shareable brag card (FR-E2); memory-narrated milestones (FR-E3);
  intensity dial (FR-E1); "Today's whim" (FR-B1); self-announcing discovery
  (FR-E4).

### Debate resolved
*Should daily quests ship at all?* — Yes, but **de-coerced**: ship the *offer* of
a daily ("Today's whim"), not the obligation. No streak, no punishment, no shame
bar. Preserves the return-loop; removes the dark pattern. (See FR-B1/B2.)
