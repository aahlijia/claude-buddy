/**
 * Session-completion bonus for claude-buddy.
 *
 * A "session" runs from the first hook activity (or the previous commit) up to
 * the next git commit. When react.sh detects a commit it fires
 * `award-xp.ts session_complete`, which awards a bonus scaled by the work done
 * since the session baseline was captured.
 *
 * The baseline is a snapshot of the relevant lifetime counters from events.json
 * (maintained by react.sh / achievements.ts). On commit we diff the current
 * counters against the baseline, award the bonus, then re-baseline so the next
 * session starts fresh. This reuses the existing counters — no second tally to
 * keep in sync.
 *
 * State: session.$SID.json, session-scoped via the same $SID as reactions, and
 * cleaned up on uninstall (see TRANSIENT_PREFIXES in state.ts).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";
import {
  sessionId,
  loadCompanion,
  saveCompanion,
  loadCompanionSlot,
  updateCompanionSlot,
  resolveUserId,
  effectiveGameFeel,
  gameFeelLevel,
  writeStatusState,
} from "./state.ts";
import { loadGlobalEvents, type GlobalCounters } from "./achievements.ts";
import {
  awardXpAmount,
  rarityMultiplier,
  getXpState,
  accountMultiplier,
  accrueStatProgress,
  ownedUpgradeEffects,
  type XpState,
} from "./xp.ts";
import { updateStreak } from "./streak.ts";
import { rollLoot } from "./loot.ts";
import { spawnBug, tierForErrors, bugById, type Bug, type BugTier } from "./bugs.ts";
import {
  resolveCombat,
  applyCombatDrops,
  writeEncounter,
  bakePendingScene,
  writePendingEncounter,
  readPendingEncounter,
  clearPendingEncounter,
} from "./combat.ts";
import { ownedItems } from "./shop.ts";
import {
  STAT_NAMES,
  hashString,
  type Species,
  type Rarity,
  type StatName,
} from "./engine.ts";

// ─── Counters that feed the bonus ────────────────────────────────────────────

/**
 * The slice of lifetime counters the session bonus cares about, plus the
 * error-ish counters that feed the combat spawn. Only the first three are
 * scored by computeSessionBonus; the rest exist so a session's failed tests /
 * type errors / lint runs / broken builds can spawn a bug to fight
 * (combatErrorCount) — react.sh's classifier routes most real-world errors to
 * those buckets rather than `errors_seen`.
 */
export interface SessionCounters {
  all_green: number; // green test runs
  large_diffs: number; // substantive changes
  errors_seen: number; // errors worked through
  commits_made: number; // baseline only — not scored
  tests_failed: number; // combat spawn only — not scored
  type_errors: number; // combat spawn only — not scored
  lint_fails: number; // combat spawn only — not scored
  build_fails: number; // combat spawn only — not scored
}

export interface SessionSnapshot {
  startedAt: number; // epoch seconds
  baseline: SessionCounters;
}

function extractCounters(g: GlobalCounters): SessionCounters {
  return {
    all_green: g.all_green,
    large_diffs: g.large_diffs,
    errors_seen: g.errors_seen,
    commits_made: g.commits_made,
    tests_failed: g.tests_failed,
    type_errors: g.type_errors,
    lint_fails: g.lint_fails,
    build_fails: g.build_fails,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Snapshot I/O (atomic, session-scoped) ───────────────────────────────────

function snapshotFile(): string {
  return join(buddyStateDir(), `session.${sessionId()}.json`);
}

export function loadSnapshot(): SessionSnapshot | null {
  try {
    return JSON.parse(readFileSync(snapshotFile(), "utf8")) as SessionSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = snapshotFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshot));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(snapshot));
  }
}

// ─── Bonus computation (pure) ────────────────────────────────────────────────

/**
 * Per-event diff between the current counters and a baseline, clamped to ≥ 0
 * (counters only ever grow, but a missing/younger baseline shouldn't go
 * negative). A counter absent from the baseline diffs to 0, not to its full
 * lifetime value: on-disk snapshots written before a counter existed would
 * otherwise credit the whole history to one session.
 */
