# Full-width falling weather — design + implementation plan (living-world follow-up)

_Drafted 2026-07-24 · branch `feature/interactive-fight-scene`_
_Status: **implemented (2026-07-26).** See
[CURRENT-STATE.md](../CURRENT-STATE.md#full-width-falling-weather-2026-07-26)
for the shipped snapshot (all 5 tasks, 1087 tests pass). Depended on
[plan-falling-weather.md](plan-falling-weather.md) (shipped, 1064 tests) and
[design-combat-weather.md](design-combat-weather.md) (shipped, 1068 tests),
both fully implemented. This doc extends the sky band they built rather than
re-deriving it._

**Goal:** the user watched a live bug fight (pasted render included below) and
observed that falling snow only ever appears in a narrow column above the
buddy/combat cluster on the right edge of the line — never over the large
blank area to its left, including the space above the DBG/PAT/CHA/WIS/SNK
stat bars. Their ask, verbatim: *"create a plan for making the snow/rain
effects take place for the entire width of the statusline. currently its only
over the buddy."*

```
   ⠀ sonnet 5[1m] · ctx 34% · usage 62% · reset 2h30m
   ⠀                                                                                      ❄
   ⠀
   ⠀ ■ DBG     ▣░░░░░░░░░  10                                                                          ❄
   ⠀ ◆ PAT     ▣▣▣░░░░░░░░░  31                                                         Bug fight in claude-buddy!
   ...
```

---

## 1. Recap — what exists today and why it's narrow

`server/weatherfall.ts`'s `buildFallingWeatherBand(kind, seed, width, rows,
period, theme)` bakes `SKY_BAND_ROWS=3` rows × `FALL_PERIOD=12` frames of a
small flipbook, `FLAKE_COUNT=4` flakes at seeded columns, with the weather
color's SGR **embedded literally into the string** around each flake glyph
(`weatherfall.ts:64-69`, `sgr()`+`RESET`). Width is either `SKY_FALL_WIDTH=14`
(idle) or the active combat scene's own `artWidth` (22-28,
`design-combat-weather.md` §2.1) — chosen in `server/state.ts:1580-1592`.
`statusline/buddy-status.sh` decodes it into `WF_LINES` (`:283-289`) and
**unshifts** it onto the front of `ALL_LINES`/`ALL_COLORS` (`:1084-1103`),
so it prints as the top `rows` lines of the **art column** — i.e., whatever
`art_part` occupies as the *rightmost* thing on those printed lines
(`:1224`, `line_out+="$art_part"`).

That's the entire reason it reads narrow: the band was designed to be
*part of the sprite's own column*, not the whole line. Everything to its
left on those same printed rows — the stats column's filler, and a large gap
between the stats column and the roaming cluster — is unrelated blank
padding the band never touches.

---

## 2. How a printed line is actually assembled (read in full, not guessed)

### 2.1 The per-line loop

`buddy-status.sh:1162-1226` builds each row `i` of the block as a **linear
string concatenation**, not a 2D grid:

```
line_out = SPACER
         + [STATS column (fixed STATS_W) + STATS_GAP_STR]   ← only if STATS_COUNT>0
         + MID_SPACER                                        ← only if STATS_COUNT>0
         + WANDER_PAD_BUBBLE (currently always "")
         + [bubble box or blank BOX_W filler]                ← only if BUBBLE_COUNT>0
         + WANDER_PAD_ART (currently always "")
         + art_part (rightmost, never padded further)
