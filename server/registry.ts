/**
 * In-process tool dispatch for buddy_menu (Phase B). buddy_menu resolves a
 * tool-leaf by running the target handler directly — no second assistant turn.
 * The captured handler is the same reference passed to server.tool, so output
 * is byte-identical. See docs/game-feel/menu/design-mechanize.md §6.
 */

import { MENU } from "./menu";

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

// Menu-reachable handlers must not read `extra` — runTool invokes them with
// one argument, so any request-context dependency breaks on the in-process path.
export type CapturedHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export const MENU_TOOLS: Record<string, CapturedHandler> = {};

/**
 * The only tools `runTool` may dispatch in-process: the `kind:"tool"` leaves of
 * the MENU tree. `registerTool` captures *every* tool into `MENU_TOOLS`, so this
 * allowlist — derived from the tree, the single source of truth — keeps the
 * unvalidated in-process path from ever reaching an off-menu handler (e.g. a
 * denylisted or `extra`-reading tool). Defense-in-depth: today `runTool` is only
 * ever called with tree leaves, but this makes that structural rather than
 * incidental.
 */
export function menuToolLeaves(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const page of Object.values(MENU)) {
    for (const opt of page.options) {
      if (opt.action.kind === "tool") names.add(opt.action.tool);
    }
  }
  return names;
}

/** Invoke a menu tool-leaf in-process. Off-allowlist / unknown names degrade gracefully. */
export async function runTool(
  tool: string,
  args?: Record<string, unknown>,
): Promise<ToolResult> {
  if (!menuToolLeaves().has(tool)) {
    return { content: [{ type: "text", text: `Unknown tool: ${tool}` }] };
  }
  const handler = MENU_TOOLS[tool];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${tool}` }] };
  }
  return handler(args ?? {});
}
