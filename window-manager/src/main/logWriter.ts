import { appendFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'

let _logDir: string | null = null

export function initLogWriter(logDir: string): void {
  _logDir = logDir
  rotateLogs(logDir)
}

export function getLogFilePath(): string {
  if (!_logDir) throw new Error('logWriter not initialized — call initLogWriter first')
  const date = new Date().toISOString().slice(0, 10)
  return join(_logDir, `window-manager-${date}.jsonl`)
}

export type LogEvent = {
  turnId: string
  windowId: number
  eventType: string
  ts: number
  payload?: Record<string, unknown>
}

export type TurnRecord = {
  id: string
  window_id: number
  turn_type: 'human-claude' | 'shellephant-claude'
  status: 'running' | 'success' | 'error'
  started_at: number
  ended_at?: number
  duration_ms?: number
  error?: string
  log_file?: string
}

export function writeEvent(logPath: string, event: LogEvent): void {
  try {
    appendFileSync(logPath, JSON.stringify(event) + '\n')
  } catch (err) {
    console.error('[logWriter] writeEvent failed:', err)
  }
}

export function insertTurn(turn: TurnRecord): void {
  getDb()
    .prepare(
      `INSERT INTO turns (id, window_id, turn_type, status, started_at, log_file)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(turn.id, turn.window_id, turn.turn_type, turn.status, turn.started_at, turn.log_file ?? null)
}

export function updateTurn(id: string, patch: Partial<TurnRecord>): void {
  const setClauses: string[] = []
  const params: unknown[] = []

  if (patch.status !== undefined) { setClauses.push('status = ?'); params.push(patch.status) }
  if (patch.ended_at !== undefined) { setClauses.push('ended_at = ?'); params.push(patch.ended_at) }
  if (patch.duration_ms !== undefined) { setClauses.push('duration_ms = ?'); params.push(patch.duration_ms) }
  if (patch.error !== undefined) { setClauses.push('error = ?'); params.push(patch.error ?? null) }

  if (setClauses.length === 0) return
  params.push(id)

  getDb()
    .prepare(`UPDATE turns SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params)
}

export function readEventsForTurn(logPath: string, turnId: string): LogEvent[] {
  try {
    const content = readFileSync(logPath, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as LogEvent } catch (e) {
          console.warn('[logWriter] skipped malformed log line:', e)
          return null
        }
      })
      .filter((e): e is LogEvent => e !== null && e.turnId === turnId)
  } catch {
    return []
  }
}

export function __resetForTests(): void {
  _logDir = null
}

export function rotateLogs(logDir: string): void {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    for (const file of readdirSync(logDir)) {
      if (!file.startsWith('window-manager-') || !file.endsWith('.jsonl')) continue
      const filePath = join(logDir, file)
      try {
        if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath)
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* ignore if logDir doesn't exist */ }
}
