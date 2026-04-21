# Shellephant MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Shellephant's hand-rolled `kimiLoop` with Vercel AI SDK `streamText` and wire in the Playwright MCP server so Shellephant (Kimi K2) can control a host-side browser.

**Architecture:** `assistedWindowWorker.ts` replaces its OpenAI-direct loop with `streamText` (Vercel AI SDK). A new `mcpManager.ts` owns MCP client lifecycle — spawning `@playwright/mcp` via stdio, fetching its tools, and exposing them to the worker. The worker merges MCP tools with the existing `run_claude_code` tool and passes both to `streamText`. One MCP process per worker thread = one isolated browser per assisted window.

**Tech Stack:** `ai` (Vercel AI SDK, pinned), `@ai-sdk/openai` (Fireworks via custom baseURL), `@modelcontextprotocol/sdk` (transitive via `ai`), `@playwright/mcp` (host binary), existing `openai` SDK removed from worker.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `window-manager/src/main/mcpManager.ts` | MCP client lifecycle: spawn servers, fetch tools, close |
| Modify | `window-manager/src/main/assistedWindowWorker.ts` | Replace kimiLoop → streamTurn; add cancel handler |
| Modify | `window-manager/src/main/assistedWindowService.ts` | cancelWindow: post cancel msg before terminate |
| Create | `window-manager/tests/main/mcpManager.test.ts` | Unit tests for mcpManager |
| Modify | `window-manager/tests/main/assistedWindowWorker.test.ts` | Remove openai mock, add ai/mcpManager mocks, rewrite kimiLoop tests |
| Modify | `window-manager/tests/main/assistedWindowService.test.ts` | Update cancelWindow test |

---

## Task 1: Add Dependencies

**Files:**
- Modify: `window-manager/package.json`

- [ ] **Step 1: Add packages to package.json dependencies**

In `window-manager/package.json`, add to `"dependencies"`:
```json
"ai": "4.3.16",
"@ai-sdk/openai": "1.3.22",
"@playwright/mcp": "0.0.26"
```

> **Note:** Verify latest stable versions of `ai` and `@ai-sdk/openai` at install time. Pin the exact versions you install. `@playwright/mcp` version must have the `npx @playwright/mcp` binary.

- [ ] **Step 2: Install dependencies**

```bash
cd window-manager && npm install
```

Expected: packages installed, no errors. `node_modules/ai` and `node_modules/@ai-sdk/openai` present.

- [ ] **Step 3: Verify ai MCP imports exist**

```bash
node -e "require('ai'); console.log('ai ok')"
node -e "require('ai/mcp-stdio'); console.log('mcp-stdio ok')"
```

Expected: both print `ok`. If `ai/mcp-stdio` fails, check AI SDK version — MCP stdio may be at a different subpath (e.g., `@ai-sdk/mcp` or main `ai` export). Adjust import path in Tasks 2–3 accordingly.

- [ ] **Step 4: Commit**

```bash
git add window-manager/package.json window-manager/package-lock.json
git commit -m "chore: add Vercel AI SDK and Playwright MCP dependencies"
```

---

## Task 2: Create `mcpManager.ts` (TDD)

