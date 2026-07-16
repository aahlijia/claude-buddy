/**
 * Regression tests: `muted` must survive status writes that don't set it.
 *
 * Mute is a user toggle persisted only in status.json (buddy_mute/unmute pass
 * `opts.muted` explicitly). Every other writer — XP awards, bug sightings,
 * easter eggs — calls writeStatusState without it, and the old `muted ?? false`
 * default silently unmuted the buddy on the next such event.
 *
 * state.ts freezes STATE_DIR at module load, so each case runs in a *fresh bun
 * subprocess* with its own CLAUDE_CONFIG_DIR — the same hermetic pattern as
 * state_wander.test.ts.
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SERVER_DIR = import.meta.dir;
const STATE_TS = JSON.stringify(join(SERVER_DIR, "state.ts"));
const ENGINE_TS = JSON.stringify(join(SERVER_DIR, "engine.ts"));

/** Run a writeStatusState scenario in a fresh subprocess and return the final
 *  status.json it wrote. `writes` is a list of opts objects applied in order. */
function renderMuted(
  writes: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const cfgDir = mkdtempSync(join(tmpdir(), "buddy-muted-"));
  const stateDir = join(cfgDir, "buddy-state");
  mkdirSync(stateDir, { recursive: true });

  const childSrc = `
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const companion = {
  bones: generateBones("muted-smoke", "salt"),
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "muted-smoke",
};
for (const opts of ${JSON.stringify(writes)}) {
  writeStatusState(companion, opts);
}
`;
  const childPath = join(cfgDir, "child.mjs");
  writeFileSync(childPath, childSrc);

  const res = spawnSync("bun", [childPath], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    encoding: "utf8",
  });

  const statusPath = join(stateDir, "status.json");
  if (!existsSync(statusPath)) {
    rmSync(cfgDir, { recursive: true, force: true });
    throw new Error(`child wrote no status.json (${res.status}): ${res.stderr}`);
  }
  const status = JSON.parse(readFileSync(statusPath, "utf8")) as Record<
    string,
    unknown
  >;
  rmSync(cfgDir, { recursive: true, force: true });
  return status;
}

describe("writeStatusState — muted persistence", () => {
  test("a write without opts.muted preserves an existing mute", () => {
    const status = renderMuted([{ muted: true }, {}]);
    expect(status.muted).toBe(true);
  });

  test("an explicit muted:false unmutes", () => {
    const status = renderMuted([{ muted: true }, { muted: false }]);
    expect(status.muted).toBe(false);
  });

  test("defaults to unmuted when no prior status file exists", () => {
    const status = renderMuted([{}]);
    expect(status.muted).toBe(false);
  });

  test("an XP-award-shaped write preserves the mute", () => {
    const status = renderMuted([
      { muted: true },
      { level: 3, xp: 250, xpGain: 25 },
    ]);
    expect(status.muted).toBe(true);
  });
});
