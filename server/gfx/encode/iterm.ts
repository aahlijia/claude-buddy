/**
 * iTerm2 inline image encoder (tier T3): iTerm2, WezTerm, and others that
 * implement OSC 1337. Sends a PNG; the terminal scales it to the cell box.
 */

import type { Framebuffer } from "../framebuffer.ts";
import { encodePng } from "./png.ts";

export function encodeIterm(fb: Framebuffer, opts: { cols?: number; rows?: number } = {}): string {
  const png = encodePng(fb);
  const args = ["inline=1", `size=${png.length}`, "preserveAspectRatio=1", "doNotMoveCursor=1"];
  if (opts.cols) args.push(`width=${opts.cols}`);
  if (opts.rows) args.push(`height=${opts.rows}`);
  return `\x1b]1337;File=${args.join(";")}:${Buffer.from(png).toString("base64")}\x07`;
}
