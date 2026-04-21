import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockSpawn, mockStreamText, mockMcpTools, mockMcpClose } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn(), once: vi.fn() },
  mockSpawn: vi.fn(),
  mockStreamText: vi.fn(),
  mockMcpTools: vi.fn().mockResolvedValue({}),
  mockMcpClose: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
  workerData: {}
}))

vi.mock('child_process', () => ({ spawn: mockSpawn }))

vi.mock('ai', () => ({
  streamText: mockStreamText,
  tool: vi.fn((def: unknown) => def),
  jsonSchema: vi.fn((schema: unknown) => schema)
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model'))
}))

vi.mock('../../src/main/mcpManager', () => ({
  createMcpClient: vi.fn().mockResolvedValue({ tools: mockMcpTools, close: mockMcpClose }),
  DEFAULT_MCP_SERVERS: [{ command: 'npx', args: ['@playwright/mcp@latest'] }]
}))

vi.mock('../../src/main/claudeRunner', async (importActual) => {
  const actual = await importActual<typeof import('../../src/main/claudeRunner')>()
  return { ...actual, runClaudeCode: vi.fn(actual.runClaudeCode) }
})

vi.mock('../../src/main/logWriter', () => ({ writeEvent: vi.fn() }))

import { resolveSystemPrompt, parseDockerOutput, __resetMcpForTests } from '../../src/main/assistedWindowWorker'
import { runClaudeCode } from '../../src/main/claudeRunner'
import { EventEmitter } from 'events'

beforeEach(() => {
  __resetMcpForTests()
  mockMcpTools.mockResolvedValue({})
})

// Helper: builds a fake streamText result with a given sequence of fullStream parts.
// After the stream is exhausted, usage resolves to { promptTokens: 10, completionTokens: 20 }.
function makeStreamResult(parts: Array<{ type: string } & Record<string, unknown>>) {
  return {
    fullStream: {
      [Symbol.asyncIterator]() {
        let i = 0
        return {
          async next() {
            if (i < parts.length) return { value: parts[i++], done: false as const }
            return { value: undefined as unknown, done: true as const }
          }
        }
      }
    },
    steps: Promise.resolve([{ text: parts.filter(p => p.type === 'text-delta').map(p => p.textDelta as string).join(''), toolCalls: [] }]),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20 })
  }
}

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

