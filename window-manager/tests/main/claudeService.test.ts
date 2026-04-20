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

const { mockDbGet, mockDbAll, mockDbRun } = vi.hoisted(() => ({
  mockDbGet: vi.fn().mockReturnValue(null),
  mockDbAll: vi.fn().mockReturnValue([]),
  mockDbRun: vi.fn()
}))

vi.mock('../../src/main/db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: mockDbAll, run: mockDbRun, get: mockDbGet })
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
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: vi.fn() } }]
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

import { sendToClaudeDirectly, cancelClaudeDirect, getDirectWorkerCount, __resetDirectWorkersForTests } from '../../src/main/claudeService'

beforeEach(() => {
  vi.clearAllMocks()
  mockDbAll.mockReturnValue([])
  mockIsUserWatching.mockReturnValue(false)
  mockGetFocusedWindow.mockReturnValue({ isDestroyed: () => false })
  mockGetLogFilePath.mockReturnValue('/tmp/test-2026-04-20.jsonl')
  MockWorker.instances.length = 0
  __resetDirectWorkersForTests()
})

describe('sendToClaudeDirectly', () => {
  it('spawns a worker for new window', async () => {
    await sendToClaudeDirectly(1, 'c1', 'hi', vi.fn())
    expect(MockWorker).toHaveBeenCalledOnce()
  })

  it('reuses existing worker for same window', async () => {
    await sendToClaudeDirectly(2, 'c2', 'msg1', vi.fn())
    await sendToClaudeDirectly(2, 'c2', 'msg2', vi.fn())
    expect(MockWorker).toHaveBeenCalledTimes(1)
  })

  it('saves user message to DB before spawning worker', async () => {
    await sendToClaudeDirectly(3, 'c3', 'hello', vi.fn())
    expect(mockDbRun).toHaveBeenCalledWith(3, 'user', 'hello', null)
  })

  it('posts send message to worker', async () => {
    await sendToClaudeDirectly(4, 'c4', 'do it', vi.fn())
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', windowId: 4, message: 'do it' })
    )
  })

  it('posts permissionMode in worker send message', async () => {
    await sendToClaudeDirectly(5, 'c5', 'do it', vi.fn(), 'plan')
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', permissionMode: 'plan' })
    )
  })

  it('defaults permissionMode to bypassPermissions', async () => {
    await sendToClaudeDirectly(6, 'c6', 'do it', vi.fn())
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', permissionMode: 'bypassPermissions' })
    )
  })
})

describe('worker message routing', () => {
  it('claude:event text_delta forwards as claude:delta', async () => {
    const mockSend = vi.fn()
    await sendToClaudeDirectly(10, 'c10', 'msg', mockSend)
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'claude:event', event: { kind: 'text_delta', text: 'chunk', ts: 1, blockKey: 'k' } })
    expect(mockSend).toHaveBeenCalledWith('claude:delta', 10, 'chunk')
  })

  it('turn-complete forwards claude:turn-complete and removes worker', async () => {
    const mockSend = vi.fn()
    await sendToClaudeDirectly(11, 'c11', 'msg', mockSend)
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'turn-complete', windowId: 11 })
    expect(mockSend).toHaveBeenCalledWith('claude:turn-complete', 11)
    expect(getDirectWorkerCount()).toBe(0)
  })

  it('save-message for claude role persists to DB', async () => {
    await sendToClaudeDirectly(12, 'c12', 'msg', vi.fn())
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'save-message', role: 'claude', content: 'result', metadata: null })
    expect(mockDbRun).toHaveBeenCalledWith(12, 'claude', 'result', null)
  })
})

describe('direct Claude notifications', () => {
  it('fires Notification on turn-complete with assistantText when user not watching', async () => {
    await sendToClaudeDirectly(30, 'c30', 'msg', vi.fn())
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'turn-complete', windowId: 30, assistantText: 'Done — here are the results.' })
    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Claude responded',
      body: 'Done — here are the results.'
    }))
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('does not fire Notification when assistantText empty', async () => {
    await sendToClaudeDirectly(31, 'c31', 'msg', vi.fn())
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'turn-complete', windowId: 31, assistantText: '' })
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('does not fire Notification when user is watching', async () => {
    mockIsUserWatching.mockReturnValue(true)
    await sendToClaudeDirectly(32, 'c32', 'msg', vi.fn())
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    handler({ type: 'turn-complete', windowId: 32, assistantText: 'hi' })
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('truncates long assistantText in body', async () => {
    await sendToClaudeDirectly(33, 'c33', 'msg', vi.fn())
    const handler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    const long = 'x'.repeat(500)
    handler({ type: 'turn-complete', windowId: 33, assistantText: long })
    const call = mockNotification.mock.calls[0]![0] as { body: string }
    expect(call.body.length).toBeLessThanOrEqual(201)
    expect(call.body.endsWith('…')).toBe(true)
  })
})

describe('cancelClaudeDirect', () => {
  it('terminates worker', async () => {
    await sendToClaudeDirectly(20, 'c20', 'msg', vi.fn())
    cancelClaudeDirect(20)
    expect(mockWorkerTerminate).toHaveBeenCalledOnce()
    expect(getDirectWorkerCount()).toBe(0)
  })
})

describe('turn observability', () => {
  let mockSendToRenderer: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSendToRenderer = vi.fn()
  })

  it('generates turnId and passes it in worker postMessage', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)

    const postCalls = MockWorker.instances[0]?.postMessage.mock.calls ?? []
    const sendCall = postCalls.find((c: [{ type: string }]) => c[0]?.type === 'send')
    expect(sendCall).toBeDefined()
    expect(typeof sendCall![0].turnId).toBe('string')
    expect(sendCall![0].turnId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof sendCall![0].logPath).toBe('string')
  })

  it('calls insertTurn when turn starts', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    expect(mockInsertTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_type: 'human-claude',
        status: 'running',
        window_id: 1
      })
    )
  })

  it('calls updateTurn with success when turn-complete received without error', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1 })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'success' })
    )
  })

  it('calls updateTurn with error when turn-complete has error field', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1, error: 'docker failed' })
    expect(mockUpdateTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'error', error: 'docker failed' })
    )
  })

  it('sends logs:turn-started to renderer', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    expect(mockSendToRenderer).toHaveBeenCalledWith(
      'logs:turn-started',
      expect.objectContaining({ turn_type: 'human-claude', window_id: 1 })
    )
  })

  it('sends logs:turn-updated to renderer on completion', async () => {
    await sendToClaudeDirectly(1, 'container-1', 'hello', mockSendToRenderer)
    const worker = MockWorker.instances[0]
    worker.emit('message', { type: 'turn-complete', windowId: 1 })
    expect(mockSendToRenderer).toHaveBeenCalledWith(
      'logs:turn-updated',
      expect.objectContaining({ status: 'success' })
    )
  })
})
