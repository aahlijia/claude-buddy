/**
 * H5: the HD sprite in statusline/buddy-status.sh (hd-overhaul/h5-statusline.md).
 *
 * Drives the real bash script under a temp CLAUDE_CONFIG_DIR, like
 * statusline_render.test.ts, with a status.json that carries the baked HD
 * frames; and writeStatusState in a child process to check what it bakes.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { bakeStatusSprite } from "./gfx/statussprite";

const SCRIPT = resolve(import.meta.dir, "..", "statusline", "buddy-status.sh");
const NOW = 1_700_000_000;
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const ASCII = ["            ", "   /\\_/\\    ", "  ( o.o )   ", "   > ^ <    ", "            "].join("\n");
const SPRITE = bakeStatusSprite({ species: "cat", rarity: "rare", shiny: false, seed: 7 }, "mini")!;

function status(extra: Record<string, unknown> = {}, hd = true): Record<string, unknown> {
  return {
    name: "Pip", species: "cat", rarity: "rare", stars: "★★★", shiny: false, reaction: "", muted: false,
    frames: [ASCII], frameSequence: [0], level: 1, xp: 0, mood: "focused", title: null, prestigeLevel: 0,
    streak: 0, stats: { DEBUGGING: 1, PATIENCE: 2, CHAOS: 3, WISDOM: 4, SNARK: 5 }, peak: "SNARK", dump: "DEBUGGING",
    xpPct: 0, lastXpGain: null, celebration: null,
    ...(hd ? { hdFrames: SPRITE.frames, hdSequence: SPRITE.sequence, hdWidth: SPRITE.width, hdCelebFrames: SPRITE.celebFrames, hdCelebSequence: SPRITE.celebSequence } : {}),
    ...extra,
  };
}

function render(st: Record<string, unknown>, cfg: Record<string, unknown> = {}, now = NOW): string {
  const dir = mkdtempSync(join(tmpdir(), "buddy-hd-"));
  try {
    mkdirSync(join(dir, "buddy-state"), { recursive: true });
    writeFileSync(join(dir, "buddy-state", "status.json"), JSON.stringify(st));
    writeFileSync(join(dir, "buddy-state", "config.json"), JSON.stringify(cfg));
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CONFIG_DIR: dir, BUDDY_FAKE_NOW: String(now), COLUMNS: "120" };
    delete env.TMUX_PANE;
    delete env.BUDDY_SHELL;
    const res = spawnSync("bash", [SCRIPT], { env, input: "{}", encoding: "utf8" });
    expect(res.status).toBe(0);
    return res.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The sprite frame bash should show at `now`. */
const frameAt = (frames: string[], seq: number[], now = NOW) => frames[seq[now % seq.length]];

