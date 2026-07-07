# Design: Derive-on-Read for Upgrade Effects

**Status:** All 4 phases implemented — the model flip is live and documented.
See §10 for per-phase detail; open follow-ups (hat wardrobe, etc.) tracked in
`docs/game-feel/CURRENT-STATE.md`.
**Date:** 2026-07-06
**Branch context:** `feature/interactive-menu` (follows the 2026-07-06 rewards
fix pass documented in `docs/game-feel/CURRENT-STATE.md`)
**Scope:** `server/xp.ts`, `server/equipment.ts`, `server/state.ts`,
`server/index.ts`, `server/combat.ts`, `server/session.ts`, `server/sets.ts`

---

## 1. Problem

The codebase has **two models** for "an owned thing changes how the buddy
looks/performs":

| Model | Used by | Mechanism | Guarantees |
|---|---|---|---|
| **Derive-on-read** | equipment (items.ts + equipment.ts) | `resolveAppearance()` folds effects into a fresh display view at render time | bones never mutated → no clobber, no drift, trivially reversible |
| **Apply/revert** | upgrade purchases (xp.ts) | `applyUpgradeEffect()` mutates `companion.bones` on buy; `revertUpgradeEffect()` best-effort undoes on refund | none — reverts are lossy |

The apply/revert model has produced real bugs, all rooted in mutated bones
being unrecoverable:

- **Lossy stat revert**: a `stat` effect bought while the peak stat sat near
  the 100 cap applies clamped, but reverts the full amount — permanent innate
  stat loss (xp.ts:1117–1122 vs 1148–1153).
- **Hat clobber**: `revertUpgradeEffect` sets `bones.hat = "none"`
  unconditionally — it can strip a hat that came from a loot cosmetic or an
  earlier purchase (xp.ts:1145–1147).
- **Post-ascension refund exploit** (fixed 2026-07-06 with guards): ascension
  reopens respec, making the lossy reverts reachable. The fix added two
  `refundError` guards (hat/stat upgrades permanently non-refundable;
  `pointsSpent >= cost` coverage) — **stopgaps that paper over the root
  cause**. This design is the root fix.

Meanwhile the equipment model has been in production since idle-RPG Phase 1
with zero drift bugs, and `items.ts` already reuses the same declarative
`UpgradeEffect` union — the two systems speak the same effect language but
interpret it differently.

**Goal:** owned upgrades' `hat` / `stat` / `shiny` / `flag` effects become
derived at read time from `XpState.unlockedUpgrades`, exactly like equipped
items. `applyUpgradeEffect` / `revertUpgradeEffect` are **deleted**.

---

## 2. Goals and non-goals

### Goals

1. **G1 — No bones mutation from upgrades.** Buying or refunding an upgrade
   never touches `companion.bones`. Ownership (`unlockedUpgrades`) is the
   single source of truth; effects are folded on read.
2. **G2 — Delete the apply/revert pair** and the `companionChanged` plumbing
   (`UnlockResult.companionChanged`, the `saveCompanion` calls at
   index.ts:1138/1158).
3. **G3 — Clean refunds.** With no mutation, hat/stat refunds become exact:
   the 2026-07-06 "permanent — can't be cleanly reverted" guard is **removed**
   (the pointsSpent-coverage guard and prestige-permanence guard stay — those
   are economy rules, not mutation workarounds).
4. **G4 — Display + combat parity.** For an already-migrated state, the buddy
   looks identical and fights at identical power before and after the flip.
5. **G5 — One-time, crash-safe migration** of existing state where effects
   were already baked into bones.

### Non-goals

- **Loot cosmetics stay direct-mutation.** They are deliberate "bones
  remixes" — permanent identity changes, not toggleable effects. Unchanged
  (loot.ts, incl. the 2026-07-06 `updateCompanionSlot` fix).
- **Behavioral stat leveling stays direct-mutation.** `applyStatIncrements`
  (session.ts) legitimately grows innate `bones.stats` from coding signals.
  Unchanged.
- **No hat wardrobe.** Owning multiple hat upgrades still resolves to one
  worn hat by a fixed rule (§4.2); letting the user *choose* among owned hats
  is a follow-up feature (§9).
- **No change to reactions, titles, or the point economy** beyond the refund
  guard relaxation in G3.

---

## 3. Current vs. target data flow

### Current (apply-on-buy)

