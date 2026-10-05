import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mulberry32, type BuddyStats } from "../engine";
import {
  act,
  actionError,
  makeBoss,
  makeMonster,
  startBattle,
  towerFoe,
  type Battle,
} from "./battle";
import { ENERGY_MAX, ENERGY_REGEN_MIN, INVENTORY_CAP, RARITY_AFFIXES, ZONES } from "./data";
import { execute, hudLine, onCommit, parse, shopStock, type BuddyCtx } from "./game";
import { gearScore, rollGear, sellValue } from "./gear";
import { deriveHero, trainCost, trainError } from "./hero";
import { coerceState, freshState, settle, type RpgState } from "./store";

const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const CTX: BuddyCtx = {
  name: "Pip",
  species: "cat",
  eye: "·",
  hat: "none",
  level: 1,
  prestige: 0,
  stats: STATS,
};
const T0 = Date.UTC(2026, 9, 5, 12);
const P = { color: false };

function hero(level = 1) {
  return deriveHero(level, 0, STATS, {}, []);
}

function fight(foe = makeMonster(ZONES[0].monsters[0], 1), seed = 1): Battle {
  const h = hero();
  return startBattle("explore", 1, 1, h, h.maxHp, foe, seed);
}

// ─── Battle engine ──────────────────────────────────────────────────────────

describe("battle engine", () => {
  test("is deterministic for the same seed and actions", () => {
    const run = () => {
      let b = fight(makeMonster(ZONES[0].monsters[2], 3), 42);
      for (let i = 0; i < 4 && !b.over; i++) b = act(b, { type: "attack" });
      return b;
    };
    expect(run()).toEqual(run());
  });

  test("act never mutates its input", () => {
    const b = fight();
    const snap = structuredClone(b);
    act(b, { type: "attack" });
    expect(b).toEqual(snap);
  });

  test("a level-1 hero beats a floor-1 monster by attacking", () => {
    let b = fight();
    while (!b.over) b = act(b, { type: "attack" });
    expect(b.over).toBe("win");
    expect(b.foe.hp).toBe(0);
  });

  test("an overmatched hero gets knocked out", () => {
    let b = fight(makeMonster(ZONES[5].monsters[0], 30));
    while (!b.over) b = act(b, { type: "attack" });
    expect(b.over).toBe("lose");
    expect(b.hero.hp).toBe(0);
  });

  test("skills go on cooldown and are rejected until it expires", () => {
    let b = fight(makeMonster(ZONES[0].monsters[2], 5));
    b = act(b, { type: "skill", id: "strike" });
    expect(b.hero.cd.strike).toBe(2);
    expect(actionError(b, { type: "skill", id: "strike" })).toContain("cooldown");
    b = act(b, { type: "attack" });
    b = act(b, { type: "attack" });
    expect(actionError(b, { type: "skill", id: "strike" })).toBeNull();
  });

  test("bosses cannot be fled or smoked", () => {
    const b = fight(makeBoss("semicolon", 6));
    expect(actionError(b, { type: "flee" })).toContain("no escape");
    expect(actionError(b, { type: "item", id: "smoke" })).toContain("no escape");
  });

  test("the Missing Semicolon telegraphs on turn 2 and defending blunts the blow", () => {
    let b = fight(makeBoss("semicolon", 6), 7);
    b.hero.hp = b.hero.maxHp = 10_000; // survive to observe
    b = act(b, { type: "attack" });
    b = act(b, { type: "attack" });
    expect(b.foe.charge).toBe(1);
    b.hero.hp = 5_000; // room for the defend heal
    const guarded = act(b, { type: "defend" });
    const open = act(b, { type: "attack" });
    expect(guarded.foe.charge).toBe(0);
    const tookGuarded = b.hero.hp - guarded.hero.hp + Math.round(b.hero.maxHp * 0.05);
    const tookOpen = b.hero.hp - open.hero.hp;
    expect(tookGuarded).toBeLessThan(tookOpen);
  });

  test("Breakpoint interrupts a boss wind-up", () => {
    let b = fight(makeBoss("semicolon", 6), 11);
    b.hero.hp = b.hero.maxHp = 10_000;
    b = act(b, { type: "attack" });
    b = act(b, { type: "attack" });
    expect(b.foe.charge).toBe(1);
    // Force the hit to land: Rubber Duck can't miss, but Breakpoint can — retry seeds.
    let hit: Battle | null = null;
    for (let s = 0; s < 20 && !hit; s++) {
      const n = act({ ...b, seed: s }, { type: "skill", id: "breakpoint" });
      if (n.log.some((l) => l.includes("interrupted"))) hit = n;
    }
    expect(hit).not.toBeNull();
    expect(hit!.foe.charge).toBe(0);
    expect(hit!.log.some((l) => l.includes("is stunned"))).toBe(true);
  });

  test("defending observes the Heisenbug so it can't dodge", () => {
    let b = fight(makeBoss("heisenbug", 18), 3);
    b.hero.hp = b.hero.maxHp = 10_000;
    b = act(b, { type: "defend" });
    expect(b.foe.fx.revealed).toBeGreaterThan(0);
  });

  test("the Leaky Golem's growth is capped at 2× its starting HP", () => {
    let b = fight(makeBoss("golem", 22), 5);
    const start = b.foe.maxHp;
    b.hero.hp = b.hero.maxHp = 1e9;
    b.hero.def = 1e6;
    for (let i = 0; i < 80; i++) b = act(b, { type: "defend" });
    expect(b.foe.maxHp).toBe(start * 2);
  });

  test("tower floors scale and every 10th floor is a boss", () => {
    const r = mulberry32(1);
    expect(towerFoe(10, r).boss).toBeDefined();
    expect(towerFoe(5, r).name.startsWith("Elite")).toBe(true);
    expect(towerFoe(3, r).level).toBeLessThan(towerFoe(13, r).level);
  });
});

