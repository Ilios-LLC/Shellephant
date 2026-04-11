import Dockerode from 'dockerode'
import type { BrowserWindow } from 'electron'

const docker = new Dockerode()

interface TerminalSession {
  stream: NodeJS.ReadWriteStream
  exec: Dockerode.Exec
}

const sessions = new Map<string, TerminalSession>()

export async function openTerminal(containerId: string, win: BrowserWindow): Promise<void> {
  const container = docker.getContainer(containerId)

  const exec = await container.exec({
    Cmd: ['/bin/bash'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  })

  const stream = (await exec.start({ hijack: true, stdin: true })) as NodeJS.ReadWriteStream

  sessions.set(containerId, { stream, exec })

  stream.on('data', (chunk: Buffer) => {
    win.webContents.send('terminal:data', containerId, chunk.toString())
  })

  stream.on('end', () => {
    sessions.delete(containerId)
    win.webContents.send('terminal:data', containerId, '\r\n[Session ended]\r\n')
  })
}

export function writeInput(containerId: string, data: string): void {
  sessions.get(containerId)?.stream.write(data)
}

export async function resizeTerminal(containerId: string, cols: number, rows: number): Promise<void> {
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
