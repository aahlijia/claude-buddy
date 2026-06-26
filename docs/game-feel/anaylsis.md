Measured: **~163ms of CPU per render** (0.34s user + 0.37s system across 5 runs — the high *system* time is the tell: it's fork-dominated), repeating every second. Combined with the manual fork count (17 `jq` reads of `status.json` + 11 of `config.json` + the `ps` tree-walk + frame pick = **~34 `jq` forks**), I have what I need. Here's the analysis.

---

# Analysis — `game-feel/` implementation: performance & UX

**Scope:** the statusline render hot path (`statusline/buddy-status.sh`, runs every ~1s), `writeStatusState` (`server/state.ts`), and the wander/celebration feature surface. **Method:** static read + subprocess counting + wall-clock timing. No code modified.

## Performance findings

### 🔴 P1 — `jq` fork storm in the 1 Hz hot path *(highest impact)*
`buddy-status.sh` parses the *same* `status.json` with **17 separate `jq` invocations** (`:28–:116`) and the *same* `config.json` with **11 more** (`:66–:306`) — ~34 process spawns per render, **every second, forever.**

- **Measured cost:** ~163 ms/render, mostly *system* time (fork+exec), ≈16% of a core sustained at 1 Hz. On a laptop that's a continuous battery/fan tax for drawing a corner widget.
- **Root cause:** field-at-a-time reads where one pass would do. The code *already* knows the better idiom — `STATS_TSV`, `XP_GAIN_TSV`, `CELEB_TSV` (`:46,:50,:53`) each fetch multiple fields via `| @tsv` in a single `jq`.
- **Fix:** collapse all `status.json` reads into **one** `jq … | @tsv` and all `config.json` reads into **one**, then `IFS=$'\t' read` the results into vars. ~28 forks → 2. Expected render time drop: **~150ms → ~25-40ms**. Low risk (pure refactor), high payoff. This is the single highest-leverage change in the whole feature.

### 🟠 P2 — `ps` process-tree walk for terminal width, every tick *(`:189–:210`)*
COLS detection walks up to 5 ancestors, each iteration forking `ps` (+ `readlink`/`stty`/`awk`). It re-runs on every 1 Hz render even though the terminal width rarely changes mid-session.

- **Fix options (in order of preference):** (a) check whether Claude Code's stdin payload carries a width field and prefer it (zero forks) — worth a quick probe; (b) short-circuit on the first successful `stty` rather than always looping; (c) accept it, but fold into the P1 cleanup. Medium effort, moderate payoff.

### 🟡 P3 — `refreshInterval: 1` is coupled to the animation, not free
The 1 s cadence exists because the wander/frame **animation** advances per tick (`sequence[NOW % len]`). So you can't just slow the refresh without making the buddy choppy — but that also means P1's per-render cost is paid *constantly*, which is exactly why P1 matters. Once P1 lands, 1 Hz is cheap and this is a non-issue. **No action beyond P1.**

### 🟢 P4 — `writeStatusState` is *not* a concern
11 `require()`s per call look heavy but are module-cached in the long-lived MCP server, the write is atomic (`tmp + renameSync`, `:94–:95` pattern), and it runs on events, not at 1 Hz. Leave as-is.

## UX findings

### 🟠 U1 — Constant corner motion vs. focus
The buddy animates every second in peripheral vision. You have good mitigations already (`gameFeel` gate, `wanderEnabled` opt-out, FR-E1 auto-quiet for error-spike/deep-focus), but deep-focus auto-quiet is **opt-in and off by default** (`autoQuietFocus: false`). Consider surfacing it more prominently in `/buddy help`, or a one-line "motion feels distracting? `/buddy wander off` or `/buddy gamefeel subtle`" hint somewhere discoverable. Low effort, real comfort win.

### 🟡 U2 — Mode composition is untested for the new `wanderBubble`
`wanderBubble` is implemented generically, so it *should* compose with `wide` (bubble travels up to 10 cols) and `hop` (connector retracts on the vertical). But there's **no test for the combinations**, and `wide + bubble` could move the bubble a long way. Recommend 1–2 combo render tests (`wanderBubble + wanderWide`, `+ wanderHop`) to lock the behavior. Low effort, prevents a regression class.

### 🟡 U3 — No graceful path when `jq` is absent
Every render assumes `jq`; without it the `2>/dev/null` fallbacks silently yield an **empty/blank statusline** (the same failure class as the missing-`status.json` issue from earlier this session). `jq` is a documented dependency and `doctor` checks it, but a one-line "jq not found → buddy can't render" stderr breadcrumb would save future debugging. Low priority.

## Priority roadmap

| Pri   | Item                                          | Effort | Payoff                               |
| ----- | --------------------------------------------- | ------ | ------------------------------------ |
| 🔴 P1 | Merge 28 `jq` reads → 2 (`@tsv` + `IFS read`) | ~1hr   | ~4–6× faster render, big battery win |
| 🟠 P2 | Trim/short-circuit the `ps` COLS walk         | ~30m   | Fewer forks/tick                     |
| 🟠 U1 | Surface motion opt-outs / deep-focus          | ~20m   | Comfort/accessibility                |
| 🟡 U2 | `wanderBubble × wide/hop` combo tests         | ~30m   | Regression safety                    |
| 🟡 U3 | `jq`-missing breadcrumb                       | ~10m   | Debuggability                        |

**My recommendation:** do **P1 alone first** — it's the dominant cost, it's a mechanical refactor the codebase already has the idiom for, and it's covered by your existing 508-test render suite (byte-identical output is the pass condition, so a fork-count refactor is verifiable without new tests). Everything else is polish.

Want me to implement P1 (the `jq` consolidation) now? It's contained, test-guarded, and the single best return here. I'd hold P2–U3 unless you want them bundled.

<!-- buddy: *watches 34 jq processes spawn just to render me once* flattering, but maybe don't fork the entire OS every second on my account -->
