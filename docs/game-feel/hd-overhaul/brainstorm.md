# HD Overhaul — brainstorm

_Status: brainstorm / not started · branch `feature/rpg`_

**Goal:** make claude-buddy look and move like a console game instead of a
pile of ASCII. That means HD buddies with real shading, motion with weight,
cinematic battles and a consistent visual language across every surface. It
should still be a terminal app, it should still cost nothing when idle, and it
should still respect the `gameFeel` gate.

This doc is a menu of ideas, grouped by layer, ending in a phased roadmap.
Nothing here is decided.

---

## 0 · The core idea: one renderer, many backends

Today every surface draws characters: `art.ts` frames, the `stage.ts` cell
canvas, and the bash cycler. "HD" in a terminal means drawing **pixels** and
then *encoding* them for whatever the terminal can show.

```
 scene state ──► rig + director ──► Framebuffer (RGBA pixels) ──► encoder ──► terminal
 (battle,        (poses, easing,      pure software raster          │
  idle, menu)     particles, camera)                                ├─ T3 kitty / iTerm2 / sixel  (true pixels)
                                                                    ├─ T2 sextant / quadrant blocks
                                                                    ├─ T1 half-block ▀▄ truecolor (2 px per cell)
                                                                    └─ T0 today's ASCII (fallback, tests)
```

- **Pure core keeps the invariants.** The framebuffer is `f(state, t, seed)`
  with no clock and no I/O, so it stays deterministic and testable (tests can
  hash the pixels). Encoders are pure too: `Framebuffer → string`.
- **Render tiers are picked automatically**, with a manual override
  (`/buddy graphics auto|pixels|blocks|ascii`):

| Tier | How | Effective resolution | Where it works |
| --- | --- | --- | --- |
| **T3 Pixels** | Kitty graphics protocol (Ghostty, kitty, WezTerm, Konsole), iTerm2 inline images, sixel (foot, Windows Terminal, xterm `-ti vt340`, tmux ≥ 3.4) | real pixels, e.g. a 128×128 sprite | buddy-shell, quest player, TUI. **Not** the Claude Code status line |
| **T2 Sextants** | Unicode 13 `🬀`–`🬻` (2×3 sub-cells, 2 colors per cell) | 2×3 per cell | modern fonts; quality varies by font |
| **T1 Half-blocks** | `▀` with truecolor fg and bg | 1×2 per cell, any colors | almost everywhere truecolor works, **including the status line** |
| **T0 ASCII** | current art | 1 glyph per cell | dumb terminals, `NO_COLOR`, tests, `gameFeel=off` |

- **Detection:** check `$TERM_PROGRAM`, `$KITTY_WINDOW_ID`, `$COLORTERM`,
  and the DA1 reply (`4` means sixel). For kitty, send a query
  (`a=q`) and use it only if it replies `OK`. Cache the result per terminal
  in config, re-probe on version change, and show it in `doctor`.
- **Kitty's native animation** is the big performance trick: upload a sprite
  sheet once (`a=t`, with image ids), then *place* frames by source rectangle,
  or load frames with `a=f` and let the terminal animate (`a=a`). The idle
  loop then costs roughly zero bytes per tick. Sixel must resend every
  frame, so cap it at about 12 fps and send only dirty rectangles.

---

## 1 · The buddies — HD art direction

### 1.1 Rigs instead of hand-drawn flipbooks

Hand-drawing 20 species × ~12 animations × ~8 frames comes to roughly 2,000
frames. That's not happening. Instead, give each species a **paper-doll rig**:

- **Parts** are small pixel sprites: body, head, eyes, mouth, left and right
  limbs, tail/fins/wings, and accessory anchors. Each has a **pivot** and a
  **z-order**.
- **Shared motion library** drives the parts procedurally, with easing:
  breathing (body scale 1.00 → 1.03), blink, look-at, squash on land and
  stretch on jump, head tilt, tail spring, wing flap, ear jiggle with
  **secondary motion** (damped spring per dangly part).
- **Per-species flavor** is a few parameters, not new frames. Duck waddle
  amplitude, ghost float bob with alpha shimmer, octopus tentacles as a sine
  chain, snail and turtle slow-ease, robot stepped "servo" easing with sparks,
  blob as a pure squash-and-stretch jelly body.
- **Gear and hats snap to anchors.** This is the HD version of today's
  `GEAR_ANCHORS` and derive-on-read: equipment is just more parts on the rig,
  so every hat, weapon and trinket works on every species and every
  animation for free.
