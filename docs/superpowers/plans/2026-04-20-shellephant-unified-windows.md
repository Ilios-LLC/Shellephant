# Shellephant Unified Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual/assisted window types with a single unified window that shows a pretty chat UI where users can toggle between sending to Claude directly or to Shellephant.

**Architecture:** Extract `runClaudeCode` to a shared `claudeRunner.ts`; both a new `claudeDirectWorker.ts` and the existing Shellephant worker use it. Both paths emit the same `claude:delta`/`claude:action`/`claude:turn-complete` IPC events. A unified history table tracks all turns regardless of recipient. Shellephant no longer has `ping_user`; it just responds.

**Tech Stack:** Electron, Svelte 5 runes, better-sqlite3, worker_threads, OpenAI SDK (Fireworks), vitest

---

## File Map

| Status | Path | Change |
|--------|------|--------|
| Create | `src/main/claudeRunner.ts` | `runClaudeCode()` extracted from worker, emits `claude:event` |
| Create | `src/main/claudeDirectWorker.ts` | Worker for direct Claude turns |
| Create | `src/main/claudeService.ts` | Worker pool for direct Claude, routes events |
| Modify | `src/shared/chatHistory.ts` | New roles + legacy fallback |
| Modify | `src/main/assistedWindowService.ts` | Remove `resumeWindow`, route `claude:event`, update `loadHistory`/`loadLastSessionId` |
| Modify | `src/main/assistedWindowWorker.ts` | Remove `ping_user`, update `handleRunClaudeCode` |
| Modify | `src/main/ipcHandlers.ts` | Add `claude:send`/`cancel`, remove `assisted:resume` |
| Modify | `src/preload/index.ts` | Add claude API methods |
| Modify | `src/renderer/src/components/AssistedPanel.svelte` | New roles, toggle, new listeners |
| Modify | `src/renderer/src/components/TerminalHost.svelte` | Remove `window_type` guards |
| Modify | `src/renderer/src/components/WindowDetailPane.svelte` | Remove `window_type` filter |
| Modify | `src/renderer/src/components/NewWindowWizard.svelte` | Remove type toggle |
| Modify | `src/shared/defaultKimiPrompt.ts` | Rename display strings |
| Create | `tests/main/claudeRunner.test.ts` | New |
| Create | `tests/main/claudeDirectWorker.test.ts` | New |
| Create | `tests/main/claudeService.test.ts` | New |
| Modify | `tests/main/assistedWindowService.test.ts` | Remove `resumeWindow`, update roles |
| Modify | `tests/main/assistedWindowWorker.test.ts` | Remove `ping_user`, rename builder |

---

## IPC Event Reference

| Channel | Direction | Fired by | Meaning |
|---------|-----------|----------|---------|
| `claude:delta` | main→renderer | claudeService / assistedWindowService | Claude streaming text chunk |
| `claude:action` | main→renderer | claudeService / assistedWindowService | Claude tool use (mini-panel) |
| `claude:turn-complete` | main→renderer | claudeService / assistedWindowService | Claude invocation done |
| `assisted:kimi-delta` | main→renderer | assistedWindowService | Shellephant streaming text |
| `assisted:turn-complete` | main→renderer | assistedWindowService | Whole Shellephant turn done |

**Renderer rule:** When `claude:turn-complete` fires and `currentRecipient === 'claude'`, set `running = false`. When `assisted:turn-complete` fires and `currentRecipient === 'shellephant'`, set `running = false`.

---

## Task 1: Create `claudeRunner.ts` — shared `runClaudeCode` utility

**Files:**
- Create: `window-manager/src/main/claudeRunner.ts`
- Create: `window-manager/tests/main/claudeRunner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// window-manager/tests/main/claudeRunner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockSpawn } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockSpawn: vi.fn()
}))

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))
vi.mock('child_process', () => ({ spawn: mockSpawn }))
vi.mock('../../src/main/assistedStreamFilter', () => ({
  StreamFilterBuffer: vi.fn().mockImplementation(() => ({
    push: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null }),
    flush: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
  }))
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
    expect(mockSpawn).toHaveBeenCalledWith('docker', ['exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg'])
  })

  it('emits claude:event messages for each stream event', async () => {
    const { StreamFilterBuffer } = await import('../../src/main/assistedStreamFilter')
    const fakeEvent = { kind: 'assistant_text', text: 'hello', ts: 1 }
    const mockBuffer = {
      push: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [fakeEvent], sessionId: null }),
      flush: vi.fn().mockReturnValue({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
    };
    (StreamFilterBuffer as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockBuffer)

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
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeRunner.test.ts
```
Expected: FAIL — `claudeRunner` module not found.

- [ ] **Step 3: Create `src/main/claudeRunner.ts`**

```typescript
// window-manager/src/main/claudeRunner.ts
import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import { StreamFilterBuffer } from './assistedStreamFilter'
import type { TimelineEvent } from '../shared/timelineEvent'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string
): Promise<{ output: string; events: TimelineEvent[]; newSessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])

    const filter = new StreamFilterBuffer()
    const contextParts: string[] = []
    const eventsLog: TimelineEvent[] = []
    let stderr = ''
    let hadAnyOutput = false
    let streamSessionId: string | null = null

    child.stdout.on('data', (chunk: Buffer) => {
      hadAnyOutput = true
      const drained = filter.push(chunk.toString())
      contextParts.push(...drained.contextChunks)
      if (drained.sessionId) streamSessionId = drained.sessionId
      for (const event of drained.events) {
        eventsLog.push(event)
        parentPort?.postMessage({ type: 'claude:event', event })
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      const drained = filter.flush()
      contextParts.push(...drained.contextChunks)
      if (drained.sessionId) streamSessionId = drained.sessionId
      for (const event of drained.events) {
        eventsLog.push(event)
        parentPort?.postMessage({ type: 'claude:event', event })
      }

      if (code !== 0 && !hadAnyOutput) {
        reject(new Error(`docker exec failed (exit ${code}): ${stderr}`))
        return
      }
      // eslint-disable-next-line no-console
      console.error(`[claude:session] resumed=${sessionId ?? 'none'} final=${streamSessionId ?? 'none'}`)
      resolve({ output: contextParts.join('\n'), events: eventsLog, newSessionId: streamSessionId })
    })

    child.on('error', reject)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeRunner.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Update `assistedWindowWorker.ts` to import from `claudeRunner`**

In `window-manager/src/main/assistedWindowWorker.ts`, replace:
```typescript
import { StreamFilterBuffer } from './assistedStreamFilter'
```
with:
```typescript
import { runClaudeCode } from './claudeRunner'
```

And remove the entire `runClaudeCode` function definition (lines 54–106). Keep all other exports (`resolveSystemPrompt`, `buildKimiTools`, `parseDockerOutput`).

- [ ] **Step 6: Run existing worker tests to confirm nothing broke**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowWorker.test.ts
```
Expected: PASS (all existing tests)

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/main/claudeRunner.ts window-manager/src/main/assistedWindowWorker.ts window-manager/tests/main/claudeRunner.test.ts
git commit -m "refactor: extract runClaudeCode to claudeRunner.ts, emit claude:event"
```

---

## Task 2: Update `chatHistory.ts` + `loadHistory` / `loadLastSessionId`

**Files:**
- Modify: `window-manager/src/shared/chatHistory.ts`
- Modify: `window-manager/src/main/assistedWindowService.ts` (loadHistory + loadLastSessionId)
- Modify: `window-manager/tests/main/assistedWindowService.test.ts`

- [ ] **Step 1: Write failing tests for new history behavior**

Add to `window-manager/tests/main/assistedWindowService.test.ts`, inside the `sendToWindow — session continuity` describe block:

```typescript
it('maps shellephant role to assistant in history', async () => {
  mockDbAll.mockReturnValueOnce([
    { role: 'shellephant', content: 'I will help', metadata: null }
  ])
  await sendToWindow(60, 'c60', 'next', null, vi.fn())
  const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
  const history = (sendCall![0] as { conversationHistory: { role: string }[] }).conversationHistory
  expect(history[0].role).toBe('assistant')
})

