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

Tuned with a Monte-Carlo sim (a scripted policy: heal <40%, defend or
Breakpoint wind-ups, rotate skills) — floors are winnable at the zone's
expected gear, while each boss needs some training/gear beyond it (≈0–40%
win rate "on curve", ≈85–100% one tier up). Tunables live in `data.ts`
(boss multipliers, pacing) and `battle.ts` `curve()`.

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

## Verified in Claude Code

`claude -p ";me"` with the hook registered (Claude Code 2.1.289): the result
is `UserPromptSubmit operation blocked by hook:\n<screen>\n\nOriginal
prompt: ;me` with `num_turns: 0` and `total_cost_usd: 0` — no model call.

## Follow-ups

- Achievements/titles wired into `achievements.ts`.
- Set bonuses across matching gear tiers.
