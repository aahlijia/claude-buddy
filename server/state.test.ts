/**
 * Unit tests for the pure string helpers in state.ts.
 *
 * The rest of state.ts is file I/O against ~/.claude-buddy/ and is not
 * covered here — those integration-style cases belong in a separate suite
 * with a proper temp directory. slugify() is a pure function though, so
 * it's easy to pin down.
 */

import { describe, test, expect } from "bun:test";
import {
  slugify,
  raritySetProgress,
  formatRaritySetLine,
  computeXpPct,
  buildCelebration,
  pickCelebration,
  resolveEmotion,
  autoQuietActive,
  autoQuietReasonFor,
  clampGameFeel,
  coerceGameFeel,
  deepFocusActive,
  FOCUS_MIN_SECONDS,
  type Celebration,
  type StatusOpts,
} from "./state.ts";
import { xpForLevel, MAX_LEVEL } from "./xp.ts";
import type { Companion, Rarity } from "./engine.ts";

/** Build a companions record from a list of rarities (other bones irrelevant). */
function companionsWithRarities(
  rarities: Rarity[],
): Record<string, Companion> {
  const out: Record<string, Companion> = {};
  rarities.forEach((rarity, i) => {
    out[`slot${i}`] = { bones: { rarity } } as unknown as Companion;
  });
  return out;
}

describe("slugify", () => {
  test("lowercases input", () => {
    expect(slugify("Sesame")).toBe("sesame");
    expect(slugify("BIG_BUDDY")).toBe("big-buddy");
  });

  test("replaces invalid characters with a dash", () => {
    expect(slugify("hello world")).toBe("hello-world");
    expect(slugify("foo@bar")).toBe("foo-bar");
    expect(slugify("a/b/c")).toBe("a-b-c");
  });

  test("collapses consecutive dashes", () => {
    expect(slugify("foo   bar")).toBe("foo-bar");
    expect(slugify("a!!!b")).toBe("a-b");
  });

  test("trims leading and trailing dashes", () => {
    expect(slugify("---hi---")).toBe("hi");
    expect(slugify("  buddy  ")).toBe("buddy");
  });

  test("truncates to 14 characters", () => {
    const long = "abcdefghijklmnopqrstuvwxyz";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(14);
    expect(result).toBe("abcdefghijklmn");
  });

  test("falls back to 'buddy' for empty or all-invalid input", () => {
    expect(slugify("")).toBe("buddy");
    expect(slugify("!!!")).toBe("buddy");
    expect(slugify("   ")).toBe("buddy");
  });

  test("preserves digits and internal dashes", () => {
    expect(slugify("buddy-2")).toBe("buddy-2");
    expect(slugify("v1-0-3")).toBe("v1-0-3");
  });

  test("unicode / emoji input falls back to 'buddy'", () => {
    expect(slugify("🐢")).toBe("buddy");
    expect(slugify("日本語")).toBe("buddy");
  });
});

describe("raritySetProgress (additional-rewards FR3)", () => {
  test("an empty menagerie owns nothing", () => {
    const p = raritySetProgress({});
    expect(p.ownedCount).toBe(0);
    expect(p.total).toBe(5);
    expect(p.complete).toBe(false);
  });

  test("counts distinct rarities, ignoring duplicates", () => {
    const p = raritySetProgress(
      companionsWithRarities(["common", "common", "rare"]),
    );
    expect(p.owned).toEqual(["common", "rare"]);
    expect(p.ownedCount).toBe(2);
    expect(p.complete).toBe(false);
  });

  test("reports the missing tiers in canonical order", () => {
    const p = raritySetProgress(
      companionsWithRarities(["common", "uncommon", "rare"]),
    );
    expect(p.missing).toEqual(["epic", "legendary"]);
  });

  test("is complete only when all five tiers are present", () => {
    const four = raritySetProgress(
      companionsWithRarities(["common", "uncommon", "rare", "epic"]),
    );
    expect(four.complete).toBe(false);
    expect(four.ownedCount).toBe(4);

    const all = raritySetProgress(
      companionsWithRarities([
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ]),
    );
    expect(all.complete).toBe(true);
    expect(all.missing).toEqual([]);
    expect(all.ownedCount).toBe(5);
  });
});

