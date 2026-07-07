/**
 * Tests for cosmetic sets (game-feel FR-C1).
 *
 * memberMet / setProgress / formatSetsLines are pure (stub state + companion).
 * Post design-derive-upgrades.md (D4), memberMet reads the *resolved*
 * appearance — an owned upgrade or an equipped item satisfies a member the
 * same as an innate bones value.
 *
 * grantCompletedSetTitle persists a title via xp.ts, so it runs against a temp
 * CLAUDE_CONFIG_DIR.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  memberMet,
  setProgress,
  formatSetsLines,
  grantCompletedSetTitle,
} from "./sets.ts";
import { getXpState, grantCosmeticFlag } from "./xp.ts";
import type { XpState } from "./xp.ts";
import type { Companion } from "./engine.ts";
import type { Equipment } from "./items.ts";

function stateWith(
  flags: string[],
  overrides: Partial<XpState> = {},
): XpState {
  return {
    cosmeticFlags: flags,
    title: null,
    unlockedUpgrades: [],
    equipment: {},
    ...overrides,
  } as unknown as XpState;
}

function compWith(hat: string, overrides: Partial<Companion["bones"]> = {}): Companion {
  return {
    bones: {
      rarity: "common",
      species: "cactus",
      eye: "·",
      hat,
      shiny: false,
      stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
      peak: "SNARK",
      dump: "WISDOM",
      ...overrides,
    },
  } as unknown as Companion;
}

describe("memberMet / setProgress (pure)", () => {
  test("a flag member is met by cosmeticFlags; a hat member by the worn hat", () => {
    expect(memberMet("glow", stateWith(["glow"]), compWith("none"))).toBe(true);
    expect(memberMet("glow", stateWith([]), compWith("none"))).toBe(false);
    expect(memberMet("hat:wizard", stateWith([]), compWith("wizard"))).toBe(true);
    expect(memberMet("hat:wizard", stateWith([]), compWith("crown"))).toBe(false);
  });

  test("the Arcane set completes with wizard hat + glow + constellation", () => {
    const progress = setProgress(
      stateWith(["glow", "constellation"]),
      compWith("wizard"),
    );
    const arcane = progress.find((p) => p.set.id === "arcane")!;
    expect(arcane.have).toBe(3);
    expect(arcane.complete).toBe(true);
  });

  test("formatSetsLines hides untouched sets and marks complete ones", () => {
    const lines = formatSetsLines(
      stateWith(["glow", "constellation"]),
      compWith("wizard"),
    );
    expect(lines.join("\n")).toContain("Arcane");
    expect(lines.join("\n")).toContain("«Arcanist»");
  });

  // ── Derive-on-read (design-derive-upgrades.md D4) ──────────────────────────

  test("hat:crown is met via an owned crown upgrade (no bones mutation needed)", () => {
    const state = stateWith([], { unlockedUpgrades: ["crown"] });
    expect(memberMet("hat:crown", state, compWith("none"))).toBe(true);
  });

  test("hat:crown is met via an equipped crown-hat item", () => {
    const equipment: Equipment = { headgear: "compiler_crown" };
    const state = stateWith([], { equipment });
    expect(memberMet("hat:crown", state, compWith("none"))).toBe(true);
  });

  test("hat:crown is unmet after a refund (ownership removed, nothing to revert)", () => {
    // A refund is just dropping the id — no bones mutation exists to undo.
    const state = stateWith([], { unlockedUpgrades: [] });
    expect(memberMet("hat:crown", state, compWith("none"))).toBe(false);
  });

  test("aura_shiny is met via an owned shiny_aura upgrade", () => {
    const state = stateWith([], { unlockedUpgrades: ["shiny_aura"] });
    expect(memberMet("aura_shiny", state, compWith("none", { shiny: false }))).toBe(
      true,
    );
  });

  test("with no companion, hat members are unmet but owned-upgrade flags still are", () => {
    const state = stateWith([], { unlockedUpgrades: ["shiny_aura"] });
    expect(memberMet("hat:crown", state, null)).toBe(false);
    expect(memberMet("aura_shiny", state, null)).toBe(true);
  });
});

describe("grantCompletedSetTitle (temp dir)", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-sets-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("grants the set title once, then is a no-op", () => {
    grantCosmeticFlag("glow");
    grantCosmeticFlag("constellation");
    const companion = compWith("wizard");

    const granted = grantCompletedSetTitle(getXpState(), companion);
    expect(granted).toBe("Arcanist");
    expect(getXpState().title).toBe("Arcanist");

    // Already worn → no re-grant.
    expect(grantCompletedSetTitle(getXpState(), companion)).toBeNull();
  });

  test("does not grant when the set is incomplete", () => {
    grantCosmeticFlag("glow"); // missing constellation + wizard hat
    expect(grantCompletedSetTitle(getXpState(), compWith("none"))).toBeNull();
    expect(getXpState().title).toBeNull();
  });
});