export function counterDelta(
  current: SessionCounters,
  baseline: SessionCounters,
): SessionCounters {
  const d = (a: number, b: number | undefined): number =>
    typeof b === "number" ? Math.max(0, a - b) : 0;
  return {
    all_green: d(current.all_green, baseline.all_green),
    large_diffs: d(current.large_diffs, baseline.large_diffs),
    errors_seen: d(current.errors_seen, baseline.errors_seen),
    commits_made: d(current.commits_made, baseline.commits_made),
    tests_failed: d(current.tests_failed, baseline.tests_failed),
    type_errors: d(current.type_errors, baseline.type_errors),
    lint_fails: d(current.lint_fails, baseline.lint_fails),
    build_fails: d(current.build_fails, baseline.build_fails),
  };
}

/**
 * How many error-ish events this session's delta carries — the signal that
 * spawns a bug to fight (tierForErrors scales with it). Broader than
 * `errors_seen` alone because react.sh's classifier routes most real errors
 * to the more specific buckets (a failing `bun test` prints `error:` and
 * lands in lint/test counters, not `errors_seen`).
 */
export function combatErrorCount(delta: SessionCounters): number {
  return (
    delta.errors_seen +
    delta.tests_failed +
    delta.type_errors +
    delta.lint_fails +
    delta.build_fails
  );
}

/** Hard cap on the raw session bonus, before any multiplier. */
export const SESSION_BONUS_CAP = 120;
/** Base award for committing at all. */
export const SESSION_BASE_BONUS = 30;

/**
 * Compute the session-completion bonus from a counter delta. Weighted with
 * per-event diminishing caps so a single giant session can't dwarf the curve,
 * then capped at SESSION_BONUS_CAP. Species/rarity multipliers are applied by
 * the caller (Phase 4) — this stays a pure, deterministic function of the work.
 */
export function computeSessionBonus(delta: SessionCounters): number {
  const raw =
    SESSION_BASE_BONUS +
    8 * Math.min(delta.all_green, 6) +
    5 * Math.min(delta.large_diffs, 4) +
    4 * Math.min(delta.errors_seen, 5);
  return Math.min(raw, SESSION_BONUS_CAP);
}

// ─── Behavioral stat leveling ────────────────────────────────────────────────

/** Stats never drop below 1 (dump floor) or rise above 100 (peak cap). */
export const STAT_FLOOR = 1;
export const STAT_CAP = 100;
/** Max whole points any single stat may gain from one session's work. */
export const STAT_GAIN_PER_SESSION_CAP = 2;

/**
 * Fractional stat gains earned by a session's work, derived from the same
 * counter delta that feeds the XP bonus plus the session's elapsed time. Four
 * of the five stats map to signals already captured; SNARK has no clean
 * behavioral proxy and stays manual for now.
 *
 * Tuning is deliberately slow — a stat only ticks up after a stretch of the
 * matching behavior (≈7 bugs worked through for +1 DEBUGGING, etc.).
 *
 * Args:
 *     delta: Per-counter work done since the session baseline.
 *     elapsedSec: Session duration in seconds (now − snapshot.startedAt).
 *
 * Returns:
 *     Fractional gains keyed by stat; stats with no gain are omitted.
 */
export function computeStatGains(
  delta: SessionCounters,
  elapsedSec: number,
): Partial<Record<StatName, number>> {
  const minutes = Math.max(0, elapsedSec) / 60;
  const gains: Partial<Record<StatName, number>> = {};
  const add = (stat: StatName, amount: number): void => {
    if (amount > 0) gains[stat] = (gains[stat] ?? 0) + amount;
  };
  add("DEBUGGING", 0.15 * delta.errors_seen); // bugs worked through
  add("CHAOS", 0.1 * delta.large_diffs); // sweeping changes
  add("WISDOM", 0.2 * delta.all_green); // clean test runs
  add("PATIENCE", 0.05 * (minutes / 10)); // time in the trenches
  return gains;
}

