# Living-World Arc — P2 Implementation Plan (Encounter Variety)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the arc's P2 — multi-stage **boss bugs** and **wild buddy visitors** — per `design.md` §P2, on the P1 primitives.

**Architecture:** Bosses are an upgrade of the existing pending-encounter standoff (`kind: "boss"`, stage counters, caption pips); each commit fights one stage through the existing seeded `resolveCombat`. Visitors are a new pure module (`server/visitor.ts`) whose greet scene rides the existing `EncounterRecord`-shaped surfacing (own `visitor.json`, read only when no fight/standoff exists — combat always outranks). Zero shell changes: captions, TTLs, and scene fields all reuse the P1/P5 render paths.

**Tech Stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), bash statusline untouched (`bash -n` still verified).

**Read first:** `design.md` §P2 + §Resolved decisions (D9, D12, D13); `CURRENT-STATE.md` (standoff + caption sections); `plan-p0-p1.md` (house rules block — ALL of it applies here verbatim: ask-once commits, live-classifier warning, per-task validation cadence).

**Baseline:** 874 tests pass at `9c09fdd`. 1 fps is the validated platform floor (P0 findings) — every new flipbook must read at 1 fps.

**Recon facts the tasks below rely on (verified 2026-07-18):**
- `PendingEncounter` (combat.ts:98): `{bugId, tier, frames, sequence, sightedAt, startedAt, project?}`; `EncounterRecord` (combat.ts:80): `{frames, sequence, enemyGlyph, at, project?}`.
- `tierForErrors` (bugs.ts:50): ≤2→1, ≤5→2, ≤9→3, else 4. `Bug` has `species: Species` (curated 5-line ANSI-free mirror-safe set) + `eye?`.
- `pendingAction(tier, existing)` (session.ts:371) → "noop"|"spawn"|"escalate"; `sightBug` (session.ts:399) is the spawn seam (configured-level gated); `resolveFightBug` (session.ts:477) picks the pinned bug; `maybeFightBug` (session.ts:~510) reads pending, **clears unconditionally today (G5)**, resolves, `applyCombatDrops(result.drop)` (combat.ts:705), `writeEncounter`.
- Caption is built in `writeStatusState`'s local `captionFrames(frs, project)` (state.ts ~1004): fixed text `Bug fight in <name>!`.
- Achievements: `incrementEvent(key, amount, slot?)` (achievements.ts:181), `Achievement {id,name,description,icon,check,secret,metric?,target?}`, `checkAndAward(slot?)`; counters live in `EventCounters` with `GLOBAL_KEYS`/`SLOT_KEYS`/`COUNTER_KEYS`.
- `composePose(playerSpecies, enemySpecies, pose, sword, extras?, look?)` is combat.ts-private; `bakeBoutFrames`/`pendingPoses` likewise — the visitor bake (Task 5) must either import from combat.ts (export what it needs) or live beside them; the task decides with a stated rule.

---

### Task 1: Caption override on both encounter records

Boss pips and visitor captions both need non-default caption text; today the text is hardcoded in `writeStatusState`. Land the seam first (inert for existing records).

**Files:** Modify `server/combat.ts` (both interfaces), `server/state.ts` (captionFrames); Test `server/statusline_render.test.ts` or `server/state.test.ts` (follow where existing caption tests live — `grep -rn "Bug fight in" server/*.test.ts`).

- [ ] **Step 1:** Locate the existing caption tests and read `captionFrames` in place. Write a failing test: a pending/encounter fixture carrying `caption: "BOSS in demo! ▰▱"` renders that line centered instead of `Bug fight in demo!`; a record WITHOUT the field renders exactly today's text (back-compat pin, byte-identical).
- [ ] **Step 2:** `PendingEncounter` and `EncounterRecord` each gain:
```ts
  /** Caption line rendered above the scene. Absent ⇒ the classic
   *  "Bug fight in <project>!" built from `project` (back-compat). */
  caption?: string;
```
In `writeStatusState`, `captionFrames(frs, project)` becomes `captionFrames(frs, project, caption?)`: `const text = caption ?? (name ? \`Bug fight in ${name}!\` : null)` — same centering, same sanitizer path (strip control chars from `caption` exactly as `project` is stripped — it crosses the same jq-exempt frame channel). Thread `enc.caption` / `pending.caption` at the two call sites.
- [ ] **Step 3:** Targeted tests PASS; full `bun test` (874 + new); `tsc`; render snapshots byte-identical for caption-less fixtures.
- [ ] **Step 4:** Commit: `feat(living-world): caption override on encounter records` (+ trailer).

