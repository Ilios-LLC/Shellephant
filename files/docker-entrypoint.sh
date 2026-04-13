#!/usr/bin/env bash
set -euo pipefail

CLAUDE_JSON="${HOME}/.claude.json"

# Self-heal in case a volume mount hid the baked config.
if [ ! -f "$CLAUDE_JSON" ]; then
  echo '{"hasCompletedOnboarding":true,"theme":"dark","customApiKeyResponses":{"approved":[],"rejected":[]}}' > "$CLAUDE_JSON"
fi

# Stamp the last-20-char suffix of the API key into customApiKeyResponses.approved
# so Claude Code skips the "trust this ANTHROPIC_API_KEY" prompt.
# Note the space in ${VAR: -20} — without it, bash parses as :- default-value operator.
SUFFIX=""
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  SUFFIX="${ANTHROPIC_API_KEY: -20}"
fi

# Trust the workdir so claude doesn't show the "Is this a project you trust?" dialog.
WORKDIR_TRUST="${PWD:-/workspace}"

tmp="$(mktemp)"
jq --arg s "$SUFFIX" --arg wd "$WORKDIR_TRUST" '
  .customApiKeyResponses = (.customApiKeyResponses // {}) |
  .customApiKeyResponses.approved = (.customApiKeyResponses.approved // []) |
  .customApiKeyResponses.rejected = (.customApiKeyResponses.rejected // []) |
  (if $s != "" then .customApiKeyResponses.approved = ((.customApiKeyResponses.approved + [$s]) | unique) else . end) |
  .hasCompletedOnboarding = true |
  .theme = (.theme // "dark") |
  .projects = (.projects // {}) |
  .projects[$wd] = ((.projects[$wd] // {}) + {
    "hasTrustDialogAccepted": true,
    "hasCompletedProjectOnboarding": true,
    "projectOnboardingSeenCount": 1
  })
' "$CLAUDE_JSON" > "$tmp" && mv "$tmp" "$CLAUDE_JSON"

exec "$@"
