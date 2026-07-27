import { describe, test, expect } from "bun:test";
import {
  pickSessionGround,
  pickSessionWeather,
  isWeatherActive,
  buildWeatherTile,
  ALL_GROUND_GLYPHS,
  ALL_GROUND_WEATHER_GLYPHS,
  type WeatherSchedule,
} from "./ground.ts";
import { mirrorFrame, displayWidth } from "./art.ts";

describe("living ground selection (living-world follow-up)", () => {
  test("same session seed ⇒ same terrain (session-stable, deterministic)", () => {
    const a = pickSessionGround(1_700_000_000);
    const b = pickSessionGround(1_700_000_000);
    expect(a).toEqual(b);
  });

  test("pure: no clock/disk read internally — a fixed seed is byte-identical", () => {
    expect(pickSessionGround(42)).toEqual(pickSessionGround(42));
  });

  test("a different session seed can re-roll the terrain (new session ⇒ new ground)", () => {
    // The whole point of the feature: sweep a run of session seeds and prove
    // the selection is not pinned to one terrain. (The table is small, so not
    // every adjacent pair differs — but the set of names produced must be > 1.)
    const names = new Set<string>();
    for (let s = 0; s < 60; s++) names.add(pickSessionGround(s).name);
    expect(names.size).toBeGreaterThan(1);
  });

  test("every terrain returns a non-empty tile and a 6-hex colour", () => {
    for (let s = 0; s < 60; s++) {
      const t = pickSessionGround(s);
      expect(t.tile.length).toBeGreaterThan(0);
      expect(t.color).toMatch(/^[0-9a-fA-F]{6}$/);
    }
  });

  test("every ground glyph is ANSI-free and exactly one display cell wide", () => {
    // The shell tiles + clips the row by code-point count, which only equals
    // the column count when every glyph is a single display cell.
    expect(ALL_GROUND_GLYPHS.length).toBeGreaterThan(0);
    for (const g of ALL_GROUND_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(displayWidth(g)).toBe(1);
    }
  });

  test("every ground glyph survives mirrorFrame unchanged (MIRROR_SWAP-safe)", () => {
    // The ground row is never mirrored, but — like props.test.ts's identical
    // check — a cheap defensive assertion that no glyph aliases a swap pair.
    for (const g of ALL_GROUND_GLYPHS) {
      const mirrored = mirrorFrame([`  ${g}  `]).join("\n");
      expect(mirrored).toContain(g);
    }
  });
});

describe("ground weather schedule (living-world follow-up)", () => {
  test("same session seed ⇒ same schedule (or same no-weather), deterministic", () => {
    const a = pickSessionWeather(1_700_000_000);
    const b = pickSessionWeather(1_700_000_000);
    expect(a).toEqual(b);
  });

  test("a seed sweep produces both weather and no-weather sessions", () => {
    let sawWeather = false,
      sawNone = false;
    for (let s = 0; s < 500; s++) {
      if (pickSessionWeather(s) === null) sawNone = true;
      else sawWeather = true;
    }
    expect(sawWeather).toBe(true);
    expect(sawNone).toBe(true);
  });

  test("a seed sweep produces both snow and rain", () => {
    const kinds = new Set<string>();
    for (let s = 0; s < 500; s++) {
      const sched = pickSessionWeather(s);
      if (sched) kinds.add(sched.kind);
    }
    expect(kinds.has("snow")).toBe(true);
    expect(kinds.has("rain")).toBe(true);
  });

  test("isWeatherActive: boundary sweep on a fixed schedule", () => {
    const sched: WeatherSchedule = {
      kind: "snow",
      startMs: 60_000,
      durationMs: 120_000,
    };
    expect(isWeatherActive(sched, 59_999)).toBe(false); // just before start
    expect(isWeatherActive(sched, 60_000)).toBe(true); // exactly at start
    expect(isWeatherActive(sched, 179_999)).toBe(true); // just before end
    expect(isWeatherActive(sched, 180_000)).toBe(false); // exactly at end
  });

  test("isWeatherActive: null schedule is always inactive", () => {
    expect(isWeatherActive(null, 0)).toBe(false);
    expect(isWeatherActive(null, 999_999)).toBe(false);
  });

  test("buildWeatherTile: same seed ⇒ same woven tile (deterministic, replayable)", () => {
    const terrain = pickSessionGround(42);
    const a = buildWeatherTile(terrain, "rain", 42, "dark");
    const b = buildWeatherTile(terrain, "rain", 42, "dark");
    expect(a).toEqual(b);
  });

  test("buildWeatherTile: woven tile is longer than the plain terrain unit and contains the weather glyph", () => {
    const terrain = pickSessionGround(42);
    const woven = buildWeatherTile(terrain, "snow", 42, "dark");
    expect(woven.tile.length).toBeGreaterThan(terrain.tile.length);
    expect(woven.tile).toContain(woven.glyph);
  });

  // 2026-07-24 follow-up: the dark-theme snow color (a pale white-blue) is
  // nearly invisible on a light terminal background — user-reported. Pin
  // that the two themes actually produce visibly distinct colors, not the
  // same hex regardless of the theme argument.
  test("buildWeatherTile: light theme uses a distinct, darker color than dark theme (readable on a light background)", () => {
    const terrain = pickSessionGround(42);
    const dark = buildWeatherTile(terrain, "snow", 42, "dark");
    const light = buildWeatherTile(terrain, "snow", 42, "light");
    expect(light.color).not.toBe(dark.color);
    // "readable on light bg" ⇒ each channel is meaningfully darker than the
    // pale dark-theme value, not just a different-but-still-near-white hex.
    const [dr, dg, db] = [0, 2, 4].map((i) =>
      parseInt(dark.color.slice(i, i + 2), 16),
    );
    const [lr, lg, lb] = [0, 2, 4].map((i) =>
      parseInt(light.color.slice(i, i + 2), 16),
    );
    expect(lr).toBeLessThan(dr);
    expect(lg).toBeLessThan(dg);
    expect(lb).toBeLessThan(db);
  });

  test("weather glyphs never collide with any TERRAINS glyph (the field/',' bug this GATE exists to prevent)", () => {
    for (const g of ALL_GROUND_WEATHER_GLYPHS) {
      expect(ALL_GROUND_GLYPHS).not.toContain(g);
    }
  });

  test("every weather glyph is ANSI-free, single display cell, and MIRROR_SWAP-safe", () => {
    for (const g of ALL_GROUND_WEATHER_GLYPHS) {
      expect(g).not.toContain("\x1b");
      expect(displayWidth(g)).toBe(1);
      const mirrored = mirrorFrame([`  ${g}  `]).join("\n");
      expect(mirrored).toContain(g);
    }
  });
});