it('collapses claude-action + claude rows into a single user history entry', async () => {
  mockDbAll.mockReturnValueOnce([
    { role: 'claude-action', content: '', metadata: JSON.stringify({ actionType: 'Write', summary: 'src/foo.ts' }) },
    { role: 'claude', content: 'Done writing the file.', metadata: null }
  ])
  await sendToWindow(61, 'c61', 'next', null, vi.fn())
  const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
  const history = (sendCall![0] as { conversationHistory: { role: string; content: string }[] }).conversationHistory
  expect(history).toHaveLength(1)
  expect(history[0].role).toBe('user')
  expect(history[0].content).toContain('src/foo.ts')
  expect(history[0].content).toContain('Done writing the file.')
})

it('loads session_id from claude role rows', () => {
  mockDbAll.mockReturnValueOnce([
    { metadata: JSON.stringify({ session_id: 'sess-new', complete: true }) }
  ])
  expect(loadLastSessionId(99)).toBe('sess-new')
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowService.test.ts
```
Expected: FAIL (3 new tests)

- [ ] **Step 3: Update `src/shared/chatHistory.ts`**

Replace the entire file:

```typescript
// Maps persisted `assisted_messages` rows to entries Shellephant can replay.
// New roles: shellephant, claude, claude-action.
// Legacy roles (assistant, tool_call, tool_result, ping_user) kept for backward compat.

export type ChatHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
}

export function mapDbRowToHistoryEntry(role: string, content: string): ChatHistoryEntry | null {
  switch (role) {
    case 'user':
      return { role: 'user', content }
    case 'shellephant':
    case 'assistant': // legacy
      return { role: 'assistant', content }
    case 'tool_result': // legacy — treat as claude response
      return { role: 'user', content: `CC output: ${content}` }
    case 'claude':
    case 'claude-action':
    case 'tool_call': // legacy
    case 'ping_user': // legacy/removed
    default:
      return null
  }
}
```

- [ ] **Step 4: Update `loadHistory` in `src/main/assistedWindowService.ts`**

Replace the `loadHistory` function (currently lines 25–35):

```typescript
function loadHistory(windowId: number): ChatHistoryEntry[] {
  const rows = getDb()
    .prepare('SELECT role, content, metadata FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as { role: string; content: string; metadata: string | null }[]

  const entries: ChatHistoryEntry[] = []
  let pendingActions: string[] = []

  for (const row of rows) {
    if (row.role === 'claude-action') {
      try {
        const meta = JSON.parse(row.metadata ?? '{}') as { summary?: string; actionType?: string }
        pendingActions.push(meta.summary ?? meta.actionType ?? 'action')
      } catch {
        pendingActions.push('action')
      }
      continue
    }

    if (row.role === 'claude') {
      const prefix = pendingActions.length > 0
        ? `[Claude did: ${pendingActions.join(', ')}] Response: `
        : '[Claude]: '
      entries.push({ role: 'user', content: prefix + row.content })
      pendingActions = []
      continue
    }

    // Orphaned actions before a non-claude role: discard
    pendingActions = []
    const mapped = mapDbRowToHistoryEntry(row.role, row.content)
    if (mapped) entries.push(mapped)
  }

  return entries
}
```

- [ ] **Step 5: Update `loadLastSessionId` in `src/main/assistedWindowService.ts`**

Replace the SQL query to scan both new `claude` role and legacy `tool_result` role:

```typescript
export function loadLastSessionId(windowId: number): string | null {
  const rows = getDb()
    .prepare(`
      SELECT metadata FROM assisted_messages
      WHERE window_id = ? AND role IN ('claude', 'tool_result') AND metadata IS NOT NULL
      ORDER BY id DESC LIMIT 20
    `)
    .all(windowId) as { metadata: string | null }[]
  for (const row of rows) {
    if (!row.metadata) continue
    try {
      const parsed = JSON.parse(row.metadata) as { session_id?: string | null; tool_name?: string }
      // Legacy tool_result rows require tool_name check; new claude rows don't have tool_name
      if (parsed.tool_name && parsed.tool_name !== 'run_claude_code') continue
      if (parsed.session_id) return parsed.session_id
    } catch {
      continue
    }
  }
  return null
}
```

- [ ] **Step 6: Run tests**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowService.test.ts
```
Expected: all tests pass (including 3 new ones). The existing `maps DB roles into OpenAI-valid history roles` test will need updating — update its expected content:

```typescript
// Update existing test at line ~161 to match new behavior:
it('maps DB roles into OpenAI-valid history roles', async () => {
  mockDbAll.mockReturnValueOnce([
    { role: 'user', content: 'hi', metadata: null },
    { role: 'shellephant', content: 'hello', metadata: null },
    { role: 'claude-action', content: '', metadata: JSON.stringify({ summary: 'src/foo.ts', actionType: 'Write' }) },
    { role: 'claude', content: 'done', metadata: null },
  ])
  await sendToWindow(52, 'c52', 'next', null, vi.fn())
  const sendCall = mockWorkerPostMessage.mock.calls.find(c => (c[0] as { type: string }).type === 'send')
  const history = (sendCall![0] as { conversationHistory: { role: string; content: string }[] }).conversationHistory
  expect(history.map(h => h.role)).toEqual(['user', 'assistant', 'user'])
  expect(history[2].content).toContain('src/foo.ts')
  expect(history[2].content).toContain('done')
})
```

Also remove the old test assertions for `tool_call`, `ping_user`, and `CC output:` since those were legacy.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/shared/chatHistory.ts window-manager/src/main/assistedWindowService.ts window-manager/tests/main/assistedWindowService.test.ts
git commit -m "feat: update chatHistory roles and loadHistory for unified window model"
```

---

## Task 3: Update `assistedWindowWorker.ts` — remove ping_user, update run_claude_code

**Files:**
- Modify: `window-manager/src/main/assistedWindowWorker.ts`
- Modify: `window-manager/tests/main/assistedWindowWorker.test.ts`

- [ ] **Step 1: Write failing tests**

In `window-manager/tests/main/assistedWindowWorker.test.ts`, update existing tests and add:

```typescript
// Replace the buildKimiTools test:
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

Update the import line in the test file:
```typescript
import { resolveSystemPrompt, buildShellephantTools, parseDockerOutput } from '../../src/main/assistedWindowWorker'
```

- [ ] **Step 2: Run to verify the renamed import fails**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowWorker.test.ts
```
Expected: FAIL — `buildShellephantTools` not exported.

- [ ] **Step 3: Update `assistedWindowWorker.ts`**

Make the following changes:

**a) Update import — add `runClaudeCode` from claudeRunner:**
```typescript
import { parentPort } from 'worker_threads'
import OpenAI from 'openai'
import { runClaudeCode } from './claudeRunner'
import { DEFAULT_KIMI_SYSTEM_PROMPT } from '../shared/defaultKimiPrompt'
```
(Remove the old `StreamFilterBuffer` import and the old `runClaudeCode` function which was already extracted in Task 1.)

**b) Rename `buildKimiTools` → `buildShellephantTools` and remove `ping_user`:**
```typescript
export function buildShellephantTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_claude_code',
        description: 'Send a message to Claude Code inside the container. The session is managed for you automatically — every call in this window continues the same CC conversation.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The task or message for Claude Code' }
          },
          required: ['message']
        }
      }
    }
  ]
}
```

**c) Remove the entire `handlePingUser` function.**

**d) Update `handleRunClaudeCode` — save new roles:**

```typescript
async function handleRunClaudeCode(
  windowId: number,
  containerId: string,
  tc: ToolCallAccum,
  activeSessionId: string | null
): Promise<{ toolResult: string; newActiveSessionId: string | null }> {
  const args = JSON.parse(tc.arguments) as { message: string }
  let output: string
  let newActiveSessionId = activeSessionId

  try {
    const result = await runClaudeCode(containerId, activeSessionId, args.message)
    output = result.output
    newActiveSessionId = result.newSessionId ?? activeSessionId
    // Save Claude's response as a claude role message
    parentPort?.postMessage({
      type: 'save-message', windowId, role: 'claude', content: output,
      metadata: JSON.stringify({ session_id: newActiveSessionId, complete: true })
    })
    parentPort?.postMessage({ type: 'claude:turn-complete', windowId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    output = `ERROR: ${message}`
    parentPort?.postMessage({
      type: 'save-message', windowId, role: 'claude', content: output,
      metadata: JSON.stringify({ session_id: newActiveSessionId, complete: false, error: true })
    })
    parentPort?.postMessage({ type: 'claude:turn-complete', windowId })
  }

  return { toolResult: output, newActiveSessionId }
}
```

**e) Update `kimiLoop` — use `buildShellephantTools()`, remove `ping_user` handling:**

In the `while (true)` loop, change `tools: buildKimiTools()` to `tools: buildShellephantTools()`.

In the tool call dispatch loop, remove the `ping_user` branch entirely:
```typescript
// Replace the tool dispatch:
if (tc.name === 'run_claude_code') {
  if (ranClaudeCodeThisTurn) {
    toolResult = 'Deferred — only one run_claude_code allowed per turn. Re-plan after reading the previous response, then call run_claude_code again.'
  } else {
    const res = await handleRunClaudeCode(windowId, containerId, tc, activeSessionId)
    toolResult = res.toolResult
    activeSessionId = res.newActiveSessionId
    ranClaudeCodeThisTurn = true
  }
} else {
  toolResult = 'Unknown tool'
}
```

**f) Update `kimiLoop` save-message for assistant text — change role from `assistant` to `shellephant`:**
```typescript
parentPort?.postMessage({
  type: 'save-message', windowId, role: 'shellephant', content: kimiDeltaRef.value,
  metadata: JSON.stringify({ input_tokens: tokenRef.input, output_tokens: tokenRef.output })
})
```

**g) Update `processStreamChunk` — change `kimi-delta` message type stays the same (keep `assisted:kimi-delta` flow):** No change needed here — the `kimi-delta` message is still sent to the service which forwards as `assisted:kimi-delta`.

- [ ] **Step 4: Run tests**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowWorker.test.ts
```
Expected: PASS all tests (including renamed `buildShellephantTools` test, no `ping_user` test).

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/assistedWindowWorker.ts window-manager/tests/main/assistedWindowWorker.test.ts
git commit -m "feat: remove ping_user from Shellephant worker, save claude role messages"
```

---

## Task 4: Update `assistedWindowService.ts` — event routing for new types

**Files:**
- Modify: `window-manager/src/main/assistedWindowService.ts`
- Modify: `window-manager/tests/main/assistedWindowService.test.ts`

- [ ] **Step 1: Write failing tests for new event routing**

Add to `window-manager/tests/main/assistedWindowService.test.ts`:

```typescript
describe('worker message routing — new event types', () => {
  it('claude:event with text_delta kind forwards as claude:delta to renderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(70, 'c70', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'claude:event', event: { kind: 'text_delta', text: 'hello', ts: 1, blockKey: 'k1' } })
    expect(mockSend).toHaveBeenCalledWith('claude:delta', 70, 'hello')
  })

  it('claude:event with tool_use kind saves claude-action and sends claude:action', async () => {
    const mockSend = vi.fn()
    await sendToWindow(71, 'c71', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({
      type: 'claude:event',
      event: { kind: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'src/a.ts' }, summary: 'src/a.ts', ts: 1 }
    })
    expect(mockDbRun).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith('claude:action', 71, expect.objectContaining({ actionType: 'Write', summary: 'src/a.ts' }))
  })

  it('claude:turn-complete forwards to renderer', async () => {
    const mockSend = vi.fn()
    await sendToWindow(72, 'c72', 'msg', null, mockSend)
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'claude:turn-complete', windowId: 72 })
    expect(mockSend).toHaveBeenCalledWith('claude:turn-complete', 72)
  })

  it('turn-complete notification says Shellephant responded', async () => {
    await sendToWindow(73, 'c73', 'msg', null, vi.fn())
    const messageHandler = mockWorkerOn.mock.calls.find(([e]) => e === 'message')?.[1]
    messageHandler({ type: 'turn-complete', windowId: 73, stats: null, assistantText: 'done' })
    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shellephant responded' }))
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowService.test.ts
```
Expected: FAIL (4 new tests)

- [ ] **Step 3: Update `assistedWindowService.ts` message handler**

In the `worker.on('message', ...)` handler, replace the current routing block with:

```typescript
worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'save-message') {
    saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
  } else if (msg.type === 'claude:event') {
    const ev = msg.event as { kind: string; text?: string; name?: string; summary?: string; input?: unknown }
    if (ev.kind === 'text_delta') {
      sendToRenderer('claude:delta', windowId, ev.text)
    } else if (ev.kind === 'tool_use') {
      const detail = JSON.stringify(ev.input)
      saveMessage(windowId, 'claude-action', '', JSON.stringify({ actionType: ev.name, summary: ev.summary, detail }))
      sendToRenderer('claude:action', windowId, { actionType: ev.name, summary: ev.summary, detail })
    }
    // other event kinds (tool_use_start, tool_use_progress, etc.) are live-only; no save or forward needed
  } else if (msg.type === 'claude:turn-complete') {
    sendToRenderer('claude:turn-complete', windowId)
  } else if (msg.type === 'kimi-delta') {
    sendToRenderer('assisted:kimi-delta', windowId, msg.delta)
  } else if (msg.type === 'turn-complete') {
    sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
    const assistantText = typeof msg.assistantText === 'string' ? msg.assistantText : ''
    if (assistantText) {
      const focusedWin = BrowserWindow.getFocusedWindow()
      if (!focusedWin || !isUserWatching(containerId, focusedWin)) {
        const body = assistantText.length > 200 ? assistantText.slice(0, 200) + '…' : assistantText
        new Notification({ title: 'Shellephant responded', body }).show()
      }
    }
    workers.delete(windowId)
  }
})
```

Also remove `resumeWindow` export function entirely, and remove the `ping-user` branch and the `stream-event`, `tool-call` branches (replaced by `claude:event`).

- [ ] **Step 4: Remove `resumeWindow` and related import**

Remove the `resumeWindow` function from `assistedWindowService.ts`:
```typescript
// DELETE this entire function:
export function resumeWindow(windowId: number, message: string): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.postMessage({ type: 'resume', windowId, message })
}
```

- [ ] **Step 5: Run tests**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/assistedWindowService.test.ts
```
Expected: PASS all (4 new + existing). Remove the `resumeWindow` describe block from the test file.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/assistedWindowService.ts window-manager/tests/main/assistedWindowService.test.ts
git commit -m "feat: update assistedWindowService to route claude:event and remove resumeWindow"
```

---

## Task 5: Create `claudeDirectWorker.ts` + `claudeService.ts`

**Files:**
- Create: `window-manager/src/main/claudeDirectWorker.ts`
- Create: `window-manager/src/main/claudeService.ts`
- Create: `window-manager/tests/main/claudeDirectWorker.test.ts`
- Create: `window-manager/tests/main/claudeService.test.ts`

- [ ] **Step 1: Write failing tests for `claudeDirectWorker`**

```typescript
// window-manager/tests/main/claudeDirectWorker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockRunClaudeCode } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn() },
  mockRunClaudeCode: vi.fn().mockResolvedValue({ output: 'done', events: [], newSessionId: 'sess-1' })
}))

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))
vi.mock('../../src/main/claudeRunner', () => ({ runClaudeCode: mockRunClaudeCode }))

