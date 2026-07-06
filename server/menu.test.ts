import { describe, expect, test } from "bun:test";

import {
  MENU,
  getMenuPage,
  askFor,
  navMarker,
  resolveSelect,
  renderMenuCard,
  advance,
  type MenuPage,
  type MenuEnvelope,
  type NavAsk,
  type RouteResult,
} from "./menu";
import { MENU_TOOLS, menuToolLeaves, runTool } from "./registry";


const PAGES: MenuPage[] = Object.values(MENU);

describe("MENU tree invariants", () => {
  test("page key matches its own id", () => {
    for (const [key, page] of Object.entries(MENU)) {
      expect(page.id).toBe(key);
    }
  });

  test("every page has 2..4 options (AskUserQuestion bounds)", () => {
    for (const page of PAGES) {
      expect(page.options.length).toBeGreaterThanOrEqual(2);
      expect(page.options.length).toBeLessThanOrEqual(4);
    }
  });

  test("no dangling page targets", () => {
    for (const page of PAGES) {
      for (const opt of page.options) {
        if (opt.action.kind === "page") {
          expect(MENU[opt.action.page]).toBeDefined();
        }
      }
    }
  });

  test("tool/prompt actions name a buddy_* tool (naming convention)", () => {
    // Self-maintaining: no hand-list to update. All MCP tools are registered
    // as buddy_*, so any deviation (typo, wrong namespace) fails here.
    // MENU_TOOLS from registry.ts is the runtime source of truth; use it for
    // cross-checking once index.ts is importable in tests.
    for (const page of PAGES) {
      for (const opt of page.options) {
        if (
          opt.action.kind === "tool" ||
          opt.action.kind === "prompt" ||
          opt.action.kind === "choice"
        ) {
          expect(opt.action.tool).toMatch(/^buddy_/);
        }
      }
    }
  });

  test("no option references the retired wide/bubble wander modes", () => {
    // Free-roam (2026-06-30) removed the wanderWide/wanderBubble flags; no menu
    // label or description may advertise them again.
    for (const page of PAGES) {
      for (const opt of page.options) {
        expect(`${opt.label} ${opt.description}`.toLowerCase()).not.toMatch(
          /wide roam|bubble-follow|wander modes/,
        );
      }
    }
  });

  test("option ids are unique within each page", () => {
    for (const page of PAGES) {
      const ids = page.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("option labels are unique within each page (select is label-addressable)", () => {
    for (const page of PAGES) {
      const labels = page.options.map((o) => o.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  test("every page is reachable from root (no orphans)", () => {
    const seen = new Set<string>(["root"]);
    const queue = ["root"];
    while (queue.length > 0) {
      const page = MENU[queue.shift()!];
      for (const opt of page.options) {
        if (opt.action.kind === "page" && !seen.has(opt.action.page)) {
          seen.add(opt.action.page);
          queue.push(opt.action.page);
        }
      }
    }
    expect(seen.size).toBe(PAGES.length);
  });
});

describe("getMenuPage", () => {
  test("returns the requested page", () => {
    expect(getMenuPage("gear")).toBe(MENU.gear);
  });

  test("unknown id falls back to root", () => {
    expect(getMenuPage("nope")).toBe(MENU.root);
  });

  test("empty/undefined falls back to root", () => {
    expect(getMenuPage()).toBe(MENU.root);
    expect(getMenuPage("")).toBe(MENU.root);
  });
});

describe("askFor", () => {
  test("emits a NavAsk with no action/id leakage in options", () => {
    for (const page of PAGES) {
      const ask = askFor(page);
      expect(ask.question).toBe(page.title);
      expect(ask.multiSelect).toBe(false);
      expect(ask.header.length).toBeGreaterThan(0);
      expect(ask.header.length).toBeLessThanOrEqual(12);
      // Options carry only label + description — no value, id, or action leakage.
      expect(ask.options).toEqual(
        page.options.map((o) => ({ label: o.label, description: o.description })),
      );
      for (const o of ask.options) {
        expect(Object.keys(o).sort()).toEqual(["description", "label"]);
      }
    }
  });

  test("then routes back to buddy_menu with the page id", () => {
    for (const page of PAGES) {
      const ask = askFor(page);
      expect(ask.then.tool).toBe("buddy_menu");
      expect(ask.then.pick_arg).toBe("select");
      expect(ask.then.args?.page).toBe(page.id);
    }
  });

  test("prefers explicit header, falls back to a derived chip", () => {
    expect(askFor(MENU.root).header).toBe("Menu"); // explicit
    const noHeader: MenuPage = {
      id: "tmp",
      title: "Stats & progress",
      options: MENU.progress.options,
    };
    expect(askFor(noHeader).header).toBe("Stats & prog"); // derived ≤12
  });
});

describe("navMarker", () => {
  test("round-trips an ask envelope — no top-level page, continuation in ask.then", () => {
    const ask = askFor(MENU.root);
    const marker = navMarker({ display: "x", ask });
    const match = marker.match(/^<!-- buddy:nav (.*) -->$/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    expect(payload).toEqual({ ask });
    expect("do" in payload).toBe(false);
    expect("page" in payload).toBe(false);
    // Page lives in ask.then.args, not at the top level.
    expect((payload.ask as NavAsk).then.args?.page).toBe("root");
  });

  test("round-trips a do envelope and omits ask and page", () => {
    const marker = navMarker({
      display: "x",
      do: { kind: "shell", command: "bun run pick" },
    });
    const payload = JSON.parse(marker.match(/^<!-- buddy:nav (.*) -->$/)![1]);
    expect(payload).toEqual({ do: { kind: "shell", command: "bun run pick" } });
    expect("ask" in payload).toBe(false);
    expect("page" in payload).toBe(false);
  });
});

describe("resolveSelect", () => {
  test("matches by id and by label identically, mapping each action.kind", () => {
    for (const page of PAGES) {
      for (const opt of page.options) {
        const byId = resolveSelect(page, opt.id);
        const byLabel = resolveSelect(page, opt.label);
        expect(byId).toEqual(byLabel);
        switch (opt.action.kind) {
          case "page":
            expect(byId.kind).toBe("page");
            break;
          case "tool":
            expect(byId.kind).toBe("tool");
            break;
          case "choice":
            expect(byId.kind).toBe("ask");
            break;
          default: // prompt | shell | sequence
            expect(byId.kind).toBe("directive");
        }
      }
    }
  });

  test("unknown select is a miss (caller re-renders the page)", () => {
    expect(resolveSelect(MENU.root, "nope").kind).toBe("miss");
  });

  test("a page action carries the resolved target page", () => {
    const r = resolveSelect(MENU.root, "gear");
    expect(r).toEqual({ kind: "page", page: MENU.gear });
  });
});

describe("renderMenuCard", () => {
  test("lists every option label and is byte-stable", () => {
    const card = renderMenuCard(MENU.root, "Waffle");
    for (const opt of MENU.root.options) {
      expect(card).toContain(opt.label);
    }
    expect(card).toMatchSnapshot();
  });
});

describe("MENU security invariants", () => {
  /**
   * Tools that must never run in-process via runTool because they are
   * irreversible and have no confirm prompt when auto-executed. If a tool here
   * needs to be reachable from the menu, wire it as kind:"sequence" so the
   * assistant orchestrates the multi-step flow instead.
   */
  const DENYLIST = new Set(["buddy_uninstall"]);

  test("no kind:\"tool\" leaf targets a denylist tool (runTool guard)", () => {
    for (const page of Object.values(MENU)) {
      for (const opt of page.options) {
        if (opt.action.kind === "tool") {
          expect(DENYLIST.has(opt.action.tool)).toBe(false);
        }
      }
    }
  });

  test("buddy_uninstall is kind:\"sequence\" (stays assistant-orchestrated)", () => {
    const action = MENU.system2.options.find((o) => o.id === "uninstall")?.action;
    expect(action?.kind).toBe("sequence");
  });

  test("all kind:\"tool\" leaves carry no args (runTool skips Zod validation)", () => {
    // runTool delivers args directly to the handler, bypassing schema parse and
    // .default()/.transform() coercion. Keeping tool-leaves arg-free means
    // there is nothing to validate or coerce, closing the gap. If a future
    // action needs args, parse them inside runTool first.
    for (const page of Object.values(MENU)) {
      for (const opt of page.options) {
        if (opt.action.kind === "tool") {
          expect(opt.action.args).toBeUndefined();
        }
      }
    }
  });

  test("runTool allowlist = the tree's kind:\"tool\" leaves, excludes the denylist", () => {
    const allowed = menuToolLeaves();
    // Every kind:"tool" leaf is allowed; nothing else is.
    for (const page of Object.values(MENU)) {
      for (const opt of page.options) {
        if (opt.action.kind === "tool") {
          expect(allowed.has(opt.action.tool)).toBe(true);
        }
      }
    }
    // The irreversible tool is reachable only as kind:"sequence", so it must NOT
    // be in the in-process allowlist even though registerTool captures it.
    expect(allowed.has("buddy_uninstall")).toBe(false);
    // choice/prompt setters route via the validated assistant path, not runTool.
    expect(allowed.has("buddy_theme")).toBe(false);
  });

  test("runTool refuses an off-allowlist tool (graceful miss)", async () => {
    const res = await runTool("buddy_uninstall");
    expect(res.content[0].text).toMatch(/unknown tool/i);
  });
});

describe("advance", () => {
  test("no select, no page → renders root (ask.then.args.page=root)", () => {
    const r = advance(undefined, undefined, "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.ask?.then.args?.page).toBe("root");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
    expect(r.display).toContain("Waffle");
  });

  test("no select with page → renders that page (ask.then.args.page)", () => {
    const r = advance("gear", undefined, "Waffle") as MenuEnvelope;
    expect(r.ask?.then.args?.page).toBe("gear");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
  });

  test("tool-leaf selection → RouteResult, not an envelope", () => {
    const r = advance("gear", "🛒 Visit the shop", "Waffle") as RouteResult;
    expect("route" in r).toBe(true);
    expect(r.route.tool).toBe("buddy_shop");
  });

  test("tool-leaf selection by id → same RouteResult as by label", () => {
    const byId = advance("gear", "shop", "W") as RouteResult;
    const byLabel = advance("gear", "🛒 Visit the shop", "W") as RouteResult;
    expect(byId).toEqual(byLabel);
  });

  test("page drill-down → renders next page (ask.then.args.page)", () => {
    const r = advance("root", "🛒 Shop & Gear", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.ask?.then.args?.page).toBe("gear");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
  });

  test("prompt directive → envelope with do (no ask)", () => {
    const r = advance("statusbits", "⏱️ Frequency", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.do?.kind).toBe("prompt");
    expect((r.do as { tool: string }).tool).toBe("buddy_frequency");
    expect(r.ask).toBeUndefined();
  });

  test("shell directive → envelope with do kind shell", () => {
    const r = advance("system2", "🕹️ Pick (terminal TUI)", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.do?.kind).toBe("shell");
    expect(r.ask).toBeUndefined();
  });

  test("sequence directive → envelope with do kind sequence", () => {
    const r = advance("system2", "🧨 Uninstall", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.do?.kind).toBe("sequence");
    expect(r.ask).toBeUndefined();
  });

  test("miss (unknown select) → re-renders same page (ask.then.args.page)", () => {
    const r = advance("gear", "not-a-real-option", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.ask?.then.args?.page).toBe("gear");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
  });
});

describe("choice setters (kind:\"choice\")", () => {
  test("resolveSelect → ask whose then targets the setter tool/arg", () => {
    const r = resolveSelect(MENU.appearance, "theme");
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.ask.then.tool).toBe("buddy_theme");
    expect(r.ask.then.pick_arg).toBe("theme");
    expect(r.ask.then.args).toEqual({});
    expect(r.ask.options.map((o) => o.value)).toEqual(["dark", "light", "auto"]);
  });

  test("advance → envelope with the setter ask (no route, no do)", () => {
    const r = advance("appearance", "theme", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
    // ask continues to the target tool, NOT back to buddy_menu
    expect(r.ask?.then.tool).toBe("buddy_theme");
    expect(r.ask?.then.args?.page).toBeUndefined();
  });

  test("boolean-arg setters carry real boolean values (no string coercion)", () => {
    // The chosen value rides the validated tool-call path, so z.boolean() schemas
    // accept it directly — the value must be a JS boolean, not "on"/"off".
    const r = resolveSelect(MENU.statusbits, "statusline");
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.ask.then.pick_arg).toBe("enabled");
    const values = r.ask.options.map((o) => o.value);
    expect(values).toEqual([true, false]);
    for (const v of values) expect(typeof v).toBe("boolean");
  });

  test("every choice setter has 2..4 options each with a value", () => {
    for (const page of PAGES) {
      for (const opt of page.options) {
        if (opt.action.kind !== "choice") continue;
        expect(opt.action.options.length).toBeGreaterThanOrEqual(2);
        expect(opt.action.options.length).toBeLessThanOrEqual(4);
        for (const o of opt.action.options) {
          expect(o.value === undefined).toBe(false);
        }
      }
    }
  });

  test("navMarker round-trips a boolean choice value", () => {
    const r = advance("statusbits", "panel", "Waffle") as MenuEnvelope;
    const marker = navMarker(r);
    const json = JSON.parse(
      marker.replace(/^<!-- buddy:nav /, "").replace(/ -->$/, ""),
    );
    expect(json.ask.options.some((o: { value: unknown }) => o.value === true)).toBe(true);
    expect(json.ask.options.some((o: { value: unknown }) => o.value === false)).toBe(true);
  });
});
