# Observability & Logging Design

**Date:** 2026-04-20  
**Status:** Approved

## Problem

Silent failures throughout the turn execution pipeline. Human calling Claude can fail without any visible trace. Shellephant calling Claude can fail without any visible trace. Worker threads crash with no persistent record. Docker exec errors swallowed by bare `.catch(() => {})`. No correlation IDs, no timing data, no queryable history.

## Goals

- Every turn (human→Claude, Shellephant→Claude) has a persistent record with status, duration, exec count
- Every docker exec invocation logged with command, exit code, duration, error
- Worker thread crashes produce a record, not silence
- In-app UI: per-window trace tab + global trace explorer (LangSmith-style)
- Real-time: live event streaming during active turn
- Post-hoc: queryable history across all windows

## Non-Goals

- LLM API call tracing (token counts, model params) — not in this iteration
- IPC message-level tracing — too granular, YAGNI
- Remote telemetry / cloud export

---

## Architecture

### Approach: Worker-Direct File + SQLite Summary in Main

Workers write directly to JSONL log file (`appendFileSync` — sync, crash-safe, no IPC). Main process writes summary rows to SQLite at turn boundaries only. File is ground truth; SQLite is query index.

This is the most crash-resilient approach: workers log before the parent process knows they failed.

---

## Data Layer

### SQLite — 1 new table

SQLite stores only turn-level summaries. Event detail lives in the JSONL file (file is ground truth; SQLite is query index).

```sql
CREATE TABLE turns (
  id          TEXT PRIMARY KEY,        -- UUID (turnId)
  window_id   INTEGER NOT NULL REFERENCES windows(id),
  turn_type   TEXT NOT NULL,           -- 'human-claude' | 'shellephant-claude'
  status      TEXT NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error'
  started_at  INTEGER NOT NULL,        -- Unix ms
  ended_at    INTEGER,
  duration_ms INTEGER,
  error       TEXT                     -- last error message if status='error'
);
```

**Event types (JSONL only):** `turn_start`, `turn_end`, `exec_start`, `exec_end`, `exec_error`, `worker_spawn`, `worker_exit`, `error`

Column migrations added to `runColumnMigrations()` in `db.ts` using existing `col(db, table).includes(colName)` guard pattern.

### Rolling JSONL Log File

- Path: `app.getPath('logs')/window-manager.jsonl`
- Format: one JSON object per line — `{ turnId, windowId, eventType, ts, payload }`
- Rotation: new file daily, keep last 7 days
- Written by workers via `appendFileSync` (sync write, crash-safe)

### turnId Flow

Generated in main process at turn start (UUID v4). Passed to worker in the `send` message payload alongside existing fields. Worker stamps every file write with it. Main process uses it as FK for all SQLite inserts.

```typescript
// Worker send payload additions
{ type: 'send', windowId, containerId, message, initialSessionId, turnId, logPath }
```

---

## Logging Infrastructure

### `logWriter.ts` (new, `src/main/`)

Single module importable by both main process and worker threads. Workers use file-write functions only (no SQLite/Electron dependency). Main process uses all functions.

```typescript
export type LogEvent = {
  turnId: string;
  windowId: number;
  eventType: string;
  ts: number;
  payload?: Record<string, unknown>;
};

// Worker-safe (file only)
export function writeEvent(logPath: string, event: LogEvent): void;  // appendFileSync

// Main process only (SQLite)
export function insertTurn(turn: TurnRecord): void;
export function updateTurn(id: string, patch: Partial<TurnRecord>): void;
export function rotateLogs(logDir: string): void;  // delete files older than 7 days

// File reading (main process, for IPC handlers)
export function readEventsForTurn(logPath: string, turnId: string): LogEvent[];
```

### Instrumentation Points

**`claudeService.ts` (human → Claude):**
- `sendToClaudeDirectly()`: generate `turnId` (UUID), call `insertTurn({ id: turnId, windowId, turnType: 'human-claude', status: 'running', startedAt: Date.now() })`, pass `turnId` + `logPath` in worker message
- On `turn-complete` message from worker: call `updateTurn(turnId, { status, endedAt, durationMs, error })`

**`assistedWindowService.ts` (Shellephant → Claude):**
- `sendToWindow()`: same pattern — generate `turnId`, `insertTurn` with `turnType: 'shellephant-claude'`, pass to worker
- On `turn-complete`: `updateTurn()`

**`claudeDirectWorker.ts`:**
- On `send` received: `writeEvent(logPath, { eventType: 'turn_start', ... })`
- Passed to `claudeRunner` via callback: before exec → `writeEvent(exec_start)`, after → `writeEvent(exec_end)`, on error → `writeEvent(exec_error)`
- On complete: `writeEvent(turn_end)`

**`assistedWindowWorker.ts`:**
- On `send` received: `writeEvent(turn_start)`
- Before each `docker exec` (in `runClaudeCode`): `writeEvent(exec_start, { command, containerId })`
- After exec: `writeEvent(exec_end, { exitCode, durationMs, stdoutSnippet: output.slice(0, 200) })`
- On error: `writeEvent(exec_error, { error: e.message })`
- On complete: `writeEvent(turn_end)`

**`claudeRunner.ts`:**
- Accept optional `onExecEvent?: (type: string, payload: object) => void` callback
- Call before docker exec spawn, in finally block after resolve/reject
- Workers pass a callback that calls `writeEvent()`

### exec_count

Not stored in SQLite. Computed on demand in the UI by counting `exec_end` events in the JSONL file when a turn is expanded. List view shows only status + duration — exec count shown in turn detail only.

---

## IPC Layer

### New IPC Handlers

