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

// ─── Lower-level commands (H4 diorama: layers, frame swaps, native loops) ────

/** One graphics command with an optional base64 payload, chunked. */
export function kittyCommand(keys: readonly string[], payload = ""): string {
  let out = "";
  for (let i = 0; i < payload.length || i === 0; i += KITTY_CHUNK) {
    const part = payload.slice(i, i + KITTY_CHUNK);
    const more = i + KITTY_CHUNK < payload.length ? 1 : 0;
    const head = i === 0 ? `${keys.join(",")}${payload ? `,m=${more}` : ""}` : `m=${more}`;
    out += `\x1b_G${head}${payload ? ";" + part : ""}\x1b\\`;
  }
  return out;
}

function pixels(fb: Framebuffer): string {
  const raw = Buffer.from(fb.data.buffer, fb.data.byteOffset, fb.data.byteLength);
  return deflateSync(raw).toString("base64");
}

/** Upload an image without showing it (`a=t`), to be placed later. */
export function kittyUpload(fb: Framebuffer, id: number): string {
  return kittyCommand(["a=t", "f=32", `s=${fb.width}`, `v=${fb.height}`, `i=${id}`, "o=z", "q=2"], pixels(fb));
}

/** Add an animation frame to image `id`, shown for `gapMs` (`a=f`). */
export function kittyFrame(fb: Framebuffer, id: number, gapMs: number): string {
  return kittyCommand(["a=f", "f=32", `s=${fb.width}`, `v=${fb.height}`, `i=${id}`, "o=z", `z=${Math.max(1, Math.round(gapMs))}`, "q=2"], pixels(fb));
}

/** Loop image `id`'s frames forever, the root frame shown for `gapMs`. */
export function kittyLoop(id: number, gapMs: number): string {
  return kittyCommand(["a=a", `i=${id}`, "r=1", `z=${Math.max(1, Math.round(gapMs))}`, "q=2"]) + kittyCommand(["a=a", `i=${id}`, "s=3", "v=1", "q=2"]);
}

export interface KittyPlace {
  placement?: number;
  /** Cell box the image is scaled into. */
  cols: number;
  rows: number;
  z: number;
  /** Source rectangle (pixels) — pans a wide layer without re-sending it. */
  src?: { x: number; y: number; w: number; h: number };
}

/** Show (or move) an uploaded image at the cursor, which stays put. */
export function kittyPlace(id: number, o: KittyPlace): string {
  const keys = ["a=p", `i=${id}`, `p=${o.placement ?? 1}`, `c=${o.cols}`, `r=${o.rows}`, `z=${o.z}`, "C=1", "q=2"];
  if (o.src) keys.push(`x=${o.src.x}`, `y=${o.src.y}`, `w=${o.src.w}`, `h=${o.src.h}`);
  return kittyCommand(keys);
}

/** Hide one placement but keep the image data for reuse. */
export function kittyUnplace(id: number, placement = 1): string {
  return kittyCommand(["a=d", "d=i", `i=${id}`, `p=${placement}`, "q=2"]);
}
