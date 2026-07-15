/**
 * Auto-idle combat for the idle-RPG layer (design-rpg Phase 3).
 *
 * `resolveCombat` is pure & deterministic: given the buddy, a bug, the equipped
 * loadout, and a seed, it returns the outcome, a baked frame flipbook, and a
 * drop spec — no I/O, no clock. The buddy never dies; the worst case is `flee`.
 *
 * The thin I/O wrappers (`applyCombatDrops`, `writeEncounter`, `readEncounter`)
 * persist the durable rewards and the transient encounter side-channel
 * (`encounter.json`, mirroring loot's `lastDrop`). The status-line *rendering*
 * of the baked frames is Phase 4.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "fs";
import { basename, join } from "path";

import {
  RARITY_WEIGHTS,
  mulberry32,
  type BuddyBones,
  type Species,
  type Eye,
  type Hat,
} from "./engine";
import {
  getArtFrame,
  mirrorFrame,
  rectFrame,
  displayWidth,
  eyeRowIndex,
  applyGear,
  applyHat,
  type GearArt,
} from "./art";
import { buddyStateDir } from "./path";
import { gearArtOf, resolveAppearance } from "./equipment";
import { ITEMS, findItem, type Equipment, type ItemId } from "./items";
import { grantBonusPoints, grantItem, type UpgradeEffect } from "./xp";
import type { Bug, BugId, BugTier } from "./bugs";

// ─── Tunable win curve (design-rpg-phase3 OQ-P3.4) ────────────────────────────

/** Base win probability before stat/gear/tier adjustments. */
export const WIN_BASE = 0.5;
/** Each bug tier above 1 subtracts this much win probability. */
export const TIER_STEP = 0.15;
/** Flat bonus for having any weapon equipped (on top of its stat effect). */
export const WEAPON_PRESENCE_BONUS = 0.05;
/** Win-probability floor/ceiling — a fight is never certain either way. */
export const WIN_FLOOR = 0.05;
export const WIN_CEIL = 0.98;
/** Per-tier chance of an item drop on a win. */
export const ITEM_DROP_PER_TIER = 0.1;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Outcome = "win" | "flee";

export interface DropSpec {
  /** Skill points granted on a win (0 on flee). */
  points: number;
  /** Optional item id dropped on a win. */
  itemId?: ItemId;
}

export interface CombatResult {
  outcome: Outcome;
  /** Baked fight flipbook — Phase 4 cycles these. */
  frames: string[];
  /** Playback indices (NOW % len). */
  sequence: number[];
  /** The bug's glyph, placed in the margin by Phase 4. */
  enemyGlyph: string;
  drop: DropSpec;
  /** One-line celebration text for the toast. */
  summary: string;
}

export interface EncounterRecord {
  frames: string[];
  sequence: number[];
  enemyGlyph: string;
  at: number; // Date.now() — TTL freshness, like loot's lastDrop.at
  /** Project the fight belongs to (hook cwd basename). Encounter state is
   *  global, so the scene shows in every instance's status line — the caption
   *  "Bug fight in <project>!" says where it came from. Absent on records
   *  written before the field existed. */
  project?: string;
}

/**
 * The persistent pre-fight standoff (design-pending-encounter §3.1). A separate
 * side-channel from `encounter.json` so the resolved phase's 10s TTL contract
 * and every existing `readEncounter` test stay untouched. Unlike an encounter
 * there is **no TTL** — the standoff lives until a commit resolves it.
 */
export interface PendingEncounter {
  /** Pinned enemy identity — the bug sighted is the bug fought (G4). */
  bugId: BugId;
  /** Tier at the last (re)bake — the escalation watermark (G3). */
  tier: BugTier;
  /** Baked standoff flipbook (2 poses). */
  frames: string[];
  /** Playback indices, e.g. [0, 0, 0, 1] — mostly ready, an occasional glare. */
  sequence: number[];
  /** Date.now() of the first sighting (display/debug). */
  sightedAt: number;
  /** The session snapshot `startedAt` that spawned it — staleness guard (§5.3). */
  startedAt: number;
  /** Project the standoff belongs to (hook cwd basename) — see
   *  `EncounterRecord.project`. Absent on records written before the field. */
  project?: string;
}

