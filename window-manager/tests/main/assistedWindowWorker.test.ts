import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockSpawn, mockCreate } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn(), once: vi.fn() },
  mockSpawn: vi.fn(),
  mockCreate: vi.fn()
}))

// Mock worker_threads parentPort
vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
  workerData: {}
}))

// Mock child_process for docker exec
vi.mock('child_process', () => ({ spawn: mockSpawn }))

// Mock openai. The SDK is `new OpenAI(...)`, so we return a constructor
// (vi.fn with .mockImplementation using a `function` keyword, to be callable
// with `new`).
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.chat = { completions: { create: mockCreate } }
  })
}))

import { resolveSystemPrompt, buildKimiTools, parseDockerOutput, runClaudeCode } from '../../src/main/assistedWindowWorker'
import { EventEmitter } from 'events'

describe('resolveSystemPrompt', () => {
  it('returns project prompt when set', () => {
    const result = resolveSystemPrompt('project prompt', null)
    expect(result).toBe('project prompt')
  })

  it('returns global prompt when project not set', () => {
    const result = resolveSystemPrompt(null, 'global prompt')
    expect(result).toBe('global prompt')
  })

  it('returns default prompt when both null', () => {
    const result = resolveSystemPrompt(null, null)
    expect(result).toContain('autonomous coding assistant')
  })
})

describe('buildKimiTools', () => {
  it('returns array with run_claude_code and ping_user tools', () => {
    const tools = buildKimiTools()
    const names = tools.map((t: { function: { name: string } }) => t.function.name)
    expect(names).toContain('run_claude_code')
    expect(names).toContain('ping_user')
  })
})

describe('parseDockerOutput', () => {
  // Historical helper — session id transport now lives on stdout via the
  // session_final event. These tests document the legacy splitter behavior;
  // the production path no longer consumes its sessionId field.
  it('splits stdout lines', () => {
    const result = parseDockerOutput('line1\nline2\n', 'session-abc')
    expect(result.outputLines).toEqual(['line1', 'line2'])
  })

  it('returns null sessionId when stderr is empty', () => {
    const result = parseDockerOutput('output', '')
    expect(result.sessionId).toBeNull()
  })
})

function makeFakeChild(): {
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  emitStdout: (chunk: string) => void
  emitStderr: (chunk: string) => void
  close: (code: number) => void
} {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = Object.assign(new EventEmitter(), { stdout, stderr })
  return {
    child,
    emitStdout: (c) => stdout.emit('data', Buffer.from(c)),
    emitStderr: (c) => stderr.emit('data', Buffer.from(c)),
    close: (code) => child.emit('close', code)
  }
}

describe('runClaudeCode — streaming wire-up', () => {
  beforeEach(() => {
    mockParentPort.postMessage.mockClear()
    mockSpawn.mockReset()
  })

  it('emits claude:event per SDK event, returns compact context + event log', async () => {
    const { child, emitStdout, emitStderr, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const lines = [
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6', session_id: 'sess-1' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'plan…' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'hello' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'result', subtype: 'success', result: 'Done.', is_error: false }
    ]

    const promise = runClaudeCode('container-x', null, 'do a thing')

    for (const line of lines) emitStdout(JSON.stringify(line) + '\n')
    // Session id now travels on stdout as a session_final event. Stderr noise
    // (warnings, deprecations) must not be parsed as control data.
    emitStdout(JSON.stringify({ type: 'session_final', session_id: 'sess-final' }) + '\n')
    emitStderr('deprecation warning from sdk: ignore me\n')
    close(0)

    const { output, events, newSessionId } = await promise

    // session_init and session_final are filtered out; 5 typed events emitted in order
    expect(events.map(e => e.kind)).toEqual([
      'thinking',
      'tool_use',
      'tool_result',
      'assistant_text',
      'result'
    ])

    // Session id sourced from stdout session_final event, immune to stderr noise
    expect(newSessionId).toBe('sess-final')

    // Context string (for Kimi) must NOT contain thinking or the raw SDK wrapper
    expect(output).not.toContain('thinking')
    expect(output).not.toContain('session_id')
    expect(output).toContain('Done.')

    // parentPort received one claude:event per typed event (session_init filtered out)
    const claudeEventCalls = mockParentPort.postMessage.mock.calls
      .filter(c => (c[0] as { type: string }).type === 'claude:event')
    expect(claudeEventCalls).toHaveLength(5)
    expect((claudeEventCalls[0][0] as { event: { kind: string } }).event.kind).toBe('thinking')
    expect((claudeEventCalls[2][0] as { event: { kind: string } }).event.kind).toBe('tool_result')
  })

  it('does not emit stream-chunk (legacy channel removed)', async () => {
    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runClaudeCode('c', null, 'x')
    emitStdout(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n')
    close(0)
    await promise

    const chunkCalls = mockParentPort.postMessage.mock.calls
      .filter(c => (c[0] as { type: string }).type === 'stream-chunk')
    expect(chunkCalls).toHaveLength(0)
  })

  it('buffers partial lines across stdout chunks', async () => {
    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'split' }] } })
    const promise = runClaudeCode('c', null, 'x')
    emitStdout(line.slice(0, 20))
    emitStdout(line.slice(20) + '\n')
    close(0)

    const { events } = await promise
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('assistant_text')
  })

  it('rejects when exit code non-zero and no stdout', async () => {
    const { child, emitStderr, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runClaudeCode('c', null, 'x')
    emitStderr('boom')
    close(1)

    await expect(promise).rejects.toThrow(/docker exec failed/)
  })
})

