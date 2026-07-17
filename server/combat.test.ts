import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import { mulberry32, type BuddyBones, type Species } from "./engine";
import { displayWidth, eyeRowIndex, getArtFrame, mirrorFrame } from "./art";
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
    // Walk from the BOTTOM: the sprites are bottom-aligned, and the bake drops
    // optional top rows no frame uses (here the enemy's own blank hat row), so
    // the scene can be shorter than the raw art it was built from.
    const shared = Math.min(ready.length, enemyMirror.length);
    for (let i = 1; i <= shared; i++) {
      const sceneLine = ready[ready.length - i];
      expect(sceneLine.endsWith(enemyMirror[enemyMirror.length - i])).toBe(true);
    }
  });

  /** The player's eye row within a scene. The sprite is bottom-aligned and only
   *  unused TOP rows are ever dropped, so counting up from the bottom pins the
   *  eye row no matter which optional rows (hat, damage pop) the bake kept. */
  const sceneEyeRow = (rows: string[], species: Species): number =>
    rows.length - (getArtFrame(species, "·", 0).length - eyeRowIndex(species));

  test("the strike frame clashes blades on the eye row", () => {
    const r = resolveCombat(bones(50), t4, {}, 3);
    // sequence is [0,1,2,2,3,3]; frame index 2 is the strike.
    const strike = r.frames[2].split("\n");
    // Default blade "/" leans right; its mirror "\\" leans left — they meet.
    expect(strike[sceneEyeRow(strike, "cactus")]).toContain("/\\");
  });

  test("clash lands on the eye row for a 6-line player (wyvern), not center", () => {
    // wyvern art is 6 lines with eyes on row index 2 — center-based math would
    // drop the clash below the eyes. The fix derives the row from the art.
    const r = resolveCombat(bones(50, { species: "wyvern" }), t4, {}, 3);
    const strike = r.frames[2].split("\n");
    const clashRows = strike.flatMap((l, i) => (l.includes("/\\") ? [i] : []));
    const eyeRow = sceneEyeRow(strike, "wyvern");
    expect(clashRows).toEqual([eyeRow]); // blades clash only on the eye row…
    expect(eyeRow).not.toBe(Math.floor(strike.length / 2)); // …which isn't center
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
  // Replay the full draw order (first, outA, dmgA, outB, dmgB, …) so tests can
  // predict each bout's outcome — dodge/parry carry no damage pop, so pop
  // assertions must be scoped to the hit bouts (design-sprite-animation P2).
  const bouts = (
    seed: number,
  ): { first: "player" | "enemy"; outA: string; outB: string } => {
    const rng = mulberry32(seed);
    const first = rng() < 0.5 ? "player" : "enemy";
    const oc = (): string => {
      const r = rng();
      return r < 0.4
        ? "hit"
        : r < 0.6
          ? "dodge"
          : r < 0.8
            ? "parry"
            : r < 0.9
              ? "crit"
              : "counter";
    };
    const outA = oc();
    rng(); // dmgA
    const outB = oc();
    return { first, outA, outB };
  };
  // Frame indices of a bout's [walk, impact, float] within the flipbook: 2
  // base frames, then 3 per bout.
  const boutFrames = (n: 0 | 1): [number, number, number] => [
    2 + n * 3,
    3 + n * 3,
    4 + n * 3,
  ];

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

  test("base frames blank; a HIT bout pops ✗ -N, dodge/parry stay pop-less", () => {
    // seed 2 ⇒ outA=hit, outB=dodge: exercises both a popping and a pop-less
    // bout in one flipbook.
    const seed = 2;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, 3);
    const { outA, outB } = bouts(seed);
    expect([outA, outB]).toEqual(["hit", "dodge"]);
    for (const i of [0, 1]) expect(overlayOf(scene.frames[i]).trim()).toBe("");
    for (const [n, out] of [[0, outA], [1, outB]] as const) {
      const [walk, impact, float] = boutFrames(n);
      expect(overlayOf(scene.frames[walk]).trim()).toBe(""); // walk-in never pops
      if (out === "hit") {
        expect(overlayOf(scene.frames[impact])).toContain("\x1b[31m");
        expect(strip(overlayOf(scene.frames[impact]))).toMatch(/✗ -\d+/);
        expect(overlayOf(scene.frames[float])).not.toContain("✗");
        expect(strip(overlayOf(scene.frames[float]))).toMatch(/-\d+/);
      } else {
        // dodge/parry deal no damage ⇒ every overlay row stays blank.
        for (const i of [impact, float]) {
          expect(strip(overlayOf(scene.frames[i]))).not.toMatch(/✗|-\d+/);
        }
      }
    }
  });

  test("attackers alternate: two hit bouts pop over different sprites", () => {
    // seed 3 ⇒ both bouts hit (first=enemy, then player), so both pop and the
    // columns differ.
    const seed = 3;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, 3);
    expect([bouts(seed).outA, bouts(seed).outB]).toEqual(["hit", "hit"]);
    const popCol = (i: number): number =>
      strip(overlayOf(scene.frames[i])).indexOf("✗");
    expect(popCol(3)).toBeGreaterThanOrEqual(0);
    expect(popCol(6)).toBeGreaterThanOrEqual(0);
    expect(popCol(3)).not.toBe(popCol(6));
  });

  test("dodge: attacker fully lunges, defender slips with O eyes, no pop", () => {
    // seed 14 ⇒ outA=dodge (first=player).
    const seed = 14;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, 3);
    expect(bouts(seed).outA).toBe("dodge");
    const [, impact] = boutFrames(0);
    // No damage anywhere in the dodge bout.
    for (const i of boutFrames(0)) {
      expect(strip(overlayOf(scene.frames[i]))).not.toMatch(/✗|-\d+/);
    }
    // The defender (enemy, right block) shows the dodging "O" eyes on impact.
    const eyeRow = strip(scene.frames[impact])
      .split("\n")
      .find((l) => l.includes("O"));
    expect(eyeRow).toBeDefined();
  });

  test("parry: the blades clash in the gap, no damage dealt", () => {
    // seed 7 ⇒ outB=parry. A foam_sword-style blade proves the clash uses the
    // player weapon; bare here ⇒ the default "/\\".
    const seed = 7;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, 3);
    expect(bouts(seed).outB).toBe("parry");
    const [, clash] = boutFrames(1);
    // No pop, but the mid-gap clash glyphs appear on the clash frame.
    for (const i of boutFrames(1)) {
      expect(strip(overlayOf(scene.frames[i]))).not.toMatch(/✗|-\d+/);
    }
    expect(strip(scene.frames[clash])).toContain("/\\");
  });

  test("crit: same beats as hit, but damage doubles and eyes read heavier", () => {
    // seed 9, tier 3 ⇒ first=player, outA=crit, raw roll dmgA=2 ⇒ pop reads 4.
    const seed = 9;
    const tier = 3;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, tier);
    expect(bouts(seed).outA).toBe("crit");
    const [, impact, float] = boutFrames(0);
    expect(strip(overlayOf(scene.frames[impact]))).toMatch(/‼ -4\b/);
    expect(overlayOf(scene.frames[impact])).toContain("\x1b[1m"); // bold: heavier than a plain hit
    expect(strip(overlayOf(scene.frames[float])).trim()).toBe("-4");
    // Heavier eyes: attacker spark, defender KO'd-wide (player attacks here).
    const impactLines = strip(scene.frames[impact]).split("\n");
    expect(impactLines.some((l) => l.includes("*"))).toBe(true);
    expect(impactLines.some((l) => l.includes("X"))).toBe(true);
  });

  test("counter: the defender punishes a parry, pop lands on the attacker", () => {
    // seed 10, tier 3 ⇒ first=enemy, outA=counter, raw roll dmgA=7 (unscaled —
    // reuses the bout's already-rolled damage, no new rng draw).
    const seed = 10;
    const tier = 3;
    const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, tier);
    expect(bouts(seed).outA).toBe("counter");
    const [, clash, punish] = boutFrames(0);
    // Lunge + clash beats are pop-less, same as parry.
    for (const i of boutFrames(0).slice(0, 2)) {
      expect(strip(overlayOf(scene.frames[i]))).not.toMatch(/‼|✗|-\d+/);
    }
    expect(strip(scene.frames[clash])).toContain("/\\"); // the clash still happens
    // The punish beat's pop lands on the ATTACKER (enemy, first here) — left of
    // center is the player's span, so the pop sits right of the gap.
    expect(strip(overlayOf(scene.frames[punish]))).toMatch(/‼ -7\b/);
    const punishLines = strip(scene.frames[punish]).split("\n");
    expect(punishLines.some((l) => l.includes("O"))).toBe(true); // attacker: surprised
    expect(punishLines.some((l) => l.includes("^"))).toBe(true); // defender: triumphant
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

  test("hit damage rolls stay in range (buddy 1..9, bug 1..3·tier)", () => {
    const tier = 4;
    for (const seed of [1, 2, 3, 4, 5]) {
      const scene = bakePendingScene("cactus", "·", "dragon", "·", seed, tier);
      const { first, outA, outB } = bouts(seed);
      const second = first === "player" ? "enemy" : "player";
      const cap = (attacker: "player" | "enemy"): number =>
        attacker === "player" ? 9 : 3 * tier;
      const popN = (i: number): number =>
        Number(strip(overlayOf(scene.frames[i])).match(/-(\d+)/)![1]);
      // Only hit bouts carry a damage number; dodge/parry deal none.
      for (const [n, out, attacker] of [
        [0, outA, first],
        [1, outB, second],
      ] as const) {
        if (out !== "hit") continue;
        const impact = boutFrames(n)[1];
        expect(popN(impact)).toBeGreaterThanOrEqual(1);
        expect(popN(impact)).toBeLessThanOrEqual(cap(attacker));
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
    // A flee never shows damage — the swing whiffed. With no pop anywhere in
    // the loop the bake drops the overlay row outright, so assert on the whole
    // frame rather than a row that no longer exists.
    for (const frame of flee!.frames) {
      expect(frame).not.toContain("\x1b[31m");
      expect(strip(frame)).not.toMatch(/✗|-\d+/);
    }
  });
});

describe("scene top-row trim (no dead rows above the sprites)", () => {
  const strip = (s: string): string => s.replace(/\x1b\[[^m]*m/g, "");
  const rowsOf = (frame: string): string[] => strip(frame).split("\n");

  test("a bare-headed standoff spends no row on the empty hat row", () => {
    // seed 3 ⇒ both bouts hit, keeping the pop row alive so row 0 stays the
    // (blank-on-this-frame) pop row rather than being reclaimed outright.
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 3, 3);
    const rows = rowsOf(scene.frames[0]);
    // Row 0 is the pop row (the bouts use it). The sprites must start directly
    // below it — with no hat worn, the art's reserved hat row is dead space.
    expect(rows[0].trim()).toBe("");
    expect(rows[1].trim()).not.toBe("");
  });

  test("keeps the hat row when a hat is actually worn", () => {
    const bare = bakePendingScene("cactus", "·", "dragon", "·", 42, 3);
    const hatted = bakePendingScene("cactus", "·", "dragon", "·", 42, 3, {
      hat: "wizard",
    });
    // The row is earned back, not merely preserved by luck: exactly one taller.
    expect(rowsOf(hatted.frames[0]).length).toBe(rowsOf(bare.frames[0]).length + 1);
    expect(rowsOf(hatted.frames[0])[1]).toContain("/^\\");
  });

  test("keeps the pop row — some bout frame needs it", () => {
    // seed 3 ⇒ both bouts hit (guaranteed ✗ pop; seed 42 no longer has one
    // under the P4 crit/counter outcome mix).
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 3, 3);
    // Blank on the calm frames, but kept for the whole loop because impacts use
    // it. A row any frame uses is never trimmed.
    expect(rowsOf(scene.frames[0])[0].trim()).toBe("");
    expect(scene.frames.some((f) => /✗ -\d+/.test(rowsOf(f)[0]))).toBe(true);
  });

  test("a pop-less resolved scene (flee) drops the pop row too", () => {
    let flee: ReturnType<typeof resolveCombat> | undefined;
    for (let s = 0; s < 200 && !flee; s++) {
      const r = resolveCombat(bones(50), t4, {}, s);
      if (r.outcome === "flee") flee = r;
    }
    // No frame pops and no hat is worn ⇒ both optional top rows are dead, so
    // the scene opens straight onto the sprites.
    expect(rowsOf(flee!.frames[0])[0].trim()).not.toBe("");
  });

  test("the trim is uniform — height stays constant across the flipbook", () => {
    for (const look of [undefined, { hat: "wizard" as const }]) {
      const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3, look);
      const heights = new Set(scene.frames.map((f) => f.split("\n").length));
      expect(heights.size).toBe(1);
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

// ─── Gear renders in fight scenes (weapon/trinket/hat on the player sprite) ──

describe("gear in combat scenes (PlayerLook)", () => {
  // "†" and ",>" occur in no species art, so containment proves the overlay.
  const LOOK = { hat: "crown" as const, gear: { weapon: "†", trinket: ",>" } };

  test("the standoff shows the geared, hatted buddy in every frame", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3, LOOK);
    for (const frame of scene.frames) {
      expect(frame).toContain("†");
      expect(frame).toContain(",>");
      expect(frame).toContain("\\^^^/"); // crown art
    }
  });

  test("gear keeps the constant width/height guarantee (no jitter)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3, LOOK);
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

  test("no look ⇒ the bare scene, free of overlay glyphs (back-compat)", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3);
    for (const frame of scene.frames) {
      expect(frame).not.toContain("†");
      expect(frame).not.toContain(",>");
    }
  });

  test("gear rides the bout shift — the walking attacker keeps holding it", () => {
    const scene = bakePendingScene("cactus", "·", "dragon", "·", 42, 3, LOOK);
    // Frames 2..7 are the two bouts (walk/impact/float × 2 attackers).
    for (let i = 2; i < 8; i++) expect(scene.frames[i]).toContain("†");
  });

  test("resolveCombat: an equipped trinket shows in every fight frame", () => {
    const r = resolveCombat(bones(50), t1, { trinket: "rubber_duck" }, 7);
    for (const frame of r.frames) expect(frame).toContain(",>");
  });

  test("resolveCombat: the held weapon shows even on the calm ready pose", () => {
    // Pre-gear, the weapon glyph appeared only as the strike-frame clash.
    const r = resolveCombat(bones(50), t1, { weapon: "foam_sword" }, 7);
    expect(r.frames[0]).toContain("†"); // ready — no clash here
  });

  test("resolveCombat: the innate hat is worn into the fight", () => {
    const r = resolveCombat(bones(50, { hat: "crown" }), t1, {}, 7);
    for (const frame of r.frames) expect(frame).toContain("\\^^^/");
  });

  test("resolveCombat: bare loadout + no hat stays glyph-free", () => {
    const r = resolveCombat(bones(50), t1, {}, 7);
    for (const frame of r.frames) {
      expect(frame).not.toContain("†");
      expect(frame).not.toContain(",>");
    }
  });
});
