# Window Manager — Bug Fixes + UI Modernization

**Date:** 2026-04-11
**Status:** Design
**Scope:** Implements `tasks.md` (4 bug reports) and restyles the app to a Raycast/Warp-style dark UI with a sidebar + main pane layout. Follow-up to `2026-04-11-window-manager-design.md`.

## Context

Current state: Electron + Svelte 5 + Vite window manager. SQLite-backed window records, Docker (`cc` image) containers, xterm.js terminal in a fullscreen modal, card grid home view. Functional but raw:

1. Delete throws `Window N not found` in some cases (`tasks.md`:1).
2. Copy from the terminal produces URL-encoded / mangled text (`tasks.md`:9).
3. Terminal shows junk like `;;;;EEEEEE` and a `Hnode@...$` prompt (`tasks.md`:14).
4. Prompt looks weird in general (`tasks.md`:18).

On top of fixing these, the app's visual design is dated. Goal is a cohesive modern dark UI with a sidebar of windows and a main pane that hosts the active terminal — closer to Warp / Raycast / Linear than to a scaffolded Electron template.

Terminal session persistence across switches is handled by running `tmux new-session -A -s cw` inside each container. The `cc` image must provide `tmux` (documented as an external requirement).

## Goals

- Make `deleteWindow` idempotent so the "Window N not found" error is impossible.
- Reconcile SQLite rows with live Docker state at app startup.
- Eliminate terminal rendering garbage and prompt weirdness via tmux + explicit `TERM`.
- Fix URL copy behavior with the xterm web-links addon.
- Restructure the renderer into small components (sidebar, main pane, terminal host) with unit tests per component.
- Apply a cohesive dark theme (zinc base, violet accent, Inter + JetBrains Mono).

## Non-goals

