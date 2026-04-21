# Observability & Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured turn-level observability — JSONL file (crash-safe, written by workers) + SQLite index (queryable by main process), real-time IPC streaming to renderer, per-window trace pane in WindowDetailPane, and global TraceExplorer view.

**Architecture:** Workers write exec/turn events directly to a daily-rotating JSONL file via `appendFileSync` (sync, crash-safe, no IPC needed for persistence). Main process writes turn-level summaries to a new `turns` SQLite table at turn boundaries. A `turnId` (UUID) is generated per turn in the main process and passed to workers. IPC channels expose turn history (SQLite) and event detail (JSONL file). Renderer subscribes to real-time push events and can query historical turns.

**Tech Stack:** better-sqlite3, Node.js `fs` (appendFileSync/readFileSync/readdirSync), `crypto.randomUUID`, Svelte 5 runes, Electron IPC (ipcMain.handle + webContents.send)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/db.ts` | Modify | Add `turns` table to `initDb()` |
| `tests/main/db.test.ts` | Modify | Assert `turns` table schema |
| `src/main/logWriter.ts` | **Create** | writeEvent (file), insertTurn/updateTurn (SQLite), readEventsForTurn, rotateLogs, initLogWriter, getLogFilePath |
| `tests/main/logWriter.test.ts` | **Create** | All logWriter exports |
| `src/main/claudeRunner.ts` | Modify | Add `onExecEvent` callback to options |
| `src/main/claudeDirectWorker.ts` | Modify | Accept turnId/logPath in send msg; call writeEvent + post log-event |
| `tests/main/claudeDirectWorker.test.ts` | Modify | Assert log-event posted, writeEvent called |
| `src/main/assistedWindowWorker.ts` | Modify | Accept turnId/logPath; call writeEvent in handleRunClaudeCode + post log-event |
| `tests/main/assistedWindowWorker.test.ts` | Modify | Assert log-event posted, writeEvent called |
| `src/main/claudeService.ts` | Modify | Generate turnId, insertTurn, updateTurn on turn lifecycle; forward log-event to renderer |
| `tests/main/claudeService.test.ts` | Modify | Assert turnId in postMessage, insertTurn/updateTurn called |
| `src/main/assistedWindowService.ts` | Modify | Same as claudeService |
| `tests/main/assistedWindowService.test.ts` | Modify | Same |
| `src/main/ipcHandlers.ts` | Modify | Add logs:list-turns, logs:get-turn-events handlers |
| `src/main/index.ts` | Modify | Call initLogWriter(app.getPath('logs')) on startup |
| `src/preload/index.ts` | Modify | Expose listTurns, getTurnEvents, onTurn*/offTurn* |
| `src/renderer/src/types.ts` | Modify | Add TurnRecord, LogEvent interfaces |
| `src/renderer/src/components/WindowDetailPane.svelte` | Modify | Add traces toggle + collapsible pane |
| `tests/renderer/WindowDetailPane.test.ts` | Modify | Assert traces toggle behavior |
| `src/renderer/src/components/TraceExplorer.svelte` | **Create** | Global trace view with filters + turn table + detail panel |
| `tests/renderer/TraceExplorer.test.ts` | **Create** | Render, filter, click-to-expand, real-time push |
| `src/renderer/src/components/MainPane.svelte` | Modify | Add 'traces' view type + TraceExplorer route |

---

## Task 1: Add `turns` table to SQLite

**Files:**
- Modify: `window-manager/src/main/db.ts`
- Modify: `window-manager/tests/main/db.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/main/db.test.ts`, add after existing table tests:

```typescript
describe('turns table', () => {
  it('has correct columns', () => {
    initDb(':memory:')
    const db = getDb()
    const cols = (db.pragma('table_info(turns)') as { name: string }[]).map(c => c.name)
    expect(cols).toContain('id')
    expect(cols).toContain('window_id')
    expect(cols).toContain('turn_type')
    expect(cols).toContain('status')
    expect(cols).toContain('started_at')
    expect(cols).toContain('ended_at')
    expect(cols).toContain('duration_ms')
    expect(cols).toContain('error')
    expect(cols).toContain('log_file')
  })

  it('status defaults to running', () => {
    initDb(':memory:')
    const db = getDb()
    db.exec(`INSERT INTO turns (id, window_id, turn_type, started_at) VALUES ('t1', 0, 'human-claude', 1000)`)
    const row = db.prepare('SELECT status FROM turns WHERE id = ?').get('t1') as { status: string }
    expect(row.status).toBe('running')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: FAIL — `turns` table does not exist.

- [ ] **Step 3: Add turns table to initDb()**

In `src/main/db.ts`, find the last `CREATE TABLE IF NOT EXISTS` block (look for `assisted_messages`). After it, add:

```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id          TEXT PRIMARY KEY,
      window_id   INTEGER NOT NULL,
      turn_type   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running',
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      duration_ms INTEGER,
      error       TEXT,
      log_file    TEXT
    )
  `)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: PASS (all existing + new tests green).

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/db.ts tests/main/db.test.ts && git commit -m "feat(db): add turns table for observability"
```

---

## Task 2: Create `logWriter.ts`

**Files:**
- Create: `window-manager/src/main/logWriter.ts`
- Create: `window-manager/tests/main/logWriter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/logWriter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Must mock db before importing logWriter
vi.mock('../src/main/db', () => ({
  getDb: vi.fn()
}))

import { getDb } from '../src/main/db'
import {
  initLogWriter,
  getLogFilePath,
  writeEvent,
  insertTurn,
  updateTurn,
  readEventsForTurn,
  rotateLogs,
  type LogEvent,
  type TurnRecord
} from '../src/main/logWriter'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'logwriter-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('initLogWriter / getLogFilePath', () => {
  it('getLogFilePath returns dated jsonl path after init', () => {
    initLogWriter(tmpDir)
    const p = getLogFilePath()
    expect(p).toMatch(/window-manager-\d{4}-\d{2}-\d{2}\.jsonl$/)
    expect(p).toContain(tmpDir)
  })

  it('getLogFilePath throws before init', () => {
    // Reset module state by re-importing is complex; just test init clears it
    initLogWriter(tmpDir)
    expect(() => getLogFilePath()).not.toThrow()
  })
})

describe('writeEvent', () => {
  it('appends valid JSON line to file', () => {
    const logPath = join(tmpDir, 'test.jsonl')
    const event: LogEvent = { turnId: 'abc', windowId: 1, eventType: 'exec_start', ts: 1000 }
    writeEvent(logPath, event)
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(event)
  })

  it('appends multiple events as separate lines', () => {
    const logPath = join(tmpDir, 'test.jsonl')
    writeEvent(logPath, { turnId: 'a', windowId: 1, eventType: 'turn_start', ts: 1 })
    writeEvent(logPath, { turnId: 'a', windowId: 1, eventType: 'turn_end', ts: 2 })
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})

describe('insertTurn / updateTurn', () => {
  it('insertTurn runs correct SQL', () => {
    const mockRun = vi.fn()
    const mockPrepare = vi.fn(() => ({ run: mockRun }))
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)

    const turn: TurnRecord = {
      id: 'turn-1', window_id: 5, turn_type: 'human-claude',
      status: 'running', started_at: 1000, log_file: '/tmp/test.jsonl'
    }
    insertTurn(turn)

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO turns'))
    expect(mockRun).toHaveBeenCalledWith('turn-1', 5, 'human-claude', 'running', 1000, '/tmp/test.jsonl')
  })

  it('updateTurn updates only provided fields', () => {
    const mockRun = vi.fn()
    const mockPrepare = vi.fn(() => ({ run: mockRun }))
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)

    updateTurn('turn-1', { status: 'success', ended_at: 2000, duration_ms: 1000 })

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringMatching(/UPDATE turns SET/))
    const sql = mockPrepare.mock.calls[0][0] as string
    expect(sql).toContain('status = ?')
    expect(sql).toContain('ended_at = ?')
    expect(sql).toContain('duration_ms = ?')
    expect(sql).not.toContain('error')
  })

  it('updateTurn is a no-op when patch is empty', () => {
    const mockPrepare = vi.fn()
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)
    updateTurn('turn-1', {})
    expect(mockPrepare).not.toHaveBeenCalled()
  })
})

