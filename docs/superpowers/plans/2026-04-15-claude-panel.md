# Claude Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Terminal/Editor/Both view toggle with Claude/Terminal/Editor — Claude is the default and runs a persistent `claude` tmux session; Terminal is the existing persistent session; both survive panel switches.

**Architecture:** Two independent PTY sessions per container keyed as `containerId:sessionType`. The IPC layer threads `sessionType` through all terminal calls. `TerminalHost` owns two xterm instances and lazily initializes the Terminal session on first use. `WindowDetailPane` gets new toggle buttons and loses the `injectClaude` action.

**Tech Stack:** node-pty, tmux, xterm.js, Svelte 5 runes, Electron IPC, Vitest + @testing-library/svelte

---

## File Map

| File | Change |
|------|--------|
| `src/main/terminalService.ts` | Export `SessionType`; key sessions as `containerId:sessionType`; claude tmux cmd; add `sessionType` param to all exports; `terminal:data` event gains `sessionType` |
| `src/main/ipcHandlers.ts` | Thread `sessionType` through all four terminal IPC handlers |
| `src/preload/index.ts` | Add `sessionType` param to terminal API methods; update `onTerminalData` callback signature |
| `src/renderer/src/components/WindowDetailPane.svelte` | `ViewMode` → `'claude'\|'terminal'\|'editor'`; new buttons; remove `injectClaude` |
| `src/renderer/src/components/TerminalHost.svelte` | Two xterm instances; lazy terminal init; route `terminal:data` by `sessionType`; default `'claude'` |
| `tests/main/terminalService.test.ts` | Update for session keys, new tmux cmd, sessionType in data event |
| `tests/main/ipcHandlers.test.ts` | Update terminal handler tests to pass sessionType |
| `tests/renderer/WindowDetailPane.test.ts` | Replace Both/injectClaude tests; new button assertions |
| `tests/renderer/TerminalHost.test.ts` | New default, two sessions, sessionType routing |

---

### Task 1: Update terminalService for session types

**Files:**
- Modify: `window-manager/src/main/terminalService.ts`
- Test: `window-manager/tests/main/terminalService.test.ts`

- [ ] **Step 1: Write failing tests for session-type keying**

Replace the full contents of `tests/main/terminalService.test.ts` with:

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

const { mockGetContainer, mockExecInContainer } = vi.hoisted(() => ({
  mockGetContainer: vi.fn(),
  mockExecInContainer: vi.fn()
}))
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: (id: string) => mockGetContainer(id) })
}))
vi.mock('../../src/main/gitOps', () => ({
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args)
}))

import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
  closeTerminalSessionFor,
  getSession
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

