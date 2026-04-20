import { parentPort } from 'worker_threads'
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
    const { output, newSessionId } = await runClaudeCode(containerId, initialSessionId, message)
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: output,
      metadata: JSON.stringify({ session_id: newSessionId, complete: true })
    })
    parentPort?.postMessage({ type: 'turn-complete', windowId, session_id: newSessionId })
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
