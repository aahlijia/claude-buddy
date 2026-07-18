/**
 * ASCII art for all 18 buddy species
 *
 * Each species has 3 animation frames (idle variations).
 * Each frame is 5 lines, ~12 chars wide.
 * {E} is replaced with the eye character at render time.
 */

import type { Species, Eye, Hat, Rarity, StatName, BuddyBones } from "./engine.ts";
import { getRarityColor } from "./theme.ts";

// ─── Species art: 3 frames × 5 lines each ──────────────────────────────────

export const SPECIES_ART: Record<Species, string[][]> = {
  duck: [
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'    "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'~   "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  .__>  ", "    `--'    "],
    // stretch (design-sprite-animation-v2 §P7 pilot): row 0 blank (hat-safe),
    // row 3 col1 + row 4 col0 blank (GEAR_ANCHORS-safe).
    ["            ", "  ~ __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'  ~ "],
  ],
  goose: [
    ["            ", "     ({E}>    ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "    ({E}>     ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "     ({E}>>   ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
  ],
  blob: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (      )  ", "   `----'   "],
    ["            ", "  .------.  ", " (  {E}  {E}  ) ", " (        ) ", "  `------'  "],
    ["            ", "    .--.    ", "   ({E}  {E})   ", "   (    )   ", "    `--'    "],
  ],
  cat: [
    ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")   "],
    ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")~  "],
    ["            ", "   /\\-/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")   "],
    // stretch (design-sprite-animation-v2 \u00a7P7 pilot): row 0 blank (hat-safe),
    // row 3 col10 + row 4 col0 blank (GEAR_ANCHORS-safe).
    ["            ", "  >/\\_/\\<   ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")~  "],
  ],
  dragon: [
    ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-'  "],
    ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (        ) ", "  `-vvvv-'  "],
    ["   ~    ~   ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-'  "],
  ],
  octopus: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  \\/\\/\\/\\/  "],
    ["     o      ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
  ],
  owl: [
    ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   `----'   "],
    ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   .----.   "],
    ["            ", "   /\\  /\\   ", "  (({E})(-))  ", "  (  ><  )  ", "   `----'   "],
  ],
  penguin: [
    ["            ", "  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---'     "],
    ["            ", "  .---.     ", "  ({E}>{E})     ", " |(   )|    ", "  `---'     "],
    ["  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---'     ", "   ~ ~      "],
  ],
  turtle: [
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "  ``    ``  "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "   ``  ``   "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[======]\\ ", "  ``    ``  "],
  ],
  snail: [
    ["            ", " {E}    .--.  ", "  \\  ( @ )  ", "   \\_`--'   ", "  ~~~~~~~   "],
    ["            ", "  {E}   .--.  ", "  |  ( @ )  ", "   \\_`--'   ", "  ~~~~~~~   "],
    ["            ", " {E}    .--.  ", "  \\  ( @  ) ", "   \\_`--'   ", "   ~~~~~~   "],
  ],
  ghost: [
    ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~`~``~`~  "],
    ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  `~`~~`~`  "],
    ["    ~  ~    ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~~`~~`~~  "],
  ],
  axolotl: [
    ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  ( .--. )  ", "  (_/  \\_)  "],
    ["            ", "~}(______){~", "~}({E} .. {E}){~", "  ( .--. )  ", "  (_/  \\_)  "],
    ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  (  --  )  ", "  ~_/  \\_~  "],
  ],
  capybara: [
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------'  "],
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   Oo   ) ", "  `------'  "],
    ["    ~  ~    ", "  u______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------'  "],
  ],
  cactus: [
    ["            ", " n  ____  n ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
    ["            ", "    ____    ", " n |{E}  {E}| n ", " |_|    |_| ", "   |    |   "],
    [" n        n ", " |  ____  | ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
  ],
  robot: [
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'  "],
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ -==- ]  ", "  `------'  "],
    ["     *      ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'  "],
    // stretch (design-sprite-animation-v2 §P7 pilot): row 0 blank (hat-safe),
    // row 3 col10 + row 4 col0 blank (GEAR_ANCHORS-safe).
    ["            ", "   \\[||]/   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'* "],
  ],
  rabbit: [
    ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", "  (\")__(\")" ],
    ["            ", "   (|__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", "  (\")__(\")" ],
    ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =( .  . )= ", "  (\")__(\")" ],
  ],
  mushroom: [
    ["            ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
    ["            ", " .-O-oo-O-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
    ["   . o  .   ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
  ],
  chonk: [
    ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'  "],
    ["            ", "  /\\    /|  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'  "],
    ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'~ "],
  ],
  wyvern: [
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "   '-'"],
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "  \x1b[38;2;255;120;0m//|\\\\\x1b[0m"],
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "   'v'"],
  ],
  pikachu: [
    ["            ", "   /\\_/\\   ", "  ({E} {E})  ", "   (  ω )   ", "   (__)    "],
    ["            ", "   /\\_/\\   ", "   (- -)   ", "   (  ω )   ", "   (__)    "],
    ["            ", "   /\\_/\\   ", "  ({E} {E})  ", "   (  ~ )   ", "   (__)    "],
  ],
};

