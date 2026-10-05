# NEXT — handoff for the HD overhaul

_A fresh session starts here. Last updated after H3._

**Branch:** `feature/living-world`. Develop, commit and push there:
`git push -u origin feature/living-world`.

## Where things stand

| Phase | State | Doc |
| --- | --- | --- |
| Buddy Quest RPG (`;` commands, `bun run play`) | done | [../buddy-quest/design.md](../buddy-quest/design.md), [../buddy-quest/design-animation.md](../buddy-quest/design-animation.md) |
| H0: framebuffer, tier encoders, HD blob, `bun run gfx-demo` | done | [h0-spike.md](h0-spike.md) |
| H1: rig format, motion library, HD blob, cat and dragon | done | [h1-rigs.md](h1-rigs.md) |
| H2: HD fights in the quest player | done | [h2-quest-player.md](h2-quest-player.md) |
| H3: the buddy UI kit (`server/ui/`) | done | [h3-ui-kit.md](h3-ui-kit.md) |
| **H4: the buddy-shell diorama** | **next** | this file and [brainstorm.md](brainstorm.md) §3.2, §5, §8 |
| H5 status line, H6 roster | later | brainstorm.md §8 |

## Read first (in this order)

1. **[brainstorm.md](brainstorm.md):** §3.2 (the home diorama), §5 (the
   buddy-shell row), §0 (kitty placement and native animation) and §8.
2. **`cli/buddy-shell.ts`:** the PTY wrapper. It reserves the bottom ~20% of
   the terminal as a panel (`layout()`), sets a scroll region for the child,
   and repairs the panel after the child clears the screen or resets the
   scroll region. Runs under Node via tsx (node-pty), not Bun.
3. **[h2-quest-player.md](h2-quest-player.md)** and
   **[h3-ui-kit.md](h3-ui-kit.md):** the scene → framebuffer → tier pipeline
   (`server/rpg/hdstage.ts` is the model to copy), particles, portraits and
   the kit's panel/legend.
4. **`cli/biomes.ts`** and the living-world docs in `docs/game-feel/`: the
   15 biomes, weather and ground props that should become the diorama.

## H4 goal

The always-on wow: the buddy-shell panel becomes a small pixel diorama —
the buddy living in a parallax biome scene with a day/night cycle and
weather particles, reacting to Claude Code hooks — at near-zero cost while
idle.

## H4 checklist

- [ ] **A pure diorama scene** (`server/gfx/diorama.ts` or similar):
      `f(biome, clock, weather, buddy state, seed) → Framebuffer`. Three
      parallax layers per biome, painted procedurally or as small
      palette-indexed sprites (text, reviewable).
- [ ] **Day/night** from the real clock: sky gradient lerp, stars and lit
      windows at night, a warm dusk.
- [ ] **Weather as particles** (extend `server/gfx/particles.ts`: rain,
      snow, leaves, sparkles) fed by the living-world weather state.
- [ ] **The buddy** on the diorama ground with `renderHd`: idle, wander
      (walk), and short reactions to hook events (flinch on an error, cheer
      on passing tests, nod on a commit, a "thinking" pose while Claude works).
      Species without HD art keep the ASCII panel.
- [ ] **Placement:** kitty (z below text or a reserved region, one image id
      swapped in place, ideally native animation so idle costs ~0 bytes),
      iTerm2, then half-blocks inside the panel rows. Repaired by the existing
      redraw hooks; never touches the child's region.
- [ ] **Cost:** the panel animates at ≤ 12 fps, sleeps when the terminal is
      unfocused or idle, and caps bytes per second (measure it).
- [ ] **Gates:** `gameFeel` off → today's panel; subtle → no weather flashes
      (lightning) or shake; `reduceMotion` → still frames on change only.
- [ ] **Tests:** scene determinism and golden hashes per biome/time of day,
      particle determinism, placement escape sequences, the gating, and that
      the child's region is never written.
- [ ] **Docs:** `h4-diorama.md` with a contact sheet, mark H4 done in
      brainstorm.md §8, and update this file for H5.

## Loose ends

- From H2: hats and gear on HD rigs; kitty native animation for the fight
  stage; a smaller HD stage for terminals under 66 × 34.
- From H3: skills, feats and the bounty board as menus; kitty/iTerm
  portraits; a pixel-type title logo.

## How to see your work

- `bun run gfx-demo --species dragon --bg` shows the H1 rigs live; `1`–`6`
  play the animations, `c` cycles species.
- `bun run scripts/h2-sheet.ts` re-renders the H2 fight contact sheet.
- Screenshots of text UIs: feed a captured terminal stream to `pyte`
  (`pip install pyte`), turn the screen into HTML (one span per cell;
  draw `▀▄█` and the eighths as CSS gradients), and screenshot it with
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless
  --screenshot`. That's how `h3-screens.png` was made.
- `bun run play` is the quest TUI. Test it headless with
  `script -qfc "stty rows 50 cols 120; bun run cli/play.ts" /dev/null` and
  piped keys; `BUDDY_GFX=halfblock` forces the HD stage's text tier, and
  `CLAUDE_CONFIG_DIR=<tmp>` keeps the run off your real save.
- **Judge the art by looking at it.** Render PNG contact sheets with
  `encodePng(fb.upscale(n))` from `server/gfx/encode/png.ts` and open them as
  images. H1's sheet script pattern is in h1-rigs.md ("Adding a species").

## Conventions

- **Commits:** sign off every commit (`git commit -s`, DCO). Use English
  messages with a prefix (`feat:`, `fix:`, `docs:`, `test:`, `balance:`).
- **Before pushing:** run `npx tsc --noEmit -p .`, `bun test`, and
  `bash -n statusline/buddy-status.sh` if you touched it.
- **Pull requests:** don't open one unless asked.

### Known failing tests (not regressions)

About 19–20 tests fail on this branch, and also on the base before any of this
work. They are environment- or date-sensitive. Compare against this set, not
against zero:

- `buddy-status.sh D1 compositing into blank filler segments` (7)
- `buddy-status.sh full-width falling weather GAP band` (3)
- `buddy-status.sh falling weather — front-layer edge cases` (2)
- `buddy-status.sh falling weather (Task 3 …)` (1)
- `buddy-status.sh living ground` (1)
- `buddy-status.sh stats panel` (2)
- `buddy-status.sh XP progress row` (2)
- `historyCallback (FR-E3)` (2)

One quick way to diff:
`bun test 2>&1 | grep '^(fail)' | sed 's/ \[.*//' | sort`.
Anything outside the groups above is yours.