// ─── Gear & hero ────────────────────────────────────────────────────────────

describe("gear", () => {
  test("rolls are deterministic and respect the rarity floor", () => {
    const a = rollGear(mulberry32(9), 10, 1, { floor: "rare" });
    const b = rollGear(mulberry32(9), 10, 1, { floor: "rare" });
    expect(a).toEqual(b);
    for (let i = 0; i < 50; i++) {
      const g = rollGear(mulberry32(i), 10, i, { floor: "epic" });
      expect(["epic", "legendary"]).toContain(g.rarity);
    }
  });

  test("higher rarity carries more affixes and more value", () => {
    const common = rollGear(mulberry32(1), 10, 1, { slot: "weapon", rarity: "common" });
    const legend = rollGear(mulberry32(1), 10, 2, { slot: "weapon", rarity: "legendary" });
    expect(Object.keys(legend.stats).length).toBeGreaterThan(Object.keys(common.stats).length);
    expect(RARITY_AFFIXES.legendary).toBe(4);
    expect(gearScore(legend)).toBeGreaterThan(gearScore(common));
    expect(sellValue(legend)).toBeGreaterThan(sellValue(common));
  });
});

describe("hero", () => {
  test("buddy level, prestige, training and gear all raise power", () => {
    const base = deriveHero(1, 0, STATS, {}, []);
    expect(deriveHero(5, 0, STATS, {}, []).atk).toBeGreaterThan(base.atk);
    expect(deriveHero(1, 1, STATS, {}, []).level).toBe(21);
    expect(deriveHero(1, 0, STATS, { atk: 3 }, []).atk).toBe(base.atk + 6);
    const sword = rollGear(mulberry32(1), 5, 1, { slot: "weapon", rarity: "common" });
    expect(deriveHero(1, 0, STATS, {}, [sword]).atk).toBe(base.atk + sword.stats.atk!);
  });

  test("training costs grow and validate", () => {
    expect(trainCost(5)).toBeGreaterThan(trainCost(0));
    expect(trainError({}, "luck", 999)).toContain("Unknown");
    expect(trainError({}, "atk", 0)).toContain("Need");
    expect(trainError({}, "atk", 999)).toBeNull();
  });
});

// ─── State ──────────────────────────────────────────────────────────────────

describe("state", () => {
  test("energy regenerates one point per interval and caps", () => {
    const s = freshState(T0);
    s.energy = 2;
    s.energyAt = T0;
    settle(s, T0 + ENERGY_REGEN_MIN * 60_000 * 3 + 1000, 100);
    expect(s.energy).toBe(5);
    settle(s, T0 + 1e9, 100);
    expect(s.energy).toBe(ENERGY_MAX);
  });

  test("HP regenerates out of combat but not mid-fight", () => {
    const s = freshState(T0);
    s.hp = 10;
    s.hpAt = T0;
    settle(s, T0 + 2 * 60_000, 100); // 2 min × 5% × 100
    expect(s.hp).toBe(20);
    s.battle = fight();
    settle(s, T0 + 60 * 60_000, 100);
    expect(s.hp).toBe(20);
  });

  test("coerceState repairs garbage", () => {
    const s = coerceState({ gold: "lots", energy: 99, items: { potion: -4, bomb: 2 }, bag: "x" }, T0);
    expect(s.gold).toBe(30);
    expect(s.energy).toBe(ENERGY_MAX);
    expect(s.items).toEqual({ bomb: 2 });
    expect(s.bag).toEqual([]);
    expect(coerceState(null, T0)).toEqual(freshState(T0));
  });
});

