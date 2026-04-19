import http from 'http'
import { networkInterfaces } from 'os'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import type { IPty } from 'node-pty'
import { listWindows } from './windowService'
import { spawnClaudePty } from './terminalService'
import { getDb } from './db'
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

function lookupClonePaths(containerId: string): string[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT wp.clone_path FROM windows w
         JOIN window_projects wp ON wp.window_id = w.id
         WHERE w.container_id = ? AND w.deleted_at IS NULL
         ORDER BY wp.id`
      )
      .all(containerId) as { clone_path: string }[]
    return rows.map(r => r.clone_path)
  } catch {
    return []
  }
}

function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const match = req.url?.match(/^\/ws\/([^/]+)$/)
  if (!match) { ws.close(); return }
  const containerId = match[1]
  const clonePaths = lookupClonePaths(containerId)
  const workDir = clonePaths.length === 1 ? clonePaths[0] : (clonePaths.length > 1 ? '/workspace' : undefined)

  let ptyProc: IPty
  try {
    ptyProc = spawnClaudePty(containerId, 80, 24, workDir, clonePaths)
  } catch (e) {
    ws.send(`ERROR: Failed to start claude session: ${e instanceof Error ? e.message : 'unknown'}`)
    ws.close()
    return
  }

  const onData = ptyProc.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
  const onExit = ptyProc.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(`\r\n[process exited: ${exitCode}]\r\n`)
    ws.close()
  })
  ws.on('message', msg => ptyProc.write(msg.toString()))
  ws.on('close', () => {
    onData.dispose()
    onExit.dispose()
    try { ptyProc.kill() } catch { /* already dead */ }
  })
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
