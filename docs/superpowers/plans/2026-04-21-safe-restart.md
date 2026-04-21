# Safe Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent DB rot and surface interrupted turns in the UI when the app restarts while Claude or Shellephant is mid-run.

**Architecture:** Add `orphaned` turn status; mark all `running` turns orphaned at startup (crash recovery) and on `before-quit` (graceful shutdown); terminate workers on shutdown; extend `assisted:history` IPC to return orphaned turn info; render an interactive "Turn interrupted — Re-send" bubble in `AssistedPanel`.

**Tech Stack:** Electron (main process), Node.js Worker threads, better-sqlite3, Svelte 5 runes, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/main/logWriter.ts` | Add `markOrphanedTurns()`, `getOrphanedTurns(windowId)`, update `TurnRecord.status` union |
| `src/main/claudeService.ts` | Add `terminateAllWorkers()` export |
| `src/main/assistedWindowService.ts` | Add `terminateAllAssistedWorkers()` export |
| `src/main/index.ts` | Startup cleanup call + `before-quit` handler |
| `src/main/ipcHandlers.ts` | Extend `assisted:history` to return `{ messages, orphanedTurns }` |
| `src/preload/index.ts` | Update `assistedHistory` return type comment |
| `src/renderer/src/components/AssistedPanel.svelte` | Handle new history shape, render orphaned bubbles |
| `tests/main/logWriter.test.ts` | Tests for `markOrphanedTurns`, `getOrphanedTurns` |
| `tests/main/claudeService.test.ts` | Test for `terminateAllWorkers` |
| `tests/main/assistedWindowService.test.ts` | Test for `terminateAllAssistedWorkers` |
| `tests/renderer/AssistedPanel.test.ts` | Tests for orphaned bubble rendering + re-send |

---

## Task 1: Extend `logWriter.ts` — orphaned turn functions

**Files:**
- Modify: `window-manager/src/main/logWriter.ts`
- Modify: `window-manager/tests/main/logWriter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `window-manager/tests/main/logWriter.test.ts` after the existing `insertTurn / updateTurn` describe block:

```typescript
describe('markOrphanedTurns', () => {
  it('updates all running turns to orphaned', () => {
    const mockRun = vi.fn()
    const mockPrepare = vi.fn(() => ({ run: mockRun }))
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)

    markOrphanedTurns()

    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'orphaned'")
    )
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining("WHERE status = 'running'")
    )
    expect(mockRun).toHaveBeenCalled()
  })
})

describe('getOrphanedTurns', () => {
  it('queries orphaned turns for window ordered by started_at ASC', () => {
    const expected = [
      { id: 'turn-1', started_at: 1000, turn_type: 'human-claude' },
      { id: 'turn-2', started_at: 2000, turn_type: 'shellephant-claude' }
    ]
    const mockAll = vi.fn().mockReturnValue(expected)
    const mockPrepare = vi.fn(() => ({ all: mockAll }))
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)

    const result = getOrphanedTurns(42)

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'orphaned'"))
    expect(mockAll).toHaveBeenCalledWith(42)
    expect(result).toEqual(expected)
  })

  it('returns empty array when no orphaned turns', () => {
    const mockAll = vi.fn().mockReturnValue([])
    const mockPrepare = vi.fn(() => ({ all: mockAll }))
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)

    expect(getOrphanedTurns(1)).toEqual([])
  })
})
```

Also add `markOrphanedTurns` and `getOrphanedTurns` to the import line at the top of `logWriter.test.ts`:

```typescript
import {
  initLogWriter,
  getLogFilePath,
  writeEvent,
  insertTurn,
  updateTurn,
  markOrphanedTurns,
  getOrphanedTurns,
  readEventsForTurn,
  rotateLogs,
  __resetForTests,
  type LogEvent,
  type TurnRecord,
  type OrphanedTurnRecord
} from '../../src/main/logWriter'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/logWriter.test.ts
```

Expected: FAIL — `markOrphanedTurns` and `getOrphanedTurns` not exported

- [ ] **Step 3: Implement in `logWriter.ts`**

Update `TurnRecord.status` union (line 30) and add two new exports after `updateTurn`:

```typescript
export type TurnRecord = {
  id: string
  window_id: number
  turn_type: 'human-claude' | 'shellephant-claude'
  status: 'running' | 'success' | 'error' | 'orphaned'
  started_at: number
  ended_at?: number
  duration_ms?: number
  error?: string
  log_file?: string
}
```