// ─── Win odds ─────────────────────────────────────────────────────────────────

/**
 * Win probability from the buddy's effective DEBUGGING (which already folds in a
 * weapon's stat effect), a flat bonus for having a weapon equipped, and the bug
 * tier. Clamped so no fight is ever a foregone conclusion.
 */
export function winChance(
  effectiveDebug: number,
  weaponEquipped: boolean,
  tier: number,
): number {
  const p =
    WIN_BASE +
    effectiveDebug / 200 +
    (weaponEquipped ? WEAPON_PRESENCE_BONUS : 0) -
    (tier - 1) * TIER_STEP;
  return Math.max(WIN_FLOOR, Math.min(WIN_CEIL, p));
}

// ─── Scene baking (design-rpg Phase 5: two-sprite combat scene) ──────────────

/** Display cols between the player and the mirrored enemy. The strike clash
 *  lives here on the eye row; width is constant across the flipbook. */
const SCENE_GAP = 4;
/** Default resting eye for an enemy that didn't specify one. */
const DEFAULT_ENEMY_EYE = "×" as Eye; // ×
/** Default swing glyph when no weapon is equipped (player blade leans right). */
const DEFAULT_SWORD = "/";

const asEye = (e: string): Eye => e as Eye;

/** Stack two rectangular frames to a common height, bottom-aligned; the shorter
 *  is top-padded with blank lines of its own width so the "ground" rows line up. */
function alignHeights(a: string[], b: string[]): [string[], string[]] {
  const h = Math.max(a.length, b.length);
  const wa = a.length ? displayWidth(a[0]) : 0;
  const wb = b.length ? displayWidth(b[0]) : 0;
  const pad = (f: string[], w: number): string[] => [
    ...Array<string>(h - f.length).fill(" ".repeat(w)),
    ...f,
  ];
  return [pad(a, wa), pad(b, wb)];
}

/** A single-display-width swing glyph: the weapon's art if it's a printable
 *  ASCII char (keeps the scene width deterministic), else the default blade. */
function swingGlyph(weaponArt: string): string {
  const ch = [...weaponArt][0];
  if (ch && ch.charCodeAt(0) >= 0x21 && ch.charCodeAt(0) <= 0x7e) return ch;
  return DEFAULT_SWORD;
}

/** Build the GAP column for one scene row: blank, except the eye row on a strike
 *  frame, where the two blades clash (player's leans right, enemy's mirrors).
 *  `width` shrinks below SCENE_GAP while a bout attacker occupies part of the
 *  gap (design-attack-animation §4.1); strike frames always use the full gap. */
function gapRow(
  strike: boolean,
  isEyeRow: boolean,
  sword: string,
  width: number = SCENE_GAP,
): string {
  if (!strike || !isEyeRow) return " ".repeat(width);
  const swordP = sword;
  const swordE = mirrorFrame([sword])[0]; // "/" → "\", etc.
  // Center the clash in the gap: " " + P + E + " " (SCENE_GAP === 4).
  return ` ${swordP}${swordE} `.slice(0, width).padEnd(width);
}

interface Pose {
  pEye: Eye;
  eEye: Eye;
  strike: boolean;
}

/**
 * The player's resolved cosmetics for a scene: worn hat + equipped-gear
 * overlay glyphs. Constant per flipbook (applied identically to every frame),
 * so the constant-width/height guarantees hold. Absent ⇒ the bare sprite,
 * byte-identical to the pre-gear scenes. The enemy is always a wild bug and
 * never gets one.
 */
export interface PlayerLook {
  hat?: Hat;
  gear?: GearArt;
}

// ─── Skirmish-bout extras (design-attack-animation §4) ───────────────────────

const RED = "\x1b[31m";
const NC = "\x1b[0m";

/** The red damage pop (OQ1): `✗ -N` on impact, a bare `-N` as it floats away.
 *  ANSI is safe here — `displayWidth` strips SGR before measuring, and the
 *  overlay row is composed after the enemy mirror, so `mirrorFrame` never sees
 *  the escape bytes. */
