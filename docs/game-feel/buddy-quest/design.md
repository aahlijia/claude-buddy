# Buddy Quest — design

A playable turn-based RPG layered on top of the companion. Goals, from the
request: full RPG progression (zones, bosses, gear, stat leveling), **easy on
tokens**, and **no load on the user's machine** while Claude Code runs.

_Status: implemented on `feature/living-world`._

## Decisions (user-confirmed)

| Question | Choice |
| --- | --- |
| Play surface | `;` prompt commands answered by a `UserPromptSubmit` hook (zero tokens) **+** a full-screen `claude-buddy play` TUI |
| Combat | Hybrid: coding still drives the idle bug fights; manual turn-based fights for floors, bosses and the tower |
| Progression | Layered on top: buddy level/prestige + the five personality stats feed derived combat stats; gold training + gear stack on |

## Zero-token channel

`hooks/rpg-command.sh` runs on every prompt. A pure-bash regex on the raw hook
JSON (`"prompt": ";...`) is the only work done for an ordinary prompt — no jq,
no bun. For a `;` prompt it pipes the JSON to `bun server/rpg/cli.ts --hook`,
which prints `{"decision":"block","reason":"<screen>"}`. Claude Code shows the
reason to the user and never sends the prompt to the model. Hook output is not
ANSI-rendered, so the hook path renders plain text (the TUI renders color).

## Modules (`server/rpg/`)

| File | Role |
| --- | --- |
| `data.ts` | Catalog: zones, monsters, bosses, skills, consumables, gear bases, affixes, pacing constants |
| `hero.ts` | `deriveHero` — buddy level/prestige/stats + training + gear → HP/ATK/DEF/SPD/CRIT/LEECH/GOLD |
| `gear.ts` | Seeded gear rolls (slot, tier name, rarity, affixes), score, sell value |
| `battle.ts` | Pure turn engine: `startBattle`, `act`, boss AI, status effects. Seeded per turn ⇒ replayable |
| `store.ts` | `rpg.json` load/coerce/atomic save; lazy timestamp regen (energy, HP) |
| `game.ts` | Command parser + every command → text; rewards, drops, shop, training; `onCommit`, `hudLine` |
| `render.ts` | Battle screen (reuses `composePose` from the idle fights), bars, gear lines |
| `cli.ts` | Hook / one-shot / `commit` entry; builds the buddy context; patches `rpgHud` into status.json |

`cli/play.ts` is the TUI: raw-mode stdin, redraw only on a keypress.

## Integration points

- **Commit reward:** `awardSessionComplete` → `grantQuestCommitReward` (guarded
  lazy require, only once `rpg.json` exists): +3 energy, gold scaled by zone,
  bounty when the idle bug fight was won.
- **Buddy XP:** fight wins return XP that `cli.ts` awards via `awardXpAmount`.
- **Status line:** `rpgHud` rides the existing single jq pass over status.json
  (no new fork); `writeStatusState` carries it forward. Rendered as one dim row
  at the bottom, clipped to the width; `questHud=false` hides it.

## Bosses

| Zone | Boss | Mechanic | Counter | Unlocks |
| --- | --- | --- | --- | --- |
| 1 Syntax Meadows | The Missing Semicolon | wind-up every 3rd turn → 2.4× Parse Error | defend / Breakpoint | Refactor |
| 2 Null Marsh | Null Pointer Lich | lifesteal; <50% HP curses your aim | burst, Hotfix | Breakpoint |
| 3 Callback Caverns | Callback Hydra | multi-hit, +1 head per 25% HP lost | kill fast, defend | Rubber Duck |
| 4 Race Rapids | The Heisenbug | +40% dodge while unobserved | defend to observe, Rubber Duck | Garbage Collect |
| 5 Leak Mines | Leaky Golem | grows max HP/ATK every turn (cap 2×) | stun, burst | Fork Bomb |
| 6 Kernel Abyss | Segfault Dragon | 3× Core Dump wind-up; enrages <30% | defend / Breakpoint | Endless Tower |

## Balance

Two simulators drove the numbers:

1. **Per-fight Monte-Carlo** (scripted policy: heal <40%, defend or
   Breakpoint wind-ups, rotate skills) for individual floor/boss odds.
2. **Full-playthrough bot** driving `execute` exactly like a player:
   equips upgrades, sells junk, buys coffee, trains, forges to +5, takes
   events, rests below half HP, retries bosses — with simulated time
   (energy regen, an hourly commit, overnight breaks) and buddy XP from
   both fights and "coding".