```typescript
export type OrphanedTurnRecord = {
  id: string
  started_at: number
  turn_type: string
}

export function markOrphanedTurns(): void {
  getDb()
    .prepare("UPDATE turns SET status = 'orphaned' WHERE status = 'running'")
    .run()
}

export function getOrphanedTurns(windowId: number): OrphanedTurnRecord[] {
  return getDb()
    .prepare(
      `SELECT id, started_at, turn_type FROM turns
       WHERE window_id = ? AND status = 'orphaned'
       ORDER BY started_at ASC`
    )
    .all(windowId) as OrphanedTurnRecord[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/logWriter.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/logWriter.ts window-manager/tests/main/logWriter.test.ts
git commit -m "feat: add markOrphanedTurns and getOrphanedTurns to logWriter"
```

---

## Task 2: Add `terminateAllWorkers` to `claudeService.ts`

**Files:**
- Modify: `window-manager/src/main/claudeService.ts`
- Modify: `window-manager/tests/main/claudeService.test.ts`

- [ ] **Step 1: Write failing test**

Read `window-manager/tests/main/claudeService.test.ts` to find end of file. Add after existing tests:

```typescript
describe('terminateAllWorkers', () => {
  it('terminates all active workers and clears maps', async () => {
    const mockSendToRenderer = vi.fn()
    // Spawn a worker by sending a message
    const p = sendToClaudeDirectly(1, 'c1', 'hello', mockSendToRenderer)
    expect(getDirectWorkerCount()).toBe(1)

    terminateAllWorkers()

    expect(getDirectWorkerCount()).toBe(0)
    await p.catch(() => {/* worker terminated */})
  })

  it('is a no-op when no workers active', () => {
    expect(() => terminateAllWorkers()).not.toThrow()
    expect(getDirectWorkerCount()).toBe(0)
  })
})
```

Add `terminateAllWorkers` to the import:

```typescript
import {
  sendToClaudeDirectly,
  cancelClaudeDirect,
  getDirectWorkerCount,
  terminateAllWorkers,
  __resetDirectWorkersForTests
} from '../../src/main/claudeService'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/claudeService.test.ts
```

Expected: FAIL — `terminateAllWorkers` not exported

- [ ] **Step 3: Implement in `claudeService.ts`**

Add after `cancelClaudeDirect` (line 147):

```typescript
export function terminateAllWorkers(): void {
  for (const worker of workers.values()) {
    worker.terminate()
  }
  workers.clear()
  activeTurnIds.clear()
  activeTurnCtx.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/claudeService.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/claudeService.ts window-manager/tests/main/claudeService.test.ts
git commit -m "feat: add terminateAllWorkers bulk shutdown to claudeService"
```

---

## Task 3: Add `terminateAllAssistedWorkers` to `assistedWindowService.ts`

**Files:**
- Modify: `window-manager/src/main/assistedWindowService.ts`
- Modify: `window-manager/tests/main/assistedWindowService.test.ts`

- [ ] **Step 1: Write failing test**

Read `window-manager/tests/main/assistedWindowService.test.ts` to find end of file. Add after existing tests:

```typescript
describe('terminateAllAssistedWorkers', () => {
  it('terminates all active workers and clears maps', async () => {
    const mockSendToRenderer = vi.fn()
    await sendToWindow(1, 'c1', 'hello', null, mockSendToRenderer)
    expect(getWorkerCount()).toBe(1)

    terminateAllAssistedWorkers()

    expect(getWorkerCount()).toBe(0)
  })

  it('is a no-op when no workers active', () => {
    expect(() => terminateAllAssistedWorkers()).not.toThrow()
    expect(getWorkerCount()).toBe(0)
  })
})
```

Add `terminateAllAssistedWorkers` to the import:

```typescript
import {
  sendToWindow,
  cancelWindow,
  getWorkerCount,
  terminateAllAssistedWorkers,
  __resetWorkersForTests
} from '../../src/main/assistedWindowService'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowService.test.ts
```

Expected: FAIL — `terminateAllAssistedWorkers` not exported

- [ ] **Step 3: Implement in `assistedWindowService.ts`**

Add after `cancelWindow` (line 261):

```typescript
export function terminateAllAssistedWorkers(): void {
  for (const worker of workers.values()) {
    worker.terminate()
  }
  workers.clear()
  workerCtxSetters.clear()
  workerCtxMap.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/assistedWindowService.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/assistedWindowService.ts window-manager/tests/main/assistedWindowService.test.ts
git commit -m "feat: add terminateAllAssistedWorkers bulk shutdown to assistedWindowService"
```

---

## Task 4: Startup cleanup + graceful shutdown in `index.ts`

**Files:**
- Modify: `window-manager/src/main/index.ts`

No unit test for `index.ts` (Electron bootstrap — integration concern). Verified manually in Task 7 verification.

