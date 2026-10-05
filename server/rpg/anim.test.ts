import { describe, expect, test } from "bun:test";
import { displayWidth } from "../art";
import { mulberry32, type BuddyStats } from "../engine";
import { afterglow, ambient, direct, directIntro } from "./anim";
import { act, makeBoss, makeMonster, startBattle, type Action, type Battle, type Beat } from "./battle";
import { ZONES } from "./data";
import { execute, type BuddyCtx } from "./game";
import { deriveHero } from "./hero";
import {
  actionBar,
  bannerFrames,
  defaultSpeed,
  diffPaint,
  fightActions,
  nextSpeed,
  revealFrames,
  scaleFrames,
  shimmerFrames,
} from "./playkit";
import { battleFrames, battleScreen, stageGeometry } from "./render";
import { Canvas, stageFor } from "./stage";
import { freshState } from "./store";

const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const CTX: BuddyCtx = { name: "Pip", species: "cat", eye: "·", hat: "wizard", level: 1, prestige: 0, stats: STATS };
const T0 = Date.UTC(2026, 9, 5, 12);
const PLAIN = { color: false };
const COLOR = { color: true };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function fight(foe = makeMonster(ZONES[0].monsters[2], 3), seed = 9): Battle {
  const h = deriveHero(1, 0, STATS, {}, [], CTX.species);
  return startBattle("explore", 1, 1, h, h.maxHp, foe, seed);
}

/** A fight the hero can't lose and the foe can't dodge. */
function sure(foe = makeMonster(ZONES[0].monsters[2], 3)): Battle {
  const b = fight(foe);
  b.hero.hp = b.hero.maxHp = 5000;
  b.hero.spd = 200;
  b.foe.spd = 0;
  return b;
}

const kinds = (b: Battle) => (b.beats ?? []).map((x) => x.t);

// ─── Beats ──────────────────────────────────────────────────────────────────

