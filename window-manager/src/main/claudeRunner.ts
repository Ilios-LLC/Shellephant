import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { StreamFilterBuffer } from './assistedStreamFilter'
import type { TimelineEvent } from '../shared/timelineEvent'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string
): Promise<{ output: string; events: TimelineEvent[]; newSessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])

    const filter = new StreamFilterBuffer()
    const contextParts: string[] = []
    const eventsLog: TimelineEvent[] = []
    let stderr = ''
    let hadAnyOutput = false
    let streamSessionId: string | null = null

    function processDrained(drained: { contextChunks: string[]; events: TimelineEvent[]; sessionId: string | null }) {
      contextParts.push(...drained.contextChunks)
      if (drained.sessionId) streamSessionId = drained.sessionId
      for (const event of drained.events) {
        eventsLog.push(event)
        parentPort?.postMessage({ type: 'claude:event', event })
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
      resolve({ output: contextParts.join('\n'), events: eventsLog, newSessionId: streamSessionId })
    })

    child.on('error', reject)
  })
}