function makeToolCallStream(toolCalls: { id: string; name: string; args: string }[]) {
  // Emit one chunk per tool call (index 0..n-1), then a terminator. Matches the
  // shape the processStreamChunk reader expects: delta.tool_calls[] with
  // index/id/function.name/function.arguments.
  const chunks = toolCalls.map((tc, i) => ({
    choices: [{ delta: { tool_calls: [{ index: i, id: tc.id, function: { name: tc.name, arguments: tc.args } }] } }]
  }))
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i < chunks.length) return { value: chunks[i++], done: false }
          return { value: undefined, done: true }
        }
      }
    }
  }
}

function makeEmptyStream() {
  return {
    [Symbol.asyncIterator]() {
      return { async next() { return { value: undefined, done: true } } }
    }
  }
}

describe('kimiLoop — single run_claude_code per turn', () => {
  // Capture the handler registered at module import time, before any mockClear.
  const messageHandlerRef: { current: ((msg: Record<string, unknown>) => Promise<void>) | null } = { current: null }
  const firstOnCall = mockParentPort.on.mock.calls.find(c => c[0] === 'message')
  if (firstOnCall) messageHandlerRef.current = firstOnCall[1] as (msg: Record<string, unknown>) => Promise<void>

  beforeEach(() => {
    mockParentPort.postMessage.mockClear()
    mockSpawn.mockReset()
    mockCreate.mockReset()
  })

  it('runs only the first run_claude_code when two are batched; defers the rest', async () => {
    // First chat.completions.create: return both tool_calls in one stream.
    // Second call (the re-plan): empty stream so the loop exits cleanly.
    mockCreate
      .mockResolvedValueOnce(makeToolCallStream([
        { id: 'tc1', name: 'run_claude_code', args: JSON.stringify({ session_id: null, message: 'first' }) },
        { id: 'tc2', name: 'run_claude_code', args: JSON.stringify({ session_id: null, message: 'second' }) }
      ]))
      .mockResolvedValueOnce(makeEmptyStream())

    // Only the FIRST tool call should actually spawn docker exec.
    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValueOnce(child)
    setTimeout(() => {
      emitStdout(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n')
      emitStdout(JSON.stringify({ type: 'session_final', session_id: 'sess-A' }) + '\n')
      close(0)
    }, 0)

    const handler = messageHandlerRef.current
    expect(handler).toBeDefined()

    await handler!({
      type: 'send',
      windowId: 99,
      containerId: 'c-test',
      message: 'do two things',
      conversationHistory: [],
      initialSessionId: null,
      systemPrompt: 'sys',
      fireworksKey: 'fw'
    })

    const turnComplete = mockParentPort.postMessage.mock.calls
      .map(c => c[0] as { type: string; error?: string })
      .find(m => m.type === 'turn-complete')
    if (turnComplete?.error) throw new Error('kimiLoop threw: ' + turnComplete.error)

    expect(mockSpawn).toHaveBeenCalledTimes(1)

    const toolResultSaves = mockParentPort.postMessage.mock.calls
      .map(c => c[0] as { type: string; role?: string; content?: string })
      .filter(m => m.type === 'save-message' && m.role === 'tool_result')
    // One real tool_result from the CC run, plus NO save for deferred (we only emit a synthetic tool message in the loop, not a save-message).
    expect(toolResultSaves).toHaveLength(1)
  })

  it('seeds activeSessionId from initialSessionId so the first CC call resumes', async () => {
    mockCreate
      .mockResolvedValueOnce(makeToolCallStream([
        { id: 'tc1', name: 'run_claude_code', args: JSON.stringify({ session_id: null, message: 'continue' }) }
      ]))
      .mockResolvedValueOnce(makeEmptyStream())

    const { child, emitStdout, close } = makeFakeChild()
    mockSpawn.mockReturnValueOnce(child)
    setTimeout(() => {
      emitStdout(JSON.stringify({ type: 'session_final', session_id: 'sess-prior' }) + '\n')
      close(0)
    }, 0)

    const handler = messageHandlerRef.current
    expect(handler).toBeDefined()

    await handler({
      type: 'send',
      windowId: 100,
      containerId: 'c-test',
      message: 'resume please',
      conversationHistory: [],
      initialSessionId: 'sess-prior',
      systemPrompt: 'sys',
      fireworksKey: 'fw'
    })

    // The docker exec args must include the prior session id (3rd positional arg after `exec <container> node <script>`).
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).toContain('sess-prior')
  })
})
