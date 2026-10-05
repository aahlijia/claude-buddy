import { describe, expect, test } from "bun:test";
import { displayWidth } from "../art";
import type { BuddyStats } from "../engine";
import { crc32 } from "../gfx/encode/png";
import { drawText, hasGlyph, textWidth } from "../gfx/font";
import { Framebuffer } from "../gfx/framebuffer";
import { ANIM_INFO } from "../gfx/hd";
import { drawParticles, PARTICLE_KINDS, particlesAt, type Emitter } from "../gfx/particles";
import { direct, directIntro, type Cue } from "./anim";
import { act, makeBoss, makeMonster, startBattle, type Battle } from "./battle";
import { ZONES } from "./data";
import { execute, type BuddyCtx } from "./game";
import {
  CUTIN_MS,
  FLASH_GAP_MS,
  PHASE_MS,
  HITSTOP_MAX,
  HITSTOP_MIN,
  SCENE_H,
  SCENE_W,
  STAGE_COLS,
  STAGE_ROWS,
  actorFrame,
  animAt,
  composeFrame,
  encodeStage,
  frameTimes,
  ghostAt,
  hdCast,
  hdFeel,
  hdTimeline,
  hitStopMs,
  motionTime,
  renderScene,
  restScene,
  sceneAt,
  standInHue,
  type HdCast,
  type HdFeel,
  type HdPaint,
  type HdScene,
  type Timeline,
} from "./hdstage";
import { deriveHero } from "./hero";
import { lazyTimed, resultsCard, scaleFrames } from "./playkit";
import { battleFrames, battleScreen, stageGeometry, type Look } from "./render";
import { freshState } from "./store";

const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const LOOK: Look = { name: "Pip", species: "cat", eye: "·", hat: "none", rarity: "rare" };
const CTX: BuddyCtx = { ...LOOK, level: 1, prestige: 0, stats: STATS };
const FULL: HdFeel = { shake: true, flash: true, camera: true, cutin: true };
const HALF: HdPaint = { tier: "halfblock", color: "truecolor", tmux: false, feel: FULL };
const T0 = Date.UTC(2026, 9, 5, 12);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const hash = (fb: Framebuffer) => crc32(new Uint8Array(fb.data));

function fight(foe = makeMonster(ZONES[0].monsters[2], 3), seed = 9): Battle {
  const h = deriveHero(1, 0, STATS, {}, [], "cat");
  const b = startBattle("explore", 1, 1, h, h.maxHp, foe, seed);
  b.hero.hp = b.hero.maxHp = 500;
  return b;
}

/** A turn where the hero lands a blow (searching seeds for one that hits). */
function turn(want: (b: Battle) => boolean = (b) => (b.beats ?? []).some((x) => x.t === "strike" && x.by === "hero")): [Battle, Battle] {
  for (let seed = 1; seed < 500; seed++) {
    const b0 = fight(undefined, seed);
    const b1 = act(b0, { type: "attack" });
    if (want(b1)) return [b0, b1];
  }
  throw new Error("no such turn");
}

function timeline(b0: Battle, b1: Battle, feel = FULL, cues?: Cue[]): Timeline {
  const g = stageGeometry(b1, LOOK);
  const cast = hdCast(b1, LOOK)!;
  return hdTimeline(cues ?? direct(b0, b1, g), cast, feel, { maxHp: [b1.hero.maxHp, b1.foe.maxHp], cell: g });
}

const impactIndex = (tl: Timeline, by: "hero" | "foe") => tl.cues.findIndex((c) => c.stage.hd?.impact?.by === by);

// ─── Selection and gating ───────────────────────────────────────────────────

