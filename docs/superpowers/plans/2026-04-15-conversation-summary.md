# Conversation Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every Claude Code `Stop` event, a background sub-agent generates a conversation summary (title + bullets) that displays in the `WindowDetailPane` footer and pre-populates the commit modal.

**Architecture:** An async Claude Code hook writes `/tmp/claude-summary.json` inside the container. The existing `waitingPoller` reads and deletes the file each tick, dispatches it via IPC `terminal:summary`, and a Svelte store keyed by `containerId` feeds the footer and commit modal.

**Tech Stack:** Electron IPC, Svelte 5 runes, vitest, @testing-library/svelte, bash

---

## File Map

| File | Action |
|---|---|
| `files/claude-summarize.sh` | Create — hook script run by Claude Code async Stop hook |
| `files/claude-settings.json` | Modify — add async Stop hook entry |
| `files/Dockerfile` | Modify — COPY + chmod script |
| `window-manager/src/main/summaryDispatcher.ts` | Create — sends `terminal:summary` IPC to renderer |
| `window-manager/src/main/waitingPoller.ts` | Modify — extend `checkOne` to also poll summary file |
| `window-manager/src/preload/index.ts` | Modify — expose `onTerminalSummary` / `offTerminalSummary` |
| `window-manager/src/renderer/src/types.ts` | Modify — add two methods to `Api` interface |
| `window-manager/src/renderer/src/lib/conversationSummary.ts` | Create — Svelte store keyed by containerId |
| `window-manager/src/renderer/src/components/CommitModal.svelte` | Modify — add `initialSubject` / `initialBody` props |
| `window-manager/src/renderer/src/components/WindowDetailPane.svelte` | Modify — add `summary` prop + summary-row |
| `window-manager/src/renderer/src/components/TerminalHost.svelte` | Modify — IPC listener, store wiring, pass props |
| `window-manager/tests/main/summaryDispatcher.test.ts` | Create |
| `window-manager/tests/main/waitingPoller.test.ts` | Modify — add summary tests, fix call-count assertions |
| `window-manager/tests/renderer/conversationSummary.test.ts` | Create |
| `window-manager/tests/renderer/CommitModal.test.ts` | Modify — add initial-value tests |
| `window-manager/tests/renderer/WindowDetailPane.test.ts` | Modify — add summary-row tests |
| `window-manager/tests/renderer/TerminalHost.test.ts` | Modify — add summary IPC tests |

---

## Task 1: Container hook script, settings, Dockerfile

**Files:**
- Create: `files/claude-summarize.sh`
- Modify: `files/claude-settings.json`
- Modify: `files/Dockerfile`

No unit tests — shell scripts and config files are not unit-testable in this project.

- [ ] **Step 1: Create `files/claude-summarize.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

RESULT=$(claude --print \
  "Read this conversation transcript and output ONLY a JSON object with two fields: \"title\" (string, ≤60 chars, summarizes what was accomplished) and \"bullets\" (array of ≤5 strings, key points). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0

printf '%s' "$RESULT" > /tmp/claude-summary.json
```

- [ ] **Step 2: Update `files/claude-settings.json` — add async Stop hook**

The existing `Stop` array has one entry. Add a second entry:

```json
{
  "enabledPlugins": {
    "caveman@caveman": true,
    "superpowers@superpowers-marketplace": true
  },
  "extraKnownMarketplaces": {
    "caveman": {
      "source": { "source": "github", "repo": "JuliusBrussee/caveman" }
    },
    "superpowers-marketplace": {
      "source": { "source": "github", "repo": "obra/superpowers-marketplace" }
    }
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "touch /tmp/claude-waiting 2>/dev/null; exit 0" }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /usr/local/bin/claude-summarize.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Update `files/Dockerfile` — add COPY and chmod**

In the `USER root` block (around line 118–122), add the COPY before the existing `docker-entrypoint.sh` COPY and add the chmod to the existing `RUN chmod` line:

```dockerfile
USER root
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY claude-summarize.sh /usr/local/bin/claude-summarize.sh
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/docker-entrypoint.sh /usr/local/bin/claude-summarize.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node
```

- [ ] **Step 4: Commit**

```bash
git add files/claude-summarize.sh files/claude-settings.json files/Dockerfile
git commit -m "feat: add async Stop hook to generate conversation summary in container"
```

---

## Task 2: `summaryDispatcher.ts` + tests

**Files:**
- Create: `window-manager/src/main/summaryDispatcher.ts`
- Create: `window-manager/tests/main/summaryDispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/main/summaryDispatcher.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() }
}))

