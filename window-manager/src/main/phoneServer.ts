import http from 'http'
import { networkInterfaces } from 'os'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { listWindows } from './windowService'
import { getSession } from './terminalService'
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

function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const match = req.url?.match(/^\/ws\/([^/]+)$/)
  if (!match) { ws.close(); return }
  const session = getSession(match[1], 'claude')
  if (!session) {
    ws.send('ERROR: No active claude session')
    ws.close()
    return
  }
  const onData = session.pty.onData(d => ws.send(d))
  const onExit = session.pty.onExit(() => ws.close())
  ws.on('message', msg => session.pty.write(msg.toString()))
  ws.on('close', () => { onData.dispose(); onExit.dispose() })
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

export async function startPhoneServer(port = DEFAULT_PORT): Promise<{ url: string }> {
  if (httpServer) return { url: serverUrl! }
  const ip = getTailscaleIp()
  if (!ip) throw new Error('Tailscale IP not found (expected 100.x.x.x)')
  httpServer = http.createServer((req, res) => { void handleHttpRequest(req, res) })
  wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', handleWsConnection)
  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(port, '0.0.0.0', resolve)
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
  httpServer = null
  wss = null
  serverUrl = null
}

export function getPhoneServerStatus(): { active: boolean; url?: string } {
  return httpServer ? { active: true, url: serverUrl! } : { active: false }
}
