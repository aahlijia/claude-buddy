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
});