beforeEach(() => { vi.clearAllMocks() })

// The worker registers its listener on import; grab it.
async function getMessageHandler() {
  await import('../../src/main/claudeDirectWorker')
  const calls = mockParentPort.on.mock.calls
  const entry = calls.find(([evt]) => evt === 'message')
  return entry?.[1] as ((msg: unknown) => Promise<void>) | undefined
}

describe('claudeDirectWorker', () => {
  it('calls runClaudeCode with correct args on send message', async () => {
    const handler = await getMessageHandler()
    await handler?.({ type: 'send', windowId: 1, containerId: 'c1', message: 'hi', initialSessionId: null })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi')
  })

  it('emits save-message with claude role on completion', async () => {
    const handler = await getMessageHandler()
    await handler?.({ type: 'send', windowId: 2, containerId: 'c2', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'save-message', role: 'claude', content: 'done' })
    )
  })

  it('emits turn-complete on completion', async () => {
    const handler = await getMessageHandler()
    await handler?.({ type: 'send', windowId: 3, containerId: 'c3', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'turn-complete', windowId: 3 })
    )
  })

  it('emits turn-complete with error on runClaudeCode failure', async () => {
    mockRunClaudeCode.mockRejectedValueOnce(new Error('docker failed'))
    const handler = await getMessageHandler()
    await handler?.({ type: 'send', windowId: 4, containerId: 'c4', message: 'hi', initialSessionId: null })
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'turn-complete', windowId: 4, error: 'docker failed' })
    )
  })
})
```

- [ ] **Step 2: Run to verify failures**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeDirectWorker.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/main/claudeDirectWorker.ts`**

