/**
 * Integration smoke tests for the idle-wander plumbing in writeStatusState (P2).
 *
 * state.ts freezes STATE_DIR / CONFIG_FILE at module load, so these cases run in
 * a *fresh bun subprocess* with its own CLAUDE_CONFIG_DIR — hermetic via the
 * child's env, no shared module state mutated in the test process. This mirrors
 * statusline_render.test.ts and the achievements.ts fresh-process precedent (the
 * existing state.test.ts deliberately leaves FS cases to a separate suite).
 *
 * Covers: the gate (off/subtle ⇒ absent, full ⇒ present), the wanderEnabled
 * opt-out, the wanderHop row track, DEFAULT_CONFIG backfill of an old
 * config.json, and the best-effort guarantee that a throwing generator never
 * breaks the write (NFR4).
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { STINGER_DELAY_TICKS } from "./wander.ts";
import { LOOTDASH_ITEM_GLYPH, displayWidth } from "./art.ts";
import { pickSessionGround } from "./ground.ts";

const SERVER_DIR = import.meta.dir;
const STATE_TS = JSON.stringify(join(SERVER_DIR, "state.ts"));
const ENGINE_TS = JSON.stringify(join(SERVER_DIR, "engine.ts"));

interface RenderCase {
  config: Record<string, unknown>;
  /** Force buildWanderSequence to throw (via a child-local loader plugin). */
  throwWander?: boolean;
  /** Opts passed straight through to writeStatusState (living-world P1
   *  stinger tests). */
  opts?: Record<string, unknown>;
  /** A persisted reaction (reaction.default.json) seeded before the write —
   *  living-world P1 D14: drives the active-reason coupling between the
   *  angry-emotion map and the auto-quiet spike clamp under test. */
  reaction?: { reaction: string; reason: string };
  /** Pin mood.json's `current` before the write. Absent mood.json falls back
   *  to getTimeOfDayMood() (mood.ts), which is wall-clock dependent — several
   *  hours map to "happy" (range 4) or "excited" (range 6), both past any
   *  assertion that assumes the tight "focused" (range 2) corridor. Any test
   *  that reasons about specific wander-range values MUST set this. */
  mood?: string;
  /** Stub props.ts's pickDayProp to a fixed PropArt regardless of the real
   *  calendar day (living-world P4 Task 3). pickDayProp is day-seeded off
   *  the real clock, so — same idiom as throwWander below — a child-local
   *  loader plugin swaps the module for a deterministic stub rather than
   *  reasoning about calendar-day races between the test and child clocks. */
  stubProp?: { feet: string; ahead: string };
  /** Override `generateBones`'s salt (userId stays "smoke") so a test can
   *  pin a specific species — default "salt" always yields "chonk" (one of
   *  the 9 cramped species with no PROP_KICK_COLUMNS entry, living-world P4
   *  Task 4), so the step-kick tests need a different salt to land on a
   *  species that actually has a kick family. */
  salt?: string;
  /** Pin `buildWanderSequence`'s `phases` output via a child-local loader
   *  plugin stub (same idiom as `throwWander`/`stubProp` above) — the real
   *  generator seeds off `Date.now()` with no config-level override, so a
   *  test that needs a SPECIFIC phase sequence (e.g. a guaranteed run of
   *  step ticks long enough to exercise every kick column) pins it here
   *  instead of retrying against the wall clock. `horizontal`/`vertical`
   *  are filled with zeros (their values don't matter to the kick tests);
   *  `gaitWalkOpts` is still stubbed (state.ts calls it unconditionally
   *  before `buildWanderSequence`) but its return value is unused once
   *  `buildWanderSequence` itself is replaced. */
  stubPhases?: number[];
  /** Weather FX (living-world P4 Task 6): seed a live "rough session" error
   *  count. Writes `events.json` (global counters, merged over EMPTY_GLOBAL)
   *  with these values PLUS a `session.default.json` snapshot whose baseline
   *  zeros the same keys — combatErrorCount reads a DELTA, and a counter
   *  absent from the baseline diffs to 0 (session.ts's counterDelta), so the
   *  baseline must exist and explicitly zero every key this sets or the
   *  "rough" signal silently reads as 0 no matter what events.json says. */
  errorEvents?: Partial<
    Record<
      "errors_seen" | "tests_failed" | "type_errors" | "lint_fails" | "build_fails",
      number
    >
  >;
  /** Weather FX (living-world P4 Task 6): seed streak.json's `current` (the
   *  same account-scoped consecutive-net-positive-session counter already
   *  read for the prestige/streak badge, FR2.4). */
  streak?: number;
  /** Living ground (living-world follow-up): pin `session.default.json`'s
   *  `startedAt` so the ground's session seed is deterministic (the terrain is
   *  seeded off this value). Writes a snapshot with a zeroed baseline unless
   *  `errorEvents` already wrote one (that path folds this in). */
  sessionStartedAt?: number;
  /** Stub server/ground.ts's pickSessionWeather/isWeatherActive/buildWeatherTile
   *  to a fixed result (living-world ground-weather Task 2) — same idiom as
   *  stubProp above. The schedule is seeded off startedAt (the same value the
   *  elapsed-time check also depends on), so picking a startedAt that lands
   *  "inside the window" by brute-force search would be circular (the
   *  hash-based RNG isn't continuous in the seed) — a fixed-result stub sidesteps
   *  that entirely. MUST also re-export pickSessionGround with a fixed terrain
   *  or terrain rendering breaks in the same write-site block (state.ts's
   *  ground block calls pickSessionGround before the weather check). */
  stubGroundWeather?: {
    active: boolean;
    glyph?: string;
    color?: string;
    tile?: string;
  };
  /** Combat-weather Task 1 (design-combat-weather.md D3): seed a fake pending
   *  standoff by writing `pending-encounter.json` directly, bypassing
   *  combat.ts's real bakePendingScene entirely — `readPendingEncounter`
   *  (combat.ts) only validates `frames`/`bugId`/`startedAt`, and state.ts's
   *  combat block derives `artWidth` from `frames`' own displayWidth (no
   *  caption/project override here), so a single `width`-wide line is
   *  sufficient to pin a known `artWidth` without reproducing composePose.
   *  `startedAt` must match `sessionStartedAt` (session.ts's staleness guard,
   *  §5.3) — pass both together. */
  pendingEncounter?: { width: number };
}

/** Run writeStatusState in a fresh subprocess under a temp config dir and return
 *  the parsed status.json it wrote (or null if none was written). */
