# Living-World Arc — P0+P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the arc's first slice — the tick-ceiling measurement (P0) and the movement vocabulary (P1: mood gaits, event-choreography stingers, edge/panel awareness) from `docs/game-feel/living-world/design.md`.

**Architecture:** Everything is baked server-side into `status.json` sequences the existing shell cycler already plays (`NOW % len`) — zero `buddy-status.sh` changes except gated Task 10. Gaits extend `wander.ts` with per-tick phase tags; a new `art.ts` mapper turns phases into a 180-tick `frameSequence` aligned with the walk; stingers are phase-anchored offset arcs spliced into `wanderSequence`; the startle is a new opening beat inside `bakePendingScene`.

**Tech Stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), bash statusline (`bash -n`), jq.

**Read first:** `docs/game-feel/living-world/design.md` (the spec, esp. §P0/§P1), `docs/game-feel/CURRENT-STATE.md` (system snapshot), `docs/game-feel/idle-rpg/testing-guide.md` (e2e harness idioms).

**House rules that override the usual plan template:**
- **Commits:** this repo's owner approves commits explicitly. Ask once before the first commit step; if declined, skip ALL commit steps and leave the tree dirty with a note. Never push.
- **Baseline:** the working tree already carries the uncommitted stat-leveling v2 pass — baseline is **844 tests, all pass**. Do not commit v2 files (`server/{session,xp,state,art,award-xp}.ts` are shared — if committing, stage hunks belonging to this plan only, or ask the user how they want v2 sequenced first).
- **Live-state warning:** the statusline on this machine runs FROM THIS REPO, and `react.sh` classifies your test output — a TDD red run prints `N fail`, which awards real XP and can spawn a real bug standoff on the user's own statusline. Harmless, but expected; don't "fix" it mid-plan.
- **Verification cadence per task:** `bun test` (full suite), `bunx tsc --noEmit`, and `bash -n statusline/buddy-status.sh` when the shell was touched.

---

### Task 1: P0 — measure the statusline tick ceiling (manual; gates Task 10)

The cycler animates at 1 fps because `NOW` is whole seconds. This task measures how often Claude Code *actually* invokes the statusline, in three regimes. Requires a live Claude Code session, so parts are "hand to the user".

**Files:**
- Create: `/private/tmp` shim (throwaway, deleted at the end)
- Modify: `docs/game-feel/living-world/design.md` (append a `### P0 findings` subsection under `## P0 — Tick ceiling`)

- [ ] **Step 1: Find the live statusline command**

