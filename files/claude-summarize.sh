#!/usr/bin/env bash
# Called by an async Claude Code Stop hook.
# Generates a JSON summary (title + bullets) from the conversation transcript
# and writes it atomically to /tmp/claude-summary.json for the host waitingPoller.
set -euo pipefail
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

RESULT=$(claude --print \
  "Read this conversation transcript and output ONLY a JSON object with two fields: \"title\" (string, ≤60 chars, summarizes what was accomplished) and \"bullets\" (array of ≤5 strings, key points). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0

TMP=$(mktemp /tmp/claude-summary.XXXXXX)
printf '%s' "$RESULT" > "$TMP"
mv "$TMP" /tmp/claude-summary.json