describe("status line: HD sprite", () => {
  test("shows the baked frame for this tick, every row of it", () => {
    for (const now of [NOW, NOW + 1, NOW + 7]) {
      const out = render(status(), {}, now);
      for (const row of frameAt(SPRITE.frames, SPRITE.sequence, now).split("\n")) {
        if (plain(row).trim()) expect(out).toContain(row);
      }
      expect(plain(out)).not.toContain("o.o");
    }
  });

  test("statusSprite off → the ASCII render, byte for byte", () => {
    expect(render(status(), { statusSprite: "off" })).toBe(render(status({}, false), { statusSprite: "off" }));
    expect(render(status(), { statusSprite: "off" })).toBe(render(status({}, false)));
    expect(plain(render(status(), { statusSprite: "off" }))).toContain("o.o");
  });

  test("gameFeel off → the ASCII render, byte for byte", () => {
    expect(render(status(), { gameFeel: "off" })).toBe(render(status({}, false), { gameFeel: "off" }));
  });

  test("an older server (no hd fields) renders exactly as before", () => {
    expect(render(status({}, false), { statusSprite: "mini" })).toBe(render(status({}, false), { statusSprite: "off" }));
  });

  test("a fresh celebration hops in HD instead of the ASCII flourish", () => {
    const celebration = { text: "Level up!", kind: "levelup", at: NOW * 1000 - 2000 };
    const out = render(status({ celebration, flourishFrames: ["FLOURISH"], flourishSequence: [0] }));
    expect(plain(out)).not.toContain("FLOURISH");
    const row = frameAt(SPRITE.celebFrames, SPRITE.celebSequence).split("\n").find((r) => plain(r).trim())!;
    expect(out).toContain(row);
  });

  test("a fight keeps its two-sprite ASCII scene", () => {
    const out = render(status({ encounterAt: NOW * 1000 - 1000, combatFrames: ["FIGHT SCENE"], combatSequence: [0], artWidth: 20 }), { gameFeel: "full" });
    expect(plain(out)).toContain("FIGHT SCENE");
    expect(out).not.toContain(SPRITE.frames[0].split("\n")[2]);
  });

  test("the name is centered under the sprite", () => {
    const lines = plain(render(status())).split("\n");
    const art = lines.filter((l) => /[▀▄█]/.test(l));
    const left = Math.min(...art.map((l) => l.search(/[▀▄█]/)));
    const right = Math.max(...art.map((l) => l.length - 1 - [...l].reverse().join("").search(/[▀▄█]/)));
    const name = lines.find((l) => l.includes("Pip"))!;
    const mid = name.indexOf("Pip") + 1;
    expect(mid).toBeGreaterThanOrEqual(left);
    expect(mid).toBeLessThanOrEqual(right);
  });

  test("the bubble sits beside the wider sprite without overlapping it", () => {
    const out = plain(render(status({ reaction: "Ouch!" })));
    const row = out.split("\n").find((l) => l.includes("Ouch!"))!;
    expect(row.indexOf("Ouch!")).toBeLessThan(row.search(/[▀▄█]/) === -1 ? Infinity : row.search(/[▀▄█]/));
  });
});

describe("writeStatusState bakes the sprite", () => {
  function write(species: string, cfg: Record<string, unknown>): { status: Record<string, unknown>; cached: boolean } {
    const dir = mkdtempSync(join(tmpdir(), "buddy-hd-write-"));
    try {
      const script = `
        const { saveConfig, saveCompanion, loadCompanion, writeStatusState } = await import("./server/state.ts");
        saveConfig(${JSON.stringify(cfg)});
        saveCompanion({ name: "Pip", personality: "", hatchedAt: 0, userId: "u",
          bones: { species: ${JSON.stringify(species)}, rarity: "rare", eye: "\\u00b7", hat: "none", shiny: false,
            peak: "SNARK", dump: "WISDOM", stats: { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 10 } } });
        writeStatusState(loadCompanion(), {});
      `;
      const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CONFIG_DIR: dir };
      delete env.TMUX_PANE;
      const res = spawnSync("bun", ["-e", script], { cwd: join(import.meta.dir, ".."), env, encoding: "utf8" });
      expect(res.status).toBe(0);
      return {
        status: JSON.parse(readFileSync(join(dir, "buddy-state", "status.json"), "utf8")),
        cached: existsSync(join(dir, "buddy-state", "hd-sprite.json")),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("HD species get frames by default (mini), cached on disk", () => {
    const { status: s, cached } = write("cat", {});
    expect(Array.isArray(s.hdFrames)).toBe(true);
    expect((s.hdFrames as string[]).length).toBeGreaterThan(1);
    expect(s.hdWidth).toBeLessThanOrEqual(14);
    expect(cached).toBe(true);
  });

  test("full is bigger; off and gameFeel off bake nothing; every species bakes", () => {
    expect(write("cat", { statusSprite: "full" }).status.hdWidth as number).toBeGreaterThan(14);
    expect(write("cat", { statusSprite: "off" }).status.hdFrames).toBeUndefined();
    expect(write("cat", { gameFeel: "off" }).status.hdFrames).toBeUndefined();
    expect(write("duck", {}).status.hdFrames).toBeDefined();
  });

  test("reduceMotion bakes one still pose", () => {
    expect(write("dragon", { reduceMotion: true }).status.hdSequence).toEqual([0]);
  });
});