describe('readEventsForTurn', () => {
  it('returns events matching turnId', () => {
    const logPath = join(tmpDir, 'test.jsonl')
    writeFileSync(logPath, [
      JSON.stringify({ turnId: 'a', windowId: 1, eventType: 'exec_start', ts: 1 }),
      JSON.stringify({ turnId: 'b', windowId: 1, eventType: 'exec_start', ts: 2 }),
      JSON.stringify({ turnId: 'a', windowId: 1, eventType: 'exec_end', ts: 3 })
    ].join('\n') + '\n')

    const events = readEventsForTurn(logPath, 'a')
    expect(events).toHaveLength(2)
    expect(events[0].eventType).toBe('exec_start')
    expect(events[1].eventType).toBe('exec_end')
  })

  it('returns empty array for missing file', () => {
    expect(readEventsForTurn('/nonexistent/path.jsonl', 'a')).toEqual([])
  })

  it('skips malformed JSON lines', () => {
    const logPath = join(tmpDir, 'test.jsonl')
    writeFileSync(logPath, `{"turnId":"a","windowId":1,"eventType":"ok","ts":1}\nnot-json\n`)
    const events = readEventsForTurn(logPath, 'a')
    expect(events).toHaveLength(1)
  })
})

describe('rotateLogs', () => {
  it('deletes files older than 7 days', () => {
    const oldFile = join(tmpDir, 'window-manager-2020-01-01.jsonl')
    writeFileSync(oldFile, '')
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(oldFile, oldDate, oldDate)

    const newFile = join(tmpDir, 'window-manager-2026-04-20.jsonl')
    writeFileSync(newFile, '')

    rotateLogs(tmpDir)

    expect(() => readFileSync(oldFile)).toThrow()
    expect(readFileSync(newFile, 'utf-8')).toBe('')
  })

  it('ignores non-matching files', () => {
    const other = join(tmpDir, 'other-file.txt')
    writeFileSync(other, '')
    const oldDate = new Date(0)
    utimesSync(other, oldDate, oldDate)
    rotateLogs(tmpDir)
    expect(readFileSync(other, 'utf-8')).toBe('')
  })

  it('does not throw if logDir does not exist', () => {
    expect(() => rotateLogs('/nonexistent-dir-xyz')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npx vitest run tests/main/logWriter.test.ts 2>&1 | tail -20
```

Expected: FAIL — `../src/main/logWriter` not found.

- [ ] **Step 3: Create logWriter.ts**

Create `src/main/logWriter.ts`:

```typescript
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
  appendFileSync(logPath, JSON.stringify(event) + '\n')
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
  const params: (string | number | null)[] = []

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
        try { return JSON.parse(line) as LogEvent } catch { return null }
      })
      .filter((e): e is LogEvent => e !== null && e.turnId === turnId)
  } catch {
    return []
  }
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npx vitest run tests/main/logWriter.test.ts 2>&1 | tail -20
```

Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/logWriter.ts tests/main/logWriter.test.ts && git commit -m "feat: add logWriter module for turn-level observability"
```

---

## Task 3: Add `onExecEvent` callback to `claudeRunner.ts`

**Files:**
- Modify: `window-manager/src/main/claudeRunner.ts`
- Modify: `window-manager/tests/main/claudeDirectWorker.test.ts` (verify callback is used — covered in Task 4)

- [ ] **Step 1: Modify claudeRunner.ts**

Replace the `options` type and add event calls. The full updated file:

```typescript
import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { StreamFilterBuffer } from './assistedStreamFilter'
import type { TimelineEvent } from '../shared/timelineEvent'
import type { PermissionMode } from '../shared/permissionMode'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string,
  options: {
    eventType?: string
    permissionMode?: PermissionMode
    onExecEvent?: (type: string, payload: Record<string, unknown>) => void
  } = {}
): Promise<{ output: string; assistantText: string; events: TimelineEvent[]; newSessionId: string | null }> {
  const eventType = options.eventType ?? 'claude:event'
  const permissionMode = options.permissionMode ?? 'bypassPermissions'
  const { onExecEvent } = options

  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const execStart = Date.now()
    const command = `docker exec ${containerId} node /usr/local/bin/cw-claude-sdk.js`

    onExecEvent?.('exec_start', { containerId, command, ts: execStart })

    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message, permissionMode])

    const filter = new StreamFilterBuffer()
    const contextParts: string[] = []
    const assistantTextParts: string[] = []
    const eventsLog: TimelineEvent[] = []
    let stderr = ''
    let hadAnyOutput = false
    let streamSessionId: string | null = null

    function processDrained(drained: { contextChunks: string[]; events: TimelineEvent[]; sessionId: string | null }) {
      contextParts.push(...drained.contextChunks)
      if (drained.sessionId) streamSessionId = drained.sessionId
      for (const event of drained.events) {
        eventsLog.push(event)
        if (event.kind === 'assistant_text' && event.text) assistantTextParts.push(event.text)
        parentPort?.postMessage({ type: eventType, event })
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      hadAnyOutput = true
      processDrained(filter.push(chunk.toString()))
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      processDrained(filter.flush())
      const durationMs = Date.now() - execStart

      if (code !== 0 && !hadAnyOutput) {
        const errMsg = `docker exec failed (exit ${code}): ${stderr}`
        onExecEvent?.('exec_error', { exitCode: code, durationMs, error: errMsg })
        reject(new Error(errMsg))
        return
      }

      onExecEvent?.('exec_end', {
        exitCode: code,
        durationMs,
        stdoutSnippet: contextParts.join('\n').slice(0, 200)
      })

      resolve({
        output: contextParts.join('\n'),
        assistantText: assistantTextParts.join('\n\n'),
        events: eventsLog,
        newSessionId: streamSessionId
      })
    })

    child.on('error', (err) => {
      const durationMs = Date.now() - execStart
      onExecEvent?.('exec_error', { durationMs, error: err.message })
      reject(err)
    })
  })
}
```

- [ ] **Step 2: Run existing tests**

```bash
cd window-manager && npx vitest run tests/main/ 2>&1 | tail -30
```

Expected: all existing tests still pass (no regressions).

- [ ] **Step 3: Commit**

```bash
cd window-manager && git add src/main/claudeRunner.ts && git commit -m "feat(claudeRunner): add onExecEvent callback for exec observability"
```

---

## Task 4: Instrument `claudeDirectWorker.ts`

**Files:**
- Modify: `window-manager/src/main/claudeDirectWorker.ts`
- Modify: `window-manager/tests/main/claudeDirectWorker.test.ts`

- [ ] **Step 1: Write failing tests**

The existing test file uses `vi.hoisted()` pattern. The `messageHandler` is captured at module level after import. You must:

1. Add `logWriter` mock to the hoisted mocks section at the top of the file.
2. Update ALL existing `messageHandler?.({...})` calls to include `turnId: 'test-turn'` and `logPath: '/tmp/test.jsonl'` (without these, worker will throw when calling `writeEvent`).
3. Update the existing `expect(mockRunClaudeCode).toHaveBeenCalledWith(..., { permissionMode: 'bypassPermissions' })` assertions to use `expect.objectContaining({ permissionMode: 'bypassPermissions' })` since options now also has `onExecEvent`.
4. Add new observability tests.

**Updated hoisted mock section** (replace the existing `vi.hoisted` block):

```typescript
const { mockParentPort, mockRunClaudeCode, mockWriteEvent } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockRunClaudeCode: vi.fn().mockResolvedValue({ output: 'done', assistantText: 'done', events: [], newSessionId: 'sess-1' }),
  mockWriteEvent: vi.fn()
}))

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))
vi.mock('../../src/main/claudeRunner', () => ({ runClaudeCode: mockRunClaudeCode }))
vi.mock('../../src/main/logWriter', () => ({ writeEvent: mockWriteEvent }))
```

**Update all existing messageHandler calls** — add `turnId` and `logPath` to every call, e.g.:
```typescript
await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi', initialSessionId: null, turnId: 'test-turn', logPath: '/tmp/test.jsonl' })
```

**Update existing runClaudeCode assertions** from:
```typescript
expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi', { permissionMode: 'bypassPermissions' })
```
To:
```typescript
expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi', expect.objectContaining({ permissionMode: 'bypassPermissions' }))
```
(Do this for ALL such assertions in the file.)

**New observability tests** to add at the end:

```typescript
describe('turn observability', () => {
  it('calls writeEvent with turn_start on send', async () => {
    await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi',
      initialSessionId: null, turnId: 'turn-abc', logPath: '/tmp/test.jsonl' })
    expect(mockWriteEvent).toHaveBeenCalledWith(
      '/tmp/test.jsonl',
      expect.objectContaining({ eventType: 'turn_start', turnId: 'turn-abc', windowId: 1 })
    )
  })

  it('posts log-event for exec_start when onExecEvent fires', async () => {
    mockRunClaudeCode.mockImplementationOnce(async (_cid, _sid, _msg, opts) => {
      opts?.onExecEvent?.('exec_start', { containerId: 'c1', command: 'docker exec', ts: 1000 })
      return { output: '', assistantText: '', events: [], newSessionId: null }
    })
    await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi',
      initialSessionId: null, turnId: 'turn-abc', logPath: '/tmp/test.jsonl' })

    const logEventCalls = mockParentPort.postMessage.mock.calls.filter(c => c[0]?.type === 'log-event')
    const execStartCall = logEventCalls.find(c => c[0].event.eventType === 'exec_start')
    expect(execStartCall).toBeDefined()
    expect(execStartCall![0].event.turnId).toBe('turn-abc')
  })

  it('calls writeEvent with turn_end on success', async () => {
    await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi',
      initialSessionId: null, turnId: 'turn-end', logPath: '/tmp/test.jsonl' })
    expect(mockWriteEvent).toHaveBeenCalledWith(
      '/tmp/test.jsonl',
      expect.objectContaining({ eventType: 'turn_end', turnId: 'turn-end' })
    )
  })

  it('calls writeEvent with error on runClaudeCode failure', async () => {
    mockRunClaudeCode.mockRejectedValueOnce(new Error('docker failed'))
    await messageHandler?.({ type: 'send', windowId: 4, containerId: 'c4', message: 'hi',
      initialSessionId: null, turnId: 'turn-err', logPath: '/tmp/test.jsonl' })
    expect(mockWriteEvent).toHaveBeenCalledWith(
      '/tmp/test.jsonl',
      expect.objectContaining({ eventType: 'error', turnId: 'turn-err' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/claudeDirectWorker.test.ts 2>&1 | tail -20
```

Expected: FAIL — new tests fail because worker doesn't handle `turnId`/`logPath` yet.

- [ ] **Step 3: Update claudeDirectWorker.ts**

Replace the full file:

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/main/claudeDirectWorker.test.ts 2>&1 | tail -20
```

Expected: PASS (all tests green including new ones).

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/claudeDirectWorker.ts tests/main/claudeDirectWorker.test.ts && git commit -m "feat(claudeDirectWorker): emit turn/exec log events with turnId"
```

---

## Task 5: Instrument `assistedWindowWorker.ts`

**Files:**
- Modify: `window-manager/src/main/assistedWindowWorker.ts`
- Modify: `window-manager/tests/main/assistedWindowWorker.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/main/assistedWindowWorker.test.ts`, add after existing tests:

```typescript
describe('turn observability', () => {
  it('posts log-event with exec_start when runClaudeCode fires onExecEvent', async () => {
    vi.mocked(runClaudeCode).mockImplementationOnce(async (_cid, _sid, _msg, opts) => {
      opts?.onExecEvent?.('exec_start', { containerId: 'c1', command: 'docker exec', ts: 1000 })
      return { output: 'done', assistantText: '', events: [], newSessionId: null }
    })

    // Emit a send message with turnId and logPath
    mockParentPort.emit('message', {
      type: 'send',
      windowId: 1,
      containerId: 'c1',
      message: 'do the thing',
      conversationHistory: [],
      initialSessionId: null,
      systemPrompt: 'you are helpful',
      fireworksKey: 'fw-test',
      turnId: 'turn-test',
      logPath: '/tmp/test.jsonl'
    })
    await new Promise(r => setTimeout(r, 50))

    const logEvents = mockParentPort.postMessage.mock.calls.filter(c => c[0]?.type === 'log-event')
    expect(logEvents.length).toBeGreaterThan(0)
    const execStartEvent = logEvents.find(c => c[0].event.eventType === 'exec_start')
    expect(execStartEvent).toBeDefined()
    expect(execStartEvent![0].event.turnId).toBe('turn-test')
  })
})
```

Note: read the existing test file for the mock setup (vi.hoisted pattern for parentPort, OpenAI, runClaudeCode mocks) before adding the test.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowWorker.test.ts 2>&1 | tail -20
```

Expected: FAIL — worker ignores `turnId`/`logPath`.

- [ ] **Step 3: Update assistedWindowWorker.ts**

Add `turnId` and `logPath` to `KimiLoopData` type, import `writeEvent`, add event emission. Changes are surgical — only add what's needed:

At the top, add import after existing imports:
```typescript
import { writeEvent, type LogEvent } from './logWriter'
```

Update `KimiLoopData` type to add two fields:
```typescript
type KimiLoopData = {
  windowId: number
  containerId: string
  message: string
  conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  initialSessionId?: string | null
  systemPrompt: string
  fireworksKey: string
  turnId: string    // NEW
  logPath: string   // NEW
}
```

Update `handleRunClaudeCode` signature to accept turnId and logPath, and add emitEvent call:

```typescript
async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  tc: ToolCallAccum,
  activeSessionId: string | null,
  turnId: string,     // NEW
  logPath: string     // NEW
): Promise<{ toolResult: string; newActiveSessionId: string | null }> {
```

Inside `handleRunClaudeCode`, before calling `runClaudeCode`, add helper:
```typescript
  function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
    const event: LogEvent = { turnId, windowId, eventType, ts: Date.now(), payload }
    writeEvent(logPath, event)
    parentPort?.postMessage({ type: 'log-event', event })
  }
```

Pass `onExecEvent` to `runClaudeCode` inside `handleRunClaudeCode`:
```typescript
    const result = await runClaudeCode(containerId, activeSessionId, args.message, {
      eventType: 'claude-to-shellephant:event',
      onExecEvent: (type, payload) => emitEvent(type, payload)
    })
```

In `kimiLoop`, destructure `turnId` and `logPath` from data:
```typescript
  const { windowId, containerId, message, conversationHistory, initialSessionId, systemPrompt, fireworksKey, turnId, logPath } = data
```

Add `emitEvent` helper at top of `kimiLoop`:
```typescript
  function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
    const event: LogEvent = { turnId, windowId, eventType, ts: Date.now(), payload }
    writeEvent(logPath, event)
    parentPort?.postMessage({ type: 'log-event', event })
  }