// ─── Hat art ────────────────────────────────────────────────────────────────

export const HAT_ART: Record<Hat, string> = {
  none:      "",
  crown:     "   \\^^^/    ",
  tophat:    "   [___]    ",
  propeller: "    -+-     ",
  halo:      "   (   )    ",
  wizard:    "    /^\\     ",
  beanie:    "   (___)    ",
  tinyduck:  "    ,>      ",
};

// Wyvern line 0 is `}       {` (7 inner chars between horns).
// These replace that line so the hat sits between the horns.
const WYVERN_HAT: Partial<Record<Hat, string>> = {
  crown:     "} \\^^^/ {",  // \^^^/ (5) centered in 7
  tophat:    "} [___] {",   // [___] (5) centered in 7
  propeller: "}  -+-  {",   // -+- (3) centered in 7
  halo:      "} (   ) {",   // (   ) (5) centered in 7
  wizard:    "}  /^\\  {",  // /^\ (3) centered in 7
  beanie:    "} (___) {",   // (___) (5) centered in 7
  tinyduck:  "}  ,>   {",   // ,> (2) slightly left of center
};

export function applyHat(species: Species, hat: Hat, art: string[]): void {
  if (hat === "none") return;
  if (species === "wyvern") {
    const wyvernLine = WYVERN_HAT[hat];
    if (wyvernLine) art[0] = wyvernLine;
  } else if (!art[0].trim()) {
    art[0] = HAT_ART[hat];
  }
}

// ─── Gear overlays (equipped weapon / trinket on the sprite) ─────────────────

/** Weapon/trinket glyphs to composite onto a rendered frame (see applyGear). */
export interface GearArt {
  weapon?: string;
  trinket?: string;
}

/**
 * Hand-tuned per-species anchor cells for gear glyphs, as `[row, col]` into the
 * *rendered* (eye-substituted) frame. `weapon` sits beside the body at hand
 * height so the glyph reads as held; `trinket` rests on the ground by the
 * buddy's feet. Every anchor is blank in all three idle frames of its species
 * (art.test.ts enforces this), so gear never flickers as the idle cycle plays.
 */
export const GEAR_ANCHORS: Record<
  Species,
  { weapon: [number, number]; trinket: [number, number] }
> = {
  duck:     { weapon: [3, 1],  trinket: [4, 0] }, // held at the chest (faces left)
  goose:    { weapon: [3, 10], trinket: [4, 0] }, // at the wing
  blob:     { weapon: [2, 11], trinket: [4, 0] }, // beside the widest (breathing) frame
  cat:      { weapon: [3, 10], trinket: [4, 0] },
  dragon:   { weapon: [3, 11], trinket: [4, 0] },
  octopus:  { weapon: [2, 11], trinket: [4, 0] }, // a tentacle-height hold
  owl:      { weapon: [3, 10], trinket: [4, 0] },
  penguin:  { weapon: [2, 9],  trinket: [4, 0] }, // clear of the frame-2 body shift
  turtle:   { weapon: [2, 10], trinket: [4, 0] },
  snail:    { weapon: [2, 1],  trinket: [4, 0] }, // by the eye stalk (faces left)
  ghost:    { weapon: [3, 10], trinket: [4, 0] },
  axolotl:  { weapon: [3, 10], trinket: [4, 0] }, // rows 1-2 are gills, full width
  capybara: { weapon: [2, 11], trinket: [4, 0] },
  cactus:   { weapon: [2, 11], trinket: [4, 0] }, // beside the arm pot
  robot:    { weapon: [3, 10], trinket: [4, 0] },
  rabbit:   { weapon: [2, 10], trinket: [4, 0] },
  mushroom: { weapon: [3, 9],  trinket: [4, 0] }, // by the stem, under the cap
  chonk:    { weapon: [2, 11], trinket: [4, 0] },
  wyvern:   { weapon: [3, 8],  trinket: [4, 9] }, // row 5 is the ANSI-fire tail — avoid
  pikachu:  { weapon: [3, 9],  trinket: [4, 0] },
};

/**
 * Write `glyph` into `art` at an anchor, padding the line rightward if the
 * anchor sits past its end. Skips (leaving the frame intact) when any target
 * cell holds a body pixel or the line carries ANSI — a shifted animation frame
 * must never be clobbered, and splicing into escape codes would corrupt them.
 */
function overlayGlyph(
  art: string[],
  anchor: readonly [number, number],
  glyph: string,
): void {
  const [row, col] = anchor;
  const line = art[row];
  if (line === undefined || line.includes("\x1b")) return;
  const cells = [...line];
  const glyphCells = [...glyph];
  while (cells.length < col + glyphCells.length) cells.push(" ");
  for (let i = 0; i < glyphCells.length; i++) {
    if (cells[col + i] !== " ") return;
  }
  cells.splice(col, glyphCells.length, ...glyphCells);
  art[row] = cells.join("");
}

