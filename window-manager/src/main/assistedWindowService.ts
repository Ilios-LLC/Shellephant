import { Worker } from 'worker_threads'
import path from 'path'
import { BrowserWindow, Notification } from 'electron'
import { getFireworksKey, getKimiSystemPrompt } from './settingsService'
import { getDb } from './db'
import { isUserWatching } from './focusState'

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

function loadHistory(windowId: number): { role: string; content: string }[] {
  return getDb()
    .prepare('SELECT role, content FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as { role: string; content: string }[]
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

  let worker = workers.get(windowId)
  if (!worker) {
    worker = new Worker(getWorkerPath())

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'save-message') {
        saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
      } else if (msg.type === 'stream-chunk') {
        sendToRenderer('assisted:stream-chunk', windowId, msg.chunk)
      } else if (msg.type === 'kimi-delta') {
        sendToRenderer('assisted:kimi-delta', windowId, msg.delta)
      } else if (msg.type === 'ping-user') {
        sendToRenderer('assisted:ping-user', windowId, msg.message)
        const focusedWin = BrowserWindow.getFocusedWindow()
        if (!focusedWin || !isUserWatching(containerId, focusedWin)) {
          new Notification({ title: 'Kimi needs your input', body: msg.message as string }).show()
        }
      } else if (msg.type === 'turn-complete') {
        sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
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
    systemPrompt: projectPrompt ?? globalPrompt ?? null,
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
