/**
 * Unit tests for the pure session-bonus helpers in session.ts.
 *
 * The snapshot I/O and the awardSessionComplete orchestration touch the
 * filesystem and the XP store, so they belong in an integration suite with a
 * temp state dir. The bonus math and the counter diff are pure and pinned here.
 */

import { describe, test, expect } from "bun:test";
import {
  computeSessionBonus,
  counterDelta,
  combatErrorCount,
  computeStatGains,
  sessionErrorRate,
  formatStatUpText,
  raisedStatNames,
  pendingAction,
  SESSION_BASE_BONUS,
  SESSION_BONUS_CAP,
  PATIENCE_MAX_MINUTES,
  WISDOM_LEARN_RATE,
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
