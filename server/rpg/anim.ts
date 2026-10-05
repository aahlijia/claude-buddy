/**
 * The director: turns a turn's `Beat`s into timed stage cues.
 *
 * `act()` says *what happened* (battle.ts beats); this module decides *how it
 * looks and how long it takes* — anticipation, contact, hit-stop, recoil and
 * settle for a strike; projectiles for bombs and the duck; rising motes for
 * heals and buffs; a wind-up glow for boss charges; flashes and a sinking
 * collapse for a KO. Log lines are revealed on the beat that narrates them,
 * so the text never runs ahead of the action.
 *
 * Pure and deterministic: the same battle always yields the same cues.
 * Durations are for "normal" speed; the player scales them.
 * See docs/game-feel/buddy-quest/design-animation.md §3.
 */

import { mulberry32 } from "../engine";
import type { Battle, Beat, Side } from "./battle";
import { EYES, marksOf, type ActorState, type Ink, type Marks, type Mote, type StageState } from "./stage";

export interface Cue {
  stage: StageState;
  /** HP shown on the bars [hero, foe]. */
  hp: [number, number];
  /** How many log lines are visible. */
  lines: number;
  ms: number;
}

const other = (s: Side): Side => (s === "hero" ? "foe" : "hero");
const dirOf = (s: Side) => (s === "hero" ? 1 : -1);

type Poses = Partial<Record<Side, ActorState>>;

class Reel {
  readonly cues: Cue[] = [];
  /** HD-only hints for the next cue (cut-ins, boss phases). */
  private hint: NonNullable<StageState["hd"]> = {};
  constructor(
    public hp: [number, number],
    public marks: Marks,
    public lines: number,
  ) {}

  push(ms: number, poses: Poses = {}, motes: Mote[] = [], shake = 0, extra: Partial<StageState> = {}): void {
    if (this.hint.cutin || this.hint.phase) {
      extra = { ...extra, hd: { ...this.hint, ...extra.hd } };
      this.hint = {};
    }
    this.cues.push({
      stage: { hero: poses.hero, foe: poses.foe, motes, shake, marks: { ...this.marks }, ...extra },
      hp: [this.hp[0], this.hp[1]],
      lines: this.lines,
      ms,
    });
  }

  /** Hang an HD-only hint on the next cue; the cell stage never sees it. */
  hintNext(h: NonNullable<StageState["hd"]>): void {
    this.hint = { ...this.hint, ...h };
  }

  reveal(b: Beat): void {
    if (b.line >= 0) this.lines = Math.max(this.lines, b.line + 1);
  }

  land(b: Beat): void {
    this.hp = [b.hp[0], b.hp[1]];
    this.reveal(b);
  }
}

/** Pose pair helper: attacker and defender by side. */
function pair(atk: Side, a: ActorState, d: ActorState): Poses {
  return { [atk]: a, [other(atk)]: d };
}

/** A damage/heal number: on row 1 at impact, row 0 as it floats away. */
function pop(at: Side, text: string, ink: Ink, rising: boolean): Mote {
  return { at, y: rising ? 0 : 1, text, ink };
}

function dmgText(dmg: number, crit: boolean): string {
  return crit ? `✦CRIT -${dmg}✦` : `-${dmg}`;
}

// ─── Strikes ────────────────────────────────────────────────────────────────

interface StrikeCtx {
  /** Position in a run of consecutive strikes by the same side. */
  chain: number;
  /** Last strike of the run (return home afterwards). */
  last: boolean;
}

