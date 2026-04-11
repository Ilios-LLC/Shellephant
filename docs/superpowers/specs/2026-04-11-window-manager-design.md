# Window Manager — Design Spec
**Date:** 2026-04-11

## Overview

Svelte + Electron desktop app for managing "windows" — Docker containers spun up from a local `cc` image. Users create named windows, open bash sessions in them via an embedded terminal, and soft-delete them when done.

---

## Architecture

```
electron-vite scaffold
├── main/          ← Node.js: Docker, SQLite, IPC handlers
├── preload/       ← Context bridge: exposes safe API to renderer
└── renderer/      ← Svelte app: UI only, no Node access
```

- Main process owns all side effects (Docker via `dockerode`, SQLite via `better-sqlite3`).
- Renderer never accesses Node APIs directly.
- Preload bridges via `contextBridge.exposeInMainWorld('api', {...})`.

### IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `window:create` | renderer → main | Create new window (name) |
| `window:list` | renderer → main | Fetch active windows |
| `window:delete` | renderer → main | Soft delete + stop container |
| `terminal:input` | renderer → main | Keystrokes from xterm |
| `terminal:data` | main → renderer | Docker stdout to xterm |
| `terminal:resize` | renderer → main | Terminal resize event |

---

## Data Model

SQLite database stored in Electron's `userData` path.

```sql
CREATE TABLE windows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  container_id TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at   DATETIME DEFAULT NULL
);
```

- `deleted_at IS NULL` = active window.
- Soft delete sets `deleted_at` to current timestamp and stops the Docker container.
- All list queries filter `WHERE deleted_at IS NULL`.

---

## UI Components

```
App.svelte
├── CreateWindow.svelte   ← text input + button → calls api.createWindow(name)
├── WindowCard.svelte     ← card per window: name, status, delete button
└── Terminal.svelte       ← xterm.js modal/overlay, opens on card click
```

### Flows

**Create window:**
1. User types name in `CreateWindow` input, clicks create.
2. Renderer calls `api.createWindow(name)`.
3. Main creates Docker container from `cc` image, inserts row in SQLite.
4. Returns `{ id, name, container_id }` to renderer.
5. New card appears in dashboard.

**Open terminal:**
1. User clicks a `WindowCard`.
2. `Terminal.svelte` modal opens.
3. Renderer calls `api.openTerminal(containerId)`.
4. Main starts Docker exec session (`/bin/bash`, TTY).
5. IO streams over IPC (`terminal:input` / `terminal:data`).

**Delete window:**
1. User clicks delete on a `WindowCard`.
2. Renderer calls `api.deleteWindow(id)`.
3. Main sets `deleted_at`, stops Docker container.
4. Card removed from UI.

---

## Terminal IPC Detail

```
User types → xterm captures → ipcRenderer.send('terminal:input', data)
                                        ↓
                              main: writes to docker exec stdin
                                        ↓
                              docker stdout → ipcMain.emit → 'terminal:data'
                                        ↓
                              xterm.write(data) → user sees output
```

- Docker exec options: `AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ['/bin/bash']`
- Resize: xterm resize event → `terminal:resize` IPC → `exec.resize({ h, w })`
- Each session keyed by `containerId`. Session cleaned up on modal close.

---

## Testing

**Framework:** Vitest (built into electron-vite / Vite ecosystem)

### Main process (unit tests)

- `windowService.createWindow(name)`: verifies Docker container created, SQLite row inserted
- `windowService.listWindows()`: returns only active (non-deleted) windows
- `windowService.deleteWindow(id)`: sets `deleted_at`, stops container
- IPC handlers: correct response shape, error propagation

Mocks: `dockerode`, `better-sqlite3`

### Renderer (component tests)

- `CreateWindow`: renders input, calls `api.createWindow` on submit, clears input after success
- `WindowCard`: renders name, clicking triggers terminal open, delete calls `api.deleteWindow`
- `Terminal`: mounts xterm instance, forwards input over IPC, writes received data to terminal

Mock: `window.api` via `vi.mock` / `vi.stubGlobal`
