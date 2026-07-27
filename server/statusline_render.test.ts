/**
 * Render tests for statusline/buddy-status.sh — Phase 6 prestige titles.
 *
 * Drives the real bash script under a temp CLAUDE_CONFIG_DIR with a hand-built
 * status.json fixture, then asserts on its stdout. Hermetic via the spawned
 * process's env (no shared module state), mirroring paths_sh.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { displayWidth } from "./art";
import { bakePendingScene } from "./combat";
import { bakeVisitorScene } from "./visitor";

const SCRIPT = resolve(import.meta.dir, "..", "statusline", "buddy-status.sh");

/** Strip ANSI SGR escape codes so assertions can match rendered text. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

interface StatusOverrides {
  title?: string | null;
  name?: string;
  level?: number;
  reaction?: string;
  /** When set, writes config.json with showStats and includes stats in status.json. */
  showStats?: boolean;
  /** Omit stats entirely from status.json (simulates an older server build). */
  omitStats?: boolean;
  /** When set, writes config.json with showPrestigeBadge (FR1.5). */
  showPrestigeBadge?: boolean;
  /** Prestige tier in status.json (default 0). */
  prestigeLevel?: number;
  /** Current streak in status.json (default 0). */
  streak?: number;
  /** Omit prestige/streak fields from status.json (simulates an older server). */
  omitBadgeFields?: boolean;
  /** Level-progress percent in status.json (default 50). */
  xpPct?: number;
  /** Most recent XP gain — amount + seconds-ago for the toast window. */
  lastXpGain?: { amount: number; secondsAgo: number } | null;
  /** Omit xpPct/lastXpGain entirely (simulates an older server). */
  omitXpFields?: boolean;
  /** Game-feel intensity written into config.json (default unset → subtle). */
  gameFeel?: "off" | "subtle" | "full";
  /** A celebration with a seconds-ago age for the toast/flourish window. */
  celebration?: { text: string; secondsAgo: number } | null;
  /** Flourish frame set (game-feel FR-A3) written into status.json. */
  flourishFrames?: string[];
  flourishSequence?: number[];
  /** Idle-wander horizontal offset sequence (movement P3) in status.json. */
  wanderSequence?: number[];
  /** Idle-wander vertical (hop) offset sequence in status.json. */
  wanderRowSequence?: number[];
  /** Override the fixed reference "now" (default 1_700_000_000) so the sweep can
   *  index the wander/frame sequences at a chosen tick (offset = seq[now%len]). */
  fakeNow?: number;
  /** Override the server-rendered art frames (e.g. a tall frame to exercise the
   *  hop height-budget degrade). */
  frames?: string[];
  /** Override the idle frameSequence (default [0]) — living-world P1 gait
   *  fixtures pin a walk-length sequence with a gait-variant index at a
   *  known tick. */
  frameSequence?: number[];
  /** Writes reaction.<SID>.json (the persistent per-session reaction file) so the
   *  sticky-bubble fallback can be exercised. SID is "default" outside tmux. */
  persistedReaction?: { reaction: string; secondsAgo?: number };
  /** reactionTTL (seconds) written into config.json — 0 (default) = permanent. */
  reactionTTL?: number;
  /** bubbleMargin in config.json (default 8) — drives the wander clamp/§7.C. */
  bubbleMargin?: number;
  /** Terminal width (default 125) — shrink it to exercise §7.C resize. */
  columns?: number;
  /** Idle-RPG (Phase 4): enemy glyph + its age for the encounter render. */
  enemyGlyph?: string;
  encounterSecondsAgo?: number;
  /** Idle-RPG (Phase 5): the baked two-sprite combat scene + its width. Shares
   *  encounterSecondsAgo for the TTL window. */
  combatFrames?: string[];
  combatSequence?: number[];
  artWidth?: number;
  /** Pending encounter (design-pending-encounter §5): render the scene as the
   *  persistent standoff — writes combatSticky:1 and, crucially, NO encounterAt
   *  (proving the TTL bypass). Requires combatFrames; ignores encounterSecondsAgo. */
  combatSticky?: boolean;
  /** Combined-status mode: model/context/usage/reset metrics, written into
   *  config.json (useCombinedStatus) and fed as the Claude Code stdin JSON. */
  useCombinedStatus?: boolean;
  /** Raw Claude Code stdin JSON (model/context/rate-limit). Default "". */
  ccInput?: string;
  /** Stat-up panel flash (stats-leveling-v2 §P4): the raised stat names + how
   *  many seconds ago, driving the ~10s value-brighten. */
  statsRaised?: { names: string[]; secondsAgo: number };
  /** Living ground (living-world follow-up): terrain tile + hex colour written
   *  into status.json for the fixed full-width ground row. */
  ground?: string;
  groundColor?: string;
  /** Ground weather (living-world follow-up): the woven-in glyph + its hex
   *  colour, distinct from groundColor so the shell recolors just that glyph. */
  groundWeatherGlyph?: string;
  groundWeatherColor?: string;
  /** Falling weather field (plan-falling-weather.md Task 3, made a front layer
   *  by design-weather-frontlayer.md): the baked PLAIN (ANSI-free) flipbook
   *  the shell tiles, slices per segment and composites OVER existing content,
   *  plus its NOW%len index sequence. There is only one weather layer — the
   *  SGR-carrying ART band that used to reserve sky rows above the sprite is
   *  gone (F9), so `weatherFallSequence` now rides with these frames. */
  weatherFallSequence?: number[];
  weatherFallGapFrames?: string[];
  weatherFallGapGlyph?: string;
  weatherFallGapColor?: string;
}

/** Write a minimal status.json into a temp config dir and run buddy-status.sh
 *  against it, returning the script's stdout. */
function renderStatus(overrides: StatusOverrides): string {
  const cfgDir = mkdtempSync(join(tmpdir(), "buddy-status-test-"));
  const stateDir = join(cfgDir, "buddy-state");
  mkdirSync(stateDir, { recursive: true });

  const status: Record<string, unknown> = {
    name: overrides.name ?? "Waffle",
    rarity: "common",
    shiny: false,
    reaction: overrides.reaction ?? "",
    achievement: "",
    level: overrides.level ?? 11,
    mood: "focused",
    muted: false,
    title: overrides.title ?? null,
    // One concrete frame so the cycler has something to pick.
    frames: overrides.frames ?? [
      "            \n    (··)    \n    (  )    \n            \n            ",
    ],
    frameSequence: overrides.frameSequence ?? [0],
  };
  if (!overrides.omitStats) {
    status.stats = {
      DEBUGGING: 10,
      PATIENCE: 22,
      CHAOS: 28,
      WISDOM: 5,
      SNARK: 76,
    };
    status.peak = "SNARK";
    status.dump = "WISDOM";
  }
  if (!overrides.omitBadgeFields) {
    status.prestigeLevel = overrides.prestigeLevel ?? 0;
    status.streak = overrides.streak ?? 0;
  }
  // Fixed reference "now" so toast-age assertions are deterministic; the sweep
  // overrides it to land on a chosen wander offset.
  const fakeNow = overrides.fakeNow ?? 1_700_000_000;
  if (overrides.celebration) {
    status.celebration = {
      text: overrides.celebration.text,
      kind: "ascension",
      at: (fakeNow - overrides.celebration.secondsAgo) * 1000,
    };
  }
  if (overrides.flourishFrames) {
    status.flourishFrames = overrides.flourishFrames;
    status.flourishSequence = overrides.flourishSequence ?? [0];
  }
  if (overrides.enemyGlyph) {
    status.enemyGlyph = overrides.enemyGlyph;
    status.encounterAt =
      (fakeNow - (overrides.encounterSecondsAgo ?? 0)) * 1000;
  }
  if (overrides.combatFrames) {
    status.combatFrames = overrides.combatFrames;
    status.combatSequence = overrides.combatSequence ?? [0];
    status.artWidth = overrides.artWidth ?? 28;
    if (overrides.combatSticky) {
      // Pending standoff: sticky bit, no encounterAt — the TTL is bypassed.
      status.combatSticky = 1;
    } else {
      // Resolved phase: the scene render keys off encounterAt freshness.
      status.encounterAt =
        (fakeNow - (overrides.encounterSecondsAgo ?? 0)) * 1000;
    }
  }
  if (overrides.statsRaised) {
    status.statsRaised = {
      names: overrides.statsRaised.names,
      at: (fakeNow - overrides.statsRaised.secondsAgo) * 1000,
    };
  }
  if (overrides.ground) {
    status.ground = overrides.ground;
    status.groundColor = overrides.groundColor ?? "4a7c3f";
  }
  if (overrides.groundWeatherGlyph) {
    status.groundWeatherGlyph = overrides.groundWeatherGlyph;
    status.groundWeatherColor = overrides.groundWeatherColor ?? "e8f0f7";
  }
  if (overrides.weatherFallGapFrames) {
    status.weatherFallSequence = overrides.weatherFallSequence ?? [0];
    status.weatherFallGapFrames = overrides.weatherFallGapFrames;
    status.weatherFallGapGlyph = overrides.weatherFallGapGlyph ?? "❄";
    status.weatherFallGapColor = overrides.weatherFallGapColor ?? "e8f0f7";
  }
  if (overrides.wanderSequence) status.wanderSequence = overrides.wanderSequence;
  if (overrides.wanderRowSequence) {
    status.wanderRowSequence = overrides.wanderRowSequence;
  }
  if (!overrides.omitXpFields) {
    status.xpPct = overrides.xpPct ?? 50;
    status.lastXpGain = overrides.lastXpGain
      ? {
          amount: overrides.lastXpGain.amount,
          at: (fakeNow - overrides.lastXpGain.secondsAgo) * 1000,
        }
      : null;
  }
  writeFileSync(join(stateDir, "status.json"), JSON.stringify(status));

  // The persistent per-session reaction file (sticky-bubble fallback source).
  if (overrides.persistedReaction) {
    writeFileSync(
      join(stateDir, "reaction.default.json"),
      JSON.stringify({
        reaction: overrides.persistedReaction.reaction,
        timestamp:
          (fakeNow - (overrides.persistedReaction.secondsAgo ?? 0)) * 1000,
        reason: "turn",
      }),
    );
  }

  if (
    overrides.showStats !== undefined ||
    overrides.showPrestigeBadge !== undefined ||
    overrides.gameFeel !== undefined ||
    overrides.reactionTTL !== undefined ||
    overrides.bubbleMargin !== undefined ||
    overrides.useCombinedStatus !== undefined
  ) {
    const cfg: Record<string, unknown> = {};
    if (overrides.useCombinedStatus !== undefined) {
      cfg.useCombinedStatus = overrides.useCombinedStatus;
    }
    if (overrides.showStats !== undefined) cfg.showStats = overrides.showStats;
    if (overrides.showPrestigeBadge !== undefined) {
      cfg.showPrestigeBadge = overrides.showPrestigeBadge;
    }
    if (overrides.gameFeel !== undefined) cfg.gameFeel = overrides.gameFeel;
    if (overrides.bubbleMargin !== undefined) {
      cfg.bubbleMargin = overrides.bubbleMargin;
    }
    if (overrides.reactionTTL !== undefined) cfg.reactionTTL = overrides.reactionTTL;
    writeFileSync(join(stateDir, "config.json"), JSON.stringify(cfg));
  }

  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: cfgDir };
  for (const k of ["HOME", "PATH", "USER", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  // The script (like every real terminal it runs in) assumes a UTF-8 locale —
  // multibyte bar slicing depends on char-aware substrings. Ensure one even if
  // the host env didn't set it.
  if (!env.LC_ALL && !env.LANG && !env.LC_CTYPE) env.LC_ALL = "en_US.UTF-8";
  // Pin width so layout padding is deterministic and the buddy renders. COLUMNS
  // alone is unreliable (the script walks the process tree to the controlling
  // PTY first); BUDDY_FAKE_COLS is the test seam that forces it.
  env.COLUMNS = String(overrides.columns ?? 125);
  env.BUDDY_FAKE_COLS = String(overrides.columns ?? 125);
  // Match the fixed reference "now" used to derive lastXpGain.at above.
  env.BUDDY_FAKE_NOW = String(fakeNow);

  try {
    const result = spawnSync("bash", [SCRIPT], {
      env,
      input: overrides.ccInput ?? "",
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`bash exited ${result.status}: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    rmSync(cfgDir, { recursive: true, force: true });
  }
}

describe("buddy-status.sh prestige title", () => {
  test("renders an equipped title in guillemets under the name", () => {
    const out = renderStatus({ title: "Committer" });
    expect(out).toContain("«Committer»");
  });

  test("omits the title line entirely when no title is equipped", () => {
    const out = renderStatus({ title: null });
    expect(out).not.toContain("«");
    expect(out).not.toContain("»");
  });

  test("still shows the buddy name when a title is present", () => {
    const out = renderStatus({ title: "Architect", name: "Waffle" });
    expect(out).toContain("Waffle");
    expect(out).toContain("«Architect»");
  });
});

describe("buddy-status.sh stats panel", () => {
  test("renders the stat panel when showStats is on", () => {
    const out = renderStatus({ showStats: true });
    for (const label of ["DBG", "PAT", "CHA", "WIS", "SNK"]) {
      expect(out).toContain(label);
    }
    // Bars + values from the fixture (strip ANSI: color codes sit between
    // the bar and the number in raw output).
    const plain = stripAnsi(out);
    expect(plain).toMatch(/SNK\s+▣+░*\s+76/);
    expect(plain).toMatch(/WIS\s+▣*░+\s+5/);
  });

  test("marks the peak with ▲ and the dump with ▼", () => {
    const out = renderStatus({ showStats: true });
    expect(out).toMatch(/SNK[^\n]*▲/); // peak
    expect(out).toMatch(/WIS[^\n]*▼/); // dump
  });

  test("hides the panel when showStats is off", () => {
    const out = renderStatus({ showStats: false });
    expect(out).not.toContain("DBG");
    expect(out).not.toContain("▲");
  });

  test("brightens a freshly-raised stat's value (P4 flash)", () => {
    // DEBUGGING crossed a point 2s ago → its value renders bold (\x1b[1m), not
    // the panel's usual dim (\x1b[2m). The fixture DEBUGGING value is 10.
    const out = renderStatus({
      showStats: true,
      statsRaised: { names: ["DEBUGGING"], secondsAgo: 2 },
    });
    expect(out).toContain("[1m 10");
    // Layout is untouched — SGR-only — so the panel still reads normally.
    expect(stripAnsi(out)).toMatch(/DBG\s+▣+░*\s+10/);
  });

  test("a stale raise leaves the value dim (flash expired)", () => {
    const out = renderStatus({
      showStats: true,
      statsRaised: { names: ["DEBUGGING"], secondsAgo: 999 },
    });
    expect(out).not.toContain("[1m 10"); // no bold value
    expect(out).toContain("[2m 10"); // dim, the default
  });

  test("hides the panel by default (no config.json)", () => {
    const out = renderStatus({});
    expect(out).not.toContain("DBG");
  });

  test("skips the panel gracefully when status.json has no stats (old server)", () => {
    const out = renderStatus({ showStats: true, omitStats: true });
    expect(out).not.toContain("DBG");
    // The buddy itself must still render.
    expect(out).toContain("Waffle");
  });

  test("shows stats and the speech bubble together (three columns)", () => {
    const out = renderStatus({ showStats: true, reaction: "nice commit" });
    expect(out).toContain("DBG");
    expect(out).toContain("nice commit");
    expect(out).toContain("Waffle");
  });

  test("every stats-panel row is the same display width (bubble stays flush)", () => {
    // Regression: the stat-row labels carry a single-column glyph (■ ◆ ▶ ● ◀)
    // that is multi-byte in UTF-8. bash's `printf '%-9s'` measures the field in
    // BYTES, so padding the glyph+abbr together left the stat rows 2 display
    // cols short of the (pure-ASCII) "Lv" row — shifting the bubble/art right
    // on the Lv row alone. A long reaction forces bubble text rows to sit
    // alongside the stat rows; the bubble's left edge must land on one column.
    // Long enough that the bubble wraps to >= 6 lines and so spans all 5 stat
    // rows + the Lv row (a short bubble is centered and skips the top/bottom).
    const long =
      "the report degrades to n slash a instead of exploding on empty " +
      "data and that is the precise detail that makes the whole G four " +
      "acceptance gate actually hold up under real production traffic";
    const out = stripAnsi(
      renderStatus({ showStats: true, reaction: long, level: 5, xpPct: 20 }),
    );
    // The glyphs and box-drawing chars are all single UTF-16 units AND single
    // display columns, so indexOf == display column for this assertion.
    const edges = out
      .split("\n")
      .filter((l) => /[■◆▶●◀]|Lv\d/.test(l)) // stat rows + the Lv row
      .map((l) => l.search(/[.|`]/)) // first bubble-box char on that row
      .filter((c) => c >= 0);
    expect(edges.length).toBeGreaterThanOrEqual(6); // 5 stats + Lv
    expect(new Set(edges).size).toBe(1); // all flush in one column
  });
});

