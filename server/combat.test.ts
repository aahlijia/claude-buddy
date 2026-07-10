import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import { mulberry32, type BuddyBones } from "./engine";
import { displayWidth, getArtFrame, mirrorFrame } from "./art";
import type { Equipment } from "./items";
import type { Bug } from "./bugs";
import { buddyStateDir } from "./path";
import {
  WIN_CEIL,
  WIN_FLOOR,
  bakePendingScene,
  clearPendingEncounter,
  readPendingEncounter,
  resolveCombat,
  winChance,
  writePendingEncounter,
  type PendingEncounter,
} from "./combat";

function bones(debug: number, overrides: Partial<BuddyBones> = {}): BuddyBones {
  return {
    rarity: "common",
    species: "cactus",
    eye: "·",
    hat: "none",
    shiny: false,
    stats: { DEBUGGING: debug, PATIENCE: 40, CHAOS: 30, WISDOM: 20, SNARK: 50 },
    peak: "DEBUGGING",
    dump: "WISDOM",
    ...overrides,
  };
}

const t1: Bug = { id: "x", name: "typo gremlin", glyph: "🐛", tier: 1, reward: 1, species: "blob" };
const t4: Bug = { id: "y", name: "segfault dragon", glyph: "🐉", tier: 4, reward: 5, species: "dragon" };

/** Win frequency over many seeds — Monte-Carlo the deterministic resolver. */
function winRate(b: BuddyBones, bug: Bug, eq: Equipment, n = 400): number {
  let wins = 0;
  for (let s = 0; s < n; s++) {
    if (resolveCombat(b, bug, eq, s).outcome === "win") wins++;
  }
  return wins / n;
}

describe("winChance", () => {
  test("rises with DEBUGGING, falls with tier", () => {
    expect(winChance(80, false, 1)).toBeGreaterThan(winChance(20, false, 1));
    expect(winChance(50, false, 4)).toBeLessThan(winChance(50, false, 1));
  });

  test("an equipped weapon helps", () => {
    expect(winChance(50, true, 2)).toBeGreaterThan(winChance(50, false, 2));
  });

  test("clamped to [floor, ceil]", () => {
    expect(winChance(1000, true, 1)).toBeLessThanOrEqual(WIN_CEIL);
    expect(winChance(0, false, 4)).toBeGreaterThanOrEqual(WIN_FLOOR);
  });
});

