import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Terminal from '../../src/renderer/src/components/Terminal.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

// Mock xterm Terminal
const mockFit = vi.fn()
const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockOnData = vi.fn()
const mockOnResize = vi.fn()

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = mockOpen
    write = mockWrite
    dispose = mockDispose
    onData = mockOnData
    onResize = mockOnResize
    loadAddon = vi.fn()
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = mockFit
  }
  return { FitAddon }
})

const mockWindow: WindowRecord = {
  id: 1,
  name: 'Test Terminal Window',
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
}

describe('Terminal', () => {
  let mockOnClose: ReturnType<typeof vi.fn>
  let mockApi: {
    openTerminal: ReturnType<typeof vi.fn>
    sendTerminalInput: ReturnType<typeof vi.fn>
    resizeTerminal: ReturnType<typeof vi.fn>
    closeTerminal: ReturnType<typeof vi.fn>
    onTerminalData: ReturnType<typeof vi.fn>
    offTerminalData: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockOnClose = vi.fn()
    mockApi = {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
    }
    vi.stubGlobal('api', mockApi)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders window name in header', () => {
    render(Terminal, { win: mockWindow, onClose: mockOnClose })
    expect(screen.getByText('Test Terminal Window')).toBeDefined()
  })

  it('renders close button with × symbol', () => {
    render(Terminal, { win: mockWindow, onClose: mockOnClose })
    expect(screen.getByRole('button', { name: '×' })).toBeDefined()
  })

  it('calls api.openTerminal with container_id on mount', async () => {
    render(Terminal, { win: mockWindow, onClose: mockOnClose })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith('container123abc')
    })
  })

  it('calls api.onTerminalData on mount', async () => {
    render(Terminal, { win: mockWindow, onClose: mockOnClose })
    await vi.waitFor(() => {
      expect(mockApi.onTerminalData).toHaveBeenCalledWith(expect.any(Function))
    })
  })

  it('calls onClose callback when close button is clicked', async () => {
    render(Terminal, { win: mockWindow, onClose: mockOnClose })
    const closeButton = screen.getByRole('button', { name: '×' })
    await fireEvent.click(closeButton)
    expect(mockOnClose).toHaveBeenCalledOnce()
  })

  it('calls api.offTerminalData and api.closeTerminal on unmount', async () => {
    const { unmount } = render(Terminal, { win: mockWindow, onClose: mockOnClose })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalled()
    })
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc')
  })
})