import { dispatchSummary } from '../../src/main/summaryDispatcher'

function fakeWin(opts: { destroyed?: boolean } = {}) {
  return {
    isDestroyed: vi.fn().mockReturnValue(opts.destroyed ?? false),
    webContents: { send: vi.fn() }
  }
}

const payload = { title: 'Fixed auth bug', bullets: ['updated middleware', 'added tests'] }

describe('dispatchSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllWindows.mockReturnValue([fakeWin()])
  })

  it('sends terminal:summary IPC with containerId, title, and bullets', () => {
    const win = fakeWin()
    mockGetAllWindows.mockReturnValue([win])
    dispatchSummary('cid-1', payload)
    expect(win.webContents.send).toHaveBeenCalledWith('terminal:summary', {
      containerId: 'cid-1',
      title: 'Fixed auth bug',
      bullets: ['updated middleware', 'added tests']
    })
  })

  it('no-ops when no windows exist', () => {
    mockGetAllWindows.mockReturnValue([])
    expect(() => dispatchSummary('cid-1', payload)).not.toThrow()
  })

  it('no-ops when the only window is destroyed', () => {
    const win = fakeWin({ destroyed: true })
    mockGetAllWindows.mockReturnValue([win])
    dispatchSummary('cid-1', payload)
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/summaryDispatcher.test.ts
```

Expected: FAIL — `summaryDispatcher` module not found.

- [ ] **Step 3: Create `window-manager/src/main/summaryDispatcher.ts`**

```typescript
import { BrowserWindow } from 'electron'

export function dispatchSummary(
  containerId: string,
  summary: { title: string; bullets: string[] }
): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send('terminal:summary', { containerId, ...summary })
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/summaryDispatcher.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/summaryDispatcher.ts window-manager/tests/main/summaryDispatcher.test.ts
git commit -m "feat: add summaryDispatcher to send terminal:summary IPC"
```

---

## Task 3: Extend `waitingPoller.ts` to poll summary file

**Files:**
- Modify: `window-manager/src/main/waitingPoller.ts`
- Modify: `window-manager/tests/main/waitingPoller.test.ts`

**Important:** `checkOne` currently calls `execInContainer` once per container. After this task it calls it twice (waiting check + summary check). Two existing tests assert `toHaveBeenCalledTimes` and must be updated.

- [ ] **Step 1: Add new tests and update broken assertions in `waitingPoller.test.ts`**

Replace the entire contents of `window-manager/tests/main/waitingPoller.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDbAll, mockExecInContainer, mockDispatchWaiting, mockDispatchSummary, mockGetContainer } = vi.hoisted(
  () => ({
    mockDbAll: vi.fn(),
    mockExecInContainer: vi.fn(),
    mockDispatchWaiting: vi.fn(),
    mockDispatchSummary: vi.fn(),
    mockGetContainer: vi.fn()
  })
)

vi.mock('../../src/main/db', () => ({
  getDb: () => ({ prepare: () => ({ all: () => mockDbAll() }) })
}))
vi.mock('../../src/main/gitOps', () => ({
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args)
}))
vi.mock('../../src/main/waitingDispatcher', () => ({
  dispatchWaiting: (id: string) => mockDispatchWaiting(id)
}))
vi.mock('../../src/main/summaryDispatcher', () => ({
  dispatchSummary: (...args: unknown[]) => mockDispatchSummary(...args)
}))
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: (id: string) => mockGetContainer(id) })
}))

function setContainers(ids: string[]): void {
  mockDbAll.mockReturnValue(ids.map((container_id) => ({ container_id })))
}

// Helper: set up exec to return waiting=Y on first call, empty summary on second
function waitingYesNoSummary(): void {
  mockExecInContainer
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: 'Y\r\n' })  // waiting check
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })         // summary check
}

