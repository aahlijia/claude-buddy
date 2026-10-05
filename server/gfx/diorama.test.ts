import { describe, expect, test } from "bun:test";

import { BIOME_NAMES, BIOME_SCENES, biomeScene } from "./biomes.ts";
import {
  NO_ACTIVITY,
  beatAt,
  buddyScale,
  buddySprite,
  cameraFor,
  composeDiorama,
  dioramaLight,
  dioramaSpec,
  downscale,
  fieldsFor,
  lightningAt,
  paintFront,
  panMargin,
  reactionFor,
  stepBeat,
  wanderZone,
  type Activity,
  type DioramaSpec,
} from "./diorama.ts";
import { crc32 } from "./encode/png.ts";
import { Framebuffer } from "./framebuffer.ts";
import { FIELD_KINDS, FIELD_LOOP, fieldAt } from "./particles.ts";
import { lightAt, phaseAt } from "./sky.ts";

const hash = (fb: Framebuffer) => crc32(new Uint8Array(fb.data.buffer, fb.data.byteOffset, fb.data.byteLength));

function spec(o: Partial<Parameters<typeof dioramaSpec>[0]> = {}): DioramaSpec {
  return dioramaSpec({ biome: "meadow", rarity: "rare", species: "cat", w: 96, h: 32, hour: 12, seed: 5, ...o });
}

describe("day and night", () => {
  test("phase weights sum to 1 around the clock", () => {
    for (let h = 0; h < 24; h += 0.25) {
      const p = phaseAt(h);
      expect(p.day + p.dusk + p.night).toBeCloseTo(1, 9);
    }
    expect(phaseAt(12)).toEqual({ day: 1, dusk: 0, night: 0 });
    expect(phaseAt(0)).toEqual({ day: 0, dusk: 0, night: 1 });
    expect(phaseAt(18.25).dusk).toBeCloseTo(1, 9);
  });

  test("the sun is up at noon, the moon and the lamps at midnight", () => {
    const sky = BIOME_SCENES.meadow.sky;
    expect(lightAt(sky, 12).sun).not.toBeNull();
    expect(lightAt(sky, 12).lamps).toBe(0);
    expect(lightAt(sky, 0).sun).toBeNull();
    expect(lightAt(sky, 0).moon).not.toBeNull();
    expect(lightAt(sky, 0).lamps).toBe(1);
  });

  test("dusk is warm, night is dark and blue", () => {
    const sky = BIOME_SCENES.meadow.sky;
    const dusk = lightAt(sky, 18.25).ambient;
    const night = lightAt(sky, 1).ambient;
    expect(dusk[0]).toBeGreaterThan(dusk[2]);
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(night[0]).toBeLessThan(0.6);
  });

  test("overcast weather dims the light and hides the sun", () => {
    const clear = dioramaLight(spec());
    const storm = dioramaLight(spec({ weather: "storm" }));
    expect(storm.ambient[0]).toBeLessThan(clear.ambient[0]);
    expect(storm.sun).toBeNull();
  });

  test("biomes that pin their hour ignore the clock", () => {
    const a = composeDiorama(spec({ biome: "space", hour: 12 }), { t: 0, beat: beatAt(spec({ biome: "space" }), 0, [30, 60]) });
    const b = composeDiorama(spec({ biome: "space", hour: 3 }), { t: 0, beat: beatAt(spec({ biome: "space" }), 0, [30, 60]) });
    expect(hash(a)).toBe(hash(b));
  });
});

describe("scene", () => {
  test("deterministic: same spec + time → same pixels", () => {
    const s = spec({ weather: "rain" });
    const beat = beatAt(s, 4.2, wanderZone(s.w, 24));
    expect(hash(composeDiorama(s, { t: 4.2, beat }))).toBe(hash(composeDiorama(s, { t: 4.2, beat })));
  });

  test("the time of day changes the picture", () => {
    const at = (hour: number) => {
      const s = spec({ hour });
      return hash(composeDiorama(s, { t: 1, beat: beatAt(s, 1, wanderZone(s.w, 24)) }));
    };
    expect(new Set([at(12), at(18.3), at(0)]).size).toBe(3);
  });

  test("every biome renders, opaque, at every tier's density", () => {
    for (const name of BIOME_NAMES) {
      for (const [w, h] of [[120, 18], [240, 36], [480, 72]]) {
        const s = spec({ biome: name, w, h });
        const fb = composeDiorama(s, { t: 2, beat: beatAt(s, 2, wanderZone(w, w * 0.2)) });
        expect([fb.width, fb.height]).toEqual([w, h]);
        for (const [x, y] of [[0, 0], [w - 1, h - 1], [w >> 1, h >> 1]]) expect(fb.get(x, y)[3]).toBe(255);
      }
    }
  });

  test("biome lookup: override, rarity default, fallback", () => {
    expect(biomeScene("common").name).toBe("meadow");
    expect(biomeScene("legendary").name).toBe("space");
    expect(biomeScene("rare", "volcano").name).toBe("volcano");
    expect(biomeScene("rare", "nope").name).toBe("ocean");
    expect(BIOME_NAMES.length).toBe(15);
  });
});