**Files:**
- Create: `window-manager/src/main/mcpManager.ts`
- Create: `window-manager/tests/main/mcpManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/main/mcpManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockTools, mockClose, mockCreateMcpClient, MockStdioTransport } = vi.hoisted(() => {
  const mockTools = vi.fn().mockResolvedValue({ screenshot: { execute: vi.fn() } })
  const mockClose = vi.fn().mockResolvedValue(undefined)
  const mockCreateMcpClient = vi.fn().mockResolvedValue({ tools: mockTools, close: mockClose })
  const MockStdioTransport = vi.fn()
  return { mockTools, mockClose, mockCreateMcpClient, MockStdioTransport }
})

vi.mock('ai', () => ({
  experimental_createMCPClient: mockCreateMcpClient
}))

vi.mock('ai/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: MockStdioTransport
}))

import { createMcpClient } from '../../src/main/mcpManager'

describe('createMcpClient', () => {
  beforeEach(() => {
    mockCreateMcpClient.mockClear()
    mockTools.mockClear()
    mockClose.mockClear()
    MockStdioTransport.mockClear()
  })

  it('creates a client and fetches tools from a single server', async () => {
    const client = await createMcpClient([{ command: 'npx', args: ['@playwright/mcp@latest'] }])
    expect(client).not.toBeNull()
    const tools = await client!.tools()
    expect(tools).toHaveProperty('screenshot')
    expect(MockStdioTransport).toHaveBeenCalledWith({
      command: 'npx',
      args: ['@playwright/mcp@latest']
    })
  })

  it('merges tool sets from multiple servers into one flat object', async () => {
    mockTools
      .mockResolvedValueOnce({ screenshot: { execute: vi.fn() } })
      .mockResolvedValueOnce({ fetch: { execute: vi.fn() } })

    const client = await createMcpClient([
      { command: 'npx', args: ['@playwright/mcp@latest'] },
      { command: 'npx', args: ['@some/other-mcp@latest'] }
    ])
    expect(client).not.toBeNull()
    const tools = await client!.tools()
    expect(tools).toHaveProperty('screenshot')
    expect(tools).toHaveProperty('fetch')
  })

  it('calls close on all underlying clients when client.close() is called', async () => {
    const close1 = vi.fn().mockResolvedValue(undefined)
    const close2 = vi.fn().mockResolvedValue(undefined)
    mockCreateMcpClient
      .mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue({}), close: close1 })
      .mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue({}), close: close2 })

    const client = await createMcpClient([
      { command: 'npx', args: ['@playwright/mcp@latest'] },
      { command: 'npx', args: ['@other/mcp@latest'] }
    ])
    await client!.close()
    expect(close1).toHaveBeenCalledOnce()
    expect(close2).toHaveBeenCalledOnce()
  })

  it('returns null when client creation throws', async () => {
    mockCreateMcpClient.mockRejectedValueOnce(new Error('spawn ENOENT'))
    const client = await createMcpClient([{ command: 'npx', args: ['@playwright/mcp@latest'] }])
    expect(client).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "mcpManager"
```

Expected: FAIL — `Cannot find module '../../src/main/mcpManager'`

- [ ] **Step 3: Implement `mcpManager.ts`**

Create `window-manager/src/main/mcpManager.ts`:

```typescript
import { experimental_createMCPClient } from 'ai'
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio'
import type { ToolSet } from 'ai'

export type McpServerConfig = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type McpClient = {
  tools(): Promise<ToolSet>
  close(): Promise<void>
}

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  { command: 'npx', args: ['@playwright/mcp@latest'] }
]

export async function createMcpClient(servers: McpServerConfig[]): Promise<McpClient | null> {
  if (servers.length === 0) return null

  try {
    const clients: Array<{ tools(): Promise<ToolSet>; close(): Promise<void> }> = []

    for (const server of servers) {
      const transport = new Experimental_StdioMCPTransport({
        command: server.command,
        args: server.args,
        ...(server.env ? { env: server.env } : {})
      })
      const client = await experimental_createMCPClient({ transport })
      clients.push(client)
    }

    return {
      tools: async () => {
        const toolSets = await Promise.all(clients.map(c => c.tools()))
        return Object.assign({}, ...toolSets) as ToolSet
      },
      close: async () => {
        await Promise.all(clients.map(c => c.close()))
      }
    }
  } catch (err) {
    console.error('[mcpManager] init failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "mcpManager"
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/mcpManager.ts window-manager/tests/main/mcpManager.test.ts
git commit -m "feat: add mcpManager for MCP client lifecycle"
```

---

## Task 3: Rewrite `assistedWindowWorker.ts` (TDD)

**Files:**
- Modify: `window-manager/tests/main/assistedWindowWorker.test.ts`
- Modify: `window-manager/src/main/assistedWindowWorker.ts`

### Step A: Update test mocks and write new failing tests

- [ ] **Step 1: Replace the top of `assistedWindowWorker.test.ts` — swap mocks**

Replace lines 1–38 (the mock setup and imports block) with:

```typescript
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
```

- [ ] **Step 2: Remove the `buildShellephantTools` describe block**

