import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPhoneServerHtml } from '../../src/main/phoneServerHtml'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) }
})

describe('getPhoneServerHtml', () => {
  it('returns HTML with recipient toggle for claude and shellephant', () => {
    const html = getPhoneServerHtml()
    expect(html).toContain('value="claude"')
    expect(html).toContain('value="shellephant"')
  })

  it('returns HTML referencing the /api/history endpoint', () => {
    expect(getPhoneServerHtml()).toContain('/api/history')
  })

  it('returns HTML referencing the /events/ WS path', () => {
    expect(getPhoneServerHtml()).toContain('/events/')
  })

  it('returns HTML referencing /api/send', () => {
    expect(getPhoneServerHtml()).toContain('/api/send')
  })

  it('returns HTML with permission-mode radios (bypass and plan)', () => {
    const html = getPhoneServerHtml()
    expect(html).toContain('value="bypassPermissions"')
    expect(html).toContain('value="plan"')
  })

  it('does not reference xterm or the old /ws/ route', () => {
    const html = getPhoneServerHtml()
    expect(html).not.toContain('xterm')
    expect(html).not.toMatch(/\/ws\//)
  })
})

import * as os from 'os'
import WebSocket from 'ws'
import {
  startPhoneServer,
  stopPhoneServer,
  getPhoneServerStatus,
  getTailscaleIp,
  __rebindForTests
} from '../../src/main/phoneServer'

vi.mock('../../src/main/windowService', () => ({
  listWindows: vi.fn(),
  getWindowTypeByContainerId: vi.fn()
}))

vi.mock('../../src/main/assistedWindowService', () => ({
  sendToWindow: vi.fn(),
  cancelWindow: vi.fn(),
  getAssistedHistory: vi.fn()
}))

vi.mock('../../src/main/claudeService', () => ({
  sendToClaudeDirectly: vi.fn(),
  cancelClaudeDirect: vi.fn()
}))

vi.mock('../../src/main/settingsService', () => ({
  getFireworksKeyStatus: vi.fn(),
  getPhoneEndpoint: vi.fn(() => null)
}))

vi.mock('../../src/main/db', () => ({
  getDb: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

import { listWindows } from '../../src/main/windowService'
import { sendToWindow, cancelWindow, getAssistedHistory } from '../../src/main/assistedWindowService'
import { sendToClaudeDirectly, cancelClaudeDirect } from '../../src/main/claudeService'
import { getFireworksKeyStatus, getPhoneEndpoint } from '../../src/main/settingsService'
import { getDb } from '../../src/main/db'
import * as eventBroker from '../../src/main/assistedEventBroker'

const mockListWindows = vi.mocked(listWindows)
const mockSendToWindow = vi.mocked(sendToWindow)
const mockCancelWindow = vi.mocked(cancelWindow)
const mockGetAssistedHistory = vi.mocked(getAssistedHistory)
const mockSendToClaudeDirectly = vi.mocked(sendToClaudeDirectly)
const mockCancelClaudeDirect = vi.mocked(cancelClaudeDirect)
const mockGetFireworksKeyStatus = vi.mocked(getFireworksKeyStatus)
const mockGetPhoneEndpoint = vi.mocked(getPhoneEndpoint)
const mockGetDb = vi.mocked(getDb)

const MOCK_IFACES = {
  tailscale0: [{
    family: 'IPv4' as const,
    address: '100.1.2.3',
    internal: false,
    netmask: '255.0.0.0',
    mac: 'aa:bb:cc:dd:ee:ff',
    cidr: '100.1.2.3/8'
  }]
}

function mockDbRow(row: unknown): void {
  mockGetDb.mockReturnValue({
    prepare: () => ({ get: () => row, all: () => [] })
  } as any)
}

describe('getTailscaleIp', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 100.x.x.x address', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    expect(getTailscaleIp()).toBe('100.1.2.3')
  })

  it('returns null when no 100.x.x.x address', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [{ family: 'IPv4' as const, address: '192.168.1.1', internal: false, netmask: '255.255.255.0', mac: 'aa:bb:cc:dd:ee:ff', cidr: '192.168.1.1/24' }]
    } as any)
    expect(getTailscaleIp()).toBeNull()
  })
})

describe('phoneServer lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('starts and returns url with tailscale ip', async () => {
    const result = await startPhoneServer(0, '127.0.0.1')
    expect(result.url).toMatch(/^http:\/\/100\.1\.2\.3:\d+$/)
  })

  it('returns same url if already running', async () => {
    const first = await startPhoneServer(0, '127.0.0.1')
    const second = await startPhoneServer(0, '127.0.0.1')
    expect(first.url).toBe(second.url)
  })

  it('throws when no tailscale ip', async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({} as any)
    await expect(startPhoneServer(0)).rejects.toThrow('Tailscale IP not found')
  })

  it('status is active after start', async () => {
    await startPhoneServer(0, '127.0.0.1')
    expect(getPhoneServerStatus().active).toBe(true)
  })

  it('status is inactive after stop', async () => {
    await startPhoneServer(0, '127.0.0.1')
    stopPhoneServer()
    expect(getPhoneServerStatus()).toEqual({ active: false })
  })
})

async function bootServer(): Promise<number> {
  vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
  const { url } = await startPhoneServer(0, '127.0.0.1')
  return Number(new URL(url).port)
}