```typescript
// window-manager/src/main/claudeDirectWorker.ts
import { parentPort } from 'worker_threads'
import { runClaudeCode } from './claudeRunner'

type DirectSendMsg = {
  type: 'send'
  windowId: number
  containerId: string
  message: string
  initialSessionId: string | null
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type !== 'send') return
  const { windowId, containerId, message, initialSessionId } = msg as unknown as DirectSendMsg

  try {
    const { output, newSessionId } = await runClaudeCode(containerId, initialSessionId, message)
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: output,
      metadata: JSON.stringify({ session_id: newSessionId, complete: true })
    })
    parentPort?.postMessage({ type: 'turn-complete', windowId, session_id: newSessionId })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    parentPort?.postMessage({
      type: 'save-message',
      role: 'claude',
      content: `ERROR: ${errMsg}`,
      metadata: JSON.stringify({ complete: false, error: true })
    })
    parentPort?.postMessage({ type: 'turn-complete', windowId, error: errMsg })
  }
})
```

- [ ] **Step 4: Run direct worker tests**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeDirectWorker.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Write failing tests for `claudeService`**

```typescript
// window-manager/tests/main/claudeService.test.ts
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
```

- [ ] **Step 6: Run to verify they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeService.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 7: Create `src/main/claudeService.ts`**

