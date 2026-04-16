import { render, cleanup, screen, fireEvent } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockReset = vi.fn()
const mockFocus = vi.fn()
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
    focus = mockFocus
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

import { writable } from 'svelte/store'

const mockPanelLayoutStore = writable({
  panels: [
    { id: 'claude',   visible: true,  width: 50 },
    { id: 'terminal', visible: false, width: 0  },
    { id: 'editor',   visible: true,  width: 50 }
  ]
})
const mockTogglePanel = vi.fn()
const mockResizePanels = vi.fn()
const mockReorderPanels = vi.fn()
const mockSavePanelLayout = vi.fn()

vi.mock('../../src/renderer/src/lib/panelLayout', () => ({
  panelLayout: {
    subscribe: (...args: unknown[]) =>
      mockPanelLayoutStore.subscribe(args[0] as Parameters<typeof mockPanelLayoutStore.subscribe>[0])
  },
  togglePanel: (...args: unknown[]) => mockTogglePanel(...args),
  resizePanels: (...args: unknown[]) => mockResizePanels(...args),
  reorderPanels: (...args: unknown[]) => mockReorderPanels(...args),
  savePanelLayout: () => mockSavePanelLayout()
}))

vi.mock('../../src/renderer/src/components/ResizeHandle.svelte', () => ({
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
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true,  width: 50 },
        { id: 'terminal', visible: false, width: 0  },
        { id: 'editor',   visible: true,  width: 50 }
      ]
    })
    mockTogglePanel.mockReset()
    mockResizePanels.mockReset()
    mockReorderPanels.mockReset()
    mockSavePanelLayout.mockReset()
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

  it('opens terminal session when terminal panel becomes visible in store', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    mockApi.openTerminal.mockClear()

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p =>
        p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p
      )
    }))

    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc', expect.any(Number), expect.any(Number), 'host-test', 'terminal'
      )
    })
  })

  it('does not re-open terminal session on second visibility change', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
    })
    mockApi.openTerminal.mockClear()

    // Hide then re-show terminal
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: false, width: 0 } : p)
    }))
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))

    await new Promise(r => setTimeout(r, 10))
    expect(mockApi.openTerminal).not.toHaveBeenCalled()
  })

  it('focuses terminal after opening so user can type immediately', async () => {
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true, width: 50 },
        { id: 'terminal', visible: true, width: 25 },
        { id: 'editor',   visible: true, width: 25 }
      ]
    })
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
    })
    expect(mockFocus).toHaveBeenCalled()
  })

  it('focuses terminal on reinit after panel re-show without reopening backend', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
    })
    mockApi.openTerminal.mockClear()
    mockFocus.mockClear()

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: false, width: 0 } : p)
    }))
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))

    await new Promise(r => setTimeout(r, 10))
    expect(mockApi.openTerminal).not.toHaveBeenCalled()
    expect(mockFocus).toHaveBeenCalled()
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

    // Make terminal visible to trigger initTerminalSession
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
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
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
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

  it('renders claude panel by default', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="claude"]')).toBeTruthy()
  })

  it('does not render terminal panel when hidden in store', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="terminal"]')).toBeNull()
  })

  it('renders terminal panel when visible in store', async () => {
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true, width: 50 },
        { id: 'terminal', visible: true, width: 25 },
        { id: 'editor',   visible: true, width: 25 }
      ]
    })
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="terminal"]')).toBeTruthy()
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

  it('enables commit button when getGitStatus returns isDirty: true', async () => {
    mockApi.getGitStatus.mockResolvedValue({ isDirty: true, added: 1, deleted: 0 })
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.getGitStatus).toHaveBeenCalled())
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^commit$/i })).not.toBeDisabled()
    })
  })

  it('keeps commit button disabled when getGitStatus returns isDirty: false', async () => {
    mockApi.getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.getGitStatus).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^commit$/i })).toBeDisabled()
  })

  it('keeps commit button enabled when getGitStatus has not resolved yet (unknown state)', async () => {
    // When status is unknown (null), allow commit attempt rather than locking out the user
    mockApi.getGitStatus.mockReturnValue(new Promise(() => {})) // never resolves
    render(TerminalHost, { win: mockWindow, project: mockProject })
    expect(screen.getByRole('button', { name: /^commit$/i })).not.toBeDisabled()
  })
})
