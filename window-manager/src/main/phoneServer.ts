import http from 'http'
import { networkInterfaces } from 'os'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { BrowserWindow } from 'electron'
import { listWindows, createWindow } from './windowService'
import { listProjects } from './projectService'
import { getPhoneServerHtml } from './phoneServerHtml'
import { sendToWindow, cancelWindow, getAssistedHistory } from './assistedWindowService'
import { sendToClaudeDirectly, cancelClaudeDirect } from './claudeService'
import { getFireworksKeyStatus, getPhoneEndpoint } from './settingsService'
import { getDb } from './db'
import * as eventBroker from './assistedEventBroker'
import type { PermissionMode } from '../shared/permissionMode'

const DEFAULT_PORT = 8765
const REBIND_CHECK_MS = 30_000

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let currentIp: string | null = null
let currentActualPort: number | null = null
let currentPort: number | null = null
let currentBindHostOverride: string | null = null
let active = false
let rebindTimer: NodeJS.Timeout | null = null

function formatUrl(ip: string, port: number): string {
  const override = getPhoneEndpoint()
  if (!override) return `http://${ip}:${port}`
  if (/^https?:\/\//i.test(override)) return override
  return `http://${override}:${port}`
}

export function getTailscaleIp(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const addr of ifaces ?? []) {
      if (addr.family === 'IPv4' && addr.address.startsWith('100.')) return addr.address
    }
  }
  return null
}

function broadcastToRenderers(channel: string, args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function phoneSendToRenderer(windowId: number): (channel: string, ...args: unknown[]) => void {
  return (channel, ...args) => {
    broadcastToRenderers(channel, args)
    eventBroker.publish(windowId, channel, args)
  }
}

function getWindowContainer(windowId: number): { container_id: string; project_id: number | null } | null {
  const row = getDb()
    .prepare('SELECT container_id, project_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(windowId) as { container_id: string; project_id: number | null } | undefined
  return row ?? null
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw || '{}') as T
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleApiSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJsonBody<{
    windowId: number
    message: string
    recipient: 'claude' | 'shellephant'
    permissionMode?: PermissionMode
  }>(req)
  if (!body.windowId || !body.message || !body.recipient) {
    writeJson(res, 400, { error: 'windowId, message, recipient required' })
    return
  }
  const ctx = getWindowContainer(body.windowId)
  if (!ctx) { writeJson(res, 404, { error: 'window not found' }); return }
  const sendToRenderer = phoneSendToRenderer(body.windowId)
  try {
    if (body.recipient === 'claude') {
      await sendToClaudeDirectly(body.windowId, ctx.container_id, body.message, sendToRenderer, body.permissionMode)
    } else {
      await sendToWindow(body.windowId, ctx.container_id, body.message, ctx.project_id, sendToRenderer)
    }
    writeJson(res, 200, { ok: true })
  } catch (err) {
    writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleApiCreateWindow(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJsonBody<{ name: string; projectId: number }>(req)
  if (!body.name || !body.projectId) {
    writeJson(res, 400, { error: 'name and projectId required' })
    return
  }
  try {
    const win = await createWindow(body.name, [body.projectId])
    writeJson(res, 200, win)
  } catch (err) {
    writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleApiCancel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJsonBody<{ windowId: number; recipient: 'claude' | 'shellephant' }>(req)
  if (!body.windowId || !body.recipient) {
    writeJson(res, 400, { error: 'windowId, recipient required' })
    return
  }
  if (body.recipient === 'claude') cancelClaudeDirect(body.windowId)
  else cancelWindow(body.windowId)
  writeJson(res, 200, { ok: true })
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname

  if (path === '/api/windows') {
    writeJson(res, 200, await listWindows())
    return
  }

  if (path === '/api/projects') {
    writeJson(res, 200, listProjects().map(p => ({ id: p.id, name: p.name })))
    return
  }

  if (path === '/api/create-window' && req.method === 'POST') {
    await handleApiCreateWindow(req, res)
    return
  }

  if (path === '/api/history') {
    const windowId = Number(url.searchParams.get('windowId'))
    if (!windowId) { writeJson(res, 400, { error: 'windowId required' }); return }
    writeJson(res, 200, getAssistedHistory(windowId))
    return
  }

  if (path === '/api/fireworks-status') {
    writeJson(res, 200, getFireworksKeyStatus())
    return
  }

  if (path === '/api/send' && req.method === 'POST') {
    await handleApiSend(req, res)
    return
  }

  if (path === '/api/cancel' && req.method === 'POST') {
    await handleApiCancel(req, res)
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(getPhoneServerHtml())
}

function handleEventsWs(ws: WebSocket, windowId: number): void {
  const unsubscribe = eventBroker.subscribe(windowId, (channel, args) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ channel, args }))
  })
  ws.on('close', unsubscribe)
  ws.on('error', unsubscribe)
}

function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const match = req.url?.match(/^\/events\/(\d+)$/)
  if (!match) { ws.close(); return }
  handleEventsWs(ws, Number(match[1]))
}