- **Expressions are eye and mouth part swaps.** The current
  `neutral/happy/angry/bored/surprised` set maps 1:1, and a few more get easy
  to add: smug, sleepy, focused, heart-eyes, dizzy spiral.

### 1.2 Style bible (so 20 species look like one game)

- **Canvas:** 48×48 px master sprites, authored at 1×. T3 scales them 2–3×
  with nearest-neighbor. T1 downsamples to 24×24 px (24 cols × 12 rows) or
  shows a 16×16 "chibi" cut.
- **Light** comes from the top-left, everywhere. Every material uses a 4-step
  ramp: outline → shadow → base → highlight, plus one specular pixel.
  Outlines use **sel-out** (colored per neighbor, not pure black), which keeps
  sprites crisp on both dark and light themes.
- **Rarity is lighting and aura, not just text color.**
  - common: flat
  - uncommon: soft rim light
  - rare: rim light + ground glow
  - epic: animated aura particles
  - legendary: golden rim, god-ray shimmer and drifting motes
  - **shiny:** an alternate palette ramp per species (the classic hue swap)
    plus a sparkle on hatch and on entrance.
- **Palette files** live in-repo as data. Each species gets a 12–16 color
  indexed palette. Sprites are stored as palette-indexed strings (diff-able
  and reviewable in PRs, like the art arrays today), or as `.png` plus a JSON
  part map if we adopt an editor (Aseprite export).
- **Theme-aware.** The current light/dark rarity colors become palette
  "lighting presets", so a light terminal gets a daylight grade and a dark
  one gets a night grade.

### 1.3 The animation set per buddy

| Anim | Beats / notes |
| --- | --- |
| idle | breathe, blink at random 2–6 s intervals, occasional look-around, mood-specific fidget |
| idle-long | after N minutes: yawn → sit → sleep with Z-particles (ties into auto-quiet) |
| walk / hop | wander already bakes offsets; add contact/pass poses, dust puffs, a shadow that scales with hop height |
| react | on hooks: a **flinch** on error, a **cheer** on passing tests, a **nod** on commit, a **think** pose (hand-to-chin plus orbiting `?`) while Claude works |
| attack | anticipation (wind-up and squash) → smear frame → contact and **hit-stop** → follow-through → settle |
| hit / KO | white flash → knockback with recoil → (KO) slow-mo, desaturate, sink, sparkle-out (buddies never die) |
| victory | species pose + jump + confetti + camera push-in |
| emote | heart, anger vein, sweat drop, `!`, `?`, music notes as attachable emote particles |
| hatch / ascend | egg wobble → cracks → rarity-colored light beams → reveal with shockwave ring |

---

## 2 · Motion that feels like a console game

The juice checklist, all implementable in the pure director (`anim.ts`
already has the bones):

- **Easing everywhere.** Use a curves module with `easeOutBack` for pop-ins,
  `easeInOutCubic` for camera, `easeOutElastic` for UI bounces and springs
  for secondary motion. Nothing moves linearly.
- **Hit-stop** freezes for 60–120 ms on contact, scaled by damage, with a
  bigger freeze on crits.
- **Screen shake** uses trauma-based decay (Perlin, not random jitter) and
  respects reduce-motion.
- **Camera:** pan, zoom (T3 scale and T1 crop) and a slow push-in on boss
  intros. The camera rig is part of `StageState`.
- **Smears and afterimages:** 1–2 stretched smear frames on fast attacks, plus
  ghost trails at 50% alpha for dashes.
- **Particles** are a tiny seeded system with gravity, drag, lifetime and color
  over life: sparks, dust, embers, bubbles, leaves, confetti and stars. Biomes
  and weather (living-world) feed ambient emitters.
- **Lighting tricks** done on the framebuffer: additive glow (cheap bloom: blur
  the bright pass and add it), hit flashes, a vignette, and a dynamic drop
  shadow that follows hop height.
- **Damage numbers** pop up on an arc with `easeOutBack` and a slight
  overshoot. Crits are bigger, gold and shaky. "MISS" tumbles.
- **Frame pacing:** target 30 fps in the quest player and buddy-shell with a
  fixed timestep. Keep diff paint (already in `play.ts`) for T0–T2. T3 places
  frames by id.

---

## 3 · Scenes — the "PlayStation" moments

1. **Boot / title.** Logo assembles from pixels, then a parallax biome
   backdrop, the buddy walks in, and "PRESS ENTER" pulses. Reuse the existing
   shine-sweep title in `play.ts` as the T0 fallback.