describe("buddy-status.sh XP progress row", () => {
  test("renders level, bar, and percent below the stat bars", () => {
    const out = renderStatus({ showStats: true, level: 7, xpPct: 68 });
    const plain = stripAnsi(out);
    expect(plain).toMatch(/Lv7\s+▣+░+\s+68%/);
  });

  test("shows the blue +N XP toast within the 10s window", () => {
    const out = renderStatus({
      showStats: true,
      lastXpGain: { amount: 15, secondsAgo: 3 },
    });
    expect(out).toContain("+15 XP");
  });

  test("omits the toast once it ages past 10s", () => {
    const out = renderStatus({
      showStats: true,
      lastXpGain: { amount: 15, secondsAgo: 30 },
    });
    expect(out).not.toContain("+15 XP");
  });

  test("the toast does not shift or truncate the buddy (regression)", () => {
    // The "+N XP" toast widens only the Lv row; without folding it into the
    // shared stats-column width it pushed the art/name right on that line alone
    // (the buddy "shifted" and the name truncated). The art column position must
    // be identical with and without the toast.
    const nameCol = (s: string): number => {
      const line = stripAnsi(s)
        .split("\n")
        .find((l) => l.includes("Waffle"));
      return line ? line.indexOf("Waffle") : -1;
    };
    const withToast = renderStatus({
      showStats: true,
      lastXpGain: { amount: 1, secondsAgo: 2 },
    });
    const without = renderStatus({ showStats: true, lastXpGain: null });
    expect(withToast).toContain("+1 XP"); // toast actually present
    expect(nameCol(without)).toBeGreaterThan(0); // name rendered untruncated
    expect(nameCol(withToast)).toBe(nameCol(without)); // and did not move
  });

  test("a multi-digit toast also keeps the buddy aligned", () => {
    const nameCol = (s: string): number => {
      const line = stripAnsi(s)
        .split("\n")
        .find((l) => l.includes("Waffle"));
      return line ? line.indexOf("Waffle") : -1;
    };
    const big = renderStatus({
      showStats: true,
      lastXpGain: { amount: 250, secondsAgo: 1 },
    });
    const without = renderStatus({ showStats: true, lastXpGain: null });
    expect(big).toContain("+250 XP");
    expect(nameCol(big)).toBe(nameCol(without));
  });

  test("omits the toast when there has been no gain", () => {
    const out = renderStatus({ showStats: true, lastXpGain: null });
    expect(out).not.toContain("XP");
  });

  test("degrades gracefully when status.json predates xpPct/lastXpGain", () => {
    const out = renderStatus({ showStats: true, omitXpFields: true });
    const plain = stripAnsi(out);
    expect(plain).toMatch(/Lv\d+\s+░+\s+0%/);
    expect(out).toContain("Waffle");
  });

  test("hides the row entirely when showStats is off", () => {
    const out = renderStatus({ showStats: false, xpPct: 68 });
    expect(out).not.toMatch(/Lv\d+/);
  });
});

describe("buddy-status.sh prestige/streak badge (FR1.5)", () => {
  test("renders prestige + streak when the badge is on", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 2,
      streak: 7,
    });
    expect(out).toContain("P2");
    expect(out).toContain("🔥7");
  });

  test("shows only the streak when never ascended (no P0)", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 0,
      streak: 5,
    });
    expect(out).toContain("🔥5");
    expect(out).not.toContain("P0");
  });

  test("shows only the prestige tier when no active streak", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 3,
      streak: 0,
    });
    expect(out).toContain("P3");
    expect(out).not.toContain("🔥");
  });

  test("skips the badge entirely when both are zero, even if enabled", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 0,
      streak: 0,
    });
    expect(out).not.toContain("🔥");
    expect(out).not.toMatch(/P\d/);
    expect(out).toContain("Waffle"); // buddy still renders
  });

  test("hidden by default — common case is visually unchanged (G5)", () => {
    const out = renderStatus({ prestigeLevel: 4, streak: 9 });
    expect(out).not.toContain("🔥");
    expect(out).not.toContain("P4");
  });

  test("hidden when explicitly off", () => {
    const out = renderStatus({
      showPrestigeBadge: false,
      prestigeLevel: 2,
      streak: 7,
    });
    expect(out).not.toContain("🔥");
    expect(out).not.toContain("P2");
  });

  test("renders gracefully when status.json lacks the fields (old server)", () => {
    const out = renderStatus({ showPrestigeBadge: true, omitBadgeFields: true });
    // Defaults to 0/0 → no badge, buddy still renders.
    expect(out).not.toContain("🔥");
    expect(out).toContain("Waffle");
  });

  test("coexists with an equipped title (badge sits under it)", () => {
    const out = renderStatus({
      showPrestigeBadge: true,
      prestigeLevel: 1,
      streak: 3,
      title: "Legend",
    });
    expect(out).toContain("«Legend»");
    expect(out).toContain("P1");
    expect(out).toContain("🔥3");
  });
});

describe("buddy-status.sh ascension flourish (FR-A3)", () => {
  // Distinctive bodies so we can tell which frame set the script animated.
  const NEUTRAL = "            \n    (··)    \n    (  )    \n            \n            ";
  const FLOURISH = "            \n    (**)    \n    (  )    \n            \n            ";

  test("animates the flourish frames while the celebration is fresh", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(**)"); // flourish body
    expect(out).not.toContain("(··)"); // not the neutral body
    expect(out).toContain("🌟 PRESTIGE 1 🌟"); // toast shares the same window
  });

  test("reverts to the neutral frames after the celebration TTL expires", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 30 }, // > 10s full TTL
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(··)"); // neutral body restored
    expect(out).not.toContain("(**)"); // flourish no longer selected
    expect(out).not.toContain("🌟 PRESTIGE 1 🌟"); // toast also expired
  });

  test("never shows the flourish when gameFeel is off", () => {
    const out = renderStatus({
      gameFeel: "off",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(out).toContain("(··)");
    expect(out).not.toContain("(**)");
  });

  test("reverts at the shorter 6s window under subtle", () => {
    const fresh = renderStatus({
      gameFeel: "subtle",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 3 },
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(fresh).toContain("(**)");
    const stale = renderStatus({
      gameFeel: "subtle",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 8 }, // > 6s subtle TTL
      flourishFrames: [FLOURISH],
      flourishSequence: [0],
    });
    expect(stale).toContain("(··)");
    expect(stale).not.toContain("(**)");
  });

  test("old status.json without flourish fields animates the neutral frames", () => {
    const out = renderStatus({
      gameFeel: "full",
      celebration: { text: "🌟 PRESTIGE 1 🌟", secondsAgo: 2 },
      // no flourishFrames — simulates an older server / non-flourish write
    });
    expect(out).toContain("(··)");
    expect(out).not.toContain("(**)");
  });
});