// ─── Commands ───────────────────────────────────────────────────────────────

function play(s: RpgState, cmd: string, now = T0) {
  return execute(s, CTX, cmd, now, P);
}

function winCurrentFight(s: RpgState): string {
  let out = "";
  for (let i = 0; i < 60 && s.battle; i++) {
    s.battle.hero.hp = s.battle.hero.maxHp = 1e6; // keep the test hero alive
    out = play(s, ";a").out;
  }
  return out;
}

describe("commands", () => {
  test("parse handles aliases and ;sN shorthand", () => {
    expect(parse(";x")).toEqual({ cmd: "explore", args: [] });
    expect(parse(";  S2")).toEqual({ cmd: "skill", args: ["2"] });
    expect(parse(";buy 1 3")).toEqual({ cmd: "buy", args: ["1", "3"] });
    expect(parse(";")).toEqual({ cmd: "status", args: [] });
  });

  test("explore → win advances the floor, pays gold and buddy XP", () => {
    const s = freshState(T0);
    const start = play(s, ";x");
    expect(start.out).toContain("Floor 1/5");
    expect(s.energy).toBe(ENERGY_MAX - 1);
    const gold = s.gold;
    const out = winCurrentFight(s);
    expect(out).toContain("Victory");
    expect(s.floors["1"]).toBe(1);
    expect(s.gold).toBeGreaterThan(gold);
    expect(s.battle).toBeNull();
  });

  test("battle commands outside a fight are rejected without changes", () => {
    const r = play(freshState(T0), ";a");
    expect(r.out).toContain("Not in a fight");
    expect(r.changed).toBe(false);
  });

  test("the boss is gated behind clearing every floor", () => {
    const s = freshState(T0);
    expect(play(s, ";boss").out).toContain("Clear all 5 floors");
    s.floors["1"] = 5;
    expect(play(s, ";boss").out).toContain("BOSS");
  });

  test("a first boss kill unlocks the next zone and a skill", () => {
    const s = freshState(T0);
    s.floors["1"] = 5;
    play(s, ";boss");
    const out = winCurrentFight(s);
    expect(out).toContain("defeated for the first time");
    expect(s.unlocked).toBe(2);
    expect(s.skills).toContain("refactor");
    expect(s.bossKills).toEqual(["semicolon"]);
    expect(s.bag.length).toBe(1); // guaranteed drop
    expect(["rare", "epic", "legendary"]).toContain(s.bag[0].rarity);
    expect(play(s, ";go 2").out).toContain("Null Marsh");
    expect(play(s, ";go 3").out).toContain("locked");
  });

  test("no energy, no fight", () => {
    const s = freshState(T0);
    s.energy = 0;
    s.energyAt = T0;
    expect(play(s, ";x").out).toContain("Out of energy");
    expect(s.battle).toBeNull();
  });

  test("a knockout costs gold and leaves the hero at 25% HP", () => {
    const s = freshState(T0);
    s.gold = 100;
    play(s, ";x");
    s.battle!.hero.hp = 1;
    s.battle!.foe.atk = 999;
    s.battle!.foe.hp = s.battle!.foe.maxHp = 1e6;
    const out = play(s, ";a").out;
    expect(out).toContain("Knocked out");
    expect(s.gold).toBe(90);
    expect(s.hp).toBe(Math.round(hero().maxHp * 0.25));
    expect(s.stats.deaths).toBe(1);
  });

  test("equip swaps gear through the bag and changes stats", () => {
    const s = freshState(T0);
    const g = rollGear(mulberry32(1), 5, 1, { slot: "weapon", rarity: "rare" });
    s.bag.push(g);
    const out = play(s, ";equip 1").out;
    expect(out).toContain("ATK +");
    expect(s.equipped.weapon?.uid).toBe(1);
    expect(s.bag).toEqual([]);
  });

  test("sell junk keeps locked and rare gear", () => {
    const s = freshState(T0);
    s.bag.push(rollGear(mulberry32(1), 5, 1, { rarity: "common" }));
    s.bag.push(rollGear(mulberry32(2), 5, 2, { rarity: "uncommon" }));
    s.bag.push({ ...rollGear(mulberry32(3), 5, 3, { rarity: "common" }), locked: true });
    s.bag.push(rollGear(mulberry32(4), 5, 4, { rarity: "rare" }));
    const gold = s.gold;
    play(s, ";sell junk");
    expect(s.bag.map((g) => g.uid)).toEqual([3, 4]);
    expect(s.gold).toBeGreaterThan(gold);
  });

  test("shop buys consumables and once-per-day gear", () => {
    const s = freshState(T0);
    s.gold = 10_000;
    play(s, ";buy 1 2");
    expect(s.items.potion).toBe(5);
    const stock = shopStock(s, T0);
    expect(stock).toHaveLength(3);
    play(s, ";buy 5");
    expect(s.bag).toHaveLength(1);
    expect(play(s, ";buy 5").out).toContain("Sold out");
    // Next day restocks.
    expect(play(s, ";buy 5", T0 + 86_400_000).out).not.toContain("Sold out");
  });

  test("train spends gold and raises the stat", () => {
    const s = freshState(T0);
    s.gold = 100;
    const out = play(s, ";train atk").out;
    expect(out).toContain("rank 1");
    expect(s.training.atk).toBe(1);
    expect(s.gold).toBe(100 - trainCost(0));
  });

  test("bag full ⇒ drops auto-sell", () => {
    const s = freshState(T0);
    for (let i = 0; i < INVENTORY_CAP; i++) s.bag.push(rollGear(mulberry32(i), 3, i + 10));
    s.floors["1"] = 5;
    play(s, ";boss");
    const out = winCurrentFight(s);
    expect(out).toContain("auto-sold");
    expect(s.bag.length).toBe(INVENTORY_CAP);
  });

  test("commits restore energy and pay gold, with a bounty for won fights", () => {
    const s = freshState(T0);
    s.energy = 0;
    s.energyAt = T0;
    const g0 = s.gold;
    expect(onCommit(s, false, T0)).toContain("+3");
    expect(s.energy).toBe(3);
    const g1 = s.gold;
    onCommit(s, true, T0);
    expect(s.gold - g1).toBeGreaterThan(g1 - g0);
  });

  test("hudLine is compact and uses only narrow glyphs", () => {
    const line = hudLine(freshState(T0), 55);
    expect(line).toBe("Z1 0/5 ♥55/55 ↯10 ◎30g");
    expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}⚡]/u);
  });
});