```
buddy_upgrades buy ──► spendUnlock()
                         ├─ unlockedUpgrades.push(id)
                         ├─ applyUpgradeEffect(companion, …)   ← MUTATES bones
                         └─ companionChanged: true ──► index.ts saveCompanion()

render ──► gearedBones(bones, equipment, cosmeticFlags)
             └─ bones already carry upgrade hat/stat/shiny (baked in)
```

### Target (derive-on-read)

```
buddy_upgrades buy ──► spendUnlock()
                         └─ unlockedUpgrades.push(id)          ← ONLY ownership

render ──► gearedBones(bones, equipment, cosmeticFlags, ITEMS,
                       ownedUpgradeEffects(xpState))
             │
             └─ resolveAppearance fold order:
                innate bones → upgrade effects (purchase order)
                             → equipped items (slot order)
                             → [seasonal fills empty hat, unchanged, in state.ts]
```

One rule everywhere: **bones = innate identity (species roll + behavioral
growth + loot remixes); everything else is a view.**

---

## 4. Design decisions

### D1 — Resolver input shape: effect list, not upgrade ids

`resolveAppearance` gains one optional parameter, a plain effect list — it
does **not** learn about `XpState` or the upgrade catalog:

```ts
// equipment.ts
export function resolveAppearance(
  bones: BuddyBones,
  equipment: Equipment,
  cosmeticFlags: readonly string[] = [],
  catalog: readonly Item[] = ITEMS,
  upgradeEffects: readonly UpgradeEffect[] = [],   // NEW
): ResolvedAppearance;

export function gearedBones(
  bones: BuddyBones,
  equipment: Equipment,
  cosmeticFlags: readonly string[] = [],
  catalog: readonly Item[] = ITEMS,
  upgradeEffects: readonly UpgradeEffect[] = [],   // NEW
): BuddyBones;
```

The id→effect mapping lives next to the catalog in xp.ts:

```ts
// xp.ts
/** Effects of owned upgrades, in purchase order (unlockedUpgrades order). */
export function ownedUpgradeEffects(state: XpState): UpgradeEffect[];
```

