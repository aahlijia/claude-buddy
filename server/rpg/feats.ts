/**
 * Achievements ("feats") and titles. Each feat is a predicate over the save;
 * `checkFeats` awards newly-met ones (gold + optional title) and returns the
 * announcements. Pure over the state it mutates.
 */

import { BOSSES, type BossId } from "./data";
import { journal, type RpgState } from "./store";

export interface Feat {
  id: string;
  name: string;
  desc: string;
  gold: number;
  title?: string;
  met: (s: RpgState) => boolean;
}

const bossFeat = (id: BossId, gold: number): Feat => ({
  id: `boss_${id}`,
  name: `${BOSSES[id].name} Slain`,
  desc: `Defeat ${BOSSES[id].name}`,
  gold,
  title: BOSSES[id].title,
  met: (s) => s.bossKills.includes(id),
});

const allGear = (s: RpgState) => [...s.bag, ...Object.values(s.equipped)].filter(Boolean);
const trainedRanks = (s: RpgState) => Object.values(s.training).reduce((a, b) => a + (b ?? 0), 0);

export const FEATS: readonly Feat[] = [
  { id: "first_blood", name: "First Blood", desc: "Win your first fight", gold: 10, met: (s) => s.stats.kills >= 1 },
  { id: "exterminator", name: "Exterminator", desc: "Defeat 100 monsters", gold: 150, title: "Exterminator", met: (s) => s.stats.kills >= 100 },
  { id: "pest_control", name: "Pest Control", desc: "Defeat 500 monsters", gold: 600, title: "Pest Control", met: (s) => s.stats.kills >= 500 },
  bossFeat("semicolon", 40),
  bossFeat("lich", 80),
  bossFeat("hydra", 120),
  bossFeat("heisenbug", 160),
  bossFeat("golem", 200),
  bossFeat("segfault", 300),
  { id: "tower_10", name: "Tower Climber", desc: "Reach tower floor 10", gold: 200, met: (s) => s.tower.best >= 10 },
  { id: "tower_25", name: "Skyscraper", desc: "Reach tower floor 25", gold: 500, title: "Skyscraper", met: (s) => s.tower.best >= 25 },
  { id: "tower_50", name: "Stack Overflow", desc: "Reach tower floor 50", gold: 1200, title: "Infinite Recursion", met: (s) => s.tower.best >= 50 },
  { id: "legendary", name: "Legendary Find", desc: "Own a legendary item", gold: 100, met: (s) => allGear(s).some((g) => g!.rarity === "legendary") },
  { id: "forge_5", name: "Apprentice Smith", desc: "Forge an item to +5", gold: 60, met: (s) => allGear(s).some((g) => (g!.plus ?? 0) >= 5) },
  { id: "forge_10", name: "Master Smith", desc: "Forge an item to +10", gold: 400, title: "Master Smith", met: (s) => allGear(s).some((g) => (g!.plus ?? 0) >= 10) },
  { id: "trainer", name: "Gym Rat", desc: "Buy 30 training ranks", gold: 150, title: "Gym Rat", met: (s) => trainedRanks(s) >= 30 },
  { id: "rich", name: "Venture Funded", desc: "Earn 5,000 gold in total", gold: 250, title: "Unicorn", met: (s) => s.stats.goldEarned >= 5000 },
  { id: "ko", name: "Learning Experience", desc: "Get knocked out", gold: 15, met: (s) => s.stats.deaths >= 1 },
  { id: "bug_hunter", name: "Bug Hunter", desc: "Hunt 10 status-line bugs", gold: 150, title: "Bug Hunter", met: (s) => (s.stats.hunts ?? 0) >= 10 },
  { id: "bounty", name: "Bounty Board Regular", desc: "Clear the bounty board 7 times", gold: 200, title: "Contractor", met: (s) => (s.stats.boards ?? 0) >= 7 },
  { id: "curious", name: "Curious", desc: "Resolve 20 exploration events", gold: 100, title: "Wanderer", met: (s) => (s.stats.events ?? 0) >= 20 },
];

/** Award every newly-met feat; returns one announcement line per award. */
export function checkFeats(s: RpgState): string[] {
  const out: string[] = [];
  for (const f of FEATS) {
    if (s.feats.includes(f.id) || !f.met(s)) continue;
    s.feats.push(f.id);
    s.gold += f.gold;
    out.push(`🏆 Achievement: ${f.name} — ${f.desc} (+${f.gold}g${f.title ? `, title «${f.title}»` : ""})`);
    journal(s, `Achievement: ${f.name}`);
  }
  return out;
}

export function unlockedTitles(s: RpgState): string[] {
  return FEATS.filter((f) => f.title && s.feats.includes(f.id)).map((f) => f.title!);
}
