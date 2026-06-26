# Design — "Game-Feel" Quick Wins

Status: Design (output of `/sc:design`). Implements the FRs in
[`requirements.md`](./requirements.md). No production code here — type/signature
sketches are interface design only; build with `/sc:implement`.

Grounded against actual source as of `feature/leveling-system`:
`server/{state,xp,loot,streak,achievements,art,session,award-xp,memory,index}.ts`
and `statusline/buddy-status.sh`.

> **Revision 1 (strategic review folded in):** adds the **intensity gate**
> (FR-E1) as the cross-cutting control NFR0 demands, the **brag card** (FR-E2),
> **memory-narrated milestones** (FR-E3), and **self-announcing discovery**
> (FR-E4); re-specs the daily quest as the de-coerced **"Today's whim"**
> (FR-B1/B2); and threads NFR6 (real-estate budget) / NFR7 (graceful
> degradation) through the principles.
>
> **Revision 2 (spec-panel review folded in):** adds **§2.6 Concurrency & write
> contract** (atomic `status.json`, `react.sh` preserves `.celebration`,
> single-slot last-write-wins, multi-session decision) and **§2.7 Tunables**
> (every constant pinned); refactors `writeStatusState` to an **options object**
> + pure helpers; scopes the loot `lastDrop` poll by **`cause`**; adds **worked
> Given/When/Then examples** and concurrency/edge-case tests; resolves the
> upgrade-default and `sets.ts`-placement questions.

---

## 1. Design principles (trace to NFRs)

- **The gate comes first (NFR0 + FR-E1).** A single `config.gameFeel`
  (`off | subtle | full`) is read by *every* producer (TS and bash) before it
  emits a toast, frame, whim, rare-idle, or callback. `off` silences all
  game-feel and touches no core XP/state. This is the system's balancing loop —
  build it before anything that interrupts (§2.5).
- **One transient-message channel, many producers (NFR2 + NFR6).** Don't invent
  a render path per celebration. A single `celebration` field on `status.json`
  rides the **always-rendered speech bubble**; A1/A2/A3, B2, D4, E4 all write to
  it. Favoring this one line over new status-line rows *is* the NFR6
  real-estate discipline.
- **Additive, lazy, swallowed (NFR4).** New cross-module reads use the existing
  lazy-`require` + `try/catch` pattern (`writeStatusState`, `fireLoot`,
  `renderXpCardMarkdown`). A quest/animation/memory failure must never break XP
  or the status line.
- **Backfill every new persisted field (NFR3).** New `status.json` fields are
  optional `writeStatusState` params defaulting to `null`/absent; bash reads
  them with `// <default>` jq fallbacks (how `xpPct`/`lastXpGain` were added).
  New JSON files load through a `backfill`-style loader.
- **Degrade cleanly (NFR7).** Every emoji/animation has a plain-text or empty
  fallback; widths go through `displayWidth`/`emoji-widths.data`; the brag card
  emits a no-ANSI variant.
- **No numbers that matter (NFR1).** Every reward is a `cosmeticFlag`, a title,
  a bubble message, or a frame. Nothing touches `XP_RULES`, multipliers, `stats`.

---

## 2. Why a shared "celebration channel"

Today the only transient toast is `+N XP`, rendered at
`buddy-status.sh:332-353` — **inside the `showStats` stats-panel branch**. With
the stats panel off (the default, `DEFAULT_CONFIG.showStats = false`), level-ups
and loot would be invisible. The speech bubble (`.reaction`) is the one element
rendered unconditionally every tick.

**Decision:** celebratory moments write a TTL-stamped message to a new
`celebration` field; the bubble renderer prefers it over the normal reaction
while fresh. A1/A2/A3/B2/D4/E4 become a *data* change + one bubble-selection
tweak, not many render paths.

### Data model

```ts
// state.ts — StatusState gains one field (mirrors lastXpGain's shape/handling)
type CelebrationKind = "levelup" | "loot" | "ascension" | "whim" | "discovery" | "shiny";
interface Celebration {
  text: string;        // e.g. "✨ LEVEL 7 ✨", "🎁 a wizard's hat"
  kind: CelebrationKind;
  at: number;          // Date.now(), for TTL like lastXpGain.at
}
// StatusState.celebration: Celebration | null
```

`writeStatusState` is already **8 positional params**; rather than add a 9th
flag argument, **refactor to an options object** (Fowler) and extract the
"what to show" logic into pure, independently-testable helpers so the writer
stops being a god-function (SRP):