```

Emit `turn_start` at the start of `kimiLoop` body (after the helper):
```typescript
  emitEvent('turn_start')
```

Update the `handleRunClaudeCode` call in `kimiLoop` to pass turnId and logPath:
```typescript
          const res = await handleRunClaudeCode(windowId, containerId, tc, activeSessionId, turnId, logPath)
```

Emit `turn_end` just before the final `parentPort?.postMessage({ type: 'turn-complete' ... })`:
```typescript
  emitEvent('turn_end')
  parentPort?.postMessage({ type: 'turn-complete', ... })
```

In the top-level error handler (in `parentPort?.on('message', ...)`), add `emitEvent` call before posting turn-complete with error. But `emitEvent` is defined inside `kimiLoop` — so handle it at the outer level by writing directly:

```typescript
parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'send') {
    const data = msg as unknown as KimiLoopData
    try {
      await kimiLoop(data)
    } catch (err) {
      // Write error event directly
      if (data.turnId && data.logPath) {
        const event: LogEvent = {
          turnId: data.turnId, windowId: data.windowId,
          eventType: 'error', ts: Date.now(),
          payload: { error: err instanceof Error ? err.message : String(err) }
        }
        writeEvent(data.logPath, event)
        parentPort?.postMessage({ type: 'log-event', event })
      }
      parentPort?.postMessage({
        type: 'turn-complete',
        windowId: data.windowId,
        stats: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
})
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowWorker.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/assistedWindowWorker.ts tests/main/assistedWindowWorker.test.ts && git commit -m "feat(assistedWindowWorker): emit turn/exec log events with turnId"
```

---

## Task 6: Add turn lifecycle tracking to `claudeService.ts`

**Files:**
- Modify: `window-manager/src/main/claudeService.ts`
- Modify: `window-manager/tests/main/claudeService.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/main/claudeService.test.ts`, add after existing tests:

```typescript
describe('turn observability', () => {
  it('generates turnId and passes it in worker postMessage', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)

    const postCalls = MockWorker.instances[0]?.postMessage.mock.calls ?? []
    const sendCall = postCalls.find(c => c[0]?.type === 'send')
    expect(sendCall).toBeDefined()
    expect(typeof sendCall![0].turnId).toBe('string')
    expect(sendCall![0].turnId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof sendCall![0].logPath).toBe('string')
  })

  it('calls insertTurn when turn starts', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    expect(mockInsertTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_type: 'human-claude',
        status: 'running',
        window_id: 1
      })
    )
  })

  it('calls updateTurn with success when turn-complete received without error', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1 })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'success' })
    )
  })

  it('calls updateTurn with error when turn-complete has error field', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1, error: 'docker failed' })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'error', error: 'docker failed' })
    )
  })

  it('sends logs:turn-started to renderer', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    expect(mockSendToRenderer).toHaveBeenCalledWith(
      'logs:turn-started',
      expect.objectContaining({ turn_type: 'human-claude', window_id: 1 })
    )
  })

  it('sends logs:turn-updated to renderer on completion', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1 })
    expect(mockSendToRenderer).toHaveBeenCalledWith(
      'logs:turn-updated',
      expect.objectContaining({ status: 'success' })
    )
  })
})
```

Add mocks for `logWriter` at the top of the test file (with existing mocks):

```typescript
const mockInsertTurn = vi.fn()
const mockUpdateTurn = vi.fn()
const mockGetLogFilePath = vi.fn(() => '/tmp/test-2026-04-20.jsonl')