function render(c: RenderCase): Record<string, unknown> | null {
  const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
  const stateDir = join(cfgDir, "buddy-state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "config.json"), JSON.stringify(c.config));
  if (c.reaction) {
    // sessionId() falls back to "default" whenever TMUX_PANE is unset (pinned
    // below in the child's env), so this is the file writeStatusState reads.
    writeFileSync(
      join(stateDir, "reaction.default.json"),
      JSON.stringify({ ...c.reaction, timestamp: Date.now() }),
    );
  }
  if (c.mood) {
    // Without this file, getMood() (mood.ts) falls back to the wall-clock
    // getTimeOfDayMood() — pinning it here removes that nondeterminism for
    // any test that reasons about a specific wander range.
    writeFileSync(
      join(stateDir, "mood.json"),
      JSON.stringify({
        current: c.mood,
        since: Date.now(),
        intensity: 1,
        recentErrors: 0,
        recentTests: 0,
        recentDiffs: 0,
      }),
    );
  }
  if (c.errorEvents) {
    writeFileSync(join(stateDir, "events.json"), JSON.stringify(c.errorEvents));
    const zeroed = Object.fromEntries(
      Object.keys(c.errorEvents).map((k) => [k, 0]),
    );
    writeFileSync(
      join(stateDir, "session.default.json"),
      JSON.stringify({
        startedAt: c.sessionStartedAt ?? Math.floor(Date.now() / 1000) - 60,
        baseline: zeroed,
      }),
    );
  } else if (typeof c.sessionStartedAt === "number") {
    // Ground tests need a session snapshot (its terrain is seeded off
    // startedAt) but no rough-error baseline — write a minimal snapshot.
    writeFileSync(
      join(stateDir, "session.default.json"),
      JSON.stringify({ startedAt: c.sessionStartedAt, baseline: {} }),
    );
  }
  if (typeof c.streak === "number") {
    writeFileSync(
      join(stateDir, "streak.json"),
      JSON.stringify({
        current: c.streak,
        longest: c.streak,
        lastSessionAt: Math.floor(Date.now() / 1000),
        lastStartAt: 0,
      }),
    );
  }
  if (c.pendingEncounter) {
    writeFileSync(
      join(stateDir, "pending-encounter.json"),
      JSON.stringify({
        bugId: "gnat",
        tier: 1,
        frames: ["X".repeat(c.pendingEncounter.width)],
        sequence: [0],
        sightedAt: Date.now(),
        startedAt:
          c.sessionStartedAt ?? Math.floor(Date.now() / 1000) - 60,
      }),
    );
  }

  // A child-local Bun loader plugin swaps wander.ts for a throwing stub — fully
  // isolated to this process, so it can't leak into other test files. Each
  // stub block below registers its own `plugin({...})` call but shares ONE
  // `import { plugin } from "bun"` (hoisted below) — importing it twice in
  // the same module is a SyntaxError, which bites the instant two stubs are
  // active in the same render() call (e.g. stubProp + stubPhases together).
  const throwBlock = c.throwWander
    ? `
plugin({ name: "throw-wander", setup(b) {
  b.onLoad({ filter: /wander\\.ts$/ }, () => ({
    loader: "js",
    contents: "export function buildWanderSequence(){throw new Error('boom')}\\nexport function moodWalkOpts(){return {range:6,length:180,dwellMin:3,dwellMax:9,stepEvery:1,hopHeight:0,seed:1}}",
  }));
}});
`
    : "";

  // Same idiom, this time pinning props.ts's day-seeded pickDayProp to a
  // fixed PropArt so the prop-gating tests don't depend on the real date.
  // The stub's own source is built with JSON.stringify (rather than manual
  // quoting like throwWander above) so glyph characters can't collide with
  // the surrounding quote style.
  const propsStubBlock = c.stubProp
    ? `
plugin({ name: "stub-props", setup(b) {
  b.onLoad({ filter: /props\\.ts$/ }, () => ({
    loader: "js",
    contents: ${JSON.stringify(
      `export function pickDayProp(){return {prop:{feet:${JSON.stringify(
        c.stubProp.feet,
      )},ahead:${JSON.stringify(c.stubProp.ahead)}},palette:"bright"}}`,
    )},
  }));
}});
`
    : "";

  // Same idiom again: pins `buildWanderSequence`'s `phases` output (P4 Task
  // 4's step-kick tests need a SPECIFIC, guaranteed-long-enough run of step
  // ticks rather than hoping a `Date.now()`-seeded real walk happens to
  // produce one). `gaitWalkOpts` still has to exist (state.ts calls it
  // unconditionally before `buildWanderSequence`) but its return value is
  // discarded once `buildWanderSequence` itself is replaced.
  const stubPhasesBlock = c.stubPhases
    ? `
plugin({ name: "stub-phases", setup(b) {
  b.onLoad({ filter: /wander\\.ts$/ }, () => ({
    loader: "js",
    contents: ${JSON.stringify(
      `export function gaitWalkOpts(){return {range:4,length:${c.stubPhases.length},dwellMin:2,dwellMax:2,stepEvery:1,hopHeight:0,seed:1}}
export function buildWanderSequence(){
  const phases=${JSON.stringify(c.stubPhases)};
  return {horizontal:phases.map(()=>0),vertical:undefined,phases};
}`,
    )},
  }));
}});
`
    : "";
  // Same idiom again: fixes ground.ts's whole module (terrain selection PLUS
  // the weather schedule/active-check/weave) to a deterministic result so a
  // test can assert an exact active/inactive outcome regardless of the real
  // startedAt-seeded roll.
  const groundWeatherStubBlock = c.stubGroundWeather
    ? `
plugin({ name: "stub-ground-weather", setup(b) {
  b.onLoad({ filter: /ground\\.ts$/ }, () => ({
    loader: "js",
    contents: ${JSON.stringify(
      `export function pickSessionGround(){return {name:"meadow",tile:"„.",color:"4a7c3f"};}
export function pickSessionWeather(){return ${c.stubGroundWeather.active ? "({kind:\"snow\",startMs:0,durationMs:999999})" : "null"};}
export function isWeatherActive(){return ${c.stubGroundWeather.active};}
export function buildWeatherTile(){return {tile:${JSON.stringify(
        c.stubGroundWeather.tile ?? "„.+„.",
      )},glyph:${JSON.stringify(
        c.stubGroundWeather.glyph ?? "+",
      )},color:${JSON.stringify(c.stubGroundWeather.color ?? "e8f0f7")}};}`,
    )},
  }));
}});
`
    : "";

  const pluginImport =
    throwBlock || propsStubBlock || stubPhasesBlock || groundWeatherStubBlock
      ? `import { plugin } from "bun";\n`
      : "";

  const childSrc = `${pluginImport}${throwBlock}${propsStubBlock}${stubPhasesBlock}${groundWeatherStubBlock}
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const companion = {
  bones: generateBones("smoke", ${JSON.stringify(c.salt ?? "salt")}),
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
};
writeStatusState(companion, ${JSON.stringify(c.opts ?? {})});
`;
  const childPath = join(cfgDir, "child.mjs");
  writeFileSync(childPath, childSrc);

  const res = spawnSync("bun", [childPath], {
    // Pin the session id to "default" (sessionId()'s no-TMUX_PANE fallback) so
    // a persisted reaction file always lands where writeStatusState looks.
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir, TMUX_PANE: "" },
    encoding: "utf8",
  });

  const statusPath = join(stateDir, "status.json");
  const out = existsSync(statusPath)
    ? (JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>)
    : null;
  rmSync(cfgDir, { recursive: true, force: true });

  if (!out && res.status !== 0) {
    throw new Error(`child failed (status ${res.status}): ${res.stderr}`);
  }
  return out;
}

