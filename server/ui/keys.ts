/**
 * Key prompts: the console-style button legend.
 *
 * Every screen ends with the same thing: which keys do what. The kit draws
 * each as a pill chip (`⟨ Enter ⟩ Confirm`) and flows them into a legend
 * aligned to the bottom-right, like a console game. Key glyphs are generic
 * on purpose — no console-maker button symbols.
 */

import { displayWidth } from "../art";
import { RESET, THEME, bg, fg, type Ui } from "./color.ts";

/** [key, label] — e.g. ["⏎", "confirm"]. */
export type KeyItem = readonly [string, string];

/** One chip. Rich: a filled pill; classic: `⟨key⟩ label`. */
export function chip(ui: Pick<Ui, "mode"> | undefined, key: string, label: string): string {
  if (!ui) return label ? `⟨${key}⟩ ${label}` : `⟨${key}⟩`;
  const pill = `\x1b[1;${fg(ui, THEME.chipKey)};${bg(ui, THEME.chip)}m ${key} ${RESET}`;
  return label ? `${pill} \x1b[${fg(ui, THEME.dim)}m${label}${RESET}` : pill;
}

/** Flow chips into lines no wider than `cols`, right-aligned. */
export function legend(ui: Pick<Ui, "mode"> | undefined, items: readonly KeyItem[], cols: number, align: "left" | "right" = "right"): string[] {
  const sep = "  ";
  const cells = items.map(([k, l]) => chip(ui, k, l));
  const lines: string[] = [];
  let line = "";
  for (const c of cells) {
    if (line && displayWidth(line) + sep.length + displayWidth(c) > cols) {
      lines.push(line);
      line = c;
    } else line = line ? line + sep + c : c;
  }
  if (line) lines.push(line);
  return align === "right" ? lines.map((l) => " ".repeat(Math.max(0, cols - displayWidth(l))) + l) : lines;
}

/** Parse a "↑↓ navigate  ⏎/␣ select  q quit" hint (two-space separated;
 *  the first word of each part is the key). */
export function parseHint(text: string): KeyItem[] {
  return text
    .trim()
    .split(/\s{2,}/)
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(" ");
      return (i < 0 ? [part, ""] : [part.slice(0, i), part.slice(i + 1)]) as KeyItem;
    });
}
