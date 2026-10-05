# NEXT — handoff for the HD overhaul

_A fresh session starts here. Last updated after H1 (commit `fe9fe99`)._

**Branch:** `feature/rpg`. Develop, commit and push there:
`git push -u origin feature/rpg`.

## Where things stand

| Phase | State | Doc |
| --- | --- | --- |
| Buddy Quest RPG (`;` commands, `bun run play`) | done | [../buddy-quest/design.md](../buddy-quest/design.md), [../buddy-quest/design-animation.md](../buddy-quest/design-animation.md) |
| H0: framebuffer, tier encoders, HD blob, `bun run gfx-demo` | done | [h0-spike.md](h0-spike.md) |
| H1: rig format, motion library, HD blob, cat and dragon | done | [h1-rigs.md](h1-rigs.md) |
| `pikachu` → `sparkit` (an original electric mouse) | done | h1-rigs.md, "Also in this phase" |
| **H2: HD in the quest player** | **next** | this file and [brainstorm.md](brainstorm.md) §2, §3, §5, §8 |
| H3 UI kit, H4 buddy-shell diorama, H5 status line, H6 roster | later | brainstorm.md §8 |

## Read first (in this order)

1. **[brainstorm.md](brainstorm.md):** §5 (the quest-player row), §2 (motion
   feel: hit-stop, camera, particles) and §8 (the H2 row).
2. **[h1-rigs.md](h1-rigs.md):** rigs, `renderHd(species, anim, t, opts)`, and
   `ANIM_INFO`, including `attack.impact`.
3. **[../buddy-quest/design-animation.md](../buddy-quest/design-animation.md):**
   the current fight pipeline. `act()` → `Beat[]` (battle.ts) → `direct()` →
   `Cue[]` (anim.ts) → `renderStage()` (stage.ts) → `battleScreen` (render.ts),
   played by `cli/play.ts` with playkit.ts (speed setting, action bar).

## H2 goal

Fights in `bun run play` render as HD pixel art on a framebuffer stage, with
the "console game" feel, while the existing choreography stays the source of
truth for what happens and when.

## H2 checklist

- [ ] **A framebuffer stage** next to the cell `Canvas` in `server/rpg/stage.ts`
      (or a new `server/rpg/hdstage.ts`). Draw both combatants with
      `renderHd`: the player faces right, the foe uses `flip: true`. Map
      director cues to rig animations (`attack` / `hit` / `ko` / `victory` /
      `idle` / `walk`), and position actors from cue offsets.
- [ ] **Encode through the existing tiers** (`server/gfx/detect.ts`: kitty →
      iTerm → half-block → ASCII). The pixel tiers swap in place; half-block
      repaints only changed lines (the diff-paint idea `cli/play.ts` already
      uses).
- [ ] **Fallback per combatant.** If `hasHd(species)` is false (17 of 20
      species), the fight keeps today's ASCII stage. Don't mix the two in one
      scene for now: use the HD stage only when both sides have HD art, or
      when the foe can be drawn with an HD stand-in. Decide and document it.
- [ ] **Hit-stop:** freeze 60–120 ms (scaled by damage) at
      `ANIM_INFO.attack.impact`.
- [ ] **Camera:** a small push-in on crits and boss specials; screen shake on
      heavy hits, capped and gated (see Accessibility).
- [ ] **Particles:** hit sparks, dust on landings, heal motes. Make them a pure
      `server/gfx/particles.ts` (seeded, `t`-driven).
- [ ] **Damage ghost bars:** HP bars drain with a lagging ghost segment.
- [ ] **Battle transition** in (a wipe or flash) and a **victory results card**
      (gold, XP, drops).
- [ ] **Speed setting:** respect playkit's `cinematic | normal | fast | off`.
      `off` must still produce correct final screens.
- [ ] **Accessibility:** `gameFeel=off` → no animation; `subtle` → no shake, no
      flashes, no cut-ins; `full` → everything. Add `reduceMotion`. Cap
      full-screen flashes at 3 per second.
- [ ] **Performance:** rasterizing a scene takes ≤ 2 ms in Bun; the idle loop
      sleeps when the terminal is unfocused (the focus logic exists in
      `play.ts`). The zero-token `;` hook path must never render pixels.
- [ ] **Tests:** stage composition (both actors, flip, z order), cue →
      animation mapping, hit-stop timing, particles determinism, fallback
      selection, and golden hashes for a few key frames, in the style of
      `server/gfx/hd.test.ts`.
- [ ] **Docs:** add `h2-quest-player.md` with a contact sheet, mark H2 done in
      brainstorm.md §8, and update this file for H3.

## How to see your work

- `bun run gfx-demo --species dragon --bg` shows the H1 rigs live; `1`–`6`
  play the animations, `c` cycles species.
- `bun run play` is the quest TUI. Test it headless with
  `script -qfc "bun run cli/play.ts" /dev/null` and piped keys.
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