describe("writeStatusState — wander gate", () => {
  test("gameFeel=subtle ⇒ no wander sequences", () => {
    const state = render({ config: { gameFeel: "subtle", wanderEnabled: true } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=off ⇒ no wander sequences", () => {
    const state = render({ config: { gameFeel: "off", wanderEnabled: true } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderEnabled ⇒ horizontal sequence present", () => {
    const state = render({ config: { gameFeel: "full", wanderEnabled: true } });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
    expect((state!.wanderSequence as number[]).length).toBeGreaterThan(0);
    // Hop off by default ⇒ no row track.
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderEnabled=false ⇒ no sequences (opt-out)", () => {
    const state = render({ config: { gameFeel: "full", wanderEnabled: false } });
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });

  test("gameFeel=full + wanderHop ⇒ row sequence present too", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, wanderHop: true },
    });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
    expect(Array.isArray(state!.wanderRowSequence)).toBe(true);
    const rows = state!.wanderRowSequence as number[];
    expect(rows.length).toBe((state!.wanderSequence as number[]).length);
    expect(Math.max(...rows)).toBeGreaterThan(0);
  });
});

describe("writeStatusState — gait lockstep (living-world P1)", () => {
  test("full+wander gait: frameSequence is walk-length and carries lean frames", () => {
    const state = render({ config: { gameFeel: "full", wanderEnabled: true } });
    const wanderSequence = state!.wanderSequence as number[];
    const frameSequence = state!.frameSequence as number[];
    const frames = state!.frames as string[];
    expect(wanderSequence.length).toBeGreaterThan(0);
    expect(frameSequence.length).toBe(wanderSequence.length);
    // Variants were appended: frames has at least lean+peek beyond the base 5.
    expect(frames.length).toBeGreaterThanOrEqual(7);
    // Every index in the gait sequence points inside frames.
    const max = Math.max(...frameSequence);
    expect(max).toBeLessThan(frames.length);
    // Indices ≥5 are the appended lean/peek variants, so their presence
    // proves the phase→frame injection actually ran rather than just
    // passing through the base cycle.
    expect(frameSequence.some((f) => f >= 5)).toBe(true);
  });

  test("subtle keeps the classic short frameSequence (no gait remap)", () => {
    const state = render({ config: { gameFeel: "subtle", wanderEnabled: true } });
    expect(state!.wanderSequence).toBeUndefined();
    // Classic idle cycle is 18 ticks (21 for stretch pilot species) — the
    // point is it's NOT the 180-tick walk-length remap.
    expect((state!.frameSequence as number[]).length).toBeLessThanOrEqual(21);
  });
});

describe("writeStatusState — angry-gait auto-quiet exemption (D14)", () => {
  // REASON_EMOTION maps "error" to angry emotion; SPIKE_REASONS ALSO contains
  // "error" and unconditionally clamps a configured `full` down to `subtle` —
  // so without the exemption, the one reaction that drives angry emotion is
  // also the one reaction that always clamps gait/emote away. D14 has the
  // angry idle expression read the *configured* level instead (the sightBug
  // precedent, 2026-07-09): the error-born expression must survive the clamp
  // the error itself causes.
  test("a live error reaction at configured full still bakes the gaited walk", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      reaction: { reaction: "ugh, an error", reason: "error" },
    });
    const wanderSequence = state!.wanderSequence as number[] | undefined;
    const frameSequence = state!.frameSequence as number[];
    expect(Array.isArray(wanderSequence)).toBe(true);
    expect(wanderSequence!.length).toBeGreaterThan(0);
    expect(frameSequence.length).toBe(wanderSequence!.length);
  });

  test("the same reaction at configured subtle still yields no wander (exemption lifts the CLAMP, never raises the configured level)", () => {
    const state = render({
      config: { gameFeel: "subtle", wanderEnabled: true },
      reaction: { reaction: "ugh, an error", reason: "error" },
    });
    expect(state!.wanderSequence).toBeUndefined();
  });
});

describe("writeStatusState — stinger opt (living-world P1)", () => {
  // Both tests below reason about the ambient wander never reaching 3, which
  // only holds for the "focused" mood profile (MOOD_WALK.focused: range 2 —
  // see wander.ts). Without an explicit mood.json, getMood() (mood.ts) falls
  // back to getTimeOfDayMood(), a wall-clock lookup: 12:00–16:59 local time
  // maps to "happy" (range 4) and 17:00–19:59 to "excited" (range 6), both of
  // which legitimately reach ≥3 with no stinger at all — the prior version of
  // this suite pinned nothing here and flaked in exactly those hours. Pin the
  // mood explicitly so the ≥3 / <3 assertions test the stinger, not the
  // clock.
  test("a walkon stinger splices an arc into wanderSequence", () => {
    // walkon anchors immediately (no celebration to wait out), so its arc
    // head lands at the tick the subprocess's own write-time clock reaches —
    // bracket the child's spawn window with the *test's* clock (before/after
    // spawnSync) rather than trusting the two processes' clocks to agree to
    // the second, so this can't flake on spawn latency.
    const before = Math.floor(Date.now() / 1000);
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      opts: { stinger: "walkon" },
      mood: "focused", // pinned dependency: MOOD_WALK.focused range=2 < 3
    });
    const after = Math.floor(Date.now() / 1000);
    const seq = state!.wanderSequence as number[];
    expect(Array.isArray(seq)).toBe(true);
    const len = seq.length;
    expect(len).toBeGreaterThan(0);
    // The ambient focused-mood walk (range 2, level 1 ⇒ no nudge) never
    // reaches 3, so a hit here can only be the stinger's arc head (which
    // floors at max(range, 3) = 3 per spliceStingerArc).
    let hit = false;
    for (let t = before; t <= after + 2 && !hit; t++) {
      const at = ((t % len) + len) % len;
      if (seq[at] >= 3) hit = true;
    }
    expect(hit).toBe(true);
  });

  test("no stinger opt leaves the ambient walk unmodified (control)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused", // pinned dependency: MOOD_WALK.focused range=2 < 3
    });
    const seq = state!.wanderSequence as number[];
    // Same focused-mood/level-1 ambient walk as above, with no stinger —
    // range 2 never reaches 3, confirming the hit above isn't just ambient
    // wander noise.
    expect(seq.every((v) => v < 3)).toBe(true);
  });
});

