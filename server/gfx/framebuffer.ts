/**
 * Framebuffer — an RGBA pixel grid every HD surface draws into.
 *
 * Pure and allocation-light: no clock, no I/O. Encoders (encode/*.ts) turn
 * a framebuffer into terminal output; the rig (blob.ts) draws into one.
 * See docs/game-feel/hd-overhaul/brainstorm.md §0.
 */

/** Straight (non-premultiplied) RGBA, each channel 0–255. */
export type RGBA = readonly [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

/** "#rrggbb" or "#rrggbbaa" → RGBA. */
export function hex(s: string): RGBA {
  const h = s.replace(/^#/, "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 255];
}

/** Linear blend of two colors (alpha included). */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
}

export class Framebuffer {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  /** Overwrite a pixel (no blending). */
  set(x: number, y: number, c: RGBA): void {
    if (!this.inBounds(x, y)) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Source-over composite `c` onto the pixel, with an extra opacity factor. */
  blend(x: number, y: number, c: RGBA, opacity = 1): void {
    if (!this.inBounds(x, y)) return;
    const sa = (c[3] / 255) * opacity;
    if (sa <= 0) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      d[i + k] = Math.round((c[k] * sa + d[i + k] * da * (1 - sa)) / oa);
    }
    d[i + 3] = Math.round(oa * 255);
  }

  /** Additive light (glows, sparkles): brightens without darkening. */
  add(x: number, y: number, c: RGBA, opacity = 1): void {
    if (!this.inBounds(x, y)) return;
    const k = (c[3] / 255) * opacity;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    d[i] += c[0] * k;
    d[i + 1] += c[1] * k;
    d[i + 2] += c[2] * k;
    d[i + 3] = Math.max(d[i + 3], Math.round(k * 255));
  }

  fill(c: RGBA): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.set(x, y, c);
  }

  /** Vertical gradient fill (sky backdrops). */
  gradient(top: RGBA, bottom: RGBA): void {
    for (let y = 0; y < this.height; y++) {
      const c = mix(top, bottom, this.height > 1 ? y / (this.height - 1) : 0);
      for (let x = 0; x < this.width; x++) this.set(x, y, c);
    }
  }

  /** Filled axis-aligned ellipse, alpha-blended with a soft 1px edge. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, opacity = 1): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        // ~1px antialiased rim, measured along the smaller radius
        const edge = (1 - d) * Math.min(rx, ry);
        if (edge <= 0) continue;
        this.blend(x, y, c, opacity * Math.min(1, edge));
      }
    }
  }

  /** Composite another framebuffer at (dx, dy). */
  draw(src: Framebuffer, dx: number, dy: number, opacity = 1): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c[3]) this.blend(dx + x, dy + y, c, opacity);
      }
    }
  }

  /** Nearest-neighbor integer upscale (keeps pixel art crisp). */
  upscale(k: number): Framebuffer {
    const n = Math.max(1, Math.floor(k));
    if (n === 1) return this;
    const out = new Framebuffer(this.width * n, this.height * n);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / n) * this.width + Math.floor(x / n)) * 4;
        const di = (y * out.width + x) * 4;
        out.data[di] = this.data[si];
        out.data[di + 1] = this.data[si + 1];
        out.data[di + 2] = this.data[si + 2];
        out.data[di + 3] = this.data[si + 3];
      }
    }
    return out;
  }
}

/**
 * A palette-indexed pixel sprite authored as text: one char per pixel,
 * `.` (or space) is transparent, every other char looks up `palette`.
 * Keeps art diff-able in PRs, the same way art.ts frames are.
 */
export interface Sprite {
  width: number;
  height: number;
  rows: readonly string[];
  palette: Readonly<Record<string, RGBA>>;
}

export function sprite(rows: readonly string[], palette: Record<string, RGBA>): Sprite {
  return { width: Math.max(...rows.map((r) => r.length)), height: rows.length, rows, palette };
}

/** Draw a sprite with its top-left at (x, y), nearest-neighbor, optional flip. */
export function blit(fb: Framebuffer, s: Sprite, x: number, y: number, opts: { flipX?: boolean; opacity?: number } = {}): void {
  const ox = Math.round(x);
  const oy = Math.round(y);
  for (let j = 0; j < s.height; j++) {
    const row = s.rows[j];
    for (let i = 0; i < s.width; i++) {
      const ch = row[opts.flipX ? s.width - 1 - i : i];
      if (!ch || ch === "." || ch === " ") continue;
      const c = s.palette[ch];
      if (c) fb.blend(ox + i, oy + j, c, opts.opacity ?? 1);
    }
  }
}
