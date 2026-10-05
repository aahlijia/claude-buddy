/**
 * Banners: big "VICTORY" / "LEVEL UP" / "BOSS DOWN" type.
 *
 * The 3×5 pixel font (gfx/font.ts) drawn into a framebuffer, then shown
 * as half-blocks: four terminal rows tall. Rich face: a vertical gradient
 * with a drop shadow, truecolor or 256-color. Classic face (T0): the same
 * letter shapes in plain `█▀▄` block characters, no color.
 */

import { encodeHalfblock } from "../gfx/encode/halfblock.ts";
import { drawText, textWidth } from "../gfx/font.ts";
import { Framebuffer, mix, type RGBA } from "../gfx/framebuffer.ts";
import { lerpRgb, type RGB, type Ui } from "./color.ts";

export const BANNER_ROWS = 4;

export interface BannerOpts {
  from: RGB;
  to: RGB;
  /** 0..1: how much of the text is shown, opening from the center. */
  reveal?: number;
  /** 0..1 white flash. */
  flash?: number;
}

/** Render a banner to the framebuffer (1px margin for the shadow). */
export function bannerPixels(text: string, o: BannerOpts): Framebuffer {
  const w = textWidth(text) + 2;
  const fb = new Framebuffer(w, 2 * BANNER_ROWS);
  // A drop shadow one pixel down-right, then the glyphs.
  drawText(fb, text, 2, 2, [40, 30, 60, 255]);
  drawText(fb, text, 1, 1, [255, 255, 255, 255]);
  const reveal = o.reveal ?? 1;
  const half = (w / 2) * reveal;
  for (let y = 0; y < fb.height; y++) {
    const c = lerpRgb(o.from, o.to, (y - 1) / 4);
    for (let x = 0; x < fb.width; x++) {
      const px = fb.get(x, y);
      if (!px[3]) continue;
      if (Math.abs(x + 0.5 - w / 2) >= half) {
        fb.set(x, y, [0, 0, 0, 0]);
        continue;
      }
      // White glyph pixels take the gradient; the shadow stays dark.
      let out: RGBA = px[0] > 128 ? [c[0], c[1], c[2], 255] : px;
      if (o.flash) out = mix(out, [255, 255, 255, 255], o.flash);
      fb.set(x, y, out);
    }
  }
  return fb;
}

/** BANNER_ROWS lines, centered in `cols`. */
export function banner(ui: Pick<Ui, "mode"> | undefined, text: string, o: BannerOpts, cols: number): string[] {
  const fb = bannerPixels(text, o);
  const lines = ui ? encodeHalfblock(fb, { color: ui.mode }) : monochrome(fb);
  const pad = " ".repeat(Math.max(0, Math.floor((cols - fb.width) / 2)));
  return lines.map((l) => pad + l);
}

/** T0: block characters from the glyph mask (shadow dropped). */
function monochrome(fb: Framebuffer): string[] {
  const on = (x: number, y: number) => {
    const c = fb.get(x, y);
    return c[3] > 0 && c[0] > 60;
  };
  const out: string[] = [];
  for (let y = 0; y < fb.height; y += 2) {
    let l = "";
    for (let x = 0; x < fb.width; x++) {
      const t = on(x, y);
      const b = on(x, y + 1);
      l += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    }
    out.push(l.replace(/\s+$/, ""));
  }
  return out;
}

/** The banner opening from its center, a flash (if allowed), then settled. */
export function bannerFrames(ui: Ui, text: string, colors: { from: RGB; to: RGB }, cols: number): { lines: string[]; ms: number }[] {
  const frames: { lines: string[]; ms: number }[] = [];
  const steps = ui.motion ? 6 : 0;
  for (let i = 1; i <= steps; i++) frames.push({ lines: banner(ui, text, { ...colors, reveal: i / steps }, cols), ms: 30 });
  if (ui.flash) frames.push({ lines: banner(ui, text, { ...colors, flash: 0.85 }, cols), ms: 70 });
  frames.push({ lines: banner(ui, text, colors, cols), ms: 0 });
  return frames;
}
