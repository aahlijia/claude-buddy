# Idle RPG — Implementation Status

Single source of truth for where the [idle-RPG arc](design.md) stands. Update
this file as phases land. For hands-on verification, see the
[testing guide](testing-guide.md).

_Last updated: 2026-06-30 · branch `feature/free-roam-combat` · **P1–P5 done** (P5 committed in `d55360c`) · 2026-06-30 game-feel fixes uncommitted — see [CURRENT-STATE.md](../CURRENT-STATE.md)_

## Phase tracker

| Phase | Feature | Design | Code | Tests | State |
| --- | --- | :---: | :---: | :---: | --- |
| 1 | [Equipment slots](phase-1-equipment.md) | ✅ | ✅ | ✅ | **Done** |
| 2 | [Merchant + interactive menus](phase-2-merchant.md) | ✅ | ✅ | ✅ | **Done** |
| 3 | [Bugs as enemies + baked combat](phase-3-combat.md) | ✅ | ✅ | ✅ | **Done** (render = Phase 4) |
| 4 | [Statusline render + opt-out gate](phase-4-statusline.md) | ✅ | ✅ | ✅ | **Done** |
| 5 | [Two-sprite scene + free-roam layout](phase-5-combat-scene.md) | ✅ | ✅ | ✅ | **Done** (resolves OQ-P4.1) |

Legend: ✅ done · 🟡 in progress · ⬜ not started

### Phase 5 — Two-sprite combat scene + free-roam layout
- `server/bugs.ts` — `Bug.species` (+ optional `eye`); 7 bugs mapped to a curated
  5-line ANSI-free roster (excludes wyvern/pikachu).
- `server/art.ts` — pure `mirrorFrame`/`rectFrame` (code-point reverse + directional
  glyph swap), reusing `displayWidth`/`dpad`/`getArtFrame`.
- `server/combat.ts` — `bakeScene` replaces `bakeFrames`: player + mirrored enemy
  side by side, constant-width ready→wind-up→strike(clash)→resolve flipbook.
- `server/state.ts` — `StatusState.combatFrames`/`combatSequence`/`artWidth`;
  `writeStatusState` uses the fresh `encounter.json` scene (the baked frames Phase 4
  threw away) and stops forcing `emotion="angry"` (idle frames stay neutral).
- `statusline/buddy-status.sh` — **free-roam layout**: left-anchored stats + a
  roaming buddy cluster (bubble travels with buddy), full-span in-window clamp,
  bubble-drop degradation at narrow widths (fixes clipping); **combat branch**:
  jq 3-way frame source (combat > flourish > idle), dynamic `ART_W`/`ART_CENTER`,
  glyph fallback only on version skew; `BUDDY_FAKE_COLS` test seam.
- Tests: `bugs.test.ts`, `art.test.ts`, `combat.test.ts`, `statusline_render.test.ts`
  (free-roam invariants rewritten; wide-corridor block retired; combat-scene block
  added). Retired: `wanderWide`/`wanderBubble` flags (the whole line is the lane).

## Locked decisions (apply to all phases)

- **Economy:** reuse **skill points** — one shared wallet for upgrades + gear. No
  new currency. (Escape hatch if it chafes: a "Bug Bounty" currency, see
  [design.md](design.md) §1.)
- **Combat:** **auto-idle** — the server bakes fight frames once per commit; the
  statusline only cycles them. **Zero per-tick cost.**
- **Render invariant:** `buddy-status.sh` is a dumb frame-cycler. Bugs/combat are
  precomputed frame sequences (like `flourishFrames`), never a live loop.
- **Gear model:** **derive-on-read** — equipment is the source of truth; `bones`
  is never mutated (no-clobber, no-drift).

## What's built

### Phase 1 — Equipment slots
- `server/items.ts` — `Slot` (weapon/headgear/trinket), `Item`, `Equipment`,
  `ITEMS` catalog (5 items), `STARTER_INVENTORY`, lookups. `Item.level` gate
  added in Phase 2.
- `server/equipment.ts` — pure `equipItem`/`unequipSlot`/`equipError`,
  `resolveAppearance` (derive-on-read), `gearedBones`, `renderLoadoutCard`.
- `server/xp.ts` — `equipment`/`inventory` on `XpState`; `coerceEquipment`
  backfill (starter-seed + invariant repair); I/O wrappers
  `equipFromInventory`/`unequipToInventory`/`grantItem`.
- `server/index.ts` — `buddy_equip` tool; `buddy_show` renders `gearedBones`.
- `server/state.ts` — `writeStatusState` folds `gearedBones` so equipped
  **headgear shows on the live status line** (one substitution; weapon/trinket
  glyphs deferred to Phase 4).
- Tests: `items.test.ts`, `equipment.test.ts`, migration cases in `xp.test.ts`.

### Phase 2 — Merchant + interactive menus
- `server/shop.ts` — pure `ownedItems`, `buyError`, `buyStatus`, `shopListing`,
  `renderShopCard`, `buyableChoices`, `choicesMarker`.
- `server/xp.ts` — `buyShopItem` I/O wrapper (debit `pointsSpent` + grant).
- `server/items.ts` — optional `Item.level`; gates set
  (foam_sword/lucky_hat = Lvl 3, compiler_crown = Lvl 6).
- `server/index.ts` — `buddy_shop` tool; **SHOP MENU directive** added to
  `getInstructions()` (turns the `buddy:choices` marker into an
  `AskUserQuestion`).
- Tests: `shop.test.ts`.

### Phase 3 — Bugs + baked combat
- `server/bugs.ts` — `Bug`, `BUGS` (7 bugs, tiers 1–4), `tierForErrors`,
  `spawnBug` (seeded).
