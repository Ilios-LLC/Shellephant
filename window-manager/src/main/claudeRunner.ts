import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { StreamFilterBuffer } from './assistedStreamFilter'
import type { TimelineEvent } from '../shared/timelineEvent'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string,
  options: { eventType?: string } = {}
): Promise<{ output: string; assistantText: string; events: TimelineEvent[]; newSessionId: string | null }> {
  const eventType = options.eventType ?? 'claude:event'
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])

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

      if (code !== 0 && !hadAnyOutput) {
        reject(new Error(`docker exec failed (exit ${code}): ${stderr}`))
        return
      }
      resolve({
        output: contextParts.join('\n'),
        assistantText: assistantTextParts.join('\n\n'),
        events: eventsLog,
        newSessionId: streamSessionId
      })
    })

    child.on('error', reject)
  })
}
