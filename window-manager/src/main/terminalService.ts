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
      ? `exec tmux -u new-session -A -s cw-claude -c '${workDir}' 'bash -c "claude; exec bash"'`
      : `exec tmux -u new-session -A -s cw-claude 'bash -c "claude; exec bash"'`
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
