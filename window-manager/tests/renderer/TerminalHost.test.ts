import { render, cleanup, screen, fireEvent } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockReset = vi.fn()
const mockOnData = vi.fn()
const mockOnResize = vi.fn()
const mockLoadAddon = vi.fn()
const mockFit = vi.fn()

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = mockOpen
    write = mockWrite
    dispose = mockDispose
    reset = mockReset
    onData = mockOnData
    onResize = mockOnResize
    loadAddon = mockLoadAddon
    cols = 120
    rows = 40
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

const mockWaitingAdd = vi.fn()
const mockWaitingRemove = vi.fn()
vi.mock('../../src/renderer/src/lib/waitingWindows', () => ({
  waitingWindows: {
    subscribe: vi.fn().mockReturnValue(() => {}),
    add: (...args: unknown[]) => mockWaitingAdd(...args),
    remove: (...args: unknown[]) => mockWaitingRemove(...args)
  }
}))

const mockSummarySet = vi.fn()
const mockSummaryRemove = vi.fn()
vi.mock('../../src/renderer/src/lib/conversationSummary', () => ({
  conversationSummary: {
    subscribe: vi.fn((cb: (v: Map<string, unknown>) => void) => {
      cb(new Map())
      return () => {}
    }),
    set: (...args: unknown[]) => mockSummarySet(...args),
    remove: (...args: unknown[]) => mockSummaryRemove(...args)
  }
}))

const mockPushToast = vi.fn()
vi.mock('../../src/renderer/src/lib/toasts', () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args)
}))