describe("computeXpPct", () => {
  test("0% at the exact start of a level", () => {
    expect(computeXpPct(5, xpForLevel(5))).toBe(0);
  });

  test("100% at the exact threshold of the next level", () => {
    expect(computeXpPct(5, xpForLevel(6))).toBe(100);
  });

  test("midway through a level rounds to ~50%", () => {
    const lower = xpForLevel(5);
    const upper = xpForLevel(6);
    const mid = Math.round((lower + upper) / 2);
    expect(computeXpPct(5, mid)).toBe(50);
  });

  test("clamps at 100 for MAX_LEVEL (no next threshold)", () => {
    expect(computeXpPct(MAX_LEVEL, xpForLevel(MAX_LEVEL))).toBe(100);
    expect(computeXpPct(MAX_LEVEL, xpForLevel(MAX_LEVEL) + 999_999)).toBe(100);
  });
});

describe("formatRaritySetLine", () => {
  test("lists the missing tiers when incomplete", () => {
    const p = raritySetProgress(companionsWithRarities(["common", "rare"]));
    const line = formatRaritySetLine(p);
    expect(line).toContain("2/5");
    expect(line).toContain("need:");
    expect(line).toContain("uncommon");
    expect(line).toContain("legendary");
  });

  test("reads as complete when the full set is owned", () => {
    const p = raritySetProgress(
      companionsWithRarities([
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ]),
    );
    const line = formatRaritySetLine(p);
    expect(line).toContain("5/5");
    expect(line).toContain("complete");
    expect(line).not.toContain("need:");
  });
});

describe("buildCelebration (game-feel §2/§2.5)", () => {
  const NOW = 1_000_000_000_000; // fixed Date.now()-style ms
  const levelup: Celebration = { text: "✨ LEVEL 7 ✨", kind: "levelup", at: NOW };
  const freshDrop = { label: "a halo", at: Math.floor(NOW / 1000) - 2 };

  test("gameFeel=off suppresses everything, even an explicit celebration", () => {
    const opts: StatusOpts = { celebration: levelup, cause: "levelup" };
    expect(buildCelebration(opts, "off", freshDrop, NOW)).toBeNull();
  });

  test("returns an explicit celebration when subtle/full", () => {
    const opts: StatusOpts = { celebration: levelup, cause: "levelup" };
    expect(buildCelebration(opts, "subtle", null, NOW)).toEqual(levelup);
  });

  test("level-up outranks a concurrent loot drop for the single slot", () => {
    const opts: StatusOpts = { celebration: levelup, cause: "levelup" };
    const got = buildCelebration(opts, "full", freshDrop, NOW);
    expect(got?.kind).toBe("levelup");
  });

  test("surfaces a fresh loot drop when the cause is loot-related", () => {
    const opts: StatusOpts = { cause: "loot" };
    const got = buildCelebration(opts, "full", freshDrop, NOW);
    expect(got?.kind).toBe("loot");
    expect(got?.text).toContain("a halo");
  });

  test("does NOT echo loot on an unrelated tool write (no spurious 🎁)", () => {
    const opts: StatusOpts = { cause: "tool" };
    expect(buildCelebration(opts, "full", freshDrop, NOW)).toBeNull();
  });

  test("ignores a stale loot drop (older than the window)", () => {
    const stale = { label: "a halo", at: Math.floor(NOW / 1000) - 30 };
    const opts: StatusOpts = { cause: "loot" };
    expect(buildCelebration(opts, "full", stale, NOW)).toBeNull();
  });

  test("returns null when there is nothing to show", () => {
    expect(buildCelebration({}, "full", null, NOW)).toBeNull();
  });
});

