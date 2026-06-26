/**
 * In-process tool dispatch for buddy_menu (Phase B). buddy_menu resolves a
 * tool-leaf by running the target handler directly — no second assistant turn.
 * The captured handler is the same reference passed to server.tool, so output
 * is byte-identical. See docs/game-feel/menu/design-mechanize.md §6.
 */

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

// Menu-reachable handlers must not read `extra` — runTool invokes them with
// one argument, so any request-context dependency breaks on the in-process path.
export type CapturedHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export const MENU_TOOLS: Record<string, CapturedHandler> = {};

/** Invoke a registered tool in-process. Unknown names degrade gracefully. */
export async function runTool(
  tool: string,
  args?: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = MENU_TOOLS[tool];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${tool}` }] };
  }
  return handler(args ?? {});
}
