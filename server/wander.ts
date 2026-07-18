/**
 * Idle-wander core (game-feel "buddy movement"): a pure, seeded random walk
 * that the status line cycles through to amble the buddy art rightward within
 * its reclaimed margin (and, with hop on, a parallel vertical bob).
 *
 * Server bakes, bash cycles — this module is the bake. It owns no I/O and reads
 * no state; `writeStatusState` injects `Date.now()` as the seed in production
 * while tests pin it. Mirrors the pre-baked-sequence pattern of
 * `art.ts` (`getStatusFrames` / `flourishFrames`).
 *
 * Design: docs/game-feel/design-movement.md §4 (generator) + §7.D (mood map).
 */

import { mulberry32 } from "./engine.ts";

/** Tunables for one baked walk. All durations are in ticks (≈ seconds). */
export interface WanderOpts {
  /** Max horizontal offset; the walk stays in [0, range]. */
  range: number;
  /** Sequence length == loop period in seconds. */
  length: number;
  /** Min ticks parked at a waypoint. */
  dwellMin: number;
  /** Max ticks parked at a waypoint. */
  dwellMax: number;
  /** Ticks per 1-cell step (1 = brisk, 2 = slow shuffle). */
  stepEvery: number;
  /** Max vertical rows; 0 disables hops (§7.A). */
  hopHeight: number;
  /** Injected seed; `Date.now()` in prod, fixed in tests. */
  seed: number;
  /** Cells per step (gait "skip"); default 1. |Δ| per tick ≤ stepSize. */
  stepSize?: number;
}

/** Per-tick gait phase: 0 dwell · 1 step · 2 edge-dwell · 3 home-linger. */
export type GaitPhase = 0 | 1 | 2 | 3;

/** A baked walk: index both arrays by `NOW % length`, like `frameSequence`. */
export interface WanderWalk {
  /** Per-tick horizontal offset (cells, ≥ 0) → `wanderSequence`. */
  horizontal: number[];
  /** Per-tick vertical offset (rows) → `wanderRowSequence`; `undefined`
   *  when `hopHeight === 0`. */
  vertical: number[] | undefined;
  /** Per-tick gait phase (see GaitPhase). Same length/index as `horizontal`
   *  (living-world P1). */
  phases?: GaitPhase[];
}

/** §7.D mood → walk personality (range / dwell / step). */
const MOOD_WALK: Record<
  string,
  { range: number; dwellMin: number; dwellMax: number; stepEvery: number }
> = {
  focused: { range: 2, dwellMin: 12, dwellMax: 24, stepEvery: 1 },
  happy: { range: 4, dwellMin: 6, dwellMax: 16, stepEvery: 1 },
  excited: { range: 6, dwellMin: 3, dwellMax: 9, stepEvery: 1 },
  chaotic: { range: 6, dwellMin: 2, dwellMax: 7, stepEvery: 1 },
  tired: { range: 2, dwellMin: 18, dwellMax: 30, stepEvery: 2 },
  melancholy: { range: 2, dwellMin: 14, dwellMax: 26, stepEvery: 2 },
};

/** Calm fallback for an unknown mood string (never animate more than focused). */
const DEFAULT_MOOD = "focused";

/** Default loop length (seconds); see §8. status.json reseeds well before it. */
const DEFAULT_LENGTH = 180;

