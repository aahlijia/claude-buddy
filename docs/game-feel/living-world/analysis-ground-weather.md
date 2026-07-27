# Ground weather — independent implementation audit

_Audited 2026-07-24 against `feature/interactive-fight-scene`. Read-only review; nothing was changed to produce it. Every command below was actually run during this audit, not copied from the implementer's report._

## Verdict

**The implementation is correct and matches the design (D1–D5) and the plan task-by-task.** `bun test`, `bunx tsc --noEmit`, and `bash -n statusline/buddy-status.sh` were all re-run independently and reproduce exactly the claimed green state (1044 pass / 0 fail, silent `tsc`, exit 0 on `bash -n`). No functional bug was found in the pure core, the `writeStatusState` wiring, or the shell recolor step — including the two areas most likely to hide one: the epoch-seconds/epoch-ms conversion and the bash glyph substitution. Two non-blocking issues were found: one vacuous test that doesn't test what its name claims, and one stale "everything is uncommitted" claim the current git history already contradicts (Task 1 is in fact committed).

## Bugs / correctness issues

**None found.** Every risk area the design/plan called out was independently re-derived from source, not taken on faith:

- The units-bug fix (`server/state.ts:1536`, `elapsedMs = Date.now() - startedAt * 1000`) is genuinely correct.
- The `,`/`field`-terrain collision the design doc's own placeholder would have hit is avoided by the shipped `+`/`:` pair.
- The bash substitution was probed live in this repo's actual shell rather than assumed safe, and behaves correctly against real multi-byte terrain glyphs.
- Gating (full-only, no active combat, `groundEnabled`-piggybacked) is applied identically in `state.ts` and `buddy-status.sh`'s jq, exercised by passing tests on both sides.

## Test-quality issues

**One vacuous test:** `server/statusline_render.test.ts:1692-1708`, `"no weather fields ⇒ ground row renders byte-identical to the current plain-terrain path"`:

```ts
const before = renderStatus({ gameFeel: "full", ground: "„.", groundColor: "4a7c3f", columns: 80, showStats: false });
const after = renderStatus({ gameFeel: "full", ground: "„.", groundColor: "4a7c3f", columns: 80, showStats: false });
expect(after).toBe(before);
```

`before` and `after` use **the identical override object** — neither sets `groundWeatherGlyph`/`groundWeatherColor`. This passes even if the recolor feature (or the whole shell script) were completely broken, as long as `renderStatus` is deterministic — trivially true by construction. It provides zero regression coverage for the invariant its name claims.

This is exactly the class of bug the implementer says they caught once already in the neighboring test (lines 1656-1674: a "distinct escape count > 1" check replaced with a literal-escape-string assertion, `raw.toContain("\x1b[38;2;232;240;247m")` — that fix is real and correctly verified). This second instance, in the same describe block, wasn't caught. Contrast with the pre-existing sibling pattern at `statusline_render.test.ts:787-806` ("an old status.json without wanderSequence renders byte-identically"), which correctly compares **two different input shapes** (field present vs. absent) — a real back-compat pin. The ground-weather test should follow that shape or be deleted as redundant with the first test in its own block (`"full: the ground row paints the tiled terrain as the last line"`, which already asserts real content for the no-weather case).

Severity: low — no product bug, just a coverage gap. Every other new test in `ground.test.ts`, `state_wander.test.ts`, and `statusline_render.test.ts` was read in full and found to assert something meaningful (deterministic-seed checks, boundary sweeps, disjointness checks, literal-escape assertions, width-clipping checks, combat/subtle/off suppression checks).

## Documentation accuracy

**"Everything is uncommitted" is stale.** The design doc's status header, the plan's baseline section, and `CURRENT-STATE.md`'s new section all claim the ground-weather work (and the base living-ground row) is entirely uncommitted. As of this audit:

```
$ git log --oneline -1 -- server/ground.ts
cbc51f3 feat(living-world): ground-weather schedule + woven-tile core
$ git diff -- server/ground.ts        # empty — no working-tree diff
```

`server/ground.ts`/`server/ground.test.ts` — Task 1's entire deliverable, **including `pickSessionGround`, the pre-existing living-ground code the design doc calls its baseline** — is already committed as `cbc51f3` on this branch. Only Tasks 2–4 remain uncommitted:

```
$ git diff HEAD --stat -- server/state.ts server/state_wander.test.ts \
    server/statusline_render.test.ts statusline/buddy-status.sh docs/game-feel/CURRENT-STATE.md
 5 files changed, 732 insertions(+), 8 deletions(-)
```