describe("golden frames", () => {
  // One hash per biome × time of day, at the half-block size of a 50-row
  // terminal (96 × 18). Re-record with GOLDEN=print after an intended art change.
  const actual: Record<string, number> = {};
  for (const name of BIOME_NAMES) {
    for (const [label, hour] of [["noon", 12.5], ["dusk", 18.4], ["night", 23.5]] as const) {
      const s = spec({ biome: name, hour, w: 96, h: 18, species: "dragon" });
      actual[`${name}/${label}`] = hash(composeDiorama(s, { t: 3, beat: beatAt(s, 3, wanderZone(96, 20)) }));
    }
  }
  test("match the recorded hashes", () => {
    if (process.env.GOLDEN === "print") console.log(JSON.stringify(actual, null, 2));
    for (const [k, v] of Object.entries(GOLDEN)) expect(actual[k], k).toBe(v);
    expect(Object.keys(GOLDEN).length).toBe(Object.keys(actual).length);
  });
});

describe("weather particles", () => {
  test("every field kind is deterministic and loops every FIELD_LOOP seconds", () => {
    for (const kind of FIELD_KINDS) {
      const f = { kind, seed: 3 };
      const a = fieldAt(f, 200, 36, 1.3, 2);
      expect(a.length).toBeGreaterThan(0);
      expect(fieldAt(f, 200, 36, 1.3, 2)).toEqual(a);
      const b = fieldAt(f, 200, 36, 1.3 + FIELD_LOOP, 2);
      expect(b.length).toBe(a.length);
      b.forEach((p, i) => {
        expect(p.x).toBeCloseTo(a[i].x, 6);
        expect(p.y).toBeCloseTo(a[i].y, 6);
      });
    }
  });

  test("rain falls and embers rise", () => {
    // Over a short step most particles move the same way (a few wrap around).
    const fall = fieldAt({ kind: "rain", seed: 9 }, 200, 36, 0.01, 2).filter((p, i) => fieldAt({ kind: "rain", seed: 9 }, 200, 36, 0.02, 2)[i].y > p.y).length;
    expect(fall).toBeGreaterThan(fieldAt({ kind: "rain", seed: 9 }, 200, 36, 0.01, 2).length * 0.8);
    const rise = fieldAt({ kind: "embers", seed: 9 }, 200, 36, 0.01, 2).filter((p, i) => fieldAt({ kind: "embers", seed: 9 }, 200, 36, 0.05, 2)[i].y < p.y).length;
    expect(rise).toBeGreaterThan(fieldAt({ kind: "embers", seed: 9 }, 200, 36, 0.01, 2).length * 0.8);
  });

  test("living-world weather maps to fields", () => {
    expect(fieldsFor(spec()).length).toBe(0);
    expect(fieldsFor(spec({ weather: "rain" })).map((f) => f.kind)).toEqual(["rain"]);
    expect(fieldsFor(spec({ weather: "snow" })).map((f) => f.kind)).toEqual(["snow"]);
    expect(fieldsFor(spec({ weather: "sparkle" })).map((f) => f.kind)).toEqual(["sparkles"]);
    // Biome ambience comes on top (sakura petals), and night-only ambience waits for dark.
    expect(fieldsFor(spec({ biome: "sakura" })).map((f) => f.kind)).toEqual(["leaves"]);
    expect(fieldsFor(spec({ biome: "meadow", hour: 0 })).map((f) => f.kind)).toEqual(["fireflies"]);
  });

  test("lightning only in storms, and only when flashes are allowed", () => {
    const strike = 0.63 * FIELD_LOOP;
    expect(lightningAt(spec({ weather: "storm", flash: true }), strike)).toBe(1);
    expect(lightningAt(spec({ weather: "storm", flash: false }), strike)).toBe(0);
    expect(lightningAt(spec({ weather: "rain", flash: true }), strike)).toBe(0);
    const front = (flash: boolean) => {
      const fb = new Framebuffer(96, 32);
      paintFront(fb, spec({ weather: "storm", flash }), strike);
      return hash(fb);
    };
    expect(front(true)).not.toBe(front(false));
  });

  test("particle density scales the count (half-blocks thin the weather)", () => {
    const n = (particles: number) => {
      const fb = new Framebuffer(200, 36);
      paintFront(fb, spec({ w: 200, h: 36, weather: "snow", particles }), 1);
      let k = 0;
      for (let i = 3; i < fb.data.length; i += 4) if (fb.data[i]) k++;
      return k;
    };
    expect(n(0.3)).toBeLessThan(n(1) * 0.6);
  });
});

