import { Worker } from 'worker_threads'
import path from 'path'
import { randomUUID } from 'crypto'
import { BrowserWindow, Notification } from 'electron'
import { getFireworksKey, getKimiSystemPrompt } from './settingsService'
import { getDb } from './db'
import { isUserWatching } from './focusState'
import { getWaitingInfoByContainerId } from './windowService'
import { sendTelegramAlert } from './telegramService'
import { resolveKimiSystemPrompt } from '../shared/defaultKimiPrompt'
import type { ChatHistoryEntry } from '../shared/chatHistory'
import { mapDbRowToHistoryEntry } from '../shared/chatHistory'
import { insertTurn, updateTurn, getLogFilePath, getOrphanedTurns } from './logWriter'
import type { TurnRecord } from './logWriter'

export function getAssistedHistory(windowId: number): {
  messages: Array<{ id: number; role: string; content: string; metadata: string | null }>
  orphanedTurns: Array<{ id: string; started_at: number; turn_type: string }>
} {
  const messages = getDb()
    .prepare('SELECT * FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as Array<{ id: number; role: string; content: string; metadata: string | null }>
  const orphanedTurns = getOrphanedTurns(windowId)
  return { messages, orphanedTurns }
}

const workers = new Map<number, Worker>()
const workerCtxSetters = new Map<number, (ctx: SendCtx) => void>()
const workerCtxMap = new Map<number, SendCtx>()

export function getWorkerCount(): number {
  return workers.size
}

export function __resetWorkersForTests(): void {
  workers.clear()
  workerCtxSetters.clear()
  workerCtxMap.clear()
}

function getWorkerPath(): string {
  return path.join(__dirname, 'assistedWindowWorker.js')
}

function loadHistory(windowId: number): ChatHistoryEntry[] {
  const rows = getDb()
    .prepare('SELECT role, content, metadata FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as { role: string; content: string; metadata: string | null }[]

  const entries: ChatHistoryEntry[] = []
  let pendingActions: string[] = []

  for (const row of rows) {
    if (row.role === 'claude-action' || row.role === 'claude-to-shellephant-action') {
      try {
        const meta = JSON.parse(row.metadata ?? '{}') as { summary?: string; actionType?: string }
        pendingActions.push(meta.summary ?? meta.actionType ?? 'action')
      } catch {
        pendingActions.push('action')
      }
      continue
    }

    if (row.role === 'claude' || row.role === 'claude-to-shellephant') {
      const prefix = pendingActions.length > 0
        ? `[Claude did: ${pendingActions.join(', ')}] Response: `
        : '[Claude]: '
      entries.push({ role: 'user', content: prefix + row.content })
      pendingActions = []
      continue
    }

    // Orphaned actions before a non-claude role: discard
    pendingActions = []
    const mapped = mapDbRowToHistoryEntry(row.role, row.content)
    if (mapped) entries.push(mapped)
  }

  return entries
}

// Returns the session_id from the newest claude or tool_result row that carries
// a non-null session_id. Ordered by id (DESC) — created_at only has second
// resolution and can tie across rapid-fire tool calls. The loop scans the last
// 20 rows so a null-metadata row doesn't mask the real last session.
export function loadLastSessionId(windowId: number): string | null {
  const rows = getDb()
    .prepare(`
      SELECT metadata FROM assisted_messages
      WHERE window_id = ? AND role IN ('claude', 'claude-to-shellephant', 'tool_result') AND metadata IS NOT NULL
      ORDER BY id DESC LIMIT 20
    `)
    .all(windowId) as { metadata: string | null }[]
  for (const row of rows) {
    if (!row.metadata) continue
    try {
      const parsed = JSON.parse(row.metadata) as { session_id?: string | null; tool_name?: string }
      // Legacy tool_result rows require tool_name check; new claude rows don't have tool_name
      if (parsed.tool_name && parsed.tool_name !== 'run_claude_code') continue
      if (parsed.session_id) return parsed.session_id
    } catch {
      continue
    }
  }
  return null
}

function saveMessage(windowId: number, role: string, content: string, metadata: string | null): void {
  getDb()
    .prepare('INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (?, ?, ?, ?)')
    .run(windowId, role, content, metadata)
}

function resolveProjectSystemPrompt(projectId: number | null): string | null {
  if (!projectId) return null
  const row = getDb()
    .prepare('SELECT kimi_system_prompt FROM projects WHERE id = ?')
    .get(projectId) as { kimi_system_prompt: string | null } | undefined
  return row?.kimi_system_prompt ?? null
}

type SendCtx = {
  windowId: number; containerId: string; turnId: string;
  startedAt: number; sendToRenderer: (channel: string, ...args: unknown[]) => void
}

function handleTurnComplete(msg: Record<string, unknown>, ctx: SendCtx): void {
  const { windowId, containerId, turnId, startedAt, sendToRenderer } = ctx
  const endedAt = Date.now()
  const status = (msg.error ? 'error' : 'success') as 'error' | 'success'
  const patch: Partial<TurnRecord> = {
    status, ended_at: endedAt, duration_ms: endedAt - startedAt,
    ...(msg.error ? { error: typeof msg.error === 'string' ? msg.error : String(msg.error) } : {})
  }
  updateTurn(turnId, patch)
  sendToRenderer('logs:turn-updated', { id: turnId, ...patch })
  sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
  const assistantText = typeof msg.assistantText === 'string' ? msg.assistantText : ''
  if (assistantText) {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed() || !isUserWatching(containerId, win)) {
      const body = assistantText.length > 200 ? assistantText.slice(0, 200) + '…' : assistantText
      new Notification({ title: 'Shellephant responded', body }).show()
      const info = getWaitingInfoByContainerId(containerId)
      if (info) {
        if (win && !win.isDestroyed()) win.webContents.send('terminal:waiting', info)
        void sendTelegramAlert(info.windowName)
      }
    }
  }
  workers.delete(windowId)
  workerCtxSetters.delete(windowId)
  workerCtxMap.delete(windowId)
}

function spawnWorker(
  initialCtx: SendCtx,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
): { worker: Worker; setCtx: (ctx: SendCtx) => void } {
  let ctx = initialCtx
  const { windowId } = ctx

  const worker = new Worker(getWorkerPath())

  worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
    if (msg.type === 'log-event') {
      sendToRenderer('logs:turn-event', msg.event)
    } else if (msg.type === 'save-message') {
      saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
    } else if (msg.type === 'claude-to-shellephant:event') {
      const ev = msg.event as { kind: string; text?: string; name?: string; summary?: string; input?: unknown }
      if (ev.kind === 'text_delta') {
        sendToRenderer('claude-to-shellephant:delta', windowId, ev.text)
      } else if (ev.kind === 'tool_use') {
        const detail = JSON.stringify(ev.input)
        saveMessage(windowId, 'claude-to-shellephant-action', '', JSON.stringify({ actionType: ev.name, summary: ev.summary, detail }))
        sendToRenderer('claude-to-shellephant:action', windowId, { actionType: ev.name, summary: ev.summary, detail })
      }
    } else if (msg.type === 'claude-to-shellephant:turn-complete') {
      sendToRenderer('claude-to-shellephant:turn-complete', windowId)
    } else if (msg.type === 'tool-call') {
      sendToRenderer('shellephant:to-claude', windowId, msg.message)
    } else if (msg.type === 'kimi-delta') {
      sendToRenderer('assisted:kimi-delta', windowId, msg.delta)
    } else if (msg.type === 'turn-complete') {
      handleTurnComplete(msg, ctx)
    }
  })

  worker.on('error', (err) => {
    const endedAt = Date.now()
    updateTurn(ctx.turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: err.message })
    sendToRenderer('logs:turn-updated', { id: ctx.turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: err.message })
    sendToRenderer('assisted:turn-complete', windowId, null, err.message)
    workers.delete(windowId)
    workerCtxSetters.delete(windowId)
    workerCtxMap.delete(windowId)
  })

  worker.on('exit', (code) => {
    if (code !== 0 && workers.has(windowId)) {
      const endedAt = Date.now()
      updateTurn(ctx.turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: `Worker exited with code ${code}` })
      sendToRenderer('logs:turn-updated', { id: ctx.turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: `Worker exited with code ${code}` })
      sendToRenderer('assisted:turn-complete', windowId, null, `Worker exited with code ${code}`)
      workers.delete(windowId)
      workerCtxSetters.delete(windowId)
      workerCtxMap.delete(windowId)
    }
  })

  return { worker, setCtx: (newCtx: SendCtx) => { ctx = newCtx } }
}