/**
 * Apply whole-point stat increments to a companion, clamped to [FLOOR, CAP].
 * Writes the companion at most once, and only if a value actually changed.
 */
function applyStatIncrements(
  slot: string | undefined,
  increments: Partial<Record<StatName, number>>,
): void {
  const companion = slot ? loadCompanionSlot(slot) : loadCompanion();
  if (!companion) return;
  let changed = false;
  for (const stat of STAT_NAMES) {
    const inc = increments[stat] ?? 0;
    if (inc <= 0) continue;
    const cur = companion.bones.stats[stat];
    const next = Math.min(STAT_CAP, Math.max(STAT_FLOOR, cur + inc));
    if (next !== cur) {
      companion.bones.stats[stat] = next;
      changed = true;
    }
  }
  if (!changed) return;
  if (slot) updateCompanionSlot(slot, companion);
  else saveCompanion(companion);
}

/**
 * Accrue this session's behavioral stat gains: fold the fractional gains into
 * the persisted accumulators, then apply any whole points that rolled over to
 * the companion. Runs once per commit (in the session-complete path), so it
 * adds no per-event cost. Returns the increments applied (for surfacing/tests).
 */
export function accrueSessionStats(
  slot: string | undefined,
  delta: SessionCounters,
  elapsedSec: number,
): Partial<Record<StatName, number>> {
  // Opt-out (design-rpg Phase 4): gameFeel=off disables the game mechanics —
  // this is the behavioral-stat gate owed since stat-leveling.
  if (effectiveGameFeel() === "off") return {};
  const gains = computeStatGains(delta, elapsedSec);
  if (Object.keys(gains).length === 0) return {};
  const increments = accrueStatProgress(gains, STAT_GAIN_PER_SESSION_CAP);
  if (Object.keys(increments).length === 0) return {};
  applyStatIncrements(slot, increments);
  return increments;
}

// ─── Pending encounter (design-pending-encounter): the standoff before combat ─

/** What a sighting event should do to the current pending file. Pure. */
export type PendingDecision = "spawn" | "escalate" | "noop";

/**
 * Decide a sighting's action from the tier it implies and any existing pending
 * standoff at the *same* session. No pending ⇒ spawn; a strictly higher tier ⇒
 * escalate (a fresh roll at the bigger tier); otherwise no-op — repeated
 * same-tier errors don't re-bake, keeping the per-event cost zero.
 */
export function pendingAction(
  tier: 0 | BugTier,
  existing: { tier: BugTier } | null,
): PendingDecision {
  if (tier === 0) return "noop";
  if (!existing) return "spawn";
  if (tier > existing.tier) return "escalate";
  return "noop";
}

/**
 * Bug-selection seed for a sighting/escalation, keyed per (session, tier). A
 * re-sighting at the same tier re-derives the same bug (idempotent), while an
 * escalation to a new tier rolls a fresh same-tier pick — matching the roll the
 * commit-time resolution will reproduce for that tier.
 */
function pendingSeed(startedAt: number, tier: number): number {
  return hashString(`${resolveUserId()}:${startedAt}:${tier}`);
}

/**
 * Sight a bug (design-pending-encounter §4.1): on the first error-ish event of a
 * session a two-sprite standoff appears on the status line and stands there
 * until a commit resolves it; further errors escalate its tier. Full-only — the
 * standoff's only surface is the scene, so `subtle`/`off` no-op (they keep
 * today's toast-at-resolve / nothing). Best-effort and self-guarded; called
 * from award-xp.ts `bug_sighted`.
 */