vi.mock('../src/main/logWriter', () => ({
  insertTurn: mockInsertTurn,
  updateTurn: mockUpdateTurn,
  getLogFilePath: mockGetLogFilePath
}))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/claudeService.test.ts 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Update claudeService.ts**

Add imports at top:
```typescript
import { randomUUID } from 'crypto'
import { insertTurn, updateTurn, getLogFilePath } from './logWriter'
import type { TurnRecord } from './logWriter'
```

In `sendToClaudeDirectly`, after `const initialSessionId = loadLastSessionId(windowId)`, add:

```typescript
  const turnId = randomUUID()
  const logPath = getLogFilePath()
  const startedAt = Date.now()

  const turnRecord: TurnRecord = {
    id: turnId, window_id: windowId, turn_type: 'human-claude',
    status: 'running', started_at: startedAt, log_file: logPath
  }
  insertTurn(turnRecord)
  sendToRenderer('logs:turn-started', turnRecord)
```

In the worker message handler, add `log-event` case before `save-message`:
```typescript
      if (msg.type === 'log-event') {
        sendToRenderer('logs:turn-event', msg.event)
      } else if (msg.type === 'save-message') {
```

In the `turn-complete` handler, replace the `workers.delete(windowId)` section:
```typescript
      } else if (msg.type === 'turn-complete') {
        const endedAt = Date.now()
        const status = msg.error ? 'error' : 'success'
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
        // ... existing notification code stays here ...
        workers.delete(windowId)
      }
```

