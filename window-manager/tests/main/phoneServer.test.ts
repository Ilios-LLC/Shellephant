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

  it('returns HTML with Claude and Terminal tab buttons', () => {
    const html = getPhoneServerHtml()
    expect(html).toContain('data-tab="claude"')
    expect(html).toContain('data-tab="terminal"')
  })

  it('returns HTML using explicit /ws/:id/:sessionType routes', () => {
    const html = getPhoneServerHtml()
    expect(html).toContain('/ws/')
    expect(html).toContain('/claude')
    expect(html).toContain('/terminal')
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
  listWindows: vi.fn(),
  getWindowTypeByContainerId: vi.fn()
}))
vi.mock('../../src/main/terminalService', () => ({
  getSession: vi.fn(),
  spawnClaudePty: vi.fn(),
  spawnTerminalPty: vi.fn()
}))

import { listWindows, getWindowTypeByContainerId } from '../../src/main/windowService'
import { getSession, spawnClaudePty, spawnTerminalPty } from '../../src/main/terminalService'

const mockListWindows = vi.mocked(listWindows)
const mockGetWindowTypeByContainerId = vi.mocked(getWindowTypeByContainerId)
const mockGetSession = vi.mocked(getSession)
const mockSpawnClaudePty = vi.mocked(spawnClaudePty)
const mockSpawnTerminalPty = vi.mocked(spawnTerminalPty)

function makeMockPty() {
  const mockDisposable = { dispose: vi.fn() }
  return {
    onData: vi.fn(() => mockDisposable),
    onExit: vi.fn(() => mockDisposable),
    write: vi.fn()
  }
}

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

  it('spawns claude PTY on-demand when no session exists', async () => {
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnClaudePty.mockReturnValue(mockChild as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/unknown`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockSpawnClaudePty).toHaveBeenCalledWith('unknown')
    expect(mockChild.onData).toHaveBeenCalled()
    client.close()
  })

  it('kills spawned PTY when WS closes', async () => {
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnClaudePty.mockReturnValue(mockChild as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-x`)
    await new Promise<void>(resolve => client.on('open', resolve))
    client.close()
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(mockChild.kill).toHaveBeenCalled()
  })

  it('pipes on-demand PTY data to WebSocket', async () => {
    mockGetSession.mockReturnValue(undefined)
    let dataCallback: ((d: string) => void) | null = null
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn((cb: (d: string) => void) => { dataCallback = cb; return mockDisposable }),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnClaudePty.mockReturnValue(mockChild as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-x`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const msgPromise = new Promise<string>(resolve => client.on('message', d => resolve(d.toString())))
    dataCallback!('PTY output')
    expect(await msgPromise).toBe('PTY output')
    client.close()
  })

  it('pipes WS message to on-demand PTY write', async () => {
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnClaudePty.mockReturnValue(mockChild as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-x`)
    await new Promise<void>(resolve => client.on('open', resolve))
    client.send('user typed')
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(mockChild.write).toHaveBeenCalledWith('user typed')
    client.close()
  })

  it('pipes PTY data to WebSocket client', async () => {
    let dataCallback: ((d: string) => void) | null = null
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn((cb: (d: string) => void) => { dataCallback = cb; return mockDisposable }),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const msgPromise = new Promise<string>(resolve => client.on('message', d => resolve(d.toString())))
    dataCallback!('hello from PTY')
    expect(await msgPromise).toBe('hello from PTY')
    client.close()
  })

  it('pipes WebSocket message to PTY write', async () => {
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    client.send('user input')
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(mockPty.write).toHaveBeenCalledWith('user input')
    client.close()
  })

  it('closes WebSocket when PTY exits', async () => {
    let exitCallback: ((e: { exitCode: number; signal?: number }) => void) | null = null
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => { exitCallback = cb; return mockDisposable }),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const closePromise = new Promise<void>(resolve => client.on('close', () => resolve()))
    exitCallback!({ exitCode: 0 })
    await closePromise
  })

  it('multiple connections all receive PTY output', async () => {
    const dataCallbacks: Array<(d: string) => void> = []
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn((cb: (d: string) => void) => { dataCallbacks.push(cb); return mockDisposable }),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const c1 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    const c2 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await Promise.all([
      new Promise<void>(resolve => c1.on('open', resolve)),
      new Promise<void>(resolve => c2.on('open', resolve))
    ])
    const m1 = new Promise<string>(resolve => c1.on('message', d => resolve(d.toString())))
    const m2 = new Promise<string>(resolve => c2.on('message', d => resolve(d.toString())))
    expect(dataCallbacks.length).toBe(2)
    dataCallbacks.forEach(cb => cb('broadcast'))
    expect(await m1).toBe('broadcast')
    expect(await m2).toBe('broadcast')
    c1.close(); c2.close()
  })
})

