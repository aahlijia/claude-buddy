/**
 * Exploration events — the rooms between fights. A floor sometimes opens on
 * a chest, a shrine or a stranger instead of a monster; the player picks
 * ;1 or ;2. Pure: `resolveEvent` returns an outcome the game layer applies.
 */

import type { ConsumableId } from "./data";

export type EventId = "chest" | "shrine" | "duck" | "forum" | "merge" | "intern";

export interface PendingEvent {
  id: EventId;
  zone: number;
  /** Monster level of the floor it appeared on (scales rewards). */
  level: number;
  seed: number;
}

export type BlessingStat = "atk" | "def" | "crit";

export interface Blessing {
  stat: BlessingStat;
  /** Percent for atk/def, flat points for crit. */
  amount: number;
  fights: number;
  name: string;
}

export interface EventOutcome {
  text: string;
  gold?: number;
  /** HP change as a fraction of max HP (negative = damage; never kills). */
  hpPct?: number;
  fullHeal?: boolean;
  item?: ConsumableId;
  /** Consumable spent to take this option. */
  cost?: { gold?: number; item?: ConsumableId };
  gear?: { luck: number; floor?: "uncommon" | "rare" | "epic" };
  blessing?: Blessing;
  xp?: number;
  /** Start a mimic fight. */
  mimic?: boolean;
  /** Option not available (can't pay) — event stays open. */
  blocked?: boolean;
}

export interface EventDef {
  id: EventId;
  title: string;
  art: readonly string[];
  text: string;
  options: readonly [string, string];
}

export const EVENTS: Record<EventId, EventDef> = {
  chest: {
    id: "chest",
    title: "A Treasure Chest",
    art: ["   ________ ", "  /\\_______\\", "  ||  $$$  |", "  \\|_______|"],
    text: "A chest sits in the grass, slightly ajar. It smells like unreviewed code.",
    options: ["Open it", "Leave it alone"],
  },
  shrine: {
    id: "shrine",
    title: "Shrine of the Green Build",
    art: ["     /\\     ", "    /✓ \\    ", "   /____\\   ", "   |____|   "],
    text: "A small shrine hums with passing tests. A donation bowl glints.",
    options: ["Pray (full heal)", "Make an offering (blessing)"],
  },
  duck: {
    id: "duck",
    title: "The Rubber Duck Sage",
    art: ["    __      ", "  <(o )___  ", "   ( ._> /  ", "    `---'   "],
    text: "An enormous rubber duck regards you patiently. It is ready to listen.",
    options: ["Explain your bug to it", "Ask it for wisdom"],
  },
  forum: {
    id: "forum",
    title: "An Ancient Forum Post",
    art: [" ┌─────────┐ ", " │ ▲ 2.1k  │ ", " │ ✔ answer│ ", " └─────────┘ "],
    text: "Carved into a stone: a highly upvoted answer. The date is worn away.",
    options: ["Copy the accepted answer", "Read the comments first"],
  },
  merge: {
    id: "merge",
    title: "A Merge Conflict",
    art: [" <<<<<<< HEAD", " =======     ", " >>>>>>> main", "             "],
    text: "Two branches block the path, glaring at each other. Something valuable is wedged between them.",
    options: ["Resolve it carefully", "git push --force"],
  },
  intern: {
    id: "intern",
    title: "A Lost Intern",
    art: ["     o      ", "    /|\\  ?  ", "    / \\     ", "            "],
    text: "An intern clutches a laptop. \"Is... is it supposed to say 'segmentation fault'?\"",
    options: ["Share a Coffee", "Point them to the docs"],
  },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

/** Chance an explore opens on an event instead of a monster. */
export const EVENT_CHANCE = 0.22;

export function rollEventId(rng: () => number): EventId {
  return EVENT_IDS[Math.floor(rng() * EVENT_IDS.length)];
}

/** Pure: what choosing `option` (1|2) does. `have` is what the player can pay with. */
export function resolveEvent(
  ev: PendingEvent,
  option: 1 | 2,
  rng: () => number,
  have: { gold: number; potions: number },
): EventOutcome {
  const L = ev.level;
  const g = (base: number, per: number) => Math.round((base + per * L) * (0.8 + rng() * 0.4));
  switch (ev.id) {
    case "chest":
      if (option === 2) return { text: "You leave it be. Somewhere, a disappointed mimic sighs." };
      if (rng() < 0.2) return { text: "The chest grows teeth. IT'S A MIMIC!", mimic: true };
      return rng() < 0.5
        ? { text: "Gold spills out — and something shiny underneath.", gold: g(8, 3), gear: { luck: 0.2 } }
        : { text: "A pile of gold coins, still warm from the build server.", gold: g(14, 4) };
    case "shrine": {
      if (option === 1) return { text: "Green light washes over you. Every test passes.", fullHeal: true };
      const price = 20 + 3 * L;
      if (have.gold < price) return { text: `The bowl wants ${price}g. You can't afford the offering.`, blocked: true };
      return {
        text: `You offer ${price}g. The shrine blesses your blade.`,
        cost: { gold: price },
        blessing: { stat: "atk", amount: 25, fights: 3, name: "Green Build (+25% ATK)" },
      };
    }
    case "duck":
      if (option === 1) {
        return {
          text: "Halfway through explaining, you realise the answer yourself. The duck nods.",
          blessing: { stat: "crit", amount: 15, fights: 3, name: "Duck Insight (+15% CRIT)" },
        };
      }
      return { text: "\"Have you tried reading the error message?\" Profound.", xp: 8 + L };
    case "forum":
      if (option === 2) {
        return { text: "The comments say the answer is outdated, then argue for 40 replies. You pocket a few coins.", gold: g(4, 1) };
      }
      return rng() < 0.65
        ? { text: "It works! You don't know why. Nobody does.", gold: g(12, 4), item: "potion" }
        : { text: "The answer is from 2011. It deletes your node_modules — and some HP.", hpPct: -0.2 };
    case "merge":
      if (option === 1) return { text: "You resolve each hunk by hand. Tedious, but safe.", hpPct: -0.1, gold: g(10, 4) };
      return rng() < 0.5
        ? { text: "--force! Their changes vanish and the loot is yours.", gold: g(30, 9) }
        : { text: "--force! ...You force-pushed over your own fix. Ouch.", hpPct: -0.35 };
    case "intern":
      if (option === 2) return { text: "\"Oh! There's a README?\" They wander off, enlightened.", xp: 5 + Math.floor(L / 2) };
      if (have.potions < 1) return { text: "You have no Coffee to share. ;buy 1 at the ;shop", blocked: true };
      return {
        text: "They perk up and hand you something they found in prod. \"Is this yours?\"",
        cost: { item: "potion" },
        gear: { luck: 0.35, floor: "rare" },
      };
  }
}
