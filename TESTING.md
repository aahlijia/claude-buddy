# Testing claude-buddy

This document lists what the test suite covers. For a walk-through of the
contribution workflow (DCO, CI, commit style), see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Running tests

```bash
bun test           # run the suite
bun run typecheck  # run tsc --noEmit
```

Both are run on every push/PR to `main` by `.github/workflows/ci.yml`
(`bun install --frozen-lockfile` → `bun run typecheck` → `bun test`) and must
be green before merge (enforced by branch protection).

## Where tests live

Tests are co-located next to the source files they cover:

```
server/
  engine.ts     ↔ engine.test.ts
  state.ts      ↔ state.test.ts
  reactions.ts  ↔ reactions.test.ts
  combat.ts     ↔ combat.test.ts
  menu.ts       ↔ menu.test.ts
  ...
```

Current totals: **679 tests** across **28 files**, ~33,800 `expect()` calls.

---

## Test files, by area

### Companion identity & rendering

- **`engine.test.ts`** — the deterministic generation engine: `hashString`,
  `mulberry32`, `generateBones` (species/rarity/stats invariants across
  sample user IDs), `renderFace`, `renderCompact`. **This is the only file
  with golden snapshot tests** — see below.
- **`art.test.ts`** — `displayWidth` and the shared ASCII-art rendering
  helpers (mirroring, rectangularizing frames for the two-sprite combat
  scene).
- **`reactions.test.ts`** — `getReaction` (species/rarity/reason
  combinations), `generateFallbackName`, `generatePersonalityPrompt`.
- **`state.test.ts`** — the pure `slugify` helper and other `state.ts`
  string utilities.
- **`path.test.ts`** — `CLAUDE_CONFIG_DIR` resolution across profiles.
- **`paths_sh.test.ts`** — `scripts/paths.sh` shell path-resolution
  behavior (invoked as a subprocess).
- **`manifest.test.ts`** — shipped plugin manifest integrity.

### Leveling, stats, and rewards

- **`xp.test.ts`** — `pointsForLevel` and XP/level math.
- **`session.test.ts`** — `computeSessionBonus` (session-completion XP).
- **`streak.test.ts`** — `streakBonus` (session-streak milestones).
- **`sets.test.ts`** — `memberMet` / `setProgress` (cosmetic-set tracking).
- **`achievements.test.ts`** — `ACHIEVEMENTS` catalog integrity.
- **`loot.test.ts`** — `LOOT_COSMETICS` loot-box table integrity.
- **`quests.test.ts`** — `whimForDate` (daily whim/flavor text).
- **`discovery.test.ts`** — `announceOnce` (the once-ever discovery
  announcement, and its interaction with other celebrations).

### Idle-RPG (equipment, merchant, combat)

- **`items.test.ts`** — item catalog integrity (`ITEMS`, slots, level
  gates).
- **`catalog.test.ts`** — combined item/upgrade catalog coverage.
- **`equipment.test.ts`** — `equipItem` / `unequipSlot` (derive-on-read
  appearance, bones never mutated).
- **`shop.test.ts`** — `ownedItems` / merchant buy-eligibility logic.
- **`bugs.test.ts`** — the `BUGS` catalog (tiers, species mapping)
  integrity.
- **`combat.test.ts`** — `winChance` and the pure, seeded `resolveCombat`
  math (determinism, drop rolls).

### Interactive menu

- **`menu.test.ts`** — the `MENU` tree invariants (bounds, reachability,
  id/label uniqueness, `buddy_*` naming), the security denylist (no
  tool-leaf reaches `buddy_uninstall`), `advance()`'s branch coverage, and
  `askFor`/`navMarker`/`resolveSelect`/`renderMenuCard` round-trips.

### Cross-session memory & pair-programming

- **`memory-callbacks.test.ts`** — the `historyCallback` used by
  `buddy_memory` (project/bug tracking across sessions).

### Status line & rendering pipeline

- **`statusline.test.ts`** — status-line settings patch logic.
- **`statusline_render.test.ts`** — `buddy-status.sh` render invariants:
  prestige-title rendering, the free-roam in-window clamp, and the
  combat-scene frame source (idle/flourish/combat priority, dynamic
  width, no-clip).
- **`state_wander.test.ts`** — `writeStatusState`'s wander gate
  (game-feel-gated, opt-out respected).
- **`wander.test.ts`** — `buildWanderSequence` (pure, seeded idle-walk
  generation).

### Uninstall & lifecycle

- **`uninstall.test.ts`** — `cleanupPluginState` (clean removal, leaves
  companion data intact).

---

## Golden snapshots

`engine.test.ts` pins the exact `generateBones` output for three fixed user
IDs. If any of these fail, the generation algorithm has changed in a way
that would give every existing user a different buddy — which is the one
thing claude-buddy promises never to do. Stop and ask "did I mean to do
that?" before updating the snapshots.

| User ID | Rarity | Species |
|---------|----------|----------|
| `golden-user-alpha` | common | capybara |
| `golden-user-beta` | common | chonk |
| `legendary-seed-1` | uncommon | capybara |

Plus: a custom-salt variant of `golden-user-alpha` is checked for both
stability (same custom salt → same bones) and isolation (custom salt ≠
default salt).

---

## What is NOT tested (and why)

The following are intentionally excluded from the current suite:

- **MCP protocol handlers in `server/index.ts`** — the `registerTool`
  wiring and tool-call surface itself. Integration territory; would need
  an MCP client mock. (Individual handlers' *pure* logic is tested via
  their own modules — e.g. `combat.ts`, `equipment.ts`, `menu.ts`'s
  `runTool` dispatch.)
- **`searchBuddy` in `engine.ts`** — brute-force search, CPU-heavy, hard to
  assert on without fixing a seed for `crypto.randomBytes`.
- **CLI scripts under `cli/`** — I/O and subprocess heavy; best covered by
  end-to-end tests against a real install (`bun run doctor` is the
  closest thing to a smoke test today).
- Most of **`hooks/`** and **`statusline/`** are bash, not run under
  `bun test` — `scripts/paths.sh` is the one exception
  (`paths_sh.test.ts` invokes it as a subprocess). The rest is verified
  by manual checks listed in `CONTRIBUTING.md` under "Manual testing".

Contributions that add tests for any of these are welcome.

---

## Test framework

Tests use [`bun:test`](https://bun.sh/docs/cli/test), Bun's built-in
Jest-compatible runner. No extra dependencies. File pattern: `*.test.ts`.

Published npm tarballs exclude test files via the `"!**/*.test.ts"` glob in
the `"files"` array of `package.json` — contributors see them, users don't.
