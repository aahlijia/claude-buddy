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
bun test          # sanity: 724 pass
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

Bugs spawn from the **error-ish events seen during a session** — the sum of
`errors_seen`, `tests_failed`, `type_errors`, `lint_fails`, and `build_fails`
(`combatErrorCount`) — resolved **on git commit** (`react.sh` →
`award-xp.ts session_complete` → `maybeFightBug`). Tier scales with the count:
1–2 → t1, 3–5 → t2, 6–9 → t3, 10+ → t4.

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
# (any error-ish counter works — e.g. incrementEvent("tests_failed", 2))
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

## 3b. Pending encounter — the standoff before the fight

The fight above is no longer the *first* time you see the bug. From the **first
error-ish event** the enemy appears as a persistent **standoff** on the status
line (`react.sh` → `award-xp.ts bug_sighted` → `sightBug`) and stays there — **no
TTL** — until a commit resolves it. It's the "you have uncommitted, error-marked
work" nudge. It only shows at `gameFeel=full`; `subtle`/`off` no-op the sighting.

**Deterministic harness** (drives the real `bug_sighted` pipeline):
```bash
cd /Users/austinahlijian/Projects/claude-buddy
bun run server/award-xp.ts session_start                                   # baseline = now
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("tests_failed", 1)'
bun run server/award-xp.ts bug_sighted                                     # → spawns a tier-1 standoff
jq '{bugId, tier, startedAt}' ~/.claude/buddy-state/pending-encounter.json
jq '{combatSticky, hasScene:(.combatFrames|length>0), encounterAt}' ~/.claude/buddy-state/status.json
```
**Expect:** `pending-encounter.json` pins a `bugId` at `tier: 1`; `status.json`
carries `combatSticky: 1`, a baked `combatFrames` scene, and **no `encounterAt`**
(the standoff bypasses the 10s TTL — that's the whole point).

**Escalation** — more errors upgrade the enemy's tier (a fresh same-seeded roll
at the higher tier); a same-tier repeat is a cheap no-op (pinned bug unchanged):
```bash
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("tests_failed", 2)'  # 1 → 3 ⇒ t2
bun run server/award-xp.ts bug_sighted
jq '.tier' ~/.claude/buddy-state/pending-encounter.json                    # → 2
```