export async function sendToWindow(
  windowId: number,
  containerId: string,
  message: string,
  projectId: number | null,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
): Promise<void> {
  const fireworksKey = getFireworksKey()
  if (!fireworksKey) throw new Error('Fireworks API key not configured')

  const projectPrompt = resolveProjectSystemPrompt(projectId)
  const globalPrompt = getKimiSystemPrompt()
  const history = loadHistory(windowId)
  const initialSessionId = loadLastSessionId(windowId)

  const turnId = randomUUID()
  const logPath = getLogFilePath()
  const startedAt = Date.now()

  const turnRecord: TurnRecord = {
    id: turnId, window_id: windowId, turn_type: 'shellephant-claude',
    status: 'running', started_at: startedAt, log_file: logPath
  }
  insertTurn(turnRecord)
  sendToRenderer('logs:turn-started', turnRecord)

  const ctx: SendCtx = { windowId, containerId, turnId, startedAt, sendToRenderer }
  let worker = workers.get(windowId)
  if (!worker) {
    const spawned = spawnWorker(ctx, sendToRenderer)
    worker = spawned.worker
    workers.set(windowId, worker)
    workerCtxSetters.set(windowId, spawned.setCtx)
  } else {
    workerCtxSetters.get(windowId)?.(ctx)
  }
  workerCtxMap.set(windowId, ctx)

  worker.postMessage({
    type: 'send', windowId, containerId, message,
    conversationHistory: history, initialSessionId,
    systemPrompt: resolveKimiSystemPrompt(projectPrompt, globalPrompt),
    fireworksKey, turnId, logPath
  })
}

export function cancelWindow(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  const ctx = workerCtxMap.get(windowId)
  if (ctx) {
    const endedAt = Date.now()
    updateTurn(ctx.turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: 'cancelled' })
    ctx.sendToRenderer('logs:turn-updated', { id: ctx.turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: 'cancelled' })
  }
  worker.postMessage({ type: 'cancel' })
  worker.terminate()
  workers.delete(windowId)
  workerCtxSetters.delete(windowId)
  workerCtxMap.delete(windowId)
}

/**
 * Bulk-terminates all active Shellephant worker threads and clears all state maps.
 * Does NOT update turn DB records — caller must invoke `markOrphanedTurns()`
 * afterward to transition any remaining `running` turns to `orphaned`.
 */
export function terminateAllAssistedWorkers(): void {
  for (const worker of workers.values()) {
    worker.postMessage({ type: 'cancel' })
    worker.terminate()
  }
  workers.clear()
  workerCtxSetters.clear()
  workerCtxMap.clear()
}

