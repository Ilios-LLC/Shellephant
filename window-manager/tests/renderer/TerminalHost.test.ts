import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRecord } from '../../src/renderer/src/types'

const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockOnData = vi.fn()
const mockOnResize = vi.fn()
const mockLoadAddon = vi.fn()
const mockFit = vi.fn()

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = mockOpen
    write = mockWrite
    dispose = mockDispose
    onData = mockOnData
    onResize = mockOnResize
    loadAddon = mockLoadAddon
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = mockFit
  }
  return { FitAddon }
})

const webLinksSentinel = { __kind: 'web-links' }
vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {
    constructor() {
      Object.assign(this, webLinksSentinel)
    }
  }
  return { WebLinksAddon }
})

import TerminalHost from '../../src/renderer/src/components/TerminalHost.svelte'

const mockWindow: WindowRecord = {
  id: 1,
  name: 'host-test',
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('TerminalHost', () => {
  let mockApi: {
    openTerminal: ReturnType<typeof vi.fn>
    sendTerminalInput: ReturnType<typeof vi.fn>
    resizeTerminal: ReturnType<typeof vi.fn>
    closeTerminal: ReturnType<typeof vi.fn>
    onTerminalData: ReturnType<typeof vi.fn>
    offTerminalData: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockApi = {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
    }
    vi.stubGlobal('api', mockApi)
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders window name and first 12 chars of container_id in the header', () => {
    render(TerminalHost, { win: mockWindow })
    expect(screen.getByText('host-test')).toBeDefined()
    expect(screen.getByText('container123')).toBeDefined()
  })

  it('loads fit and web-links addons on mount', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockLoadAddon).toHaveBeenCalledTimes(2)
    })
    const loaded = mockLoadAddon.mock.calls.map(call => call[0])
    const hasFit = loaded.some(a => typeof (a as { fit?: unknown }).fit === 'function')
    const hasWebLinks = loaded.some(a => (a as { __kind?: string }).__kind === 'web-links')
    expect(hasFit).toBe(true)
    expect(hasWebLinks).toBe(true)
  })

  it('calls api.openTerminal with container_id on mount', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith('container123abc')
    })
  })

  it('subscribes to onTerminalData and writes only matching-container chunks', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.onTerminalData).toHaveBeenCalled()
    })
    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, d: string) => void
    callback('container123abc', 'hi')
    expect(mockWrite).toHaveBeenCalledWith('hi')
    mockWrite.mockClear()
    callback('some-other-container', 'nope')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('calls api.offTerminalData and api.closeTerminal on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalled()
    })
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc')
    expect(mockDispose).toHaveBeenCalled()
  })

  it('forwards term.onData to sendTerminalInput', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockOnData).toHaveBeenCalled()
    })
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('ls\n')
    expect(mockApi.sendTerminalInput).toHaveBeenCalledWith('container123abc', 'ls\n')
  })

  it('forwards term.onResize to resizeTerminal', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockOnResize).toHaveBeenCalled()
    })
    const resizeHandler = mockOnResize.mock.calls[0][0] as (d: { cols: number; rows: number }) => void
    resizeHandler({ cols: 120, rows: 40 })
    expect(mockApi.resizeTerminal).toHaveBeenCalledWith('container123abc', 120, 40)
  })
})
