#!/usr/bin/env node
// Runs a single Claude Code SDK turn inside the container.
// Usage: node cw-claude-sdk.js <session_id|new> <message...>
// Streams JSON message lines to stdout. Writes final session_id to stderr.
'use strict'

const { query } = require('@anthropic-ai/claude-code')

async function main() {
  const rawSessionId = process.argv[2]
  const sessionId = (!rawSessionId || rawSessionId === 'new') ? undefined : rawSessionId
  const message = process.argv.slice(3).join(' ')

  if (!message) {
    process.stderr.write('ERROR: no message provided\n')
    process.exit(1)
  }

  let lastSessionId = null

  const options = {
    dangerouslySkipPermissions: true,
    ...(sessionId ? { resume: sessionId } : {})
  }

  for await (const msg of query({ prompt: message, options })) {
    process.stdout.write(JSON.stringify(msg) + '\n')
    if (msg.session_id) lastSessionId = msg.session_id
  }

  process.stderr.write(lastSessionId ?? '')
}

main().catch((err) => {
  process.stderr.write('ERROR: ' + err.message + '\n')
  process.exit(1)
})
