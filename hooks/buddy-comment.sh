#!/usr/bin/env bash
# buddy-comment Stop hook
# Extracts hidden buddy comment from Claude's response.
# Claude writes: <!-- buddy: *adjusts tophat* nice code -->
# This hook extracts it and updates the status line bubble.
# The HTML comment is invisible in rendered markdown output.

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_comment.$SID"
CONFIG_FILE="$STATE_DIR/config.json"
EVENTS_FILE="$STATE_DIR/events.json"

[ -f "$STATUS_FILE" ] || exit 0

# Read cooldown from config (default 30s, 0 = disabled)
COOLDOWN=30
if [ -f "$CONFIG_FILE" ]; then
  _cd=$(jq -r '.commentCooldown // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
  # Accept any non-negative integer (including 0 to disable cooldown)
  [[ "$_cd" =~ ^[0-9]+$ ]] && COOLDOWN=$_cd
fi

# Builtin stdin capture (perf R2: was $(cat)) — INPUT is needed twice (MSG
# here, USER_MSG in the consolidate sidecar below). read -d '' returns
# nonzero at EOF but the variable holds the full stream.
INPUT=""
IFS= read -rd '' INPUT

# Extract last_assistant_message from hook input
MSG=$(jq -r '.last_assistant_message // ""' <<< "$INPUT" 2>/dev/null)
[ -z "$MSG" ] && exit 0

# Cheap builtin pre-check before forking sed: the sed pattern requires a
# literal "buddy:", so a message without that substring can never match —
# and that is the overwhelmingly common Stop (perf R2). sed stays the
# authoritative extractor when the marker is present.
[[ $MSG != *buddy:* ]] && exit 0

# Extract <!-- buddy: ... --> comment (portable, no grep -P)
COMMENT=$(echo "$MSG" | sed -n 's/.*<!-- *buddy: *\(.*[^ ]\) *-->.*/\1/p' | tail -1)
[ -z "$COMMENT" ] && exit 0

# Cooldown: configurable (default 30s)
NOW_TS=$(date +%s)
if [ -f "$COOLDOWN_FILE" ]; then
    LAST=""
    read -r LAST < "$COOLDOWN_FILE" 2>/dev/null
    [ $(( NOW_TS - ${LAST:-0} )) -lt "$COOLDOWN" ] && exit 0
fi

mkdir -p "$STATE_DIR"
printf '%s\n' "$NOW_TS" > "$COOLDOWN_FILE"

# Update status.json with the reaction
# Same-dir mktemp: /tmp may be another filesystem, where mv degrades to
# copy+unlink and a concurrent statusline tick can see a torn status.json.
TMP=$(mktemp "$STATE_DIR/.status.patch.XXXXXX")
jq --arg r "$COMMENT" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null \
    && mv "$TMP" "$STATUS_FILE" || rm -f "$TMP"

# Also write reaction file (use jq for safe JSON encoding)
jq -n --arg r "$COMMENT" --arg ts "${NOW_TS}000" \
  '{reaction: $r, timestamp: ($ts | tonumber), reason: "turn"}' \
  > "$STATE_DIR/reaction.$SID.json"

# Increment achievement event counters and award XP
if command -v jq >/dev/null 2>&1; then
    if [ ! -f "$EVENTS_FILE" ]; then
        echo '{}' > "$EVENTS_FILE"
    fi
    TMP=$(mktemp "$STATE_DIR/.events.patch.XXXXXX")
    jq '.turns = (.turns // 0 + 1)' "$EVENTS_FILE" > "$TMP" 2>/dev/null \
        && mv "$TMP" "$EVENTS_FILE" || rm -f "$TMP"
fi

# Award XP for turn (async, non-blocking)
if [ -x "$(command -v bun)" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    bun run "$PLUGIN_ROOT/server/award-xp.ts" "turn" >/dev/null 2>&1 &
fi

# Consolidate memory (async, non-blocking)
# Extract project, bug, and preference signals from conversation
if [ -x "$(command -v bun)" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # Pass the assistant message for analysis (pass empty string for user prompt if unavailable)
    USER_MSG=$(jq -r '.last_user_message // ""' <<< "$INPUT" 2>/dev/null)
    bun run "$PLUGIN_ROOT/server/consolidate.ts" \
        "$(echo "$MSG" | jq -Rs .)" \
        "$(echo "$USER_MSG" | jq -Rs .)" \
        >/dev/null 2>&1 &
fi

exit 0