// Helper: set up exec for both calls returning empty (no dispatch)
function bothEmpty(): void {
  mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
}

import { pollOnce, startWaitingPoller } from '../../src/main/waitingPoller'

describe('waitingPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetContainer.mockImplementation((id: string) => ({ id }))
  })

  describe('pollOnce', () => {
    it('dispatches waiting when exec returns Y on first call', async () => {
      setContainers(['cid-a'])
      waitingYesNoSummary()
      await pollOnce()
      expect(mockDispatchWaiting).toHaveBeenCalledWith('cid-a')
    })

    it('does not dispatch waiting on empty stdout', async () => {
      setContainers(['cid-empty'])
      bothEmpty()
      await pollOnce()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('does not dispatch waiting when exec fails', async () => {
      setContainers(['cid-fail'])
      mockExecInContainer.mockResolvedValue({ ok: false, code: 1, stdout: '' })
      await pollOnce()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('swallows exec rejections (container gone)', async () => {
      setContainers(['cid-missing'])
      mockExecInContainer.mockRejectedValue(new Error('no such container'))
      await expect(pollOnce()).resolves.toBeUndefined()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('polls every active container — 2 exec calls per container', async () => {
      setContainers(['c1', 'c2', 'c3'])
      bothEmpty()
      await pollOnce()
      // 2 exec calls per container (waiting + summary) × 3 containers = 6
      expect(mockExecInContainer).toHaveBeenCalledTimes(6)
    })

    it('uses the exact waiting probe command on first call', async () => {
      setContainers(['cid-cmd'])
      bothEmpty()
      await pollOnce()
      const cmd = mockExecInContainer.mock.calls[0][1] as string[]
      expect(cmd[0]).toBe('sh')
      expect(cmd[1]).toBe('-c')
      expect(cmd[2]).toBe('test -e /tmp/claude-waiting && rm -f /tmp/claude-waiting && echo Y')
    })

    it('uses the exact summary probe command on second call', async () => {
      setContainers(['cid-cmd'])
      bothEmpty()
      await pollOnce()
      const cmd = mockExecInContainer.mock.calls[1][1] as string[]
      expect(cmd[0]).toBe('sh')
      expect(cmd[1]).toBe('-c')
      expect(cmd[2]).toBe(
        'test -f /tmp/claude-summary.json && cat /tmp/claude-summary.json && rm -f /tmp/claude-summary.json'
      )
    })

    it('skips polling when no sessions are active', async () => {
      setContainers([])
      await pollOnce()
      expect(mockExecInContainer).not.toHaveBeenCalled()
    })

    it('dispatches summary when summary file contains valid JSON', async () => {
      setContainers(['cid-summary'])
      const json = JSON.stringify({ title: 'Built login', bullets: ['added form', 'tests pass'] })
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })           // waiting check
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: json })          // summary check
      await pollOnce()
      expect(mockDispatchSummary).toHaveBeenCalledWith('cid-summary', {
        title: 'Built login',
        bullets: ['added form', 'tests pass']
      })
    })

    it('does not dispatch summary when stdout is empty', async () => {
      setContainers(['cid-nosummary'])
      bothEmpty()
      await pollOnce()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
    })

    it('silently ignores malformed summary JSON', async () => {
      setContainers(['cid-bad'])
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: 'not-json' })
      await expect(pollOnce()).resolves.toBeUndefined()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
    })

    it('silently ignores summary JSON missing required fields', async () => {
      setContainers(['cid-incomplete'])
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: JSON.stringify({ title: 'hi' }) })
      await pollOnce()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
    })
  })

  describe('startWaitingPoller', () => {
    it('returns a stop function that clears the interval', () => {
      vi.useFakeTimers()
      try {
        const stop = startWaitingPoller()
        expect(typeof stop).toBe('function')
        stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it('fires pollOnce on each 3s tick (2 exec calls per container per tick)', async () => {
      vi.useFakeTimers()
      setContainers(['tick-cid'])
      bothEmpty()
      const stop = startWaitingPoller()
      try {
        await Promise.resolve()
        mockExecInContainer.mockClear()
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(2) // 2 per container × 1 container
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(4)
      } finally {
        stop()
        vi.useRealTimers()
      }
    })

    it('primes markers at boot (clears stale /tmp/claude-waiting)', async () => {
      vi.useFakeTimers()
      setContainers(['boot-cid'])
      bothEmpty()
      const stop = startWaitingPoller()
      try {
        await Promise.resolve()
        await Promise.resolve()
        expect(mockExecInContainer).toHaveBeenCalledTimes(1)
        const cmd = mockExecInContainer.mock.calls[0][1] as string[]
        expect(cmd).toEqual(['rm', '-f', '/tmp/claude-waiting'])
      } finally {
        stop()
        vi.useRealTimers()
      }
    })
  })
})
```

- [ ] **Step 2: Run existing tests to see which fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/waitingPoller.test.ts
```

Expected: several FAIL (module not found for summaryDispatcher, plus count assertions fail).

- [ ] **Step 3: Update `window-manager/src/main/waitingPoller.ts`**

Replace the entire file:

```typescript
import { getDocker } from './docker'
import { execInContainer } from './gitOps'
import { getDb } from './db'
import { dispatchWaiting } from './waitingDispatcher'
import { dispatchSummary } from './summaryDispatcher'

const POLL_INTERVAL_MS = 3000
const MARKER = '/tmp/claude-waiting'
const SUMMARY_FILE = '/tmp/claude-summary.json'

export function startWaitingPoller(): () => void {
  void primeMarkers()
  const interval = setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL_MS)
  return () => clearInterval(interval)
}

export async function pollOnce(
  check: (id: string) => Promise<void> = checkOne
): Promise<void> {
  const ids = getMonitoredContainerIds()
  await Promise.allSettled(ids.map(check))
}

function getMonitoredContainerIds(): string[] {
  try {
    const rows = getDb()
      .prepare('SELECT container_id FROM windows WHERE deleted_at IS NULL')
      .all() as { container_id: string }[]
    return rows.map((r) => r.container_id)
  } catch {
    return []
  }
}

async function primeMarkers(): Promise<void> {
  const ids = getMonitoredContainerIds()
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        await execInContainer(getDocker().getContainer(id), ['rm', '-f', MARKER])
      } catch {
        // Container gone / stopped; next tick is harmless.
      }
    })
  )
}

async function checkOne(containerId: string): Promise<void> {
  try {
    const container = getDocker().getContainer(containerId)

    // Check waiting marker
    const r = await execInContainer(container, [
      'sh',
      '-c',
      `test -e ${MARKER} && rm -f ${MARKER} && echo Y`
    ])
    if (r.ok && r.stdout.trim() === 'Y') dispatchWaiting(containerId)

    // Check summary file — read and delete atomically
    const s = await execInContainer(container, [
      'sh',
      '-c',
      `test -f ${SUMMARY_FILE} && cat ${SUMMARY_FILE} && rm -f ${SUMMARY_FILE}`
    ])
    if (s.ok && s.stdout.trim()) {
      try {
        const summary = JSON.parse(s.stdout.trim()) as { title: string; bullets: string[] }
        if (summary.title && Array.isArray(summary.bullets)) {
          dispatchSummary(containerId, summary)
        }
      } catch {
        // Malformed JSON — skip silently.
      }
    }
  } catch {
    // Container gone / docker unreachable; next tick will retry naturally.
  }
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/waitingPoller.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run full main suite to check for regressions**

```bash
cd window-manager && npm run test:main
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/waitingPoller.ts window-manager/tests/main/waitingPoller.test.ts
git commit -m "feat: extend waitingPoller to poll and dispatch conversation summary"
```

---

## Task 4: Preload bridge + Api type update

**Files:**
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`

No unit tests — thin IPC bridge, covered by integration.

- [ ] **Step 1: Update `window-manager/src/preload/index.ts` — add summary IPC listeners**

Add after `offTerminalWaiting`:

```typescript
  onTerminalSummary: (
    callback: (data: { containerId: string; title: string; bullets: string[] }) => void
  ) => ipcRenderer.on('terminal:summary', (_, data) => callback(data)),
  offTerminalSummary: () => ipcRenderer.removeAllListeners('terminal:summary'),
```

- [ ] **Step 2: Update `window-manager/src/renderer/src/types.ts` — add to `Api` interface**

Add after `offTerminalWaiting`:

```typescript
  onTerminalSummary: (
    callback: (data: { containerId: string; title: string; bullets: string[] }) => void
  ) => void
  offTerminalSummary: () => void
```

- [ ] **Step 3: Typecheck**

```bash
cd window-manager && npm run typecheck:node
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/preload/index.ts window-manager/src/renderer/src/types.ts
git commit -m "feat: expose onTerminalSummary / offTerminalSummary in preload bridge"
```

---

## Task 5: `conversationSummary.ts` store + tests

**Files:**
- Create: `window-manager/src/renderer/src/lib/conversationSummary.ts`
- Create: `window-manager/tests/renderer/conversationSummary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/renderer/conversationSummary.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { conversationSummary } from '../../src/renderer/src/lib/conversationSummary'
import type { ConversationSummary } from '../../src/renderer/src/lib/conversationSummary'

function makeSummary(title: string): ConversationSummary {
  return { title, bullets: [`bullet for ${title}`] }
}

describe('conversationSummary', () => {
  beforeEach(() => conversationSummary._resetForTest())

  it('starts empty', () => {
    expect(get(conversationSummary).size).toBe(0)
  })

  it('set stores a summary keyed by containerId', () => {
    conversationSummary.set('cid-1', makeSummary('Built login'))
    const m = get(conversationSummary)
    expect(m.get('cid-1')).toEqual({ title: 'Built login', bullets: ['bullet for Built login'] })
  })

  it('set overwrites an existing entry for the same containerId', () => {
    conversationSummary.set('cid-1', makeSummary('first'))
    conversationSummary.set('cid-1', makeSummary('second'))
    expect(get(conversationSummary).get('cid-1')?.title).toBe('second')
    expect(get(conversationSummary).size).toBe(1)
  })

  it('remove deletes the matching entry', () => {
    conversationSummary.set('cid-1', makeSummary('one'))
    conversationSummary.set('cid-2', makeSummary('two'))
    conversationSummary.remove('cid-1')
    const m = get(conversationSummary)
    expect(m.has('cid-1')).toBe(false)
    expect(m.has('cid-2')).toBe(true)
  })

  it('remove is a no-op when entry does not exist', () => {
    conversationSummary.set('cid-1', makeSummary('one'))
    conversationSummary.remove('nonexistent')
    expect(get(conversationSummary).size).toBe(1)
  })

  it('store notifies subscribers on set', () => {
    const received: Map<string, ConversationSummary>[] = []
    const unsubscribe = conversationSummary.subscribe((v) => received.push(v))
    conversationSummary.set('cid-1', makeSummary('title'))
    unsubscribe()
    expect(received.length).toBeGreaterThanOrEqual(2) // initial + after set
    expect(received[received.length - 1].size).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/conversationSummary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `window-manager/src/renderer/src/lib/conversationSummary.ts`**

```typescript
import { writable } from 'svelte/store'

export interface ConversationSummary {
  title: string
  bullets: string[]
}

function createConversationSummaryStore() {
  const { subscribe, update, set } = writable<Map<string, ConversationSummary>>(new Map())

  return {
    subscribe,
    set(containerId: string, summary: ConversationSummary): void {
      update((m) => {
        m.set(containerId, summary)
        return new Map(m)
      })
    },
    remove(containerId: string): void {
      update((m) => {
        m.delete(containerId)
        return new Map(m)
      })
    },
    _resetForTest(): void {
      set(new Map())
    }
  }
}

export const conversationSummary = createConversationSummaryStore()
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/conversationSummary.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/lib/conversationSummary.ts window-manager/tests/renderer/conversationSummary.test.ts
git commit -m "feat: add conversationSummary Svelte store keyed by containerId"
```

---

## Task 6: `CommitModal.svelte` — add `initialSubject` / `initialBody` props

**Files:**
- Modify: `window-manager/src/renderer/src/components/CommitModal.svelte`
- Modify: `window-manager/tests/renderer/CommitModal.test.ts`

- [ ] **Step 1: Add new tests to `CommitModal.test.ts`**

Append these two tests inside the `describe('CommitModal')` block (before the closing `}`):

```typescript
  it('pre-populates subject from initialSubject prop', () => {
    render(CommitModal, {
      props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false, initialSubject: 'Add feature X' }
    })
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement
    expect(subject.value).toBe('Add feature X')
  })

  it('pre-populates body from initialBody prop', () => {
    render(CommitModal, {
      props: {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        busy: false,
        initialSubject: 'x',
        initialBody: '- point one\n- point two'
      }
    })
    const body = screen.getByLabelText(/body/i) as HTMLTextAreaElement
    expect(body.value).toBe('- point one\n- point two')
  })
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/CommitModal.test.ts
```

Expected: 2 FAIL (new tests), 6 PASS (existing).

- [ ] **Step 3: Update `CommitModal.svelte` script block**

Replace the `<script>` block:

```svelte
<script lang="ts">
  interface Props {
    onSubmit: (v: { subject: string; body: string }) => void
    onCancel: () => void
    busy: boolean
    initialSubject?: string
    initialBody?: string
  }
  let { onSubmit, onCancel, busy, initialSubject = '', initialBody = '' }: Props = $props()

  let subject = $state(initialSubject)
  let body = $state(initialBody)
  let canSubmit = $derived(subject.trim().length > 0 && !busy)

  function handleSubmit(e: Event): void {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ subject: subject.trim(), body: body.trim() })
  }