Delete this entire block from the test file:
```typescript
describe('buildShellephantTools', () => {
  it('returns only run_claude_code (no ping_user)', () => {
    const tools = buildShellephantTools()
    const names = tools.map((t: { function: { name: string } }) => t.function.name)
    expect(names).toContain('run_claude_code')
    expect(names).not.toContain('ping_user')
    expect(names).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Add `beforeEach` to reset MCP state and add helper for streamText mock**

Add immediately after the last `import` statement, before the first `describe` block:

```typescript
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
```

- [ ] **Step 4: Replace the `kimiLoop` describe block with new `streamTurn` tests**

Replace the entire `describe('kimiLoop — single run_claude_code per turn', ...)` block with:

```typescript
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
```

- [ ] **Step 5: Update the `turn observability` describe block to use new mock**

Find the `turn observability` describe block (currently references `mockCreate`). Replace its `beforeEach` with:

```typescript
beforeEach(() => {
  mockParentPort.postMessage.mockClear()
  mockStreamText.mockReset()
})
```

And update the test itself to use `mockStreamText` instead of `mockCreate`:

```typescript
it('posts log-event with exec_start when runClaudeCode fires onExecEvent', async () => {
  mockStreamText.mockReturnValueOnce(makeStreamResult([]))

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
```

- [ ] **Step 6: Run updated tests to confirm they fail on the right things**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|×)" | grep "assistedWindowWorker" | head -30
```

Expected: tests that reference `buildShellephantTools` and `kimiLoop` are gone; new `streamTurn` tests FAIL because `assistedWindowWorker.ts` still has the old implementation; `resolveSystemPrompt` and `parseDockerOutput` tests still PASS.

### Step B: Rewrite `assistedWindowWorker.ts`

- [ ] **Step 7: Replace the full contents of `assistedWindowWorker.ts`**

```typescript
import { parentPort } from 'worker_threads'
import { streamText, tool, jsonSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { TimelineEvent } from '../shared/timelineEvent'
import { DEFAULT_KIMI_SYSTEM_PROMPT } from '../shared/defaultKimiPrompt'
import { runClaudeCode } from './claudeRunner'
import { writeEvent, type LogEvent } from './logWriter'
import { createMcpClient, DEFAULT_MCP_SERVERS, type McpClient } from './mcpManager'

// ─── Exported helpers (still tested directly) ────────────────────────────────

export function resolveSystemPrompt(
  projectPrompt: string | null,
  globalPrompt: string | null
): string {
  return projectPrompt ?? globalPrompt ?? DEFAULT_KIMI_SYSTEM_PROMPT
}

export function parseDockerOutput(
  stdout: string,
  stderr: string
): { outputLines: string[]; sessionId: string | null } {
  const outputLines = stdout.split('\n').filter(l => l.trim())
  const sessionId = stderr.trim() || null
  return { outputLines, sessionId }
}

// ─── MCP client — persistent per worker thread ───────────────────────────────

let mcpClient: McpClient | null = null
let mcpInitialized = false

export function __resetMcpForTests(): void {
  mcpClient = null
  mcpInitialized = false
}

async function ensureMcpClient(): Promise<McpClient | null> {
  if (mcpInitialized) return mcpClient
  mcpInitialized = true
  mcpClient = await createMcpClient(DEFAULT_MCP_SERVERS)
  return mcpClient
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeEmitter(
  turnId: string,
  logPath: string,
  windowId: number
): (eventType: string, payload?: Record<string, unknown>) => void {
  return function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
    const event: LogEvent = { turnId, windowId, eventType, ts: Date.now(), payload }
    writeEvent(logPath, event)
    parentPort?.postMessage({ type: 'log-event', event })
  }
}

async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  message: string,
  sessionRef: { value: string | null },
  turnId: string,
  logPath: string
): Promise<string> {
  parentPort?.postMessage({ type: 'save-message', windowId, role: 'tool_call', content: message, metadata: JSON.stringify({ tool_name: 'run_claude_code' }) })

  const emitEvent = makeEmitter(turnId, logPath, windowId)
  let output: string
  let assistantText = ''
  let events: TimelineEvent[] = []

  try {
    const result = await runClaudeCode(containerId, sessionRef.value, message, {
      eventType: 'claude-to-shellephant:event',
      onExecEvent: (type, payload) => emitEvent(type, payload)
    })
    output = result.output
    assistantText = result.assistantText
    events = result.events
    sessionRef.value = result.newSessionId ?? sessionRef.value
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    output = `ERROR: ${errMsg}`
    const errorEvent: TimelineEvent = { kind: 'result', text: output, isError: true, ts: Date.now() }
    events = [errorEvent]
    parentPort?.postMessage({ type: 'claude-to-shellephant:event', event: errorEvent })
  }

  parentPort?.postMessage({
    type: 'save-message', windowId, role: 'claude-to-shellephant',
    content: assistantText || output,
    metadata: JSON.stringify({
      schemaVersion: 1, session_id: sessionRef.value, complete: true,
      tool_name: 'run_claude_code', events
    })
  })
  parentPort?.postMessage({ type: 'claude-to-shellephant:turn-complete', windowId })
  return output
}

// ─── Main turn function ───────────────────────────────────────────────────────

type StreamTurnData = {
  windowId: number
  containerId: string
  message: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  initialSessionId?: string | null
  systemPrompt: string
  fireworksKey: string
  turnId: string
  logPath: string
}

async function streamTurn(data: StreamTurnData): Promise<void> {
  const { windowId, containerId, message, conversationHistory, initialSessionId, systemPrompt, fireworksKey, turnId, logPath } = data

  const emitEvent = makeEmitter(turnId, logPath, windowId)
  emitEvent('turn_start')

  const sessionRef = { value: initialSessionId ?? null }

  const mcp = await ensureMcpClient()
  const mcpTools = mcp ? await mcp.tools() : {}

  const runClaudeCodeTool = tool({
    description: 'Send a message to Claude Code inside the container. The session is managed automatically — every call continues the same CC conversation.',
    parameters: jsonSchema<{ message: string }>({
      type: 'object',
      properties: { message: { type: 'string', description: 'The task or message for Claude Code' } },
      required: ['message']
    }),
    execute: async ({ message: toolMessage }: { message: string }) => {
      return handleRunClaudeCode(windowId, containerId, toolMessage, sessionRef, turnId, logPath)
    }
  })

  const model = createOpenAI({
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKey: fireworksKey
  })('accounts/fireworks/models/kimi-k2p5')

  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: message, metadata: null })

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [...conversationHistory, { role: 'user' as const, content: message }],
    tools: { run_claude_code: runClaudeCodeTool, ...mcpTools },
    maxSteps: 20
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      parentPort?.postMessage({ type: 'kimi-delta', windowId, delta: part.textDelta })
    } else if (part.type === 'tool-call' && part.toolName === 'run_claude_code') {
      parentPort?.postMessage({
        type: 'tool-call', windowId,
        toolName: 'run_claude_code',
        message: (part.args as { message: string }).message
      })
    }
  }

  const steps = await result.steps
  const finalText = (steps[steps.length - 1]?.text ?? '').trim()
  const usage = await result.usage

  if (finalText) {
    parentPort?.postMessage({
      type: 'save-message', windowId, role: 'shellephant', content: finalText,
      metadata: JSON.stringify({ input_tokens: usage.promptTokens, output_tokens: usage.completionTokens })
    })
  }

  const costUsd = (usage.promptTokens * 0.000001) + (usage.completionTokens * 0.000003)
  emitEvent('turn_end')
  parentPort?.postMessage({
    type: 'turn-complete', windowId,
    stats: { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens, costUsd },
    assistantText: finalText
  })
}

// ─── Message handler ──────────────────────────────────────────────────────────

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'cancel') {
    mcpClient?.close().catch(() => { /* best-effort */ })
    return
  }

  if (msg.type === 'send') {
    const data = msg as unknown as StreamTurnData
    try {
      await streamTurn(data)
    } catch (err) {
      if (data.turnId && data.logPath) {
        const event: LogEvent = {
          turnId: data.turnId, windowId: data.windowId,
          eventType: 'error', ts: Date.now(),
          payload: { error: err instanceof Error ? err.message : String(err) }
        }
        writeEvent(data.logPath, event)
        parentPort?.postMessage({ type: 'log-event', event })
      }
      parentPort?.postMessage({
        type: 'turn-complete', windowId: data.windowId,
        stats: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
})
```

- [ ] **Step 8: Run all worker tests**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|×|assistedWindowWorker)"
```

Expected: all `assistedWindowWorker` tests PASS. If `runClaudeCode — streaming wire-up` tests fail (they test `claudeRunner` directly, not the worker), check that `mockSpawn` is still clearing correctly — add `mockSpawn.mockReset()` to the `beforeEach` in that describe block if needed.

- [ ] **Step 9: Commit**

```bash
git add window-manager/src/main/assistedWindowWorker.ts window-manager/tests/main/assistedWindowWorker.test.ts
git commit -m "feat: replace kimiLoop with Vercel AI SDK streamText + MCP tool support"
```

---

## Task 4: Update Cancel Flow (TDD)

**Files:**
- Modify: `window-manager/tests/main/assistedWindowService.test.ts`
- Modify: `window-manager/src/main/assistedWindowService.ts`

- [ ] **Step 1: Update the cancelWindow test to assert cancel message is sent**

Find the `describe('cancelWindow', ...)` block in `assistedWindowService.test.ts`. Replace:

```typescript
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
```

With:

```typescript
describe('cancelWindow', () => {
  it('sends cancel message to worker before terminating', async () => {
    await sendToWindow(4, 'container-ghi', 'start', null, vi.fn())
    cancelWindow(4)
    expect(mockWorkerPostMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(mockWorkerTerminate).toHaveBeenCalledOnce()
    expect(getWorkerCount()).toBe(0)
  })

  it('does nothing if no worker for window', () => {
    expect(() => cancelWindow(999)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the updated test to confirm it fails**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A5 "cancelWindow"
```

Expected: `sends cancel message to worker before terminating` FAIL — `mockWorkerPostMessage` not called with `{ type: 'cancel' }`.

- [ ] **Step 3: Update `cancelWindow` in `assistedWindowService.ts`**

> **Design note:** The spec proposed a 500ms wait between cancel message and terminate. The plan simplifies to immediate terminate — the worker's `cancel` handler closes the MCP client best-effort, and `worker.terminate()` kills the thread if close hasn't finished. This avoids async state in `cancelWindow` and test complexity. The MCP `close()` call is still made; it just races with terminate.

Find the `cancelWindow` function. Add `worker.postMessage({ type: 'cancel' })` before `worker.terminate()`:

```typescript
export function cancelWindow(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  const ctx = workerCtxMap.get(windowId)
  if (ctx) {
    const endedAt = Date.now()
    updateTurn(ctx.turnId, { status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: 'cancelled' })
    ctx.sendToRenderer('logs:turn-updated', { id: ctx.turnId, status: 'error', ended_at: endedAt, duration_ms: endedAt - ctx.startedAt, error: 'cancelled' })
  }
  worker.postMessage({ type: 'cancel' })
  worker.terminate()
  workers.delete(windowId)
  workerCtxSetters.delete(windowId)
  workerCtxMap.delete(windowId)
}
```

- [ ] **Step 4: Run the full test suite**

```bash
cd window-manager && npm run test:main
```

Expected: all tests PASS. Note the test count — should be higher than before (new mcpManager tests added, streamTurn tests added).

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/assistedWindowService.ts window-manager/tests/main/assistedWindowService.test.ts
git commit -m "feat: send cancel message to worker before terminate for MCP cleanup"
```

---

## Task 5: Full Test Run and Smoke Check

- [ ] **Step 1: Run complete test suite (main + renderer)**

```bash
cd window-manager && npm run test
```

Expected: all tests pass. Check the count against pre-change baseline — should be net higher.

- [ ] **Step 2: Typecheck**

```bash
cd window-manager && npm run typecheck:node
```

Expected: no errors. Common issues to fix if they appear:
- `ToolSet` not exported from `ai` → use `Record<string, unknown>` in `McpClient.tools()` return type
- `result.steps` type — may need `await result.steps` or `result.steps.then(...)` depending on SDK version
- `jsonSchema` not exported from `ai` → use `z.object()` from `zod` instead (add `zod` to deps)

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: Shellephant MCP integration complete — Vercel AI SDK + Playwright MCP"
```

---

## Troubleshooting

**`ai/mcp-stdio` import fails:** The subpath may differ by SDK version. Try `@ai-sdk/mcp` or check `node_modules/ai/package.json` for `exports` to find the correct path. Update the import in `mcpManager.ts` and its test mock accordingly.

**`ToolSet` not exported from `ai`:** Use `import type { Tool } from 'ai'` and `Record<string, Tool>` instead.

**`result.steps` is not a promise:** In some SDK versions it may be synchronous. Change `await result.steps` to `result.steps` and adjust the type.

**`jsonSchema` not exported from `ai`:** Install `zod` (`npm install zod`) and use `z.object({ message: z.string() })` for the `run_claude_code` tool parameters.

**Playwright MCP process doesn't start:** Verify `@playwright/mcp` is installed globally or use the local path. Run `npx @playwright/mcp --help` on the host to confirm. If it requires `@playwright/mcp start`, adjust the args in `DEFAULT_MCP_SERVERS`.
