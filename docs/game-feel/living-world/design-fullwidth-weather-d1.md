# Full-width weather, part 2 — D1 compositing into blank filler segments

_Drafted 2026-07-27 · branch `feature/interactive-fight-scene`_
_Status: **design + implementation** (this doc is written ahead of the code,
per this arc's convention). Follows
[plan-fullwidth-weather.md](plan-fullwidth-weather.md) (shipped, 1100 tests),
whose **D1 deferred exactly this work** to §7._

**Why this exists.** The user reported, with a live paste, that snow is still
"isolated to two spots: to the right of the stats bars and directly over the
buddy." Diagnosed against their real state — **not a bug**. Measured at their
actual terminal (`COLS≈104`, `bubbleWidth 28`, `bubbleMargin 12`):

```
STATS_BLOCK 29 + CLUSTER_W 49 + RIGHT_SAFETY 12 = 90
SPAN = 104 - 90 = 14   →  minus WANDER_OFF  →  ROAM = 7-11
```

`WFGAP_ROWS=3` confirmed the gap band was decoded and rendering correctly —
into a **7-column strip**. Meanwhile the first band row measured **88 of 89
columns blank**. ~80 of those blank columns were off-limits *by design*:
plan-fullwidth-weather's D1 restricted painting to the "guaranteed-blank gap"
between the stats panel and the cluster, explicitly refusing to touch the
stats-column and bubble-box segments to keep their render paths at zero
regression risk.

That was the right call for shipping the first increment. It is also the
entire reason the effect reads as two isolated spots. This doc removes that
restriction.

---

## 1. What the previous increment established (unchanged, reused)

- `buildFallingWeatherGapBand` bakes a **plain, ANSI-free** flipbook
  (`weatherfall.ts`) at `MAX_GAP_WIDTH=110` × `SKY_BAND_ROWS=3` ×
  `FALL_PERIOD=12`, on the `sky-fall-gap:` seed stream.
- The shell decodes it to `WFGAP_LINES` and **clips first, recolors after**
  (D3) — mandatory, because `${str:0:N}` counts characters and would corrupt
  embedded SGR.
- The ART band (`weatherFallFrames`, embedded-SGR, sprite-column width) is a
  separate layer and stays **completely untouched**.

**No server change is needed for this increment.** The baked payload already
contains everything required; all the new work is in `buddy-status.sh`. That
is a deliberate goal, not a coincidence — see D4.

## 2. How a band row is actually assembled

From the per-line loop (`buddy-status.sh`, verified by reading it, and by
column-mapping a real render):

```
line_out = SPACER_LEAD + LEAD_PAD
         + [stat line  | _STATS_FILL ]  (STATS_W)     ← blank on filler rows
         + STATS_GAP_STR                (STATS_GAP=2)
         + _gap_row                     (ROAM)        ← the only painted part today
         + WANDER_PAD_BUBBLE            ("")
         + [bubble line | blank filler] (BOX_W)       ← blank on filler rows
         + WANDER_PAD_ART               ("")
         + art_part                                   ← ART band lives here
```

The two segments marked "blank on filler rows" are the ~80 columns being
wasted. Whether they are blank varies **per row** (`si = i - STATS_START`,
`bi = i - BUBBLE_START`) — which is exactly the per-row content-awareness D1
declined to add. The shell already computes both indices, so the information
is present; only the decision to use it is new.

## 3. Decisions

| # | Question | Decision |
| --- | --- | --- |
| **E1** | How do the separate segments avoid looking like disjoint patches? | **Treat the baked frame as one continuous weather field spanning the whole line, and give each blank segment its own *absolute-column window* into it.** A flake's column is decided once, in line coordinates; each segment simply reveals the part of the field it covers. Painting each segment from column 0 of the bake would repeat the same few flakes 3× at different offsets — visibly wrong, and the main reason this is a field-slicing problem rather than a "call the existing gap code 3 times" problem. |
| **E2** | The bake is 110 wide; a line can be 200. | **Tile the baked row to `COLS` before slicing**, exactly as the ground row already tiles its unit (`_grow`, `:0:_GRND_W`). Costs nothing, needs no new bake width, and keeps `status.json` byte-identical. Rejected: widening `MAX_GAP_WIDTH` to ~200 (would roughly double `status.json`, which is re-parsed by jq every second). The period-110 repeat is invisible in practice at this flake density. |
| **E3** | Which segments get painted? | **The stats column and the bubble box, each only on rows where it carries no content**, plus the existing gap. Deliberately NOT the 2-column `STATS_GAP_STR` (not worth a third splice) and NOT `art_part` (the ART band owns that column and has its own embedded-SGR mechanism). |
| **E4** | Row scope? | **Unchanged at `SKY_BAND_ROWS=3`** (plan-fullwidth-weather D6). The complaint is horizontal, and widening to more rows would start colliding with rows that carry real content far more often. |
| **E5** | Does this change the D3 clip-then-recolor rule? | **No — it makes it more load-bearing.** Every segment is sliced while plain, then recolored. Recoloring before slicing would now risk cutting escapes in three places instead of one. |
| **E6** | Regression posture for the stats/bubble render paths? | **A painted segment must be exactly as wide as the blank it replaces** (`STATS_W`, `BOX_W`) — pad any shortfall — so total line width is provably unchanged. With no active weather the code path must be byte-identical to today. Both are pinned by tests, and the tests are mutation-verified (the previous increment shipped two assertions that passed against a deleted implementation). |
| **E7** | `STATS_W` is not constant (an XP toast widens it). | **Derive every offset from the live values at render time**, never from a baked constant, so a widened stats panel shifts the field correctly. |

## 4. Mechanism

Once per band row, build the line-wide field and the segment offsets:

```bash
_wx_full="${WFGAP_LINES[$gi]}"
while [ ${#_wx_full} -lt "$COLS" ]; do _wx_full+="${WFGAP_LINES[$gi]}"; done   # E2 tile
# absolute column of each segment, accumulated in the loop's own order
_wx_stats_off=$(( ${#SPACER_LEAD} + LEAD_PAD ))
_wx_gap_off=$(( _wx_stats_off + STATS_W + STATS_GAP ))   # stats shown
_wx_bub_off=$(( _wx_gap_off + ROAM ))
```

then slice → pad-to-exact-width → recolor, per blank segment:

```bash
seg="${_wx_full:$off:$w}"
[ ${#seg} -lt "$w" ] && printf -v seg '%s%*s' "$seg" $(( w - ${#seg} )) ''
seg="${seg//$WFGAP_GLYPH/${_WFGAP_SGR}$WFGAP_GLYPH${NC}}"                     # D3 order
```

When `STATS_COUNT==0` the gap is the lead pad itself, so `_wx_gap_off`
collapses to `${#SPACER_LEAD}` and there is no stats segment — the same
two-branch split plan-fullwidth-weather's D5 already introduced.

## 5. What does not change

- `weatherfall.ts`, `state.ts`, `status.json`'s shape — **zero changes** (E2).
- The ART band — zero changes.
- The ground row — zero changes.
- Any row that carries real stats/bubble content — never touched (E3/E6).
- Total printed line width, in every configuration — invariant (E6).

## 6. Tasks

### Task 1: shell compositing
- [x] Tile the baked row to `COLS`; compute the three absolute offsets from
  live values (E1/E2/E7).
- [x] Paint the stats segment on its filler rows; paint the bubble segment on
  its filler rows; keep the existing gap painting, now field-aligned.
- [x] `bash -n` clean.

### Task 2: tests
- [x] Flakes appear in the stats-column and bubble-box regions on band rows.
- [x] Rows carrying real stats/bubble content are unchanged.
- [x] Total line widths identical to the no-weather baseline, every width.
- [x] No weather fields ⇒ byte-identical output (the true no-op invariant).
- [x] Escape hygiene across all three segments.
- [x] **Mutation-verify** each new assertion actually fails when its
  implementation is deleted.

### Task 3: verify at the reporting user's real configuration
- [x] Reproduce `COLS=104`, `bubbleWidth 28`, `bubbleMargin 12` and measure
  the painted-column count before vs. after.

## 7. Results (2026-07-27)

Measured against the reporting user's **actual `status.json` + `config.json`**
(copied into a sandbox; their profile never written to):

| | before | after |
| --- | --- | --- |
| flake span on band rows | a 7-column strip + the sprite column | **columns 9-80** |
| band rows carrying flakes | 1 of 3 | **3 of 3** |
| line widths vs. no-gap baseline | identical | **identical** (verified at `COLS` 80/104/125/200 on the same state) |

**Tests: 1108 pass, 0 fail** (1100 → +8), `tsc --noEmit` and `bash -n` clean.
No server change: `weatherfall.ts`, `state.ts` and `status.json`'s shape are
byte-identical to the previous increment (E2's goal).

**Mutation audit** (each applied, tested, reverted; script checksum-verified
back to pristine):

| Mutation | First result | Resolution |
| --- | --- | --- |
| Never paint the stats segment | caught | — |
| Drop the E2 tiling loop | caught | — |
| Never paint the bubble segment | **survived** | The broad "edge to edge" assertion was satisfied by the stats segment alone. Added a test that locates the bubble by its border row and requires a flake inside that column span. Now caught. |
| Drop the E6 short-slice pad | **survived, and still does** | Investigated rather than papered over: the pad is genuinely **unreachable**. E2 tiles the field to ≥ `COLS`, and the script's dynamic bubble fitting plus its drop backstop keep every painted segment ending within `COLS`. A sweep of 72 real configurations (`COLS` 40-80 × stats on/off × `bubbleWidth` 8-20, bubble present) found **zero** renders where removing it changes a byte. Kept as a guard against future geometry changes and documented as defensive dead code in the test file — not left as a silent surviving mutant. |

**Known limits, honestly.** The 3-column connector between bubble and sprite
stays plain (E3), as does the 2-column stats gap — so on a band row the
painted field has two narrow plain seams. The `art_part` column is still the
ART band's own territory with its own embedded-SGR mechanism, so the far
right of a band row is denser than the rest. Neither was worth a further
splice for this increment.