function strike(r: Reel, b: Extract<Beat, { t: "strike" }>, c: StrikeCtx, eyeY: number): void {
  const A = b.by;
  const D = other(A);
  const k = dirOf(A);
  const heavy = b.style === "heavy";
  const crit = b.crit;
  const atkEye = { eye: EYES.attack };
  const popInk: Ink = crit ? "crit" : A === "hero" ? "hurt" : "red";
  const text = dmgText(b.dmg, crit);
  const clash: Mote = { at: "gap", y: eyeY, text: crit ? "\\✦/" : A === "hero" ? "/" : "\\", ink: crit ? "crit" : "white" };

  if (b.style === "bomb" || b.style === "duck") return projectile(r, b, eyeY);

  if (c.chain === 0) {
    // Anticipation: lean back (heavy hits charge up a glow).
    if (heavy) {
      r.push(80, pair(A, { x: -k, ...atkEye, tint: "glow" }, {}));
      r.push(80, pair(A, { x: -2 * k, ...atkEye, tint: "glow" }, {}), [{ at: A, y: 1, text: "!", ink: "gold" }]);
    } else {
      r.push(60, pair(A, { x: -k, ...atkEye }, {}));
    }
    r.push(40, pair(A, { x: 2 * k, ...atkEye }, {}));
  } else {
    r.push(30, pair(A, { x: 2 * k, ...atkEye }, {}));
  }

  // Contact + hit-stop.
  r.land(b);
  const flash = crit || heavy ? "flash" : "hurt";
  const hold = c.chain > 0 ? 80 : crit ? 170 : heavy ? 150 : 110;
  r.push(hold, pair(A, { x: 4 * k, ...atkEye }, { eye: EYES.hurt, tint: flash }), [clash, pop(D, text, popInk, false)], crit || heavy ? 1 : 0, {
    hd: { impact: { by: A, dmg: b.dmg, crit, heavy } },
  });

  // Recoil: the defender is knocked back, the number floats up.
  const knock = heavy || crit ? 2 : 1;
  r.push(c.chain > 0 ? 50 : 70, pair(A, { x: 3 * k, ...atkEye }, { x: knock * k, eye: EYES.hurt, tint: crit || heavy ? "hurt" : undefined }), [pop(D, text, popInk, true)], crit || heavy ? -1 : 0);

  if (c.last) {
    r.push(60, pair(A, { x: k }, { x: heavy || crit ? k : 0 }), [{ ...pop(D, text, "dim", true) }]);
    r.push(40);
  }
}

/** Bombs and the rubber duck fly across the gap instead of a lunge. */
function projectile(r: Reel, b: Extract<Beat, { t: "strike" }>, eyeY: number): void {
  const A = b.by;
  const D = other(A);
  const k = dirOf(A);
  const glyph = b.style === "bomb" ? "●" : ">o";
  const ink: Ink = b.style === "bomb" ? "gray" : "yellow";
  r.push(70, pair(A, { x: -k, eye: EYES.attack }, {}));
  const path = [-4, -2, 0, 2, 4];
  const arc = [0, -1, -1, -1, 0];
  path.forEach((dx, i) => r.push(35, {}, [{ at: "gap", dx: dx * k, y: eyeY + arc[i], text: glyph, ink }]));
  r.land(b);
  const burst: Mote[] = [
    { at: D, y: eyeY - 1, text: "\\ | /", ink: "gold" },
    { at: D, y: eyeY, text: "─ ✹ ─", ink: "crit" },
    { at: D, y: eyeY + 1, text: "/ | \\", ink: "gold" },
  ];
  const text = dmgText(b.dmg, b.crit);
  r.push(150, pair(A, {}, { eye: EYES.hurt, tint: "flash" }), [...burst, pop(D, text, "crit", false)], 1, {
    hd: { impact: { by: A, dmg: b.dmg, crit: b.crit, heavy: true, ranged: true } },
  });
  r.push(70, pair(A, {}, { x: k, eye: EYES.hurt, tint: "hurt" }), [
    { at: D, y: eyeY - 1, text: ".  ·  .", ink: "dim" },
    { at: D, y: eyeY + 1, text: "·  .  ·", ink: "dim" },
    pop(D, text, "crit", true),
  ], -1);
  r.push(60, {}, [pop(D, text, "dim", true)]);
  r.push(40);
}

