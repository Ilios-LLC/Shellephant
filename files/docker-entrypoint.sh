#!/usr/bin/env bash
set -euo pipefail

CLAUDE_JSON="${HOME}/.claude.json"

# Self-heal in case a volume mount hid the baked config.
if [ ! -f "$CLAUDE_JSON" ]; then
  echo '{"hasCompletedOnboarding":true,"theme":"dark"}' > "$CLAUDE_JSON"
fi

# Trust the workdir so claude doesn't show the "Is this a project you trust?" dialog.
WORKDIR_TRUST="${PWD:-/workspace}"

tmp="$(mktemp)"
jq --arg wd "$WORKDIR_TRUST" '
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
