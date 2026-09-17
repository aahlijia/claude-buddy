# Living-World Arc — Independent Code Analysis

_Analysis performed 2026-07-31 against `feature/living-world` @ `70194a6`.
Read-only: no product code was modified to produce this report. Two mutation
tests were run directly against `statusline/buddy-status.sh` during this
audit; both mutations were reverted via `git checkout --` and the restore was
verified with `shasum -a 256` (`bf4a89e0...` before and after). `git status`
and `git diff` are empty at the end of this analysis, as required._

_Authored by a dispatched Fable 5 agent via `/sc:analyze`; findings 1-3 and
the doc-staleness claims were independently re-verified against the real
source files by the orchestrating session before this file was saved (see
[§9](#9-orchestrator-re-verification))._

## Executive summary

**Overall verdict: solid.** The implementation matches its own design docs to
an unusually high degree — the code itself is disciplined, heavily
self-documented with rationale (not just what, but why), and the "server
bakes, bash cycles" split is held consistently through several rounds of
architectural revision (band → gap-band → front-layer). The project's own
prior hardening passes (H1–H4 in `design-weather-frontlayer.md`) were
independently re-verified here and found genuine — I reproduced one of them
(H2, the glob-quoting bug) as a live mutation against the actual shell script
and watched the real test suite catch it.

That said, this analysis found two things worth fixing:

1. **One live, unfixed security/robustness bug**, of the exact class the
   project's own hardening pass (H2) already fixed once — but in a sibling
   code path the hardening pass didn't touch. The ground-row weather-glyph
   substitution (`buddy-status.sh:1510`) uses an **unquoted** glob pattern,
   identical to the bug H2 fixed in the front-layer's `_wx_slice`
   (`buddy-status.sh:1101`, now correctly quoted). I reproduced the collapse
   live: a `groundWeatherGlyph` of `*` shrinks a ~74-cell tiled ground row
   down to 3 display cells. Not exploitable today (the only two glyphs
   `ground.ts` ever emits are `+`/`:`, neither a glob metacharacter), but it's
   the same latent fragility a prior independent audit
   (`analysis-ground-weather.md`, "Quality/maintainability observations" #1)
   flagged **and recommended a fix for**, and the fix was never made.

2. **One confirmed-still-vacuous test**, also previously flagged by that same
   prior audit and also never fixed: `statusline_render.test.ts:1708-1724`
   compares two renders built from **byte-identical override objects** and
   asserts they're equal — true by construction regardless of whether the
   feature it claims to test exists at all. I mutation-verified this: with
   the ground-weather recolor code fully disabled, this test still passes,
   while the neighboring, properly-written test (`:1672-1690`) correctly
   fails. Notably, the falling-weather test block added later
   (`:1858-1867`) explicitly cites "a prior audit on the sibling
   ground-weather feature" catching this exact mistake and deliberately
   avoids repeating it — but the original instance the citation refers to was
   never itself corrected.

Everything else checked out: the seed-stream discipline is real and
independently verifiable (distinct hash prefixes throughout), the space-only
compositing invariant holds under inspection and under a targeted mutation
test, the config-gating is *consistent* even where it is surprising, and the
performance story is architecturally sound (no new forks were introduced in
the hot per-row loop — verified by grepping for command substitutions inside
it). Several of the arc's design docs are meaningfully stale relative to
shipped code, which the task brief anticipated; specifics below.

**Baseline, independently reproduced:** `bun test` → 1112 pass, 0 fail (34
files, 42136 `expect()` calls); `bunx tsc --noEmit` → clean; `bash -n
statusline/buddy-status.sh` → clean (exit 0). Matches the number the
`design-weather-frontlayer.md` hardening-pass section itself claims.

---

## 1. Architecture

### 1.1 Server-bakes / bash-cycles split

Held consistently. Every weather primitive — the ground terrain
(`pickSessionGround`), the ground-weather schedule (`pickSessionWeather`),
the woven ground tile (`buildWeatherTile`), and the falling-weather field
(`buildFallingWeatherGapBand`) — lives in pure TypeScript modules
(`server/ground.ts`, `server/weatherfall.ts`) that take an injected seed and
never touch the clock or disk. `statusline/buddy-status.sh` never rolls
anything; it slices, tiles, and recolors strings the server already decided
(confirmed by grep: the only three `${var//pattern/repl}` substitutions in
the whole 1516-line script are the ground-weather recolor, the front-layer
overlay, and one unrelated cosmetic `BORDER=${BORDER// /-}` — see §5.1).

The one genuinely impure read, `Date.now()` at the `writeStatusState` write
site (`state.ts:1573`), mirrors the codebase's own established idiom
(`pickDayProp(new Date(), ...)`), and is the *only* place wall-clock time
enters the picture. This was verified by reading `ground.ts` and
`weatherfall.ts` in full — neither imports `Date`, `fs`, or any I/O.

### 1.2 Seed-stream discipline

Verified by direct inspection of every `hashString(...)` call site across
`ground.ts` and `weatherfall.ts`:

| Draw | Prefix | Purpose |
| --- | --- | --- |
| Terrain | `ground:${seed}` | which biome |
| Weather schedule | `ground-weather:${seed}` | whether/when/what kind |
| Ground-tile weave | `ground-weather-weave:${seed}` | where the specks land in the terrain tile |
| Falling-weather field | `sky-fall-gap:${seed}` | where/when flakes fall in the front layer |

All four streams share one seed (`startedAt`) but are hashed through
distinct string prefixes before being fed to `mulberry32`, so re-tuning any
one draw's internals (e.g. changing `WEAVE_PERIOD_RANGE` or `FLAKE_COUNT`)
cannot reroll *whether* weather happens — that's decided once, by
`pickSessionWeather` alone, and every other draw is a read-only consumer of
its `kind`. This is the "weather FX never rerolls whether weather happens"
property the task asked me to check, and it holds by construction, not by
convention — there is no shared mutable RNG state between the four calls.

### 1.3 Config-key surface: coherent gating, incoherent naming

The three toggles (`wanderEnabled`, `worldDressing`, `groundEnabled`) are
each gated identically (`idleGate === "full" && cfg.X`, confirmed at
`state.ts:1287`, `:1276`/`:1398`/`:1417`, `:1547`) — mechanically consistent.

But the toggle-to-effect mapping is genuinely confusing, and this is a real
finding, not a nitpick: there are **three unrelated "weather" concepts** in
this codebase —

1. `art.ts`'s `Weather` (`"drizzle" | "sparkle"`, `art.ts:770`) — coding-signal
   driven (error tier / clean streak), rendered on the idle FX row, gated by
   `worldDressing`.
2. `ground.ts`'s `GroundWeather` (`"snow" | "rain"`) — session-scheduled,
   randomized, rendered as specks woven into the ground tile.
3. `weatherfall.ts`'s falling front layer — same schedule as #2, rendered as
   moving flakes over the whole widget.

\#2 and \#3 share one schedule and are wired together correctly. But **both**
are gated by `cfg.groundEnabled` (`state.ts:1547`), not by any toggle whose
name suggests "weather." `buddy_ground`'s MCP tool description
(`server/index.ts:1013`) advertises only "the fixed, full-width terrain
strip" — it never discloses that turning it off also silently kills all
snow/rain, both the ground specks and the (arguably more visually striking)
falling flakes. Meanwhile `buddy_dressing`'s description (`server/index.ts:974`)
*does* say "weather FX," but that refers to the unrelated drizzle/sparkle
effect (#1) — and the menu entry for it (`server/menu.ts:338,346`) repeats
"weather" again. A user who wants to keep the terrain floor but silence
falling snow, or who disables the terrain floor expecting only the floor to
go, has no lever that does that and no text anywhere warning them. This is
an ad hoc outcome of iterative piggybacking (each follow-up doc explicitly
chose to piggyback on the cheapest existing toggle rather than add a new
config key, which is individually reasonable each time) rather than a
deliberately designed surface — worth reconciling in a future pass, but not
a functional bug.

### 1.4 Compositing architecture (front-layer, `design-weather-frontlayer.md`)

Verified directly against the running code, matching the design doc closely:

- **F1/F9/F10 (delete the reserved sky band):** confirmed —
  `buddy-status.sh:1199-1205` contains a comment-only block ("There is
  deliberately nothing here") where the old `HOP_BUDGET` degrade branch used
  to live; `weatherfall.ts` no longer exports `buildFallingWeatherBand`,
  `SKY_FALL_WIDTH`, or `SKY_BAND_ROWS` — only `buildFallingWeatherGapBand`
  and the frontlayer-era constants remain (`SKY_FALL_ROWS=14`,
  `MAX_GAP_WIDTH=110`, `weatherfall.ts:67,86`).
- **F2 (field row = block row, with wraparound):** confirmed at
  `buddy-status.sh:1306`, `gi=$(( i % ${#WFGAP_LINES[@]} ))`, guarded by
  `${#WFGAP_LINES[@]} -gt 0` at `:1291` so it cannot divide by zero.
- **F4 (which layers get the treatment):** confirmed — the per-row loop
  (`:1291-1358`) computes segments for the gap (`_wx_slice`), the stats
  column only on rows with no stat bar (`:1342-1348`), and the bubble box
  only on rows with no bubble text (`:1350-1356`); the sprite/art column and
  bubble *text* rows go through `_wx_overlay` instead (`:1367`, `:1429`,
  `:1435`), which composites onto already-occupied rows rather than only
  blank ones. This matches F4's "bubble box + sprite column + gap +
  blank-filler segments" list exactly.
- **F5 (stats content rows exempted):** confirmed — `_wx_stats_seg` is only
  set when `$_wx_si` falls outside `[0, STATS_COUNT)` (`:1344`).
- **D10/D1 relaxation (weather visible during combat, no longer suppressed
  by a fresh celebration):** confirmed at the jq level — `$gf == "full"` is
  the *only* condition gating `$wfseq`/`$wfgap` (`buddy-status.sh:199-202`),
  with no `$combat_on` or `$celeb_fresh` clause, and the comment at
  `:191-198` explains why the celebration gate was dropped.

---

## 2. Correctness / quality

### 2.1 The space-only invariant and its two preconditions (F3/H2/H3)

`_wx_overlay` (`buddy-status.sh:1153-1175`) only ever replaces a character in
the underlying string when that character is a literal space
(`:1166`, `[ "${_u:$_c:1}" = " " ]`), and only ever inserts the glyph plus a
restore-color escape in that slot — this is what makes the composite
width-preserving *by construction* rather than by assertion, exactly as the
design doc claims.

Two preconditions this argument silently assumes were genuinely broken once
(H2/H3) and are now enforced:

- **Glob-inertness (H2):** `_wx_overlay`'s two pattern uses are quoted
  (`"$WFGAP_GLYPH"` at `:1160` and `:1163`), and so is `_wx_slice`'s (`:1101`,
  with an explicit comment explaining why). I mutation-tested this directly
  — see §4 below.
- **Exactly one display cell (H3):** enforced at `buddy-status.sh:1120`,
  `[ ${#WFGAP_GLYPH} -eq 1 ] || WFGAP_GLYPH=""` — a non-single-character
  glyph degrades to "no flakes" rather than corrupting width. Verified this
  guard exists and precedes every use of `$WFGAP_GLYPH` in the file.

**These two fixes were applied to the front-layer code path only.** The
ground-row weather recolor (`buddy-status.sh:1510`,
`_grow="${_grow//$GROUND_WEATHER_GLYPH/...}"`) has neither guard: the
pattern is unquoted, and there's no length check on `$GROUND_WEATHER_GLYPH`.
See §5.1 for the reproduced bug.

### 2.2 `gi = i % rows` field-row wrapping (H1)

Confirmed correct and tested. `buddy-status.sh:1306` wraps the field row
index by the actual baked row count rather than hard-coding
`SKY_FALL_ROWS`, so a block taller than 14 rows (reachable via the supported
`/buddy width 10` + a long reaction, per H1's own writeup) no longer produces
a hard horizontal "weather cliff." `statusline_render.test.ts:1839-1856`
("F2: the field's row 0 lands on the block's row 0, even with hop headroom
reserved") is a real regression pin for this — it uses a field with flakes
on row 0 only and hop headroom reserved, which is exactly the condition that
would silently break if the field-row math reverted to the old
`i - ART_TOP` offset. I did not re-run this specific mutation (the design
doc's own mutation-audit table already reports it caught, and its logic is
straightforward to verify by inspection); I did independently mutation-test
the adjacent H2 fix (§4) using the same methodology, which is directly
corroborating.

### 2.3 Column-offset arithmetic (`_wx_stats_off`/`_wx_gap_off`/`_wx_bub_off`/`_wx_art_off`)

Read in full (`buddy-status.sh:1318-1337`). These are derived from **live**
values every row (`SPACER_LEAD`, `LEAD_PAD`, `STATS_W`, `STATS_GAP`, `ROAM`,
`BOX_W`), not baked constants — the comment at `:1320-1321` explicitly notes
this matters because an XP toast can widen `STATS_W` mid-session, which must
shift the field with it. The offsets accumulate in the same left-to-right
order the line is actually assembled in (stats → gap → bubble → art),
matching the render loop's own concatenation order. I did not find a case
where these could drift out of sync with the real layout, though I note this
is exactly the kind of thing that's easy to break silently in a future
change to the layout order without a corresponding offset update — there's
no shared abstraction enforcing "offsets track the visual layout," just
consistent manual bookkeeping.

### 2.4 Known, documented, and accepted limitation: wide-character misregistration

`_wx_overlay`'s character-index arithmetic assumes 1 char = 1 display column.
A wide character (emoji, CJK) earlier in the *content* string shifts every
later character's true display column relative to its string-index, which
means the weather field's character-index-based window (`_win`) can end up
recoloring the "wrong" position relative to what's on screen. I traced this
by hand through `_wx_overlay`'s logic and confirm it is real, but — as the
hardening-pass doc claims — it cannot corrupt width, because the *only*
substitution condition is "the character at this index is a literal space,"
and a space is always 1 char = 1 cell regardless of what preceded it. This
is a cosmetic misregistration, not a correctness bug, and is already honestly
documented in `design-weather-frontlayer.md` §7 ("Checked and found
correct").

---

## 3. Test quality — vacuous tests

Per the task brief's specific request to hunt for vacuous tests (this suite
has a documented history of them), I read every weather-adjacent test file
in full: `ground.test.ts` (156 lines), `weatherfall.test.ts` (148 lines), the
weather-related `describe` blocks in `state_wander.test.ts` (~1180-1420) and
`statusline_render.test.ts` (~1595-2432).

**One confirmed-vacuous test, still present:**
`server/statusline_render.test.ts:1708-1724`,
`"no weather fields ⇒ ground row renders byte-identical to the current
plain-terrain path"`:

```ts
test("no weather fields ⇒ ground row renders byte-identical to the current plain-terrain path", () => {
  const before = renderStatus({
    gameFeel: "full", ground: "„.", groundColor: "4a7c3f",
    columns: 80, showStats: false,
  });
  const after = renderStatus({
    gameFeel: "full", ground: "„.", groundColor: "4a7c3f",
    columns: 80, showStats: false,
  });
  expect(after).toBe(before);
});
```

`before` and `after` are built from **identical override objects** — this
passes as long as `renderStatus` is deterministic (trivially true by
construction), regardless of whether the ground-weather recolor feature
works, is broken, or doesn't exist. This is not a new finding — a prior
independent audit (`analysis-ground-weather.md`, dated 2026-07-24) flagged
this exact test at its then-line-numbers (1692-1708) and recommended fixing
or deleting it. **It was never fixed.** The file has since grown a
falling-weather test block (`:1754` onward) whose own back-compat test
(`:1858-1867`) explicitly cites "a prior audit on the sibling ground-weather
feature" catching precisely this mistake and deliberately does it
differently (a real absence check: no flake glyph anywhere, plus an exact
expected line count) — so the lesson was learned and applied to the *new*
code, but the *original* instance the lesson refers to was left as-is.

I mutation-verified this is genuinely vacuous (§4.2 below): with the
ground-weather recolor code fully disabled, this test still passes.

**Everything else read as substantive.** `ground.test.ts` and
`weatherfall.test.ts` in particular are well-constructed: they pin real
boundary behavior (`isWeatherActive`'s exact start/end ms), real
determinism-plus-variation (seed sweeps that assert *both* that a fixed seed
repeats *and* that varying the seed changes the outcome — the "stable but not
vacuous" pattern explicitly called out in `weatherfall.test.ts:113-119`), and
real glyph-safety contracts (disjointness from `MIRROR_SWAP`, from the other
weather layer's own glyphs, from `TERRAINS`' own tile glyphs — the exact
`field`/`,` collision class the ground-weather plan's own Task 1 Step 2 gate
was written to prevent). The falling-weather front-layer block in
`statusline_render.test.ts` (`:1754-1900+`) is unusually rigorous for this
codebase: it has a test literally named "F1 is not vacuous" (`:1809`) that
exists specifically to confirm the zero-added-rows test isn't passing for
the wrong reason (no weather rendering at all), and the escape-assertion
test at `:1688-1689` explicitly rejects an "escape count > 1" check in favor
of a literal expected byte sequence, citing exactly the failure mode the
task brief asked me to hunt for.

---

## 4. Mutation tests performed

Two mutations were run directly against the real `statusline/buddy-status.sh`
during this audit, each reverted with `git checkout -- statusline/buddy-status.sh`
and confirmed byte-identical via `shasum -a 256` before and after
(`bf4a89e016afe41b335a72a7ef7d6197d3f999668f2c3b7d13ed3ba7a3d19de9` both
times). `git status`/`git diff` are empty as of the end of this analysis.

**Mutation 1 — revert H2 (unquote `_wx_slice`'s glyph pattern).**
Changed `_WX_SEG="${_WX_SEG//"$WFGAP_GLYPH"/...}"` back to the unquoted
`_WX_SEG="${_WX_SEG//$WFGAP_GLYPH/...}"`. Ran
`bun test server/statusline_render.test.ts`: **1 failure** —
`"a glob-special glyph cannot collapse a line (the pattern is quoted)"`,
which measured the corrupted line width dropping from 116 to 43 display
cells. This independently reproduces the hardening pass's own claimed
mutation-audit result ("`//` pattern unquoted again | caught (1)") rather
than taking it on faith.

**Mutation 2 — disable the ground-weather recolor block entirely**
(`if [ -n "$GROUND_WEATHER_GLYPH" ]` → `if false && [ -n "$GROUND_WEATHER_GLYPH" ]`
at `buddy-status.sh:1500`). Ran the two relevant tests together:

- `"active weather: the weather glyph renders in its own color..."`
  (`:1672`) — **correctly failed**: the expected literal escape
  `\x1b[38;2;232;240;247m` was absent from the (now unrecolored) output.
- `"no weather fields ⇒ ground row renders byte-identical..."` (`:1708`) —
  **passed anyway**, confirming it is genuinely vacuous: it never exercises
  the code path this mutation disabled, because its own fixture never sets
  `groundWeatherGlyph` in the first place.

This is direct, reproduced evidence for both the §2.1 security finding and
the §3 test-quality finding — not inference from reading the doc history.

**Live reproduction of the unfixed glob bug (outside the test suite, via
the real shell in a throwaway `mktemp -d` sandbox, never touching
`~/.claude-buddy`):** wrote a hand-built `status.json` with
`groundWeatherGlyph: "*"` and a 74-character `ground` tile, ran
`echo '{}' | CLAUDE_CONFIG_DIR="$TMP" statusline/buddy-status.sh`. The
rendered ground row collapsed from the expected ~74-cell tiled string down
to `⠀ *` — 3 display cells. This is the live, current-code equivalent of the
H2 bug the front-layer code already fixed, still reachable through the
ground-row code path. (Not exploitable via any live server code path today —
`ground.ts` only ever emits `+`/`:` — but the shell offers no defense if a
future glyph choice, a config migration bug, or a hand-edited `status.json`
introduced a glob character; this was exactly the concrete concern a prior
audit already raised as its recommendation #1, without a fix landing.)

---

## 5. Security / robustness

### 5.1 The one real finding: unquoted glob pattern at `buddy-status.sh:1510`

```bash
_grow="${_grow//$GROUND_WEATHER_GLYPH/${_WC}${GROUND_WEATHER_GLYPH}${_GC}}"
```

`$GROUND_WEATHER_GLYPH` is unquoted inside the pattern half of `${var//pattern/repl}`,
so bash treats it as a **glob pattern**, not a literal string — identical to
the bug H2 fixed in the sibling `_wx_slice` function (`:1101`, now correctly
quoted: `"${_WX_SEG//"$WFGAP_GLYPH"/...}"`). Reproduced live in §4 above: a
`*` glyph collapses the entire row.

**Severity: low.** The only two values `ground.ts`'s `WEATHER_GLYPH` table
can ever produce are `+` and `:` (`ground.ts:136-139`), neither a glob
metacharacter, and this value never comes from user input — it's a
hardcoded server constant. This does not reach `eval` or any command
execution; the blast radius is a garbled status-line rendering, not code
execution. But it is a live, currently-uncaught defect class in a codebase
that has already paid to fix the identical bug once, in the newer sibling
code path, and a prior independent audit already flagged this exact spot
with a concrete recommendation ("add a glob-metacharacter disjointness test")
that was never implemented as either a test or a code fix.

**Recommendation** (not applied — read-only task): quote the pattern the
same way `_wx_overlay`/`_wx_slice` already do:
`_grow="${_grow//"$GROUND_WEATHER_GLYPH"/...}"`, and add a `ground.test.ts`
assertion that `ALL_GROUND_WEATHER_GLYPHS` (and `ALL_SKY_FALL_GLYPHS`) never
contain a glob metacharacter, mirroring the disjointness test the module
already has for `MIRROR_SWAP`.

### 5.2 Everything else checked

- **jq control-character sanitizer**: every free-text field that reaches the
  shell as a plain (non-base64) string is passed through
  `gsub("[\\x01-\\x1f\\x7f]"; " ")` before being joined into the TSV-ish
  record (`buddy-status.sh:207-238`) — confirmed this includes `$ground`,
  `$gcolor`, `$gwglyph`, `$gwcolor`, name/reaction/achievement/title, and the
  raised-stats names.
- **Frame-art exemption**: `$frame`/`$wfgapframe` are the only two fields
  base64-encoded rather than sanitized (`:239-240`), because both are
  multi-line and the sanitizer operates on a scalar string. The falling
  weather field is additionally guaranteed ANSI-free by construction
  (`weatherfall.test.ts:92-97`, "frames are PLAIN — no embedded ANSI
  anywhere in the output (D3)") — this is a real, verified difference from
  the general sprite-frame channel, which *is* allowed embedded ANSI (the
  wyvern-flame precedent) precisely because it never gets bash-side
  substring-sliced the way the weather field does.
- **Quoting audit**: grepped the entire script for every
  `${var//pattern/repl}` site — there are exactly three (§2.1/§5.1 above,
  plus one unrelated, harmless `BORDER=${BORDER// /-}` at `:992`, both
  literal single characters, not attacker/config-influenced). No other
  glob-substitution hazard exists in the file.
- **Species names / reaction text**: these ride through the existing
  sanitizer pipeline unrelated to weather; nothing about the weather feature
  introduces a new unsanitized string channel.

---

## 6. Performance

Per the task brief, I did not re-measure from scratch (the brief explicitly
warns the benchmark environment is noise-dominated enough to produce
causally-impossible results, e.g. weather-off slower than weather-on). What
I *did* independently check:

- **No new forks in the hot per-row loop.** Grepped
  `buddy-status.sh:1269-1460` (the per-row rendering loop, which runs once
  per printed line, every ~1s tick) for command substitutions (`$( )`,
  as opposed to arithmetic `$(( ))`) — found none related to weather.
  `_wx_slice`/`_wx_overlay` are shell **functions**, not `$( )` subshells,
  which the code's own comments (`:1087-1089`) say was a deliberate choice to
  avoid adding forks to the hot path. This is consistent with, and supports,
  the hardening pass's claim that the ~1.8 ms delta measured is genuinely
  shell compositing cost rather than new process overhead.
- **No new disk reads.** The weather block in `writeStatusState`
  (`state.ts:1547-1619`) reuses the *already-loaded* `startedAt` (from the
  same `loadSnapshot()` call the terrain draw needs) and the *already-loaded*
  `cfg.theme` — no additional file read was introduced for weather beyond
  what ground-weather already required.
  `require("./weatherfall.ts")`/`require("./ground.ts")` are Node/Bun module
  loads, not disk-per-call — first-load cost only, standard for this
  codebase's lazy-require pattern used throughout `state.ts`.
- **The architectural shift (band → front-layer) removed cost, not added
  it**: the old ART band reserved 3 real rows in every render (regardless of
  whether weather was active — the row-count itself was structural); the
  front layer reserves zero. This is a structural improvement independent
  of the ms-level numbers in the doc.

I did not re-run the 40-render timing sweep the hardening pass reports (37.2 ms
off / 39.0 ms on). Given (a) no forks were added, (b) no disk I/O was added,
and (c) the architecture change strictly removed row-reservation overhead
rather than adding compositing overhead beyond what was already measured, I
have no basis to doubt those numbers, but I'm flagging explicitly that this
is inference from architecture, not a fresh measurement — see the section
below for exactly what was verified vs. inferred.

---

## 7. Findings table (ranked by severity)

| # | Severity | Finding | Location |
| --- | --- | --- | --- |
| 1 | **Medium-low** | Ground-row weather-glyph substitution uses an unquoted glob pattern — the same defect class H2 already fixed in the sibling front-layer code, left unfixed here despite a prior independent audit flagging this exact spot. Reproduced live (74-cell row → 3 cells with glyph `*`). Not reachable via any current server code path (`ground.ts` only emits `+`/`:`), so exploitability is nil today, but it's a real, undefended latent bug, not a hypothetical. | `statusline/buddy-status.sh:1510` |
| 2 | **Low** | Confirmed-vacuous test: compares two renders from byte-identical override objects. Passes regardless of whether the feature works. Previously flagged by an independent audit (2026-07-24) with the same diagnosis; never fixed. Mutation-verified in this analysis (feature disabled ⇒ test still green). | `server/statusline_render.test.ts:1708-1724` |
| 3 | **Low, UX/docs only** | Config-surface coherence: `groundEnabled` silently gates ALL ground+falling weather (snow/rain), but neither `buddy_ground`'s nor `buddy_dressing`'s MCP tool description (nor the `/buddy menu` entries) discloses this — and `buddy_dressing`'s own description uses the word "weather" for an unrelated effect (`art.ts`'s drizzle/sparkle). Three distinct "weather" concepts, ambiguous toggle mapping, no cross-reference anywhere in user-facing text. | `server/index.ts:974,1013`; `server/menu.ts:338,346`; `server/state.ts:1547` |
| 4 | **Informational — stale docs** | `design-combat-weather.md`'s D3 (bake the band at the combat scene's own `artWidth` via a ternary) describes an architecture that no longer exists: `design-weather-frontlayer.md`'s F2 replaced per-scene sizing with one fixed-`MAX_GAP_WIDTH` field for every context. The combat-weather doc's own §"What does not change" claims `weatherfall.ts`/the prepend mechanism are untouched by its own change — true only until the *next* doc (frontlayer) rewrote both. No functional bug; just a doc that reads as current but describes a superseded design. Confirmed by direct inspection of `state.ts:1600-1613` (no `artWidth` ternary anywhere in the weather-bake block) and the `state_wander.test.ts:1319-1356` test explicitly titled "dissolved by F2." | `docs/game-feel/living-world/design-combat-weather.md` §3 D3, Task 1 |
| 5 | **Informational — stale docs** | `plan-falling-weather.md` describes `buildFallingWeatherBand` baking SGR-embedded frames prepended above `ART_LINES` inside a reserved sky band, with a dedicated `HOP_BUDGET` degrade branch (D9). None of this exists in shipped code: `weatherfall.ts` exports only the plain (ANSI-free), front-layer `buildFallingWeatherGapBand`; the degrade branch was deleted (F10). The doc's own header says "implemented," which was true of *that* doc's scope at the time, but a reader landing on it today without also reading `design-weather-frontlayer.md` would get a materially wrong mental model of the current architecture. | `docs/game-feel/living-world/plan-falling-weather.md` (whole doc, superseded by `design-weather-frontlayer.md`) |
| 6 | **Informational, confirmed correct** | Wide-character misregistration in `_wx_overlay` (content with an earlier emoji/CJK shifts later character-index-to-column alignment) is real but width-safe by construction (only spaces are ever replaced, and a space is always 1 char = 1 cell). Already honestly documented in the project's own hardening-pass writeup; independently re-derived here, not just cited. | `statusline/buddy-status.sh:1153-1175` |

---

## 8. What I verified vs. what I inferred

**Verified by direct execution/reproduction:**

- Full baseline: `bun test` (1112/1112), `bunx tsc --noEmit` (clean), `bash -n`
  (clean) — all run fresh in this session, not taken from prior docs.
- The unquoted-glob bug at `buddy-status.sh:1510` — reproduced live via a
  hand-built `status.json` in a `mktemp -d` sandbox (never touched
  `~/.claude-buddy`), `CLAUDE_CONFIG_DIR` prefixed on the same command line
  per the safety protocol.
- The H2 mutation (revert the quote fix) — reran the real test suite against
  the mutated script, observed the expected single failure, reverted, and
  confirmed the file's SHA-256 matched the pre-mutation hash.
- The vacuous-test finding — reran the two specific tests against a
  mutated script with the ground-weather recolor disabled; the vacuous test
  passed, the real test failed, exactly as the static-inspection argument
  predicted. Reverted and re-verified the SHA-256.
- No forks in the per-row loop — grepped the actual file for `$( )` vs.
  `$(( ))` inside the loop's line range.
- The seed-stream prefixes, the space-only replace condition, the
  single-char glyph guard, the `gi = i % rows` wrap, the quoting on the
  front-layer helpers, the config-gating consistency, the three-toggle
  naming mismatch, the jq sanitizer coverage, and the doc/code architecture
  divergence (D3 ternary absent from `state.ts`, `buildFallingWeatherBand`
  absent from `weatherfall.ts`) — all confirmed by direct reading of the
  current source files at the cited line numbers, not by trusting the
  design docs' own claims.
- Git tree state — `git status --porcelain`/`git diff` are empty at every
  checkpoint in this analysis, including the final one.

**Inferred, not independently re-measured:**

- The specific millisecond performance numbers in
  `design-weather-frontlayer.md` §7 (37.2 ms / 39.0 ms / 0.085→0.146 ms
  server-side). I did not rerun the timing sweep, per the task brief's own
  explicit instruction not to re-measure without cause and its warning that
  this environment's noise floor can produce causally-backwards results. My
  confidence that nothing has since invalidated those numbers rests on
  architectural reasoning (no new forks, no new disk I/O, no new row
  reservations were introduced since that pass), not a fresh benchmark.
- That `TRANSIENT_PREFIXES`/uninstall-cleanup has no ground/weather entries
  needed — I confirmed there is no persisted weather state to clean up (the
  schedule is fully derived from `startedAt`, never written to its own file),
  which structurally implies no cleanup entry is needed, but I did not
  separately re-audit the full uninstall path end-to-end in this pass.
- The historical claim (from a prior independent audit) that the H1–H4
  hardening-pass mutations were all genuinely caught — I re-ran only H2
  myself; H1/H3/H4 are taken on the strength of that prior audit's own
  documented methodology (each was applied, tested, and reverted with a
  restore-verification step matching what I did here), not re-derived fresh
  in this pass.

---

## 9. Orchestrator re-verification

The agent's report was not taken at face value. Before saving this file, the
orchestrating session independently re-checked the load-bearing claims
against the real source:

| Claim | Result |
| --- | --- |
| `buddy-status.sh:1510` pattern is unquoted | **Confirmed** — `_grow="${_grow//$GROUND_WEATHER_GLYPH/${_WC}${GROUND_WEATHER_GLYPH}${_GC}}"`, no quotes on the pattern half. |
| The sibling at `:1101` *is* quoted | **Confirmed** — `"${_WX_SEG//"$WFGAP_GLYPH"/...}"`, with a comment citing the measured 116→47 cell collapse. |
| `statusline_render.test.ts:1708-1724` is vacuous | **Confirmed** — both `before` and `after` are built from byte-identical override objects, then compared. |
| `ground.ts` only ever emits `+`/`:` | **Confirmed** — `WEATHER_GLYPH` at `ground.ts:136-139` has exactly those two entries, so finding #1 is latent, not live. |
| `groundEnabled` gates the whole weather block | **Confirmed** — `state.ts:1547`, `if (idleGate === "full" && cfg.groundEnabled)`. |
| `buildFallingWeatherBand`/`SKY_BAND_ROWS`/`SKY_FALL_WIDTH` are gone | **Confirmed** — absent from all product code; one stale mention survives in a `state_wander.test.ts` comment only. |
| Tree clean after the agent's mutation tests | **Confirmed** — `git status --porcelain` shows only untracked `.dev/` and `.serena/`. |

The millisecond performance figures were *not* re-measured by the
orchestrator either; they remain inference from architecture, as §8 states.
