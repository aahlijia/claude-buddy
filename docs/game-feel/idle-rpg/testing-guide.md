# Idle RPG — Testing Guide

A practical guide to exercising the idle-RPG features (equipment, merchant,
combat, statusline render, opt-out). Covers setup, the natural workflows, and
fast **deterministic harnesses** for triggering scenarios on demand.

> Status: features built & unit-tested (see [`status.md`](status.md)). This guide
> is for **manual / live** verification after install.

---

## 0. Setup

```bash
cd /Users/austinahlijian/Projects/claude-buddy
bun test          # sanity: 653 pass
bun run install-buddy
```
Then **restart Claude Code** (the MCP server + hooks reload). In a session:

1. **See your buddy:** the status line should show the companion (e.g. Waffle).
2. **Turn the juice up** so animations render — ask Claude:
   > set game feel to full
   (calls `buddy_gamefeel level=full`; read live, no restart needed.)

**State lives in** `~/.claude/buddy-state/` (or `$CLAUDE_CONFIG_DIR/buddy-state`).
Useful inspectors:
```bash
jq . ~/.claude/buddy-state/xp.json          # level, points, equipment, inventory
jq . ~/.claude/buddy-state/status.json      # what the status line renders
jq . ~/.claude/buddy-state/encounter.json   # the last baked fight (transient)
```
**Render the status line on demand** (reads live state, prints one frame):
```bash
echo '{}' | bash statusline/buddy-status.sh
```

> ⚠️ The `bun -e` harnesses below mutate your **real** buddy state (points,
> inventory, fights). That's intended for live testing. To keep your profile
> pristine, prefix any command with `CLAUDE_CONFIG_DIR=$(mktemp -d)` to run it
> against a throwaway profile instead.

### New tools at a glance
| Tool | What |
| --- | --- |
| `buddy_equip` | View loadout · `equip=<id>` · `unequip=<slot>` |
| `buddy_shop` | Browse catalog · `buy=<id>` (spends skill points) |
| `buddy_gamefeel` | `off` / `subtle` / `full` — gates animation + the opt-out |

---

## 1. Equipment slots

**Prompts:**
> show my buddy's loadout

> equip the debug wand

> take off my weapon

**What happens / expect:**
- No-arg `buddy_equip` → a loadout card (weapon / headgear / trinket + inventory).
  A fresh buddy is seeded with **Rubber Duck** + **Debug Wand**.
- `equip=debug_wand` → moves it into the weapon slot; inventory shrinks.
- Equipping into a full slot **swaps** the old item back to inventory.
- `unequip=weapon` → returns it to inventory.
- **Headgear shows live:** equip a hat item and the status-line buddy wears it —
  without clobbering its innate hat. Verify with `buddy_show` (the card reflects
  geared hat + any stat bonus) and `echo '{}' | bash statusline/buddy-status.sh`.

---

## 2. Merchant + interactive menu

Buying spends **skill points** (the same pool as `buddy_upgrades`). Earn them by
leveling, or grant some for testing:
```bash
bun -e 'import {grantBonusPoints} from "./server/xp.ts"; grantBonusPoints(20)'
```

**Prompts:**
> open the buddy shop

> buy the foam sword

**What happens / expect:**
- `buddy_shop` (no arg) → a catalog card: 🟢 affordable · 💸 too poor · 🔒 level-
  locked · ✅ owned, each with rarity ★ and price. Note the "_points are shared
  with `buddy_upgrades`_" line.
- It also emits a hidden `buddy:choices` marker → **Claude should pop an
  interactive `AskUserQuestion` menu** ("What would you like to buy?"). Pick one →
  Claude calls `buddy_shop buy=<id>`.
- A buy debits points, adds the item to inventory, and hints `buddy_equip`.
- Re-buying an owned item is refused; level-locked items (e.g. **Compiler Crown**,
  Lvl 6) stay 🔒 until you level up.

> 💡 The interactive menu is the one path not covered by unit tests — this is the
> main thing to eyeball live.

---

## 3. Combat — fighting bugs

Bugs spawn from the **errors seen during a session**, resolved **on git commit**
(`react.sh` → `award-xp.ts session_complete` → `maybeFightBug`). Tier scales with
error count: 1–2 → t1, 3–5 → t2, 6–9 → t3, 10+ → t4.

### A. Natural workflow
1. During a session, cause some errors (failing tests, a command that errors out)
   — the hooks count them.