/** Composite equipped-gear glyphs onto a rendered frame at the species' anchors. */
export function applyGear(
  species: Species,
  art: string[],
  gear?: GearArt,
): void {
  if (!gear) return;
  const anchors = GEAR_ANCHORS[species];
  if (gear.weapon) overlayGlyph(art, anchors.weapon, gear.weapon);
  if (gear.trinket) overlayGlyph(art, anchors.trinket, gear.trinket);
}

const SHINY_COLOR = "\x1b[93m"; // bright yellow
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

export const RARITY_STARS: Record<Rarity, string> = {
  common: "\u2605",
  uncommon: "\u2605\u2605",
  rare: "\u2605\u2605\u2605",
  epic: "\u2605\u2605\u2605\u2605",
  legendary: "\u2605\u2605\u2605\u2605\u2605",
};

// ─── Display width helpers ──────────────────────────────────────────────────

function stripAnsi(s: string): string { return s.replace(/\x1b\[[^m]*m/g, ""); }

// Unicode property escapes (ES2018) are the source of truth for which
// codepoints terminals render 2 cols wide. The statusline (bash) can't use
// these directly, so scripts/gen-emoji-widths.ts exports the subset that
// bash needs into statusline/emoji-widths.data — regenerate on version bumps.
const EMOJI_PRES_RE = /\p{Emoji_Presentation}/u;
const EMOJI_RE = /\p{Emoji}/u;

// Precondition: ch is neither a variation selector (U+FE00-U+FE0F) nor ZWJ
// (U+200D); displayWidth filters those before calling in.
function charWidth(ch: string): number {
  if (EMOJI_PRES_RE.test(ch)) return 2;
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x2500 && cp <= 0x259F) return 1;
  if (cp >= 0x3000 && cp <= 0x9FFF) return 2;
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  return 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  let upgradable = false;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xFE0F) {
      // VS16 forces emoji presentation on the previous codepoint; upgrade
      // its width from 1 to 2 if it was narrow-but-emoji (e.g. ❤ + VS16).
      if (upgradable) { w += 1; upgradable = false; }
      continue;
    }
    if ((cp >= 0xFE00 && cp <= 0xFE0E) || cp === 0x200D) {
      upgradable = false;
      continue;
    }
    const cw = charWidth(ch);
    w += cw;
    upgradable = cw === 1 && EMOJI_RE.test(ch);
  }
  return w;
}

/** Pad string with spaces to reach target display width */
function dpad(s: string, targetW: number): string {
  const w = displayWidth(s);
  return w < targetW ? s + " ".repeat(targetW - w) : s;
}

// ─── Render functions ───────────────────────────────────────────────────────

export function getArtFrame(species: Species, eye: Eye, frame: number = 0): string[] {
  const frames = SPECIES_ART[species];
  const f = frames[frame % frames.length];
  return f.map((line) => line.replace(/\{E\}/g, eye));
}

/**
 * The row index of a species' eyes within its raw art frame — the first line
 * carrying the `{E}` placeholder.
 *
 * Drives the two-sprite combat-scene clash alignment (idle-RPG Phase 5) so the
 * sword lands on the eye row regardless of where a species wears its face: most
 * are centered (row 2 of 5), but goose/snail sit on row 1, mushroom on row 3,
 * and wyvern's body spans 6 lines — `length/2` is wrong for all of these. Falls
 * back to the vertical center if a species somehow has no placeholder. Pure.
 */
export function eyeRowIndex(species: Species, frame: number = 0): number {
  const frames = SPECIES_ART[species];
  const f = frames[frame % frames.length];
  const idx = f.findIndex((line) => line.includes("{E}"));
  return idx >= 0 ? idx : Math.floor(f.length / 2);
}

// ─── Frame geometry (idle-RPG Phase 5: two-sprite combat scene) ──────────────

/** Directional glyphs swapped when a sprite is mirrored, so the flipped art
 *  still reads as a creature facing the other way. Symmetric glyphs
 *  (`| _ ^ ~ . ' = ω` …) are absent and pass through unchanged. */
const MIRROR_SWAP: Readonly<Record<string, string>> = {
  "(": ")",
  ")": "(",
  "<": ">",
  ">": "<",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "/": "\\",
  "\\": "/",
};

/** Right-pad every line of a frame to the frame's max display width, yielding a
 *  rectangular block. Pure. */
export function rectFrame(lines: string[]): string[] {
  const w = lines.reduce((m, l) => Math.max(m, displayWidth(l)), 0);
  return lines.map((l) => dpad(l, w));
}

/**
 * Mirror a rendered frame left↔right so a creature faces the opposite way.
 *
 * Rectangularizes first (square bounding box), reverses each line **by code
 * point** (surrogate-pair safe), then swaps directional glyphs. Pure.
 *
 * Intended for the curated 5-line, ANSI-free roster (`bugs.ts` excludes
 * `wyvern`/`pikachu`): ANSI escapes would reverse into garbage.
 *
 * @param lines: A rendered (eye-substituted, ANSI-free) frame.
 * @returns The mirrored frame, every line equal display width.
 */
export function mirrorFrame(lines: string[]): string[] {
  return rectFrame(lines).map((line) =>
    [...line]
      .reverse()
      .map((ch) => MIRROR_SWAP[ch] ?? ch)
      .join(""),
  );
}

