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
