/**
 * Render-tier detection: picks the best way this terminal can show pixels.
 * Pure — takes the environment as input — so every branch is testable.
 * See docs/game-feel/hd-overhaul/brainstorm.md §0.
 */

import type { ColorMode } from "./encode/halfblock.ts";

export const TIERS = ["kitty", "iterm", "halfblock", "ascii"] as const;
export type Tier = (typeof TIERS)[number];

export interface Detected {
  tier: Tier;
  color: ColorMode;
  /** Running inside tmux: graphics escapes need passthrough wrapping. */
  tmux: boolean;
  /** Human-readable reason, shown by the demo and (later) `doctor`. */
  reason: string;
}

type Env = Record<string, string | undefined>;

export function isTier(s: string | undefined): s is Tier {
  return !!s && (TIERS as readonly string[]).includes(s);
}

export function detectTier(env: Env, override?: string): Detected {
  const tmux = !!env.TMUX;
  const term = env.TERM ?? "";
  const prog = env.TERM_PROGRAM ?? "";
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? "") || /kitty|ghostty|direct/.test(term);
  const color: ColorMode = truecolor || prog === "iTerm.app" || prog === "WezTerm" ? "truecolor" : "256";

  const forced = override ?? env.BUDDY_GFX;
  if (forced && forced !== "auto") {
    if (isTier(forced)) return { tier: forced, color, tmux, reason: `forced (${forced})` };
  }
  if (env.NO_COLOR !== undefined || term === "dumb") {
    return { tier: "ascii", color, tmux, reason: env.NO_COLOR !== undefined ? "NO_COLOR is set" : "TERM=dumb" };
  }
  // Graphics through tmux need `allow-passthrough on`, which we can't see
  // from here, so half-blocks are the safe default there.
  if (tmux) return { tier: "halfblock", color, tmux, reason: "inside tmux (force a pixel tier with BUDDY_GFX=kitty)" };
  if (term === "xterm-kitty" || env.KITTY_WINDOW_ID) return { tier: "kitty", color, tmux, reason: "kitty" };
  if (prog === "ghostty" || term === "xterm-ghostty") return { tier: "kitty", color, tmux, reason: "Ghostty" };
  if (prog === "iTerm.app") return { tier: "iterm", color, tmux, reason: "iTerm2" };
  if (prog === "WezTerm") return { tier: "iterm", color, tmux, reason: "WezTerm" };
  return {
    tier: "halfblock",
    color,
    tmux,
    reason: color === "truecolor" ? "truecolor terminal" : "no truecolor advertised (256-color half-blocks)",
  };
}

/** Wrap an escape sequence for tmux passthrough (needs `allow-passthrough on`). */
export function tmuxWrap(seq: string): string {
  return `\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}