```

- `SPACER` (`:1044-1047`) = a Braille-Blank lead + `LEAD_PAD` spaces.
- `LEAD_PAD`/`MID_PAD` (`:1030-1036`): **when a stats panel is shown**,
  `LEAD_PAD = STATS_LEFT_MARGIN(1)` and `MID_PAD = ROAM`; **when it isn't**,
  `LEAD_PAD = ROAM` and `MID_PAD = 0`. Either way, `ROAM` cells of plain
  blank space sit **somewhere** between the stats column (or the left edge)
  and the roaming cluster — as `MID_SPACER` in the first case, as the tail of
  `SPACER` in the second. This is computed **once per tick**, not per row,
  and applied identically on every printed row (`:1048`,
  `printf -v MID_SPACER '%*s' "$MID_PAD" ''`) — so it is a genuinely blank,
  full-height rectangle that never carries stats/bubble/art content on *any*
  row, by construction.
- `art_part` (`:1163-1170`): the sprite/band line for this row, or
  `_ART_FILL` blank filler — always the line's last segment.

### 2.2 Cluster geometry (`buddy-status.sh:867-1028`, "free-roam layout")

```
STATS_GAP=2                     (:872)
STATS_LEFT_MARGIN=1             (:873)
RIGHT_SAFETY=$MARGIN            (:881, MARGIN defaults to config bubbleMargin=8, state.ts:459)
CONNECTOR_W=3                   (:885)
STATS_BLOCK = STATS_LEFT_MARGIN + STATS_W + STATS_GAP   (:887; STATS_W=26 base, :683)
CLUSTER_W = ART_W [+ BOX_W + CONNECTOR_W if a bubble is shown]  (:1006-1007)
SPAN = COLS - STATS_BLOCK - CLUSTER_W - RIGHT_SAFETY    (:1022, clamped ≥0)
ROAM = SPAN - WANDER_OFF, clamped to [0, SPAN]            (:1026-1028)
```

`ART_W` is 14 at idle, widened to `ART_WIDTH` (22-28) during combat
(`:662-668`) — so `SPAN`/`ROAM` **already account for the wider combat
tableau for free**; nothing here needs combat-specific handling (confirmed,
§6).

### 2.3 Precedent: the ground row's width-unknown-at-bake-time fix

The only other place in this codebase clips a server-baked string to a
width only known in bash is the living-ground row
(`buddy-status.sh:1228-1283`): it bakes a **repeating tile unit**
server-side, then bash fills `_GRND_W = COLS - RIGHT_SAFETY -
STATS_LEFT_MARGIN` (`:1241`) by repeating the tile and clipping —
`_grow="${_grow:0:_GRND_W}"` (`:1245`). Two things make this easy that
**don't hold for the sky band**:
1. It's a *repeating tile*, so "bake wide enough" is free — just repeat more.
   A falling-weather band is an *absolute-position animated flipbook*
   (`weatherfall.ts` §D4 of `plan-falling-weather.md`) — there's no way to
   "repeat" a flake's position, so the server must commit to a specific
   baked width up front.
2. It prints **once, after the entire per-line loop**, at full terminal
   width, never sharing a row with stats/bubble/art (`design-combat-weather.md`
   D2's own reasoning for why the ground row is lower-risk than the sky
   band). The sky band, by contrast, **must** stay inside the per-line loop
   — it's multi-row, animated, and needs to sit visually above the sprite,
   not below everything.

No other art-line width-clipping precedent exists in the shell (checked:
the only other `:0:` slices in the file are the stat-bar pip fills,
`:712,749`, unrelated).

### 2.4 A real, previously-undiscussed hazard: ANSI + bash substring slicing

`plan-falling-weather.md` D6 chose to **embed literal SGR** into the baked
band string (`weatherfall.ts:64-69,105-121`) specifically because the ART
band never needs bash-side width math — it's baked at an exact,
server-known width and printed whole. **That assumption breaks for anything
that needs a live `${str:0:N}` clip**: bash's substring operator counts
*characters*, not display cells, and an SGR escape sequence
(`\x1b[38;2;232;240;247m`) is ~20 plain characters that render as **zero**
columns. Slicing a band line that carries embedded escapes at a
column-budget `N` would (a) under-fill the visible width — most of the
budget gets eaten by invisible escape-sequence characters — and, worse,
(b) risk cutting off *mid-escape-sequence* on a boundary, which would leave
a dangling/malformed SGR that could bleed color into whatever prints next
on that line. This was never a problem for the ART band (baked-exact,
never sliced) and is a genuine, previously-unencountered risk specific to
this feature. §4 D3 resolves it.

---

## 3. Resolved decisions

| # | Question | Decision |
| --- | --- | --- |
| **D1** | Dedicated new full-width rows (ground-row style), or composite into blank space on existing rows? | **Neither purely — widen the ART band's *existing* dedicated rows into the already-guaranteed-blank gap segment identified in §2.1** (`MID_SPACER`/`SPACER`'s tail). This is not "new rows" (ground-row style) because a full-width flipbook can't be printed once-after-everything the way a static tile can (§2.3) — it must stay inside the per-line loop, above the sprite, exactly where the band already lives. It is also not "true 2D compositing into stats/bubble content" — the gap segment is proven (§2.1, by reading the concatenation order) to **never** carry stats/bubble/art content on *any* row, so there is nothing to collide with. Composing into the stats column's own text, or the bubble box, was evaluated and rejected: those segments' blank-vs-content state varies per row *and* per config (XP toast growing `STATS_W`, a reaction bubble appearing/disappearing) in ways that would need the shell to make new per-row content-awareness decisions it doesn't make today — real, and correctly the kind of risk this doc's brief asked to name honestly, not hand-wave past. It's deferred (§7), not solved. |
| **D2** | The COLS-unknown-at-bake-time problem for a multi-row *animated* effect (not a repeating tile)? | **Bake a second, independent flipbook at a generously large fixed width (`MAX_GAP_WIDTH`), left-anchored and clipped to the live `ROAM` value in bash — a direct generalization of the ground row's `_grow:0:_GRND_W` clip (§2.3) to a per-row, per-tick multi-line flipbook instead of one repeating string.** Bash only ever takes a substring of an already-fully-baked, already-decided string — no position/timing math happens in bash, so "server bakes, bash cycles" holds. §4 picks the actual constant from real measured `SPAN`/`ROAM` values. |
| **D3** | How does the new gap band survive bash substring clipping, given §2.4's ANSI hazard? | **The gap band bakes PLAIN, ANSI-free glyph+space grids — no embedded SGR — reusing `design-ground-weather.md`'s D5 mechanism (plain glyph + a shell-side `${var//glyph/${color}glyph${resume}}` recolor step) instead of the sky-band's own D6 (embedded SGR).** This is a deliberate divergence from the ART band's mechanism, justified specifically because the ART band never needs bash-side slicing and the gap band uniquely does. Clip **first** (while plain), recolor **after** — the exact ordering the ground row already proves safe in this codebase (`buddy-status.sh:1244-1245` clip, then `:1279` recolor) — sidesteps §2.4's hazard entirely rather than trying to make ANSI-aware slicing work. |
| **D4** | Flake density at the new, much wider gap canvas? | **Reuse the ART band's own established ratio, applied to the new width, so visible density degrades gracefully with actual room instead of needing a live recompute.** `FLAKE_DENSITY = FLAKE_COUNT(4) / SKY_FALL_WIDTH(14) ≈ 0.2857` flakes/column (the exact ratio `design-combat-weather.md` D4 already found "reads sparse," kept as the deliberate baseline, not re-tuned). `GAP_FLAKE_COUNT = round(MAX_GAP_WIDTH × FLAKE_DENSITY)`. Because gap-flake columns are drawn uniformly across the *full* baked width and bash always clips to `[0:ROAM]`, the **expected visible count already scales down proportionally with the actual live gap** (`GAP_FLAKE_COUNT × ROAM/MAX_GAP_WIDTH`) with zero extra shell-side density logic — a narrower real terminal naturally shows fewer visible flakes, a wider one shows more, for free. |
| **D5** | Injection point in the per-line loop? | **Two sites, mirroring §2.1's two-branch `LEAD_PAD`/`MID_PAD` split**: when `STATS_COUNT>0`, splice the clipped gap content into `MID_SPACER`'s value; when `STATS_COUNT==0`, splice it into `SPACER`'s `LEAD_PAD` tail (after the fixed Braille-Blank lead). Both only apply on **band rows** — the same `gi = i - ART_TOP` check already used to select `art_part` from `ALL_LINES`, bounded to `[0, rows)` for the new gap array. This is genuinely new per-row shell logic (unlike the existing band's one-time unshift outside the loop) — flagged honestly as the one real shell change here, same posture `plan-falling-weather.md` Task 3 took for its own (smaller) shell change. |
| **D6** | Row-height scope — extend past the 3 band rows down through the sprite's own row-span? | **No — stays at `SKY_BAND_ROWS=3`, matching the existing band exactly.** The user's complaint is about *horizontal* narrowness ("only over the buddy," a narrow column), not about needing coverage beside the sprite's own body rows specifically — the gap columns never overlap sprite cells regardless of row count, so extending row-height *would* be safe, but it's an unforced scope increase for a complaint that's already fully addressed by widening the existing 3 rows. Noted as a cheap, safe stretch in §7, deliberately deferred for minimality. |
| **D7** | Should gap flakes share the art band's exact positions, or be independent? | **Independent — distinct seed stream `sky-fall-gap:${seed}`, not `sky-fall:${seed}`.** Mirrors the established "distinct hash-prefix, independent draw off one seed" idiom (`ground.ts`/`props.ts`, cited in `plan-falling-weather.md` D7) so the two layers don't visually lock-step or reveal an obvious shared pattern. |
| **D8** | Does combat need its own handling? | **No — already covered for free, confirmed by tracing the actual arithmetic.** `CLUSTER_W`/`SPAN`/`ROAM` already substitute `ART_WIDTH` for `ART_W` during combat (`buddy-status.sh:662-668`, §2.2), and the gap band's gate mirrors the ART band's own gate, which `design-combat-weather.md` D1 **already relaxed** to show during combat (`buddy-status.sh:191-192` carries no `combat_on` clause). No new combat-specific width, gate, or row math is needed. |
| **D9** | Row-budget (`HOP_BUDGET`) interaction? | **None — this feature adds zero new rows.** It only widens content on rows the ART band already reserved and already budgeted (`plan-falling-weather.md` D9, `buddy-status.sh:1061-1103`, unmodified by this plan). If the ART band degrades away under the existing budget check, the gap band must degrade with it (same `WF_LINES` emptiness check governs both — see §4). |
| **D10** | New config toggle? | **No — piggyback the identical gate the ART band already uses** (`groundEnabled` + `isWeatherActive` + `gf=="full"` + no fresh celebration; combat no longer excluded per D8/design-combat-weather D1). Consistent with `plan-falling-weather.md` D11 and `design-ground-weather.md` D3's "no new toggle" posture throughout this whole arc. |
| **D11** | What happens when live `ROAM` exceeds the baked `MAX_GAP_WIDTH`? | **Left-anchor the clip (`${gap_line:0:ROAM}`, right-pad any shortfall with plain spaces)** — the stats-adjacent side of the gap (the part of the user's actual complaint) is always populated regardless of `COLS`; only the far/buddy-adjacent side of the gap can go unpopulated on exceptionally wide, minimal-chrome terminals, which is an accepted, harmless degrade (that side is already covered by the unchanged ART band anyway) rather than a bug — see §4 for the real measured range this needs to cover. |

---

## 4. Mechanism, with real measured numbers

### 4.1 Empirical `COLS`/`SPAN` measurements (not guessed)

Real measurement in this session's own dev terminal: `stty size` /
`tput cols` → **80 columns**. The script's own coded floor is `< 40`
(`buddy-status.sh:434,478,480`, triggering fallback probes) and its hard
final fallback is **125** (`:484`) when every detection method fails.
Working the cited constants from §2.2 through several realistic
configurations:

| `COLS` | Config | `CLUSTER_W` | `SPAN` (= max `ROAM`) |
| --- | --- | --- | --- |
| 80 (measured, this session) | idle, stats on, no bubble | 14 | **29** |
| 80 | idle, stats on, bubble *requested* | 49 → auto-dropped (§2.2 backstop, `:1014-1018`, since `80-29-49-8=-6<0`) | 29 (falls back to no-bubble) |
| 125 (script fallback) | idle, stats on, no bubble | 14 | **74** |
| 125 | idle, stats on, bubble kept | 49 | 39 |
| 125 | combat (`artWidth=28`), no bubble | 28 | 60 |
| 125 | combat (`artWidth=28`), bubble kept | 63 | 25 |
| 160 (plausible wide real terminal) | idle, stats on, no bubble | 14 | 109 |
| 200 (plausible ultrawide) | idle, stats on, no bubble | 14 | 149 |

**Resolved: `MAX_GAP_WIDTH = 110`.** It fully covers the fallback-default
(125) case in every configuration measured, and the realistic 80-160 col
range with a bubble present or a narrower combat tableau. Past that, D11's
clip-and-accept edge case applies — see §4.1.1 for where that boundary
*actually* falls, measured rather than estimated. The accept-the-degrade
posture there matches this arc's repeated "ambient decoration, not
simulation" stance (already invoked for D4 in `design-combat-weather.md`
and D9 in `plan-falling-weather.md`).

`GAP_FLAKE_COUNT = round(110 × 0.2857) = 31`.

### 4.1.1 Task 0 verification — measured against the live script (2026-07-27)

The table above was worked by hand from §2.2's cited constants. Task 0
re-derived it **from the running script instead**: a byte-identical copy of
`buddy-status.sh` with one `printf` inserted immediately after `ROAM` is
clamped (`:1059-1061`), driven across `COLS ∈ {40, 80, 100, 125, 160, 200}`
× {stats on, off} × {bubble requested, not} × {idle, combat `artWidth`
22/28} — 72 real renders, each against a fresh temp `CLAUDE_CONFIG_DIR`.

**Every stats-on row in §4.1's table reproduced exactly** — 80→29, 125→74,
125+bubble→39, 125+combat28→60, 125+combat28+bubble→25, 160→109, 200→149,
and the `COLS=80` bubble auto-drop backstop fired exactly as predicted
(`CLUSTER_W` 43, `SPAN` 0). The hand arithmetic was sound; `MAX_GAP_WIDTH=110`
and `GAP_FLAKE_COUNT=31` stand unchanged.

Two things the sweep corrected, neither of which changes the constant:

1. **The "~185" threshold estimate was wrong.** Binary-searching the live
   script for the first `COLS` where `ROAM > 110`: **`COLS=162`** with stats
   on / idle / no bubble (`ROAM=111`; at 161, `ROAM=110` exactly). The real
   safety margin above a 160-col terminal is therefore ~1 column, not ~25.
   Still adequate — it covers the entire 80-160 range this arc targets, and
   D11's degrade past it is harmless by construction (the stats-adjacent
   side, which is the user's actual complaint, stays populated at *any*
   `COLS`; only the buddy-adjacent far side goes bare, and the unchanged ART
   band already covers that side).
