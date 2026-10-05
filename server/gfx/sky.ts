/**
 * Day and night for the diorama (H4, docs/game-feel/hd-overhaul/h4-diorama.md).
 *
 * The real clock (as a fractional hour, 0–24) becomes three weights — day,
 * dusk and night — that blend a biome's three sky palettes, tint everything
 * standing in the scene, place the sun or moon, and light the windows.
 * Pure: the caller reads the clock, this only maps an hour to colors.
 */

import { mix, type RGBA } from "./framebuffer.ts";

export interface SkyPalette {
  /** Sky gradient [top, horizon] at noon, at dusk/dawn, at midnight. */
  day: readonly [RGBA, RGBA];
  dusk: readonly [RGBA, RGBA];
  night: readonly [RGBA, RGBA];
}

export interface Phase {
  day: number;
  dusk: number;
  night: number;
}

/**
 * Hour → phase weights (they sum to 1). Night until 5, a dawn that passes
 * through the dusk palette (5–7), day 7–17, a warm dusk peaking at 18:15,
 * night again from 19:30.
 */
export function phaseAt(hour: number): Phase {
  const h = ((hour % 24) + 24) % 24;
  const ramp = (a: number, b: number) => Math.max(0, Math.min(1, (h - a) / (b - a)));
  if (h < 5) return { day: 0, dusk: 0, night: 1 };
  if (h < 6) { const k = ramp(5, 6); return { day: 0, dusk: k, night: 1 - k }; }
  if (h < 7) { const k = ramp(6, 7); return { day: k, dusk: 1 - k, night: 0 }; }
  if (h < 17) return { day: 1, dusk: 0, night: 0 };
  if (h < 18.25) { const k = ramp(17, 18.25); return { day: 1 - k, dusk: k, night: 0 }; }
  if (h < 19.5) { const k = ramp(18.25, 19.5); return { day: 0, dusk: 1 - k, night: k }; }
  return { day: 0, dusk: 0, night: 1 };
}

function blend3(p: Phase, a: RGBA, b: RGBA, c: RGBA): RGBA {
  // day → dusk → night as two lerps keeps the weights exact.
  const dn = p.dusk + p.night;
  const tail = dn > 0 ? mix(b, c, p.night / dn) : b;
  return mix(a, tail, dn);
}

export interface Light {
  phase: Phase;
  /** Sky gradient, top and horizon. */
  top: RGBA;
  horizon: RGBA;
  /** Per-channel multiplier for everything standing in the scene. */
  ambient: readonly [number, number, number];
  /** 0..1 how lit the windows are (and how visible the stars). */
  lamps: number;
  /** Sun or moon on a 0..1 arc (x across, y down from the top); null below the horizon. */
  sun: { x: number; y: number } | null;
  moon: { x: number; y: number } | null;
}

const AMBIENT_DAY = [1, 1, 1] as const;
const AMBIENT_DUSK = [1.02, 0.82, 0.74] as const;
const AMBIENT_NIGHT = [0.42, 0.48, 0.72] as const;

/** A body's place on its arc: rises at `rise`, sets at `set` (hours, may wrap). */
function arc(hour: number, rise: number, set: number): { x: number; y: number } | null {
  const len = (set - rise + 24) % 24;
  const u = ((hour - rise + 24) % 24) / len;
  if (u < 0 || u > 1) return null;
  return { x: 0.08 + 0.84 * u, y: 0.9 - 0.75 * Math.sin(Math.PI * u) };
}

export function lightAt(sky: SkyPalette, hour: number): Light {
  const p = phaseAt(hour);
  const amb = [0, 1, 2].map((i) => AMBIENT_DAY[i] * p.day + AMBIENT_DUSK[i] * p.dusk + AMBIENT_NIGHT[i] * p.night) as unknown as [number, number, number];
  return {
    phase: p,
    top: blend3(p, sky.day[0], sky.dusk[0], sky.night[0]),
    horizon: blend3(p, sky.day[1], sky.dusk[1], sky.night[1]),
    ambient: amb,
    lamps: Math.min(1, p.night + p.dusk * 0.6),
    sun: p.night < 1 ? arc(hour, 5.5, 19.25) : null,
    moon: p.night > 0 || p.dusk > 0.5 ? arc(hour, 18.5, 6.5) : null,
  };
}

/** Light a scene color: multiply by the ambient light, then fade toward the
 *  horizon by `haze` (atmospheric perspective for the far layers). */
export function shade(c: RGBA, light: Light, haze = 0): RGBA {
  const lit: RGBA = [
    Math.min(255, Math.round(c[0] * light.ambient[0])),
    Math.min(255, Math.round(c[1] * light.ambient[1])),
    Math.min(255, Math.round(c[2] * light.ambient[2])),
    c[3],
  ];
  if (haze <= 0) return lit;
  const h = mix(lit, light.horizon, haze);
  return [h[0], h[1], h[2], c[3]];
}

/**
 * The hour a diorama should show for a wall-clock Date, quantized to
 * `stepMin` minutes so slow layers only re-render when the light really
 * changes (kitty re-sends the backdrop once per step).
 */
export function hourOf(d: Date, stepMin = 0): number {
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const q = stepMin > 0 ? Math.floor(m / stepMin) * stepMin : m;
  return q / 60;
}
