/**
 * Daily bounty board — three day-seeded tasks, some of them coding-driven
 * (commits, squashing a status-line bug). Rolled lazily on first touch each
 * day; completing one pays gold + a coffee, clearing the board pays an
 * Energy Drink on top.
 */

import { hashString, mulberry32 } from "../engine";
import { BOUNTIES, BOUNTIES_PER_DAY, CONSUMABLE_STACK, ZONES, type BountyKind } from "./data";
import { journal, type Bounty, type RpgState } from "./store";

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Pure: the board for a day. Distinct kinds, targets rolled in range. */
export function rollBoard(day: string, seedSalt: string = ""): Bounty[] {
  const rng = mulberry32(hashString(`bounty:${day}:${seedSalt}`));
  const pool = [...BOUNTIES];
  const out: Bounty[] = [];
  while (out.length < BOUNTIES_PER_DAY && pool.length) {
    const def = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const target = def.min + Math.floor(rng() * (def.max - def.min + 1));
    out.push({ kind: def.kind, target, progress: 0, done: false });
  }
  return out;
}

/** Roll today's board if the stored one is from another day. */
export function syncDaily(s: RpgState, now: number): void {
  const day = dayKey(now);
  if (s.daily.day === day && s.daily.tasks.length) return;
  s.daily = { day, tasks: rollBoard(day), bonus: false };
}

export function bountyText(b: Bounty): string {
  const def = BOUNTIES.find((d) => d.kind === b.kind);
  return def ? def.text(b.target) : b.kind;
}

export function bountyReward(s: RpgState): number {
  return 30 + 15 * Math.min(s.unlocked, ZONES.length);
}

/**
 * Advance every open bounty of `kind` by `n`. Completed bounties pay out
 * immediately; returns one announcement line per completion (empty when
 * nothing finished).
 */
export function progress(s: RpgState, kind: BountyKind, n: number, now: number): string[] {
  if (n <= 0) return [];
  syncDaily(s, now);
  const lines: string[] = [];
  for (const b of s.daily.tasks) {
    if (b.done || b.kind !== kind) continue;
    b.progress = Math.min(b.target, b.progress + n);
    if (b.progress < b.target) continue;
    b.done = true;
    const gold = bountyReward(s);
    s.gold += gold;
    s.stats.goldEarned += gold;
    s.items.potion = Math.min(CONSUMABLE_STACK, (s.items.potion ?? 0) + 1);
    lines.push(`📜 Bounty complete: ${bountyText(b)} — +${gold}g ☕`);
  }
  if (!s.daily.bonus && s.daily.tasks.length && s.daily.tasks.every((b) => b.done)) {
    s.daily.bonus = true;
    s.stats.boards = (s.stats.boards ?? 0) + 1;
    s.items.elixir = Math.min(CONSUMABLE_STACK, (s.items.elixir ?? 0) + 1);
    lines.push("🏅 Bounty board cleared! +1 🥤 Energy Drink");
    journal(s, `Cleared the bounty board (${s.daily.day})`);
  }
  return lines;
}
