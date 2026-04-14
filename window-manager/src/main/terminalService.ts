import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { getClaudeToken } from './settingsService'

interface TerminalSession {
  pty: IPty
  resizeTimer: ReturnType<typeof setTimeout> | null
  pendingResize: { cols: number; rows: number } | null
}

// Collapse bursts of resize events into a single pty.resize call. During
// initial layout / window drags ResizeObserver can fire many times; without
// debounce each fire triggers SIGWINCH in the remote shell.
const RESIZE_DEBOUNCE_MS = 80

// After the client attaches to tmux we bump the PTY size by one row and back
// so tmux receives SIGWINCH and repaints the pane state fresh — preserving
// the persistent-session prompt the user expects to see on re-open.
const REFRESH_KICK_MS = 120

const sessions = new Map<string, TerminalSession>()

export function openTerminal(
  containerId: string,
  win: BrowserWindow,
  cols: number,
  rows: number
): Promise<void> {
  // Idempotent: tear down any existing session for this container first.
  if (sessions.has(containerId)) {
    closeTerminal(containerId)
  }

  const safeCols = Math.max(1, Math.floor(cols))
  const safeRows = Math.max(1, Math.floor(rows))

  // Spawn `docker exec -it <id> sh -c 'exec tmux -u new-session -A -s cw'`
  // as a child under a locally-allocated PTY. node-pty creates the PTY at the
  // exact size we specify; the docker CLI's -t inherits that geometry and
  // forwards it to the container exec. TIOCSWINSZ propagation is correct from
  // byte 1, so tmux/zsh paint at the right size with no race.
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
    pendingResize: null
  }
  sessions.set(containerId, session)

  child.onData((data: string) => {
    if (win.isDestroyed()) return
    win.webContents.send('terminal:data', containerId, data)
  })

  child.onExit(() => {
    sessions.delete(containerId)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, '\r\n[detached]\r\n')
    }
  })

  // Kick tmux with a real SIGWINCH so it repaints the pane state whether we
  // are creating the session or re-attaching to an existing one.
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