describe("beats", () => {
  test("strikes and misses mirror the hit list for plain attacks", () => {
    let b = fight();
    for (let i = 0; i < 6 && !b.over; i++) {
      b = act(b, { type: "attack" });
      const swings = (b.beats ?? []).filter((x) => x.t === "strike" || x.t === "miss");
      expect(swings.length).toBe(b.hits!.length);
    }
  });

  test("every action type is visible", () => {
    const cases: [Action, Beat["t"]][] = [
      [{ type: "attack" }, "strike"],
      [{ type: "defend" }, "guard"],
      [{ type: "skill", id: "refactor" }, "buff"],
      [{ type: "item", id: "bomb" }, "strike"],
      [{ type: "flee" }, "flee"],
    ];
    for (const [a, t] of cases) expect(kinds(act(sure(), a))).toContain(t);
    const hurt = sure();
    hurt.hero.hp = 100;
    expect(kinds(act(hurt, { type: "skill", id: "hotfix" }))).toContain("heal");
    expect(kinds(act(hurt, { type: "item", id: "potion" }))).toContain("heal");
  });

  test("beats point at real log lines and carry sane HP", () => {
    let b = fight();
    for (let i = 0; i < 8 && !b.over; i++) {
      b = act(b, { type: i % 3 === 2 ? "defend" : "attack" });
      for (const x of b.beats ?? []) {
        expect(x.line).toBeLessThan(b.log.length);
        expect(x.hp[0]).toBeGreaterThanOrEqual(0);
        expect(x.hp[1]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("a boss wind-up is a charge beat, and Breakpoint interrupts it", () => {
    let b = sure(makeBoss("semicolon", 6));
    b.foe.hp = b.foe.maxHp = 100000;
    while (!b.foe.charge) b = act(b, { type: "defend" });
    expect(kinds(b)).toContain("charge");
    b = act(b, { type: "skill", id: "breakpoint" });
    expect(kinds(b)).toContain("interrupt");
    expect(kinds(b)).toContain("status");
  });

  test("the fight ends on a KO beat", () => {
    let b = sure();
    while (!b.over) b = act(b, { type: "attack" });
    expect(b.beats!.at(-1)).toMatchObject({ t: "ko", who: "foe" });
  });

  test("records the HP each side started the turn with", () => {
    const b0 = fight();
    const b1 = act(b0, { type: "attack" });
    expect(b1.was).toEqual([b0.hero.hp, b0.foe.hp]);
  });
});

// ─── Direction ──────────────────────────────────────────────────────────────

function turnFrames(prev: Battle, a: Action, color = false) {
  const next = act(prev, a);
  const cues = direct(prev, next, stageGeometry(next, CTX));
  return { next, cues, frames: battleFrames({ color }, next, CTX, ["strike"], {}, cues) };
}

describe("director", () => {
  const actions: Action[] = [
    { type: "attack" },
    { type: "defend" },
    { type: "skill", id: "strike" },
    { type: "skill", id: "forkbomb" },
    { type: "skill", id: "duck" },
    { type: "item", id: "bomb" },
    { type: "item", id: "potion" },
    { type: "flee" },
  ];

  test("every frame of a turn is the static screen's size and it lands on it", () => {
    for (const a of actions) {
      const prev = act(sure(), { type: "attack" });
      prev.hero.hp = 3000;
      const { next, frames } = turnFrames(prev, a);
      const still = battleScreen(PLAIN, next, CTX, ["strike"], {});
      const h = still.split("\n").length;
      expect(frames.length).toBeGreaterThan(2);
      for (const f of frames) expect(f.text.split("\n").length).toBe(h);
      expect(frames.at(-1)!.text).toBe(still);
    }
  });

  test("log lines are revealed in order and all by the end", () => {
    const prev = fight();
    const { next, cues } = turnFrames(prev, { type: "attack" });
    let seen = 0;
    for (const c of cues) {
      expect(c.lines).toBeGreaterThanOrEqual(seen);
      seen = c.lines;
      expect(c.ms).toBeGreaterThan(0);
    }
    expect(seen).toBe(next.log.length);
    // The first frames come before the narration.
    expect(cues[0].lines).toBe(0);
  });

  test("HP bars only reach the new totals once the blow lands", () => {
    const prev = sure();
    const { next, cues } = turnFrames(prev, { type: "attack" });
    expect(cues[0].hp[1]).toBe(prev.foe.hp);
    expect(cues.at(-1)!.hp).toEqual([next.hero.hp, next.foe.hp]);
  });

  test("a KO turn ends in the KO pose with the fight-over marks", () => {
    let prev = sure();
    let next = act(prev, { type: "attack" });
    while (!next.over) {
      prev = next;
      next = act(prev, { type: "attack" });
    }
    const cues = direct(prev, next, stageGeometry(next, CTX));
    expect(cues.at(-1)!.stage.marks?.over).toBe("win");
    expect(cues.some((c) => c.stage.foe?.sink)).toBe(true);
  });

  test("color frames carry escapes, plain frames never do", () => {
    const prev = fight();
    expect(turnFrames(prev, { type: "attack" }, true).frames.some((f) => f.text.includes("\x1b["))).toBe(true);
    for (const f of turnFrames(prev, { type: "attack" }, false).frames) expect(f.text).not.toContain("\x1b");
  });

  test("the intro wipes in and ends on the full log", () => {
    for (const b of [fight(), fight(makeBoss("lich", 11))]) {
      const cues = directIntro(b, stageGeometry(b, CTX));
      expect(cues.some((c) => c.stage.wipe !== undefined)).toBe(true);
      expect(cues.at(-1)!.lines).toBe(b.log.length);
      const h = battleScreen(PLAIN, b, CTX, [], {}).split("\n").length;
      for (const f of battleFrames(PLAIN, b, CTX, [], {}, cues)) expect(f.text.split("\n").length).toBe(h);
    }
  });

  test("the ambient loop keeps the size and blinks", () => {
    const b = fight();
    const loop = ambient(b);
    expect(loop.some((s) => s.hero?.frame === "blink")).toBe(true);
    const st = stageFor(b, CTX);
    for (const s of loop) {
      const lines = st.render(s, false);
      expect(lines.length).toBe(st.height);
      for (const l of lines) expect(displayWidth(l)).toBe(st.width);
    }
  });

  test("the static screen shows this turn's damage and an HP ghost", () => {
    const next = act(sure(), { type: "attack" });
    const out = battleScreen(PLAIN, next, CTX, [], {});
    const dealt = next.hits!.filter((h) => h.by === "hero").reduce((a, h) => a + h.dmg, 0);
    expect(afterglow(next).some((m) => m.text.includes(`-${dealt}`))).toBe(true);
    expect(out).toContain(`-${dealt}`);
    expect(out).toContain("▓");
  });
});

// ─── Stage ──────────────────────────────────────────────────────────────────

describe("stage", () => {
  test("renders a fixed-size grid whatever the actors do", () => {
    const st = stageFor(fight(makeBoss("hydra", 8)), CTX);
    const states = [
      {},
      { hero: { x: 40 }, foe: { x: -40 } },
      { hero: { y: -9 }, foe: { sink: 9 } },
      { shake: 1, motes: [{ at: "foe" as const, y: 0, text: "✦CRIT -999✦", ink: "crit" as const }] },
      { wipe: 12 },
    ];
    for (const s of states) {
      for (const color of [false, true]) {
        const lines = st.render(s, color);
        expect(lines.length).toBe(st.height);
        for (const l of lines) expect(displayWidth(l)).toBe(st.width);
      }
    }
  });

  test("the canvas never splits a wide glyph", () => {
    const cv = new Canvas(6, 1);
    cv.put(0, 0, "☕☕☕");
    cv.put(1, 0, "x");
    const [line] = cv.lines(false);
    expect(displayWidth(line)).toBe(6);
    expect(line.startsWith(" x")).toBe(true);
  });

  test("the canvas parses ANSI art into styled cells", () => {
    const cv = new Canvas(4, 1);
    cv.put(0, 0, "\x1b[31mab\x1b[0mc");
    expect(strip(cv.lines(true)[0])).toBe("abc ");
    expect(cv.lines(true)[0]).toContain("\x1b[31m");
    expect(cv.lines(false)[0]).toBe("abc ");
  });
});

// ─── Game wiring ────────────────────────────────────────────────────────────

describe("game wiring", () => {
  test("starting a fight in the TUI plays an intro and offers a loop", () => {
    const s = freshState(T0);
    s.seen = [0];
    s.lastEvent = true;
    const r = execute(s, CTX, ";x", T0, { color: true, anim: true });
    expect(s.battle).not.toBeNull();
    expect(r.anim!.length).toBeGreaterThan(5);
    expect(r.anim!.at(-1)!.text).toBe(r.out);
    expect(r.loop?.frames.length).toBe(4);
  });

  test("the town screen breathes in the TUI", () => {
    const s = freshState(T0);
    s.seen = [0];
    const r = execute(s, CTX, ";", T0, { color: true, anim: true });
    expect(r.loop?.frames[0]).toBe(r.out);
  });

  test("the hook path bakes nothing", () => {
    const s = freshState(T0);
    s.seen = [0];
    s.lastEvent = true;
    const r = execute(s, CTX, ";x", T0, PLAIN);
    expect(r.anim).toBeUndefined();
    expect(r.loop).toBeUndefined();
    expect(COLOR.color).toBe(true);
  });
});

// ─── Player kit ─────────────────────────────────────────────────────────────

describe("playkit", () => {
  test("speed: off drops frames, fast is quicker, cycles back round", () => {
    const f = [{ text: "a", ms: 100 }];
    expect(scaleFrames(f, "off")).toEqual([]);
    expect(scaleFrames(f, "fast")[0].ms).toBeLessThan(100);
    expect(scaleFrames(f, "cinematic")[0].ms).toBeGreaterThan(100);
    let s = nextSpeed("normal");
    for (let i = 0; i < 3; i++) s = nextSpeed(s);
    expect(s).toBe("normal");
  });

  test("speed default follows game feel; reduced motion wins", () => {
    expect(defaultSpeed(undefined, "full")).toBe("normal");
    expect(defaultSpeed(undefined, "subtle")).toBe("fast");
    expect(defaultSpeed(undefined, "off")).toBe("off");
    expect(defaultSpeed("cinematic", "off")).toBe("cinematic");
    expect(defaultSpeed("cinematic", "full", { BUDDY_REDUCED_MOTION: "1" })).toBe("off");
    expect(defaultSpeed("bogus", "full")).toBe("normal");
  });

  test("the painter rewrites only changed rows, atomically", () => {
    expect(diffPaint(["a", "b"], ["a", "b"])).toBe("");
    const d = diffPaint(["a", "b", "c"], ["a", "X"]);
    expect(d.startsWith("\x1b[?2026h")).toBe(true);
    expect(d).toContain("\x1b[2;1HX");
    expect(d).not.toContain("\x1b[1;1H");
    expect(d).toContain("\x1b[3;1H\x1b[J");
  });

  test("the action bar lists the fight's options with cooldowns and blocks", () => {
    const s = freshState(T0);
    s.battle = fight(makeBoss("lich", 11));
    s.battle.hero.cd.strike = 2;
    s.skills = ["strike", "hotfix"];
    s.items = { potion: 2, smoke: 1 };
    const acts = fightActions(s);
    expect(acts.map((a) => a.cmd)).toEqual([";a", ";d", ";s1", ";s2", ";i potion", ";i smoke", ";f"]);
    expect(acts.find((a) => a.cmd === ";s1")!.blocked).toBe("cooldown 2");
    expect(acts.find((a) => a.cmd === ";f")!.blocked).toBeTruthy();
    const bar = actionBar(acts, 2, 30, false);
    expect(bar.join("\n")).toContain("[Power Strike(2)]");
    expect(bar.at(-1)).toContain("cooldown 2");
    for (const l of bar.slice(0, -1)) expect(displayWidth(l)).toBeLessThanOrEqual(30);
  });

  test("reveals end on the full text; shimmer and banners end clean", () => {
    const r = revealFrames("BASE", ["one", "[L] Sword", ""]);
    expect(r.at(-1)!.text).toBe("BASE\none\n[L] Sword\n");
    expect(r.length).toBeGreaterThan(4);
    expect(shimmerFrames("\x1b[33mloot\x1b[0m", "1;33").at(-1)!.text).toBe("\x1b[33mloot\x1b[0m");
    const bf = bannerFrames("V I C", "1;32", 20);
    expect(strip(bf.at(-1)!.text).trim()).toBe("V I C");
    expect(strip(bf[0].text).trim().length).toBeLessThan(5);
  });
});

describe("layout stability", () => {
  test("a wind-up turn never changes the panel width mid-animation", () => {
    let b = sure(makeBoss("semicolon", 6));
    b.foe.hp = b.foe.maxHp = 100000;
    let next = act(b, { type: "defend" });
    while (!next.foe.charge) {
      b = next;
      next = act(b, { type: "defend" });
    }
    const cues = direct(b, next, stageGeometry(next, CTX));
    const widths = new Set(battleFrames(PLAIN, next, CTX, [], {}, cues).map((f) => displayWidth(f.text.split("\n")[0])));
    expect(widths.size).toBe(1);
  });
});

describe("sweep", () => {
  test("random turns across species and bosses always land on the final screen", () => {
    const rng = mulberry32(11);
    const cmds = [";a", ";a", ";d", ";s1", ";s2", ";s3", ";s4", ";s5", ";s6", ";s7", ";i potion", ";i bomb", ";f"];
    const P = { color: true, anim: true };
    for (const species of ["cat", "wyvern", "snail", "sparkit"] as const) {
      for (const z of [1, 4, 6]) {
        const ctx: BuddyCtx = { ...CTX, species, level: 10 * z };
        const s = freshState(T0);
        s.seen = [0, 1, 2, 3, 4, 5, 6];
        s.unlocked = s.zone = z;
        s.floors = { [z]: 5 };
        s.items = { potion: 9, bomb: 9 };
        s.skills = ["strike", "hotfix", "refactor", "breakpoint", "duck", "gc", "forkbomb"];
        execute(s, ctx, ";boss", T0, P);
        for (let t = 0; t < 25 && s.battle; t++) {
          const r = execute(s, ctx, cmds[Math.floor(rng() * cmds.length)], T0, P);
          const fr = r.anim ?? [];
          if (!fr.length) continue;
          const first = fr[0].text.split("\n");
          for (const f of fr) {
            const lines = f.text.split("\n");
            expect(lines.length).toBe(first.length);
            expect(displayWidth(lines[0])).toBe(displayWidth(first[0]));
          }
          expect(r.out.startsWith(fr.at(-1)!.text)).toBe(true);
        }
      }
    }
  });
});
