/**
 * Tests for milestone loot boxes (additional-rewards FR4).
 *
 * The cosmetic `apply` functions are pure and pinned directly. rollLoot touches
 * the filesystem (loot.json + the durable bonus-point grant in xp.json), so it
 * runs against a temp CLAUDE_CONFIG_DIR — both loot.ts and xp.ts resolve their
 * state files at call time, so per-test env keeps each case hermetic.
 *
 * Safety: rollLoot is always called with an explicit, non-existent slot. The
 * companion store (state.ts) freezes its directory at module load, so a cosmetic
 * drop's companion lookup would otherwise hit the real profile — a missing slot
 * makes that lookup a pure read that returns null, so no real state is mutated.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  rollLoot,
  loadLoot,
  saveLoot,
  recentLoot,
  describeLootEntry,
  LOOT_COSMETICS,
  LOOT_COSMETIC_CHANCE,
  LOOT_BONUS_POINTS,
  LOOT_LOG_CAP,
} from "./loot.ts";
import { getXpState } from "./xp.ts";
import type { Companion } from "./engine.ts";

/** A slot that does not exist, so the companion lookup is a safe no-op read. */
const FAKE_SLOT = "loot-test-nonexistent-slot";

/** Minimal companion stub for testing cosmetic `apply` effects. */
function stubCompanion(): Companion {
  return {
    bones: { eye: "·", hat: "none", shiny: false },
  } as unknown as Companion;
}

// ─── Pure: cosmetic apply effects ─────────────────────────────────────────────

describe("LOOT_COSMETICS", () => {
  test("every loot-exclusive cosmetic is category cosmetic (game-feel FR-D1)", () => {
    expect(LOOT_COSMETICS.length).toBeGreaterThanOrEqual(6);
    for (const c of LOOT_COSMETICS) expect(c.category).toBe("cosmetic");
  });

  test("ids are unique", () => {
    const ids = LOOT_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each carries flavor text and an apply effect", () => {
    for (const c of LOOT_COSMETICS) {
      expect(c.flavorText.length).toBeGreaterThan(0);
      expect(typeof c.apply).toBe("function");
    }
  });

  test("describeLootEntry labels points and cosmetics", () => {
    expect(
      describeLootEntry({ id: "points", grantedAt: 0, trigger: "level_up" }),
    ).toBe(`+${LOOT_BONUS_POINTS} pt`);

    const cos = LOOT_COSMETICS[0];
    expect(
      describeLootEntry({ id: cos.id, grantedAt: 0, trigger: "ascension" }),
    ).toBe(cos.flavorText);

    // Unknown id falls back to the id itself (forward-compat).
    expect(
      describeLootEntry({ id: "mystery", grantedAt: 0, trigger: "achievement" }),
    ).toBe("mystery");
  });

  test("apply mutates the expected bones field", () => {
    const byId = (id: string) => LOOT_COSMETICS.find((c) => c.id === id)!;

    const eyes = stubCompanion();
    byId("loot_starlit_eyes").apply(eyes);
    expect(eyes.bones.eye).toBe("✦");

    const aurora = stubCompanion();
    byId("loot_aurora").apply(aurora);
    expect(aurora.bones.shiny).toBe(true);

    const wizard = stubCompanion();
    byId("loot_wizard_hat").apply(wizard);
    expect(wizard.bones.hat).toBe("wizard");

    // The "otherwise unreachable" combo sets two fields at once.
    const combo = stubCompanion();
    byId("loot_cosmic_static").apply(combo);
    expect(combo.bones.shiny).toBe(true);
    expect(combo.bones.eye).toBe("@");
  });
});

// ─── rollLoot (filesystem-backed) ─────────────────────────────────────────────

