# Permission Mode Toggle Design

**Date:** 2026-04-20  
**Status:** Approved

## Summary

Add a per-window in-memory toggle to switch Claude direct sends between `bypassPermissions` and `plan` mode. Toggle lives in `AssistedPanel` alongside the Claude/Shellephant recipient selector. Mode threads through the full stack as a CLI arg to `cw-claude-sdk.js`.

## Data Flow

```
AssistedPanel.$state permissionMode ('bypassPermissions' | 'plan')
  → window.api.claudeSend(windowId, message, permissionMode)
  → IPC 'claude:send' handler (windowId, message, permissionMode)
  → claudeService.sendToClaudeDirectly(windowId, containerId, message, permissionMode, sendToRenderer)
  → worker.postMessage({ type: 'send', windowId, containerId, message, initialSessionId, permissionMode })
  → claudeRunner.runClaudeCode(containerId, sessionId, message, permissionMode)
  → docker exec <containerId> node /usr/local/bin/cw-claude-sdk.js <sessionId> <message> --mode=<permissionMode>
  → cw-claude-sdk.js reads process.argv[4], sets options.permissionMode
```

- Default: `'bypassPermissions'` at every layer
- No new IPC channels — extends existing `claude:send` payload
- No DB changes — in-memory only, resets on app restart

## UI

In `AssistedPanel.svelte`, same row as Claude/Shellephant radio toggle:

```
[ Claude · Shellephant ]    [ Bypass · Plan ]
```

- `Bypass | Plan` radio pair rendered only when `currentRecipient === 'claude'`
- Styled with existing `.recipient-toggle` CSS class
- State: `let permissionMode: PermissionMode = $state('bypassPermissions')`
- Passed to `window.api.claudeSend` on every send

## Type

```typescript
type PermissionMode = 'bypassPermissions' | 'plan'
```

Defined once, imported where needed.

## Files Changed

| File | Change |
|------|--------|
| `files/cw-claude-sdk.js` | Read `process.argv[4]` (`--mode=<value>`), set `options.permissionMode` |
| `src/main/claudeRunner.ts` | Add `permissionMode: PermissionMode` param; append `--mode=<permissionMode>` to docker exec args |
| `src/main/claudeDirectWorker.ts` | Add `permissionMode` to `DirectSendMsg` type; forward to `runClaudeCode` |
| `src/main/claudeService.ts` | Add `permissionMode` param to `sendToClaudeDirectly`; pass to worker postMessage |
| `src/main/ipcHandlers.ts` | Extract `permissionMode` from `claude:send` payload; pass to `sendToClaudeDirectly` |
| `src/preload/index.ts` | Add `permissionMode: PermissionMode` to `claudeSend` signature |
| `src/renderer/src/components/AssistedPanel.svelte` | Add `$state permissionMode`; render toggle UI; pass on send |

## Testing

- `claudeRunner.test.ts` — `--mode=plan` in docker exec args when `permissionMode='plan'`; `--mode=bypassPermissions` as default
- `claudeDirectWorker.test.ts` — `permissionMode` forwarded from msg to `runClaudeCode`
- `claudeService.test.ts` — `permissionMode` threaded from `sendToClaudeDirectly` through to worker postMessage
- `AssistedPanel.test.ts` — toggle hidden when `currentRecipient='shellephant'`; `claudeSend` called with correct mode
