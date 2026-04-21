import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockWorkerOn, mockWorkerPostMessage, mockWorkerTerminate, MockWorker } = vi.hoisted(() => {
  const mockWorkerOn = vi.fn()
  const mockWorkerPostMessage = vi.fn()
  const mockWorkerTerminate = vi.fn()
  const instances: Array<{
    on: ReturnType<typeof vi.fn>
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    emit: (event: string, ...args: unknown[]) => void
  }> = []
  function MockWorkerCtor(this: Record<string, unknown>) {
    this.on = mockWorkerOn
    this.postMessage = mockWorkerPostMessage
    this.terminate = mockWorkerTerminate
    const self = this as typeof instances[number]
    self.emit = function (event: string, ...args: unknown[]) {
      mockWorkerOn.mock.calls
        .filter(([e]: [string]) => e === event)
        .forEach(([, handler]: [string, (...a: unknown[]) => void]) => handler(...args))
    }
    instances.push(self)
  }
  const MockWorker = vi.fn().mockImplementation(MockWorkerCtor)
  return { mockWorkerOn, mockWorkerPostMessage, mockWorkerTerminate, MockWorker: Object.assign(MockWorker, { instances }) }
})

vi.mock('worker_threads', () => ({ Worker: MockWorker }))

vi.mock('../../src/main/settingsService', () => ({
  getFireworksKey: vi.fn().mockReturnValue('fw-test-key'),
  getKimiSystemPrompt: vi.fn().mockReturnValue(null)
}))

const { mockDbGet, mockDbAll, mockDbRun } = vi.hoisted(() => ({
  mockDbGet: vi.fn().mockReturnValue(null),
  mockDbAll: vi.fn().mockReturnValue([]),
  mockDbRun: vi.fn()
}))

vi.mock('../../src/main/db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: mockDbAll,
      run: mockDbRun,
      get: mockDbGet
    })
  })
}))

const { mockNotification, mockNotificationShow, mockIsUserWatching, mockGetFocusedWindow } = vi.hoisted(() => ({
  mockNotification: vi.fn(),
  mockNotificationShow: vi.fn(),
  mockIsUserWatching: vi.fn().mockReturnValue(false),
  mockGetFocusedWindow: vi.fn().mockReturnValue({ isDestroyed: () => false })
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => mockGetFocusedWindow(),
    getAllWindows: () => [mockGetFocusedWindow()]
  },
  Notification: vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: unknown) {
    mockNotification(opts)
    this.show = mockNotificationShow
  })
}))

vi.mock('../../src/main/focusState', () => ({
  isUserWatching: (...args: unknown[]) => mockIsUserWatching(...args)
}))

const { mockInsertTurn, mockUpdateTurn, mockGetLogFilePath } = vi.hoisted(() => ({
  mockInsertTurn: vi.fn(),
  mockUpdateTurn: vi.fn(),
  mockGetLogFilePath: vi.fn(() => '/tmp/test-2026-04-20.jsonl')
}))

vi.mock('../../src/main/logWriter', () => ({
  insertTurn: mockInsertTurn,
  updateTurn: mockUpdateTurn,
  getLogFilePath: mockGetLogFilePath
}))

import { sendToWindow, cancelWindow, loadLastSessionId, getWorkerCount, __resetWorkersForTests } from '../../src/main/assistedWindowService'

const mockSendToRenderer = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockIsUserWatching.mockReturnValue(false)
  mockGetFocusedWindow.mockReturnValue({ isDestroyed: () => false })
  mockDbGet.mockReturnValue(null)
  mockDbAll.mockReturnValue([])
  mockGetLogFilePath.mockReturnValue('/tmp/test-2026-04-20.jsonl')
  MockWorker.instances.length = 0
  __resetWorkersForTests()
})