```typescript
// window-manager/src/main/claudeService.ts
import { Worker } from 'worker_threads'
import path from 'path'
import { getDb } from './db'
import { loadLastSessionId } from './assistedWindowService'

const workers = new Map<number, Worker>()

export function getDirectWorkerCount(): number { return workers.size }
export function __resetDirectWorkersForTests(): void { workers.clear() }

function getWorkerPath(): string {
  return path.join(__dirname, 'claudeDirectWorker.js')
}

function saveMessage(windowId: number, role: string, content: string, metadata: string | null): void {
  getDb()
    .prepare('INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (?, ?, ?, ?)')
    .run(windowId, role, content, metadata)
}

export async function sendToClaudeDirectly(
  windowId: number,
  containerId: string,
  message: string,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
): Promise<void> {
  // Save user message first
  saveMessage(windowId, 'user', message, null)
  const initialSessionId = loadLastSessionId(windowId)

  let worker = workers.get(windowId)
  if (!worker) {
    worker = new Worker(getWorkerPath())

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'save-message') {
        saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
      } else if (msg.type === 'claude:event') {
        const ev = msg.event as { kind: string; text?: string; name?: string; summary?: string; input?: unknown }
        if (ev.kind === 'text_delta') {
          sendToRenderer('claude:delta', windowId, ev.text)
        } else if (ev.kind === 'tool_use') {
          const detail = JSON.stringify(ev.input)
          saveMessage(windowId, 'claude-action', '', JSON.stringify({ actionType: ev.name, summary: ev.summary, detail }))
          sendToRenderer('claude:action', windowId, { actionType: ev.name, summary: ev.summary, detail })
        }
      } else if (msg.type === 'turn-complete') {
        sendToRenderer('claude:turn-complete', windowId)
        if (msg.error) {
          sendToRenderer('claude:error', windowId, msg.error)
        }
        workers.delete(windowId)
      }
    })

    worker.on('error', (err) => {
      sendToRenderer('claude:turn-complete', windowId)
      sendToRenderer('claude:error', windowId, err.message)
      workers.delete(windowId)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && workers.has(windowId)) {
        sendToRenderer('claude:turn-complete', windowId)
        workers.delete(windowId)
      }
    })

    workers.set(windowId, worker)
  }

  worker.postMessage({ type: 'send', windowId, containerId, message, initialSessionId })
}

export function cancelClaudeDirect(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.terminate()
  workers.delete(windowId)
}
```

- [ ] **Step 8: Run all new tests**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/claudeService.test.ts tests/main/claudeDirectWorker.test.ts
```
Expected: PASS all.

- [ ] **Step 9: Commit**

```bash
git add window-manager/src/main/claudeDirectWorker.ts window-manager/src/main/claudeService.ts window-manager/tests/main/claudeDirectWorker.test.ts window-manager/tests/main/claudeService.test.ts
git commit -m "feat: add claudeDirectWorker and claudeService for direct Claude turns"
```

---

## Task 6: Wire IPC handlers and preload

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 1: Update `ipcHandlers.ts`**

**a) Add import for `claudeService`:**
```typescript
import { sendToClaudeDirectly, cancelClaudeDirect } from './claudeService'
```

**b) Remove `resumeWindow` from the `assistedWindowService` import:**
```typescript
import { sendToWindow, cancelWindow } from './assistedWindowService'
```

**c) Add new IPC handlers (after the existing assisted handlers):**
```typescript
// Direct Claude handlers
ipcMain.handle('claude:send', async (event, windowId: number, message: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const row = getDb()
    .prepare('SELECT container_id FROM windows WHERE id = ?')
    .get(windowId) as { container_id: string } | undefined
  if (!row) throw new Error(`Window ${windowId} not found`)

  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    win?.webContents.send(channel, ...args)
  }

  await sendToClaudeDirectly(windowId, row.container_id, message, sendToRenderer)
})

ipcMain.handle('claude:cancel', (_, windowId: number) => {
  cancelClaudeDirect(windowId)
})
```

**d) Remove the `assisted:resume` handler:**
```typescript
// DELETE this block:
ipcMain.handle('assisted:resume', (_, windowId: number, message: string) => {
  resumeWindow(windowId, message)
})
```

**e) Remove `windowType` validation from `window:create` handler** — replace the handler signature and body:
```typescript
ipcMain.handle(
  'window:create',
  async (event, name: string, projectIds: number[], withDeps = false, branchOverrides: Record<number, string> = {}, networkName = '') => {
    return createWindow(name, projectIds, withDeps, branchOverrides, (step) => event.sender.send('window:create-progress', step), undefined, networkName)
  }
)
```

- [ ] **Step 2: Update `preload/index.ts`**

**a) Update `createWindow` to remove `windowType` param:**
```typescript
createWindow: (name: string, projectIds: number[], withDeps: boolean = false, branchOverrides: Record<number, string> = {}, networkName: string = '') =>
  ipcRenderer.invoke('window:create', name, projectIds, withDeps, branchOverrides, networkName),
```

**b) Remove `assistedResume`:**
```typescript
// DELETE:
assistedResume: (windowId: number, message: string) =>
  ipcRenderer.invoke('assisted:resume', windowId, message),
```

**c) Add claude API methods after `assistedHistory`:**
```typescript
// Direct Claude API
claudeSend: (windowId: number, message: string) =>
  ipcRenderer.invoke('claude:send', windowId, message),
claudeCancel: (windowId: number) => ipcRenderer.invoke('claude:cancel', windowId),
onClaudeDelta: (callback: (windowId: number, chunk: string) => void) =>
  ipcRenderer.on('claude:delta', (_, windowId, chunk) => callback(windowId, chunk)),
offClaudeDelta: () => ipcRenderer.removeAllListeners('claude:delta'),
onClaudeAction: (callback: (windowId: number, action: { actionType: string; summary: string; detail: string }) => void) =>
  ipcRenderer.on('claude:action', (_, windowId, action) => callback(windowId, action)),
offClaudeAction: () => ipcRenderer.removeAllListeners('claude:action'),
onClaudeTurnComplete: (callback: (windowId: number) => void) =>
  ipcRenderer.on('claude:turn-complete', (_, windowId) => callback(windowId)),
offClaudeTurnComplete: () => ipcRenderer.removeAllListeners('claude:turn-complete'),
```

- [ ] **Step 3: Run the main tests to catch regressions**

```bash
cd window-manager && npm run test:main
```
Expected: all pass. If `ipcHandlers.test.ts` tests for `assisted:resume` exist, remove those test cases.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts
git commit -m "feat: wire claude:send/cancel IPC, add preload claude API, remove assisted:resume"
```

---

## Task 7: Update `AssistedPanel.svelte`

**Files:**
- Modify: `window-manager/src/renderer/src/components/AssistedPanel.svelte`
- Modify: `window-manager/tests/renderer/AssistedPanel.test.ts`

- [ ] **Step 1: Read current AssistedPanel test to understand mock patterns**

```bash
head -80 window-manager/tests/renderer/AssistedPanel.test.ts
```

- [ ] **Step 2: Write failing tests for new behavior**

Add to `window-manager/tests/renderer/AssistedPanel.test.ts`:

```typescript
it('shows recipient toggle with Claude as default', async () => {
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  const claudeRadio = screen.getByRole('radio', { name: /^Claude$/i })
  expect(claudeRadio).toBeChecked()
})

it('shows Shellephant radio disabled when Fireworks key not configured', async () => {
  // Mock getFireworksKeyStatus to return not configured
  vi.mocked(window.api.getFireworksKeyStatus).mockResolvedValue({ configured: false })
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  await vi.waitFor(() => {
    const shellRadio = screen.getByRole('radio', { name: /Shellephant/i })
    expect(shellRadio).toBeDisabled()
  })
})

it('renders shellephant message with Shellephant label', async () => {
  const history = [{ id: 1, role: 'shellephant', content: 'I can help', metadata: null }]
  vi.mocked(window.api.assistedHistory).mockResolvedValue(history)
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  await vi.waitFor(() => {
    expect(screen.getByText('Shellephant')).toBeInTheDocument()
    expect(screen.getByText('I can help')).toBeInTheDocument()
  })
})

it('renders claude message with Claude label', async () => {
  const history = [{ id: 1, role: 'claude', content: 'Here is the result', metadata: null }]
  vi.mocked(window.api.assistedHistory).mockResolvedValue(history)
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  await vi.waitFor(() => {
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Here is the result')).toBeInTheDocument()
  })
})

it('renders claude-action as collapsed mini-panel', async () => {
  const history = [{ id: 1, role: 'claude-action', content: '', metadata: JSON.stringify({ actionType: 'Write', summary: 'src/foo.ts', detail: '{}' }) }]
  vi.mocked(window.api.assistedHistory).mockResolvedValue(history)
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  await vi.waitFor(() => {
    expect(screen.getByText(/Write.*src\/foo\.ts/)).toBeInTheDocument()
  })
})

it('calls claudeSend when Claude toggle active', async () => {
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  const textarea = screen.getByRole('textbox')
  await userEvent.type(textarea, 'hello')
  await userEvent.keyboard('{Enter}')
  expect(window.api.claudeSend).toHaveBeenCalledWith(1, 'hello')
})

it('calls assistedSend when Shellephant toggle active', async () => {
  vi.mocked(window.api.getFireworksKeyStatus).mockResolvedValue({ configured: true })
  render(AssistedPanel, { props: { windowId: 1, containerId: 'c1' } })
  await vi.waitFor(() => screen.getByRole('radio', { name: /Shellephant/i }))
  await userEvent.click(screen.getByRole('radio', { name: /Shellephant/i }))
  const textarea = screen.getByRole('textbox')
  await userEvent.type(textarea, 'help')
  await userEvent.keyboard('{Enter}')
  expect(window.api.assistedSend).toHaveBeenCalledWith(1, 'help')
})
```

- [ ] **Step 3: Run to verify failures**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/AssistedPanel.test.ts
```
Expected: some new tests fail.

- [ ] **Step 4: Rewrite `AssistedPanel.svelte`**

Full replacement (script section):

```typescript
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { AssistedMessage } from '../types'

  interface Props {
    windowId: number
    containerId: string
  }

  let { windowId, containerId }: Props = $props()

  type Recipient = 'claude' | 'shellephant'

  interface DisplayMessage {
    id: number
    role: 'user' | 'shellephant' | 'claude' | 'claude-action'
    content: string
    metadata: string | null
    streaming?: boolean
    expanded?: boolean
  }

  let messages = $state<DisplayMessage[]>([])
  let input = $state('')
  let running = $state(false)
  let lastStats = $state<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null)
  let currentRecipient = $state<Recipient>('claude')
  let fireworksConfigured = $state(false)

  let mountActive = true
  let syntheticIdSeq = 0
  function nextId(): number {
    syntheticIdSeq += 1
    return Date.now() * 1000 + (syntheticIdSeq % 1000)
  }

  function mapLegacyRole(role: string): DisplayMessage['role'] | null {
    switch (role) {
      case 'user': return 'user'
      case 'shellephant': return 'shellephant'
      case 'assistant': return 'shellephant' // legacy
      case 'claude': return 'claude'
      case 'claude-action': return 'claude-action'
      case 'tool_result': return 'claude' // legacy
      default: return null
    }
  }

  onMount(() => {
    void window.api.getFireworksKeyStatus().then((s: { configured: boolean }) => {
      if (!mountActive) return
      fireworksConfigured = s.configured
    })

    // Register all IPC listeners before history fetch (prevents race)
    window.api.offAssistedKimiDelta?.()
    window.api.offAssistedTurnComplete?.()
    window.api.offClaudeDelta?.()
    window.api.offClaudeAction?.()
    window.api.offClaudeTurnComplete?.()

    window.api.onAssistedKimiDelta((wid: number, delta: string) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'shellephant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta }
      } else {
        messages = [...messages, { id: nextId(), role: 'shellephant', content: delta, metadata: null, streaming: true }]
      }
    })

    window.api.onAssistedTurnComplete((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => {
      if (!mountActive || wid !== windowId) return
      if (currentRecipient === 'shellephant') {
        running = false
        lastStats = stats
      }
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (error) {
        messages = [...messages, { id: nextId(), role: 'shellephant', content: `Error: ${error}`, metadata: null }]
      }
    })

    window.api.onClaudeDelta((wid: number, chunk: string) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'claude' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      } else {
        messages = [...messages, { id: nextId(), role: 'claude', content: chunk, metadata: null, streaming: true }]
      }
    })

    window.api.onClaudeAction((wid: number, action: { actionType: string; summary: string; detail: string }) => {
      if (!mountActive || wid !== windowId) return
      messages = [...messages, {
        id: nextId(),
        role: 'claude-action',
        content: '',
        metadata: JSON.stringify(action),
        expanded: false
      }]
    })

    window.api.onClaudeTurnComplete((wid: number) => {
      if (!mountActive || wid !== windowId) return
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (currentRecipient === 'claude') {
        running = false
      }
    })

    void (async () => {
      const history = await window.api.assistedHistory(windowId)
      if (!mountActive) return
      const historyItems: DisplayMessage[] = []
      for (const m of history as AssistedMessage[]) {
        const role = mapLegacyRole(m.role)
        if (!role) continue
        historyItems.push({ id: m.id, role, content: m.content, metadata: m.metadata, expanded: false })
      }
      const liveItems = messages.filter(m => !historyItems.some(h => h.id === m.id))
      messages = [...historyItems, ...liveItems]
    })()
  })

  onDestroy(() => {
    mountActive = false
    window.api.offAssistedKimiDelta?.()
    window.api.offAssistedTurnComplete?.()
    window.api.offClaudeDelta?.()
    window.api.offClaudeAction?.()
    window.api.offClaudeTurnComplete?.()
  })

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: nextId(), role: 'user', content: trimmed, metadata: null }]
    if (currentRecipient === 'claude') {
      await window.api.claudeSend(windowId, trimmed)
    } else {
      await window.api.assistedSend(windowId, trimmed)
    }
  }

  async function handleCancel(): Promise<void> {
    if (!confirm('Cancel current run? Conversation will be preserved.')) return
    if (currentRecipient === 'claude') {
      await window.api.claudeCancel(windowId)
    } else {
      await window.api.assistedCancel(windowId)
    }
    running = false
    messages = messages.map(m => ({ ...m, streaming: false }))
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function toggleExpand(id: number): void {
    messages = messages.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m)
  }

  function getActionLabel(metadata: string | null): string {
    if (!metadata) return 'action'
    try {
      const m = JSON.parse(metadata) as { actionType?: string; summary?: string }
      return `${m.actionType ?? 'action'}${m.summary ? ' — ' + m.summary : ''}`
    } catch {
      return 'action'
    }
  }

  function getActionDetail(metadata: string | null): string {
    if (!metadata) return ''
    try {
      const m = JSON.parse(metadata) as { detail?: string }
      return m.detail ?? ''
    } catch {
      return ''
    }
  }

  let messagesEl: HTMLDivElement | null = $state(null)
  let stickToBottom = $state(true)
  const NEAR_BOTTOM_PX = 40

  function onMessagesScroll(): void {
    if (!messagesEl) return
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop
    stickToBottom = distanceFromBottom <= NEAR_BOTTOM_PX
  }

  $effect(() => {
    const count = messages.length
    const last = messages[count - 1]
    const contentLen = last?.content?.length ?? 0
    void count; void contentLen
    if (!stickToBottom || !messagesEl) return
    const el = messagesEl
    queueMicrotask(() => { el.scrollTop = el.scrollHeight })
  })