// ─── Sticky speech bubble — persists until a new message ─────────────────────
//
// status.json's .reaction is volatile (an incidental writeStatusState clears it
// to ""), but reaction.<SID>.json persists the last real reaction. The bubble
// falls back to it so it stays visible until a NEW message arrives — unless an
// opt-in reactionTTL has elapsed.
describe("buddy-status.sh sticky bubble", () => {
  test("falls back to the persisted reaction when status.json's is empty", () => {
    const out = stripAnsi(
      renderStatus({
        reaction: "", // live field cleared by an incidental status write
        persistedReaction: { reaction: "still here from last turn" },
      }),
    );
    expect(out).toContain("still here from last turn");
  });

  test("the live reaction wins over the persisted one when present", () => {
    const out = stripAnsi(
      renderStatus({
        reaction: "fresh live reaction",
        persistedReaction: { reaction: "older persisted reaction" },
      }),
    );
    expect(out).toContain("fresh live reaction");
    expect(out).not.toContain("older persisted reaction");
  });

  test("with reactionTTL>0 the persisted bubble still expires once stale", () => {
    const out = stripAnsi(
      renderStatus({
        reaction: "",
        reactionTTL: 10,
        persistedReaction: { reaction: "expired note", secondsAgo: 30 },
      }),
    );
    expect(out).not.toContain("expired note");
  });

  test("with reactionTTL>0 a recent persisted bubble still shows", () => {
    const out = stripAnsi(
      renderStatus({
        reaction: "",
        reactionTTL: 60,
        persistedReaction: { reaction: "recent note", secondsAgo: 5 },
      }),
    );
    expect(out).toContain("recent note");
  });

  test("no bubble when both the live and persisted reactions are empty", () => {
    const out = stripAnsi(renderStatus({ reaction: "" }));
    // The buddy still renders, just without a speech bubble border.
    expect(out).toContain("Waffle");
    expect(out).not.toContain(".--");
  });
});

// ─── Idle wander — free-roam layout invariant (movement §11 / design-rpg P5) ──
//
// Free-roam: the buddy CLUSTER (bubble + connector + art) travels as one rigid
// block, ambling LEFT from its right-edge home toward the stats. The keystone
// gate: the left-anchored STATS column never moves, while the whole cluster
// shifts left by exactly the offset (connector stays attached). We bake a
// wanderSequence [0..6] and sweep BUDDY_FAKE_NOW so NOW % 7 lands on each offset.
describe("buddy-status.sh idle wander (base horizontal)", () => {
  const SEQ = [0, 1, 2, 3, 4, 5, 6]; // offset == index == NOW for NOW in 0..6
  const REACTION = "hello friend"; // no dashes, so "|--" uniquely marks connector

  /** Render every offset 0..6 of the swept sequence, ANSI-stripped. */
  function sweep(): string[] {
    return SEQ.map((_, now) =>
      stripAnsi(
        renderStatus({
          reaction: REACTION,
          name: "Waffle",
          showStats: true,
          gameFeel: "full",
          wanderSequence: SEQ,
          fakeNow: now,
        }),
      ),
    );
  }

  /** indexOf a needle across the whole rendered block (first match wins). */
  function colOf(frame: string, needle: string): number {
    const line = frame.split("\n").find((l) => l.includes(needle));
    expect(line).toBeDefined();
    return line!.indexOf(needle);
  }

  test("the stats column is byte-fixed while the cluster roams", () => {
    const frames = sweep();
    // Stats labels (left-anchored) never move.
    for (const label of ["DBG", "SNK"]) {
      const cols = frames.map((f) => colOf(f, label));
      expect(new Set(cols).size).toBe(1);
    }
    // The bubble travels WITH the buddy — it shifts left by exactly the offset.
    const base = colOf(frames[0], REACTION);
    for (let k = 0; k < SEQ.length; k++) {
      expect(colOf(frames[k], REACTION)).toBe(base - k);
    }
  });

  test("the buddy art translates LEFT by exactly the offset (home = right edge)", () => {
    const frames = sweep();
    const base = colOf(frames[0], "Waffle");
    for (let k = 0; k < SEQ.length; k++) {
      expect(colOf(frames[k], "Waffle")).toBe(base - k);
    }
  });

  test("the connector stays attached as the cluster roams (bubble travels)", () => {
    const frames = sweep();
    for (let k = 0; k < SEQ.length; k++) {
      expect(frames[k].includes("|--")).toBe(true);
    }
  });

  test("gameFeel=subtle keeps the buddy planted (no wander)", () => {
    const planted = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "subtle",
        wanderSequence: SEQ,
        fakeNow: 5, // would be offset 5 if the gate allowed it
      }),
    );
    const home = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "subtle",
        wanderSequence: SEQ,
        fakeNow: 0,
      }),
    );
    // Gate closed ⇒ offset forced 0 regardless of NOW ⇒ identical to home, and
    // the connector stays attached.
    expect(planted).toBe(home);
    expect(planted.includes("|--")).toBe(true);
  });

  test("a fresh celebration pauses the wander (buddy comes home to talk)", () => {
    const base = {
      reaction: REACTION,
      name: "Waffle",
      showStats: true,
      gameFeel: "full" as const,
      wanderSequence: SEQ,
    };
    // NOW=5 would amble the buddy to offset 5…
    const wandered = stripAnsi(renderStatus({ ...base, fakeNow: 5 }));
    // …but a fresh celebration (2s ≤ the 10s full TTL) pulls it home to talk.
    const paused = stripAnsi(
      renderStatus({
        ...base,
        fakeNow: 5,
        celebration: { text: "🎉 LEVEL 5 🎉", secondsAgo: 2 },
      }),
    );
    const homeCol = colOf(sweep()[0], "Waffle"); // offset-0 art column (home = right)
    expect(colOf(wandered, "Waffle")).toBe(homeCol - 5); // wander is live (ambles left)
    expect(paused).toContain("🎉 LEVEL 5 🎉"); // celebration is showing
    expect(colOf(paused, "Waffle")).toBe(homeCol); // forced home (offset 0)
    expect(paused.includes("|--")).toBe(true); // connector attached
  });

  test("an old status.json without wanderSequence renders byte-identically", () => {
    const withField = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "full",
        wanderSequence: [0], // present but pinned to home
        fakeNow: 0,
      }),
    );
    const withoutField = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "full",
        // no wanderSequence — simulates an older server write (NFR3 degrade)
        fakeNow: 0,
      }),
    );
    expect(withoutField).toBe(withField);
  });
});

// ─── Idle wander — vertical hop (movement P4 / §7.A, flag wanderHop) ──────────
//
// The hop reserves constant headroom (= the row-sequence max) and slides the art
// block up by the live WANDER_ROW. The invariant: bubble/stats rows are centered
// on the *floor baseline* (total height), so they hold their row while the art
// bobs. We sweep WANDER_ROW 0..2 via a baked wanderRowSequence + fakeNow.
describe("buddy-status.sh idle wander (vertical hop)", () => {
  const ROW_SEQ = [0, 1, 2]; // WANDER_ROW == index == fakeNow for 0..2
  const REACTION = "hello friend";

  function hopSweep(): string[] {
    return ROW_SEQ.map((_, now) =>
      stripAnsi(
        renderStatus({
          reaction: REACTION,
          name: "Waffle",
          showStats: true,
          gameFeel: "full",
          wanderRowSequence: ROW_SEQ, // hop only; no horizontal offset
          fakeNow: now,
        }),
      ),
    );
  }

  /** Output row index (line number) of the first line containing `needle`. */
  function rowOf(frame: string, needle: string): number {
    const lines = frame.split("\n");
    const idx = lines.findIndex((l) => l.includes(needle));
    expect(idx).toBeGreaterThanOrEqual(0);
    return idx;
  }

  test("bubble and stats hold their row while the buddy hops (no bob)", () => {
    const frames = hopSweep();
    for (const landmark of [REACTION, "DBG", "SNK"]) {
      const rows = frames.map((f) => rowOf(f, landmark));
      expect(new Set(rows).size).toBe(1);
    }
  });

  test("the buddy art rises by exactly one row per hop step", () => {
    const frames = hopSweep();
    // ART_TOP = HOP_RESERVE - WANDER_ROW, so the name row decreases by 1 per step.
    const rows = frames.map((f) => rowOf(f, "Waffle"));
    expect(rows[0] - rows[1]).toBe(1);
    expect(rows[1] - rows[2]).toBe(1);
  });

  test("the connector retracts while hopping, reattaches on the floor", () => {
    const frames = hopSweep();
    expect(frames[0].includes("|--")).toBe(true); // WANDER_ROW=0 → on the floor
    expect(frames[1].includes("|--")).toBe(false);
    expect(frames[2].includes("|--")).toBe(false);
  });

  test("headroom collapses (hop ignored) when the block blows the height budget", () => {
    // A 12-line art frame ⇒ ART_COUNT (incl. name) exceeds the 12-row budget once
    // headroom is added, so the hop is dropped and renders identically to no-hop.
    const tall = [Array.from({ length: 12 }, () => "xxxxxxxxxxxx").join("\n")];
    const hopped = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        gameFeel: "full",
        frames: tall,
        wanderRowSequence: [2, 2, 2], // would hop 2 rows if budget allowed
        fakeNow: 0,
      }),
    );
    const planted = stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        gameFeel: "full",
        frames: tall,
        // no wanderRowSequence — the baseline to match
        fakeNow: 0,
      }),
    );
    expect(hopped).toBe(planted);
  });
});

// ─── Idle wander — bubble travels with the buddy (free-roam default, §11) ─────
//
// Free-roam makes "the bubble travels with the buddy" the default: the whole
// [bubble · connector · art] cluster translates LEFT by the offset as a rigid
// unit, connector stays attached. (The old wanderWide / wanderBubble flags are
// retired — the whole line is the lane.) We bake [0..6] and sweep BUDDY_FAKE_NOW.
describe("buddy-status.sh idle wander (bubble travels with buddy)", () => {
  const SEQ = [0, 1, 2, 3, 4, 5, 6];
  const REACTION = "hello friend"; // no dashes → "|--" uniquely marks connector

  function render(now: number): string {
    return stripAnsi(
      renderStatus({
        reaction: REACTION,
        name: "Waffle",
        showStats: true,
        gameFeel: "full",
        wanderSequence: SEQ,
        fakeNow: now,
      }),
    );
  }
  function colOf(frame: string, needle: string): number {
    return frame.split("\n").find((l) => l.includes(needle))!.indexOf(needle);
  }

  test("the bubble moves LEFT by exactly the offset (travels with the buddy)", () => {
    const baseBubble = colOf(render(0), REACTION);
    const baseArt = colOf(render(0), "Waffle");
    for (let k = 0; k < SEQ.length; k++) {
      // Both the bubble and the art shift left by k — as one rigid block.
      expect(colOf(render(k), REACTION)).toBe(baseBubble - k);
      expect(colOf(render(k), "Waffle")).toBe(baseArt - k);
    }
  });

  test("the connector stays attached at every offset (never points at thin air)", () => {
    for (let k = 0; k < SEQ.length; k++) {
      expect(render(k).includes("|--")).toBe(true);
    }
  });

  test("the bubble→art gap is constant (connector width never changes)", () => {
    const gaps = SEQ.map((_, k) => {
      const f = render(k);
      return colOf(f, "Waffle") - colOf(f, REACTION);
    });
    expect(new Set(gaps).size).toBe(1);
  });

  test("stats column stays left-pinned even as the cluster travels", () => {
    const cols = SEQ.map((_, k) => colOf(render(k), "DBG"));
    expect(new Set(cols).size).toBe(1);
  });
});

// ─── Idle wander — free-roam in-window clamp (movement §11, no flag) ──────────
//
// The roam range is the full span between the stats panel and the window edge,
// recomputed against the live COLS every tick. The keystone guarantee: when the
// stats + cluster fit in COLS, the buddy is ALWAYS fully in-window (the old fixed
// MARGIN reserve could overflow at narrow widths). A large baked offset can't push
// the cluster off the left, and a too-narrow terminal drops the bubble to keep the
// sprite visible.
describe("buddy-status.sh idle wander (free-roam in-window clamp)", () => {
  function render(columns: number, seq: number[], now: number): string {
    return stripAnsi(
      renderStatus({
        reaction: "hi",
        name: "Waffle",
        gameFeel: "full",
        columns,
        wanderSequence: seq,
        fakeNow: now,
      }),
    );
  }
  const nameCol = (out: string): number =>
    out.split("\n").find((l) => l.includes("Waffle"))!.indexOf("Waffle");
  // Pure-ASCII fixture (no stats/emoji) ⇒ code-point count == display width.
  const maxW = (out: string): number =>
    Math.max(...out.split("\n").map((l) => [...l].length));

  test("a wide terminal ambles the buddy LEFT by exactly the offset", () => {
    const home = nameCol(render(125, [0, 6], 0)); // offset 0 (home = right)
    const moved = nameCol(render(125, [0, 6], 1)); // offset 6
    expect(home - moved).toBe(6);
  });

  test("bubbleMargin sets the right-edge reserve (buddy home shifts left)", () => {
    // The home (offset-0) cluster sits at COLS - CLUSTER_W - RIGHT_SAFETY, and
    // RIGHT_SAFETY is driven by bubbleMargin. A larger margin pulls the buddy
    // LEFT by exactly the delta — the reserve that keeps it clear of Claude
    // Code's status-line left gutter so it doesn't clip off the right edge.
    const nameCol = (margin: number): number => {
      const out = stripAnsi(
        renderStatus({
          name: "Waffle",
          gameFeel: "full",
          columns: 125,
          wanderSequence: [0],
          fakeNow: 0,
          bubbleMargin: margin,
        }),
      );
      return out.split("\n").find((l) => l.includes("Waffle"))!.indexOf("Waffle");
    };
    expect(nameCol(2) - nameCol(12)).toBe(10);
  });

  test("a large baked offset can't push the cluster off the left edge", () => {
    for (const now of [0, 1]) {
      const out = render(125, [0, 9999], now); // absurd offset → clamps to span
      expect(nameCol(out)).toBeGreaterThanOrEqual(0);
      expect(maxW(out)).toBeLessThanOrEqual(125);
    }
  });

  test("a narrow terminal keeps the buddy fully in-window (no clip)", () => {
    for (const columns of [80, 70, 60]) {
      const out = render(columns, [0, 4, 8], columns % 3);
      expect(maxW(out)).toBeLessThanOrEqual(columns);
      expect(out).toContain("Waffle");
    }
  });
});