function damagePop(n: number, floating: boolean): string {
  return floating ? `${RED}-${n}${NC}` : `${RED}✗ -${n}${NC}`;
}

/** Extra per-frame scene features for the skirmish bouts. Absent ⇒ the
 *  composed frame is byte-identical to the classic pose. */
interface PoseExtras {
  /** Attacker translation into the gap, in display cells (0..SCENE_GAP). The
   *  vacated gap is space-padded on the far side, so total width is constant. */
  shift?: { side: "player" | "enemy"; cells: number };
  /** Damage-pop row rendered above the scene, centered over one sprite. When a
   *  flipbook uses overlays at all, EVERY frame must pass one (`text: null` ⇒
   *  an all-space row) so the frame height stays constant across the loop. */
  overlay?: { text: string | null; over: "player" | "enemy" };
}

/** The overlay row: `text` centered over the chosen sprite's column span,
 *  padded to the full scene width (rows stay rectangular). The defender never
 *  shifts during a bout, so its span is stable regardless of `shift`. */
function overlayRow(
  overlay: { text: string | null; over: "player" | "enemy" },
  playerW: number,
  enemyW: number,
): string {
  const total = playerW + SCENE_GAP + enemyW;
  if (!overlay.text) return " ".repeat(total);
  const w = displayWidth(overlay.text);
  const centered =
    overlay.over === "player"
      ? Math.floor((playerW - w) / 2)
      : playerW + SCENE_GAP + Math.floor((enemyW - w) / 2);
  const col = Math.max(0, Math.min(centered, total - w));
  return " ".repeat(col) + overlay.text + " ".repeat(Math.max(0, total - col - w));
}

/** The four fight poses: ready → wind-up → strike → resolve. Body art is fixed
 *  to frame 0 (constant per-species width across the flipbook); only eyes + the
 *  clash change. */
function scenePoses(
  restingP: Eye,
  restingE: Eye,
  outcome: Outcome,
): Pose[] {
  return [
    { pEye: restingP, eEye: restingE, strike: false }, // ready
    { pEye: asEye(">"), eEye: asEye(">"), strike: false }, // wind-up
    { pEye: asEye(">"), eEye: asEye(">"), strike: true }, // strike
    outcome === "win"
      ? { pEye: asEye("^"), eEye: asEye("x"), strike: false } // triumph
      : { pEye: asEye("-"), eEye: asEye("^"), strike: false }, // unbothered flee
  ];
}

/** Compose one scene row-block: the player buddy, a fixed-width gap, and the
 *  mirrored enemy, bottom-aligned. The gap clashes blades only on a strike
 *  frame's eye row. Shared by the fight scene (`bakeScene`) and the pending
 *  standoff (`bakePendingScene`) so both stay pixel-identical in layout. */
function composePose(
  playerSpecies: Species,
  enemySpecies: Species,
  pose: Pose,
  sword: string,
  extras?: PoseExtras,
  look?: PlayerLook,
): string {
  const playerRaw = getArtFrame(playerSpecies, pose.pEye, 0);
  if (look?.hat && look.hat !== "none") {
    applyHat(playerSpecies, look.hat, playerRaw);
  }
  applyGear(playerSpecies, playerRaw, look?.gear);
  const player = rectFrame(playerRaw);
  const enemy = mirrorFrame(getArtFrame(enemySpecies, pose.eEye, 0));
  const [pA, eA] = alignHeights(player, enemy);
  // Clash on the PLAYER's actual eye row (not the block center), shifted by any
  // top-padding alignHeights added when the player is the shorter sprite — so
  // the sword lands at eye level for off-center species (goose/snail/mushroom)
  // and the 6-line wyvern alike.
  const eyeRow = eyeRowIndex(playerSpecies) + (pA.length - player.length);
  // A bout attacker walks `cells` into the gap; the vacated space moves to the
  // attacker's outer side, keeping every row's total width constant.
  const cells = Math.min(extras?.shift?.cells ?? 0, SCENE_GAP);
  const side = cells > 0 ? extras?.shift?.side : undefined;
  const pad = " ".repeat(cells);
  const rows = pA.map((line, i) => {
    const gap = gapRow(pose.strike, i === eyeRow, sword, SCENE_GAP - cells);
    if (side === "player") return pad + line + gap + eA[i];
    if (side === "enemy") return line + gap + eA[i] + pad;
    return line + gap + eA[i];
  });
  if (extras?.overlay) {
    rows.unshift(
      overlayRow(extras.overlay, displayWidth(pA[0]), displayWidth(eA[0])),
    );
  }
  return rows.join("\n");
}