**Render the standoff** (full-only, animates ready ↔ periodic glare, no strike):
```bash
for n in 0 1 2 3; do echo "--- tick $n ---"; BUDDY_FAKE_NOW=$(( $(date +%s) + n )) bash statusline/buddy-status.sh < /dev/null; done
```
Your buddy on the left, the mirrored enemy on the right, the gap **blank** (no
`/\` clash — that's the resolved fight only), and the buddy **doesn't wander**
while it renders. The buddy's normal chatter still shows during the standoff.

**Skirmish bouts** (design-attack-animation): twice per loop one sprite walks
across the gap and swings — a red `✗ -N` pop over the victim, then it floats
away. The loop is seeded per (session, tier) and ~34–55s long, so to catch a
bout deterministically sweep the sequence instead of waiting:
```bash
# Find the bout ticks (frame indices 2-7 are bout poses; 3 and 6 are impacts):
jq -r '.combatSequence | join("")' ~/.claude/buddy-state/status.json
# Render tick k of the loop (k = a position showing 3 or 6 above):
BUDDY_FAKE_NOW=$k bash statusline/buddy-status.sh < /dev/null
```
**Expect:** the attacker shifted into the gap, hurt eyes (`x`) on the victim,
the red pop above the scene, and every rendered line still inside the window.
The commit-time fight shows the same pop over the bug on a **win** (strike +
triumph frames); on a flee the overlay row stays blank.

**Commit dismisses it** (the nudge semantics — G5/D6). Fixing the error does
**not** clear the standoff; only a commit does, which also fights the pinned bug:
```bash
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("commits_made", 1)'
bun run server/award-xp.ts session_complete
ls ~/.claude/buddy-state/pending-encounter.json 2>&1                       # → No such file (cleared)
jq '{enemyGlyph, encounterAt}' ~/.claude/buddy-state/status.json           # → the resolved 10s fight
```
`session_start` also clears an orphaned standoff (a fresh baseline would make it
a ghost). To wipe one by hand: `rm -f ~/.claude/buddy-state/pending-encounter.json`.

> **Cooldown note:** in a live session `react.sh`'s 30s reaction cooldown can lag
> the first sighting behind the first error. The commit-time fight never
> under-counts regardless — resolution falls back to a fresh roll if no standoff
> was pinned — so only the *nudge* is delayed, never the reward.

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
# Nuke the transient fight AND any pending standoff so the line goes idle now:
rm -f ~/.claude/buddy-state/encounter.json ~/.claude/buddy-state/pending-encounter.json

# Re-baseline so a stray error count doesn't trigger a fight on your next commit
# (this also clears any surviving standoff):
bun run server/award-xp.ts session_start
```
A full uninstall (`bun run` the uninstall CLI, or the `buddy_uninstall` tool)
removes plugin state entirely. Or just test against a throwaway profile from the
start: prefix commands with `CLAUDE_CONFIG_DIR=$(mktemp -d)`.

---

## 7. Derive-on-read upgrades (buy/refund purity)

Owned upgrades (hat/stat/shiny/flag) no longer mutate `companion.bones` — they
fold into the display/combat view at read time from `unlockedUpgrades`, exactly
like equipment (see
[`design-derive-upgrades.md`](design-derive-upgrades.md)). The buy/refund cycle
should now be **exact**: nothing about your buddy's saved bones changes,
regardless of how many times you buy and refund.

**Prompts:**
> buy the royal crown

> refund the royal crown

**What happens / expect:**
- `buddy_upgrades buy=crown` → the status line and `buddy_show` card show the
  crown immediately, **without** `menagerie.json`'s `bones.hat` changing:
  ```bash
  jq '.companions[.active].bones.hat' ~/.claude/buddy-state/menagerie.json  # still your innate hat (e.g. "none")
  jq '.unlockedUpgrades' ~/.claude/buddy-state/xp.json                      # now contains "crown"
  echo '{}' | bash statusline/buddy-status.sh                               # buddy renders wearing the crown
  ```
- `buddy_upgrades refund=crown` while respec is open (below level 10, or right
  after an ascension) → succeeds and removes `crown` from `unlockedUpgrades`.
  Before this design, hat/stat upgrades were **permanently non-refundable**
  once past their level gate (a lossy-revert guard) — that guard is gone.
- **Menagerie-wide:** an owned upgrade now shows on **every** companion, not
  just whoever was active at purchase — switch buddies (`/buddy list`, pick
  another) and the crown still shows.

**Migration (legacy state):** a save file from before this design has upgrade
effects baked directly into `bones` (e.g. `bones.hat` already `"crown"`,
`bones.stats.<peak>` already bumped). The one-time rebase runs automatically on
the next `loadXpState()` call (any tool, any hook). Simulate it manually:
```bash
# Force the "needs migration" path by clearing the marker:
jq 'del(.upgradeEffectsDerived)' ~/.claude/buddy-state/xp.json > /tmp/x && mv /tmp/x ~/.claude/buddy-state/xp.json
bun -e 'import {getXpState} from "./server/xp.ts"; getXpState()'   # triggers the rebase
jq '.upgradeEffectsDerived' ~/.claude/buddy-state/xp.json                        # now true
jq '.companions[.active].effectsRebased' ~/.claude/buddy-state/menagerie.json    # now true
```
**Expect:** `buddy_show` / the status line render **identically** before and
after (G4 parity) — the rebase only moves where the effect lives, not what it
looks like.

---

## 8. Living-world P1 — mood gaits, stingers, and the D14 exemption

The living-world arc's P1 phase ([living-world/design.md](../living-world/design.md))
adds gait profiles (angry/bored/happy walk personalities), event-choreography
stingers (victory-lap, loot-dash, walk-on), and lean/peek edge posture — all
baked server-side, zero `buddy-status.sh` changes. These harnesses drive the
real award path in a throwaway profile; always export `CLAUDE_CONFIG_DIR` for
every process below, including the shell renders.

**Setup (once):**
```bash
cd /Users/austinahlijian/Projects/claude-buddy
export CLAUDE_CONFIG_DIR=$(mktemp -d)
bun -e '
import { saveConfig, loadConfig, saveCompanion } from "./server/state.ts";
saveCompanion({
  name: "Waffle", personality: "",
  bones: {
    species: "cactus", rarity: "common", eye: "·", hat: "none",
    shiny: false, peak: "SNARK", dump: "WISDOM",
    stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
  },
});
saveConfig({ ...loadConfig(), gameFeel: "full" });
'
```

### a. Walk-on stinger (session start)
```bash
W=$(date +%s)
bun run server/award-xp.ts session_start
jq '.wanderSequence[('"$W"'%180):('"$W"'%180+8)]' \
  "$CLAUDE_CONFIG_DIR/buddy-state/status.json"   # → 3,3,2,2,1,1,0,0 (arc head to home)
for n in 0 1 2 3 4; do
  BUDDY_FAKE_NOW=$((W+n)) bash statusline/buddy-status.sh < /dev/null
done
```
**Expect:** the arc head (offset ≥3) is spliced at index `W % 180` (walk-on
anchors immediately, `STINGER_DELAY_TICKS` doesn't apply to it); the buddy's
art column advances tick over tick as the offset descends toward home.

### b. Angry gait + `!` emote (D14 — reads the configured level, not the clamp)
```bash
bun -e '
import { saveReaction } from "./server/state.ts";
saveReaction("ugh, another error", "error");
'
bun run server/award-xp.ts errors_spotted
jq '{wanderLen: (.wanderSequence|length), frameSeqLen: (.frameSequence|length)}' \
  "$CLAUDE_CONFIG_DIR/buddy-state/status.json"   # → both 180 (the gaited walk)
BUDDY_FAKE_NOW=$(date +%s) bash statusline/buddy-status.sh < /dev/null
```
**Expect:** `wanderSequence`/`frameSequence` are both the 180-tick gaited
walk (not the classic 6-tick emotion micro-cycle), and the rendered line
carries a `!` row above the sprite. Before D14 this reason ("error") *always*
clamped a configured `full` to `subtle` first — the same reason that selects
angry emotion is also an auto-quiet spike reason — so both fields came back
absent/short and the emote never showed. D14 exempts the angry idle
expression from that clamp; every other reaction reason is unaffected.

### c. Victory lap (a real won fight, deterministic seed search)
Reuses `session.test.ts`'s fresh-process win/flee search technique, inlined
so the same process both finds the seed and performs the real award-path
write (`writeStatusState` + `pickCelebration` + `stingerForCompletion`,
exactly what `award-xp.ts session_complete` calls):
```bash
bun -e '
import { saveConfig, loadConfig, loadCompanion, writeStatusState, pickCelebration } from "./server/state.ts";
import { awardSessionComplete, saveSnapshot, stingerForCompletion, formatStatUpText, raisedStatNames } from "./server/session.ts";
import { incrementEvent } from "./server/achievements.ts";

saveConfig({ ...loadConfig(), gameFeel: "full" });
const ZERO = { all_green:0, large_diffs:0, errors_seen:0, commits_made:0, tests_failed:0, type_errors:0, lint_fails:0, build_fails:0, pets:0 };
incrementEvent("errors_seen", 10); // tier 4 (DEBUGGING 50 vs t4 ⇒ ~30% win chance)

let found = null;
for (let t = 0; t < 300 && !found; t++) {
  saveSnapshot({ startedAt: t, baseline: ZERO });
  const completion = awardSessionComplete(undefined, "cactus", "common");
  if (completion.fightWon) found = { t, completion };
}
const { completion } = found;
const companion = loadCompanion();
const statUpText = formatStatUpText(completion.statIncrements);
const { celebration, cause } = pickCelebration(
  completion.state.level, false, false, completion.fightSummary, false, "loot", statUpText,
);
const stinger = stingerForCompletion(completion.fightWon, completion.fightSummary, celebration?.kind);
writeStatusState(companion, {
  level: completion.state.level, xp: completion.state.totalXp, xpGain: completion.bonus,
  celebration, cause, statsRaised: raisedStatNames(completion.statIncrements),
  flourish: celebration != null && celebration.kind !== "discovery", stinger,
});
console.log(JSON.stringify({ t: found.t, at: Math.floor(Date.now()/1000), stinger }));
'
```
Note the printed `at` (the write's wall-clock second) as `W`, then sweep:
```bash
for n in 0 3 6 9; do   # celebration-fresh window: wander suppressed
  BUDDY_FAKE_NOW=$((W+n)) bash statusline/buddy-status.sh < /dev/null
done
for n in 12 13 14 15 16 17; do   # STINGER_DELAY_TICKS past the write
  BUDDY_FAKE_NOW=$((W+n)) bash statusline/buddy-status.sh < /dev/null
done
```
**Expect:** `W..W+9` renders identically each tick — the win toast showing,
buddy planted at home (celebration freshness suppresses wander). From `W+12`
the buddy sweeps the two-lap victory arc (`1,2,3,2,1,0,1,2,3,2,1,0`) as the
toast fades, confirmed by the art column moving in that exact pattern.

**Cleanup:** `rm -rf "$CLAUDE_CONFIG_DIR"` when done — never run these
against your real profile.

---

## 9. Living-world P2 — boss bugs and wild visitors

The living-world arc's P2 phase ([living-world/design.md](../living-world/design.md)
§P2) upgrades the standoff into a multi-stage **boss** past a threshold, and
adds a wholly separate **wild visitor** cameo — both baked server-side, zero
`buddy-status.sh` changes. Same idiom as §8: always export
`CLAUDE_CONFIG_DIR` first, every process below (including the shell renders)
must see it.

**Setup (once, same companion as §8):**
```bash
cd /Users/austinahlijian/Projects/claude-buddy
export CLAUDE_CONFIG_DIR=$(mktemp -d)
ls "$CLAUDE_CONFIG_DIR"                                                     # confirm it's the throwaway, not $HOME/.claude-buddy
bun -e '
import { saveConfig, loadConfig, saveCompanion } from "./server/state.ts";
saveCompanion({
  name: "Waffle", personality: "",
  bones: {
    species: "cactus", rarity: "common", eye: "·", hat: "none",
    shiny: false, peak: "SNARK", dump: "WISDOM",
    stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
  },
});
saveConfig({ ...loadConfig(), gameFeel: "full" });
'
```

### a. Boss standoff — threshold trigger, pips, crown

`BOSS_THRESHOLD = 12` (session.ts) — no roll, purely deterministic (D13). A
single sighting at count ≥ 12 upgrades the standoff straight to a boss:
```bash
bun run server/award-xp.ts session_start
bun -e 'import {incrementEvent} from "./server/achievements.ts"; incrementEvent("tests_failed", 12)'
bun run server/award-xp.ts bug_sighted
jq '{bugId, kind, stages, stagesCleared, caption}' \
  "$CLAUDE_CONFIG_DIR/buddy-state/pending-encounter.json"
BUDDY_FAKE_NOW=$(date +%s) bash statusline/buddy-status.sh < /dev/null
```
**Expect:** `kind: "boss"`, `stages: 2`, `stagesCleared: 0`, caption
`BOSS in <project>! ▱▱` (`bossPips` — nothing cleared yet, both pips hollow).
The rendered scene shows a `♛` crown over the enemy's blank row 0
(`applyBossCrown`, the tier-4-fallback boss look) and the caption centered
above the two-sprite standoff.

**Stage-win → pip fill → persist (the G5 revision).** Unlike an ordinary
standoff, a boss is **not** cleared by a commit unless it's the final stage —
keep calling `session_complete` (not `session_start`, which would clear the
whole standoff per D12) with a bumped error count each try until one wins
(deterministic per `startedAt`+`errorsSeen`, so a bumped count re-seeds):
```bash
for i in 1 2 3 4 5; do
  bun -e "import {incrementEvent} from './server/achievements.ts'; incrementEvent('tests_failed', $i)"
  bun run server/award-xp.ts session_complete
  jq -e '.stagesCleared == 1' "$CLAUDE_CONFIG_DIR/buddy-state/pending-encounter.json" \
    >/dev/null 2>&1 && { echo "stage 1 win at i=$i"; break; }
done
jq '{stages, stagesCleared, caption}' "$CLAUDE_CONFIG_DIR/buddy-state/pending-encounter.json"
```
**Expect:** the pending file still exists (`stagesCleared: 1`, caption
`▰▱`), and the win's toast reads `⚔️ Stage 1/2 down — the boss staggers!` —
a stage clear, not a kill. The standoff (with its crown) is still what
renders.

**Final stage → kill scene, guaranteed drop, badge.** One more winning
commit (same loop, without `session_start` in between — a boss survives
across commits by design):
```bash
for i in 1 2 3 4 5; do
  bun -e "import {incrementEvent} from './server/achievements.ts'; incrementEvent('tests_failed', $i)"
  bun run server/award-xp.ts session_complete
  [ -f "$CLAUDE_CONFIG_DIR/buddy-state/pending-encounter.json" ] || { echo "boss down at i=$i"; break; }
done
jq '.bosses_beaten' "$CLAUDE_CONFIG_DIR/buddy-state/events.json"
jq 'map(select(.id=="boss_slayer"))' "$CLAUDE_CONFIG_DIR/buddy-state/unlocked.json"
jq '{points: .bonusPoints, inventory}' "$CLAUDE_CONFIG_DIR/buddy-state/xp.json"
```
**Expect:** `pending-encounter.json` is gone, `bosses_beaten` is `1`, the
`boss_slayer` 👑 badge appears in `unlocked.json`, and `inventory` gained a
rare+ item on top of a points bump well above a normal tier-4 win — the
guaranteed `bossDrop`. The next render (within the resolved-scene's ~10s
TTL, keyed off the write's own wall-clock `encounterAt`) shows the `👑 BOSS
DOWN` toast and the crowned kill scene.

### b. Wild visitor — seeded roll, greet scene, toast

Visitors roll only when the commit's own combat slot is untouched (no fight,
no live standoff, no fresh resolved scene — combat always outranks a social
call) at ~1-in-12 odds, seeded per `visitor:<user>:<startedAt>`. Rather than
looping and hoping (odds this good rarely need it), search the pure core for
a hit exactly like §8c searches for a win, then drive the real pipeline at
that `startedAt`:
```bash
bun -e '
import { rollVisitor } from "./server/visitor.ts";
import { resolveUserId } from "./server/state.ts";
import { hashString } from "./server/engine.ts";
const user = resolveUserId();
let found = null;
for (let t = 0; t < 2000 && !found; t++) {
  const v = rollVisitor(hashString(`visitor:${user}:${t}`), "cactus");
  if (v && v.reward) found = { t, v };
}
console.log(JSON.stringify(found));
'
```
Note the printed `t`, then force the session snapshot to that `startedAt`
(baseline unchanged, so the commit delta stays zero ⇒ no fight competes for
the combat slot) and run a commit:
```bash
bun -e '
import { startSession, saveSnapshot } from "./server/session.ts";
saveSnapshot({ ...startSession(), startedAt: T });   // substitute the found t
'
bun run server/award-xp.ts session_complete
jq '{caption, enemyGlyph}' "$CLAUDE_CONFIG_DIR/buddy-state/visitor.json"
jq '.celebration' "$CLAUDE_CONFIG_DIR/buddy-state/status.json"
BUDDY_FAKE_NOW=$(( $(jq '.encounterAt/1000|floor' "$CLAUDE_CONFIG_DIR/buddy-state/status.json") + 8 )) \
  bash statusline/buddy-status.sh < /dev/null
```
**Expect:** `visitor.json` carries the caption `A wild <species> stopped
by!`; `status.json.celebration` is `{kind: "visitor", text: "🐾 a wild
<species> stopped by! left <n> pts!"}`; the render at `+8` ticks (mid-loop)
shows the visiting species walked on with a `♥` overlay pop over the greet
beat. At `subtle` only the toast shows — the scene render is `full`-only,
same gate as every other combat surface.

**Cleanup:** `rm -rf "$CLAUDE_CONFIG_DIR"` when done — never run these
against your real profile.

---

## 10. Living-world P4 — props, prop-kick, inspect beat, weather

The living-world arc's P4 phase ([living-world/design.md](../living-world/design.md)
§P4) adds ambient ground props (a daily sprout by the feet, a kickable
pebble ahead), a loot-dash inspect beat over a dropped item, and sparse
weather FX — all baked server-side, zero `buddy-status.sh` changes. Same
idiom as §8/§9: always export `CLAUDE_CONFIG_DIR` first and confirm it's
the throwaway (`ls "$CLAUDE_CONFIG_DIR"`, not `$HOME/.claude-buddy`) before
any write — every process below, including the shell renders, must see it.

**Setup (once) — the crowded-sprite worst case: hat + gear + props at
once.** Cactus is one of the 11 species with a spare kick column
(`PROP_KICK_COLUMNS`, art.ts), so it's the species to use if you want to
see the pebble actually slide, not just sit still:
```bash
cd /Users/austinahlijian/Projects/claude-buddy
export CLAUDE_CONFIG_DIR=$(mktemp -d)
ls "$CLAUDE_CONFIG_DIR"                                      # confirm it's the throwaway
bun -e '
import { saveConfig, loadConfig, saveCompanion } from "./server/state.ts";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
saveCompanion({
  name: "Waffle", personality: "",
  bones: {
    species: "cactus", rarity: "common", eye: "·", hat: "crown",
    shiny: false, peak: "SNARK", dump: "WISDOM",
    stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
  },
});
saveConfig({ ...loadConfig(), gameFeel: "full", wanderEnabled: true });
const stateDir = join(process.env.CLAUDE_CONFIG_DIR, "buddy-state");
mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, "xp.json"), JSON.stringify({
  totalXp: 0, equipment: { trinket: "rubber_duck" }, upgradeEffectsDerived: true,
}));
'
bun run server/award-xp.ts session_start
```

### a. Props coexist with gear + the pebble kicks
```bash
jq -r '.frames[] | select(length>0)' "$CLAUDE_CONFIG_DIR/buddy-state/status.json" | tail -6
for n in 0 1 2 3 4 5 6 7 8; do
  BUDDY_FAKE_NOW=$(( $(date +%s) + n )) bash statusline/buddy-status.sh <<< '{}'
done
```
**Expect:** every idle frame's row 4 carries `,>` (the equipped rubber-duck
trinket, cols 0-1) **and** a daily-constant clover/sprout glyph a couple
cells in (`♣`/`⚘`/`✿`/`☘` — whichever the day-seed drew) — no clobber
between the two. Over the ticks the pebble at the far-right column drifts
inward (col 11 → 10 → 9 → 7 for cactus) on the walk's step ticks, then
resets — the real per-species sliding motion (Task 4, after its two fix
rounds — see [CURRENT-STATE.md's P4
section](../CURRENT-STATE.md#living-world-arc--p4-world-dressing-2026-07-20)
for the saga), not a withheld toggle.

### b. Loot-dash inspect beat over a dropped item
```bash
bun -e '
import { loadCompanion, writeStatusState } from "./server/state.ts";
writeStatusState(loadCompanion(), { stinger: "lootdash" });
console.log(JSON.stringify({ at: Math.floor(Date.now()/1000) }));
'
# note the printed "at" as W, then find which frameSequence offsets are
# the peek/inspect frame (index 10 in the fixture above — the last baked
# idle frame) and render across that span:
jq -c '.frameSequence | to_entries | map(select(.value==10)) | map(.key)' \
  "$CLAUDE_CONFIG_DIR/buddy-state/status.json"
```
Render a few ticks straddling the reported offsets (`(W + offset) % 180`,
`STINGER_DELAY_TICKS` after the write). **Expect:** for exactly the
inspect pause's 3 ticks the buddy shows the peek posture (`<  <` eyes) with
a dropped-item glyph (`◇`) at the pebble's `ahead` anchor, then reverts to
the normal walking pose and the day's own pebble.

### c. Weather — drizzle on a rough streak, sparkle on a clean one
```bash
# Drizzle: bump this session's live error count past the rough threshold.
bun -e 'import { incrementEvent } from "./server/achievements.ts"; incrementEvent("errors_seen", 4);'
bun -e 'import { loadCompanion, writeStatusState } from "./server/state.ts"; writeStatusState(loadCompanion(), {});'
BUDDY_FAKE_NOW=$(date +%s) bash statusline/buddy-status.sh <<< '{}'
```
**Expect:** a drizzle row (`'` marks) above the sprite — one new row, not a
clipped one.
```bash
# Sparkle: reset the session baseline to the current counters (so the
# error delta drops back to 0) and set a clean streak.
bun -e '
import { saveSnapshot, extractCounters } from "./server/session.ts";
import { loadEvents } from "./server/achievements.ts";
import { writeFileSync } from "fs";
import { join } from "path";
saveSnapshot({ startedAt: Math.floor(Date.now()/1000), baseline: extractCounters(loadEvents()) });
writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, "buddy-state", "streak.json"),
  JSON.stringify({ current: 3, longest: 3, lastSessionAt: Date.now(), lastStartAt: Date.now() }));
'
bun -e 'import { loadCompanion, writeStatusState } from "./server/state.ts"; writeStatusState(loadCompanion(), {});'
BUDDY_FAKE_NOW=$(date +%s) bash statusline/buddy-status.sh <<< '{}'
```
**Expect:** sparkles (`*` marks) in the same row instead of drizzle — a
rough error count always wins over a simultaneous clean streak, so the
error delta must actually be reset first, same as above.

### d. Props/weather vanish while a scene is up
```bash
rm -f "$CLAUDE_CONFIG_DIR/buddy-state/pending-encounter.json"   # visitor never shows mid-fight
bun run server/award-xp.ts bug_sighted   # spawns a standoff (errors_seen is already >0 from step c)
BUDDY_FAKE_NOW=$(date +%s) bash statusline/buddy-status.sh <<< '{}'
```
**Expect:** the two-sprite bug-fight scene renders — no feet prop, no
pebble, no weather row above it. Props and weather ride **idle** frames
only; combat/pending/visitor scenes are a separate baked channel the shell
shows *instead of* idle, never alongside it (design.md's zero-rows
architecture note). The equipped trinket still shows on the combat pose
(gear is a different, always-on channel) — only the ambient props/weather
disappear.

**Cleanup:** `rm -rf "$CLAUDE_CONFIG_DIR"` when done — never run these
against your real profile.

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