```ts
// state.ts — options object replaces the positional tail (one-time call-site migration)
interface StatusOpts {
  reaction?: string;
  muted?: boolean;
  achievement?: string;
  level?: number;
  xp?: number;
  xpGain?: number;
  celebration?: Celebration | null;   // NEW; null when gate=off
  /** Which producer triggered this write — scopes lastDrop consumption (see §2.6). */
  cause?: "loot" | "levelup" | "ascension" | "whim" | "shiny" | "tool";
}
export function writeStatusState(companion: Companion, opts?: StatusOpts): void

// extracted pure helpers (unit-testable without I/O):
export function buildCelebration(opts: StatusOpts, gate: GameFeel, loot: LootState): Celebration | null;
export function resolveEmotion(reason: string | undefined, gate: GameFeel): Emotion;
```

> **Backward-compat:** this changes an existing signature — migrate the call
> sites (`award-xp.ts`, `session.ts`, `index.ts`) in the same Phase-1 commit.
> The options object is the last chance to do this before more producers pile
> onto the positional list.

### Render (bash, in the always-on bubble path, not the stats branch)

```
CELEB_TSV=$(jq -r '[(.celebration.text // ""), (.celebration.at // 0)] | @tsv' "$STATE")
# if text != "" and (NOW - at/1000) in [0, CELEB_TTL]:  BUBBLE_TEXT=celeb (styled)
# else: BUBBLE_TEXT="$REACTION"   (today's behavior, unchanged)
```

Self-expiring (no writer clears it), like the `+N XP` age check at
`buddy-status.sh:346-351`. `CELEB_TTL` shrinks under `subtle` (see §2.5).

### Producers (sequence)

```
award-xp.ts ── level rose? ──► celebration{levelup} ─┐
index.ts ascend ────────────► celebration{ascension} ├─(gate≠off)─► writeStatusState ─► status.json ─► bubble
loot.ts roll ── drop? ──────► lastDrop marker ───────┤
quests.ts ── whim done ─────► celebration{whim} ─────┤
engine.ts ── shiny hatch ───► celebration{shiny} ────┤
discovery ── first sight ───► celebration{discovery} ┘
```

---

## 2.5. Intensity gate — FR-E1  *(cross-cutting; build first, NFR0)*

The control every other feature is measured against. **One config value, read at
each producer** — no central event bus needed.

```ts
// state.ts — BuddyConfig gains one field (next to showStats/showPrestigeBadge)
gameFeel: "off" | "subtle" | "full";   // DEFAULT_CONFIG: "subtle"
export function gameFeelLevel(): "off" | "subtle" | "full"; // loadConfig() accessor
```

| Level | Celebrations | Emotion frames (A4) | Rare-idle (D2) / memory callbacks (E3) | `CELEB_TTL` |
|---|---|---|---|---|
| `off` | none | neutral only | off | — |
| `subtle` (default) | yes | yes | off | ~6s |
| `full` | yes | yes | on | ~12s |

**Where the gate is read:**
- **TS producers** (`writeStatusState`, the ascend/quest paths, brag): call
  `gameFeelLevel()`; when `off`, pass `celebration = null` and `emotion =
  "neutral"` — so `status.json` simply omits the content and **bash needs no
  gate logic** (policy centralized + unit-testable in TS).
- **Bash/hook producers** (`react.sh` rare-idle, name-react): read
  `.gameFeel // "subtle"` from `config.json` via `jq` (same pattern as
  `showStats` at `buddy-status.sh:180`) and skip `full`-only pools otherwise.
- **Auto-quiet (stretch):** treat a recent error spike (the existing escalation
  signal) as a temporary `subtle` clamp. Out of scope for the first cut.

- **Surface:** an MCP tool `buddy_gamefeel <off|subtle|full>` + `/buddy gamefeel`
  route (mirrors `buddy_stats_panel` / `/buddy stats bar`), persisting via
  `saveConfig`. Add a `/buddy doctor` line reporting the active `gameFeel` and
  the age of the last celebration (supportability — Hightower).
- **Upgrade default (resolves OQ7):** fresh installs **and** existing installs
  (no `gameFeel` key) backfill to **`subtle`** via `loadConfig`'s merge —
  least-surprise, and `subtle` already suppresses the chatty producers (D2/E3).
- **Acceptance (measurable):** `gameFeel=off` ⇒ `status.json` carries
  `celebration:null` + neutral frames, and the rendered status line is
  **byte-identical to a captured pre-feature baseline fixture**; `subtle` shows
  celebrations but emits **zero** D2/E3 output; the value persists across
  restart in `config.json`. ✅

---

## 2.6. Concurrency & write contract  *(Nygard / Hohpe / Newman — must-fix)*

`status.json` has **multiple concurrent writers**: the MCP server
(`writeStatusState` on tool calls), the separate `award-xp.ts` *process* spawned
by hooks, and `react.sh`'s Stop-hook `jq` patch that updates `.reaction`. Today
`writeStatusState` uses a plain `writeFileSync` (**not** the tmp+rename
`saveManifest` uses). Adding the celebration channel widens this race, so the
contract is now explicit:

1. **Atomic writes.** `writeStatusState` must write `status.json` via
   **tmp + `renameSync`** (adopt `saveManifest`'s pattern) so a status-line tick
   never reads a half-written file.
2. **`react.sh` must preserve `.celebration`.** The Stop-hook `jq` patch updates
   `.reaction` only; it must round-trip the full object (`jq '.reaction=$r'`
   already preserves other keys — add a test asserting `.celebration` survives a
   reaction patch). A reaction patch must **not** clear a fresh celebration.
3. **Delivery guarantee (Hohpe):** the celebration channel is **single-slot,
   last-write-wins per write, lower-priority dropped (not queued)** — see the
   §2.5 priority order. This is acceptable because celebrations are ephemeral
   delight, not events requiring delivery. No cross-process ordering is
   guaranteed; the TTL makes ordering irrelevant.
4. **`lastDrop` is scoped by `cause`** (§ FR-A2) so an unrelated tool write
   within the TTL window can't surface a spurious 🎁.
5. **Multi-session (tmux) decision (Cockburn/Newman):** `celebration`,
   `whims.json`, and discovery are **account-scoped** while reactions are
   session-scoped (`reaction.$SID.json`). **Decision: account-scoped is
   intended** — a level-up is a whole-account event and may flash in any pane's
   status line; this is acceptable delight, not a bug. Documented so it isn't
   "fixed" later by mistake.

## 2.7. Tunables  *(Wiegers — pin every constant)*

Single source of truth; reconciled with the existing `+N XP` toast (10s).

| Constant | Value | Notes |
|---|---|---|
| `CELEB_TTL` (`full`) | **10s** | matches the existing `+N XP` toast window |
| `CELEB_TTL` (`subtle`) | **6s** | shorter, less dwell |
| `CELEB_TEXT_MAX` | **`bubbleWidth − 3` display cols** | via `displayWidth`; truncate with `…` like `renderCompanionCard`'s `maxMsg` |
| `EMOTION_FRAMES` | **2** sub-frames per emotion | fixed (not "2–3") |
| `RARE_IDLE_CHANCE` (D2) | **0.02** | `full` only |
| `HISTORY_CALLBACK_CHANCE` (E3) | **0.05** | `full` only; deduped consecutively |
| `EASTER_EGG_THRESHOLD` (D3) | **10** name-calls | OQ4 (confirm) |
| `SHINY_HATCH_CHANCE` (D4) | **0.01** | lift the inline `engine.ts:280` literal to this const |
| `WHIM_COUNT` (B1) | **1/day** | no streak (structural) |

---

## 3. Per-feature design

> Every producer below is implicitly gated by §2.5. "Emit a celebration" means
> "emit it unless `gameFeel == off`."

### Worked examples (Adzic — Given/When/Then for the tricky paths)

```
# Multi-fire priority
Given gameFeel=subtle, a turn that raises level 6→7 AND rolls loot
When writeStatusState runs (cause:"levelup")
Then celebration.kind == "levelup"   (loot suppressed in bubble)
And  loot still appears in buddy_xp "Recent loot"
And  the bubble reverts to .reaction after CELEB_TTL(subtle)=6s

# Off = byte-identity
Given gameFeel=off
When any producer would emit a celebration
Then status.json.celebration == null AND frames == neutral
And  the rendered line equals the captured pre-feature baseline fixture, byte-for-byte

# No spurious loot echo
Given a loot drop 4s ago, then buddy_mood is called (cause:"tool")
When writeStatusState runs
Then NO 🎁 celebration is emitted (cause not loot-related)

# Whim rollover across midnight, mid-session
Given a whim issued yesterday, partially fulfilled, session still open
When loadWhim() runs after local midnight
Then a new whim is offered, baseline re-snapshotted, prior progress discarded silently (no "missed" surfaced)
```

### FR-A1 — Level-up celebration toast  *(starter)*

- **Producer:** `award-xp.ts`/`session.ts` already compute `prevLevel` vs
  `state.level` (`award-xp.ts:76-89`). On `state.level > prevLevel`, pass
  `{text:"✨ LEVEL N ✨", kind:"levelup", at:Date.now()}` as the new arg.
- **No new state** — uses the level delta the caller already has;
  `levelUpAchieved`/`clearLevelUpFlag` untouched.
- **Acceptance:** once per level-up (delta is one-shot), self-expires, not
  persisted beyond the timestamp window. ✅

### FR-A2 — Loot reveal toast  *(starter)*

- **Problem:** loot rolls inside `xp.ts:fireLoot` (swallowed, lazy) — the
  `LootDrop` never reaches the `writeStatusState` caller.
- **Decision (keeps the swallow-safe edge):** `rollLoot` records its outcome on
  `LootState`; `writeStatusState` reads it and emits a celebration if fresh.

```ts
// loot.ts — LootState gains a transient marker (backfilled in loadLoot)
interface LootState { /* …existing… */ lastDrop?: { label: string; at: number } | null; }
// rollLoot sets lastDrop on EVERY roll: label = cosmetic.flavorText or "+1 pt"
```

`buildCelebration`: emit `{text:"🎁 "+label, kind:"loot"}` only when
`loadLoot().lastDrop` is fresh (within `CELEB_TTL`) **and the call's `cause`
indicates loot or a loot-causing milestone** (`loot`/`levelup`/`whim`/
`ascension`) — *not* on an unrelated write (e.g. `cause:"tool"` from
`buddy_mood`). This closes the spurious-🎁 hazard (§2.6) while keeping
`fireLoot` swallow-safe — the producer hints the cause, the writer still polls
the marker. **Priority when several fire on one write: ascension > shiny >
levelup > whim > loot** (a level-up that triggered the loot wins the bubble;
loot still shows in `buddy_xp`'s "Recent loot").

- **Acceptance:** shows for all loot trigger sites; "+1 pt" counts as a drop so a
  roll is never silent; no toast when no roll occurred. ✅

### FR-A3 — Ascension flourish  *(quick)*

- **Producer:** the `buddy_upgrades ascend` handler (`index.ts`) calls `ascend()`
  then `writeStatusState`; pass `{text:"🌟 PRESTIGE N 🌟", kind:"ascension"}`.
- **Frame flourish (optional):** reuse the A4 emotion mechanism for one TTL
  window. Bubble text alone satisfies the FR if A4 isn't in yet.
- **Acceptance:** once per ascension; no new art pipeline. ✅

### FR-A4 — Emotion animations, active species only  *(M)*

The plan's 162 hand-authored frames are **not** a quick win. Substitute:
**derive** emotion frames from existing `SPECIES_ART` by eye substitution + a
one-line micro-motion tweak at render time — zero new art data, all 18 species.

```ts
// art.ts
type Emotion = "happy" | "angry" | "bored" | "surprised" | "neutral";
const EMOTION_EYE: Record<Exclude<Emotion,"neutral">, string> =
  { happy:"^", angry:">", bored:"-", surprised:"O" };
export function getStatusFrames(bones: BuddyBones, emotion: Emotion = "neutral"):
  { frames: string[]; frameSequence: number[] }
// non-neutral: resolveFrame uses EMOTION_EYE[emotion]; returns a 2-3 frame
// micro-cycle. neutral returns today's exact 4-frame set (byte-identical).
```

- **Reason→emotion:** `pet→happy`, `error→angry`, `idle→bored`,
  `large-diff→surprised`. The active reaction's `reason` already persists in
  `reaction.$SID.json` (`ReactionState.reason`); `writeStatusState` reads it
  (lazy/guarded) → maps → passes to `getStatusFrames` (or `neutral` when
  `gameFeel == off`).
- **TTL:** inherits `reactionTTL`; clears to neutral when the reaction expires.
- **Acceptance:** active buddy shows emotion eyes/motion on those events;
  unmapped reasons → neutral; clears with the reaction. ✅

### FR-B1 — "Today's whim" (de-coerced daily)  *(M)*

> **Reframe (panel debate, resolved):** an *offer*, not an obligation. **No
> streak, no shame bar, no consecutive-completion tracking, no absence
> penalty.** Missing a day is silent.

New module `server/quests.ts` + `whims.json` (account-scoped, alongside
`xp.json`/`streak.json`; resolved via `buddyStateDir()` at call time).

```ts
interface WhimDef { id: string; offer: string; metric: keyof EventCounters; target: number; }
const WHIMS: WhimDef[] = [
  { id:"commit",  offer:"feel like landing a few commits today?", metric:"commits_made", target:3 },
  { id:"green",   offer:"how about a clean test run?",            metric:"all_green",    target:1 },
  { id:"pet",     offer:"i wouldn't say no to a few pats…",        metric:"pets",         target:3 },
];
interface WhimState {
  date: string;        // "YYYY-MM-DD" local
  whimId: string;
  baseline: number;    // metric value when offered (delta-based progress)
  fulfilled: boolean;
  rewarded: boolean;
  // NOTE: deliberately no `streak`, `bestStreak`, or `missed` field — non-coercion is structural.
}
```

- **Daily offer (deterministic):** on `loadWhim()`, if `date !== today`, pick
  `WHIMS[hash(today) % n]`, snapshot `baseline = loadEvents()[metric]`, reset
  flags. Delta progress (`current = events[metric] - baseline`) reuses the
  **existing event counters** — no new tracking plumbing.
- **`tickWhim()`** at the same hook points that bump `EventCounters`: marks
  `fulfilled` when `current >= target`. Idempotent.
- **Midnight rollover:** date-string compare on load (matches
  `trackActiveDay`, `achievements.ts:203`).
- **Acceptance:** the offer (and quiet progress) shows in `buddy_xp`; **absence
  is never surfaced as failure**; survives restart same day; clean rollover; no
  consecutive-day mechanic exists in state or render. ✅

### FR-B2 — Whim completion = quiet delight  *(starter)*

- On `tickWhim()` transition to `fulfilled && !rewarded`: `rollLoot("whim",
  slot)` (add `"whim"` to `LootTrigger`), set `rewarded`, emit
  `celebration{kind:"whim", text:"⭐ "+offer-shortlabel}`.
- **No direct XP/stat bonus** beyond the loot roll; **no escalating reward for
  keeping it up** (NFR1 + non-coercion).
- **Acceptance:** fires exactly once (`rewarded` guard); re-opening a completed
  day re-grants nothing; nothing tracks consecutive completions. ✅

### FR-B3 — Progress-bearing achievements  *(quick)*

`Achievement.check` is a boolean closure with no exposed threshold. Add optional
declarative metadata; render a fraction when present and unearned.

```ts
interface Achievement { /* …existing… */ metric?: keyof EventCounters; target?: number; }
// renderAchievementsCard*: for !done && !secret && metric && target →
//   show `${Math.min(current,target)}/${target}`.
```

- Backward-compatible: metadata-less (combo/boolean) achievements render as today.
- **Acceptance:** in-progress countable ones show `n/target`; others unchanged. ✅

### FR-C1 — Cosmetic sets  *(quick–M)*

Pure-derived; **no new persisted state** — read `XpState.cosmeticFlags` +
companion `bones.hat`/`shiny`.

```ts
// server/sets.ts (NEW module — not xp.ts, which is already 1,385 lines)
interface CosmeticSet { id:string; name:string; members:string[]; title:string; }
const COSMETIC_SETS: CosmeticSet[] = [
  { id:"arcane", name:"Arcane", members:["wizard_hat","glow","constellation"], title:"Arcanist" },
];
function setProgress(state, companion): { set:CosmeticSet; have:number; complete:boolean }[]
```

- **Completion reward = title only** — grant via the title slot exactly like the
  `Collector` milestone (`xp.ts:applyCollectionReward`: set if none worn, **no
  multiplier**).
- **Surface:** a "Sets" block in `renderXpCardMarkdown` + `buddy_list`.
- **Acceptance:** progress shown; completion grants an equippable title, zero
  multiplier. ✅

### FR-C2 — Seasonal / dated cosmetic  *(quick; lowest priority)*

```ts
interface SeasonalCosmetic { hat?: Hat; flag?: string; from:[number,number]; to:[number,number]; }
const SEASONAL: SeasonalCosmetic[] = [ { hat:"beanie", from:[12,20], to:[12,31] } ];
function activeSeasonal(now = new Date()): SeasonalCosmetic | null
```

- Applied during frame resolution only if the hat slot is empty (like the
  existing `applyHat`/`getStatusFrames` overlay) — never clobbers a user hat.
- **Panel caveat:** dated content is a fragile maintenance tail with
  timezone/culture assumptions (NFR7) — keep the calendar tiny; ship last.
- **Acceptance:** renders only in-window; absent otherwise; no off-season state. ✅

### FR-C3 — Buddy growth/age tell  *(quick)*

- **Dependency resolved:** `Companion.hatchedAt: number` already exists
  (`engine.ts:131`) — no new field, no backfill.
- Derive a cosmetic marker at render (e.g. a glyph at ≥7d, another ≥30d) from
  `Date.now() - hatchedAt`. Visual only.
- **Acceptance:** purely visual, derived from `hatchedAt`, no mechanics. ✅

### FR-D1 — Expanded loot pool  *(trivial)*

Append cosmetic-only entries to `LOOT_COSMETICS` (`loot.ts:56`) — same
`apply:(c)=>{…bones…}` shape. Keep `LOOT_COSMETIC_CHANCE` + the "unowned only"
filter so rarity feel holds.

- **Acceptance:** bones-cosmetic only (never points/multiplier); dedup already
  handled by `pickUnownedCosmetic`. ✅

### FR-D2 — Rare idle event  *(quick; `full` only)*

- Hook the existing idle reaction path (`reactions.ts` idle pool / the idle
  branch in `react.sh`). With low probability (~2-3%) substitute a special
  "unexpected" idle bubble from a small dedicated pool. **Gated to
  `gameFeel == full`** (read in bash via `jq`).
- Cosmetic text only; no state.
- **Acceptance:** low rate, bubble-text only, silent unless `full`. ✅

### FR-D3 — Easter-egg unlock  *(quick–M)*

- **Trigger candidate (OQ4):** the name-call path (`hooks/name-react.sh`)
  already detects the buddy's name. Add a small persisted counter; at threshold N
  (proposed 10) grant a hidden `cosmeticFlag` once (set-if-absent, like
  `addFlag`) + a `discovery`-kind celebration.
- **Acceptance:** threshold-gated, granted once, idempotent. ✅

### FR-D4 — "Shiny" variant at hatch  *(quick)*

- **Already half-built:** `generateBones()` **already rolls `shiny = rng() <
  0.01`** (`engine.ts:280`, also `:490`). The 1% shiny hatch exists — it just
  isn't announced or distinguished from an upgrade/loot shiny.
- **FR-D4 = polish, not a new roll:** when a hatch is shiny, (a) add a
  `cosmeticFlag "hatched_shiny"` so it reads as innate (and survives
  `xp.ts:revertUpgradeEffect`, which only clears `aura_shiny`), and (b) emit
  `celebration{kind:"shiny", text:"✨ a SHINY hatched! ✨"}`. Optionally lift the
  inline `0.01` to a named const.
- **Acceptance:** existing roll now marked + announced; retroactivity moot. ✅

### FR-E1 — Intensity dial

Designed as cross-cutting infrastructure in **§2.5**.

### FR-E2 — Shareable brag card  *(M; top growth lever)*

A new MCP tool `buddy_brag` (+ `/buddy brag` route), built on the existing
**pure-markdown** `renderCompanionCardMarkdown` (`art.ts`, already ANSI-free and
used by `buddy_show`/`buddy_pick`/`buddy_list` in `index.ts:199,262,1364`).

```ts
// index.ts — new tool, reuses the markdown renderer + one milestone line
function renderBragCard(companion, opts?: { plain?: boolean }): string
// = renderCompanionCardMarkdown(bones,name,personality)
//   + "🏆 Lv N · Prestige P · «Title» · {one history stat}"
```

- **Milestone line** pulls only non-sensitive, already-public stats: level,
  prestige, equipped title, and *one* history figure (e.g. longest streak or
  `bugs_resolved` from event counters). **No project paths, file names, or
  memory contents** (privacy — R8).
- **NFR7:** `plain:true` yields an emoji-light, code-fenced ASCII variant for
  surfaces that mangle Unicode.
- **Acceptance:** copy-paste clean (no raw ANSI), renders in PR/Slack markdown,
  leaks no private data, works offline. ✅

### FR-E3 — Memory-narrated milestones  *(M; the "witness" job)*

A new reaction source that occasionally references *real shared history*, surfaced
through the existing reaction pick path at low frequency. **Gated to `full`**
(it's flavor, and chattier than core reactions).

```ts
// reactions.ts (or memory-callbacks.ts) — lazy/guarded reads of memory.ts + counters
export function historyCallback(): string | null
// draws from: loadEvents() counters (bugs_resolved, commits_made, days_active,
//   streak longest), and memory.ts queryMemory()/loadBugs() for a remembered
//   bug/project. e.g. "we've squashed 100 bugs together", "remember that 3am merge?"
// returns null when history is thin (fresh install) → caller falls back to normal pool.
```

- **Frequency + dedupe (R9):** low rate; avoid repeating the same callback
  back-to-back (track last-used id in the session reaction file). Never block a
  more relevant event reaction.
- **Degrades silently** when memory/counters are empty or unreadable (NFR4).
- **Acceptance:** callbacks cite real recorded history; silent when thin; flavor
  only; not creepy/repetitive (rate-limited + deduped). ✅

### FR-E4 — Self-announcing discovery  *(S)*

The buddy mentions a new system once, transiently, then vanishes — discovery
without permanent chrome (NFR6).

```ts
// small persisted set of system ids already announced (own file or a field on whims.json)
interface DiscoveryState { announced: string[]; } // e.g. ["loot","whim","sets"]
```

- The first time a system becomes relevant (first loot drop, first whim offered,
  first set partially owned), emit `celebration{kind:"discovery", text:…}` and
  record the id. At most once each.
- **Acceptance:** each system announces ≤ once; no persistent UI added. ✅

---

## 4. File-by-file change map

| File | FRs | Change |
|---|---|---|
| `server/state.ts` | E1; channel; A4 | `BuddyConfig.gameFeel` + `gameFeelLevel()`; `StatusState.celebration`; **`writeStatusState(companion, opts)` options-object refactor** + `buildCelebration`/`resolveEmotion` pure helpers; **`status.json` write → tmp+rename (atomic, §2.6)** |
| `server/award-xp.ts` | A1, A2, B1/B2 | `celebration` on level delta; `tickWhim()` call |
| `server/session.ts` | A1 | `celebration` on session-complete level delta |
| `server/xp.ts` | C1 | "Sets" + whim blocks in `renderXpCardMarkdown` (render only) |
| `server/sets.ts` (new) | C1 | `COSMETIC_SETS` + `setProgress` (kept out of the 1,385-line `xp.ts` — Fowler) |
| `server/loot.ts` | A2, B2, D1 | `LootState.lastDrop`; `"whim"` trigger; new `LOOT_COSMETICS` |
| `server/art.ts` | A4, C2 | `Emotion`/`EMOTION_EYE`, `getStatusFrames(emotion)`; `SEASONAL`/`activeSeasonal` |
| `server/achievements.ts` | B3 | optional `metric`/`target`; fraction in both renderers |
| `server/quests.ts` (new) | B1, B2 | `WHIMS`, `WhimState`, `loadWhim`/`tickWhim`, render line, discovery hook |
| `server/reactions.ts` (or new `memory-callbacks.ts`) | E3 | `historyCallback()` + dedupe |
| `server/engine.ts` | D4 | mark `hatched_shiny` on the existing 1% roll; (C3 reads existing `hatchedAt`) |
| `server/index.ts` | E1,E2,A3,B1,C1,D3 | `buddy_gamefeel` + `buddy_brag` tools; ascension celebration; surface whim/sets in `buddy_xp`/`buddy_list`; name-call easter-egg counter |
| `hooks/react.sh`, `hooks/name-react.sh` | D2, D3, E1; §2.6 | gate read (`jq .gameFeel`); rare-idle (`full`); name-call counter; **reaction `jq` patch must preserve `.celebration`** |
| `statusline/buddy-status.sh` | channel | bubble prefers fresh `.celebration.text` over `.reaction` |

---

## 5. Test plan (NFR5)

- **state.test.ts** — `gameFeel` backfills to `"subtle"`; `gameFeelLevel()` maps
  correctly; `off` ⇒ `writeStatusState` writes `celebration:null` + neutral
  frames; `celebration` round-trips; loot/reason derivation guarded (no throw
  when files absent). **Pure-helper units:** `buildCelebration` priority
  resolution (all multi-fire combos), `cause`-scoped `lastDrop` (no echo on
  `cause:"tool"`), `resolveEmotion` mapping incl. unmapped→neutral and
  gate=off→neutral. **Atomicity:** `status.json` is written via tmp+rename
  (assert no partial-file window).
- **concurrency.test.ts** (new) — a `react.sh`-style `.reaction`-only `jq` patch
  **preserves** a fresh `.celebration`; interleaved writes leave valid JSON
  (last-writer-wins, never corrupt).
- **statusline_render.test.ts** — extend the existing `renderStatus()` harness
  (`xpPct`/`lastXpGain`/`BUDDY_FAKE_NOW`): celebration shows in-window, hidden
  after `CELEB_TTL`, overrides reaction, with `showStats` **on and off** (the
  visibility bug this fixes); shorter TTL under `subtle`; **`off` matches the
  captured pre-feature baseline fixture byte-for-byte**; **`subtle` emits zero
  D2/E3 output**; negative/future `at` (`BUDDY_FAKE_NOW` before `at`) shows no
  toast; the 5 new glyphs (✨🎁🌟⭐🏆) pass the `emoji-widths.data` width fixture
  and `CELEB_TEXT_MAX` truncates with `…`.
- **art.test.ts** — `getStatusFrames("neutral")` byte-identical to today; each
  emotion yields valid frames; `activeSeasonal` window boundaries.
- **quests.test.ts** (new) — deterministic daily pick; delta progress; reward
  fires once; midnight rollover (incl. a session open **across** local midnight,
  and a **timezone/DST** shift changing the date string); backfill of
  absent/partial `whims.json`; **asserts no streak/consecutive field exists** and
  absence isn't rendered as failure.
- **loot.test.ts** — `lastDrop` set every roll; `"whim"` trigger logged;
  injected `rng` keeps cosmetic rolls deterministic.
- **achievements.test.ts** — fraction renders for `metric/target`; metadata-less
  unchanged.
- **brag.test.ts** (new) — output contains no `\x1b`/ANSI; `plain` variant is
  emoji-light; no project/memory strings leak.
- **memory-callback.test.ts** (new) — returns `null` on empty history; cites real
  counters when present; doesn't repeat the same id consecutively.
- Gate: `bun test` green + `tsc --noEmit -p tsconfig.json` clean.

---

## 6. Risks & mitigations

- **R1 — Toast invisible without stats panel.** *Mitigation:* celebration rides
  the always-on bubble (§2).
- **R2 — Multi-fire on one write.** *Mitigation:* fixed priority
  ascension > shiny > levelup > whim > loot; loot still shows in "Recent loot".
- **R3 — Emotion frames break neutral.** *Mitigation:* `emotion` defaults
  `"neutral"` (today's exact frames); snapshot asserts byte-identity.
- **R4 — Whim double-reward.** *Mitigation:* delta-vs-baseline is idempotent;
  `rewarded` guards the grant.
- **R5 — ~~`bornAt` backfill~~ (retired).** `hatchedAt` + the shiny roll already
  exist.
- **R6 — Locale/width on new glyphs (✨🎁🌟⭐🏆).** *Mitigation:* `displayWidth`/
  `emoji-widths.data`; add to the width fixture; NFR7 plain fallbacks.
- **R7 — Brag card privacy leak (E2).** *Mitigation:* milestone line whitelists
  level/prestige/title + one history figure only — never paths, file names, or
  memory text. Covered by `brag.test.ts`.
- **R8 — Memory callbacks feel creepy/repetitive (E3).** *Mitigation:* low rate,
  consecutive-dedupe, silent-when-thin; `full`-only so it's opt-in.
- **R9 — Upgrade default for existing users (E1).** **Resolved:** existing
  installs (no `gameFeel` key) backfill to `"subtle"` via `loadConfig` merge —
  `subtle` suppresses the chatty D2/E3 producers, so the change is low-surprise.
- **R10 — `status.json` write race / corruption (§2.6).** *Mitigation:* atomic
  tmp+rename writes; `react.sh` patch preserves `.celebration`; single-slot
  last-write-wins delivery. Covered by `concurrency.test.ts`. **Must land with
  Phase 1.**

---

## 7. Sequencing & dependencies

```
Phase 0 (the gate — NFR0):       state.ts gameFeel + gameFeelLevel + buddy_gamefeel   (build FIRST)
Phase 1 (channel + foundation):  §2.6 atomic write + writeStatusState options-object refactor
                                 ─► celebration channel ─► A1 ─► A2 (cause-scoped lastDrop) ─► D1
Phase 2 (growth):                E2 brag card            (independent; high leverage)
Phase 3 (return loop):           quests.ts ─► B1 "whim" ─► B2 (reuses channel + loot)
Phase 4 (the witness + body):    E3 memory callbacks, A4 emotion ─► A3 flourish, E4 discovery
Phase 5 (collection + surprise): B3, C1 (+sets.ts), C3, D2, D3, D4   (C2 seasonal last — fragile)
```

Phase 0 gates everything that interrupts. **Phase 1 now front-loads the §2.6
write contract + the options-object refactor** — they're the foundation every
later producer builds on, so they must not be deferred.

**Definition of Done (per phase, Gregory):** all new/affected `*.test.ts` green;
`tsc --noEmit` clean; `gameFeel=off` baseline-fixture byte-identity holds;
manual check in a fresh terminal (UTF-8 + a no-color/narrow terminal for NFR7);
docs/README routing updated if a new `/buddy` subcommand shipped.

---

## 8. Open questions — all resolved

1. ~~**Whim reward**~~ — **loot roll only** (no whim-exclusive cosmetic). Shipped.
2. ~~**Whim cadence**~~ — **daily only**, non-coercive. Shipped.
3. ~~**shiny retroactivity**~~ — resolved (roll already exists; mark + announce).
4. ~~**Easter-egg trigger**~~ — **name called 10×** confirmed (Phase 5, D3).
5. ~~**Seasonal calendar (C2)**~~ — **a small multi-occasion list** (Phase 5,
   lowest priority).
6. ~~**Brag-card surface (E2)**~~ — **default markdown** (PR/Slack) primary,
   `plain` stays the opt-in. Matches what shipped.
7. ~~**Intensity default on upgrade (E1)**~~ — **resolved:** backfills to
   `subtle` (R9).

### Phase 3 implementation notes (as built)

- **Metrics are global counters only** (`commits_made`/`all_green`/
  `large_diffs`/`errors_seen`) — the `pet` whim was dropped so baseline and
  current always read from the same slot-independent source.
- **Single integration point:** `award-xp.ts` calls `tickWhim(slot)` after every
  event (commits via `session_complete`; tests/diffs/errors via their XP
  events). Delta-vs-baseline is eventually-consistent.
- **Reward = one `rollLoot("whim", slot)`**, nothing else (OQ1/NFR1). Level-up
  still outranks a whim completion for the single bubble slot.

## Next step

`/sc:implement` **Phase 0 then Phase 1** immediately — neither depends on an open
question, and Phase 0 (the gate) is required by NFR0 before anything interrupts.
Phase 2 (brag card) is independent and high-leverage. Resolve OQ1–2, 4–7 before
Phases 3–5.
