import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockSpawn } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockSpawn: vi.fn()
}))

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))
vi.mock('child_process', () => ({ spawn: mockSpawn }))

const defaultBufferImpl = {
  push: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null }),
  flush: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
}

vi.mock('../../src/main/assistedStreamFilter', () => ({
  StreamFilterBuffer: vi.fn().mockImplementation(function (this: typeof defaultBufferImpl) {
    this.push = defaultBufferImpl.push
    this.flush = defaultBufferImpl.flush
  })
}))

import { runClaudeCode } from '../../src/main/claudeRunner'
import { EventEmitter } from 'events'

function makeFakeChild() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = Object.assign(new EventEmitter(), { stdout, stderr })
  return {
    child,
    emitStdout: (chunk: string) => stdout.emit('data', Buffer.from(chunk)),
    emitStderr: (chunk: string) => stderr.emit('data', Buffer.from(chunk)),
    close: (code: number) => child.emit('close', code)
  }
}

describe('runClaudeCode', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('resolves with output on zero exit', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('container-1', null, 'hello')
    close(0)
    const result = await promise
    expect(result).toHaveProperty('output')
    expect(result).toHaveProperty('newSessionId')
  })

  it('rejects on non-zero exit with no output', async () => {
    const { child, emitStderr, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('container-1', null, 'hello')
    emitStderr('bad error')
    close(1)
    await expect(promise).rejects.toThrow('docker exec failed')
  })

  it('passes new session arg when sessionId is null', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg')
    close(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('docker', ['exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'bypassPermissions'])
  })

  it('emits claude:event messages for each stream event', async () => {
    const { StreamFilterBuffer } = await import('../../src/main/assistedStreamFilter')
    const fakeEvent = { kind: 'assistant_text', text: 'hello', ts: 1 }
    const mockBuffer = {
      push: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [fakeEvent], sessionId: null }),
      flush: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
    };
    (StreamFilterBuffer as ReturnType<typeof vi.fn>).mockImplementationOnce(function (this: typeof mockBuffer) {
      this.push = mockBuffer.push
      this.flush = mockBuffer.flush
    })

    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg')
    emitStdout('{"type":"assistant"}\n')
    close(0)
    await promise
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'claude:event', event: fakeEvent })
    )
  })

  it('passes permissionMode=plan to docker exec args', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg', { permissionMode: 'plan' })
    close(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('docker', [
      'exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'plan'
    ])
  })

  it('passes permissionMode=bypassPermissions by default', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg')
    close(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('docker', [
      'exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'bypassPermissions'
    ])
  })

  it('uses custom eventType when provided', async () => {
    const { StreamFilterBuffer } = await import('../../src/main/assistedStreamFilter')
    const fakeEvent = { kind: 'text_delta', text: 'x', ts: 1, blockKey: 'k' }
    const mockBuffer = {
      push: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [fakeEvent], sessionId: null }),
      flush: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
    };
    (StreamFilterBuffer as ReturnType<typeof vi.fn>).mockImplementationOnce(function (this: typeof mockBuffer) {
      this.push = mockBuffer.push
      this.flush = mockBuffer.flush
    })

    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg', { eventType: 'claude-to-shellephant:event' })
    emitStdout('{"type":"assistant"}\n')
    close(0)
    await promise
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'claude-to-shellephant:event', event: fakeEvent })
    )
  })
})