describe("pickCelebration (award ladder, incl. idle-RPG fight toast)", () => {
  const NOW = 1_000_000_000_000; // fixed Date.now()-style ms
  const FIGHT = "🗡 squashed a null-pointer! +3 pt";

  test("level-up wins the slot over everything else", () => {
    const got = pickCelebration(7, true, true, FIGHT, true, "loot", null, NOW);
    expect(got.celebration?.kind).toBe("levelup");
    expect(got.celebration?.text).toContain("LEVEL 7");
    expect(got.cause).toBe("levelup");
  });

  test("a completed whim beats the fight summary", () => {
    const got = pickCelebration(3, false, true, FIGHT, false, "loot", null, NOW);
    expect(got.celebration?.kind).toBe("whim");
    expect(got.cause).toBe("whim");
  });

  test("the fight summary surfaces as a loot-kind toast (the clobber fix)", () => {
    const got = pickCelebration(3, false, false, FIGHT, false, "loot", null, NOW);
    expect(got.celebration).toEqual({ text: FIGHT, kind: "loot", at: NOW });
    expect(got.cause).toBe("loot");
  });

  test("the fight summary beats the one-time discovery announce", () => {
    const got = pickCelebration(3, false, false, FIGHT, true, "loot", null, NOW);
    expect(got.celebration?.kind).toBe("loot");
    expect(got.celebration?.text).toBe(FIGHT);
  });

  test("discovery surfaces when nothing above claims the bubble", () => {
    const got = pickCelebration(3, false, false, null, true, "loot", null, NOW);
    expect(got.celebration?.kind).toBe("discovery");
    expect(got.cause).toBeUndefined();
  });

  test("falls back to a null celebration with the caller's cause", () => {
    const got = pickCelebration(3, false, false, null, false, "loot", null, NOW);
    expect(got.celebration).toBeNull();
    expect(got.cause).toBe("loot");
  });

  test("a stat-up surfaces when nothing above claims the bubble (P4)", () => {
    const up = "📈 DEBUGGING +1";
    const got = pickCelebration(3, false, false, null, false, "loot", up, NOW);
    expect(got.celebration).toEqual({ text: up, kind: "statup", at: NOW });
    // Fallback cause is preserved so a concurrent loot side-channel still scopes.
    expect(got.cause).toBe("loot");
  });

  test("the one-time discovery outranks a stat-up (P4 is the lowest rung)", () => {
    const got = pickCelebration(
      3,
      false,
      false,
      null,
      true,
      "loot",
      "📈 SNARK +1",
      NOW,
    );
    expect(got.celebration?.kind).toBe("discovery");
  });
});

describe("resolveEmotion (game-feel FR-A4)", () => {
  test("maps known reasons to emotions", () => {
    expect(resolveEmotion("pet", "full")).toBe("happy");
    expect(resolveEmotion("error", "full")).toBe("angry");
    expect(resolveEmotion("test-fail", "full")).toBe("angry");
    expect(resolveEmotion("idle", "subtle")).toBe("bored");
    expect(resolveEmotion("large-diff", "subtle")).toBe("surprised");
  });

  test("unmapped reasons and no reason are neutral", () => {
    expect(resolveEmotion("commit", "full")).toBe("neutral");
    expect(resolveEmotion(undefined, "full")).toBe("neutral");
  });

  test("gameFeel=off forces neutral even for a mapped reason", () => {
    expect(resolveEmotion("pet", "off")).toBe("neutral");
  });
});

describe("autoQuietActive (game-feel FR-E1)", () => {
  test("true for every error-family spike reason", () => {
    for (const reason of [
      "error",
      "test-fail",
      "build-fail",
      "type-error",
      "lint-fail",
    ]) {
      expect(autoQuietActive(reason)).toBe(true);
    }
  });

  test("false for non-spike reasons and absent reactions", () => {
    expect(autoQuietActive("pet")).toBe(false);
    expect(autoQuietActive("idle")).toBe(false);
    expect(autoQuietActive("commit")).toBe(false);
    expect(autoQuietActive("large-diff")).toBe(false);
    expect(autoQuietActive(null)).toBe(false);
    expect(autoQuietActive(undefined)).toBe(false);
    expect(autoQuietActive("")).toBe(false);
  });
});