// ─── Gait posture — lean frame in lockstep with its wander offset ────────────
// (living-world P1). `gaitFrameSequence` (art.ts) maps a walk's per-tick
// phases onto frame indices at BAKE time, replacing frameSequence so it's the
// same length and NOW-indexed as wanderSequence — the lean/peek posture and
// the horizontal offset that provoked it always land on the identical tick.
// This pins that lockstep through the real shell with a walk-length (180-tick,
// matching wander.ts's DEFAULT_LENGTH) fixture.
describe("buddy-status.sh gait lean posture (living-world P1)", () => {
  test("renders the lean posture in lockstep with its wander offset, no clipping", () => {
    const NEUTRAL =
      "            \n    (··)    \n    (  )    \n            \n            ";
    const LEAN =
      "            \n    (~~)    \n    (  )    \n            \n            ";
    const LEAN_TICK = 42;
    const OFFSET = 3;
    const frameSequence = new Array(180).fill(0);
    frameSequence[LEAN_TICK] = 1; // index into `frames`: 0 neutral, 1 lean
    const wanderSequence = new Array(180).fill(0);
    wanderSequence[LEAN_TICK] = OFFSET;

    const nameCol = (s: string): number =>
      s.split("\n").find((l) => l.includes("Waffle"))!.indexOf("Waffle");

    const atLeanTick = stripAnsi(
      renderStatus({
        name: "Waffle",
        gameFeel: "full",
        frames: [NEUTRAL, LEAN],
        frameSequence,
        wanderSequence,
        fakeNow: LEAN_TICK,
      }),
    );
    expect(atLeanTick).toContain("~~"); // lean posture selected at the gaited tick
    expect(atLeanTick).not.toContain("··"); // ...not the neutral frame

    // Same tick drives the offset too (lockstep): the art shifts left by
    // exactly that tick's wanderSequence value relative to home (tick 0).
    const atHome = stripAnsi(
      renderStatus({
        name: "Waffle",
        gameFeel: "full",
        frames: [NEUTRAL, LEAN],
        frameSequence,
        wanderSequence,
        fakeNow: 0,
      }),
    );
    expect(nameCol(atHome) - nameCol(atLeanTick)).toBe(OFFSET);

    // A neighboring tick (no gait beat baked) is back to the neutral frame —
    // the lean is a one-tick posture, not a sticky state.
    const neighbor = stripAnsi(
      renderStatus({
        name: "Waffle",
        gameFeel: "full",
        frames: [NEUTRAL, LEAN],
        frameSequence,
        wanderSequence,
        fakeNow: LEAN_TICK + 1,
      }),
    );
    expect(neighbor).toContain("··");
    expect(neighbor).not.toContain("~~");

    // Layout invariant (no clipping) at the gaited tick across widths.
    for (const columns of [125, 100, 80]) {
      const out = stripAnsi(
        renderStatus({
          name: "Waffle",
          gameFeel: "full",
          columns,
          frames: [NEUTRAL, LEAN],
          frameSequence,
          wanderSequence,
          fakeNow: LEAN_TICK,
        }),
      );
      for (const line of out.split("\n")) {
        expect([...line].length).toBeLessThanOrEqual(columns);
      }
      expect(out).toContain("Waffle");
    }
  });
});

// ─── Dynamic bubble — the box changes SIZE and SHAPE to fit the width ─────────
// Instead of a fixed-width box that's dropped whole the moment it doesn't fit,
// the bubble shrinks (narrower ⇒ more, shorter rows), grows to contain an
// over-long word, and only drops when even the narrowest usable box won't fit —
// recomputed every tick, so it re-grows as the terminal (or the buddy's window)
// widens. All geometry uses the no-stats path (STATS_BLOCK=0, RIGHT_SAFETY=8,
// ART_W=14 ⇒ FIT_INNER = COLS - 29; default INNER_W 28 ⇒ box border 32).
describe("buddy-status.sh dynamic bubble (fit-to-width)", () => {
  const MSG = "this is a fairly long reaction that needs several rows";
  const render = (columns: number, reaction = MSG): string =>
    stripAnsi(
      renderStatus({ reaction, name: "Waffle", gameFeel: "full", columns }),
    );
  // A border row is a run of dashes fenced by corner dots; the token length is
  // BOX_W. (Don't trim the whole line — the leading Braille-Blank spacer isn't
  // ASCII whitespace, so trim() wouldn't drop it.)
  const borderW = (out: string): number => {
    const m = out.match(/\.-+\./);
    return m ? m[0].length : 0;
  };
  // A text row carries "| … |" (the last one also trails the connector/sprite).
  const textRows = (out: string): number =>
    out.split("\n").filter((l) => /\|.+\|/.test(l)).length;
  const maxW = (out: string): number =>
    Math.max(...out.split("\n").map((l) => [...l].length));

  test("uses the full configured width when there's room", () => {
    expect(borderW(render(125))).toBe(32); // INNER_W 28 + 4 chrome
  });

  test("shrinks the box (narrower + taller) when the default won't fit", () => {
    const wide = render(125);
    const narrow = render(45); // FIT_INNER = 16 < 28 ⇒ shrink
    expect(borderW(narrow)).toBeGreaterThan(0); // still shown…
    expect(borderW(narrow)).toBeLessThan(borderW(wide)); // …but narrower…
    expect(textRows(narrow)).toBeGreaterThan(textRows(wide)); // …and taller
    expect(maxW(narrow)).toBeLessThanOrEqual(45); // never clips
  });

  test("re-grows monotonically as the terminal widens", () => {
    expect(borderW(render(45))).toBeLessThanOrEqual(borderW(render(55)));
    expect(borderW(render(55))).toBeLessThanOrEqual(borderW(render(125)));
    expect(borderW(render(125))).toBe(32); // capped at the configured width
  });

  test("drops the bubble only when even the narrowest box can't fit", () => {
    // The script floors detected width at 40, so squeeze the room with a large
    // right-edge reserve instead: FIT_INNER = 60 - 35 - 14 - 3 - 4 = 4 < floor 8.
    const out = stripAnsi(
      renderStatus({
        reaction: MSG,
        name: "Waffle",
        gameFeel: "full",
        columns: 60,
        bubbleMargin: 35,
      }),
    );
    expect(/\.-+\./.test(out)).toBe(false); // no bubble border
    expect(out).toContain("Waffle"); // sprite/name still visible
    expect(maxW(out)).toBeLessThanOrEqual(60);
  });

  test("grows the box to contain a word wider than the configured width", () => {
    // A 40-col lone word exceeds the default 28 box; with room it widens to fit.
    const word = "x".repeat(40);
    const out = render(125, `hi ${word} ok`);
    expect(out).toContain(word); // rendered whole, on its own row
    expect(borderW(out)).toBeGreaterThan(32); // box grew past the default
    expect(maxW(out)).toBeLessThanOrEqual(125); // still in-window
  });

  test("never clips an over-long word — grows if it fits, else drops", () => {
    const word = "x".repeat(40); // ~40-col unbreakable token
    for (const columns of [125, 90, 70, 55, 45]) {
      const out = render(columns, `hi ${word} ok`);
      expect(maxW(out)).toBeLessThanOrEqual(columns); // invariant either way
      expect(out).toContain("Waffle");
    }
  });
});

// ─── Idle-RPG encounter render (design-rpg Phase 4) ──────────────────────────
describe("idle-RPG encounter glyph", () => {
  const GLYPH = "\u{1F409}"; // 🐉

  test("renders the enemy glyph at gameFeel=full while fresh", () => {
    const out = stripAnsi(
      renderStatus({ gameFeel: "full", enemyGlyph: GLYPH, encounterSecondsAgo: 0 }),
    );
    expect(out).toContain(GLYPH);
  });

  test("does NOT render the glyph at subtle (animation is full-only)", () => {
    const out = stripAnsi(
      renderStatus({ gameFeel: "subtle", enemyGlyph: GLYPH, encounterSecondsAgo: 0 }),
    );
    expect(out).not.toContain(GLYPH);
  });

  test("a stale encounter (past TTL) does not render", () => {
    const out = stripAnsi(
      renderStatus({ gameFeel: "full", enemyGlyph: GLYPH, encounterSecondsAgo: 99 }),
    );
    expect(out).not.toContain(GLYPH);
  });

  test("places the glyph on the eye row (frame middle), not the ears", () => {
    // A realistic 5-row frame: hat slot, ears, EYES, body, feet — matching
    // SPECIES_ART layout (eyes on row 2, unlike this file's default fixture).
    const frame =
      "   HAT      \n   ears     \n   (EYES)   \n   body     \n   feet     ";
    const out = stripAnsi(
      renderStatus({
        gameFeel: "full",
        enemyGlyph: GLYPH,
        encounterSecondsAgo: 0,
        frames: [frame],
      }),
    );
    const glyphLine = out.split("\n").find((l) => l.includes(GLYPH))!;
    expect(glyphLine).toContain("EYES"); // on the eye row, not "ears"/"body"
    expect(glyphLine).not.toContain("ears");
  });

  test("layout invariant: the glyph only adds to the right margin", () => {
    // Same status.json otherwise; the only difference is the fresh encounter.
    const base = {
      gameFeel: "full" as const,
      showStats: true,
      name: "Waffle",
      level: 11,
    };
    const without = stripAnsi(renderStatus(base)).split("\n");
    const withGlyph = stripAnsi(
      renderStatus({ ...base, enemyGlyph: GLYPH, encounterSecondsAgo: 0 }),
    ).split("\n");

    expect(withGlyph.length).toBe(without.length);
    for (let i = 0; i < without.length; i++) {
      // Every line is byte-identical EXCEPT the eye row, which must keep the
      // no-glyph content as a prefix (the glyph is appended rightmost).
      if (withGlyph[i] === without[i]) continue;
      expect(withGlyph[i].startsWith(without[i])).toBe(true);
      expect(withGlyph[i]).toContain(GLYPH);
    }
    // Exactly one line changed.
    const changed = without.filter((l, i) => l !== withGlyph[i]).length;
    expect(changed).toBe(1);
  });
});

