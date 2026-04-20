import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockRunClaudeCode } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockRunClaudeCode: vi.fn().mockResolvedValue({ output: 'done', assistantText: 'done', events: [], newSessionId: 'sess-1' })
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
  mockRunClaudeCode.mockResolvedValue({ output: 'done', assistantText: 'done', events: [], newSessionId: 'sess-1' })
})

describe('claudeDirectWorker', () => {
  it('calls runClaudeCode with correct args on send message', async () => {
    await messageHandler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi', initialSessionId: null })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi', { permissionMode: 'bypassPermissions' })
  })

  it('emits save-message with claude role on completion', async () => {
    await messageHandler?.({ type: 'send', windowId: 2, containerId: 'c2', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'save-message', role: 'claude', content: 'done' })
    )
  })

  it('persists assistantText (not raw output with tool_use/tool_result) as the claude row', async () => {
    mockRunClaudeCode.mockResolvedValueOnce({
      output: 'hello\ntool_use: Read(file)\ntool_result: file contents\nmore text',
      assistantText: 'hello\n\nmore text',
      events: [],
      newSessionId: 'sess-2'
    })
    await messageHandler?.({ type: 'send', windowId: 5, containerId: 'c5', message: 'hi', initialSessionId: null })
    const saveCall = mockParentPort.postMessage.mock.calls.find(([m]) => (m as { type: string }).type === 'save-message')
    expect(saveCall?.[0]).toMatchObject({ role: 'claude', content: 'hello\n\nmore text' })
  })

  it('skips save-message when assistantText is empty', async () => {
    mockRunClaudeCode.mockResolvedValueOnce({ output: 'ignored', assistantText: '', events: [], newSessionId: 'sess-3' })
    await messageHandler?.({ type: 'send', windowId: 6, containerId: 'c6', message: 'hi', initialSessionId: null })
    const saveCalls = mockParentPort.postMessage.mock.calls.filter(([m]) => (m as { type: string }).type === 'save-message')
    expect(saveCalls).toHaveLength(0)
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

  it('forwards permissionMode to runClaudeCode', async () => {
    await messageHandler?.({
      type: 'send',
      windowId: 7,
      containerId: 'c7',
      message: 'hi',
      initialSessionId: null,
      permissionMode: 'plan'
    })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c7', null, 'hi', { permissionMode: 'plan' })
  })

  it('defaults permissionMode to bypassPermissions when not provided', async () => {
    await messageHandler?.({
      type: 'send',
      windowId: 8,
      containerId: 'c8',
      message: 'hi',
      initialSessionId: null
    })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c8', null, 'hi', { permissionMode: 'bypassPermissions' })
  })
})
