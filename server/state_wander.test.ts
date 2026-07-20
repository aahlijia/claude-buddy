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

  // A child-local Bun loader plugin swaps wander.ts for a throwing stub — fully
  // isolated to this process, so it can't leak into other test files.
  const throwBlock = c.throwWander
    ? `
import { plugin } from "bun";
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
import { plugin } from "bun";
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

  const childSrc = `${throwBlock}${propsStubBlock}
import { writeStatusState } from ${STATE_TS};
import { generateBones } from ${ENGINE_TS};
const companion = {
  bones: generateBones("smoke", "salt"),
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
    // wanderEnabled:true appends the lean/peek gait frames (P1) — the LAST
    // two entries — and P4 Task 4's step-kick withholds `ahead` on exactly
    // those two (see the "prop kick" describe block below); every other
    // frame still carries both glyphs.
    frames.forEach((frame, i) => {
      expect(frame).toContain(PROP.feet);
      if (i < frames.length - 2) expect(frame).toContain(PROP.ahead);
    });
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
    // Same lean/peek (last-two) exception as above — P4 Task 4.
    frames.forEach((frame, i) => {
      expect(frame).toContain(PROP.feet);
      if (i < frames.length - 2) expect(frame).toContain(PROP.ahead);
    });
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

  test("the walk's lean/peek gait frames (last two of `frames`) withhold the pebble; every other frame keeps it", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: true },
      mood: "focused",
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    // Precondition (P1's "gait lockstep" test above): gaitVariants appended
    // exactly two frames (lean, peek) after the base cycle.
    expect(frames.length).toBeGreaterThanOrEqual(7);
    const kicked = new Set([frames.length - 2, frames.length - 1]);
    frames.forEach((frame, i) => {
      expect(frame).toContain(PROP.feet);
      if (kicked.has(i)) {
        expect(frame).not.toContain(PROP.ahead);
      } else {
        expect(frame).toContain(PROP.ahead);
      }
    });
  });

  test("the actual rendered sprite differs between a step tick and a direction-flip tick", () => {
    // This is the state_wander-level proof that the kick reaches the real
    // baked write, not just getStatusFrames in isolation: find a tick in the
    // walk-length frameSequence that lands on an ordinary frame (pebble
    // present) and one that lands on the appended lean/peek frame (pebble
    // withheld), and confirm the two rendered frames actually differ.
    //
    // `writeStatusState` seeds the walk off the real `Date.now()` (no test
    // seam to pin it — same as the pre-existing P1 "carries lean frames"
    // test above, which has the identical dependency), so whether a given
    // 180-tick walk happens to visit the range edge (the only way `idx.lean`
    // gets selected — `idx.peek` needs `showStats`, off by default) is
    // probabilistic. "chaotic" mood (range 6, dwellMin 2) makes it land on
    // the edge on all but a sliver of seeds; retrying a bounded few times
    // over fresh real-clock seeds collapses that sliver to negligible
    // without pinning a seed this harness doesn't expose.
    let ordinaryFrame: string | undefined;
    let kickedFrame: string | undefined;
    for (let attempt = 0; attempt < 8 && !kickedFrame; attempt++) {
      const state = render({
        config: { gameFeel: "full", wanderEnabled: true },
        mood: "chaotic",
        stubProp: PROP,
      });
      const frames = state!.frames as string[];
      const frameSequence = state!.frameSequence as number[];
      const kickedIdx = new Set([frames.length - 2, frames.length - 1]);
      const ordinaryTick = frameSequence.findIndex((f) => !kickedIdx.has(f));
      const kickedTick = frameSequence.findIndex((f) => kickedIdx.has(f));
      if (ordinaryTick >= 0 && kickedTick >= 0) {
        ordinaryFrame = frames[frameSequence[ordinaryTick]];
        kickedFrame = frames[frameSequence[kickedTick]];
      }
    }
    expect(kickedFrame).toBeDefined();
    expect(ordinaryFrame).not.toBe(kickedFrame);
    expect(ordinaryFrame).toContain(PROP.ahead);
    expect(kickedFrame).not.toContain(PROP.ahead);
  });

  test("gaitVariants off (wanderEnabled:false) ⇒ no lean/peek frames exist, so the kick never triggers — every frame keeps the pebble", () => {
    const state = render({
      config: { gameFeel: "full", wanderEnabled: false },
      stubProp: PROP,
    });
    const frames = state!.frames as string[];
    for (const frame of frames) {
      expect(frame).toContain(PROP.feet);
      expect(frame).toContain(PROP.ahead);
    }
  });
});