Rationale: equipment.ts stays pure and I/O-free (its module contract), keeps
zero xp.ts imports (items.ts already type-imports `UpgradeEffect` from xp.ts —
type-only, no cycle), and stays trivially unit-testable with literal effect
arrays. Callers that have an `XpState` compose the two. The default `[]`
keeps every existing call site compiling and behaving identically until
Phase 3 flips them (and lets combat's catalog-injection tests keep working).

### D2 — Fold precedence

Within `resolveAppearance`, effects fold in this order (later wins for `hat`;
`shiny`/`flag` are monotonic ORs/unions; `stat` sums then clamps):

1. **Innate bones** — the base (species roll, behavioral stat growth, loot
   remixes).
2. **Upgrade effects, in `unlockedUpgrades` (purchase) order** — preserves
   today's "last hat you bought is the one you wear" feel deterministically.
3. **Equipped items, in slot order** — deliberate gear choices beat passive
   upgrades (an equipped headgear hat overrides an owned crown), matching the
   existing "equipment folds last" behavior.
4. **Seasonal hat** — unchanged, stays in state.ts: fills the hat only when
   the *resolved* hat is `"none"`. Since a baked upgrade hat previously made
   `bones.hat ≠ none`, and the derived hat now does the same, seasonal
   behavior is identical.

Stat clamping stays per-fold-step at `1..100` (the existing resolver rule), so
displayed/combat stats never exceed 100 regardless of stacking.

### D3 — Migration strategy: clean-break rebase (recommended)

Existing state has effects **baked into bones** (e.g. `bones.stats[peak]`
already contains stat_boost's +5; `bones.hat` is already `"crown"`). Turning
on derivation without migration would **double-count stats** (hat/shiny are
idempotent — same value re-derived — but stats are additive).

Two candidate strategies:

| | **A. Clean-break rebase** (recommended) | B. Grandfather list (`bakedUpgrades`) |
|---|---|---|
| Mechanism | One-time rewrite of companion slots: subtract baked effects, then derive everything | Snapshot `unlockedUpgrades` at migration into a `bakedUpgrades` list; resolver skips those ids forever |
| End state | One model, no legacy | Two effect classes forever; refund guard must stay for baked ids |
| Risk | Rebase heuristics (below) are approximate in rare cases | None (no state rewrite) |
| Code | Migration module, deletable later | Permanent resolver branch + guard branch |

**Recommendation: A.** This is a single-profile app; the approximation cases
(below) are narrow, and B leaves the lossy-revert permanence rule alive
indefinitely — the exact thing this design exists to kill.

**Rebase algorithm** (per companion slot; runs once, gated by markers — §5):

- **Stat:** for the *active* slot only:
  `bones.stats[peak] = clamp(bones.stats[peak] − Σ owned stat amounts, 1, 100)`.
  Effects were only ever applied to the companion active at purchase time, and
  there is no per-slot record — non-active slots get **no** stat subtraction
  (if the user switched buddies after buying, the old buddy keeps a small
  grandfathered innate bonus; one-time, bounded at +18, and never
  double-counted because derivation folds on top of whatever innate remains).
  *Known imprecision:* a purchase that clamped at 100 under-subtracts by the
  clamped remainder — accept (requires peak ≥ 96 at buy; current profile's
  peak is 76).
- **Hat:** for *every* slot: if `bones.hat` equals the `hat` of any owned
  upgrade (`tinyduck`/`crown`/`wizard`), set `bones.hat = "none"` — derivation
  re-applies it, so display is unchanged. If the same hat is *also* granted by
  an owned loot cosmetic (`loot_wizard_hat` vs the `wizard_hat` upgrade —
  both `"wizard"`), keep `bones.hat` as-is: loot is innate by design, and the
  derived fold produces the same display either way, but a future refund of
  the upgrade must not strip the loot hat.
- **Shiny:** for *every* slot: if `cosmeticFlags` contains `"aura_shiny"`
  (the existing "shimmer came from the aura, not nature" marker) **and** no
  owned loot cosmetic sets shiny (`loot_aurora`, `loot_cosmic_static`), set
  `bones.shiny = false` and remove `"aura_shiny"` from `cosmeticFlags` —
  derivation (`owns shiny_aura → shiny`) restores the display. Naturally-shiny
  buddies (no `aura_shiny` flag) are untouched.
- **Flags:** owned flag upgrades currently live in `XpState.cosmeticFlags`
  (clean, revertible — never the bug). They migrate too, for one uniform rule
  ("owning an upgrade = its effect is active"): remove each owned upgrade's
  flag from `cosmeticFlags` (derivation re-adds it). `cosmeticFlags` then
  holds only non-upgrade grants (`grantCosmeticFlag` easter-egg/hatch paths),
  which keep working unchanged as the resolver's base set.

### D4 — Cosmetic sets read the *resolved* appearance

`memberMet` (sets.ts:44–53) currently checks `companion.bones.hat` for
`"hat:<hat>"` tokens and `state.cosmeticFlags` for flag tokens. Post-
migration, a bought crown no longer lives in either. `memberMet` switches to
the resolved appearance:

```ts
// sets.ts — memberMet(member, state, companion)
const a = resolveAppearance(
  companion.bones, state.equipment, state.cosmeticFlags,
  ITEMS, ownedUpgradeEffects(state),
);
// "hat:x" → a.hat === x        (was: bones.hat === x)
// flag    → a.flags.includes(member)   (was: state.cosmeticFlags.includes)
```

Semantics stay "what your buddy currently looks like": a worn equipped
headgear can complete/uncomplete a set, same as a bought hat could before.
Title grants are already idempotent and never clobber a worn title, so
toggling is harmless. Side effect worth naming: a *naturally* shiny buddy
that buys `shiny_aura` now satisfies the Twinkle set's `aura_shiny` member
(derived `aura_shiny` = owns `shiny_aura`) — previously impossible because
the flag was skipped for natural shimmer. This is a fix, not a regression:
the set asks for the purchase, and the purchase is owned. (Implementation
note: derived flags must include `aura_shiny` when `shiny_aura` is owned —
either keep the shiny effect implying the flag in the resolver, or add it in
`ownedUpgradeEffects`.)

### D5 — Refund guards after the migration

`refundError` (xp.ts:1205–1234) becomes:

| Guard | Fate | Why |
|---|---|---|
| Respec lock (`respecLockedAt !== null`) | **keep** | economy rule |
| Unknown / not-owned | **keep** | validation |
| Prestige-tier permanence | **keep** | design rule (FR1.4), independent of mutation |
| Hat/stat "can't be cleanly reverted" | **DELETE** | reverts are now exact: refund = remove id, derivation drops the effect |
| `pointsSpent < cost` coverage | **keep** | pure economy invariant (post-ascension budget), still correct |

`refundUnlock` loses the companion parameter entirely (it only needed it for
`revertUpgradeEffect`); same for `spendUnlock` — **almost**: `purchaseError`
still needs `companion` for species/rarity gates, so `spendUnlock(id,
companion)` keeps its signature but never mutates or reports
`companionChanged`.

---

## 5. Migration mechanics

### Trigger and markers

- New `XpState` field: `upgradeEffectsDerived?: boolean` (absent = legacy).
  `backfillXpState` defaults it `false` for existing files, `true` for
  brand-new states (nothing to migrate).
- New per-slot companion field: `effectsRebased?: boolean`.
- Entry point: a `migrateUpgradeEffects()` function (new `server/migrate.ts`
  or colocated in xp.ts), invoked from `loadXpState()` when the marker is
  falsy. The check is one field-read on the already-parsed state — zero cost
  on the hot path after the one-time run. Running inside `loadXpState`
  covers **every** process that touches xp state: the MCP server (index.ts),
  the hook-spawned `award-xp.ts`, and tests.
- Companion-store access from xp.ts uses the established lazy
  `require("./state.ts")` idiom (state.ts already lazy-requires xp.ts;
  runtime-lazy in both directions is safe, and the migration path is
  best-effort `try/catch` like every other cross-module read).

### Crash-safety / idempotence

Order of operations makes a crash at any point safe to re-run:

1. For each companion slot without `effectsRebased`: compute the rebase
   (D3), set `effectsRebased: true` **in the same object**, persist via
   `updateCompanionSlot` (atomic tmp+rename). Stat subtraction — the only
   non-idempotent step — is guarded by the per-slot flag, so a crash between
   slots never double-subtracts.
2. Only after all slots carry the flag: set `upgradeEffectsDerived: true` on
   the xp state and `saveXpState` (atomic).

A crash before step 2 re-enters the migration on next load and skips
already-flagged slots. The `effectsRebased` flag is permanent slot metadata
(harmless; also documents which save-file era a companion came from).

**Ordering constraint:** the consumer flip (Phase 3) and the migration ship
in the same release — derivation without migration double-counts stats;
migration without derivation strips display. Within one process this is
guaranteed structurally: every read path that derives goes through
`getXpState`/`loadXpState`, which migrates first.

---

## 6. Consumer rewiring map

| Site | Today | After |
|---|---|---|
| `state.ts:1005` writeStatusState | `gearedBones(bones, eq, cosmeticFlags)` | + `ITEMS, ownedUpgradeEffects(xpStateForStatus)` (state is already in scope) |
| `index.ts:283` buddy_show card | `gearedBones(bones, xp.equipment, xp.cosmeticFlags)` | same addition |
| `combat.ts:245` resolveCombat | `resolveAppearance(bones, equipment)` — **stat upgrades count today only because they're baked into bones**; without rewiring, migrated buddies would silently lose up to +18 effective DEBUGGING | `resolveCombat` gains an `upgradeEffects: readonly UpgradeEffect[] = []` parameter, threaded to the resolver; caller (session.ts:265 `maybeFightBug`) passes `ownedUpgradeEffects(xpState)` (G4: power parity) |
| `index.ts:1138/1158` spend/refund | `if (res.ok && res.companionChanged && companion) saveCompanion(companion)` | line deleted; `UnlockResult.companionChanged` field deleted |
| `sets.ts memberMet` | `bones.hat` / `state.cosmeticFlags` | resolved appearance (D4) |
| `xp.ts applyUpgradeEffect` / `revertUpgradeEffect` / `addFlag`+`removeFlag` (if orphaned) | exist | **deleted** |
| `xp.ts refundError` | 6 guards | hat/stat lossiness guard deleted (D5) |
| statusline (`buddy-status.sh`) | reads status.json | no change — derived appearance flows through `writeStatusState` |

Not rewired (deliberately, per non-goals): `loot.ts` cosmetic `apply`,
`session.ts applyStatIncrements`, `grantCosmeticFlag`, seasonal-hat logic.

---

## 7. Semantic deltas (user-visible)

1. **Menagerie-wide effects.** Upgrades now affect *every* companion
   (ownership is global in xp.json), not just whoever was active at purchase.
   Previously a bought crown existed only on one buddy's bones. This is an
   upgrade-feel improvement and consistent with equipment (also global), but
   it is a change — worth one line in the user guide.
2. **Hat precedence is now a rule, not history.** Last-*purchased* upgrade
   hat wins (stable), equipped headgear beats it, loot hat = innate base.
   Before, "whatever mutated bones last" won, which could be a loot drop
   landing after a purchase.
3. **Hat/stat refunds become available** while respec is open (they were
   blocked by the 2026-07-06 guard). Post-ascension, the pointsSpent-coverage
   guard still limits refunds to current-budget purchases.
4. **Twinkle set completable by naturally-shiny buddies** (D4).
5. **Grandfathered stats on non-active slots** (D3): a buddy that received
   stat effects and was later benched keeps them as innate — visible only as
   slightly-higher base stats, never double-counted.

---

## 8. Test plan

New/updated coverage (existing baseline: 685 pass):

1. **Resolver fold** (equipment.test.ts): upgrade effects param — purchase-
   order hat precedence; equipped headgear overrides upgrade hat; stat
   sum + clamp at 100 with both upgrade and item stat effects; shiny OR;
   flag union incl. derived `aura_shiny`; default `[]` byte-identical to
   today's outputs (regression pin for Phase 1's inertness).
2. **Spend/refund purity** (xp.test.ts): `spendUnlock`/`refundUnlock` on a
   companion object → deep-equal bones before/after (G1); buy→refund→buy
   round-trip at the 100 stat cap loses nothing (the old lossy case, now
   exact); the two 2026-07-06 guard regression tests **flip**: hat/stat
   refund with respec open now *succeeds*; the pointsSpent-coverage and
   prestige-permanence tests stay green unchanged.
3. **Migration** (fresh-process, the loot.test.ts spawnSync idiom — state.ts
   freezes STATE_DIR at module load): seed a legacy xp.json (no marker,
   owned `stat_boost`+`crown`+`shiny_aura`+`beanie`) + companion slots with
   baked bones → first `loadXpState()` rebases; assert (a) resolved display
   identical pre/post (G4 parity), (b) `bones.stats[peak]` reduced by owned
   amounts on the active slot only, (c) `bones.hat` reset unless loot-owned,
   (d) markers set, (e) second load is a no-op (idempotence), (f) crash
   simulation: slot flagged but xp marker absent → re-run skips the slot.
4. **Combat parity** (combat.test.ts): same seed/bug/equipment, stats split
   as baked-innate vs innate+derived → identical `CombatResult`.
5. **Sets** (sets.test.ts): `hat:crown` met via owned crown upgrade, via
   equipped crown-hat item, and unmet after refund; `aura_shiny` via owned
   `shiny_aura`.
6. **Status write** (state tests): status.json bones reflect derived hat/
   stat/shiny for an owned-upgrades state.

---

## 9. Open questions (decide before or during implementation)

1. **Hat wardrobe** — with multiple owned hat upgrades, should the user pick
   the worn one (e.g. `buddy_upgrades wear=<hat>` storing a `wornHat`
   preference in XpState, folded between upgrades and equipment)? Purchase-
   order default ships first; wardrobe is a clean follow-up because
   derivation makes it a pure preference field. **Default: defer.**
2. **Delete `migrate.ts` later?** After the profile has migrated, the code is
   dead weight but protects stale backups/other machines. **Default: keep**
   (it's ~60 lines and self-gating).
3. **`active?` field on `UnlockableUpgrade`** (xp.ts:211) — appears vestigial;
   confirm during Phase 3 and delete if nothing reads it.

---

## 10. Phased implementation plan (for `/sc:implement`)

Matches the repo's phased convention (status.md tracker per phase, tests
green + `tsc` clean at each boundary; each phase is a working tree state).

- **Phase 1 — Resolver extension (inert). DONE (2026-07-06).**
  `upgradeEffects` param on `resolveAppearance`/`gearedBones` (equipment.ts) +
  `ownedUpgradeEffects()` (xp.ts) + fold tests (§8.1, incl. the shiny→
  `aura_shiny` implication per the D4 implementation note). Default `[]` is
  pinned byte-identical via a regression test. No consumer sites rewired yet
  (Phase 3). **694 tests pass** (685 + 9 new), `tsc --noEmit` clean.
- **Phase 2 — Migration machinery (inert). DONE (2026-07-06).**
  New `server/migrate.ts`: `rebaseCompanionBones` (pure, per-slot D3 rebase),
  `lootGrantedAppearance` (pure, simulates each owned loot cosmetic's
  `apply()` on a probe companion rather than hardcoding an id→appearance
  map), and `migrateUpgradeEffects` (the I/O entry point — lazy-requires
  `state.ts`/`loot.ts`, guarded try/catch, matching xp.ts's existing
  cross-module idiom). Markers: `XpState.upgradeEffectsDerived` (backfilled
  `true` for brand-new state, `false` for an existing legacy blob) and
  `Companion.effectsRebased` (engine.ts). **Not** wired into `loadXpState` —
  that stays the first commit of Phase 3 so migration and derivation flip
  atomically (§5 ordering constraint); confirmed no `migrate` reference
  exists in xp.ts yet. Fresh-process test (spawnSync idiom, real companion
  store) covers all of §8.3 (a)-(f): active-vs-benched hat/shiny/stat
  handling, markers, idempotence, and the crash-simulation skip. **711 tests
  pass** (694 + 17 new), `tsc --noEmit` + `bash -n` clean.
- **Phase 3 — The flip. DONE (2026-07-06).** `loadXpState` now calls
  `migrateUpgradeEffects` (lazy-required, guarded try/catch) whenever
  `!state.upgradeEffectsDerived`, then persists the result — covers every
  process that touches xp state (MCP server, hook-spawned `award-xp.ts`,
  tests). All six consumer sites rewired (§6): `state.ts` writeStatusState
  and `index.ts`'s `buddy_show` card now pass `ITEMS, ownedUpgradeEffects(xp)`
  into `gearedBones`; `combat.ts` `resolveCombat` gained an `upgradeEffects`
  param threaded from `session.ts`'s `maybeFightBug` (G4 power parity);
  `sets.ts` `memberMet` reads the resolved appearance (with a
  no-companion fallback that checks ownership directly, since there's no
  bones to fold); the `index.ts` spend/refund handlers no longer
  save-on-mutate. Deleted: `applyUpgradeEffect`/`revertUpgradeEffect`,
  `addFlag`/`removeFlag` (orphaned), `UnlockResult.companionChanged` (and
  every construction site), the vestigial `UnlockableUpgrade.active` field
  (confirmed unread — open question #3). `refundUnlock` dropped its
  companion parameter entirely; `refundError`'s hat/stat lossiness guard
  (D5) is gone — refunds are exact now, gated only by the pointsSpent-
  coverage and prestige-permanence rules. The two 2026-07-06 guard
  regression tests flipped (hat/stat refund with respec open now
  *succeeds*). New tests: spend/refund purity + the 100-cap round-trip
  (xp.test.ts), combat power parity + a default-`[]` no-op pin
  (combat.test.ts), sets derive-on-read incl. the no-companion fallback
  (sets.test.ts, stubs upgraded to real shapes), and a fresh-process
  statusline test proving an owned upgrade's hat renders without touching
  innate bones (state_wander.test.ts). **724 tests pass** (711 + 13 new),
  `tsc --noEmit` + `bash -n` clean.
- **Phase 4 — Docs + validation. DONE (2026-07-06).** README gained a
  semantic-delta note (menagerie-wide unlocks, exact hat/stat refunds) next
  to the existing respec line; `idle-rpg/testing-guide.md` gained a §7 with
  a live buy/refund/migration harness; `CURRENT-STATE.md` gained a full
  "Derive-on-read for upgrades" recap plus an architecture-invariant update
  (#3) and doc-map entry; `idle-rpg/todo.md` DONE-list entry + a new hat-
  wardrobe follow-up. Live-profile validation: the repo's own PostToolUse
  hooks (pointed at this checkout, not an installed copy) fired against the
  real `~/.claude-buddy` profile while editing during Phase 3 and correctly
  ran the new migration path for real — confirmed via `effectsRebased: true`
  appearing on the real companion slot, a harmless no-op since that profile
  owns zero upgrades. Also confirmed `bun test` itself never touches the
  real profile (menagerie.json/xp.json mtimes unchanged across a full run).
  Full suite + `tsc --noEmit` + `bash -n` re-verified clean at **724 pass**.

Estimated diff: ~-80 lines in xp.ts (apply/revert/plumbing), +~40 resolver/
helper, +~70 migration, +~250 tests.