describe("writeStatusState — loot-dash inspect beat (living-world P4 Task 5)", () => {
  // Same bracket idiom as the walkon stinger test above (before/after the
  // subprocess's own write-time clock), plus the same pinned "focused" mood
  // dependency: MOOD_WALK.focused range=2 never reaches 3, so the arc's
  // reach floors at exactly 3 (Math.max(...horizontal, 3)) — which fixes
  // stingerInspectOffsets("lootdash", 3) at [3, 4, 5], deterministically,
  // without needing to reason about the ambient walk's actual values.
  test("a lootdash stinger poses the inspect frame with the dropped-item glyph at its exact pause ticks", () => {
    const before = Math.floor(Date.now() / 1000);
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      opts: { stinger: "lootdash" },
      mood: "focused", // pinned dependency: MOOD_WALK.focused range=2 < 3
    });
    const after = Math.floor(Date.now() / 1000);
    const frameSequence = state!.frameSequence as number[];
    const frames = state!.frames as string[];
    const len = frameSequence.length;
    expect(len).toBeGreaterThan(0);

    const offsets = [3, 4, 5]; // stingerInspectOffsets("lootdash", 3)
    let hit = false;
    for (let t = before; t <= after + 2 && !hit; t++) {
      const at = (t + STINGER_DELAY_TICKS) % len;
      hit = offsets.every((k) => {
        const idx = frameSequence[(at + k) % len];
        return frames[idx]?.includes(LOOTDASH_ITEM_GLYPH);
      });
    }
    expect(hit).toBe(true);
  });

  test("a walkon stinger (no inspect beat) never poses the item glyph anywhere in frameSequence", () => {
    // Control: victory/walkon report an empty inspect span (wander.test.ts
    // pins the pure accessor); this confirms the state.ts wiring actually
    // respects that — no frame the walk cycles through shows the item glyph.
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      opts: { stinger: "walkon" },
      mood: "focused",
    });
    const frameSequence = state!.frameSequence as number[];
    const frames = state!.frames as string[];
    for (const idx of frameSequence) {
      expect(frames[idx]).not.toContain(LOOTDASH_ITEM_GLYPH);
    }
  });
});

describe("writeStatusState — wander backfill (NFR3)", () => {
  test("old config.json (no wander keys) ⇒ DEFAULT_CONFIG enables wander", () => {
    // Pre-wander config: only gameFeel set. loadConfig merges DEFAULT_CONFIG,
    // so wanderEnabled defaults true ⇒ a sequence is written.
    const state = render({ config: { gameFeel: "full" } });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
  });
});

describe("writeStatusState — mood-expressive walk is read-only (P5c / NFR1)", () => {
  test("a full + wander write never mutates mood.json", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
    const stateDir = join(cfgDir, "buddy-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ gameFeel: "full", wanderEnabled: true }),
    );
    const moodPath = join(stateDir, "mood.json");
    const moodJson = JSON.stringify(
      {
        current: "excited",
        since: 1_700_000_000_000,
        intensity: 2,
        recentErrors: 0,
        recentTests: 0,
        recentDiffs: 0,
      },
      null,
      2,
    );
    writeFileSync(moodPath, moodJson);

    const childSrc = `
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
writeStatusState({
  bones: generateBones("smoke", "salt"),
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
});
`;
    const childPath = join(cfgDir, "child.mjs");
    writeFileSync(childPath, childSrc);
    const res = spawnSync("bun", [childPath], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);

    // The walk *reads* mood to shape the animation; it must write nothing back.
    expect(readFileSync(moodPath, "utf8")).toBe(moodJson);
    rmSync(cfgDir, { recursive: true, force: true });
  });
});

describe("writeStatusState — generator failure is swallowed (NFR4)", () => {
  test("a throwing wander generator never breaks the write", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      throwWander: true,
    });
    // Write still completes, just without wander fields — buddy stays planted.
    expect(state).not.toBeNull();
    expect(state!.name).toBe("Waffle");
    expect(state!.wanderSequence).toBeUndefined();
    expect(state!.wanderRowSequence).toBeUndefined();
  });
});

describe("writeStatusState — owned-upgrade hat (design-derive-upgrades.md)", () => {
  test("status.json's hat reflects an owned upgrade, not the innate (none) bones", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
    const stateDir = join(cfgDir, "buddy-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "xp.json"),
      JSON.stringify({
        totalXp: 0,
        unlockedUpgrades: ["crown"],
        upgradeEffectsDerived: true,
      }),
    );

    const childSrc = `
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const bones = generateBones("smoke", "salt");
bones.hat = "none"; // innate hat — the derived "crown" must come from ownership
writeStatusState({
  bones,
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
});
`;
    const childPath = join(cfgDir, "child.mjs");
    writeFileSync(childPath, childSrc);
    const res = spawnSync("bun", [childPath], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);

    const status = JSON.parse(
      readFileSync(join(stateDir, "status.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(status.hat).toBe("crown");
    rmSync(cfgDir, { recursive: true, force: true });
  });
});

describe("writeStatusState — equipped gear renders on the sprite", () => {
  test("weapon + trinket glyphs land in status.json frames (derive-on-read)", () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "buddy-wander-"));
    const stateDir = join(cfgDir, "buddy-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "xp.json"),
      JSON.stringify({
        totalXp: 0,
        equipment: { weapon: "foam_sword", trinket: "rubber_duck" },
        upgradeEffectsDerived: true,
      }),
    );

    const childSrc = `
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const bones = generateBones("smoke", "salt");
bones.hat = "none"; // a random tinyduck hat would fake the ",>" containment
writeStatusState({
  bones,
  name: "Waffle",
  personality: "x",
  hatchedAt: Date.now(),
  userId: "smoke",
});
`;
    const childPath = join(cfgDir, "child.mjs");
    writeFileSync(childPath, childSrc);
    const res = spawnSync("bun", [childPath], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
      encoding: "utf8",
    });
    expect(res.status).toBe(0);

    const status = JSON.parse(
      readFileSync(join(stateDir, "status.json"), "utf8"),
    ) as { frames: string[] };
    // foam_sword's art is "†", rubber_duck's is ",>" — neither occurs in any
    // species' innate art, so containment proves the overlay rendered.
    for (const frame of status.frames) {
      expect(frame).toContain("†");
      expect(frame).toContain(",>");
    }
    rmSync(cfgDir, { recursive: true, force: true });
  });
});