/**
 * A full-width row carrying `text` centered over one span of a wider block.
 *
 * Span-addressed rather than sprite-addressed, so both the two-sprite combat
 * scene (centering a damage pop over the player's or the enemy's column span)
 * and the single-sprite idle line (centering an emote over the buddy) share one
 * implementation. `null` text ⇒ an all-space row of the full width: when a
 * flipbook uses an overlay at all, EVERY frame must carry one so the frame
 * height stays constant across the loop. Pure.
 *
 * @param text: The glyph(s) to center, or null for a blank row.
 * @param spanStart: Column where the span to center over begins.
 * @param spanW: Display width of that span.
 * @param totalW: Display width of the whole row.
 * @returns The composed row, exactly `totalW` display cells wide.
 */
export function overlayRow(
  text: string | null,
  spanStart: number,
  spanW: number,
  totalW: number,
): string {
  if (!text) return " ".repeat(totalW);
  const w = displayWidth(text);
  const centered = spanStart + Math.floor((spanW - w) / 2);
  const col = Math.max(0, Math.min(centered, totalW - w));
  return " ".repeat(col) + text + " ".repeat(Math.max(0, totalW - col - w));
}

/**
 * Drop top rows that NO frame of ANY co-present flipbook uses, applying one
 * shared drop set to all of them.
 *
 * Optional rows collect above a sprite: the species art reserves its row 0 for
 * the hat (`applyHat` fills it only when one is worn) and callers may unshift an
 * FX row (damage pop, idle emote) above that. Unused, they render as dead space
 * — pure waste in a status line where vertical room is the scarcest thing there
 * is.
 *
 * Three properties keep this safe:
 *
 * - Only rows blank in *every* frame go, so a row any frame needs (a hat, a
 *   bout's `✗ -N`) is kept for the whole loop.
 * - The same rows are dropped from every frame, so the constant-height /
 *   no-jitter guarantee the cycler depends on still holds.
 * - The scan stops at the first row every frame uses — the top of the sprite
 *   bodies — so an intentional blank row *inside* a sprite is never reachable,
 *   no matter what art is added later.
 *
 * Taking *all* co-present flipbooks at once is what extends that guarantee
 * across a frame-source swap: `buddy-status.sh` picks idle or flourish frames
 * per tick off `$celeb_fresh`, so trimming them independently would let a
 * celebration change the line's height mid-loop (they use different art frames,
 * hence different rows). Every flipbook passed must start at the same height.
 *
 * "Blank" means blank of content: a pop's ANSI bytes survive `.trim()`, so an
 * FX row is never mistaken for an empty one.
 *
 * @param flipbooks: The co-present flipbooks, each an array of `\n`-joined
 *     frames, all of equal height. Empty flipbooks are ignored and passed back
 *     through.
 * @returns The flipbooks in the same order, each with the shared drop applied.
 */
export function trimSharedBlankTopRows(flipbooks: string[][]): string[][] {
  const split = flipbooks.map((fb) => fb.map((f) => f.split("\n")));
  const all = split.flat();
  const height = all[0]?.length ?? 0;
  const drop = new Set<number>();
  // Stop short of the last row: a block always keeps at least one.
  for (let i = 0; i < height - 1; i++) {
    if (!all.some((r) => r[i]?.trim())) drop.add(i); // used by no frame ⇒ dead
    else if (all.every((r) => r[i]?.trim())) break; // sprite bodies start here
  }
  if (drop.size === 0) return flipbooks;
  return split.map((fb) =>
    fb.map((r) => r.filter((_, i) => !drop.has(i)).join("\n")),
  );
}

/** Single-flipbook `trimSharedBlankTopRows`. */
export function trimBlankTopRows(frames: string[]): string[] {
  return trimSharedBlankTopRows([frames])[0];
}

// Original 15-tick cycle [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0]: -1 (blink) becomes
// index 3 in the pre-baked frames array. Extended to 18 ticks
// (design-sprite-animation-v2 §P6) with a glance (index 4) placed well clear
// of the blink so the two never read as the same beat.
export const STATUS_FRAME_SEQUENCE: readonly number[] = [
  0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 0,
];

// Used only by species with a 4th raw art frame (design-sprite-animation-v2
// §P7 pilot: duck/cat/robot) — one extra beat (index 5) near the end of the
// loop, the rarest state since it's the most novel pose. Every other species
// gets the base sequence above; `getStatusFrames` picks between the two based
// on `SPECIES_ART[species].length`, not a global flag.
export const STATUS_FRAME_SEQUENCE_STRETCH: readonly number[] = [
  0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 5, 0, 0, 0,
];

// Pre-resolves eye, hat overlay, and blink so the statusline shell does no art
// work — it just cycles whatever frames the server writes. Each frame is a
// \n-joined 5-line string (one jq call + mapfile in bash).
// ─── Emotion animations (game-feel FR-A4) ───────────────────────────────────
//
// Derived at render time from existing species art by eye substitution + a
// short micro-cycle — no new per-species frame data, all species covered. The
// emotion owns the eyes; "neutral" is the unchanged 4-frame idle cycle.