/** Inclusive integer in [lo, hi]; collapses to lo when hi <= lo. */
function randInt(rng: () => number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** A parabolic hop arc rising to `height` and back, e.g. height 2 → [1, 2, 1].
 *  Surrounded by baseline 0s it reads 0→…→height→…→0 (a complete arc). */
function hopArc(height: number): number[] {
  const arc: number[] = [];
  for (let v = 1; v <= height; v++) arc.push(v);
  for (let v = height - 1; v >= 1; v--) arc.push(v);
  return arc;
}

/**
 * Build a deterministic "amble": from home (0), pick a random waypoint in
 * [0, range], step toward it one cell every `stepEvery` ticks (so |Δ| ≤ 1),
 * park for a random dwell, repeat until `length` ticks are produced. With
 * `hopHeight > 0` a parallel vertical track sprinkles parabolic hop arcs.
 *
 * Pure: no I/O, deterministic for a given `opts.seed`.
 */
export function buildWanderSequence(opts: WanderOpts): WanderWalk {
  const range = Math.max(0, Math.floor(opts.range));
  const length = Math.max(0, Math.floor(opts.length));
  const stepEvery = Math.max(1, Math.floor(opts.stepEvery));
  const dwellMin = Math.max(1, Math.floor(opts.dwellMin));
  const dwellMax = Math.max(dwellMin, Math.floor(opts.dwellMax));
  const hopHeight = Math.max(0, Math.floor(opts.hopHeight));
  const stepSize = Math.max(1, Math.floor(opts.stepSize ?? 1));

  const rng = mulberry32(opts.seed >>> 0);
  const horizontal: number[] = [];
  const phases: GaitPhase[] = [];
  let pos = 0;

  while (horizontal.length < length) {
    // Dwell at the current waypoint.
    const dwell = randInt(rng, dwellMin, dwellMax);
    for (let i = 0; i < dwell && horizontal.length < length; i++) {
      // Phase 2 (edge-dwell) at range boundary; phase 3 (home-linger) at home
      // after 4+ ticks; phase 0 (dwell) otherwise. Range guard: home and edge
      // are the same cell (0) when range is 0.
      phases.push(pos === range && range > 0 ? 2 : pos === 0 && i >= 4 ? 3 : 0);
      horizontal.push(pos);
    }
    if (horizontal.length >= length) break;

    // Travel to a fresh waypoint: hold each cell `stepEvery` ticks, then step.
    const target = randInt(rng, 0, range);
    const dir = target > pos ? 1 : -1;
    while (pos !== target && horizontal.length < length) {
      for (let s = 0; s < stepEvery && horizontal.length < length; s++) {
        phases.push(1);
        horizontal.push(pos);
      }
      pos += dir * Math.min(stepSize, Math.abs(target - pos));
    }
  }

  let vertical: number[] | undefined;
  if (hopHeight > 0 && length > 0) {
    vertical = new Array<number>(length).fill(0);
    const arc = hopArc(hopHeight);
    // First hop after a gap; arcs are separated by ≥ dwellMin baseline ticks,
    // so each is bounded by 0s — it rises and returns to 0.
    let i = randInt(rng, dwellMin, dwellMax);
    while (i + arc.length <= length) {
      for (let k = 0; k < arc.length; k++) vertical[i + k] = arc[k];
      i += arc.length + randInt(rng, dwellMin, dwellMax);
    }
  }

  return { horizontal, vertical, phases };
}

/**
 * Map the buddy's current mood + level to a walk personality (§7.D). A one-way
 * read — input is values `writeStatusState` already holds, output is the opts
 * for `buildWanderSequence`. Writes nothing and grants no advantage (NFR1),
 * exactly like `emotion → frames` today.
 *
 * @param mood - current mood string (unknown ⇒ calm `focused` baseline).
 * @param level - buddy XP level; nudges range up by `min(2, ⌊level/10⌋)` and
 *     bumps hop amplitude to 2 at level ≥ 20 (purely flavor).
 * @param seed - injected seed, threaded straight into the returned opts.
 */
export function moodWalkOpts(
  mood: string,
  level: number,
  seed: number,
): WanderOpts {
  const base = MOOD_WALK[mood] ?? MOOD_WALK[DEFAULT_MOOD];
  const lvl = Math.max(0, Math.floor(level));
  const rangeNudge = Math.min(2, Math.floor(lvl / 10));
  return {
    range: base.range + rangeNudge,
    length: DEFAULT_LENGTH,
    dwellMin: base.dwellMin,
    dwellMax: base.dwellMax,
    stepEvery: base.stepEvery,
    hopHeight: lvl >= 20 ? 2 : 1,
    seed,
  };
}

/** Emotion-keyed gait overrides (living-world P1). Keyed by the transient
 *  emotion `resolveEmotion` already derives — a second read of a decision
 *  already made, like the emote row. Unlisted emotions (incl. neutral,
 *  surprised) fall back to the mood personality unchanged.
 *
 *  Angry and bored pin a tight pacing corridor regardless of level: they set
 *  explicit `range` values that clobber moodWalkOpts' level-based nudge.
 *  Happy preserves the level nudge by omitting `range`. */
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

/** Copy `horizontal` with `kind`'s arc written at `atTick` (modulo length).
 *  The arc's reach is the walk's observed extent with a 3-cell floor (from
 *  Math.max(...horizontal, 3)), so sedentary moods still get a legible sweep
 *  while active walks' arcs match their roam. A track shorter than the arc
 *  truncates it, with the last written cell forced to 0 to preserve the
 *  no-teleport hand-off invariant. */
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
  // If arc was truncated, force the final written cell to 0 to ensure
  // no teleport snap on hand-off back to the surrounding walk.
  if (arc.length > len && len > 0) {
    out[(atTick + len - 1) % len] = 0;
  }
  return out;
}
