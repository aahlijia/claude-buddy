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
  /** §7.B wide corridor flag, written into config.json. */
  wanderWide?: boolean;
  /** §5e bubble-follows-buddy flag, written into config.json. */
  wanderBubble?: boolean;
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
  /** Combined-status mode: model/context/usage/reset metrics, written into
   *  config.json (useCombinedStatus) and fed as the Claude Code stdin JSON. */
  useCombinedStatus?: boolean;
  /** Raw Claude Code stdin JSON (model/context/rate-limit). Default "". */
  ccInput?: string;
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
    frameSequence: [0],
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
    // The scene render keys off encounterAt freshness (glyph-independent).
    status.encounterAt =
      (fakeNow - (overrides.encounterSecondsAgo ?? 0)) * 1000;
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
    overrides.wanderWide !== undefined ||
    overrides.wanderBubble !== undefined ||
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
    if (overrides.wanderWide !== undefined) cfg.wanderWide = overrides.wanderWide;
    if (overrides.wanderBubble !== undefined) {
      cfg.wanderBubble = overrides.wanderBubble;
    }
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
