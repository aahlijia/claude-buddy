/**
 * Menus: a cursor that bounces, a selected row with a highlight sweep, a
 * description pane, and a slot-in stagger when the menu opens.
 *
 * Two shapes: a vertical list in a panel (shop, bag, map) and a horizontal
 * bar (the fight's actions). Rich face only; classic screens keep their
 * printed `;buy <n>` style lists.
 */

import { displayWidth } from "../art";
import { RESET, THEME, bg, fg, lerpRgb, style, type RGB, type Ui } from "./color.ts";
import { panel } from "./panel.ts";

export interface MenuItem {
  /** The row as shown (may carry its own colors). */
  label: string;
  /** Command run on Enter (absent ⇒ not selectable, e.g. a section rule). */
  cmd?: string;
  desc?: string;
  /** Why it can't be used now. */
  blocked?: string;
  /** Extra keys for this row, e.g. { s: ";sell 3" }. */
  keys?: Readonly<Record<string, string>>;
}

export interface Menu {
  /** The command that shows this menu. */
  source?: string;
  /** Re-open the menu after an action (shop, bag) instead of leaving it. */
  stay?: boolean;
  /** What Enter does, for the key legend ("buy", "equip"…). */
  verb?: string;
  /** Extra key legend for the alt keys, e.g. [["s", "sell"]]. */
  hint?: readonly (readonly [string, string])[];
  title: string;
  right?: string;
  header?: readonly string[];
  items: readonly MenuItem[];
  footer?: string;
  accent?: RGB;
}

export interface MenuView {
  /** 0..1 animation phase: cursor bounce and sweep position. */
  phase?: number;
  /** Slot-in: only the first `reveal` items are shown (others blank). */
  reveal?: number;
}

/** Selectable item indices, in order. */
export function selectable(m: Menu): number[] {
  return m.items.flatMap((it, i) => (it.cmd ? [i] : []));
}

/** Move the cursor to the next selectable item (wraps). */
export function moveCursor(m: Menu, cursor: number, dir: 1 | -1): number {
  const sel = selectable(m);
  if (!sel.length) return cursor;
  const at = sel.indexOf(cursor);
  if (at < 0) return sel[0];
  return sel[(at + dir + sel.length) % sel.length];
}

/** Paint a background behind every visible character of `text` (escapes
 *  inside it keep working); `band` lights a 4-cell sweep at that column. */
export function highlight(ui: Pick<Ui, "mode">, text: string, base: RGB, band?: number): string {
  let out = "";
  let col = 0;
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      const m = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    i += ch.length;
    const d = band === undefined ? 99 : Math.abs(col - band);
    const c = d < 2 ? THEME.selectHi : d < 3 ? lerpRgb(base, THEME.selectHi, 0.5) : base;
    out += `\x1b[${bg(ui, c)}m${ch}`;
    col += displayWidth(ch);
  }
  return out + RESET;
}

/** The body rows of a vertical menu. Height is constant for a given menu. */
export function menuBody(ui: Pick<Ui, "mode">, m: Menu, cursor: number, v: MenuView = {}): string[] {
  const phase = v.phase ?? 0;
  const rows: string[] = [...(m.header ?? [])];
  const widest = Math.max(0, ...m.items.map((it) => displayWidth(it.label)));
  m.items.forEach((it, i) => {
    if (v.reveal !== undefined && i >= v.reveal) return rows.push("");
    if (i !== cursor || !it.cmd) {
      const text = it.cmd && it.blocked ? style(stripToDim(it.label), fg(ui, THEME.faint)) : it.label;
      return rows.push(`  ${text}`);
    }
    // Bounce: the arrow nudges right on the off-beat.
    const arrow = phase % 1 < 0.5 ? `${style("▸", `1;${fg(ui, THEME.gold)}`)} ` : ` ${style("▸", `1;${fg(ui, THEME.gold)}`)}`;
    const padded = it.label + " ".repeat(Math.max(0, widest - displayWidth(it.label)) + 1);
    const sweep = v.phase !== undefined ? (phase % 1) * (widest + 8) - 4 : undefined;
    rows.push(`${arrow}${highlight(ui, ` ${padded}`, THEME.select, sweep)}`);
  });
  // Description pane: always one row, so moving the cursor never shifts layout.
  const cur = m.items[cursor];
  const desc = cur ? [cur.desc, cur.blocked && `(${cur.blocked})`].filter(Boolean).join(" ") : "";
  rows.push("", desc ? `${style("┃", fg(ui, m.accent ?? THEME.accent))} ${style(desc, fg(ui, THEME.dim))}` : "");
  return rows;
}

function stripToDim(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** A vertical menu in a rich panel. */
export function menuScreen(ui: Ui, m: Menu, cursor: number, v: MenuView = {}): string {
  return panel(true, ui, { title: m.title, right: m.right, body: menuBody(ui, m, cursor, v), footer: m.footer, accent: m.accent });
}

/** The slot-in stagger: rows appear one per frame, then the cursor lands. */
export function menuOpenFrames(ui: Ui, m: Menu, cursor: number): { text: string; ms: number }[] {
  const frames: { text: string; ms: number }[] = [];
  for (let k = 0; k < m.items.length; k++) frames.push({ text: menuScreen(ui, m, cursor, { reveal: k + 1 }), ms: 22 });
  return frames;
}

// ─── Horizontal bar (fight actions) ─────────────────────────────────────────

export interface BarItem {
  label: string;
  blocked?: string;
  hotkey: string;
  desc: string;
}

/** The fight action bar: chips flowing over lines, the focused one
 *  highlighted (with a sweep), a description line under it. */
export function menuBar(ui: Pick<Ui, "mode">, items: readonly BarItem[], cursor: number, cols: number, phase?: number): string[] {
  const at = Math.max(0, Math.min(cursor, items.length - 1));
  const cells = items.map((a, i) => {
    const cd = a.blocked && a.blocked.startsWith("cooldown") ? `(${a.blocked.slice(9)})` : "";
    const text = ` ${a.label}${cd} `;
    if (i === at) return highlight(ui, text, THEME.selectHi, phase === undefined ? undefined : (phase % 1) * (displayWidth(text) + 6) - 3);
    return a.blocked ? style(text, fg(ui, THEME.faint)) : style(text, `${fg(ui, THEME.text)};${bg(ui, THEME.chip)}`);
  });
  const lines: string[] = [];
  let line = "";
  for (const c of cells) {
    if (line && displayWidth(line) + 1 + displayWidth(c) > cols) {
      lines.push(line);
      line = c;
    } else line = line ? `${line} ${c}` : c;
  }
  if (line) lines.push(line);
  const a = items[at];
  if (a) {
    const desc = a.blocked ? `${a.desc} — ${a.blocked}` : a.desc;
    lines.push(`${style("┃", fg(ui, THEME.accent))} ${style(desc, fg(ui, THEME.text))} ${style(`[${a.hotkey}]`, fg(ui, THEME.dim))}`);
  }
  return lines;
}