function miss(r: Reel, b: Extract<Beat, { t: "miss" }>, eyeY: number): void {
  const A = b.by;
  const D = other(A);
  const k = dirOf(A);
  if (b.why === "blind") {
    r.push(60, pair(A, { x: k, eye: EYES.shock }, {}), [{ at: A, y: 1, text: "? ?", ink: "magenta" }]);
    r.reveal(b);
    r.push(120, pair(A, { x: 2 * k, eye: EYES.shock, tint: "magic" }, {}), [{ at: "gap", y: eyeY, text: "~", ink: "dim" }, pop(A, "miss", "dim", false)]);
    r.push(60, pair(A, { x: k }, {}), [pop(A, "miss", "dim", true)]);
    r.push(40);
    return;
  }
  r.push(50, pair(A, { x: -k, eye: EYES.attack }, {}));
  r.push(40, pair(A, { x: 2 * k, eye: EYES.attack }, {}));
  r.reveal(b);
  // The defender sidesteps out of reach.
  r.push(120, pair(A, { x: 4 * k, eye: EYES.attack }, { x: 2 * k, y: -1 }), [
    { at: "gap", dx: 2 * k, y: eyeY, text: "≈", ink: "dim" },
    pop(D, "dodge", "cyan", false),
  ]);
  r.push(70, pair(A, { x: 2 * k }, { x: k }), [pop(D, "dodge", "dim", true)]);
  r.push(40);
}

// ─── Support beats ──────────────────────────────────────────────────────────

const HEAL_MOTES: [number, number, string][][] = [
  [[-4, -2, "+"], [3, -3, "·"]],
  [[-4, -3, "·"], [3, -4, "+"], [0, -2, "+"]],
  [[3, 1, "·"], [0, -4, "·"], [-3, -1, "+"]],
];

function heal(r: Reel, b: Extract<Beat, { t: "heal" }>): void {
  const W = b.who;
  if (b.amount <= 0) return r.reveal(b);
  const quick = b.src === "leech" || b.src === "guard" || b.src === "drain";
  const text = `+${b.amount}`;
  if (quick) {
    r.land(b);
    r.push(90, { [W]: { tint: "heal" } }, [pop(W, text, "heal", false)]);
    r.push(60, {}, [pop(W, text, "green", true)]);
    return;
  }
  r.reveal(b);
  const from = r.hp;
  const to = b.hp;
  HEAL_MOTES.forEach((set, i) => {
    // Tween the bar up across the sparkle frames.
    const t = (i + 1) / HEAL_MOTES.length;
    r.hp = [Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t)];
    const motes: Mote[] = set.map(([dx, y, ch]) => ({ at: W, dx, y, text: ch, ink: "heal" }));
    motes.push(pop(W, text, "heal", i === HEAL_MOTES.length - 1));
    r.push(i === 1 ? 110 : 80, { [W]: { tint: i === 1 ? "heal" : undefined, eye: W === "hero" ? EYES.happy : undefined } }, motes);
  });
  r.land(b);
  r.push(50, {}, [pop(W, text, "dim", true)]);
}

function guard(r: Reel, b: Beat): void {
  r.reveal(b);
  r.push(70, { hero: { x: -1 } }, [{ at: "hero", y: 1, text: "GUARD", ink: "shield" }]);
  r.marks.guard = true;
  r.push(110, { hero: { tint: "glow" } }, [{ at: "hero", y: 0, text: "GUARD", ink: "blue" }]);
  r.push(40);
}