describe('WebSocket session routing by window_type', () => {
  let port: number

  beforeEach(async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
    const { url } = await startPhoneServer(0, '127.0.0.1')
    port = parseInt(new URL(url).port)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('uses claude session for manual windows', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue('manual' as any)
    mockGetSession.mockReturnValue({ pty: makeMockPty() } as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockGetSession).toHaveBeenCalledWith('container-1', 'claude')
    client.close()
  })

  it('uses terminal session for assisted windows', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue('assisted' as any)
    mockGetSession.mockReturnValue({ pty: makeMockPty() } as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockGetSession).toHaveBeenCalledWith('container-1', 'terminal')
    client.close()
  })

  it('defaults to claude session when container not found in DB', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue(null as any)
    mockGetSession.mockReturnValue({ pty: makeMockPty() } as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockGetSession).toHaveBeenCalledWith('container-1', 'claude')
    client.close()
  })

  it('spawns terminal PTY on-demand for assisted window with no session', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue('assisted' as any)
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnTerminalPty.mockReturnValue(mockChild as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockSpawnTerminalPty).toHaveBeenCalledWith('container-1')
    client.close()
  })
})

describe('WebSocket /ws/:containerId/:sessionType (explicit)', () => {
  let port: number

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
    const { url } = await startPhoneServer(0, '127.0.0.1')
    port = parseInt(new URL(url).port)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('routes /ws/:id/claude to claude session regardless of window type', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue('assisted' as any)
    mockGetSession.mockReturnValue({ pty: makeMockPty() } as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1/claude`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockGetSession).toHaveBeenCalledWith('container-1', 'claude')
    expect(mockGetWindowTypeByContainerId).not.toHaveBeenCalled()
    client.close()
  })

  it('routes /ws/:id/terminal to terminal session regardless of window type', async () => {
    mockGetWindowTypeByContainerId.mockReturnValue('manual' as any)
    mockGetSession.mockReturnValue({ pty: makeMockPty() } as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1/terminal`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockGetSession).toHaveBeenCalledWith('container-1', 'terminal')
    expect(mockGetWindowTypeByContainerId).not.toHaveBeenCalled()
    client.close()
  })

  it('rejects unknown session type in URL', async () => {
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1/badtype`)
    await new Promise<void>(resolve => client.on('close', resolve))
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('explicit /ws/:id/claude spawns claude PTY on-demand when no session', async () => {
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnClaudePty.mockReturnValue(mockChild as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1/claude`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockSpawnClaudePty).toHaveBeenCalledWith('container-1')
    client.close()
  })

  it('explicit /ws/:id/terminal spawns terminal PTY on-demand when no session', async () => {
    mockGetSession.mockReturnValue(undefined)
    const mockDisposable = { dispose: vi.fn() }
    const mockChild = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn(),
      kill: vi.fn()
    }
    mockSpawnTerminalPty.mockReturnValue(mockChild as any)
    const client = new WebSocket(`ws://localhost:${port}/ws/container-1/terminal`)
    await new Promise<void>(resolve => client.on('open', resolve))
    expect(mockSpawnTerminalPty).toHaveBeenCalledWith('container-1')
    client.close()
  })
})
