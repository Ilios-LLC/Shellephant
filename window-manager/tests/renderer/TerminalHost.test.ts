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

  it('loads fit and web-links addons on mount', async () => {
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

  it('calls api.openTerminal with container_id, measured size, and win.name on mount', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc',
        expect.any(Number),
        expect.any(Number),
        'host-test'
      )
    })
  })

  it('subscribes to onTerminalData and writes only matching-container chunks', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
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
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalled()
    })
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc')
    expect(mockDispose).toHaveBeenCalled()
  })

  it('forwards term.onData to sendTerminalInput', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockOnData).toHaveBeenCalled()
    })
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('ls\n')
    expect(mockApi.sendTerminalInput).toHaveBeenCalledWith('container123abc', 'ls\n')
  })

  it('forwards term.onResize to resizeTerminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      expect(mockOnResize).toHaveBeenCalled()
    })
    const resizeHandler = mockOnResize.mock.calls[0][0] as (d: {
      cols: number
      rows: number
    }) => void
    resizeHandler({ cols: 120, rows: 40 })
    expect(mockApi.resizeTerminal).toHaveBeenCalledWith('container123abc', 120, 40)
  })

  it('removes from waitingWindows when user types', async () => {
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

  it('renders a content-area div that wraps the terminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // The terminal-body must be inside a content-area
    const body = document.querySelector('.terminal-body')
    expect(body?.closest('.content-area')).not.toBeNull()
  })

  it('passes viewMode and onViewChange to WindowDetailPane (terminal default)', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // Terminal toggle button should be active (aria-pressed true)
    const termBtn = screen.getByRole('button', { name: /terminal/i })
    expect(termBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides terminal-body (adds .hidden) when Editor mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    const editorBtn = screen.getByRole('button', { name: /^editor$/i })
    await fireEvent.click(editorBtn)
    const body = document.querySelector('.terminal-body')
    expect(body?.classList.contains('hidden')).toBe(true)
  })

  it('shows terminal-body when Terminal mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // Switch to editor then back to terminal
    await fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    await fireEvent.click(screen.getByRole('button', { name: /terminal/i }))
    const body = document.querySelector('.terminal-body')
    expect(body?.classList.contains('hidden')).toBe(false)
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

  it('calls offTerminalSummary and removes summary from store on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    unmount()
    expect(mockApi.offTerminalSummary).toHaveBeenCalled()
    expect(mockSummaryRemove).toHaveBeenCalledWith('container123abc')
  })
})