</script>
```

Template section:

```svelte
<div class="assisted-panel">
  <div class="messages" bind:this={messagesEl} onscroll={onMessagesScroll}>
    {#each messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user">{msg.content}</div>
      {:else if msg.role === 'shellephant'}
        <div class="msg sender-bubble shellephant">
          <div class="sender-tag">Shellephant</div>
          <div class="bubble-content">{msg.content}</div>
        </div>
      {:else if msg.role === 'claude'}
        <div class="msg sender-bubble claude">
          <div class="sender-tag">Claude</div>
          <div class="bubble-content">{msg.content}</div>
        </div>
      {:else if msg.role === 'claude-action'}
        <div class="msg claude-action">
          <button class="action-toggle" onclick={() => toggleExpand(msg.id)} type="button">
            {msg.expanded ? '▾' : '▸'} {getActionLabel(msg.metadata)}
          </button>
          {#if msg.expanded}
            <pre class="action-detail">{getActionDetail(msg.metadata)}</pre>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  {#if lastStats}
    <div class="stats-bar">
      ↑ {lastStats.inputTokens.toLocaleString()} tokens
      ↓ {lastStats.outputTokens.toLocaleString()} tokens
      ~${lastStats.costUsd.toFixed(3)}
    </div>
  {/if}

  <div class="recipient-toggle">
    <label>
      <input type="radio" name="recipient-{windowId}" value="claude" bind:group={currentRecipient} />
      Claude
    </label>
    <label title={!fireworksConfigured ? 'Set Fireworks API key in Settings' : ''}>
      <input
        type="radio"
        name="recipient-{windowId}"
        value="shellephant"
        disabled={!fireworksConfigured}
        bind:group={currentRecipient}
      />
      Shellephant
    </label>
  </div>

  <div class="input-row">
    <textarea
      placeholder={currentRecipient === 'claude' ? 'Ask Claude…' : 'Ask Shellephant…'}
      bind:value={input}
      disabled={running}
      onkeydown={handleKey}
      rows={2}
    ></textarea>
    <div class="input-actions">
      {#if running}
        <button type="button" class="cancel-btn" onclick={handleCancel} aria-label="Cancel">Cancel</button>
      {:else}
        <button type="button" class="send-btn" onclick={send} disabled={!input.trim()} aria-label="Send">
          Send
        </button>
      {/if}
    </div>
  </div>
</div>
```

Style additions (keep existing styles, add/update):

```css
.sender-bubble {
  align-self: stretch;
  max-width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.5;
  word-break: break-word;
}

.sender-bubble.shellephant {
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.35);
  color: var(--fg-0);
}

.sender-bubble.claude {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: var(--fg-0);
}

.sender-tag {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.shellephant .sender-tag { color: rgb(96, 165, 250); }
.claude .sender-tag { color: rgb(52, 211, 153); }

.bubble-content { white-space: pre-wrap; }

.claude-action {
  align-self: stretch;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8rem;
  padding: 0.35rem 0.6rem;
}

.action-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--fg-2);
  padding: 0;
  text-align: left;
  width: 100%;
  font-family: var(--font-mono);
}

.action-toggle:hover { color: var(--fg-0); }

.action-detail {
  margin: 0.4rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--fg-1);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

.recipient-toggle {
  display: flex;
  gap: 1rem;
  padding: 0.35rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.8rem;
}

.recipient-toggle label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  color: var(--fg-1);
}

.recipient-toggle label:has(input:checked) { color: var(--fg-0); }
.recipient-toggle label:has(input:disabled) { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 5: Run renderer tests**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/AssistedPanel.test.ts
```
Expected: PASS. Remove outdated tests for `ping_user`, `pingActive`, `tool_call`, `tool_result` roles. Update any assertions checking for "Kimi" label to check "Shellephant".

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/AssistedPanel.svelte window-manager/tests/renderer/AssistedPanel.test.ts
git commit -m "feat: unified AssistedPanel with Claude/Shellephant toggle and new message roles"
```

---

## Task 8: Cleanup — TerminalHost, WindowDetailPane, NewWindowWizard

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`
- Modify: `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 1: Update `TerminalHost.svelte`**

**a) In `onMount` — remove the `if (win.window_type !== 'assisted')` guard** (lines 212–236). Delete the claude XTerm initialization block entirely. All windows now use AssistedPanel; no XTerm for the `claude` session.

**b) In `onDestroy` — remove `window_type` guard:**
```svelte
// Replace:
if (win.window_type !== 'assisted') {
  window.api.closeTerminal(win.container_id, 'claude')
}
// With: nothing (no claude terminal to close)
```

**c) In the template — always render `AssistedPanel` for the claude panel:**
```svelte
{#if panel.id === 'claude'}
  <AssistedPanel windowId={win.id} containerId={win.container_id} />
{:else if panel.id === 'terminal'}
  <div class="terminal-inner" bind:this={terminalEl}></div>
{:else if panel.id === 'editor'}
  <EditorPane bind:this={editorPaneRef} containerId={win.container_id} roots={editorRoots} />
{/if}
```

**d) Remove the `claudeTerminalEl`, `claudeTerm`, `claudeFitAddon`, `claudeResizeObserver`, `postMountClaudeEffectPending` state variables** (all related to the claude XTerm). Also remove `reinitClaudeTerminal()`, `attachClaudeScrollInterceptor()` functions, and the `$effect` clause that handles `claudePanel` re-attachment (keep the `termPanel` part).

**e) Remove the `sessionType === 'claude'` branch in `onTerminalData`:**
```typescript
// Replace:
if (sessionType === 'claude') claudeTerm?.write(data)
else term?.write(data)
// With:
if (sessionType === 'terminal') term?.write(data)
```

- [ ] **Step 2: Update `WindowDetailPane.svelte`**

