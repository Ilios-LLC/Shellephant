import http from 'http'
import { networkInterfaces } from 'os'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { listWindows, getWindowTypeByContainerId } from './windowService'
import { getSession, spawnClaudePty, spawnTerminalPty } from './terminalService'
import { getPhoneServerHtml } from './phoneServerHtml'

const DEFAULT_PORT = 8765

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let serverUrl: string | null = null

export function getTailscaleIp(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const addr of ifaces ?? []) {
      if (addr.family === 'IPv4' && addr.address.startsWith('100.')) return addr.address
    }
  }
  return null
}

function resolveSessionType(
  urlSessionType: string | undefined,
  containerId: string
): 'claude' | 'terminal' {
  if (urlSessionType === 'claude' || urlSessionType === 'terminal') return urlSessionType
  const windowType = getWindowTypeByContainerId(containerId)
  return windowType === 'assisted' ? 'terminal' : 'claude'
}

function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const match = req.url?.match(/^\/ws\/([^/]+)(?:\/(claude|terminal))?$/)
  if (!match) { ws.close(); return }
  const containerId = match[1]
  const sessionType = resolveSessionType(match[2], containerId)
  const session = getSession(containerId, sessionType)
  if (session) {
    const onData = session.pty.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
    const onExit = session.pty.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(`\r\n[process exited: ${exitCode}]\r\n`)
      ws.close()
    })
    ws.on('message', msg => session.pty.write(msg.toString()))
    ws.on('close', () => { onData.dispose(); onExit.dispose() })
  } else {
    const child = sessionType === 'terminal' ? spawnTerminalPty(containerId) : spawnClaudePty(containerId)
    const onData = child.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
    const onExit = child.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(`\r\n[process exited: ${exitCode}]\r\n`)
      ws.close()
    })
    ws.on('message', msg => child.write(msg.toString()))
    ws.on('close', () => { onData.dispose(); onExit.dispose(); try { child.kill() } catch { /* already dead */ } })
  }
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.url === '/api/windows') {
    const windows = await listWindows()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(windows))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(getPhoneServerHtml())
}

export async function startPhoneServer(port = DEFAULT_PORT, bindHost?: string): Promise<{ url: string }> {
  if (httpServer) return { url: serverUrl! }
  const ip = getTailscaleIp()
  if (!ip) throw new Error('Tailscale IP not found (expected 100.x.x.x)')
  const host = bindHost ?? ip
  httpServer = http.createServer((req, res) => {
    handleHttpRequest(req, res).catch(() => {
      if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error') }
    })
  })
  wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', handleWsConnection)
  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(port, host, resolve)
    httpServer!.once('error', reject)
  })
  const actualPort = (httpServer!.address() as AddressInfo).port
  serverUrl = `http://${ip}:${actualPort}`
  return { url: serverUrl }
}

export function stopPhoneServer(): void {
  wss?.clients.forEach(c => c.close())
  wss?.close()
  httpServer?.close()
  // http.Server.close() is async; module state cleared immediately so toggle works
  httpServer = null
  wss = null
  serverUrl = null
}

export function getPhoneServerStatus(): { active: boolean; url?: string } {
  return httpServer ? { active: true, url: serverUrl! } : { active: false }
}