async function createAndListen(
  port: number,
  host: string
): Promise<{ server: http.Server; wsServer: WebSocketServer; actualPort: number }> {
  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res).catch(() => {
      if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error') }
    })
  })
  const wsServer = new WebSocketServer({ server })
  wsServer.on('connection', handleWsConnection)
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, resolve)
    server.once('error', reject)
  })
  return { server, wsServer, actualPort: (server.address() as AddressInfo).port }
}

function teardownListener(): void {
  wss?.clients.forEach(c => c.close())
  wss?.close()
  httpServer?.close()
  httpServer = null
  wss = null
}

async function rebindIfIpChanged(): Promise<void> {
  if (!active || !httpServer || currentPort === null) return
  const ip = getTailscaleIp()
  if (!ip) return
  const host = currentBindHostOverride ?? ip
  const boundHost = (httpServer.address() as AddressInfo | null)?.address
  if (!boundHost || boundHost === host) return
  teardownListener()
  if (!active) return
  try {
    const { server, wsServer, actualPort } = await createAndListen(currentPort, host)
    if (!active) {
      wsServer.close()
      server.close()
      return
    }
    httpServer = server
    wss = wsServer
    currentIp = ip
    currentActualPort = actualPort
    console.log(`[phoneServer] rebound to ${formatUrl(ip, actualPort)} after Tailscale IP change`)
  } catch (err) {
    console.error('[phoneServer] rebind failed:', err)
    currentIp = null
    currentActualPort = null
  }
}

export async function startPhoneServer(port = DEFAULT_PORT, bindHost?: string): Promise<{ url: string }> {
  if (httpServer) return { url: formatUrl(currentIp!, currentActualPort!) }
  const ip = getTailscaleIp()
  if (!ip) throw new Error('Tailscale IP not found (expected 100.x.x.x)')
  const host = bindHost ?? ip
  const { server, wsServer, actualPort } = await createAndListen(port, host)
  httpServer = server
  wss = wsServer
  currentPort = port
  currentBindHostOverride = bindHost ?? null
  currentIp = ip
  currentActualPort = actualPort
  active = true
  if (!bindHost) {
    rebindTimer = setInterval(() => { void rebindIfIpChanged() }, REBIND_CHECK_MS)
  }
  return { url: formatUrl(ip, actualPort) }
}

export function stopPhoneServer(): void {
  active = false
  if (rebindTimer) { clearInterval(rebindTimer); rebindTimer = null }
  teardownListener()
  currentIp = null
  currentActualPort = null
  currentPort = null
  currentBindHostOverride = null
}

export async function __rebindForTests(): Promise<void> {
  await rebindIfIpChanged()
}

export function getPhoneServerStatus(): { active: boolean; url?: string } {
  if (!httpServer || !currentIp || currentActualPort === null) return { active: false }
  return { active: true, url: formatUrl(currentIp, currentActualPort) }
}
