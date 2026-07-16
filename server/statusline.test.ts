/**
 * Tests for the Claude Code settings.json patching helpers used by the
 * buddy_statusline MCP tool. Uses a temp directory per test so runs are
 * isolated from the real ~/.claude/settings.json.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setBuddyStatusLine, unsetBuddyStatusLine, DEFAULT_CONFIG } from "./state.ts";

describe("buddy statusline settings patch", () => {
  let settingsPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "buddy-statusline-test-"));
    settingsPath = join(dir, "settings.json");
  });

  test("enable writes statusLine pointing to buddy-status.sh and preserves other keys", () => {
    writeFileSync(settingsPath, JSON.stringify({ other: "value" }));

    const ok = setBuddyStatusLine("/opt/buddy/statusline/buddy-status.sh", settingsPath);

    expect(ok).toBe(true);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine.type).toBe("command");
    expect(result.statusLine.command).toContain("buddy-status.sh");
    expect(result.statusLine.padding).toBe(1);
    expect(result.statusLine.refreshInterval).toBe(1);
    expect(result.other).toBe("value");
  });

  test("disable removes buddy statusLine but keeps other keys", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "/opt/buddy/statusline/buddy-status.sh" },
        other: "value",
      }),
    );

    const ok = unsetBuddyStatusLine(settingsPath);

    expect(ok).toBe(true);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine).toBeUndefined();
    expect(result.other).toBe("value");
  });

  test("disable does NOT touch a foreign statusLine", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "/usr/local/bin/my-status.sh" },
      }),
    );

    const ok = unsetBuddyStatusLine(settingsPath);

    expect(ok).toBe(false);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine.command).toBe("/usr/local/bin/my-status.sh");
  });

  test("enable returns false if settings.json is missing", () => {
    const missing = join(tmpdir(), `buddy-nonexistent-${Date.now()}.json`);
    const ok = setBuddyStatusLine("/opt/buddy/statusline/buddy-status.sh", missing);
    expect(ok).toBe(false);
  });

  test("backslash path is normalized to forward slashes in persisted command", () => {
    writeFileSync(settingsPath, JSON.stringify({}));

    // Simulate a Windows-style path with backslashes (e.g. from path.join on Windows).
    // The persisted command must contain only forward slashes so bash can execute it.
    const backslashPath = "C:\\Users\\user\\.claude\\statusline\\buddy-status.sh";
    const ok = setBuddyStatusLine(backslashPath, settingsPath);

    expect(ok).toBe(true);
    const result = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(result.statusLine.command).not.toContain("\\");
    expect(result.statusLine.command).toContain("/");
  });
});

// ─── TS ↔ bash defaults parity ────────────────────────────────────────────────
//
// buddy-status.sh mirrors DEFAULT_CONFIG's fallbacks in two places (the
// pre-read initializers for a missing config.json, and the jq `//` defaults for
// a config missing a field). Those copies drifted once (bubbleWidth 28 vs 44 —
// changing an unrelated setting visibly narrowed the bubble), so pin them to
// the exported DEFAULT_CONFIG.

describe("buddy-status.sh config defaults parity", () => {
  const script = readFileSync(
    join(import.meta.dir, "..", "statusline", "buddy-status.sh"),
    "utf8",
  );

  /** The jq `.key // <fallback>` default for a config field, unquoted. */
  function jqFallback(key: string): string {
    const m = script.match(new RegExp(`\\.${key} // ("[^"]*"|[a-z0-9]+)`));
    expect(m).not.toBeNull();
    return m![1].replaceAll('"', "");
  }

  /** A `NAME=value` initializer at line start (the missing-file defaults). */
  function initializer(name: string): string {
    const m = script.match(new RegExp(`^${name}=("?)([^"\\n]*)\\1$`, "m"));
    expect(m).not.toBeNull();
    return m![2];
  }

  test("jq field fallbacks match DEFAULT_CONFIG", () => {
    expect(jqFallback("gameFeel")).toBe(DEFAULT_CONFIG.gameFeel);
    expect(jqFallback("theme")).toBe(DEFAULT_CONFIG.theme);
    expect(Number(jqFallback("reactionTTL"))).toBe(DEFAULT_CONFIG.reactionTTL);
    expect(Number(jqFallback("bubbleWidth"))).toBe(DEFAULT_CONFIG.bubbleWidth);
    expect(Number(jqFallback("bubbleMargin"))).toBe(DEFAULT_CONFIG.bubbleMargin);
    expect(jqFallback("showStats")).toBe(String(DEFAULT_CONFIG.showStats));
    expect(jqFallback("showPrestigeBadge")).toBe(
      String(DEFAULT_CONFIG.showPrestigeBadge),
    );
    expect(jqFallback("useCombinedStatus")).toBe(
      String(DEFAULT_CONFIG.useCombinedStatus),
    );
  });

  test("pre-read initializers match DEFAULT_CONFIG (missing config.json)", () => {
    expect(initializer("GAME_FEEL")).toBe(DEFAULT_CONFIG.gameFeel);
    expect(Number(initializer("REACTION_TTL"))).toBe(DEFAULT_CONFIG.reactionTTL);
    expect(Number(initializer("INNER_W"))).toBe(DEFAULT_CONFIG.bubbleWidth);
    expect(Number(initializer("MARGIN"))).toBe(DEFAULT_CONFIG.bubbleMargin);
  });
});
