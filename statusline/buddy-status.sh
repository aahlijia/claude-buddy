#!/usr/bin/env bash
# claude-buddy status line — animated, right-aligned multi-line companion
#
# Art rendering: the server (writeStatusState in server/state.ts) pre-bakes
# every frame with eye, hat overlay, and blink resolved, and writes them into
# status.json along with the frame-index sequence. This script is a dumb
# cycler — one jq call per tick picks the current frame body.
#
# BUDDY_FAKE_NOW env var: override wall clock for snapshot tests.
#
# Uses Braille Blank (U+2800) for padding — survives JS .trim()
#
# When running inside buddy-shell (the PTY wrapper), skip status line rendering
# so the buddy doesn't show up twice (once in status line, once in wrapper panel).
[ "$BUDDY_SHELL" = "1" ] && exit 0

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE="$BUDDY_STATE_DIR/status.json"
CONFIG_FILE="$BUDDY_STATE_DIR/config.json"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"

[ -f "$STATE" ] || exit 0

# Wall clock (overridable for snapshot tests). Needed by the consolidated
# status read below to resolve the animation frame + wander offsets in one pass.
NOW=${BUDDY_FAKE_NOW:-$(date +%s)}

# ─── Single config.json read (perf: ~11 jq forks → 1) ───────────────────────
# The status line runs every ~1s; one jq fork per field was ~11 process spawns
# per tick. Fetch every config field in a single jq pass instead. rainbowColors
# is an array → joined with commas here, re-split in bash. All the per-field
# defaulting/validation the scattered reads used to do is re-applied just below.
GAME_FEEL="subtle"
_CFG_THEME="auto"
_RAINBOW_CSV=""
REACTION_TTL=0
INNER_W=44
MARGIN=8
WANDER_WIDE="false"
WANDER_BUBBLE="false"
SHOW_STATS="false"
SHOW_PRESTIGE_BADGE="false"
USE_COMBINED="false"
if [ -f "$CONFIG_FILE" ]; then
    # Join with 0x1F (non-whitespace) rather than @tsv: an empty field (e.g. no
    # rainbowColors) would COLLAPSE under IFS=$'\t' (tab is IFS-whitespace),
    # silently shifting every later field and misreading the booleans.
    IFS=$'\x1f' read -r \
        GAME_FEEL _CFG_THEME _RAINBOW_CSV \
        REACTION_TTL INNER_W MARGIN \
        WANDER_WIDE WANDER_BUBBLE \
        SHOW_STATS SHOW_PRESTIGE_BADGE USE_COMBINED \
    <<< "$(jq -r '[
        (.gameFeel // "subtle"),
        (.theme // "auto"),
        ((.rainbowColors // []) | join(",")),
        ((.reactionTTL // 0) | tostring),
        ((.bubbleWidth // 44) | tostring),
        ((.bubbleMargin // 8) | tostring),
        ((.wanderWide // false) | tostring),
        ((.wanderBubble // false) | tostring),
        ((.showStats // false) | tostring),
        ((.showPrestigeBadge // false) | tostring),
        ((.useCombinedStatus // false) | tostring)
    ] | join("")' "$CONFIG_FILE" 2>/dev/null)"
fi
# Re-apply the exact per-field validation/defaulting the old scattered reads did,
# so a missing/garbled value (incl. an empty read on malformed JSON) still falls
# back to the documented default.
case "$GAME_FEEL" in off|subtle|full) ;; *) GAME_FEEL="subtle" ;; esac
case "$REACTION_TTL" in ''|*[!0-9]*) REACTION_TTL=0 ;; esac
case "$INNER_W" in ''|*[!0-9]*) INNER_W=44 ;; esac
case "$MARGIN" in ''|*[!0-9]*) MARGIN=8 ;; esac
[ "$WANDER_WIDE" = "true" ] || WANDER_WIDE="false"
[ "$WANDER_BUBBLE" = "true" ] || WANDER_BUBBLE="false"
[ "$SHOW_STATS" = "true" ] || SHOW_STATS="false"
[ "$SHOW_PRESTIGE_BADGE" = "true" ] || SHOW_PRESTIGE_BADGE="false"
[ "$USE_COMBINED" = "true" ] || USE_COMBINED="false"

# ─── Single status.json read (perf: ~17 jq forks → 1) ───────────────────────
# All status.json fields PLUS the celebration-freshness, frame-pick (game-feel
# FR-A3) and idle-wander offset logic that used to be separate jq calls are
# resolved in one pass. Fields are joined with the ASCII Unit Separator (0x1F,
# same idiom as the combined-metrics read below) so the inner @tsv blobs
# (stats / xp / celebration) keep their own tabs and split downstream exactly as
# before. The multi-line frame art is base64'd to survive the single-line read,
# then decoded after the early-exit checks. Free-text fields are tab/newline-
# sanitized so a stray control char can't shift the columns.
_STATUS=$(jq -r --argjson now "$NOW" --arg gf "$GAME_FEEL" '
    # Celebration freshness — mirrors the old bash TTL/age math, gameFeel-gated.
    (if $gf == "off" then 0
     else
       (.celebration.text // "") as $ct
       | (.celebration.at // 0) as $ca
       | (if ($ct | type) == "string" and $ct != "" and $ct != "null"
             and ($ca | type) == "number" and $ca > 0 then
            (if $gf == "subtle" then 6 else 10 end) as $ttl
            | ($now - ($ca / 1000 | floor)) as $age
            | (if $age >= 0 and $age <= $ttl then 1 else 0 end)
          else 0 end)
     end) as $celeb_fresh
    # Encounter freshness (idle-RPG Phase 4/5) — same TTL/age idiom as
    # $celeb_fresh, gated to full (the fight render is full-only). Glyph-
    # independent: Phase 5 keys the scene off encounterAt, the glyph is only the
    # degraded-skew fallback. Off never wrote the file.
    | (if $gf == "full"
       then ((.encounterAt // 0) as $ea
             | if ($ea | type) == "number" and $ea > 0
                   and ($now - ($ea / 1000 | floor)) >= 0
                   and ($now - ($ea / 1000 | floor)) <= 10
               then 1 else 0 end)
       else 0 end) as $enc_fresh
    # Combat scene active (Phase 5): a fresh encounter WITH a baked two-sprite
    # scene. Takes priority over flourish/idle as the frame source.
    | (if $enc_fresh == 1
          and ((.combatFrames | type) == "array")
          and ((.combatFrames | length) > 0) then 1 else 0 end) as $combat_on
    # Frame source: combat scene > flourish (while a celebration is fresh) > idle.
    | (if ((.flourishFrames | type) == "array")
          and ((.flourishFrames | length) > 0) then 1 else 0 end) as $has_fl
    | (if $combat_on == 1 then .combatSequence
       elif $celeb_fresh == 1 and $has_fl == 1 then .flourishSequence
       else .frameSequence end) as $seq
    | (if $combat_on == 1 then .combatFrames
       elif $celeb_fresh == 1 and $has_fl == 1 then .flourishFrames
       else .frames end) as $frms
    | ($seq | length) as $slen
    | (if $slen > 0 then ($seq[$now % $slen] // 0) else 0 end) as $idx
    | ($frms[$idx] // "") as $frame
    # Active art display width: the combat scene widens the art column; 0 ⇒ the
    # shell keeps its default single-sprite ART_W.
    | (if $combat_on == 1 then (.artWidth // 0) else 0 end) as $awidth
    # Wander offsets — only at gameFeel=full with no fresh celebration; all three
    # stay 0 otherwise (parity with the old gf==full && !celeb_fresh gate, incl.
    # WANDER_ROW_MAX, which must not reserve hop headroom when wander is idle).
    | (if $gf == "full" and $celeb_fresh != 1
       then ((.wanderSequence // []) as $w
             | if ($w | length) > 0 then ($w[$now % ($w | length)] // 0) else 0 end)
       else 0 end) as $woff
    | (if $gf == "full" and $celeb_fresh != 1
       then ((.wanderRowSequence // []) as $w
             | if ($w | length) > 0 then ($w[$now % ($w | length)] // 0) else 0 end)
       else 0 end) as $wrow
    | (if $gf == "full" and $celeb_fresh != 1
       then (((.wanderRowSequence // []) | max) // 0)
       else 0 end) as $wrmax
    | [
        ((.muted // false) | tostring),
        ((.name // "") | gsub("[\t\n\r]"; " ")),
        ((.rarity // "common") | gsub("[\t\n\r]"; " ")),
        ((.shiny // false) | tostring),
        ((.reaction // "") | gsub("[\t\n\r]"; " ")),
        ((.achievement // "") | gsub("[\t\n\r]"; " ")),
        ((.level // 1) | tostring),
        ((.mood // "focused") | gsub("[\t\n\r]"; " ")),
        ((.title // "") | gsub("[\t\n\r]"; " ")),
        ((.prestigeLevel // 0) | tostring),
        ((.streak // 0) | tostring),
        ([.stats.DEBUGGING, .stats.PATIENCE, .stats.CHAOS, .stats.WISDOM, .stats.SNARK, .peak, .dump] | @tsv),
        ((.xpPct // 0) | tostring),
        ([(.lastXpGain.amount // 0), (.lastXpGain.at // 0)] | @tsv),
        ([(.celebration.text // ""), (.celebration.at // 0)] | @tsv),
        ($has_fl | tostring),
        ($celeb_fresh | tostring),
        ($woff | tostring),
        ($wrow | tostring),
        ($wrmax | tostring),
        ($enc_fresh | tostring),
        ($combat_on | tostring),
        ($awidth | tostring),
        ((.enemyGlyph // "") | gsub("[\t\n\r]"; " ")),
        ($frame | @base64)
      ] | join("")
' "$STATE" 2>/dev/null)

IFS=$'\x1f' read -r \
    MUTED NAME RARITY SHINY REACTION ACHIEVEMENT \
    LEVEL MOOD TITLE PRESTIGE STREAK \
    STATS_TSV XP_PCT XP_GAIN_TSV CELEB_TSV \
    _HAS_FLOURISH _CELEB_FRESH WANDER_OFF WANDER_ROW WANDER_ROW_MAX \
    _ENC_FRESH _COMBAT_ON ART_WIDTH ENEMY_GLYPH \
    _FRAME_B64 <<< "$_STATUS"

[ "$MUTED" = "true" ] && exit 0
[ -z "$NAME" ] && exit 0

CC_INPUT=$(cat)  # capture stdin JSON (model/context/rate-limit data)

# Decode the base64'd frame art (it's multi-line, so it couldn't ride the TSV
# raw). Empty on a degraded/missing file → the fallback art below kicks in.
FRAME_BODY=$(printf '%s' "$_FRAME_B64" | base64 -d 2>/dev/null)

# Celebration text for the bubble toast (its freshness is already resolved in the
# single read above as _CELEB_FRESH).
IFS=$'\t' read -r _CELEB_TEXT _CELEB_AT <<< "$CELEB_TSV"

# Wander offset sanitizers — the jq pass already gates these to gameFeel=full &&
# no fresh celebration (0 otherwise); guard against a non-numeric on a bad file.
case "$WANDER_OFF" in ''|*[!0-9]*) WANDER_OFF=0 ;; esac
case "$WANDER_ROW" in ''|*[!0-9]*) WANDER_ROW=0 ;; esac
case "$WANDER_ROW_MAX" in ''|*[!0-9]*) WANDER_ROW_MAX=0 ;; esac
# Combat-scene width (idle-RPG Phase 5): the server-emitted display width of the
# active two-sprite scene; 0 unless a fresh fight is being rendered.
case "$_COMBAT_ON" in 1) ;; *) _COMBAT_ON=0 ;; esac
case "$ART_WIDTH" in ''|*[!0-9]*) ART_WIDTH=0 ;; esac

# Fallback when status.json lacks .frames — e.g. server/bash version skew
# during install or while the MCP server hasn't rewritten the file yet. Keep
# the buddy visible in a degraded form instead of emitting an empty block.
if [ -z "$FRAME_BODY" ]; then
    FRAME_BODY=$'            \n    (°°)    \n    (  )    \n            \n            '
fi

ART_LINES=()
while IFS= read -r line; do
    ART_LINES+=("$line")
done <<< "$FRAME_BODY"

# Idle-RPG encounter (Phase 4 fallback): hover the enemy glyph in the buddy's
# right margin during a fresh fight. This is now the DEGRADED-SKEW path only —
# when the server baked a Phase 5 two-sprite scene ($_COMBAT_ON), that scene is
# the frame body and we must NOT also draw the glyph (no doubled enemy).
# Appended RIGHTMOST on the eye row so its (often double-width) glyph can't shift
# any aligned column to its left. $_ENC_FRESH is already gated to gameFeel=full.
if [ "$_COMBAT_ON" != 1 ] && [ "$_ENC_FRESH" = 1 ] && [ -n "$ENEMY_GLYPH" ] && [ "$ENEMY_GLYPH" != "null" ]; then
    # The eye row is the vertical middle of the frame (row 0 is the hat slot,
    # the eyes sit on the centre line across all species art). For the standard
    # 5-row frame this is row 2; integer-halving degrades sanely for shorter art.
    _FACE_ROW=$(( ${#ART_LINES[@]} / 2 ))
    ART_LINES[$_FACE_ROW]="${ART_LINES[$_FACE_ROW]}    ${ENEMY_GLYPH}"
fi

# ─── Rarity color (theme-aware) ─────────────────────────────────────────────
# _CFG_THEME comes from the single config read above.
_THEME="dark"
[ "$_CFG_THEME" = "light" ] && _THEME="light"

NC=$'\033[0m'
case "$RARITY" in
  common)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;90;90;90m' || C=$'\033[38;2;153;153;153m' ;;
  uncommon)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;22;115;55m' || C=$'\033[38;2;78;186;101m' ;;
  rare)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;55;85;210m' || C=$'\033[38;2;177;185;249m' ;;
  epic)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;110;55;200m' || C=$'\033[38;2;175;135;255m' ;;
  legendary)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;180;120;0m' || C=$'\033[38;2;255;193;7m' ;;
  *)         C=$'\033[0m' ;;
esac

B=$'\xe2\xa0\x80'  # Braille Blank U+2800

# ─── Rainbow colors for shiny buddies ────────────────────────────────────────
# Default ROYGBIV palette; overridden by rainbowColors in config.json
_hex_to_ansi() {
    local hex="${1#\#}"
    printf '\033[38;2;%d;%d;%dm' "$(( 16#${hex:0:2} ))" "$(( 16#${hex:2:2} ))" "$(( 16#${hex:4:2} ))"
}

RAINBOW=(
  $'\033[38;2;255;50;50m'
  $'\033[38;2;255;140;0m'
  $'\033[38;2;255;220;0m'
  $'\033[38;2;50;210;50m'
  $'\033[38;2;50;120;255m'
  $'\033[38;2;100;50;220m'
  $'\033[38;2;180;50;220m'
)

# _RAINBOW_CSV (comma-joined rainbowColors) comes from the single config read.
if [ -n "$_RAINBOW_CSV" ]; then
    RAINBOW=()
    IFS=',' read -ra _RAINBOW_HEXES <<< "$_RAINBOW_CSV"
    for _hex in "${_RAINBOW_HEXES[@]}"; do
        RAINBOW+=("$(_hex_to_ansi "$_hex")")
    done
fi

RAINBOW_LEN=${#RAINBOW[@]}
RAINBOW_OFFSET=$(( NOW % RAINBOW_LEN ))

# ─── Terminal width ──────────────────────────────────────────────────────────
# CC's statusline stdin carries no width field (verified against the live
# payload), so the width is found by walking up the process tree to the
# controlling PTY. This reruns every ~1s, so the per-iteration forks are trimmed
# vs. the obvious form: strip whitespace with `read` (a builtin) instead of
# forking `tr`, parse `stty size` with `read` instead of `awk`, and skip the
# Linux /proc probe entirely on hosts without /proc (e.g. macOS). Same result —
# breaks on the first PTY that reports a sane width — validated identical across
# a real PTY and the no-TTY fallback.
COLS=0
# Test seam (like BUDDY_FAKE_NOW): force the terminal width so snapshot/layout
# tests are deterministic regardless of the controlling PTY. Unset in production.
if [ -n "$BUDDY_FAKE_COLS" ]; then
    case "$BUDDY_FAKE_COLS" in ''|*[!0-9]*) ;; *) COLS=$BUDDY_FAKE_COLS ;; esac
fi
_HAS_PROC=0
[ -d /proc ] && _HAS_PROC=1
PID=$$
for _ in 1 2 3 4 5; do
    [ "${COLS:-0}" -ge 40 ] 2>/dev/null && break  # forced width ⇒ skip PTY walk
    read -r PID < <(ps -o ppid= -p "$PID" 2>/dev/null)
    [ -z "$PID" ] || [ "$PID" = "1" ] && break

    # Linux: read PTY device from /proc (skipped where /proc doesn't exist).
    if [ "$_HAS_PROC" = 1 ]; then
        PTY=$(readlink "/proc/${PID}/fd/0" 2>/dev/null)
        if [ -c "$PTY" ] 2>/dev/null; then
            read -r _ COLS < <(stty size < "$PTY" 2>/dev/null)
            [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
        fi
    fi

    # macOS/BSD: /proc doesn't exist — get the TTY name from the process table.
    read -r TTY_NAME < <(ps -o tty= -p "$PID" 2>/dev/null)
    if [ -n "$TTY_NAME" ] && [ "$TTY_NAME" != "??" ] && [ "$TTY_NAME" != "?" ]; then
        TTY_DEV="/dev/$TTY_NAME"
        if [ -c "$TTY_DEV" ] 2>/dev/null; then
            read -r _ COLS < <(stty size < "$TTY_DEV" 2>/dev/null)
            [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
        fi
    fi
done
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=${COLUMNS:-0}
# Windows: /proc and TTY device detection don't exist; use PowerShell as fallback
if [ "${COLS:-0}" -lt 40 ] 2>/dev/null; then
    _ps_cols=$(powershell.exe -NoProfile -Command "(Get-Host).UI.RawUI.WindowSize.Width" 2>/dev/null | tr -d '\r\n')
    case "$_ps_cols" in ''|*[!0-9]*) ;; *) [ "$_ps_cols" -gt 40 ] 2>/dev/null && COLS=$_ps_cols ;; esac
fi
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=125

# ─── Reaction bubble (with TTL check) ────────────────────────────────────────
BUBBLE=""
if [ -n "$ACHIEVEMENT" ] && [ "$ACHIEVEMENT" != "null" ] && [ "$ACHIEVEMENT" != "" ]; then
    BUBBLE=$'\xf0\x9f\x8f\x86'" $ACHIEVEMENT"
fi
REACTION_FILE="$BUDDY_STATE_DIR/reaction.$SID.json"
# REACTION_TTL / INNER_W / MARGIN come (validated) from the single config read.

# ─── Idle wander clamp (movement design-movement §5b / §7.B / §7.C) ─────────
# The corridor is reclaimed from the right MARGIN; bash owns the clamp because
# only it knows MARGIN/COLS (the baked sequence carries raw offsets). §7.C
# resize robustness is automatic — MARGIN/COLS are recomputed every tick, so a
# shrink caps WANDER_OFF on the next tick and the buddy never clips. §7.B wide
# mode (flag wanderWide, full-gated) opens a left lane: it shifts the whole
# bubble+art block left by a CONSTANT WANDER_LEFT (folded into PAD below, once)
# so the corridor can span WANDER_RANGE_WIDE without the per-tick offset moving
# anything. WANDER_PAD is plain spaces (never trimmed). WANDER_MAX=0 ⇒ park.
# WANDER_WIDE / WANDER_BUBBLE come from the single config read above. wanderBubble
# (design-movement §5e): when true the bubble+connector travel WITH the buddy as
# one rigid block (connector stays attached) instead of the bubble staying pinned
# + connector retracting. Pure render flags.
# Free-roam (design-movement §11): the buddy is no longer confined to a tiny
# right-margin corridor. WANDER_OFF (the raw baked offset) is the number of cells
# the buddy ambles LEFT of its right-edge home; the actual roam range is the full
# span between the stats panel and the window edge, computed + clamped in the
# layout section below (which is the first place ART_W/BOX_W — the cluster width —
# are known). The bubble travels WITH the buddy as one block (the offset lands in
# the cluster's leading pad), so the per-segment WANDER_PADs are now no-ops.
# wanderWide is retired (the whole line is the lane); the flag is ignored.
WANDER_PAD_BUBBLE=""
WANDER_PAD_ART=""

# SHOW_STATS (stats panel), SHOW_PRESTIGE_BADGE (prestige/streak badge) and
# USE_COMBINED (model/context/usage/reset row) all come from the single config
# read above — still live each tick (the whole script reruns at ~1 Hz), so a
# config toggle still applies without a restart.
# Celebration channel (game-feel §2): a transient message that overrides the
# normal reaction in the bubble while fresh. Freshness (_CELEB_FRESH) and the
# text (_CELEB_TEXT) were computed once up in the animation block, so the toast
# and the frame flourish share a single TTL evaluation.
CELEB_SHOWN=0
if [ "$_CELEB_FRESH" = 1 ]; then
    if [ -n "$BUBBLE" ]; then
        BUBBLE="$BUBBLE | ${_CELEB_TEXT}"
    else
        BUBBLE="${_CELEB_TEXT}"
    fi
    CELEB_SHOWN=1
fi

# Sticky bubble: status.json's .reaction is volatile — an incidental status
# refresh (writeStatusState with no reaction) clears it to "". The per-session
# reaction.$SID.json instead persists the LAST real reaction (hooks only ever
# write it with content), so fall back to it when the live field is empty. The
# bubble then stays until a new message replaces it. The TTL check below still
# uses this file's timestamp, so an opt-in reactionTTL>0 keeps expiring as before.
if { [ -z "$REACTION" ] || [ "$REACTION" = "null" ]; } && [ -f "$REACTION_FILE" ]; then
    REACTION=$(jq -r '.reaction // ""' "$REACTION_FILE" 2>/dev/null || echo "")
fi

if [ "$CELEB_SHOWN" -eq 0 ] && [ -n "$REACTION" ] && [ "$REACTION" != "null" ] && [ "$REACTION" != "" ]; then
    FRESH=0
    if [ "$REACTION_TTL" -eq 0 ]; then
        FRESH=1
    elif [ -f "$REACTION_FILE" ]; then
        TS=$(jq -r '.timestamp // 0' "$REACTION_FILE" 2>/dev/null || echo 0)
        if [ "$TS" != "0" ]; then
            # Use the top-level NOW (honors BUDDY_FAKE_NOW), consistent with the
            # celebration/xp age checks — don't re-fetch the real clock here.
            AGE=$(( NOW - TS / 1000 ))
            [ "$AGE" -lt "$REACTION_TTL" ] && FRESH=1
        fi
    fi
    if [ "$FRESH" -eq 1 ]; then
        if [ -n "$BUBBLE" ]; then
            BUBBLE="$BUBBLE | \"${REACTION}\""
        else
            BUBBLE="\"${REACTION}\""
        fi
    fi
fi

# ─── Build all art lines ──────────────────────────────────────────────────────
# ART_LINES comes from the pre-rendered frame (already includes hat + blink).
# Center the name under the art. Frames are 12 cols wide (see server/art.ts),
# so the geometric center sits at col 6.
NAME_WITH_LEVEL="$NAME"
[ "$LEVEL" -gt 1 ] 2>/dev/null && NAME_WITH_LEVEL="${NAME} [L${LEVEL}]"
case "$MOOD" in
    happy)       MOOD_EMOJI="" ;;
    focused)     MOOD_EMOJI="" ;;
    excited)     MOOD_EMOJI="" ;;
    tired)       MOOD_EMOJI="" ;;
    melancholy)  MOOD_EMOJI="" ;;
    chaotic)     MOOD_EMOJI="" ;;
    *)           MOOD_EMOJI="" ;;
esac
NAME_WITH_LEVEL="${NAME_WITH_LEVEL}${MOOD_EMOJI}"
NAME_LEN=${#NAME_WITH_LEVEL}
# Idle art is 12 cols wide ⇒ centre at col 6. The Phase 5 combat scene is wider
# (server-emitted ART_WIDTH); re-centre the name/title under it. Scoped to the
# combat path so idle renders keep ART_CENTER=6 byte-identical.
if [ "$_COMBAT_ON" = 1 ] && [ "$ART_WIDTH" -gt 0 ]; then
    ART_CENTER=$(( ART_WIDTH / 2 ))
else
    ART_CENTER=6
fi
NAME_PAD=$(( ART_CENTER - NAME_LEN / 2 ))
[ "$NAME_PAD" -lt 0 ] && NAME_PAD=0
NAME_LINE="$(printf '%*s%s' "$NAME_PAD" '' "$NAME_WITH_LEVEL")"

DIM=$'\033[2;3m'

ALL_LINES=()
ALL_COLORS=()
_arc=0
for line in "${ART_LINES[@]}"; do
    ALL_LINES+=("$line")
    if [ "$SHINY" = "true" ]; then
        ALL_COLORS+=("${RAINBOW[$(( (_arc + RAINBOW_OFFSET) % RAINBOW_LEN ))]}")
    else
        ALL_COLORS+=("$C")
    fi
    _arc=$(( _arc + 1 ))
done
ALL_LINES+=("$NAME_LINE"); ALL_COLORS+=("$DIM")

# Prestige title (FR5.4): a dimmed, centered line under the name. Wrapped in
# guillemets to read as a title rather than a second name. Centered on the art
# the same way as the name — title names are short ASCII and fit within ART_W.
if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
    TITLE_TEXT="«${TITLE}»"
    TITLE_LEN=${#TITLE_TEXT}
    TITLE_PAD=$(( ART_CENTER - TITLE_LEN / 2 ))
    [ "$TITLE_PAD" -lt 0 ] && TITLE_PAD=0
    TITLE_LINE="$(printf '%*s%s' "$TITLE_PAD" '' "$TITLE_TEXT")"
    ALL_LINES+=("$TITLE_LINE"); ALL_COLORS+=("$DIM")
fi

# Prestige/streak badge (FR1.5): opt-in (default off), a compact centered line
# under the title. "P<tier>" appears once ascended; "🔥<streak>" while on a
# streak. Skipped entirely when both are zero, even if the badge is enabled, so
# the common case adds no clutter.
if [ "$SHOW_PRESTIGE_BADGE" = "true" ]; then
    case "$PRESTIGE" in ''|*[!0-9]*) PRESTIGE=0 ;; esac
    case "$STREAK" in ''|*[!0-9]*) STREAK=0 ;; esac
    BADGE=""
    [ "$PRESTIGE" -gt 0 ] && BADGE="P${PRESTIGE}"
    if [ "$STREAK" -gt 0 ]; then
        if [ -n "$BADGE" ]; then BADGE="$BADGE 🔥${STREAK}"; else BADGE="🔥${STREAK}"; fi
    fi
    if [ -n "$BADGE" ]; then
        BADGE_LEN=${#BADGE}
        BADGE_PAD=$(( ART_CENTER - BADGE_LEN / 2 ))
        [ "$BADGE_PAD" -lt 0 ] && BADGE_PAD=0
        BADGE_LINE="$(printf '%*s%s' "$BADGE_PAD" '' "$BADGE")"
        ALL_LINES+=("$BADGE_LINE"); ALL_COLORS+=("$DIM")
    fi
fi

ART_W=14
# Idle-RPG Phase 5: a fresh two-sprite scene widens the art column to the
# server-emitted scene width so TOTAL_W/PAD reserve the right room and the scene
# stays in-window. Scoped to the combat path ⇒ idle keeps ART_W=14 (byte-ident).
if [ "$_COMBAT_ON" = 1 ] && [ "$ART_WIDTH" -gt "$ART_W" ]; then
    ART_W=$ART_WIDTH
fi
ART_COUNT=${#ALL_LINES[@]}

# ─── Stats panel (optional leftmost column) ─────────────────────────────────
# One line per stat: "ICON ABBR(9) PIPS(10) VAL(3) MARKER(2)" → 26 display
# cols. Pips are sliced from full 10-char templates (no multibyte tr, which
# is byte-oriented and would corrupt ▣/░). Peak gets ▲, dump gets ▼. Each
# stat gets its own color (icon+label+pips) so the panel reads at a glance
# instead of one uniform companion-theme color; ▲/▼ stay green/red since
# that's a rank signal, not the stat's own hue. Icons come from the Geometric
# Shapes block (U+25A0-25FF, same family as ▲▼) — guaranteed single-width in
# every terminal, unlike dingbats/emoji-presentation glyphs (e.g. ⏳ ★) which
# render double-width in some fonts despite being one codepoint, silently
# breaking column alignment. No dwidth() fork needed either way.
STATS_LINES=()
STATS_W=26
if [ "$SHOW_STATS" = "true" ] && [ -n "$STATS_TSV" ]; then
    IFS=$'\t' read -r _S_DBG _S_PAT _S_CHA _S_WIS _S_SNK _S_PEAK _S_DUMP <<< "$STATS_TSV"
    case "$_S_DBG" in
        ''|*[!0-9]*) ;;  # missing/non-numeric (old status.json) → skip panel
        *)
            _FULL_PIPS='▣▣▣▣▣▣▣▣▣▣'
            _EMPTY_PIPS='░░░░░░░░░░'
            _GREEN=$'\033[32m'
            _RED=$'\033[31m'
            _BLUE=$'\033[34m'
            _YELLOW=$'\033[33m'
            _MAGENTA=$'\033[35m'
            _SDIM=$'\033[2m'
            _stat_names=(DEBUGGING PATIENCE CHAOS WISDOM SNARK)
            _stat_glyphs=("■" "◆" "▶" "●" "◀")
            _stat_abbrs=(DBG PAT CHA WIS SNK)
            _stat_colors=("$_RED" "$_BLUE" "$_MAGENTA" "$_YELLOW" "$_GREEN")
            _stat_vals=("$_S_DBG" "$_S_PAT" "$_S_CHA" "$_S_WIS" "$_S_SNK")
            _si=0
            for _sn in "${_stat_names[@]}"; do
                _val=${_stat_vals[$_si]}
                _glyph=${_stat_glyphs[$_si]}
                _abbr=${_stat_abbrs[$_si]}
                _scolor=${_stat_colors[$_si]}
                _si=$(( _si + 1 ))
                case "$_val" in ''|*[!0-9]*) _val=0 ;; esac
                _filled=$(( _val / 10 ))
                [ "$_filled" -gt 10 ] && _filled=10
                _bar="${_FULL_PIPS:0:_filled}${_EMPTY_PIPS:0:$(( 10 - _filled ))}"
                # Label = glyph(1 col) + space + abbr right-padded to 7 = 9 cols.
                # Pad the ASCII abbr ALONE: printf measures its field width in
                # BYTES, so feeding it the glyph (a 3-byte char that renders as
                # 1 col) would eat 2 phantom bytes of the field and leave the
                # label 2 display cols short — shifting every column to its
                # right (the Lv row, bubble, and buddy would no longer align).
                printf -v _abbr_pad '%-7s' "$_abbr"
                _label="${_glyph} ${_abbr_pad}"
                _valstr=$(printf '%3d' "$_val")
                if [ "$_sn" = "$_S_PEAK" ]; then
                    _mark=" ${_GREEN}▲${NC}"
                elif [ "$_sn" = "$_S_DUMP" ]; then
                    _mark=" ${_RED}▼${NC}"
                else
                    _mark="  "
                fi
                STATS_LINES+=("${_scolor}${_label}${NC} ${_scolor}${_bar}${NC} ${_SDIM}${_valstr}${NC}${_mark}")
            done

            # XP progress row, below the 5 stat bars. Same pip style; shows a
            # transient blue "+N XP" toast for ~10s after an award.
            IFS=$'\t' read -r _XP_AMT _XP_AT <<< "$XP_GAIN_TSV"
            case "$_XP_AMT" in ''|*[!0-9]*) _XP_AMT=0 ;; esac
            case "$_XP_AT" in ''|*[!0-9]*) _XP_AT=0 ;; esac
            case "$XP_PCT" in ''|*[!0-9]*) XP_PCT=0 ;; esac
            _xp_filled=$(( XP_PCT / 10 ))
            [ "$_xp_filled" -gt 10 ] && _xp_filled=10
            [ "$_xp_filled" -lt 0 ] && _xp_filled=0
            _xp_bar="${_FULL_PIPS:0:_xp_filled}${_EMPTY_PIPS:0:$(( 10 - _xp_filled ))}"
            _xp_label=$(printf '%-9s' "Lv${LEVEL}")
            _xp_pctstr=$(printf '%3d%%' "$XP_PCT")
            # The transient toast adds width to this one row. Fold that width
            # into STATS_W (and backfill the rows already built) so every row in
            # the stats column shares one width — otherwise the toast pushes the
            # gap/bubble/art right on the Lv row alone and the buddy's name
            # "shifts" (and can truncate). Growing STATS_W keeps the art pinned:
            # its position is independent of STATS_W (the extra width is absorbed
            # from the mid-line slack), so the buddy stays put. Plain (ANSI-free)
            # widths: Lv row is label 9 + 1 + bar 10 + 1 + pct 4 = 25 cols; the
            # toast " +N XP" is 5 + len(N).
            _xp_toast=""
            _xp_row_w=25
            if [ "$_XP_AMT" -gt 0 ] && [ "$_XP_AT" -gt 0 ]; then
                _xp_at_s=$(( _XP_AT / 1000 ))
                _xp_age=$(( NOW - _xp_at_s ))
                if [ "$_xp_age" -ge 0 ] && [ "$_xp_age" -le 10 ]; then
                    _xp_toast=" ${_BLUE}+${_XP_AMT} XP${NC}"
                    _xp_row_w=$(( 25 + 5 + ${#_XP_AMT} ))
                fi
            fi
            if [ "$_xp_row_w" -gt "$STATS_W" ]; then
                _XP_EXTRA_PAD=$(printf '%*s' "$(( _xp_row_w - STATS_W ))" '')
                for _bi in "${!STATS_LINES[@]}"; do
                    STATS_LINES[$_bi]="${STATS_LINES[$_bi]}${_XP_EXTRA_PAD}"
                done
                STATS_W=$_xp_row_w
            fi
            # Pad the Lv row itself out to the (possibly grown) column width so it
            # matches the stat rows exactly (fixes a latent 1-col under-width).
            _XP_ROW_PAD=$(printf '%*s' "$(( STATS_W - _xp_row_w ))" '')
            STATS_LINES+=("${_SDIM}${_xp_label}${NC} ${C}${_xp_bar}${NC} ${_SDIM}${_xp_pctstr}${NC}${_xp_toast}${_XP_ROW_PAD}")
            ;;
    esac
fi

# Combined-mode metrics: model/context/usage/reset. Rendered on its OWN
# full-width line ABOVE the buddy block (see the print site before the per-line
# loop), NOT folded into the stats column. Folding it in grew STATS_W to the
# long, variable model-name width — which both shoved the buddy cluster right
# and let the speech bubble crowd the metrics text when the buddy roamed left
# toward it. A standalone header decouples the two: stats keep their fixed
# 26-col width and the bubble keeps its room.
METRICS_HEADER=""
if [ "$USE_COMBINED" = "true" ]; then
    _METRICS_TSV=$(printf '%s' "$CC_INPUT" | jq -r '
        [
            (.model.display_name // ""),
            (.context_window.context_window_size // ""),
            (.context_window.used_percentage // ""),
            (.rate_limits.five_hour.used_percentage // ""),
            (.rate_limits.five_hour.resets_at // "")
        ] | join("")
    ' 2>/dev/null)
    if [ -n "$_METRICS_TSV" ]; then
        IFS=$'\x1f' read -r _M_MODEL _M_CTX_SIZE _M_CTX _M_USAGE _M_RESET <<< "$_METRICS_TSV"
        _SDIM=$'\033[2m'
        _METRICS_PARTS=()
        if [ -n "$_M_MODEL" ]; then
            _MODEL_TAG=$(printf '%s' "$_M_MODEL" | tr '[:upper:]' '[:lower:]')
            case "$_M_CTX_SIZE" in
                ''|*[!0-9]*) ;;
                *) [ "$_M_CTX_SIZE" -ge 1000000 ] && _MODEL_TAG="${_MODEL_TAG}[1m]" ;;
            esac
            _METRICS_PARTS+=("$_MODEL_TAG")
        fi
        case "$_M_CTX" in
            ''|*[!0-9.]*) ;;
            *) _METRICS_PARTS+=("ctx $(printf '%.0f' "$_M_CTX")%") ;;
        esac
        case "$_M_USAGE" in
            ''|*[!0-9.]*) ;;
            *) _METRICS_PARTS+=("usage $(printf '%.0f' "$_M_USAGE")%") ;;
        esac
        case "$_M_RESET" in
            ''|*[!0-9]*) ;;
            *)
                _SECS_LEFT=$(( _M_RESET - NOW ))
                if [ "$_SECS_LEFT" -gt 0 ]; then
                    _HRS=$(( _SECS_LEFT / 3600 ))
                    _MINS=$(( (_SECS_LEFT % 3600) / 60 ))
                    _METRICS_PARTS+=("reset ${_HRS}h${_MINS}m")
                fi
                ;;
        esac
        if [ ${#_METRICS_PARTS[@]} -gt 0 ]; then
            _METRICS_LINE="${_METRICS_PARTS[0]}"
            for (( _mi=1; _mi<${#_METRICS_PARTS[@]}; _mi++ )); do
                _METRICS_LINE="${_METRICS_LINE} · ${_METRICS_PARTS[$_mi]}"
            done
            # Stash for the standalone header line printed above the buddy block.
            # No STATS_W coupling and no padding: it owns its own full-width line,
            # so its (variable) length can't push the stats column / bubble / art.
            METRICS_HEADER="${_SDIM}${_METRICS_LINE}${NC}"
        fi
    fi
fi

STATS_COUNT=${#STATS_LINES[@]}

# ─── Speech bubble (left of art, word-wrapped) ──────────────────────────────
# Strip the quotes we added earlier
BUBBLE_TEXT=""
if [ -n "$BUBBLE" ]; then
    BUBBLE_TEXT="${BUBBLE%\"}"
    BUBBLE_TEXT="${BUBBLE_TEXT#\"}"
fi

# ─── Display width (emojis count as 2 cols) ──────────────────────────────────
# iconv turns the string into a stream of UTF-32LE codepoints, then awk sums
# widths. Rules mirror server/art.ts:displayWidth — the U+2600-U+27BF range
# is split by Emoji_Presentation (2) vs text-presentation (1), and VS16
# (U+FE0F) upgrades the previous narrow symbol to 2 cols (e.g. ❤ + VS16).
# The ambiguous codepoint list comes from emoji-widths.data, generated by
# scripts/gen-emoji-widths.ts from the Unicode Emoji_Presentation property.
EMOJI_WIDTHS_DATA="$(dirname "${BASH_SOURCE[0]}")/emoji-widths.data"
EMOJI_PRES_2600="$(grep -v '^#' "$EMOJI_WIDTHS_DATA" 2>/dev/null | tr -d '\n')"

dwidth() {
    printf '%s' "$1" | iconv -f UTF-8 -t UTF-32LE 2>/dev/null | od -An -tu4 | awk -v pres="$EMOJI_PRES_2600" '
    BEGIN {
        n = split(pres, arr)
        for (k = 1; k <= n; k++) wide[arr[k]] = 1
    }
    # Precondition: cp is neither a variation selector (65024-65039) nor ZWJ
    # (8205); the main loop filters those before calling in.
    function char_width(cp) {
        if (cp >= 126976) return 2
        if (cp >= 9728 && cp <= 10175) return (cp in wide) ? 2 : 1
        if (cp >= 9472 && cp <= 9631) return 1
        if (cp >= 12288 && cp <= 40959) return 2
        if (cp >= 65281 && cp <= 65376) return 2
        return 1
    }
    { for (i = 1; i <= NF; i++) {
        cp = $i + 0
        if (cp == 65039) {
            if (upgradable) { w += 1; upgradable = 0 }
            continue
        }
        if ((cp >= 65024 && cp <= 65038) || cp == 8205) { upgradable = 0; continue }
        cw = char_width(cp)
        w += cw
        upgradable = (cw == 1 && cp >= 9728 && cp <= 10175) ? 1 : 0
    } }
    END { print w+0 }'
}

# ─── Word-wrap bubble text ────────────────────────────────────────────────────
TEXT_LINES=()
if [ -n "$BUBBLE_TEXT" ]; then
    WORDS=($BUBBLE_TEXT)
    CUR_LINE=""
    CUR_W=0
    for word in "${WORDS[@]}"; do
        word_w=$(dwidth "$word")
        if [ -z "$CUR_LINE" ]; then
            CUR_LINE="$word"; CUR_W=$word_w
        elif [ $(( CUR_W + 1 + word_w )) -le $INNER_W ]; then
            CUR_LINE="$CUR_LINE $word"; CUR_W=$(( CUR_W + 1 + word_w ))
        else
            TEXT_LINES+=("$CUR_LINE")
            CUR_LINE="$word"; CUR_W=$word_w
        fi
    done
    [ -n "$CUR_LINE" ] && TEXT_LINES+=("$CUR_LINE")
fi

TEXT_COUNT=${#TEXT_LINES[@]}

# Build box as plain strings (no ANSI). Color applied at output time.
# Box display width = INNER_W + 4:  "| " + text(INNER_W) + " |"
BOX_W=$(( INNER_W + 4 ))
BUBBLE_LINES=()
BUBBLE_TYPES=()  # "border" or "text" — determines coloring
if [ $TEXT_COUNT -gt 0 ]; then
    # Top border
    BORDER=$(printf '%*s' "$(( BOX_W - 2 ))" '' | tr ' ' '-')
    BUBBLE_LINES+=(".${BORDER}.")
    BUBBLE_TYPES+=("border")
    # Text rows: "| text padded |"
    for tl in "${TEXT_LINES[@]}"; do
        tpad=$(( INNER_W - $(dwidth "$tl") ))
        [ "$tpad" -lt 0 ] && tpad=0
        padding=$(printf '%*s' "$tpad" '')
        BUBBLE_LINES+=("| ${tl}${padding} |")
        BUBBLE_TYPES+=("text")
    done
    # Bottom border
    BUBBLE_LINES+=("\`${BORDER}'")
    BUBBLE_TYPES+=("border")
fi

BUBBLE_COUNT=${#BUBBLE_LINES[@]}

# ─── Free-roam layout: left-anchored stats + a roaming buddy cluster ─────────
# (design-movement §11.) The stats panel (when shown) is anchored at the left
# edge. The buddy CLUSTER = [bubble + connector + art] travels as one rigid block
# between the stats panel (left bound) and the window edge (right bound), and is
# clamped to stay fully in-window — so the buddy never clips when stats+cluster
# fit in COLS (the old right-align with a fixed MARGIN reserve could overflow at
# narrow widths). ART_W is the live sprite width (14 idle, the wide scene during
# a fight).
STATS_GAP=2
STATS_LEFT_MARGIN=1
# Right-edge reserve. This is NOT dead margin: Claude Code renders the status
# line inside its own viewport with a small LEFT gutter (a few cols of indent on
# every row), so a cluster pinned at COLS-1 gets shifted off the right edge and
# the buddy clips. RIGHT_SAFETY must clear that gutter (plus a little breathing
# room). It's driven by the configurable bubbleMargin (MARGIN, default 8) so the
# cushion is tunable per terminal without editing the script — reviving the knob
# the free-roam rewrite had orphaned. Clamp ≥1 so a config of 0 still reserves a col.
RIGHT_SAFETY=$MARGIN
[ "$RIGHT_SAFETY" -lt 1 ] 2>/dev/null && RIGHT_SAFETY=1
# The bubble→art connector gap is rendered as 3 cols ("-- " / "   "), so the
# cluster width must count 3 here (not GAP) or the home position overflows by 1.
CONNECTOR_W=3
STATS_BLOCK=0
[ $STATS_COUNT -gt 0 ] && STATS_BLOCK=$(( STATS_LEFT_MARGIN + STATS_W + STATS_GAP ))
CLUSTER_W=$ART_W
[ $BUBBLE_COUNT -gt 0 ] && CLUSTER_W=$(( BOX_W + CONNECTOR_W + CLUSTER_W ))
# Degradation (design-movement §11 / OQ-P5.2): when stats + the full cluster
# can't fit in COLS, DROP THE BUBBLE so the buddy sprite (the rightmost, most
# important element) stays in-window. Sprite visibility always wins over the
# speech bubble at narrow widths.
if [ $BUBBLE_COUNT -gt 0 ] && [ $(( COLS - STATS_BLOCK - CLUSTER_W - RIGHT_SAFETY )) -lt 0 ]; then
    BUBBLE_COUNT=0
    BUBBLE_LINES=()
    CLUSTER_W=$ART_W
fi
# The full horizontal span the cluster's left edge may occupy. Clamped ≥ 0; when
# 0 (terminal too narrow even for stats + the lone sprite) the cluster pins to
# its left bound and only that absolute-narrow case clips.
SPAN=$(( COLS - STATS_BLOCK - CLUSTER_W - RIGHT_SAFETY ))
[ "$SPAN" -lt 0 ] && SPAN=0
# Home is the right edge (ROAM=SPAN); WANDER_OFF ambles the cluster LEFT toward
# the stats, clamped so it can neither cross the stats nor leave the window.
ROAM=$(( SPAN - WANDER_OFF ))
[ "$ROAM" -lt 0 ] && ROAM=0
[ "$ROAM" -gt "$SPAN" ] && ROAM=$SPAN

if [ $STATS_COUNT -gt 0 ]; then
    LEAD_PAD=$STATS_LEFT_MARGIN
    MID_PAD=$ROAM
else
    LEAD_PAD=$ROAM
    MID_PAD=0
fi

# On Windows (Git Bash / MSYS2), Braille Blank (U+2800) renders as double-width,
# which doubles the spacer and pushes content off-screen. Use regular spaces instead.
# MID_SPACER sits mid-line (never trimmed), so it's always plain spaces — only
# the line-leading SPACER needs the non-trimmable Braille Blank.
case "$(uname -s)" in
    MINGW*|CYGWIN*|MSYS*) SPACER=$(printf '%*s' "$LEAD_PAD" '') ;;
    *)                     SPACER=$(printf "${B}%${LEAD_PAD}s" "") ;;
esac
MID_SPACER=$(printf '%*s' "$MID_PAD" '')
STATS_GAP_STR=$(printf '%*s' "$STATS_GAP" '')

# ─── Idle wander hop headroom (movement §7.A, flag wanderHop) ───────────────
# Reserve HOP_RESERVE blank rows above the art ONLY when the server baked a
# non-empty wanderRowSequence (hop on). Headroom = the sequence's max so it is
# constant across ticks — the block height never changes, so the bubble/stats
# (centered on the total height below) can't bob. Collapse to 0 if the block
# would blow the height budget (degrade, NFR7); WANDER_ROW resets so the
# connector logic and art position stay consistent with "no hop".
HOP_RESERVE=0
if [ "$WANDER_ROW_MAX" -gt 0 ]; then
    HOP_RESERVE=$WANDER_ROW_MAX
    HOP_CAP=2
    [ "$HOP_RESERVE" -gt "$HOP_CAP" ] && HOP_RESERVE=$HOP_CAP
    HOP_BUDGET=12
    if [ $(( ART_COUNT + HOP_RESERVE )) -gt "$HOP_BUDGET" ]; then
        HOP_RESERVE=0
        WANDER_ROW=0
    fi
fi
ART_COUNT_TOTAL=$(( ART_COUNT + HOP_RESERVE ))
# Art's top row within the block: WANDER_ROW=0 rests on the floor (below the
# headroom); WANDER_ROW=HOP_RESERVE touches the ceiling.
ART_TOP=$(( HOP_RESERVE - WANDER_ROW ))
[ "$ART_TOP" -lt 0 ] && ART_TOP=0

# Vertically center each left column on the FLOOR baseline (the full block
# height incl. headroom), independent of the live hop row → no vertical bob.
BUBBLE_START=0
if [ $BUBBLE_COUNT -gt 0 ] && [ $BUBBLE_COUNT -lt $ART_COUNT_TOTAL ]; then
    BUBBLE_START=$(( (ART_COUNT_TOTAL - BUBBLE_COUNT) / 2 ))
fi
STATS_START=0
if [ $STATS_COUNT -gt 0 ] && [ $STATS_COUNT -lt $ART_COUNT_TOTAL ]; then
    STATS_START=$(( (ART_COUNT_TOTAL - STATS_COUNT) / 2 ))
fi

# ─── Find the connector line (middle text line → points to buddy's mouth) ─────
# The connector goes on the middle text row of the bubble
CONNECTOR_BI=-1
if [ $BUBBLE_COUNT -gt 2 ]; then
    # text rows are indices 1..(BUBBLE_COUNT-2), pick the middle one
    FIRST_TEXT=1
    LAST_TEXT=$(( BUBBLE_COUNT - 2 ))
    CONNECTOR_BI=$(( (FIRST_TEXT + LAST_TEXT) / 2 ))
fi
# Free-roam (design-movement §11): the bubble now ALWAYS travels with the buddy
# as one rigid cluster (the chosen default), so the connector stays attached for
# horizontal motion regardless of how far the buddy roams. Only a vertical hop
# (WANDER_ROW>0), where the mouth sits on a different row, still retracts it.
[ "$WANDER_ROW" -gt 0 ] && CONNECTOR_BI=-1

# ─── Combined-mode metrics header (standalone full-width line, above) ────────
# Printed before the buddy block so it never shares a row with — or inflates the
# width of — the stats column/bubble. Indented to line up with the stats panel's
# left edge; the lead uses Braille Blank (like SPACER) so a JS .trim() can't eat
# it and shift the header left of the stats below it.
if [ -n "$METRICS_HEADER" ]; then
    # Same lead idiom as SPACER (B + margin spaces) so the header aligns with the
    # stats column below whether or not the stats panel itself is shown.
    case "$(uname -s)" in
        MINGW*|CYGWIN*|MSYS*) _MH_LEAD=$(printf '%*s' "$STATS_LEFT_MARGIN" '') ;;
        *)                     _MH_LEAD=$(printf "${B}%${STATS_LEFT_MARGIN}s" "") ;;
    esac
    echo "${_MH_LEAD}${METRICS_HEADER}"
fi

# ─── Output: merged stats panel + bubble + connector + art per line ──────────
TOTAL_BUBBLE=$(( BUBBLE_START + BUBBLE_COUNT ))
TOTAL_STATS=$(( STATS_START + STATS_COUNT ))
MAX_LINES=$ART_COUNT_TOTAL
[ $TOTAL_BUBBLE -gt $MAX_LINES ] && MAX_LINES=$TOTAL_BUBBLE
[ $TOTAL_STATS -gt $MAX_LINES ] && MAX_LINES=$TOTAL_STATS
for (( i=0; i<MAX_LINES; i++ )); do
    # Art part: actual art line (shifted down by the hop headroom, up by the
    # live hop row) or blank filler.
    ai=$(( i - ART_TOP ))
    if [ $ai -ge 0 ] && [ $ai -lt $ART_COUNT ]; then
        art_part="${ALL_COLORS[$ai]}${ALL_LINES[$ai]}${NC}"
    else
        art_part=$(printf '%*s' "$ART_W" '')
    fi

    line_out="$SPACER"

    # Stats column (leftmost) — pre-colored, fixed STATS_W display width
    if [ $STATS_COUNT -gt 0 ]; then
        si=$(( i - STATS_START ))
        if [ $si -ge 0 ] && [ $si -lt $STATS_COUNT ]; then
            line_out+="${STATS_LINES[$si]}"
        else
            line_out+=$(printf '%*s' "$STATS_W" '')
        fi
        line_out+="$STATS_GAP_STR"
        line_out+="$MID_SPACER"
    fi

    # §5e: when the bubble travels with the buddy, the offset is inserted here —
    # before the whole bubble cluster — so bubble+connector+art shift together.
    # Empty (no-op) in the default pinned-bubble mode. Applied on every row so
    # blank-bubble rows (top/bottom art) translate by the same amount.
    line_out+="$WANDER_PAD_BUBBLE"

    # Bubble column
    if [ $BUBBLE_COUNT -gt 0 ]; then
        bi=$(( i - BUBBLE_START ))
        if [ $bi -ge 0 ] && [ $bi -lt $BUBBLE_COUNT ]; then
            bline="${BUBBLE_LINES[$bi]}"
            btype="${BUBBLE_TYPES[$bi]}"

            # Connector: "-- " on the middle text line, spaces otherwise
            if [ $bi -eq $CONNECTOR_BI ]; then
                gap="${C}--${NC} "
            else
                gap="   "
            fi

            if [ "$btype" = "border" ]; then
                line_out+="${C}${bline}${NC}${gap}"
            else
                pipe_l="${bline:0:1}"
                pipe_r="${bline: -1}"
                inner="${bline:1:$(( ${#bline} - 2 ))}"
                line_out+="${C}${pipe_l}${NC}${DIM}${inner}${NC}${C}${pipe_r}${NC}${gap}"
            fi
        else
            line_out+=$(printf '%*s' "$BOX_W" '')
            line_out+="   "
        fi
    fi

    # Idle wander (design-movement §5d): nudge the art block right into the
    # reclaimed margin. In the default mode this is the whole offset (bubble
    # pinned); with wanderBubble on it's empty because the offset already shifted
    # the bubble cluster above (art rode along, connector attached).
    line_out+="$WANDER_PAD_ART"
    line_out+="$art_part"
    echo "$line_out"
done

exit 0
