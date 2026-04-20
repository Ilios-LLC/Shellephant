#!/usr/bin/env node
// Runs a single Claude Agent SDK turn inside the container.
// Usage: node cw-claude-sdk.js <session_id|new> <message...>
// Streams JSON message lines to stdout. Writes final session_id to stderr.

async function main() {
  const { query } = await import('/usr/local/share/npm-global/lib/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')
  const rawSessionId = process.argv[2]
  const sessionId = (!rawSessionId || rawSessionId === 'new') ? undefined : rawSessionId
  const message = process.argv.slice(3).join(' ')

  if (!message) {
    process.stderr.write('ERROR: no message provided\n')
    process.exit(1)
  }

  // Only trust session_id from the canonical boundary events: `system/init`
  // (session start) and `result` (session end). Subagent events and
  // task_progress events carry their own session_id and would otherwise
  // overwrite the main session id, making the next --resume point at an
  // unresumable id.
  let initSessionId = null
  let resultSessionId = null

  const options = {
    dangerouslySkipPermissions: true,
    ...(sessionId ? { resume: sessionId } : {})
  }

  process.stderr.write(`[cw-claude-sdk] resume arg=${sessionId ?? 'none'}\n`)

  for await (const msg of query({ prompt: message, options })) {
    process.stdout.write(JSON.stringify(msg) + '\n')
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      initSessionId = msg.session_id
    } else if (msg.type === 'result' && msg.session_id) {
      resultSessionId = msg.session_id
    }
  }

  // Prefer the `result` session id (terminal/canonical). Fall back to the
  // init session id if no result event arrived (e.g. early exit).
  const finalSessionId = resultSessionId ?? initSessionId
  process.stderr.write(`[cw-claude-sdk] init=${initSessionId ?? '-'} result=${resultSessionId ?? '-'} final=${finalSessionId ?? '-'}\n`)

  if (finalSessionId) {
    process.stdout.write(JSON.stringify({ type: 'session_final', session_id: finalSessionId }) + '\n')
  }
}

main().catch((err) => {
  process.stderr.write('ERROR: ' + err.message + '\n')
  process.exit(1)
})
