#!/usr/bin/env bash
# claude-buddy UserPromptSubmit hook — Buddy Quest commands.
#
# A prompt starting with ";" is a game command (";x", ";a", ";bag" ...). It is
# answered locally and BLOCKED, so it never reaches the model: zero tokens.
# Every other prompt exits after a pure-bash prefix check — no jq, no bun,
# no extra process on the normal path.

INPUT=""
IFS= read -r -d '' INPUT || true

# Cheap gate: the JSON "prompt" value must start with ";" (allowing leading
# whitespace). Anything else is not ours.
_RE='"prompt"[[:space:]]*:[[:space:]]*"[[:space:]]*;'
[[ $INPUT =~ $_RE ]] || exit 0

command -v bun >/dev/null 2>&1 || {
    printf '%s' '{"decision":"block","reason":"Buddy Quest needs bun on PATH (curl -fsSL https://bun.sh/install | bash)."}'
    exit 0
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
printf '%s' "$INPUT" | bun run "$ROOT/server/rpg/cli.ts" --hook
exit 0