describe('sendToWindow', () => {
  it('spawns a worker for a new window', async () => {
    await sendToWindow(1, 'container-abc', 'hello', null, vi.fn())
    expect(MockWorker).toHaveBeenCalledOnce()
  })

  it('reuses existing worker for same window', async () => {
    await sendToWindow(2, 'container-def', 'msg1', null, vi.fn())
    await sendToWindow(2, 'container-def', 'msg2', null, vi.fn())
    expect(MockWorker).toHaveBeenCalledTimes(1)
  })

  it('sends the resolved default system prompt when no overrides are set', async () => {
    await sendToWindow(20, 'c20', 'hi', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    expect(sendCall).toBeDefined()
    const payload = sendCall![0] as { systemPrompt: string }
    expect(typeof payload.systemPrompt).toBe('string')
    expect(payload.systemPrompt.length).toBeGreaterThan(0)
    expect(payload.systemPrompt).toContain('autonomous coding assistant')
  })

  it('posts send message to worker', async () => {
    await sendToWindow(3, 'c1', 'do something', null, vi.fn())
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', windowId: 3, message: 'do something' })
    )
  })
})

describe('loadLastSessionId', () => {
  it('returns session_id from newest run_claude_code tool_result metadata', () => {
    mockDbAll.mockReturnValueOnce([
      { metadata: JSON.stringify({ session_id: 'sess-xyz', tool_name: 'run_claude_code' }) }
    ])
    expect(loadLastSessionId(42)).toBe('sess-xyz')
  })

  it('skips null-session rows and returns the next valid one', () => {
    mockDbAll.mockReturnValueOnce([
      { metadata: JSON.stringify({ session_id: null, tool_name: 'run_claude_code' }) },
      { metadata: JSON.stringify({ session_id: 'sess-older', tool_name: 'run_claude_code' }) }
    ])
    expect(loadLastSessionId(42)).toBe('sess-older')
  })

  it('returns null when no rows', () => {
    mockDbAll.mockReturnValueOnce([])
    expect(loadLastSessionId(42)).toBeNull()
  })

  it('returns null when no row carries a session_id', () => {
    mockDbAll.mockReturnValueOnce([{ metadata: JSON.stringify({ tool_name: 'run_claude_code' }) }])
    expect(loadLastSessionId(42)).toBeNull()
  })

  it('skips rows with invalid JSON metadata', () => {
    mockDbAll.mockReturnValueOnce([
      { metadata: 'not json' },
      { metadata: JSON.stringify({ session_id: 'sess-ok', tool_name: 'run_claude_code' }) }
    ])
    expect(loadLastSessionId(42)).toBe('sess-ok')
  })

  it('ignores metadata for other tools', () => {
    mockDbAll.mockReturnValueOnce([
      { metadata: JSON.stringify({ session_id: 'sess-ignored', tool_name: 'ping_user' }) }
    ])
    expect(loadLastSessionId(42)).toBeNull()
  })
})

