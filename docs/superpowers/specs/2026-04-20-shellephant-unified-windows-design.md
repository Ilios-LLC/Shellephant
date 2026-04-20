# Shellephant Unified Windows Design

**Date:** 2026-04-20
**Status:** Approved

## Summary

Remove the `manual` / `assisted` window type distinction. Every window gets a single unified chat UI (the current AssistedPanel style). Users toggle the recipient on the input: **Claude** (default) or **Shellephant** (available only when Fireworks API key is configured). All conversation turns — regardless of recipient — are persisted to a shared history and passed to Shellephant on every invocation.

---

## Architecture

```
User message
  │
  ├─ [toggle: Claude] ──► claudeService ──► claudeDirectWorker
  │                            │                    │
  │                            │          docker exec cw-claude-sdk.js
  │                            │                    │
  │                            │        ┌───────────┴───────────┐
  │                            │   tool use events         text chunks
  │                            │   (claude-action)         (claude bubble)
  │                            └── save to history
  │
  └─ [toggle: Shellephant] ──► assistedWindowService ──► Worker (Shellephant loop)
                                    │                         │
                                    │              ┌──────────┴──────────┐
                                    │         run_claude_code        text response
                                    │         [same Claude stream       (Shellephant bubble)
                                    │          pipeline as above]
                                    └── save to history
```

Both paths emit the same IPC events (`claude:action`, `claude:delta`, `claude:complete`) for Claude output. `AssistedPanel` uses one set of listeners regardless of whether Claude was called directly or via Shellephant.

Shellephant receives the full unified history on every invocation, including prior direct-Claude turns.

---

## Data Model

### `assisted_messages` table

No schema changes. New role values added; legacy roles supported via fallback mapping for existing rows.

| role | meaning |
|------|---------|
| `user` | user message |
| `shellephant` | Shellephant text response (was `assistant`) |
| `claude` | Claude's streamed assistant text |
| `claude-action` | single tool use event (Write, Read, Bash, etc.) |
| ~~`ping_user`~~ | removed — no new rows written |
| ~~`tool_call`~~ | removed — no new rows written |
| ~~`tool_result`~~ | removed — no new rows written |

**`claude-action` metadata shape:**
```json
{
  "actionType": "Write" | "Read" | "Bash" | "TodoWrite" | "...",
  "summary": "short label shown in collapsed panel",
  "detail": "full content shown when expanded",
  "session_id": "abc123"
}
```

### History → Shellephant mapping (OpenAI-compatible)

| DB role | OpenAI mapping |
|---------|---------------|
| `user` | `{role: 'user', content}` |
| `shellephant` | `{role: 'assistant', content}` |
| `claude` + preceding `claude-action` rows | Collapsed into `{role: 'user', content: '[Claude did X, Y, Z and responded: ...]'}` |
| `claude-action` without adjacent `claude` | Omitted |
| Legacy `assistant` | Treated as `shellephant` |
| Legacy `tool_result` | Treated as `claude` |
| Legacy `tool_call` / `ping_user` | Omitted |

### `windows` table

`window_type` column stays in DB — no destructive migration. Column value ignored by all new code. `createWindow` no longer accepts a `windowType` parameter.

---

## UI Components

### `AssistedPanel.svelte`

- **Recipient toggle** on input: "Claude" (default) | "Shellephant" (hidden if no Fireworks key). State is component-local, not persisted.
- **Message rendering** — four visual types:
  - `user` → right-aligned bubble (unchanged)
  - `shellephant` → left-aligned bubble, labeled "Shellephant"
  - `claude` → left-aligned bubble, labeled "Claude", streams in real-time
  - `claude-action` → compact collapsed row (e.g. "✎ Write — src/foo.ts"), click to expand full detail
- **Send logic:** toggle = Claude → `window.api.claudeSend(windowId, message)`; toggle = Shellephant → `window.api.assistedSend(windowId, message)`
- Remove `pingActive` state and all `ping_user` handling
- Remove `handlePingReply()` — all sends go through toggle path
- IPC listeners: add `claude:delta`, `claude:action`, `claude:complete` alongside existing `assistedKimiDelta`, `assistedTurnComplete`

### `NewWindowWizard.svelte`