Find line 220:
```svelte
{#each (['claude', 'terminal', 'editor'] as const).filter(id => id !== 'claude' || win.window_type !== 'assisted') as id}
```
Replace with:
```svelte
{#each (['claude', 'terminal', 'editor'] as const) as id}
```

- [ ] **Step 3: Update `NewWindowWizard.svelte`**

**a) Remove the `windowType` state:** Delete `let windowType = $state<'manual' | 'assisted'>('manual')`

**b) Remove Fireworks key check in `onMount`** (the check for `fireworksConfigured` used to disable the Assisted radio — this logic no longer needed at creation time).

**c) Remove the type toggle UI block** (the `.type-toggle` div containing Manual/Assisted radio buttons).

**d) Update `handleSubmit`** — remove `windowType` from the `createWindow` call:
```typescript
const win = await window.api.createWindow(name, ids, withDeps, branchOverrides)
```

- [ ] **Step 4: Run renderer tests**

```bash
cd window-manager && npm run test:renderer
```
Expected: PASS. Remove test cases from `TerminalHost.test.ts` that check `window_type === 'assisted'` shows AssistedPanel and `window_type === 'manual'` shows XTerm (now ALL windows show AssistedPanel). Update `NewWindowWizard.test.ts` to remove type toggle tests. Update `WindowDetailPane.test.ts` to remove the claude-button-hidden-for-assisted test.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/TerminalHost.test.ts window-manager/tests/renderer/WindowDetailPane.test.ts window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat: remove window_type guards, all windows use AssistedPanel"
```

---

## Task 9: Rename Kimi → Shellephant in display strings and system prompt

**Files:**
- Modify: `window-manager/src/shared/defaultKimiPrompt.ts`
- Modify: `window-manager/src/main/assistedWindowService.ts` (import rename)
- Modify: `window-manager/src/main/assistedWindowWorker.ts` (import rename)

- [ ] **Step 1: Update `src/shared/defaultKimiPrompt.ts`**

Update the prompt content and exported names:

```typescript
export const DEFAULT_SHELLEPHANT_SYSTEM_PROMPT = `You are an autonomous coding assistant called Shellephant. Orchestrate Claude Code (CC) session inside dev container.

User says "the app" → means current project's app. CC already has context; don't re-discover.
If CC was told something earlier this session, it still has it. Don't repeat.

NO emojis. Focus on clear, concise text.

Channels (CRITICAL):
- Plain completion text → USER only. Never reaches CC.
- CC sees only run_claude_code payloads.
- To reply to CC you MUST call run_claude_code. Plain text answer goes to user; CC stays blind.
- Session continuity auto-managed.

Turn-taking (CRITICAL):
- Max ONE run_claude_code per turn. Wait for output before next step. Never batch.
- CC output with question/confirmation → next action MUST be run_claude_code (answer to CC). Never answer CC via plain text.
- Plain text only for: status, summaries, final results to user. Never to reply to CC.

CC question needing judgment:
1. CC gives rec, sensible, not security/privacy/ethics → accept.
2. CC gives rec, answer derivable from user prefs → answer from prefs.
3. No rec but 99% sure from user prefs → answer.
4. Else → respond to user asking for input.

run_claude_code = coding tasks. When stuck without human input, send a response to the user asking for clarification — prefer self-resolve.
Task done → summarize to user.

Format for user: short paragraphs, bullets. No raw code/terminal dumps without explanation.

CC claims full project done → force it to:
1. Security-audit own work.
2. Confirm all planned steps complete.
3. Confirm tested per app instructions.
Any missed → not done.

Tell user when fully done with workflow.`

// Keep old name as alias for backward compat with any external references
export const DEFAULT_KIMI_SYSTEM_PROMPT = DEFAULT_SHELLEPHANT_SYSTEM_PROMPT

export function resolveShellephantSystemPrompt(
  projectPrompt: string | null | undefined,
  globalPrompt: string | null | undefined
): string {
  if (projectPrompt && projectPrompt.trim()) return projectPrompt
  if (globalPrompt && globalPrompt.trim()) return globalPrompt
  return DEFAULT_SHELLEPHANT_SYSTEM_PROMPT
}

// Alias for backward compat
export const resolveKimiSystemPrompt = resolveShellephantSystemPrompt
```

- [ ] **Step 2: Run all tests**

```bash
cd window-manager && npm test
```
Expected: all pass. The `resolveSystemPrompt` test that checks `contains('autonomous coding assistant')` should still pass since the prompt still contains that text.

- [ ] **Step 3: Commit**

```bash
git add window-manager/src/shared/defaultKimiPrompt.ts
git commit -m "feat: rename Kimi to Shellephant in system prompt and display strings"
```

---

## Task 10: Full test run and cleanup

- [ ] **Step 1: Run entire test suite**

```bash
cd window-manager && npm test
```
Expected: all pass.

- [ ] **Step 2: Fix any remaining failures**

Common issues to watch for:
- `assistedWindowService.test.ts`: remove `resumeWindow` describe block; update `'Kimi responded'` notification title to `'Shellephant responded'`
- `assistedWindowWorker.test.ts`: update `buildKimiTools` describe block to `buildShellephantTools`; remove any `ping_user` handling tests
- `AssistedPanel.test.ts`: remove tests for `ping_user`, `pingActive`, `handlePingReply`, "Reply to Kimi…" placeholder, "Ask Kimi…" placeholder; update assertions checking for "Kimi" tag to "Shellephant"
- `NewWindowWizard.test.ts`: remove Manual/Assisted type toggle tests; remove Fireworks key validation at creation tests
- `TerminalHost.test.ts`: remove tests that check `window_type === 'assisted'` renders `AssistedPanel`; update to just confirm `AssistedPanel` always renders

- [ ] **Step 3: Final commit**

```bash
cd window-manager && npm test
git add -A
git commit -m "fix: clean up all test files for unified window model"
```

---

## Self-Review Checklist

Spec requirements → task coverage:

| Spec requirement | Task |
|-----------------|------|
| Remove window_type distinction | Tasks 6, 8 |
| All windows use AssistedPanel UI | Task 8 (TerminalHost) |
| Claude/Shellephant toggle, Claude default | Task 7 (AssistedPanel) |
| Shellephant disabled without Fireworks key | Task 7 |
| Claude path: direct docker exec, chat bubble | Tasks 1, 5, 6 |
| `claude-action` mini-panels (collapsed) | Tasks 4, 5, 7 |
| `claude:delta` streaming text | Tasks 1, 4, 5, 7 |
| Shellephant has no ping_user | Task 3 |
| Shellephant response = user alert | Task 4 (notification) |
| Unified history, Shellephant sees all turns | Task 2 |
| Legacy roles backward compat | Task 2 |
| DB no schema changes | Task 2 (note: no ALTER TABLE) |
| `createWindow` drops windowType param | Task 6 |