describe("rollLoot", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-loot-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("always grants the deterministic point, even with no cosmetic", () => {
    const drop = rollLoot("level_up", FAKE_SLOT, () => 0.99); // above the chance
    expect(drop.bonusPoints).toBe(LOOT_BONUS_POINTS);
    expect(drop.cosmetic).toBeNull();
    // The point is durable in xp.json.
    expect(getXpState().bonusPoints).toBe(LOOT_BONUS_POINTS);
  });

  test("the deterministic point accumulates across rolls", () => {
    rollLoot("level_up", FAKE_SLOT, () => 0.99);
    rollLoot("achievement", FAKE_SLOT, () => 0.99);
    rollLoot("streak_milestone", FAKE_SLOT, () => 0.99);
    expect(getXpState().bonusPoints).toBe(3 * LOOT_BONUS_POINTS);
  });

  test("degrades to points-only when no companion can receive the cosmetic", () => {
    // The roll lands under the chance, but the slot doesn't exist: the drop
    // must not count — the cosmetic stays in the pool for a later roll instead
    // of being marked owned without ever having been applied.
    const drop = rollLoot("ascension", FAKE_SLOT, () => 0);
    expect(drop.cosmetic).toBeNull();
    expect(drop.bonusPoints).toBe(LOOT_BONUS_POINTS);
    expect(loadLoot().ownedLootCosmetics).toEqual([]);
    expect(loadLoot().log.at(-1)!.id).toBe("points");
  });

  test("a roll at/above the 12% threshold never attempts a cosmetic", () => {
    const at = rollLoot("level_up", FAKE_SLOT, () => LOOT_COSMETIC_CHANCE);
    expect(at.cosmetic).toBeNull();
  });

  test("never grants an already-owned cosmetic (point only instead)", () => {
    // Pre-own every cosmetic, then force the cosmetic branch.
    saveLoot({
      log: [],
      ownedLootCosmetics: LOOT_COSMETICS.map((c) => c.id),
    });
    const drop = rollLoot("level_up", FAKE_SLOT, () => 0);
    expect(drop.cosmetic).toBeNull();
    expect(drop.bonusPoints).toBe(LOOT_BONUS_POINTS); // still gets the point
    expect(loadLoot().log.at(-1)!.id).toBe("points");
  });

  test("tags the log entry with the trigger type", () => {
    rollLoot("streak_milestone", FAKE_SLOT, () => 0.99);
    const last = loadLoot().log.at(-1)!;
    expect(last.trigger).toBe("streak_milestone");
    expect(last.id).toBe("points");
    expect(last.grantedAt).toBeGreaterThan(0);
  });

  test("sets lastDrop on a points-only roll (game-feel FR-A2, never silent)", () => {
    rollLoot("level_up", FAKE_SLOT, () => 0.99); // no cosmetic
    const last = loadLoot().lastDrop!;
    expect(last).toBeTruthy();
    expect(last.label).toContain("pt");
    expect(last.at).toBeGreaterThan(0);
  });

  test("caps the log at the most-recent LOOT_LOG_CAP entries", () => {
    for (let i = 0; i < LOOT_LOG_CAP + 5; i++) {
      rollLoot("level_up", FAKE_SLOT, () => 0.99);
    }
    expect(loadLoot().log.length).toBe(LOOT_LOG_CAP);
  });

  test("recentLoot returns the newest entries (newest last)", () => {
    rollLoot("level_up", FAKE_SLOT, () => 0.99);
    rollLoot("achievement", FAKE_SLOT, () => 0.99);
    rollLoot("ascension", FAKE_SLOT, () => 0.99);
    const recent = recentLoot(2);
    expect(recent.length).toBe(2);
    expect(recent[1].trigger).toBe("ascension");
  });

  test("an absent loot.json loads as an empty state", () => {
    expect(loadLoot()).toEqual({ log: [], ownedLootCosmetics: [], lastDrop: null });
  });
});

// ─── Fresh-process: the real companion apply path ─────────────────────────────
//
// state.ts freezes its state dir at module load, so exercising a REAL slot
// needs a subprocess whose CLAUDE_CONFIG_DIR is set before any import (the same
// isolation idiom as the renderer's spawnSync tests). Regression: rollLoot used
// to persist the applied cosmetic via the append-only saveCompanionSlot, which
// THROWS for an existing slot — so every cosmetic drop on a live buddy crashed
// (unhandled at the streak-milestone call site) and the cosmetic was lost.

describe("rollLoot cosmetic apply (fresh process)", () => {
  test("applies + persists to an existing companion and records the drop", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-loot-proc-"));
    const script = `
      const { saveCompanionSlot, loadCompanionSlot } = await import("./server/state.ts");
      const { rollLoot, loadLoot, LOOT_COSMETIC_CHANCE } = await import("./server/loot.ts");
      const companion = {
        name: "loottest",
        personality: "",
        bones: {
          species: "blob", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      };
      saveCompanionSlot(companion, "loottest");
      const drop = rollLoot("level_up", "loottest", () => 0);
      const afterDrop = loadLoot();
      const missed = rollLoot("level_up", "loottest", () => LOOT_COSMETIC_CHANCE);
      console.log(JSON.stringify({
        droppedId: drop.cosmetic?.id ?? null,
        lastDropLabel: afterDrop.lastDrop?.label ?? null,
        loggedId: afterDrop.log.at(-1)?.id ?? null,
        missedId: missed.cosmetic?.id ?? null,
        eye: loadCompanionSlot("loottest").bones.eye,
      }));
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
      // rng () => 0 picks the first pool entry: loot_starlit_eyes (eye ✦),
      // applied to the companion and persisted through updateCompanionSlot.
      expect(out.droppedId).toBe("loot_starlit_eyes");
      expect(out.eye).toBe("✦");
      // The drop is logged under its id and surfaces as the toast label.
      expect(out.loggedId).toBe("loot_starlit_eyes");
      expect(out.lastDropLabel).toBe("Eyes like distant stars.");
      // A roll at the threshold drops nothing (the 12% bound is exclusive).
      expect(out.missedId).toBeNull();
      // …and the owned list marks the cosmetic so it never re-drops.
      const loot = JSON.parse(
        readFileSync(join(cfgDir, "buddy-state", "loot.json"), "utf8"),
      );
      expect(loot.ownedLootCosmetics).toEqual(["loot_starlit_eyes"]);
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
