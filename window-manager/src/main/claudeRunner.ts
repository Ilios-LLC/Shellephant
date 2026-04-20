import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { StreamFilterBuffer } from './assistedStreamFilter'
import type { TimelineEvent } from '../shared/timelineEvent'
import type { PermissionMode } from '../shared/permissionMode'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string,
  options: {
    eventType?: string
    permissionMode?: PermissionMode
    onExecEvent?: (type: string, payload: Record<string, unknown>) => void
  } = {}
): Promise<{ output: string; assistantText: string; events: TimelineEvent[]; newSessionId: string | null }> {
  const eventType = options.eventType ?? 'claude:event'
  const permissionMode = options.permissionMode ?? 'bypassPermissions'
  const { onExecEvent } = options
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const execStart = Date.now()
    const command = `docker exec ${containerId} node /usr/local/bin/cw-claude-sdk.js`
    onExecEvent?.('exec_start', { containerId, command, ts: execStart })
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message, permissionMode])

    const filter = new StreamFilterBuffer()
    const contextParts: string[] = []
    const assistantTextParts: string[] = []
    const eventsLog: TimelineEvent[] = []
    let stderr = ''
    let hadAnyOutput = false
    let streamSessionId: string | null = null

    function processDrained(drained: { contextChunks: string[]; events: TimelineEvent[]; sessionId: string | null }) {
      contextParts.push(...drained.contextChunks)
      if (drained.sessionId) streamSessionId = drained.sessionId
      for (const event of drained.events) {
        eventsLog.push(event)
        if (event.kind === 'assistant_text' && event.text) assistantTextParts.push(event.text)
        parentPort?.postMessage({ type: eventType, event })
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      hadAnyOutput = true
      processDrained(filter.push(chunk.toString()))
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      processDrained(filter.flush())
      const durationMs = Date.now() - execStart

      if (code !== 0 && !hadAnyOutput) {
        const errMsg = `docker exec failed (exit ${code}): ${stderr}`
        onExecEvent?.('exec_error', { exitCode: code, durationMs, error: errMsg })
        reject(new Error(errMsg))
        return
      }
      onExecEvent?.('exec_end', {
        exitCode: code,
        durationMs,
        stdoutSnippet: contextParts.join('\n').slice(0, 200)
      })
      resolve({
        output: contextParts.join('\n'),
        assistantText: assistantTextParts.join('\n\n'),
        events: eventsLog,
        newSessionId: streamSessionId
      })
    })

    child.on('error', (err) => {
      const durationMs = Date.now() - execStart
      onExecEvent?.('exec_error', { durationMs, error: err.message })
      reject(err)
    })
  })
}