/** Drop rows above the sprites that NO frame of a flipbook uses. Two optional
 *  rows sit up there: the species art reserves its row 0 for the hat
 *  (`applyHat` fills it only when one is worn) and `composePose` unshifts the
 *  damage-pop row above that. Bare-headed, or in a loop that never pops, those
 *  rows render as dead space — pure waste in a status line where vertical room
 *  is the scarcest thing there is, and a visible hole between the fight caption
 *  and the sprites.
 *
 *  Two properties keep this safe. Only rows blank in *every* frame go, so a row
 *  any frame needs (a hat, a bout's `✗ -N`) is kept for the whole flipbook —
 *  and since the same rows are dropped from every frame, the constant-height /
 *  no-jitter guarantee the cycler depends on still holds. And the scan stops at
 *  the first row every frame uses — the top of the sprite bodies, which are
 *  fixed to art frame 0 — so an intentional blank row *inside* a sprite is
 *  never reachable, no matter what art is added later. "Blank" means blank of
 *  content: the pop's ANSI bytes survive `.trim()`, so a pop row is never
 *  mistaken for an empty one. */
function trimBlankTopRows(frames: string[]): string[] {
  const rows = frames.map((f) => f.split("\n"));
  const height = rows[0]?.length ?? 0;
  const drop = new Set<number>();
  // Stop short of the last row: a scene always keeps at least one.
  for (let i = 0; i < height - 1; i++) {
    if (!rows.some((r) => r[i]?.trim())) drop.add(i); // used by no frame ⇒ dead
    else if (rows.every((r) => r[i]?.trim())) break; // sprite bodies start here
  }
  if (drop.size === 0) return frames;
  return rows.map((r) => r.filter((_, i) => !drop.has(i)).join("\n"));
}

/**
 * Bake the two-sprite fight scene: the player buddy and the mirrored enemy
 * creature side by side, with a short sword-swing flipbook. Every frame is the
 * same display width (the strike's clash lives in a fixed-width gap, no body
 * translation) so the status line never jitters horizontally. Pure — reuses
 * `SPECIES_ART` via `getArtFrame` + the `mirrorFrame` pass, no new per-species
 * art and no clock.
 */
function bakeScene(
  playerSpecies: Species,
  playerEye: Eye,
  enemySpecies: Species,
  enemyEye: Eye,
  weaponArt: string,
  outcome: Outcome,
  damage: number,
  look?: PlayerLook,
): { frames: string[]; sequence: number[] } {
  const sword = swingGlyph(weaponArt);
  // OQ4: on a win the strike shows the red pop over the enemy and the triumph
  // frame lets the number float away; a flee keeps the overlay blank (the
  // swing whiffed). Every frame carries the row so height stays constant.
  const popFor = (i: number): string | null => {
    if (outcome !== "win") return null;
    if (i === 2) return damagePop(damage, false); // strike
    if (i === 3) return damagePop(damage, true); // triumph
    return null;
  };
  const frames = scenePoses(playerEye, enemyEye, outcome).map((pose, i) =>
    composePose(
      playerSpecies,
      enemySpecies,
      pose,
      sword,
      { overlay: { text: popFor(i), over: "enemy" } },
      look,
    ),
  );
  // Gentle oscillation: ready, wind-up, strike, strike, resolve, resolve.
  const sequence = [0, 1, 2, 2, 3, 3];
  return { frames: trimBlankTopRows(frames), sequence };
}

/** The two standoff poses: a calm ready and a periodic glare — no strike, no
 *  resolve, no clash glyph (the gap stays blank), so the pending scene needs no
 *  weapon plumbing at sighting time. Pose 0 matches `scenePoses[0]` (ready) and
 *  pose 1 matches its wind-up (fight eyes, no strike). */