- Remove Manual/Assisted radio buttons entirely
- Remove Fireworks key check at creation time (check moved to send time)

### `WindowDetailPane.svelte`

- Remove `window_type === 'assisted'` guard that filtered out the Claude panel toggle

### `TerminalHost.svelte`

- Always render `AssistedPanel` for the Claude panel slot
- Remove `window_type !== 'assisted'` guard on xterm claude session creation
- Remove `closeTerminal(..., 'claude')` on destroy guard

---

## Direct-to-Claude Service

### `src/main/claudeService.ts` (new)

**`sendToClaudeDirectly(windowId, containerId, message, sendToRenderer)`:**
1. Save user message to DB (role: `user`)
2. Load last `session_id` from history via `loadLastSessionId(windowId)`
3. Spawn/reuse Worker from `claudeDirectWorker.ts`, keyed by `windowId`
4. Worker posts back events; main process:
   - `claude-action` → DB insert + IPC `claude:action` to renderer
   - `claude:delta` → IPC to renderer (text streaming)
   - `claude:complete` → DB insert (role: `claude`) + IPC to renderer + worker cleanup

**`cancelClaudeDirect(windowId)`:** Terminate worker, remove from map.

### `src/main/claudeDirectWorker.ts` (new)

Runs `docker exec <container> node cw-claude-sdk.js <sessionId|new> <message>`.
Parses stream via `StreamFilterBuffer` (extracted shared util).
Posts to parent:
- `{type: 'claude-action', actionType, summary, detail, session_id}` per tool use event
- `{type: 'claude:delta', chunk}` per text chunk
- `{type: 'claude:complete', fullText, session_id}` at end

### `src/main/streamFilter.ts` (new — extracted)

`StreamFilterBuffer` moved from `assistedWindowWorker.ts` to shared util. Imported by both `claudeDirectWorker.ts` and `assistedWindowWorker.ts`.

### New IPC channels

| channel | direction | purpose |
|---------|-----------|---------|
| `claude:send` | renderer → main | trigger direct Claude call |
| `claude:cancel` | renderer → main | cancel running direct call |
| `claude:delta` | main → renderer | streaming text chunk |
| `claude:action` | main → renderer | tool use event (mini-panel) |
| `claude:complete` | main → renderer | turn finished |

---

## Shellephant Changes

### Rename

All display strings, comments, and the default system prompt updated: "Kimi" → "Shellephant". Model and Fireworks API endpoint unchanged.

### Remove `ping_user`

- `buildKimiTools()` → `buildShellephantTools()` — returns only `run_claude_code`
- `handlePingUser()` removed from worker
- `resumeWindow()` removed from `assistedWindowService.ts`
- `assisted:resume` IPC handler + preload channel removed
- Worker loop: text response with no tool calls → post `turn-complete`, done. No blocking.

### `run_claude_code` output → unified Claude events

Worker replaces `stream-event` / `turn-complete` blob emissions with the same granular events as the direct path:
- `claude:action` per tool use event
- `claude:delta` per text chunk
- `claude:complete` at end

`assistedWindowService.ts` forwards these same channels to renderer.

### History

`loadHistory(windowId)` updated to map new and legacy roles per the mapping table above. Full history passed to Shellephant — no filtering by source.

---

## Migration & Cleanup

### DB

- No `ALTER TABLE`. `window_type` column stays, ignored.
- Existing rows with legacy roles handled by fallback mapping in `loadHistory()`.

### Files added

| file | purpose |
|------|---------|
| `src/main/claudeService.ts` | direct-Claude service (worker pool manager) |
| `src/main/claudeDirectWorker.ts` | worker: docker exec + stream parsing for direct Claude |
| `src/main/streamFilter.ts` | extracted `StreamFilterBuffer` shared util |

### Tests

| file | change |
|------|--------|
| `assistedWindowService.test.ts` | remove `resumeWindow` tests, update role names |
| `assistedWindowWorker.test.ts` | remove `ping_user` tests, rename tool builder |
| `NewWindowWizard.test.ts` | remove type toggle tests |
| `AssistedPanel` tests | update for new roles, toggle UI, removed ping state |
| `claudeService.test.ts` | new |
| `claudeDirectWorker.test.ts` | new |
| `streamFilter.test.ts` | new |