describe("fallback selection", () => {
  const b = fight();
  test("a hero without HD art keeps the ASCII stage", () => {
    // H6 put every species in HD; only an unknown one falls back.
    expect(hdCast(b, { species: "nope" as never })).toBeNull();
    expect(hdCast(b, { species: "robot" })).not.toBeNull();
  });

  test("HD foes are drawn as themselves", () => {
    const blob = fight(makeMonster(ZONES[0].monsters[0], 3)); // Typo Gremlin is a blob
    expect(hdCast(blob, LOOK)!.foe).toMatchObject({ species: "blob", hue: undefined });
    const dragon = fight(makeBoss("segfault", 4));
    const cast = hdCast(dragon, LOOK)!;
    expect(cast.foe.species).toBe("dragon");
    expect(cast.boss).toBe(true);
  });

  test("foes without a rig get a recolored blob stand-in", () => {
    // H6: the Indent Snail is a real snail now.
    const cast = hdCast(b, LOOK)!;
    expect(b.foe.species).toBe("snail");
    expect(cast.foe).toMatchObject({ species: "snail", hue: undefined });
    const odd = hdCast({ ...b, foe: { ...b.foe, species: "nope" as never } }, LOOK)!;
    expect(odd.foe.species).toBe("blob");
    expect(odd.foe.hue).toBe(standInHue("nope" as never));
    // Stable per species, away from the hero blob's mint.
    expect(standInHue("snail")).toBe(standInHue("snail"));
    expect(standInHue("snail")).not.toBe(standInHue("owl"));
    for (const s of ["owl", "duck", "ghost", "robot"] as const) expect(standInHue(s)).toBeGreaterThanOrEqual(70);
  });

  test("gameFeel and reduceMotion gate the juice", () => {
    expect(hdFeel("off")).toBeNull();
    expect(hdFeel("subtle")).toEqual({ shake: false, flash: false, camera: true, cutin: false });
    expect(hdFeel("full")).toEqual(FULL);
    expect(hdFeel("full", true)).toEqual({ shake: false, flash: false, camera: false, cutin: false });
  });

  test("subtle and reduce-motion timelines carry no shake or flash", () => {
    const [b0, b1] = turn((x) => (x.beats ?? []).some((y) => y.t === "strike" && y.crit));
    const full = timeline(b0, b1, FULL);
    expect(full.traumas.length).toBeGreaterThan(0);
    expect(full.flashes.length).toBeGreaterThan(0);
    const subtle = timeline(b0, b1, hdFeel("subtle")!);
    expect(subtle.traumas).toEqual([]);
    expect(subtle.flashes).toEqual([]);
    const calm = timeline(b0, b1, hdFeel("full", true)!);
    expect(calm.cams).toEqual([]);
    for (const [T] of frameTimes(calm)) {
      const s = sceneAt(calm, T);
      expect(s.shake).toEqual([0, 0]);
      expect(s.flash).toBe(0);
      expect(s.cam.zoom).toBe(1);
    }
  });
});

// ─── Cue → animation mapping ────────────────────────────────────────────────

describe("cue → animation mapping", () => {
  const [b0, b1] = turn();
  const tl = timeline(b0, b1);
  const j = impactIndex(tl, "hero");

  test("the attacker plays `attack`, landing exactly on the impact cue", () => {
    expect(j).toBeGreaterThan(0);
    const seg = tl.segments.hero.find((s) => s.anim === "attack")!;
    expect(seg.impactAt).toBe(tl.starts[j]);
    const at = animAt(tl, "hero", tl.starts[j]);
    expect(at.anim).toBe("attack");
    expect(at.t).toBeCloseTo(ANIM_INFO.attack.impact!, 5);
    // Anticipation plays before contact.
    const before = animAt(tl, "hero", seg.start);
    expect(before.t).toBeLessThan(ANIM_INFO.attack.impact!);
  });

  test("the defender reacts with `hit` at the impact", () => {
    expect(animAt(tl, "foe", tl.starts[j]).anim).toBe("hit");
    expect(animAt(tl, "foe", tl.starts[j]).t).toBe(0);
  });

  test("one-shots finish before idle takes over, inside the settle tail", () => {
    expect(tl.total).toBeGreaterThanOrEqual(tl.cueMs);
    const end = animAt(tl, "hero", tl.total);
    expect(["idle", "hit"]).toContain(end.anim);
    for (const side of ["hero", "foe"] as const) {
      const segs = tl.segments[side];
      for (let n = 1; n < segs.length; n++) expect(segs[n].start).toBeGreaterThanOrEqual(segs[n - 1].start);
    }
  });

  test("a KO collapses the loser and the winner celebrates", () => {
    const b0 = fight();
    b0.foe.hp = 1;
    const b1 = act(b0, { type: "attack" });
    expect(b1.over).toBe("win");
    const tl = timeline(b0, b1);
    const last = tl.total - 1;
    expect(animAt(tl, "foe", last).anim).toBe("ko");
    expect(animAt(tl, "hero", last).anim).toBe("victory");
    expect(tl.emitters.some((e) => e.kind === "confetti")).toBe(true);
  });

  test("the intro walks both sides in after the wipe", () => {
    const b = fight();
    const g = stageGeometry(b, LOOK);
    const tl = hdTimeline(directIntro(b, g), hdCast(b, LOOK)!, FULL, { maxHp: [500, b.foe.maxHp], cell: g });
    expect(animAt(tl, "hero", 0).hidden).toBe(true);
    expect(tl.segments.hero.map((s) => s.anim)).toEqual(["hidden", "walk", "idle"]);
    expect(sceneAt(tl, 0).wipe).toBeGreaterThanOrEqual(0);
    // The wipe ends in a flash.
    expect(tl.flashes.length).toBe(1);
  });

  test("fleeing walks off, then the hero is gone", () => {
    const b0 = fight();
    b0.foe.spd = 0;
    b0.hero.spd = 999;
    const b1 = act(b0, { type: "flee" });
    expect(b1.over).toBe("fled");
    const tl = timeline(b0, b1);
    expect(tl.segments.hero.map((s) => s.anim)).toContain("walk");
    expect(animAt(tl, "hero", tl.total).hidden).toBe(true);
  });
});

