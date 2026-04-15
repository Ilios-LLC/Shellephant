# Claude Waiting Notifications — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Overview

When Claude Code (running inside a container terminal) finishes a turn or pauses waiting for user input, the app should alert the user via an OS notification and an in-app toast, and display the waiting window in the sidebar.

## Signal Chain

```
Claude Code Stop hook
  → printf OSC-9999 sequence >/dev/tty
  → tmux pane PTY (slave → master)
  → tmux allow-passthrough → outer PTY (docker exec)
  → node-pty onData() in terminalService.ts
  → strip sequence, fire IPC + OS Notification
  → renderer: toast + sidebar entry
```

The OSC sequence used is `\x1b]9999;claude-waiting\x07`. This is not a standard sequence, so no existing tool emits it accidentally. It is stripped before being forwarded to xterm so it is invisible to the user.

## Trigger Conditions

Both cases are covered by the Claude Code `Stop` hook:

- Claude finishes a task turn and shows its `>` prompt
- Claude pauses mid-task to ask a yes/no or permission question

## Container Changes

### `files/tmux.conf`

Add one line:

```
set -g allow-passthrough on
```

Without this, tmux consumes unknown OSC sequences and they never reach node-pty. Requires tmux 3.3+. Debian Bookworm (the base for `node:24`) ships tmux 3.3a — compatible.

### `files/claude-settings.json`

Add a `Stop` hook that writes the signal to `/dev/tty`:

```json
"hooks": {
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "printf '\\033]9999;claude-waiting\\007' >/dev/tty"
    }]
  }]
}
```

`/dev/tty` in the hook subprocess refers to the tmux pane's controlling terminal (inherited from Claude Code's process group), so the sequence enters the pane's PTY output stream.

## Host-Side Changes

### `terminalService.ts`

- Add `displayName: string` and `waitingDebounceTimer` fields to `TerminalSession`
- Add `displayName` param to `openTerminal()`
- In `child.onData()`: scan each chunk for `\x1b]9999;claude-waiting\x07`
  - Strip the sequence before forwarding to the renderer
  - Fire `win.webContents.send('terminal:waiting', containerId)`
  - Fire `new Notification({ title: 'Claude is waiting', body: displayName }).show()`
  - Debounce per-container: ignore repeat signals within 2 seconds

### `ipcHandlers.ts`

Pass window display name to `openTerminal()`. The display name is passed from the renderer as an additional argument to `terminal:open` — no DB lookup needed.

### `preload/index.ts` + `preload/index.d.ts`

Expose:

```typescript
onTerminalWaiting: (callback: (containerId: string) => void) => void
offTerminalWaiting: () => void
```

### `lib/toasts.ts`

Add `'info'` to `ToastLevel`:

```typescript
export type ToastLevel = 'success' | 'error' | 'info'
```

### `lib/waitingWindows.ts` (new file)

Svelte writable store tracking windows currently waiting for input:

```typescript
export interface WaitingEntry {
  containerId: string
  windowId: number
  windowName: string
  projectId: number
  projectName: string
}

// API: waitingWindows.add(entry), waitingWindows.remove(containerId)
```

### `TerminalHost.svelte`

- On `terminal:waiting` IPC (when `containerId === win.container_id`):
  - `waitingWindows.add({ containerId, windowId: win.id, windowName: win.name, projectId: project.id, projectName: project.name })`
  - `pushToast({ level: 'info', title: 'Claude is waiting', body: win.name })`
- On `term.onData` (user sends input): `waitingWindows.remove(win.container_id)`
- On `onDestroy`: `waitingWindows.remove(win.container_id)`

### `Sidebar.svelte`

New "Waiting" section rendered between the project list and the footer, visible only when `$waitingWindows` is non-empty:

```
─ WAITING ────────────────────
  ● MyProject / feature-branch   ← clickable, navigates to window
  ● OtherProject / main
──────────────────────────────
```

- Reads `$waitingWindows` store directly (no prop)
- Each item fires `onWaitingWindowSelect(entry: WaitingEntry)` callback

### `App.svelte`

New handler `handleWaitingWindowSelect(entry: WaitingEntry)`:

```typescript
async function handleWaitingWindowSelect(entry: WaitingEntry): Promise<void> {
  selectedProjectId = entry.projectId
  selectedWindowId = entry.windowId
  view = 'default'
  windows = await window.api.listWindows(entry.projectId)
}
```

Pass `onWaitingWindowSelect` to `Sidebar`.

## State Lifecycle

| Event | Action |
|---|---|
| `terminal:waiting` IPC fires | Add to store, show toast, fire OS notification |
| User types in terminal | Remove from store |
| TerminalHost unmounts (navigate away) | Remove from store |

**Coverage gap (acceptable):** If Claude finishes a task while the user is viewing a different window (PTY disconnected), no signal fires for that session. The user will see it on return.

## Files Changed

| File | Change |
|---|---|
| `files/tmux.conf` | Add `allow-passthrough on` |
| `files/claude-settings.json` | Add Stop hook |
| `window-manager/src/main/terminalService.ts` | Intercept OSC, debounce, fire IPC + Notification |
| `window-manager/src/main/ipcHandlers.ts` | Pass display name to openTerminal |
| `window-manager/src/preload/index.ts` | Expose onTerminalWaiting / offTerminalWaiting |
| `window-manager/src/preload/index.d.ts` | Update Api type |
| `window-manager/src/renderer/src/lib/toasts.ts` | Add 'info' level |
| `window-manager/src/renderer/src/lib/waitingWindows.ts` | New store |
| `window-manager/src/renderer/src/components/TerminalHost.svelte` | Listen + update store |
| `window-manager/src/renderer/src/components/Sidebar.svelte` | Waiting section |
| `window-manager/src/renderer/src/App.svelte` | Navigation handler |
