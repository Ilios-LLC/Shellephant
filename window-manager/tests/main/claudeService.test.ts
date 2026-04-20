import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockWorkerOn, mockWorkerPostMessage, mockWorkerTerminate, MockWorker } = vi.hoisted(() => {
  const mockWorkerOn = vi.fn()
  const mockWorkerPostMessage = vi.fn()
  const mockWorkerTerminate = vi.fn()
  function MockWorkerCtor(this: Record<string, unknown>) {
    this.on = mockWorkerOn
    this.postMessage = mockWorkerPostMessage
    this.terminate = mockWorkerTerminate
  }
  const MockWorker = vi.fn().mockImplementation(MockWorkerCtor)
  return { mockWorkerOn, mockWorkerPostMessage, mockWorkerTerminate, MockWorker }
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

import { sendToClaudeDirectly, cancelClaudeDirect, getDirectWorkerCount, __resetDirectWorkersForTests } from '../../src/main/claudeService'

beforeEach(() => {
  vi.clearAllMocks()
  mockDbAll.mockReturnValue([])
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

describe('cancelClaudeDirect', () => {
  it('terminates worker', async () => {
    await sendToClaudeDirectly(20, 'c20', 'msg', vi.fn())
    cancelClaudeDirect(20)
    expect(mockWorkerTerminate).toHaveBeenCalledOnce()
    expect(getDirectWorkerCount()).toBe(0)
  })
})