describe('sendToWindow — session continuity', () => {
  it('passes initialSessionId from DB into the worker send payload', async () => {
    // sendToWindow calls .all() twice: first loadHistory, then loadLastSessionId.
    mockDbAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { metadata: JSON.stringify({ session_id: 'sess-resume', tool_name: 'run_claude_code' }) }
      ])
    await sendToWindow(50, 'c50', 'follow up', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    expect((sendCall![0] as { initialSessionId: string | null }).initialSessionId).toBe('sess-resume')
  })

  it('passes null initialSessionId when no prior session', async () => {
    await sendToWindow(51, 'c51', 'first', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    expect((sendCall![0] as { initialSessionId: string | null }).initialSessionId).toBeNull()
  })

  it('maps DB roles into OpenAI-valid history roles', async () => {
    mockDbAll.mockReturnValueOnce([
      { role: 'user', content: 'hi', metadata: null },
      { role: 'shellephant', content: 'hello', metadata: null },
      { role: 'claude-to-shellephant-action', content: '', metadata: JSON.stringify({ summary: 'src/foo.ts', actionType: 'Write' }) },
      { role: 'claude-to-shellephant', content: 'done', metadata: null },
    ])
    await sendToWindow(52, 'c52', 'next', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    const history = (sendCall![0] as { conversationHistory: { role: string; content: string }[] }).conversationHistory
    expect(history.map(h => h.role)).toEqual(['user', 'assistant', 'user'])
    expect(history[2].content).toContain('src/foo.ts')
    expect(history[2].content).toContain('done')
  })

  it('maps shellephant role to assistant in history', async () => {
    mockDbAll.mockReturnValueOnce([
      { role: 'shellephant', content: 'I will help', metadata: null }
    ])
    await sendToWindow(60, 'c60', 'next', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    const history = (sendCall![0] as { conversationHistory: { role: string }[] }).conversationHistory
    expect(history[0].role).toBe('assistant')
  })

  it('collapses claude-action + claude rows into a single user history entry', async () => {
    mockDbAll.mockReturnValueOnce([
      { role: 'claude-action', content: '', metadata: JSON.stringify({ actionType: 'Write', summary: 'src/foo.ts' }) },
      { role: 'claude', content: 'Done writing the file.', metadata: null }
    ])
    await sendToWindow(61, 'c61', 'next', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    const history = (sendCall![0] as { conversationHistory: { role: string; content: string }[] }).conversationHistory
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toContain('src/foo.ts')
    expect(history[0].content).toContain('Done writing the file.')
  })

  it('collapses claude-to-shellephant-action + claude-to-shellephant rows into a single user history entry', async () => {
    mockDbAll.mockReturnValueOnce([
      { role: 'claude-to-shellephant-action', content: '', metadata: JSON.stringify({ actionType: 'Edit', summary: 'src/bar.ts' }) },
      { role: 'claude-to-shellephant', content: 'Edit applied.', metadata: null }
    ])
    await sendToWindow(62, 'c62', 'next', null, vi.fn())
    const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
    const history = (sendCall![0] as { conversationHistory: { role: string; content: string }[] }).conversationHistory
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toContain('src/bar.ts')
    expect(history[0].content).toContain('Edit applied.')
  })

  it('loads session_id from claude role rows', () => {
    mockDbAll.mockReturnValueOnce([
      { metadata: JSON.stringify({ session_id: 'sess-new', complete: true }) }
    ])
    expect(loadLastSessionId(99)).toBe('sess-new')
  })
})

describe('cancelWindow', () => {
  it('terminates the worker and removes from map', async () => {
    await sendToWindow(4, 'container-ghi', 'start', null, vi.fn())
    cancelWindow(4)
    expect(mockWorkerTerminate).toHaveBeenCalledOnce()
    expect(getWorkerCount()).toBe(0)
  })

  it('does nothing if no worker for window', () => {
    expect(() => cancelWindow(999)).not.toThrow()
  })
})


describe('worker message routing', () => {
  it('turn-complete removes worker from map', async () => {
    await sendToWindow(10, 'c10', 'msg', null, vi.fn())
    expect(getWorkerCount()).toBe(1)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 10, stats: null })
    expect(getWorkerCount()).toBe(0)
  })

  it('turn-complete calls sendToRenderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(11, 'c11', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    const stats = { inputTokens: 100, outputTokens: 50, costUsd: 0.001 }
    messageHandler({ type: 'turn-complete', windowId: 11, stats })
    expect(mockSend).toHaveBeenCalledWith('assisted:turn-complete', 11, stats, undefined)
  })

  it('turn-complete with assistantText fires OS notification when user not watching', async () => {
    await sendToWindow(60, 'c60', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 60, stats: null, assistantText: 'done — here are the results' })
    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Shellephant responded',
      body: 'done — here are the results'
    }))
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('turn-complete with empty assistantText does not fire notification', async () => {
    await sendToWindow(61, 'c61', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 61, stats: null, assistantText: '' })
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('turn-complete does not fire notification when user is watching', async () => {
    mockIsUserWatching.mockReturnValue(true)
    await sendToWindow(62, 'c62', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 62, stats: null, assistantText: 'hi' })
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('turn-complete truncates very long assistantText in notification body', async () => {
    await sendToWindow(63, 'c63', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    const long = 'x'.repeat(500)
    messageHandler({ type: 'turn-complete', windowId: 63, stats: null, assistantText: long })
    const call = mockNotification.mock.calls[0]![0] as { body: string }
    expect(call.body.length).toBeLessThanOrEqual(201)
    expect(call.body.endsWith('…')).toBe(true)
  })

  it('worker error removes worker from map and sends turn-complete', async () => {
    const mockSend = vi.fn()
    await sendToWindow(13, 'c13', 'msg', null, mockSend)
    const errorHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'error')?.[1]
    errorHandler(new Error('worker crashed'))
    expect(getWorkerCount()).toBe(0)
    expect(mockSend).toHaveBeenCalledWith('assisted:turn-complete', 13, null, 'worker crashed')
  })

  it('non-zero worker exit removes worker from map', async () => {
    const mockSend = vi.fn()
    await sendToWindow(14, 'c14', 'msg', null, mockSend)
    const exitHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'exit')?.[1]
    exitHandler(1)  // non-zero exit
    expect(getWorkerCount()).toBe(0)
  })
})