function buff(r: Reel, b: Extract<Beat, { t: "buff" }>): void {
  const W = b.who;
  r.reveal(b);
  const ink: Ink = b.label === "ENRAGED" ? "hurt" : b.label === "SHIELD" ? "shield" : b.label === "OBSERVED" ? "cyan" : "gold";
  const tint = b.label === "ENRAGED" ? "rage" : b.label === "SHIELD" ? undefined : "glow";
  const shake = b.label === "ENRAGED" ? 1 : 0;
  r.push(80, { [W]: { tint } }, [{ at: W, dx: -3, y: -2, text: "↑", ink }, { at: W, dx: 3, y: -1, text: "↑", ink }, pop(W, b.label, ink, false)], shake);
  if (b.label === "ENRAGED") r.marks.enraged = true;
  if (b.label === "SHIELD") r.marks.foeShield = true;
  if (b.label === "ATK↑") r.marks.buff = true;
  r.push(80, { [W]: { tint } }, [{ at: W, dx: -3, y: -3, text: "↑", ink }, { at: W, dx: 3, y: -2, text: "↑", ink }, pop(W, b.label, ink, true)], -shake);
  r.push(60, {}, [pop(W, b.label, "dim", true)]);
}

function status(r: Reel, b: Extract<Beat, { t: "status" }>): void {
  const W = b.who;
  r.reveal(b);
  if (b.fx === "stun") {
    if (r.marks.stun) {
      // Already seeing stars: the stunned foe just loses its turn.
      r.push(110, { [W]: { eye: EYES.stun } }, [{ at: W, y: 0, text: "z z", ink: "dim" }], 0, { tick: 1 });
      r.push(90, { [W]: { eye: EYES.stun } }, [{ at: W, dx: 1, y: 0, text: "z", ink: "dim" }], 0, { tick: 2 });
      return;
    }
    r.marks.stun = true;
    r.push(90, { [W]: { eye: EYES.stun, x: dirOf(other(W)) } }, [pop(W, "STUNNED", "yellow", false)], 0, { tick: 0 });
    r.push(90, { [W]: { eye: EYES.stun } }, [pop(W, "STUNNED", "yellow", true)], 0, { tick: 1 });
    r.push(60, {}, [], 0, { tick: 2 });
    return;
  }
  const [label, ink, tint] = b.fx === "poison" ? (["POISONED", "green", "poison"] as const) : (["CURSED", "magenta", "magic"] as const);
  r.push(90, { [W]: { tint, eye: EYES.hurt } }, [pop(W, label, ink, false)]);
  if (b.fx === "poison") r.marks.poison = true;
  else r.marks.blind = true;
  r.push(90, { [W]: { tint } }, [pop(W, label, ink, true)]);
  r.push(40);
}

function tickDmg(r: Reel, b: Extract<Beat, { t: "tick" }>): void {
  r.land(b);
  r.push(100, { [b.who]: { tint: "poison", eye: EYES.hurt } }, [pop(b.who, `-${b.dmg}`, "green", false)]);
  r.push(70, {}, [pop(b.who, `-${b.dmg}`, "dim", true)]);
}

function charge(r: Reel, b: Beat): void {
  r.reveal(b);
  for (let n = 1; n <= 3; n++) {
    r.marks.charge = n;
    r.push(n === 3 ? 160 : 100, { foe: { x: n === 3 ? 2 : 1, eye: EYES.attack, tint: n % 2 ? "glow" : "rage" } }, [], n === 3 ? 1 : 0);
  }
  r.push(50, { foe: { x: 1 } });
}

function interrupt(r: Reel, b: Beat): void {
  r.reveal(b);
  r.marks.charge = 0;
  r.push(110, { foe: { tint: "flash", eye: EYES.stun } }, [{ at: "foe", y: 1, text: "✕ ✕ ✕", ink: "hurt" }, { at: "foe", y: 0, text: "INTERRUPTED", ink: "crit" }], 1);
  r.push(80, { foe: { x: 1 } }, [{ at: "foe", y: 0, text: "·  ·  ·", ink: "dim" }], -1);
}

function thorns(r: Reel, b: Extract<Beat, { t: "thorns" }>, eyeY: number): void {
  r.push(40, {}, [{ at: "gap", dx: -1, y: eyeY, text: ">>", ink: "yellow" }]);
  r.land(b);
  r.push(90, { foe: { tint: "hurt" } }, [{ at: "gap", dx: 2, y: eyeY, text: "*", ink: "gold" }, pop("foe", `-${b.dmg}`, "yellow", false)], 0, {
    hd: { impact: { by: "hero", dmg: b.dmg, crit: false, heavy: false, ranged: true } },
  });
  r.push(50, {}, [pop("foe", `-${b.dmg}`, "dim", true)]);
}