describe('terminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetClaudeToken.mockReturnValue(null)
    mockGetContainer.mockReturnValue({})
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openAndSettle(
    containerId: string,
    win: ReturnType<typeof makeFakeWin>,
    cols: number,
    rows: number,
    displayName: string = '',
    sessionType: 'terminal' | 'claude' = 'terminal'
  ): Promise<void> {
    await openTerminal(containerId, win as any, cols, rows, displayName, undefined, sessionType)
    await vi.advanceTimersByTimeAsync(400)
  }

  describe('openTerminal', () => {
    it('spawns docker exec with cw session for terminal sessionType', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 120, 40)

      const [program, args, opts] = mockSpawn.mock.calls[0] as [
        string,
        string[],
        { cols: number; rows: number; name: string }
      ]
      expect(program).toBe('docker')
      expect(args).toContain('exec')
      expect(args.join(' ')).toMatch(/tmux -u new-session -A -s cw/)
      expect(args.join(' ')).not.toMatch(/cw-claude/)
      expect(opts.cols).toBe(120)
      expect(opts.rows).toBe(40)
    })

    it('spawns docker exec with cw-claude session and runs claude for claude sessionType', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 120, 40, '', '/workspace/repo', 'claude')

      const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
      expect(args.join(' ')).toMatch(/tmux -u new-session -A -s cw-claude/)
      expect(args.join(' ')).toMatch(/claude/)
    })

    it('terminal:data event includes sessionType', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 80, 24, '', undefined, 'claude')
      ptyInstance.emitData('hello')

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-1', 'claude', 'hello')
    })

    it('terminal:data uses terminal sessionType by default', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 80, 24)
      ptyInstance.emitData('hello')

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-1', 'terminal', 'hello')
    })

    it('two sessions for same container coexist independently', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()

      await openTerminal('container-x', win as any, 80, 24, '', undefined, 'terminal')
      await openTerminal('container-x', win as any, 80, 24, '', undefined, 'claude')

      expect(mockSpawn).toHaveBeenCalledTimes(2)
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('fires a stale-marker cleanup exec on open', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      await openTerminal('container-stale', makeFakeWin() as any, 80, 24)
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      expect(mockGetContainer).toHaveBeenCalledWith('container-stale')
      const cmd = mockExecInContainer.mock.calls[0]?.[1] as string[]
      expect(cmd).toEqual(['rm', '-f', '/tmp/claude-waiting'])
    })

    it('swallows errors from the stale-marker cleanup', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      mockExecInContainer.mockRejectedValueOnce(new Error('docker down'))
      await expect(
        openTerminal('container-stale-err', makeFakeWin() as any, 80, 24)
      ).resolves.toBeUndefined()
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

    it('forwards pty data immediately', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-boot', win as any, 80, 24)
      ptyInstance.emitData('hello')
      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-boot', 'terminal', 'hello')
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
        'terminal',
        '\r\n[detached]\r\n'
      )

      writeInput('container-exit', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('is idempotent within same sessionType: second open kills previous pty', async () => {
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

  describe('getSession', () => {
    it('returns the session for the given containerId and sessionType', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      const win = makeFakeWin()
      await openAndSettle('container-gs', win, 80, 24, 'my-name', 'terminal')
      const s = getSession('container-gs', 'terminal')
      expect(s?.displayName).toBe('my-name')
      expect(s?.win).toBe(win)
    })

    it('defaults sessionType to terminal', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      await openAndSettle('container-gs2', makeFakeWin(), 80, 24, 'n')
      expect(getSession('container-gs2')).toBeDefined()
    })

    it('returns undefined for an unknown containerId', () => {
      expect(getSession('nope')).toBeUndefined()
    })

    it('returns undefined when sessionType does not match', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      await openAndSettle('container-gs3', makeFakeWin(), 80, 24, '', 'terminal')
      expect(getSession('container-gs3', 'claude')).toBeUndefined()
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

    it('routes to the correct sessionType', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()
      await openAndSettle('container-route', win, 80, 24, '', 'terminal')
      await openAndSettle('container-route', win, 80, 24, '', 'claude')

      writeInput('container-route', 'a', 'claude')
      expect(p2.write).toHaveBeenCalledWith('a')
      expect(p1.write).not.toHaveBeenCalled()
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
    it('kills the pty and drops the session', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-c', makeFakeWin(), 80, 24)

      closeTerminal('container-c')

      expect(mockKill).toHaveBeenCalled()
      writeInput('container-c', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('only closes the specified sessionType', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()
      await openAndSettle('container-sel', win, 80, 24, '', 'terminal')
      await openAndSettle('container-sel', win, 80, 24, '', 'claude')

      closeTerminal('container-sel', 'terminal')

      expect(mockKill).toHaveBeenCalledTimes(1)
      expect(getSession('container-sel', 'claude')).toBeDefined()
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
    it('closes both terminal and claude sessions for the container', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()
      await openAndSettle('container-both', win, 80, 24, '', 'terminal')
      await openAndSettle('container-both', win, 80, 24, '', 'claude')

      closeTerminalSessionFor('container-both')

      expect(mockKill).toHaveBeenCalledTimes(2)
      expect(getSession('container-both', 'terminal')).toBeUndefined()
      expect(getSession('container-both', 'claude')).toBeUndefined()
    })

    it('is a no-op when no sessions exist', () => {
      expect(() => closeTerminalSessionFor('ghost')).not.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/main/terminalService.test.ts
```

Expected: multiple failures — `getSession` signature mismatch, `terminal:data` missing sessionType, etc.

- [ ] **Step 3: Update terminalService implementation**

Replace the full contents of `src/main/terminalService.ts` with:

```typescript
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { getClaudeToken } from './settingsService'
import { getDocker } from './docker'
import { execInContainer } from './gitOps'

export type SessionType = 'claude' | 'terminal'

export interface TerminalSession {
  pty: IPty
  resizeTimer: ReturnType<typeof setTimeout> | null
  pendingResize: { cols: number; rows: number } | null
  displayName: string
  win: BrowserWindow
}

const RESIZE_DEBOUNCE_MS = 80
const REFRESH_KICK_MS = 120

const sessions = new Map<string, TerminalSession>()

function sessionKey(containerId: string, sessionType: SessionType): string {
  return `${containerId}:${sessionType}`
}

export function getSession(containerId: string, sessionType: SessionType = 'terminal'): TerminalSession | undefined {
  return sessions.get(sessionKey(containerId, sessionType))
}

export function openTerminal(
  containerId: string,
  win: BrowserWindow,
  cols: number,
  rows: number,
  displayName: string = '',
  workDir?: string,
  sessionType: SessionType = 'terminal'
): Promise<void> {
  const key = sessionKey(containerId, sessionType)
  if (sessions.has(key)) {
    closeTerminalByKey(key)
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

  let tmuxCmd: string
  if (sessionType === 'claude') {
    tmuxCmd = workDir
      ? `exec tmux -u new-session -A -s cw-claude -c '${workDir}' 'claude'`
      : `exec tmux -u new-session -A -s cw-claude 'claude'`
  } else {
    tmuxCmd = workDir
      ? `exec tmux -u new-session -A -s cw -c '${workDir}'`
      : 'exec tmux -u new-session -A -s cw'
  }
  args.push(containerId, 'sh', '-c', tmuxCmd)

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
    win
  }
  sessions.set(key, session)

  void clearStaleMarker(containerId)

  child.onData((data: string) => {
    if (win.isDestroyed()) return
    win.webContents.send('terminal:data', containerId, sessionType, data)
  })

  child.onExit(() => {
    sessions.delete(key)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, sessionType, '\r\n[detached]\r\n')
    }
  })

  setTimeout(() => {
    if (!sessions.has(key)) return
    try {
      child.resize(safeCols, Math.max(1, safeRows - 1))
      child.resize(safeCols, safeRows)
    } catch {
      // Session may have exited; ignore.
    }
  }, REFRESH_KICK_MS)

  return Promise.resolve()
}

export function writeInput(containerId: string, data: string, sessionType: SessionType = 'terminal'): void {
  sessions.get(sessionKey(containerId, sessionType))?.pty.write(data)
}

export function resizeTerminal(containerId: string, cols: number, rows: number, sessionType: SessionType = 'terminal'): void {
  const session = sessions.get(sessionKey(containerId, sessionType))
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

function closeTerminalByKey(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  if (session.resizeTimer) clearTimeout(session.resizeTimer)
  try {
    session.pty.kill()
  } catch {
    // Already dead; ignore.
  }
  sessions.delete(key)
}

export function closeTerminal(containerId: string, sessionType: SessionType = 'terminal'): void {
  closeTerminalByKey(sessionKey(containerId, sessionType))
}

export function closeTerminalSessionFor(containerId: string): void {
  closeTerminalByKey(sessionKey(containerId, 'terminal'))
  closeTerminalByKey(sessionKey(containerId, 'claude'))
}

async function clearStaleMarker(containerId: string): Promise<void> {
  try {
    const container = getDocker().getContainer(containerId)
    await execInContainer(container, ['rm', '-f', '/tmp/claude-waiting'])
  } catch {
    // Docker unreachable or container gone; harmless.
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/terminalService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/terminalService.ts tests/main/terminalService.test.ts
git commit -m "feat(terminal): key sessions by containerId:sessionType, add claude tmux session"
```

---

### Task 2: Thread sessionType through IPC layer

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Test: `window-manager/tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Write failing IPC handler tests**

In `tests/main/ipcHandlers.test.ts`, replace the four terminal handler tests (lines 179–215) with:

```typescript
  it('registers terminal:open handler that calls openTerminal with sessionType', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 120, 40, 'my-window', 'claude')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 120, 40, 'my-window', undefined, 'claude')
  })

  it('terminal:open defaults sessionType to terminal when omitted', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 120, 40, 'my-window')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 120, 40, 'my-window', undefined, 'terminal')
  })

  it('terminal:open resolves workDir from DB and passes to openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    mockDbGet.mockReturnValue({ git_url: 'git@github.com:org/my-repo.git' })
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 80, 24, 'win', 'terminal')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 80, 24, 'win', '/workspace/my-repo', 'terminal')
  })

  it('registers terminal:input listener that calls writeInput with sessionType', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n', 'claude')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n', 'claude')
  })

  it('terminal:input defaults sessionType to terminal', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n', 'terminal')
  })

  it('registers terminal:resize listener that calls resizeTerminal with sessionType', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24, 'claude')
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24, 'claude')
  })

  it('terminal:resize defaults sessionType to terminal', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24)
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24, 'terminal')
  })

  it('registers terminal:close listener that calls closeTerminal with sessionType', () => {
    getListener('terminal:close')({}, 'container-abc', 'claude')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc', 'claude')
  })

  it('terminal:close defaults sessionType to terminal', () => {
    getListener('terminal:close')({}, 'container-abc')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc', 'terminal')
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts
```

Expected: the four terminal handler tests fail.

- [ ] **Step 3: Update ipcHandlers.ts**

In `src/main/ipcHandlers.ts`:

1. Add `SessionType` to the import from terminalService:
```typescript
import { openTerminal, writeInput, resizeTerminal, closeTerminal, type SessionType } from './terminalService'
```

2. Replace the four terminal handler registrations (lines 135–153) with:
```typescript
  ipcMain.handle('terminal:open', (event, containerId: string, cols: number, rows: number, displayName: string, sessionType: SessionType = 'terminal') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    const row = getDb()
      .prepare(
        `SELECT p.git_url FROM windows w JOIN projects p ON p.id = w.project_id
         WHERE w.container_id = ? AND w.deleted_at IS NULL LIMIT 1`
      )
      .get(containerId) as { git_url: string } | undefined
    const workDir = row ? `/workspace/${extractRepoName(row.git_url)}` : undefined
    return openTerminal(containerId, win, cols, rows, displayName, workDir, sessionType)
  })
  ipcMain.on('terminal:input', (_, containerId: string, data: string, sessionType: SessionType = 'terminal') =>
    writeInput(containerId, data, sessionType)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number, sessionType: SessionType = 'terminal') =>
    resizeTerminal(containerId, cols, rows, sessionType)
  )
  ipcMain.on('terminal:close', (_, containerId: string, sessionType: SessionType = 'terminal') => closeTerminal(containerId, sessionType))
```

- [ ] **Step 4: Update preload/index.ts**

Replace the Terminal API section (lines 41–64) with:

```typescript
  // Terminal API
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string, sessionType: string = 'terminal') =>
    ipcRenderer.invoke('terminal:open', containerId, cols, rows, displayName, sessionType),
  sendTerminalInput: (containerId: string, data: string, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:input', containerId, data, sessionType),
  resizeTerminal: (containerId: string, cols: number, rows: number, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows, sessionType),
  closeTerminal: (containerId: string, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:close', containerId, sessionType),
  onTerminalData: (callback: (containerId: string, sessionType: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, sessionType, data) => callback(containerId, sessionType, data)),
  offTerminalData: () => ipcRenderer.removeAllListeners('terminal:data'),
  onTerminalWaiting: (
    callback: (info: {
      containerId: string
      windowId: number
      windowName: string
      projectId: number
      projectName: string
    }) => void
  ) => ipcRenderer.on('terminal:waiting', (_, info) => callback(info)),
  offTerminalWaiting: () => ipcRenderer.removeAllListeners('terminal:waiting'),
  onTerminalSummary: (
    callback: (data: { containerId: string; title: string; bullets: string[] }) => void
  ) => ipcRenderer.on('terminal:summary', (_, data) => callback(data)),
  offTerminalSummary: () => ipcRenderer.removeAllListeners('terminal:summary'),
```

- [ ] **Step 5: Run IPC tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/main/ipcHandlers.ts src/preload/index.ts tests/main/ipcHandlers.test.ts
git commit -m "feat(ipc): thread sessionType through terminal IPC handlers and preload"
```

---

### Task 3: Update WindowDetailPane — Claude/Terminal/Editor buttons

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write failing tests for new button layout**

In `tests/renderer/WindowDetailPane.test.ts`, make these targeted replacements:

Replace the test `'renders Terminal, Editor, and Both toggle buttons'` with:
```typescript
  it('renders Claude, Terminal, and Editor toggle buttons in order', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    const buttons = screen.getAllByRole('button', { name: /^(claude|terminal|editor)$/i })
    expect(buttons[0]).toHaveAccessibleName(/claude/i)
    expect(buttons[1]).toHaveAccessibleName(/terminal/i)
    expect(buttons[2]).toHaveAccessibleName(/editor/i)
    expect(screen.queryByRole('button', { name: /both/i })).not.toBeInTheDocument()
  })
```

Replace the test `'marks the active viewMode button with aria-pressed'` with:
```typescript
  it('marks the active viewMode button with aria-pressed', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project, viewMode: 'editor' } })
    expect(screen.getByRole('button', { name: /^editor$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^claude$/i })).toHaveAttribute('aria-pressed', 'false')
  })
```

Replace the test `'calls onViewChange with the clicked mode'` with:
```typescript
  it('calls onViewChange with the clicked mode', async () => {
    getCurrentBranch.mockResolvedValue('main')
    const onViewChange = vi.fn()
    render(WindowDetailPane, { props: { win, project, viewMode: 'claude', onViewChange } })
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    expect(onViewChange).toHaveBeenCalledWith('terminal')
  })
```

Remove the three tests for the inject-Claude button (the ones checking `'renders a Claude button'`, `'Claude button is disabled when container is not running'`, `'Claude button is disabled when container status is unknown'`, `'Claude button is enabled when container is running'`, `'clicking Claude button sends the inject command to the terminal'`).

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts
```

Expected: button layout tests fail, inject-claude tests still pass (they'll be removed).

- [ ] **Step 3: Update WindowDetailPane.svelte**

In `src/renderer/src/components/WindowDetailPane.svelte`:

1. Change `type ViewMode` declaration (line 6):
```typescript
type ViewMode = 'claude' | 'terminal' | 'editor'
```

2. Change the default for `viewMode` prop (line 27):
```typescript
viewMode = 'claude',
```

3. Remove the `injectClaude` function entirely (lines 106–108).

4. Replace the `.toggle-row` buttons block (lines 113–133) with:
```html
  <div class="toggle-row">
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'claude'}
      aria-pressed={viewMode === 'claude'}
      onclick={() => onViewChange('claude')}
    >Claude</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'terminal'}
      aria-pressed={viewMode === 'terminal'}
      onclick={() => onViewChange('terminal')}
    >Terminal</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'editor'}
      aria-pressed={viewMode === 'editor'}
      onclick={() => onViewChange('editor')}
    >Editor</button>
  </div>
```

5. Remove the Claude action button from `.actions` (the `<button ... onclick={injectClaude}>Claude</button>` line).

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/renderer/src/components/WindowDetailPane.svelte tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(ui): replace Terminal/Editor/Both toggle with Claude/Terminal/Editor"
```

---

### Task 4: Update TerminalHost — two xterm instances, lazy terminal init

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Test: `window-manager/tests/renderer/TerminalHost.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the full contents of `tests/renderer/TerminalHost.test.ts` with:

```typescript
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte'
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

const mockSummarySet = vi.fn()
const mockSummaryRemove = vi.fn()
vi.mock('../../src/renderer/src/lib/conversationSummary', () => ({
  conversationSummary: {
    subscribe: vi.fn((cb: (v: Map<string, unknown>) => void) => {
      cb(new Map())
      return () => {}
    }),
    set: (...args: unknown[]) => mockSummarySet(...args),
    remove: (...args: unknown[]) => mockSummaryRemove(...args)
  }
}))

const mockPushToast = vi.fn()
vi.mock('../../src/renderer/src/lib/toasts', () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args)
}))

vi.mock('../../src/renderer/src/components/EditorPane.svelte', () => ({
  default: vi.fn(() => ({}))
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
    onTerminalSummary: ReturnType<typeof vi.fn>
    offTerminalSummary: ReturnType<typeof vi.fn>
    getCurrentBranch: ReturnType<typeof vi.fn>
    getGitStatus: ReturnType<typeof vi.fn>
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
      onTerminalSummary: vi.fn(),
      offTerminalSummary: vi.fn(),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      getGitStatus: vi.fn().mockResolvedValue({ isDirty: false, added: 0, deleted: 0 }),
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

  it('opens claude session on mount (default view is claude)', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test',
        'claude'
      )
    })
    expect(mockApi.openTerminal).toHaveBeenCalledTimes(1)
  })

  it('does NOT open terminal session on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    const calls = mockApi.openTerminal.mock.calls as unknown[][]
    const terminalCalls = calls.filter((c) => c[4] === 'terminal')
    expect(terminalCalls).toHaveLength(0)
  })

  it('opens terminal session on first click of Terminal button', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    mockApi.openTerminal.mockClear()

    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))

    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test',
        'terminal'
      )
    })
  })

  it('does not re-open terminal session on subsequent Terminal clicks', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    mockApi.openTerminal.mockClear()

    await fireEvent.click(screen.getByRole('button', { name: /^claude$/i }))
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))

    expect(mockApi.openTerminal).not.toHaveBeenCalled()
  })

  it('routes onTerminalData to claude session when sessionType is claude', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('container123abc', 'claude', 'hello from claude')

    expect(mockWrite).toHaveBeenCalledWith('hello from claude')
  })

  it('routes onTerminalData to terminal session when sessionType is terminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    // Switch to terminal first so term is initialized
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    mockWrite.mockClear()

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('container123abc', 'terminal', 'hello from terminal')

    expect(mockWrite).toHaveBeenCalledWith('hello from terminal')
  })

  it('ignores onTerminalData for a different container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('other-container', 'claude', 'ignored')

    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('closes claude session on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc', 'claude')
  })

  it('closes terminal session on unmount if it was opened', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    unmount()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc', 'terminal')
  })

  it('does not close terminal session on unmount if it was never opened', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    const terminalCloseCalls = (mockApi.closeTerminal.mock.calls as unknown[][]).filter(
      (c) => c[1] === 'terminal'
    )
    expect(terminalCloseCalls).toHaveLength(0)
  })

  it('loads fit and web-links addons for claude terminal on mount', async () => {
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

  it('Claude toggle button is active (aria-pressed true) by default', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^claude$/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides claude terminal div when Editor mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    await fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    const claudeBody = document.querySelectorAll('.terminal-body')[0]
    expect(claudeBody?.classList.contains('hidden')).toBe(true)
  })

  it('removes from waitingWindows when user types in claude terminal', async () => {
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

  it('calls offTerminalSummary and removes summary on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalSummary).toHaveBeenCalled()
    expect(mockSummaryRemove).toHaveBeenCalledWith('container123abc')
  })

  it('calls offTerminalData on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/renderer/TerminalHost.test.ts
```

Expected: multiple failures — default view is not 'claude', session type not passed, etc.

- [ ] **Step 3: Update TerminalHost.svelte**

Replace the full contents of `src/renderer/src/components/TerminalHost.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import EditorPane from './EditorPane.svelte'
  import CommitModal from './CommitModal.svelte'
  import { pushToast, pushSuccessModal } from '../lib/toasts'
  import { waitingWindows } from '../lib/waitingWindows'
  import { conversationSummary } from '../lib/conversationSummary'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onWindowDeleted?: (id: number) => void
  }

  let { win, project, onWindowDeleted = () => {} }: Props = $props()

  const rootPath = $derived('/workspace/' + (project.git_url.split('/').pop() ?? 'unknown').replace(/\.git$/, ''))

  // Claude terminal (default, opened on mount)
  let claudeTerminalEl: HTMLDivElement
  let claudeTerm: XTerm | undefined
  let claudeFitAddon: FitAddon | undefined
  let claudeResizeObserver: ResizeObserver | undefined

  // Terminal session (lazy, opened on first switch to Terminal panel)
  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let resizeObserver: ResizeObserver | undefined
  let terminalOpened = false

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)
  let deleteBusy = $state(false)
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
  let viewMode = $state<'claude' | 'terminal' | 'editor'>('claude')

  const xtermOptions = {
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    theme: {
      background: '#09090b',
      foreground: '#fafafa',
      cursor: '#8b5cf6',
      selectionBackground: '#3f3f46'
    },
    scrollback: 1000
  }

  function initTerminalSession(): void {
    terminalOpened = true
    term = new XTerm(xtermOptions)
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(terminalEl)
    fitAddon.fit()
    term.reset()
    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalEl)
    window.api.openTerminal(win.container_id, term.cols, term.rows, win.name, 'terminal')
    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'terminal')
      waitingWindows.remove(win.container_id)
    })
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'terminal')
    })
  }

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
      if (res.ok) {
        pushSuccessModal(res.prUrl)
      } else {
        pushToast({ level: 'error', title: 'Push failed', body: res.stdout || undefined })
      }
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  async function runDelete(): Promise<void> {
    if (deleteBusy) return
    deleteBusy = true
    try {
      await window.api.deleteWindow(win.id)
      onWindowDeleted(win.id)
    } catch (err) {
      pushToast({ level: 'error', title: 'Delete failed', body: (err as Error).message })
      deleteBusy = false
    }
  }

  onMount(() => {
    claudeTerm = new XTerm(xtermOptions)
    claudeFitAddon = new FitAddon()
    claudeTerm.loadAddon(claudeFitAddon)
    claudeTerm.loadAddon(new WebLinksAddon())
    claudeTerm.open(claudeTerminalEl)
    claudeFitAddon.fit()
    claudeTerm.reset()
    claudeResizeObserver = new ResizeObserver(() => claudeFitAddon?.fit())
    claudeResizeObserver.observe(claudeTerminalEl)
    window.api.openTerminal(win.container_id, claudeTerm.cols, claudeTerm.rows, win.name, 'claude')
    claudeTerm.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'claude')
      waitingWindows.remove(win.container_id)
    })
    claudeTerm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'claude')
    })

    window.api.onTerminalData((containerId: string, sessionType: string, data: string) => {
      if (containerId !== win.container_id) return
      if (sessionType === 'claude') claudeTerm?.write(data)
      else term?.write(data)
    })

    window.api.onTerminalSummary(({ containerId, title, bullets }) => {
      if (containerId === win.container_id) {
        conversationSummary.set(containerId, { title, bullets })
      }
    })
  })

  onDestroy(() => {
    claudeResizeObserver?.disconnect()
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id, 'claude')
    if (terminalOpened) {
      window.api.closeTerminal(win.container_id, 'terminal')
    }
    waitingWindows.remove(win.container_id)
    window.api.offTerminalSummary()
    conversationSummary.remove(win.container_id)
    claudeTerm?.dispose()
    term?.dispose()
  })

  $effect(() => {
    if (viewMode === 'claude') {
      claudeFitAddon?.fit()
    } else if (viewMode === 'terminal') {
      if (!terminalOpened) initTerminalSession()
      fitAddon?.fit()
    }
  })
</script>

<section class="terminal-host">
  <div class="content-area">
    {#if viewMode === 'editor'}
      <div class="editor-wrap">
        <EditorPane containerId={win.container_id} {rootPath} />
      </div>
    {/if}
    <div class="terminal-body" class:hidden={viewMode !== 'claude'} bind:this={claudeTerminalEl}></div>
    <div class="terminal-body" class:hidden={viewMode !== 'terminal'} bind:this={terminalEl}></div>
  </div>
  <WindowDetailPane
    {win}
    {project}
    {viewMode}
    summary={$conversationSummary.get(win.container_id)}
    onViewChange={(mode) => (viewMode = mode)}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    onDelete={runDelete}
    onGitStatus={(s) => (gitStatus = s)}
    commitDisabled={commitBusy || pushBusy || deleteBusy || !gitStatus?.isDirty}
    pushDisabled={commitBusy || pushBusy || deleteBusy}
    deleteDisabled={deleteBusy}
  />
  {#if commitOpen}
    <CommitModal
      initialSubject={$conversationSummary.get(win.container_id)?.title ?? ''}
      initialBody={$conversationSummary.get(win.container_id)?.bullets.join('\n') ?? ''}
      onSubmit={runCommit}
      onCancel={() => (commitOpen = false)}
      busy={commitBusy}
    />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .content-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-wrap {
    flex: 1;
    overflow: hidden;
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }

  .terminal-body.hidden {
    display: none;
  }
</style>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/renderer/TerminalHost.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd window-manager && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/renderer/src/components/TerminalHost.svelte tests/renderer/TerminalHost.test.ts
git commit -m "feat(ui): add claude panel as default view with lazy terminal session"
```