// ─── Prompt hook (end to end, real bash + bun) ──────────────────────────────

describe("rpg-command.sh hook", () => {
  const HOOK = join(import.meta.dir, "..", "..", "hooks", "rpg-command.sh");

  function runHook(prompt: string, cfgDir: string) {
    const env: Record<string, string> = { CLAUDE_CONFIG_DIR: cfgDir };
    for (const k of ["HOME", "PATH", "LANG", "LC_ALL"]) if (process.env[k]) env[k] = process.env[k]!;
    return spawnSync("bash", [HOOK], {
      input: JSON.stringify({ session_id: "t", prompt }),
      env,
      encoding: "utf8",
    });
  }

  test("ordinary prompts pass through untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "quest-hook-"));
    try {
      const r = runHook("fix the failing test; then commit", dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`;` prompts are blocked with the game screen as the reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "quest-hook-"));
    try {
      mkdirSync(join(dir, "buddy-state"), { recursive: true });
      writeFileSync(join(dir, "buddy-state", "status.json"), JSON.stringify({ name: "Pip" }));
      const r = runHook("  ;x", dir);
      const out = JSON.parse(r.stdout);
      expect(out.decision).toBe("block");
      expect(out.reason).toContain("Syntax Meadows");
      expect(out.reason).not.toContain("\x1b["); // plain text for the transcript
      const saved = JSON.parse(readFileSync(join(dir, "buddy-state", "rpg.json"), "utf8"));
      expect(saved.battle).not.toBeNull();
      // The HUD was patched into status.json for the status line.
      const status = JSON.parse(readFileSync(join(dir, "buddy-state", "status.json"), "utf8"));
      expect(status.rpgHud).toContain("vs ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