- Keyboard shortcuts, command palette.
- Multiple tabs per window / multiplexed panes inside one window (tmux-in-container can do this manually, but the UI doesn't expose it).
- Container resource limits, environment variables, volume mounts in the create flow.
- Modifying the `cc` image's Dockerfile inside this repo (it lives elsewhere).
- Auth, telemetry, multi-user support.
- Integration / E2E tests that talk to real Docker — unit tests with mocks only.

## External requirements (documented, not in-scope as code)

- The `cc` Docker image must have `tmux` on `$PATH`. Install via the image's own build process.
- Fonts (`Inter`, `JetBrains Mono`) may be dropped into `src/renderer/src/assets/fonts/` or left absent. The theme falls back to `system-ui` / `ui-monospace` if fonts are missing. No Google Fonts network call.

## Architecture

```
┌─ Main Process ──────────────────────────────┐
│  db.ts                                      │
│  windowService   create/list/delete         │
│                  + reconcileWindows (NEW)   │
│                  + statusMap (module state) │
│  terminalService                            │
│                  openTerminal → tmux attach │
│                  closeTerminalSessionFor    │
│  ipcHandlers     unchanged channel names    │
└─────────────────────────────────────────────┘
                    │ IPC (contextBridge)
┌─ Renderer ──────────────────────────────────┐
│  App.svelte       thin shell, holds state   │
│   ├─ Sidebar      list + inline CreateWindow│
│   │    └─ SidebarItem   (replaces           │
│   │                      WindowCard)        │
│   └─ MainPane                               │
│        ├─ EmptyState   (nothing selected)   │
│        └─ TerminalHost (replaces Terminal;  │
│                         no modal)           │
│  theme.css        CSS vars, violet on zinc  │
└─────────────────────────────────────────────┘
```

## High-level flows

1. **Startup.** Main: `initDb()` → `reconcileWindows()` → `registerIpcHandlers()` → `createBrowserWindow()`. Renderer: `listWindows()` → render sidebar → auto-select first window if any.
2. **Create.** Click `+` in sidebar header → inline name input → `api.createWindow(name)` → main creates and starts a container from image `cc` → inserts row → returns record → renderer appends to sidebar and auto-selects the new window.
3. **Select / open.** Click a sidebar item → `selectedId = id` → `MainPane` keyed on `selectedId` mounts a new `TerminalHost` → TerminalHost calls `terminal:open` → main runs `docker exec … tmux new-session -A -s cw` → stream piped back over `terminal:data`.
4. **Switch.** Click another sidebar item → keyed remount → old TerminalHost destroys (emits `terminal:close` detach), new one opens (reattach via tmux `-A`). tmux replays the pane on attach so scrollback is visible.
5. **Delete.** Click row delete → inline confirm UI → `api.deleteWindow(id)` (idempotent) → soft-delete row → stop container → close any live exec session for that container → renderer removes the item; if it was selected, selection clears (or jumps to the first remaining window).
6. **App restart.** On next launch, `reconcileWindows` drops rows whose containers are gone; survivors re-attach to their existing `cw` tmux session when first opened.

## Components

### `src/renderer/src/theme.css` (NEW)

CSS variables + minimal reset. Imported once from `main.ts`. Replaces the body/background rules currently in `app.css` (reset stays).

```css
:root {
  --bg-0: #09090b;   /* zinc-950 */
  --bg-1: #18181b;   /* zinc-900 */
  --bg-2: #27272a;   /* zinc-800 */
  --border: #3f3f46; /* zinc-700 */
  --fg-0: #fafafa;   /* zinc-50  */
  --fg-1: #a1a1aa;   /* zinc-400 */
  --fg-2: #71717a;   /* zinc-500 */
  --accent: #8b5cf6;    /* violet-500 */
  --accent-hi: #a78bfa; /* violet-400 */
  --danger: #ef4444;    /* red-500 */
  --ok: #22c55e;        /* green-500 */
  --radius: 8px;
  --font-ui: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

No component rules here. Per-component CSS lives in the component.

### `src/renderer/src/App.svelte` (RESTRUCTURED, thin shell)

```ts
let windows = $state<WindowRecord[]>([])
let selectedId = $state<number | null>(null)
```

Lifecycle:
- `onMount` → `windows = await api.listWindows()` → `selectedId = windows[0]?.id ?? null`.

Layout: CSS grid `220px 1fr`. Root element is `<div class="app">` with two children: `<Sidebar …/>` and `<MainPane …/>`. No other rendering logic in App.svelte; callbacks delegate to the two children.

Target size: ~40 lines of script + template.

### `src/renderer/src/components/Sidebar.svelte` (NEW)

Left rail. Fixed width 220px. Contents:
- Header row: app title ("Windows" in UI font) + inline `CreateWindow` component.
- Scrollable list of `SidebarItem`.
- When `windows.length === 0`: a muted hint "No windows. Click + to create one."

Props:
```ts
windows: WindowRecord[]
selectedId: number | null
onSelect: (id: number) => void
onCreated: (record: WindowRecord) => void
onDelete: (id: number) => void
```

No local state. Styling uses `--bg-1` background, `--border` right border.

### `src/renderer/src/components/SidebarItem.svelte` (NEW, replaces `WindowCard.svelte`)

Row in the sidebar list.

Props:
```ts
win: WindowRecord
selected: boolean
onSelect: (win: WindowRecord) => void
onDelete: (id: number) => void
```

Local state:
```ts
let confirming = $state(false)
let confirmTimeout: ReturnType<typeof setTimeout> | null = null
```

Visual:
- Status dot: small colored circle. `--ok` when `win.status === 'running'`, `--fg-2` when `'stopped'` or `'unknown'`.
- Name: `--fg-0`, UI font, bold.
- Container id: first 12 chars, mono font, `--fg-2`, small.
- Selected state: `--bg-2` background + 2px `--accent` left border.
- Delete button: opacity 0 by default, opacity 1 on `:hover` of the row.
- Delete-confirm: first click sets `confirming = true` and a 3s `setTimeout` that reverts it. The button label swaps to `Delete?` and a `×` cancel button appears next to it. Second click calls `onDelete(win.id)`.

`onDestroy` clears `confirmTimeout` if set.

Max size target: 150 lines including CSS.

### `src/renderer/src/components/MainPane.svelte` (NEW)

Right side, fills remaining space.

Props:
```ts
selected: WindowRecord | null
```

Template:
```svelte
{#if selected}
  {#key selected.id}
    <TerminalHost win={selected} />
  {/key}
{:else}
  <EmptyState />
{/if}
```

The `{#key selected.id}` forces unmount + remount on switch, which drives TerminalHost lifecycle cleanly.

Background: `--bg-0`.

### `src/renderer/src/components/EmptyState.svelte` (NEW)

Centered vertical stack on `--bg-0`. Small inline SVG icon (violet outline), heading "No window selected" (`--fg-0`), hint "Create or select a window from the sidebar." (`--fg-1`). Subtle radial gradient from `--bg-1` to `--bg-0` as background. No dependencies on `wavy-lines.svg` (drop that).

### `src/renderer/src/components/TerminalHost.svelte` (NEW, replaces `Terminal.svelte`)

Fills MainPane. No modal, no overlay.

Dependencies:
- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links` (NEW)

Props:
```ts
win: WindowRecord
```

Local state: xterm instance, fitAddon, resizeObserver.

Template:
```svelte
<section class="terminal-host">
  <header class="terminal-host-header">
    <span class="name">{win.name}</span>
    <span class="container-id">{win.container_id.slice(0, 12)}</span>
  </header>
  <div class="terminal-body" bind:this={terminalEl}></div>
</section>
```

`onMount`:
```ts
term = new XTerm({
  fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono'),
  fontSize: 13,
  theme: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#8b5cf6',
    selectionBackground: '#3f3f46',
  },
  scrollback: 1000,
})
term.loadAddon(new FitAddon())
term.loadAddon(new WebLinksAddon())
term.open(terminalEl)
fitAddon.fit()

resizeObserver = new ResizeObserver(() => fitAddon.fit())
resizeObserver.observe(terminalEl)

window.api.openTerminal(win.container_id)
window.api.onTerminalData((containerId, data) => {
  if (containerId === win.container_id) term.write(data)
})
term.onData(data => window.api.sendTerminalInput(win.container_id, data))
term.onResize(({ cols, rows }) => window.api.resizeTerminal(win.container_id, cols, rows))
```

`onDestroy`:
```ts
resizeObserver?.disconnect()
window.api.offTerminalData()
window.api.closeTerminal(win.container_id)
term?.dispose()
```

Max size target: 200 lines including CSS.

### `src/renderer/src/components/CreateWindow.svelte` (RESTYLED)

API unchanged (`onCreated` prop + name input). Restyled: compact, sits in Sidebar header. Behavior:
- Default state: icon button `+`.
- Click `+` → expands to an input row. Enter to submit, Esc to cancel.
- On successful create: collapses back to icon button.

Local state extends with `expanded = $state(false)`. Existing `name`, `loading`, `error` state kept.

### `src/renderer/src/types.ts` (UPDATED)

```ts
export type WindowStatus = 'running' | 'stopped' | 'unknown'

export type WindowRecord = {
  id: number
  name: string
  container_id: string
  created_at: string
  status: WindowStatus
}
```

`status` is transient (not stored in SQLite). Populated at `listWindows` time from the main-process `statusMap`.

### Removed files

- `src/renderer/src/components/WindowCard.svelte` (replaced by `SidebarItem`).
- `src/renderer/src/components/Terminal.svelte` (replaced by `TerminalHost`).
- `tests/renderer/WindowCard.test.ts`, `tests/renderer/Terminal.test.ts` (replaced by new tests — see Testing).
- `src/renderer/src/components/Versions.svelte` if no longer imported. (Audit during implementation; remove only if unused.)
- `wavy-lines.svg` background image — no longer used.

## Data flow & IPC

### Channels

| Channel | Direction | Payload | Notes |
|---|---|---|---|
| `window:create` | render → main (invoke) | `(name: string) → WindowRecord` | unchanged |
| `window:list` | render → main (invoke) | `() → WindowRecord[]` | `WindowRecord` now includes `status` |
| `window:delete` | render → main (invoke) | `(id: number) → void` | idempotent: no throw if row/container already gone |
| `terminal:open` | render → main (invoke) | `(containerId: string) → void` | runs `tmux new-session -A -s cw` inside the container |
| `terminal:input` | render → main (send) | `(containerId, data)` | unchanged |
| `terminal:resize` | render → main (send) | `(containerId, cols, rows)` | unchanged |
| `terminal:close` | render → main (send) | `(containerId)` | detach only; tmux session remains |
| `terminal:data` | main → render (send) | `(containerId, data)` | unchanged |

### `windowService.ts` (UPDATED)

New module-level state:
```ts
const statusMap = new Map<number, WindowStatus>()
```

**`reconcileWindows(): Promise<void>`** — NEW. Called once at startup, before the BrowserWindow is created.

```
for each row in db.all('SELECT id, container_id FROM windows WHERE deleted_at IS NULL'):
  try:
    inspect = await docker.getContainer(row.container_id).inspect()
    if inspect.State.Status === 'running':
      statusMap.set(row.id, 'running')
    else:
      # 'exited', 'dead', 'created', etc → treat as gone
      db.update('UPDATE windows SET deleted_at = datetime("now") WHERE id = ?', row.id)
  catch err:
    if err is a 404 / container-not-found:
      db.update('UPDATE windows SET deleted_at = datetime("now") WHERE id = ?', row.id)
    else:
      # docker daemon unreachable or other — leave row alone, mark unknown
      statusMap.set(row.id, 'unknown')
```

If the whole function throws (e.g. docker completely unreachable), catch at the caller in `main/index.ts`, log, and continue with empty `statusMap`. `listWindows` will fall back to `'unknown'`.

**`listWindows(): WindowRecord[]`** — UPDATED.
```ts
return rows.map(r => ({ ...r, status: statusMap.get(r.id) ?? 'unknown' }))
```

**`createWindow(name): Promise<WindowRecord>`** — UPDATED. After insert, `statusMap.set(row.id, 'running')`. Return record with `status: 'running'`.

**`deleteWindow(id): Promise<void>`** — UPDATED. Idempotent.
```
row = db.get('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL', id)
if !row: return    // silent — bug 1 fix
db.update('UPDATE windows SET deleted_at = datetime("now") WHERE id = ?', id)
statusMap.delete(id)
try: await docker.getContainer(row.container_id).stop({ t: 1 })
catch: /* already stopped or gone — swallow */
try: closeTerminalSessionFor(row.container_id)
catch: /* idempotent */
```

### `terminalService.ts` (UPDATED)

New exported function: `closeTerminalSessionFor(containerId: string): void` (used by `windowService.deleteWindow`). Same body as the existing `closeTerminal` — exported separately to make the call-site intent obvious.

**`openTerminal(containerId, win): Promise<void>`** — UPDATED.

Key changes:
- Exec command: `['tmux', 'new-session', '-A', '-s', 'cw']` instead of `['/bin/bash']`.
- Env: `['TERM=xterm-256color']` explicitly.
- Idempotent: if a session already exists for this containerId, close it first, then reopen. This handles renderer reloads where the old stream is orphaned.
- `stream.on('data')`: check `win.isDestroyed()` before `win.webContents.send(...)` to avoid errors on renderer teardown.

```
async function openTerminal(containerId, win):
  if sessions.has(containerId): closeTerminal(containerId)

  container = docker.getContainer(containerId)
  exec = await container.exec({
    Cmd: ['tmux', 'new-session', '-A', '-s', 'cw'],
    AttachStdin: true, AttachStdout: true, AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color'],
  })
  stream = await exec.start({ hijack: true, stdin: true })
  sessions.set(containerId, { stream, exec })

  stream.on('data', chunk => {
    if (win.isDestroyed()) return
    win.webContents.send('terminal:data', containerId, chunk.toString())
  })
  stream.on('end', () => {
    sessions.delete(containerId)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, '\r\n[detached]\r\n')
    }
  })
```

### `ipcHandlers.ts` (UNCHANGED signatures)

Handler bodies are unchanged — the services already encapsulate the new behavior. Existing registration-once logic (from commit 14912b3) is preserved.

### `main/index.ts` (UPDATED)

Call `reconcileWindows()` between `initDb()` and `registerIpcHandlers()`, wrapped in try/catch so a failure does not block app startup.

## Bug → fix mapping

| Bug | Fix |
|---|---|
| 1. `Window N not found` on delete | `deleteWindow` now returns silently when the row is missing. Duplicate IPC handler registration was already addressed in commit 14912b3. |
| 2. Copy text URL-encoded / mangled | `@xterm/addon-web-links` renders URLs as real links, so selection copies display text instead of escape bytes. Explicit `TERM=xterm-256color` prevents fallback escape handling that was likely misparsing OSC sequences. |
| 3. `;;;;EEEE` / `Hnode@…` junk in output | tmux normalizes the PTY, plus `TERM=xterm-256color` gives xterm.js a terminfo it handles cleanly. tmux redraws the pane on attach. |
| 4. Prompt looks weird in general | Same as bug 3. tmux owns the cols/rows the shell sees, so readline column miscounts from unwrapped color escapes go away. |

## Error handling

| Failure | Response |
|---|---|
| Docker daemon unreachable | `reconcileWindows` catches at top level → leaves rows with `'unknown'` status. `createWindow` / `openTerminal` throw → IPC handler returns error to renderer → existing error banner in `CreateWindow` / new inline banner in `TerminalHost`. No crash. |
| `cc` image missing | `createContainer` throws 404 → error banner in `CreateWindow`: "Image 'cc' not found. Build or pull it, then retry." |
| Container exists in DB but gone from Docker (startup) | `reconcileWindows` soft-deletes the row. User sees a clean sidebar. |
| Container goes missing mid-session | `openTerminal` exec throws 404 → `TerminalHost` shows inline "Container exited." + a `Remove` button that calls `deleteWindow(id)`. |
| tmux missing from `cc` image | `docker exec` fails with `executable file not found`. `TerminalHost` surfaces: "tmux not available in image 'cc'. Install tmux in the image." No retry loop. |
| Double-click delete race | `deleteWindow` is idempotent — second call is a no-op. |
| Orphan exec session after delete | `deleteWindow` explicitly calls `closeTerminalSessionFor(container_id)`. `stream.on('end')` already removes from the sessions map. |
| `win.webContents.send` after renderer reload | `stream.on('data')` checks `win.isDestroyed()` first. |
| Renderer reload with live session | On mount, `openTerminal` detects an existing session for the container and tears it down before opening a new one. tmux session `cw` persists inside the container, so the reattach shows the prior state. |
| SQLite locked / disk full | better-sqlite3 throws synchronously → IPC handler catches → error banner. No deeper recovery. |

Not handled (out of scope): retry loops for transient docker errors, structured logging, multi-process sqlite locking.

## Testing

Framework: vitest, existing node / renderer configs. All tests use mocks — no real Docker.

### Main process

**`tests/main/windowService.test.ts`** (extend)
- Existing: create inserts row, list returns non-deleted, delete soft-deletes and stops container.
- New:
  - `deleteWindow` with a non-existent id returns silently (no throw).
  - `deleteWindow` where `container.stop()` rejects still completes (no throw).
  - `deleteWindow` calls `closeTerminalSessionFor(container_id)`.
  - `reconcileWindows` sets `'running'` in statusMap for running containers.
  - `reconcileWindows` soft-deletes rows whose `container.inspect()` returns 404.
  - `reconcileWindows` soft-deletes rows whose `inspect().State.Status` is `'exited'`.
  - `reconcileWindows` leaves rows alone and sets `'unknown'` when docker is unreachable.
  - `listWindows` merges status from statusMap into records (default `'unknown'`).
  - `createWindow` sets statusMap entry to `'running'` and returns record with `status: 'running'`.

Mock extension: `getContainer().inspect()` returning configurable `{ State: { Status } }` objects or throwing configurable errors.

**`tests/main/terminalService.test.ts`** (NEW)
- `openTerminal` calls `container.exec` with `Cmd: ['tmux', 'new-session', '-A', '-s', 'cw']` and `Env: ['TERM=xterm-256color']`.
- `openTerminal` when a session already exists: closes old, opens new.
- `openTerminal` forwards `stream.on('data')` chunks via `win.webContents.send('terminal:data', containerId, str)`.
- `openTerminal` skips `webContents.send` when `win.isDestroyed()` is true.
- `openTerminal` cleans up the session entry on `stream.on('end')`.
- `writeInput` writes to the right session's stream.
- `resizeTerminal` calls `exec.resize({ w: cols, h: rows })`.
- `closeTerminal` destroys stream and deletes the session entry.
- `closeTerminalSessionFor` behaves identically to `closeTerminal` (or is aliased).

Mocks: fake Dockerode exec + `EventEmitter`-based fake stream with a `.write()` spy and a `.destroy()` spy; fake `BrowserWindow` with `webContents.send` spy and `isDestroyed()` stub.

**`tests/main/ipcHandlers.test.ts`** (extend)
- Existing: handlers registered once, dispatch to service functions.
- New: `window:list` result objects include a `status` field.
- New: `window:delete` IPC invocation does not reject when the row is missing.

### Renderer

**`tests/renderer/Sidebar.test.ts`** (NEW)
- Renders a list of windows (assert count).
- Clicking a sidebar item calls `onSelect` with the correct id.
- Highlights the selected item (assert on a `data-selected` attribute or class).
- Shows the empty hint when `windows.length === 0`.
- Inline `CreateWindow` in the header forwards `onCreated`.

**`tests/renderer/SidebarItem.test.ts`** (NEW)
- Shows name and first 12 chars of `container_id`.
- Status dot class reflects `win.status` (`running`, `stopped`, `unknown`).
- Click body calls `onSelect(win)`.
- First click on delete enters confirming state (no `onDelete` call yet).
- Click confirm → calls `onDelete(id)`.
- Click cancel → reverts to normal state; no `onDelete` call.

**`tests/renderer/MainPane.test.ts`** (NEW)
- Renders `EmptyState` when `selected` is null.
- Renders `TerminalHost` when `selected` is a record.
- Switching `selected` from A to B unmounts the old TerminalHost and mounts a new one (asserted via a unique `data-testid` tied to `win.id` or a spy on a mock `TerminalHost`).

**`tests/renderer/EmptyState.test.ts`** (NEW)
- Renders heading and hint text.

**`tests/renderer/TerminalHost.test.ts`** (NEW, replaces `Terminal.test.ts`)
- Mounts xterm with fit + web-links addons (spy on `XTerm.prototype.loadAddon`).
- Calls `window.api.openTerminal(container_id)` on mount.
- Writes `onTerminalData` chunks to xterm only when `containerId` matches.
- Ignores chunks for non-matching containerIds.
- On destroy: calls `closeTerminal`, `offTerminalData`, disposes xterm.
- Forwards `term.onData` to `sendTerminalInput`.
- Forwards `term.onResize` to `resizeTerminal`.

**`tests/renderer/CreateWindow.test.ts`** (extend)
- Existing behavior preserved.
- New: collapsed → click `+` → expanded. Escape or successful create → collapsed.

**Removed:** `tests/renderer/WindowCard.test.ts`, `tests/renderer/Terminal.test.ts`.

### Integration / E2E — manual only

Out of scope as automated tests. Implementation must pass this manual checklist before the task is considered complete:

1. Launch app. Sidebar renders. No console errors.
2. Create window "alpha". Sidebar shows the new item. It is auto-selected. Terminal attaches.
3. Type `echo hello` → output is clean (no `;;;EEEE` garbage).
4. `echo "https://anthropic.com"` → URL is clickable; selecting and copying yields `https://anthropic.com` verbatim.
5. Create window "beta". Switch to it. Type `echo beta`. Switch back to alpha. Prior alpha state is visible (tmux replay).
6. Delete beta. Row disappears. Rapid double-click delete on another window → no error toast.
7. Quit app. Relaunch. Sidebar shows alpha. Opening it shows the prior tmux state.
8. Stop alpha's container externally (`docker stop …`). Relaunch app. Reconcile removes alpha from sidebar.
9. Stop the docker daemon. Launch app. Empty state visible; no crash; banner says docker is unreachable.

## File size budget

All new `.ts` / `.svelte` files should stay under 200 lines (CLAUDE.md rule is 1000 but 200 is the practical target). Functions under 100 lines. The file closest to the limit is `TerminalHost.svelte` (xterm setup + IPC + styling). If it approaches 200 lines, extract xterm construction into a helper module.

## Open questions

None. All structural decisions settled during brainstorming. Details not covered here (exact font file paths, exact icon SVG content, exact pixel sizes) are implementation-level choices within the design constraints.