</script>
```

- [ ] **Step 4: Run all CommitModal tests**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/CommitModal.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/CommitModal.svelte window-manager/tests/renderer/CommitModal.test.ts
git commit -m "feat: add initialSubject and initialBody props to CommitModal"
```

---

## Task 7: `WindowDetailPane.svelte` — add summary row

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Add new tests to `WindowDetailPane.test.ts`**

Import `ConversationSummary` at the top of the test file (after the existing imports):

```typescript
import type { ConversationSummary } from '../../src/renderer/src/lib/conversationSummary'
```

Then append these tests inside the `describe('WindowDetailPane')` block:

```typescript
  it('does not render summary row when summary prop is undefined', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(document.querySelector('.summary-row')).toBeNull()
  })

  it('renders summary title when summary prop is provided', () => {
    getCurrentBranch.mockResolvedValue('main')
    const summary: ConversationSummary = { title: 'Fixed auth bug', bullets: ['updated middleware'] }
    render(WindowDetailPane, { props: { win, project, summary } })
    expect(screen.getByText('Fixed auth bug')).toBeInTheDocument()
  })

  it('renders all summary bullets when summary prop is provided', () => {
    getCurrentBranch.mockResolvedValue('main')
    const summary: ConversationSummary = {
      title: 'Built feature',
      bullets: ['added endpoint', 'wrote tests', 'updated docs']
    }
    render(WindowDetailPane, { props: { win, project, summary } })
    expect(screen.getByText('added endpoint')).toBeInTheDocument()
    expect(screen.getByText('wrote tests')).toBeInTheDocument()
    expect(screen.getByText('updated docs')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: 3 FAIL (new tests), all existing PASS.

- [ ] **Step 3: Update `WindowDetailPane.svelte`**

In the `<script>` block, add the import and prop. After the existing imports, add:

```typescript
  import type { ConversationSummary } from '../lib/conversationSummary'