2. **§4.1's table only ever considered stats-on.** With the stats panel
   hidden, `STATS_BLOCK` drops from 29 to 0 and the gap widens by exactly
   that much: the same crossover lands at **`COLS=133`** (`ROAM=111`), and
   at `COLS=200`/stats-off/idle `ROAM` reaches **178**. This is the widest
   real configuration in the whole sweep. It is the same accepted D11
   degrade, just reached sooner than the doc implied — worth knowing before
   anyone reads "110 covers everything realistic" too literally.

Also confirmed incidentally: `WANDER_OFF` only ever *subtracts* from `ROAM`
(`:1059-1061`), so an ambling cluster can only ever make the clip narrower,
never overflow it — no additional headroom needed for the wander corridor.

### 4.2 `server/weatherfall.ts` additions

```ts
// Existing (unchanged): SKY_FALL_GLYPH, SKY_FALL_COLOR — currently module-
// private consts. Export them (no behavior change) so state.ts can read the
// active kind's plain glyph/hex for the new gap band's shell-side recolor
// (D3) — the same shape ground.ts already exports for its own weather glyph.
export const SKY_FALL_GLYPH: Record<GroundWeather, string> = { ... };
export const SKY_FALL_COLOR: Record<Theme, Record<GroundWeather, string>> = { ... };

export const FLAKE_DENSITY = FLAKE_COUNT / SKY_FALL_WIDTH; // D4, ≈0.2857
export const MAX_GAP_WIDTH = 110; // D2/§4.1
export const GAP_FLAKE_COUNT = Math.round(MAX_GAP_WIDTH * FLAKE_DENSITY); // 31

/**
 * Pure. Bakes `period` PLAIN (ANSI-free) gap-band frames — same shape as
 * buildFallingWeatherBand, but with no embedded SGR (D3: bash must be able
 * to `${line:0:N}` this safely at render time, which embedded escapes would
 * break). Distinct seed stream (`sky-fall-gap:`, D7) from the art band.
 */
export function buildFallingWeatherGapBand(
  kind: GroundWeather,
  seed: number,
  width: number,   // MAX_GAP_WIDTH
  rows: number,    // SKY_BAND_ROWS (reused, D6 — no new row constant)
  period: number,  // FALL_PERIOD (reused)
  flakeCount: number, // GAP_FLAKE_COUNT
): string[] {
  // Same grid-fill loop as buildFallingWeatherBand's internals, minus sgr()/RESET.
}
```

