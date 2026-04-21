# Safe Restart Design

**Date:** 2026-04-21

## Context

When the app restarts (or crashes) while a Claude direct or Shellephant turn is in-flight, the result is:

- Worker threads die → streaming output lost
- `turns` rows stuck at `status='running'` forever (DB rot)
- UI shows no indication anything was interrupted
- User has no path to recover

Missed streaming output is unrecoverable (no SDK API for session history replay, docker exec streams die with parent). Goal: clean up DB state, surface interruption in UI, let user re-send.

## Scope

- Add `orphaned` turn status
- Mark running turns orphaned on graceful shutdown (`before-quit`) and on startup (crash recovery)
- Terminate workers on shutdown
- Show orphaned-turn bubble in `AssistedPanel` with re-send button

Out of scope: auto-retry, session output replay, reconnecting to orphaned docker exec.

---

## Architecture

### 1. Turn Status: `orphaned`

`turns.status` is `TEXT` — no migration needed. Valid values become:
`running | success | error | orphaned`

New function in `logWriter.ts`:
```ts
export function markOrphanedTurns(db: Database): void
// UPDATE turns SET status='orphaned' WHERE status='running'
```

### 2. Graceful Shutdown (`index.ts`)

Register `before-quit` handler after `app.whenReady()`:

```ts
app.on('before-quit', async (e) => {
  e.preventDefault()
  terminateAllWorkers()          // claudeService.ts
  terminateAllAssistedWorkers()  // assistedWindowService.ts
  markOrphanedTurns(getDb())
  app.exit(0)
})
```

### 3. Startup Crash Recovery (`index.ts`)

Call immediately after `app.whenReady()` resolves, before `reconcileWindows()`:

```ts
markOrphanedTurns(getDb())
```

Handles case where `before-quit` never fired (force-kill, crash).

### 4. Worker Termination

New bulk exports (iterate existing `workers` Map, call `worker.terminate()`):

- `terminateAllWorkers()` in `claudeService.ts`
- `terminateAllAssistedWorkers()` in `assistedWindowService.ts`

Both reuse existing per-window cancel logic internally.

### 5. IPC: History + Orphaned Turns

Extend `assisted:history` response shape:

```ts
// Before
AssistedMessage[]

// After
{ messages: AssistedMessage[], orphanedTurns: OrphanedTurn[] }

// OrphanedTurn
{ id: string, started_at: number, turn_type: string }
```

New DB query in `db.ts`:
```ts
export function getOrphanedTurns(db: Database, windowId: number): OrphanedTurn[]
// SELECT id, started_at, turn_type FROM turns
// WHERE window_id=? AND status='orphaned'
// ORDER BY started_at ASC
```

Update `ipcHandlers.ts` `assisted:history` handler to call `getOrphanedTurns` and include in response.

Update preload `assistedHistory` type accordingly.

### 6. UI: Orphaned Turn Bubble (`AssistedPanel.svelte`)

On `onMount`, after loading history:

1. For each `orphanedTurn`, find last `user` message in `messages` with `created_at < orphanedTurn.started_at`
2. Build synthetic display entry (not stored in DB):
   ```ts
   { type: 'orphaned', turnId, lastUserMessage, turn_type }
   ```
3. Insert into render list at position after last message before `started_at`

Bubble renders:
```
⚠ Turn interrupted (app closed mid-run)
[Re-send last message]
```

Styled like existing `claude-action` mini-panel (muted/warning). Shows `turn_type` (`claude` / `shellephant`).

Re-send button: calls `send(lastUserMessage.content)` → sets `running=true`, fires normal IPC path. On click, removes synthetic entry from list so button doesn't persist.

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/logWriter.ts` | Add `markOrphanedTurns()` export |
| `src/main/db.ts` | Add `getOrphanedTurns()` export |
| `src/main/claudeService.ts` | Add `terminateAllWorkers()` export |
| `src/main/assistedWindowService.ts` | Add `terminateAllAssistedWorkers()` export |
| `src/main/index.ts` | Add `before-quit` handler; call `markOrphanedTurns` on startup |
| `src/main/ipcHandlers.ts` | Extend `assisted:history` to include orphaned turns |
| `src/preload/index.ts` | Update `assistedHistory` return type |
| `src/renderer/src/components/AssistedPanel.svelte` | Render orphaned bubbles with re-send button |

---

## Verification

1. Start app, send message to Claude direct window, immediately force-quit app (`kill -9`)
2. Reopen app — turn row should be `status='orphaned'` in DB
3. Open that window — orphaned bubble appears in chat with re-send button
4. Click re-send — new turn fires, `running=true`, response streams normally

5. Start app, send message, use normal quit (Cmd+Q)
6. Same result — graceful path also marks turn orphaned before exit

7. Run unit tests: `logWriter`, `claudeService`, `assistedWindowService`, `ipcHandlers`, `AssistedPanel`
