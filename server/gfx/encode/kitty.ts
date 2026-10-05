/**
 * Kitty graphics protocol encoder (tier T3): real pixels in kitty, Ghostty
 * and other terminals that implement it. Pixels go over as zlib-compressed
 * RGBA in ≤4096-byte base64 chunks.
 *
 * Re-sending with the same image id + placement id replaces the picture in
 * place, so an animation is just "transmit the next frame at the same spot".
 */

import { deflateSync } from "node:zlib";
import type { Framebuffer } from "../framebuffer.ts";

export interface KittyOptions {
  /** Image id (1–4294967295). Reusing it replaces the previous frame. */
  id?: number;
  /** Placement id, kept stable so the frame swaps in place. */
  placement?: number;
  /** Display size in terminal cells; the terminal scales the pixels to fit. */
  cols?: number;
  rows?: number;
  /** Stacking order relative to text (negative = under text). */
  z?: number;
  compress?: boolean;
}

export const KITTY_CHUNK = 4096;

/** One `a=T` (transmit + display) command, chunked. Does not move the cursor. */
export function encodeKitty(fb: Framebuffer, opts: KittyOptions = {}): string {
  const compress = opts.compress ?? true;
  const raw = Buffer.from(fb.data.buffer, fb.data.byteOffset, fb.data.byteLength);
  const payload = (compress ? deflateSync(raw) : raw).toString("base64");
  const keys = [
    "a=T",
    "f=32",
    `s=${fb.width}`,
    `v=${fb.height}`,
    `i=${opts.id ?? 1}`,
    `p=${opts.placement ?? 1}`,
    "q=2", // suppress terminal replies
    "C=1", // keep the cursor where it is
  ];
  if (compress) keys.push("o=z");
  if (opts.cols) keys.push(`c=${opts.cols}`);
  if (opts.rows) keys.push(`r=${opts.rows}`);
  if (opts.z !== undefined) keys.push(`z=${opts.z}`);

  let out = "";
  for (let i = 0; i < payload.length || i === 0; i += KITTY_CHUNK) {
    const part = payload.slice(i, i + KITTY_CHUNK);
    const more = i + KITTY_CHUNK < payload.length ? 1 : 0;
    const head = i === 0 ? `${keys.join(",")},m=${more}` : `m=${more}`;
    out += `\x1b_G${head};${part}\x1b\\`;
  }
  return out;
}

/** Delete an image (and its placements) by id, freeing terminal memory. */
export function kittyDelete(id: number): string {
  return `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
}

/** Query whether the terminal speaks the protocol; it answers `…;OK` if so. */
export const KITTY_QUERY = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
