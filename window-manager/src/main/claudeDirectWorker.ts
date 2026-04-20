import { parentPort } from 'worker_threads'
import type { TimelineEvent } from '../shared/timelineEvent'
import type { PermissionMode } from '../shared/permissionMode'
import { runClaudeCode } from './claudeRunner'
import { writeEvent, type LogEvent } from './logWriter'

type DirectSendMsg = {
  type: 'send'
  windowId: number
  containerId: string
  message: string
  initialSessionId: string | null
  permissionMode?: PermissionMode
  turnId: string
  logPath: string
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type !== 'send') return
  const { windowId, containerId, message, initialSessionId, permissionMode, turnId, logPath } = msg as unknown as DirectSendMsg

  const ts = () => Date.now()

  function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
    const event: LogEvent = { turnId, windowId, eventType, ts: ts(), payload }
    writeEvent(logPath, event)
    parentPort?.postMessage({ type: 'log-event', event })
  }

  emitEvent('turn_start')

  try {
    const { output, assistantText, newSessionId, events } = await runClaudeCode(
      containerId,
      initialSessionId,
      message,
      {
        permissionMode: permissionMode ?? 'bypassPermissions',
        onExecEvent: (type, payload) => emitEvent(type, payload)
      }
    )
    if (assistantText) {
      parentPort?.postMessage({
        type: 'save-message',
        role: 'claude',
        content: assistantText,
        metadata: JSON.stringify({ session_id: newSessionId, complete: true })
      })
    }
    const resultText = events
      .filter((e): e is Extract<TimelineEvent, { kind: 'result' }> => e.kind === 'result')
      .filter(e => !e.isError)
      .map(e => e.text)
      .join(' ')
    const notificationText = resultText || assistantText || output
    emitEvent('turn_end')
    parentPort?.postMessage({ type: 'turn-complete', windowId, session_id: newSessionId, assistantText: notificationText })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    emitEvent('error', { error: errMsg })
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: `ERROR: ${errMsg}`,
      metadata: JSON.stringify({ complete: false, error: true })
    })
    parentPort?.postMessage({ type: 'turn-complete', windowId, error: errMsg })
  }
})
