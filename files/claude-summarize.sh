#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

RESULT=$(claude --print \
  "Read this conversation transcript and output ONLY a JSON object with two fields: \"title\" (string, ≤60 chars, summarizes what was accomplished) and \"bullets\" (array of ≤5 strings, key points). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0

printf '%s' "$RESULT" > /tmp/claude-summary.json
