import { Worker } from 'worker_threads'
import path from 'path'
import { BrowserWindow, Notification } from 'electron'
import { getFireworksKey, getKimiSystemPrompt } from './settingsService'
import { getDb } from './db'
import { isUserWatching } from './focusState'
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
    .prepare('SELECT role, content FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as { role: string; content: string }[]
  const entries: ChatHistoryEntry[] = []
  for (const row of rows) {
    const mapped = mapDbRowToHistoryEntry(row.role, row.content)
    if (mapped) entries.push(mapped)
  }
  return entries
}

// Returns the session_id from the newest run_claude_code tool_result that has
// a non-null session_id. Ordered by id (DESC) — created_at only has second
// resolution and can tie across rapid-fire tool calls. The loop scans the last
// 20 rows so a null-metadata row doesn't mask the real last session.
export function loadLastSessionId(windowId: number): string | null {
  const rows = getDb()
    .prepare(`
      SELECT metadata FROM assisted_messages
      WHERE window_id = ? AND role = 'tool_result' AND metadata IS NOT NULL
      ORDER BY id DESC LIMIT 20
    `)
    .all(windowId) as { metadata: string | null }[]
  for (const row of rows) {
    if (!row.metadata) continue
    try {
      const parsed = JSON.parse(row.metadata) as { session_id?: string | null; tool_name?: string }
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
      } else if (msg.type === 'stream-event') {
        sendToRenderer('assisted:stream-event', windowId, msg.event)
      } else if (msg.type === 'kimi-delta') {
        sendToRenderer('assisted:kimi-delta', windowId, msg.delta)
      } else if (msg.type === 'tool-call') {
        sendToRenderer('assisted:tool-call', windowId, msg.toolName, msg.message)
      } else if (msg.type === 'ping-user') {
        sendToRenderer('assisted:ping-user', windowId, msg.message)
        const focusedWin = BrowserWindow.getFocusedWindow()
        if (!focusedWin || !isUserWatching(containerId, focusedWin)) {
          new Notification({ title: 'Kimi needs your input', body: msg.message as string }).show()
        }
      } else if (msg.type === 'turn-complete') {
        sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
        // Notify when Kimi finishes a turn with a user-facing message. Plain
        // assistant text is one of two paths Kimi uses to talk to the user
        // (the other is ping_user, handled above). No text → tool-only turn →
        // no alert. Silent when the user is already watching this window.
        const assistantText = typeof msg.assistantText === 'string' ? msg.assistantText : ''
        if (assistantText) {
          const focusedWin = BrowserWindow.getFocusedWindow()
          if (!focusedWin || !isUserWatching(containerId, focusedWin)) {
            const body = assistantText.length > 200 ? assistantText.slice(0, 200) + '…' : assistantText
            new Notification({ title: 'Kimi responded', body }).show()
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

export function resumeWindow(windowId: number, message: string): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.postMessage({ type: 'resume', windowId, message })
}