describe("the buddy's director", () => {
  const s = spec({ w: 240, h: 36 });
  const zone = wanderZone(240, 50);

  test("wanders inside its zone, walking between idles", () => {
    const anims = new Set<string>();
    for (let t = 0; t < 120; t += 0.37) {
      const b = beatAt(s, t, zone);
      expect(b.x).toBeGreaterThanOrEqual(zone[0] - 0.01);
      expect(b.x).toBeLessThanOrEqual(zone[1] + 0.01);
      anims.add(b.anim);
    }
    expect([...anims].sort()).toEqual(["idle", "walk"]);
  });

  test("faces the way it walks", () => {
    for (let t = 0; t < 60; t += 0.1) {
      const a = beatAt(s, t, zone);
      const b = beatAt(s, t + 0.05, zone);
      if (a.anim === "walk" && b.anim === "walk" && Math.abs(b.x - a.x) > 0.01) expect(a.flip).toBe(b.x < a.x);
    }
  });

  test("a reaction plays its pose and freezes the walk; the walk resumes after", () => {
    // Find a moment mid-walk.
    let t0 = 0;
    while (beatAt(s, t0, zone).anim !== "walk") t0 += 0.1;
    const act: Activity = { holds: [{ kind: "flinch", from: t0, to: t0 + 0.9 }], heldBefore: 0 };
    const during = beatAt(s, t0 + 0.3, zone, act);
    expect(during.anim).toBe("hit");
    expect(during.x).toBeCloseTo(beatAt(s, t0, zone).x, 6);
    // After the hold, the wander clock is 0.9 s behind.
    expect(beatAt(s, t0 + 2, zone, act).x).toBeCloseTo(beatAt(s, t0 + 1.1, zone).x, 6);
    const cheer: Activity = { holds: [{ kind: "cheer", from: 1, to: 3.2 }], heldBefore: 0 };
    expect(beatAt(s, 2, zone, cheer).anim).toBe("victory");
    const nod: Activity = { holds: [{ kind: "nod", from: 1, to: 2.1 }], heldBefore: 0 };
    expect(Math.max(...[1.1, 1.15, 1.2].map((t) => beatAt(s, t, zone, nod).dy))).toBeGreaterThan(0);
  });

  test("thinking stands still with the dots", () => {
    const act: Activity = { holds: [{ kind: "think", from: 2, to: Infinity }], heldBefore: 0 };
    const a = beatAt(s, 10, zone, act);
    const b = beatAt(s, 50, zone, act);
    expect(a.think).toBe(true);
    expect(a.x).toBe(b.x);
    expect(a.anim).toBe("idle");
    expect(hash(composeDiorama(s, { t: 10, beat: { ...a, thinkT: 1 } }))).not.toBe(hash(composeDiorama(s, { t: 10, beat: { ...a, think: false } })));
  });

  test("reduceMotion: one still pose, mid-zone", () => {
    const a = beatAt(s, 3, zone, NO_ACTIVITY, true);
    const b = beatAt(s, 47, zone, NO_ACTIVITY, true);
    expect(a).toEqual(b);
    expect(a.anim).toBe("idle");
    expect(beatAt(s, 2, zone, { holds: [{ kind: "cheer", from: 1, to: 3 }], heldBefore: 0 }, true).anim).toBe("victory");
  });

  test("hook reasons map to reactions", () => {
    expect(reactionFor("error")).toBe("flinch");
    expect(reactionFor("test-fail")).toBe("flinch");
    expect(reactionFor("all-green")).toBe("cheer");
    expect(reactionFor("recovery-from-test-fail")).toBe("cheer");
    expect(reactionFor("commit")).toBe("nod");
    expect(reactionFor("turn")).toBeNull();
    expect(reactionFor(undefined)).toBeNull();
  });

  test("stepped beats land on whole frames", () => {
    const a = stepBeat({ anim: "idle", t: 0.13, x: 0, flip: false, dy: 0, think: false, thinkT: 0 });
    const b = stepBeat({ anim: "idle", t: 0.14, x: 0, flip: false, dy: 0, think: false, thinkT: 0 });
    expect(a.frame).toBe(b.frame);
    expect(a.beat.t).toBe(b.beat.t);
  });

  test("the camera follows loosely and stays inside the pan margin", () => {
    expect(Math.abs(cameraFor(s, 0))).toBeLessThanOrEqual(panMargin(240));
    expect(cameraFor(s, 240)).toBeGreaterThan(0);
    expect(cameraFor(s, 120)).toBe(0);
  });
});