describe("resolveCombat", () => {
  test("is deterministic for a given seed", () => {
    const a = resolveCombat(bones(50), t1, {}, 42);
    const b = resolveCombat(bones(50), t1, {}, 42);
    expect(a.outcome).toBe(b.outcome);
    expect(a.frames).toEqual(b.frames);
    expect(a.drop).toEqual(b.drop);
    expect(a.summary).toBe(b.summary);
  });

  test("bakes a non-empty, index-safe flipbook", () => {
    const r = resolveCombat(bones(50), t1, {}, 7);
    expect(r.frames.length).toBeGreaterThan(0);
    expect(r.sequence.length).toBeGreaterThan(0);
    for (const i of r.sequence) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(r.frames.length);
    }
    expect(r.enemyGlyph).toBe(t1.glyph);
  });

  test("higher DEBUGGING wins more often", () => {
    expect(winRate(bones(90), t1, {})).toBeGreaterThan(winRate(bones(10), t1, {}));
  });

  test("tougher bugs win less often", () => {
    expect(winRate(bones(50), t4, {})).toBeLessThan(winRate(bones(50), t1, {}));
  });

  test("equipping a stat weapon raises the win rate", () => {
    const bare = winRate(bones(50), t1, {});
    const armed = winRate(bones(50), t1, { weapon: "foam_sword" });
    expect(armed).toBeGreaterThan(bare);
  });

  test("a win drops points ≥ the bug's reward", () => {
    // seed search for a guaranteed win at high DEBUGGING vs a t1
    const b = bones(95);
    let win = resolveCombat(b, t1, {}, 0);
    for (let s = 0; win.outcome !== "win" && s < 50; s++) {
      win = resolveCombat(b, t1, {}, s);
    }
    expect(win.outcome).toBe("win");
    expect(win.drop.points).toBeGreaterThanOrEqual(t1.reward);
    expect(win.summary).toContain("squashed");
  });

  test("never drops an item the player already owns (no phantom loot)", () => {
    const everything = new Set(
      // all catalog ids — nothing left to drop
      ["rubber_duck", "debug_wand", "foam_sword", "lucky_hat", "compiler_crown"],
    );
    const b = bones(95);
    // Even across many guaranteed-win seeds, an owned item is never granted and
    // the summary never claims a find.
    for (let s = 0; s < 100; s++) {
      const r = resolveCombat(b, t1, {}, s, everything);
      if (r.outcome !== "win") continue;
      expect(r.drop.itemId).toBeUndefined();
      expect(r.summary).not.toContain("found");
    }
  });

  test("a flee yields no points and no item", () => {
    const b = bones(1);
    let flee = resolveCombat(b, t4, {}, 0);
    for (let s = 0; flee.outcome !== "flee" && s < 50; s++) {
      flee = resolveCombat(b, t4, {}, s);
    }
    expect(flee.outcome).toBe("flee");
    expect(flee.drop.points).toBe(0);
    expect(flee.drop.itemId).toBeUndefined();
    expect(flee.summary).toContain("scuttled off");
  });

  // ── Owned upgrade effects (design-derive-upgrades.md G4: power parity) ────
  test("an owned stat upgrade raises the win rate exactly like a baked-in stat", () => {
    const bare = winRate(bones(50), t1, {});
    const owned = (() => {
      let wins = 0;
      const n = 400;
      for (let s = 0; s < n; s++) {
        const r = resolveCombat(bones(50), t1, {}, s, new Set(), [
          { type: "stat", amount: 5 },
        ]);
        if (r.outcome === "win") wins++;
      }
      return wins / n;
    })();
    expect(owned).toBeGreaterThan(bare);
    // ...and matches a companion whose bones already carry the +5 (the old
    // baked-in path), i.e. equivalent power regardless of which model applied it.
    const baked = winRate(bones(55), t1, {});
    expect(owned).toBeCloseTo(baked, 1);
  });

  test("owned upgrade effects default to [] — behavior unchanged when omitted", () => {
    const a = resolveCombat(bones(50), t1, {}, 42);
    const b = resolveCombat(bones(50), t1, {}, 42, new Set(), []);
    expect(a).toEqual(b);
  });
});

