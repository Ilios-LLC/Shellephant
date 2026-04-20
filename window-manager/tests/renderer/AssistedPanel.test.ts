import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import AssistedPanel from '../../src/renderer/src/components/AssistedPanel.svelte'

let mockApi: {
  assistedHistory: ReturnType<typeof vi.fn>
  assistedSend: ReturnType<typeof vi.fn>
  assistedCancel: ReturnType<typeof vi.fn>
  assistedResume: ReturnType<typeof vi.fn>
  onAssistedStreamChunk: ReturnType<typeof vi.fn>
  offAssistedStreamChunk: ReturnType<typeof vi.fn>
  onAssistedKimiDelta: ReturnType<typeof vi.fn>
  offAssistedKimiDelta: ReturnType<typeof vi.fn>
  onAssistedPingUser: ReturnType<typeof vi.fn>
  offAssistedPingUser: ReturnType<typeof vi.fn>
  onAssistedTurnComplete: ReturnType<typeof vi.fn>
  offAssistedTurnComplete: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mockApi = {
    assistedHistory: vi.fn().mockResolvedValue([]),
    assistedSend: vi.fn().mockResolvedValue(undefined),
    assistedCancel: vi.fn().mockResolvedValue(undefined),
    assistedResume: vi.fn().mockResolvedValue(undefined),
    onAssistedStreamChunk: vi.fn(),
    offAssistedStreamChunk: vi.fn(),
    onAssistedKimiDelta: vi.fn(),
    offAssistedKimiDelta: vi.fn(),
    onAssistedPingUser: vi.fn(),
    offAssistedPingUser: vi.fn(),
    onAssistedTurnComplete: vi.fn(),
    offAssistedTurnComplete: vi.fn()
  }
  vi.stubGlobal('api', mockApi)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const defaultProps = { windowId: 1, containerId: 'c1' }

describe('AssistedPanel', () => {
  it('renders chat input and send button', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalledWith(1))
    expect(screen.getByPlaceholderText(/ask kimi/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /send/i })).toBeDefined()
  })

  it('sends message on button click', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByPlaceholderText(/ask kimi/i)
    await fireEvent.input(textarea, { target: { value: 'build me a server' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(mockApi.assistedSend).toHaveBeenCalledWith(1, 'build me a server')
  })

  it('shows cancel button while running', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByPlaceholderText(/ask kimi/i)
    await fireEvent.input(textarea, { target: { value: 'go' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })

  it('shows token stats after turn complete', async () => {
    let turnCompleteCallback: ((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) | null = null
    mockApi.onAssistedTurnComplete.mockImplementation((cb: typeof turnCompleteCallback) => { turnCompleteCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    turnCompleteCallback!(1, { inputTokens: 100, outputTokens: 50, costUsd: 0.001 })
    await waitFor(() => {
      expect(screen.getByText(/100/)).toBeDefined()
    })
  })

  it('renders user messages from history', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, window_id: 1, role: 'user', content: 'hello from history', metadata: null, created_at: '' }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText('hello from history')).toBeDefined()
    })
  })

  it('shows ping_user message as alert', async () => {
    let pingCallback: ((wid: number, msg: string) => void) | null = null
    mockApi.onAssistedPingUser.mockImplementation((cb: typeof pingCallback) => { pingCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    pingCallback!(1, 'Which database?')
    await waitFor(() => {
      expect(screen.getByText('Which database?')).toBeDefined()
    })
  })
})
