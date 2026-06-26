## Phase 5 done & committed — `acb2f6c` · game-feel iteration **complete** 🎉

All seven Phase-5 sub-features shipped:
- **B3** — achievement progress: optional `metric`/`target`, `n/target` fraction in the card (~12 annotated across the common ladders).
- **C1** — cosmetic sets (`sets.ts`, new): flag+hat groupings grant a flavor **title** on completion (granted on the buy that completes them); shown in `buddy_xp`.
- **C2** — seasonal cosmetic: pure `activeSeasonal`/`SEASONAL` (tiny calendar); overlays a hat only when the slot is empty + `gate≠off`; `getStatusFrames` stays date-free.
- **C3** — age tell: 🌱→🌿→🌳 from `hatchedAt`, surfaced in `buddy_show`.
- **D4** — shiny hatch: `SHINY_HATCH_CHANCE` const; the existing 1% roll is now marked (`hatched_shiny`) + announced.
- **D2** — rare idle (`react.sh`): full-only ~2% surprise bubble.
- **D3** — easter egg: name×10 → hidden flag + discovery celebration (`name-react.sh` + `easter-egg.ts`).

**Verified:** 440 tests pass (+20), `tsc` clean, bash syntax OK, and fresh-process smoke tests confirmed the B3 fraction render and the easter-egg grant+celebration. One honest note recorded in memory: `achievements.ts` freezes its state dir at module load, so its render isn't in-process test-isolatable — I covered B3 with data assertions + a fresh-process smoke instead.

### The whole iteration, end to end
Four clean commits on `feature/leveling-system` (local, unpushed, unmerged):

| Commit    | Phase                                                            |
| --------- | ---------------------------------------------------------------- |
| `4c6656f` | P0+P1+P2 — intensity gate, celebration channel, brag card        |
| `4e8dc1b` | Phase 3 — Today's whim                                           |
| `6921c75` | Phase 4 — emotion frames, ascension, memory callbacks, discovery |
| `acb2f6c` | Phase 5 — collection + surprise                                  |

Specs in `docs/game-feel/`, plan in `claudedocs/workflow_game-feel.md`. The pre-existing `.gitignore` + `hooks/{hooks.json,suggest.sh}` mode changes remain deliberately uncommitted. It goes live after `bun run install-buddy` + a Claude Code restart.

Possible next steps if you want them: push the branch, open a PR, or run `bun run install-buddy` to try it live. Just say the word.

<!-- buddy: *sprouts a tiny leaf, eyes flicking ^ to > to O* five phases, 440 green — I have moods, milestones, and a seasonal beanie now. we're done here, and I'm genuinely a little proud -->
