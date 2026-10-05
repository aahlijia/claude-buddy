# Buddy Quest — animation overhaul

_Status: implemented on `feature/living-world`. Buddies with HD art fight on a pixel stage driven by these same cues: see [../hd-overhaul/h2-quest-player.md](../hd-overhaul/h2-quest-player.md)._

The first animation pass (`animScenes`) was one move: per hit, the attacker
slid 2 → 4 → 2 cells into the gap and a number appeared. Every action looked
the same (a heal, a bomb and a dodge were all "nothing happens" or "lunge"),
frames were fixed at 85 ms, the screen was wiped with `2J` on every frame
(flicker), keys were swallowed while it played, and the log text appeared all
at once before the animation it described had finished.

This overhaul replaces it end to end: the engine says **what happened**, a
director decides **how it looks and how long it takes**, a stage compositor
**draws** it, and the TUI **plays** it cleanly and interactively.

```
act() ──► Beat[] ──► direct() ──► Cue[] ──► renderStage() ──► battleScreen(view)
 (battle.ts)          (anim.ts)    (stage state + ms)  (stage.ts)        (render.ts)
                                                                        │
                                       cli/play.ts  Player ◄────────────┘
                              (scheduler, diff paint, skip, speed, idle loop)
```

## Goals

| Goal | Meaning here |
| --- | --- |
| Detailed | Every beat of a turn has its own motion: anticipation, contact, hit-stop, recoil, settle. Skills, items, statuses and boss mechanics read differently at a glance. |
| Interactive | Animations are skippable, speed is a setting, fights have a cursor-driven action bar with descriptions, keys are never lost. |
| Clean | No flicker or tearing, no layout jumps (every frame of a fight is the same size as the static screen), deterministic and pure (seeded), zero cost when idle. |
| Free | The zero-token `;` hook path never renders a frame; the TUI only animates in response to input, and the ambient loop sleeps when the terminal loses focus or after a short idle budget. |

## 1 · Beats — what happened (`battle.ts`)

`act()` now records a `Beat` for everything visible, alongside the log line
that narrates it (`line`) and both HP totals right after it (`hp`). Existing
`hits` stay as-is (damage pops, tests).

| Beat | Emitted by |
| --- | --- |
| `strike` (`style`: melee · heavy · multi · bomb · duck · drain) | `heroHit` / `foeHit` landing |
| `miss` (`why`: dodge · blind) | dodge rolls, cursed aim |
| `heal` (`src`: potion · elixir · hotfix · guard · leech · drain · regen) | every HP gain |
| `guard` | defend |
| `buff` (`label`) | Refactor, enrage, shield, Lich curse, observe |
| `status` (`fx`: poison · stun · blind) | status applied |
| `tick` | poison damage at end of turn |
| `charge` / `interrupt` | boss wind-ups and Breakpoint cancelling them |
| `thorns`, `secondwind`, `grow`, `sprout` | legendary uniques, Golem, Hydra |
| `speech` | boss phase line |
| `flee` (`ok`) | flee / smoke bomb |
| `ko` (`who`) | the fight ends |

Beats are plain JSON on the persisted `Battle` like `hits`, so a replay of the
same seed produces the same beats.

## 2 · Stage — how it's drawn (`stage.ts`)

A small cell canvas replaces string concatenation for the fight scene:

- **Fixed geometry.** Width = `PAD + heroSlot + GAP + foeSlot + PAD`, height =
  `HEADROOM + max(spriteH)`. Slots are the widest of a species' idle frames, so
  the breathing cycle never changes the size. The static screen renders the
  *same* stage at rest — the last animation frame and the resting screen are
  identical, so nothing jumps when playback ends.
- **Actors** have `x`/`y` offsets, an eye, an idle frame, a tint (`flash`,
  `hurt`, `heal`, `glow`, `dim`) and a `sink` (KO collapse rows). Anything
  pushed off the canvas is clipped.
- **Particles** are text at a cell with a color: damage pops, sparkles,
  shields, stun stars, projectiles, dust.