describe("two-sprite combat scene (Phase 5)", () => {
  test("every line of every frame is the same display width (no jitter)", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    const widths = new Set<number>();
    for (const frame of r.frames) {
      for (const line of frame.split("\n")) widths.add(displayWidth(line));
    }
    // A constant-width scene ⇒ exactly one width across all rows of all frames.
    expect(widths.size).toBe(1);
  });

  test("the scene is wider than a single sprite (two creatures present)", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    const sceneW = displayWidth(r.frames[0].split("\n")[0]);
    const playerW = Math.max(
      ...getArtFrame("cactus", "·", 0).map((l) => displayWidth(l)),
    );
    expect(sceneW).toBeGreaterThan(playerW * 2);
  });

  test("the enemy half is the mirror of its species art", () => {
    // Explicit resting eye so the comparison is codepoint-stable.
    const sceneBug: Bug = { ...t4, eye: "·" };
    const r = resolveCombat(bones(50), sceneBug, {}, 3);
    const enemyMirror = mirrorFrame(getArtFrame("dragon", "·", 0));
    const ready = r.frames[0].split("\n");
    // Each scene line ends with the mirrored enemy block (rightmost element).
    for (let i = 0; i < enemyMirror.length; i++) {
      const sceneLine = ready[ready.length - enemyMirror.length + i];
      expect(sceneLine.endsWith(enemyMirror[i])).toBe(true);
    }
  });

  test("the strike frame clashes blades on the eye row", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    // sequence is [0,1,2,2,3,3]; frame index 2 is the strike.
    const strike = r.frames[2].split("\n");
    const eyeRow = strike[Math.floor(strike.length / 2)];
    // Default blade "/" leans right; its mirror "\\" leans left — they meet.
    expect(eyeRow).toContain("/\\");
  });

  test("clash lands on the eye row for a 6-line player (wyvern), not center", () => {
    // wyvern art is 6 lines with eyes on row index 2 — center-based math would
    // drop the clash below the eyes. The fix derives the row from the art.
    // Row 0 is the damage-pop overlay, so the eye row sits at index 3.
    const r = resolveCombat(bones(50, { species: "wyvern" }), t4, {}, 3);
    const strike = r.frames[2].split("\n");
    const clashRows = strike.flatMap((l, i) => (l.includes("/\\") ? [i] : []));
    expect(clashRows).toEqual([3]); // blades clash only on the actual eye row
  });

  test("determinism extends to the multi-line scene frames", () => {
    const a = resolveCombat(bones(50), t4, {}, 11);
    const b = resolveCombat(bones(50), t4, {}, 11);
    expect(a.frames).toEqual(b.frames);
  });
});

describe("pending standoff scene (Phase 1: bakePendingScene)", () => {
  test("bakes ready/glare plus two 3-frame bouts (8 frames)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    expect(scene.frames.length).toBe(8);
    // Every sequence tick indexes a real frame.
    for (const i of scene.sequence) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(scene.frames.length);
    }
    // Both bouts play in order (walk, impact ×2, float ×2) with calm rhythm
    // between them.
    const seq = scene.sequence.join(",");
    expect(seq).toContain("2,3,3,4,4");
    expect(seq).toContain("5,6,6,7,7");
    expect(scene.sequence[0]).toBe(0); // loop opens on the calm ready pose
  });

  test("every line of every frame is the same display width (no jitter)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    const widths = new Set<number>();
    for (const frame of scene.frames) {
      for (const line of frame.split("\n")) widths.add(displayWidth(line));
    }
    expect(widths.size).toBe(1);
  });

  test("the standoff is wider than a single sprite (two creatures present)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    const sceneW = displayWidth(scene.frames[0].split("\n")[0]);
    const playerW = Math.max(
      ...getArtFrame("cactus", "·", 0).map((l) => displayWidth(l)),
    );
    expect(sceneW).toBeGreaterThan(playerW * 2);
  });

  test("no strike frame — the gap never clashes blades", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    for (const frame of scene.frames) expect(frame).not.toContain("/\\");
  });

  test("the ready and glare poses differ (glare swaps the eyes)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    expect(scene.frames[0]).not.toBe(scene.frames[1]);
    // Glare pose uses ">" fight eyes on the player half.
    expect(scene.frames[1]).toContain(">");
  });

  test("the enemy half is the mirror of its species art", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    const enemyMirror = mirrorFrame(getArtFrame("dragon", "·", 0));
    const ready = scene.frames[0].split("\n");
    for (let i = 0; i < enemyMirror.length; i++) {
      const sceneLine = ready[ready.length - enemyMirror.length + i];
      expect(sceneLine.endsWith(enemyMirror[i])).toBe(true);
    }
  });

  test("is pure & deterministic given the same inputs", () => {
    const a = bakePendingScene("wyvern", "·", "octopus", "×");
    const b = bakePendingScene("wyvern", "·", "octopus", "×");
    expect(a.frames).toEqual(b.frames);
    expect(a.sequence).toEqual(b.sequence);
  });
});

