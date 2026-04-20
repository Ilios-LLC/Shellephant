import { Worker } from 'worker_threads'
import path from 'path'
import { randomUUID } from 'crypto'
import { BrowserWindow, Notification } from 'electron'
import { getDb } from './db'
import { loadLastSessionId } from './assistedWindowService'
import { isUserWatching } from './focusState'
import { getWaitingInfoByContainerId } from './windowService'
import { insertTurn, updateTurn, getLogFilePath } from './logWriter'
import type { TurnRecord } from './logWriter'
import type { PermissionMode } from '../shared/permissionMode'

const workers = new Map<number, Worker>()
const activeTurnIds = new Map<number, string>()

export function getDirectWorkerCount(): number { return workers.size }
export function __resetDirectWorkersForTests(): void { workers.clear(); activeTurnIds.clear() }

function getWorkerPath(): string {
  return path.join(__dirname, 'claudeDirectWorker.js')
}

function saveMessage(windowId: number, role: string, content: string, metadata: string | null): void {
  getDb()
    .prepare('INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (?, ?, ?, ?)')
    .run(windowId, role, content, metadata)
}


export async function sendToClaudeDirectly(
  windowId: number,
  containerId: string,
  message: string,
  sendToRenderer: (channel: string, ...args: unknown[]) => void,
  permissionMode: PermissionMode = 'bypassPermissions'
): Promise<void> {
  saveMessage(windowId, 'user', message, null)
  const initialSessionId = loadLastSessionId(windowId)

  const turnId = randomUUID()
  const logPath = getLogFilePath()
  const startedAt = Date.now()

  const turnRecord: TurnRecord = {
    id: turnId, window_id: windowId, turn_type: 'human-claude',
    status: 'running', started_at: startedAt, log_file: logPath
  }
  insertTurn(turnRecord)
  activeTurnIds.set(windowId, turnId)
  sendToRenderer('logs:turn-started', turnRecord)

  let worker = workers.get(windowId)
  if (!worker) {
    worker = new Worker(getWorkerPath())

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'log-event') {
        sendToRenderer('logs:turn-event', msg.event)
      } else if (msg.type === 'save-message') {
        saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
      } else if (msg.type === 'claude:event') {
        const ev = msg.event as { kind: string; text?: string; name?: string; summary?: string; input?: unknown }
        if (ev.kind === 'text_delta') {
          sendToRenderer('claude:delta', windowId, ev.text)
        } else if (ev.kind === 'tool_use') {
          const detail = JSON.stringify(ev.input)
          saveMessage(windowId, 'claude-action', '', JSON.stringify({ actionType: ev.name, summary: ev.summary, detail }))
          sendToRenderer('claude:action', windowId, { actionType: ev.name, summary: ev.summary, detail })
        }
      } else if (msg.type === 'turn-complete') {
        const endedAt = Date.now()
        const status = (msg.error ? 'error' : 'success') as 'error' | 'success'
        const patch: Partial<TurnRecord> = {
          status,
          ended_at: endedAt,
          duration_ms: endedAt - startedAt,
          ...(msg.error ? { error: msg.error as string } : {})
        }
        updateTurn(turnId, patch)
        sendToRenderer('logs:turn-updated', { id: turnId, ...patch })
        sendToRenderer('claude:turn-complete', windowId)
        if (msg.error) {
          sendToRenderer('claude:error', windowId, msg.error)
        }
        const assistantText = typeof msg.assistantText === 'string' ? msg.assistantText : ''
        if (assistantText) {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win || win.isDestroyed() || !isUserWatching(containerId, win)) {
            const body = assistantText.length > 200 ? assistantText.slice(0, 200) + '…' : assistantText
            new Notification({ title: 'Claude responded', body }).show()
            if (win && !win.isDestroyed()) {
              const info = getWaitingInfoByContainerId(containerId)
              if (info) win.webContents.send('terminal:waiting', info)
            }
          }
        }
        activeTurnIds.delete(windowId)
        workers.delete(windowId)
      }
    })

    worker.on('error', (err) => {
      const endedAt = Date.now()
      updateTurn(turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('logs:turn-updated', { id: turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('claude:turn-complete', windowId)
      sendToRenderer('claude:error', windowId, err.message)
      activeTurnIds.delete(windowId)
      workers.delete(windowId)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && workers.has(windowId)) {
        const endedAt = Date.now()
        updateTurn(turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: `Worker exited with code ${code}` })
        sendToRenderer('logs:turn-updated', { id: turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: `Worker exited with code ${code}` })
        sendToRenderer('claude:turn-complete', windowId)
        sendToRenderer('claude:error', windowId, `Worker exited with code ${code}`)
        activeTurnIds.delete(windowId)
        workers.delete(windowId)
      }
    })

    workers.set(windowId, worker)
  }

  worker.postMessage({ type: 'send', windowId, containerId, message, initialSessionId, permissionMode, turnId, logPath })
}

export function cancelClaudeDirect(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.terminate()
  const activeTurnId = activeTurnIds.get(windowId)
  if (activeTurnId) {
    const endedAt = Date.now()
    updateTurn(activeTurnId, { status: 'error', ended_at: endedAt, error: 'Cancelled' })
  }
  activeTurnIds.delete(windowId)
  workers.delete(windowId)
}