- **Shake** offsets the whole stage horizontally on heavy and critical hits.
- **Wide glyphs and ANSI** in sprite art (the wyvern's fire tail) are parsed
  into cells, so clipping and tinting never split an escape sequence.
- **Plain mode** (hook output, `color: false`) emits the same characters with
  no escapes; tints simply vanish.

Persistent state shows on the static screen too: the guard shield `]` in front
of the hero, `!`/`!!` over a charging boss, stars over a stunned foe, poison
bubbles, and a **ghost segment** on the HP bars (`▓` = HP lost this turn), which
also makes the zero-token hook screens easier to read.

## 3 · Director — choreography (`anim.ts`)

`direct(prev, next, look)` turns the beats into `Cue`s — a stage state, both HP
bar values (current + ghost), how many log lines are visible, and a duration in
ms. Durations are tuned for the *normal* speed; the player scales them.

| Beat | Choreography (normal speed) |
| --- | --- |
| melee strike | lean back 1 (60) → dash 2 (40) → **contact** at 4: clash glyph, defender flashes, pop on row 1, HP drops and the lost chunk turns into the `▓` ghost (hit-stop 110) → defender knocked back 1, pop rises (70) → both return (60) → settle (40) |
| crit | contact hit-stop 170, `CRIT` pop in yellow, 2-frame shake |
| heavy (Power Strike, Parse Error, Core Dump) | longer glowing wind-up, bigger knockback, shake |
| multi (Fork Bomb, Hydra, lunges) | first hit full, later hits skip the wind-up and use short frames — reads as a flurry |
| bomb / Rubber Duck | projectile (`●` / `>o`) arcs across the gap, then a `\|/`-burst on the target |
| miss | lunge; defender sidesteps 2 with a dim `miss` / `dodge`; both return |
| heal / regen | rising green `+` motes around the healed sprite, `+N` pop, bar tweens up |
| guard | shield `]` snaps up in front of the hero |
| buff | `↑` motes rise; label pop (`ATK↑`, `ENRAGED`, `SHIELD`, `CURSED`) |
| status | poison bubbles `°o`, stun stars `* ✦`, blind `?` |
| poison tick | green flash + green pop |
| charge | foe leans back, glows, `!` → `!!` → `!!!` |
| interrupt | `!!!` shatters into `✕` |
| thorns | spikes fly back to the foe, small pop |
| second wind | white flash + `SECOND WIND` |
| grow / sprout | pulsing magenta `+` motes, `+N max` / `+1 head` |
| speech | the boss line is revealed with a held beat |
| flee | hero dashes off the left edge with dust (or stumbles back on a failure) |
| KO | 3 flashes, then the loser sinks into the ground and dims; the winner hops twice with confetti |

The ghost segment holds for the whole turn (it shows what the turn cost), so
the last frame and the static screen agree. Log lines are revealed **in sync** — a beat's line appears on its contact
frame, so the text never runs ahead of the action.

**Intro** (`directIntro`): a diagonal wipe sweeps the stage, the foe slides in
from the right (a boss drops from above and lands with a shake), the hero steps
in from the left, and a `!` pops over the hero.

**Ambient** (`ambientFrames`): 4 resting frames cycling the species' idle
frames, with the persistent markers (stun stars orbiting, charge `!` pulsing).

## 4 · Player — playback and interaction (`cli/play.ts`)

| Feature | Detail |
| --- | --- |
| Scheduler | One `setTimeout` chain; each cue owns its own duration. Cancelable. |
| Flicker-free paint | Synchronized output (`CSI ?2026 h/l`), cursor home, per-line overwrite with `CSI K`, `CSI J` to clear leftovers — no full-screen wipe per frame. Only changed lines are rewritten. |
| Skip | Any key during playback jumps to the final screen **and is then handled** (e.g. mashing `a` keeps attacking). `Space` / `Enter` only skip. |
| Speed | `~` cycles `cinematic → normal → fast → off`; persisted as `questAnim` in buddy config. The default follows `gameFeel` (`off` ⇒ off, `full` ⇒ normal, else fast). `BUDDY_REDUCED_MOTION=1` forces off. |
| Action bar | In fights: `←/→` (or `h`/`l`) move a cursor over Attack · Defend · each skill (with cooldown) · each owned item · Flee; `Enter` acts; the focused action's description shows under the bar. Hotkeys still work. |
| Reveal | After a fight resolves, reward lines appear one by one; epic/legendary loot, level-ups and boss kills get a shimmer sweep. Banners (`VICTORY`, `LEVEL UP`…) expand from the center. |
| Title | The logo wipes in column by column with a shimmer, the buddy breathes and blinks, the prompt pulses. |
| Idle budget | Ambient loops run only while the terminal reports focus (`CSI ?1004 h`) and stop 30 s after the last key. No focus support ⇒ the 30 s budget still applies. |
| Resize | Re-paints the current frame at the new size without restarting playback. |

## 5 · Cost

- Hook path: `Paint.anim` is false ⇒ no beats are directed and no frames are
  baked; the only new work is drawing the static stage (same as before).
- TUI: frames are baked once per command (≈ 20–60 small strings), then painted.
  At rest the process sleeps on stdin.

## 6 · Tests

`server/rpg/anim.test.ts` covers: every cue of a turn renders to the same
height and width as the static screen; the last cue equals the resting stage;
log reveal is monotonic and ends at the full log; durations are positive and
scale with speed; beats exist for every action type (attack, defend, skill,
item, flee) and match `hits`; boss charge/interrupt/KO beats; plain mode emits
no escapes; the intro and ambient loops keep the same size.
