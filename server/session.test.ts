/**
 * Unit tests for the pure session-bonus helpers in session.ts.
 *
 * The snapshot I/O and the awardSessionComplete orchestration touch the
 * filesystem and the XP store, so they belong in an integration suite with a
 * temp state dir. The bonus math and the counter diff are pure and pinned here.
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeSessionBonus,
  counterDelta,
  combatErrorCount,
  computeStatGains,
  sessionErrorRate,
  formatStatUpText,
  raisedStatNames,
  pendingAction,
  bossStages,
  stingerForCompletion,
  SESSION_BASE_BONUS,
  SESSION_BONUS_CAP,
  PATIENCE_MAX_MINUTES,
  WISDOM_LEARN_RATE,
  BOSS_THRESHOLD,
  BOSS_STAGE2_AT,
  type SessionCounters,
} from "./session.ts";

const ZERO: SessionCounters = {
  all_green: 0,
  large_diffs: 0,
  errors_seen: 0,
  commits_made: 0,
  tests_failed: 0,
  type_errors: 0,
  lint_fails: 0,
  build_fails: 0,
  pets: 0,
};

describe("computeSessionBonus", () => {
  test("a no-work commit grants only the base bonus", () => {
    expect(computeSessionBonus(ZERO)).toBe(SESSION_BASE_BONUS);
  });

  test("matches the documented worked example", () => {
    // 3 green runs, 1 big diff, 2 errors → 30 + 24 + 5 + 8 = 67
    const delta: SessionCounters = {
      ...ZERO,
      all_green: 3,
      large_diffs: 1,
      errors_seen: 2,
      commits_made: 1,
    };
    expect(computeSessionBonus(delta)).toBe(67);
  });

  test("commits_made does not contribute to the score", () => {
    const delta: SessionCounters = { ...ZERO, commits_made: 9 };
    expect(computeSessionBonus(delta)).toBe(SESSION_BASE_BONUS);
  });

  test("applies per-event diminishing caps", () => {
    // Each term saturates: 8·6 + 5·4 + 4·5 = 48 + 20 + 20 = 88, +30 base = 118
    const flooded: SessionCounters = {
      ...ZERO,
      all_green: 100,
      large_diffs: 100,
      errors_seen: 100,
      commits_made: 100,
    };
    expect(computeSessionBonus(flooded)).toBe(118);
  });

  test("never exceeds the hard cap", () => {
    const flooded: SessionCounters = {
      ...ZERO,
      all_green: 9999,
      large_diffs: 9999,
      errors_seen: 9999,
      commits_made: 9999,
    };
    expect(computeSessionBonus(flooded)).toBeLessThanOrEqual(SESSION_BONUS_CAP);
  });

  test("each individual term scales until its cap", () => {
    expect(computeSessionBonus({ ...ZERO, all_green: 1 })).toBe(38); // 30 + 8
    expect(computeSessionBonus({ ...ZERO, large_diffs: 1 })).toBe(35); // 30 + 5
    expect(computeSessionBonus({ ...ZERO, errors_seen: 1 })).toBe(34); // 30 + 4
  });
});

describe("counterDelta", () => {
  test("subtracts the baseline from the current counters", () => {
    const current: SessionCounters = {
      ...ZERO,
      all_green: 5,
      large_diffs: 3,
      errors_seen: 4,
      commits_made: 2,
      tests_failed: 6,
    };
    const baseline: SessionCounters = {
      ...ZERO,
      all_green: 2,
      large_diffs: 1,
      errors_seen: 4,
      commits_made: 1,
      tests_failed: 2,
    };
    expect(counterDelta(current, baseline)).toEqual({
      ...ZERO,
      all_green: 3,
      large_diffs: 2,
      errors_seen: 0,
      commits_made: 1,
      tests_failed: 4,
    });
  });

  test("a baseline missing the newer counters diffs them to zero", () => {
    // On-disk snapshots written before tests_failed/type_errors/lint_fails/
    // build_fails existed must not credit the whole lifetime count to the
    // first session after the upgrade.
    const current: SessionCounters = { ...ZERO, lint_fails: 30, errors_seen: 2 };
    const legacy = {
      all_green: 0,
      large_diffs: 0,
      errors_seen: 1,
      commits_made: 0,
    } as SessionCounters;
    const delta = counterDelta(current, legacy);
    expect(delta.lint_fails).toBe(0);
    expect(delta.errors_seen).toBe(1);
  });

  test("clamps to zero when a baseline somehow exceeds current", () => {
    const current: SessionCounters = { ...ZERO, all_green: 1 };
    const baseline: SessionCounters = { ...ZERO, all_green: 5 };
    expect(counterDelta(current, baseline).all_green).toBe(0);
  });

  test("an unchanged session yields an all-zero delta", () => {
    const snap: SessionCounters = {
      ...ZERO,
      all_green: 7,
      large_diffs: 2,
      errors_seen: 1,
      commits_made: 3,
      build_fails: 2,
    };
    expect(counterDelta(snap, snap)).toEqual(ZERO);
  });
});

describe("combatErrorCount", () => {
  test("a clean session spawns nothing", () => {
    expect(combatErrorCount(ZERO)).toBe(0);
  });

  test("sums every error-ish bucket", () => {
    const delta: SessionCounters = {
      ...ZERO,
      errors_seen: 1,
      tests_failed: 2,
      type_errors: 3,
      lint_fails: 4,
      build_fails: 5,
    };
    expect(combatErrorCount(delta)).toBe(15);
  });

  test("green runs, diffs, and commits do not feed the spawn", () => {
    const delta: SessionCounters = {
      ...ZERO,
      all_green: 9,
      large_diffs: 9,
      commits_made: 9,
    };
    expect(combatErrorCount(delta)).toBe(0);
  });

  test("a single failed test run is enough to spawn a tier-1 bug", () => {
    // The real-world regression: bun test failures print `error:` and land in
    // tests_failed/lint_fails, never errors_seen — the spawn must see them.
    expect(combatErrorCount({ ...ZERO, tests_failed: 1 })).toBe(1);
  });
});

describe("pendingAction (design-pending-encounter §4.1)", () => {
  test("no existing standoff → spawn", () => {
    expect(pendingAction(1, null)).toBe("spawn");
    expect(pendingAction(4, null)).toBe("spawn");
  });

  test("a strictly higher tier → escalate", () => {
    expect(pendingAction(2, { tier: 1 })).toBe("escalate");
    expect(pendingAction(4, { tier: 2 })).toBe("escalate");
  });

  test("the same tier → no-op (no re-bake on repeated same-tier errors)", () => {
    expect(pendingAction(1, { tier: 1 })).toBe("noop");
    expect(pendingAction(3, { tier: 3 })).toBe("noop");
  });

  test("a lower tier never downgrades an existing standoff", () => {
    expect(pendingAction(1, { tier: 3 })).toBe("noop");
    expect(pendingAction(2, { tier: 4 })).toBe("noop");
  });

  test("tier 0 (no spawn) is always a no-op, even with no existing file", () => {
    expect(pendingAction(0, null)).toBe("noop");
    expect(pendingAction(0, { tier: 2 })).toBe("noop");
  });
});

describe("boss decisions (living-world P2)", () => {
  test("count >= BOSS_THRESHOLD upgrades a standoff to a boss", () => {
    expect(pendingAction(4, { tier: 4 }, 12)).toBe("boss");
    expect(pendingAction(4, { tier: 4 }, 11)).toBe("noop");
  });

  test("an existing boss never re-upgrades or de-escalates", () => {
    expect(pendingAction(4, { tier: 4, kind: "boss" }, 20)).toBe("noop");
  });

  test("boss stage count scales with severity", () => {
    expect(bossStages(12)).toBe(2);
    expect(bossStages(18)).toBe(3);
  });
});

describe("computeStatGains", () => {
  test("a no-work, no-time session yields no gains", () => {
    expect(computeStatGains(ZERO, 0)).toEqual({});
  });

  test("maps each counter to its stat at the documented rate", () => {
    expect(computeStatGains({ ...ZERO, errors_seen: 2 }, 0)).toEqual({
      DEBUGGING: 0.3, // 0.15 × 2
    });
    expect(computeStatGains({ ...ZERO, large_diffs: 3 }, 0).CHAOS).toBeCloseTo(
      0.3, // 0.10 × 3
    );
    expect(computeStatGains({ ...ZERO, all_green: 2 }, 0).WISDOM).toBeCloseTo(
      0.2, // 0.10 × 2 (the clean-run floor; the learning term is separate)
    );
    expect(computeStatGains({ ...ZERO, pets: 4 }, 0).SNARK).toBeCloseTo(
      1.0, // 0.25 × 4 (stats-leveling-v2 §P1)
    );
  });

  test("PATIENCE accrues from elapsed time, not counters", () => {
    // 100 minutes → 0.05 × (100/10) = 0.5
    expect(computeStatGains(ZERO, 100 * 60).PATIENCE).toBeCloseTo(0.5);
  });

  test("a zero-length session grants no PATIENCE", () => {
    expect(computeStatGains({ ...ZERO, errors_seen: 1 }, 0).PATIENCE).toBe(
      undefined,
    );
  });

  test("negative elapsed time is treated as zero", () => {
    expect(computeStatGains(ZERO, -9999).PATIENCE).toBe(undefined);
  });

  test("commits_made never moves a stat", () => {
    expect(computeStatGains({ ...ZERO, commits_made: 50 }, 0)).toEqual({});
  });

  test("SNARK accrues only from pet interaction, not other work", () => {
    const flooded: SessionCounters = {
      ...ZERO,
      all_green: 99,
      large_diffs: 99,
      errors_seen: 99,
      commits_made: 99,
    };
    expect(computeStatGains(flooded, 9999 * 60).SNARK).toBe(undefined);
    expect(computeStatGains({ ...ZERO, pets: 2 }, 0).SNARK).toBeCloseTo(0.5);
  });

  test("PATIENCE from a multi-day session is clamped, not unbounded", () => {
    // 10 days of elapsed time must not bank 10 days of patience — capped at
    // PATIENCE_MAX_MINUTES so the +0.05/10min rate tops out (§P0).
    const tenDays = 10 * 24 * 60 * 60;
    const capped = 0.05 * (PATIENCE_MAX_MINUTES / 10);
    expect(computeStatGains(ZERO, tenDays).PATIENCE).toBeCloseTo(capped);
  });

  test("WISDOM rewards a session-over-session drop in mistake rate", () => {
    // Last session ran 2 failures/commit; this one runs 0 → improvement of 2.
    const clean = { ...ZERO, commits_made: 3 };
    const withPrior = computeStatGains(clean, 0, 2).WISDOM ?? 0;
    const noPrior = computeStatGains(clean, 0).WISDOM ?? 0;
    expect(withPrior).toBeGreaterThan(noPrior);
    expect(withPrior).toBeCloseTo(WISDOM_LEARN_RATE * 2); // no all_green floor here
  });

  test("WISDOM ignores a session-over-session rise in mistake rate", () => {
    // This session is worse than last (0 → 2 failures/commit): no learning gain.
    const worse = { ...ZERO, commits_made: 1, tests_failed: 2 };
    expect(computeStatGains(worse, 0, 0).WISDOM).toBe(undefined);
  });
});

describe("sessionErrorRate", () => {
  test("is failures per commit, floored at one commit", () => {
    expect(sessionErrorRate({ ...ZERO, tests_failed: 4, commits_made: 2 })).toBe(
      2,
    );
    // No commits → denominator floors at 1 (the failures still count).
    expect(sessionErrorRate({ ...ZERO, lint_fails: 3 })).toBe(3);
    expect(sessionErrorRate(ZERO)).toBe(0);
  });
});

describe("formatStatUpText / raisedStatNames", () => {
  test("no increments yields no toast and no names", () => {
    expect(formatStatUpText({})).toBe(null);
    expect(formatStatUpText({ DEBUGGING: 0 })).toBe(null);
    expect(raisedStatNames({})).toEqual([]);
  });

  test("a single raise reads as one toast entry", () => {
    expect(formatStatUpText({ DEBUGGING: 1 })).toBe("📈 DEBUGGING +1");
    expect(raisedStatNames({ DEBUGGING: 1 })).toEqual(["DEBUGGING"]);
  });

  test("multiple raises list in canonical order, with amounts", () => {
    // SNARK is declared after DEBUGGING in STAT_NAMES, so it sorts second
    // regardless of insertion order.
    const inc = { SNARK: 2, DEBUGGING: 1 };
    expect(formatStatUpText(inc)).toBe("📈 DEBUGGING +1 · SNARK +2");
    expect(raisedStatNames(inc)).toEqual(["DEBUGGING", "SNARK"]);
  });
});

describe("stingerForCompletion (living-world P1)", () => {
  test("a won fight always fires the victory stinger", () => {
    expect(stingerForCompletion(true, "you squashed the bug", "loot")).toBe(
      "victory",
    );
    expect(stingerForCompletion(true, "you squashed the bug", null)).toBe(
      "victory",
    );
  });

  test("a fled fight fires no stinger, even though it shares celebration kind loot", () => {
    // Regression: pickCelebration's fight branch emits kind "loot" for BOTH
    // win and flee — a flee must not fall through into the lootdash branch
    // just because the kind matches a genuine loot toast.
    expect(
      stingerForCompletion(false, "the bug scuttled off", "loot"),
    ).toBeUndefined();
  });

  test("a genuine loot celebration (no fight this commit) fires lootdash", () => {
    expect(stingerForCompletion(false, null, "loot")).toBe("lootdash");
  });

  test("no fight and no loot celebration fires no stinger", () => {
    expect(stingerForCompletion(false, null, "levelup")).toBeUndefined();
    expect(stingerForCompletion(false, null, undefined)).toBeUndefined();
  });
});

// ─── awardSessionComplete: fightWon (living-world P1, fresh-process) ─────────
//
// state.ts/achievements.ts freeze their STATE_DIR at module load (see the
// state_wander.test.ts and combat.test.ts fresh-process precedents), so
// exercising the real awardSessionComplete → maybeFightBug path needs a
// subprocess with CLAUDE_CONFIG_DIR set before any import. The script fixes
// errorsSeen at a tier-4 spawn (DEBUGGING 50 vs tier 4 ⇒ ~30% win chance,
// from combat.ts's WIN_BASE/TIER_STEP), then only varies the snapshot's
// startedAt per iteration — that value feeds maybeFightBug's seed hash, so a
// short search deterministically turns up both a win and a flee.

describe("awardSessionComplete — fightWon (fresh process)", () => {
  test("reports fightWon true for a winning seed and false for a flee", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-fightwon-proc-"));
    const script = `
      const { saveConfig, saveCompanion } = await import("./server/state.ts");
      const { incrementEvent } = await import("./server/achievements.ts");
      const { awardSessionComplete, saveSnapshot } = await import("./server/session.ts");

      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "fighttest",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });

      const ZERO = {
        all_green: 0, large_diffs: 0, errors_seen: 0, commits_made: 0,
        tests_failed: 0, type_errors: 0, lint_fails: 0, build_fails: 0, pets: 0,
      };
      // One bump to a tier-4 errorsSeen delta; the baseline is pinned to ZERO
      // every iteration below, so this stays constant while startedAt varies.
      incrementEvent("errors_seen", 10);

      let win = null;
      let flee = null;
      for (let t = 0; t < 300 && (win === null || flee === null); t++) {
        saveSnapshot({ startedAt: t, baseline: ZERO });
        const completion = awardSessionComplete();
        if (completion.fightSummary === null) continue;
        if (completion.fightWon && win === null) win = completion;
        if (!completion.fightWon && flee === null) flee = completion;
      }

      console.log(JSON.stringify({ win, flee }));
    `;
    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfgDir,
      };
      delete env.TMUX_PANE; // pin SID to "default" so the snapshot file agrees
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env,
        encoding: "utf8",
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const { win, flee } = JSON.parse(res.stdout.trim().split("\n").pop()!);
      expect(win).not.toBeNull();
      expect(flee).not.toBeNull();
      // Non-tautological: cross-check against the fight's own summary text
      // (combat.ts: a win's summary contains "squashed", a flee's "scuttled
      // off") rather than re-deriving fightWon from itself.
      expect(win.fightWon).toBe(true);
      expect(win.fightSummary).toContain("squashed");
      expect(flee.fightWon).toBe(false);
      expect(flee.fightSummary).toContain("scuttled off");
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});

// ─── maybeFightBug / sightBug — bosses survive commit rebaselining
// (living-world P2 Task 4, G5 revision, fresh-process) ─────────────────────
//
// A boss must persist ACROSS commit boundaries, not just across a single
// commit — that's the entire point of multi-stage bosses. `startedAt`
// (session.ts SessionSnapshot) is NOT a stable "session" identifier: every
// commit's awardSessionComplete rebaselines it to "now" (nowSeconds()), so
// gating boss continuity on `pending.startedAt === startedAt` (the same
// staleness guard `resolveFightBug` uses for an ORDINARY, single-commit
// standoff) breaks the moment any real time passes between commits. Bosses
// are exempt from that guard: they're dismissed only by explicit lifecycle
// events — `startSession`'s unconditional clear (D12; covers both a real
// Claude Code session boundary AND the crash-orphan case the staleness guard
// originally existed for), the `off` gate, and the final-stage kill. Segment
// staleness does not apply to them.
//
// These tests flow entirely through the REAL production path — startSession,
// sightBug, awardSessionComplete, with a genuine `Bun.sleepSync` gap standing
// in for the real minutes a developer spends between commits — never a
// manually pinned `startedAt`/`saveSnapshot`, so a regression of the guard
// removal shows up here exactly as it would in production.
//
// Seed-search technique: unlike the fightWon suite (which varies `startedAt`
// directly), these vary `errorsSeen` per attempt (incrementEvent bumps
// errors_seen by a growing amount each try; awardSessionComplete's baseline
// tracks `current` after every call, so the delta — and thus the seed hash —
// changes attempt to attempt even when `nowSeconds()` doesn't). DEBUGGING 50
// vs tier 4 gives the same ~30% win chance the fightWon suite documents.

describe("bosses survive commit rebaselining (fresh process)", () => {
  function runBossScript(script: string): any {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-boss-rebaseline-proc-"));
    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfgDir,
      };
      delete env.TMUX_PANE; // pin SID to "default" so the snapshot file agrees
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      return JSON.parse(res.stdout.trim().split("\n").pop()!);
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  }

  const SETUP = `
      const { saveConfig, saveCompanion } = await import("./server/state.ts");
      const { incrementEvent, loadGlobalEvents } = await import("./server/achievements.ts");
      const { awardSessionComplete, startSession, sightBug } = await import("./server/session.ts");
      const { readPendingEncounter } = await import("./server/combat.ts");

      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "bosstest",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });

      startSession();
      // 18 errors ⇒ a 3-STAGE boss (BOSS_STAGE2_AT): this leaves a "poke"
      // commit (below) that can legitimately clear a stage WITHOUT risking an
      // accidental kill, isolating the mid-fight persistence proof from the
      // final-stage proof.
      incrementEvent("errors_seen", 18);
      sightBug();
  `;

  test("a mid-fight boss survives a real commit gap, a re-sighting, and lands the kill later", () => {
    const script = `
      ${SETUP}
      const initialPending = readPendingEncounter();

      // Stage 1: search for a WIN by varying errorsSeen per attempt — never
      // startedAt (awardSessionComplete's own trailing saveSnapshot handles
      // that, exactly like a real commit would). This first resolution is
      // undisturbed (no gap yet), so it succeeds identically whether or not
      // the fix is applied — it's the SUBSEQUENT commits that matter.
      let stage1 = null;
      for (let i = 0; i < 500 && stage1 === null; i++) {
        incrementEvent("errors_seen", i + 1);
        const completion = awardSessionComplete();
        if (completion.fightSummary && completion.fightSummary.includes("Stage 1/3")) {
          stage1 = completion;
        }
      }
      const afterStage1 = readPendingEncounter();

      // A real gap — the developer keeps working for over a second before the
      // next commit. No startedAt is ever touched by hand: this is wall-clock
      // time actually elapsing.
      Bun.sleepSync(1100);

      // A "poke" commit: ANY outcome. Its READ still uses the snapshot value
      // frozen since the stage-1 win (pre-gap, so it resolves against the
      // SAME boss correctly either way) — but its own trailing
      // awardSessionComplete rebaseline is the first to capture the POST-GAP
      // wall-clock time, exactly like the very next real commit after a
      // developer's away-from-keyboard gap would. A 3-stage boss can absorb
      // a second win here (stagesCleared 1→2) without risking an accidental
      // kill, so this step can't spuriously "pass" by clearing the standoff.
      incrementEvent("errors_seen", 999);
      awardSessionComplete();
      const afterPoke = readPendingEncounter();

      // Twin-flaw #2 proof: an error event fired right after MUST NOT
      // overwrite the still-alive boss (pendingAction's boss-immutability
      // then yields "noop" — the pips are the only nudge a mid-boss error
      // gets). This is the first read genuinely exercising the post-gap
      // snapshot value against the boss's frozen original startedAt.
      incrementEvent("errors_seen", 3);
      sightBug();
      const afterResight = readPendingEncounter();

      // Twin-flaw #1 proof + the kill: subsequent commits — now permanently
      // past the gap — must keep resolving against the SAME persisted boss
      // through to the final stage, not fall through to a fresh/discarded
      // fight the moment the snapshot has rebaselined past the boss's
      // original sighting time.
      const bossesBeatenBefore = loadGlobalEvents().bosses_beaten;
      let final = null;
      for (let i = 0; i < 500 && final === null; i++) {
        incrementEvent("errors_seen", i + 1);
        const completion = awardSessionComplete();
        if (completion.fightWon) {
          final = completion;
        }
      }
      const bossesBeatenAfter = loadGlobalEvents().bosses_beaten;
      const afterFinal = readPendingEncounter();

      console.log(JSON.stringify({
        initialPending, stage1, afterStage1, afterPoke, afterResight,
        final, afterFinal, bossesBeatenBefore, bossesBeatenAfter,
      }));
    `;
    const out = runBossScript(script);

    expect(out.initialPending.kind).toBe("boss");
    expect(out.initialPending.stages).toBe(3);
    expect(out.initialPending.stagesCleared).toBe(0);

    // Stage 1 win persists the standoff, pips advance, no victory stinger yet.
    expect(out.stage1).not.toBeNull();
    expect(out.stage1.fightWon).toBe(false);
    expect(out.afterStage1.kind).toBe("boss");
    expect(out.afterStage1.stagesCleared).toBe(1);

    // The poke commit (whatever its outcome) leaves it a live, non-final boss.
    expect(out.afterPoke.kind).toBe("boss");
    expect(out.afterPoke.stagesCleared).toBeGreaterThanOrEqual(1);
    expect(out.afterPoke.stagesCleared).toBeLessThan(3);

    // Twin flaw #2: the re-sighting AFTER the gap must NOT overwrite the
    // boss — kind/stagesCleared/caption all unchanged from the poke.
    expect(out.afterResight.kind).toBe("boss");
    expect(out.afterResight.stagesCleared).toBe(out.afterPoke.stagesCleared);
    expect(out.afterResight.caption).toBe(out.afterPoke.caption);

    // Twin flaw #1 + the kill: commits after the gap still resolve against
    // the SAME boss and eventually finish it — the badge counter proves it
    // was the real boss kill, not an ordinary fight that happened to win.
    expect(out.bossesBeatenBefore).toBe(0);
    expect(out.final).not.toBeNull();
    expect(out.final.fightWon).toBe(true);
    expect(out.afterFinal).toBeNull();
    expect(out.bossesBeatenAfter).toBe(1);
  });

  test("a fleeing commit leaves the standoff byte-untouched", () => {
    const script = `
      ${SETUP}
      // Capture "before" on the SAME attempt the flee is detected on — an
      // earlier attempt in the search may legitimately WIN a stage first
      // (that's not what this test is about), which would make a before
      // captured once up front disagree with "after" for the wrong reason.
      let flee = null;
      let before = null;
      let after = null;
      for (let i = 0; i < 500 && flee === null; i++) {
        incrementEvent("errors_seen", i + 1);
        const attemptBefore = readPendingEncounter();
        const completion = awardSessionComplete();
        if (completion.fightSummary && completion.fightSummary.includes("scuttled off")) {
          flee = completion;
          before = attemptBefore;
          after = readPendingEncounter();
        }
      }
      console.log(JSON.stringify({ before, flee, after }));
    `;
    const out = runBossScript(script);
    expect(out.flee).not.toBeNull();
    expect(out.flee.fightWon).toBe(false);
    expect(out.after).toEqual(out.before);
  });

  // Boss look (living-world P2 Task 6): the standoff bakes crowned from the
  // first sighting (proven in combat.test.ts's sighting suite); this proves
  // the OTHER end — the final-stage kill scene, baked separately by
  // resolveCombat inside maybeFightBug — also wears the ♛ look, and that a
  // mid-fight (non-final) stage win never writes an encounter record at all
  // (the standoff persists instead — see the G5 revision above).
  test("the final-stage kill scene also wears the ♛ look (P2 Task 6)", () => {
    const script = `
      ${SETUP}
      const { readEncounter } = await import("./server/combat.ts");
      let final = null;
      for (let i = 0; i < 500 && final === null; i++) {
        incrementEvent("errors_seen", i + 1);
        const completion = awardSessionComplete();
        if (completion.fightWon) final = completion;
      }
      const enc = readEncounter();
      console.log(JSON.stringify({
        final,
        allCrowned: enc ? enc.frames.every((f) => f.includes("\\u265b")) : null,
      }));
    `;
    const out = runBossScript(script);
    expect(out.final).not.toBeNull();
    expect(out.final.fightWon).toBe(true);
    expect(out.allCrowned).toBe(true);
  });

  // The state.ts persistence fix (session.ts sightBug/maybeFightBug) is not
  // the only staleness reader: `writeStatusState`'s pending render branch
  // (state.ts) has its OWN `snap.startedAt === pending.startedAt` guard,
  // independent of session.ts's. A boss can survive in the persisted record
  // (proven above) while STILL failing to render — the standoff would go
  // dark on the status line the moment real time passes after a stage win,
  // even though the underlying fight state is intact. This is the render
  // path award-xp.ts actually drives after every awardSessionComplete call.
  test("a stage win still renders (combatSticky + pips) after a real commit gap", () => {
    const script = `
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      const { saveConfig, saveCompanion, loadCompanion, writeStatusState } =
        await import("./server/state.ts");
      const { incrementEvent } = await import("./server/achievements.ts");
      const { awardSessionComplete, startSession, sightBug } = await import("./server/session.ts");

      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "bosstest",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });

      startSession();
      incrementEvent("errors_seen", 18); // 3-stage boss
      sightBug();

      let stage1 = null;
      for (let i = 0; i < 500 && stage1 === null; i++) {
        incrementEvent("errors_seen", i + 1);
        const completion = awardSessionComplete();
        if (completion.fightSummary && completion.fightSummary.includes("Stage 1/3")) {
          stage1 = completion;
        }
      }

      // A real gap before the NEXT commit — the exact scenario the review
      // proved broken. Sleeping alone doesn't move session.json's on-disk
      // startedAt (nothing writes it while idle); a commit must happen AFTER
      // the gap so ITS OWN trailing rebaseline captures the post-gap
      // wall-clock time, exactly as the very next real commit would.
      Bun.sleepSync(1100);
      incrementEvent("errors_seen", 999);
      awardSessionComplete(); // "poke" commit — any outcome; a 3-stage boss
                               // can absorb a second win here without risking
                               // an accidental kill (see the sibling test).

      // award-xp.ts's session_complete handler calls writeStatusState with
      // the fresh companion immediately after awardSessionComplete returns —
      // reproduce that exact call here, now against the post-gap snapshot.
      const companion = loadCompanion();
      writeStatusState(companion, {});

      const status = JSON.parse(readFileSync(
        join(process.env.CLAUDE_CONFIG_DIR, "buddy-state", "status.json"),
        "utf8",
      ));
      console.log(JSON.stringify({
        stage1,
        hasCombatFrames: Array.isArray(status.combatFrames) && status.combatFrames.length > 0,
        combatSticky: status.combatSticky ?? null,
        captionLine: status.combatFrames?.[0]?.split("\\n")[0]?.trim() ?? null,
      }));
    `;
    const out = runBossScript(script);
    expect(out.stage1).not.toBeNull();
    expect(out.hasCombatFrames).toBe(true);
    expect(out.combatSticky).toBe(1);
    expect(out.captionLine).toMatch(/▰▱/u);
  });
});

// ─── maybeVisitBuddy — wild visitor trigger (living-world P2 Task 7,
// fresh-process) ────────────────────────────────────────────────────────────
//
// Combat always outranks a visitor: `maybeVisitBuddy` rolls ONLY when this
// commit's own fight left the combat slot untouched (fightSummary null) AND
// neither combat side-channel (encounter.json / pending-encounter.json) is
// live. Proved with a seed-search technique like the fightWon suite above
// (never by temporarily lowering VISITOR_ODDS): find a `startedAt` where an
// UNBLOCKED roll genuinely hits, then re-run the SAME startedAt under each
// suppression condition to prove the guard — not just an unlucky miss —
// is what blocks it.

describe("maybeVisitBuddy — wild visitor trigger (living-world P2 Task 7, fresh process)", () => {
  test("suppression matrix: fight present / standoff present / off ⇒ no roll", () => {
    const script = `
      const { saveConfig, saveCompanion } = await import("./server/state.ts");
      const { maybeVisitBuddy } = await import("./server/session.ts");
      const {
        writePendingEncounter, writeEncounter, readVisitor, clearVisitor,
        clearPendingEncounter, bakePendingScene,
      } = await import("./server/combat.ts");

      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "visittest",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });

      // Search for a startedAt where an UNBLOCKED roll hits — same technique
      // the fightWon suite uses (varying the seed input, never the odds).
      let hitStartedAt = null;
      let hitText = null;
      for (let t = 0; t < 3000 && hitStartedAt === null; t++) {
        const text = maybeVisitBuddy(undefined, null, t);
        if (text !== null) {
          hitStartedAt = t;
          hitText = text;
          clearVisitor(); // undo the side effect so the matrix below starts clean
        }
      }

      // "off" ⇒ no roll, even at the known-hit startedAt.
      saveConfig({ gameFeel: "off" });
      const offResult = maybeVisitBuddy(undefined, null, hitStartedAt);
      const offVisitor = readVisitor();
      saveConfig({ gameFeel: "full" });

      // A fight this commit ⇒ no roll (fightSummary non-null).
      const fightResult = maybeVisitBuddy(undefined, "some fight summary", hitStartedAt);
      const fightVisitor = readVisitor();

      // A live standoff ⇒ no roll, even with fightSummary null.
      const scene = bakePendingScene("cactus", "\\u00b7", "dragon", "\\u00b7");
      writePendingEncounter({
        bugId: "segfault_dragon",
        tier: 4,
        frames: scene.frames,
        sequence: scene.sequence,
        sightedAt: Date.now(),
        startedAt: hitStartedAt,
      });
      const standoffResult = maybeVisitBuddy(undefined, null, hitStartedAt);
      const standoffVisitor = readVisitor();
      clearPendingEncounter();

      // A live resolved encounter ⇒ no roll.
      writeEncounter(
        {
          outcome: "win",
          frames: scene.frames,
          sequence: scene.sequence,
          enemyGlyph: "x",
          drop: { points: 0 },
          summary: "",
        },
        "proj",
      );
      const encResult = maybeVisitBuddy(undefined, null, hitStartedAt);
      const encVisitor = readVisitor();

      console.log(JSON.stringify({
        hitStartedAt, hitText,
        offResult, offVisitor,
        fightResult, fightVisitor,
        standoffResult, standoffVisitor,
        encResult, encVisitor,
      }));
    `;
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-visit-trigger-proc-"));
    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfgDir,
      };
      delete env.TMUX_PANE;
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout.trim().split("\n").pop()!);

      // The search found a genuine hit and it wrote the greet scene.
      expect(out.hitStartedAt).not.toBeNull();
      expect(out.hitText).toMatch(/^🐾 a wild \w+ stopped by!( left \d+ pts!)?$/u);

      // Every suppression case: no toast text AND nothing written.
      expect(out.offResult).toBeNull();
      expect(out.offVisitor).toBeNull();
      expect(out.fightResult).toBeNull();
      expect(out.fightVisitor).toBeNull();
      expect(out.standoffResult).toBeNull();
      expect(out.standoffVisitor).toBeNull();
      expect(out.encResult).toBeNull();
      expect(out.encVisitor).toBeNull();
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  test("an unblocked roll persists the greet scene and toast through the real commit path", () => {
    const script = `
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      const { saveConfig, saveCompanion, loadCompanion, writeStatusState, pickCelebration } =
        await import("./server/state.ts");
      const { awardSessionComplete, saveSnapshot } = await import("./server/session.ts");
      const { readVisitor } = await import("./server/combat.ts");

      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "visittest2",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 50, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });

      const ZERO = {
        all_green: 0, large_diffs: 0, errors_seen: 0, commits_made: 0,
        tests_failed: 0, type_errors: 0, lint_fails: 0, build_fails: 0, pets: 0,
      };

      // Search over startedAt via the REAL production entry point — a
      // zero-delta commit never spawns a fight, so fightSummary stays null
      // and the visitor trigger's own conditions are met by construction.
      let hit = null;
      for (let t = 0; t < 3000 && hit === null; t++) {
        saveSnapshot({ startedAt: t, baseline: ZERO });
        const completion = awardSessionComplete();
        if (completion.visitorText !== null) hit = completion;
      }

      const visitor = readVisitor();

      // The search loop above ran the REAL awardSessionComplete many times,
      // which can incidentally trip a genuine streak-milestone loot roll on
      // some iteration (unrelated to the visitor being tested here). Clear
      // any resulting lastDrop so it can't compete for the bubble via
      // buildCelebration's loot side-channel merge and make this assertion
      // flaky — a real concurrent loot drop legitimately outranking a
      // visitor (CELEB_PRIORITY) is exercised separately, not here.
      const { loadLoot, saveLoot } = await import("./server/loot.ts");
      saveLoot({ ...loadLoot(), lastDrop: null });

      // Mirror award-xp.ts's session_complete status write so the render
      // fields land in status.json exactly like production.
      const { celebration } = pickCelebration(
        hit.state.level, false, false, hit.fightSummary, false, "loot",
        null, hit.visitorText,
      );
      const companion = loadCompanion();
      writeStatusState(companion, { celebration, cause: "loot" });

      const status = JSON.parse(readFileSync(
        join(process.env.CLAUDE_CONFIG_DIR, "buddy-state", "status.json"),
        "utf8",
      ));
      console.log(JSON.stringify({
        hitVisitorText: hit.visitorText,
        hitFightSummary: hit.fightSummary,
        visitorCaption: visitor?.caption ?? null,
        visitorFrameCount: visitor?.frames?.length ?? 0,
        celebrationKind: status.celebration?.kind ?? null,
        celebrationText: status.celebration?.text ?? null,
        hasCombatFrames: Array.isArray(status.combatFrames) && status.combatFrames.length > 0,
        combatSticky: status.combatSticky ?? null,
        enemyGlyph: status.enemyGlyph ?? null,
      }));
    `;
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-visit-e2e-proc-"));
    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfgDir,
      };
      delete env.TMUX_PANE;
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout.trim().split("\n").pop()!);

      expect(out.hitFightSummary).toBeNull();
      expect(out.hitVisitorText).toMatch(/^🐾 a wild \w+ stopped by!/u);
      expect(out.visitorCaption).toMatch(/^A wild \w+ stopped by!$/u);
      expect(out.visitorFrameCount).toBeGreaterThan(0);
      // Toast surfaces via the celebration channel (subtle-visible surface).
      expect(out.celebrationKind).toBe("visitor");
      expect(out.celebrationText).toBe(out.hitVisitorText);
      // Scene surfaces via the resolved-phase combat fields — never sticky
      // (that bit is fight-specific).
      expect(out.hasCombatFrames).toBe(true);
      expect(out.combatSticky).toBeNull();
      expect(out.enemyGlyph).toBe("◇");

      // Through the REAL shell (statusline/buddy-status.sh) against the
      // status.json the production write just left in this same
      // CLAUDE_CONFIG_DIR — proves the caption + scene actually render, not
      // just that the server-side fields were set correctly.
      const shellEnv: Record<string, string> = { CLAUDE_CONFIG_DIR: cfgDir };
      for (const k of ["HOME", "PATH", "USER", "LANG", "LC_ALL", "LC_CTYPE"]) {
        if (process.env[k]) shellEnv[k] = process.env[k]!;
      }
      if (!shellEnv.LC_ALL && !shellEnv.LANG && !shellEnv.LC_CTYPE) {
        shellEnv.LC_ALL = "en_US.UTF-8";
      }
      shellEnv.COLUMNS = "125";
      shellEnv.BUDDY_FAKE_COLS = "125";
      const shellScript = join(
        import.meta.dir,
        "..",
        "statusline",
        "buddy-status.sh",
      );
      const shellRes = spawnSync("bash", [shellScript], {
        env: shellEnv,
        input: "",
        encoding: "utf8",
      });
      expect(shellRes.status).toBe(0);
      // eslint-disable-next-line no-control-regex
      const rendered = shellRes.stdout.replace(/\x1b\[[0-9;]*m/g, "");
      expect(rendered).toContain("stopped by!");
      expect(rendered).toContain(out.hitVisitorText.match(/wild (\w+)/u)![1]);
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