describe("clampGameFeel (game-feel FR-E1)", () => {
  test("clamps full→subtle only while quiet", () => {
    expect(clampGameFeel("full", true)).toBe("subtle");
  });

  test("never silences the core: subtle/off unchanged while quiet", () => {
    expect(clampGameFeel("subtle", true)).toBe("subtle");
    expect(clampGameFeel("off", true)).toBe("off");
  });

  test("no clamp when not quiet, at any level", () => {
    expect(clampGameFeel("full", false)).toBe("full");
    expect(clampGameFeel("subtle", false)).toBe("subtle");
    expect(clampGameFeel("off", false)).toBe("off");
  });
});

describe("deepFocusActive (game-feel FR-E1 deep-focus)", () => {
  test("true for a long, error-free session", () => {
    expect(
      deepFocusActive({
        sessionElapsedSec: FOCUS_MIN_SECONDS,
        hasFreshError: false,
      }),
    ).toBe(true);
    expect(
      deepFocusActive({
        sessionElapsedSec: FOCUS_MIN_SECONDS + 600,
        hasFreshError: false,
      }),
    ).toBe(true);
  });

  test("false before the focus threshold", () => {
    expect(
      deepFocusActive({
        sessionElapsedSec: FOCUS_MIN_SECONDS - 1,
        hasFreshError: false,
      }),
    ).toBe(false);
    expect(
      deepFocusActive({ sessionElapsedSec: 0, hasFreshError: false }),
    ).toBe(false);
  });

  test("a fresh error overrides deep focus (the spike path handles it)", () => {
    expect(
      deepFocusActive({
        sessionElapsedSec: FOCUS_MIN_SECONDS + 9999,
        hasFreshError: true,
      }),
    ).toBe(false);
  });

  test("no session snapshot ⇒ never deep focus", () => {
    expect(
      deepFocusActive({ sessionElapsedSec: null, hasFreshError: false }),
    ).toBe(false);
  });
});

describe("autoQuietReasonFor (pure core of the auto-quiet clamp)", () => {
  test("an error-family reason reports error-spike, regardless of focus", () => {
    expect(autoQuietReasonFor("error", false, null)).toBe("error-spike");
    expect(
      autoQuietReasonFor("test-fail", true, FOCUS_MIN_SECONDS + 100),
    ).toBe("error-spike");
  });

  test("deep focus only with the opt-in AND a long session", () => {
    expect(
      autoQuietReasonFor(undefined, true, FOCUS_MIN_SECONDS),
    ).toBe("deep-focus");
    expect(
      autoQuietReasonFor(undefined, false, FOCUS_MIN_SECONDS),
    ).toBeNull();
    expect(
      autoQuietReasonFor(undefined, true, FOCUS_MIN_SECONDS - 1),
    ).toBeNull();
    expect(autoQuietReasonFor(undefined, true, null)).toBeNull();
  });

  test("a non-spike reason does not clamp", () => {
    expect(autoQuietReasonFor("pet", false, null)).toBeNull();
  });
});

describe("coerceGameFeel", () => {
  test("passes valid levels through", () => {
    expect(coerceGameFeel("off")).toBe("off");
    expect(coerceGameFeel("subtle")).toBe("subtle");
    expect(coerceGameFeel("full")).toBe("full");
  });

  test("coerces anything else to the documented default (mirrors bash)", () => {
    expect(coerceGameFeel("loud")).toBe("subtle");
    expect(coerceGameFeel("")).toBe("subtle");
    expect(coerceGameFeel(undefined)).toBe("subtle");
    expect(coerceGameFeel(3)).toBe("subtle");
    expect(coerceGameFeel(true)).toBe("subtle");
  });
});
