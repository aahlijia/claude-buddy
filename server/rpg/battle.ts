/**
 * Turn-based battle engine. Pure: a `Battle` is plain JSON (persisted between
 * prompt-hook invocations), and `act` returns the next state plus a log.
 * Randomness is seeded per turn (`seed`, `turn`), so a battle replays
 * identically given the same actions.
 */

import { mulberry32, type Species } from "../engine";
import {
  BOSSES,
  SKILLS,
  ZONES,
  type BossId,
  type ConsumableId,
  type MonsterDef,
  type MonsterMove,
  type SkillId,
  type UniqueId,
  type ZoneDef,
} from "./data";
import type { HeroStats } from "./hero";
import { BOSS_LINES } from "./story";

export type BattleKind = "explore" | "boss" | "tower" | "hunt" | "event";

export interface Effects {
  /** Remaining turns of each timed effect. */
  poison?: number;
  stun?: number;
  stunImmune?: number;
  blind?: number;
  shield?: number;
  revealed?: number;
  /** Hero ATK buff (Refactor). */
  buff?: number;
  /** Next hero hit is a guaranteed crit (Rubber Duck). */
  sureCrit?: boolean;
  enraged?: boolean;
  /** Legendary bookkeeping: Second Wind spent / First Strike landed. */
  windUsed?: boolean;
  struck?: boolean;
}

export interface HeroSide {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  crit: number;
  leech: number;
  cd: Partial<Record<SkillId, number>>;
  fx: Effects;
  guard: boolean;
  uniques?: UniqueId[];
}

export interface FoeSide {
  id: string;
  name: string;
  species: Species;
  level: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  move?: MonsterMove;
  boss?: BossId;
  fx: Effects;
  /** Boss wind-up: >0 ⇒ the big attack lands on its next turn. */
  charge?: number;
  /** Hydra head count. */
  heads?: number;
  /** Leaky Golem's max-HP growth ceiling. */
  growCap?: number;
  /** Boss has delivered its half-HP line. */
  phased?: boolean;
}

export interface Battle {
  kind: BattleKind;
  zone: number;
  floor: number;
  seed: number;
  turn: number;
  hero: HeroSide;
  foe: FoeSide;
  /** Lines produced by the latest turn (or the intro). */
  log: string[];
  /** This fight is a floor guardian (the floor's last win). */
  guardian?: boolean;
  /** Hits landed (or missed) during the latest turn, in order — drives the
   *  damage pops and the TUI's attack animation. */
  hits?: Hit[];
  /** Both sides' HP when the latest turn began (the HP bars' ghost). */
  was?: [number, number];
  /** Everything visible that happened during the latest turn, in order —
   *  drives the TUI's choreography (see anim.ts). */
  beats?: Beat[];
  over?: "win" | "lose" | "fled";
}

export interface Hit {
  by: "hero" | "foe";
  /** 0 on a miss/dodge. */
  dmg: number;
  crit: boolean;
}

export type Side = "hero" | "foe";

/** How a strike looks, not how it's computed. */
export type StrikeStyle = "melee" | "heavy" | "multi" | "bomb" | "duck" | "drain";

/** One visible moment of a turn. `line` is the index of the log line that
 *  narrates it (-1 when none), `hp` both sides' HP right after it. */
export type Beat = { line: number; hp: [number, number] } & (
  | { t: "strike"; by: Side; dmg: number; crit: boolean; style: StrikeStyle }
  | { t: "miss"; by: Side; why: "dodge" | "blind" }
  | { t: "heal"; who: Side; amount: number; src: "potion" | "elixir" | "hotfix" | "guard" | "leech" | "drain" | "regen" }
  | { t: "guard" }
  | { t: "buff"; who: Side; label: string }
  | { t: "status"; who: Side; fx: "poison" | "stun" | "blind" }
  | { t: "tick"; who: Side; dmg: number }
  | { t: "charge" }
  | { t: "interrupt" }
  | { t: "thorns"; dmg: number }
  | { t: "secondwind" }
  | { t: "grow"; amount: number }
  | { t: "sprout"; heads: number }
  | { t: "speech" }
  | { t: "flee"; ok: boolean }
  | { t: "ko"; who: Side }
);

