import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

import type { Companion } from "./engine.ts";
import type { LootCosmetic } from "./loot.ts";
import type { UpgradeEffect, XpState } from "./xp.ts";
import {
  lootGrantedAppearance,
  rebaseCompanionBones,
  migrateUpgradeEffects,
} from "./migrate.ts";

function bones(overrides: Partial<Companion["bones"]> = {}) {
  return {
    rarity: "common" as const,
    species: "cactus" as const,
    eye: "·" as const,
    hat: "none" as const,
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    peak: "SNARK" as const,
    dump: "WISDOM" as const,
    ...overrides,
  };
}

function companion(overrides: Partial<Companion["bones"]> = {}): Companion {
  return {
    name: "test",
    personality: "",
    hatchedAt: 0,
    userId: "u",
    bones: bones(overrides),
  };
}

// ─── lootGrantedAppearance (pure) ──────────────────────────────────────────────

const CATALOG: LootCosmetic[] = [
  {
    id: "loot_wizard_hat",
    category: "cosmetic",
    flavorText: "",
    apply: (c) => {
      c.bones.hat = "wizard";
    },
  },
  {
    id: "loot_aurora",
    category: "cosmetic",
    flavorText: "",
    apply: (c) => {
      c.bones.shiny = true;
    },
  },
  {
    id: "loot_starlit_eyes",
    category: "cosmetic",
    flavorText: "",
    apply: (c) => {
      c.bones.eye = "✦";
    },
  },
];

describe("lootGrantedAppearance", () => {
  test("finds hats and shiny granted by owned loot cosmetics", () => {
    const r = lootGrantedAppearance(["loot_wizard_hat", "loot_aurora"], CATALOG);
    expect(r.lootHats.has("wizard")).toBe(true);
    expect(r.lootShiny).toBe(true);
  });

  test("ignores unowned and no-appearance cosmetics", () => {
    const r = lootGrantedAppearance(["loot_starlit_eyes"], CATALOG);
    expect(r.lootHats.size).toBe(0);
    expect(r.lootShiny).toBe(false);
  });

  test("empty when nothing owned", () => {
    const r = lootGrantedAppearance([], CATALOG);
    expect(r.lootHats.size).toBe(0);
    expect(r.lootShiny).toBe(false);
  });
});

// ─── rebaseCompanionBones (pure) ────────────────────────────────────────────────

describe("rebaseCompanionBones", () => {
  const hatEffect: UpgradeEffect = { type: "hat", hat: "crown" };
  const statEffect: UpgradeEffect = { type: "stat", amount: 5 };

  test("strips an owned-upgrade hat back to none", () => {
    const c = companion({ hat: "crown" });
    rebaseCompanionBones(c, false, [hatEffect], false, new Set());
    expect(c.bones.hat).toBe("none");
  });

  test("keeps the hat when an owned loot cosmetic also grants it", () => {
    const c = companion({ hat: "crown" });
    rebaseCompanionBones(c, false, [hatEffect], false, new Set(["crown"]));
    expect(c.bones.hat).toBe("crown");
  });

  test("leaves a hat untouched when it isn't an owned upgrade's hat", () => {
    const c = companion({ hat: "tophat" });
    rebaseCompanionBones(c, false, [hatEffect], false, new Set());
    expect(c.bones.hat).toBe("tophat");
  });

  test("undoes the aura's shiny only when currently shiny", () => {
    const shinyC = companion({ shiny: true });
    rebaseCompanionBones(shinyC, true, [], false, new Set());
    expect(shinyC.bones.shiny).toBe(false);

    const notShinyC = companion({ shiny: false });
    rebaseCompanionBones(notShinyC, true, [], false, new Set());
    expect(notShinyC.bones.shiny).toBe(false);
  });

  test("leaves shiny untouched when stripAuraShiny is false (loot-protected or no aura flag)", () => {
    const c = companion({ shiny: true });
    rebaseCompanionBones(c, false, [], false, new Set());
    expect(c.bones.shiny).toBe(true);
  });

  test("subtracts owned stat effects only on the active slot", () => {
    const active = companion({ peak: "SNARK", stats: { ...bones().stats, SNARK: 76 } });
    rebaseCompanionBones(active, false, [statEffect], true, new Set());
    expect(active.bones.stats.SNARK).toBe(71);

    const benched = companion({ peak: "SNARK", stats: { ...bones().stats, SNARK: 76 } });
    rebaseCompanionBones(benched, false, [statEffect], false, new Set());
    expect(benched.bones.stats.SNARK).toBe(76); // grandfathered, untouched
  });

  test("stat subtraction clamps at 1, never goes to 0 or negative", () => {
    const c = companion({ peak: "SNARK", stats: { ...bones().stats, SNARK: 3 } });
    rebaseCompanionBones(c, false, [statEffect], true, new Set());
    expect(c.bones.stats.SNARK).toBe(1);
  });
});