What the bot sim found and what changed:

| Finding | Fix |
| --- | --- |
| A zone was 5 fights + a boss (≈36 fights per playthrough) | Floor guardians: 3 wins per floor, the 3rd an elite guardian (`FLOOR_WINS`) |
| Zero KOs anywhere; trained DEF snowballed to ~70% mitigation | Mitigation constant scales with the attacker's level; DEF/HP training gains halved-ish; training cost growth 1.22 → 1.27 |
| Bosses died first try with ~50% HP left; extra boss HP just meant more Hotfixes | Separate boss HP/ATK knobs — damage-per-turn is the real threat lever |
| Too many legendaries | Lower legendary/epic weights and luck slope |
| Then the Segfault Dragon became a wall (68 tries for a slow turtle) | Dragon HP 4 → 3.5, ATK 1.2 → 1.02 |

Final numbers across cat/turtle/goose/duck/snail: ~2,700–2,900 commands,
~220–300 kills, bosses 1–5 mostly first or second try, the dragon a real
final exam (≈10–14 KOs). Knobs: `HP_SCALE`, `ATK_SCALE`,
`BOSS_HP_SCALE`, `BOSS_ATK_SCALE` in `battle.ts`; boss multipliers and
pacing in `data.ts`.

## Depth pass

- **Species passives** (`SPECIES_PASSIVES`, data.ts): one per species, applied
  as % (ATK/DEF/HP) or flat (SPD/CRIT/LEECH/GOLD) modifiers in `deriveHero`.
- **Legendary uniques** (`UNIQUES`): every legendary rolls one of Thorns,
  Second Wind, First Strike, Midas, Overclock. Combat ones live in
  `battle.ts` (`HeroSide.uniques`); Midas applies in `game.ts` `conclude`.
- **Daily bounties** (`bounty.ts`): three distinct day-seeded tasks (kills,
  skills, commits, boss, flawless wins, hunts, gold). Progress hooks sit in
  `turn`/`conclude`/`onCommit`; completion pays immediately, a cleared board
  pays an Energy Drink.
- **`;hunt`**: `cli.ts` `loadStandoff` reads the idle-RPG
  `pending-encounter.json` (bug + tier + boss flag) into `BuddyCtx.standoff`.
  The hunt is a scaled fight vs that bug's species, once per standoff
  (`RpgState.hunted` = `bugId:startedAt`), double gold, 60% drop. It never
  clears the standoff — the commit-nudge semantics stay intact.

## "Feels like a game" pass

| Area | Module | Notes |
| --- | --- | --- |
| Story | `story.ts` | Prologue (first command, once — `seen[0]`), zone arrivals (`seen[z]`), boss intro/phase/defeat lines (battle log), ending on the first Segfault kill |
| Events | `events.ts` | 22% of explores (never twice running, never a new player's first) open a free room; pure `resolveEvent` → `EventOutcome` applied by `game.ts`. Mimic = battle kind `event` (2× gold, guaranteed drop, no floor progress) |
| Blessings | `game.ts` `bless` | Shrine/duck buffs applied to the next N fresh battles, counted down in `conclude` |
| Forge | `forge.ts` | `GearItem.plus`, +10% all stats per level via `gearStats`; 100% to +5, then 85→30% |
| Feats | `feats.ts` | 21 predicates over the save; `checkFeats` runs after every command (gold + titles) |
| Level-up | `cli.ts` | XP award compares buddy level before/after → fanfare line |
| Presentation | `render.ts` | Open-right panels (no right border: emoji widths vary by terminal), damage-pop row from `Battle.hits`, town screen with the buddy sprite |
| Animation | `anim.ts`, `stage.ts`, `playkit.ts`, `cli/play.ts` | Replaced by the animation overhaul: battle beats → director cues → stage canvas → diff-painted TUI player. See [design-animation.md](design-animation.md) |

## Verified in Claude Code

`claude -p ";me"` with the hook registered (Claude Code 2.1.289): the result
is `UserPromptSubmit operation blocked by hook:\n<screen>\n\nOriginal
prompt: ;me` with `num_turns: 0` and `total_cost_usd: 0` — no model call.

## Follow-ups

- Achievements/titles wired into `achievements.ts`.
- Set bonuses across matching gear tiers.