describe("skirmish bouts + damage pops (design-attack-animation)", () => {
  const strip = (s: string): string => s.replace(/\x1b\[[^m]*m/g, "");
  const overlayOf = (frame: string): string => frame.split("\n")[0];
  // The seeded draw order is part of the bake contract (§4.4): the first
  // rng() call picks the opening attacker.
  const firstAttacker = (seed: number): "player" | "enemy" =>
    mulberry32(seed)() < 0.5 ? "player" : "enemy";

  test("constant display width AND height across all frames (no jitter)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3);
    const widths = new Set<number>();
    const heights = new Set<number>();
    for (const frame of scene.frames) {
      const lines = frame.split("\n");
      heights.add(lines.length);
      for (const line of lines) widths.add(displayWidth(line));
    }
    expect(widths.size).toBe(1);
    expect(heights.size).toBe(1);
  });

  test("base frames carry a blank overlay row; impacts pop a red ✗ -N", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3);
    for (const i of [0, 1]) {
      expect(overlayOf(scene.frames[i]).trim()).toBe("");
    }
    // Impact frames (2nd of each bout): red SGR + marker + number.
    for (const i of [3, 6]) {
      expect(overlayOf(scene.frames[i])).toContain("\x1b[31m");
      expect(strip(overlayOf(scene.frames[i]))).toMatch(/✗ -\d+/);
    }
    // Float frames: the marker is gone, the number lingers.
    for (const i of [4, 7]) {
      expect(overlayOf(scene.frames[i])).not.toContain("✗");
      expect(strip(overlayOf(scene.frames[i]))).toMatch(/-\d+/);
    }
    // Walk-in frames have no pop yet.
    for (const i of [2, 5]) {
      expect(overlayOf(scene.frames[i]).trim()).toBe("");
    }
  });

  test("attackers alternate: the two bouts pop over different sprites", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3);
    const popCol = (i: number): number =>
      strip(overlayOf(scene.frames[i])).indexOf("✗");
    expect(popCol(3)).toBeGreaterThanOrEqual(0);
    expect(popCol(6)).toBeGreaterThanOrEqual(0);
    expect(popCol(3)).not.toBe(popCol(6));
  });

  test("the walk translates the attacker inside the fixed canvas", () => {
    const seed = 42;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, 3);
    // Compare a bottom art row (no eyes) of each bout's walk-in frame against
    // the ready frame: the attacker's block shifts 2 cells into the gap while
    // the defender's stays put and total width is constant.
    const lastRow = (i: number): string => {
      const lines = scene.frames[i].split("\n");
      return lines[lines.length - 1];
    };
    const ready = lastRow(0);
    const walks: Record<"player" | "enemy", string> = {
      [firstAttacker(seed)]: lastRow(2),
      [firstAttacker(seed) === "player" ? "enemy" : "player"]: lastRow(5),
    } as Record<"player" | "enemy", string>;
    // Player attacks: its leftmost ink moves 2 cells right.
    expect(walks.player.search(/\S/)).toBe(ready.search(/\S/) + 2);
    // Enemy attacks: its rightmost ink moves 2 cells left.
    expect(walks.enemy.trimEnd().length).toBe(ready.trimEnd().length - 2);
  });

  test("damage rolls stay in range (buddy 1..9, bug 1..3·tier)", () => {
    const tier = 4;
    for (const seed of [1, 2, 3, 4, 5]) {
      const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, tier);
      const first = firstAttacker(seed);
      const second = first === "player" ? "enemy" : "player";
      const cap = (attacker: "player" | "enemy"): number =>
        attacker === "player" ? 9 : 3 * tier;
      const popN = (i: number): number =>
        Number(strip(overlayOf(scene.frames[i])).match(/-(\d+)/)![1]);
      for (const [i, attacker] of [[3, first], [6, second]] as const) {
        expect(popN(i)).toBeGreaterThanOrEqual(1);
        expect(popN(i)).toBeLessThanOrEqual(cap(attacker));
      }
    }
  });

  test("seeded variation: a different seed re-rolls the loop", () => {
    const a = bakePendingScene("cactus", "·", "dragon", "·", 7, 2);
    const b = bakePendingScene("cactus", "·", "dragon", "·", 7, 2);
    expect(a).toEqual(b);
    // Gap draws can collide across seeds (8 values each); the frames carry the
    // attacker order + damage rolls, so the flipbook as a whole must differ.
    const c = bakePendingScene("cactus", "·", "dragon", "·", 8, 2);
    expect([c.frames, c.sequence]).not.toEqual([a.frames, a.sequence]);
  });

  test("resolved scene (OQ4): win strikes pop over the enemy, flee stays blank", () => {
    let win: ReturnType<typeof resolveCombat> | undefined;
    let flee: ReturnType<typeof resolveCombat> | undefined;
    for (let s = 0; s < 200 && (!win || !flee); s++) {
      const r = resolveCombat(bones(50), t4, {}, s);
      if (r.outcome === "win") win = win ?? r;
      else flee = flee ?? r;
    }
    // strike frames show the pop, the triumph frame floats the number away
    expect(strip(overlayOf(win!.frames[2]))).toMatch(/✗ -\d+/);
    expect(strip(overlayOf(win!.frames[3]))).toMatch(/-\d+/);
    expect(overlayOf(win!.frames[3])).not.toContain("✗");
    // ...and it lands over the enemy (right of the player block)
    const playerW = Math.max(
      ...getArtFrame("cactus", "·", 0).map((l) => displayWidth(l)),
    );
    expect(strip(overlayOf(win!.frames[2])).indexOf("✗")).toBeGreaterThan(playerW);
    // a flee never shows damage — the swing whiffed
    for (const frame of flee!.frames) {
      expect(overlayOf(frame).trim()).toBe("");
    }
  });
});

