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
  type RouteResult,
} from "./menu";

/**
 * Every buddy_* tool a menu action may target. Mirrored from the tool
 * registrations in index.ts; keep in sync when the tree grows. A `kind:"tool"`
 * or `kind:"prompt"` action naming anything outside this set fails test 3.
 */
const KNOWN_TOOLS = new Set<string>([
  "buddy_shop",
  "buddy_equip",
  "buddy_upgrades",
  "buddy_stats",
  "buddy_xp",
  "buddy_achievements",
  "buddy_mood",
  "buddy_brag",
  "buddy_memory",
  "buddy_theme",
  "buddy_style",
  "buddy_gamefeel",
  "buddy_wander",
  "buddy_statusline",
  "buddy_stats_panel",
  "buddy_prestige_badge",
  "buddy_frequency",
  "buddy_rename",
  "buddy_set_personality",
  "buddy_save",
  "buddy_list",
  "buddy_summon",
  "buddy_dismiss",
  "buddy_mute",
  "buddy_unmute",
  "buddy_help",
]);

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

  test("tool/prompt actions name a known buddy tool", () => {
    for (const page of PAGES) {
      for (const opt of page.options) {
        if (opt.action.kind === "tool" || opt.action.kind === "prompt") {
          expect(KNOWN_TOOLS.has(opt.action.tool)).toBe(true);
        }
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
  test("emits an AskUserQuestion-ready shape with no action/id leakage", () => {
    for (const page of PAGES) {
      const ask = askFor(page);
      expect(ask.question).toBe(page.title);
      expect(ask.multiSelect).toBe(false);
      expect(ask.header.length).toBeGreaterThan(0);
      expect(ask.header.length).toBeLessThanOrEqual(12);
      expect(ask.options).toEqual(
        page.options.map((o) => ({
          label: o.label,
          description: o.description,
        })),
      );
      // No internal fields leak into the harness payload.
      for (const o of ask.options) {
        expect(Object.keys(o).sort()).toEqual(["description", "label"]);
      }
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
  test("round-trips an ask envelope and omits do", () => {
    const marker = navMarker({
      display: "x",
      ask: askFor(MENU.root),
      page: "root",
    });
    const match = marker.match(/^<!-- buddy:nav (.*) -->$/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    expect(payload).toEqual({ page: "root", ask: askFor(MENU.root) });
    expect("do" in payload).toBe(false);
  });

  test("round-trips a do envelope and omits ask", () => {
    const marker = navMarker({
      display: "x",
      do: { kind: "shell", command: "bun run pick" },
      page: "system2",
    });
    const payload = JSON.parse(marker.match(/^<!-- buddy:nav (.*) -->$/)![1]);
    expect(payload).toEqual({
      page: "system2",
      do: { kind: "shell", command: "bun run pick" },
    });
    expect("ask" in payload).toBe(false);
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

describe("advance", () => {
  test("no select, no page → renders root with ask", () => {
    const r = advance(undefined, undefined, "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.page).toBe("root");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
    expect(r.display).toContain("Waffle");
  });

  test("no select with page → renders that page with ask", () => {
    const r = advance("gear", undefined, "Waffle") as MenuEnvelope;
    expect(r.page).toBe("gear");
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

  test("page drill-down → renders next page with ask", () => {
    const r = advance("root", "🛒 Shop & Gear", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.page).toBe("gear");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
  });

  test("prompt directive → envelope with do (no ask)", () => {
    const r = advance("statusbits", "⏱️ Frequency", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.do?.kind).toBe("prompt");
    expect((r.do as { tool: string }).tool).toBe("buddy_frequency");
    expect(r.ask).toBeUndefined();
    expect(r.page).toBe("statusbits");
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

  test("miss (unknown select) → re-renders same page with ask", () => {
    const r = advance("gear", "not-a-real-option", "Waffle") as MenuEnvelope;
    expect("route" in r).toBe(false);
    expect(r.page).toBe("gear");
    expect(r.ask).toBeDefined();
    expect(r.do).toBeUndefined();
  });
});