function pendingPoses(restingP: Eye, restingE: Eye): Pose[] {
  return [
    { pEye: restingP, eEye: restingE, strike: false }, // ready
    { pEye: asEye(">"), eEye: asEye(">"), strike: false }, // glare
  ];
}

/** One skirmish bout (design-attack-animation §4.2): the attacker walks across
 *  the gap, lands a hit (red `✗ -N` pop over the defender), then backs off
 *  while the number floats away. Three distinct frames; the sequence returns
 *  to the base ready pose for the walk-home beat. The defender never moves. */
function bakeBoutFrames(
  playerSpecies: Species,
  enemySpecies: Species,
  restingP: Eye,
  restingE: Eye,
  attacker: "player" | "enemy",
  damage: number,
  look?: PlayerLook,
): string[] {
  const defender = attacker === "player" ? "enemy" : "player";
  const walk: Pose =
    attacker === "player"
      ? { pEye: asEye(">"), eEye: restingE, strike: false }
      : { pEye: restingP, eEye: asEye(">"), strike: false };
  const impact: Pose =
    attacker === "player"
      ? { pEye: asEye(">"), eEye: asEye("x"), strike: false }
      : { pEye: asEye("x"), eEye: asEye(">"), strike: false };
  const at = (pose: Pose, cells: number, text: string | null): string =>
    // strike is always false ⇒ the sword arg is inert (gap stays blank).
    composePose(
      playerSpecies,
      enemySpecies,
      pose,
      DEFAULT_SWORD,
      {
        shift: { side: attacker, cells },
        overlay: { text, over: defender },
      },
      look,
    );
  return [
    at(walk, 2, null), // walk-in: halfway across the gap
    at(impact, SCENE_GAP, damagePop(damage, false)), // impact: adjacent, ✗ -N
    at(impact, 2, damagePop(damage, true)), // back off: -N floats away
  ];
}

/**
 * Bake the persistent standoff flipbook (design-pending-encounter §4.2,
 * extended by design-attack-animation): the same two-sprite composition as
 * `bakeScene` — ready/glare poses plus two seeded skirmish bouts (§4.2/OQ2:
 * attackers alternate, damage and loop gaps rolled from `seed`). Pure &
 * deterministic; constant display width AND height across all frames (body
 * fixed to art frame 0, every frame carries the overlay row), bottom-aligned.
 */
export function bakePendingScene(
  playerSpecies: Species,
  playerEye: Eye,
  enemySpecies: Species,
  enemyEye: Eye = DEFAULT_ENEMY_EYE,
  seed: number = 0,
  tier: number = 1,
  look?: PlayerLook,
): { frames: string[]; sequence: number[] } {
  const base = pendingPoses(playerEye, enemyEye).map((pose) =>
    // strike is always false ⇒ the sword arg is inert (gap stays blank).
    composePose(
      playerSpecies,
      enemySpecies,
      pose,
      DEFAULT_SWORD,
      { overlay: { text: null, over: "enemy" } },
      look,
    ),
  );
  // Seeded draws in a fixed order (determinism): first attacker, damage per
  // bout (§4.3: the bug hits 1..3·tier, the buddy hits 1..9), three gaps.
  const rng = mulberry32(seed);
  const first: "player" | "enemy" = rng() < 0.5 ? "player" : "enemy";
  const second: "player" | "enemy" = first === "player" ? "enemy" : "player";
  const roll = (attacker: "player" | "enemy"): number =>
    1 + Math.floor(rng() * (attacker === "player" ? 9 : 3 * tier));
  const dmgA = roll(first);
  const dmgB = roll(second);
  const gap = (): number => 8 + Math.floor(rng() * 8);
  const [g1, g2, g3] = [gap(), gap(), gap()];

  const bout = (attacker: "player" | "enemy", damage: number): string[] =>
    bakeBoutFrames(
      playerSpecies,
      enemySpecies,
      playerEye,
      enemyEye,
      attacker,
      damage,
      look,
    );
  const frames = [...base, ...bout(first, dmgA), ...bout(second, dmgB)];

  // The calm rhythm keeps the classic mostly-ready/periodic-glare beat; each
  // bout plays walk → impact ×2 → float ×2, then falls back to ready. The
  // whole loop repeats every `sequence.length` seconds (§4.4).
  const calm = (n: number): number[] =>
    Array.from({ length: n }, (_, i) => [0, 0, 0, 1][i % 4]);
  const boutTicks = (f: number): number[] => [f, f + 1, f + 1, f + 2, f + 2];
  const sequence = [
    ...calm(g1),
    ...boutTicks(2),
    ...calm(g2),
    ...boutTicks(5),
    ...calm(g3),
  ];
  return { frames: trimBlankTopRows(frames), sequence };
}

