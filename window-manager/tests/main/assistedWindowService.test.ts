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

vi.mock('../../src/main/settingsService', () => ({
  getFireworksKey: vi.fn().mockReturnValue('fw-test-key'),
  getKimiSystemPrompt: vi.fn().mockReturnValue(null)
}))

vi.mock('../../src/main/db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      get: vi.fn().mockReturnValue(null)
    })
  })
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: vi.fn().mockReturnValue(null) },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() }))
}))

vi.mock('../../src/main/focusState', () => ({
  isUserWatching: vi.fn().mockReturnValue(false)
}))

import { sendToWindow, cancelWindow, resumeWindow, getWorkerCount, __resetWorkersForTests } from '../../src/main/assistedWindowService'

beforeEach(() => {
  vi.clearAllMocks()
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

  it('posts send message to worker', async () => {
    await sendToWindow(3, 'c1', 'do something', null, vi.fn())
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', windowId: 3, message: 'do something' })
    )
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

describe('resumeWindow', () => {
  it('posts resume message with windowId to worker', async () => {
    await sendToWindow(5, 'c2', 'start', null, vi.fn())
    resumeWindow(5, 'my reply')
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resume', windowId: 5, message: 'my reply' })
    )
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

  it('stream-chunk calls sendToRenderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(12, 'c12', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'stream-chunk', windowId: 12, chunk: 'hello' })
    expect(mockSend).toHaveBeenCalledWith('assisted:stream-chunk', 12, 'hello')
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
