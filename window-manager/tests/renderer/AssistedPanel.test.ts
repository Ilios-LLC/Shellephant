import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import AssistedPanel from '../../src/renderer/src/components/AssistedPanel.svelte'

let mockApi: {
  assistedHistory: ReturnType<typeof vi.fn>
  assistedSend: ReturnType<typeof vi.fn>
  assistedCancel: ReturnType<typeof vi.fn>
  assistedResume: ReturnType<typeof vi.fn>
  onAssistedStreamEvent: ReturnType<typeof vi.fn>
  offAssistedStreamEvent: ReturnType<typeof vi.fn>
  onAssistedKimiDelta: ReturnType<typeof vi.fn>
  offAssistedKimiDelta: ReturnType<typeof vi.fn>
  onAssistedPingUser: ReturnType<typeof vi.fn>
  offAssistedPingUser: ReturnType<typeof vi.fn>
  onAssistedToolCall: ReturnType<typeof vi.fn>
  offAssistedToolCall: ReturnType<typeof vi.fn>
  onAssistedTurnComplete: ReturnType<typeof vi.fn>
  offAssistedTurnComplete: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mockApi = {
    assistedHistory: vi.fn().mockResolvedValue([]),
    assistedSend: vi.fn().mockResolvedValue(undefined),
    assistedCancel: vi.fn().mockResolvedValue(undefined),
    assistedResume: vi.fn().mockResolvedValue(undefined),
    onAssistedStreamEvent: vi.fn(),
    offAssistedStreamEvent: vi.fn(),
    onAssistedKimiDelta: vi.fn(),
    offAssistedKimiDelta: vi.fn(),
    onAssistedPingUser: vi.fn(),
    offAssistedPingUser: vi.fn(),
    onAssistedToolCall: vi.fn(),
    offAssistedToolCall: vi.fn(),
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

  it('streams typed timeline events into a tool_result timeline', async () => {
    let eventCallback: ((wid: number, event: unknown) => void) | null = null
    mockApi.onAssistedStreamEvent.mockImplementation((cb: typeof eventCallback) => { eventCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

    eventCallback!(1, { kind: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'TODO' }, summary: 'TODO', ts: 2 })
    eventCallback!(1, { kind: 'assistant_text', text: 'All done.', ts: 3 })

    await waitFor(() => {
      expect(screen.getByText(/Grep/)).toBeDefined()
      expect(screen.getByText(/All done\./)).toBeDefined()
    })
  })

  it('drops session_init and successful hook events from live stream', async () => {
    let eventCallback: ((wid: number, event: unknown) => void) | null = null
    mockApi.onAssistedStreamEvent.mockImplementation((cb: typeof eventCallback) => { eventCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

    eventCallback!(1, { kind: 'session_init', model: 'claude-sonnet-4-6', sessionId: 'abc', ts: 1 })
    eventCallback!(1, { kind: 'hook', name: 'SessionStart', status: 'ok', ts: 2 })
    eventCallback!(1, { kind: 'assistant_text', text: 'signal', ts: 3 })

    await waitFor(() => expect(screen.getByText('signal')).toBeDefined())
    expect(screen.queryByText(/claude-sonnet-4-6/)).toBeNull()
    expect(screen.queryByText(/SessionStart/)).toBeNull()
  })

  it('dedupes successful result that mirrors the preceding assistant_text', async () => {
    let eventCallback: ((wid: number, event: unknown) => void) | null = null
    mockApi.onAssistedStreamEvent.mockImplementation((cb: typeof eventCallback) => { eventCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

    eventCallback!(1, { kind: 'assistant_text', text: 'the answer', ts: 1 })
    eventCallback!(1, { kind: 'result', text: 'the answer', isError: false, ts: 2 })

    await waitFor(() => expect(screen.getAllByText('the answer')).toHaveLength(1))
  })

  it('keeps failed result even when text matches prior assistant_text', async () => {
    let eventCallback: ((wid: number, event: unknown) => void) | null = null
    mockApi.onAssistedStreamEvent.mockImplementation((cb: typeof eventCallback) => { eventCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())

    eventCallback!(1, { kind: 'assistant_text', text: 'boom', ts: 1 })
    eventCallback!(1, { kind: 'result', text: 'boom', isError: true, ts: 2 })

    await waitFor(() => expect(screen.getAllByText('boom').length).toBeGreaterThanOrEqual(2))
  })

  it('hydrates timeline from history row with schemaVersion metadata', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      {
        id: 10,
        window_id: 1,
        role: 'tool_result',
        content: 'compact context',
        metadata: JSON.stringify({
          schemaVersion: 1,
          tool_name: 'run_claude_code',
          events: [
            { kind: 'assistant_text', text: 'persisted hello', ts: 5 },
            { kind: 'result', text: 'persisted final', isError: false, ts: 6 }
          ]
        }),
        created_at: ''
      }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText('persisted hello')).toBeDefined()
      expect(screen.getByText('persisted final')).toBeDefined()
    })
  })

  it('legacy tool_result without schemaVersion falls back to collapsed <pre>', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 11, window_id: 1, role: 'tool_result', content: 'legacy raw json blob', metadata: null, created_at: '' }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /claude code output/i })).toBeDefined()
    })
    expect(screen.queryByText('legacy raw json blob')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: /claude code output/i }))
    await waitFor(() => {
      expect(screen.getByText('legacy raw json blob')).toBeDefined()
    })
  })

  it('calls off* methods on destroy', async () => {
    const { unmount } = render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    unmount()
    expect(mockApi.offAssistedStreamEvent).toHaveBeenCalled()
    expect(mockApi.offAssistedKimiDelta).toHaveBeenCalled()
    expect(mockApi.offAssistedPingUser).toHaveBeenCalled()
    expect(mockApi.offAssistedTurnComplete).toHaveBeenCalled()
  })

  it('cancel dialog uses correct confirmation text', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByPlaceholderText(/ask kimi/i)
    await fireEvent.input(textarea, { target: { value: 'go' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(confirmSpy).toHaveBeenCalledWith('Cancel current run? Conversation will be preserved.')
    confirmSpy.mockRestore()
  })
})
