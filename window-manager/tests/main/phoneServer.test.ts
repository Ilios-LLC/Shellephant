import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPhoneServerHtml } from '../../src/main/phoneServerHtml'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) }
})

describe('getPhoneServerHtml', () => {
  it('returns HTML containing xterm script tag', () => {
    expect(getPhoneServerHtml()).toContain('xterm')
  })

  it('returns HTML containing WebSocket connection code', () => {
    expect(getPhoneServerHtml()).toContain('WebSocket')
  })

  it('returns HTML containing /api/windows fetch', () => {
    expect(getPhoneServerHtml()).toContain('/api/windows')
  })
})

import * as os from 'os'
import WebSocket from 'ws'
import {
  startPhoneServer,
  stopPhoneServer,
  getPhoneServerStatus,
  getTailscaleIp
} from '../../src/main/phoneServer'

vi.mock('../../src/main/windowService', () => ({
  listWindows: vi.fn()
}))
vi.mock('../../src/main/terminalService', () => ({
  spawnClaudePty: vi.fn()
}))
vi.mock('../../src/main/db', () => ({
  getDb: vi.fn(() => ({
    prepare: () => ({ all: () => [] })
  }))
}))

import { listWindows } from '../../src/main/windowService'
import { spawnClaudePty } from '../../src/main/terminalService'

const mockListWindows = vi.mocked(listWindows)
const mockSpawnClaudePty = vi.mocked(spawnClaudePty)

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

  it('getPhoneServerStatus returns active after start', async () => {
    await startPhoneServer(0, '127.0.0.1')
    const status = getPhoneServerStatus()
    expect(status.active).toBe(true)
    expect(status.url).toMatch(/^http:\/\/100\.1\.2\.3/)
  })

  it('getPhoneServerStatus returns inactive after stop', async () => {
    await startPhoneServer(0, '127.0.0.1')
    stopPhoneServer()
    expect(getPhoneServerStatus()).toEqual({ active: false })
  })
})

describe('GET /api/windows', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns JSON from listWindows', async () => {
    const windows = [{ id: 1, name: 'test', status: 'running', container_id: 'abc' }]
    mockListWindows.mockResolvedValue(windows as any)
    const { url } = await startPhoneServer(0, '127.0.0.1')
    const port = new URL(url).port
    const res = await fetch(`http://localhost:${port}/api/windows`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(windows)
  })
})

describe('GET /', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns HTML containing xterm', async () => {
    const { url } = await startPhoneServer(0, '127.0.0.1')
    const port = new URL(url).port
    const res = await fetch(`http://localhost:${port}/`)
    expect(await res.text()).toContain('xterm')
  })
})

describe('WebSocket /ws/:containerId', () => {
  let port: number

  beforeEach(async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
    const { url } = await startPhoneServer(0, '127.0.0.1')
    port = parseInt(new URL(url).port)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  function makePtyMock(): { pty: any; kill: any; onDataCb: { cb: ((d: string) => void) | null }; onExitCb: { cb: ((e: { exitCode: number; signal?: number }) => void) | null } } {
    const onDataCb = { cb: null as ((d: string) => void) | null }
    const onExitCb = { cb: null as ((e: { exitCode: number; signal?: number }) => void) | null }
    const kill = vi.fn()
    const disp = { dispose: vi.fn() }
    const pty = {
      onData: vi.fn((cb: (d: string) => void) => { onDataCb.cb = cb; return disp }),
      onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => { onExitCb.cb = cb; return disp }),
      write: vi.fn(),
      kill
    }
    return { pty, kill, onDataCb, onExitCb }
  }

  it('spawns a dedicated pty per connection and kills on close', async () => {
    const m = makePtyMock()
    mockSpawnClaudePty.mockReturnValue(m.pty as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockSpawnClaudePty).toHaveBeenCalledWith('container-1', 80, 24, undefined, [])
    const closed = new Promise<void>(resolve => client.on('close', () => resolve()))
    client.close()
    await closed
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(m.kill).toHaveBeenCalled()
  })

  it('closes with error when spawn throws', async () => {
    mockSpawnClaudePty.mockImplementation(() => { throw new Error('docker missing') })
    const client = new WebSocket(`ws://localhost:${port}/ws/container-x`)
    const messages: string[] = []
    await new Promise<void>(resolve => {
      client.on('message', d => messages.push(d.toString()))
      client.on('close', () => resolve())
    })
    expect(messages[0]).toContain('docker missing')
  })

  it('pipes PTY data to WebSocket client', async () => {
    const m = makePtyMock()
    mockSpawnClaudePty.mockReturnValue(m.pty as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const msgPromise = new Promise<string>(resolve => client.on('message', d => resolve(d.toString())))
    m.onDataCb.cb!('hello from PTY')
    expect(await msgPromise).toBe('hello from PTY')
    client.close()
  })

  it('pipes WebSocket message to PTY write', async () => {
    const m = makePtyMock()
    mockSpawnClaudePty.mockReturnValue(m.pty as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    client.send('user input')
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(m.pty.write).toHaveBeenCalledWith('user input')
    client.close()
  })

  it('closes WebSocket when PTY exits', async () => {
    const m = makePtyMock()
    mockSpawnClaudePty.mockReturnValue(m.pty as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const closePromise = new Promise<void>(resolve => client.on('close', () => resolve()))
    m.onExitCb.cb!({ exitCode: 0 })
    await closePromise
  })

  it('multiple connections each get their own pty', async () => {
    const ms: ReturnType<typeof makePtyMock>[] = []
    mockSpawnClaudePty.mockImplementation(() => { const m = makePtyMock(); ms.push(m); return m.pty as any })
    const c1 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => c1.on('open', resolve))
    const c2 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => c2.on('open', resolve))
    const m1 = new Promise<string>(resolve => c1.on('message', d => resolve(d.toString())))
    const m2 = new Promise<string>(resolve => c2.on('message', d => resolve(d.toString())))
    expect(ms.length).toBe(2)
    ms[0].onDataCb.cb!('one')
    ms[1].onDataCb.cb!('two')
    expect(await m1).toBe('one')
    expect(await m2).toBe('two')
    c1.close(); c2.close()
  })
})