`buildFallingWeatherBand` itself is **untouched** — the ART band keeps its
exact current behavior, byte-identical, no regression risk to the shipped
feature.

### 4.3 `server/state.ts` — bake the gap band alongside the existing one

Extends the same block that already computes `weatherFallFrames`
(`state.ts:1575-1593`) — same `schedule`/`elapsedMs`/`theme`, no second
schedule read (mirrors `plan-falling-weather.md` D2's "one schedule" rule):

```ts
const { buildFallingWeatherGapBand, MAX_GAP_WIDTH, GAP_FLAKE_COUNT,
        SKY_FALL_GLYPH, SKY_FALL_COLOR } =
  require("./weatherfall.ts") as typeof import("./weatherfall.ts");
weatherFallGapFrames = buildFallingWeatherGapBand(
  schedule!.kind, startedAt, MAX_GAP_WIDTH, SKY_BAND_ROWS, FALL_PERIOD, GAP_FLAKE_COUNT,
);
weatherFallGapGlyph = SKY_FALL_GLYPH[schedule!.kind];
weatherFallGapColor = SKY_FALL_COLOR[theme][schedule!.kind];
// weatherFallSequence (already computed) is reused for BOTH arrays — same
// FALL_PERIOD, same NOW%len cadence; no second sequence field needed.
```

New `StatusState` fields (conditional spread, matching the
`groundWeatherGlyph`/`groundWeatherColor` "present iff active" contract):
`weatherFallGapFrames?: string[]`, `weatherFallGapGlyph?: string`,
`weatherFallGapColor?: string`.

### 4.4 `statusline/buddy-status.sh` — the one real shell change

**jq** (mirrors `:191-196` exactly, same gate, no new condition per D10):
```
| (if $gf == "full" and $celeb_fresh != 1
   then (.weatherFallGapFrames // []) else [] end) as $wfgap
| (if ($wfseq | length) > 0
   then ($wfgap[$wfseq[$now % ($wfseq | length)]] // "") else "" end) as $wfgapframe
```
plus `weatherFallGapGlyph`/`weatherFallGapColor` as two more plain sanitized
fields (same `gsub` pattern as `$gwglyph`/`$gwcolor`, `:178-179`) and
`($wfgapframe | @base64)` appended to the joined array alongside `$wfframe`.

**Decode** (mirrors `:283-289`): `WFGAP_LINES` array, base64-decoded,
`\n`-split — plain content, no ANSI, so no exemption from anything is
needed.

**Per-row injection** (new logic inside the `for (( i=0; i<MAX_LINES; i++ ))`
loop, D5):
```bash
_gap_content=""
if [ ${#WFGAP_LINES[@]} -gt 0 ]; then
    gi=$(( i - ART_TOP ))
    if [ $gi -ge 0 ] && [ $gi -lt ${#WFGAP_LINES[@]} ]; then
        _gap_content="${WFGAP_LINES[$gi]:0:$ROAM}"          # D2 clip
        _pad_short=$(( ROAM - ${#_gap_content} ))            # D11 shortfall
        [ $_pad_short -gt 0 ] && printf -v _gap_content '%s%*s' "$_gap_content" "$_pad_short" ''
        # D3: recolor AFTER clipping, plain-glyph substitution — mirrors the
        # ground row's exact clip-then-recolor order (:1244-1245, :1279).
        if [ -n "$WFGAP_GLYPH" ]; then
            _gap_content="${_gap_content//$WFGAP_GLYPH/${_WFGAP_SGR}$WFGAP_GLYPH${NC}}"
        fi
    fi
fi
```
then use `$_gap_content` in place of the plain-blank fill wherever
`MID_SPACER` (stats-on) or `SPACER`'s `LEAD_PAD` tail (stats-off) is
currently built (D5's two-branch split, §2.1).

**Row-budget interplay (D9):** no new check — the gap band shares the
*same* `WF_LINES` emptiness (i.e., if the existing degrade check at
`:1084-1103` empties `WF_LINES` under budget pressure, `WFGAP_LINES` must be
emptied alongside it, since a gap band with no matching art band above the
sprite would look disconnected). Concretely: gate the gap-band jq extraction
on the *same* `$wf`/`$wfseq` non-emptiness the ART band already computed,
not a second independent check.

---

## 5. What does *not* change

- `buildFallingWeatherBand` (the existing ART band) — **zero changes.**
  Different function, different width, different (embedded-SGR) mechanism,
  byte-identical output to today.
- `HOP_BUDGET`/`ART_COUNT`/the existing degrade check
  (`buddy-status.sh:1061-1103`) — **zero changes** (D9): no new rows.
- The living-ground row (`:1228-1283`) — **zero changes**, unrelated code
  path.
- `pickSessionWeather`/`isWeatherActive` (`ground.ts`) — **zero changes**
  (same schedule reused, D2 of `plan-falling-weather.md` still holds).
- The stats column's and bubble box's own render logic — **zero changes**
  (D1: the gap segment never touches their segments).

---

## 6. Task-by-task implementation plan

> For agentic workers: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. `- [ ]` checkboxes for tracking.

**Read first:** this doc in full; `server/weatherfall.ts` (already read for
this doc); `statusline/buddy-status.sh:867-1028` (cluster geometry) and
`:1073-1226` (existing band prepend + per-line loop) — the exact insertion
points Task 3 extends; `design-ground-weather.md` §"D5 mechanism" (the
plain-glyph recolor pattern Task 1/3 reuse).

### Task 0: Confirm `MAX_GAP_WIDTH` against the live script

- [x] Re-run this doc's §4.1 arithmetic against the *current* working tree
  (constants may have drifted) with a throwaway script or `BUDDY_FAKE_COLS`
  test-seam sweep (`buddy-status.sh:423-425`) across `COLS ∈
  {40, 80, 100, 125, 160, 200}`, both with and without a bubble, idle and
  combat `ART_W`. Confirm `MAX_GAP_WIDTH=110`/`GAP_FLAKE_COUNT=31` still
  cover the realistic range; adjust only if the sweep disagrees with §4.1.
  **Done 2026-07-27 — 72 live renders; §4.1's table reproduced exactly, both
  constants unchanged. See §4.1.1.**
- [x] Record the actual sweep output in the task report (not just the
  formula) — same "verify empirically" discipline `plan-falling-weather.md`
  Task 0 and `plan-ground-weather.md` Task 1 both required.
  **Recorded in §4.1.1**, including the two corrections the sweep forced
  (the "~185" threshold is really 162 stats-on / 133 stats-off).

### Task 1: `server/weatherfall.ts` — the gap-band core

**Files:** Modify `server/weatherfall.ts`, extend
`server/weatherfall.test.ts`.

- [x] Export `SKY_FALL_GLYPH`/`SKY_FALL_COLOR` (no behavior change).
  `weatherfall.ts:25,33`.
- [x] Add `FLAKE_DENSITY`, `MAX_GAP_WIDTH`, `GAP_FLAKE_COUNT` named
  constants (§4.1/D4). `weatherfall.ts:79,85,86`.
- [x] Failing tests, mirroring `weatherfall.test.ts`'s existing shapes:
  same-seed determinism; exactly `period` frames × `rows` lines × `width`
  display cells; **no embedded ANSI anywhere in the output** (D3 — this is
  the one contract that must differ from `buildFallingWeatherBand`'s own
  test, which asserts the *opposite*); distinct output from
  `buildFallingWeatherBand("snow", seed, ...)` at the same seed (D7,
  confirms the `sky-fall-gap:` prefix is actually distinct); every glyph
  used is single-display-cell/`MIRROR_SWAP`-safe (reuse the existing
  `ALL_SKY_FALL_GLYPHS` contract). All present in
  `weatherfall.test.ts`'s "full-width falling weather GAP band" block.
- [x] Implement `buildFallingWeatherGapBand` (§4.2 sketch — resolve any
  off-by-one during implementation; tests are the contract).
  `weatherfall.ts:175-203`.
- [x] `bun test server/weatherfall.test.ts` green (**19 pass, 0 fail**); full
  `bun test` (**1087 pass, 0 fail**) + `bunx tsc --noEmit` clean. (Task 2
  has since added the `state.ts` caller, so the "no caller yet" note no
  longer applies.)

**D4 density verified empirically (2026-07-27), with one precision
correction to the decision's wording.** A 200-seed sweep measuring flakes
actually drawn per clipped frame found the *simultaneously visible* count is
a consistent **0.494×** D4's stated `GAP_FLAKE_COUNT × ROAM/MAX_GAP_WIDTH`
formula (measured at `ROAM ∈ {29, 60, 74, 109, 110}`; the ratio held to
±0.006 across all five, so the **proportional-scaling claim itself is
exactly right** — only the constant factor was overstated). The gap is the
flakes' *duty cycle*: `cycleLen = rows + FALL_GAP_TICKS_MIN + rng()×
FALL_GAP_TICKS_RANGE` = 5-7 ticks, of which a flake is on-screen only while
`pos < rows`(3) — so ~half of `GAP_FLAKE_COUNT` is offscreen mid-respawn at
any tick. D4's formula therefore describes **baked** flakes in the clipped
region, not simultaneously-rendered ones.

This does **not** weaken D4, because the duty cycle applies identically to
the ART band, so it cancels in the comparison D4 actually cares about: a
300-seed parity measurement puts the gap band at **0.0464** visible
flakes/column/row against the ART band's **0.0484** — a ratio of **0.957**,
i.e. the widened band reads at ~96% of the shipped band's density, which is
what "reuse the ART band's own established ratio" was for. (The 4% shortfall
is just `GAP_FLAKE_COUNT`'s rounding: 31/110 = 0.2818 vs 4/14 = 0.2857.)

### Task 2: `server/state.ts` — bake the gap band

**Files:** Modify `server/state.ts`, extend `server/state_wander.test.ts`
(same `stubGroundWeather` idiom the sibling docs used).

- [ ] Failing tests: active window ⇒ `weatherFallGapFrames` present,
  `weatherFallGapGlyph`/`weatherFallGapColor` match the active kind/theme;
  inactive/`groundEnabled:false`/`subtle`/`off` ⇒ absent, byte-identical to
  today (regression pin — the existing `weatherFallFrames` tests must stay
  green unmodified).
- [ ] Implement per §4.3, reusing `schedule`/`elapsedMs`/`theme` already
  computed for the ART band — **no second schedule read.**
- [ ] Add the three new fields to `StatusState` + its doc-comments,
  matching the `groundWeatherGlyph`/`groundWeatherColor` "present iff
  active" style.
- [ ] Full `bun test` + `bunx tsc --noEmit` clean.

### Task 3: `statusline/buddy-status.sh` — the real shell change

**Files:** Modify `statusline/buddy-status.sh`, extend
`server/statusline_render.test.ts`.

- [x] **DECISION GATE, mirroring `plan-falling-weather.md` Task 3 Step 1's
  discipline exactly:** run a throwaway probe with a real baked gap-band
  frame, a real `WFGAP_GLYPH`/`WFGAP_COLOR`, and a real computed `ROAM`
  value, through the actual clip → recolor → concatenation path (§4.4).
  Confirm: (a) the clip lands on exactly `ROAM` display columns, no
  off-by-one against `MID_SPACER`'s current blank-fill width; (b) the
  post-clip recolor substitution doesn't corrupt the line or leak an
  un-reset escape into the next segment (`WANDER_PAD_BUBBLE`/bubble/art);
  (c) the two-branch injection (`MID_SPACER` vs. `SPACER`'s `LEAD_PAD` tail,
  D5) produces byte-identical total line length to today when
  `WFGAP_LINES` is empty (regression pin — this must be a true no-op when
  weather isn't active). State the actual probe output in the report.
  **Run 2026-07-27 against the real script — all three confirmed, output in
  §6.1 below.**
- [x] jq extraction (§4.4) + `_WFGAP_B64`/`WFGAP_GLYPH`/`WFGAP_COLOR` added
  to the single `IFS=$'\x1f' read`. `buddy-status.sh:256-257`.
- [x] Decode `WFGAP_LINES` (mirrors `WF_LINES`). `buddy-status.sh:316-321`.
- [x] Per-row injection (§4.4), gated so it's a no-op whenever
  `WF_LINES`/`WFGAP_LINES` are empty (D9's shared-emptiness rule).
  `buddy-status.sh:1252-1264` (clip+pad+recolor), injected at `:1277`
  (stats-off branch) and `:1289` (stats-on branch); D9's shared emptying at
  `:1155`.
- [x] Failing/passing tests per the probe's confirmed contract: gap flakes
  visible across the stats-adjacent portion of the line when weather is
  active + `COLS` wide enough to have a nonzero `ROAM`; **zero** gap output
  (byte-identical to today) when `ROAM=0` (narrow terminal) or weather
  fields absent; combat/celebration suppression matches the ART band's own
  (D8, D10 — same gate). **These did NOT exist before 2026-07-27** — only
  the fixture override fields had been added, with no test consuming them.
  Now an 11-test describe block in `statusline_render.test.ts`,
  mutation-verified (§6.1).
- [x] `bash -n statusline/buddy-status.sh` clean; targeted + full `bun test`
  green.

### 6.1 Task 3 decision-gate probe + mutation audit (2026-07-27)

**Decision gate**, driving the real `buddy-status.sh` with a real
`buildFallingWeatherGapBand` bake, temp `CLAUDE_CONFIG_DIR` per render:

- **(a) clip width** — no rendered line exceeded `COLS` at any tested width
  (`COLS ∈ {80, 125, 160}`, stats on and off). Distinct line widths were
  internally consistent per width (e.g. 116/118 at `COLS=125`).
- **(b) escape hygiene** — across all arms: **0** truncated/mid-escape
  sequences and **0** lines ending on an un-reset SGR. §2.4's dangling-escape
  hazard does not materialize; clip-then-recolor holds.
- **(c) no-op regression** — isolating the gap band (ART band present in
  *both* arms), at `COLS=40`/stats-on where `ROAM=0` the output is
  **byte-identical** with and without all three gap fields. Where `ROAM>0`
  the flake count rises with the available gap exactly as D4 predicts:
  `ROAM=18`→+2 flakes, `29`→+6, `74`→+8, `103`→+16.

**Mutation audit of the new tests** (each mutation applied to a working copy,
then reverted; the script was checksum-verified back to pristine after each):

| Mutation | First result | Fix |
| --- | --- | --- |
| Delete D11's right-pad (`_gap_short=0`) | **SURVIVED** — all tests green | The shortfall branch only fires when `ROAM > MAX_GAP_WIDTH`, and no test went past `COLS=160` (`ROAM=109`). Added a `COLS=200`/stats-off case (`ROAM=178`) asserting line widths match the ART-only baseline. Mutation now **caught**. |
| Delete the post-clip recolor | **SURVIVED** — all tests green | The recolor assertion was **vacuous**: the ART-band fixture embedded the *same* snow SGR the gap band gets, so `toContain` passed either way. Retinted the ART fixture rain-blue (`5f8fc7`) so the snow hex can only originate from the shell's own substitution. Mutation now **caught**. |
| Delete the `:0:$ROAM` clip | Caught (2 failures) | — |

Both surviving mutations were **real coverage holes in tests written the same
day**, not pre-existing implementation bugs — the shipped shell code was
correct throughout; the tests simply could not have told us so.

### Task 4: e2e + docs

> ## ⚠️ Same `CLAUDE_CONFIG_DIR` safety warning as every prior task in this
> arc — prefix the env var before the command word, verify a fresh
> `mktemp -d` is in effect before any write, never skip the check.

- [x] Manual e2e (temp `CLAUDE_CONFIG_DIR`): force `weatherFallGapFrames` +
  the existing `BUDDY_FORCE_WEATHER=snow|rain` override, render across
  several `BUDDY_FAKE_COLS` values (40, 80, 125, 200) with stats
  on/off and a bubble present/absent. Confirm: (a) flakes now visibly span
  from just past the stats column out to the roaming cluster, not just the
  narrow art strip; (b) no stats/bubble text is ever touched or discolored;
  (c) resizing (`BUDDY_FAKE_COLS` changing tick-to-tick) never produces a
  ragged/overlong line; (d) combat still shows it at the combat tableau's
  own (wider) `ART_W`, gap included; (e) a fresh celebration/flourish
  suppresses both bands together, matching D10.
  **Full 32-cell matrix run 2026-07-27 — results in §6.2.**
- [x] `bun test && bunx tsc --noEmit && bash -n statusline/buddy-status.sh`
  — full green, record the new total. **1100 pass / 0 fail** (up from 1087:
  +2 `state_wander` theme pins, +11 `statusline_render` gap-band tests),
  `tsc --noEmit` clean, `bash -n` clean.

### 6.2 Task 4 e2e matrix (2026-07-27)

32 combinations — `COLS ∈ {40, 80, 125, 200}` × stats on/off × bubble
present/absent × idle/combat(`artWidth=28`) — each rendered twice (gap band
present vs. absent) through the real script, each with its own fresh temp
`CLAUDE_CONFIG_DIR`.

- **(a) full-width spread — confirmed.** Flake column ranges widen exactly as
  the available gap does: `COLS=125`/stats-on spans columns **31..106**
  (against a 118-wide line), `COLS=200`/stats-on spans **31..181**, and with
  stats off the left edge moves to column **2** (`2..181` at `COLS=200`).
  Flake counts scale with room: 1 → 7 → 9 → 19 across the four widths at
  stats-on/idle, versus a constant **1** for the ART band alone. The
  narrow-strip complaint is genuinely resolved.
- **(b) stats/bubble text untouched — confirmed** in all 32 cells (all five
  stat labels and the reaction text intact and undiscolored).
- **(c) no ragged/overlong lines — confirmed for every width ≥ 50.** At
  `COLS=40` the render *does* overflow (lines of width 42-44), but this is
  **pre-existing and unrelated**: with weather disabled entirely, `COLS=40`
  already emits 6 lines of width 42, because a 26-wide stats panel plus the
  sprite plus `RIGHT_SAFETY` cannot fit in 40 columns at all — the script's
  own documented "only that absolute-narrow case clips" (`SPAN=0`,
  `buddy-status.sh:1055-1056`). The ART band (shipped earlier in this arc)
  adds the 44-wide rows. Critically, at `COLS=40` the gap band's output is
  **byte-identical** with and without all three fields, so it contributes
  nothing to the overflow. Verified, not assumed.
- **(d) combat — confirmed.** With `artWidth=28` the gap still renders,
  correctly narrowed by the wider cluster (`COLS=125`: `31..92` vs idle's
  `31..106`), exactly as D8 predicted the existing `CLUSTER_W`/`SPAN`
  arithmetic would handle for free.
- **(e) celebration suppression — confirmed.** A 1-second-old celebration
  yields **0** flakes at both `COLS=125` and `COLS=200`: both bands vanish
  together, matching D10's shared gate.
- [ ] `CURRENT-STATE.md` new dated section: what (snow/rain now spans the
  blank gap between the stats panel and the roaming cluster, not just the
  narrow art column), why (D1-D3's architecture reasoning, especially the
  ANSI-slicing hazard D3 caught), mechanism (a second, plain-ANSI-free,
  wider flipbook + a live bash clip, mirroring the ground row's own
  width-unknown-at-bake-time fix), honest tradeoffs (D6's row-height scope,
  D11's wide-terminal edge case).
- [ ] This doc's own header flips to "implemented" once shipped.

---

## 7. Deferred / explicitly out of scope

- **Compositing into the stats column's or bubble box's own blank filler
  rows** (D1). Real and tractable — bash already computes `STATS_START`/
  `STATS_COUNT` per tick, so it *could* determine which specific rows are
  genuinely blank filler and only inject there — but it's meaningfully more
  shell logic, touches segments this doc otherwise leaves fully alone
  (lowering regression risk to zero for the stats/bubble render path), and
  the user's actual complaint (a narrow *column*, not missing coverage
  beside specific rows) is already resolved without it. Worth a follow-up
  only if, after Task 4's e2e pass, the remaining stats-column-width strip
  of untouched space still reads as an obvious gap.
- **Extending gap-flake row-height past `SKY_BAND_ROWS=3`** (D6). Safe
  (columns never overlap sprite cells) but an unforced scope increase; a
  single-constant change (`rows` param to `buildFallingWeatherGapBand`) if
  ever wanted.
- **A live-resize-aware `MAX_GAP_WIDTH`** (i.e., deriving the bake width
  from something other than a fixed generous constant). Rejected — would
  require either a second server round-trip informed by a previous render's
  `COLS` (staleness risk, extra plumbing) or genuinely bending "server
  bakes, bash cycles" by pushing width knowledge server-side some other way;
  the fixed-constant-plus-clip approach (D2/D11) already covers the
  realistic range at zero extra complexity.
- **Wind/drift, accumulation, or a landing hand-off between the gap band and
  the ground row's specks.** Same out-of-scope items
  `plan-falling-weather.md` §5 already deferred; nothing about widening the
  band changes that calculus.
- **A combat-specific `MAX_GAP_WIDTH`.** Not warranted (§4.1's sweep already
  covers combat's own `ART_WIDTH` cases; D8 confirms the existing geometry
  math absorbs it for free).