2. `git commit` something.
3. Watch the status line: a **toast** appears — `🗡 squashed a null-wraith! +2 pt`
   (or `🐛 a typo gremlin scuttled off.` on a loss). Points/inventory update.

### B. Deterministic harness (recommended)
Reproducible, no real errors needed — drives the **real** pipeline. Use a small
error count (tier-1 bug) for a near-guaranteed **win** demo:
```bash
cd /Users/austinahlijian/Projects/claude-buddy
bun run server/award-xp.ts session_start                                   # baseline = now
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("errors_seen", 2)'
bun run server/award-xp.ts session_complete                                # → fights a tier-1 bug
```
Then inspect:
```bash
jq '{points: (.bonusPoints), inventory}' ~/.claude/buddy-state/xp.json
jq '{enemyGlyph, encounterAt}' ~/.claude/buddy-state/status.json
```

**Expect:**
- A **win** credits `bonusPoints` (≈ the bug's reward) and may add an item to
  `inventory`. A **flee** (more likely against high tiers) leaves points
  unchanged — that's the loss case, **not** a failure.
- `encounter.json` and `status.json.enemyGlyph` are written either way — these
  (plus the points/inventory delta) are the **reliable** signals that combat ran.
- Vary the count to change the tier: `2` → t1, `4` → t2, `7` → t3, `12` → t4.
  Higher tiers reward more but are harder; a higher **DEBUGGING** stat and an
  equipped weapon raise the win rate.

> **Toast caveat:** the combat summary shares the single bubble "toast" slot with
> other celebrations (a daily whim, a loot drop). On a busy commit another toast
> may win the slot, so the bubble might not show `squashed a …` even on a win —
> the **enemy glyph + the points/inventory change are the source of truth.**

> Tip: combat is deterministic per commit (seeded by `userId:startedAt:errors`),
> so the same setup yields the same outcome — bump the error count (re-`start`
> first) to reroll.

---

## 4. Statusline fight render — the two-sprite scene (Phase 5)

The fight **renders only at `gameFeel=full`**, for ~10s after it lands. The bug
spawns as a **second creature** (a buddy of a different kind) beside your buddy,
and they trade a short **sword-swing** flipbook: ready → wind-up (`>`/`<` eyes) →
**strike** (a `/\` clash in the gap) → resolve (win = `^^` vs `xx`; flee = the bug
shrugs). A win/flee toast rides the speech bubble.

**Force a fresh fight render without waiting on a commit** (uses a real baked
scene, so `combatFrames`/`artWidth` are populated):
```bash
bun -e '
import {resolveCombat, writeEncounter} from "./server/combat.ts";
import {loadCompanion, writeStatusState, saveConfig, loadConfig} from "./server/state.ts";
saveConfig({...loadConfig(), gameFeel:"full"});
const c = loadCompanion();
const bug = {id:"y", name:"segfault dragon", glyph:"🐉", tier:4, reward:5, species:"dragon"};
const r = resolveCombat(c.bones, bug, {}, Date.now() & 0xffff);
writeEncounter(r);
writeStatusState(c, { celebration: { text: r.summary, kind:"loot", at: Date.now() } });
'
# Sweep a few ticks to watch the flipbook (ready / wind-up / strike / resolve):
for n in 0 1 2 4; do echo "--- tick $n ---"; BUDDY_FAKE_NOW=$(( $(date +%s) + n )) bash statusline/buddy-status.sh < /dev/null; done
```
**Expect:** your buddy on the left, the **mirrored dragon** on the right, the `/\`
clash on the strike tick, the toast in the bubble, and the name re-centred under
the wider scene. After ~10s (the encounter TTL) it reverts to the idle buddy. In a
live session the status line repaints ~1×/sec, so it animates on its own.

**Width check:** the whole scene must stay within the terminal width. Force a
deterministic width with the `BUDDY_FAKE_COLS` seam and confirm no row exceeds it:
```bash
BUDDY_FAKE_COLS=100 BUDDY_FAKE_NOW=$(( $(date +%s) + 2 )) bash statusline/buddy-status.sh < /dev/null \
  | perl -CSD -pe 's/\e\[[0-9;]*m//g' | perl -CSD -ne 'chomp; printf "%3d  %s\n", length($_), $_'
# every printed width must be ≤ 100
```

> **Degraded fallback:** an older `status.json` (or version skew) without
> `combatFrames` falls back to the Phase-4 render — the single enemy **glyph** in
> the buddy's right margin. Seed it by writing an `encounter.json` whose `frames`
> is `[]` (or just `enemyGlyph`/`encounterAt` on `status.json`).

---

## 4b. Free-roam layout

The status line is no longer a rigid right-aligned block. The **stats panel is
left-anchored**; the **buddy cluster** (bubble + connector + sprite) free-roams
between the stats and the window edge, **clamped fully in-window**, with the
**bubble travelling with the buddy**.

**Watch the buddy amble (bubble travels with it):**
```bash
bun -e '
import {loadCompanion, writeStatusState, saveConfig, loadConfig} from "./server/state.ts";
saveConfig({...loadConfig(), gameFeel:"full"});
writeStatusState(loadCompanion(), { reaction: "hi there friend" });
'
# Force a wander track + sweep ticks; the whole cluster slides LEFT then home:
jq ".wanderSequence=[0,4,8,12,8,4]" ~/.claude/buddy-state/status.json > /tmp/s && mv /tmp/s ~/.claude/buddy-state/status.json
for n in 0 1 2 3; do echo "--- tick $n ---"; BUDDY_FAKE_NOW=$n bash statusline/buddy-status.sh < /dev/null; done
```
**Expect:** the bubble + connector + buddy + name all shift left together as one
block; the stats panel (if `showStats` on) never moves.

**No-clip / bubble-drop check** (the clipping bug this fixes):
```bash
for cols in 120 80 60 50; do
  echo "=== COLS=$cols ===";
  BUDDY_FAKE_COLS=$cols BUDDY_FAKE_NOW=0 bash statusline/buddy-status.sh < /dev/null \
    | perl -CSD -pe 's/\e\[[0-9;]*m//g' | perl -CSD -ne 'chomp; printf "%3d  %s\n", length($_), $_'
done
# Every width ≤ COLS. As COLS shrinks the speech bubble is DROPPED so the buddy
# sprite itself is never cut off (sprite visibility always wins).
```

---

## 5. Opt-out gate

`gameFeel` is the master switch:

| Set it to | Combat + drops | Stat accrual | Toast | Fight animation |
| --- | :---: | :---: | :---: | :---: |
| `off` | ❌ | ❌ | ❌ | ❌ |
| `subtle` | ✅ | ✅ | ✅ | ❌ |
| `full` | ✅ | ✅ | ✅ | ✅ |

**Prompt:**
> turn game feel off

**Verify the opt-out** (combat + accrual must not run):
```bash
bun -e 'import {saveConfig, loadConfig} from "./server/state.ts"; saveConfig({...loadConfig(), gameFeel:"off"})'
bun run server/award-xp.ts session_start
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("errors_seen", 8)'
BEFORE=$(jq .bonusPoints ~/.claude/buddy-state/xp.json)
bun run server/award-xp.ts session_complete
AFTER=$(jq .bonusPoints ~/.claude/buddy-state/xp.json)
echo "points $BEFORE → $AFTER (should be unchanged); encounter.json should be stale/absent"
```
At `subtle`, the same steps **do** award points + show the toast, but the status
line shows **no** two-sprite fight scene (the buddy keeps idling).

---

## 6. Reset / cleanup

```bash
# Nuke the transient fight so the status line goes idle immediately:
rm -f ~/.claude/buddy-state/encounter.json

# Re-baseline so a stray error count doesn't trigger a fight on your next commit:
bun run server/award-xp.ts session_start
```
A full uninstall (`bun run` the uninstall CLI, or the `buddy_uninstall` tool)
removes plugin state entirely. Or just test against a throwaway profile from the
start: prefix commands with `CLAUDE_CONFIG_DIR=$(mktemp -d)`.

---

## Gotchas

- **Nothing animates?** Confirm `gameFeel=full` (`buddy_gamefeel`), and that
  `encounter.json` is fresh (< ~10s old) — the render TTL is short by design.
- **Auto-quiet:** during an error spike or deep focus, `full` is transiently
  clamped to `subtle` (animation pauses) — that's correct behavior, not a bug.
- **Status line lag:** Claude Code repaints the status line roughly once a second;
  give it a beat, or render manually with the `bash statusline/buddy-status.sh`
  one-liner.
- **Combat didn't fire?** It needs `errors_seen > 0` **since the last
  `session_start`** and a `session_complete`. Re-run the harness in order.