```typescript
'logs:list-turns'      // args: { windowId?: number, status?: string, turnType?: string, limit?: number, offset?: number }
                       // returns: TurnRecord[] (from SQLite)

'logs:get-turn-events' // args: { turnId: string }
                       // reads JSONL file, filters by turnId via readEventsForTurn()
                       // returns: LogEvent[]
```

### Real-Time Push (Main → Renderer)

Emitted from `claudeService.ts` and `assistedWindowService.ts` alongside existing `sendToRenderer` calls:

```typescript
'logs:turn-started'   // payload: TurnRecord
'logs:turn-updated'   // payload: { id: string } & Partial<TurnRecord>
'logs:turn-event'     // payload: TurnEventRecord
```

### Preload Additions

```typescript
listTurns(filter?: TurnFilter): Promise<TurnRecord[]>
getTurnEvents(turnId: string): Promise<LogEvent[]>
onTurnStarted(cb: (turn: TurnRecord) => void): () => void
onTurnUpdated(cb: (patch: Partial<TurnRecord>) => void): () => void
onTurnEvent(cb: (event: LogEvent) => void): () => void
offTurnStarted(cb): void
offTurnUpdated(cb): void
offTurnEvent(cb): void
```

---

## UI

### Per-Window Trace Tab (WindowDetailPane)

Add "Traces" toggle button to `WindowDetailPane` toggle row (alongside Claude/Terminal/Editor panel toggles). Clicking opens a collapsible pane above the footer showing:

- List of recent turns for this window (last 20), newest first
- Each turn row: `[type badge] [status dot] [duration] [timestamp]`
  - type badge: `human→claude` or `shellephant→claude`
  - status dot: green=success, red=error, pulsing yellow=running
- Click turn row → expands inline event timeline:
  - Each event shown as a row with timestamp, event type, payload summary
  - `exec_start`/`exec_end` pairs shown as waterfall bar with duration
  - `exec_error` rows highlighted red with full error text
  - Running turns stream new events live via `onTurnEvent`

State: `showTraces` boolean, `turns: TurnRecord[]`, `expandedTurnId: string | null`, `turnEvents: Map<string, TurnEventRecord[]>`

### Global Trace Explorer (TraceExplorer.svelte, new)

New top-level nav entry in `MainPane`. New component `TraceExplorer.svelte`.

**Header bar:**
- Window filter: `<select>` of all windows + "All windows"
- Status filter: `all` / `running` / `success` / `error`  
- Type filter: `all` / `human-claude` / `shellephant-claude`

**Turn list (table):**
| Window | Type | Status | Duration | Started |

Clicking a row opens the detail panel.

**Turn detail panel (right side):**
- Same event timeline as per-window view
- Waterfall rows for exec spans with ms duration
- Errors in red with full text
- Running turns update live

**Real-time behavior:** Both views subscribe to `onTurnStarted`/`onTurnUpdated`/`onTurnEvent` in `onMount`. No polling. Subscriptions cleaned up `onDestroy`.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/main/logWriter.ts` | New — file + SQLite write functions |
| `src/main/db.ts` | Add `turns`, `turn_events` tables + migrations |
| `src/main/claudeService.ts` | Generate turnId, insertTurn, updateTurn |
| `src/main/assistedWindowService.ts` | Same |
| `src/main/claudeDirectWorker.ts` | Accept logPath/turnId, writeEvent calls |
| `src/main/assistedWindowWorker.ts` | Same |
| `src/main/claudeRunner.ts` | Accept onExecEvent callback, emit exec events |
| `src/main/ipcHandlers.ts` | Add logs:list-turns, logs:get-turn-events handlers |
| `src/preload/index.ts` | Add listTurns, getTurnEvents, onTurn* preload bindings |
| `src/renderer/src/components/WindowDetailPane.svelte` | Add Traces toggle + collapsible pane |
| `src/renderer/src/components/TraceExplorer.svelte` | New — global trace view |
| `src/renderer/src/components/MainPane.svelte` | Add Traces nav entry |

---

## Testing

### Unit Tests

**`logWriter.test.ts`** (new)
- `writeEvent` appends valid JSON line to temp file
- `writeEvent` is synchronous — no async failure path
- `insertTurn` writes correct row to in-memory SQLite
- `updateTurn` patches existing row, leaves other columns untouched
- `insertTurnEvent` writes correct row with FK
- `rotateLogs` deletes files older than 7 days, keeps recent

**`db.test.ts` additions**
- `turns` table created with correct columns and FK constraint
- Column migration guard runs without error on existing DB (idempotent)

**`claudeService.test.ts` additions**
- `sendToClaudeDirectly` generates unique `turnId` per call
- `turnId` + `logPath` present in message posted to worker
- Worker `turn-complete` triggers `updateTurn` with `status: 'success'`
- Worker `turn-complete` with error field triggers `updateTurn` with `status: 'error'`

**`assistedWindowService.test.ts` additions**
- Same turnId generation and updateTurn coverage

### IPC Handler Tests

**`ipcHandlers` additions**
- `logs:list-turns` with `windowId` returns only turns for that window
- `logs:list-turns` with `status: 'error'` filters correctly
- `logs:get-turn-events` returns events ordered by `ts` ascending

### Component Tests

**`TraceExplorer.test.ts`** (new)
- Renders turn list from mocked `listTurns()`
- Status filter change updates displayed turns
- Click turn row fetches events via `getTurnEvents` and renders timeline
- `onTurnStarted` push prepends new turn to list
- `onTurnEvent` push appends event row to expanded turn's timeline

**`WindowDetailPane.test.ts` additions**
- Traces button renders and toggles trace pane
- Running turn shows status dot with `running` class
- `onTurnEvent` appends event row when turn is expanded
