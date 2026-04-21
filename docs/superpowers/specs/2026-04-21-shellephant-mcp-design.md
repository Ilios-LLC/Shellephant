# Shellephant MCP Integration Design

**Date:** 2026-04-21  
**Status:** Approved  
**Scope:** `assistedWindowWorker.ts`, new `mcpManager.ts`, minor update to `assistedWindowService.ts`

---

## Overview

Replace Shellephant's hand-rolled `kimiLoop` (direct OpenAI SDK calls + manual tool dispatch) with Vercel AI SDK's `streamText`, and wire in the Playwright MCP server as the first MCP tool provider. Shellephant (Kimi K2 via Fireworks) gains direct access to a browser on the host machine. No renderer, IPC, or DB schema changes.

---

## Dependencies

| Package | Role |
|---|---|
| `ai` (pinned exact version) | `streamText`, `tool`, `experimental_createMCPClient`, `Experimental_StdioMCPTransport` |
| `@ai-sdk/openai` | Fireworks-compatible OpenAI provider via `createOpenAI({ baseURL, apiKey })` |
| `@playwright/mcp` | Playwright MCP server binary (host-installed) |
| `zod` | Tool parameter schemas (already present in repo) |

---

## Architecture

### Unchanged

- `assistedWindowService.ts` — worker pool, IPC handlers, `parentPort` message protocol (cancel flow gets one addition — see below)
- All renderer components — no surface area changes
- DB schema, IPC channel names, `parentPort` message types
- `claudeDirectWorker.ts`, `claudeService.ts`, `claudeRunner.ts`

### New: `mcpManager.ts`

Thin module owning MCP client lifecycle. Exported interface:

```ts
type McpServerConfig = {
  command: string
  args: string[]
  env?: Record<string, string>
}

type McpClient = {
  tools(): Promise<ToolSet>  // AI SDK ToolSet
  close(): Promise<void>
}

async function createMcpClient(servers: McpServerConfig[]): Promise<McpClient | null>
```

- Spawns each server via `Experimental_StdioMCPTransport`
- Wraps each in `experimental_createMCPClient`
- Merges all tool sets into one flat `ToolSet`
- Returns `null` on init failure (worker continues without MCP tools)

### Modified: `assistedWindowWorker.ts`

`kimiLoop` replaced by `streamTurn`. `processStreamChunk` and manual `while(true)` loop removed. `buildShellephantTools` removed (tools now assembled dynamically per turn).

**MCP client lifecycle:**  
Created once on first `send` message, reused across all turns in the window. Each worker thread has its own MCP client → own `@playwright/mcp` process → isolated browser session per window. No cross-window state.

**Tool set per turn:**

```ts
const mcpTools = mcpClient ? await mcpClient.tools() : {}

const tools = {
  run_claude_code: tool({
    description: 'Send a message to Claude Code inside the container...',
    parameters: z.object({ message: z.string() }),
    execute: async ({ message }) => { /* existing handleRunClaudeCode logic */ }
  }),
  ...mcpTools
}
```

**Streaming loop:**

```ts
const result = streamText({
  model: createOpenAI({ baseURL: 'https://api.fireworks.ai/inference/v1', apiKey: fireworksKey })('accounts/fireworks/models/kimi-k2p5'),
  messages,
  tools,
  maxSteps: 20
})

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      parentPort?.postMessage({ type: 'kimi-delta', windowId, delta: part.textDelta })
      break
    case 'tool-call':
      parentPort?.postMessage({ type: 'tool-call', windowId, toolName: part.toolName, message: part.args?.message })
      break
    case 'finish':
      // token counts from result.usage after loop
      break
  }
}

const { promptTokens, completionTokens } = await result.usage
```

**Session tracking:**  
`activeSessionId` mutation across `run_claude_code` calls within a turn managed via closure ref object:
```ts
const sessionRef = { value: initialSessionId ?? null }
// execute fn reads/writes sessionRef.value
```

### Modified: `assistedWindowService.ts`

**Cancel flow updated:**  
`cancelWindow` sends `{ type: 'cancel' }` message to worker, waits 500ms for graceful MCP cleanup, then calls `worker.terminate()`.

Worker handles `cancel` message: calls `mcpClient?.close()` then `process.exit(0)`.

---

## MCP Server Configuration

Initial config (Playwright only):

```ts
const MCP_SERVERS: McpServerConfig[] = [
  {
    command: 'npx',
    args: ['@playwright/mcp@latest'],
  }
]
```

Config is a module-level constant in `mcpManager.ts`. Adding future MCP servers = append to this array.

---

## Error Handling

| Failure | Behavior |
|---|---|
| MCP init failure (not installed, crash on spawn) | `createMcpClient` returns `null`; turn proceeds with `run_claude_code` only; error logged |
| MCP tool call throws during turn | Vercel SDK catches, passes error string to model as tool result; model retries or reports |
| `streamText` throws (network, API error) | Caught by existing try/catch in `parentPort.on('message')`; posts `turn-complete` with error |
| Worker terminated mid-MCP-call | `mcpClient.close()` called on cancel message; MCP process killed with worker |

---

## Testing

### New: `mcpManager.test.ts`

- Tools fetched on init from all configured servers
- Multiple server tool sets merged into one flat ToolSet
- Init failure (spawn throws) → returns `null`
- `close()` called on all clients

### Updated: `assistedWindowWorker.test.ts`

- Replace `OpenAI` mock with `streamText` mock (vi.hoisted pattern)
- Mock `mcpManager.createMcpClient` → returns fixed ToolSet
- Existing assertions on `kimi-delta`, `tool-call`, `save-message`, `turn-complete` messages remain valid
- Add: MCP tool appears in tools passed to `streamText`
- Add: MCP init failure → turn completes with `run_claude_code` only
- Add: `sessionRef.value` updated correctly across multiple `run_claude_code` calls in one turn

### Updated: `assistedWindowService.test.ts`

- Cancel sends `{ type: 'cancel' }` message before `worker.terminate()`

### Out of scope

No E2E tests for Playwright MCP integration — manual smoke test on first ship.

---

## Open Questions

- Exact binary invocation for `@playwright/mcp` when installed as local dep (vs `npx`) — verify during implementation.
- `maxSteps: 20` — may need tuning based on real usage.