describe("writeStatusState — ambient ground prop (living-world P4 Task 3)", () => {
  // Neither glyph occurs in any species' innate art, so containment proves
  // the prop landed (a collision would silently skip the overlay).
  const PROP = { feet: "❦", ahead: "•" };

  test("full + wanderEnabled: idle frames carry the day's prop", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    // Last frame is the Task 5 loot-dash inspect frame — always appended
    // when gaitVariants is on, and it intentionally shows the item glyph
    // instead of the day's own prop at `ahead` (its own describe block
    // below covers that swap).
    for (const frame of frames.slice(0, -1)) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });

  test("subtle: props are full-only idle juice — absent", () => {
    const state = render({
      config: { gameFeel: "subtle", wanderEnabled: true },
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).not.toContain(PROP.feet);
      expect(frame).not.toContain(PROP.ahead);
    }
  });

  test("off: no prop", () => {
    const state = render({
      config: { gameFeel: "off", wanderEnabled: true },
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).not.toContain(PROP.feet);
      expect(frame).not.toContain(PROP.ahead);
    }
  });

  test("full but wanderEnabled=false: prop is independent of the wander opt-out — still full-gated, so still present", () => {
    // idleGate === "full" doesn't depend on wanderEnabled (that only gates
    // gaitVariants/wantGait) — props are full-idle juice, not wander-specific,
    // so they render even with wander off.
    const state = render({
      config: { gameFeel: "full", wanderEnabled: false },
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });

  test("a live error reaction at configured full still bakes the prop (D14 exemption carries forward)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      reaction: { reaction: "ugh, an error", reason: "error" },
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    // See the "always appended last" note above.
    for (const frame of frames.slice(0, -1)) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });

  test("no stub (real pickDayProp): write never breaks — props are best-effort", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
    });
    expect(Array.isArray(state!.frames)).toBe(true);
    expect((state!.frames as string[]).length).toBeGreaterThan(0);
  });
});

describe("writeStatusState — prop kick (living-world P4 Task 4)", () => {
  // Neither glyph occurs in any species' innate art, so containment proves
  // the prop landed (a collision would silently skip the overlay).
  const PROP = { feet: "❦", ahead: "•" };
  // The finalized `state.frames` have gone through `finalizeIdleBlock`
  // (unshifts the emote FX row, trims dead top rows) — the row the ahead
  // glyph lands on there is NOT necessarily row 4 the way it is straight out
  // of `getStatusFrames`, so search every row rather than assuming an index.
  const aheadColumn = (frame: string): number => {
    for (const row of frame.split("\n")) {
      const col = [...row].indexOf(PROP.ahead);
      if (col >= 0) return col;
    }
    return -1;
  };

  test("the pebble is present on every frame of the real baked walk — never withheld (default companion is chonk, one of the 9 cramped species)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    // Last frame is the Task 5 loot-dash inspect frame — see the note in the
    // "ambient ground prop" describe block above.
    for (const frame of frames.slice(0, -1)) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });

  test("a species with room (pikachu, salt \"x\") genuinely slides the pebble through multiple columns across the real baked walk, and it's never absent", () => {
    // This is the state_wander-level proof the kick reaches the real write,
    // not just getStatusFrames in isolation: walk the actual frameSequence
    // this write produced and read the ahead glyph's rendered column at
    // every tick. `stubPhases` pins the walk's phase track (W1 — the real
    // generator seeds off Date.now() with no config-level override, so this
    // is deterministic rather than hoping a real walk happens to travel):
    // dwell(4) → 5 step ticks (enough to run past pikachu's 4 kick columns
    // and saturate) → edge-dwell(2) → 2 more step ticks → home-linger →
    // dwell. `propKickFrameSequence` only ever overrides a phase===1 tick —
    // every other tick (dwell/edge/home alike) renders the plain prop at its
    // rest column (11), so the second step run starts fresh from col 10.
    const stubPhases = [
      0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 1, 1, 3, 0, 0, 0, 0, 0, 0,
    ];
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      stubProp: PROP,
      salt: "x",
      stubPhases,
    });
    const frames = state!.frames as string[];
    const frameSequence = state!.frameSequence as number[];
    expect(frameSequence.length).toBe(stubPhases.length);
    const columns = frameSequence.map((idx) => aheadColumn(frames[idx]));
    // Never absent: every tick's frame contains the pebble somewhere.
    expect(columns.every((c) => c >= 0)).toBe(true);
    // Genuine motion, deterministically: every one of pikachu's positions —
    // rest (11) plus all 4 kick columns (10, 9, 8, 7) — actually appears,
    // and in the expected order over the stubbed run.
    expect(columns).toEqual([
      11, 11, 11, 11, // dwell
      10, 9, 8, 7, 7, // 5 step ticks: climbs then saturates at col 7
      11, 11, // edge-dwell: not a step tick, plain prop at rest
      10, 9, // 2 more step ticks: fresh run, restarts from col 10
      11, // home-linger: plain prop at rest
      11, 11, 11, 11, 11, 11, // dwell
    ]);
  });

  test("gaitVariants off (wanderEnabled:false) ⇒ no kick frames exist, so every frame keeps the pebble at its rest anchor", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: false },
      stubProp: PROP,
      salt: "x",
    });
    const frames = state!.frames as string[];
    for (const frame of frames) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
      expect(aheadColumn(frame)).toBe(11);
    }
  });
});