// ─── Hit-stop ───────────────────────────────────────────────────────────────

describe("hit-stop", () => {
  test("60–120 ms, scaled by damage, bigger on crits", () => {
    expect(hitStopMs(1, 100, false, false)).toBe(HITSTOP_MIN + 2);
    expect(hitStopMs(0, 100, false, false)).toBe(HITSTOP_MIN);
    expect(hitStopMs(50, 100, false, false)).toBe(HITSTOP_MAX);
    expect(hitStopMs(10, 100, true, false)).toBeGreaterThan(hitStopMs(10, 100, false, false));
    for (let d = 0; d < 200; d += 7) {
      const ms = hitStopMs(d, 100, d % 2 === 0, d % 3 === 0);
      expect(ms).toBeGreaterThanOrEqual(HITSTOP_MIN);
      expect(ms).toBeLessThanOrEqual(HITSTOP_MAX);
    }
  });

  test("freezes at the impact cue and stops the motion clock", () => {
    const [b0, b1] = turn();
    const tl = timeline(b0, b1);
    const j = impactIndex(tl, "hero");
    const f = tl.freezes.find((x) => x.at === tl.starts[j])!;
    expect(f.ms).toBeGreaterThanOrEqual(HITSTOP_MIN);
    expect(f.ms).toBeLessThanOrEqual(Math.min(HITSTOP_MAX, tl.cues[j].ms));
    const m0 = motionTime(tl, f.at);
    expect(motionTime(tl, f.at + f.ms / 2)).toBe(m0);
    expect(motionTime(tl, f.at + f.ms)).toBe(m0);
    expect(motionTime(tl, f.at + f.ms + 10)).toBe(m0 + 10);
    // Both actors hold their pose through the freeze.
    for (const side of ["hero", "foe"] as const) {
      expect(animAt(tl, side, f.at + 1).t).toBe(animAt(tl, side, f.at + f.ms - 1).t);
    }
    // Sparks burst as motion resumes.
    const sparks = tl.emitters.find((e) => e.kind === "spark")!;
    expect(sparks.t0 * 1000).toBe(m0);
  });

  test("the directed timing is unchanged: cue starts are the director's", () => {
    const [b0, b1] = turn();
    const tl = timeline(b0, b1);
    let acc = 0;
    tl.cues.forEach((c, i) => {
      expect(tl.starts[i]).toBe(acc);
      acc += c.ms;
    });
    expect(tl.cueMs).toBe(acc);
  });
});

// ─── Camera, shake, flashes ─────────────────────────────────────────────────

