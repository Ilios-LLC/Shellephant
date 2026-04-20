import { parentPort } from 'worker_threads'
import type { TimelineEvent } from '../shared/timelineEvent'
import type { PermissionMode } from '../shared/permissionMode'
import { runClaudeCode } from './claudeRunner'

type DirectSendMsg = {
  type: 'send'
  windowId: number
  containerId: string
  message: string
  initialSessionId: string | null
  permissionMode?: PermissionMode
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type !== 'send') return
  const { windowId, containerId, message, initialSessionId, permissionMode } = msg as unknown as DirectSendMsg

  try {
    const { output, assistantText, newSessionId, events } = await runClaudeCode(
      containerId,
      initialSessionId,
      message,
      { permissionMode: permissionMode ?? 'bypassPermissions' }
    )
    if (assistantText) {
      parentPort?.postMessage({
        type: 'save-message',
        role: 'claude',
        content: assistantText,
        metadata: JSON.stringify({ session_id: newSessionId, complete: true })
      })
    }
    // Pick the most readable text for the notification body.
    const resultText = events
      .filter((e): e is Extract<TimelineEvent, { kind: 'result' }> => e.kind === 'result')
      .filter(e => !e.isError)
      .map(e => e.text)
      .join(' ')
    const notificationText = resultText || assistantText || output
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