describe('worker message routing — new event types', () => {
  it('claude-to-shellephant:event with text_delta kind forwards to renderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(70, 'c70', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'claude-to-shellephant:event', event: { kind: 'text_delta', text: 'hello', ts: 1, blockKey: 'k1' } })
    expect(mockSend).toHaveBeenCalledWith('claude-to-shellephant:delta', 70, 'hello')
  })

  it('claude-to-shellephant:event with tool_use saves action row and sends action to renderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(71, 'c71', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({
      type: 'claude-to-shellephant:event',
      event: { kind: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'src/a.ts' }, summary: 'src/a.ts', ts: 1 }
    })
    expect(mockDbRun).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith('claude-to-shellephant:action', 71, expect.objectContaining({ actionType: 'Write', summary: 'src/a.ts' }))
  })

  it('tool-call forwards as shellephant:to-claude to renderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(75, 'c75', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'tool-call', windowId: 75, toolName: 'run_claude_code', message: 'please check things' })
    expect(mockSend).toHaveBeenCalledWith('shellephant:to-claude', 75, 'please check things')
  })

  it('claude-to-shellephant:turn-complete forwards to renderer without firing notification', async () => {
    const mockSend = vi.fn()
    await sendToWindow(72, 'c72', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'claude-to-shellephant:turn-complete', windowId: 72 })
    expect(mockSend).toHaveBeenCalledWith('claude-to-shellephant:turn-complete', 72)
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('turn-complete notification says Shellephant responded', async () => {
    await sendToWindow(73, 'c73', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 73, stats: null, assistantText: 'done' })
    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shellephant responded' }))
  })
})

describe('turn observability', () => {
  it('passes turnId and logPath in worker postMessage', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const sendCall = MockWorker.instances[0]?.postMessage.mock.calls
      .find((c: [{ type: string }]) => c[0]?.type === 'send')
    expect(sendCall![0].turnId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof sendCall![0].logPath).toBe('string')
  })

  it('calls insertTurn with shellephant-claude type', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    expect(mockInsertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ turn_type: 'shellephant-claude', status: 'running', window_id: 1 })
    )
  })

  it('calls updateTurn with success on turn-complete', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1, stats: null })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'success' })
    )
  })

  it('calls updateTurn with error on worker error', async () => {
    await sendToWindow(1, 'container-1', 'hello', null, mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('error', new Error('worker crashed'))
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'error', error: 'worker crashed' })
    )
  })
})
