import { describe, expect, test } from "bun:test";
import { displayWidth } from "../art";
import type { BuddyStats } from "../engine";
import { textWidth } from "../gfx/font";
import { execute, type BuddyCtx } from "../rpg/game";
import { actionBar, fightActions, resultsCard } from "../rpg/playkit";
import { freshState } from "../rpg/store";
import { banner, bannerFrames, BANNER_ROWS } from "./banner";
import { THEME, gradient, rgb, stripSgr, type Ui } from "./color";
import { chip, legend, parseHint } from "./keys";
import { meter } from "./meter";
import { highlight, menuBody, menuOpenFrames, menuScreen, moveCursor, selectable, type Menu } from "./menu";
import { panel } from "./panel";
import { portrait, portraitPixels } from "./portrait";

const UI: Ui = { mode: "truecolor", motion: true, flash: true };
const UI256: Ui = { mode: "256", motion: false, flash: false };
const STATS: BuddyStats = { DEBUGGING: 30, PATIENCE: 30, CHAOS: 30, WISDOM: 30, SNARK: 30 };
const CTX: BuddyCtx = { name: "Pip", species: "cat", eye: "·", hat: "none", level: 9, prestige: 0, stats: STATS, rarity: "epic" };
const T0 = Date.UTC(2026, 9, 5, 12);
const TRUECOLOR = /\x1b\[[0-9;]*[34]8;[25];/;

// ─── Panels ─────────────────────────────────────────────────────────────────

describe("panel", () => {
  const o = { title: "✦ BUDDY QUEST", right: "Turn 3", body: ["hello", "a longer line of body text"], footer: ";x explore" };

  test("classic face is the pre-kit panel, byte for byte", () => {
    expect(panel(false, undefined, o)).toBe(
      [
        "╭─ ✦ BUDDY QUEST ───────────────────────────────── Turn 3 ─╮",
        "│ hello",
        "│ a longer line of body text",
        "╰─ ;x explore ─────────────────────────────────────────────╯",
      ].join("\n"),
    );
    // Color without a Ui keeps the classic dim/bold escapes only.
    const ansi = panel(true, undefined, o);
    expect(ansi).toContain("\x1b[2m╭─\x1b[0m\x1b[1m ✦ BUDDY QUEST \x1b[0m");
    expect(ansi).not.toMatch(TRUECOLOR);
  });

  test("rich face has the same characters and layout", () => {
    for (const ui of [UI, UI256]) {
      const rich = panel(true, ui, { ...o, accent: THEME.gold });
      expect(stripSgr(rich)).toBe(panel(false, undefined, o));
    }
    expect(panel(true, UI, o)).toMatch(TRUECOLOR);
    expect(panel(true, UI256, o)).toContain("38;5;");
  });
});

// ─── Meters ─────────────────────────────────────────────────────────────────

describe("meter", () => {
  test("is always exactly `width` cells", () => {
    for (const w of [1, 5, 14, 20]) {
      for (let cur = 0; cur <= 50; cur += 7) {
        expect(displayWidth(meter(UI, cur, 50, w))).toBe(w);
        expect(displayWidth(meter(UI, cur, 50, w, { ghost: 50, fresh: true }))).toBe(w);
      }
    }
  });

  test("1/8-cell precision", () => {
    const plain = (s: string) => stripSgr(s);
    expect(plain(meter(UI, 1, 80, 10))).toBe("▏" + " ".repeat(9));
    expect(plain(meter(UI, 40, 80, 10))).toBe("█████     ");
    expect(plain(meter(UI, 45, 80, 10))).toBe("█████▋    ");
  });

  test("ghost shows white when fresh, dark red after", () => {
    expect(meter(UI, 20, 100, 10, { ghost: 60, fresh: true })).toContain("38;2;255;255;255");
    const late = meter(UI, 20, 100, 10, { ghost: 60 });
    expect(late).toContain(`38;2;${THEME.ghost.join(";")}`);
    expect(meter(UI, 20, 100, 10)).not.toContain(`38;2;${THEME.ghost.join(";")}`);
  });

  test("only low HP pulses", () => {
    expect(meter(UI, 10, 100, 10, { pulse: 0.5 })).not.toBe(meter(UI, 10, 100, 10, { pulse: 0 }));
    expect(meter(UI, 90, 100, 10, { pulse: 0.5 })).toBe(meter(UI, 90, 100, 10, { pulse: 0 }));
  });
});

// ─── Keys ───────────────────────────────────────────────────────────────────

describe("key prompts", () => {
  test("chips: a pill in rich, ⟨key⟩ in classic", () => {
    expect(chip(undefined, "⏎", "confirm")).toBe("⟨⏎⟩ confirm");
    expect(stripSgr(chip(UI, "⏎", "confirm"))).toBe(" ⏎  confirm");
  });

  test("the legend flows right-aligned within the width", () => {
    const items = parseHint("↑↓ navigate  ⏎/␣ select  esc back  q quit");
    expect(items).toEqual([["↑↓", "navigate"], ["⏎/␣", "select"], ["esc", "back"], ["q", "quit"]]);
    for (const cols of [20, 40, 80]) {
      const lines = legend(UI, items, cols);
      for (const l of lines) expect(displayWidth(l)).toBe(cols);
    }
    expect(legend(UI, items, 200).length).toBe(1);
    expect(legend(UI, items, 25).length).toBeGreaterThan(1);
  });
});

// ─── Menus ──────────────────────────────────────────────────────────────────

describe("menus", () => {
  const m: Menu = {
    title: "Shop",
    items: [
      { label: "Coffee   25g", cmd: ";buy 1", desc: "heal 40%" },
      { label: "— gear —" },
      { label: "Hoodie  108g", cmd: ";buy 5", desc: "+4 DEF", blocked: "not enough gold" },
      { label: "(sold out)" },
      { label: "Note    108g", cmd: ";buy 7", desc: "+5 ATK" },
    ],
  };

  test("the cursor skips rows that can't be picked, and wraps", () => {
    expect(selectable(m)).toEqual([0, 2, 4]);
    expect(moveCursor(m, 0, 1)).toBe(2);
    expect(moveCursor(m, 2, 1)).toBe(4);
    expect(moveCursor(m, 4, 1)).toBe(0);
    expect(moveCursor(m, 0, -1)).toBe(4);
  });

  test("moving the cursor never changes the layout height", () => {
    const h = menuBody(UI, m, 0).length;
    for (const c of selectable(m)) for (const phase of [0, 0.3, 0.7]) expect(menuBody(UI, m, c, { phase }).length).toBe(h);
    expect(menuOpenFrames(UI, m, 0).every((f) => f.text.split("\n").length === menuScreen(UI, m, 0).split("\n").length)).toBe(true);
  });

  test("the description pane names the row and why it's blocked", () => {
    const body = menuBody(UI, m, 2).map(stripSgr);
    expect(body[body.length - 1]).toBe("┃ +4 DEF (not enough gold)");
    expect(body.find((l) => l.includes("Hoodie"))).toContain("▸");
  });

  test("slot-in reveals rows one at a time", () => {
    const frames = menuOpenFrames(UI, m, 0).map((f) => stripSgr(f.text));
    expect(frames.length).toBe(m.items.length);
    expect(frames[0]).toContain("Coffee");
    expect(frames[0]).not.toContain("Hoodie");
    expect(frames[frames.length - 1]).toContain("Note");
  });

  test("highlight keeps the text and its width", () => {
    const t = "\x1b[33m[R]\x1b[0m Hoodie";
    expect(stripSgr(highlight(UI, t, THEME.select, 3))).toBe(stripSgr(t));
  });

  test("the fight bar: rich chips, classic brackets unchanged", () => {
    const s = freshState(T0);
    execute(s, CTX, ";help", T0, { color: false });
    execute(s, CTX, ";x", T0, { color: false });
    const acts = fightActions(s);
    expect(acts.length).toBeGreaterThan(2);
    expect(actionBar(acts, 1, 80, false)[0]).toContain("[Defend]");
    const rich = actionBar(acts, 1, 80, true, UI).map(stripSgr);
    expect(rich[0]).toContain(" Defend ");
    expect(rich[rich.length - 1]).toContain("┃ brace");
  });
});

// ─── Banners ────────────────────────────────────────────────────────────────

describe("banners", () => {
  const colors = { from: rgb("#fff3a0"), to: rgb("#ff9a30") };

  test("four rows of pixel type, centered", () => {
    const b = banner(UI, "VICTORY", colors, 60);
    expect(b.length).toBe(BANNER_ROWS);
    const w = textWidth("VICTORY") + 2;
    for (const l of b) expect(displayWidth(l)).toBe(Math.floor((60 - w) / 2) + w);
  });

  test("T0 uses plain block characters", () => {
    const b = banner(undefined, "VICTORY", colors, 40);
    expect(b.join("")).not.toContain("\x1b");
    expect(b.join("")).toMatch(/[█▀▄]/);
  });

  test("opens from the center, flashes only when allowed", () => {
    const shut = banner(UI, "LEVEL UP", { ...colors, reveal: 0 }, 40);
    expect(stripSgr(shut.join("")).trim()).toBe("");
    expect(bannerFrames(UI, "LEVEL UP", colors, 40).length).toBe(8);
    expect(bannerFrames({ ...UI, flash: false }, "LEVEL UP", colors, 40).length).toBe(7);
    expect(bannerFrames({ ...UI, motion: false, flash: false }, "LEVEL UP", colors, 40).length).toBe(1);
  });

  test("gradient text keeps its characters", () => {
    expect(stripSgr(gradient(UI, "RESULTS", THEME.gold, THEME.boss))).toBe("RESULTS");
  });
});

// ─── Portraits ──────────────────────────────────────────────────────────────

describe("portraits", () => {
  test("HD species get a bust, a face and a small cut", () => {
    for (const sp of ["blob", "cat", "dragon"] as const) {
      const bust = portrait(sp)!;
      expect(bust.length).toBe(14);
      expect(displayWidth(bust[0])).toBe(32);
      const face = portrait(sp, { size: "face" })!;
      expect(face.length).toBe(9);
      expect(displayWidth(face[0])).toBe(22);
      expect(portrait(sp, { size: "small" })!.length).toBe(7);
    }
  });

  test("species without HD art return null", () => {
    expect(portrait("nope" as never)).toBeNull();
    expect(portraitPixels("nope" as never)).toBeNull();
    expect(portraitPixels("robot")).not.toBeNull();
  });

  test("deterministic, and the idle clock moves it", () => {
    expect(portrait("cat", { t: 1 })).toEqual(portrait("cat", { t: 1 }));
    expect(portrait("cat", { t: 1.3 })).not.toEqual(portrait("cat", { t: 0 }));
  });
});

// ─── Game screens ───────────────────────────────────────────────────────────

describe("rich game screens", () => {
  const P = { color: true, anim: true, ui: UI };
  const fresh = () => {
    const s = freshState(T0);
    s.gold = 60;
    execute(s, CTX, ";help", T0, { color: false });
    return s;
  };

  test("the shop is a walkable menu", () => {
    const r = execute(fresh(), CTX, ";shop", T0, P);
    expect(r.menu?.source).toBe(";shop");
    expect(r.menu!.stay).toBe(true);
    const cmds = r.menu!.items.flatMap((i) => (i.cmd ? [i.cmd] : []));
    expect(cmds.slice(0, 4)).toEqual([";buy 1", ";buy 2", ";buy 3", ";buy 4"]);
    expect(r.menu!.items.find((i) => i.cmd === ";buy 2")!.blocked).toBe("not enough gold");
    expect(stripSgr(r.out)).toContain("🏪 Merchant");
    expect(stripSgr(r.out)).toContain("▸");
  });

  test("the map only lets you pick open zones", () => {
    const r = execute(fresh(), CTX, ";map", T0, P);
    expect(r.menu!.items.filter((i) => i.cmd).map((i) => i.cmd)).toEqual([";go 1"]);
  });

  test("the bag offers sell, lock and forge keys", () => {
    const s = fresh();
    s.bag.push({ uid: 1, slot: "weapon", name: "Rusty Pointer", rarity: "rare", ilvl: 3, stats: { atk: 5 } });
    const r = execute(s, CTX, ";bag", T0, P);
    const it = r.menu!.items.find((i) => i.cmd === ";equip 1")!;
    expect(it.keys).toEqual({ s: ";sell 1", l: ";lock 1", f: ";forge 1" });
  });

  test("the character sheet and town show the HD portrait", () => {
    const s = fresh();
    expect(execute(s, CTX, ";me", T0, P).out).toContain("▀");
    expect(execute(s, CTX, ";", T0, P).out).toContain("▀");
    // H6: every species has a portrait now.
    expect(execute(s, { ...CTX, species: "duck" }, ";", T0, P).out).toContain("▀");
  });

  test("events open as a dialogue box with typed-out text", () => {
    for (let seed = 0; seed < 400; seed++) {
      const s = fresh();
      s.lastEvent = false; // a fresh save never opens on an event
      const r = execute(s, CTX, ";x", T0 + seed * 997, P);
      if (!s.event) continue;
      expect(r.anim!.length).toBeGreaterThan(5);
      const lens = r.anim!.map((f) => stripSgr(f.text).replace(/\s/g, "").length);
      for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThanOrEqual(lens[i - 1]);
      expect(r.out).toContain("▀"); // the buddy's portrait
      return;
    }
    throw new Error("no event rolled");
  });

  test("the results card: rich panel, same numbers", () => {
    const r = { gold: 40, xp: 7, drops: ["[R] Rusty Blade"], boss: true };
    const rich = resultsCard(r, 1, true, UI).map(stripSgr).join("\n");
    expect(rich).toContain("♛ RESULTS ♛");
    expect(rich).toContain("+40g");
    expect(rich).toContain("Rusty Blade");
  });
});

// ─── The hook never changes ─────────────────────────────────────────────────

describe("classic output", () => {
  test("no Ui ⇒ no truecolor, no pixels, no menus", () => {
    const cmds = [";help", ";", ";shop", ";bag", ";map", ";me", ";skills", ";x", ";a", ";a", ";"];
    for (const p of [{ color: false }, { color: true }, { color: true, anim: true }]) {
      const s = freshState(T0);
      for (const c of cmds) {
        const r = execute(s, CTX, c, T0, p);
        expect(r.out, c).not.toMatch(TRUECOLOR);
        expect(r.out, c).not.toContain("▀");
        expect(r.menu, c).toBeUndefined();
      }
    }
  });
});
