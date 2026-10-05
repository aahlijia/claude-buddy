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
import { execute, heroOf, hudLine, onCommit, parse, shopStock, type BuddyCtx } from "./game";
import { gearScore, rollGear, sellValue } from "./gear";
import { deriveHero, trainCost, trainError } from "./hero";
import { coerceState, freshState as newState, settle, type RpgState } from "./store";

/** A started game: prologue already seen (it rides the first command once). */
function freshState(now: number): RpgState {
  return { ...newState(now), seen: [0] };
}
import { progress, rollBoard, syncDaily } from "./bounty";
import type { GearItem } from "./gear";

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
  return deriveHero(level, 0, STATS, {}, [], CTX.species);
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
    expect(coerceState(null, T0)).toEqual(newState(T0));
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

// ─── Depth: passives, uniques, bounties, hunt ───────────────────────────────

function legendary(unique: GearItem["unique"], slot: GearItem["slot"] = "charm"): GearItem {
  return { uid: 99, slot, name: "Test Relic", rarity: "legendary", ilvl: 1, stats: {}, unique };
}

describe("species passives", () => {
  test("shape the derived stats", () => {
    const plain = deriveHero(1, 0, STATS, {}, []);
    expect(deriveHero(1, 0, STATS, {}, [], "turtle").def).toBeGreaterThan(plain.def);
    expect(deriveHero(1, 0, STATS, {}, [], "turtle").spd).toBe(plain.spd - 2);
    expect(deriveHero(1, 0, STATS, {}, [], "chonk").maxHp).toBe(Math.round(plain.maxHp * 1.3));
    expect(deriveHero(1, 0, STATS, {}, [], "duck").gold).toBe(15);
  });

  test("the character sheet names the passive", () => {
    expect(execute(freshState(T0), CTX, ";me", T0, P).out).toContain("Nine Lives");
  });
});

describe("legendary uniques", () => {
  test("legendary rolls always carry a unique and name it", () => {
    for (let i = 0; i < 20; i++) {
      const g = rollGear(mulberry32(i), 10, i, { rarity: "legendary" });
      expect(g.unique).toBeDefined();
      expect(g.name).toContain(" of ");
    }
  });

  function withUnique(u: GearItem["unique"], foe = makeMonster(ZONES[0].monsters[2], 4)) {
    const h = deriveHero(1, 0, STATS, {}, [legendary(u)]);
    return startBattle("explore", 1, 1, h, h.maxHp, foe, 3);
  }

  test("First Strike makes the first landed hit a crit", () => {
    let b = withUnique("firststrike");
    b.foe.spd = 0; // no dodges
    b = act(b, { type: "attack" });
    expect(b.log[0]).toStartWith("CRIT!");
  });

  test("Thorns reflects damage taken", () => {
    let b = withUnique("thorns");
    b.foe.hp = b.foe.maxHp = 10_000;
    b.hero.spd = 0;
    for (let i = 0; i < 6; i++) b = act(b, { type: "defend" });
    expect(b.foe.hp).toBeLessThan(10_000);
  });

  test("Second Wind survives one lethal hit", () => {
    let b = withUnique("secondwind", makeMonster(ZONES[1].monsters[2], 30)); // single-hit foe
    b.hero.spd = 0; // never dodge
    b.foe.hp = b.foe.maxHp = 1e6;
    b.hero.hp = 2;
    b = act(b, { type: "attack" });
    expect(b.hero.hp).toBe(1);
    expect(b.over).toBeUndefined();
    expect(b.log.join(" ")).toContain("Second Wind");
    b = act(b, { type: "attack" });
    expect(b.over).toBe("lose");
  });

  test("Overclock shortens cooldowns", () => {
    const b = act(withUnique("overclock"), { type: "skill", id: "hotfix" });
    expect(b.hero.cd.hotfix).toBe(3); // 4 - 1
  });

  test("Midas pays 50% more gold", () => {
    const run = (gear: GearItem[]) => {
      const s = freshState(T0);
      s.equipped = Object.fromEntries(gear.map((g) => [g.slot, g]));
      execute(s, CTX, ";x", T0, P);
      winCurrentFight(s);
      return s.gold;
    };
    expect(run([legendary("midas")]) - 30).toBeGreaterThan((run([]) - 30) * 1.3);
  });
});