describe('streamTurn', () => {
  // Capture the message handler registered at module import time
  const messageHandlerRef: { current: ((msg: Record<string, unknown>) => Promise<void>) | null } = { current: null }
  const firstOnCall = mockParentPort.on.mock.calls.find(c => c[0] === 'message')
  if (firstOnCall) messageHandlerRef.current = firstOnCall[1] as (msg: Record<string, unknown>) => Promise<void>

  beforeEach(() => {
    mockParentPort.postMessage.mockClear()
    mockStreamText.mockReset()
    mockMcpTools.mockResolvedValue({})
  })

  async function runTurn(overrides: Partial<{
    windowId: number; containerId: string; message: string;
    initialSessionId: string | null; systemPrompt: string; fireworksKey: string;
    turnId: string; logPath: string
  }> = {}) {
    const handler = messageHandlerRef.current
    expect(handler).toBeDefined()
    await handler!({
      type: 'send',
      windowId: 1, containerId: 'c1', message: 'do it',
      conversationHistory: [], initialSessionId: null,
      systemPrompt: 'sys', fireworksKey: 'fw-key',
      turnId: 'turn-1', logPath: '/tmp/test.jsonl',
      ...overrides
    })
  }

  it('posts kimi-delta for each text-delta part in fullStream', async () => {
    mockStreamText.mockReturnValueOnce(makeStreamResult([
      { type: 'text-delta', textDelta: 'Hello' },
      { type: 'text-delta', textDelta: ' world' }
    ]))

    await runTurn()

    const deltas = mockParentPort.postMessage.mock.calls
      .filter(c => (c[0] as { type: string }).type === 'kimi-delta')
      .map(c => (c[0] as { delta: string }).delta)
    expect(deltas).toEqual(['Hello', ' world'])
  })

  it('posts tool-call for run_claude_code tool-call parts', async () => {
    mockStreamText.mockReturnValueOnce(makeStreamResult([
      { type: 'tool-call', toolName: 'run_claude_code', args: { message: 'check the tests' } }
    ]))

    await runTurn()

    const toolCallMsgs = mockParentPort.postMessage.mock.calls
      .filter(c => (c[0] as { type: string }).type === 'tool-call')
    expect(toolCallMsgs).toHaveLength(1)
    expect(toolCallMsgs[0][0]).toMatchObject({
      type: 'tool-call',
      toolName: 'run_claude_code',
      message: 'check the tests'
    })
  })

  it('posts turn-complete with stats after stream finishes', async () => {
    mockStreamText.mockReturnValueOnce(makeStreamResult([
      { type: 'text-delta', textDelta: 'Done.' }
    ]))

    await runTurn()

    const turnComplete = mockParentPort.postMessage.mock.calls
      .find(c => (c[0] as { type: string }).type === 'turn-complete')
    expect(turnComplete).toBeDefined()
    expect(turnComplete![0]).toMatchObject({
      type: 'turn-complete',
      stats: { inputTokens: 10, outputTokens: 20 }
    })
  })

  it('includes MCP tools in streamText call when MCP client initializes successfully', async () => {
    mockMcpTools.mockResolvedValueOnce({
      screenshot: { execute: vi.fn() },
      click: { execute: vi.fn() }
    })
    mockStreamText.mockReturnValueOnce(makeStreamResult([]))

    await runTurn()

    const streamTextCall = mockStreamText.mock.calls[0][0] as { tools: Record<string, unknown> }
    expect(streamTextCall.tools).toHaveProperty('run_claude_code')
    expect(streamTextCall.tools).toHaveProperty('screenshot')
    expect(streamTextCall.tools).toHaveProperty('click')
  })

  it('proceeds with only run_claude_code when MCP init returns null', async () => {
    const { createMcpClient } = await import('../../src/main/mcpManager')
    vi.mocked(createMcpClient).mockResolvedValueOnce(null)
    __resetMcpForTests()  // force re-init next turn

    mockStreamText.mockReturnValueOnce(makeStreamResult([]))

    await runTurn()

    const streamTextCall = mockStreamText.mock.calls[0][0] as { tools: Record<string, unknown> }
    expect(streamTextCall.tools).toHaveProperty('run_claude_code')
    expect(Object.keys(streamTextCall.tools)).toHaveLength(1)
  })

  it('run_claude_code execute updates sessionRef so second call uses new session', async () => {
    // runClaudeCode is called when run_claude_code execute runs.
    // We capture the tools from streamText, call execute twice, and verify
    // that the second call receives the session returned by the first.
    vi.mocked(runClaudeCode).mockClear()
    vi.mocked(runClaudeCode)
      .mockResolvedValueOnce({ output: 'result-1', assistantText: '', events: [], newSessionId: 'sess-1' })
      .mockResolvedValueOnce({ output: 'result-2', assistantText: '', events: [], newSessionId: 'sess-2' })

    let capturedTools: Record<string, { execute: (args: { message: string }) => Promise<string> }> = {}
    mockStreamText.mockImplementationOnce((opts: { tools: typeof capturedTools }) => {
      capturedTools = opts.tools
      return makeStreamResult([])
    })

    await runTurn({ initialSessionId: 'sess-0' })

    // Simulate two sequential tool executions in the same turn
    await capturedTools.run_claude_code.execute({ message: 'first' })
    await capturedTools.run_claude_code.execute({ message: 'second' })

    const calls = vi.mocked(runClaudeCode).mock.calls
    expect(calls[0][1]).toBe('sess-0')   // first call uses initial session
    expect(calls[1][1]).toBe('sess-1')   // second call uses session from first result
  })
})

describe('turn observability', () => {
  const obsHandlerRef: { current: ((msg: Record<string, unknown>) => Promise<void>) | null } = { current: null }
  const firstOnCallObs = mockParentPort.on.mock.calls.find(c => c[0] === 'message')
  if (firstOnCallObs) obsHandlerRef.current = firstOnCallObs[1] as (msg: Record<string, unknown>) => Promise<void>

  beforeEach(() => {
    mockParentPort.postMessage.mockClear()
    mockStreamText.mockReset()
  })

  it('posts log-event with exec_start when runClaudeCode fires onExecEvent', async () => {
    vi.mocked(runClaudeCode).mockImplementationOnce(async (_cid, _sid, _msg, opts) => {
      opts?.onExecEvent?.('exec_start', { containerId: 'c1', command: 'docker exec', ts: 1000 })
      return { output: 'done', assistantText: '', events: [], newSessionId: null }
    })

    let capturedTools: Record<string, { execute: (args: { message: string }) => Promise<string> }> = {}
    mockStreamText.mockImplementationOnce((opts: { tools: typeof capturedTools }) => {
      capturedTools = opts.tools
      return makeStreamResult([])
    })

    const handler = mockParentPort.on.mock.calls.find(c => c[0] === 'message')?.[1] as
      ((msg: Record<string, unknown>) => Promise<void>) | undefined
    expect(handler).toBeDefined()

    await handler!({
      type: 'send',
      windowId: 1, containerId: 'c1', message: 'do the thing',
      conversationHistory: [], initialSessionId: null,
      systemPrompt: 'you are helpful', fireworksKey: 'fw-test',
      turnId: 'turn-test', logPath: '/tmp/test.jsonl'
    })

    // Execute the run_claude_code tool to trigger onExecEvent
    await capturedTools.run_claude_code.execute({ message: 'do the thing' })

    const logEvents = mockParentPort.postMessage.mock.calls
      .filter((c: [{ type: string }]) => c[0]?.type === 'log-event')
    const execStartEvent = logEvents.find(
      (c: [{ event: { eventType: string } }]) => c[0].event.eventType === 'exec_start'
    )
    expect(execStartEvent).toBeDefined()
    expect(execStartEvent![0].event.turnId).toBe('turn-test')
  })
})
