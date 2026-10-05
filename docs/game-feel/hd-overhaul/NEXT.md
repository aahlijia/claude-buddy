# NEXT — handoff for the HD overhaul

_A fresh session starts here. Last updated after H2._

**Branch:** `feature/living-world` (it now carries all of `feature/rpg` plus
H2). Develop, commit and push there: `git push -u origin feature/living-world`.

## Where things stand

| Phase | State | Doc |
| --- | --- | --- |
| Buddy Quest RPG (`;` commands, `bun run play`) | done | [../buddy-quest/design.md](../buddy-quest/design.md), [../buddy-quest/design-animation.md](../buddy-quest/design-animation.md) |
| H0: framebuffer, tier encoders, HD blob, `bun run gfx-demo` | done | [h0-spike.md](h0-spike.md) |
| H1: rig format, motion library, HD blob, cat and dragon | done | [h1-rigs.md](h1-rigs.md) |
| `pikachu` → `sparkit` (an original electric mouse) | done | h1-rigs.md, "Also in this phase" |
| H2: HD fights in the quest player | done | [h2-quest-player.md](h2-quest-player.md) |
| **H3: the buddy UI kit** | **next** | this file and [brainstorm.md](brainstorm.md) §4, §8 |
| H4 buddy-shell diorama, H5 status line, H6 roster | later | brainstorm.md §8 |

## Read first (in this order)

1. **[brainstorm.md](brainstorm.md):** §4 (the UI kit) and §8 (the H3 row).
2. **[h2-quest-player.md](h2-quest-player.md):** the HD stage, `Paint.hd`,
   lazy frames, `hpBarFine` and the results card. H3 should absorb the bar
   and the card into the kit rather than keep two styles.
3. **`server/rpg/render.ts`** (`panel`, `hpBar`, `wrap`) and
   **`server/rpg/playkit.ts`** (action bar, banners, shimmer, reveal,
   results card): the pieces the kit replaces or promotes.

## H3 goal

One visual language for the quest player, the Ink TUI (`cli/tui.tsx`) and
the shop: panels, bars, key prompts, banners and portraits as a shared
`server/ui/` kit, pure and testable, with the T0 (plain) output unchanged
for the hook path.

## H3 checklist

- [ ] **`server/ui/` kit:** panels (rounded borders, gradient title bar,
      rarity accent edge, inner shadow), with slide/fade-in frames. Keep the
      open-right rule for emoji-width safety, or prove a right border is safe.
- [ ] **Bars:** promote `hpBarFine` (1/8-cell precision, ghost) to the kit;
      gradient fills (green → yellow → red), a low-HP pulse; XP bars too.
- [ ] **Key prompts:** pill chips (`⟨ Enter ⟩ Confirm`) in a consistent
      bottom-right legend. Generic key glyphs only, no console button symbols.
- [ ] **Menus:** bounce cursor, highlight sweep on the selected row, a
      description pane, a slot-in stagger when a menu opens (shop, bag, map).
- [ ] **Banners:** "VICTORY", "LEVEL UP", "BOSS" as pixel-font renders
      (`server/gfx/font.ts`) on T1–T3, figlet-style blocks on T0. Replace
      `bannerFrames` in play.ts.
- [ ] **Portraits:** a bust per HD species from the rig's head at 2×, for
      dialogue boxes (with the existing typewriter), the stats screen and
      later H6 cut-ins.
- [ ] **Ink TUI:** use the kit's components; for T3 images, a raw kitty
      placement at the measured box position after each render.
- [ ] **Accessibility:** the same gates as H2 (`gameFeel`, `reduceMotion`,
      flash cap).
- [ ] **Tests:** kit components render to fixed widths, plain mode has no
      escapes, the hook output is byte-identical, golden strings or hashes
      for key components.
- [ ] **Docs:** `h3-ui-kit.md` with screenshots, mark H3 done in
      brainstorm.md §8, and update this file for H4.

## Loose ends from H2

- Hats and gear on HD rigs (anchors exist in rig.ts).
- Kitty native animation (upload frames once, let the terminal play them).
- A smaller HD stage for terminals under 66 × 34 instead of the ASCII
  fallback.

## How to see your work

- `bun run gfx-demo --species dragon --bg` shows the H1 rigs live; `1`–`6`
  play the animations, `c` cycles species.
- `bun run scripts/h2-sheet.ts` re-renders the H2 fight contact sheet.
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