// ─── Item-drop roll (rarity-weighted) ─────────────────────────────────────────

/**
 * Roll a rarity-weighted item the player does NOT already own. Pure (rng
 * injected). Returns undefined when nothing droppable remains — so the summary
 * never announces loot the grant would silently no-op.
 */
function rollItemDrop(
  rng: () => number,
  owned: ReadonlySet<ItemId>,
): ItemId | undefined {
  const pool = ITEMS.filter((i) => !owned.has(i.id));
  const total = pool.reduce((sum, i) => sum + (RARITY_WEIGHTS[i.rarity] ?? 0), 0);
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const item of pool) {
    roll -= RARITY_WEIGHTS[item.rarity] ?? 0;
    if (roll < 0) return item.id;
  }
  return pool[pool.length - 1]?.id;
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve one encounter deterministically. Same inputs ⇒ same result. Gear
 * matters: effective DEBUGGING reads the equipped weapon's stat effect via
 * resolveAppearance, and an equipped weapon adds a flat bonus. Owned upgrades
 * (derive-on-read, see equipment.ts/ownedUpgradeEffects) count too — a bought
 * stat upgrade must carry the same combat power a migrated buddy would have
 * had baked into bones. `owned` (the player's inventory ∪ equipped) is
 * excluded from item drops so the summary never announces loot the grant
 * would silently skip.
 */
export function resolveCombat(
  bones: BuddyBones,
  bug: Bug,
  equipment: Equipment,
  seed: number,
  owned: ReadonlySet<ItemId> = new Set(),
  upgradeEffects: readonly UpgradeEffect[] = [],
): CombatResult {
  // Seeded once, consumed in a fixed order ⇒ reproducible resolution.
  const rng = mulberry32(seed);

  const appearance = resolveAppearance(
    bones,
    equipment,
    [],
    ITEMS,
    upgradeEffects,
  );
  const effDebug = appearance.stats.DEBUGGING;
  const weaponEquipped = Boolean(equipment.weapon);
  const p = winChance(effDebug, weaponEquipped, bug.tier);

  const outcome: Outcome = rng() < p ? "win" : "flee";
  // Cosmetic damage pop (design-attack-animation §4.3/OQ4). Rolled from a
  // derived seed so the main rng stream (outcome → jitter → item) is
  // unchanged for existing seeds. 0x2717 = ✗.
  const damage = 1 + Math.floor(mulberry32(seed ^ 0x2717)() * 9);
  // The player fights in its full look (gear renders on the sprite): worn hat
  // plus the equipped weapon/trinket overlay glyphs, all derive-on-read.
  const { frames, sequence } = bakeScene(
    bones.species,
    bones.eye,
    bug.species,
    bug.eye ?? DEFAULT_ENEMY_EYE,
    appearance.weaponArt,
    outcome,
    damage,
    { hat: appearance.hat, gear: gearArtOf(appearance) },
  );

  let drop: DropSpec;
  let summary: string;
  if (outcome === "win") {
    const jitter = Math.floor(rng() * 2); // 0..1 bonus point
    const points = bug.reward + jitter;
    const itemId =
      rng() < ITEM_DROP_PER_TIER * bug.tier
        ? rollItemDrop(rng, owned)
        : undefined;
    drop = { points, itemId };
    const itemName = itemId ? findItem(itemId)?.name : undefined;
    summary = `\u{1F5E1} squashed a ${bug.name}! +${points} pt${
      itemName ? ` & found a ${itemName}` : ""
    }`;
  } else {
    drop = { points: 0 };
    summary = `${bug.glyph} a ${bug.name} scuttled off.`;
  }

  return {
    outcome,
    frames,
    sequence,
    enemyGlyph: bug.glyph,
    drop,
    summary,
  };
}

// ─── I/O wrappers ─────────────────────────────────────────────────────────────

/** Apply a win's drop: credit skill points and (maybe) grant an item. */
export function applyCombatDrops(drop: DropSpec): void {
  if (drop.points > 0) grantBonusPoints(drop.points);
  if (drop.itemId) grantItem(drop.itemId);
}

function encounterFile(): string {
  return join(buddyStateDir(), "encounter.json");
}

/**
 * The project a sighting/fight belongs to: the basename of the process cwd
 * (react.sh's backgrounded bun inherits the session's working directory).
 * Control characters are stripped here because frame art is exempt from the
 * shell-side jq sanitizer, and the name is clamped so a long directory name
 * can't blow out the scene width. Undefined when the cwd yields nothing usable.
 */
export function currentProject(): string | undefined {
  try {
    const name = basename(process.cwd())
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
      .slice(0, 24);
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Persist the baked encounter to the transient side-channel (like lastDrop). */
export function writeEncounter(result: CombatResult, project?: string): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const record: EncounterRecord = {
    frames: result.frames,
    sequence: result.sequence,
    enemyGlyph: result.enemyGlyph,
    at: Date.now(),
    project,
  };
  const file = encounterFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(record));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(record));
  }
}

