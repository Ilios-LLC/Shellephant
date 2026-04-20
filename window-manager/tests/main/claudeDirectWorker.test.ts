import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockRunClaudeCode } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockRunClaudeCode: vi.fn().mockResolvedValue({ output: 'done', events: [], newSessionId: 'sess-1' })
}))

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))
vi.mock('../../src/main/claudeRunner', () => ({ runClaudeCode: mockRunClaudeCode }))

import '../../src/main/claudeDirectWorker'

// Capture handler once after module import (before beforeEach clears mocks)
let messageHandler: ((msg: unknown) => Promise<void>) | undefined
const entry = mockParentPort.on.mock.calls.find(([evt]) => evt === 'message')
messageHandler = entry?.[1] as ((msg: unknown) => Promise<void>) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mockRunClaudeCode.mockResolvedValue({ output: 'done', events: [], newSessionId: 'sess-1' })
})

describe('claudeDirectWorker', () => {
  it('calls runClaudeCode with correct args on send message', async () => {
    await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi', initialSessionId: null })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi')
  })

  it('emits save-message with claude role on completion', async () => {
    await messageHandler?.({ type: 'send', windowId: 2, containerId: 'c2', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'save-message', role: 'claude', content: 'done' })
    )
  })

  it('emits turn-complete with assistantText on completion', async () => {
    await messageHandler?.({ type: 'send', windowId: 3, containerId: 'c3', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'turn-complete', windowId: 3, assistantText: 'done' })
    )
  })

  it('emits turn-complete with error on runClaudeCode failure', async () => {
    mockRunClaudeCode.mockRejectedValueOnce(new Error('docker failed'))
    await messageHandler?.({ type: 'send', windowId: 4, containerId: 'c4', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'turn-complete', windowId: 4, error: 'docker failed' })
    )
  })
})