/** Distributive Omit, so each Beat variant keeps its own fields. */
type BeatData = Beat extends infer B ? (B extends Beat ? Omit<B, "line" | "hp"> : never) : never;

/** Record a beat narrated by the log line just pushed (if any). */
function beat(b: Battle, log: string[], data: BeatData, narrated = true): void {
  b.beats?.push({ ...data, line: narrated ? log.length - 1 : -1, hp: [b.hero.hp, b.foe.hp] } as Beat);
}

export type Action =
  | { type: "attack" }
  | { type: "skill"; id: SkillId }
  | { type: "defend" }
  | { type: "item"; id: ConsumableId }
  | { type: "flee" };

// ─── Foe construction ───────────────────────────────────────────────────────

/** Global difficulty knobs, tuned with a full-playthrough bot sim (see
 *  docs/game-feel/buddy-quest/design.md § Balance). */
export const HP_SCALE = 1.3;
export const ATK_SCALE = 1.35;
export const BOSS_HP_SCALE = 1.3;
export const BOSS_ATK_SCALE = 1.45;

function curve(level: number) {
  return {
    hp: (22 + 9 * level + 0.35 * level * level) * HP_SCALE,
    atk: (5 + 1.6 * level + 0.045 * level * level) * ATK_SCALE,
    def: 1 + 0.9 * level,
    spd: 8 + 0.35 * level,
  };
}

export function makeMonster(def: MonsterDef, level: number): FoeSide {
  const c = curve(level);
  const hp = Math.round(c.hp * def.hp);
  return {
    id: def.id,
    name: def.name,
    species: def.species,
    level,
    hp,
    maxHp: hp,
    atk: Math.round(c.atk * def.atk),
    def: Math.round(c.def * def.def),
    spd: Math.round(c.spd * def.spd),
    move: def.move,
    fx: {},
  };
}

export function makeBoss(id: BossId, level: number): FoeSide {
  const b = BOSSES[id];
  const c = curve(level);
  const hp = Math.round(c.hp * b.hp * BOSS_HP_SCALE);
  return {
    id,
    name: b.name,
    species: b.species,
    level,
    hp,
    maxHp: hp,
    atk: Math.round(c.atk * b.atk * BOSS_ATK_SCALE),
    def: Math.round(c.def * b.def),
    spd: Math.round(c.spd * b.spd),
    boss: id,
    fx: {},
    heads: id === "hydra" ? 2 : undefined,
  };
}

export function bossLevel(zone: ZoneDef): number {
  return zone.base + 5;
}

/** Tower floor n: level 22+n; every 10th floor is a boss from the rotation. */
export function towerFoe(floor: number, rng: () => number): FoeSide {
  const level = 22 + floor;
  if (floor % 10 === 0) {
    const ids = Object.keys(BOSSES) as BossId[];
    return makeBoss(ids[(floor / 10 - 1) % ids.length], level);
  }
  const all = ZONES.flatMap((z) => z.monsters);
  const m = makeMonster(all[Math.floor(rng() * all.length)], level);
  if (floor % 5 === 0) {
    // Elite: tougher, named.
    m.name = `Elite ${m.name}`;
    m.hp = m.maxHp = Math.round(m.maxHp * 1.8);
    m.atk = Math.round(m.atk * 1.15);
  }
  return m;
}