function secondWind(r: Reel, b: Beat): void {
  r.land(b);
  r.push(140, { hero: { tint: "flash", eye: EYES.shock } }, [pop("hero", "SECOND WIND", "crit", false)], 1);
  r.push(120, { hero: { tint: "glow" } }, [pop("hero", "SECOND WIND", "gold", true)]);
  r.push(50);
}

function grow(r: Reel, b: Extract<Beat, { t: "grow" }>): void {
  r.land(b);
  r.push(90, { foe: { tint: "magic" } }, [{ at: "foe", dx: -4, y: -2, text: "+", ink: "magenta" }, { at: "foe", dx: 4, y: -3, text: "+", ink: "magenta" }, pop("foe", `+${b.amount} max`, "magenta", false)]);
  r.push(90, { foe: { tint: "magic" } }, [{ at: "foe", dx: -4, y: -3, text: "·", ink: "magenta" }, { at: "foe", dx: 4, y: -4, text: "·", ink: "magenta" }, pop("foe", `+${b.amount} max`, "magenta", true)]);
}

function sprout(r: Reel, b: Extract<Beat, { t: "sprout" }>): void {
  r.reveal(b);
  r.push(100, { foe: { tint: "magic", x: 1 } }, [pop("foe", `${b.heads} HEADS`, "magenta", false)], 1);
  r.push(80, { foe: { tint: "magic" } }, [pop("foe", `${b.heads} HEADS`, "magenta", true)], -1);
}

function speech(r: Reel, b: Extract<Beat, { t: "speech" }>): void {
  if (b.phase) r.hintNext({ phase: true });
  r.reveal(b);
  r.push(120, { foe: { eye: EYES.attack, x: -1 } }, [{ at: "foe", y: 1, text: "◣", ink: "white" }]);
  r.push(380, { foe: { eye: EYES.attack } }, [{ at: "foe", y: 1, text: "◣", ink: "white" }]);
}

function flee(r: Reel, b: Extract<Beat, { t: "flee" }>): void {
  r.reveal(b);
  if (!b.ok) {
    r.push(60, { hero: { x: -2, eye: EYES.shock } }, [{ at: "hero", dx: 6, y: -1, text: "~", ink: "dim" }]);
    r.push(70, { hero: { x: -3, eye: EYES.shock } }, [{ at: "hero", dx: 6, y: -1, text: "~ ~", ink: "dim" }]);
    r.push(110, { hero: { x: -1, eye: EYES.hurt } }, [pop("hero", "blocked!", "red", false)], 1);
    r.push(60, {}, [pop("hero", "blocked!", "dim", true)]);
    return;
  }
  [-1, -3, -6, -10, -15, -21].forEach((x, i) =>
    r.push(45, { hero: { x, eye: EYES.shock, act: "walk" } }, [{ at: "hero", dx: 6, y: -1, text: i % 2 ? "~ ." : ". ~", ink: "dim" }]),
  );
  r.push(80, { hero: { hidden: true }, foe: { eye: EYES.shock } }, [{ at: "foe", y: 1, text: "?", ink: "yellow" }]);
}

const CONFETTI = ["*", "+", "·", "✦", "°"];
const CONFETTI_INK: Ink[] = ["gold", "magenta", "cyan", "green", "yellow"];