2. **Home diorama** (buddy-shell panel and TUI):
   - The buddy lives in a small **parallax scene** with 3 depth layers from
     `biomes.ts`: the 15 biomes become painted backdrops.
   - A **day/night cycle** follows the real clock (a sky gradient lerp, with
     lit windows and stars at night).
   - Living-world weather renders as real particles. Ground props like the
     sprout and pebble get pixel art.
3. **Battle transition.** A classic swirl or shatter wipe, then the camera
   swoops in, the foe slides in with a name banner, and the HUD slides in
   from the edges.
4. **Battle.**
   - Over-the-shoulder framing: buddy bottom-left, foe top-right, with
     ellipse shadows on the floor.
   - **Special moves get a cut-in:** a diagonal slash panel with the buddy's
     close-up portrait, speed lines and the move name in big type, about
     700 ms, skippable.
   - Status effects become visible: poison bubbles, a burn shimmer, stun stars.
   - Bosses get a phase-change cinematic (screen dims, boss glows, roar shake).
5. **Victory → results.** Freeze-frame, the camera pushes in on the buddy,
   and a victory pose plays. Then a **results card**: the XP bar fills with a
   tick-up counter, and on a level-up a burst plays and stats roll up one by
   one.
6. **Loot reveal.** The chest shakes, the lid pops, and a **rarity-colored
   light beam** shoots up (the ARPG convention). Legendary gets a screen
   flash and a slow-mo item spin.
7. **Hatch / pick / hunt** (`cli/pick.ts`, `cli/hunt.ts`). The egg wobble
   builds tension, the crack color teases rarity, and the reveal has a
   shockwave. Shiny gets the sparkle sting.
8. **Shop / merchant.** The merchant becomes a rigged NPC with idle
   animation. Items sit on shelves and the cursor bob-highlights them, with a
   "tilt-card" preview of each item.

---

## 4 · UI / HUD design system

There should be one visual language for the TUI, quest player and shell panel.
Name it the **buddy UI kit** (`server/ui/`):

- **Panels:** rounded borders (`╭╮╰╯`), a 1-cell gradient title bar, a
  subtle inner shadow (darker bg on the bottom/right edge) and a
  rarity-tinted accent edge. Panels slide and fade in with easing.
- **Bars:**
  - HP and XP bars get 1/8-cell precision using `▏▎▍▌▋▊▉█`, with gradient
    fills (green → yellow → red as HP drops).
  - A **damage ghost** (the fighting-game convention): the lost chunk flashes
    white, then drains red behind the real bar.
  - A low-HP pulse.
- **Key prompts:** pill chips such as `⟨ Enter ⟩ Confirm   ⟨ Esc ⟩ Back`, in
  a consistent bottom-right "button legend" like console games. Use generic
  key glyphs, **not** PlayStation button symbols (trademark).
- **Menus:** a cursor with a bounce/arrow, a selected row with a highlight
  sweep, a description pane, and a "slot-in" stagger when a menu opens.
- **Typography:**
  - Big banner text ("VICTORY", "LEVEL UP", "BOSS") as pixel-font
    renders on T1–T3.
  - Figlet-style block letters on T0.
  - Gradient + shine sweep (already in `playkit.ts`, promoted to the kit).
- **Toasts:** status-line toasts get icons, a slide-in, and a rarity gradient
  for loot.
- **Portraits:** each species gets a bust portrait, rendered from the rig's
  head part at 2×. Use it in dialogue boxes (with typewriter text, which
  exists), cut-ins, and the stats screen.

---

## 5 · Per-surface plan