export function startBattle(
  kind: BattleKind,
  zone: number,
  floor: number,
  hero: HeroStats,
  heroHp: number,
  foe: FoeSide,
  seed: number,
): Battle {
  const log = [
    foe.boss ? `♛ ${foe.name} blocks your path!` : `A wild ${foe.name} (Lv${foe.level}) appears!`,
  ];
  if (foe.boss) {
    log.push(`${foe.name}: ${BOSS_LINES[foe.boss].intro}`);
    log.push(`TIP: ${BOSSES[foe.boss].intro}`);
  }
  return {
    kind,
    zone,
    floor,
    seed: seed >>> 0,
    turn: 0,
    hero: {
      hp: Math.max(1, Math.min(heroHp, hero.maxHp)),
      maxHp: hero.maxHp,
      atk: hero.atk,
      def: hero.def,
      spd: hero.spd,
      crit: hero.crit,
      leech: hero.leech,
      cd: {},
      fx: {},
      guard: false,
      uniques: hero.uniques.length ? [...hero.uniques] : undefined,
    },
    foe,
    log,
  };
}

// ─── Combat math ────────────────────────────────────────────────────────────

/** Defense mitigation. The armor constant grows with the attacker's level,
 *  so piling on DEF helps against your peers but a high-level foe still
 *  hits through it (otherwise trained DEF snowballs into invulnerability). */
export function mitigate(raw: number, def: number, attackerLevel: number = 1): number {
  const k = 30 + 8 * Math.max(1, attackerLevel);
  return raw * (k / (k + Math.max(0, def)));
}

function roll(rng: () => number, atk: number, def: number, mult: number, attackerLevel = 1): number {
  return Math.max(1, Math.round(mitigate(atk * mult, def, attackerLevel) * (0.9 + rng() * 0.2)));
}

function dodgeChance(defSpd: number, atkSpd: number): number {
  return Math.max(0, Math.min(30, 5 + (defSpd - atkSpd) * 1.5)) / 100;
}

function heroAtk(b: Battle): number {
  return b.hero.atk * (b.hero.fx.buff ? 1.4 : 1);
}

function foeAtk(b: Battle): number {
  return b.foe.atk * (b.foe.fx.enraged ? 1.35 : 1);
}

interface HitOpts {
  mult: number;
  sure?: boolean;
  forceCrit?: boolean;
  style?: StrikeStyle;
}

/** Hero strikes the foe; returns damage dealt (0 on a miss). */
function heroHit(b: Battle, rng: () => number, o: HitOpts, log: string[]): number {
  const { hero, foe } = b;
  if (!o.sure) {
    if (hero.fx.blind && rng() < 0.5) {
      log.push("Cursed aim — you miss!");
      b.hits?.push({ by: "hero", dmg: 0, crit: false });
      beat(b, log, { t: "miss", by: "hero", why: "blind" });
      return 0;
    }
    let dodge = dodgeChance(foe.spd, hero.spd);
    if (foe.boss === "heisenbug" && !foe.fx.revealed) dodge += 0.4;
    if (rng() < dodge) {
      log.push(`${foe.name} dodges!`);
      b.hits?.push({ by: "hero", dmg: 0, crit: false });
      beat(b, log, { t: "miss", by: "hero", why: "dodge" });
      return 0;
    }
  }
  const first = !hero.fx.struck && !!hero.uniques?.includes("firststrike");
  hero.fx.struck = true;
  const crit = o.forceCrit || hero.fx.sureCrit || first || rng() < hero.crit / 100;
  let mult = o.mult * (crit ? (o.forceCrit ? 2.5 : 1.75) : 1);
  if (foe.fx.shield) mult *= 0.5;
  const dmg = roll(rng, heroAtk(b), foe.def, mult);
  foe.hp = Math.max(0, foe.hp - dmg);
  hero.fx.sureCrit = false;
  log.push(`${crit ? "CRIT! " : ""}You hit ${foe.name} for ${dmg}.`);
  b.hits?.push({ by: "hero", dmg, crit });
  beat(b, log, { t: "strike", by: "hero", dmg, crit, style: o.style ?? "melee" });
  if (hero.leech > 0) {
    const heal = Math.floor((dmg * hero.leech) / 100);
    if (heal > 0) {
      hero.hp = Math.min(hero.maxHp, hero.hp + heal);
      beat(b, log, { t: "heal", who: "hero", amount: heal, src: "leech" }, false);
    }
  }
  return dmg;
}