describe("buddy scale", () => {
  test("fits the panel: 1× in kitty, shrunk in half-blocks", () => {
    expect(buddyScale(72)).toBe(1);
    expect(buddyScale(18)).toBe(3);
  });

  test("downscale keeps hard edges (every pixel opaque or empty)", () => {
    const fb = new Framebuffer(9, 9);
    fb.ellipse(4.5, 4.5, 4, 4, [200, 100, 50, 255]);
    const d = downscale(fb, 3);
    expect([d.width, d.height]).toEqual([3, 3]);
    for (let i = 3; i < d.data.length; i += 4) expect([0, 255]).toContain(d.data[i]);
    expect(d.get(1, 1)[3]).toBe(255);
  });
});

const GOLDEN: Record<string, number> = {
  "meadow/noon": 3859767281,
  "meadow/dusk": 3087728967,
  "meadow/night": 1865777714,
  "forest/noon": 2492134120,
  "forest/dusk": 1382533198,
  "forest/night": 533817540,
  "ocean/noon": 3081325854,
  "ocean/dusk": 2306937435,
  "ocean/night": 2906579470,
  "cyberpunk/noon": 2537067878,
  "cyberpunk/dusk": 162598565,
  "cyberpunk/night": 3446715591,
  "space/noon": 4011323617,
  "space/dusk": 4011323617,
  "space/night": 4011323617,
  "volcano/noon": 529940234,
  "volcano/dusk": 3869526040,
  "volcano/night": 2427653434,
  "arctic/noon": 545459617,
  "arctic/dusk": 983036831,
  "arctic/night": 2453819990,
  "desert/noon": 3040335607,
  "desert/dusk": 3790760262,
  "desert/night": 4287709419,
  "haunted/noon": 1593159334,
  "haunted/dusk": 3737835626,
  "haunted/night": 649240990,
  "sakura/noon": 45925411,
  "sakura/dusk": 4118770302,
  "sakura/night": 1334099132,
  "underwater/noon": 2593866799,
  "underwater/dusk": 3999321324,
  "underwater/night": 3725701409,
  "candyland/noon": 475499844,
  "candyland/dusk": 1886125122,
  "candyland/night": 2817059086,
  "dungeon/noon": 1062261835,
  "dungeon/dusk": 1062261835,
  "dungeon/night": 1062261835,
  "cloudkingdom/noon": 1888607622,
  "cloudkingdom/dusk": 760043538,
  "cloudkingdom/night": 2072378904,
  "matrix/noon": 264395090,
  "matrix/dusk": 264395090,
  "matrix/night": 264395090,
};

describe("gear in the diorama", () => {
  test("a hatted buddy wears it and keeps its feet on the same spot", () => {
    for (const h of [32, 96]) {
      const bare = spec({ h });
      const worn = spec({ h, gear: { hat: "wizard", trinket: "duck" } });
      const beat = beatAt(bare, 1, wanderZone(bare.w, 24));
      const a = buddySprite(bare, beat, 0)!;
      const b = buddySprite(worn, beat, 0)!;
      expect(b.y + b.fb.height).toBe(a.y + a.fb.height);
      expect(b.fb.height).toBeGreaterThan(a.fb.height);
      expect(hash(b.fb)).not.toBe(hash(a.fb));
    }
  });
});
