import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { getClaudeToken } from './settingsService'
import { getDocker } from './docker'
import { execInContainer } from './gitOps'

export interface TerminalSession {
  pty: IPty
  resizeTimer: ReturnType<typeof setTimeout> | null
  pendingResize: { cols: number; rows: number } | null
  displayName: string
  win: BrowserWindow
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

export function getSession(containerId: string): TerminalSession | undefined {
  return sessions.get(containerId)
}

export function openTerminal(
  containerId: string,
  win: BrowserWindow,
  cols: number,
  rows: number,
  displayName: string = '',
  workDir?: string
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
  const tmuxCmd = workDir
    ? `exec tmux -u new-session -A -s cw -c '${workDir}'`
    : 'exec tmux -u new-session -A -s cw'
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
  sessions.set(containerId, session)

  // Fire-and-forget: clear any stale Stop-hook marker left from a
  // previous session so the first poll tick doesn't spuriously notify.
  void clearStaleMarker(containerId)

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

async function clearStaleMarker(containerId: string): Promise<void> {
  try {
    const container = getDocker().getContainer(containerId)
    await execInContainer(container, ['rm', '-f', '/tmp/claude-waiting'])
  } catch {
    // Docker unreachable or container gone; harmless.
  }
}