/** Foe strikes the hero; returns damage dealt. */
function foeHit(
  b: Battle,
  rng: () => number,
  mult: number,
  log: string[],
  verb = "hits",
  style: StrikeStyle = "melee",
): number {
  const { hero, foe } = b;
  if (rng() < dodgeChance(hero.spd, foe.spd)) {
    log.push(`You dodge ${foe.name}'s attack.`);
    b.hits?.push({ by: "foe", dmg: 0, crit: false });
    beat(b, log, { t: "miss", by: "foe", why: "dodge" });
    return 0;
  }
  const crit = rng() < 0.05;
  let m = mult * (crit ? 1.5 : 1);
  if (hero.guard) m *= 0.4;
  const dmg = roll(rng, foeAtk(b), hero.def, m, foe.level);
  hero.hp = Math.max(0, hero.hp - dmg);
  log.push(`${crit ? "CRIT! " : ""}${foe.name} ${verb} you for ${dmg}.`);
  b.hits?.push({ by: "foe", dmg, crit });
  beat(b, log, { t: "strike", by: "foe", dmg, crit, style });
  if (hero.uniques?.includes("thorns")) {
    const back = Math.max(1, Math.round(dmg * 0.25));
    foe.hp = Math.max(0, foe.hp - back);
    log.push(`Thorns reflect ${back}.`);
    beat(b, log, { t: "thorns", dmg: back });
  }
  secondWind(b, log);
  return dmg;
}

/** Second Wind: the first lethal blow of a fight leaves the hero at 1 HP. */
function secondWind(b: Battle, log: string[]): void {
  const { hero } = b;
  if (hero.hp > 0 || hero.fx.windUsed || !hero.uniques?.includes("secondwind")) return;
  hero.hp = 1;
  hero.fx.windUsed = true;
  log.push("Second Wind! You cling on at 1 HP.");
  beat(b, log, { t: "secondwind" });
}

// ─── Foe turn ───────────────────────────────────────────────────────────────

function monsterTurn(b: Battle, rng: () => number, log: string[]): void {
  const { foe, hero } = b;
  const special = foe.move && rng() < 0.3;
  switch (special ? foe.move : undefined) {
    case "poison":
      foeHit(b, rng, 0.7, log, "bites");
      if (!hero.fx.poison) {
        log.push("You are poisoned!");
        beat(b, log, { t: "status", who: "hero", fx: "poison" });
      }
      hero.fx.poison = 3;
      return;
    case "heal":
      if (foe.hp < foe.maxHp * 0.6) {
        const h = Math.round(foe.maxHp * 0.2);
        foe.hp = Math.min(foe.maxHp, foe.hp + h);
        log.push(`${foe.name} regenerates ${h} HP.`);
        beat(b, log, { t: "heal", who: "foe", amount: h, src: "regen" });
        return;
      }
      break;
    case "enrage":
      if (!foe.fx.enraged && foe.hp < foe.maxHp * 0.5) {
        foe.fx.enraged = true;
        log.push(`${foe.name} becomes enraged!`);
        beat(b, log, { t: "buff", who: "foe", label: "ENRAGED" });
        return;
      }
      break;
    case "shield":
      if (!foe.fx.shield) {
        foe.fx.shield = 2;
        log.push(`${foe.name} raises a shield.`);
        beat(b, log, { t: "buff", who: "foe", label: "SHIELD" });
        return;
      }
      break;
    case "double":
      foeHit(b, rng, 0.65, log, "lunges at", "multi");
      if (hero.hp > 0) foeHit(b, rng, 0.65, log, "lunges at", "multi");
      return;
  }
  foeHit(b, rng, 1, log);
}