// ─── migrateUpgradeEffects (pure state half — no companion store) ─────────────

function makeXpState(partial: Partial<XpState>): XpState {
  return {
    totalXp: 0,
    level: 1,
    unlockedReactions: [],
    unlockedUpgrades: [],
    cosmeticFlags: [],
    levelUpAchieved: false,
    statProgress: {},
    pointsTotal: 0,
    pointsSpent: 0,
    bonusPoints: 0,
    collectionMultiplier: 1.0,
    respecLockedAt: null,
    title: null,
    prestigeLevel: 0,
    prestigeMultiplier: 1.0,
    equipment: {},
    inventory: [],
    upgradeEffectsDerived: false,
    ...partial,
  };
}

describe("migrateUpgradeEffects (no companion store present)", () => {
  test("is a no-op once already derived", () => {
    const s = makeXpState({ upgradeEffectsDerived: true, cosmeticFlags: ["x"] });
    expect(migrateUpgradeEffects(s)).toBe(s); // same reference — true no-op
  });

  test("strips owned-flag markers from cosmeticFlags and sets the marker", () => {
    const s = makeXpState({
      unlockedUpgrades: ["bonus_eye"], // effect: {type:"flag", flag:"has_third_eye"}
      cosmeticFlags: ["has_third_eye", "unrelated"],
    });
    const migrated = migrateUpgradeEffects(s);
    expect(migrated.upgradeEffectsDerived).toBe(true);
    expect(migrated.cosmeticFlags).toEqual(["unrelated"]);
  });

  test("strips the aura_shiny marker when no loot cosmetic protects it (no loot store => not shiny)", () => {
    // migrateUpgradeEffects consults the REAL loot store (loadLoot) to decide
    // whether a loot cosmetic protects the marker. In-process that's the
    // ambient config dir — on a machine whose store owns a shiny cosmetic the
    // marker is (correctly) kept and this expectation flips. A fresh
    // subprocess with a temp CLAUDE_CONFIG_DIR guarantees the empty store the
    // test name promises (same isolation idiom as the suite below).
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-migrate-shiny-"));
    const script = `
      const { migrateUpgradeEffects } = await import("./server/migrate.ts");
      const { backfillXpState } = await import("./server/xp.ts");
      const s = backfillXpState({
        unlockedUpgrades: ["shiny_aura"],
        cosmeticFlags: ["aura_shiny"],
      });
      const migrated = migrateUpgradeEffects(s);
      console.log(JSON.stringify({ cosmeticFlags: migrated.cosmeticFlags }));
    `;
    try {
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
        encoding: "utf8",
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout.trim());
      expect(out.cosmeticFlags).toEqual([]);
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});

// ─── Fresh-process: the real companion-store rebase path ───────────────────────
//
// state.ts freezes its state dir at module load, so exercising real companion
// slots needs a subprocess whose CLAUDE_CONFIG_DIR is set before any import
// (the same isolation idiom as loot.test.ts's fresh-process suite).

describe("migrateUpgradeEffects (fresh process, real companion store)", () => {
  test("rebases active + benched slots, is idempotent, and skips crash-flagged slots", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-migrate-proc-"));
    const script = `
      const { saveCompanionSlot, loadCompanionSlot, updateCompanionSlot } =
        await import("./server/state.ts");
      const { migrateUpgradeEffects } = await import("./server/migrate.ts");
      const { backfillXpState } = await import("./server/xp.ts");

      const mkBones = (overrides) => ({
        species: "cactus", rarity: "common", eye: "\\u00b7", hat: "crown",
        shiny: true, peak: "SNARK", dump: "WISDOM",
        stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 5, SNARK: 76 },
        ...overrides,
      });

      // "buddy" is active by default (first slot saved); "bench" is not.
      saveCompanionSlot(
        { name: "buddy", personality: "", hatchedAt: 0, userId: "u", bones: mkBones({}) },
        "buddy",
      );
      saveCompanionSlot(
        {
          name: "bench", personality: "", hatchedAt: 0, userId: "u",
          bones: mkBones({ shiny: false, stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 5, SNARK: 50 } }),
        },
        "bench",
      );

      const legacy = backfillXpState({
        totalXp: 0,
        unlockedUpgrades: ["stat_boost", "crown", "shiny_aura", "beanie"],
        cosmeticFlags: ["aura_shiny", "beanie"],
      });
      const migrated = migrateUpgradeEffects(legacy);

      const buddyAfter = loadCompanionSlot("buddy");
      const benchAfter = loadCompanionSlot("bench");

      const firstRun = {
        upgradeEffectsDerived: migrated.upgradeEffectsDerived,
        cosmeticFlags: migrated.cosmeticFlags,
        buddyHat: buddyAfter.bones.hat,
        buddyShiny: buddyAfter.bones.shiny,
        buddyStat: buddyAfter.bones.stats.SNARK,
        buddyRebased: buddyAfter.effectsRebased,
        benchHat: benchAfter.bones.hat,
        benchShiny: benchAfter.bones.shiny,
        benchStat: benchAfter.bones.stats.SNARK, // grandfathered — untouched
        benchRebased: benchAfter.effectsRebased,
      };

      // Idempotence: re-running against the now-migrated state changes nothing.
      const secondRun = migrateUpgradeEffects(migrated);
      const buddyAfterSecond = loadCompanionSlot("buddy");
      const idempotent = {
        sameRef: secondRun === migrated,
        buddyStatUnchanged: buddyAfterSecond.bones.stats.SNARK === buddyAfter.bones.stats.SNARK,
      };

      // Crash simulation: a fresh legacy state (marker false) where "bench"
      // was already flagged effectsRebased (as if a prior run crashed after
      // persisting it but before setting the xp-state marker) must be skipped
      // — while an unflagged slot in the same run still gets processed.
      saveCompanionSlot(
        { name: "fresh", personality: "", hatchedAt: 0, userId: "u", bones: mkBones({}) },
        "fresh",
      );
      const preFlaggedBench = { ...benchAfter, effectsRebased: true, bones: { ...benchAfter.bones, hat: "crown" } };
      updateCompanionSlot("bench", preFlaggedBench);
      const crashState = backfillXpState({
        totalXp: 0,
        unlockedUpgrades: ["crown"],
        cosmeticFlags: [],
      });
      migrateUpgradeEffects(crashState);
      const crashSim = {
        benchHatSkipped: loadCompanionSlot("bench").bones.hat, // untouched — still "crown"
        freshHatProcessed: loadCompanionSlot("fresh").bones.hat, // reset to "none"
      };

      console.log(JSON.stringify({ firstRun, idempotent, crashSim }));
    `;
    try {
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
        encoding: "utf8",
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout.trim());

      // (a)/(c) hat reset — crown isn't loot-granted, so both slots lose it.
      expect(out.firstRun.buddyHat).toBe("none");
      expect(out.firstRun.benchHat).toBe("none");
      // shiny undone only where it was actually true (buddy).
      expect(out.firstRun.buddyShiny).toBe(false);
      expect(out.firstRun.benchShiny).toBe(false);
      // (b) stat subtraction only on the active slot (buddy); bench grandfathered.
      expect(out.firstRun.buddyStat).toBe(71); // 76 - 5
      expect(out.firstRun.benchStat).toBe(50); // untouched
      // (d) markers set.
      expect(out.firstRun.upgradeEffectsDerived).toBe(true);
      expect(out.firstRun.buddyRebased).toBe(true);
      expect(out.firstRun.benchRebased).toBe(true);
      // owned-flag stripping (beanie) + aura_shiny marker, both removed.
      expect(out.firstRun.cosmeticFlags).toEqual([]);

      // (e) idempotence.
      expect(out.idempotent.sameRef).toBe(true);
      expect(out.idempotent.buddyStatUnchanged).toBe(true);

      // (f) crash simulation — pre-flagged slot skipped, fresh slot processed.
      expect(out.crashSim.benchHatSkipped).toBe("crown");
      expect(out.crashSim.freshHatProcessed).toBe("none");
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
