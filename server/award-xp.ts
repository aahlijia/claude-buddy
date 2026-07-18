#!/usr/bin/env bun
/**
 * Lightweight XP awarding script — called from shell hooks.
 * Awards XP for coding events without loading the full MCP server.
 *
 * Usage:
 *   bun run server/award-xp.ts <event> [slot]
 *
 * Events: errors_spotted | tests_passed | tests_failed | large_diff | turn | time_spent | buddy_pet
 */

import { awardXp, getXpState } from "./xp";
import {
  loadCompanionSlot,
  loadActiveSlot,
  writeStatusState,
  pickCelebration,
} from "./state";
import {
  startSession,
  awardSessionComplete,
  sightBug,
  formatStatUpText,
  raisedStatNames,
} from "./session";
import { recordSessionStart } from "./streak";
import { tickWhim } from "./quests";
import { announceOnce } from "./discovery";
import type { XpEvent } from "./xp";

/** Reconcile today's whim, swallowing any failure (game-feel NFR4). */
function safeTickWhim(slot?: string): boolean {
  try {
    return tickWhim(slot).justRewarded;
  } catch {
    return false;
  }
}

/**
 * Announce the daily-whim system once ever — but only when nothing higher
 * (level-up / whim reward) is already taking the bubble, so the introduction
 * is actually seen. Best-effort.
 */
function maybeDiscoverWhim(suppressed: boolean): boolean {
  if (suppressed) return false;
  try {
    return announceOnce("whim");
  } catch {
    return false;
  }
}

const VALID_EVENTS = new Set([
  "errors_spotted",
  "tests_passed",
  "tests_failed",
  "large_diff",
  "turn",
  "time_spent",
  "buddy_pet",
]);

// Session-lifecycle events route through session.ts rather than the fixed-XP
// path: session_start captures a baseline, session_complete awards the bonus.
const SESSION_EVENTS = new Set(["session_start", "session_complete"]);

// Encounter events carry no XP — they only drive the pending-encounter standoff
// (design-pending-encounter): bug_sighted spawns/escalates the standoff scene.
const ENCOUNTER_EVENTS = new Set(["bug_sighted"]);

function main(): void {
  const event = process.argv[2] as string;
  const slot = process.argv[3] ?? loadActiveSlot();

  if (
    !event ||
    (!VALID_EVENTS.has(event) &&
      !SESSION_EVENTS.has(event) &&
      !ENCOUNTER_EVENTS.has(event))
  ) {
    const all = [...VALID_EVENTS, ...SESSION_EVENTS, ...ENCOUNTER_EVENTS].join(
      " | ",
    );
    console.error(
      `Usage: bun run server/award-xp.ts <event> [slot]\nValid events: ${all}`,
    );
    process.exit(1);
  }

  // Encounter events run before the companion/XP setup below: sightBug loads its
  // own companion and attaches no XP. Best-effort (version-skew tolerant).
  if (event === "bug_sighted") {
    try {
      sightBug(slot);
    } catch {
      // The standoff is an optional delighter — never break the hook.
    }
    return;
  }

  // Get species and rarity for bonus calculation
  const companion = loadCompanionSlot(slot);
  const species = companion?.bones.species;
  const rarity = companion?.bones.rarity;

  if (event === "session_start") {
    // Break the streak if the previous session never committed, then capture
    // the new baseline (additional-rewards FR2).
    recordSessionStart();
    startSession(slot);
    // living-world P1: a fresh session gets a walk-on stinger — the buddy
    // enters the corridor instead of just picking up mid-wander.
    if (companion) {
      writeStatusState(companion, { stinger: "walkon" });
    }
    return;
  }

  if (event === "session_complete") {
    const prevLevel = getXpState().level;
    const { bonus, state, fightSummary, fightWon, statIncrements } =
      awardSessionComplete(slot, species, rarity);
    // A commit ticks the daily whim (commits_made was bumped before this runs).
    const whimRewarded = safeTickWhim(slot);
    if (companion) {
      const leveled = state.level > prevLevel;
      // A fight summary also suppresses the once-ever discovery announce, so
      // the intro isn't consumed on a write where the fight owns the bubble.
      const discovered = maybeDiscoverWhim(
        leveled || whimRewarded || fightSummary !== null,
      );
      // Behavioral stat leveling feedback (stats-leveling-v2 §P4): a toast for
      // any stat that crossed a whole point this commit (the lowest celebration
      // rung, so it never buries a level-up/fight/discovery) + a brief panel
      // flash on the raised stats.
      const statUpText = formatStatUpText(statIncrements);
      // Fallback "loot" so any streak/whim loot drop surfaces as a 🎁 toast.
      const { celebration, cause } = pickCelebration(
        state.level,
        leveled,
        whimRewarded,
        fightSummary,
        discovered,
        "loot",
        statUpText,
      );
      writeStatusState(companion, {
        level: state.level,
        xp: state.totalXp,
        xpGain: bonus,
        celebration,
        cause,
        statsRaised: raisedStatNames(statIncrements),
        // design-sprite-animation-v2 §P5: every real celebration gets its
        // kind-flavored flourish now, not just ascension/shiny. Discovery
        // stays unflourished — a one-time system message, not a performance.
        flourish: celebration != null && celebration.kind !== "discovery",
        // living-world P1: a won fight gets a victory-lap wander stinger; a
        // fled fight (or any other loot-kind celebration) gets the quieter
        // loot-dash instead.
        stinger: fightWon
          ? "victory"
          : celebration?.kind === "loot"
            ? "lootdash"
            : undefined,
      });
    }
    console.log(
      `Session bonus: +${bonus} XP → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
    );
    return;
  }

  const prevState = getXpState();
  const before = prevState.totalXp;
  const prevLevel = prevState.level;
  const state = awardXp(event as XpEvent, slot, species, rarity);
  const gained = state.totalXp - before;
  const whimRewarded = safeTickWhim(slot);
  if (companion) {
    const leveled = state.level > prevLevel;
    const discovered = maybeDiscoverWhim(leveled || whimRewarded);
    // No fallback cause: a plain event rolls no loot, so no side-channel echo.
    // Fights only spawn on session completion, so no fight summary here.
    const { celebration, cause } = pickCelebration(
      state.level,
      leveled,
      whimRewarded,
      null,
      discovered,
      undefined,
    );
    writeStatusState(companion, {
      level: state.level,
      xp: state.totalXp,
      xpGain: gained,
      celebration,
      cause,
      flourish: celebration != null && celebration.kind !== "discovery",
    });
  }
  console.log(
    `XP awarded: +${event} → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
  );
}

main();