describe("camera and flashes", () => {
  test("crits push the camera in and flashes are capped at 3 per second", () => {
    const [b0, b1] = turn((x) => (x.beats ?? []).some((y) => y.t === "strike" && y.crit));
    const tl = timeline(b0, b1);
    expect(tl.cams.length).toBeGreaterThan(0);
    const zooms = frameTimes(tl).map(([T]) => sceneAt(tl, T).cam.zoom);
    expect(Math.max(...zooms)).toBeGreaterThan(1.05);
    expect(zooms[zooms.length - 1]).toBe(1);
    for (let i = 1; i < tl.flashes.length; i++) expect(tl.flashes[i] - tl.flashes[i - 1]).toBeGreaterThanOrEqual(FLASH_GAP_MS);
  });

  test("shake stays within 3 px", () => {
    const [b0, b1] = turn((x) => (x.beats ?? []).some((y) => y.t === "strike" && y.crit));
    const tl = timeline(b0, b1);
    for (let T = 0; T < tl.total; T += 5) {
      const s = sceneAt(tl, T);
      expect(Math.abs(s.shake[0])).toBeLessThanOrEqual(3);
      expect(Math.abs(s.shake[1])).toBeLessThanOrEqual(3);
    }
  });
});

// ─── Composition ────────────────────────────────────────────────────────────