export function sightBug(slot?: string): void {
  // The standoff is a full-only surface (§D5), gated on the CONFIGURED level —
  // NOT effectiveGameFeel(). A sighting fires on the very error events whose
  // fresh reaction trips the auto-quiet spike clamp (FR-E1, and reactionTTL
  // defaults to 0 = the reaction never expires), so the clamped read is
  // "subtle" here by construction and would suppress every spawn.
  if (gameFeelLevel() !== "full") return;

  const snapshot = loadSnapshot();
  const current = extractCounters(loadGlobalEvents());
  const baseline = snapshot?.baseline ?? current;
  // A sighting event just fired, so even a missing/older snapshot counts the
  // event that summoned us (floor at 1).
  const count = Math.max(1, combatErrorCount(counterDelta(current, baseline)));
  const tier = tierForErrors(count);
  const startedAt = snapshot?.startedAt ?? nowSeconds();

  // Only an existing standoff from THIS session escalates; a stale one (crash
  // between session_start's clear and its snapshot save) is treated as absent.
  const existing = readPendingEncounter();
  const sameSession = existing && existing.startedAt === startedAt ? existing : null;
  const decision = pendingAction(tier, sameSession);
  if (decision === "noop") return;

  const bug = spawnBug(count, pendingSeed(startedAt, tier));
  if (!bug) return;
  const companion = slot ? loadCompanionSlot(slot) : loadCompanion();
  if (!companion) return;

  const scene = bakePendingScene(
    companion.bones.species,
    companion.bones.eye,
    bug.species,
    bug.eye,
  );
  writePendingEncounter({
    bugId: bug.id,
    tier: tier as BugTier, // decision !== "noop" ⇒ tier >= 1
    frames: scene.frames,
    sequence: scene.sequence,
    sightedAt: Date.now(),
    startedAt,
  });
  // Land the standoff on the line immediately (§4.1.6); writeStatusState reads
  // the pending file we just wrote (P3 render branch).
  writeStatusState(companion, {});
}

/**
 * Choose the bug a commit fights (design-pending-encounter §4.3, G4). Prefer the
 * pinned enemy from this session's standoff; tier-upgrade it if the final count
 * outgrew the displayed tier (errors during react.sh's 30s cooldown can outrun
 * sightings). Falls back to a fresh roll when no pending standoff belongs to
 * this session — behavior identical to the pre-pending code.
 */
function resolveFightBug(
  pending: { bugId: string; tier: BugTier; startedAt: number } | null,
  errorsSeen: number,
  startedAt: number,
  fallbackSeed: number,
): Bug | null {
  const fallback = (): Bug | null => spawnBug(errorsSeen, fallbackSeed);
  if (!pending || pending.startedAt !== startedAt) return fallback();
  const finalTier = tierForErrors(errorsSeen);
  if (finalTier > pending.tier) {
    // Escalate: a fresh same-seeded roll at the higher tier (§D1).
    return spawnBug(errorsSeen, pendingSeed(startedAt, finalTier)) ?? bugById(pending.bugId);
  }
  return bugById(pending.bugId) ?? fallback();
}

/**
 * Idle-RPG combat (design-rpg Phase 3, extended by design-pending-encounter): a
 * session's error-ish events (see combatErrorCount) spawn a bug the buddy
 * auto-fights on commit. Runs once per commit (reusing the counter delta already
 * computed), so it adds no per-event cost. Wins drop skill points / items; the
 * baked fight lands in the transient encounter side-channel (rendered by
 * Phase 4). Seeded deterministically for reproducibility.
 *
 * The enemy fought is the one the standoff pinned (G4); a commit ALSO clears the
 * pending standoff unconditionally (G5) — even at `off` or a zero-delta commit —
 * so "commit dismisses the nudge" is a hard invariant, not a happy-path effect.
 *
 * Returns the fight's one-line summary so the CALLER's final status write can
 * surface it as a toast (via pickCelebration). This function deliberately does
 * not write status itself: award-xp.ts writes status immediately after
 * awardSessionComplete returns, and a toast written here was overwritten by
 * that write before it ever rendered — leaving `subtle` users (whose only
 * combat surface is the toast) with an invisible fight.
 */