describe("writeStatusState — weather FX (living-world P4 Task 6)", () => {
  // Drizzle ('), sparkle (*) — the idle FX row's weather glyphs, checked on
  // the very first (top) row of each rendered frame, exactly like the emote
  // tests above check for "!"/"zZz".
  const topRow = (frame: string): string => frame.split("\n")[0];

  test("full + a rough session error count ⇒ drizzle in the idle FX row", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      errorEvents: { tests_failed: 4 }, // tierForErrors(4) = 2, ≥ the rough cutoff
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(topRow(frame)).toContain("'");
  });

  test("full + an active net-positive session streak (no errors) ⇒ sparkle in the idle FX row", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      streak: 4,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(topRow(frame)).toContain("*");
  });

  test("subtle: weather is full-only idle juice — neither drizzle nor sparkle, even with both signals armed", () => {
    const state = render({
      config: { gameFeel: "subtle", wanderEnabled: true },
      errorEvents: { tests_failed: 4 },
      streak: 4,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(topRow(frame)).not.toContain("'");
      expect(topRow(frame)).not.toContain("*");
    }
  });

  test("off: neither drizzle nor sparkle", () => {
    const state = render({
      config: { gameFeel: "off", wanderEnabled: true },
      errorEvents: { tests_failed: 4 },
      streak: 4,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(topRow(frame)).not.toContain("'");
      expect(topRow(frame)).not.toContain("*");
    }
  });

  test("a small (below-cutoff) error count does not read as 'rough' ⇒ no drizzle", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      errorEvents: { errors_seen: 1 }, // tierForErrors(1) = 1, below the rough cutoff
    });
    const frames = state!.frames as string[];
    for (const frame of frames) expect(topRow(frame)).not.toContain("'");
  });

  test("no streak at all (0) ⇒ no sparkle", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
    });
    const frames = state!.frames as string[];
    for (const frame of frames) expect(topRow(frame)).not.toContain("*");
  });

  test("precedence: a rough error count wins over a simultaneous clean streak (drizzle, not sparkle)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      errorEvents: { tests_failed: 4 },
      streak: 4,
    });
    const frames = state!.frames as string[];
    for (const frame of frames) {
      expect(topRow(frame)).toContain("'");
      expect(topRow(frame)).not.toContain("*");
    }
  });

  // D14-style exemption (living-world P1): the SAME "error" reaction that
  // drives angry emotion is also a SPIKE_REASON that clamps gate full→subtle.
  // Drizzle is error-BORN in the same sense the angry emote/gait are, so it
  // rides `idleGate` and pierces the clamp exactly when emotion is angry.
  test("a live 'error' reaction at configured full still shows drizzle (D14 exemption: angry is error-born, so it survives the very clamp the error causes)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      reaction: { reaction: "ugh, an error", reason: "error" },
      errorEvents: { tests_failed: 4 },
    });
    const frames = state!.frames as string[];
    for (const frame of frames) expect(topRow(frame)).toContain("'");
  });

  // The counterfactual that proves the exemption is scoped to angry — not to
  // "any spike reason" — matching the reasoning in the task report: "build-fail"
  // is ALSO a SPIKE_REASON (clamps gate to subtle) but is UNMAPPED in
  // REASON_EMOTION, so emotion stays "neutral", idleGate reduces to the plain
  // clamped `gate`, and drizzle — bound to idleGate — is correctly suppressed
  // even though the session is just as "rough" by the numbers.
  test("a live 'build-fail' reaction (a spike, but NOT angry) at configured full does NOT show drizzle — the exemption doesn't leak past the angry-emotion window", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      reaction: { reaction: "build broke", reason: "build-fail" },
      errorEvents: { tests_failed: 4 },
    });
    const frames = state!.frames as string[];
    for (const frame of frames) expect(topRow(frame)).not.toContain("'");
  });

  test("sparkle takes the PLAIN clamp — an active error-spike (angry) suppresses it even though drizzle would survive at the same tick (no drizzle signal here, streak only)", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      reaction: { reaction: "ugh, an error", reason: "error" },
      streak: 4, // clean streak, no rough errors this session
    });
    const frames = state!.frames as string[];
    for (const frame of frames) {
      expect(topRow(frame)).not.toContain("*"); // gate clamped to subtle, no exemption for sparkle
      expect(topRow(frame)).not.toContain("'"); // no rough error count either
    }
  });

  test("no fixtures at all (real events/streak files absent): write never breaks — weather is best-effort", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
    });
    expect(Array.isArray(state!.frames)).toBe(true);
    expect((state!.frames as string[]).length).toBeGreaterThan(0);
  });
});

describe("writeStatusState — worldDressing opt-out (living-world P4)", () => {
  // The granular toggle silences BOTH ambient layers (props + weather) at
  // full without dropping gameFeel — so the emote/wander still render but the
  // day-seeded specks and weather glyphs do not. PROP glyphs are absent from
  // every species' innate art; weather rides the top FX row (' / *).
  const PROP = { feet: "❦", ahead: "•" };
  const topRow = (frame: string): string => frame.split("\n")[0];

  test("worldDressing=false at full: the day's prop is suppressed", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, worldDressing: false },
      mood: "focused",
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).not.toContain(PROP.feet);
      expect(frame).not.toContain(PROP.ahead);
    }
  });

  test("worldDressing=false at full: sparkle is suppressed even with an active streak", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, worldDressing: false },
      mood: "focused",
      streak: 4,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(topRow(frame)).not.toContain("*");
  });

  test("worldDressing=false at full: drizzle is suppressed even with a rough error count", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, worldDressing: false },
      mood: "focused",
      errorEvents: { tests_failed: 4 },
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(topRow(frame)).not.toContain("'");
  });

  test("worldDressing=false is surgical: the idle wander still animates", () => {
    // Proves the toggle only strips ambient dressing, not the rest of the
    // full-gate juice — wanderSequence must still be present.
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true, worldDressing: false },
      mood: "focused",
    });
    expect(Array.isArray(state!.wanderSequence)).toBe(true);
    expect((state!.wanderSequence as number[]).length).toBeGreaterThan(0);
  });

  test("old config.json (no worldDressing key) ⇒ DEFAULT_CONFIG enables dressing (prop present)", () => {
    // NFR3 backfill: loadConfig merges DEFAULT_CONFIG, so a pre-P4 config with
    // no worldDressing key inherits the default (true) and still gets its prop.
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    // Last frame is the loot-dash inspect frame (swaps the ahead prop for the
    // item glyph) — same carve-out the Task 3 block documents.
    for (const frame of frames.slice(0, -1)) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });
});

