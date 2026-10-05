/**
 * Buddy Quest narrative — prologue, zone arrivals, boss dialogue, ending.
 * Pure text. `{name}` is replaced with the buddy's name.
 */

import type { BossId } from "./data";

export const PROLOGUE: readonly string[] = [
  "The build is red. It has been red for days.",
  "Deep beneath your editor, bugs have slipped out of the test suite and",
  "burrowed into six realms of the Codebase. The linters have gone quiet.",
  "The CI runners whisper of a dragon that dumps cores at the bottom of it all.",
  "",
  "{name} looks up at you, grabs the nearest blunt object, and steps into",
  "the Syntax Meadows. Somebody has to fix this.",
];

export const ZONE_ARRIVAL: Record<number, string> = {
  1: "Syntax Meadows — tall grass of tangled brackets. Something is missing a semicolon.",
  2: "Null Marsh — fog that isn't there. Every step might dereference nothing.",
  3: "Callback Caverns — tunnels nesting inside tunnels. You hear a promise break.",
  4: "Race Rapids — the river flows in two orders at once. Timing is everything.",
  5: "Leak Mines — the walls are made of memory no one freed. They're still growing.",
  6: "Kernel Abyss — no user space down here. Only the dragon, and the dark.",
  7: "The Endless Tower — every regression ever reverted climbs back up here. Forever.",
};

export interface BossLines {
  intro: string;
  /** Spoken once when the boss drops below half HP. */
  phase: string;
  defeat: string;
}

export const BOSS_LINES: Record<BossId, BossLines> = {
  semicolon: {
    intro: "\"You'll never find me. I'm on line 1,204 of a minified file.\"",
    phase: "\"Unexpected token? I AM the unexpected token!\"",
    defeat: "\"...;\" — at last, it terminates.",
  },
  lich: {
    intro: "\"Everything ends in null, little buddy. Even you.\"",
    phase: "\"Cannot read properties of undefined (reading 'you')!\"",
    defeat: "The Lich checks itself for null... and finds it.",
  },
  hydra: {
    intro: "\"Call me back. Call me back. Call me back...\"",
    phase: "The heads begin resolving out of order!",
    defeat: "Every pending callback fires at once — then silence. Unhandled? Handled.",
  },
  heisenbug: {
    intro: "\"You can see me or you can hit me. Not both.\"",
    phase: "It flickers. When you look away, it's somewhere else.",
    defeat: "Observed, isolated, reproduced. It was only ever a timing issue.",
  },
  golem: {
    intro: "\"I keep everything. Every object. Every reference. Forever.\"",
    phase: "\"FREE? I don't know that word!\"",
    defeat: "The Golem is garbage collected. Gigabytes of air rush back in.",
  },
  segfault: {
    intro: "\"Address 0x0. That's where you'll end up.\"",
    phase: "The dragon's eyes go red. Signal 11 crackles in the air.",
    defeat: "The dragon dumps one final core... and the build turns green.",
  },
};

export const ENDING: readonly string[] = [
  "The Segfault Dragon falls. Somewhere far above, a CI badge turns green.",
  "",
  "{name} drops the blunt object, sits down in the quiet of the Kernel Abyss,",
  "and for the first time in days, nothing is on fire.",
  "",
  "        ★  T H E   E N D  ★        ...?",
  "",
  "A low hum from above. The Endless Tower has opened. ;tower",
];

export function fill(lines: readonly string[] | string, name: string): string {
  const text = typeof lines === "string" ? lines : lines.join("\n");
  return text.replaceAll("{name}", name);
}