vi.mock('../../src/renderer/src/components/EditorPane.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import TerminalHost from '../../src/renderer/src/components/TerminalHost.svelte'

const mockWindow: WindowRecord = {
  id: 1,
  name: 'host-test',
  project_id: 7,
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

const mockProject: ProjectRecord = {
  id: 7,
  name: 'host-project',
  git_url: 'git@github.com:org/host-test.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('TerminalHost', () => {
  let mockApi: {
    openTerminal: ReturnType<typeof vi.fn>
    sendTerminalInput: ReturnType<typeof vi.fn>
    resizeTerminal: ReturnType<typeof vi.fn>
    closeTerminal: ReturnType<typeof vi.fn>
    onTerminalData: ReturnType<typeof vi.fn>
    offTerminalData: ReturnType<typeof vi.fn>
    onTerminalWaiting: ReturnType<typeof vi.fn>
    offTerminalWaiting: ReturnType<typeof vi.fn>
    onTerminalSummary: ReturnType<typeof vi.fn>
    offTerminalSummary: ReturnType<typeof vi.fn>
    getCurrentBranch: ReturnType<typeof vi.fn>
    getGitStatus: ReturnType<typeof vi.fn>
    commit: ReturnType<typeof vi.fn>
    push: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockApi = {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
      onTerminalWaiting: vi.fn(),
      offTerminalWaiting: vi.fn(),
      onTerminalSummary: vi.fn(),
      offTerminalSummary: vi.fn(),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      getGitStatus: vi.fn().mockResolvedValue({ isDirty: false, added: 0, deleted: 0 }),
      commit: vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: '' }),
      push: vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: '' })
    }
    vi.stubGlobal('api', mockApi)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens claude session on mount (default view is claude)', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test',
        'claude'
      )
    })
    expect(mockApi.openTerminal).toHaveBeenCalledTimes(1)
  })

  it('does NOT open terminal session on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    const calls = mockApi.openTerminal.mock.calls as unknown[][]
    const terminalCalls = calls.filter((c) => c[4] === 'terminal')
    expect(terminalCalls).toHaveLength(0)
  })

  it('opens terminal session on first click of Terminal button', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    mockApi.openTerminal.mockClear()

    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))

    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test',
        'terminal'
      )
    })
  })

  it('does not re-open terminal session on subsequent Terminal clicks', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    mockApi.openTerminal.mockClear()

    await fireEvent.click(screen.getByRole('button', { name: /^claude$/i }))
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))

    expect(mockApi.openTerminal).not.toHaveBeenCalled()
  })

  it('routes onTerminalData to claude session when sessionType is claude', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('container123abc', 'claude', 'hello from claude')

    expect(mockWrite).toHaveBeenCalledWith('hello from claude')
  })

  it('routes onTerminalData to terminal session when sessionType is terminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    // Switch to terminal first so term is initialized
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    mockWrite.mockClear()

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('container123abc', 'terminal', 'hello from terminal')

    expect(mockWrite).toHaveBeenCalledWith('hello from terminal')
  })

  it('ignores onTerminalData for a different container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalData).toHaveBeenCalled())

    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, st: string, d: string) => void
    callback('other-container', 'claude', 'ignored')

    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('closes claude session on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc', 'claude')
  })

  it('closes terminal session on unmount if it was opened', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some((c) => c[4] === 'terminal')).toBe(true)
    })
    unmount()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc', 'terminal')
  })

  it('does not close terminal session on unmount if it was never opened', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    const terminalCloseCalls = (mockApi.closeTerminal.mock.calls as unknown[][]).filter(
      (c) => c[1] === 'terminal'
    )
    expect(terminalCloseCalls).toHaveLength(0)
  })

  it('loads fit and web-links addons for claude terminal on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockLoadAddon).toHaveBeenCalledTimes(2)
    })
    const loaded = mockLoadAddon.mock.calls.map((call) => call[0])
    const hasFit = loaded.some((a) => typeof (a as { fit?: unknown }).fit === 'function')
    const hasWebLinks = loaded.some((a) => (a as { __kind?: string }).__kind === 'web-links')
    expect(hasFit).toBe(true)
    expect(hasWebLinks).toBe(true)
  })

  it('Claude toggle button is active (aria-pressed true) by default', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^claude$/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides claude terminal div when Editor mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    await fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    const claudeBody = document.querySelectorAll('.terminal-body')[0]
    expect(claudeBody?.classList.contains('hidden')).toBe(true)
  })

  it('removes from waitingWindows when user types in claude terminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockOnData).toHaveBeenCalled())
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('hello')
    expect(mockWaitingRemove).toHaveBeenCalledWith('container123abc')
  })

  it('removes from waitingWindows on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockWaitingRemove).toHaveBeenCalledWith('container123abc')
  })

  it('registers onTerminalSummary listener on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
  })

  it('calls conversationSummary.set when terminal:summary fires for this container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
    const cb = mockApi.onTerminalSummary.mock.calls[0][0] as (d: {
      containerId: string
      title: string
      bullets: string[]
    }) => void
    cb({ containerId: 'container123abc', title: 'Built X', bullets: ['a', 'b'] })
    expect(mockSummarySet).toHaveBeenCalledWith('container123abc', {
      title: 'Built X',
      bullets: ['a', 'b']
    })
  })

  it('ignores terminal:summary for a different container', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.onTerminalSummary).toHaveBeenCalled())
    const cb = mockApi.onTerminalSummary.mock.calls[0][0] as (d: {
      containerId: string
      title: string
      bullets: string[]
    }) => void
    cb({ containerId: 'other-container', title: 'x', bullets: [] })
    expect(mockSummarySet).not.toHaveBeenCalled()
  })

  it('calls offTerminalSummary and removes summary on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalSummary).toHaveBeenCalled()
    expect(mockSummaryRemove).toHaveBeenCalledWith('container123abc')
  })

  it('calls offTerminalData on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
  })

  it('forwards claude terminal onData to sendTerminalInput with claude sessionType', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockOnData).toHaveBeenCalled())
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('hello')
    expect(mockApi.sendTerminalInput).toHaveBeenCalledWith('container123abc', 'hello', 'claude')
  })

  it('forwards claude terminal onResize to resizeTerminal with claude sessionType', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockOnResize).toHaveBeenCalled())
    const resizeHandler = mockOnResize.mock.calls[0][0] as (size: { cols: number; rows: number }) => void
    resizeHandler({ cols: 100, rows: 30 })
    expect(mockApi.resizeTerminal).toHaveBeenCalledWith('container123abc', 100, 30, 'claude')
  })
})