describe("writeStatusState — living ground (living-world follow-up)", () => {
  // The ground is a standalone status.json field (tile + colour), NOT baked
  // into frames — the shell paints it as a fixed full-width bottom row. It is
  // session-seeded off the snapshot's startedAt, so these tests pin startedAt
  // and assert against the pure pickSessionGround() the write wires to.
  const STARTED = 1_700_000_000;
  const TERRAIN = pickSessionGround(STARTED);

  test("full + groundEnabled + a session snapshot ⇒ ground tile + colour match the session seed", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    expect(state!.ground).toBe(TERRAIN.tile);
    expect(state!.groundColor).toBe(TERRAIN.color);
  });

  test("the ground is stable within a session (same startedAt ⇒ identical terrain)", () => {
    const a = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    const b = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    expect(a!.ground).toBe(b!.ground);
    expect(a!.groundColor).toBe(b!.groundColor);
  });

  test("subtle: the ground is full-only ⇒ absent", () => {
    const state = render({
      config: { gameFeel: "subtle", groundEnabled: true },
      sessionStartedAt: STARTED,
    });
    expect(state!.ground).toBeUndefined();
    expect(state!.groundColor).toBeUndefined();
  });

  test("off: no ground", () => {
    const state = render({
      config: { gameFeel: "off", groundEnabled: true },
      sessionStartedAt: STARTED,
    });
    expect(state!.ground).toBeUndefined();
  });

  test("groundEnabled=false at full: the ground opt-out suppresses the row", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: false },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    expect(state!.ground).toBeUndefined();
    expect(state!.groundColor).toBeUndefined();
  });

  test("ground is surgical: it never touches the wander sequence or the sprite frames", () => {
    // Toggling ground off leaves the rest of the full-gate juice intact.
    const on = render({
      config: { gameFeel: "full", wanderEnabled: true, groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    const off = render({
      config: { gameFeel: "full", wanderEnabled: true, groundEnabled: false },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    expect(Array.isArray(on!.wanderSequence)).toBe(true);
    expect(Array.isArray(off!.wanderSequence)).toBe(true);
    // The sprite frames are identical whether or not the ground row is on —
    // ground lives entirely outside the flipbook.
    expect(off!.frames).toEqual(on!.frames);
  });

  test("no session snapshot (pre-first-session): the write never breaks, ground just absent", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
    });
    expect(Array.isArray(state!.frames)).toBe(true);
    expect(state!.ground).toBeUndefined();
  });

  test("old config.json (no groundEnabled key) ⇒ DEFAULT_CONFIG enables the ground", () => {
    // NFR3 backfill: loadConfig merges DEFAULT_CONFIG, so a config predating this
    // feature inherits groundEnabled=true and still paints the floor.
    const state = render({
      config: { gameFeel: "full" },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    expect(state!.ground).toBe(TERRAIN.tile);
  });
});

describe("writeStatusState — ground weather (living-world follow-up)", () => {
  // The schedule is derived off startedAt at write time — no persisted
  // schedule file (unlike combat.ts's writeEncounter side channel). A fixed
  // stub of ground.ts's whole module sidesteps the circularity of trying to
  // brute-force a startedAt that lands "inside the window" for a real roll.
  const STARTED = 1_700_000_000;

  test("full + groundEnabled + active window ⇒ status.json carries the woven tile + weather fields", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: {
        active: true,
        glyph: "+",
        color: "e8f0f7",
        tile: "„.+„.",
      },
    });
    expect(state!.ground).toBe("„.+„.");
    expect(state!.groundWeatherGlyph).toBe("+");
    expect(state!.groundWeatherColor).toBe("e8f0f7");
  });

  test("full + groundEnabled + inactive window ⇒ plain terrain tile, no weather fields", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: false },
    });
    expect(state!.ground).toBe("„."); // the stub's plain pickSessionGround terrain
    expect(state!.groundWeatherGlyph).toBeUndefined();
    expect(state!.groundWeatherColor).toBeUndefined();
  });

  test("groundEnabled: false ⇒ no ground field at all regardless of the schedule (D3)", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: false },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(state!.ground).toBeUndefined();
    expect(state!.groundWeatherGlyph).toBeUndefined();
  });

  test("subtle/off ⇒ no ground field, no weather fields, regardless of the schedule", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const state = render({
        config: { gameFeel, groundEnabled: true },
        sessionStartedAt: STARTED,
        stubGroundWeather: { active: true },
      });
      expect(state!.ground).toBeUndefined();
      expect(state!.groundWeatherGlyph).toBeUndefined();
    }
  });
});

describe("writeStatusState — falling weather sky band (living-world follow-up, Task 2)", () => {
  // Reuses the SAME stubGroundWeather idiom as the ground-weather describe
  // block above — buildFallingWeatherGapBand (weatherfall.ts) is pure and
  // seeded off startedAt/schedule.kind only, so it needs no clock/day stub of
  // its own; pinning ground.ts's schedule via stubGroundWeather is sufficient
  // to make the whole write deterministic (plan-falling-weather.md Task 2).
  const STARTED = 1_700_000_000;

  test("full + groundEnabled + active window ⇒ status.json carries the field + its sequence", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(Array.isArray(state!.weatherFallGapFrames)).toBe(true);
    expect((state!.weatherFallGapFrames as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(state!.weatherFallSequence)).toBe(true);
    expect((state!.weatherFallSequence as unknown[]).length).toBe(
      (state!.weatherFallGapFrames as unknown[]).length,
    );
    // design-weather-frontlayer.md F9: the separately-baked, SGR-carrying ART
    // band that used to reserve sky rows above the sprite is gone entirely —
    // not merely unread by the shell. A payload jq re-parses every second
    // should not carry a layer nothing consumes.
    expect(state!.weatherFallFrames).toBeUndefined();
    // NOW % len indexing (every other baked sequence's contract) needs a
    // plain 0..len-1 index array, not e.g. frame indices out of range.
    const seq = state!.weatherFallSequence as number[];
    seq.forEach((idx, i) => expect(idx).toBe(i));
  });

  test("full + groundEnabled + inactive window ⇒ neither field is present (byte-identical to ground-only render)", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: false },
    });
    expect(state!.weatherFallSequence).toBeUndefined();
  });

  test("ground rendered with NO stubGroundWeather at all (real, unstubbed schedule) never carries falling-weather fields unless a real window happens to be open — back-compat pin: existing ground tests stay green", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
    });
    // Doesn't assert on/off (a real roll off a fixed seed may or may not be
    // active) — just that the two fields are only ever a matched pair, never
    // one without the other, exactly like groundWeatherGlyph/Color already are.
    const hasFrames = state!.weatherFallGapFrames !== undefined;
    const hasSeq = state!.weatherFallSequence !== undefined;
    expect(hasFrames).toBe(hasSeq);
  });

  test("groundEnabled: false ⇒ no falling-weather fields regardless of the schedule (D11)", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: false },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(state!.weatherFallGapFrames).toBeUndefined();
    expect(state!.weatherFallSequence).toBeUndefined();
  });

  test("subtle/off ⇒ no falling-weather fields, regardless of the schedule", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const state = render({
        config: { gameFeel, groundEnabled: true },
        sessionStartedAt: STARTED,
        stubGroundWeather: { active: true },
      });
      expect(state!.weatherFallGapFrames).toBeUndefined();
      expect(state!.weatherFallSequence).toBeUndefined();
    }
  });

  // design-combat-weather.md Task 1 (D3) used to bake the band at the active
  // combat scene's artWidth, because a band fixed at the idle SKY_FALL_WIDTH=14
  // would visually truncate over just the player. design-weather-frontlayer.md
  // F2 dissolves that problem rather than solving it: there is one full-width
  // field composited over the entire line, so no scene width can outgrow it.
  describe("the field is scene-width-independent (design-combat-weather.md D3, dissolved by F2)", () => {
    for (const [label, pendingEncounter] of [
      ["combat active (pending standoff, artWidth 24)", { width: 24 }],
      ["idle only (no combat)", undefined],
    ] as const) {
      test(`${label} + weather active ⇒ the SAME MAX_GAP_WIDTH field, never a scene-sized one`, () => {
        const state = render({
          config: { gameFeel: "full", groundEnabled: true },
          mood: "focused",
          sessionStartedAt: STARTED,
          stubGroundWeather: { active: true },
          ...(pendingEncounter ? { pendingEncounter } : {}),
        });
        const frames = state!.weatherFallGapFrames as string[];
        expect(Array.isArray(frames)).toBe(true);
        expect(frames.length).toBeGreaterThan(0);
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            expect(displayWidth(line)).toBe(110);
          }
        }
      });
    }

    test("combat and idle bake the byte-identical field at the same seed (no width branch survives)", () => {
      const base = {
        config: { gameFeel: "full", groundEnabled: true } as const,
        mood: "focused" as const,
        sessionStartedAt: STARTED,
        stubGroundWeather: { active: true } as const,
      };
      const combat = render({ ...base, pendingEncounter: { width: 24 } });
      expect(combat!.artWidth).toBe(24);
      const idle = render({ ...base });
      expect(idle!.artWidth).toBeUndefined();
      expect(combat!.weatherFallGapFrames).toEqual(idle!.weatherFallGapFrames);
    });
  });
});

