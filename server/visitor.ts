/**
 * Wild buddy visitors — a P2 living-world flavor beat, distinct from the
 * bug-fight/boss-standoff pipeline in `combat.ts`. Once in a while, a
 * different-species buddy wanders through, greets, and leaves. No fight, no
 * gear, no stakes beyond an occasional small points reward.
 *
 * Pure core: `rollVisitor` decides whether/who (seeded, deterministic) and
 * `bakeVisitorScene` bakes the greet flipbook. Both are dependency-light and
 * do no I/O — the trigger seam, surfacing side-channel, and toast wiring are
 * Task 7's job (`session.ts`/`award-xp.ts`/`state.ts`).
 *
 * The greet scene reuses `composePose` (exported from `combat.ts` for this
 * purpose) so it stays pixel-consistent with fight/standoff scenes: same
 * two-sprite composition, same `shift`-into-the-gap primitive, same
 * overlay-row contract. Caption text is NOT baked here — the surfaced record
 * carries it (Task 7).
 */

import { trimBlankTopRows } from "./art";
import {
  composePose,
  type Pose,
  type PoseExtras,
  type PlayerLook,
} from "./combat";
import { BUGS } from "./bugs";
import {
  mulberry32,
  SHINY_HATCH_CHANCE,
  type Species,
  type Eye,
} from "./engine";

// ─── Visitor spec ───────────────────────────────────────────────────────────

/** A wild buddy that wanders through — a greet, never a fight. */
export interface VisitorSpec {
  /** The visiting creature's species (never the player's own — see
   *  `rollVisitor`). */
  species: Species;
  /** Whether the visitor sparkles, at the usual hatch odds. */
  shiny: boolean;
  /** A small points reward, present on ~25% of visits. */
  reward?: { points: number };
}

/** 1-in-N commits roll a wild visitor (before the species/shiny/reward
 *  draws that decide who shows up). */
export const VISITOR_ODDS = 12;

/** The curated mirror-safe species set: `BUGS`' `species` values,
 *  de-duplicated. Reusing this set (rather than the full `SPECIES` union)
 *  keeps visitors on the exact 5-line, ANSI-free creatures `combat.ts`'s
 *  `mirrorFrame` pass already proves safe for the enemy slot. */
const VISITOR_SPECIES: readonly Species[] = [
  ...new Set(BUGS.map((b) => b.species)),
];

/**
 * Roll whether a wild visitor shows up this commit, and if so, who. Pure &
 * deterministic (`mulberry32(seed)`) — same seed, same result. Fixed draw
 * order so the odds bands stay stable across changes to this function:
 *
 *   1. gate      — ~1/`VISITOR_ODDS` chance a visitor appears at all. Always
 *                  drawn (even on a miss) so later seeds aren't shifted by
 *                  whether earlier ones hit.
 *   2. species   — uniform over the curated set, excluding the player's own
 *                  species (a buddy doesn't visit itself).
 *   3. shiny     — the usual hatch odds (`SHINY_HATCH_CHANCE`, engine.ts).
 *   4. reward?   — ~25% of visits carry a reward; when they do, a 5th draw
 *                  picks the point amount. A miss costs exactly this one
 *                  draw (no 5th draw), so the stream length is a pure
 *                  function of the gate + reward-gate outcomes.
 *   5. points    — 3..8 inclusive, only drawn on a reward hit.
 */
export function rollVisitor(
  seed: number,
  playerSpecies: Species,
): VisitorSpec | null {
  const rng = mulberry32(seed);
  if (rng() >= 1 / VISITOR_ODDS) return null; // (1) gate
  const pool = VISITOR_SPECIES.filter((s) => s !== playerSpecies);
  const species = pool[Math.floor(rng() * pool.length)]; // (2) species
  const shiny = rng() < SHINY_HATCH_CHANCE; // (3) shiny, usual odds
  const reward =
    rng() < 0.25 // (4) reward gate, ~25%
      ? { points: 3 + Math.floor(rng() * 6) } // (5) 3..8 inclusive
      : undefined;
  return { species, shiny, reward };
}

// ─── Greet scene ────────────────────────────────────────────────────────────

/** Inert placeholder: the greet scene's `strike` is always false, so
 *  `composePose`'s `sword` glyph is never drawn into the gap. */
const NO_SWORD = "";
/** The visitor's calm resting eye — in shot on arrival and on departure. */
const IDLE_EYE = "·"; // ·
/** The visitor's happy greeting eye. */
const GREET_EYE = "^";
/** The affection pop drawn on the greet beat, via the shared `overlayRow`
 *  machinery `composePose` already threads through `PoseExtras.overlay`. */
const HEART = "♥"; // ♥

/**
 * Bake the wild-visitor greet flipbook: the visitor walks partway into the
 * gap (the same `shift`-toward-the-gap primitive the skirmish bouts use),
 * greets with brightened eyes and a heart pop, then walks back off. Every
 * beat carries an overlay row (blank when there's no heart) so height never
 * jitters, matching the fight/standoff contract. Constant width AND height
 * by construction (`composePose` + `trimBlankTopRows`, shared with
 * `combat.ts`). `seed` drives only pacing (how long the heart-pop beat
 * lingers) — same seed, same scene.
 *
 * `look` is accepted (and threaded straight through to `composePose`) purely
 * because the player-side plumbing is free once `composePose` is reused; no
 * caller wires a real look into it yet (Task 5 scope) — that's for whichever
 * later task wants the player's gear visible on a greet.
 */
export function bakeVisitorScene(
  playerSpecies: Species,
  playerEye: Eye,
  visitor: VisitorSpec,
  seed: number,
  look?: PlayerLook,
): { frames: string[]; sequence: number[] } {
  const beat = (cells: number, eEye: string, heart: boolean): string => {
    const pose: Pose = { pEye: playerEye, eEye: eEye as Eye, strike: false };
    const extras: PoseExtras = {
      shift: { side: "enemy", cells },
      overlay: { text: heart ? HEART : null, over: "enemy" },
    };
    return composePose(
      playerSpecies,
      visitor.species,
      pose,
      NO_SWORD,
      extras,
      look,
    );
  };

  const rest = beat(0, IDLE_EYE, false);
  const walk1 = beat(1, IDLE_EYE, false);
  const walk2 = beat(2, IDLE_EYE, false);
  const walk3 = beat(3, IDLE_EYE, false);
  const greet1 = beat(3, GREET_EYE, false);
  const greet2 = beat(3, GREET_EYE, true); // the heart-pop beat
  const walkoff1 = beat(2, IDLE_EYE, false);
  const walkoff2 = beat(1, IDLE_EYE, false);
  const frames = [
    rest,
    walk1,
    walk2,
    walk3,
    greet1,
    greet2,
    walkoff1,
    walkoff2,
  ];

  // Seeded pacing only (bout-grammar style, cf. bakePendingScene's gap()):
  // the heart-pop beat lingers 1-3 extra ticks so not every visit reads
  // identically. Walk-in / greet / walk-off / home, played once (~12-14
  // ticks); NOW % len naturally loops it for as long as the record is fresh.
  const rng = mulberry32(seed);
  const greetHold = 1 + Math.floor(rng() * 3);
  const sequence = [
    0, 0,
    1, 2, 3,
    4, 4,
    ...Array<number>(greetHold).fill(5),
    6, 7,
    0, 0,
  ];
  return { frames: trimBlankTopRows(frames), sequence };
}