export function maybeFightBug(
  slot: string | undefined,
  errorsSeen: number,
  startedAt: number,
): string | null {
  // Read the pinned standoff, then dismiss it unconditionally (§4.3, G5): the
  // commit resolves the nudge regardless of gate or delta.
  const pending = readPendingEncounter();
  clearPendingEncounter();

  // Opt-out (design-rpg Phase 4): gameFeel=off disables the idle-RPG loop —
  // no spawns, no drops, no encounter file (the clear above still ran).
  if (effectiveGameFeel() === "off") return null;
  const seed = hashString(`${resolveUserId()}:${startedAt}:${errorsSeen}`);
  const bug = resolveFightBug(pending, errorsSeen, startedAt, seed);
  if (!bug) return null;
  const companion = slot ? loadCompanionSlot(slot) : loadCompanion();
  if (!companion) return null;

  const xpState = getXpState();
  const { equipment, inventory } = xpState;
  const owned = ownedItems(inventory, equipment);
  const result = resolveCombat(
    companion.bones,
    bug,
    equipment,
    seed,
    owned,
    ownedUpgradeEffects(xpState),
  );
  applyCombatDrops(result.drop);
  writeEncounter(result);
  return result.summary;
}

// ─── Lifecycle entry points (called from award-xp.ts) ────────────────────────

/** Capture the baseline at the start of a session (overwrites any stale one). */
export function startSession(): SessionSnapshot {
  // A fresh session re-baselines the counters, so any surviving standoff would
  // resolve against a zero delta — a ghost. Clear it (§4.4, G5) before the new
  // snapshot lands so a sighting is always matched to a live baseline.
  clearPendingEncounter();
  const snapshot: SessionSnapshot = {
    startedAt: nowSeconds(),
    baseline: extractCounters(loadGlobalEvents()),
  };
  saveSnapshot(snapshot);
  return snapshot;
}

export interface SessionCompletion {
  bonus: number;
  state: XpState;
  /** One-line summary of this commit's idle-RPG fight, or null when none
   *  spawned. The caller folds it into its final status write's celebration
   *  (pickCelebration) — see maybeFightBug for why it isn't written here. */
  fightSummary: string | null;
}

/**
 * Award the session-completion bonus on commit, then re-baseline for the next
 * session. If no baseline exists yet (first commit before any session_start),
 * the delta is zero and only the base bonus is granted.
 */
export function awardSessionComplete(
  slot?: string,
  species?: Species,
  rarity?: Rarity,
): SessionCompletion {
  const current = extractCounters(loadGlobalEvents());
  const snapshot = loadSnapshot();
  const baseline = snapshot?.baseline ?? current;

  // This commit completes a net-positive session: advance the streak and fold
  // any milestone bonus into the raw total so it scales with the same
  // multiplier as the rest of the session reward (additional-rewards FR2).
  const streakReward = updateStreak();

  // Cap the raw bonus first (§3.2), then apply the rarity and account
  // (prestige × collection) multipliers — all stack multiplicatively
  // (additional-rewards FR1.3 / FR3.3).
  const delta = counterDelta(current, baseline);
  const raw = computeSessionBonus(delta);
  const acctMult = accountMultiplier(getXpState());
  const bonus = Math.floor(
    (raw + streakReward) * rarityMultiplier(rarity) * acctMult,
  );
  const state = awardXpAmount(bonus, slot, species, rarity);

  // Behavioral stat leveling: nudge the companion's stats from the same delta
  // plus the session's elapsed time. Once-per-commit, so no per-event cost.
  const elapsedSec = snapshot ? Math.max(0, nowSeconds() - snapshot.startedAt) : 0;
  accrueSessionStats(slot, delta, elapsedSec);

  // Idle-RPG combat (Phase 3): this session's error-ish events (errors, failed
  // tests/lint/type-checks/builds) spawn a bug to fight.
  const fightSummary = maybeFightBug(
    slot,
    combatErrorCount(delta),
    snapshot?.startedAt ?? 0,
  );

  // A non-zero streak reward means a streak milestone just landed — roll loot
  // on top of the deterministic bonus (additional-rewards FR4.1).
  if (streakReward > 0) rollLoot("streak_milestone", slot);

  // Re-baseline: the next session starts counting from here.
  saveSnapshot({ startedAt: nowSeconds(), baseline: current });

  return { bonus, state, fightSummary };
}
