# Claude Waiting Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert the user (OS notification + in-app toast + sidebar badge) when Claude Code inside a container terminal stops and waits for input.

**Architecture:** A Claude Code `Stop` hook inside the container writes an invisible OSC escape sequence (`\x1b]9999;claude-waiting\x07`) to `/dev/tty`. tmux forwards it to node-pty via `allow-passthrough`. `terminalService.ts` strips the sequence before it reaches xterm, fires an Electron `Notification` and a `terminal:waiting` IPC event. The renderer updates a shared Svelte store, shows a toast, and the sidebar displays waiting windows.

**Tech Stack:** Electron (main process), node-pty, Svelte 5 (renderer), Vitest, @testing-library/svelte, SweetAlert2 (toasts)

---

### Task 1: Container config — tmux passthrough + Claude hook

**Files:**
- Modify: `files/tmux.conf`
- Modify: `files/claude-settings.json`

No unit tests for config files — changes are verified end-to-end when the full feature is running.

- [ ] **Step 1: Enable tmux allow-passthrough**

Edit `files/tmux.conf` — add this line at the end:

```
set -g allow-passthrough on
```

Full file after edit:
```
set -g status off
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
set -g mouse on
set -g allow-passthrough on
```

Without this, tmux silently drops unknown OSC sequences and the signal never reaches node-pty.

- [ ] **Step 2: Add Claude Code Stop hook**

Edit `files/claude-settings.json` — add a `hooks` key at the top level:

```json
{
  "enabledPlugins": {
    "caveman@caveman": true,
    "superpowers@superpowers-marketplace": true
  },
  "extraKnownMarketplaces": {
    "caveman": {
      "source": {
        "source": "github",
        "repo": "JuliusBrussee/caveman"
      }
    },
    "superpowers-marketplace": {
      "source": {
        "source": "github",
        "repo": "obra/superpowers-marketplace"
      }
    }
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "printf '\\033]9999;claude-waiting\\007' >/dev/tty"
          }
        ]
      }
    ]
  }
}
```

`/dev/tty` in the hook subprocess refers to the tmux pane's controlling terminal (inherited from Claude Code's process group). The sequence enters the pane's PTY output stream and tmux forwards it to the docker exec PTY via `allow-passthrough`.

- [ ] **Step 3: Commit**

```bash
git add files/tmux.conf files/claude-settings.json
git commit -m "feat: enable tmux allow-passthrough and add Claude Stop hook for waiting signal"
```

---

### Task 2: waitingWindows Svelte store

**Files:**
- Create: `window-manager/src/renderer/src/lib/waitingWindows.ts`
- Create: `window-manager/tests/renderer/waitingWindows.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/waitingWindows.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'
import type { WaitingEntry } from '../../src/renderer/src/lib/waitingWindows'

function makeEntry(containerId: string, windowId: number = 1): WaitingEntry {
  return {
    containerId,
    windowId,
    windowName: `window-${windowId}`,
    projectId: 10,
    projectName: 'test-project'
  }
}

describe('waitingWindows', () => {
  beforeEach(() => waitingWindows._resetForTest())

  it('starts empty', () => {
    expect(get(waitingWindows)).toEqual([])
  })

  it('add inserts an entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].containerId).toBe('c1')
    expect(list[0].windowName).toBe('window-1')
  })

  it('add deduplicates by containerId, keeping the latest entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.add({ ...makeEntry('c1', 1), windowName: 'updated-name' })
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].windowName).toBe('updated-name')
  })

  it('remove clears the matching entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.add(makeEntry('c2', 2))
    waitingWindows.remove('c1')
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].containerId).toBe('c2')
  })

  it('remove is a no-op when entry does not exist', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.remove('nonexistent')
    expect(get(waitingWindows)).toHaveLength(1)
  })

  it('store notifies subscribers on add', () => {
    const received: WaitingEntry[][] = []
    const unsubscribe = waitingWindows.subscribe((v) => received.push(v))
    waitingWindows.add(makeEntry('c1', 1))
    unsubscribe()
    expect(received.length).toBeGreaterThanOrEqual(2) // initial + after add
    expect(received[received.length - 1]).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose waitingWindows
```

Expected: FAIL — module `waitingWindows` not found.

- [ ] **Step 3: Create the store**

Create `window-manager/src/renderer/src/lib/waitingWindows.ts`:

```typescript
import { writable } from 'svelte/store'

export interface WaitingEntry {
  containerId: string
  windowId: number
  windowName: string
  projectId: number
  projectName: string
}

function createWaitingWindowsStore() {
  const { subscribe, update, set } = writable<WaitingEntry[]>([])

  return {
    subscribe,
    add(entry: WaitingEntry): void {
      update((list) => {
        const filtered = list.filter((e) => e.containerId !== entry.containerId)
        return [...filtered, entry]
      })
    },
    remove(containerId: string): void {
      update((list) => list.filter((e) => e.containerId !== containerId))
    },
    _resetForTest(): void {
      set([])
    }
  }
}

export const waitingWindows = createWaitingWindowsStore()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose waitingWindows
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/lib/waitingWindows.ts window-manager/tests/renderer/waitingWindows.test.ts
git commit -m "feat: add waitingWindows Svelte store"
```

---

### Task 3: Add 'info' level to toasts

