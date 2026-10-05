/**
 * Meters: HP, XP, progress and stat bars at 1/8-cell precision.
 *
 * Rich face only — the classic `█░` bars stay in render.ts for the hook.
 * HP fills shift green → yellow → red as HP drops and pulse when low; a
 * ghost segment shows HP just lost (white for an instant, then dark red as
 * it drains). Every meter is exactly `width` cells.
 */

import { RESET, THEME, bg, fg, lerpRgb, shade, type RGB, type Ui } from "./color.ts";

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export type MeterKind = "hp" | "xp" | "progress" | "stat";

export interface MeterOpts {
  kind?: MeterKind;
  /** HP before the latest loss (drawn as the ghost segment). */
  ghost?: number;
  /** The ghost was just created: draw it white. */
  fresh?: boolean;
  /** 0..1 phase of the low-HP pulse (omit for a still bar). */
  pulse?: number;
}

/** HP color: green at full, yellow at half, red near empty. */
export function hpColor(ratio: number): RGB {
  return ratio > 0.5 ? lerpRgb(THEME.hpMid, THEME.hpHigh, (ratio - 0.5) * 2) : lerpRgb(THEME.hpLow, THEME.hpMid, Math.max(0, ratio) * 2);
}

function fillColor(kind: MeterKind, ratio: number, at: number): RGB {
  switch (kind) {
    case "hp":
      return hpColor(ratio);
    case "xp":
      return lerpRgb(THEME.xpFrom, THEME.xpTo, at);
    case "stat":
      return lerpRgb(THEME.accent, THEME.gold, at);
    default:
      return THEME.hpHigh;
  }
}

export function meter(ui: Pick<Ui, "mode">, cur: number, max: number, width: number, o: MeterOpts = {}): string {
  const kind = o.kind ?? "hp";
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const eighths = (v: number) => (max > 0 ? Math.round((Math.max(0, Math.min(v, max)) / max) * width * 8) : 0);
  const f8 = eighths(cur);
  const g8 = Math.max(f8, eighths(o.ghost ?? cur));
  // Low HP throbs between full and 60% brightness.
  const throb = kind === "hp" && ratio <= 0.25 && o.pulse !== undefined ? 0.8 + 0.2 * Math.cos(o.pulse * Math.PI * 2) : 1;
  const ghostC = o.fresh ? THEME.ghostFresh : THEME.ghost;
  const track = THEME.track;
  let out = "";
  for (let c = 0; c < width; c++) {
    const f = Math.max(0, Math.min(8, f8 - 8 * c));
    const g = Math.max(0, Math.min(8, g8 - 8 * c));
    // Darker at the tail, brighter toward the leading edge.
    const lead = f8 > 0 ? (8 * c + 4) / f8 : 0;
    const fc = shade(fillColor(kind, ratio, Math.min(1, lead)), (0.72 + 0.28 * Math.min(1, lead)) * throb);
    if (f === 8) out += `\x1b[${fg(ui, fc)};${bg(ui, track)}m█`;
    else if (f > 0) out += `\x1b[${fg(ui, fc)};${bg(ui, g > f ? ghostC : track)}m${EIGHTHS[f]}`;
    else if (g === 8) out += `\x1b[${fg(ui, ghostC)};${bg(ui, track)}m█`;
    else if (g > 0) out += `\x1b[${fg(ui, ghostC)};${bg(ui, track)}m${EIGHTHS[g]}`;
    else out += `\x1b[${bg(ui, track)}m `;
  }
  return out + RESET;
}