function ko(r: Reel, b: Extract<Beat, { t: "ko" }>, width: number, seed: number): void {
  const L = b.who;
  const W = other(L);
  r.land(b);
  for (let i = 0; i < 3; i++) {
    r.push(70, { [L]: { eye: EYES.ko, tint: i % 2 ? undefined : "flash" } }, [], i === 0 ? 1 : 0);
    r.push(50, { [L]: { eye: EYES.ko, tint: "hurt" } });
  }
  r.push(90, { [L]: { eye: EYES.ko, sink: 1, tint: "dim" } }, [{ at: L, y: -1, text: ". ˙ .", ink: "dim" }]);
  r.marks.over = L === "foe" ? "win" : "lose";
  r.marks.charge = 0;
  r.marks.stun = false;
  r.marks.guard = false;
  r.push(110, { [L]: { eye: EYES.ko, sink: 2, tint: "dim" } }, [{ at: L, y: -1, text: "˙ . ˙", ink: "dim" }]);
  // The winner hops; confetti rains on a hero win.
  const rng = mulberry32(seed);
  const rain = (row: number): Mote[] =>
    L === "foe"
      ? Array.from({ length: 6 }, () => ({
          at: "abs" as const,
          dx: Math.floor(rng() * width),
          y: row + Math.floor(rng() * 2),
          text: CONFETTI[Math.floor(rng() * CONFETTI.length)],
          ink: CONFETTI_INK[Math.floor(rng() * CONFETTI_INK.length)],
        }))
      : [];
  const winEye = W === "hero" ? EYES.happy : EYES.attack;
  const done = { [L]: { eye: EYES.ko, sink: 2, tint: "dim" as const } };
  r.push(90, { ...done, [W]: { y: -1, eye: winEye } }, rain(0));
  r.push(90, { ...done, [W]: { eye: winEye } }, rain(1));
  r.push(90, { ...done, [W]: { y: -1, eye: winEye } }, rain(2));
  r.push(120, { ...done, [W]: { eye: winEye } }, rain(3));
}

// ─── Entry points ───────────────────────────────────────────────────────────

/** Stage geometry the director needs (avoids a Stage dependency for tests). */
export interface Geometry {
  width: number;
  eyeY: number;
}

/** Choreograph the turn that took `prev` to `next`. */
export function direct(prev: Battle, next: Battle, g: Geometry): Cue[] {
  const beats = next.beats ?? [];
  const start = marksOf(prev);
  // Guard lasts exactly one turn; the over state only lands with the KO.
  const r = new Reel([prev.hero.hp, prev.foe.hp], { ...start, guard: false, over: undefined }, 0);
  beats.forEach((b, i) => {
    switch (b.t) {
      case "strike": {
        // A flurry: consecutive multi-style strikes by one side (leech
        // heals ride along between them without breaking the run).
        const sameRun = (j: number) => {
          const o = beats[j];
          return o?.t === "strike" && o.by === b.by;
        };
        const step = (j: number, d: number) => {
          while (beats[j]?.t === "heal" && (beats[j] as { src?: string }).src === "leech") j += d;
          return j;
        };
        let chain = 0;
        if (b.style === "multi") for (let j = step(i - 1, -1); sameRun(j); j = step(j - 1, -1)) chain++;
        const n = step(i + 1, 1);
        const continues = sameRun(n) && (beats[n] as { style?: string }).style === "multi";
        return strike(r, b, { chain, last: !continues }, g.eyeY);
      }
      case "miss":
        return miss(r, b, g.eyeY);
      case "heal":
        return heal(r, b);
      case "guard":
        return guard(r, b);
      case "buff":
        return buff(r, b);
      case "status":
        return status(r, b);
      case "tick":
        return tickDmg(r, b);
      case "charge":
        return charge(r, b);
      case "interrupt":
        return interrupt(r, b);
      case "thorns":
        return thorns(r, b, g.eyeY);
      case "secondwind":
        return secondWind(r, b);
      case "grow":
        return grow(r, b);
      case "sprout":
        return sprout(r, b);
      case "speech":
        return speech(r, b);
      case "special":
        return r.hintNext({ cutin: { name: b.name, by: "hero" } });
      case "flee":
        return flee(r, b);
      case "ko":
        return ko(r, b, g.width, (next.seed ^ next.turn) >>> 0);
    }
  });
  // Land exactly on the resting screen.
  r.hp = [next.hero.hp, next.foe.hp];
  r.lines = next.log.length;
  r.marks = marksOf(next);
  r.push(60, {}, afterglow(next));
  return r.cues;
}