**Files:**
- Modify: `window-manager/src/renderer/src/lib/toasts.ts`
- Modify: `window-manager/tests/renderer/toasts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `window-manager/tests/renderer/toasts.test.ts` (append inside the `describe` block):

```typescript
  it('fires an info toast with the given title', () => {
    pushToast({ level: 'info', title: 'Claude is waiting' })
    expect(fire).toHaveBeenCalledWith(
      expect.objectContaining({ icon: 'info', title: 'Claude is waiting' })
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose toasts
```

Expected: FAIL — TypeScript error: `'info'` not assignable to `ToastLevel`.

- [ ] **Step 3: Add 'info' to ToastLevel**

Edit `window-manager/src/renderer/src/lib/toasts.ts` — change line 3:

```typescript
export type ToastLevel = 'success' | 'error' | 'info'
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose toasts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/lib/toasts.ts window-manager/tests/renderer/toasts.test.ts
git commit -m "feat: add 'info' level to ToastLevel"
```

---

### Task 4: terminalService — OSC intercept, debounce, notifications

**Files:**
- Modify: `window-manager/src/main/terminalService.ts`
- Modify: `window-manager/tests/main/terminalService.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `window-manager/tests/main/terminalService.test.ts` with the updated version below. Key additions: mock `electron.Notification`, update `openAndSettle` signature, add OSC test suite.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockSpawn, mockWrite, mockResize, mockKill, mockOnData, mockOnExit } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn(),
    mockWrite: vi.fn(),
    mockResize: vi.fn(),
    mockKill: vi.fn(),
    mockOnData: vi.fn(),
    mockOnExit: vi.fn()
  }
})

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args)
}))

const { mockGetClaudeToken } = vi.hoisted(() => ({ mockGetClaudeToken: vi.fn() }))
vi.mock('../../src/main/settingsService', () => ({
  getClaudeToken: () => mockGetClaudeToken()
}))

const { MockNotification, mockNotificationShow } = vi.hoisted(() => {
  const mockNotificationShow = vi.fn()
  const MockNotification = vi.fn().mockImplementation(() => ({ show: mockNotificationShow }))
  return { MockNotification, mockNotificationShow }
})

vi.mock('electron', () => ({
  Notification: MockNotification
}))

import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
  closeTerminalSessionFor
} from '../../src/main/terminalService'

type DataHandler = (data: string) => void
type ExitHandler = () => void

function makeFakePty() {
  let dataHandler: DataHandler | null = null
  let exitHandler: ExitHandler | null = null
  const pty = {
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    onData: (cb: DataHandler) => {
      dataHandler = cb
      mockOnData(cb)
    },
    onExit: (cb: ExitHandler) => {
      exitHandler = cb
      mockOnExit(cb)
    },
    emitData: (s: string) => dataHandler?.(s),
    emitExit: () => exitHandler?.()
  }
  return pty
}

function makeFakeWin(isDestroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(isDestroyed),
    webContents: { send: vi.fn() }
  } as unknown as {
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn> }
  }
}

const WAITING_SIGNAL = '\x1b]9999;claude-waiting\x07'

