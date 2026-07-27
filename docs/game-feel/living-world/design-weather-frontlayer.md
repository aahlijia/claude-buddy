# Falling weather, part 3 — front layer, no reserved sky

_Drafted 2026-07-27 · branch `feature/interactive-fight-scene`_
_Status: **shipped** (design written ahead of the code, per this arc's convention).
Follows [design-fullwidth-weather-d1.md](design-fullwidth-weather-d1.md)._

**Why this exists.** Two requests, which turn out to be one change:

1. _"There were some additional lines added to the statusline. Can we condense
   the statusline a bit and remove ~3 lines."_
2. _"As rain/snow falls, it can overlap with the chat bubble. Imagine the chat
   bubble is in the back layer, and the snowflake takes the front layer."_

The "~3 additional lines" **are** the falling-weather feature: the ART sky band
prepends `SKY_BAND_ROWS = 3` blank-but-for-flakes rows above the sprite. Those
rows exist for exactly one reason — to give flakes somewhere to fall that isn't
already occupied. Request 2 removes that reason. If weather can fall *in front
of* content, it no longer needs reserved empty sky.

So this doc does both at once: **delete the reserved sky rows, and make the
weather a front layer over the whole block.**

---

## 1. Measured starting point

Rendered from the reporting user's real `status.json` + `config.json` in a
sandbox (`COLS=106`, `STATS_W=26`, `BOX_W=32`, `ART_W=28`, `ROAM=2`):

```
 1 |⠀                          ❄             ❄                     |  ← sky band
 2 |⠀      ❄                          ❄ ❄            ❄             |  ← sky band
 3 |⠀ ■ DBG  ▣░░░░░░░░░  10   ❄            ❄                       |  ← sky band + stats
 4 |⠀ ◆ PAT  ▣▣▣░░░░░░░  34   .----------------.   Bug fight in …  |
 …
11 |⠀                                     Waffle [L11]             |
12 |⠀ +▂▂+▂+▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂+▂▂▂▂▂▂▂▂▂+▂+▂▂+▂+▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂|  ← ground
```

`ART_COUNT = 11` (3 band + 8 real), `HOP_RESERVE = 0`, so the block is 11 rows.
Rows 4-11 — the majority of the widget — carry no weather at all.

Note `ROAM = 2`. The "guaranteed-blank gap" that the previous two increments
were built around is **two columns wide** at this terminal. Everything visible
above is already coming from D1's blank-filler compositing, not the gap. That
is further evidence the gap-shaped framing has run its course.

## 2. Decisions

| # | Question | Decision |
| --- | --- | --- |
| **F1** | Where do the 3 lines come from? | **Retire the ART band's row prepend.** It is exactly `SKY_BAND_ROWS = 3` rows and it is the only thing in the widget whose row cost was added by this arc. Measured effect: block 11 rows → 8. No other row is touched — nothing else in the block is padding. |
| **F2** | What replaces it? | **The gap band becomes a full-block field.** It is already a plain, line-wide, tiled weather field (D1/E1); the only thing keeping it in the top 3 rows was the ART band's row span. Field row = block row `i`, directly — the `i - ART_TOP` offset existed only because the band lived inside the art stack. |
| **F3** | What does "front layer" mean precisely? | **A flake may replace a SPACE, and nothing else.** Never a border, a letter, a bar segment, a sprite glyph. This makes the composite **width-preserving by construction** — one width-1 space out, one width-1 glyph in (both `❄` and `` ` `` were already verified single-cell) — so no layout invariant can move. |
| **F4** | Which layers get the front-layer treatment? | **The bubble box** (the explicit ask) and **the sprite/art column** (which would otherwise lose all weather when the ART band goes), plus the gap and the blank-filler segments D1 already paints. **Not** the stats column's content rows — see F5. |
| **F5** | Why exempt the stats rows? | Two reasons, and the weaker one is not the reason. (a) **Legibility**: the stat bars are the one part of the widget that is read as data rather than looked at as scenery; dropping flakes into `▣░░░░░░░░░` gutters degrades a readout to decorate a background. (b) `STATS_LINES` are pre-colored strings with embedded SGR, so splicing into them needs an ANSI-aware walk rather than the plain-string splice everything else allows. (a) is the decision; (b) is why it is also the cheap one. Blank stats rows keep D1's painting, so the column is not a hard-edged hole. |
| **F6** | How tall is the baked field, and how dense? | **14 rows** (comfortably over `HOP_BUDGET = 12`), with the flake count scaled so **visible flakes per row is unchanged** from the shipped 3-row band. A flake is drawn only while `pos < rows`, so the duty cycle is `rows / cycleLen` and visible-per-row works out to `flakeCount / cycleLen` — independent of `rows`. Preserving the look therefore means scaling the count by `(rows + meanGap)`, not by `rows`. |
| **F7** | Isn't a 14-row bake much bigger? | Yes — `status.json` 10.0 KB → 22-25 KB — and **measured, it costs nothing**: 10-render averages of 54 / 53 / 52 ms at 3 / 12 / 14 rows. Tick time here is dominated by process startup, not by how much JSON jq walks. Sparse encoding was considered and rejected on this evidence: it would have bought ~20 KB and cost a new payload format plus a new decoder, for no measurable gain. |
| **F8** | Escape-splicing safety (the D3 hazard, again) | **The overlay refuses to touch any string containing ESC** and returns it unchanged. Every intended target (`ALL_LINES`, `BUBBLE_LINES`) was verified plain by probe; the guard means a future change that colors one of them degrades to "no flakes there" instead of corrupting a sequence. |
| **F9** | What happens to the ART band code? | **Deleted, not orphaned.** `buildFallingWeatherBand`, `SKY_FALL_WIDTH`, `SKY_BAND_ROWS`, `FLAKE_COUNT`, the `weatherFallFrames` payload field and the shell's `WF_LINES` all go. `weatherFallSequence` **stays** — it cycles the field. Leaving a baked-but-unread layer in `status.json` would be dead weight re-parsed every second. |
| **F10** | The band's height-budget degrade branch | **Deleted with it.** It existed because the band consumed rows against `HOP_BUDGET`. A front layer consumes none, so there is nothing left to degrade — weather can no longer push the widget over its ceiling. |

## 3. Mechanism

Per block row, build the tiled line-wide field once (unchanged from E1/E2),
then for each target segment:

```bash
_wx_overlay "$plain_underlying" "$absolute_start_col" "$restore_sgr"
```

which walks only the **flake columns** in that segment's window — not every
character — and rebuilds the string from plain runs:

```
out += under[last .. c-1] + NC + WX_SGR + glyph + NC + restore   (if under[c] == ' ')
```

`restore` is the caller's own active color (`${C}` for a bubble border, `${DIM}`
for bubble text, `${ALL_COLORS[$ai]}` for an art row), so the flake is punched
through the segment's coloring without disturbing what follows it.

Flakes are sparse (~5 per 110 columns), so this is ~2-3 iterations per segment,
not a per-character scan.

## 4. What does not change

- The ground row and its own ground-weather — untouched.
- The weather **schedule** — no reroll, same window, same kind, same seed
  stream (`sky-fall-gap:`).
- The stats column's content rows (F5).
- Total printed line width, in every configuration (F3 makes this structural
  rather than something tests have to police).
- `buildFallingWeatherGapBand`'s signature — it already takes `rows` and
  `flakeCount` as parameters.

## 5. Tasks

### Task 1: server
- [x] `weatherfall.ts`: drop the ART band; add `SKY_FALL_ROWS` and a
  density-preserving `gapFlakeCount(rows)`.
- [x] `state.ts`: stop baking `weatherFallFrames`; bake the field at the new
  height; keep `weatherFallSequence`.

### Task 2: shell
- [x] Remove `WF_LINES`, the prepend, and the `HOP_BUDGET` weather degrade;
  move the jq gate off `$wf`.
- [x] Field row = `i`; add `_wx_overlay`; apply to bubble + art.

### Task 3: tests
- [x] Block is exactly 3 rows shorter with weather active.
- [x] Flakes land inside the bubble box and on sprite rows.
- [x] No content character is ever replaced; line widths unchanged.
- [x] Stats content rows stay flake-free (F5 is pinned, not incidental).
- [x] Weather off ⇒ byte-identical to the plain baseline.
- [x] **Mutation-verify** every new assertion.

### Task 4: verify on the reporting user's real state
- [x] Before/after row count and flake coverage at their actual geometry.

## 6. Results (2026-07-27)

Measured against the reporting user's **actual `status.json` + `config.json`**
(copied into a sandbox; their profile never written to), at their real
`COLS=104` geometry:

| | before | after |
| --- | --- | --- |
| lines in the widget block | 11 | **8** (−3, request 1) |
| rows carrying weather | 3 (reserved sky) | **all 8** |
| flakes in front of the bubble | none — it sat below the band | **yes** (request 2) |
| flakes over the sprite | only in the 3 rows above it | **on the sprite's own rows** |
| line widths vs. the unweathered render | identical | **identical** (verified at `COLS` 40/60/80/104/125/160/200) |
| tick time | 49 ms bare | **50 ms** with weather |
| `status.json` | 10.0 KB | 23.0 KB (no measurable cost, F7) |

```
1 |⠀            ❄                                    ❄       Bug fight in claude-buddy!|
2 |⠀ ■ DBG     ▣░░░░░░░░░  10                    ❄                                     |
3 |⠀ ◆ PAT     ▣▣▣░░░░░░░  34    .------------------.    ❄ \^^^/                     ❄ |
4 |⠀ ▶ CHA     ▣▣░░░░░░░░  28    | did you hear …   |--  n  ____  n     ❄ .--.       × |
5 |⠀ ● WIS     ▣░░░░░░░░░  12 ▼  | mind.            |    | |×❄ ×| |/      ( @ )      /❄|
6 |⠀ ◀ SNK     ▣▣▣▣▣▣▣░░░  76 ▲  `------------------'    |_|    |_|        '--`_/      |
7 |⠀ Lv11      ▣▣▣░░░░░░░  38%       ❄       ❄       ❄     |    |   ❄      ~~~~~~~     |
8 |⠀                        ❄                     ❄  ❄       ❄   Waffle [L11]          |
```

**Tests: 1107 pass, 0 fail**, `tsc --noEmit` and `bash -n` clean.

### Mutation audit

Every new assertion was verified load-bearing by deleting the implementation
it claims to cover (each applied, tested, reverted; both files checksum-verified
back to pristine afterwards).

| Mutation | Result |
| --- | --- |
| `_wx_overlay` never paints | caught (4) |
| Drop the space-only guard, so flakes overwrite content | caught (4) |
| Bubble text row not overlaid | caught (1) |
| Art/sprite row not overlaid | caught (3) |
| `gapFlakeCount` scales linearly with rows | caught (2) |
| `SKY_FALL_ROWS` back to 3 | caught (2) |
| Weather re-reserves 3 sky rows | caught (5) |
| **Field row reverts to the `i - ART_TOP` mapping** | **SURVIVED → fixed** |

The survivor was worth the exercise. `i - ART_TOP` is invisible until the hop
headroom makes `ART_TOP` non-zero, at which point the top rows silently stop
snowing and the whole field slides down — a bug no existing test could see
because none of them combined hop with a field whose flakes had a known row.
Added one that does (all flakes on row 0, hop reserved, assert the first
printed line is the one that carries them); re-ran the mutation, now caught.

### Known effects, honestly

- **Flakes land in the gaps between words** in a bubble comment, e.g.
  `did you hear❄that?`. That is the literal consequence of F3 and it is not an
  accident, but it is the one place a reader might prefer the weather to yield.
  Narrowing the rule to "only spaces with a space neighbour" would confine
  flakes to the box's padding; it was not done because it makes the effect
  inconsistent for no stated benefit. Easy to add if it grates.
- **The stats column stays clear on its content rows** (F5), so on a
  stats-heavy render the left ~26 columns snow only on the rows without a bar.
- Flakes can land immediately beside a sprite glyph (`n❄ ____`), which reads
  as the buddy standing in the weather — intended.
- The 3-column bubble→sprite connector and the 2-column stats gap remain plain
  (inherited from D1's E3), so a fully-painted row has two narrow seams.

---

## 7. Hardening pass (2026-07-27, post-ship analysis)

A focused performance + correctness review of the shipped front layer. **The
performance story held up under independent re-measurement** — 40 renders per
variant, median: weather off 37.2 ms, shipped 39.0 ms, and a single-frame
2.3 KB payload also 39.0 ms. F7's central claim is confirmed from the other
direction: the 21 KB payload and the 2.3 KB payload tick *identically*, so jq
walking the full array is genuinely free and rejecting sparse encoding was
right. The ~1.8 ms delta is the shell compositing, not the payload. Server-side
the taller bake costs 0.085 → 0.146 ms/call. No performance changes were made.

Four defects were found at the layer's **edges**, all invisible on the happy
path. Each fix is mutation-verified (revert it, watch the suite go red).

| # | Defect | Severity | Fix |
| --- | --- | --- | --- |
| **H1** | **The field stopped dead below row 14.** `SKY_FALL_ROWS = 14` was chosen to clear `HOP_BUDGET = 12` — but `HOP_BUDGET` bounds only the ART stack. `MAX_LINES` also takes `TOTAL_BUBBLE`, and the bubble word-wrap has **no row cap**. `/buddy width 10` (a supported 10-60 setting) plus a long reaction measured a **17-row block whose bottom 3 rows carried no weather at all** — not a fade, a hard horizontal line with snow above and none below. | medium — reachable through supported config | Field row now **wraps** (`gi = i % rows`), exactly as E2 already tiles the same field horizontally. Removes the cliff at *every* height rather than moving it to the next constant; no payload growth, no re-tuning of F6's density arithmetic. |
| **H2** | **`_wx_slice`'s replacement pattern was unquoted**, so the glyph was a **glob**. A `*` glyph matched the whole segment and collapsed it — measured **116 display cells → 47**. | low (needs a malformed payload) but it is the hole in F3 | Quote the search half. `_wx_overlay` already quoted both of its own uses. |
| **H3** | **A multi-character glyph broke width**, swapping a 1-cell space for an N-cell glyph in the overlay. | low, same reachability | Refuse any glyph that is not exactly one character; both helpers then no-op and the render degrades to "no flakes" rather than to a broken layout. |
| **H4** | **A fresh celebration suppressed falling weather but not ground weather**, so for the whole flourish window the ground was visibly snowing while nothing fell above it. | low, cosmetic | Gate dropped. Its justification was that the old ART band *prepended rows* which fought the taller flourish flipbook for the same height budget — the identical reason F10 deleted the `HOP_BUDGET` degrade. A front layer costs no rows, so the reason died with F1. |

### F3, restated honestly

F3 claims the composite is width-preserving **by construction**. H2 and H3 show
the construction had two unstated preconditions: the glyph must be *glob-inert*
and *exactly one display cell*. The first is now enforced by quoting, the second
by a length check. A single-but-**double-width** glyph (CJK) remains
unenforceable — bash cannot measure display width without a fork — and stays a
server-side contract: `state.ts` only ever emits `SKY_FALL_GLYPH`, both members
verified single-cell. That precondition is now written down rather than assumed.

### Checked and found correct

- **Wide characters in content** (emoji, CJK in a bubble comment) make
  `_wx_overlay`'s character indices drift from display columns — but width is
  **preserved in every case measured**, because only spaces are ever replaced
  and a space is always 1 char = 1 cell. The drift is invisible misregistration
  against a field of noise. F3's structural argument holds.
- **The field is anchored to the screen, not the buddy.** `_wx_bub_off` tracks
  the bubble's true column via `ROAM`, and the field row is the block row, so
  the buddy roams and hops *through* stationary weather. This is the invariant
  the M7 mutation was protecting.
- A degenerate 1-char baked row does not spin the tiling loop.

### Mutation audit

| Mutation | Result |
| --- | --- |
| Vertical wrap reverted to `gi=$i` | caught (1) |
| `//` pattern unquoted again | caught (1) |
| Single-char glyph guard removed | caught (1) |
| Celebration gate restored | caught (3) |

**Tests: 1112 pass, 0 fail** (+5), `tsc --noEmit` and `bash -n` clean.