describe("writeStatusState — full-width falling weather GAP band (plan-fullwidth-weather.md Task 2)", () => {
  // Same stubGroundWeather idiom as the sibling describe blocks above —
  // buildFallingWeatherGapBand (weatherfall.ts) is pure and seeded off
  // startedAt/schedule.kind only, no clock/day stub of its own needed.
  const STARTED = 1_700_000_000;

  test("full + groundEnabled + active window ⇒ status.json carries weatherFallGapFrames + weatherFallGapGlyph + weatherFallGapColor", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(Array.isArray(state!.weatherFallGapFrames)).toBe(true);
    expect((state!.weatherFallGapFrames as unknown[]).length).toBeGreaterThan(0);
    expect(state!.weatherFallGapGlyph).toBe("❄");
    expect(state!.weatherFallGapColor).toBe("e8f0f7"); // dark theme default
    // Every gap-band frame line must measure MAX_GAP_WIDTH=110 display cells —
    // the fixed, generously-wide bake width bash later clips to the live ROAM.
    const frames = state!.weatherFallGapFrames as string[];
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        expect(displayWidth(line)).toBe(110);
      }
    }
    // D3: the gap band must be PLAIN (ANSI-free) — the ART band's own
    // weatherFallFrames carries embedded SGR, this must NOT.
    for (const frame of frames) {
      expect(frame).not.toContain("\x1b");
    }
  });

  // Task 2's checklist calls for the glyph/color to match the active
  // kind/THEME, but every other gap-band test above runs at the default dark
  // theme — so state.ts:1629's `SKY_FALL_COLOR[theme][kind]` indexing was
  // unpinned: hardcoding the dark palette there would leave them all green.
  // That is precisely the line behind this arc's user-reported "snow is
  // invisible on my white background" bug, so it gets its own pin. (The
  // weatherfall.ts-level theme test covers the PALETTE; this covers state.ts
  // actually THREADING cfg.theme into it.)
  test("cfg.theme: light ⇒ gap-band color is the light-theme hex, not the dark default", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true, theme: "light" },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(state!.weatherFallGapColor).toBe("4a6f94"); // light-theme snow
    expect(state!.weatherFallGapColor).not.toBe("e8f0f7");
    // The glyph is theme-independent — only the tint changes.
    expect(state!.weatherFallGapGlyph).toBe("❄");
  });

  test('cfg.theme: "auto"/absent ⇒ gap-band color resolves to the dark palette (state.ts\'s documented auto⇒dark rule)', () => {
    for (const theme of ["auto", undefined]) {
      const cfg: Record<string, unknown> = { gameFeel: "full", groundEnabled: true };
      if (theme !== undefined) cfg.theme = theme;
      const state = render({
        config: cfg,
        mood: "focused",
        sessionStartedAt: STARTED,
        stubGroundWeather: { active: true },
      });
      expect(state!.weatherFallGapColor).toBe("e8f0f7");
    }
  });

  test("weatherFallSequence (already computed for the ART band) is reused for the gap band too — no second sequence field", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    const gapFrames = state!.weatherFallGapFrames as string[];
    const seq = state!.weatherFallSequence as number[];
    expect(seq.length).toBe(gapFrames.length);
    // No separate weatherFallGapSequence field exists.
    expect(state!.weatherFallGapSequence).toBeUndefined();
  });

  test("full + groundEnabled + inactive window ⇒ none of the three gap fields are present", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: false },
    });
    expect(state!.weatherFallGapFrames).toBeUndefined();
    expect(state!.weatherFallGapGlyph).toBeUndefined();
    expect(state!.weatherFallGapColor).toBeUndefined();
  });

  test("groundEnabled: false ⇒ no gap-band fields regardless of the schedule", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: false },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(state!.weatherFallGapFrames).toBeUndefined();
    expect(state!.weatherFallGapGlyph).toBeUndefined();
    expect(state!.weatherFallGapColor).toBeUndefined();
  });

  test("subtle/off ⇒ no gap-band fields, regardless of the schedule", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const state = render({
        config: { gameFeel, groundEnabled: true },
        sessionStartedAt: STARTED,
        stubGroundWeather: { active: true },
      });
      expect(state!.weatherFallGapFrames).toBeUndefined();
      expect(state!.weatherFallGapGlyph).toBeUndefined();
      expect(state!.weatherFallGapColor).toBeUndefined();
    }
  });

  // design-weather-frontlayer.md F9: the ART band is retired, so what used to
  // be an "additive, not a replacement" pin now pins the opposite — one layer,
  // and it is the PLAIN one. Both halves matter: a leftover SGR-carrying band
  // would be dead payload, and a field that started carrying SGR would break
  // the shell's character-indexed slice and splice (D3).
  test("exactly ONE weather layer ships, and it is ANSI-free (F9)", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
    });
    expect(state!.weatherFallFrames).toBeUndefined();
    const frames = state!.weatherFallGapFrames as string[];
    expect(Array.isArray(frames)).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.includes("❄"))).toBe(true);
    expect(frames.some((f) => f.includes("\x1b"))).toBe(false);
    // And it is tall enough to cover a whole widget block, not a 3-row strip.
    for (const frame of frames) {
      expect(frame.split("\n").length).toBe(14);
    }
  });

  // design-combat-weather.md D3's own width-aware bake doesn't apply to the
  // gap band (D2: it always bakes at the fixed MAX_GAP_WIDTH regardless of
  // combat, since it's a SEPARATE canvas from the sprite's own art column —
  // see plan-fullwidth-weather.md D8/§4.1, "no combat-specific MAX_GAP_WIDTH").
  test("combat active (pending standoff, artWidth 24) + weather active ⇒ gap band still bakes at the fixed MAX_GAP_WIDTH=110, not artWidth", () => {
    const state = render({
      config: { gameFeel: "full", groundEnabled: true },
      mood: "focused",
      sessionStartedAt: STARTED,
      stubGroundWeather: { active: true },
      pendingEncounter: { width: 24 },
    });
    expect(state!.artWidth).toBe(24);
    const gapFrames = state!.weatherFallGapFrames as string[];
    expect(Array.isArray(gapFrames)).toBe(true);
    for (const frame of gapFrames) {
      for (const line of frame.split("\n")) {
        expect(displayWidth(line)).toBe(110);
      }
    }
  });
});
