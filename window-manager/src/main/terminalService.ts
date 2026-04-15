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
    if (session.waitingDebounceTimer) clearTimeout(session.waitingDebounceTimer)
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