export type Emotion = "happy" | "angry" | "bored" | "surprised" | "neutral";

const EMOTION_EYE: Record<Exclude<Emotion, "neutral">, string> = {
  happy: "^",
  angry: ">",
  bored: "-",
  surprised: "O",
};

/** The idle FX row's glyph, mirroring `EMOTION_EYE` one-for-one: the row
 *  visualizes what the eyes already say, so it needs no signal of its own.
 *  Neutral ⇒ null ⇒ a blank row, which `trimSharedBlankTopRows` then reclaims,
 *  leaving a resting buddy exactly as tall as it would be without the feature. */
const EMOTION_EMOTE: Record<Exclude<Emotion, "neutral">, string> = {
  happy: "♪", // ♪
  angry: "!",
  bored: "zZz",
  surprised: "?",
};

/** The emote glyph for an emotion, or null when neutral. Pure. */
export function emoteFor(emotion: Emotion): string | null {
  return emotion === "neutral" ? null : EMOTION_EMOTE[emotion];
}

// 2 sub-frames (art frames 0/1) on a gentle 6-tick oscillation.
const EMOTION_FRAME_SEQUENCE: readonly number[] = [0, 0, 0, 1, 1, 1];

/**
 * Render one species art frame with a given eye glyph substituted in.
 *
 * Shared by the idle/emotion cycle and the ascension flourish so they apply
 * identical eye + hat (incl. seasonal overlay) substitution. Pure — the date is
 * resolved by the caller via `seasonalHat`, keeping this testable.
 *
 * @param bones: The buddy's bones (species + hat).
 * @param frameIdx: Index into the species' art frames.
 * @param eye: The glyph to substitute for the `{E}` eye placeholder.
 * @param seasonalHat: Optional seasonal hat to overlay when the hat slot is
 *     empty (never clobbers a user-equipped hat).
 * @param gear: Optional equipped-gear glyphs composited at the species'
 *     anchors (weapon held beside the body, trinket at the feet).
 * @returns The rendered frame as a newline-joined string.
 */
export function renderSpeciesFrame(
  bones: BuddyBones,
  frameIdx: number,
  eye: string,
  seasonalHat?: Hat,
  gear?: GearArt,
): string {
  const raw = SPECIES_ART[bones.species][frameIdx];
  const art = raw.map((line) => line.replace(/\{E\}/g, eye));
  // Seasonal cosmetic (FR-C2): only when the hat slot is empty. applyHat is
  // the single hat renderer (shared with the card path) — it knows the wyvern's
  // between-the-horns placement, so wyvern hats show on the status line too.
  const hat = bones.hat !== "none" ? bones.hat : seasonalHat ?? "none";
  applyHat(bones.species, hat, art);
  applyGear(bones.species, art, gear);
  return art.join("\n");
}

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
  const resolveFrame = (frameIdx: number, eye: string): string =>
    renderSpeciesFrame(bones, frameIdx, eye, seasonalHat, gear);

  // Append lean/peek as eye-substituted postures for the walk's edge/home beats,
  // keeping existing indices stable. Lean is "~" (strained lean-out) because ">"
  // collides with the angry emotion eye and the pose must stay visible mid-gait
  // for every emotion.
  const withGait = (
    r: { frames: string[]; frameSequence: number[] },
  ): ReturnType<typeof getStatusFrames> => {
    if (!gaitVariants) return r;
    const lean = r.frames.length;
    return {
      ...r,
      frames: [...r.frames, resolveFrame(0, "~"), resolveFrame(0, "<")],
      gaitIdx: { bob: 1, lean, peek: lean + 1 },
    };
  };

  // Emotion: swap in the emotion's eye and run a 2-frame micro-cycle.
  if (emotion !== "neutral") {
    const eye = EMOTION_EYE[emotion];
    return withGait({
      frames: [resolveFrame(0, eye), resolveFrame(1, eye)],
      frameSequence: [...EMOTION_FRAME_SEQUENCE],
    });
  }

  // Neutral: the original idle cycle (game-feel R3) plus a rare glance
  // (design-sprite-animation-v2 §P6) — frame 0 with a distinct eye glyph, the
  // same derivation blink already uses, so it's unconditionally safe across
  // every species (all carry `{E}` on frame 0) with zero new art.
  const hasStretch = SPECIES_ART[bones.species].length > 3;
  return withGait({
    frames: [
      resolveFrame(0, bones.eye),
      resolveFrame(1, bones.eye),
      resolveFrame(2, bones.eye),
      resolveFrame(0, "-"), // 3: blink
      resolveFrame(0, "'"), // 4: glance
      ...(hasStretch ? [resolveFrame(3, bones.eye)] : []), // 5: stretch (pilot species)
    ],
    frameSequence: [
      ...(hasStretch ? STATUS_FRAME_SEQUENCE_STRETCH : STATUS_FRAME_SEQUENCE),
    ],
  });
}

/** The widest display row across a set of flipbooks — the sprite block's width,
 *  which the FX row spans. Species art is nominally 12 cells, but some frames
 *  are ragged (wyvern's rows differ), so this measures rather than assumes. */
