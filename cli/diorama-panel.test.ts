import { describe, expect, test } from "bun:test";

import { CellGrid, diffCells, narrow } from "../server/gfx/encode/cells.ts";
import { BUBBLE_MS, DioramaPanel, IDLE_MS, SLEEP_MS, dioramaEnabled, kittyPlaysAnimations, type PanelOptions, type PanelStatus } from "./diorama-panel.ts";

const STATUS: PanelStatus = { name: "Pip", species: "cat", rarity: "rare", stars: "★★★", reaction: "", gameFeel: "full" };
const STATS = { stats: { DEBUGGING: 30, PATIENCE: 12, CHAOS: 44, WISDOM: 20, SNARK: 51 }, peak: "SNARK", dump: "PATIENCE" };
const LAYOUT = { cols: 120, rows: 50, code: 40 };
const NOON = new Date(2026, 9, 5, 12, 30);
const T0 = 1_000_000;

function panel(o: Partial<PanelOptions> = {}, status: PanelStatus = STATUS, cfg = {}) {
  const p = new DioramaPanel({ tier: "halfblock", color: "truecolor", tmux: false, ...o });
  p.resize(LAYOUT);
  p.update(T0, status, STATS, cfg);
  return p;
}

/** Every 1-based row the bytes move the cursor to. */
function rows(bytes: string): number[] {
  return [...bytes.matchAll(/\x1b\[(\d+);(\d+)H/g)].map((m) => Number(m[1]));
}

/** Kitty placements: [row the cursor was on, r= rows]. */
function placements(bytes: string): [number, number][] {
  const out: [number, number][] = [];
  let row = 0;
  for (const m of bytes.matchAll(/\x1b\[(\d+);\d+H|\x1b_G([^;\x1b]*)/g)) {
    if (m[1]) row = Number(m[1]);
    else if (m[2]?.startsWith("a=p")) out.push([row, Number(/,r=(\d+)/.exec(m[2])![1])]);
  }
  return out;
}

describe("gates", () => {
  const cfg = {};
  test("on for HD buddies in a graphics-capable terminal", () => {
    expect(dioramaEnabled("halfblock", STATUS, cfg, LAYOUT)).toBe(true);
    expect(dioramaEnabled("kitty", { ...STATUS, gameFeel: "subtle" }, cfg, LAYOUT)).toBe(true);
  });
  test("gameFeel off → today's panel", () => {
    expect(dioramaEnabled("halfblock", { ...STATUS, gameFeel: "off" }, cfg, LAYOUT)).toBe(false);
    expect(dioramaEnabled("halfblock", { ...STATUS, gameFeel: undefined }, { gameFeel: "off" }, LAYOUT)).toBe(false);
  });
  test("species without HD art, text-only terminals and tiny panels keep the ASCII panel", () => {
    expect(dioramaEnabled("halfblock", { ...STATUS, species: "nope" }, cfg, LAYOUT)).toBe(false);
    expect(dioramaEnabled("halfblock", { ...STATUS, species: "duck" }, cfg, LAYOUT)).toBe(true);
    expect(dioramaEnabled("ascii", STATUS, cfg, LAYOUT)).toBe(false);
    expect(dioramaEnabled("halfblock", STATUS, cfg, { cols: 120, rows: 24, code: 19 })).toBe(false);
    expect(dioramaEnabled("kitty", STATUS, cfg, { cols: 120, rows: 24, code: 19 })).toBe(true);
    expect(dioramaEnabled("kitty", STATUS, cfg, { cols: 120, rows: 20, code: 16 })).toBe(false);
    expect(dioramaEnabled("halfblock", null, cfg, LAYOUT)).toBe(false);
  });
  test("subtle → no lightning; full → lightning", () => {
    const full = panel({ weather: "storm" }).peek(T0, NOON).spec;
    const subtle = panel({ weather: "storm" }, { ...STATUS, gameFeel: "subtle" }).peek(T0, NOON).spec;
    const still = panel({ weather: "storm" }, STATUS, { reduceMotion: true }).peek(T0, NOON).spec;
    expect(full.flash).toBe(true);
    expect(subtle.flash).toBe(false);
    expect(still.flash).toBe(false);
  });
  test("kitty proper plays animations natively", () => {
    expect(kittyPlaysAnimations({ TERM: "xterm-kitty" })).toBe(true);
    expect(kittyPlaysAnimations({ KITTY_WINDOW_ID: "1" })).toBe(true);
    expect(kittyPlaysAnimations({ TERM_PROGRAM: "ghostty" })).toBe(false);
  });
});

describe("half-block placement", () => {
  test("a full paint covers the panel and only the panel", () => {
    const out = panel().paint(T0, NOON, true);
    expect(out.startsWith("\x1b7")).toBe(true);
    expect(out.endsWith("\x1b8")).toBe(true);
    const r = rows(out);
    expect(Math.min(...r)).toBe(LAYOUT.code + 2);
    expect(Math.max(...r)).toBe(LAYOUT.rows);
    // No line feeds or reverse indexes that could scroll the child's region.
    expect(out).not.toMatch(/\n|\x1bM|\x1bD/);
  });

  test("later frames only send what changed, and never above the panel", () => {
    const p = panel({ weather: "rain" });
    const full = p.paint(T0, NOON, true);
    let total = 0;
    for (let i = 1; i <= 24; i++) {
      const f = p.paint(T0 + i * 83, NOON);
      total += f.length;
      for (const r of rows(f)) expect(r).toBeGreaterThanOrEqual(LAYOUT.code + 2);
    }
    expect(total / 24).toBeLessThan(full.length / 2);
  });

  test("nothing changed → nothing sent", () => {
    const p = panel({}, STATUS, { reduceMotion: true });
    p.paint(T0, NOON, true);
    expect(p.paint(T0 + 5000, NOON)).toBe("");
  });

  test("text overlay: the name card and the speech bubble", () => {
    const p = panel({}, { ...STATUS, reaction: "Nice refactor!" });
    const out = p.paint(T0, NOON, true);
    const plain = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b[78]/g, "");
    expect(plain).toContain("Pip");
    expect(plain).toContain("Nice");
    expect(plain).toContain("SNARK");
    // The bubble goes away after BUBBLE_MS.
    const later = p.paint(T0 + BUBBLE_MS + 100, NOON, true).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    expect(later).not.toContain("Nice");
  });

  test("the byte budget skips frames rather than flooding the terminal", () => {
    const p = panel({ weather: "storm", maxBytesPerSec: 2000 });
    expect(p.paint(T0, NOON, true).length).toBeGreaterThan(2000); // a repaint always goes out
    let sent = 0;
    for (let i = 1; i <= 12; i++) sent += p.paint(T0 + i * 83, NOON).length;
    expect(sent).toBeLessThan(2000 * 1.5);
  });
});

describe("kitty placement", () => {
  test("first frame uploads layers and places them inside the panel", () => {
    const p = panel({ tier: "kitty" });
    const out = p.paint(T0, NOON, true);
    expect(out).toContain("a=t");
    const ps = placements(out);
    expect(ps.length).toBeGreaterThanOrEqual(5); // sky, far, mid, near, buddy, plates
    for (const [row, r] of ps) {
      expect(row).toBeGreaterThanOrEqual(LAYOUT.code + 2);
      expect(row + r - 1).toBeLessThanOrEqual(LAYOUT.rows);
    }
    // Every image sits under the text and keeps the cursor still.
    for (const m of out.matchAll(/\x1b_G(a=p[^;\x1b]*)/g)) {
      expect(m[1]).toMatch(/z=-\d+/);
      expect(m[1]).toContain("C=1");
    }
    for (const r of rows(out)) expect(r).toBeGreaterThanOrEqual(LAYOUT.code + 2);
  });

  test("idle frames are placements, not uploads", () => {
    const p = panel({ tier: "kitty" });
    p.paint(T0, NOON, true);
    // Warm the frame cache over a minute of wandering (both facings), then
    // measure a second-long stretch where the buddy stands idle.
    let now = T0;
    for (; now < T0 + 60_000; now += 83) p.paint(now, NOON);
    while (![0, 250, 500, 750, 1000].every((d) => p.peek(now + d, NOON).beat.anim === "idle")) {
      p.paint(now, NOON);
      now += 83;
    }
    let bytes = 0;
    let uploads = 0;
    for (let i = 0; i < 12; i++, now += 83) {
      const f = p.paint(now, NOON);
      bytes += f.length;
      uploads += (f.match(/a=t/g) ?? []).length;
    }
    expect(uploads).toBe(0);
    expect(bytes / 12).toBeLessThan(400);
  });

  test("the sky is re-sent only when the light changes", () => {
    const p = panel({ tier: "kitty" });
    p.paint(T0, NOON, true);
    const sky = `a=t,f=32,s=${LAYOUT.cols * 4},v=${(LAYOUT.rows - LAYOUT.code - 1) * 8}`;
    expect(p.paint(T0, NOON, true)).toContain(sky);
    expect(p.paint(T0 + 100, new Date(2026, 9, 5, 12, 33))).not.toContain(sky);
    expect(p.paint(T0 + 200, new Date(2026, 9, 5, 18, 30))).toContain(sky);
  });

  test("weather loops natively in kitty, by frame swaps elsewhere", () => {
    const native = panel({ tier: "kitty", weather: "rain", kittyNative: true, maxBytesPerSec: 1e7 }).paint(T0, NOON, true);
    expect(native).toContain("a=f");
    expect(native).toMatch(/a=a,[^;\x1b]*s=3/);
    const swap = panel({ tier: "kitty", weather: "rain", maxBytesPerSec: 1e7 }).paint(T0, NOON, true);
    expect(swap).not.toContain("a=f");
  });

  test("hide() takes every image off screen; hide(true) frees them", () => {
    const p = panel({ tier: "kitty" });
    p.paint(T0, NOON, true);
    expect(p.hide()).toMatch(/a=d,d=i/);
    p.paint(T0 + 100, NOON, true);
    expect(p.hide(true)).toMatch(/a=d,d=I/);
  });

  test("tmux wraps graphics in passthrough", () => {
    const out = panel({ tier: "kitty", tmux: true }).paint(T0, NOON, true);
    expect(out).toContain("\x1bPtmux;");
  });
});

describe("iTerm placement", () => {
  test("an inline image at the panel's top-left, sized to the panel", () => {
    const out = panel({ tier: "iterm" }).paint(T0, NOON, true);
    expect(out).toContain(`\x1b[${LAYOUT.code + 2};1H\x1b]1337;File=`);
    expect(out).toContain(`width=${LAYOUT.cols}`);
    expect(out).toContain(`height=${LAYOUT.rows - LAYOUT.code - 1}`);
  });
});

describe("pacing", () => {
  test("12 fps while active, half rate when idle, asleep after a while or unfocused", () => {
    const p = panel();
    p.input(T0);
    expect(p.nextDelay(T0 + 1000)).toBe(83);
    expect(p.nextDelay(T0 + IDLE_MS + 1000)).toBe(167);
    expect(p.nextDelay(T0 + SLEEP_MS + 1000)).toBeNull();
    p.focus(false, T0);
    expect(p.nextDelay(T0 + 1000)).toBeNull();
    p.focus(true, T0 + 2000);
    expect(p.nextDelay(T0 + 3000)).toBe(83);
  });

  test("asleep, the scene holds still: repair repaints change nothing, waking resumes", () => {
    const p = panel();
    p.input(T0);
    p.paint(T0, NOON, true);
    const asleep = T0 + SLEEP_MS + 5000;
    const a = p.peek(asleep, NOON).beat;
    p.paint(asleep, NOON);
    expect(p.paint(asleep + 3000, NOON)).toBe("");
    expect(p.peek(asleep + 60_000, NOON).beat).toEqual(a);
    // Waking resumes from the frozen moment rather than jumping ahead.
    p.input(asleep + 60_000);
    expect(p.peek(asleep + 60_000, NOON).beat.x).toBeCloseTo(a.x, 6);
  });

  test("reduceMotion: no frame timer at all (still frames on change only)", () => {
    expect(panel({}, STATUS, { reduceMotion: true }).nextDelay(T0)).toBeNull();
  });

  test("iTerm re-sends whole pictures, so it runs slower", () => {
    const p = panel({ tier: "iterm" });
    p.input(T0);
    expect(p.nextDelay(T0)).toBe(250);
  });
});

describe("reactions", () => {
  test("hooks make the buddy flinch, cheer and nod", () => {
    const p = panel();
    p.react("test-fail", T0 + 1000);
    expect(p.peek(T0 + 1200, NOON).beat.anim).toBe("hit");
    p.react("all-green", T0 + 5000);
    expect(p.peek(T0 + 5500, NOON).beat.anim).toBe("victory");
    p.react("turn", T0 + 9000); // not a reaction
    expect(["idle", "walk"]).toContain(p.peek(T0 + 9100, NOON).beat.anim);
  });

  test("Claude's output (not the keystroke echo) is thinking", () => {
    const p = panel();
    p.input(T0 + 1000);
    p.output(T0 + 1100); // echo
    expect(p.peek(T0 + 1200, NOON).beat.think).toBe(false);
    p.output(T0 + 2000);
    p.output(T0 + 2500);
    expect(p.peek(T0 + 2600, NOON).beat.think).toBe(true);
    // Quiet for a while → done thinking.
    expect(p.peek(T0 + 9000, NOON).beat.think).toBe(false);
  });
});

describe("cell grids", () => {
  const grid = (ch: string) => {
    const g = new CellGrid(4, 2);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g.set(c, r, { ch, sgr: "48;2;1;2;3" });
    return g;
  };

  test("identical grids diff to nothing; one changed cell is one jump and one glyph", () => {
    expect(diffCells(grid("x"), grid("x"), 10, 1)).toBe("");
    const next = grid("x");
    next.set(2, 1, { ch: "y", sgr: "48;2;1;2;3" });
    expect(diffCells(grid("x"), next, 10, 1)).toBe("\x1b[11;3H\x1b[0;48;2;1;2;3my\x1b[0m");
  });

  test("a full paint stays inside the grid's rectangle", () => {
    const out = diffCells(null, grid("x"), 10, 5);
    expect(rows(out)).toEqual([10, 11]);
    expect((out.match(/x/g) ?? []).length).toBe(8);
  });

  test("narrow() keeps one cell per glyph", () => {
    expect(narrow("Pip ✨")).toBe("Pip ✦");
    expect(narrow("★★★")).toBe("★★★");
    expect(narrow("日本")).toBe("**");
    expect(narrow("a\tb")).toBe("a b");
  });
});
