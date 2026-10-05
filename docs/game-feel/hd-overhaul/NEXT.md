# NEXT — handoff for the HD overhaul

_A fresh session starts here. Last updated after H5._

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
| H5: the status line in T1 | done | [h5-statusline.md](h5-statusline.md) |
| **H6: the roster** | **next** | this file and [brainstorm.md](brainstorm.md) §1, §3, §8 |

## Read first (in this order)

1. **[brainstorm.md](brainstorm.md):** §1 (art direction, the style bible,
   the animation set), §3 (scenes: hatch, loot reveal, battle cut-ins, boss
   phase change) and §8.
2. **[h1-rigs.md](h1-rigs.md)**, especially "Adding a species": the rig
   format, materials as ramps, the face grids, the validator, golden hashes.
   `server/gfx/species/cat.ts` and `dragon.ts` are the references.
3. **[h2-quest-player.md](h2-quest-player.md):** the fight stage the
   cut-ins and boss cinematics plug into (`server/rpg/hdstage.ts`).
4. **`cli/pick.ts`** and **`cli/hunt.ts`:** today's ASCII hatch and reveal.
5. **[h5-statusline.md](h5-statusline.md)** and
   **[h4-diorama.md](h4-diorama.md):** every species added to `HD_SPECIES`
   shows up in the status line, the diorama, the quest player and the
   portraits with no extra wiring, so check it in all four.

## H6 goal

Content complete: every species in HD, plus the big moments that make the
game feel like a console game.

## H6 checklist

- [ ] **The 17 remaining species** as rigs (duck, goose, octopus, owl,
      penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot,
      rabbit, mushroom, chonk, wyvern, sparkit). Follow the style bible
      (brainstorm §1.2): one light direction, ramps per material, 1-px dark
      outline. Pilot three that stress the rig (octopus: many limbs; ghost:
      no legs and translucency; robot: hard edges), then batch the rest.
- [ ] **Per species:** register in `hd.ts`, golden hashes, a look in
      `bun run gfx-demo`, `bun run diorama-demo` and the status-line sprite
      sheet (`bakeStatusSprite`); `HEAD_Y` in `hdstage.ts` needs the new
      names.
- [ ] **Hatch cinematic** (`pick` / `hunt`): egg wobble that builds, a crack
      color that teases the rarity, a shockwave reveal, the shiny sting.
- [ ] **Loot reveal:** chest shake, lid pop, a rarity-colored light beam;
      legendary gets a flash (gated) and a slow item spin.
- [ ] **Special-move cut-ins** in HD fights (~700 ms, skippable): a
      diagonal panel with the portrait, speed lines and the move name.
- [ ] **Boss phase change:** dim, glow, roar shake (all gated).
- [ ] **Gates and tests** as before: gameFeel off → today's ASCII; subtle →
      no shake or flashes; reduceMotion; golden hashes for new art.
- [ ] **Docs:** `h6-roster.md` with contact sheets, mark H6 done in
      brainstorm.md §8, and update this file.

## Loose ends

- From H2: hats and gear on HD rigs; kitty native animation for the fight
  stage; a smaller HD stage for terminals under 66 × 34.
- From H3: skills, feats and the bounty board as menus; kitty/iTerm
  portraits; a pixel-type title logo.
- From H4: kitty native animation for the diorama buddy's idle loop (it
  swaps frames today, ~1.3 KB/s); living-world ground props as pixel art;
  sixel; the same diorama in the TUI's home screen.
- From H5: an HD fight scene in the status line (fights keep the ASCII
  two-sprite scene); hats on the HD sprite; a 256-color sprite variant.

## How to see your work

- `bun run gfx-demo --species dragon --bg` shows the H1 rigs live; `1`–`6`
  play the animations, `c` cycles species.
- `bun run diorama-demo` shows the H4 panel alone (keys cycle biome, hour,
  weather, species and fire reactions); `bun run scripts/h4-sheet.ts`
  re-renders its contact sheet (`--rows 3-7 --scale 2` to review a slice).
- `/buddy sprite full` (or `statusSprite` in config.json) switches the status
  line's HD sprite; `bakeStatusSprite` in `server/gfx/statussprite.ts`
  renders the frames, so a quick Bun script can print them all side by side.
- **Seeing the real Claude Code status line:** run `claude` in a pty with
  `env -i`, an isolated `HOME` whose `.claude.json` pre-accepts onboarding,
  the project's trust dialog and a dummy `ANTHROPIC_API_KEY`, and a
  `settings.json` whose `statusLine.command` points at the script. It draws
  the UI without sending anything; feed the stream to pyte. Never run it
  with this session's own environment. h5-statusline.md shows the result.
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