Doesn't affect correctness, but it's a concrete inaccuracy in the doc set this audit was asked to sanity-check, and worth reconciling before commit. No other documentation discrepancy was found — `CURRENT-STATE.md`'s mechanism description matches the code at every point checked, and the test-count math (1027 + 17 = 1044) is exactly right (verified by counting: 9 new tests in `ground.test.ts`, 4 in `state_wander.test.ts`, 4 in `statusline_render.test.ts`).

## Quality / maintainability observations (not bugs)

1. **`${_grow//$GROUND_WEATHER_GLYPH/...}` (`buddy-status.sh:1210`) trusts the glyph is glob-metacharacter-free, but nothing enforces it.** `${var//pattern/replacement}` treats `pattern` as a glob, not a guaranteed literal. Safe today (`+`/`:` aren't glob metacharacters), but `ground.test.ts`'s glyph-safety test checks ANSI/width/`MIRROR_SWAP` — not glob-safety (`* ? [ ] \`). Not a live bug, and not a security issue (never reaches `eval`/exec, only a string substitution printed to the terminal) — but a latent fragility with no test guarding it. Recommend adding a disjointness check against `* ? [ ] \` alongside the existing `MIRROR_SWAP` test.
2. **Speck placement in `buildWeatherTile` can rarely collide** (`ground.ts:225-228`, indices aren't deduped), silently yielding fewer visible specks than `speckCount`. Cosmetic only, untested either way, not worth blocking on.
3. **No integration-level test exercises the real (unstubbed) `pickSessionWeather → isWeatherActive → writeStatusState` path landing inside an active window** — by design, since the plan correctly notes a real seed can't be brute-forced into its own window. Low risk (both functions are small, individually well-covered), but it's the one seam this plan couldn't practically close end-to-end.

## Explicitly verified correct

1. **Units-bug fix is real.** `session.ts:106` documents `startedAt` as epoch seconds; `state.ts:1536`'s `Date.now() - startedAt * 1000` is dimensionally correct. Grepped every non-test `startedAt` use across `server/*.ts` — only one other `Date.now()`-adjacent site exists (`state.ts:604`, already seconds-based, pre-existing/unrelated) — no systemic bug elsewhere.
2. **Glyph disjointness confirmed by direct read**, not claim: `art.ts` `MIRROR_SWAP` keys (`( ) < > [ ] { } / \`) and `WEATHER_GLYPH` (`'`/`*`), `ground.ts`'s `ALL_GROUND_GLYPHS` (`„ . , ~ ▂ ·`) — `+`/`:` collide with none.
3. **Pure core is actually pure** — read `pickSessionWeather`/`isWeatherActive`/`buildWeatherTile` in full; no clock/fs/env read anywhere.
4. **Independent RNG streams** — `hashString` (Bun.hash/wyhash) hashes the whole prefixed string before `mulberry32`, so `ground:`/`ground-weather:`/`ground-weather-weave:` prefixes yield practically uncorrelated seeds.
5. **D3 holds** — no new config key or MCP tool; only pre-existing `buddy_ground`/`buddy_dressing` exist.
6. **D1 holds** — `TRANSIENT_PREFIXES` has no ground/weather entry.
7. **Shell substitution genuinely safe for the shipped glyphs** — verified live: the `„` glyph's 3-byte UTF-8 sequence (`e2 80 9e`) survives intact and unsplit on both sides of a substituted `+`, and an untouched `:` is left alone.
8. **Gating consistent in both places** — `state.ts:1518` (`idleGate === "full" && cfg.groundEnabled`) and `buddy-status.sh:177-178` (`$gf == "full" and $combat_on != 1`) apply the same rule independently, exercised by passing subtle/off/combat tests.
9. **Reported green state is real** — `bun test` → 1044/0; `tsc --noEmit` → clean; `bash -n` → exit 0.
10. **`groundColor` left unchanged when weather is active** — `state.ts:1526-1543` sets it before the weather branch and never reassigns it inside.

## Follow-up recommendations

1. Fix or delete the vacuous test at `statusline_render.test.ts:1692-1708`.
2. Add a glob-metacharacter disjointness test to `ground.test.ts` (`* ? [ ] \` absent from the weather/ground glyph sets).
3. Reconcile the "everything is uncommitted" language in the design doc / `CURRENT-STATE.md` before committing Tasks 2–4 — Task 1 is already committed as `cbc51f3`.
4. Nothing else blocks committing the remaining working-tree diff (`server/state.ts`, `server/state_wander.test.ts`, `server/statusline_render.test.ts`, `statusline/buddy-status.sh`, `docs/game-feel/CURRENT-STATE.md`) as-is.