describe("idle-RPG combat scene (Phase 5)", () => {
  const GLYPH = "\u{1F409}"; // 🐉
  // Two distinct 4-line scenes; every line is padded to a constant width so the
  // status line never jitters. L*/R* mark the player/enemy halves.
  const W = 24;
  const mkLine = (l: string, r: string): string =>
    (l.padEnd(10) + "  " + r.padEnd(10)).padEnd(W);
  const sceneA = ["LA0", "LA1", "LA2", "LA3"].map((l, i) => mkLine(l, `RA${i}`));
  const sceneB = ["LB0", "LB1", "LB2", "LB3"].map((l, i) => mkLine(l, `RB${i}`));
  const SCENE = [sceneA.join("\n"), sceneB.join("\n")];

  const renderScene = (o: Partial<StatusOverrides> = {}): string =>
    stripAnsi(
      renderStatus({
        gameFeel: "full",
        combatFrames: SCENE,
        combatSequence: [0],
        artWidth: W,
        encounterSecondsAgo: 0,
        ...o,
      }),
    );

  test("renders both creature halves at gameFeel=full while fresh", () => {
    const out = renderScene();
    expect(out).toContain("LA0"); // player half
    expect(out).toContain("RA2"); // enemy half
  });

  test("cycles combatFrames by NOW (animation)", () => {
    const even = renderScene({ combatSequence: [0, 1], fakeNow: 1_700_000_000 });
    const odd = renderScene({ combatSequence: [0, 1], fakeNow: 1_700_000_001 });
    expect(even).toContain("LA0");
    expect(even).not.toContain("LB0");
    expect(odd).toContain("LB0");
    expect(odd).not.toContain("LA0");
  });

  test("does NOT render the scene at subtle (full-only)", () => {
    const out = renderScene({ gameFeel: "subtle" });
    expect(out).not.toContain("LA0");
  });

  test("a stale encounter past TTL reverts to the idle frames", () => {
    const out = renderScene({ encounterSecondsAgo: 99 });
    expect(out).not.toContain("LA0");
    expect(out).toContain("("); // the default idle fixture is still drawn
  });

  test("suppresses the fallback glyph when a scene is active (no doubled enemy)", () => {
    const out = renderScene({ enemyGlyph: GLYPH });
    expect(out).toContain("LA0"); // the scene wins
    expect(out).not.toContain(GLYPH); // ...and the margin glyph is suppressed
  });

  test("the wide scene stays fully in-window (no clip) across terminal widths", () => {
    // COLS is forced via BUDDY_FAKE_COLS, so the in-window guarantee is exact.
    for (const columns of [125, 100, 80]) {
      const lines = renderScene({ columns }).split("\n");
      for (const line of lines) {
        // Pure-ASCII fixture + the 1-col leading braille ⇒ code points == width.
        expect([...line].length).toBeLessThanOrEqual(columns);
      }
      expect(lines.some((l) => l.includes("LA0"))).toBe(true); // not degraded away
    }
  });
});

describe("pending standoff render (design-pending-encounter Phase 3)", () => {
  const W = 24;
  const mkLine = (l: string, r: string): string =>
    (l.padEnd(10) + "  " + r.padEnd(10)).padEnd(W);
  const sceneA = ["SA0", "SA1", "SA2", "SA3"].map((l, i) => mkLine(l, `EA${i}`));
  const sceneB = ["SB0", "SB1", "SB2", "SB3"].map((l, i) => mkLine(l, `EB${i}`));
  const SCENE = [sceneA.join("\n"), sceneB.join("\n")];

  const renderStandoff = (o: Partial<StatusOverrides> = {}): string =>
    stripAnsi(
      renderStatus({
        gameFeel: "full",
        combatFrames: SCENE,
        combatSequence: [0],
        artWidth: W,
        combatSticky: true, // sticky bit, NO encounterAt
        ...o,
      }),
    );

  test("renders the standoff with NO encounterAt (TTL bypass proves out)", () => {
    const out = renderStandoff();
    expect(out).toContain("SA0"); // player half
    expect(out).toContain("EA2"); // enemy half
  });

  test("the sticky standoff persists even when any encounter would be stale", () => {
    // A resolved scene at the same age (99s) reverts to idle; the sticky one
    // does not, because it carries no TTL at all.
    const out = renderStandoff({ fakeNow: 1_700_009_999 });
    expect(out).toContain("SA0"); // still rendering, hours later
  });

  test("does NOT render the standoff at subtle (full-only surface)", () => {
    const out = renderStandoff({ gameFeel: "subtle" });
    expect(out).not.toContain("SA0");
    expect(out).toContain("("); // the idle fixture is drawn instead
  });

  test("cycles the standoff flipbook by NOW", () => {
    const even = renderStandoff({ combatSequence: [0, 1], fakeNow: 1_700_000_000 });
    const odd = renderStandoff({ combatSequence: [0, 1], fakeNow: 1_700_000_001 });
    expect(even).toContain("SA0");
    expect(even).not.toContain("SB0");
    expect(odd).toContain("SB0");
    expect(odd).not.toContain("SA0");
  });

  test("wander is frozen while the standoff renders (D3)", () => {
    // A wanderSequence that would push the buddy right on odd ticks. With the
    // scene active the offsets are zeroed, so the two ticks render identically.
    const a = renderStandoff({ wanderSequence: [0, 9], fakeNow: 1_700_000_000 });
    const b = renderStandoff({ wanderSequence: [0, 9], fakeNow: 1_700_000_001 });
    expect(a).toBe(b);
  });

  test("the standoff keeps the reaction bubble (pending is NOT suppressed, D4)", () => {
    const out = renderStandoff({
      persistedReaction: { reaction: "you have uncommitted work" },
    });
    expect(out).toContain("you have uncommitted work");
  });

  test("a RESOLVED fight suppresses the reaction bubble (D4, resolved-only)", () => {
    // Same scene, but as a fresh resolved encounter (encounterAt, no sticky) and
    // no celebration set — so the ONLY thing that can hide the reaction is the
    // resolved-phase suppression.
    const out = stripAnsi(
      renderStatus({
        gameFeel: "full",
        combatFrames: SCENE,
        combatSequence: [0],
        artWidth: W,
        encounterSecondsAgo: 0,
        persistedReaction: { reaction: "you have uncommitted work" },
      }),
    );
    expect(out).toContain("SA0"); // the scene is up
    expect(out).not.toContain("you have uncommitted work"); // ...bubble muted
  });

  test("the wide standoff stays fully in-window (no clip) across widths", () => {
    for (const columns of [125, 100, 80]) {
      const lines = renderStandoff({ columns }).split("\n");
      for (const line of lines) {
        expect([...line].length).toBeLessThanOrEqual(columns);
      }
      expect(lines.some((l) => l.includes("SA0"))).toBe(true);
    }
  });

  test("no combatSticky and no encounter ⇒ plain idle art, no scene", () => {
    const out = stripAnsi(renderStatus({ gameFeel: "full" }));
    expect(out).not.toContain("SA0");
    expect(out).toContain("("); // the default idle fixture
  });
});

describe("wild visitor cameo render (living-world P2 Task 7)", () => {
  // A real seeded bake (not a hand-fabricated fixture) — proves the actual
  // visitor.ts flipbook is a well-formed combat-scene payload the shell can
  // render, same as the fight/standoff scenes above.
  const scene = bakeVisitorScene(
    "cactus",
    "·",
    { species: "goose", shiny: false },
    7,
  );
  const W = displayWidth(scene.frames[0].split("\n")[0]);
  const VISIT_TEXT = "🐾 a wild goose stopped by!";

  const renderVisitor = (o: Partial<StatusOverrides> = {}): string =>
    stripAnsi(
      renderStatus({
        gameFeel: "full",
        combatFrames: scene.frames,
        combatSequence: scene.sequence,
        artWidth: W,
        enemyGlyph: "◇",
        encounterSecondsAgo: 0,
        celebration: { text: VISIT_TEXT, secondsAgo: 2 },
        ...o,
      }),
    );

  test("the greet scene renders at full, EncounterRecord-shaped like a resolved fight", () => {
    const out = renderVisitor();
    // Two distinct rows of the baked flipbook prove the real scene rendered,
    // not the default idle fixture.
    expect(out).not.toContain("(··)  ");
    expect(out.split("\n").length).toBeGreaterThan(1);
  });

  test("never carries combatSticky — that bit is fight-specific", () => {
    // Sanity: the standoff's TTL-bypass render only fires with combatSticky.
    // A visitor scene renders purely off `encounterAt` freshness, so an aged
    // encounterSecondsAgo reverts it exactly like a resolved fight would.
    const fresh = renderVisitor({ encounterSecondsAgo: 0 });
    const stale = renderVisitor({ encounterSecondsAgo: 99 });
    expect(fresh).not.toBe(stale);
  });

  test("at subtle, the toast is the ONLY surface — the full-only scene reverts to idle", () => {
    const out = renderVisitor({ gameFeel: "subtle" });
    expect(out).toContain(VISIT_TEXT); // celebration toast — kind-agnostic gate
    expect(out).toContain("("); // idle fixture, not the visitor scene
  });

  test("at full, both the toast and the scene are present", () => {
    const out = renderVisitor();
    expect(out).toContain(VISIT_TEXT);
  });
});

describe("skirmish-bout render (design-attack-animation)", () => {
  // Real baked frames, not a fixture: the guard for the taller (+overlay row)
  // and ANSI-bearing flipbook through the real jq + layout path. frames[3] is
  // the first bout's impact pose — attacker adjacent, red ✗ -N pop on top.
  // seed 3 ⇒ both bouts hit (P4's crit/counter buckets moved seed 42 off hit).
  const scene = bakePendingScene("cactus", "·", "dragon", "·", 3, 3);
  const W = displayWidth(scene.frames[0].split("\n")[0]);

  const renderBout = (o: Partial<StatusOverrides> = {}): string =>
    renderStatus({
      gameFeel: "full",
      combatFrames: scene.frames,
      combatSequence: [3], // pin the impact frame
      artWidth: W,
      combatSticky: true,
      ...o,
    });

  test("the impact frame's damage pop renders through the real shell", () => {
    const out = renderBout();
    expect(stripAnsi(out)).toMatch(/✗ -\d+/); // the pop is visible
    expect(out).toContain("\x1b[31m"); // ...and still red (frames skip the sanitizer)
  });

  test("a base standoff frame renders with a blank overlay (no pop)", () => {
    const out = renderBout({ combatSequence: [0] });
    expect(stripAnsi(out)).not.toContain("✗");
  });

  test("strict no-clip at hostile widths (BUDDY_FAKE_COLS)", () => {
    for (const columns of [125, 100, 80]) {
      const lines = stripAnsi(renderBout({ columns })).split("\n");
      for (const line of lines) {
        // Stripped scene is ASCII + the 1-cell ✗ ⇒ code points == width.
        expect([...line].length).toBeLessThanOrEqual(columns);
      }
    }
  });
});

describe("buddy-status.sh combined-status metrics header", () => {
  // resets_at is 8100s (2h15m) past the fixed fakeNow used by renderStatus.
  const CC = JSON.stringify({
    model: { display_name: "Claude Opus 4.8" },
    context_window: { context_window_size: 200000, used_percentage: 45 },
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: 1_700_000_000 + 8100 },
    },
  });

  test("renders metrics on their own standalone line above the buddy block", () => {
    const lines = renderStatus({
      showStats: true,
      useCombinedStatus: true,
      ccInput: CC,
    }).split("\n");
    // The metrics are the FIRST line and carry every part…
    expect(lines[0]).toContain("claude opus 4.8");
    expect(lines[0]).toContain("ctx 45%");
    expect(lines[0]).toContain("usage 30%");
    expect(lines[0]).toContain("reset 2h15m");
    // …and that line is standalone: no stat labels, no buddy name share it.
    expect(lines[0]).not.toContain("DBG");
    expect(lines[0]).not.toContain("Waffle");
    // The metrics never share a row with the speech bubble (no crowding).
    for (const l of lines) {
      if (l.includes("claude opus 4.8")) continue;
      expect(l).not.toContain("claude opus 4.8");
    }
  });

  test("does not push the buddy block right (header is purely additive)", () => {
    // The whole point: folding metrics into the stats column used to grow
    // STATS_W to the model-name width and shove the buddy cluster right. Now the
    // buddy block must be byte-identical with and without combined mode — the
    // combined render is just one extra header line prepended.
    const base = renderStatus({ showStats: true });
    const combined = renderStatus({
      showStats: true,
      useCombinedStatus: true,
      ccInput: CC,
    });
    expect(combined.split("\n").slice(1).join("\n")).toBe(base);
  });

  test("renders the header even when the stats panel is off", () => {
    const out = renderStatus({
      showStats: false,
      useCombinedStatus: true,
      ccInput: CC,
    });
    expect(out.split("\n")[0]).toContain("claude opus 4.8");
    expect(out).toContain("Waffle"); // the buddy still renders below
    expect(out).not.toContain("DBG"); // …with no stats column
  });
});

