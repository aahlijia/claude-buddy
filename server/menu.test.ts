import { describe, expect, test } from "bun:test";

import {
  MENU,
  getMenuPage,
  menuMarker,
  renderMenuCard,
  type MenuPage,
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

describe("menuMarker", () => {
  test("round-trips the page payload as JSON", () => {
    const marker = menuMarker(MENU.root);
    const match = marker.match(/^<!-- buddy:menu (.*) -->$/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    expect(payload).toEqual({
      page: "root",
      title: MENU.root.title,
      options: MENU.root.options,
    });
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