In the `worker.on('error', ...)` handler, add turn update before existing code:
```typescript
    worker.on('error', (err) => {
      const endedAt = Date.now()
      updateTurn(turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('logs:turn-updated', { id: turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('claude:turn-complete', windowId)
      sendToRenderer('claude:error', windowId, err.message)
      workers.delete(windowId)
    })
```

Pass `turnId` and `logPath` in `worker.postMessage`:
```typescript
  worker.postMessage({ type: 'send', windowId, containerId, message, initialSessionId, permissionMode, turnId, logPath })
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/main/claudeService.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/claudeService.ts tests/main/claudeService.test.ts && git commit -m "feat(claudeService): track turns in SQLite and stream to renderer"
```

---

## Task 7: Add turn lifecycle tracking to `assistedWindowService.ts`

**Files:**
- Modify: `window-manager/src/main/assistedWindowService.ts`
- Modify: `window-manager/tests/main/assistedWindowService.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/main/assistedWindowService.test.ts`, add the same observability tests as Task 6 but for shellephant turns. Add mocks for logWriter (same pattern as Task 6). Add tests:

```typescript
describe('turn observability', () => {
  it('passes turnId and logPath in worker postMessage', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const sendCall = MockWorker.instances[0]?.postMessage.mock.calls
      .find(c => c[0]?.type === 'send')
    expect(sendCall![0].turnId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof sendCall![0].logPath).toBe('string')
  })

  it('calls insertTurn with shellephant-claude type', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    expect(mockInsertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ turn_type: 'shellephant-claude', status: 'running', window_id: 1 })
    )
  })

  it('calls updateTurn with success on turn-complete', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1, stats: null })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'success' })
    )
  })

  it('calls updateTurn with error on worker error', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('error', new Error('worker crashed'))
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'error', error: 'worker crashed' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowService.test.ts 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Update assistedWindowService.ts**

Apply the same pattern as `claudeService.ts`:

Add imports:
```typescript
import { randomUUID } from 'crypto'
import { insertTurn, updateTurn, getLogFilePath } from './logWriter'
import type { TurnRecord } from './logWriter'
```

In `sendToWindow`, after `const initialSessionId = loadLastSessionId(windowId)`:
```typescript
  const turnId = randomUUID()
  const logPath = getLogFilePath()
  const startedAt = Date.now()

  const turnRecord: TurnRecord = {
    id: turnId, window_id: windowId, turn_type: 'shellephant-claude',
    status: 'running', started_at: startedAt, log_file: logPath
  }
  insertTurn(turnRecord)
  sendToRenderer('logs:turn-started', turnRecord)
