#!/usr/bin/env bash
# Called by an async Claude Code Stop hook.
# Generates a JSON summary (title + bullets) from the conversation transcript
# and writes it atomically to /tmp/claude-summary.json for the host waitingPoller.
set -euo pipefail
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

RESULT=$(claude --print \
  "Read this conversation transcript. Focus only on code changes made — ignore discussion, questions, and explanations. Output ONLY a JSON object with two fields: \"title\" (string, ≤50 chars, conventional commit format e.g. 'feat: add retry logic', imperative mood, present tense) and \"bullets\" (array of ≤5 strings, each naming a specific code change: what file or behavior changed). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0

TMP=$(mktemp /tmp/claude-summary.XXXXXX)
printf '%s' "$RESULT" > "$TMP"
mv "$TMP" /tmp/claude-summary.json
