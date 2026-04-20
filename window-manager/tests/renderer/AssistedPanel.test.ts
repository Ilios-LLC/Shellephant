import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import AssistedPanel from '../../src/renderer/src/components/AssistedPanel.svelte'

let mockApi: {
  assistedHistory: ReturnType<typeof vi.fn>
  assistedSend: ReturnType<typeof vi.fn>
  assistedCancel: ReturnType<typeof vi.fn>
  onAssistedKimiDelta: ReturnType<typeof vi.fn>
  offAssistedKimiDelta: ReturnType<typeof vi.fn>
  onAssistedTurnComplete: ReturnType<typeof vi.fn>
  offAssistedTurnComplete: ReturnType<typeof vi.fn>
  getFireworksKeyStatus: ReturnType<typeof vi.fn>
  claudeSend: ReturnType<typeof vi.fn>
  claudeCancel: ReturnType<typeof vi.fn>
  onClaudeDelta: ReturnType<typeof vi.fn>
  offClaudeDelta: ReturnType<typeof vi.fn>
  onClaudeAction: ReturnType<typeof vi.fn>
  offClaudeAction: ReturnType<typeof vi.fn>
  onClaudeTurnComplete: ReturnType<typeof vi.fn>
  offClaudeTurnComplete: ReturnType<typeof vi.fn>
  onClaudeError: ReturnType<typeof vi.fn>
  offClaudeError: ReturnType<typeof vi.fn>
  onClaudeToShellephantDelta: ReturnType<typeof vi.fn>
  offClaudeToShellephantDelta: ReturnType<typeof vi.fn>
  onClaudeToShellephantAction: ReturnType<typeof vi.fn>
  offClaudeToShellephantAction: ReturnType<typeof vi.fn>
  onClaudeToShellephantTurnComplete: ReturnType<typeof vi.fn>
  offClaudeToShellephantTurnComplete: ReturnType<typeof vi.fn>
  onShellephantToClaude: ReturnType<typeof vi.fn>
  offShellephantToClaude: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  localStorage.clear()
  mockApi = {
    assistedHistory: vi.fn().mockResolvedValue([]),
    assistedSend: vi.fn().mockResolvedValue(undefined),
    assistedCancel: vi.fn().mockResolvedValue(undefined),
    onAssistedKimiDelta: vi.fn(),
    offAssistedKimiDelta: vi.fn(),
    onAssistedTurnComplete: vi.fn(),
    offAssistedTurnComplete: vi.fn(),
    getFireworksKeyStatus: vi.fn().mockResolvedValue({ configured: true, hint: 'abcd' }),
    claudeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    onClaudeDelta: vi.fn(),
    offClaudeDelta: vi.fn(),
    onClaudeAction: vi.fn(),
    offClaudeAction: vi.fn(),
    onClaudeTurnComplete: vi.fn(),
    offClaudeTurnComplete: vi.fn(),
    onClaudeError: vi.fn(),
    offClaudeError: vi.fn(),
    onClaudeToShellephantDelta: vi.fn(),
    offClaudeToShellephantDelta: vi.fn(),
    onClaudeToShellephantAction: vi.fn(),
    offClaudeToShellephantAction: vi.fn(),
    onClaudeToShellephantTurnComplete: vi.fn(),
    offClaudeToShellephantTurnComplete: vi.fn(),
    onShellephantToClaude: vi.fn(),
    offShellephantToClaude: vi.fn()
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
    expect(screen.getByRole('textbox')).toBeDefined()
    expect(screen.getByRole('button', { name: /send/i })).toBeDefined()
  })

  it('shows cancel button while running', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'go' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })

  it('shows token stats after shellephant turn complete', async () => {
    let turnCompleteCallback: ((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) | null = null
    mockApi.onAssistedTurnComplete.mockImplementation((cb: typeof turnCompleteCallback) => { turnCompleteCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    // Switch to shellephant first so stats are shown
    const shellRadio = screen.getByRole('radio', { name: /Shellephant/i })
    await fireEvent.click(shellRadio)
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'go' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
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

  it('calls off* methods on destroy', async () => {
    const { unmount } = render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    unmount()
    expect(mockApi.offAssistedKimiDelta).toHaveBeenCalled()
    expect(mockApi.offAssistedTurnComplete).toHaveBeenCalled()
    expect(mockApi.offClaudeDelta).toHaveBeenCalled()
    expect(mockApi.offClaudeAction).toHaveBeenCalled()
    expect(mockApi.offClaudeTurnComplete).toHaveBeenCalled()
    expect(mockApi.offClaudeToShellephantDelta).toHaveBeenCalled()
    expect(mockApi.offClaudeToShellephantAction).toHaveBeenCalled()
    expect(mockApi.offClaudeToShellephantTurnComplete).toHaveBeenCalled()
  })

  it('cancel dialog uses correct confirmation text', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'go' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(confirmSpy).toHaveBeenCalledWith('Cancel current run? Conversation will be preserved.')
    confirmSpy.mockRestore()
  })

  it('shows recipient toggle with Claude as default', async () => {
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    const claudeRadio = screen.getByRole('radio', { name: /^Claude$/i })
    expect(claudeRadio).toBeChecked()
  })

  it('restores saved recipient from localStorage on remount', async () => {
    localStorage.setItem('assisted-recipient-1', 'shellephant')
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    expect(screen.getByRole('radio', { name: /Shellephant/i })).toBeChecked()
  })

  it('shows Shellephant radio disabled when Fireworks key not configured', async () => {
    vi.mocked(window.api.getFireworksKeyStatus).mockResolvedValue({ configured: false, hint: '' })
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await vi.waitFor(() => {
      const shellRadio = screen.getByRole('radio', { name: /Shellephant/i })
      expect(shellRadio).toBeDisabled()
    })
  })

  it('renders shellephant message with Shellephant label', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'shellephant', content: 'I can help', metadata: null }
    ])
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await vi.waitFor(() => {
      // sender-tag "Shellephant" appears in message bubble (in addition to radio label)
      expect(screen.getAllByText('Shellephant').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('I can help')).toBeInTheDocument()
    })
  })

  it('renders claude message with Claude label', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'claude', content: 'Here is the result', metadata: null }
    ])
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await vi.waitFor(() => {
      // sender-tag "Claude" appears in message bubble (in addition to radio label)
      expect(screen.getAllByText('Claude').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('Here is the result')).toBeInTheDocument()
    })
  })

  it('renders claude-action as collapsed mini-panel', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'claude-action', content: '', metadata: JSON.stringify({ actionType: 'Write', summary: 'src/foo.ts', detail: '{}' }) }
    ])
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await vi.waitFor(() => {
      expect(screen.getByText(/Write.*src\/foo\.ts/)).toBeInTheDocument()
    })
  })

  it('calls claudeSend when Claude toggle is active', async () => {
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'hello' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await vi.waitFor(() => {
      expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'hello', 'bypassPermissions')
    })
  })

  it('calls assistedSend when Shellephant toggle is active', async () => {
    render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    // Wait for fireworks status to load so radio is enabled
    await vi.waitFor(() => {
      expect(screen.getByRole('radio', { name: /Shellephant/i })).not.toBeDisabled()
    })
    await fireEvent.click(screen.getByRole('radio', { name: /Shellephant/i }))
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'help me' } })
    await fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await vi.waitFor(() => {
      expect(mockApi.assistedSend).toHaveBeenCalledWith(1, 'help me')
    })
  })

  it('streams kimi delta into shellephant message', async () => {
    let kimiCallback: ((wid: number, delta: string) => void) | null = null
    mockApi.onAssistedKimiDelta.mockImplementation((cb: typeof kimiCallback) => { kimiCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    kimiCallback!(1, 'Hello from Shellephant')
    await waitFor(() => {
      // sender-tag "Shellephant" in bubble + radio label
      expect(screen.getAllByText('Shellephant').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('Hello from Shellephant')).toBeDefined()
    })
  })

  it('streams claude delta into claude message', async () => {
    let claudeCallback: ((wid: number, chunk: string) => void) | null = null
    mockApi.onClaudeDelta.mockImplementation((cb: typeof claudeCallback) => { claudeCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    claudeCallback!(1, 'Hello from Claude')
    await waitFor(() => {
      // sender-tag "Claude" in bubble + radio label
      expect(screen.getAllByText('Claude').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('Hello from Claude')).toBeDefined()
    })
  })

  it('renders legacy assistant role as shellephant', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'assistant', content: 'legacy message', metadata: null }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      // sender-tag "Shellephant" in bubble + radio label
      expect(screen.getAllByText('Shellephant').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('legacy message')).toBeDefined()
    })
  })

  it('streams claude-to-shellephant delta into a Claude → Shellephant bubble', async () => {
    let ctsCallback: ((wid: number, chunk: string) => void) | null = null
    mockApi.onClaudeToShellephantDelta.mockImplementation((cb: typeof ctsCallback) => { ctsCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    ctsCallback!(1, 'internal claude reply')
    await waitFor(() => {
      expect(screen.getByText(/Claude.*Shellephant/)).toBeDefined()
      expect(screen.getByText('internal claude reply')).toBeDefined()
    })
  })

  it('renders claude-to-shellephant role from history', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'claude-to-shellephant', content: 'reply for shellephant', metadata: null }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText(/Claude.*Shellephant/)).toBeDefined()
      expect(screen.getByText('reply for shellephant')).toBeDefined()
    })
  })

  it('renders claude-to-shellephant-action as a collapsed mini-panel', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'claude-to-shellephant-action', content: '', metadata: JSON.stringify({ actionType: 'Write', summary: 'src/x.ts', detail: '{}' }) }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText(/Write.*src\/x\.ts/)).toBeDefined()
    })
  })

  it('renders live shellephant-to-claude message via event', async () => {
    let stcCallback: ((wid: number, message: string) => void) | null = null
    mockApi.onShellephantToClaude.mockImplementation((cb: typeof stcCallback) => { stcCallback = cb })
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    stcCallback!(1, 'check status')
    await waitFor(() => {
      expect(screen.getByText(/Shellephant.*Claude/)).toBeDefined()
      expect(screen.getByText('check status')).toBeDefined()
    })
  })

  it('renders legacy tool_call role from history as shellephant-to-claude', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'tool_call', content: 'please investigate', metadata: null }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText(/Shellephant.*Claude/)).toBeDefined()
      expect(screen.getByText('please investigate')).toBeDefined()
    })
  })

  it('renders legacy tool_result role as claude message', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, role: 'tool_result', content: 'tool output', metadata: null }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      // sender-tag "Claude" in bubble + radio label
      expect(screen.getAllByText('Claude').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('tool output')).toBeDefined()
    })
  })

  it('renders Bypass/Plan toggle when recipient is Claude', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    expect(screen.getByRole('radio', { name: /bypass/i })).toBeDefined()
    expect(screen.getByRole('radio', { name: /plan/i })).toBeDefined()
  })

  it('hides Bypass/Plan toggle when recipient is Shellephant', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const shellephantRadio = screen.getByRole('radio', { name: /shellephant/i })
    await fireEvent.click(shellephantRadio)
    expect(screen.queryByRole('radio', { name: /bypass/i })).toBeNull()
    expect(screen.queryByRole('radio', { name: /plan/i })).toBeNull()
  })

  it('calls claudeSend with bypassPermissions by default', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'hello' } })
    await fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'hello', 'bypassPermissions'))
  })

  it('calls claudeSend with plan when Plan mode selected', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const planRadio = screen.getByRole('radio', { name: /plan/i })
    await fireEvent.click(planRadio)
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'do something' } })
    await fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'do something', 'plan'))
  })
})
