/**
 * Portraits: a bust of an HD buddy, cut from its rig at rest.
 *
 * Used where a face beats a full body: the character sheet, event dialogue
 * boxes and the dashboard's buddy card. `bust` (32 × 28 px → 32 × 14 cells)
 * and `face` (22 × 18 px → 22 × 9 cells) are full resolution, one pixel per
 * column and two per row; `small` is the bust at half resolution. Species without HD art
 * return null and callers keep their ASCII art.
 */

import type { Rarity, Species } from "../engine";
import { encodeHalfblock, type ColorMode } from "../gfx/encode/halfblock.ts";
import { Framebuffer, hex, mix } from "../gfx/framebuffer.ts";
import { headAt, renderHd } from "../gfx/hd.ts";
import { downsample2 } from "../rpg/hdstage.ts";

export type PortraitSize = "bust" | "face" | "small";

export interface PortraitOpts {
  rarity?: Rarity;
  shiny?: boolean;
  size?: PortraitSize;
  color?: ColorMode;
  /** Idle clock (seconds): breathing and blinks for a living portrait. */
  t?: number;
  seed?: number;
}

/** Crop boxes (rig pixels): head and shoulders, or just the face. */
const BOX: Record<PortraitSize, [number, number]> = { bust: [32, 28], small: [32, 28], face: [22, 18] };

/** The portrait as pixels, or null without HD art. */
export function portraitPixels(species: Species, o: PortraitOpts = {}): Framebuffer | null {
  const full = renderHd(species, "idle", o.t ?? 0, { rarity: o.rarity, shiny: o.shiny, seed: o.seed ?? 1 });
  if (!full) return null;
  const [W, H] = BOX[o.size ?? "bust"];
  // Center on the head (rigs pivot it at the neck: the face sits above).
  const [hx, hy] = headAt(species) ?? [full.width / 2, 30];
  const x0 = Math.round(Math.max(0, Math.min(full.width - W, hx - W / 2)));
  const y0 = Math.round(Math.max(0, Math.min(full.height - H, hy - H * (o.size === "face" ? 0.8 : 0.74))));
  // A soft vignette frame behind the bust.
  const out = new Framebuffer(W, H);
  const inner = hex("#3a2e5a");
  const outer = hex("#120e22");
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H * 0.45) / (H * 0.6));
      out.set(x, y, mix(inner, outer, Math.min(1, d)));
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = full.get(x0 + x, y0 + y);
    if (c[3]) out.blend(x, y, c);
  }
  return o.size === "small" ? downsample2(out) : out;
}

/** The portrait as half-block lines (rows: 14 bust, 9 face, 7 small). */
export function portrait(species: Species, o: PortraitOpts = {}): string[] | null {
  const fb = portraitPixels(species, o);
  return fb ? encodeHalfblock(fb, { color: o.color ?? "truecolor" }) : null;
}
