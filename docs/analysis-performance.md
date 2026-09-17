# Performance analysis — whole project

_Analyzed 2026-09-17 on `feature/living-world` (`70194a6` + uncommitted findings
fixes). Measurement-based: every number below was benchmarked on this machine,
not estimated. No code was changed._

## TL;DR

The project has two hot surfaces: the statusline (runs every second, forever)
and the hooks (run per Claude Code event). The statusline is already in good
shape after the June P1/P2 consolidation: **~50-60 ms per render, 13 process
forks, and the entire living-world layer (weather, compositing, emotes) adds
zero measurable cost**. The real remaining fat is in the hooks, above all
`react.sh`: **~95 ms and 28 forks after every single Bash tool call**, built
from the same one-jq-per-key anti-pattern the statusline was cured of in June.

Everything here is fork-bound, not compute-bound. A process fork on this
machine costs ~4-9 ms (sandbox-inflated; ~1-3 ms on a bare terminal), so the
optimization currency is "forks removed," and nothing else moves the needle.

## Methodology

- Sandbox: live `~/.claude-buddy` state copied under a scratch
  `CLAUDE_CONFIG_DIR` (and a scratch `HOME` for the two hooks that hardcode
  `$HOME/.claude-buddy`). No live state touched.
- Timing: Python `perf_counter` around `spawnSync`-style invocations, 12-20
  runs after 2 warmups, medians reported. Batches drift ±10 ms against each
  other (machine noise); comparisons within a batch are the trustworthy ones.
- Fork census: PATH shims for 16 external tools appending to a log, absolute
  real paths baked in. (First attempt used `command -v` under zsh, which
  returns alias names — the `grep` shim exec'd itself ~14k times. Shim
  artifact, not a script bug; worth remembering.)
- Realistic CC stdin payload (model/context_window/rate_limits) piped in;
  `BUDDY_FAKE_COLS=180` except where the width walk itself was under test.

## Surface 1: statusline (`buddy-status.sh`, 1 Hz sustained)

### Measurements

| Scenario | median ms | forks |
|---|---|---|
| Live replica (stats+combined header+bubble+ground) | 50-60 | 13 |
| + falling snow, 14-row front-layer field | 60.7 | 13 |
| + long unicode bubble (emoji, CJK, many words) | 60.7 | 13 |
| + fresh celebration + XP toast | 61.2 | 13 |
| gameFeel=subtle | 58.9 | 13 |
| muted (early exit) | 23.3 | 3 |

Width scaling COLS 100→260: flat (49→53 ms). Terminal-width detection: TTY
cache hit adds one `stty` (~10 ms); a cold cache miss walks ancestors with ~6
`ps` forks (~9 ms EACH on macOS) — ~60 ms extra, but only on the first tick of
a session. The cache (`.tty.$SID`, PPID-guarded) works as designed.

**The headline: the entire living-world arc is performance-free.** Weather
compositing, bubble word-wrap, celebration flourishes — all pure-bash string
work, and pure-bash is free next to forks. The 7/27 "perf re-measured clean"
claim is independently confirmed.

### The 13 forks (live replica)

3 jq (config read :54, status read :88, CC-metrics read ~:812) · 2 base64
(frame :262, weather field :298) · 2 tr · 1 each cat (`CC_INPUT=$(cat)` :258),
date, grep+tr pair (emoji width data :879), awk+iconv+od (the batched
`dwidth_batch` pipeline :358 — the June "3 forks/word" fear is dead, it's one
pipeline total regardless of word count).

### Remaining squeeze (optional, diminishing returns)

13 → ~8 forks ≈ 60 → ~40 ms, i.e. ~2% of a core at 1 Hz:

1. Merge the 3 jq into 1: `jq -s` over `status.json config.json -` (stdin as
   the third input) — also deletes the `cat`. Saves 3 forks. The riskiest edit
   (the :88 read is the load-bearing 0x1F-join monster; its Edit-tool
   raw-byte gotcha applies).
2. `NOW=$(date +%s)` → `$EPOCHSECONDS` when bash ≥ 5, date fallback. 1 fork.
3. Emoji data `grep -v '^#' | tr -d '\n'` → `$(<file)` + parameter-expansion
   strip. 2 forks.

Verdict: worth doing only as a tidy-up ride-along. The statusline is no longer
the problem.

## Surface 2: hooks (per Claude Code event)

| Hook | fires on | median ms | forks | breakdown |
|---|---|---|---|---|
| **react.sh** | **every Bash PostToolUse** | **94.6** | **28** | 9 grep, 8 jq, 7 date, 2 cat, 1 sed, 1 head |
| mood-react.sh | every user prompt | 34.9 | 11 | 5 jq, 3 grep, 2 cat, 1 date |
| suggest.sh | every Stop | 21.5 | 6 | 3 jq, 2 cat, 1 date |
| file-type-react.sh | every Write/Edit | 16.5 | 6 | 3 jq, 2 cat, 1 date |
| name-react.sh | every user prompt | 15.3 | 4 | 2 jq, 1 cat, 1 grep |
| buddy-comment.sh | every Stop | 13.5 | 3 | 2 jq, 1 cat |