describe("pending-encounter I/O (Phase 1)", () => {
  let prevEnv: string | undefined;
  let cfgDir: string;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-pending-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    mkdirSync(buddyStateDir(), { recursive: true });
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  const sample = (): PendingEncounter => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·");
    return {
      bugId: "segfault_dragon",
      tier: 4,
      frames: scene.frames,
      sequence: scene.sequence,
      sightedAt: 1_700_000_000_000,
      startedAt: 1_699_999_999_000,
    };
  };

  test("round-trips a written record (no TTL — persists)", () => {
    const rec = sample();
    writePendingEncounter(rec);
    expect(readPendingEncounter()).toEqual(rec);
  });

  test("clearPendingEncounter removes the file (idempotent)", () => {
    writePendingEncounter(sample());
    clearPendingEncounter();
    expect(readPendingEncounter()).toBeNull();
    // Clearing an already-absent file is a no-op, not a throw.
    expect(() => clearPendingEncounter()).not.toThrow();
  });

  test("missing file reads as null", () => {
    expect(readPendingEncounter()).toBeNull();
  });

  test("optional project field survives the roundtrip", () => {
    const rec = { ...sample(), project: "claude-buddy" };
    writePendingEncounter(rec);
    expect(readPendingEncounter()?.project).toBe("claude-buddy");
    // Records written before the field existed read back without it.
    writePendingEncounter(sample());
    expect(readPendingEncounter()?.project).toBeUndefined();
  });

  test("malformed file reads as null", () => {
    writeFileSync(join(buddyStateDir(), "pending-encounter.json"), "{ not json");
    expect(readPendingEncounter()).toBeNull();
  });

  test("a record missing required fields reads as null", () => {
    writeFileSync(
      join(buddyStateDir(), "pending-encounter.json"),
      JSON.stringify({ frames: ["x"], tier: 4 }), // no bugId / startedAt
    );
    expect(readPendingEncounter()).toBeNull();
  });
});