function bossTurn(b: Battle, rng: () => number, log: string[]): void {
  const { foe, hero } = b;
  const t = b.turn;
  switch (foe.boss) {
    case "semicolon":
      if (foe.charge) {
        foe.charge = 0;
        foeHit(b, rng, 2.4, log, "unleashes PARSE ERROR on", "heavy");
      } else if (t % 3 === 2) {
        foe.charge = 1;
        log.push("The Missing Semicolon gathers stray tokens... (defend!)");
        beat(b, log, { t: "charge" });
      } else foeHit(b, rng, 1, log);
      return;
    case "lich": {
      if (foe.hp < foe.maxHp / 2 && t % 3 === 0 && !hero.fx.blind) {
        hero.fx.blind = 2;
        log.push("The Lich curses you: NullReferenceException! Your aim falters.");
        beat(b, log, { t: "status", who: "hero", fx: "blind" });
        return;
      }
      const d = foeHit(b, rng, 1, log, "drains", "drain");
      const drained = Math.min(foe.maxHp - foe.hp, Math.round(d * 0.5));
      foe.hp += drained;
      if (drained > 0) beat(b, log, { t: "heal", who: "foe", amount: drained, src: "drain" }, false);
      return;
    }
    case "hydra": {
      const lost = 1 - foe.hp / foe.maxHp;
      const heads = Math.min(5, 2 + Math.floor(lost / 0.25));
      if (heads > (foe.heads ?? 2)) {
        log.push(`A new callback head sprouts! (${heads} heads)`);
        beat(b, log, { t: "sprout", heads });
      }
      foe.heads = heads;
      for (let i = 0; i < heads && hero.hp > 0; i++) foeHit(b, rng, 0.5, log, "bites", "multi");
      return;
    }
    case "heisenbug":
      foeHit(b, rng, 1, log, "glitches into");
      return;
    case "golem": {
      // Leaks toward a 2× ceiling: unchecked it outgrows you; stuns pause it.
      const cap = (foe.growCap ??= foe.maxHp * 2);
      const grow = Math.min(Math.round(foe.maxHp * 0.04), Math.max(0, cap - foe.maxHp));
      if (grow > 0) {
        foe.maxHp += grow;
        foe.hp = Math.min(foe.maxHp, foe.hp + grow);
        log.push(`The Golem leaks memory: +${grow} max HP.`);
        beat(b, log, { t: "grow", amount: grow });
      }
      foeHit(b, rng, 1, log, "slams", "heavy");
      return;
    }
    case "segfault":
      if (!foe.fx.enraged && foe.hp < foe.maxHp * 0.3) {
        foe.fx.enraged = true;
        log.push("The Segfault Dragon ENRAGES!");
        beat(b, log, { t: "buff", who: "foe", label: "ENRAGED" });
      }
      if (foe.charge) {
        foe.charge = 0;
        foeHit(b, rng, 3, log, "CORE DUMPS on", "heavy");
      } else if (t % 4 === 3) {
        foe.charge = 1;
        log.push("The dragon inhales... (defend or Breakpoint!)");
        beat(b, log, { t: "charge" });
      } else foeHit(b, rng, 1, log, "claws");
      return;
  }
  foeHit(b, rng, 1, log);
}

// ─── Turn resolution ────────────────────────────────────────────────────────

const ITEM_BOMB_MULT = 2.6;

/**
 * Pre-validate an action. Returns an error string or null. Ownership and item
 * counts are the caller's to check — this only knows cooldowns and fight rules.
 */
export function actionError(b: Battle, a: Action): string | null {
  if (b.over) return "This battle is over.";
  if (a.type === "skill") {
    const cd = b.hero.cd[a.id] ?? 0;
    if (cd > 0) return `${SKILLS[a.id].name} is on cooldown (${cd} turn${cd === 1 ? "" : "s"}).`;
  }
  if (a.type === "item" && a.id === "smoke" && b.foe.boss) return "Bosses block the exit — no escape!";
  if (a.type === "flee" && b.foe.boss) return "Bosses block the exit — no escape!";
  return null;
}

