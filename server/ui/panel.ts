/**
 * Panels: the box every quest screen sits in.
 *
 * Classic face (no `Ui`): rules top and bottom, a left border, open on the
 * right (emoji widths differ between terminals and a misaligned right border
 * looks worse than none) — byte-identical to the pre-kit `panel()`.
 *
 * Rich face: the same characters, so the layout never changes, painted with
 * an accent edge, a gradient title bar and a shadowed bottom rule.
 */

import { displayWidth } from "../art";
import { RESET, THEME, bg, fg, gradient, lerpRgb, shade, style, type RGB, type Ui } from "./color.ts";

export const PANEL_W = 58;

export interface PanelOpts {
  title: string;
  right?: string;
  body: readonly string[];
  footer?: string;
  minW?: number;
  /** Rich face: the edge and title color (rarity, boss red…). */
  accent?: RGB;
}

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

/** Panel width for a body (both faces agree). */
export function panelWidth(o: Pick<PanelOpts, "body" | "minW">): number {
  return Math.max(o.minW ?? PANEL_W, ...o.body.map((l) => displayWidth(l) + 2));
}

export function panel(color: boolean, ui: Ui | undefined, o: PanelOpts): string {
  return ui && color ? richPanel(ui, o) : classicPanel(color, o);
}

function classicPanel(color: boolean, o: PanelOpts): string {
  const p = (code: string, t: string) => (color ? `${code}${t}${RESET}` : t);
  const w = panelWidth(o);
  const t = ` ${o.title} `;
  const rt = o.right ? ` ${o.right} ` : "";
  const fill = Math.max(2, w - displayWidth(t) - displayWidth(rt) - 2);
  const edge = (x: string) => p(DIM, x);
  const out = [edge("╭─") + p(BOLD, t) + edge("─".repeat(fill)) + rt + edge("─╮")];
  for (const l of o.body) out.push(`${edge("│")} ${l}`);
  const foot = o.footer ? ` ${o.footer} ` : "";
  out.push(edge("╰─") + foot + edge("─".repeat(Math.max(2, w - displayWidth(foot) - 1))) + edge("╯"));
  return out.join("\n");
}

function richPanel(ui: Ui, o: PanelOpts): string {
  const accent = o.accent ?? THEME.accent;
  const w = panelWidth(o);
  const t = ` ${o.title} `;
  const rt = o.right ? ` ${o.right} ` : "";
  const fill = Math.max(2, w - displayWidth(t) - displayWidth(rt) - 2);
  // Title bar: bold text on a band that fades from the accent into the panel.
  const band = [...t];
  const dark = shade(accent, 0.38);
  let title = "";
  band.forEach((ch, i) => {
    const c = lerpRgb(dark, THEME.shadow, i / Math.max(1, band.length - 1));
    title += `\x1b[1;${fg(ui, THEME.chipKey)};${bg(ui, c)}m${ch}`;
  });
  title += RESET;
  const top = style("╭─", fg(ui, accent)) + title + gradient(ui, "─".repeat(fill), accent, THEME.faint) + rt + style("─╮", fg(ui, THEME.faint));
  const out = [top];
  const edge = style("│", fg(ui, accent));
  for (const l of o.body) out.push(`${edge} ${l}`);
  const foot = o.footer ? ` ${o.footer} ` : "";
  out.push(
    style("╰─", fg(ui, shade(accent, 0.6))) + foot + gradient(ui, "─".repeat(Math.max(2, w - displayWidth(foot) - 1)), THEME.edge, THEME.shadow) + style("╯", fg(ui, THEME.shadow)),
  );
  return out.join("\n");
}

export { DIM as DIM_SGR, BOLD as BOLD_SGR };