function blockWidth(flipbooks: string[][]): number {
  let w = 0;
  for (const fb of flipbooks) {
    for (const f of fb) {
      for (const line of f.split("\n")) w = Math.max(w, displayWidth(line));
    }
  }
  return w;
}

/**
 * Finalize the idle sprite block: unshift the emote FX row and reclaim every
 * dead row above the sprite, across the idle and flourish flipbooks *together*.
 *
 * Both must be processed in one pass. `buddy-status.sh` picks its frame source
 * per tick (`combat > flourish while a celebration is fresh > idle`), so the two
 * flipbooks are co-present in one `status.json` and swap within seconds. They
 * use different art frames — idle cycles 0/1/2 plus a blink, flourish only 0/1
 * — so trimming them independently yields different drop sets and the line would
 * visibly jump a row the moment a celebration fired. One shared drop set over
 * the union is what keeps the swap seamless.
 *
 * Order matters: **trim first, then unshift.** Unlike combat's damage pop —
 * which is blank on the loop's calm frames — the idle emote is constant across
 * every frame it appears in, so an FX row added *before* the trim would satisfy
 * the "row every frame uses" test and break the scan on row 0, stranding the
 * dead row beneath it. Trimming the bare sprite blocks first gives the scan the
 * same input shape combat gives it, and the FX row then rides on top.
 *
 * The row is added to **both** flipbooks (blank on flourish, which stays bare by
 * design) so the shared height survives a celebration swap. A neutral buddy gets
 * no row at all, so it ends up one row *shorter* than before this existed.
 *
 * @param idle: The idle flipbook from `getStatusFrames`.
 * @param flourish: The co-present flourish flipbook, if one was baked.
 * @param emote: The idle emote glyph (`emoteFor`), or null when neutral.
 * @returns Both flipbooks, same order, sharing one height.
 */
export function finalizeIdleBlock(
  idle: string[],
  flourish: string[] | undefined,
  emote: string | null,
): { idle: string[]; flourish?: string[] } {
  const fl = flourish ?? [];
  const [tIdle, tFl] = trimSharedBlankTopRows([idle, fl]);
  const pack = (i: string[], f: string[]): { idle: string[]; flourish?: string[] } =>
    flourish ? { idle: i, flourish: f } : { idle: i };
  if (!emote) return pack(tIdle, tFl);
  const w = blockWidth([tIdle, tFl]);
  const add = (frames: string[], text: string | null): string[] => {
    const row = overlayRow(text, 0, w, w);
    return frames.map((f) => `${row}\n${f}`);
  };
  return pack(add(tIdle, emote), add(tFl, null));
}

// ─── Ascension frame flourish (game-feel FR-A3; per-kind since round 2) ──────

/** Mirrors `state.ts`'s `CelebrationKind` — canonical here since flourish is
 *  the only consumer that varies by kind; `state.ts` re-exports it so every
 *  other call site is unaffected. */
export type CelebrationKind =
  | "levelup"
  | "loot"
  | "ascension"
  | "whim"
  | "discovery"
  | "shiny"
  | "statup";

interface FlourishCycle {
  eyes: readonly string[];
  frameSequence: readonly number[];
}

/**
 * Per-kind celebratory eye cycles (design-sprite-animation-v2 §P5), reusing
 * the FR-A4 eye-substitution machinery so none of them need new per-species
 * art. `ascension` is the original round-1 cycle, unchanged — still the
 * biggest. The common cases (levelup/loot/whim) are new: shorter, quieter
 * bobs that read as a beat rather than a scene. `discovery` stays minimal by
 * design (a one-time system message, not a buddy performance).
 */
const FLOURISH_BY_KIND: Record<CelebrationKind, FlourishCycle> = {
  ascension: { eyes: ["^", "O", "*", "^"], frameSequence: [0, 1, 2, 3, 2, 1] },
  shiny: { eyes: ["*", "^", "*", "^"], frameSequence: [0, 1, 2, 3, 2, 1] },
  levelup: { eyes: ["^", "*", "^"], frameSequence: [0, 1, 2, 1] },
  loot: { eyes: ["^", "^"], frameSequence: [0, 1] },
  whim: { eyes: ["^", "-", "^"], frameSequence: [0, 1, 2, 1] },
  discovery: { eyes: ["^", "^"], frameSequence: [0, 1] },
  // A stat crossing a whole point (stats-leveling-v2 §P4): a quick, quiet
  // proud bob — the smallest celebration, matching how often it fires.
  statup: { eyes: ["^", "-", "^"], frameSequence: [0, 1, 2] },
};

/**
 * A short, celebratory animation cycle for any species (game-feel FR-A3,
 * flavored per `CelebrationKind` since round 2).
 *
 * Produced as a *separate* frame set from the neutral idle frames so the
 * status line can animate it only while the celebration is fresh, then fall
 * back to the co-present neutral `frames`. No new per-species art — each
 * flourish frame is the species body with a celebratory eye glyph and a
 * one-step body bob.
 *
 * @param bones: The buddy's bones (species + hat).
 * @param kind: Which celebration this flourish belongs to. Defaults to
 *     `ascension` (round 1's only caller) so existing call sites are
 *     unaffected.
 * @returns The flourish frames and their playback sequence.
 */