---

### Task 2: Boss model — state fields + pure decision

**Files:** Modify `server/combat.ts` (PendingEncounter), `server/session.ts` (pendingAction + constants); Test `server/session.test.ts`.

- [ ] **Step 1 — failing tests** (session.test.ts, pure):
```ts
describe("boss decisions (living-world P2)", () => {
  test("count >= BOSS_THRESHOLD upgrades a standoff to a boss", () => {
    expect(pendingAction(4, { tier: 4 }, 12)).toBe("boss");
    expect(pendingAction(4, { tier: 4 }, 11)).toBe("noop");
  });
  test("an existing boss never re-upgrades or de-escalates", () => {
    expect(pendingAction(4, { tier: 4, kind: "boss" }, 20)).toBe("noop");
  });
  test("boss stage count scales with severity", () => {
    expect(bossStages(12)).toBe(2);
    expect(bossStages(18)).toBe(3);
  });
});
```
- [ ] **Step 2 — implement.** `PendingEncounter` gains:
```ts
  /** Boss upgrade (living-world P2, D13): present only on a boss standoff. */
  kind?: "boss";
  /** Total stages (2-3, severity-scaled) and stages already won. */
  stages?: number;
  stagesCleared?: number;
```
`session.ts`: `export const BOSS_THRESHOLD = 12;` and `export const BOSS_STAGE2_AT = 18;` with
```ts
export function bossStages(count: number): number {
  return count >= BOSS_STAGE2_AT ? 3 : 2;
}
```
`pendingAction` gains a third param `count = 0` and a `kind?: "boss"` on `existing`; new first-priority rules:
```ts
  if (existing && "kind" in existing && existing.kind === "boss") return "noop";
  if (tier > 0 && count >= BOSS_THRESHOLD) return "boss";
```
`"boss"` is returned whether or not a standoff exists (a cold 12-error boss is normally impossible — sightings fire per error event — but a crash between clear and snapshot can orphan one, so the caller treats `"boss"` as (re)bake-as-boss unconditionally). Existing two-arg call sites pass no count ⇒ behavior unchanged (default 0 never crosses the threshold).
- [ ] **Step 3:** tests PASS, full suite, tsc.
- [ ] **Step 4:** Commit: `feat(living-world): boss threshold + stage model` (+ trailer).

---

### Task 3: Boss sighting — upgrade the standoff in `sightBug`

**Files:** Modify `server/session.ts` (sightBug), `server/combat.ts` (pips helper); Test `server/combat.test.ts` (fresh-subprocess idiom, like the existing sightBug tests).

- [ ] **Step 1 — failing test** (mirror the existing fresh-process sightBug case): drive ≥12 error events → `readPendingEncounter()` has `kind: "boss"`, `stages: 2`, `stagesCleared: 0`, and `caption` matching `/^BOSS in .+! ▰*▱+$/u` (pips = stagesCleared filled). A second sighting at higher count stays a boss (no downgrade, no pip reset).
- [ ] **Step 2 — implement.** New pure helper in combat.ts:
```ts
/** Stage pips for the boss caption: cleared ▰, remaining ▱. */
export function bossPips(stages: number, cleared: number): string {
  return "▰".repeat(Math.max(0, cleared)) + "▱".repeat(Math.max(0, stages - cleared));
}
```
In `sightBug`: thread `count` into `pendingAction`; on `"boss"`, write the pending record with `kind: "boss"`, `stages: bossStages(count)` (preserve existing `stagesCleared` if the current record is already this session's boss — it isn't on first upgrade ⇒ 0), tier as computed, and `caption: \`BOSS in ${currentProject()}! ${bossPips(stages, cleared)}\`` (project fallback: if `currentProject()` is empty, caption `\`BOSS FIGHT! ${pips}\`` — never render an empty "in !"). **Producer clamp contract** (Task 1 review): `captionFrames` does NOT length-clamp — the producer must; `currentProject()` is already ≤24 chars, keeping this caption ≤ ~40, but assert the assembled caption's length in a test so a future pips/text change can't silently over-widen `artWidth`. Scene bake unchanged (same `bakePendingScene` — the boss LOOK upgrade is Task 6). Escalation of a non-boss standoff past the threshold takes the same path.
- [ ] **Step 3:** tests, suite, tsc.
- [ ] **Step 4:** Commit: `feat(living-world): standoffs escalate into multi-stage bosses` (+ trailer).

---