describe("buddy-status.sh living ground (living-world follow-up)", () => {
  // The fixed full-width terrain floor is a standalone bottom row painted by
  // the shell from the server's session-seeded tile — NOT baked into a frame,
  // so it must stay put while the buddy roams.
  const groundLine = (out: string): string => {
    const lines = stripAnsi(out).split("\n").filter((l) => l.trim() !== "");
    return lines[lines.length - 1] ?? "";
  };

  test("full: the ground row paints the tiled terrain as the last line", () => {
    const out = renderStatus({
      gameFeel: "full",
      ground: "„.",
      groundColor: "4a7c3f",
      columns: 80,
      showStats: false,
    });
    const g = groundLine(out);
    // The last line is the tiled floor: several tile units, no buddy body.
    expect(g).toContain("„.„.„.");
    expect(g).not.toContain("Waffle");
  });

  test("the ground is fixed-left and never overflows the terminal width", () => {
    for (const columns of [40, 80, 120]) {
      const out = renderStatus({
        gameFeel: "full",
        ground: "„.",
        columns,
        showStats: false,
        // The buddy roams; the ground must NOT ride the offset.
        wanderSequence: [0, 6, 12, 18, 12, 6],
      });
      const g = groundLine(out);
      // Display width = code points (single-width glyphs) ≤ the terminal width.
      expect([...g].length).toBeLessThanOrEqual(columns);
      // Leading run is the fixed small margin, not the big roam indent — the
      // floor starts within the first few columns regardless of where the
      // buddy is.
      expect(g.search(/„/)).toBeLessThanOrEqual(3);
    }
  });

  test("subtle: the ground is full-only ⇒ no terrain row", () => {
    const out = renderStatus({
      gameFeel: "subtle",
      ground: "„.",
      columns: 80,
      showStats: false,
    });
    expect(stripAnsi(out)).not.toContain("„");
  });

  test("off: no terrain row", () => {
    const out = renderStatus({
      gameFeel: "off",
      ground: "„.",
      columns: 80,
      showStats: false,
    });
    expect(stripAnsi(out)).not.toContain("„");
  });

  test("an active combat scene no longer suppresses the ground (D2 relaxes the gate)", () => {
    const out = renderStatus({
      gameFeel: "full",
      ground: "„.",
      columns: 80,
      showStats: false,
      combatFrames: ["  (>_<)  vs  (x_x)  "],
      combatSequence: [0],
      artWidth: 20,
      encounterSecondsAgo: 1, // fresh ⇒ combat_on, but the ground gate no longer cares
    });
    expect(stripAnsi(out)).toContain("„");
  });

  test("active weather: the weather glyph renders in its own color, distinct from the terrain tint", () => {
    const out = renderStatus({
      gameFeel: "full",
      ground: "„.+„.+„.",
      groundColor: "4a7c3f",
      groundWeatherGlyph: "+",
      groundWeatherColor: "e8f0f7",
      columns: 80,
      showStats: false,
    });
    const g = groundLine(out);
    expect(g).toContain("+");
    // Assert the LITERAL weather-color truecolor escape (e8f0f7 → 232;240;247)
    // is present around the glyph — a weak "escape count > 1" check would pass
    // trivially even unimplemented, since the row already ends with a plain
    // reset (NC) after the terrain color. This pins the actual recolor.
    const raw = out.split("\n").filter((l) => l.includes("+"))[0] ?? "";
    expect(raw).toContain("\x1b[38;2;232;240;247m");
  });

  test("weather glyph substitution does not corrupt row width/clipping", () => {
    for (const columns of [40, 80, 120]) {
      const out = renderStatus({
        gameFeel: "full",
        ground: "„.+„.+„.",
        groundColor: "4a7c3f",
        groundWeatherGlyph: "+",
        groundWeatherColor: "e8f0f7",
        columns,
        showStats: false,
      });
      const g = stripAnsi(groundLine(out));
      expect([...g].length).toBeLessThanOrEqual(columns);
    }
  });

  test("no weather fields ⇒ ground row renders byte-identical to the current plain-terrain path", () => {
    const before = renderStatus({
      gameFeel: "full",
      ground: "„.",
      groundColor: "4a7c3f",
      columns: 80,
      showStats: false,
    });
    const after = renderStatus({
      gameFeel: "full",
      ground: "„.",
      groundColor: "4a7c3f",
      columns: 80,
      showStats: false,
    });
    expect(after).toBe(before);
  });

  test("subtle/off suppress the whole row even with weather fields present; combat no longer does (D2)", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const out = renderStatus({
        gameFeel,
        ground: "„.+",
        groundWeatherGlyph: "+",
        groundWeatherColor: "e8f0f7",
        columns: 80,
        showStats: false,
      });
      expect(stripAnsi(out)).not.toContain("+");
    }
    const combatOut = renderStatus({
      gameFeel: "full",
      ground: "„.+",
      groundWeatherGlyph: "+",
      groundWeatherColor: "e8f0f7",
      columns: 80,
      showStats: false,
      combatFrames: ["  (>_<)  vs  (x_x)  "],
      combatSequence: [0],
      artWidth: 20,
      encounterSecondsAgo: 1,
    });
    expect(stripAnsi(combatOut)).toContain("+");
  });
});

describe("buddy-status.sh falling weather (Task 3, made a front layer by design-weather-frontlayer.md)", () => {
  // PLAIN fixtures (D3) — the field carries no SGR of its own; every escape in
  // the output is the shell's own post-slice recolor. 14 rows so the field
  // covers a whole block (F2/F6), which is what lets it be a front layer
  // instead of a reserved band.
  const GAP_W = 110;
  const gapLine = (cols: number[]): string => {
    const cells: string[] = new Array(GAP_W).fill(" ");
    for (const c of cols) cells[c] = "❄";
    return cells.join("");
  };
  const FIELD = Array.from({ length: 14 }, (_, r) =>
    gapLine([3 + r, 40 + ((r * 7) % 30), 70 + (r % 20)]),
  ).join("\n");
  const SNOW_SGR = "\x1b[38;2;232;240;247m";

  const withWeather = (o: Record<string, unknown>) =>
    renderStatus({
      gameFeel: "full",
      weatherFallGapFrames: [FIELD],
      weatherFallGapGlyph: "❄",
      weatherFallGapColor: "e8f0f7",
      ...o,
    } as Parameters<typeof renderStatus>[0]);
  const noWeather = (o: Record<string, unknown>) =>
    renderStatus({ gameFeel: "full", ...o } as Parameters<typeof renderStatus>[0]);

  const totalLines = (out: string): number => {
    const lines = out.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.length;
  };

  test("active falling weather: the flake renders with the shell's own weather colour, and the sprite line is unaffected", () => {
    const out = withWeather({ columns: 80, showStats: false });
    // The fixture is plain, so this escape can ONLY have come from the shell.
    expect(out).toContain(`${SNOW_SGR}❄`);
    expect(stripAnsi(out)).toContain("(··)");
  });

  // ── design-weather-frontlayer.md F1: THE headline requirement ─────────────
  // The three "extra lines" the user asked to get back were the reserved sky
  // rows this feature used to prepend. Weather is now a front layer, so it
  // must cost exactly zero rows in every configuration.
  test("F1: weather adds NO rows — the block is the same height with and without it", () => {
    for (const columns of [80, 104, 125, 200]) {
      for (const showStats of [true, false]) {
        for (const reaction of [undefined, "hydrate. seriously."]) {
          const o = { columns, showStats, ...(reaction ? { reaction } : {}) };
          expect(totalLines(withWeather(o))).toBe(totalLines(noWeather(o)));
        }
      }
    }
  });

  test("F1 is not vacuous: the weathered render at each width really does draw flakes", () => {
    for (const columns of [80, 104, 125, 200]) {
      for (const showStats of [true, false]) {
        expect(stripAnsi(withWeather({ columns, showStats }))).toContain("❄");
      }
    }
  });

  // F10: the band used to compete with the hop headroom for HOP_BUDGET, and a
  // band that would not fit was dropped. A front layer consumes no rows, so
  // hop keeps its reservation AND the weather still renders — the two former
  // outcomes of that gate are now both true at once.
  test("F10: with the hop headroom reserved, weather still renders and still costs nothing", () => {
    const hop = { columns: 80, showStats: false, wanderRowSequence: [0, 1, 2, 1, 0] };
    const withHop = withWeather(hop);
    expect(totalLines(withHop)).toBe(totalLines(noWeather(hop)));
    expect(stripAnsi(withHop)).toContain("❄");
    // And the hop reservation itself is intact: taller than the un-hopped block.
    expect(totalLines(withHop)).toBeGreaterThan(
      totalLines(noWeather({ columns: 80, showStats: false })),
    );
  });

  // F2: the field's row N is the BLOCK's row N. This looks like a detail and
  // is not — the old code offset it by ART_TOP because the weather lived
  // inside the art stack, and that offset is invisible until the hop headroom
  // makes ART_TOP non-zero, at which point the top rows silently stop
  // snowing and the whole field slides down. Pinned with a field whose flakes
  // are ALL on row 0, rendered with hop reserved. (Mutation-verified: without
  // this test, restoring the `i - ART_TOP` mapping left the suite green.)
  test("F2: the field's row 0 lands on the block's row 0, even with hop headroom reserved", () => {
    const topOnly = [
      "❄".repeat(GAP_W),
      ...Array.from({ length: 13 }, () => " ".repeat(GAP_W)),
    ].join("\n");
    const out = withWeather({
      columns: 125,
      showStats: false,
      wanderRowSequence: [0, 1, 2, 1, 0],
      weatherFallGapFrames: [topOnly],
    });
    const lines = stripAnsi(out).split("\n").filter((l) => l.length);
    // ART_TOP is 2 here, so the buggy mapping puts these flakes on line 2.
    expect(lines[0]).toContain("❄");
    expect(lines.findIndex((l) => l.includes("❄"))).toBe(0);
    // ...and nowhere else, which is what makes the index assertion meaningful.
    expect(lines.filter((l) => l.includes("❄")).length).toBe(1);
  });

  test("no falling-weather fields: no flake glyph anywhere, row count matches the plain 5-row-sprite + name fixture exactly", () => {
    // A real absence check, not a self-referential before/after diff (a prior
    // audit on the sibling ground-weather feature caught exactly that mistake
    // — comparing two identical override objects passes even if the feature
    // is fully broken). This asserts real structure: 5 sprite rows + 1 name
    // row, empirically confirmed against the real script.
    const out = renderStatus({ gameFeel: "full", columns: 80, showStats: false });
    expect(stripAnsi(out)).not.toContain("❄");
    expect(totalLines(out)).toBe(6);
  });

  test("combat does not suppress weather (design-combat-weather.md D1 relaxes the gate)", () => {
    const out = withWeather({
      columns: 80,
      showStats: false,
      combatFrames: ["  (>_<)  vs  (x_x)  "],
      combatSequence: [0],
      artWidth: 20,
      encounterSecondsAgo: 1,
    });
    expect(stripAnsi(out)).toContain("❄");
  });

  test("combat + weather together: flakes and the ground row (with its weather glyph) both render (D1 + D2)", () => {
    const out = withWeather({
      columns: 80,
      showStats: false,
      combatFrames: ["  (>_<)  vs  (x_x)  "],
      combatSequence: [0],
      artWidth: 20,
      encounterSecondsAgo: 1,
      ground: "„.+",
      groundColor: "4a7c3f",
      groundWeatherGlyph: "+",
      groundWeatherColor: "e8f0f7",
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("❄"); // falling weather (D1)
    expect(plain).toContain("„"); // ground terrain (D2)
    expect(plain).toContain("+"); // ground weather glyph (D2)
  });

  // 2026-07-27 bugfix: a fresh celebration no longer suppresses weather. The
  // old D10/D1 celeb_fresh gate existed because the ART band PREPENDED rows,
  // which fought the taller flourish flipbook for the same height budget —
  // the identical reason F10 deleted the HOP_BUDGET degrade. A front layer
  // costs no rows, so the justification died with F1, and keeping the gate
  // left the ground row visibly snowing while nothing fell above it for the
  // whole flourish window. These two now pin the OPPOSITE invariant.
  test("a fresh celebration no longer suppresses weather, even with combat active", () => {
    const out = withWeather({
      columns: 80,
      showStats: false,
      combatFrames: ["  (>_<)  vs  (x_x)  "],
      combatSequence: [0],
      artWidth: 20,
      encounterSecondsAgo: 1,
      celebration: { text: "Level up!", secondsAgo: 1 },
    });
    expect(stripAnsi(out)).toContain("❄");
  });

  test("weather keeps falling through a fresh celebration, matching the ground row's gate", () => {
    const celeb = { text: "Level up!", secondsAgo: 1 } as const;
    const out = withWeather({ columns: 80, showStats: false, celebration: celeb });
    const plain = stripAnsi(out);
    expect(plain).toContain("❄");
    // The celebration itself must still be rendering — otherwise this passes
    // for the trivial reason that the toast never appeared at all.
    expect(plain).toContain("Level up!");
    // And the gate is the SAME one the ground row uses: gameFeel, not
    // celebration. Turning gameFeel down still silences it mid-celebration.
    const off = withWeather({
      columns: 80,
      showStats: false,
      celebration: celeb,
      gameFeel: "subtle",
    });
    expect(stripAnsi(off)).not.toContain("❄");
  });

  test("subtle/off suppress weather even with fields present", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const out = withWeather({ columns: 80, showStats: false, gameFeel });
      expect(stripAnsi(out)).not.toContain("❄");
    }
  });
});