| Surface | Today | HD version |
| --- | --- | --- |
| **Status line** (`buddy-status.sh`, 1 s refresh) | ASCII frames, baked by the server and cycled by bash | **T1 half-block sprite**: the server bakes truecolor half-block frames into `status.json`, and bash still just cycles them, so the invariant holds. The status line can't carry kitty or sixel. Budget is about 6–8 rows; offer `statusSprite: mini (12×6) / full (24×12)`. 1 fps means poses, not motion: pick key poses that read at 1 Hz. |
| **buddy-shell** (PTY wrapper, 60 fps panel) | ASCII panel | The **flagship**: T3 pixel diorama with parallax, weather particles and day/night, and the buddy reacting live to hooks. Graphics go on a pinned layer (kitty `z` below text, or a reserved region) and are repaired by the existing redraw hooks. |
| **Quest player** (`cli/play.ts`) | `stage.ts` cell canvas | Swap the `Canvas` for the `Framebuffer`. The director and cues stay the same, with camera, particles and lighting added. Do this first, because it's fully ours (alt-screen, own input loop) and it's where the "game" feeling lives. |
| **TUI** (`cli/tui.tsx`, Ink) | text panels | UI kit components. T3 sprites go in an Ink `<Box>` with an escape-hatch "image slot" (Ink can't place images, so write a raw kitty placement at the measured box position after each render). |
| **pick / hunt / show** | ASCII | Hatch cinematic and a turntable "show" view. |

---

## 6 · Engineering notes

- **New modules:**
  - `server/gfx/framebuffer.ts`: RGBA, blit, alpha, palette, blur.
  - `server/gfx/rig.ts`: parts, pivots, pose → transforms.
  - `server/gfx/ease.ts`
  - `server/gfx/particles.ts`
  - `server/gfx/encode/{kitty,iterm,sixel,sextant,halfblock,ascii}.ts`
  - `server/gfx/detect.ts`
  - `server/ui/*`
- **Data:**
  - `assets/species/<name>/{parts.txt|parts.png, rig.json, palette.json}`
  - `assets/biomes/<name>/layers`
  - An `assets` validator joins `validate-species.ts`.
- **Performance budget:**
  - Rasterize a 160×90 px scene in ≤ 2 ms in Bun.
  - The status line must never rasterize: bash reads baked strings.
  - Idle loops pause when unfocused (the focus-event logic exists in `play.ts`).
- **Tests:**
  - Golden pixel hashes per (species, anim, frame).
  - Encoder round-trip tests.
  - T0 output must stay byte-identical, so the 1000+ existing tests keep
    passing.
- **Accessibility and gating:**
  - `gameFeel=off` gives T0 static.
  - `subtle` gives the HD sprite with no shake, no flashes and no cut-ins.
  - `full` gives everything.
  - Add a `reduceMotion` flag, and cap full-screen flashes at 3 per second
    (photosensitivity).
- **tmux/SSH:** kitty graphics over tmux needs `allow-passthrough on`. Sixel
  needs tmux 3.4+. `doctor` should explain it, and the fallback is
  automatic. On high-latency SSH, prefer T1.

---

## 7 · Risks and open questions

1. **Art production is the real cost.** The rig approach cuts it to about 6–10
   small parts per species, but 20 species still need an artist's pass. One
   option is to pilot 3 species (blob for the simplest rig, cat for the
   reference, dragon for the showpiece) before committing.
2. **`pikachu` is a species name**, and an HD pixel version would be a
   recognizable copy of a trademarked character. Recommend an original
   electric-mouse design with a new name before it gets HD art. The same
   caution applies to any "PlayStation" branding or button glyphs.
3. **Status-line limits:** Claude Code controls its height and redraw, and
   refreshes at 1 s. HD there is capped at T1 and key-pose animation. Verify
   it renders `▀` with fg+bg truecolor reliably across Claude Code's
   renderer.
4. **Font variance** for sextants (T2). It may be worth skipping T2 entirely
   and going T3 → T1 → T0.
5. **Asset format:** palette-indexed text (reviewable, zero deps) vs. PNG +
   Aseprite JSON (artist-friendly, needs a PNG decoder; Bun can do this
   without native deps via a tiny inflate). Leaning toward text for parts
   and PNG for biome backdrops.
6. **Sound?** An optional, opt-in `paplay`/`afplay` blip on crits and level-ups
   would sell the console feel a lot. Default off.

---

## 8 · Roadmap (proposed)

| Phase | Deliverable | Proves |
| --- | --- | --- |
| **H0 Spike** | `framebuffer` + `halfblock` + `kitty` encoders, plus one hand-made 48×48 blob sprite with a procedural breathe/blink loop, viewable via `bun run gfx-demo` | The tier ladder works in real terminals, including tmux |
| **H1 Rig + style bible** | Rig format, ease/motion library, 3 pilot species (blob, cat, dragon) with idle/walk/attack/hit/KO/victory, and a palette and rarity lighting pass | The rig pipeline scales and looks good |
| **H2 Quest player HD** | Framebuffer stage in `play.ts`, camera, particles, hit-stop, damage ghost bars, battle transition, victory results card | The "PlayStation moment" |
| **H3 UI kit** | Panels, bars, key prompts, banners and portraits across play, TUI and shop | One visual language |
| **H4 buddy-shell diorama** | Parallax biomes, day/night, weather particles, live hook reactions | The always-on wow |
| **H5 Status line T1** | Baked half-block sprites with key-pose cycling; bash unchanged except for the frame source | HD reaches every user |
| **H6 Roster** | The remaining 17 species, the hatch cinematic, loot beams, special-move cut-ins, boss cinematics | Content complete |