export function flourishFrames(
  bones: BuddyBones,
  kind: CelebrationKind = "ascension",
): {
  frames: string[];
  frameSequence: number[];
} {
  const cycle = FLOURISH_BY_KIND[kind];
  return {
    frames: cycle.eyes.map((eye, i) => renderSpeciesFrame(bones, i % 2, eye)),
    frameSequence: [...cycle.frameSequence],
  };
}

// ─── Buddy growth / age tell (game-feel FR-C3) ───────────────────────────────

/** A purely cosmetic glyph keyed to days-since-hatch. Visual only, no stats. */
export function ageTell(hatchedAt: number, now: number = Date.now()): string {
  const days = Math.floor((now - hatchedAt) / 86_400_000);
  if (days >= 30) return "\u{1F333}"; // 🌳 mature
  if (days >= 7) return "\u{1F33F}"; // 🌿 growing
  return "\u{1F331}"; // 🌱 sprout
}

// ─── Seasonal cosmetics (game-feel FR-C2) ────────────────────────────────────

export interface SeasonalCosmetic {
  hat?: Hat;
  /** Inclusive window as [month, day] (local). */
  from: [number, number];
  to: [number, number];
  label: string;
}

/** A small, deliberately-tiny calendar (dated content is a maintenance tail). */
export const SEASONAL: SeasonalCosmetic[] = [
  { hat: "beanie", from: [12, 20], to: [12, 31], label: "winter" },
  { hat: "beanie", from: [1, 1], to: [1, 2], label: "new-year" },
];

/** The active seasonal cosmetic for a date, or null. Pure (date injected). */
export function activeSeasonal(now: Date = new Date()): SeasonalCosmetic | null {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const cmp = (am: number, ad: number, bm: number, bd: number): number =>
    am !== bm ? am - bm : ad - bd;
  for (const s of SEASONAL) {
    const afterFrom = cmp(m, d, s.from[0], s.from[1]) >= 0;
    const beforeTo = cmp(m, d, s.to[0], s.to[1]) <= 0;
    const wraps = cmp(s.from[0], s.from[1], s.to[0], s.to[1]) > 0;
    if (wraps ? afterFrom || beforeTo : afterFrom && beforeTo) return s;
  }
  return null;
}

export function renderCompanionCard(
  bones: BuddyBones,
  name: string,
  personality: string,
  reaction?: string,
  frame: number = 0,
  width: number = 40,
  gear?: GearArt,
): string {
  const color = getRarityColor(bones.rarity);
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? `${SHINY_COLOR}\u2728 ${NC}` : "";
  const art = getArtFrame(bones.species, bones.eye, frame);
  applyHat(bones.species, bones.hat, art);
  applyGear(bones.species, art, gear);

  // Build the card
  const W = Math.max(24, width);
  const hr = "\u2500".repeat(W - 2);
  const lines: string[] = [];

  // Top border
  lines.push(`${color}\u256d${hr}\u256e${NC}`);

  // Inner width = W - 2 (borders), content area = W - 4 (borders + padding)
  const innerW = W - 4;

  // Species art (centered)
  for (const artLine of art) {
    if (!artLine.trim()) continue;
    lines.push(`${color}\u2502${NC}  ${dpad(artLine, innerW)}${color}\u2502${NC}`);
  }

  // Separator
  lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);

  // Name + rarity
  const nameStarsRaw = `${BOLD}${name}${NC}  ${color}${stars}${NC}`;
  lines.push(`${color}\u2502${NC}  ${nameStarsRaw}${" ".repeat(Math.max(0, innerW - displayWidth(name) - 2 - displayWidth(stars)))}${color}\u2502${NC}`);

  const rarityRaw = `${shiny}${color}${BOLD}${bones.rarity.toUpperCase()}${NC} ${bones.species}`;
  const rarityVis = (bones.shiny ? 3 : 0) + bones.rarity.length + 1 + bones.species.length;
  lines.push(`${color}\u2502${NC}  ${rarityRaw}${" ".repeat(Math.max(0, innerW - rarityVis))}${color}\u2502${NC}`);

  // Eye + Hat info
  const cosmeticLine = `eye: ${bones.eye}  hat: ${bones.hat}`;
  lines.push(`${color}\u2502${NC}  ${DIM}${cosmeticLine}${NC}${" ".repeat(Math.max(0, innerW - displayWidth(cosmeticLine)))}${color}\u2502${NC}`);

  // Separator
  lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);

  // Stats
  const STAT_NAMES: StatName[] = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
  for (const stat of STAT_NAMES) {
    const val = bones.stats[stat];
    const filled = Math.round(val / 10);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
    const label = stat.slice(0, 3).padEnd(3);
    const marker = stat === bones.peak ? " \u25b2" : stat === bones.dump ? " \u25bc" : "  ";
    const valStr = String(val).padStart(3);
    const statLine = `${DIM}${label}${NC} ${bar} ${valStr}${marker}`;
    const statVis = 3 + 1 + 10 + 1 + 3 + 2; // label + spaces + bar + val + marker = 20
    lines.push(`${color}\u2502${NC}  ${statLine}${" ".repeat(Math.max(0, innerW - statVis))}${color}\u2502${NC}`);
  }

  // Speech bubble (if reaction)
  if (reaction) {
    lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);
    const maxMsg = innerW - 3; // "💬 " prefix (💬 = 2 cols + space)
    const msg = displayWidth(reaction) > maxMsg ? reaction.slice(0, maxMsg - 1) + "\u2026" : reaction;
    const msgPad = Math.max(0, innerW - displayWidth(msg) - 3);
    lines.push(`${color}\u2502${NC}  \ud83d\udcac ${msg}${" ".repeat(msgPad)}${color}\u2502${NC}`);
  }

  // Personality
  if (personality) {
    lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);
    const words = personality.split(" ");
    let line = "";
    for (const word of words) {
      if (displayWidth(line) + displayWidth(word) + 1 > innerW) {
        lines.push(`${color}\u2502${NC}  ${DIM}${dpad(line, innerW)}${NC}${color}\u2502${NC}`);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) {
      lines.push(`${color}\u2502${NC}  ${DIM}${dpad(line, innerW)}${NC}${color}\u2502${NC}`);
    }
  }

  // Bottom border
  lines.push(`${color}\u2570${hr}\u256f${NC}`);

  return lines.join("\n");
}