```

In the `Props` interface, add:

```typescript
    summary?: ConversationSummary
```

In the destructured props, add:

```typescript
    summary = undefined
```

After the closing `</footer>` tag... wait — `<footer>` is the root element. Add the summary-row inside the footer, after the `info-row` div:

```svelte
  {#if summary}
    <div class="summary-row">
      <span class="summary-title">{summary.title}</span>
      <ul class="summary-bullets">
        {#each summary.bullets as b}<li>{b}</li>{/each}
      </ul>
    </div>
  {/if}
```

In the `<style>` block, add at the end:

```css
  .summary-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
  }
  .summary-title {
    color: var(--fg-1);
    font-weight: 500;
  }
  .summary-bullets {
    margin: 0;
    padding-left: 1rem;
    color: var(--fg-2);
    list-style: disc;
  }
  .summary-bullets li {
    line-height: 1.4;
  }
```

- [ ] **Step 4: Run all WindowDetailPane tests**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat: add summary-row to WindowDetailPane footer"
```

---

## Task 8: `TerminalHost.svelte` — wire IPC, store, and props

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts`

- [ ] **Step 1: Add new tests and mock to `TerminalHost.test.ts`**

After the existing `mockWaitingRemove` / `mockWaitingAdd` mocks and their `vi.mock`, add:

```typescript
const mockSummarySet = vi.fn()
const mockSummaryRemove = vi.fn()
vi.mock('../../src/renderer/src/lib/conversationSummary', () => ({
  conversationSummary: {
    subscribe: vi.fn().mockReturnValue(() => {}),
    set: (...args: unknown[]) => mockSummarySet(...args),
    remove: (...args: unknown[]) => mockSummaryRemove(...args)
  }
}))
```

Add `onTerminalSummary` and `offTerminalSummary` to `mockApi` type and initialization in `beforeEach`:

```typescript
    onTerminalSummary: vi.fn(),
    offTerminalSummary: vi.fn(),
```

Append these tests inside the `describe('TerminalHost')` block:

```typescript
  it('registers onTerminalSummary listener on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
  })

  it('calls conversationSummary.set when terminal:summary fires for this container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
    const cb = mockApi.onTerminalSummary.mock.calls[0][0] as (d: {
      containerId: string
      title: string
      bullets: string[]
    }) => void
    cb({ containerId: 'container123abc', title: 'Built X', bullets: ['a', 'b'] })
    expect(mockSummarySet).toHaveBeenCalledWith('container123abc', {
      title: 'Built X',
      bullets: ['a', 'b']
    })
  })

  it('ignores terminal:summary for a different container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
    const cb = mockApi.onTerminalSummary.mock.calls[0][0] as (d: {
      containerId: string
      title: string
      bullets: string[]
    }) => void
    cb({ containerId: 'other-container', title: 'x', bullets: [] })
    expect(mockSummarySet).not.toHaveBeenCalled()
  })

  it('calls offTerminalSummary and removes summary from store on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalSummary).toHaveBeenCalled()
    expect(mockSummaryRemove).toHaveBeenCalledWith('container123abc')
  })
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/TerminalHost.test.ts
```

Expected: 4 FAIL (new tests), existing PASS.

- [ ] **Step 3: Update `TerminalHost.svelte`**

In the `<script>` block, add the import after the existing `waitingWindows` import:

```typescript
  import { conversationSummary } from '../lib/conversationSummary'
