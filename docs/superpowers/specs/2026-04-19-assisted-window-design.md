# Assisted Window Type — Design Spec

**Date:** 2026-04-19  
**Status:** Approved

## Overview

Add a second window type — `assisted` — alongside the existing `manual` type. Assisted windows replace the Claude terminal panel with a chat UI driven by Kimi 2.5 (Fireworks AI). Kimi autonomously orchestrates a Claude Code SDK session inside the dev container, looping until the task is complete or it needs human input.

---

## 1. Database Schema

### `windows` table
Add column:
```sql
ALTER TABLE windows ADD COLUMN window_type TEXT NOT NULL DEFAULT 'manual';
-- values: 'manual' | 'assisted'
```

### `settings` table
One new encrypted entry and one plain text entry:
- `fireworks_api_key` — encrypted via `safeStorage` (same pattern as `claude_token`)
- `kimi_system_prompt` — plain text, stored as regular DB row (not encrypted)

### `projects` table
```sql
ALTER TABLE projects ADD COLUMN kimi_system_prompt TEXT DEFAULT NULL;
-- NULL = use global default
```

### New table `assisted_messages`
```sql
CREATE TABLE assisted_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id  INTEGER NOT NULL REFERENCES windows(id),
  role       TEXT NOT NULL,
  -- 'user' | 'assistant' | 'tool_result' | 'ping_user'
  content    TEXT NOT NULL,
  metadata   TEXT DEFAULT NULL,
  -- JSON: { token_stats?, cost_usd?, tool_name?, session_id?, error?, complete? }
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Conversation history persists across restarts. Cancel stops the run — it does not delete history.

---

## 2. Worker Architecture

### Files
- `src/main/assistedWindowWorker.ts` — worker thread, owns Kimi loop
- `src/main/assistedWindowService.ts` — manages `Map<windowId, Worker>`, brokers IPC

### `assistedWindowService.ts`
- On `assisted:send` IPC from renderer → looks up or spawns worker for `windowId` → posts message
- On `assisted:cancel` IPC → calls `worker.terminate()` → removes from map
- Listens to `worker.on('message')` → forwards to renderer via appropriate IPC channel
- Listens to `worker.on('error')` and `worker.on('exit')` → sends `assisted:turn-complete` with error flag

### `assistedWindowWorker.ts` loop
1. Receives `{ type: 'send', message, windowId, containerId, conversationHistory, systemPrompt }`
2. Appends user message to local history
3. Calls Fireworks API (streaming) with Kimi model + two tools
4. On `run_claude_code` tool call:
   - Runs Claude Code SDK in container (see Section 3)
   - Streams stdout chunks → `parentPort.postMessage({ type: 'stream-chunk', chunk })`
   - Returns `{ session_id, output }` to Kimi
5. On `ping_user` tool call:
   - Posts `{ type: 'ping-user', message }` to main
   - Awaits `{ type: 'resume', message }` — loop paused here
   - Injects user reply as next user turn and continues
6. When Kimi returns no tool calls → posts `{ type: 'turn-complete', tokenStats }`

Each message persisted to `assisted_messages` immediately (not batched).

### IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `assisted:send` | renderer → main | user message |
| `assisted:cancel` | renderer → main | cancel current run |
| `assisted:stream-chunk` | main → renderer | live Claude Code output |
| `assisted:kimi-delta` | main → renderer | Kimi reasoning text |
| `assisted:ping-user` | main → renderer | Kimi needs human input |
| `assisted:turn-complete` | main → renderer | run done + token stats |
| `assisted:history` | renderer → main (invoke) | load conversation history |

---

## 3. Kimi Integration

### API
- Endpoint: Fireworks AI OpenAI-compatible chat completions
- Model: `accounts/fireworks/models/kimi-k2-instruct`
- Streaming enabled

### Tools

**`run_claude_code`**
```json
{
  "session_id": "string | null",
  "message": "string"
}
```
Returns `{ session_id, output }`. Pass `null` to start a new session.

**`ping_user`**
```json
{
  "message": "string"
}
```
Pauses the loop. Sends OS notification + `assisted:ping-user` IPC. Resumes when user replies via chat input.

### Claude Code SDK in Container
Worker executes:
```
docker exec <containerId> node /usr/local/bin/cw-claude-sdk.js <session_id|new> "<message>"
```

`cw-claude-sdk.js` is a small script baked into the container image (requires a Dockerfile update to the `cc` image) that:
- Uses `@anthropic-ai/claude-code` SDK
- Streams output lines to stdout (worker forwards as `stream-chunk`)
- Writes final session_id to stderr
- Exits 0 on success, non-zero on error

Session ID stored in worker memory and in `metadata.session_id` of the most recent `tool_result` message (for recovery on app restart).

### Default System Prompt
```
You are an autonomous coding assistant orchestrating a Claude Code session inside a development container.
Use run_claude_code to execute coding tasks. Use ping_user only when you genuinely cannot proceed without human input — prefer to resolve ambiguity yourself.
When the task is complete, summarize what was accomplished.
```

### System Prompt Resolution
1. If project has `kimi_system_prompt` set → use project prompt
2. Else if global `kimi_system_prompt` set → use global prompt
3. Else → use default prompt above

### Token/Cost Stats
Extracted from Fireworks response `usage` field per turn:
`{ input_tokens, output_tokens, cost_usd }` stored in `metadata` of `assistant` message and displayed in UI.

---

## 4. Assisted Panel UI

### `AssistedPanel.svelte`
Replaces the Claude xterm panel in assisted windows. Terminal + editor panels unchanged.

### Message Rendering
| Role | Appearance |
|---|---|
| `user` | Right-aligned bubble, plain text |
| `assistant` | Left-aligned, Kimi reasoning/summary |
| `tool_result` | Collapsible "Claude Code output" block — collapsed by default, streams live while running |
| `ping_user` | Amber alert card with Kimi's message |

### Footer Stats Bar
Shown after each completed turn:
```
↑ 1,240 tokens  ↓ 890 tokens  ~$0.003
```

### Input Area
- Textarea + Send button
- While running: Send disabled, Cancel button appears
- Cancel → confirmation dialog: "Cancel current run? Conversation will be preserved." → confirm → `assisted:cancel`

### Window Creation
Existing creation flow gets a type toggle: `Manual` / `Assisted`.  
If no Fireworks API key is set, Assisted is disabled with tooltip "Set Fireworks API key in Settings".

### `TerminalHost.svelte` Change
When `win.window_type === 'assisted'`, render `<AssistedPanel>` instead of Claude xterm panel.  
`WindowDetailPane` hides the Claude toggle button for assisted windows.

---

## 5. Settings UI

On the existing settings screen (where Claude token is entered), add a **Fireworks API Key** section:
- Masked text input
- Save / Clear buttons
- Status indicator: "Set" / "Not set"

IPC handlers: `settings:set-fireworks-key`, `settings:get-fireworks-key-status`, `settings:clear-fireworks-key`

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| Fireworks API failure | Worker posts `{ type: 'error' }` → error card in chat, run ends, input re-enabled. Stored as `assistant` message with `metadata.error: true` |
| `docker exec` failure | `run_claude_code` returns error string to Kimi — Kimi decides to retry or `ping_user`. Worker does not crash. |
| Worker crash | `assistedWindowService` catches `worker.on('error')` / `worker.on('exit')` → sends `assisted:turn-complete` with error flag to renderer |
| Stale session ID on restart | Claude Code SDK starts new session, returns new session_id. Transparent to user. |
| App closed mid-run | Worker terminates with process. Last `tool_result` message marked `[interrupted]` if `metadata.complete !== true` |
| `ping_user` while window focused | Skip OS notification. Show alert card in chat UI only. |
| `ping_user` while window not focused | OS notification (same mechanism as manual window waiting alert) + chat card |

---

## 7. Testing

- Unit tests for `assistedWindowService.ts`: worker lifecycle, cancel, map cleanup
- Unit tests for `assistedWindowWorker.ts`: tool dispatch, ping_user pause/resume, error paths
- Unit tests for `AssistedPanel.svelte`: message rendering, cancel confirmation, stats bar, streaming append
- Integration: Fireworks API call mocked — verify full loop (send → tool call → stream → complete)
- DB migration tests: schema changes, message persistence, history load