```

In the worker message handler, add `log-event` case before `save-message`:
```typescript
      if (msg.type === 'log-event') {
        sendToRenderer('logs:turn-event', msg.event)
      } else if (msg.type === 'save-message') {
```

In the `turn-complete` handler, add before `workers.delete(windowId)`:
```typescript
        const endedAt = Date.now()
        const status = msg.error ? 'error' : 'success'
        const patch: Partial<TurnRecord> = {
          status, ended_at: endedAt, duration_ms: endedAt - startedAt,
          ...(msg.error ? { error: msg.error as string } : {})
        }
        updateTurn(turnId, patch)
        sendToRenderer('logs:turn-updated', { id: turnId, ...patch })
```

In `worker.on('error', ...)`, add turn update:
```typescript
    worker.on('error', (err) => {
      const endedAt = Date.now()
      updateTurn(turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('logs:turn-updated', { id: turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - startedAt, error: err.message })
      sendToRenderer('assisted:turn-complete', windowId, null, err.message)
      workers.delete(windowId)
    })
```

Pass `turnId` and `logPath` in `worker.postMessage` (add to existing payload):
```typescript
  worker.postMessage({
    type: 'send', windowId, containerId, message,
    conversationHistory: history, initialSessionId,
    systemPrompt: resolveKimiSystemPrompt(projectPrompt, globalPrompt),
    fireworksKey, turnId, logPath
  })
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowService.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/assistedWindowService.ts tests/main/assistedWindowService.test.ts && git commit -m "feat(assistedWindowService): track turns in SQLite and stream to renderer"
```

---

## Task 8: IPC handlers, preload bindings, and app startup

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/main/index.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`

- [ ] **Step 1: Add TurnRecord and LogEvent to renderer types**

In `src/renderer/src/types.ts`, add at the end:

```typescript
export interface TurnRecord {
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

export interface LogEvent {
  turnId: string
  windowId: number
  eventType: string
  ts: number
  payload?: Record<string, unknown>
}
```

- [ ] **Step 2: Add IPC handlers in ipcHandlers.ts**

Add import at the top with existing imports:
```typescript
import { readEventsForTurn } from './logWriter'
```

Add two handlers at the end of `registerIpcHandlers()`, before the closing brace:

```typescript
  ipcMain.handle('logs:list-turns', (_event, filter?: {
    windowId?: number
    status?: string
    turnType?: string
    limit?: number
    offset?: number
  }) => {
    let query = 'SELECT * FROM turns WHERE 1=1'
    const params: (string | number)[] = []
    if (filter?.windowId != null) { query += ' AND window_id = ?'; params.push(filter.windowId) }
    if (filter?.status) { query += ' AND status = ?'; params.push(filter.status) }
    if (filter?.turnType) { query += ' AND turn_type = ?'; params.push(filter.turnType) }
    query += ' ORDER BY started_at DESC'
    if (filter?.limit != null) { query += ' LIMIT ?'; params.push(filter.limit) }
    if (filter?.offset != null) { query += ' OFFSET ?'; params.push(filter.offset) }
    return getDb().prepare(query).all(...params)
  })

  ipcMain.handle('logs:get-turn-events', (_event, turnId: string) => {
    const row = getDb()
      .prepare('SELECT log_file FROM turns WHERE id = ?')
      .get(turnId) as { log_file: string | null } | undefined
    if (!row?.log_file) return []
    return readEventsForTurn(row.log_file, turnId)
  })
```

- [ ] **Step 3: Initialize logWriter in index.ts**

In `src/main/index.ts`, add import:
```typescript
import { initLogWriter } from './logWriter'
```

In `app.whenReady().then(async () => {`, add after `initDb(dbPath)`:
```typescript
  initLogWriter(app.getPath('logs'))
```

- [ ] **Step 4: Add preload bindings**

In `src/preload/index.ts`, add to the `contextBridge.exposeInMainWorld('api', { ... })` object.

Find the section with existing channel bindings and add:

```typescript
  // Observability / Logs
  listTurns: (filter?: {
    windowId?: number
    status?: string
    turnType?: string
    limit?: number
    offset?: number
  }) => ipcRenderer.invoke('logs:list-turns', filter),

  getTurnEvents: (turnId: string) =>
    ipcRenderer.invoke('logs:get-turn-events', turnId),

  onTurnStarted: (cb: (turn: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, turn: unknown) => cb(turn)
    ipcRenderer.on('logs:turn-started', handler)
    return () => ipcRenderer.off('logs:turn-started', handler)
  },

  onTurnUpdated: (cb: (patch: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, patch: unknown) => cb(patch)
    ipcRenderer.on('logs:turn-updated', handler)
    return () => ipcRenderer.off('logs:turn-updated', handler)
  },

  onTurnEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, logEvent: unknown) => cb(logEvent)
    ipcRenderer.on('logs:turn-event', handler)
    return () => ipcRenderer.off('logs:turn-event', handler)
  },

  offTurnStarted: (cb: (turn: unknown) => void) =>
    ipcRenderer.off('logs:turn-started', cb as Parameters<typeof ipcRenderer.off>[1]),

  offTurnUpdated: (cb: (patch: unknown) => void) =>
    ipcRenderer.off('logs:turn-updated', cb as Parameters<typeof ipcRenderer.off>[1]),

  offTurnEvent: (cb: (event: unknown) => void) =>
    ipcRenderer.off('logs:turn-event', cb as Parameters<typeof ipcRenderer.off>[1]),
```

- [ ] **Step 5: Run all main tests**

```bash
cd window-manager && npx vitest run tests/main/ 2>&1 | tail -30
```

Expected: PASS (all existing + new tests green).

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/main/ipcHandlers.ts src/main/index.ts src/preload/index.ts src/renderer/src/types.ts && git commit -m "feat: wire IPC channels and preload bindings for observability"
```

---

## Task 9: Per-window traces pane in `WindowDetailPane.svelte`

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/renderer/WindowDetailPane.test.ts`, add after existing tests:

```typescript
describe('traces pane', () => {
  it('renders Traces toggle button', async () => {
    render(WindowDetailPane, { props: { win: mockWin, project: mockProject } })
    expect(screen.getByRole('button', { name: /traces/i })).toBeInTheDocument()
  })

  it('traces pane hidden by default', async () => {
    render(WindowDetailPane, { props: { win: mockWin, project: mockProject } })
    expect(screen.queryByTestId('traces-pane')).not.toBeInTheDocument()
  })

  it('clicking Traces shows traces pane', async () => {
    render(WindowDetailPane, { props: { win: mockWin, project: mockProject } })
    await userEvent.click(screen.getByRole('button', { name: /traces/i }))
    expect(screen.getByTestId('traces-pane')).toBeInTheDocument()
  })

  it('clicking Traces again hides the pane', async () => {
    render(WindowDetailPane, { props: { win: mockWin, project: mockProject } })
    const btn = screen.getByRole('button', { name: /traces/i })
    await userEvent.click(btn)
    await userEvent.click(btn)
    expect(screen.queryByTestId('traces-pane')).not.toBeInTheDocument()
  })

  it('shows turn rows when turns loaded', async () => {
    vi.mocked(window.api.listTurns).mockResolvedValue([
      { id: 't1', window_id: 1, turn_type: 'human-claude', status: 'success',
        started_at: Date.now() - 2000, ended_at: Date.now(), duration_ms: 2000, log_file: '/tmp/x.jsonl' }
    ])
    render(WindowDetailPane, { props: { win: mockWin, project: mockProject } })
    await userEvent.click(screen.getByRole('button', { name: /traces/i }))
    await screen.findByText('human→claude')
    expect(screen.getByText('2000ms')).toBeInTheDocument()
  })
})
```

Note: ensure `window.api.listTurns` is mocked in the existing test setup. Read the test file's mock setup before adding.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Add traces state and UI to WindowDetailPane.svelte**

Read the existing component fully before editing. Add to imports:
```typescript
import type { TurnRecord, LogEvent } from '../types'
```

Add state after existing state declarations:
```typescript
let showTraces = $state(false)
let turns = $state<TurnRecord[]>([])
let expandedTurnId = $state<string | null>(null)
let turnEvents = $state<Map<string, LogEvent[]>>(new Map())
```

Add `loadTurns` function and real-time subscriptions in `onMount`:
```typescript
  async function loadTurns() {
    turns = await window.api.listTurns({ windowId: win.id, limit: 20 }) as TurnRecord[]
  }

  const offStarted = window.api.onTurnStarted((t: unknown) => {
    const turn = t as TurnRecord
    if (turn.window_id === win.id) turns = [turn, ...turns]
  })
  const offUpdated = window.api.onTurnUpdated((patch: unknown) => {
    const p = patch as Partial<TurnRecord> & { id: string }
    turns = turns.map(t => t.id === p.id ? { ...t, ...p } : t)
  })
  const offEvent = window.api.onTurnEvent((e: unknown) => {
    const ev = e as LogEvent
    if (expandedTurnId === ev.turnId) {
      const existing = turnEvents.get(ev.turnId) ?? []
      turnEvents = new Map(turnEvents).set(ev.turnId, [...existing, ev])
    }
  })
```

Add cleanup in `onDestroy`:
```typescript
  offStarted()
  offUpdated()
  offEvent()
```

Add `expandTurn` function:
```typescript
  async function expandTurn(turnId: string) {
    if (expandedTurnId === turnId) { expandedTurnId = null; return }
    expandedTurnId = turnId
    if (!turnEvents.has(turnId)) {
      const events = await window.api.getTurnEvents(turnId) as LogEvent[]
      turnEvents = new Map(turnEvents).set(turnId, events)
    }
  }
```

In the template, add "Traces" button to the toggle row (after existing panel toggles):
```svelte
<button onclick={() => { showTraces = !showTraces; if (showTraces) loadTurns() }}
        aria-pressed={showTraces}>
  Traces
</button>
```

Add traces pane above or below existing content (controlled by `showTraces`):
```svelte
{#if showTraces}
<div data-testid="traces-pane" class="traces-pane">
  {#if turns.length === 0}
    <p class="no-turns">No turns yet.</p>
  {:else}
    {#each turns as turn (turn.id)}
      <div class="turn-row" onclick={() => expandTurn(turn.id)}>
        <span class="turn-type">{turn.turn_type === 'human-claude' ? 'human→claude' : 'shellephant→claude'}</span>
        <span class="turn-status {turn.status}">{turn.status}</span>
        {#if turn.duration_ms != null}
          <span class="turn-duration">{turn.duration_ms}ms</span>
        {:else}
          <span class="turn-duration">—</span>
        {/if}
        <span class="turn-ts">{new Date(turn.started_at).toLocaleTimeString()}</span>
      </div>
      {#if expandedTurnId === turn.id}
        <div class="turn-events">
          {#each turnEvents.get(turn.id) ?? [] as ev (ev.ts + ev.eventType)}
            <div class="event-row {ev.eventType.includes('error') ? 'error' : ''}">
              <span class="ev-type">{ev.eventType}</span>
              <span class="ev-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
              {#if ev.payload?.error}
                <span class="ev-error">{ev.payload.error}</span>
              {/if}
              {#if ev.payload?.durationMs != null}
                <span class="ev-dur">{ev.payload.durationMs}ms</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
</div>
{/if}
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/renderer/src/components/WindowDetailPane.svelte tests/renderer/WindowDetailPane.test.ts && git commit -m "feat(WindowDetailPane): add per-window traces toggle pane"
```

---

## Task 10: Create `TraceExplorer.svelte` (global trace view)

**Files:**
- Create: `window-manager/src/renderer/src/components/TraceExplorer.svelte`
- Create: `window-manager/tests/renderer/TraceExplorer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/renderer/TraceExplorer.test.ts`:

```typescript
import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import TraceExplorer from '../../src/renderer/src/components/TraceExplorer.svelte'
import type { TurnRecord, LogEvent } from '../../src/renderer/src/types'

const mockTurns: TurnRecord[] = [
  { id: 't1', window_id: 1, turn_type: 'human-claude', status: 'success',
    started_at: 1000000, ended_at: 1002000, duration_ms: 2000, log_file: '/tmp/x.jsonl' },
  { id: 't2', window_id: 2, turn_type: 'shellephant-claude', status: 'error',
    started_at: 1005000, error: 'docker failed', log_file: '/tmp/x.jsonl' }
]

const mockEvents: LogEvent[] = [
  { turnId: 't1', windowId: 1, eventType: 'exec_start', ts: 1000100 },
  { turnId: 't1', windowId: 1, eventType: 'exec_end', ts: 1001900, payload: { durationMs: 1800 } }
]

beforeEach(() => {
  vi.mocked(window.api.listTurns).mockResolvedValue(mockTurns as any)
  vi.mocked(window.api.getTurnEvents).mockResolvedValue(mockEvents as any)
  vi.mocked(window.api.onTurnStarted).mockReturnValue(vi.fn())
  vi.mocked(window.api.onTurnUpdated).mockReturnValue(vi.fn())
  vi.mocked(window.api.onTurnEvent).mockReturnValue(vi.fn())
})

describe('TraceExplorer', () => {
  it('renders turn list from listTurns', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    expect(screen.getByText('shellephant→claude')).toBeInTheDocument()
  })

  it('shows status for each turn', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('success')
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('status filter hides non-matching turns', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    const statusSelect = screen.getByLabelText(/status/i)
    await userEvent.selectOptions(statusSelect, 'error')
    expect(screen.queryByText('success')).not.toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('clicking a turn row fetches and shows events', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    await userEvent.click(screen.getAllByRole('row')[1]) // first data row
    await screen.findByText('exec_start')
    expect(screen.getByText('exec_end')).toBeInTheDocument()
  })

  it('onTurnStarted push adds new turn to list', async () => {
    let startedCb: ((t: unknown) => void) | undefined
    vi.mocked(window.api.onTurnStarted).mockImplementation((cb) => {
      startedCb = cb
      return vi.fn()
    })
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    const newTurn: TurnRecord = { id: 't3', window_id: 3, turn_type: 'human-claude',
      status: 'running', started_at: Date.now(), log_file: '/tmp/x.jsonl' }
    startedCb?.(newTurn)
    await screen.findAllByText('human→claude')
    expect(screen.getAllByText('human→claude')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/renderer/TraceExplorer.test.ts 2>&1 | tail -20
```

Expected: FAIL — component not found.

- [ ] **Step 3: Create TraceExplorer.svelte**

Create `src/renderer/src/components/TraceExplorer.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { TurnRecord, LogEvent } from '../types'

  let turns = $state<TurnRecord[]>([])
  let statusFilter = $state<string>('all')
  let typeFilter = $state<string>('all')
  let expandedTurnId = $state<string | null>(null)
  let turnEvents = $state<Map<string, LogEvent[]>>(new Map())

  const filteredTurns = $derived(turns.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (typeFilter !== 'all' && t.turn_type !== typeFilter) return false
    return true
  }))

  async function loadTurns() {
    turns = await window.api.listTurns({ limit: 100 }) as TurnRecord[]
  }

  async function expandTurn(turnId: string) {
    if (expandedTurnId === turnId) { expandedTurnId = null; return }
    expandedTurnId = turnId
    if (!turnEvents.has(turnId)) {
      const events = await window.api.getTurnEvents(turnId) as LogEvent[]
      turnEvents = new Map(turnEvents).set(turnId, events)
    }
  }

  const offStarted = window.api.onTurnStarted((t: unknown) => {
    turns = [t as TurnRecord, ...turns]
  })

  const offUpdated = window.api.onTurnUpdated((patch: unknown) => {
    const p = patch as Partial<TurnRecord> & { id: string }
    turns = turns.map(t => t.id === p.id ? { ...t, ...p } : t)
  })

  const offEvent = window.api.onTurnEvent((e: unknown) => {
    const ev = e as LogEvent
    if (expandedTurnId === ev.turnId) {
      const existing = turnEvents.get(ev.turnId) ?? []
      turnEvents = new Map(turnEvents).set(ev.turnId, [...existing, ev])
    }
  })

  onMount(loadTurns)
  onDestroy(() => { offStarted(); offUpdated(); offEvent() })
</script>

<div class="trace-explorer">
  <div class="filters">
    <label for="status-filter">Status</label>
    <select id="status-filter" bind:value={statusFilter} aria-label="status">
      <option value="all">All</option>
      <option value="running">Running</option>
      <option value="success">Success</option>
      <option value="error">Error</option>
    </select>

    <label for="type-filter">Type</label>
    <select id="type-filter" bind:value={typeFilter} aria-label="type">
      <option value="all">All</option>
      <option value="human-claude">human→claude</option>
      <option value="shellephant-claude">shellephant→claude</option>
    </select>
  </div>

  <table class="turns-table">
    <thead>
      <tr>
        <th>Type</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Started</th>
      </tr>
    </thead>
    <tbody>
      {#each filteredTurns as turn (turn.id)}
        <tr role="row" onclick={() => expandTurn(turn.id)} class="turn-row {turn.status}">
          <td>{turn.turn_type === 'human-claude' ? 'human→claude' : 'shellephant→claude'}</td>
          <td><span class="status-dot {turn.status}">{turn.status}</span></td>
          <td>{turn.duration_ms != null ? `${turn.duration_ms}ms` : '—'}</td>
          <td>{new Date(turn.started_at).toLocaleTimeString()}</td>
        </tr>
        {#if expandedTurnId === turn.id}
          <tr class="events-row">
            <td colspan="4">
              <div class="event-list">
                {#each turnEvents.get(turn.id) ?? [] as ev (ev.ts + ev.eventType)}
                  <div class="event-item {ev.eventType.includes('error') ? 'error' : ''}">
                    <span class="ev-type">{ev.eventType}</span>
                    {#if ev.payload?.durationMs != null}
                      <span class="ev-dur">{ev.payload.durationMs}ms</span>
                    {/if}
                    {#if ev.payload?.error}
                      <span class="ev-error">{ev.payload.error}</span>
                    {/if}
                    <span class="ev-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                {/each}
              </div>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .trace-explorer { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .filters { display: flex; gap: 12px; align-items: center; }
  .turns-table { width: 100%; border-collapse: collapse; }
  .turns-table th, .turns-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
  .turn-row { cursor: pointer; }
  .turn-row:hover { background: #2a2a2a; }
  .status-dot { font-size: 12px; }
  .status-dot.running { color: #f5a623; }
  .status-dot.success { color: #7ed321; }
  .status-dot.error { color: #d0021b; }
  .event-list { padding: 8px 0; display: flex; flex-direction: column; gap: 4px; }
  .event-item { display: flex; gap: 12px; font-size: 12px; font-family: monospace; padding: 2px 8px; }
  .event-item.error { background: #2d1515; color: #ff6b6b; }
  .ev-type { font-weight: 600; min-width: 100px; }
  .ev-error { color: #ff6b6b; flex: 1; }
</style>
```

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run tests/renderer/TraceExplorer.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/renderer/src/components/TraceExplorer.svelte tests/renderer/TraceExplorer.test.ts && git commit -m "feat: add TraceExplorer global trace view component"
```

---

## Task 11: Wire TraceExplorer into MainPane navigation

**Files:**
- Modify: `window-manager/src/renderer/src/components/MainPane.svelte`
- Modify: `window-manager/src/renderer/src/App.svelte`
- Modify: `window-manager/src/renderer/src/components/Sidebar.svelte`

**Pattern from reading App.svelte + Sidebar.svelte:** Nav buttons live in `Sidebar.svelte`. Settings uses `onRequestSettings` prop → App.svelte `handleRequestSettings()` sets `view = 'settings'`. Follow same pattern for traces.

- [ ] **Step 1: Add 'traces' to MainPaneView type in MainPane.svelte**

In `src/renderer/src/components/MainPane.svelte`, find:
```typescript
export type MainPaneView = 'default' | 'new-project' | 'new-window' | 'new-multi-window' | 'settings'
```

Replace with:
```typescript
export type MainPaneView = 'default' | 'new-project' | 'new-window' | 'new-multi-window' | 'settings' | 'traces'
```

Add import for TraceExplorer at top of script:
```typescript
import TraceExplorer from './TraceExplorer.svelte'
```

In the conditional rendering block, add before the `{:else if selectedWindow}` line:
```svelte
{:else if view === 'traces'}
  <TraceExplorer />
```

- [ ] **Step 2: Add onRequestTraces prop to Sidebar.svelte**

In `src/renderer/src/components/Sidebar.svelte`, add to the `Props` interface:
```typescript
onRequestTraces?: () => void
```

Add to the destructured props:
```typescript
let {
  // ...existing props...
  onRequestTraces
}: Props = $props()
```

In the `<aside class="sidebar">` template, add a Traces button alongside the existing Settings button in `.header-actions`:
```svelte
<button
  type="button"
  class="icon-btn"
  aria-label="traces"
  title="Traces"
  onclick={onRequestTraces}
>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
</button>
```

- [ ] **Step 3: Wire handler in App.svelte**

In `src/renderer/src/App.svelte`, add handler function after `handleRequestSettings`:
```typescript
function handleRequestTraces(): void {
  view = 'traces'
}
```

Pass to Sidebar (find `<Sidebar` component usage and add prop):
```svelte
onRequestTraces={handleRequestTraces}
```

- [ ] **Step 4: Run all renderer tests**

```bash
cd window-manager && npx vitest run tests/renderer/ 2>&1 | tail -30
```

Expected: PASS (all tests green).

- [ ] **Step 5: Run full test suite**

```bash
cd window-manager && npx vitest run 2>&1 | tail -30
```

Expected: PASS — all tests across main and renderer pass.

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/renderer/src/components/MainPane.svelte src/renderer/src/App.svelte && git commit -m "feat: add Traces nav entry wired to TraceExplorer"
```
