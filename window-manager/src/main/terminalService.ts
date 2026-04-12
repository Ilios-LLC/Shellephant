import Dockerode from 'dockerode'
import type { Duplex } from 'stream'
import type { BrowserWindow } from 'electron'

const docker = new Dockerode()

interface TerminalSession {
  stream: Duplex
  exec: Dockerode.Exec
}

const sessions = new Map<string, TerminalSession>()

export async function openTerminal(containerId: string, win: BrowserWindow): Promise<void> {
  // Idempotent: tear down any existing session for this container first.
  if (sessions.has(containerId)) {
    closeTerminal(containerId)
  }

  const container = docker.getContainer(containerId)

  const exec = await container.exec({
    Cmd: ['tmux', 'new-session', '-A', '-s', 'cw'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color']
  })

  const stream = (await exec.start({ hijack: true, stdin: true })) as unknown as Duplex

  sessions.set(containerId, { stream, exec })

  stream.on('data', (chunk: Buffer) => {
    if (win.isDestroyed()) return
    win.webContents.send('terminal:data', containerId, chunk.toString())
  })

  stream.on('end', () => {
    sessions.delete(containerId)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, '\r\n[detached]\r\n')
    }
  })
}

export function writeInput(containerId: string, data: string): void {
  sessions.get(containerId)?.stream.write(data)
}

export async function resizeTerminal(
  containerId: string,
  cols: number,
  rows: number
): Promise<void> {
  const session = sessions.get(containerId)
  if (session) await session.exec.resize({ w: cols, h: rows })
}

export function closeTerminal(containerId: string): void {
  const session = sessions.get(containerId)
  if (session) {
    session.stream.destroy()
    sessions.delete(containerId)
  }
}

export function closeTerminalSessionFor(containerId: string): void {
  closeTerminal(containerId)
}