describe('terminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetClaudeToken.mockReturnValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openAndSettle(
    containerId: string,
    win: ReturnType<typeof makeFakeWin>,
    cols: number,
    rows: number,
    displayName: string = ''
  ): Promise<void> {
    await openTerminal(containerId, win as any, cols, rows, displayName)
    await vi.advanceTimersByTimeAsync(400)
  }

  describe('openTerminal', () => {
    it('spawns docker exec -it under a node-pty with the given cols/rows', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 120, 40)

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [program, args, opts] = mockSpawn.mock.calls[0] as [
        string,
        string[],
        { cols: number; rows: number; name: string }
      ]
      expect(program).toBe('docker')
      expect(args).toContain('exec')
      expect(args).toContain('-i')
      expect(args).toContain('-t')
      expect(args).toContain('TERM=xterm-256color')
      expect(args).toContain('LANG=C.UTF-8')
      expect(args).toContain('LC_ALL=C.UTF-8')
      expect(args).toContain('container-1')
      expect(args).toContain('sh')
      expect(args).toContain('-c')
      expect(args.join(' ')).toMatch(/tmux -u new-session -A -s cw/)
      expect(opts.cols).toBe(120)
      expect(opts.rows).toBe(40)
      expect(opts.name).toBe('xterm-256color')
    })

    it('clamps non-positive cols/rows to 1', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-clamp', win as any, 0, -5)

      const opts = mockSpawn.mock.calls[0][2] as { cols: number; rows: number }
      expect(opts.cols).toBe(1)
      expect(opts.rows).toBe(1)
    })

    it('forwards pty data immediately (no boot-settle swallow)', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-boot', win as any, 80, 24)
      ptyInstance.emitData('hello')
      expect(win.webContents.send).toHaveBeenCalledWith(
        'terminal:data',
        'container-boot',
        'hello'
      )
    })

    it('forwards pty data after the settle window opens passthrough', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-2', win, 80, 24)
      ptyInstance.emitData('hello')

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-2', 'hello')
    })

    it('kicks tmux with a size-bump SIGWINCH when the settle elapses', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-kick', win, 80, 24)

      expect(mockResize).toHaveBeenCalledWith(80, 23)
      expect(mockResize).toHaveBeenCalledWith(80, 24)
    })

    it('does not forward data when the window is destroyed', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin(true)

      await openAndSettle('container-destroyed', win, 80, 24)
      ptyInstance.emitData('ignored')

      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('emits [detached] on pty exit and clears the session', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-exit', win, 80, 24)
      ptyInstance.emitExit()

      expect(win.webContents.send).toHaveBeenCalledWith(
        'terminal:data',
        'container-exit',
        '\r\n[detached]\r\n'
      )

      writeInput('container-exit', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('is idempotent: a second open kills the previous pty first', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()

      await openAndSettle('container-idem', win, 80, 24)
      await openAndSettle('container-idem', win, 80, 24)

      expect(mockKill).toHaveBeenCalledTimes(1)
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })
  })

  describe('OSC waiting signal', () => {
    it('strips the waiting signal from data before forwarding to renderer', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-strip', win, 80, 24)
      win.webContents.send.mockClear()

      ptyInstance.emitData(`before${WAITING_SIGNAL}after`)

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-strip', 'beforeafter')
    })

    it('does not send terminal:data when the signal is the entire chunk', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-only-signal', win, 80, 24)
      win.webContents.send.mockClear()

      ptyInstance.emitData(WAITING_SIGNAL)

      const dataCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'terminal:data'
      )
      expect(dataCalls).toHaveLength(0)
    })

    it('sends terminal:waiting IPC event when signal detected', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-ipc', win, 80, 24)
      win.webContents.send.mockClear()

      ptyInstance.emitData(WAITING_SIGNAL)

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:waiting', 'container-ipc')
    })

    it('fires OS Notification with displayName as body', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-notif', win, 80, 24, 'my-window')

      ptyInstance.emitData(WAITING_SIGNAL)

      expect(MockNotification).toHaveBeenCalledWith({ title: 'Claude is waiting', body: 'my-window' })
      expect(mockNotificationShow).toHaveBeenCalled()
    })

    it('debounce: second signal within 2s does not fire a second notification', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-deb', win, 80, 24)

      ptyInstance.emitData(WAITING_SIGNAL)
      ptyInstance.emitData(WAITING_SIGNAL)

      expect(mockNotificationShow).toHaveBeenCalledTimes(1)
    })

    it('debounce resets after 2s, allowing a new notification', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()
      await openAndSettle('container-deb2', win, 80, 24)

      ptyInstance.emitData(WAITING_SIGNAL)
      await vi.advanceTimersByTimeAsync(2001)
      ptyInstance.emitData(WAITING_SIGNAL)

      expect(mockNotificationShow).toHaveBeenCalledTimes(2)
    })

    it('does not fire notification when window is destroyed', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin(true)
      await openAndSettle('container-destroyed-notif', win, 80, 24)

      ptyInstance.emitData(WAITING_SIGNAL)

      expect(mockNotificationShow).not.toHaveBeenCalled()
    })
  })

  describe('writeInput', () => {
    it('writes to the right session pty', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-w', makeFakeWin(), 80, 24)
      writeInput('container-w', 'ls\n')
      expect(mockWrite).toHaveBeenCalledWith('ls\n')
    })

    it('is a no-op when no session exists', () => {
      expect(() => writeInput('missing', 'x')).not.toThrow()
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  describe('resizeTerminal', () => {
    it('debounces rapid resizes into a single pty.resize with the last size', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-r', makeFakeWin(), 80, 24)
      mockResize.mockClear()

      resizeTerminal('container-r', 100, 30)
      resizeTerminal('container-r', 110, 35)
      resizeTerminal('container-r', 132, 43)

      expect(mockResize).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)

      expect(mockResize).toHaveBeenCalledTimes(1)
      expect(mockResize).toHaveBeenCalledWith(132, 43)
    })

    it('clamps non-positive resize args to 1', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-clamp2', makeFakeWin(), 80, 24)
      mockResize.mockClear()

      resizeTerminal('container-clamp2', 0, -5)
      await vi.advanceTimersByTimeAsync(200)

      expect(mockResize).toHaveBeenCalledWith(1, 1)
    })

    it('is a no-op when no session exists', async () => {
      resizeTerminal('missing', 80, 24)
      await vi.advanceTimersByTimeAsync(200)
      expect(mockResize).not.toHaveBeenCalled()
    })
  })

  describe('closeTerminal', () => {
    it('kills the pty and clears the session', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-c', makeFakeWin(), 80, 24)
      closeTerminal('container-c')

      expect(mockKill).toHaveBeenCalled()
      writeInput('container-c', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('is a no-op when no session exists', () => {
      expect(() => closeTerminal('ghost')).not.toThrow()
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('does not throw when pty.kill rejects', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-throwy', makeFakeWin(), 80, 24)
      mockKill.mockImplementationOnce(() => {
        throw new Error('already dead')
      })
      expect(() => closeTerminal('container-throwy')).not.toThrow()
    })
  })

  describe('closeTerminalSessionFor', () => {
    it('behaves identically to closeTerminal', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-csf', makeFakeWin(), 80, 24)
      closeTerminalSessionFor('container-csf')
      expect(mockKill).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:main -- --reporter=verbose terminalService
```

Expected: new OSC tests FAIL — `Notification` not imported, `displayName` param missing.

- [ ] **Step 3: Update terminalService.ts**

Replace `window-manager/src/main/terminalService.ts` with:

```typescript
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { Notification, type BrowserWindow } from 'electron'
import { getClaudeToken } from './settingsService'

interface TerminalSession {
  pty: IPty
  resizeTimer: ReturnType<typeof setTimeout> | null
  pendingResize: { cols: number; rows: number } | null
  displayName: string
  waitingDebounceTimer: ReturnType<typeof setTimeout> | null
}

// Collapse bursts of resize events into a single pty.resize call. During
// initial layout / window drags ResizeObserver can fire many times; without
// debounce each fire triggers SIGWINCH in the remote shell.
const RESIZE_DEBOUNCE_MS = 80

// After the client attaches to tmux we bump the PTY size by one row and back
// so tmux receives SIGWINCH and repaints the pane state fresh — preserving
// the persistent-session prompt the user expects to see on re-open.
const REFRESH_KICK_MS = 120

// OSC sequence emitted by the Claude Code Stop hook inside the container.
// Stripped before forwarding to xterm; invisible to the user.
const WAITING_SIGNAL = '\x1b]9999;claude-waiting\x07'
const WAITING_DEBOUNCE_MS = 2000

const sessions = new Map<string, TerminalSession>()

export function openTerminal(
  containerId: string,
  win: BrowserWindow,
  cols: number,
  rows: number,
  displayName: string = ''
): Promise<void> {
  // Idempotent: tear down any existing session for this container first.
  if (sessions.has(containerId)) {
    closeTerminal(containerId)
  }

  const safeCols = Math.max(1, Math.floor(cols))
  const safeRows = Math.max(1, Math.floor(rows))

  const args = [
    'exec',
    '-i',
    '-t',
    '-e',
    'TERM=xterm-256color',
    '-e',
    'LANG=C.UTF-8',
    '-e',
    'LC_ALL=C.UTF-8'
  ]
  const claudeToken = getClaudeToken()
  if (claudeToken) {
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`)
  }
  args.push(containerId, 'sh', '-c', 'exec tmux -u new-session -A -s cw')

  const child = pty.spawn('docker', args, {
    name: 'xterm-256color',
    cols: safeCols,
    rows: safeRows,
    cwd: process.env.HOME,
    env: process.env as { [key: string]: string }
  })

  const session: TerminalSession = {
    pty: child,
    resizeTimer: null,
    pendingResize: null,
    displayName,
    waitingDebounceTimer: null
  }
  sessions.set(containerId, session)

  child.onData((data: string) => {
    if (win.isDestroyed()) return

    if (data.includes(WAITING_SIGNAL)) {
      const stripped = data.replaceAll(WAITING_SIGNAL, '')
      if (stripped) {
        win.webContents.send('terminal:data', containerId, stripped)
      }
      if (!session.waitingDebounceTimer) {
        win.webContents.send('terminal:waiting', containerId)
        new Notification({ title: 'Claude is waiting', body: session.displayName }).show()
        session.waitingDebounceTimer = setTimeout(() => {
          session.waitingDebounceTimer = null
        }, WAITING_DEBOUNCE_MS)
      }
    } else {
      win.webContents.send('terminal:data', containerId, data)
    }
  })

  child.onExit(() => {
    sessions.delete(containerId)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, '\r\n[detached]\r\n')
    }
  })

  setTimeout(() => {
    if (!sessions.has(containerId)) return
    try {
      child.resize(safeCols, Math.max(1, safeRows - 1))
      child.resize(safeCols, safeRows)
    } catch {
      // Session may have exited; ignore.
    }
  }, REFRESH_KICK_MS)

  return Promise.resolve()
}

export function writeInput(containerId: string, data: string): void {
  sessions.get(containerId)?.pty.write(data)
}

export function resizeTerminal(containerId: string, cols: number, rows: number): void {
  const session = sessions.get(containerId)
  if (!session) return
  session.pendingResize = {
    cols: Math.max(1, Math.floor(cols)),
    rows: Math.max(1, Math.floor(rows))
  }
  if (session.resizeTimer) return
  session.resizeTimer = setTimeout(() => {
    session.resizeTimer = null
    const pending = session.pendingResize
    session.pendingResize = null
    if (!pending) return
    try {
      session.pty.resize(pending.cols, pending.rows)
    } catch {
      // Session may have exited between schedule and fire; ignore.
    }
  }, RESIZE_DEBOUNCE_MS)
}

export function closeTerminal(containerId: string): void {
  const session = sessions.get(containerId)
  if (!session) return
  if (session.resizeTimer) clearTimeout(session.resizeTimer)
  if (session.waitingDebounceTimer) clearTimeout(session.waitingDebounceTimer)
  try {
    session.pty.kill()
  } catch {
    // Already dead; ignore.
  }
  sessions.delete(containerId)
}

export function closeTerminalSessionFor(containerId: string): void {
  closeTerminal(containerId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose terminalService
```

Expected: all tests PASS (including the 7 new OSC tests).

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/terminalService.ts window-manager/tests/main/terminalService.test.ts
git commit -m "feat: intercept OSC waiting signal in terminalService, debounce, fire IPC and OS Notification"
```

---

### Task 5: Wire displayName through IPC + expose onTerminalWaiting in preload

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Write the failing test for ipcHandlers**

In `window-manager/tests/main/ipcHandlers.test.ts`, find the section that tests `terminal:open` and update it. First locate the existing test (search for `terminal:open` or `openTerminal`). Then add/update the test to verify `displayName` is forwarded:

Find the block in `ipcHandlers.test.ts` that handles `terminal:open` registration. Look for `ipcMain.handle.mock.calls` filtering for `'terminal:open'`. Add a test after the existing terminal tests:

```typescript
  it('terminal:open passes displayName as 5th arg to openTerminal', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipcHandlers')
    const { ipcMain, BrowserWindow } = await import('electron')
    const { openTerminal } = await import('../../src/main/terminalService')

    const mockWin = { webContents: {} }
    ;(BrowserWindow.fromWebContents as ReturnType<typeof vi.fn>).mockReturnValue(mockWin)

    registerIpcHandlers()

    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
    const [, handler] = calls.find(([ch]) => ch === 'terminal:open')!
    const fakeEvent = { sender: {} }
    await handler(fakeEvent, 'ctr-1', 80, 24, 'my-display-name')

    expect(openTerminal).toHaveBeenCalledWith('ctr-1', mockWin, 80, 24, 'my-display-name')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd window-manager && npm run test:main -- --reporter=verbose ipcHandlers
```

Expected: FAIL — `openTerminal` called without `displayName`.

- [ ] **Step 3: Update ipcHandlers.ts**

In `window-manager/src/main/ipcHandlers.ts`, update the `terminal:open` handler:

```typescript
  ipcMain.handle('terminal:open', (event, containerId: string, cols: number, rows: number, displayName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    return openTerminal(containerId, win, cols, rows, displayName)
  })
```

- [ ] **Step 4: Update preload/index.ts**

Replace `window-manager/src/preload/index.ts` with:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Project API
  createProject: (name: string, gitUrl: string) =>
    ipcRenderer.invoke('project:create', name, gitUrl),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: number) => ipcRenderer.invoke('project:delete', id),

  // Window API
  createWindow: (name: string, projectId: number) =>
    ipcRenderer.invoke('window:create', name, projectId),
  listWindows: (projectId?: number) => ipcRenderer.invoke('window:list', projectId),
  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),
  onWindowCreateProgress: (callback: (step: string) => void) =>
    ipcRenderer.on('window:create-progress', (_, step: string) => callback(step)),
  offWindowCreateProgress: () => ipcRenderer.removeAllListeners('window:create-progress'),

  // Git API
  getCurrentBranch: (windowId: number) => ipcRenderer.invoke('git:current-branch', windowId),
  commit: (windowId: number, payload: { subject: string; body?: string }) =>
    ipcRenderer.invoke('git:commit', windowId, payload),
  push: (windowId: number) => ipcRenderer.invoke('git:push', windowId),

  // Settings API
  getGitHubPatStatus: () => ipcRenderer.invoke('settings:get-github-pat-status'),
  setGitHubPat: (pat: string) => ipcRenderer.invoke('settings:set-github-pat', pat),
  clearGitHubPat: () => ipcRenderer.invoke('settings:clear-github-pat'),
  getClaudeTokenStatus: () => ipcRenderer.invoke('settings:get-claude-token-status'),
  setClaudeToken: (token: string) => ipcRenderer.invoke('settings:set-claude-token', token),
  clearClaudeToken: () => ipcRenderer.invoke('settings:clear-claude-token'),

  // Terminal API
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string) =>
    ipcRenderer.invoke('terminal:open', containerId, cols, rows, displayName),
  sendTerminalInput: (containerId: string, data: string) =>
    ipcRenderer.send('terminal:input', containerId, data),
  resizeTerminal: (containerId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows),
  closeTerminal: (containerId: string) => ipcRenderer.send('terminal:close', containerId),
  onTerminalData: (callback: (containerId: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, data) => callback(containerId, data)),
  offTerminalData: () => ipcRenderer.removeAllListeners('terminal:data'),
  onTerminalWaiting: (callback: (containerId: string) => void) =>
    ipcRenderer.on('terminal:waiting', (_, containerId) => callback(containerId)),
  offTerminalWaiting: () => ipcRenderer.removeAllListeners('terminal:waiting')
})
```

- [ ] **Step 5: Update types.ts**

In `window-manager/src/renderer/src/types.ts`, update the `Api` interface:

```typescript
  // Terminal
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string) => Promise<void>
  sendTerminalInput: (containerId: string, data: string) => void
  resizeTerminal: (containerId: string, cols: number, rows: number) => void
  closeTerminal: (containerId: string) => void
  onTerminalData: (callback: (containerId: string, data: string) => void) => void
  offTerminalData: () => void
  onTerminalWaiting: (callback: (containerId: string) => void) => void
  offTerminalWaiting: () => void
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose ipcHandlers
```

Expected: all tests PASS including new displayName test.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/src/renderer/src/types.ts window-manager/tests/main/ipcHandlers.test.ts
git commit -m "feat: pass displayName through terminal:open IPC, expose onTerminalWaiting in preload"
```

---

### Task 6: TerminalHost — listen for waiting signal, update store

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `window-manager/tests/renderer/TerminalHost.test.ts` with the updated version below. Key additions: mock `waitingWindows`, mock `pushToast`, add `onTerminalWaiting`/`offTerminalWaiting` to `mockApi`, update `openTerminal` assertion to include `win.name`.

```typescript
import { render, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockReset = vi.fn()
const mockOnData = vi.fn()
const mockOnResize = vi.fn()
const mockLoadAddon = vi.fn()
const mockFit = vi.fn()

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = mockOpen
    write = mockWrite
    dispose = mockDispose
    reset = mockReset
    onData = mockOnData
    onResize = mockOnResize
    loadAddon = mockLoadAddon
    cols = 120
    rows = 40
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = mockFit
  }
  return { FitAddon }
})

const webLinksSentinel = { __kind: 'web-links' }
vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {
    constructor() {
      Object.assign(this, webLinksSentinel)
    }
  }
  return { WebLinksAddon }
})

const mockWaitingAdd = vi.fn()
const mockWaitingRemove = vi.fn()
vi.mock('../../src/renderer/src/lib/waitingWindows', () => ({
  waitingWindows: {
    subscribe: vi.fn().mockReturnValue(() => {}),
    add: (...args: unknown[]) => mockWaitingAdd(...args),
    remove: (...args: unknown[]) => mockWaitingRemove(...args)
  }
}))

const mockPushToast = vi.fn()
vi.mock('../../src/renderer/src/lib/toasts', () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args)
}))

import TerminalHost from '../../src/renderer/src/components/TerminalHost.svelte'

const mockWindow: WindowRecord = {
  id: 1,
  name: 'host-test',
  project_id: 7,
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

const mockProject: ProjectRecord = {
  id: 7,
  name: 'host-project',
  git_url: 'git@github.com:org/host-test.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('TerminalHost', () => {
  let mockApi: {
    openTerminal: ReturnType<typeof vi.fn>
    sendTerminalInput: ReturnType<typeof vi.fn>
    resizeTerminal: ReturnType<typeof vi.fn>
    closeTerminal: ReturnType<typeof vi.fn>
    onTerminalData: ReturnType<typeof vi.fn>
    offTerminalData: ReturnType<typeof vi.fn>
    onTerminalWaiting: ReturnType<typeof vi.fn>
    offTerminalWaiting: ReturnType<typeof vi.fn>
    getCurrentBranch: ReturnType<typeof vi.fn>
    commit: ReturnType<typeof vi.fn>
    push: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockApi = {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
      onTerminalWaiting: vi.fn(),
      offTerminalWaiting: vi.fn(),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      commit: vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: '' }),
      push: vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: '' })
    }
    vi.stubGlobal('api', mockApi)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('loads fit and web-links addons on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockLoadAddon).toHaveBeenCalledTimes(2)
    })
    const loaded = mockLoadAddon.mock.calls.map((call) => call[0])
    const hasFit = loaded.some((a) => typeof (a as { fit?: unknown }).fit === 'function')
    const hasWebLinks = loaded.some((a) => (a as { __kind?: string }).__kind === 'web-links')
    expect(hasFit).toBe(true)
    expect(hasWebLinks).toBe(true)
  })

  it('calls api.openTerminal with container_id, measured size, and win.name on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test'
      )
    })
  })

  it('subscribes to onTerminalData and writes only matching-container chunks', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.onTerminalData).toHaveBeenCalled()
    })
    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, d: string) => void
    callback('container123abc', 'hi')
    expect(mockWrite).toHaveBeenCalledWith('hi')
    mockWrite.mockClear()
    callback('some-other-container', 'nope')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('calls api.offTerminalData, api.offTerminalWaiting, and api.closeTerminal on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalled()
    })
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
    expect(mockApi.offTerminalWaiting).toHaveBeenCalled()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc')
    expect(mockDispose).toHaveBeenCalled()
  })

  it('forwards term.onData to sendTerminalInput', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockOnData).toHaveBeenCalled()
    })
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('ls\n')
    expect(mockApi.sendTerminalInput).toHaveBeenCalledWith('container123abc', 'ls\n')
  })

  it('forwards term.onResize to resizeTerminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockOnResize).toHaveBeenCalled()
    })
    const resizeHandler = mockOnResize.mock.calls[0][0] as (d: {
      cols: number
      rows: number
    }) => void
    resizeHandler({ cols: 120, rows: 40 })
    expect(mockApi.resizeTerminal).toHaveBeenCalledWith('container123abc', 120, 40)
  })

  it('on terminal:waiting for matching container, adds to waitingWindows and shows toast', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalWaiting).toHaveBeenCalled())

    const waitingCb = mockApi.onTerminalWaiting.mock.calls[0][0] as (c: string) => void
    waitingCb('container123abc')

    expect(mockWaitingAdd).toHaveBeenCalledWith({
      containerId: 'container123abc',
      windowId: 1,
      windowName: 'host-test',
      projectId: 7,
      projectName: 'host-project'
    })
    expect(mockPushToast).toHaveBeenCalledWith({
      level: 'info',
      title: 'Claude is waiting',
      body: 'host-test'
    })
  })

  it('ignores terminal:waiting for a different container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalWaiting).toHaveBeenCalled())

    const waitingCb = mockApi.onTerminalWaiting.mock.calls[0][0] as (c: string) => void
    waitingCb('different-container')

    expect(mockWaitingAdd).not.toHaveBeenCalled()
    expect(mockPushToast).not.toHaveBeenCalled()
  })

  it('removes from waitingWindows when user types', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockOnData).toHaveBeenCalled())

    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('hello')

    expect(mockWaitingRemove).toHaveBeenCalledWith('container123abc')
  })

  it('removes from waitingWindows on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockWaitingRemove).toHaveBeenCalledWith('container123abc')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose TerminalHost
```

Expected: new tests FAIL — `openTerminal` called without `displayName`, `onTerminalWaiting` not called, `waitingWindows.add` not called.

- [ ] **Step 3: Update TerminalHost.svelte**

Replace `window-manager/src/renderer/src/components/TerminalHost.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import CommitModal from './CommitModal.svelte'
  import { pushToast } from '../lib/toasts'
  import { waitingWindows } from '../lib/waitingWindows'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
  }

  let { win, project }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let resizeObserver: ResizeObserver | undefined

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, {
        subject: v.subject,
        body: v.body || undefined
      })
      if (res.ok) {
        const subjectLine = res.stdout.split('\n').find((l) => /^\[.+\]/.test(l))
        pushToast({ level: 'success', title: 'Committed', body: subjectLine })
      } else {
        const nothing = /nothing to commit/i.test(res.stdout)
        pushToast({
          level: nothing ? 'success' : 'error',
          title: nothing ? 'Nothing to commit' : 'Commit failed',
          body: nothing ? undefined : res.stdout
        })
      }
      commitOpen = false
    } catch (err) {
      pushToast({ level: 'error', title: 'Commit error', body: (err as Error).message })
    } finally {
      commitBusy = false
    }
  }

  async function runPush(): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.push(win.id)
      pushToast({
        level: res.ok ? 'success' : 'error',
        title: res.ok ? 'Pushed' : 'Push failed',
        body: res.stdout || undefined
      })
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  onMount(() => {
    term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#8b5cf6',
        selectionBackground: '#3f3f46'
      },
      scrollback: 1000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(terminalEl)
    fitAddon.fit()
    term.reset()

    resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalEl)

    window.api.openTerminal(win.container_id, term.cols, term.rows, win.name)

    window.api.onTerminalData((containerId: string, data: string) => {
      if (containerId === win.container_id) {
        term?.write(data)
      }
    })

    window.api.onTerminalWaiting((containerId: string) => {
      if (containerId === win.container_id) {
        waitingWindows.add({
          containerId: win.container_id,
          windowId: win.id,
          windowName: win.name,
          projectId: project.id,
          projectName: project.name
        })
        pushToast({ level: 'info', title: 'Claude is waiting', body: win.name })
      }
    })

    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data)
      waitingWindows.remove(win.container_id)
    })

    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows)
    })
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.offTerminalWaiting()
    window.api.closeTerminal(win.container_id)
    waitingWindows.remove(win.container_id)
    term?.dispose()
  })