/**
 * How long a baked encounter stays fresh (ms). Kept in sync with the
 * `$enc_fresh` window in buddy-status.sh and the full-gate celebration TTL, so
 * the glyph, the fight face, and the toast all fade together (≈10s).
 *
 * Note: the bash `$enc_fresh` check works in integer seconds while this gate is
 * in milliseconds, so the two can disagree by up to ~1s at the very edge of the
 * window. Harmless — both land at ≈10s and the elements are meant to fade as a
 * group, not frame-exact.
 */
export const ENCOUNTER_TTL_MS = 10_000;

/**
 * Read the encounter side-channel if present and fresh. Returns null when
 * missing, malformed, or older than `maxAgeMs`. Phase 4's status write consumes
 * this; exposed now for tests.
 */
export function readEncounter(
  maxAgeMs: number = ENCOUNTER_TTL_MS,
): EncounterRecord | null {
  try {
    const rec = JSON.parse(
      readFileSync(encounterFile(), "utf8"),
    ) as EncounterRecord;
    if (!Array.isArray(rec.frames) || typeof rec.at !== "number") return null;
    if (Date.now() - rec.at > maxAgeMs) return null;
    return rec;
  } catch {
    return null;
  }
}

// ─── Pending-encounter side-channel (design-pending-encounter §3.1) ───────────

function pendingEncounterFile(): string {
  return join(buddyStateDir(), "pending-encounter.json");
}

/** Persist the pending standoff atomically (tmp+rename), like `writeEncounter`. */
export function writePendingEncounter(rec: PendingEncounter): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = pendingEncounterFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(rec));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(rec));
  }
}

/**
 * Read the pending standoff if present. Returns null when missing or malformed.
 * Unlike `readEncounter` there is **no TTL** — the standoff persists until a
 * commit clears it (design-pending-encounter G2). Staleness is instead guarded
 * by matching `startedAt` against the live snapshot at the call site (§5.3).
 */
export function readPendingEncounter(): PendingEncounter | null {
  try {
    const rec = JSON.parse(
      readFileSync(pendingEncounterFile(), "utf8"),
    ) as PendingEncounter;
    if (
      !Array.isArray(rec.frames) ||
      typeof rec.bugId !== "string" ||
      typeof rec.startedAt !== "number"
    ) {
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

/** Clear the pending standoff (commit / session_start / staleness — §4, G5). */
export function clearPendingEncounter(): void {
  try {
    rmSync(pendingEncounterFile(), { force: true });
  } catch {
    /* already gone — clearing is idempotent */
  }
}