describe("daily bounties", () => {
  test("the board is deterministic per day with distinct kinds", () => {
    const a = rollBoard("2026-10-05");
    expect(a).toEqual(rollBoard("2026-10-05"));
    expect(new Set(a.map((b) => b.kind)).size).toBe(3);
  });

  test("completing a bounty pays out; clearing the board pays an elixir", () => {
    const s = freshState(T0);
    syncDaily(s, T0);
    const gold = s.gold;
    const lines: string[] = [];
    for (const b of s.daily.tasks) lines.push(...progress(s, b.kind, b.target, T0));
    expect(lines.filter((l) => l.includes("Bounty complete"))).toHaveLength(3);
    expect(lines.some((l) => l.includes("board cleared"))).toBe(true);
    expect(s.gold).toBeGreaterThan(gold);
    expect(s.items.elixir).toBe(1);
    // No double payout.
    expect(progress(s, s.daily.tasks[0].kind, 99, T0)).toEqual([]);
  });

  test("the board rolls over at midnight UTC", () => {
    const s = freshState(T0);
    syncDaily(s, T0);
    s.daily.tasks[0].progress = 1;
    syncDaily(s, T0 + 86_400_000);
    expect(s.daily.day).not.toBe(new Date(T0).toISOString().slice(0, 10));
    expect(s.daily.tasks.every((b) => b.progress === 0)).toBe(true);
  });

  test("commits advance a commit bounty", () => {
    const s = freshState(T0);
    s.daily = { day: "2026-10-05", tasks: [{ kind: "commits", target: 2, progress: 0, done: false }], bonus: false };
    onCommit(s, false, T0);
    expect(s.daily.tasks[0].progress).toBe(1);
    expect(onCommit(s, false, T0)).toContain("Bounty complete");
  });
});

describe(";hunt", () => {
  const STANDOFF = { key: "null_wraith:123", name: "Null Wraith", species: "ghost" as const, tier: 2, boss: false };

  test("without a status-line bug there is nothing to hunt", () => {
    const r = execute(freshState(T0), CTX, ";hunt", T0, P);
    expect(r.out).toContain("No bug on your status line");
    expect(r.changed).toBe(false);
  });

  test("hunting the standoff's shadow pays double and is once per standoff", () => {
    const ctx = { ...CTX, standoff: STANDOFF };
    const s = freshState(T0);
    expect(execute(s, ctx, ";", T0, P).out).toContain(";hunt");
    expect(execute(s, ctx, ";hunt", T0, P).out).toContain("Bug Hunt");
    expect(s.battle?.foe.species).toBe("ghost");
    let out = "";
    for (let i = 0; i < 60 && s.battle; i++) {
      s.battle.hero.hp = s.battle.hero.maxHp = 1e6;
      out = execute(s, ctx, ";a", T0, P).out;
    }
    expect(out).toContain("Bug squashed");
    expect(s.hunted).toBe(STANDOFF.key);
    expect(execute(s, ctx, ";hunt", T0, P).out).toContain("already squashed");
    // A new standoff (new key) can be hunted again.
    expect(execute(s, { ...ctx, standoff: { ...STANDOFF, key: "x:1" } }, ";hunt", T0, P).out).toContain("Bug Hunt");
  });
});

// ─── Story & events ─────────────────────────────────────────────────────────

import { EVENT_IDS, resolveEvent, type PendingEvent } from "./events";