</script>

<section class="terminal-host">
  <div class="terminal-body" bind:this={terminalEl}></div>
  <WindowDetailPane
    {win}
    {project}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    commitDisabled={commitBusy || pushBusy}
    pushDisabled={commitBusy || pushBusy}
  />
  {#if commitOpen}
    <CommitModal onSubmit={runCommit} onCancel={() => (commitOpen = false)} busy={commitBusy} />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose TerminalHost
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte window-manager/tests/renderer/TerminalHost.test.ts
git commit -m "feat: TerminalHost listens for terminal:waiting, updates waitingWindows store and shows toast"
```

---

### Task 7: Sidebar — Waiting section

**Files:**
- Modify: `window-manager/src/renderer/src/components/Sidebar.svelte`
- Modify: `window-manager/tests/renderer/Sidebar.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following to `window-manager/tests/renderer/Sidebar.test.ts`. First add imports at the top:

```typescript
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'
import type { WaitingEntry } from '../../src/renderer/src/lib/waitingWindows'
```

Then add an `onWaitingWindowSelect` mock to the `beforeEach`:

```typescript
  let onWaitingWindowSelect: ReturnType<typeof vi.fn>
```

And inside `beforeEach`:

```typescript
    onWaitingWindowSelect = vi.fn()
```

Update `baseProps` to include it:

```typescript
  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      projects: [] as ProjectRecord[],
      selectedProjectId: null as number | null,
      onProjectSelect,
      onRequestNewProject,
      onRequestSettings,
      onRequestAssetTesting,
      assetTestingActive: false,
      onWaitingWindowSelect,
      ...overrides
    }
  }
```

Add a `beforeEach` reset and new tests at the end of the describe block:

```typescript
  beforeEach(() => waitingWindows._resetForTest())

  it('does not render the waiting section when no windows are waiting', () => {
    render(Sidebar, baseProps())
    expect(screen.queryByText(/waiting/i)).toBeNull()
  })

  it('renders the waiting section when a window is waiting', async () => {
    const entry: WaitingEntry = {
      containerId: 'c1',
      windowId: 1,
      windowName: 'my-window',
      projectId: 1,
      projectName: 'my-project'
    }
    waitingWindows.add(entry)
    render(Sidebar, baseProps())
    await vi.waitFor(() => {
      expect(screen.getByText(/waiting/i)).toBeDefined()
    })
    expect(screen.getByText('my-project / my-window')).toBeDefined()
  })

  it('clicking a waiting item calls onWaitingWindowSelect with the entry', async () => {
    const entry: WaitingEntry = {
      containerId: 'c1',
      windowId: 1,
      windowName: 'my-window',
      projectId: 1,
      projectName: 'my-project'
    }
    waitingWindows.add(entry)
    render(Sidebar, baseProps())
    await vi.waitFor(() => {
      expect(screen.getByText('my-project / my-window')).toBeDefined()
    })
    await fireEvent.click(screen.getByText('my-project / my-window'))
    expect(onWaitingWindowSelect).toHaveBeenCalledWith(entry)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose Sidebar
```

Expected: new tests FAIL — waiting section not rendered, `onWaitingWindowSelect` prop missing.

- [ ] **Step 3: Update Sidebar.svelte**

Replace `window-manager/src/renderer/src/components/Sidebar.svelte` with:

```svelte
<script lang="ts">
  import type { ProjectRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import { waitingWindows, type WaitingEntry } from '../lib/waitingWindows'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    onProjectSelect: (project: ProjectRecord) => void
    onRequestNewProject: () => void
    onRequestSettings: () => void
    onRequestAssetTesting: () => void
    assetTestingActive: boolean
    onWaitingWindowSelect: (entry: WaitingEntry) => void
  }

  let {
    projects,
    selectedProjectId,
    onProjectSelect,
    onRequestNewProject,
    onRequestSettings,
    onRequestAssetTesting,
    assetTestingActive,
    onWaitingWindowSelect
  }: Props = $props()
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <h1>Projects</h1>
    <div class="header-actions">
      <button
        type="button"
        class="icon-btn"
        aria-label="settings"
        title="Settings"
        onclick={onRequestSettings}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="new project"
        title="New project"
        onclick={onRequestNewProject}>+</button
      >
    </div>
  </header>
  <nav class="sidebar-list">
    {#each projects as project (project.id)}
      <ProjectItem
        {project}
        selected={project.id === selectedProjectId}
        onSelect={onProjectSelect}
      />
    {/each}
  </nav>
  {#if projects.length === 0}
    <p class="empty-hint">No projects yet.</p>
  {/if}
  {#if $waitingWindows.length > 0}
    <div class="waiting-section">
      <div class="waiting-header">Waiting</div>
      {#each $waitingWindows as entry (entry.containerId)}
        <button
          type="button"
          class="waiting-item"
          onclick={() => onWaitingWindowSelect(entry)}
        >
          <span class="waiting-dot" aria-hidden="true">●</span>
          <span class="waiting-label">{entry.projectName} / {entry.windowName}</span>
        </button>
      {/each}
    </div>
  {/if}
  <footer class="sidebar-footer">
    <button
      type="button"
      class="tab-link"
      class:active={assetTestingActive}
      onclick={onRequestAssetTesting}
    >
      Asset Testing
    </button>
  </footer>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    height: 100%;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
    min-width: 1.6rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }

  .waiting-section {
    border-top: 1px solid var(--border);
    padding: 0.35rem 0;
  }

  .waiting-header {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    padding: 0.35rem 0.85rem 0.2rem;
  }

  .waiting-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
  }

  .waiting-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .waiting-dot {
    font-size: 0.5rem;
    color: var(--accent-hi);
    flex-shrink: 0;
  }

  .waiting-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 0.5rem 0.65rem;
    border-top: 1px solid var(--border);
  }

  .tab-link {
    width: 100%;
    text-align: left;
    padding: 0.45rem 0.55rem;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--fg-2);
    cursor: pointer;
  }

  .tab-link:hover {
    color: var(--fg-0);
    border-color: var(--border);
  }

  .tab-link.active {
    color: var(--accent-hi);
    border-color: var(--accent);
    background: rgba(139, 92, 246, 0.08);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose Sidebar
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/Sidebar.svelte window-manager/tests/renderer/Sidebar.test.ts
git commit -m "feat: Sidebar shows waiting windows section with navigation"
```

---

### Task 8: App.svelte — navigation handler for waiting windows

**Files:**
- Modify: `window-manager/src/renderer/src/App.svelte`

No unit tests for `App.svelte` (it's the root orchestrator; existing tests cover sub-components).

- [ ] **Step 1: Add import and handler to App.svelte**

In `window-manager/src/renderer/src/App.svelte`, add the `WaitingEntry` import and `handleWaitingWindowSelect` function.

After the existing imports at the top of the `<script>` block, add:

```typescript
  import type { WaitingEntry } from './lib/waitingWindows'
```

After `handleWindowDeleted`, add:

```typescript
  async function handleWaitingWindowSelect(entry: WaitingEntry): Promise<void> {
    selectedProjectId = entry.projectId
    selectedWindowId = entry.windowId
    view = 'default'
    windows = await window.api.listWindows(entry.projectId)
  }
```

- [ ] **Step 2: Wire handler into Sidebar**

In the template section of `App.svelte`, update the `<Sidebar>` component call to include the new prop:

```svelte
  <Sidebar
    {projects}
    {selectedProjectId}
    onProjectSelect={handleProjectSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestSettings={handleRequestSettings}
    onRequestAssetTesting={handleRequestAssetTesting}
    assetTestingActive={view === 'asset-testing'}
    onWaitingWindowSelect={handleWaitingWindowSelect}
  />
```

- [ ] **Step 3: Run all tests to verify nothing broken**

```bash
cd window-manager && npm test
```

Expected: all main and renderer tests PASS.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/renderer/src/App.svelte
git commit -m "feat: App.svelte navigates to waiting window on sidebar click"
```

---

## Self-Review

**Spec coverage:**
- ✅ `files/tmux.conf` `allow-passthrough on` → Task 1
- ✅ `files/claude-settings.json` Stop hook → Task 1
- ✅ OSC intercept + strip in `terminalService.ts` → Task 4
- ✅ `displayName` param + debounce + OS Notification → Task 4
- ✅ `terminal:waiting` IPC event from main → Task 4
- ✅ `displayName` wired through `ipcHandlers.ts` → Task 5
- ✅ `onTerminalWaiting`/`offTerminalWaiting` in preload → Task 5
- ✅ `Api` type updated → Task 5
- ✅ `'info'` toast level → Task 3
- ✅ `waitingWindows` store → Task 2
- ✅ `TerminalHost` listens, adds to store, clears on input, clears on destroy → Task 6
- ✅ Sidebar waiting section → Task 7
- ✅ App navigation handler → Task 8

**Placeholder scan:** None found. All steps contain complete code.

**Type consistency:**
- `WaitingEntry` defined in Task 2, used in Tasks 6, 7, 8 — consistent
- `displayName` default `''` in `openTerminal` — consistent across Tasks 4 and 5
- `ToastLevel 'info'` added in Task 3, used in Task 6 — consistent
- `terminal:waiting` event name used in Tasks 4, 5, 6 — consistent
