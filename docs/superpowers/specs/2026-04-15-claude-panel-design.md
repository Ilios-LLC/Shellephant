# Claude Panel Design

**Date:** 2026-04-15
**Status:** Approved

## Overview

Replace the Terminal / Editor / Both view toggle with a Claude / Terminal / Editor toggle. Claude is the default panel and runs a persistent `claude` session in the container workspace. Both Claude and Terminal are persistent tmux sessions — switching panels hides/shows without teardown.

## View Model

`viewMode` type: `'claude' | 'terminal' | 'editor'` (was `'terminal' | 'editor' | 'both'`).

Default: `'claude'`.

Button order in `WindowDetailPane`: **Claude | Terminal | Editor**.

The `injectClaude()` function and its button are removed — superseded by the Claude panel.

## Backend: Session Keying

### terminalService

Sessions currently keyed by `containerId`. New key: `${containerId}:${sessionType}` where `sessionType` is `'claude' | 'terminal'`.

All affected IPC calls gain an optional `sessionType` param defaulting to `'terminal'`:
- `openTerminal(containerId, cols, rows, displayName, sessionType?)`
- `closeTerminal(containerId, sessionType?)`
- `sendTerminalInput(containerId, data, sessionType?)`
- `resizeTerminal(containerId, cols, rows, sessionType?)`

Defaulting to `'terminal'` preserves backward compatibility.

`resizeTerminal` is called by the active panel's `FitAddon` resize observer, so it naturally passes the `sessionType` of whichever terminal is currently visible.

### Tmux commands

**Terminal session** (unchanged):
```
exec tmux -u new-session -A -s cw -c '/workspace/repo'
```

**Claude session** (new):
```
exec tmux -u new-session -A -s cw-claude -c '/workspace/repo' 'claude'
```

The `-A` flag handles persistence automatically:
- New session → creates and runs `claude` as the initial command
- Existing session → attaches silently, initial command ignored

No explicit "already initialized" tracking needed.

### IPC event: terminal:data

Payload gains `sessionType` field so the renderer can route data to the correct xterm instance:

```ts
// main → renderer
webContents.send('terminal:data', containerId, sessionType, data)
```

## Frontend: TerminalHost

### Two xterm instances

| Instance | Element | Session type | Init |
|----------|---------|--------------|------|
| `claudeTerm` | `claudeTerminalEl` | `'claude'` | On mount |
| `term` | `terminalEl` | `'terminal'` | On first Terminal click |

Tracked via `claudeOpened` / `terminalOpened` booleans.

### Lazy init rule

- Claude: always opened on mount (default view).
- Terminal: opened on first switch to Terminal panel, then kept alive.
- Editor: no PTY — existing `EditorPane` behavior unchanged.

### Panel switching

Both terminal `<div>` elements exist in the DOM at all times. Visibility controlled by CSS (active panel visible, inactive hidden via `display:none`). No teardown on switch. `fitAddon.fit()` called when switching to a terminal panel to re-sync dimensions.

### onTerminalData routing

```ts
window.api.onTerminalData((containerId, sessionType, data) => {
  if (containerId !== win.container_id) return
  if (sessionType === 'claude') claudeTerm?.write(data)
  else term?.write(data)
})
```

### onDestroy

Closes both sessions if opened, disconnects both ResizeObservers, disposes both xterm instances.

## Files Changed

| File | Change |
|------|--------|
| `src/main/terminalService.ts` | Session key → `containerId:sessionType`; claude tmux command |
| `src/main/ipcHandlers.ts` | Add `sessionType` param to terminal IPC handlers |
| `src/preload/index.ts` | Add `sessionType` to terminal API methods |
| `src/preload/index.d.ts` | Update type definitions |
| `src/renderer/src/components/TerminalHost.svelte` | Two xterm instances, lazy init, new viewMode |
| `src/renderer/src/components/WindowDetailPane.svelte` | New buttons, remove injectClaude |
| `tests/renderer/TerminalHost.test.ts` | Update for new viewMode, new session behavior |
| `tests/main/terminalService.test.ts` | New session key tests (if file exists) |

## Error Handling

Same as existing: PTY exit emits `terminal:data` with `[detached]` suffix. No new error paths introduced.

## Testing

- Claude session opens on mount
- Terminal session does not open on mount; opens on first Terminal click
- Subsequent Terminal clicks do not re-open session
- `onTerminalData` routes to correct xterm instance by `sessionType`
- `onDestroy` closes both sessions (only those that were opened)
- `WindowDetailPane` renders Claude / Terminal / Editor buttons in order
- `injectClaude` is gone