describe("story", () => {
  test("the prologue opens the very first command, once", () => {
    const s = newState(T0);
    expect(execute(s, CTX, ";", T0, P).out).toContain("The build is red");
    expect(execute(s, CTX, ";", T0, P).out).not.toContain("The build is red");
  });

  test("zone arrival text shows on the first explore of a zone", () => {
    const s = freshState(T0);
    expect(execute(s, CTX, ";x", T0, P).out).toContain("tall grass of tangled brackets");
    winCurrentFight(s);
    s.lastEvent = true;
    expect(execute(s, CTX, ";x", T0, P).out).not.toContain("tall grass");
  });

  test("bosses taunt, crack at half HP, and die with a line", () => {
    let b = fight(makeBoss("lich", 10), 2);
    expect(b.log.join("\n")).toContain("Everything ends in null");
    b.hero.hp = b.hero.maxHp = 1e6;
    b.hero.atk = 60;
    let all = "";
    while (!b.over) {
      b = act(b, { type: "attack" });
      all += b.log.join("\n");
    }
    expect(all).toContain("Cannot read properties of undefined");
    expect(all).toContain("finds it");
  });

  test("felling the Segfault Dragon rolls the ending", () => {
    const s = freshState(T0);
    s.unlocked = 6;
    s.zone = 6;
    s.floors["6"] = 5;
    execute(s, CTX, ";boss", T0, P);
    s.battle!.foe.hp = 1;
    s.battle!.foe.spd = 0;
    const out = winCurrentFight(s);
    expect(out).toContain("T H E   E N D");
    expect(s.unlocked).toBe(7);
  });
});

describe("events", () => {
  const ev = (id: PendingEvent["id"]): PendingEvent => ({ id, zone: 1, level: 3, seed: 1 });
  const rich = { gold: 1000, potions: 3 };

  test("every event resolves both options", () => {
    for (const id of EVENT_IDS) {
      for (const o of [1, 2] as const) {
        const out = resolveEvent(ev(id), o, mulberry32(1), rich);
        expect(out.text.length).toBeGreaterThan(0);
      }
    }
  });

  test("unaffordable options stay open", () => {
    expect(resolveEvent(ev("shrine"), 2, mulberry32(1), { gold: 0, potions: 0 }).blocked).toBe(true);
    expect(resolveEvent(ev("intern"), 1, mulberry32(1), { gold: 0, potions: 0 }).blocked).toBe(true);
  });

  test("chests are sometimes mimics", () => {
    const outs = Array.from({ length: 60 }, (_, i) => resolveEvent(ev("chest"), 1, mulberry32(i), rich));
    expect(outs.some((o) => o.mimic)).toBe(true);
    expect(outs.some((o) => o.gold)).toBe(true);
  });

  function forceEvent(s: RpgState): string {
    for (let i = 0; i < 200; i++) {
      s.lastEvent = false;
      const out = execute(s, CTX, ";x", T0 + i, P).out;
      if (s.event) return out;
      s.battle = null; // drop the fight and roll again
      s.energy = ENERGY_MAX;
    }
    throw new Error("no event rolled");
  }

  test("an explore can open a free event; the next explore is a fight", () => {
    const s = freshState(T0);
    const out = forceEvent(s);
    expect(out).toContain(";1");
    const energy = s.energy;
    expect(execute(s, CTX, ";x", T0, P).out).toContain("Decide first");
    execute(s, CTX, ";2", T0, P);
    expect(s.event).toBeNull();
    expect(s.energy).toBe(energy);
    execute(s, CTX, ";x", T0, P);
    expect(s.battle).not.toBeNull();
  });

  test("a shrine blessing buffs the next fights, then fades", () => {
    const s = freshState(T0);
    s.gold = 500;
    s.event = { id: "shrine", zone: 1, level: 3, seed: 5 };
    expect(execute(s, CTX, ";2", T0, P).out).toContain("blesses");
    const base = heroOf(s, CTX).atk;
    for (let i = 0; i < 3; i++) {
      s.lastEvent = true;
      execute(s, CTX, ";x", T0, P);
      if (i === 0) expect(s.battle!.hero.atk).toBe(Math.round(base * 1.25));
      winCurrentFight(s);
    }
    expect(s.blessing).toBeNull();
  });

  test("a mimic is a free bonus fight with a guaranteed drop", () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = freshState(T0);
      s.event = { id: "chest", zone: 1, level: 3, seed };
      execute(s, CTX, ";1", T0, P);
      if (!s.battle) continue;
      expect(s.battle.kind).toBe("event");
      expect(s.energy).toBe(ENERGY_MAX);
      winCurrentFight(s);
      expect(s.bag.length).toBe(1);
      expect(s.floors["1"]).toBeUndefined();
      return;
    }
    throw new Error("no mimic in 200 seeds");
  });
});
