import { parentPort } from 'worker_threads'
import type { TimelineEvent } from '../shared/timelineEvent'
import { runClaudeCode } from './claudeRunner'

type DirectSendMsg = {
  type: 'send'
  windowId: number
  containerId: string
  message: string
  initialSessionId: string | null
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type !== 'send') return
  const { windowId, containerId, message, initialSessionId } = msg as unknown as DirectSendMsg

  try {
    const { output, newSessionId, events } = await runClaudeCode(containerId, initialSessionId, message)
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: output,
      metadata: JSON.stringify({ session_id: newSessionId, complete: true })
    })
    // Pick the most readable text for the notification body.
    // 'result' events carry Claude's final answer; 'assistant_text' events carry
    // the model's literal prose. Both are more human-readable than `output`,
    // which is the compact context format (e.g. "tool_use: Write(src/foo.ts)…").
    const resultText = events
      .filter((e): e is Extract<TimelineEvent, { kind: 'result' }> => e.kind === 'result')
      .filter(e => !e.isError)
      .map(e => e.text)
      .join(' ')
    const assistantTextFromEvents = events
      .filter((e): e is Extract<TimelineEvent, { kind: 'assistant_text' }> => e.kind === 'assistant_text')
      .map(e => e.text)
      .join(' ')
    const notificationText = resultText || assistantTextFromEvents || output
    parentPort?.postMessage({ type: 'turn-complete', windowId, session_id: newSessionId, assistantText: notificationText })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: `ERROR: ${errMsg}`,
      metadata: JSON.stringify({ complete: false, error: true })
    })
    parentPort?.postMessage({ type: 'turn-complete', windowId, error: errMsg })
  }
})