export function act(prev: Battle, a: Action): Battle {
  const b: Battle = structuredClone(prev);
  const rng = mulberry32((b.seed ^ Math.imul(b.turn + 1, 0x9e3779b1)) >>> 0);
  const log: string[] = [];
  const { hero, foe } = b;
  b.turn++;
  b.hits = [];
  b.beats = [];
  b.was = [hero.hp, foe.hp];
  hero.guard = false;

  // ── Hero action ──
  switch (a.type) {
    case "attack":
      heroHit(b, rng, { mult: 1 }, log);
      break;
    case "defend":
      hero.guard = true;
      {
        const h = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * 0.05));
        hero.hp += h;
        log.push("You brace yourself.");
        beat(b, log, { t: "guard" });
        if (h > 0) beat(b, log, { t: "heal", who: "hero", amount: h, src: "guard" }, false);
      }
      if (foe.boss === "heisenbug") {
        foe.fx.revealed = 2;
        log.push("You observe the Heisenbug — it can't dodge now!");
        beat(b, log, { t: "buff", who: "foe", label: "OBSERVED" });
      }
      break;
    case "flee":
      if (rng() < Math.max(0.35, Math.min(0.9, 0.55 + (hero.spd - foe.spd) * 0.04))) {
        b.over = "fled";
        b.log = ["You slip away."];
        beat(b, b.log, { t: "flee", ok: true });
        return b;
      }
      log.push("You fail to escape!");
      beat(b, log, { t: "flee", ok: false });
      break;
    case "item":
      switch (a.id) {
        case "potion": {
          const h = Math.round(hero.maxHp * 0.4);
          const gained = Math.min(hero.maxHp - hero.hp, h);
          hero.hp += gained;
          log.push(`You drink Coffee: +${h} HP.`);
          beat(b, log, { t: "heal", who: "hero", amount: gained, src: "potion" });
          break;
        }
        case "elixir": {
          const gained = hero.maxHp - hero.hp;
          hero.hp = hero.maxHp;
          hero.cd = {};
          hero.fx.poison = 0;
          log.push("Energy Drink! Full HP, cooldowns reset.");
          beat(b, log, { t: "heal", who: "hero", amount: gained, src: "elixir" });
          break;
        }
        case "bomb":
          heroHit(b, rng, { mult: ITEM_BOMB_MULT, sure: true, style: "bomb" }, log);
          break;
        case "smoke":
          b.over = "fled";
          b.log = ["Ctrl+C! You vanish in smoke."];
          beat(b, b.log, { t: "flee", ok: true });
          return b;
      }
      break;
    case "skill": {
      const s = SKILLS[a.id];
      const cool = hero.uniques?.includes("overclock") ? Math.max(1, s.cooldown - 1) : s.cooldown;
      hero.cd[a.id] = cool + 1; // +1: ticks down at end of this turn
      switch (a.id) {
        case "strike":
          heroHit(b, rng, { mult: 1.7, style: "heavy" }, log);
          break;
        case "hotfix": {
          const h = Math.round(hero.maxHp * 0.35);
          const gained = Math.min(hero.maxHp - hero.hp, h);
          hero.hp += gained;
          hero.fx.poison = 0;
          log.push(`Hotfix deployed: +${h} HP.`);
          beat(b, log, { t: "heal", who: "hero", amount: gained, src: "hotfix" });
          break;
        }
        case "refactor":
          hero.fx.buff = 3;
          log.push("Refactor! ATK +40% for 3 turns.");
          beat(b, log, { t: "buff", who: "hero", label: "ATK↑" });
          break;
        case "breakpoint":
          if (heroHit(b, rng, { mult: 0.9 }, log) > 0 || foe.boss === "heisenbug") {
            if (foe.fx.stunImmune) log.push(`${foe.name} resists the stun.`);
            else {
              foe.fx.stun = 1;
              if (foe.charge) {
                foe.charge = 0;
                log.push("Breakpoint hit! The wind-up is interrupted.");
                beat(b, log, { t: "interrupt" });
              } else log.push(`${foe.name} is frozen at a breakpoint!`);
              beat(b, log, { t: "status", who: "foe", fx: "stun" }, false);
            }
          }
          break;
        case "duck":
          heroHit(b, rng, { mult: 1, sure: true, forceCrit: true, style: "duck" }, log);
          break;
        case "gc": {
          const extra = Math.round(foe.hp * 0.12);
          heroHit(b, rng, { mult: 1, style: "heavy" }, log);
          foe.hp = Math.max(0, foe.hp - extra);
          foe.fx.shield = 0;
          foe.fx.enraged = false;
          log.push(`Garbage collected ${extra} extra HP.`);
          beat(b, log, { t: "strike", by: "hero", dmg: extra, crit: false, style: "multi" });
          break;
        }
        case "forkbomb":
          for (let i = 0; i < 3 && foe.hp > 0; i++) heroHit(b, rng, { mult: 0.75, style: "multi" }, log);
          break;
      }
      break;
    }
  }

  if (foe.hp <= 0) {
    log.push(foe.boss ? BOSS_LINES[foe.boss].defeat : `${foe.name} is defeated!`);
    b.over = "win";
    beat(b, log, { t: "ko", who: "foe" });
    b.log = log;
    return b;
  }
  if (foe.boss && !foe.phased && foe.hp < foe.maxHp / 2) {
    foe.phased = true;
    log.push(`${foe.name}: ${BOSS_LINES[foe.boss].phase}`);
    beat(b, log, { t: "speech" });
  }

  // ── Foe action ──
  if (foe.fx.stun) {
    log.push(`${foe.name} is stunned.`);
    beat(b, log, { t: "status", who: "foe", fx: "stun" });
    foe.fx.stunImmune = 2;
  } else if (foe.boss) {
    bossTurn(b, rng, log);
  } else {
    monsterTurn(b, rng, log);
  }

  // ── End of turn ──
  if (hero.fx.poison && hero.hp > 0) {
    const p = Math.max(1, Math.round(hero.maxHp * 0.06));
    hero.hp = Math.max(0, hero.hp - p);
    log.push(`Poison: -${p} HP.`);
    beat(b, log, { t: "tick", who: "hero", dmg: p });
    secondWind(b, log);
  }
  tick(hero.fx, ["poison", "blind", "buff", "stun", "stunImmune", "shield", "revealed"]);
  tick(foe.fx, ["stun", "stunImmune", "shield", "revealed", "blind", "poison"]);
  for (const k of Object.keys(hero.cd) as SkillId[]) {
    hero.cd[k] = Math.max(0, (hero.cd[k] ?? 0) - 1);
    if (!hero.cd[k]) delete hero.cd[k];
  }

  if (hero.hp <= 0) {
    log.push("You are knocked out...");
    b.over = "lose";
    beat(b, log, { t: "ko", who: "hero" });
  } else if (foe.hp <= 0) {
    // Thorns can finish a foe on its own turn.
    log.push(`${foe.name} is defeated!`);
    b.over = "win";
    beat(b, log, { t: "ko", who: "foe" });
  }
  b.log = log;
  return b;
}

type TimedKey = "poison" | "stun" | "stunImmune" | "blind" | "shield" | "revealed" | "buff";

function tick(fx: Effects, keys: TimedKey[]): void {
  for (const k of keys) {
    const v = fx[k];
    if (typeof v === "number" && v > 0) {
      fx[k] = v - 1;
      if (fx[k] === 0) delete fx[k];
    }
  }
}

/** Short telegraph shown under the foe's HP bar. */
export function foeIntent(b: Battle): string {
  const f = b.foe;
  if (f.fx.stun) return "stunned";
  if (f.charge) return "⚠ charging a huge attack!";
  const tags: string[] = [];
  if (f.fx.enraged) tags.push("enraged");
  if (f.fx.shield) tags.push("shielded");
  if (f.boss === "heisenbug") tags.push(f.fx.revealed ? "observed" : "unobserved");
  if (f.boss === "hydra") tags.push(`${f.heads ?? 2} heads`);
  return tags.join(", ");
}