```

In `onMount`, after the `window.api.onTerminalData(...)` call, add:

```typescript
    window.api.onTerminalSummary(({ containerId, title, bullets }) => {
      if (containerId === win.container_id) {
        conversationSummary.set(containerId, { title, bullets })
      }
    })
```

In `onDestroy`, after `waitingWindows.remove(win.container_id)` and before `term?.dispose()`, add:

```typescript
    window.api.offTerminalSummary()
    conversationSummary.remove(win.container_id)
```

Update the `<WindowDetailPane>` usage to pass `summary`:

```svelte
  <WindowDetailPane
    {win}
    {project}
    {viewMode}
    summary={$conversationSummary.get(win.container_id)}
    onViewChange={(mode) => (viewMode = mode)}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    onDelete={runDelete}
    commitDisabled={commitBusy || pushBusy || deleteBusy}
    pushDisabled={commitBusy || pushBusy || deleteBusy}
    deleteDisabled={deleteBusy}
  />
```

Update the `<CommitModal>` usage to pass initial values:

```svelte
  {#if commitOpen}
    <CommitModal
      initialSubject={$conversationSummary.get(win.container_id)?.title ?? ''}
      initialBody={$conversationSummary.get(win.container_id)?.bullets.join('\n') ?? ''}
      onSubmit={runCommit}
      onCancel={() => (commitOpen = false)}
      busy={commitBusy}
    />
  {/if}
```

- [ ] **Step 4: Run all TerminalHost tests**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/TerminalHost.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run full renderer suite to check for regressions**

```bash
cd window-manager && npm run test:renderer
```

Expected: all PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd window-manager && npm run test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte window-manager/tests/renderer/TerminalHost.test.ts
git commit -m "feat: wire conversation summary IPC into TerminalHost, WindowDetailPane, and CommitModal"
```