describe("stage composition", () => {
  const b = fight(makeMonster(ZONES[0].monsters[0], 3));
  const cast = hdCast(b, LOOK)!;
  const g = stageGeometry(b, LOOK);
  const rest = restScene(b, [], g, cast);

  test("both actors are drawn, the foe mirrored", () => {
    const empty = renderScene(cast, { ...rest, hero: { ...rest.hero, hidden: true }, foe: { ...rest.foe, hidden: true } });
    const full = renderScene(cast, rest);
    const diff = (x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < SCENE_H; y++) for (let x = x0; x < x1; x++) if (full.get(x, y).join() !== empty.get(x, y).join()) n++;
      return n;
    };
    expect(diff(0, SCENE_W / 2)).toBeGreaterThan(300);
    expect(diff(SCENE_W / 2, SCENE_W)).toBeGreaterThan(300);
    // The foe frame is the mirror of the unflipped one.
    const a = actorFrame(cast.foe, "idle", 0, false, 1);
    const m = actorFrame(cast.foe, "idle", 0, true, 1);
    expect(m.get(m.width - 1 - 20, 30)).toEqual(a.get(20, 30));
  });

  test("the attacker is drawn over the defender", () => {
    const overlap: HdScene = { ...rest, hero: { anim: "idle", t: 0, x: 40, y: 0 }, foe: { anim: "idle", t: 0, x: 0, y: 0 } };
    const heroOnly = renderScene(cast, { ...overlap, foe: { ...overlap.foe, hidden: true } });
    const both = renderScene(cast, overlap);
    // Wherever the lunging hero has a solid pixel, it wins.
    const heroFb = actorFrame(cast.hero, "idle", 0, false, cast.seed);
    let checked = 0;
    for (let y = 0; y < heroFb.height; y++) {
      for (let x = 0; x < heroFb.width; x++) {
        if (heroFb.get(x, y)[3] < 255) continue;
        const sx = x + 40;
        const sy = y + 4;
        if (sx >= 56 && sx < SCENE_W) {
          expect(both.get(sx, sy)).toEqual(heroOnly.get(sx, sy));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("every tier fills the same box", () => {
    const hb = encodeStage(cast, rest, HALF);
    expect(hb.lines.length).toBe(STAGE_ROWS);
    for (const l of hb.lines) expect(displayWidth(l)).toBe(STAGE_COLS);
    for (const tier of ["kitty", "iterm"] as const) {
      const px = encodeStage(cast, rest, { ...HALF, tier });
      expect(px.lines).toEqual(Array.from({ length: STAGE_ROWS }, () => " ".repeat(STAGE_COLS)));
      expect(px.suffix).toContain(tier === "kitty" ? "\x1b_G" : "\x1b]1337;File=");
      // Placed from the box's top-left, cursor returned to where it was.
      expect(px.suffix!.startsWith(`\x1b[${STAGE_COLS}D\x1b[${STAGE_ROWS - 1}A`)).toBe(true);
      expect(px.suffix!.endsWith(`\x1b[${STAGE_ROWS - 1}B\x1b[${STAGE_COLS}C`)).toBe(true);
    }
    const tm = encodeStage(cast, rest, { ...HALF, tier: "kitty", tmux: true });
    expect(tm.suffix).toContain("\x1bPtmux;");
  });

  test("half-block frames are the scene at half resolution", () => {
    expect(composeFrame(cast, rest, true).width).toBe(STAGE_COLS);
    expect(composeFrame(cast, rest, true).height).toBe(STAGE_ROWS * 2);
    expect(composeFrame(cast, rest, false).width).toBe(SCENE_W);
  });
});

// ─── Particles and font ─────────────────────────────────────────────────────

describe("particles", () => {
  const e = (kind: Emitter["kind"], seed = 3): Emitter => ({ kind, x: 60, y: 30, t0: 1, seed, w: 100 });

  test("deterministic: same emitter and time, same particles", () => {
    for (const k of PARTICLE_KINDS) {
      expect(particlesAt(e(k), 1.2)).toEqual(particlesAt(e(k), 1.2));
      expect(particlesAt(e(k, 4), 1.2)).not.toEqual(particlesAt(e(k), 1.2));
    }
  });

  test("nothing before the burst or after the longest life", () => {
    for (const k of PARTICLE_KINDS) {
      expect(particlesAt(e(k), 0.99)).toEqual([]);
      expect(particlesAt(e(k), 10)).toEqual([]);
    }
    expect(particlesAt(e("spark"), 1.05).length).toBeGreaterThan(0);
  });

  test("render order never matters (pure in t)", () => {
    const draw = (t: number) => {
      const fb = new Framebuffer(120, 60);
      drawParticles(fb, PARTICLE_KINDS.map((k) => e(k)), t);
      return hash(fb);
    };
    const a = draw(1.3);
    draw(1.1);
    expect(draw(1.3)).toBe(a);
  });

  test("sparks fly away from the attacker", () => {
    const right = particlesAt({ ...e("spark"), dir: 1 }, 1.1);
    const left = particlesAt({ ...e("spark"), dir: -1 }, 1.1);
    const avg = (ps: { x: number }[]) => ps.reduce((s, p) => s + p.x, 0) / ps.length;
    expect(avg(right)).toBeGreaterThan(60);
    expect(avg(left)).toBeLessThan(60);
  });
});

describe("pixel font", () => {
  test("covers the director's pops", () => {
    for (const t of ["-12", "+8", "CRIT", "miss", "dodge", "GUARD", "STUNNED", "ATK↑", "INTERRUPTED", "SECOND WIND", "3 HEADS", "+4 max", "blocked!", "♛ BOSS ♛", "!!!", "?"]) {
      for (const ch of t) expect(hasGlyph(ch), `${t}: ${ch}`).toBe(true);
    }
  });

  test("draws within its measured width", () => {
    const fb = new Framebuffer(40, 10);
    drawText(fb, "-12", 1, 1, [255, 255, 255, 255], { scale: 2 });
    let maxX = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) if (fb.get(x, y)[3]) maxX = Math.max(maxX, x);
    expect(maxX).toBe(textWidth("-12", 2));
  });
});

// ─── Bars ───────────────────────────────────────────────────────────────────

describe("damage ghost bars", () => {
  test("the lost chunk lingers, then drains to the real HP", () => {
    const [b0, b1] = turn();
    const tl = timeline(b0, b1);
    const j = impactIndex(tl, "hero");
    const at = tl.starts[j];
    const before = tl.cues[j - 1].hp[1];
    const after = tl.cues[j].hp[1];
    expect(after).toBeLessThan(before);
    expect(ghostAt(tl, at + 10).ghost[1]).toBe(before);
    expect(ghostAt(tl, at + 10).fresh[1]).toBe(true);
    expect(ghostAt(tl, at + 200).fresh[1]).toBe(false);
    const mid = ghostAt(tl, at + 400).ghost[1];
    expect(mid).toBeLessThan(before);
    expect(mid).toBeGreaterThan(after - 1);
    expect(ghostAt(tl, tl.total).ghost[1]).toBe(b1.foe.hp);
  });
});

// ─── Screens and the player ─────────────────────────────────────────────────

describe("HD battle screens", () => {
  test("every HD frame is the size of the resting screen, and ends on it", () => {
    const [b0, b1] = turn();
    const p = { color: true, anim: true, hd: HALF };
    const frames = battleFrames(p, b1, LOOK, [], {}, direct(b0, b1, stageGeometry(b1, LOOK)));
    const rest = battleScreen(p, b1, LOOK, [], {});
    const h = rest.split("\n").length;
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames.filter((_, i) => i % 5 === 0)) expect(f.text.split("\n").length).toBe(h);
    expect(frames[frames.length - 1].text).toBe(rest);
    expect(strip(rest)).toContain("▀");
  });

  test("pixel tiers place the image on the last stage row", () => {
    const b = fight();
    const out = battleScreen({ color: true, anim: true, hd: { ...HALF, tier: "kitty" } }, b, LOOK, [], {}).split("\n");
    expect(out.findIndex((l) => l.includes("\x1b_G"))).toBe(STAGE_ROWS);
  });

  test("the zero-token hook path never renders pixels", () => {
    const s = freshState(T0);
    for (const cmd of [";x", ";a", ";a", ";a"]) {
      const r = execute(s, CTX, cmd, T0, { color: false });
      expect(r.out).not.toMatch(/[▀▄]|\x1b_G|\x1b\]1337/);
      expect(r.anim).toBeUndefined();
    }
  });

  test("the TUI gets HD frames, lazily, and a lazy HD idle loop", () => {
    const s = freshState(T0);
    execute(s, CTX, ";help", T0, { color: true }); // past the prologue
    const r = execute(s, CTX, ";x", T0, { color: true, anim: true, hd: HALF });
    expect(r.anim!.length).toBeGreaterThan(10);
    expect(r.anim![0].text).toContain("▀");
    expect(typeof r.loop!.frames[0]).toBe("function");
    expect((r.loop!.frames[0] as () => string)()).toContain("▀");
  });

  test("speed scaling keeps frames lazy", () => {
    let built = 0;
    const frames = [lazyTimed(() => `f${++built}`, 33), lazyTimed(() => `f${++built}`, 33)];
    const fast = scaleFrames(frames, "fast");
    expect(built).toBe(0);
    expect(fast[1].text).toBe("f1");
    expect(fast[1].text).toBe("f1");
    expect(built).toBe(1);
    expect(scaleFrames(frames, "off")).toEqual([]);
  });
});

describe("results card", () => {
  const r = { gold: 40, xp: 7, drops: ["[R] Rusty Blade"], boss: false };
  test("counts up and reveals the loot at the end", () => {
    const start = resultsCard(r, 0, false).join("\n");
    expect(start).toContain("+0g");
    expect(start).not.toContain("Rusty Blade");
    const end = resultsCard(r, 1, false).join("\n");
    expect(end).toContain("+40g");
    expect(end).toContain("+7");
    expect(end).toContain("Rusty Blade");
  });

  test("a won fight reports its spoils", () => {
    const s = freshState(T0);
    execute(s, CTX, ";x", T0, { color: false });
    s.battle!.foe.hp = 1;
    s.battle!.hero.hp = s.battle!.hero.maxHp = 999;
    s.battle!.foe.spd = 0;
    let res = execute(s, CTX, ";a", T0, { color: false });
    for (let i = 0; i < 5 && s.battle; i++) res = execute(s, CTX, ";a", T0, { color: false });
    expect(res.results?.gold).toBeGreaterThan(0);
    expect(res.out).toContain(`+${res.results!.gold}g`);
  });
});

describe("performance", () => {
  test("a warm scene rasterizes in ≤ 2 ms", () => {
    const [b0, b1] = turn();
    const tl = timeline(b0, b1);
    const times = frameTimes(tl).map(([T]) => T);
    for (const T of times) renderScene(tl.cast, sceneAt(tl, T)); // warm the actor cache
    const t0 = performance.now();
    for (let k = 0; k < 3; k++) for (const T of times) renderScene(tl.cast, sceneAt(tl, T));
    expect((performance.now() - t0) / (3 * times.length)).toBeLessThan(2);
  });
});

// ─── H6: special-move cut-ins and boss phase changes ────────────────────────

describe("cut-ins and phase changes", () => {
  const SUBTLE = hdFeel("subtle")!;
  const skillTurn = (): [Battle, Battle] => {
    const b0 = fight();
    return [b0, act(b0, { type: "skill", id: "strike" })];
  };
  const noHd = (cues: readonly Cue[]) => cues.map((c) => ({ ...c, stage: { ...c.stage, hd: c.stage.hd?.impact ? { impact: c.stage.hd.impact } : undefined } }));

  test("a skill is a special beat; the cell stage never sees the cut-in", () => {
    const [b0, b1] = skillTurn();
    expect(b1.beats![0]).toMatchObject({ t: "special", id: "strike", name: "Power Strike", line: -1 });
    const g = stageGeometry(b1, LOOK);
    const cues = direct(b0, b1, g);
    expect(cues.some((c) => c.stage.hd?.cutin?.name === "Power Strike")).toBe(true);
    // Without the beat, the choreography is the same cue for cue.
    const plain = { ...b1, beats: b1.beats!.filter((x) => x.t !== "special") };
    expect(noHd(cues)).toEqual(noHd(direct(b0, plain, g)));
  });

  test("full plays a skippable-length cut-in that freezes the fight; subtle doesn't", () => {
    const [b0, b1] = skillTurn();
    const full = timeline(b0, b1);
    const subtle = timeline(b0, b1, SUBTLE);
    expect(full.holds).toHaveLength(1);
    expect(subtle.holds).toHaveLength(0);
    const h = full.holds[0];
    expect(h).toMatchObject({ kind: "cutin", ms: CUTIN_MS, name: "Power Strike" });
    expect(full.cueMs - subtle.cueMs).toBe(CUTIN_MS);
    expect(motionTime(full, h.at + 500)).toBe(motionTime(full, h.at));
    const mid = sceneAt(full, h.at + 300);
    expect(mid.cutin).toMatchObject({ name: "Power Strike", by: "hero" });
    expect(hash(composeFrame(full.cast, mid, false))).not.toBe(hash(composeFrame(full.cast, { ...mid, cutin: undefined }, false)));
    expect(sceneAt(full, h.at + CUTIN_MS + 1).cutin).toBeUndefined();
    // Playback frames tile the whole timeline, holds included.
    const f = frameTimes(full);
    for (let i = 1; i < f.length; i++) expect(f[i][0]).toBe(f[i - 1][0] + f[i - 1][1]);
    expect(f.at(-1)![0] + f.at(-1)![1]).toBe(full.total);
  });

  test("a foe's move cuts in once per fight, mirrored; a boss's charged blow every time", () => {
    const def = ZONES.flatMap((z) => z.monsters).find((m) => m.id === "zalgo")!;
    let b = fight(makeMonster(def, 3));
    b.foe.atk = 1;
    let foeCuts = 0;
    let prev = b;
    for (let i = 0; i < 40 && !b.over; i++) {
      prev = b;
      b = act(b, { type: "defend" });
      const cuts = (b.beats ?? []).filter((x) => x.t === "special");
      for (const c of cuts) expect(c).toMatchObject({ by: "foe", name: "Double Strike", line: -1 });
      foeCuts += cuts.length;
      if (cuts.length) {
        const tl = timeline(prev, b);
        const h = tl.holds.find((x) => x.kind === "cutin")!;
        expect(h.by).toBe("foe");
        const s = sceneAt(tl, h.at + 300);
        expect(s.cutin?.by).toBe("foe");
        // Mirrored: the panel's bust sits on the right half.
        const fr = composeFrame(tl.cast, s, false);
        const plain = composeFrame(tl.cast, { ...s, cutin: undefined }, false);
        let left = 0;
        let right = 0;
        for (let y = 0; y < fr.height; y++) for (let x = 0; x < fr.width; x++) if (fr.get(x, y).join() !== plain.get(x, y).join()) (x < fr.width / 2 ? left++ : right++);
        expect(right).toBeGreaterThan(0);
      }
    }
    expect(foeCuts).toBe(1);
    expect(b.foe.shown).toBe(true);

    // The Missing Semicolon's charged PARSE ERROR always cuts in.
    let boss = fight(makeBoss("semicolon", 6));
    boss.foe.hp = boss.foe.maxHp = 100000;
    let parse = 0;
    for (let i = 0; i < 12; i++) {
      boss = act(boss, { type: "defend" });
      parse += (boss.beats ?? []).filter((x) => x.t === "special" && x.name === "Parse Error").length;
    }
    expect(parse).toBeGreaterThanOrEqual(2);
  });

  test("a boss crossing half HP gets the phase change: dim, glow, roar (shake gated)", () => {
    let pair: [Battle, Battle] | undefined;
    for (let seed = 1; seed < 400 && !pair; seed++) {
      const b0 = fight(makeBoss("segfault", 4), seed);
      b0.foe.hp = Math.floor(b0.foe.maxHp / 2) + 1;
      const b1 = act(b0, { type: "attack" });
      if ((b1.beats ?? []).some((x) => x.t === "speech" && x.phase) && !b1.over) pair = [b0, b1];
    }
    const [b0, b1] = pair!;
    const full = timeline(b0, b1);
    const h = full.holds.find((x) => x.kind === "phase")!;
    expect(h.ms).toBe(PHASE_MS);
    const s = sceneAt(full, h.at + PHASE_MS / 2);
    expect(s.phase).toBeGreaterThan(0.4);
    expect(full.traumas.some((t) => t.at > h.at && t.at < h.at + h.ms)).toBe(true);
    const subtle = timeline(b0, b1, SUBTLE);
    expect(subtle.holds.some((x) => x.kind === "phase")).toBe(true);
    expect(subtle.traumas).toHaveLength(0);
    // The dim darkens the stage around the boss.
    const lum = (fb: Framebuffer) => {
      let n = 0;
      for (let i = 0; i < fb.data.length; i += 4) n += fb.data[i] + fb.data[i + 1] + fb.data[i + 2];
      return n;
    };
    const dimmed = composeFrame(full.cast, { ...s, shake: [0, 0] }, false);
    const plain = composeFrame(full.cast, { ...s, shake: [0, 0], phase: undefined }, false);
    expect(dimmed.get(5, 5)[0] + dimmed.get(5, 5)[1]).toBeLessThan(plain.get(5, 5)[0] + plain.get(5, 5)[1]);
    expect(lum(dimmed)).not.toBe(lum(plain));
  });
});

// ─── Golden frames ──────────────────────────────────────────────────────────

/**
 * Golden pixel hashes for key stage frames. After an intentional change, run
 *   GOLDEN=print bun test server/rpg/hdstage.test.ts
 * and paste the printed table here.
 */
const GOLDEN: Record<string, number> = {
  rest: 2116264231,
  "rest/half": 2922357116,
  impact: 1043342693,
  "impact+120": 3761444489,
  end: 2180359525,
};

describe("golden frames", () => {
  const actual: Record<string, number> = {};
  const [b0, b1] = turn();
  const tl = timeline(b0, b1);
  const cast: HdCast = tl.cast;
  const j = impactIndex(tl, "hero");
  const g = stageGeometry(b1, LOOK);
  actual["rest"] = hash(composeFrame(cast, restScene(b1, [], g, cast), false));
  actual["rest/half"] = hash(composeFrame(cast, restScene(b1, [], g, cast), true));
  actual["impact"] = hash(composeFrame(cast, sceneAt(tl, tl.starts[j]), false));
  actual["impact+120"] = hash(composeFrame(cast, sceneAt(tl, tl.starts[j] + 120), false));
  actual["end"] = hash(composeFrame(cast, sceneAt(tl, tl.total - 1), false));
  test("match the recorded hashes", () => {
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    for (const [k, v] of Object.entries(GOLDEN)) expect(actual[k], k).toBe(v);
    expect(Object.keys(GOLDEN).length).toBe(Object.keys(actual).length);
  });
});