- [ ] **Step 1: Update imports in `index.ts`**

Change the existing import block at the top of `window-manager/src/main/index.ts`. Add the three new imports:

```typescript
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb } from './db'
import { initLogWriter, markOrphanedTurns } from './logWriter'
import { registerIpcHandlers } from './ipcHandlers'
import { reconcileWindows } from './windowService'
import { startWaitingPoller } from './waitingPoller'
import { getGitHubPat } from './settingsService'
import { getIdentity } from './githubIdentity'
import { applyGitIdentity } from './gitOps'
import { terminateAllWorkers } from './claudeService'
import { terminateAllAssistedWorkers } from './assistedWindowService'
```

- [ ] **Step 2: Add startup cleanup call**

In the `app.whenReady().then(async () => {` block, add `markOrphanedTurns()` call immediately after `initLogWriter` (line 40) and before `startWaitingPoller()`:

```typescript
app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'windows.db')
  initDb(dbPath)
  initLogWriter(app.getPath('logs'))
  markOrphanedTurns()
  startWaitingPoller()
  // ... rest unchanged
```

- [ ] **Step 3: Add `before-quit` handler**

Add after the `app.on('window-all-closed', ...)` handler at the bottom of `index.ts`:

```typescript
app.on('before-quit', (e) => {
  e.preventDefault()
  terminateAllWorkers()
  terminateAllAssistedWorkers()
  markOrphanedTurns()
  app.exit(0)
})
```

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/main/index.ts
git commit -m "feat: mark running turns orphaned on startup and graceful shutdown"
```

---

## Task 5: Extend `assisted:history` IPC + preload type

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 1: Update `assisted:history` handler in `ipcHandlers.ts`**

First, update line 41 of `ipcHandlers.ts` — the existing logWriter import:

```typescript
// before
import { readEventsForTurn } from './logWriter'
// after
import { readEventsForTurn, getOrphanedTurns } from './logWriter'
```

Then replace the handler (lines 367–371):

```typescript
ipcMain.handle('assisted:history', (_, windowId: number) => {
  const messages = getDb()
    .prepare('SELECT * FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId)
  const orphanedTurns = getOrphanedTurns(windowId)
  return { messages, orphanedTurns }
})
```

- [ ] **Step 2: Update preload comment in `preload/index.ts`**

Find line 161 in `window-manager/src/preload/index.ts` and replace:

```typescript
assistedHistory: (windowId: number) => ipcRenderer.invoke('assisted:history', windowId),
```

with:

```typescript
// Returns { messages: AssistedMessage[], orphanedTurns: Array<{ id: string; started_at: number; turn_type: string }> }
assistedHistory: (windowId: number) => ipcRenderer.invoke('assisted:history', windowId),
```

- [ ] **Step 3: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts
git commit -m "feat: extend assisted:history IPC to include orphaned turns"
```

---

## Task 6: Orphaned bubble in `AssistedPanel.svelte`

**Files:**
- Modify: `window-manager/src/renderer/src/components/AssistedPanel.svelte`
- Modify: `window-manager/tests/renderer/AssistedPanel.test.ts`

- [ ] **Step 1: Write failing tests**

Read `window-manager/tests/renderer/AssistedPanel.test.ts` to find end of file. Add before the closing `})` of the outer `describe('AssistedPanel', ...)`:

```typescript
  describe('orphaned turn bubble', () => {
    it('renders interrupted bubble when history has orphaned turns', async () => {
      mockApi.assistedHistory.mockResolvedValue({
        messages: [
          { id: 1, role: 'user', content: 'do the thing', metadata: null }
        ],
        orphanedTurns: [
          { id: 'turn-abc', started_at: Date.now() + 1, turn_type: 'human-claude' }
        ]
      })

      render(AssistedPanel, defaultProps)
      await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

      expect(screen.getByText(/turn interrupted/i)).toBeDefined()
      expect(screen.getByRole('button', { name: /re-send/i })).toBeDefined()
    })

    it('does not render interrupted bubble when no orphaned turns', async () => {
      mockApi.assistedHistory.mockResolvedValue({
        messages: [],
        orphanedTurns: []
      })

      render(AssistedPanel, defaultProps)
      await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

      expect(screen.queryByText(/turn interrupted/i)).toBeNull()
    })

    it('re-send button sends last user message and removes bubble', async () => {
      mockApi.assistedHistory.mockResolvedValue({
        messages: [
          { id: 1, role: 'user', content: 'original message', metadata: null }
        ],
        orphanedTurns: [
          { id: 'turn-abc', started_at: Date.now() + 1, turn_type: 'human-claude' }
        ]
      })

      render(AssistedPanel, defaultProps)
      await waitFor(() => screen.getByRole('button', { name: /re-send/i }))

      await fireEvent.click(screen.getByRole('button', { name: /re-send/i }))

      expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'original message', 'bypassPermissions')
      await waitFor(() => expect(screen.queryByText(/turn interrupted/i)).toBeNull())
    })

    it('handles legacy history shape (plain array) without crashing', async () => {
      mockApi.assistedHistory.mockResolvedValue([])

      render(AssistedPanel, defaultProps)
      await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

      expect(screen.queryByText(/turn interrupted/i)).toBeNull()
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```

Expected: FAIL — orphaned bubble not rendered

- [ ] **Step 3: Add `orphanedEntries` state to script section**

In `AssistedPanel.svelte`, add after `let running = $state(false)` (line 25):

```typescript
  interface OrphanedEntry {
    id: number
    role: 'orphaned'
    content: string
    metadata: string | null
    lastUserMessage: string
    turnType: string
  }

  let orphanedEntries = $state<OrphanedEntry[]>([])
```

- [ ] **Step 4: Replace history loading block in `onMount`**

Replace the history loading `void (async () => { ... })()` block (lines 166–177) with:

```typescript
    void (async () => {
      const raw = await window.api.assistedHistory(windowId) as
        | { messages: Array<{ id: number; role: string; content: string; metadata: string | null; created_at?: string }>; orphanedTurns: Array<{ id: string; started_at: number; turn_type: string }> }
        | Array<{ id: number; role: string; content: string; metadata: string | null }>

      if (!mountActive) return

      const historyRows = Array.isArray(raw) ? raw : raw.messages
      const orphanedTurns = Array.isArray(raw) ? [] : raw.orphanedTurns

      const historyItems: DisplayMessage[] = []
      for (const m of historyRows) {
        const role = mapLegacyRole(m.role)
        if (!role) continue
        historyItems.push({ id: m.id, role, content: m.content, metadata: m.metadata, expanded: false })
      }
      const liveItems = messages.filter(m => !historyItems.some(h => h.id === m.id))
      messages = [...historyItems, ...liveItems]

      orphanedEntries = orphanedTurns.map(turn => {
        const lastUserMsg = [...historyRows]
          .filter(m => m.role === 'user')
          .pop()
        return {
          id: -(Math.floor(Math.random() * 1e9)),
          role: 'orphaned' as const,
          content: '',
          metadata: null,
          lastUserMessage: lastUserMsg?.content ?? '',
          turnType: turn.turn_type
        }
      })
    })()
```

- [ ] **Step 5: Add `resendOrphaned` handler**

Add after `handleCancel` function (after line 217):

```typescript
  function resendOrphaned(entry: OrphanedEntry): void {
    orphanedEntries = orphanedEntries.filter(e => e.id !== entry.id)
    if (!entry.lastUserMessage) return
    input = entry.lastUserMessage
    void send()
  }
```

- [ ] **Step 6: Add orphaned bubbles to template**

In the template, after the `{/each}` that closes the `{#each messages as msg}` block (line 306) and before `{#if lastStats}`, add:

```svelte
    {#each orphanedEntries as entry (entry.id)}
      <div class="msg orphaned-turn">
        <span class="orphaned-label">⚠ Turn interrupted (app closed mid-run)</span>
        {#if entry.lastUserMessage}
          <button
            type="button"
            class="resend-btn"
            aria-label="Re-send last message"
            onclick={() => resendOrphaned(entry)}
          >
            Re-send last message
          </button>
        {/if}
      </div>
    {/each}
```

- [ ] **Step 7: Add CSS for orphaned bubble**

Add to `<style>` block:

```css
  .orphaned-turn {
    align-self: stretch;
    max-width: 100%;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.4);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .orphaned-label {
    color: rgb(245, 158, 11);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  .resend-btn {
    background: transparent;
    border: 1px solid rgba(245, 158, 11, 0.6);
    border-radius: 4px;
    color: rgb(245, 158, 11);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    font-family: var(--font-ui);
  }

  .resend-btn:hover {
    background: rgba(245, 158, 11, 0.15);
  }
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```

Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add window-manager/src/renderer/src/components/AssistedPanel.svelte window-manager/tests/renderer/AssistedPanel.test.ts
git commit -m "feat: render orphaned turn bubble with re-send in AssistedPanel"
```

---

## Task 7: Full test suite verification

- [ ] **Step 1: Run all tests**

```bash
cd window-manager && npx vitest run
```

Expected: all tests pass, no regressions

- [ ] **Step 2: Commit (if any cleanup needed)**

```bash
git add -p
git commit -m "chore: safe-restart cleanup after full test run"
```

---