/** The turn's damage totals, floating over each side — the last frame of
 *  the animation and the static (hook) screen both show them. */
export function afterglow(b: Battle): Mote[] {
  const out: Mote[] = [];
  for (const side of ["hero", "foe"] as const) {
    // Damage *taken* by this side = hits by the other side.
    const hits = (b.hits ?? []).filter((h) => h.by !== side);
    if (!hits.length) continue;
    const dmg = hits.reduce((a, h) => a + h.dmg, 0);
    const crit = hits.some((h) => h.crit);
    out.push(
      dmg === 0
        ? { at: side, y: 0, text: "miss", ink: "dim" }
        : { at: side, y: 0, text: `${crit ? "CRIT " : ""}-${dmg}`, ink: crit ? "crit" : side === "foe" ? "hurt" : "red" },
    );
  }
  return out;
}

/** The encounter: a diagonal wipe, the foe slides in (a boss drops from
 *  above), the hero steps up, a `!` of surprise. */
export function directIntro(b: Battle, g: Geometry & { height: number }): Cue[] {
  const r = new Reel([b.hero.hp, b.foe.hp], marksOf(b), 0);
  const hidden = { hero: { hidden: true }, foe: { hidden: true } };
  const sweep = g.width + 2 * g.height + 9;
  for (let i = 0; i <= 6; i++) r.push(40, hidden, [], 0, { wipe: Math.round((sweep * i) / 6) });
  const boss = !!b.foe.boss;
  const steps = boss
    ? [
        { foe: { y: -6 }, hero: { x: -12, act: "walk" as const } },
        { foe: { y: -4 }, hero: { x: -7, act: "walk" as const } },
        { foe: { y: -2 }, hero: { x: -3, act: "walk" as const } },
        { foe: { y: 0, tint: "flash" as const }, hero: { x: -1, eye: EYES.shock } },
      ]
    : [
        { foe: { x: 16, act: "walk" as const }, hero: { x: -12, act: "walk" as const } },
        { foe: { x: 9, act: "walk" as const }, hero: { x: -7, act: "walk" as const } },
        { foe: { x: 4, act: "walk" as const }, hero: { x: -3, act: "walk" as const } },
        { foe: { x: 1, act: "walk" as const }, hero: { x: -1, act: "walk" as const } },
      ];
  steps.forEach((s, i) => r.push(i === 3 && boss ? 140 : 55, s, [], i === 3 && boss ? 1 : 0));
  if (boss) r.push(90, { foe: { eye: EYES.attack } }, [{ at: "foe", y: 0, text: "♛ BOSS ♛", ink: "gold" }], -1);
  r.push(110, { hero: { eye: EYES.shock, y: -1 }, foe: { eye: EYES.attack } }, [{ at: "hero", y: 0, text: "!", ink: "gold" }]);
  r.push(90, { hero: { eye: EYES.shock }, foe: { eye: EYES.attack } }, [{ at: "hero", y: 1, text: "!", ink: "gold" }]);
  // Then the log types in, a line at a time.
  for (let n = 1; n <= b.log.length; n++) {
    r.lines = n;
    r.push(70);
  }
  r.lines = b.log.length;
  return r.cues;
}

/** Resting loop for an idle screen: breathe, blink, orbit the stun stars,
 *  pulse the charge. */
export function ambient(b: Battle): StageState[] {
  const marks = marksOf(b);
  const seq: (0 | 1 | "blink")[] = [0, 1, 0, "blink"];
  return seq.map((frame, i) => ({
    hero: marks.over === "fled" ? undefined : { frame },
    foe: { frame: i % 2 ? 0 : 1 },
    marks,
    tick: i,
  }));
}