Run: `jq '.statusLine' ~/.claude/settings.json`
Expected: a command path (historically `combined-status.sh` exec'ing `buddy-status.sh`, but it churns — trust the file, not memory). Call the configured script `$LIVE_CMD` below.

- [ ] **Step 2: Create the logging shim**

```bash
mkdir -p /tmp/buddy-tick && cat > /tmp/buddy-tick/shim.sh <<'EOF'
#!/usr/bin/env bash
# Throwaway P0 shim: log invocation wall-clock (ms) then run the real command.
perl -MTime::HiRes=time -e 'printf "%.3f\n", time' >> /tmp/buddy-tick/ticks.log
exec <LIVE_CMD_HERE> "$@"
EOF
chmod +x /tmp/buddy-tick/shim.sh
```

Replace `<LIVE_CMD_HERE>` with the Step 1 command. (`perl -MTime::HiRes` because BSD `date` has no `%N`.)

- [ ] **Step 3: Point settings at the shim, restart, collect**

Edit `~/.claude/settings.json` statusLine command → `/tmp/buddy-tick/shim.sh` (keep a copy of the original value). Then ask the user to restart Claude Code and use it normally for ~10 minutes covering three regimes: active streaming conversation, idle with terminal focused, idle unfocused. Mark the log between regimes: `echo "REGIME <name>" >> /tmp/buddy-tick/ticks.log`.

- [ ] **Step 4: Analyze inter-invocation deltas per regime**

```bash
awk '/^REGIME/{r=$2; next} {if (p[r]) print r, $1-p[r]; p[r]=$1}' /tmp/buddy-tick/ticks.log \
  | awk '{s[$1]+=$2; n[$1]++; if(!m[$1]||$2<m[$1])m[$1]=$2; if($2>M[$1])M[$1]=$2}
         END{for(r in s) printf "%s: n=%d mean=%.2fs min=%.2fs max=%.2fs\n", r, n[r], s[r]/n[r], m[r], M[r]}'
```

- [ ] **Step 5: Record findings + decide the Task 10 gate**

Append `### P0 findings` to the design doc's P0 section: per-regime mean/min/max/jitter, and one explicit sentence: "**Task 10 gate: PASS/FAIL** — idle cadence is reliably {<1s / ≥1s}." The gate PASSES only if the *idle* regime shows a steady sub-second cadence (not just fast bursts while streaming). If invocations turn out to be event-driven-only at idle, note that as the "how is wander even working" finding the spec calls for.

- [ ] **Step 6: Restore settings and clean up**

Restore the original statusLine command in `~/.claude/settings.json`, ask the user to restart, then `rm -rf /tmp/buddy-tick`. Verify: statusline renders normally again.

- [ ] **Step 7: Commit** (ask-first house rule)

```bash
git add docs/game-feel/living-world/design.md
git commit -m "docs(living-world): P0 tick-ceiling findings"
```

---

### Task 2: Gait profiles + per-tick phases (`wander.ts`)

Extends the pure walk generator: multi-cell steps, emotion-keyed profiles, and a per-tick phase track (`0` dwell, `1` step, `2` edge-dwell, `3` home-linger) that Task 4 maps to frames. **Determinism constraint:** for `stepSize` absent/1 and no phase consumers, `horizontal`/`vertical` must be byte-identical to today for the same seed — the change adds no `rng()` draws and existing `wander.test.ts` cases must pass untouched.

**Files:**
- Modify: `server/wander.ts`
- Test: `server/wander.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/wander.test.ts` (follow the file's existing import/describe style):

```ts
describe("gait profiles (living-world P1)", () => {
  test("stepSize 2 moves at most 2 cells per step and still lands on target", () => {
    const walk = buildWanderSequence({
      range: 6, length: 120, dwellMin: 2, dwellMax: 4,
      stepEvery: 1, hopHeight: 0, seed: 7, stepSize: 2,
    });
    for (let i = 1; i < walk.horizontal.length; i++) {
      expect(Math.abs(walk.horizontal[i] - walk.horizontal[i - 1])).toBeLessThanOrEqual(2);
    }
  });

  test("phases align with movement: phase 1 exactly on travel ticks", () => {
    const walk = buildWanderSequence({
      range: 4, length: 120, dwellMin: 2, dwellMax: 4,
      stepEvery: 1, hopHeight: 0, seed: 11,
    });
    expect(walk.phases).toHaveLength(walk.horizontal.length);
    // Every tick where the NEXT offset differs is a travel tick.
    for (let i = 0; i < walk.horizontal.length - 1; i++) {
      if (walk.horizontal[i + 1] !== walk.horizontal[i]) {
        expect(walk.phases![i]).toBe(1);
      }
    }
  });

  test("edge dwell tags phase 2 at range, home linger tags 3 after 4 ticks", () => {
    const walk = buildWanderSequence({
      range: 2, length: 300, dwellMin: 6, dwellMax: 8,
      stepEvery: 1, hopHeight: 0, seed: 3,
    });
    const atEdge = walk.horizontal
      .map((p, i) => [p, walk.phases![i]] as const)
      .filter(([p]) => p === 2);
    expect(atEdge.some(([, ph]) => ph === 2)).toBe(true);
    // No phase-3 in the first 4 ticks of any home dwell; some later.
    expect(walk.phases!.includes(3)).toBe(true);
  });

  test("gaitWalkOpts: angry/bored/happy override, neutral falls back to mood", () => {
    const neutral = gaitWalkOpts("neutral", "focused", 5, 42);
    expect(neutral).toEqual(moodWalkOpts("focused", 5, 42));
    const angry = gaitWalkOpts("angry", "focused", 5, 42);
    expect(angry.dwellMax).toBeLessThan(neutral.dwellMax);
    const happy = gaitWalkOpts("happy", "focused", 5, 42);
    expect(happy.stepSize).toBe(2);
    const bored = gaitWalkOpts("bored", "focused", 5, 42);
    expect(bored.stepEvery).toBe(2);
  });

  test("identical output to pre-gait bake for stepSize-less opts (regression)", () => {
    const opts = { range: 4, length: 60, dwellMin: 3, dwellMax: 6,
      stepEvery: 1, hopHeight: 2, seed: 99 };
    const a = buildWanderSequence(opts);
    const b = buildWanderSequence({ ...opts, stepSize: 1 });
    expect(a.horizontal).toEqual(b.horizontal);
    expect(a.vertical).toEqual(b.vertical);
  });
});
```

Update the file's import line to include `gaitWalkOpts` (and `moodWalkOpts` if not already imported).

- [ ] **Step 2: Run to verify failure**

Run: `bun test server/wander.test.ts`
Expected: FAIL — `gaitWalkOpts` not exported; `phases` undefined.

- [ ] **Step 3: Implement**

In `server/wander.ts`:

1. `WanderOpts` gains:

```ts
  /** Cells per step (gait "skip"); default 1. |Δ| per tick ≤ stepSize. */
  stepSize?: number;
```

2. `WanderWalk` gains:

```ts
  /** Per-tick gait phase: 0 dwell · 1 step · 2 edge-dwell · 3 home-linger.
   *  Same length/index as `horizontal` (living-world P1). */
  phases?: GaitPhase[];
```

with, above it:

```ts
export type GaitPhase = 0 | 1 | 2 | 3;
```

3. In `buildWanderSequence`, add `const stepSize = Math.max(1, Math.floor(opts.stepSize ?? 1));` beside the other clamps, and a `const phases: GaitPhase[] = [];` beside `horizontal`. Tag as you push:
   - dwell loop body becomes:

```ts
    for (let i = 0; i < dwell && horizontal.length < length; i++) {
      phases.push(pos === range && range > 0 ? 2 : pos === 0 && i >= 4 ? 3 : 0);
      horizontal.push(pos);
    }
```

   - travel loop steps `Math.min(stepSize, Math.abs(target - pos))` cells and pushes `phases.push(1)` per emitted tick:

```ts
    while (pos !== target && horizontal.length < length) {
      for (let s = 0; s < stepEvery && horizontal.length < length; s++) {
        phases.push(1);
        horizontal.push(pos);
      }
      pos += dir * Math.min(stepSize, Math.abs(target - pos));
    }
```

   - return `{ horizontal, vertical, phases }`.

   Note the phase-1 semantics the test pins: a *travel* tick is tagged 1 even though the offset change lands on the next tick — "legs moving" starts when the step begins.

4. Below `moodWalkOpts`, add:

```ts
/** Emotion-keyed gait overrides (living-world P1). Keyed by the transient
 *  emotion `resolveEmotion` already derives — a second read of a decision
 *  already made, like the emote row. Unlisted emotions (incl. neutral,
 *  surprised) fall back to the mood personality unchanged. */
const EMOTION_GAIT: Record<
  string,
  Partial<Pick<WanderOpts, "range" | "dwellMin" | "dwellMax" | "stepEvery" | "stepSize">>
> = {
  angry: { range: 3, dwellMin: 2, dwellMax: 4, stepEvery: 1 },
  bored: { range: 2, dwellMin: 8, dwellMax: 14, stepEvery: 2 },
  happy: { stepSize: 2, dwellMin: 4, dwellMax: 10, stepEvery: 1 },
};

/** Mood personality with the current emotion's gait folded over it. */
export function gaitWalkOpts(
  emotion: string,
  mood: string,
  level: number,
  seed: number,
): WanderOpts {
  const base = moodWalkOpts(mood, level, seed);
  const gait = EMOTION_GAIT[emotion];
  return gait ? { ...base, ...gait } : base;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test server/wander.test.ts` → PASS, then `bun test` (full) + `bunx tsc --noEmit` → 844+5 pass, clean.

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add server/wander.ts server/wander.test.ts
git commit -m "feat(living-world): gait profiles + per-tick phases in wander core"
```

---

### Task 3: Gait frame variants in `getStatusFrames` (`art.ts`)

Adds the lean/peek posture frames (eye-substitution derivation — safe for all 20 species, the blink/glance precedent) and reports gait frame indices. Bob reuses existing frame index 1 — no new frame needed.

**Files:**
- Modify: `server/art.ts:558-597` (`getStatusFrames`)
- Test: `server/art.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("gait frame variants (living-world P1)", () => {
  const bones = makeBones("cactus"); // use the file's existing bones fixture helper
  test("absent unless requested; stable base output", () => {
    const base = getStatusFrames(bones);
    expect((base as { gaitIdx?: unknown }).gaitIdx).toBeUndefined();
  });
  test("appends lean (>) and peek (<) frames and reports indices", () => {
    const base = getStatusFrames(bones);
    const g = getStatusFrames(bones, "neutral", undefined, undefined, true);
    expect(g.frames.length).toBe(base.frames.length + 2);
    expect(g.gaitIdx).toEqual({
      bob: 1, lean: base.frames.length, peek: base.frames.length + 1,
    });
    expect(g.frames[g.gaitIdx!.lean]).toBe(renderSpeciesFrame(bones, 0, "~"));
    expect(g.frames[g.gaitIdx!.peek]).toBe(renderSpeciesFrame(bones, 0, "<"));
    // Base frames + sequence untouched by the two appended variants.
    expect(g.frames.slice(0, base.frames.length)).toEqual(base.frames);
    expect(g.frameSequence).toEqual(base.frameSequence);
  });
  test("emotion branch also carries variants when requested", () => {
    const g = getStatusFrames(bones, "angry", undefined, undefined, true);
    expect(g.gaitIdx).toEqual({ bob: 1, lean: 2, peek: 3 });
  });
});
```

(Adapt `makeBones` to whatever fixture `art.test.ts` actually uses — do not invent a second fixture style.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test server/art.test.ts` → FAIL (arity/`gaitIdx`).

- [ ] **Step 3: Implement**

`getStatusFrames` gains a 5th param and a widened return type:

```ts
export function getStatusFrames(
  bones: BuddyBones,
  emotion: Emotion = "neutral",
  seasonalHat?: Hat,
  gear?: GearArt,
  gaitVariants = false,
): {
  frames: string[];
  frameSequence: number[];
  /** Indices of the gait posture frames (living-world P1); present only when
   *  `gaitVariants` was requested. bob = existing frame 1 (no new art). */
  gaitIdx?: { bob: number; lean: number; peek: number };
} {
```

At the end of **each** branch (emotion and neutral), before returning, when `gaitVariants` is true append `resolveFrame(0, "~")` and `resolveFrame(0, "<")` to the frames array and set `gaitIdx = { bob: 1, lean: <index of "~">, peek: <index of "<"> }`. (Lean is `~`, not `>` — `>` is `EMOTION_EYE.angry`, and a colliding glyph would make the lean pose invisible during the angry pacing gait.) Factor with a small local helper so both branches share it:

```ts
  const withGait = (r: { frames: string[]; frameSequence: number[] }) => {
    if (!gaitVariants) return r;
    const lean = r.frames.length;
    return {
      ...r,
      frames: [...r.frames, resolveFrame(0, "~"), resolveFrame(0, "<")],
      gaitIdx: { bob: 1, lean, peek: lean + 1 },
    };
  };
```

and wrap both existing `return {...}` values in `withGait(...)`.

- [ ] **Step 4: Run tests**

`bun test server/art.test.ts` → PASS; full suite + `tsc` clean. Render snapshots must be byte-identical (no caller passes `gaitVariants` yet).

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add server/art.ts server/art.test.ts
git commit -m "feat(living-world): lean/peek gait posture frames in getStatusFrames"
```

---

### Task 4: `gaitFrameSequence` mapper (`art.ts`)

Pure mapper: per-tick phases → a walk-length `frameSequence` (bob on alternating step ticks, lean at the right extreme, peek at home-linger only when the stats panel is on).

**Files:**
- Modify: `server/art.ts` (new export, place beside `getStatusFrames`)
- Test: `server/art.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("gaitFrameSequence (living-world P1)", () => {
  const idx = { bob: 1, lean: 5, peek: 6 };
  const baseSeq = [0, 0, 1, 0, 2];
  test("dwell ticks follow the base cycle; length matches phases", () => {
    const seq = gaitFrameSequence([0, 0, 0, 0, 0, 0], baseSeq, idx, false);
    expect(seq).toEqual([0, 0, 1, 0, 2, 0]);
  });
  test("step ticks alternate base and bob", () => {
    const seq = gaitFrameSequence([1, 1, 1, 1], baseSeq, idx, false);
    expect(seq).toEqual([0, 1, 1, 1]); // base[0], bob, base[2](=1), bob... parity
    expect(seq.filter((f) => f === idx.bob).length).toBeGreaterThan(0);
  });
  test("edge dwell leans; home linger peeks only with the panel on", () => {
    expect(gaitFrameSequence([2, 2], baseSeq, idx, false)).toEqual([5, 5]);
    expect(gaitFrameSequence([3, 3], baseSeq, idx, true)).toEqual([6, 6]);
    expect(gaitFrameSequence([3], baseSeq, idx, false)).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test server/art.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
import type { GaitPhase } from "./wander.ts";

/** Map a walk's per-tick phases onto frame indices (living-world P1). The
 *  result replaces `frameSequence` for the write, same length as the walk, so
 *  body frames and offsets stay in lockstep with zero shell changes — both are
 *  indexed by the same NOW. */
export function gaitFrameSequence(
  phases: GaitPhase[],
  baseSeq: number[],
  idx: { bob: number; lean: number; peek: number },
  showStats: boolean,
): number[] {
  let stepParity = 0;
  return phases.map((p, i) => {
    if (p === 1) return stepParity++ % 2 === 1 ? idx.bob : baseSeq[i % baseSeq.length];
    if (p === 2) return idx.lean;
    if (p === 3 && showStats) return idx.peek;
    return baseSeq[i % baseSeq.length];
  });
}
```

(`wander.ts` imports only `engine.ts`, so `art.ts → wander.ts` is acyclic.)

- [ ] **Step 4: Run tests** — targeted PASS, full suite + `tsc` clean.

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add server/art.ts server/art.test.ts
git commit -m "feat(living-world): gaitFrameSequence phase→frame mapper"
```

---

### Task 5: Wire gaits into `writeStatusState` (`state.ts`)

At `full` with wander on: request gait variants, bake the walk from `gaitWalkOpts(emotion, …)`, and replace `frameSequence` with the phase-mapped 180-tick sequence.

**Files:**
- Modify: `server/state.ts` (`writeStatusState`: the `getStatusFrames` call ~line 1113 and the wander branch ~lines 1203-1224)
- Test: `server/state_wander.test.ts`

- [ ] **Step 1: Write failing test**

Mirror `state_wander.test.ts`'s existing setup idiom (temp `CLAUDE_CONFIG_DIR`, config write, `writeStatusState`, read back `status.json`) exactly — copy its beforeEach pattern, don't invent one. Add:

```ts
test("full+wander gait: frameSequence is walk-length and carries lean frames", () => {
  // setup: gameFeel full, wanderEnabled true (the file's existing helpers)
  writeStatusState(companion, {});
  const status = readStatusJson(); // the file's existing reader helper
  expect(status.wanderSequence.length).toBeGreaterThan(0);
  expect(status.frameSequence.length).toBe(status.wanderSequence.length);
  // Variants were appended: frames has at least lean+peek beyond the base 5.
  expect(status.frames.length).toBeGreaterThanOrEqual(7);
  // Every index in the gait sequence points inside frames.
  const max = Math.max(...status.frameSequence);
  expect(max).toBeLessThan(status.frames.length);
});

test("subtle keeps the classic short frameSequence (no gait remap)", () => {
  // setup: gameFeel subtle
  writeStatusState(companion, {});
  const status = readStatusJson();
  expect(status.wanderSequence).toBeUndefined();
  expect(status.frameSequence.length).toBeLessThanOrEqual(18);
});
```

- [ ] **Step 2: Run to verify failure** — frameSequence today is 15/18 long at full; first test FAILS.

- [ ] **Step 3: Implement**

In `writeStatusState`:

1. The frames call (~1113) becomes (note `let` — Task 4's remap reassigns it):

```ts
  const wantGait = /* gate computed above */ gate === "full" && cfg.wanderEnabled;
  const {
    frames: rawFrames,
    frameSequence: bakedSequence,
    gaitIdx,
  } = getStatusFrames(displayBones, emotion, seasonalHat, gearArt, wantGait);
  let frameSequence = bakedSequence;
```

(`getStatusFrames` is already destructured from the lazy `require("./art.ts")` at the top of the function — add `gaitFrameSequence` to that same destructure.)

2. The wander branch (~1203) becomes:

```ts
  let wanderSequence: number[] | undefined;
  let wanderRowSequence: number[] | undefined;
  if (gate === "full") {
    try {
      if (cfg.wanderEnabled) {
        const { buildWanderSequence, gaitWalkOpts } =
          require("./wander.ts") as typeof import("./wander.ts");
        const walkOpts = gaitWalkOpts(emotion, moodStr, xpLevel, Date.now());
        if (!cfg.wanderHop) walkOpts.hopHeight = 0; // §7.A opt-in
        const walk = buildWanderSequence(walkOpts);
        wanderSequence = walk.horizontal;
        wanderRowSequence = walk.vertical;
        // Gait: body frames locked to the walk (living-world P1). Falls back
        // to the classic short cycle if the bake carried no phases/variants.
        if (walk.phases && gaitIdx) {
          frameSequence = gaitFrameSequence(
            walk.phases,
            frameSequence,
            gaitIdx,
            cfg.showStats === true,
          );
        }
      }
    } catch {
      // Best-effort delighter; a failure leaves the buddy planted.
    }
  }
```

`emotion`, `moodStr`, `xpLevel`, `cfg` all already exist in scope. `finalizeIdleBlock` (which runs earlier) maps every frame — appended variants included — so indices survive it; do not reorder the blocks.

- [ ] **Step 4: Run tests** — targeted PASS; **full suite** + `tsc`; `bun test server/statusline_render.test.ts` must stay byte-identical (render tests inject fixture frames, not live bakes — if any snapshot moved, something leaked; stop and investigate).

- [ ] **Step 5: Live sanity check** — render once through the real shell:

Run: `echo '{}' | statusline/buddy-status.sh | head -8` (with the user's real state; non-destructive read).
Expected: normal buddy line, no errors on stderr.

- [ ] **Step 6: Commit** (ask-first house rule)

```bash
git add server/state.ts server/state_wander.test.ts
git commit -m "feat(living-world): emotion gaits drive walk + frame lockstep"
```

---

### Task 6: Stinger arcs (`wander.ts`)

Pure arc shapes + the phase-anchored splice. The shell suppresses wander during `$celeb_fresh`/`$combat_on`, so anchored arcs land *after* the freshness window (see the spec's amended §P1.2).

**Files:**
- Modify: `server/wander.ts`
- Test: `server/wander.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("stinger arcs (living-world P1)", () => {
  test("every arc kind starts after home and ends at 0 (no teleport snap)", () => {
    for (const kind of ["victory", "lootdash", "walkon"] as const) {
      const arc = stingerArc(kind, 5);
      expect(arc.length).toBeGreaterThan(4);
      expect(arc[arc.length - 1]).toBe(0);
      for (const v of arc) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  test("splice writes the arc at the anchor, modulo-wrapped, others untouched", () => {
    const base = new Array(20).fill(1);
    const out = spliceStingerArc(base, "walkon", 15);
    const arc = stingerArc("walkon", Math.max(...base, 3));
    for (let k = 0; k < Math.min(arc.length, 20); k++) {
      expect(out[(15 + k) % 20]).toBe(arc[k]);
    }
    expect(base.every((v) => v === 1)).toBe(true); // input not mutated
  });
  test("empty walk is a no-op", () => {
    expect(spliceStingerArc([], "victory", 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — not exported → FAIL.

- [ ] **Step 3: Implement**

```ts
/** Event-choreography stingers (living-world P1): one-shot offset arcs
 *  spliced into the baked wander track, anchored to the wall-clock index the
 *  shell will reach after any celebration/scene freshness lapses. */
export type StingerKind = "victory" | "lootdash" | "walkon";

/** Ticks past the write before an anchored arc begins — safely beyond the
 *  10s celebration/scene freshness window during which the shell suppresses
 *  wander offsets entirely. */
export const STINGER_DELAY_TICKS = 12;

/** The arc shape for a kind, spanning [0, max(range, 3)]. Ends at 0 so the
 *  hand-off back to the surrounding walk can't teleport the sprite. */
export function stingerArc(kind: StingerKind, range: number): number[] {
  const r = Math.max(3, Math.floor(range));
  const out: number[] = [];
  if (kind === "victory") {
    for (let lap = 0; lap < 2; lap++) {
      for (let p = 1; p <= r; p++) out.push(p);
      for (let p = r - 1; p >= 0; p--) out.push(p);
    }
  } else if (kind === "lootdash") {
    for (let p = 1; p <= r; p++) out.push(p);
    out.push(r, r, r); // inspect pause
    for (let p = r - 1; p >= 0; p--) out.push(p);
  } else {
    // walkon: enter from the far edge, two ticks per cell (a deliberate walk).
    for (let p = r; p >= 0; p--) out.push(p, p);
  }
  return out;
}

/** Copy `horizontal` with `kind`'s arc written at `atTick` (modulo length). */
export function spliceStingerArc(
  horizontal: number[],
  kind: StingerKind,
  atTick: number,
): number[] {
  const len = horizontal.length;
  if (len === 0) return horizontal;
  const arc = stingerArc(kind, Math.max(...horizontal, 3));
  const out = [...horizontal];
  for (let k = 0; k < arc.length && k < len; k++) {
    out[(atTick + k) % len] = arc[k];
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — targeted PASS, full suite + `tsc` clean.

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add server/wander.ts server/wander.test.ts
git commit -m "feat(living-world): phase-anchored stinger arcs"
```

---

### Task 7: Stinger triggers (`session.ts`, `award-xp.ts`, `state.ts`)

Threads "what just happened" to the wander bake: fight-won → `victory`, loot celebration → `lootdash`, session start → `walkon`.

**Files:**
- Modify: `server/session.ts` (`maybeFightBug` ~510-543, `SessionCompletion` ~563-573, and `awardSessionComplete`'s use of both)
- Modify: `server/award-xp.ts` (the session-complete and session-start status writes)
- Modify: `server/state.ts` (`StatusOpts` ~761-779; wander branch from Task 5)
- Test: `server/session.test.ts`, `server/state_wander.test.ts`

- [ ] **Step 1: Confirm the outcome values**

Run: `grep -n "type Outcome" server/combat.ts`
Expected: a union including a win-ish and flee-ish member. Use the *actual* member names below wherever this plan writes `"win"`.

- [ ] **Step 2: Write failing tests**

In `server/session.test.ts` (follow its existing `maybeFightBug`/`awardSessionComplete` test setup — fresh-subprocess/temp-config idioms where the file already uses them):

```ts
test("completion reports fightWon for a winning seed and false for a flee", () => {
  // Reuse the file's existing seeded fight fixtures: one known-win seed, one
  // known-flee seed (they exist for the fightSummary tests). Assert:
  expect(winCompletion.fightWon).toBe(true);
  expect(fleeCompletion.fightWon).toBe(false);
});
```

In `server/state_wander.test.ts`:

```ts
test("stinger opt splices an arc into wanderSequence", () => {
  // setup: full + wander on (existing idiom)
  writeStatusState(companion, { stinger: "walkon" });
  const status = readStatusJson();
  // walkon anchors at write time: the current tick's offset is the arc head
  // (the walk's max, ≥3), not a home-hugging idle value.
  const now = Math.floor(Date.now() / 1000);
  const at = now % status.wanderSequence.length;
  expect(status.wanderSequence[at]).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 3: Run to verify failure** — `fightWon`/`stinger` unknown → FAIL (type errors count).

- [ ] **Step 4: Implement**

1. `session.ts` — `maybeFightBug` returns `{ summary: string; won: boolean } | null`; its two `return result.summary`-ish sites become `return { summary: result.summary, won: result.outcome === "win" }` (Step-1 name), the early `return null`s stay. `SessionCompletion` gains:

```ts
  /** True when this commit's fight resolved as a win (living-world P1) — the
   *  caller anchors a victory-lap stinger on it. */
  fightWon: boolean;
```

`awardSessionComplete` adapts: where it stored `fightSummary = maybeFightBug(...)`, destructure the object (null ⇒ `fightSummary: null, fightWon: false`).

2. `state.ts` — `StatusOpts` gains:

```ts
  /** Event-choreography stinger to splice into the wander track (living-world
   *  P1). Anchored past the celebration freshness window ("walkon" anchors
   *  immediately — its write carries no celebration). Ignored below full. */
  stinger?: import("./wander.ts").StingerKind;
```

and the Task-5 wander branch grows, after the gait remap:

```ts
        if (opts.stinger && wanderSequence.length > 0) {
          const { spliceStingerArc, STINGER_DELAY_TICKS } =
            require("./wander.ts") as typeof import("./wander.ts");
          const delay = opts.stinger === "walkon" ? 0 : STINGER_DELAY_TICKS;
          const at = (Math.floor(Date.now() / 1000) + delay) % wanderSequence.length;
          wanderSequence = spliceStingerArc(wanderSequence, opts.stinger, at);
        }
```

3. `award-xp.ts` — at the session-complete status write, add to its opts:

```ts
    stinger: completion.fightWon
      ? "victory"
      : celebration?.kind === "loot"
        ? "lootdash"
        : undefined,
```

and at the session-start write: `stinger: "walkon"`.
(Find the exact writes: `grep -n "writeStatusState" server/award-xp.ts` — there is one per verb path; touch only `session_complete` and `session_start`.)

- [ ] **Step 5: Run tests** — targeted PASS; **full suite** + `tsc` (the `maybeFightBug` return-shape change will surface every caller — fix them all, they're within `session.ts`/its tests).

- [ ] **Step 6: Commit** (ask-first house rule)

```bash
git add server/session.ts server/award-xp.ts server/state.ts \
        server/session.test.ts server/state_wander.test.ts
git commit -m "feat(living-world): victory/lootdash/walkon stinger triggers"
```

---

### Task 8: Startle beat in the standoff (`combat.ts`)

The pending flipbook opens with a startled pose (player `O` eyes — the dodge-eye precedent) before the ready/glare loop, recurring each loop as a re-glare. See the spec's amended §P1.2 "Startle".

**Files:**
- Modify: `server/combat.ts:490-579` (`bakePendingScene`)
- Test: `server/combat.test.ts`

- [ ] **Step 1: Write failing test**

Follow `combat.test.ts`'s existing `bakePendingScene` cases (species/seed fixtures already exist):

```ts
test("standoff opens with a startle beat: O-eyed player pose, 3 ticks", () => {
  const { frames, sequence } = bakePendingScene("cactus", "o", "ant", undefined, 42, 1);
  const startleIdx = sequence[0];
  expect(sequence[0]).toBe(sequence[1]);
  expect(sequence[1]).toBe(sequence[2]);
  expect(frames[startleIdx]).toContain("O");
  // The startle frame obeys the constant-geometry contract with the rest.
  const dims = (f: string) => f.split("\n").length;
  expect(dims(frames[startleIdx])).toBe(dims(frames[0]));
});
```

(If existing constant-width/height tests iterate `frames`, they now cover the startle frame automatically — that's the real guarantee; the `dims` assert is belt-and-braces.)

- [ ] **Step 2: Run to verify failure** — sequence today starts with the calm rhythm → FAIL.

- [ ] **Step 3: Implement**

In `bakePendingScene`, after `frames` is assembled and before `sequence`:

```ts
  // Startle beat (living-world P1): the standoff's opening pose — the player
  // recoils with O eyes before settling into the ready/glare loop. Appended
  // (not inserted) so no existing frame index shifts; recurs each loop as a
  // re-glare, matching the periodic bout grammar. pendingPoses with the eye
  // substituted reuses the exact ready-pose geometry.
  const startle = composePose(
    playerSpecies,
    enemySpecies,
    pendingPoses("O", enemyEye)[0],
    DEFAULT_SWORD,
    { overlay: { text: null, over: "enemy" } },
    look,
  );
  const startleIdx = frames.length;
  frames.push(startle);
```

and prepend its ticks to the sequence:

```ts
  const sequence = [
    startleIdx, startleIdx, startleIdx,
    ...calm(g1),
    ...boutTicks(2),
    ...calm(g2),
    ...boutTicks(5),
    ...calm(g3),
  ];
```

If `Eye` is a closed union that rejects `"O"`, widen it the same way the dodge implementation did (find it: `grep -n '"O"' server/combat.ts server/art.ts`) — follow that precedent exactly rather than casting.

- [ ] **Step 4: Run tests** — targeted PASS; **full suite**. Expect possible fallout in seed-pinned pending-scene tests (frame count grew by one, sequence length by three) — fix by the round-2 rule: re-derive expectations from the new structure, never loosen assertions.

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add server/combat.ts server/combat.test.ts
git commit -m "feat(living-world): startle opening beat in the bug standoff"
```

---

### Task 9: Real-shell e2e + docs

**Files:**
- Modify: `docs/game-feel/CURRENT-STATE.md` (new dated section), `docs/game-feel/living-world/design.md` (status line: P1 implemented), `docs/game-feel/idle-rpg/testing-guide.md` (gait/stinger harness), `README.md` (one line in the game-feel section: gaits + event choreography, only if README already lists comparable features)
- Test: `server/statusline_render.test.ts` (one new render case)

- [ ] **Step 1: Add a pinned render test for the gait path**

Follow the file's fixture idiom (inject a `status.json`, run the real script with `BUDDY_FAKE_NOW`): craft a fixture whose `frameSequence` is walk-length with a lean index at a known `BUDDY_FAKE_NOW % len`, assert the rendered line contains the `~` posture and the layout invariants the file already asserts (no clipping, stats column intact).

- [ ] **Step 2: Manual e2e through the real award path**

Per testing-guide idioms: temp `CLAUDE_CONFIG_DIR`, adopt a buddy, then:

```bash
export CLAUDE_CONFIG_DIR=$(mktemp -d)
bun run server/award-xp.ts session_start   # walkon: arc at the current tick
for i in 0 1 2 3 4; do
  BUDDY_FAKE_NOW=$(( $(date +%s) + i )) statusline/buddy-status.sh <<< '{}'
done
```

Expected: the buddy enters from the right across the five renders. Repeat for a winning fight (victory lap lands ~12s after the toast) and an angry reaction (pacing gait + `!` emote). Delete the temp dir after.

- [ ] **Step 3: Full validation sweep**

Run: `bun test && bunx tsc --noEmit && bash -n statusline/buddy-status.sh`
Expected: all green; note the new test total.

- [ ] **Step 4: Write the docs**

CURRENT-STATE gets a "Living-world P1 — movement vocabulary (date)" section in the established voice (what/why/mechanism/tests); design.md status header flips P1 to implemented; testing-guide gains the Step-2 harness.

- [ ] **Step 5: Commit** (ask-first house rule)

```bash
git add docs/ README.md server/statusline_render.test.ts
git commit -m "docs(living-world): P1 shipped — snapshot, harness, render pin"
```

---

### Task 10 (GATED on Task 1: PASS): sub-second frame indexing

**Skip entirely — and say so in the completion report — unless Task 1's findings line reads PASS.** This is the arc's one sanctioned `buddy-status.sh` change.

> Carried note from Task 5's review: gait dwell ticks render `baseSeq[i % baseSeq.length]`, and 180 is an exact multiple of the 6- and 18-tick base cycles but NOT of the 21-tick stretch cycle — a one-frame seam at the 180-tick loop boundary, negligible at 1 fps because status.json reseeds first. If this task lengthens effective loop exposure (faster ticks ⇒ more loops per bake), re-check that seam before shipping.

**Files:**
- Modify: `statusline/buddy-status.sh:30` (clock) + the jq sequence-index sites
- Modify: `server/state.ts` (bake `tickMs` into `StatusState`)
- Test: `server/statusline_render.test.ts`

- [ ] **Step 1: Locate every sequence-index site**

Run: `grep -n '% ' statusline/buddy-status.sh | grep -iv comment` and `grep -n '\$now' statusline/buddy-status.sh`
Classify each hit: **frame/wander sequence indexing** (changes) vs **freshness/TTL arithmetic** (must stay in seconds — do not touch).

- [ ] **Step 2: Add the ms clock beside line 30**

```bash
NOW=${BUDDY_FAKE_NOW:-$(date +%s)}
# Sub-second frame clock (living-world P0): bash ≥5 only; test/fallback path
# stays at whole seconds so BUDDY_FAKE_NOW renders stay deterministic.
if [[ -n ${BUDDY_FAKE_NOW:-} || -z ${EPOCHREALTIME:-} ]]; then
  NOW_MS=$((NOW * 1000))
else
  NOW_MS=${EPOCHREALTIME/./}; NOW_MS=${NOW_MS%???}
fi
```

- [ ] **Step 3: Bake `tickMs` and index by it**

`StatusState` gains `tickMs?: number;` (write `1000` unconditionally in `writeStatusState` for now — per-sequence speed-ups are a later, findings-informed change). Pass `--argjson nowms "$NOW_MS"` into the main jq; each *sequence-index* expression from Step 1 changes from `$now % len` to `(($nowms / (.tickMs // 1000)) | floor) % len`. With `tickMs` at 1000 this is arithmetically identical to today — that's the point: land the plumbing provably-inert.

- [ ] **Step 4: Prove inertness, then flip one consumer**

Run the full render-snapshot suite: **byte-identical required** (fake-now path exercises the fallback). Then, only if findings said the idle cadence supports it, bake `tickMs: 500` and double the wander bake's resolution (`length: 360`, `dwellMin/Max ×2`, `stepEvery ×2` via one `TICKS_PER_SEC` constant in `wander.ts`) so real-time pacing is unchanged but steps land twice as smoothly. Add a render test pinning a `tickMs: 500` fixture at two `BUDDY_FAKE_NOW` values.

- [ ] **Step 5: Validate + commit** (ask-first house rule)

`bun test && bunx tsc --noEmit && bash -n statusline/buddy-status.sh`, live render sanity check, then:

```bash
git add statusline/buddy-status.sh server/state.ts server/statusline_render.test.ts server/wander.ts
git commit -m "feat(living-world): sub-second frame indexing behind baked tickMs"
```

---

## Completion checklist

- [ ] All tasks green (or Task 10 explicitly skipped with the FAIL finding quoted)
- [ ] Full suite / `tsc` / `bash -n` clean; render snapshots accounted for
- [ ] CURRENT-STATE.md + design.md status updated
- [ ] Report to the user: test count delta, what's visible on their line now, and that P2 (encounters) is the next plan to write