- `server/combat.ts` — pure `resolveCombat` (seeded → outcome + baked frames +
  `DropSpec`), `winChance` (tunable curve), frame baker (reuses `renderFace`
  with fight-expression eyes), rarity-weighted item-drop roll; I/O wrappers
  `applyCombatDrops` (`grantBonusPoints` + `grantItem`), `writeEncounter` /
  `readEncounter` (transient `encounter.json`, TTL like loot's `lastDrop`).
- `server/session.ts` — `maybeFightBug` hooked into `awardSessionComplete` (once
  per commit, reuses `delta.errors_seen`, seed = `userId:startedAt:errorsSeen`);
  surfaces a `Celebration{kind:"loot"}` toast now. **No bash** (render = Phase 4).
- Tests: `bugs.test.ts`, `combat.test.ts`. Integration verified by smoke (the
  `awardSessionComplete` I/O path is intentionally not unit-tested in-process,
  matching `session.test.ts`'s documented scope).

### Phase 4 — Statusline render + opt-out gate
- `server/state.ts` — optional `StatusState.enemyGlyph?`/`encounterAt?`;
  `writeStatusState` reads `encounter.json` (`readEncounter`) and, while fresh,
  biases `emotion = "angry"` (reuses the emotion-frame pipeline — no bespoke
  cycler) + surfaces the glyph fields. Render model: **reuse emotion frames + a
  margin glyph**, not a parallel frame cycler.
- `server/session.ts` — `effectiveGameFeel() === "off"` early-returns in **both**
  `maybeFightBug` and `accrueSessionStats` → `off` is a true opt-out (combat +
  stat accrual). **Closes the stat-leveling opt-out debt.**
- `statusline/buddy-status.sh` — `$enc_fresh` added to the **existing** single
  `jq` pass (TTL idiom, gated `gf==full`); two fields read; the glyph is appended
  **rightmost** on the eye row, inside the wander-free margin. **Zero new forks**
  (still one `jq` over `$STATE`). `bash -n` clean.
- Gate model (refines [[design]] §1): `off` = opt-out · `subtle` = resolve +
  toast, no animation · `full` = + fight face & glyph.
- Tests: 4 new cases in `statusline_render.test.ts` incl. the **layout-invariant**
  test (glyph adds only to the right margin — exactly one line changes, as a
  suffix). Opt-out + `writeStatusState` pickup verified by smoke.

## Post-review fixes (2026-06-25)

A `/sc:analyze` pass found and fixed:
- **Enemy glyph on the wrong row** — hardcoded `_FACE_ROW=1` hit the ears for most
  species (eyes are on row 2). Now `_FACE_ROW = ART_COUNT / 2`; regression test
  asserts the glyph lands on the eye row.
- **Phantom item drops** — `rollItemDrop` could "find" an item the player already
  owns (the grant then silently no-ops). Now excludes the owned set
  (`resolveCombat` takes `owned`, fed by `ownedItems`); test guards it.
- **Double `getXpState()` in `writeStatusState`** — hoisted to a single read.
- **TTL drift** — encounter render / `readEncounter` / fight-face now share
  `ENCOUNTER_TTL_MS = 10_000`, aligned with the full-gate toast.
- Dropped a redundant `as Rarity` cast in `combat.ts`.

## Verification (current)

- `tsc --noEmit`: **clean** · `bash -n buddy-status.sh`: **clean**
- `bun test`: **605 pass / 0 fail** (532 → +33 P1 → +14 P2 → +20 P3 → +4 P4 → +2 fixes)
- Statusline: **zero new forks** (one `jq` over `$STATE`, unchanged).
- Smoke (fresh process, temp state dir): P1 equip/swap/geared render; P2 shop
  browse→buy→owned-block; P3 commit-with-errors → win drops points + item,
  encounter persists, no-error = no-op; P4 `full` surfaces `enemyGlyph` in
  status.json, `off` disables combat **and** accrual.
- **Not yet:** `bun run install-buddy` + Claude Code restart (required to see it
  live). The interactive shop menu (AskUserQuestion firing) is the one behavior
  unverified outside unit tests — the marker emission is tested, the live prompt
  is not.

## New MCP tools

| Tool | Phase | Purpose |
| --- | --- | --- |
| `buddy_equip` | 1 | View loadout; `equip=<id>` / `unequip=<slot>` |
| `buddy_shop` | 2 | Browse catalog; `buy=<id>` (skill points) |

## Follow-ups (post-arc)

_Design/UX decisions (not bugs) — deferred pending product calls:_
- **Inventory cap** (OQ-P1.3) — drops compound unbounded; needs a cap or stacking.
- **Shared-wallet UX** (OQ-P2.4) — gear competes with upgrades for skill points;
  the Bug-Bounty currency remains the escape hatch if it chafes in playtest.
- **Discoverability** — `buddy_shop` is unsurfaced; `buddy_equip` only hinted when
  geared. Consider a one-line nudge somewhere players will see it.
- **OQ-P2.1** — selling/refunding gear (currently buy-only).
- **OQ-P4.1** — bespoke fight choreography atop the v1 emotion-frames render.
- **OQ-P4.5** — fold the `off`=opt-out wording into [design.md](design.md) §1.
- Weapon/trinket glyphs on the status line (deferred from Phase 1).
- Ship: `bun run install-buddy` + restart, then verify the live shop menu.

## Open questions still outstanding

- **OQ-P2.1** — selling/refunding gear (deferred; buy-only today).
- **OQ-P2.4** — one shared wallet vs. separate Bug Bounty currency (watch in
  playtest).
- **Phase 4** — the game-feel **opt-out gate** still needs wiring (also owed from
  stat-leveling); encounters must respect it.
- **Live menu** — confirm the SHOP MENU directive reliably fires `AskUserQuestion`
  in a real Claude Code session.
