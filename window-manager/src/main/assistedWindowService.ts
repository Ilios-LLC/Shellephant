import { Worker } from 'worker_threads'
import path from 'path'
import { BrowserWindow, Notification } from 'electron'
import { getFireworksKey, getKimiSystemPrompt } from './settingsService'
import { getDb } from './db'
import { isUserWatching } from './focusState'
import { getWaitingInfoByContainerId } from './windowService'
import { resolveKimiSystemPrompt } from '../shared/defaultKimiPrompt'
import type { ChatHistoryEntry } from '../shared/chatHistory'
import { mapDbRowToHistoryEntry } from '../shared/chatHistory'

const workers = new Map<number, Worker>()

export function getWorkerCount(): number {
  return workers.size
}

export function __resetWorkersForTests(): void {
  workers.clear()
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

  let worker = workers.get(windowId)
  if (!worker) {
    worker = new Worker(getWorkerPath())

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'save-message') {
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
        sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
        // Notify when Shellephant finishes a turn with a user-facing message.
        // No text → tool-only turn → no alert. Silent when user is watching.
        const assistantText = typeof msg.assistantText === 'string' ? msg.assistantText : ''
        if (assistantText) {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win || win.isDestroyed() || !isUserWatching(containerId, win)) {
            const body = assistantText.length > 200 ? assistantText.slice(0, 200) + '…' : assistantText
            new Notification({ title: 'Shellephant responded', body }).show()
            if (win && !win.isDestroyed()) {
              const info = getWaitingInfoByContainerId(containerId)
              if (info) win.webContents.send('terminal:waiting', info)
            }
          }
        }
        workers.delete(windowId)
      }
    })

    worker.on('error', (err) => {
      sendToRenderer('assisted:turn-complete', windowId, null, err.message)
      workers.delete(windowId)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && workers.has(windowId)) {
        sendToRenderer('assisted:turn-complete', windowId, null, `Worker exited with code ${code}`)
        workers.delete(windowId)
      }
    })

    workers.set(windowId, worker)
  }

  worker.postMessage({
    type: 'send',
    windowId,
    containerId,
    message,
    conversationHistory: history,
    initialSessionId,
    systemPrompt: resolveKimiSystemPrompt(projectPrompt, globalPrompt),
    fireworksKey
  })
}

export function cancelWindow(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.terminate()
  workers.delete(windowId)
}

