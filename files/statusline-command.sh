#!/usr/bin/env bash
# Claude Code status line script
# Reads JSON from stdin (provided by Claude Code) and outputs a status line.

input=$(cat)

# --- Attention flags ---
# Set by the Stop hook (touch /tmp/claude-waiting) when Claude finishes a task.
attention=""
if [ -f /tmp/claude-waiting ]; then
  attention="** CLAUDE WAITING **"
fi

# shellephant signals via /tmp/shellephant-waiting when it needs attention.
if [ -f /tmp/shellephant-waiting ]; then
  if [ -n "$attention" ]; then
    attention="$attention + SHELLEPHANT"
  else
    attention="** SHELLEPHANT WAITING **"
  fi
fi

# --- Session info from Claude Code JSON ---
model=$(echo "$input" | jq -r '.model.display_name // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Shorten home directory to ~
if [ -n "$cwd" ]; then
  cwd="${cwd/#$HOME/\~}"
fi

# Build the output parts
parts=""

if [ -n "$attention" ]; then
  parts="$attention"
fi

if [ -n "$model" ]; then
  [ -n "$parts" ] && parts="$parts | $model" || parts="$model"
fi

if [ -n "$cwd" ]; then
  [ -n "$parts" ] && parts="$parts | $cwd" || parts="$cwd"
fi

if [ -n "$used_pct" ]; then
  used_int=$(printf '%.0f' "$used_pct")
  [ -n "$parts" ] && parts="$parts | ctx: ${used_int}% used" || parts="ctx: ${used_int}% used"
fi

echo "$parts"