// ─── Fresh-process: sighting under the auto-quiet error spike ─────────────────
//
// state.ts freezes its state dir at module load, so the real sightBug →
// writeStatusState path needs a subprocess whose CLAUDE_CONFIG_DIR is set
// before any import (same idiom as loot.test.ts). Regression: sightBug gated on
// effectiveGameFeel(), but a sighting fires on the very error events whose
// fresh reaction trips the auto-quiet spike clamp (FR-E1) — and reactionTTL
// defaults to 0 (never expires), so the clamped read was "subtle" by
// construction and every spawn was suppressed. Both the spawn (session.ts) and
// the combatSticky status write (state.ts) must read the CONFIGURED level.

describe("sightBug under auto-quiet error spike (fresh process)", () => {
  test("spawns the standoff and lands combatSticky despite a fresh spike reaction", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-sight-proc-"));
    const script = `
      const { readFileSync } = await import("fs");
      const { join } = await import("path");
      const {
        saveConfig, saveCompanion, saveReaction, effectiveGameFeel,
      } = await import("./server/state.ts");
      const { startSession, sightBug } = await import("./server/session.ts");
      const { readPendingEncounter, clearPendingEncounter } =
        await import("./server/combat.ts");
      saveConfig({ gameFeel: "full" });
      saveCompanion({
        name: "sighttest",
        personality: "",
        bones: {
          species: "cactus", rarity: "common", eye: "\\u00b7", hat: "none",
          shiny: false, peak: "SNARK", dump: "WISDOM",
          stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 },
        },
      });
      const snap = startSession();
      // The exact live sequence: react.sh writes the error-family reaction,
      // THEN fires bug_sighted. reactionTTL=0 (default) keeps it fresh forever.
      saveReaction("*glares at the failing tests*", "test-fail");
      const clampedWhileSighting = effectiveGameFeel();
      sightBug();
      const pending = readPendingEncounter();
      const status = JSON.parse(readFileSync(
        join(process.env.CLAUDE_CONFIG_DIR, "buddy-state", "status.json"),
        "utf8",
      ));
      // Negative control: a configured subtle/off level still no-ops.
      clearPendingEncounter();
      saveConfig({ gameFeel: "subtle" });
      sightBug();
      console.log(JSON.stringify({
        clampedWhileSighting,
        pendingTier: pending?.tier ?? null,
        startedAtMatch: pending ? pending.startedAt === snap.startedAt : null,
        sticky: status.combatSticky ?? null,
        frames: Array.isArray(status.combatFrames) ? status.combatFrames.length : 0,
        encounterAt: status.encounterAt ?? null,
        caption: status.combatFrames?.[0]?.split("\\n")[0]?.trim() ?? null,
        subtleNoop: readPendingEncounter() === null,
      }));
    `;
    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfgDir,
      };
      delete env.TMUX_PANE; // pin SID to "default" so reaction/session files agree
      const res = spawnSync("bun", ["-e", script], {
        cwd: join(import.meta.dir, ".."),
        env,
        encoding: "utf8",
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout.trim());
      // Precondition of the regression: the spike clamp IS active when the
      // sighting runs — effectiveGameFeel() reads "subtle" at configured full.
      expect(out.clampedWhileSighting).toBe("subtle");
      // The standoff spawns anyway (configured-level gate)…
      expect(out.pendingTier).toBe(1);
      expect(out.startedAtMatch).toBe(true);
      // …and the status write surfaces it as a sticky scene (no encounterAt —
      // the shell must not TTL it away), also despite the active clamp.
      expect(out.sticky).toBe(1);
      expect(out.frames).toBeGreaterThan(0);
      expect(out.encounterAt).toBeNull();
      // The cross-instance caption names the project the sighting ran in
      // (the child's cwd is the repo root).
      expect(out.caption).toBe(`Bug fight in ${basename(join(import.meta.dir, ".."))}!`);
      // Full-only still holds: configured subtle never spawns.
      expect(out.subtleNoop).toBe(true);
    } finally {
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