describe('GET /api/windows', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns JSON from listWindows', async () => {
    const windows = [{ id: 1, name: 'test', status: 'running', container_id: 'abc' }]
    mockListWindows.mockResolvedValue(windows as any)
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/windows`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(windows)
  })
})

describe('GET /api/history', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns history for windowId', async () => {
    mockGetAssistedHistory.mockReturnValue({
      messages: [{ id: 1, role: 'user', content: 'hi', metadata: null }],
      orphanedTurns: []
    })
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/history?windowId=5`)
    expect(mockGetAssistedHistory).toHaveBeenCalledWith(5)
    expect(await res.json()).toEqual({
      messages: [{ id: 1, role: 'user', content: 'hi', metadata: null }],
      orphanedTurns: []
    })
  })

  it('400 when windowId missing', async () => {
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/history`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/fireworks-status', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns configured status', async () => {
    mockGetFireworksKeyStatus.mockReturnValue({ configured: true })
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/fireworks-status`)
    expect(await res.json()).toEqual({ configured: true })
  })
})

describe('POST /api/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbRow({ container_id: 'abc', project_id: 7 })
    mockSendToWindow.mockResolvedValue(undefined)
    mockSendToClaudeDirectly.mockResolvedValue(undefined)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('routes recipient=claude to sendToClaudeDirectly', async () => {
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3, message: 'hi', recipient: 'claude', permissionMode: 'bypassPermissions' })
    })
    expect(res.status).toBe(200)
    expect(mockSendToClaudeDirectly).toHaveBeenCalledWith(3, 'abc', 'hi', expect.any(Function), 'bypassPermissions')
    expect(mockSendToWindow).not.toHaveBeenCalled()
  })

  it('routes recipient=shellephant to sendToWindow', async () => {
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3, message: 'hi', recipient: 'shellephant' })
    })
    expect(res.status).toBe(200)
    expect(mockSendToWindow).toHaveBeenCalledWith(3, 'abc', 'hi', 7, expect.any(Function))
    expect(mockSendToClaudeDirectly).not.toHaveBeenCalled()
  })

  it('400 when body fields missing', async () => {
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3 })
    })
    expect(res.status).toBe(400)
  })

  it('404 when window not found', async () => {
    mockDbRow(undefined)
    const port = await bootServer()
    const res = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 99, message: 'x', recipient: 'claude' })
    })
    expect(res.status).toBe(404)
  })

  it('phone-originated send broadcasts events to broker', async () => {
    mockSendToClaudeDirectly.mockImplementation(async (_wid, _cid, _msg, sendToRenderer) => {
      sendToRenderer('claude:delta', 3, 'hello')
    })
    const received: Array<[string, unknown[]]> = []
    const off = eventBroker.subscribe(3, (channel, args) => received.push([channel, args]))
    const port = await bootServer()
    await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3, message: 'hi', recipient: 'claude' })
    })
    off()
    expect(received).toEqual([['claude:delta', [3, 'hello']]])
  })
})

describe('POST /api/cancel', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('routes recipient=claude to cancelClaudeDirect', async () => {
    const port = await bootServer()
    await fetch(`http://localhost:${port}/api/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3, recipient: 'claude' })
    })
    expect(mockCancelClaudeDirect).toHaveBeenCalledWith(3)
  })

  it('routes recipient=shellephant to cancelWindow', async () => {
    const port = await bootServer()
    await fetch(`http://localhost:${port}/api/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: 3, recipient: 'shellephant' })
    })
    expect(mockCancelWindow).toHaveBeenCalledWith(3)
  })
})

describe('phone endpoint override', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockGetPhoneEndpoint.mockReturnValue(null)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('startPhoneServer uses detected IP when no override', async () => {
    const { url } = await startPhoneServer(0, '127.0.0.1')
    expect(url).toMatch(/^http:\/\/100\.1\.2\.3:\d+$/)
  })

  it('startPhoneServer uses hostname override when set', async () => {
    mockGetPhoneEndpoint.mockReturnValue('host.tailnet.ts.net')
    const { url } = await startPhoneServer(0, '127.0.0.1')
    expect(url).toMatch(/^http:\/\/host\.tailnet\.ts\.net:\d+$/)
  })

  it('startPhoneServer honors override with explicit scheme verbatim', async () => {
    mockGetPhoneEndpoint.mockReturnValue('https://host.tailnet.ts.net')
    const { url } = await startPhoneServer(0, '127.0.0.1')
    expect(url).toBe('https://host.tailnet.ts.net')
  })

  it('getPhoneServerStatus reflects override changed after start', async () => {
    await startPhoneServer(0, '127.0.0.1')
    mockGetPhoneEndpoint.mockReturnValue('host.tailnet.ts.net')
    expect(getPhoneServerStatus().url).toMatch(/^http:\/\/host\.tailnet\.ts\.net:\d+$/)
  })
})

describe('rebindIfIpChanged', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('is a no-op when bound host still matches', async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    const { url } = await startPhoneServer(0, '127.0.0.1')
    await __rebindForTests()
    expect(getPhoneServerStatus()).toEqual({ active: true, url })
  })
})

describe('WebSocket /events/:windowId', () => {
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('delivers broker-published events as JSON frames', async () => {
    eventBroker.__resetForTests()
    const port = await bootServer()
    const ws = new WebSocket(`ws://localhost:${port}/events/42`)
    await new Promise<void>(resolve => ws.on('open', () => resolve()))
    const received = new Promise<string>(resolve => ws.on('message', d => resolve(d.toString())))
    eventBroker.publish(42, 'claude:delta', [42, 'hi'])
    expect(JSON.parse(await received)).toEqual({ channel: 'claude:delta', args: [42, 'hi'] })
    ws.close()
  })

  it('rejects non-matching paths', async () => {
    const port = await bootServer()
    const ws = new WebSocket(`ws://localhost:${port}/events/not-a-number`)
    await new Promise<void>(resolve => ws.on('close', () => resolve()))
    expect(true).toBe(true)
  })
})