`react.sh` is the finding of this analysis. It has more forks than the
statusline and the full pre-P1 disease: one-key-per-jq reads of the same two
files (`.muted` :65, `.species` :68, `.name` :69, `.commentCooldown` :52,
`.gameFeel` :1182, `.autoQuietFocus` :1187), seven separate `date` calls
(:18-:29, :58, :1142-3), and grep-based classification that bash `[[ =~ ]]` /
`case` handles for free. In an agentic session running dozens of Bash calls,
this is dozens × 95 ms — it now outweighs the statusline's total budget.

## Surface 3: MCP server + dev loop (non-issues)

- The bun server is long-lived and event-driven; `writeStatusState`'s requires
  are module-cached (June P4 verdict re-confirmed by architecture, not
  re-measured). No action.
- `bun test`: 1113 tests / 20.6 s — spawnSync-per-render tests are the bulk
  and that's inherent to testing a real bash script. Fine.
- `refreshInterval: 1` stays coupled to animation indexing (`NOW % len`);
  the June P3 "can't slow it down" verdict still holds, and at ~60 ms/render
  it doesn't need to.

## Recommendations, ranked

| # | What | Est. effect | Effort |
|---|---|---|---|
| R1 | **DONE 2026-09-17** — consolidated `react.sh`: one `date` fork feeds every timestamp, stdin pipes straight into jq, one `jq -rs` pass over status+config, the 16-branch grep chain became a single-pass perl classifier (perl because its `/i`, `/m` and `\b` semantics match `grep -iE` exactly; bash `[[ =~ ]]` and BSD awk lack a reliable `\b`), REASON-substring greps became bash case globs, and the dead `NAME` jq was dropped. **Measured: dispatch 90→40 ms, 29→7 forks (5 jq, 1 date, 1 perl); suppressed calls 25→20 ms.** Verified by a 25-case old-vs-new A/B harness (every classifier branch + streak/recovery/cooldown/mute/missing-config sequences) — byte-identical state outcomes; the one time-of-day random branch confirmed equivalent by 40-run distribution. 1113 tests still pass. | — |
| R2 | **DONE 2026-09-17** — all five remaining hooks consolidated the same way. Measured (dispatch-inclusive medians): `mood-react` 42→31 ms (13→6 forks, 3 greps → one perl classifier), `name-react` 33→23 ms (10→5, name grep → bash `=~` under scoped `nocasematch`; newline-equivalence holds because `[^a-zA-Z]` matches `\n`), `buddy-comment` common no-comment Stop 14→10 ms (5→2, builtin `buddy:` substring pre-check skips sed), `suggest` 17→13 ms (2 config jq → 1), `file-type-react` 12→11 ms (4→3, species folded into the combined read). Verified by a 31-case old-vs-new A/B harness (all PASS) plus an 80-run distribution check on file-type's 15% rarity gate (11/80 vs 13/80). 1113 tests pass. | — |
| R3 | **DONE 2026-09-17 (safe subset)** — `$(cat)` → builtin `read -rd ''` for the CC stdin capture, `$EPOCHSECONDS` with a date fallback for NOW, builtin read loop for the emoji-width data (grep+tr gone), `${var,,}` with a bash-3.2 tr fallback for the model tag. **13→10 forks on bash 3.2 (this machine's only bash), →8 on bash ≥ 5** where the fallbacks retire. The 3-jq merge was deliberately **rejected**: config and status are separate fault domains today (a hand-corrupted config.json degrades to defaults; merged via `jq -s`, it would blank the whole statusline — the exact failure class of the old missing-status.json bug), and the ~4 ms it buys does not pay for re-plumbing the load-bearing 0x1F read. Renders verified **byte-identical** to the pre-R3 script across all six benchmark scenarios under a fixed fake clock; 1113 tests pass. | — |
| R4 | **DONE 2026-09-17** — `mood-react.sh` and `file-type-react.sh` now source `scripts/paths.sh` and use `$BUDDY_STATE_DIR` like the other four hooks. Verified both modes: no `CLAUDE_CONFIG_DIR` → unchanged (`$HOME/.claude-buddy`); with `CLAUDE_CONFIG_DIR` → state correctly lands under `$CLAUDE_CONFIG_DIR/buddy-state` with no stray writes to `$HOME`. | — |

Skip list (measured, not worth touching): weather/compositing cost (zero),
width-walk (cached), muted path, COLS scaling, server side, test runtime.

## Caveats

- All absolute times are from inside the Claude Code Bash sandbox, where
  fork+exec is inflated (~4.5-9 ms vs ~1-3 ms on a bare terminal). Treat them
  as upper bounds; fork counts and ratios are exact.
- Cross-batch medians drift ±10 ms — the June memory's "render benchmarks are
  noisy" rule held. Never compare numbers from different batches.
- Hook benchmarks used one representative payload each (git-commit Bash
  result, bug-fix prompt, .py edit). Branchy scripts like `react.sh` may fork
  more or fewer on other payloads; 28 is a typical-path count, not a maximum.