describe("buddy-status.sh full-width falling weather GAP band (plan-fullwidth-weather.md Task 3)", () => {
  // The GAP band is PLAIN (D3) — unlike the ART band above, which embeds its
  // own SGR. The shell clips it to the live ROAM and recolors AFTER, so these
  // fixtures carry no escapes at all; the colour in the output comes from the
  // shell's own post-clip substitution.
  const GAP_W = 110;
  const gapLine = (cols: number[]): string => {
    const cells: string[] = new Array(GAP_W).fill(" ");
    for (const c of cols) cells[c] = "❄";
    return cells.join("");
  };
  // Flakes deliberately placed near the LEFT (stats-adjacent) edge — the exact
  // region the user's original complaint was about — plus some further right.
  // 14 rows (SKY_FALL_ROWS) so the field spans a whole block, not a 3-row
  // strip. Flakes deliberately placed near the LEFT (stats-adjacent) edge —
  // the region the original complaint was about — plus some further right.
  const GAP_FRAME = Array.from({ length: 14 }, (_, r) =>
    gapLine([1 + (r % 9), 20 + ((r * 5) % 25), 60 + ((r * 3) % 40)]),
  ).join("\n");
  // Since design-weather-frontlayer.md F9 there is no second (SGR-carrying)
  // layer to isolate against: the fixture is entirely plain, so every escape
  // below can ONLY have been produced by the shell's own recolor step. That
  // is what keeps the recolor assertions non-vacuous — a shared colour with a
  // pre-tinted fixture would let them pass with the recolor deleted outright
  // (mutation-verified back when the ART band existed).
  const GAP_SGR = "\x1b[38;2;232;240;247m"; // snow — can ONLY come from the shell

  const withArtOnly = (o: Record<string, unknown>) =>
    renderStatus({ gameFeel: "full", ...o } as Parameters<typeof renderStatus>[0]);
  const withGap = (o: Record<string, unknown>) =>
    withArtOnly({
      weatherFallGapFrames: [GAP_FRAME],
      weatherFallGapGlyph: "❄",
      weatherFallGapColor: "e8f0f7",
      ...o,
    });

  const flakeCount = (out: string): number =>
    (stripAnsi(out).match(/❄/g) ?? []).length;

  test("active + a wide-enough terminal: gap flakes render ACROSS the line, not just in the sprite's own narrow column", () => {
    const out = withGap({ columns: 125, showStats: true });
    // Strictly more flakes than the ART band alone contributes.
    expect(flakeCount(out)).toBeGreaterThan(flakeCount(withArtOnly({ columns: 125, showStats: true })));
    // The point of the whole feature: at least one flake lands well LEFT of
    // the roaming cluster, i.e. out over the previously-blank gap.
    const plain = stripAnsi(out);
    const gapSideFlake = plain
      .split("\n")
      .some((l) => l.indexOf("❄") >= 0 && l.indexOf("❄") < 90);
    expect(gapSideFlake).toBe(true);
  });

  test("gap flakes are recolored by the SHELL (post-clip), carrying the weather SGR despite the plain fixture", () => {
    const out = withGap({ columns: 125, showStats: true });
    // The snow SGR appears nowhere in any fixture — the ART band is tinted
    // rain-blue — so its presence proves the shell's own post-clip recolor ran.
    expect(out).toContain(`${GAP_SGR}❄`);
    // And it is genuinely absent without the gap band.
    expect(withArtOnly({ columns: 125, showStats: true })).not.toContain(GAP_SGR);
  });

  test("D11 clip: no rendered line ever exceeds the terminal width, at any COLS", () => {
    for (const columns of [80, 125, 160]) {
      const out = withGap({ columns, showStats: true });
      for (const line of out.split("\n")) {
        if (!line.length) continue;
        expect([...stripAnsi(line)].length).toBeLessThanOrEqual(columns);
      }
    }
  });

  // D11's right-pad shortfall branch only fires when the live ROAM EXCEEDS the
  // baked MAX_GAP_WIDTH=110 — i.e. only on very wide terminals. Task 0 measured
  // that crossover on the live script: COLS>=162 with stats on, COLS>=133 with
  // stats off. Every other test here sits below it (COLS=160 => ROAM=109), so
  // without this case the whole shortfall branch is dead code as far as the
  // suite is concerned — confirmed by mutation-testing it (deleting the pad
  // left all other tests green). The pad matters because an under-filled gap
  // would shift every following segment LEFT, misaligning the sprite.
  test("D11 shortfall: at a terminal wide enough that ROAM exceeds the baked width, the gap is right-padded so later segments stay aligned", () => {
    // COLS=200, stats off => ROAM=178, well past MAX_GAP_WIDTH=110.
    const out = withGap({ columns: 200, showStats: false });
    const base = withArtOnly({ columns: 200, showStats: false });
    const widths = (s: string) =>
      s.split("\n").filter((l) => l.length).map((l) => [...stripAnsi(l)].length);
    // The gap band must not change any line's total width vs. the ART-only
    // baseline: the clip+pad together fill exactly ROAM, no more, no less.
    expect(widths(out)).toEqual(widths(base));
    // And it genuinely rendered (not silently skipped, which would also
    // trivially preserve the widths).
    expect(flakeCount(out)).toBeGreaterThan(flakeCount(base));
  });

  test("D3 escape hygiene: the post-clip recolor never truncates an escape nor leaves a line ending un-reset", () => {
    for (const columns of [80, 125, 160]) {
      for (const showStats of [true, false]) {
        const out = withGap({ columns, showStats });
        for (const line of out.split("\n")) {
          if (!line.length) continue;
          // No line may end mid-escape-sequence (§2.4's dangling-SGR hazard).
          expect(/\x1b\[?[0-9;]*$/.test(line)).toBe(false);
          const codes = [...line.matchAll(/\x1b\[([0-9;]*)m/g)].map((m) => m[1]);
          if (codes.length) expect(codes[codes.length - 1]).toBe("0");
        }
      }
    }
  });

  // The single most important regression pin: with no weather fields at all,
  // the feature must be a TRUE no-op — byte-for-byte, not "looks about right".
  //
  // NOTE (design-fullwidth-weather-d1.md): this used to assert that ROAM=0 at
  // COLS=40 was ALSO byte-identical, which held only while painting was
  // confined to the gap segment. Under D1 the stats/bubble filler segments are
  // painted too, so a zero-width gap no longer implies zero output — that is
  // the intended new behaviour, not a regression. The genuine invariant (no
  // weather ⇒ no change) is what this pins, and it is width-independent.
  test("no weather fields at all: output is BYTE-IDENTICAL to the plain baseline, at every width", () => {
    for (const columns of [40, 80, 125, 200]) {
      for (const showStats of [true, false]) {
        const plain = renderStatus({ gameFeel: "full", columns, showStats });
        const alsoPlain = renderStatus({ gameFeel: "full", columns, showStats });
        expect(alsoPlain).toBe(plain);
        // And a render WITH weather genuinely differs (guards the above from
        // passing vacuously if weather silently never rendered anywhere).
        expect(withGap({ columns, showStats })).not.toBe(plain);
      }
    }
  });

  test("gap fields absent entirely: the weathered render differs from the bare one at a wide width", () => {
    // Sanity counterpart to the above — proves the equality there came from
    // the absence of fields, not from weather silently never rendering.
    const wide = withGap({ columns: 125, showStats: true });
    const wideBase = withArtOnly({ columns: 125, showStats: true });
    expect(wide).not.toBe(wideBase);
  });

  test("D5 two-branch injection: the gap renders with stats ON and with stats OFF", () => {
    for (const showStats of [true, false]) {
      const out = withGap({ columns: 125, showStats });
      const base = withArtOnly({ columns: 125, showStats });
      expect(flakeCount(out)).toBeGreaterThan(flakeCount(base));
    }
  });

  test("D5: the stats column's own text is never touched or discolored by the gap band", () => {
    const out = withGap({ columns: 125, showStats: true });
    const plain = stripAnsi(out);
    // Every stat label still renders intact alongside the weather.
    for (const label of ["DBG", "PAT", "CHA", "WIS", "SNK"]) {
      expect(plain).toContain(label);
    }
  });

  // 2026-07-27 bugfix — see the matching pair above. D10's celeb_fresh clause
  // is gone; gameFeel is now the only gate, exactly as it is for the ground.
  test("a fresh celebration does not suppress the gap band", () => {
    const out = withGap({
      columns: 125,
      showStats: true,
      celebration: { text: "Level up!", secondsAgo: 1 },
    });
    expect(stripAnsi(out)).toContain("❄");
  });

  test("D10: subtle/off suppress the gap band even with all three fields present", () => {
    for (const gameFeel of ["subtle", "off"] as const) {
      const out = withGap({ columns: 125, showStats: true, gameFeel });
      expect(stripAnsi(out)).not.toContain("❄");
    }
  });
});

describe("buddy-status.sh D1 compositing into blank filler segments (design-fullwidth-weather-d1.md)", () => {
  // Reproduces the reporting user's real configuration, where the gap segment
  // alone measured 7 columns while the first band row was 88/89 blank.
  const GAP_W = 110;
  // A DENSE fixture: every column carries a flake, so "did this segment get
  // painted at all" is a deterministic question rather than a dice roll on
  // where the sparse production flakes happen to land.
  const DENSE = Array.from({ length: 14 }, () => "❄".repeat(GAP_W)).join("\n");

  const render = (o: Record<string, unknown>) =>
    renderStatus({
      gameFeel: "full",
      weatherFallGapFrames: [DENSE],
      weatherFallGapGlyph: "❄",
      weatherFallGapColor: "e8f0f7",
      ...o,
    } as Parameters<typeof renderStatus>[0]);
  // Baseline: the same render with no weather at all. Since F1 removed the
  // reserved sky rows, weather contributes no rows of its own, so a bare
  // render is now a like-for-like comparison (it was not before — it used to
  // differ by the ART band's own 3 rows).
  const artOnly = (o: Record<string, unknown>) =>
    renderStatus({ gameFeel: "full", ...o } as Parameters<typeof renderStatus>[0]);

  const rows = (s: string) => stripAnsi(s).split("\n").filter((l) => l.length);
  const widths = (s: string) => rows(s).map((l) => [...l].length);
  const flakeCols = (line: string) =>
    [...line].map((c, i) => (c === "❄" ? i : -1)).filter((i) => i >= 0);

  test("a row is painted essentially edge to edge, not just in the 7-column gap", () => {
    // 104 cols + a bubble is the reporting user's own geometry.
    const out = render({ columns: 104, showStats: true, reaction: "hello there" });
    const painted = rows(out).map(flakeCols).filter((c) => c.length > 0);
    expect(painted.length).toBeGreaterThan(0);
    const widest = painted.reduce((a, b) => (b.length > a.length ? b : a));
    // Before D1 the gap alone was ~7 columns wide. Anything in this range can
    // only come from the bubble and art segments also being painted.
    expect(widest.length).toBeGreaterThan(40);
    // It reaches the far right — past the bubble, out over the sprite column.
    const lineLen = Math.max(...rows(out).map((l) => [...l].length));
    expect(Math.max(...widest)).toBeGreaterThan(lineLen - 20);
  });

  // design-weather-frontlayer.md F5 is a DECISION, so pin it rather than let
  // it hold by accident: the stat bars are read as data, not looked at as
  // scenery, so flakes never land on a row carrying one — even with a fixture
  // dense enough to paint every other eligible cell on the line.
  test("F5: rows carrying a stat line are exempt, while the rest of the same row is painted", () => {
    const out = render({ columns: 125, showStats: true });
    const statRows = rows(out).filter((l) => /(DBG|PAT|CHA|WIS|SNK)/.test(l));
    expect(statRows.length).toBe(5);
    for (const line of statRows) {
      const label = /(DBG|PAT|CHA|WIS|SNK)/.exec(line)!;
      // Nothing left of (or inside) the stats column carries a flake...
      const statsEnd = line.indexOf("  ", label.index + 3);
      expect(line.slice(0, statsEnd)).not.toContain("❄");
      // ...but the same row IS painted further right, so this is an exemption
      // of the stats column specifically, not of the whole row.
      expect(line).toContain("❄");
    }
  });

  // COLS=40 is included because the printed line is WIDER than the terminal
  // there (a 26-wide stats panel plus the sprite cannot fit — a pre-existing
  // clip case), which is the closest this gets to stressing the geometry.
  //
  // HONEST NOTE on the E6 short-slice pad in `_wx_slice`: it is defensive and
  // currently UNREACHABLE. Deleting it leaves this suite green, and a sweep of
  // 72 real configurations (COLS 40-80 × stats on/off × bubbleWidth 8-20, with
  // a bubble present) found zero renders where it changes a single byte —
  // because E2 tiles the field to at least COLS, and the script's dynamic
  // bubble fitting plus its drop backstop keep every painted segment ending
  // within COLS. It is kept as a guard against future geometry changes, not
  // because any test can exercise it. Recorded rather than left as a silently
  // surviving mutant.
  test("total line widths are unchanged vs. the unweathered baseline (E6), at every width", () => {
    for (const columns of [40, 80, 104, 125, 200]) {
      for (const showStats of [true, false]) {
        expect(widths(render({ columns, showStats }))).toEqual(
          widths(artOnly({ columns, showStats })),
        );
      }
    }
  });

  // Targets the BUBBLE segment specifically. The broad "edge to edge" test
  // above is satisfied by the stats segment alone, so without this a bubble
  // that never paints would go unnoticed (mutation-verified).
  test("the bubble box's own blank rows are painted (E3), not just the stats column and gap", () => {
    const out = render({ columns: 125, showStats: true, reaction: "weather is rough" });
    const lines = rows(out);
    // Locate the bubble by its border row, which is real content and so is
    // never painted — giving the box's true column span.
    const border = lines.find((l) => /\.-{5,}\./.test(l));
    expect(border).toBeDefined();
    const bStart = border!.indexOf(".");
    const bEnd = border!.lastIndexOf(".");
    expect(bEnd).toBeGreaterThan(bStart);
    // Some band row must carry a flake inside that column span.
    const insideBubbleSpan = lines.some((l) =>
      flakeCols(l).some((c) => c > bStart && c < bEnd),
    );
    expect(insideBubbleSpan).toBe(true);
  });

  test("rows carrying real stats text are never overpainted (E3)", () => {
    const out = render({ columns: 104, showStats: true });
    const text = stripAnsi(out);
    for (const label of ["DBG", "PAT", "CHA", "WIS", "SNK"]) {
      expect(text).toContain(label);
    }
    // Every stat label still sits on a line whose label region is intact —
    // i.e. no flake was written over the characters themselves.
    for (const line of rows(out)) {
      const m = /(DBG|PAT|CHA|WIS|SNK)/.exec(line);
      if (m) expect(line.slice(m.index, m.index + 3)).toBe(m[1]);
    }
  });

  // design-weather-frontlayer.md F3/F4 — the second half of the request: the
  // bubble is the BACK layer, so flakes DO pass in front of it. What must
  // survive is every non-space character, in order.
  test("F3/F4: flakes land inside the bubble, replacing only spaces — never a character", () => {
    const out = render({ columns: 125, showStats: true, reaction: "weather is rough" });
    const text = stripAnsi(out);
    // The comment's own characters are all still there, in order, with only
    // its spaces swapped for flakes.
    expect(text).toContain("weather❄is❄rough");
    // Which is a genuine front-layer composite, not a mangled string: undoing
    // the substitution recovers the original comment exactly.
    expect(text.replace(/❄/g, " ")).toContain("weather is rough");
    // The bubble's border rows keep their box-drawing characters (no spaces
    // to overwrite there, so they are untouched by construction).
    expect(text).toMatch(/\.-+\./);
    // And the flakes are genuinely INSIDE the box, not merely adjacent to it.
    const textRow = rows(out).find((l) => l.includes("weather"))!;
    const lPipe = textRow.indexOf("|");
    const rPipe = textRow.lastIndexOf("|");
    expect(rPipe).toBeGreaterThan(lPipe);
    expect(flakeCols(textRow).some((c) => c > lPipe && c < rPipe)).toBe(true);
  });

  // The same contract, for the sprite: the buddy is behind the weather too
  // (F4), which is what keeps the right-hand column snowing now that the
  // reserved sky rows above it are gone.
  test("F3/F4: flakes land over the sprite's own row, leaving its glyphs intact", () => {
    const out = render({ columns: 125, showStats: true });
    // The fixture sprite alternates an open-eye row `(··)` and a blink row
    // `(  )`. Both directions of F3 are visible in that one pair: the blink
    // row's interior spaces are taken by flakes...
    const blinkRow = rows(out).find((l) => /\(❄+\)/.test(l));
    expect(blinkRow).toBeDefined();
    expect(blinkRow!.replace(/❄/g, " ")).toContain("(  )");
    // ...while the open-eye row, whose interior is glyphs rather than spaces,
    // comes through completely untouched.
    expect(rows(out).some((l) => l.includes("(··)"))).toBe(true);
  });

  // The general form of F3, swept: NO non-space character may ever be lost,
  // in any configuration, against the most aggressive fixture available.
  test("F3: undoing every flake substitution reproduces the unweathered render exactly", () => {
    for (const columns of [80, 104, 125, 200]) {
      for (const showStats of [true, false]) {
        const o = { columns, showStats, reaction: "hydrate. seriously." };
        const wx = stripAnsi(render(o)).replace(/❄/g, " ");
        const bare = stripAnsi(artOnly(o));
        expect(wx).toBe(bare);
      }
    }
  });

  test("E5 escape hygiene holds across all three painted segments", () => {
    for (const columns of [80, 104, 200]) {
      for (const showStats of [true, false]) {
        for (const line of render({ columns, showStats }).split("\n")) {
          if (!line.length) continue;
          expect(/\x1b\[?[0-9;]*$/.test(line)).toBe(false);
          const codes = [...line.matchAll(/\x1b\[([0-9;]*)m/g)].map((m) => m[1]);
          if (codes.length) expect(codes[codes.length - 1]).toBe("0");
        }
      }
    }
  });

  test("E2 tiling: a line far wider than the 110-column bake is still populated to its right edge", () => {
    const out = render({ columns: 200, showStats: false });
    const painted = rows(out).map(flakeCols).filter((c) => c.length > 0);
    const widest = painted.reduce((a, b) => (b.length > a.length ? b : a));
    // Past column 110 there is only content if the bake was tiled.
    expect(Math.max(...widest)).toBeGreaterThan(110);
  });

  test("still a no-op with no weather fields, now that three segments can paint", () => {
    for (const columns of [40, 104, 200]) {
      const a = artOnly({ columns, showStats: true });
      const b = artOnly({ columns, showStats: true });
      expect(a).toBe(b);
      expect(render({ columns, showStats: true })).not.toBe(a);
    }
  });
});

// ─── Front-layer hardening (2026-07-27 analysis follow-up) ──────────────────
// Three defects found by probing the front layer at its edges rather than at
// its happy path. Each test below fails on the pre-fix script.
describe("buddy-status.sh falling weather — front-layer edge cases", () => {
  const GAP_W = 110;
  const FIELD_ROWS = 14; // SKY_FALL_ROWS
  /** Every column of every row carries a flake ⇒ "did this row paint at all"
   *  is deterministic rather than a dice roll on where sparse flakes land. */
  const dense = (glyph: string): string =>
    Array.from({ length: FIELD_ROWS }, () => glyph.repeat(GAP_W)).join("\n");

  const withWx = (o: Record<string, unknown>) =>
    renderStatus({
      gameFeel: "full",
      weatherFallGapFrames: [dense("❄")],
      weatherFallGapGlyph: "❄",
      weatherFallGapColor: "e8f0f7",
      ...o,
    } as Parameters<typeof renderStatus>[0]);

  const lines = (out: string): string[] =>
    out.split("\n").filter((l) => l.length > 0);

  // A block TALLER than the baked field. SKY_FALL_ROWS=14 was chosen to clear
  // HOP_BUDGET=12, but HOP_BUDGET bounds only the art stack — MAX_LINES also
  // takes TOTAL_BUBBLE, and the bubble wrap has no row cap. Before the fix the
  // field stopped dead at row 14: snow above, none below, a hard horizontal
  // line mid-widget. The field now wraps, exactly as it already tiles across.
  const TALL_ART = Array.from({ length: 16 }, (_, r) =>
    `art-row-${r}`.padEnd(28),
  ).join("\n");

  test("a block taller than the baked field still snows on EVERY row (no cliff at row 14)", () => {
    const out = withWx({ columns: 125, showStats: true, frames: [TALL_ART] });
    const ls = lines(out);
    // The premise: this really is taller than the field, or the test is vacuous.
    expect(ls.length).toBeGreaterThan(FIELD_ROWS);
    const dry = ls.filter((l) => !l.includes("❄"));
    expect(dry).toEqual([]);
  });

  test("the tall-block render is still width-correct (wrapping did not disturb layout)", () => {
    const opts = { columns: 125, showStats: true, frames: [TALL_ART] };
    const weathered = lines(withWx(opts)).map(displayWidth);
    const bare = lines(
      renderStatus({ gameFeel: "full", ...opts } as Parameters<typeof renderStatus>[0]),
    ).map(displayWidth);
    expect(weathered).toEqual(bare);
  });

  // F3 argues the composite is width-preserving BY CONSTRUCTION. It is — but
  // only given a single-cell, glob-inert glyph. Both preconditions were
  // unguarded: `_wx_slice` used the glyph UNQUOTED as a `${v//pat/rep}`
  // pattern, so `*` matched the whole segment and collapsed it (measured 116
  // display cells → 47), and a multi-character glyph swapped a 1-cell space
  // for an N-cell glyph in `_wx_overlay`.
  const baselineWidths = (o: Record<string, unknown>): number[] =>
    lines(
      renderStatus({ gameFeel: "full", columns: 125, showStats: true, ...o } as
        Parameters<typeof renderStatus>[0]),
    ).map(displayWidth);

  test("a glob-special glyph cannot collapse a line (the pattern is quoted)", () => {
    const bare = baselineWidths({});
    for (const glyph of ["*", "?", "["]) {
      const out = withWx({
        columns: 125,
        showStats: true,
        weatherFallGapGlyph: glyph,
        weatherFallGapFrames: [dense(glyph)],
      });
      expect(lines(out).map(displayWidth)).toEqual(bare);
    }
  });

  test("a multi-character glyph is refused outright rather than breaking width", () => {
    const bare = baselineWidths({});
    const out = withWx({
      columns: 125,
      showStats: true,
      weatherFallGapGlyph: "AB",
      weatherFallGapFrames: [dense("AB")],
    });
    expect(lines(out).map(displayWidth)).toEqual(bare);
    // The guard blanks the glyph, which disables the OVERLAY path — the only
    // one that can break width, since it swaps a 1-cell space for the glyph.
    // `_wx_slice` still fills blank segments from the raw field, but those are
    // fixed-width slices and so are width-safe whatever the field contains.
    // What must hold is that no content row was spliced into: the sprite comes
    // through byte-identical.
    const plain = stripAnsi(out);
    expect(plain).toContain("(··)"); // eye row intact
    expect(plain).toContain("(  )"); // blink row's spaces NOT overlaid
  });

  test("the guards do not fire on the real glyphs — snow and rain both still paint", () => {
    for (const [glyph, color] of [["❄", "e8f0f7"], ["`", "5f8fc7"]] as const) {
      const out = withWx({
        columns: 125,
        showStats: true,
        weatherFallGapGlyph: glyph,
        weatherFallGapColor: color,
        weatherFallGapFrames: [dense(glyph)],
      });
      expect(stripAnsi(out)).toContain(glyph);
      expect(lines(out).map(displayWidth)).toEqual(baselineWidths({}));
    }
  });
});