### Task 4: Boss stage fights in `maybeFightBug` + badge

The G5 revision: a mid-boss commit fights ONE stage and the standoff persists unless it was the final stage. `startSession`'s orphan clear is untouched (D12).

**Files:** Modify `server/session.ts` (maybeFightBug), `server/achievements.ts` (counter + achievement); Test `server/session.test.ts` + `server/achievements.test.ts`.

- [ ] **Step 1 — failing tests:**
  - Fresh-subprocess boss lifecycle: boss standoff (stages 2) → commit with a known-WIN seed ⇒ pending STILL EXISTS with `stagesCleared: 1`, caption pips `▰▱`, and the returned summary mentions the stage (e.g. `/stage 1\/2/`); second winning commit ⇒ pending CLEARED, `fightWon: true`, drop points > a normal tier-4 win (boss bonus), and `loadGlobalEvents().bosses_beaten === 1`. A FLEE seed ⇒ pending persists with `stagesCleared` unchanged.
  - achievements.test.ts: new `boss_slayer` achievement unlocks at `bosses_beaten >= 1` (follow the file's existing single-achievement test idiom).
- [ ] **Step 2 — implement.**
  - `achievements.ts`: add `bosses_beaten` to the global counters (follow `GLOBAL_KEYS`/`EMPTY_GLOBAL`/`EventCounters` exactly as an existing global counter like `bugs_resolved` is declared — copy its pattern) and an `ACHIEVEMENTS` entry:
```ts
  {
    id: "boss_slayer",
    name: "Boss Slayer",
    description: "Defeat a boss bug",
    icon: "👑",
    check: (e) => (e.bosses_beaten ?? 0) >= 1,
    secret: false,
    metric: "bosses_beaten",
    target: 1,
  },
```
  - `maybeFightBug`: after `readPendingEncounter()`, branch on `pending?.kind === "boss"` — **with NO `startedAt` staleness guard** (execution finding, 2026-07-19): `awardSessionComplete` rebaselines the snapshot's `startedAt` after every commit, so a segment-staleness guard kills any boss at the first commit boundary — the exact persistence the feature exists for. Boss records are dismissed by **explicit lifecycle events only**: `startSession`'s unconditional clear (D12 — which also covers the crash-orphan case the guard existed for), the `off` clear, and the final-stage kill. `sightBug`'s `sameSession` filter needs the same boss exemption, or the next error event after a commit overwrites the mid-fight boss with a fresh standoff. Do NOT clear unconditionally. Resolve one stage via the existing `resolveCombat` (same seed derivation, tier 4 bug via `bugById(pending.bugId)`). On `outcome === "win"`: `stagesCleared + 1`; if `< stages` → rewrite the pending record (same frames/sequence, updated `stagesCleared` + caption pips) and return `{ summary: \`⚔️ Stage ${n}/${stages} down — the boss staggers!\`, won: false }` (won:false — no victory stinger until the kill) with a stage-scaled points drop (`applyCombatDrops({ points: <stage bonus> })`); if final → `clearPendingEncounter()`, `applyCombatDrops` with the boss drop (Step 3), `incrementEvent("bosses_beaten")`, `writeEncounter(result, project)` so the resolved scene plays, summary `👑 BOSS DOWN — <bug name> defeated!`, `won: true`. On flee: persist untouched, summary the normal flee text. Non-boss pendings keep today's exact path (clear-unconditionally G5).
  - Boss drop: guaranteed rare+ — FIRST inspect how items carry rarity (`grep -n "rarity" server/items.ts | head`) and how `resolveCombat` rolls `drop.itemId`; implement `bossDrop(seed)` in combat.ts picking a seeded item of rarity ≥ rare (or the best available tier if none) + points `≥ 3× the tier-4 base reward`. If item rarity turns out not to exist on the ITEMS shape, fall back to points-only ×4 and SAY SO in your report.
- [ ] **Step 3:** lifecycle tests, suite, tsc. Verify `checkAndAward` actually runs on the commit path (grep its call sites; if it only runs elsewhere, add the call where other award-path achievements are checked — follow existing wiring, do not invent a new call site).
- [ ] **Step 4:** Commit: `feat(living-world): boss stage fights, guaranteed drop, boss_slayer badge` (+ trailer).

---

### Task 5: `server/visitor.ts` — pure core

**Files:** Create `server/visitor.ts`; Modify `server/combat.ts` (export `composePose`/`pendingPoses`-adjacent needs — smallest export set); Test `server/visitor.test.ts` (new file).

- [ ] **Step 1 — decide the bake's home with this rule:** the visitor scene must reuse `composePose` + the walk-in `shift` extras so it stays pixel-consistent with fight scenes. If exporting `composePose` (+ the pose type) from combat.ts is a ≤3-export change, do that and put the bake in visitor.ts; otherwise put `bakeVisitorScene` inside combat.ts (beside `bakePendingScene`) and keep visitor.ts pure-logic-only. State the choice in your report.
- [ ] **Step 2 — failing tests** (visitor.test.ts):
```ts
describe("visitor core (living-world P2)", () => {
  test("roll is seeded, ~1/12, and never the player's species", () => {
    let hits = 0;
    for (let s = 0; s < 1200; s++) {
      const v = rollVisitor(s, "cactus");
      if (v) { hits++; expect(v.species).not.toBe("cactus"); }
      expect(rollVisitor(s, "cactus")).toEqual(v); // deterministic
    }
    expect(hits).toBeGreaterThan(60); expect(hits).toBeLessThan(140); // ~100
  });
  test("reward: ~25% carry points 3-8, the rest are pure visits", () => {
    let rewards = 0;
    for (let s = 0; s < 400; s++) {
      const v = rollVisitor(s, "cactus");
      if (v?.reward) { rewards++;
        expect(v.reward.points).toBeGreaterThanOrEqual(3);
        expect(v.reward.points).toBeLessThanOrEqual(8); }
    }
    expect(rewards).toBeGreaterThan(0);
  });
  test("greet scene: constant width and height, walks on and off", () => {
    const scene = bakeVisitorScene("cactus", "o", { species: "goose", shiny: false }, 7);
    // reuse the constant-geometry assertion style from combat.test.ts
  });
});
```
(Adapt species/eye literals to real fixture values from combat.test.ts.)
- [ ] **Step 3 — implement.**
```ts
export interface VisitorSpec {
  species: Species;          // from the same curated mirror-safe set BUGS uses
  shiny: boolean;            // the usual shiny odds (grep engine.ts for the constant)
  reward?: { points: number };  // ~25% of visits
}
export const VISITOR_ODDS = 12;   // 1-in-N per commit
export function rollVisitor(seed: number, playerSpecies: Species): VisitorSpec | null
```
mulberry32(seed); first draw gates `1/VISITOR_ODDS`; species drawn from the curated set (derive it from `BUGS`' species values de-duplicated — the set already proven mirror-safe — minus `playerSpecies`); shiny + reward from subsequent draws (fixed draw order, comment it). `bakeVisitorScene(...)`: walk-in beats (shift extras toward the gap, the bout grammar), 2 greet poses (visitor `^` eyes; a `♥` overlay pop on the greet beat — reuse `overlayRow` via art.ts), walk-off beats, ~12-16 frames sequence; caption text is NOT baked here (Task 7 passes it on the record).
- [ ] **Step 4:** tests, suite, tsc.
- [ ] **Step 5:** Commit: `feat(living-world): visitor core — seeded roll + greet scene` (+ trailer).

---

### Task 6: Boss look — dedicated art, with a bounded fallback

**Files:** investigate first — then either `server/engine.ts` + `server/art.ts` + `server/bugs.ts`, or `server/combat.ts` only.

- [ ] **Step 1 — verify the boundary:** `grep -n "Species" server/engine.ts | head` and find every enumerator of adoptable species (hatch/adopt pools — `grep -rn "SPECIES\b" server/engine.ts server/reactions.ts server/index.ts | head -20`). Answer: does adding a Species union member leak into adoption/hatch pools automatically, or are pools an explicit list?
- [ ] **Step 2 — DECISION GATE:**
  - **If pools are an explicit list** (union member is safe): add ONE wide boss species (`"boss_hydra"`: 5 rows, ~14-16 cols wide, ANSI-free, mirror-safe glyphs only — check `MIRROR_SWAP` coverage for every glyph used), excluded from all pools; `BUGS` tier-4 entries stay; the boss bake passes `boss_hydra` as the enemy species when `kind === "boss"`. Blank-row-0 + constant-geometry tests same as any species.
  - **If the union leaks** (pools enumerate the union): SKIP the new species. Boss look = tier-4 bug species + a `♛` crown composited onto the enemy's blank row 0 in the boss bake (the applyHat blank-cell contract, enemy-side) + the caption. Report which branch you took and why.
- [ ] **Step 3:** whichever branch: render the boss standoff through the real shell at 100 cols (no clipping), suite, tsc.
- [ ] **Step 4:** Commit: `feat(living-world): boss look (<branch taken>)` (+ trailer).

---

### Task 7: Visitor trigger + surfacing + toast

**Files:** Modify `server/session.ts` or `server/award-xp.ts` (trigger — see Step 1), `server/combat.ts` (visitor.json I/O — same idiom as pending), `server/state.ts` (render branch + celebration), `server/art.ts` (CelebrationKind); Tests: `server/state_wander.test.ts`-style render test + trigger test.

- [ ] **Step 1 — trigger seam:** in `awardSessionComplete`'s caller path (award-xp.ts session_complete), AFTER the fight/stinger logic: roll ONLY when `completion.fightSummary === null` AND `readPendingEncounter() === null` AND `readEncounter() === null` (combat outranks, spec suppression) AND gate ≠ off. Seed: `hashString(\`visitor:${resolveUserId()}:${startedAt}\`)` — per-session-commit deterministic, one roll per commit.
- [ ] **Step 2 — surfacing:** `write/read/clearVisitor` in combat.ts (own `visitor.json`, atomic, `TRANSIENT_PREFIXES` registered, EncounterRecord-shaped `{frames, sequence, at, caption, enemyGlyph: "◇"}`). `writeStatusState`: in the existing `gate !== "off"` combat block, a third branch — no `enc` AND no surfaced pending ⇒ try `readVisitor()`; if fresh-ish (the shell enforces the real 10s TTL via `encounterAt`, so just pass `at` through as `encounterAt`) surface via the same `combatFrames/combatSequence/artWidth` + captionFrames path, `full`-gated like the resolved scene. Never write `combatSticky`.
- [ ] **Step 3 — toast:** add `"visitor"` to `CelebrationKind` (art.ts — FLOURISH_BY_KIND entry copying the `loot` 2-frame happy blink) + `CELEB_PRIORITY` slot directly below `fight`; `pickCelebration` gains a `visitorText` param following EXACTLY the pattern the 7th param (`statUpText`) used — update its call sites the same way that change did (they're enumerated in state.test.ts + award-xp.ts). Toast text: `🐾 a wild <name> stopped by!` + ` left <n> pts!` when rewarded (points applied via `applyCombatDrops({points})`). The visitor record's `caption` (`A wild <name> stopped by!`) obeys the producer clamp contract from Task 3 — bug/species names are short, but pin its length in a test all the same. At `subtle` the toast is the only surface (celebrations already work at subtle); at `full` toast + scene.
- [ ] **Step 4 — tests:** trigger suppression matrix (fight present ⇒ no roll; standoff present ⇒ no roll; off ⇒ no roll); render e2e: seeded forced visit (temporarily lower odds? NO — pick a seed that hits by search, like the fightWon test does) renders the greet scene + caption through the real shell; celebration surfaces at subtle.
- [ ] **Step 5:** suite, tsc, snapshots.
- [ ] **Step 6:** Commit: `feat(living-world): wild visitors — trigger, scene, toast` (+ trailer).

---

### Task 8: e2e + docs

**Files:** `docs/game-feel/CURRENT-STATE.md` (new section), `design.md` (status: P2 implemented), `docs/game-feel/idle-rpg/testing-guide.md` (§9 boss + visitor harnesses), `README.md` (bug-fights section: boss + visitors mention if it fits the existing voice).

- [ ] **Step 1 — manual e2e** (temp CLAUDE_CONFIG_DIR, testing-guide idioms): (a) 12 error events → boss standoff with pips caption on the real shell; (b) two winning commits → stage pip fills, then kill scene + badge in `buddy_achievements`; (c) forced-seed visitor → greet scene + toast. STOP/BLOCKED on any failure.
- [ ] **Step 2:** full validation sweep (`bun test`, `tsc`, `bash -n`), exact totals.
- [ ] **Step 3:** docs in the established voice; CURRENT-STATE notes the G5 revision (bosses persist mid-fight; D12 unchanged) explicitly.
- [ ] **Step 4:** Commit: `docs(living-world): P2 shipped — bosses + visitors` (+ trailer).

---

## Self-review checklist (run after writing, before executing)
- Spec coverage: D9 (boss width — Task 6), D12 (orphan clear untouched — Task 4), D13 (threshold not roll — Task 2), visitor suppression + subtle toast (Task 7), zero shell changes (all).
- The G5 revision is documented (Task 4 + Task 8 docs step).
- No invented APIs: every uncertain shape has a grep/verify step and a stated fallback.
