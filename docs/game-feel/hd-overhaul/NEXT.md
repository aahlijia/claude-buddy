# NEXT — handoff for the HD overhaul

_A fresh session starts here. Last updated after H4._

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
| H4: the buddy-shell diorama | done | [h4-diorama.md](h4-diorama.md) |
| **H5: the status line in T1** | **next** | this file and [brainstorm.md](brainstorm.md) §5, §7.3, §8 |
| H6 roster | later | brainstorm.md §8 |

## Read first (in this order)

1. **[brainstorm.md](brainstorm.md):** §5 (the status-line row), §7.3
   (status-line limits), §0 (the tier ladder) and §8.
2. **`statusline/buddy-status.sh`:** the bash renderer Claude Code runs every
   second. It reads `status.json` and cycles baked frames by
   `frameSequence[NOW % len]`; it must never rasterize. Its tests are
   `server/statusline_render.test.ts` and friends.
3. **`server/state.ts` `writeStatusState`:** where the server bakes the
   frames, flourish, wander, combat and weather fields into `status.json`.
   H4 added `sceneWeather` and `gameFeel` there.
4. **[h4-diorama.md](h4-diorama.md):** `encodeHalfblock`, `downscale` (crisp
   alpha) and `stepBeat` are the pieces to reuse; the diorama's half-block
   tier is the closest thing to what the status line will show.

## H5 goal

HD reaches every user: the status line shows the HD buddy as truecolor
half-block sprites. The server bakes them; bash keeps cycling strings and
stays unchanged except for where the frames come from.

## H5 checklist

- [ ] **Bake** half-block frames for the HD species in `writeStatusState`
      (`renderHd` → `downscale` → `encodeHalfblock`), as a new field (for
      example `hdFrames` + `hdSequence`) next to the ASCII `frames`.
- [ ] **Key poses at 1 Hz:** the status line refreshes once a second, so
      pick poses that read without motion (idle breathe extremes, a blink,
      the reaction poses for error / cheer). Keep the sequence short.
- [ ] **Size option** `statusSprite: mini (12×6) | full (24×12) | off` in
      config, the TUI settings and `doctor`.
- [ ] **bash:** prefer `hdFrames` when present and the terminal is
      truecolor; the ASCII frames stay the fallback. Measure the extra
      bytes per tick and the jq cost.
- [ ] **Compose** with what the status line already draws around the sprite
      (bubble, ground, falling weather, combat) without breaking alignment;
      the sprite is wider than the ASCII art.
- [ ] **Verify** that Claude Code's renderer shows `▀` with fg + bg
      truecolor reliably (brainstorm §7.3), and keep T0 byte-identical when
      the option is off.
- [ ] **Gates:** `gameFeel` off → ASCII; `reduceMotion` → one still frame.
- [ ] **Tests and docs:** baked-frame determinism and size, bash fallback,
      `h5-statusline.md` with screenshots, mark H5 done in brainstorm.md §8,
      update this file for H6.

## Loose ends

- From H2: hats and gear on HD rigs; kitty native animation for the fight
  stage; a smaller HD stage for terminals under 66 × 34.
- From H3: skills, feats and the bounty board as menus; kitty/iTerm
  portraits; a pixel-type title logo.
- From H4: kitty native animation for the diorama buddy's idle loop (it
  swaps frames today, ~1.3 KB/s); living-world ground props as pixel art;
  sixel; the same diorama in the TUI's home screen.

## How to see your work

- `bun run gfx-demo --species dragon --bg` shows the H1 rigs live; `1`–`6`
  play the animations, `c` cycles species.
- `bun run diorama-demo` shows the H4 panel alone (keys cycle biome, hour,
  weather, species and fire reactions); `bun run scripts/h4-sheet.ts`
  re-renders its contact sheet (`--rows 3-7 --scale 2` to review a slice).
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