// ─── Markdown-native render (for MCP tool responses) ───────────────────────
//
// Claude Code's UI doesn't render raw ANSI escape codes properly — it strips
// the ESC byte but leaves "[38;2;...m" as literal text, making the output
// unreadable. This renderer produces pure markdown with unicode rarity dots
// instead of ANSI colors, so it renders cleanly in any MCP client UI.

const RARITY_DOT: Record<Rarity, string> = {
  common:    "\u26AA",  // ⚪ white circle
  uncommon:  "\uD83D\uDFE2",  // 🟢 green circle
  rare:      "\uD83D\uDD35",  // 🔵 blue circle
  epic:      "\uD83D\uDFE3",  // 🟣 purple circle
  legendary: "\uD83D\uDFE1",  // 🟡 yellow circle
};

export function renderCompanionCardMarkdown(
  bones: BuddyBones,
  name: string,
  personality: string,
  reaction?: string,
  frame: number = 0,
  gear?: GearArt,
): string {
  const dot = RARITY_DOT[bones.rarity];
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? " \u2728" : "";
  const art = getArtFrame(bones.species, bones.eye, frame);
  applyHat(bones.species, bones.hat, art);
  applyGear(bones.species, art, gear);

  // Strip empty lines from art for cleaner rendering
  const artLines = art.filter((l) => l.trim().length > 0);

  const STAT_NAMES: StatName[] = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
  const statRows = STAT_NAMES.map((stat) => {
    const val = bones.stats[stat];
    const filled = Math.round(val / 10);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
    const marker = stat === bones.peak ? " \u25B2" : stat === bones.dump ? " \u25BC" : "";
    const label = `**${stat.slice(0, 3)}**${stat.slice(3)}`;
    return `| ${label} | ${val}${marker} | \`${bar}\` |`;
  }).join("\n");

  const parts: string[] = [];

  // Header: rarity dot, name, species+rarity, stars, shiny
  parts.push(`### ${dot} ${name} · \`${bones.rarity.toUpperCase()} ${bones.species}\` · ${stars}${shiny}`);
  parts.push("");

  // ASCII art in a code block (preserves monospaced formatting)
  parts.push("```");
  parts.push(artLines.join("\n"));
  parts.push("```");
  parts.push("");

  // Identity line
  parts.push(`**Identity:** eye \`${bones.eye}\` · hat \`${bones.hat}\``);
  parts.push("");

  // Stats table
  parts.push("| Stat | Value | Bar |");
  parts.push("|---|---|---|");
  parts.push(statRows);
  parts.push("");

  // Reaction (if any) — reactions often already contain asterisks
  // for actions like "*blinks slowly*", so render them verbatim to avoid
  // accidentally turning italics into bold.
  if (reaction) {
    parts.push(`\ud83d\udcac ${reaction}`);
    parts.push("");
  }

  // Personality as blockquote
  if (personality) {
    parts.push(`> ${personality}`);
  }

  return parts.join("\n");
}

// ─── Compact status line render ─────────────────────────────────────────────

export function renderStatusLine(
  bones: BuddyBones,
  name: string,
  reaction?: string,
): string {
  const face = SPECIES_ART[bones.species][0][2]?.replace(/\{E\}/g, bones.eye).trim() || "(?)";
  const color = getRarityColor(bones.rarity);
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? "\u2728" : "";
  const msg = reaction ? ` \u2502 "${reaction}"` : "";
  return `${color}${face}${NC} ${BOLD}${name}${NC} ${shiny}${color}${stars}${NC}${msg}`;
}
