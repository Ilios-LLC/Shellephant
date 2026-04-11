# Window Manager — Bug Fixes + UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs from `tasks.md` (delete-not-found, copy-mangled, terminal garbage, weird prompt) and restructure the renderer into a Raycast/Warp-style dark UI with a sidebar + main pane layout.

**Architecture:** Keep existing Electron main/preload/renderer split. Main process gains `reconcileWindows` on startup and a transient `statusMap`; `deleteWindow` becomes idempotent; terminal sessions run `tmux new-session -A -s cw` inside each container with explicit `TERM=xterm-256color`. Renderer is restructured from a card-grid + modal into `Sidebar` + `MainPane` (with `TerminalHost` and `EmptyState`) using CSS variables defined in a new `theme.css`. Session persistence across window switches is delegated to tmux inside the container.

**Tech Stack:** Electron + Svelte 5 (runes) + TypeScript + vitest + better-sqlite3 + dockerode + xterm.js + @xterm/addon-fit + @xterm/addon-web-links (NEW) + @testing-library/svelte.

**Spec:** `docs/superpowers/specs/2026-04-11-window-manager-fixes-and-modernize-design.md`

**Working directory convention:** All `npm`, `vitest`, and Node tooling commands must run from `window-manager/` (the Electron app subdir). Tasks assume you are in the repo root and prefix with `cd window-manager &&` or use `(cd window-manager && <cmd>)`.

---

## File Structure

### Created
- `window-manager/src/renderer/src/theme.css` — CSS variables for the dark palette.
- `window-manager/src/renderer/src/components/EmptyState.svelte` — right-pane empty state.
- `window-manager/src/renderer/src/components/SidebarItem.svelte` — sidebar row with status dot, name, container id, inline delete confirm.
- `window-manager/src/renderer/src/components/Sidebar.svelte` — left rail, hosts `CreateWindow` and the list of `SidebarItem`s.
- `window-manager/src/renderer/src/components/MainPane.svelte` — right pane; renders `EmptyState` or a keyed `TerminalHost`.
- `window-manager/src/renderer/src/components/TerminalHost.svelte` — xterm host with fit + web-links addons.
- `window-manager/tests/main/terminalService.test.ts` — unit tests for terminal service.
- `window-manager/tests/renderer/EmptyState.test.ts`
- `window-manager/tests/renderer/SidebarItem.test.ts`
- `window-manager/tests/renderer/Sidebar.test.ts`
- `window-manager/tests/renderer/MainPane.test.ts`
- `window-manager/tests/renderer/TerminalHost.test.ts`

### Modified
- `window-manager/package.json` — add `@xterm/addon-web-links` dependency.
- `window-manager/src/renderer/src/types.ts` — add `WindowStatus` + `status` field to `WindowRecord`.
- `window-manager/src/main/windowService.ts` — add `statusMap`, `reconcileWindows`, status on `listWindows` / `createWindow`, idempotent `deleteWindow`, call `closeTerminalSessionFor`.
- `window-manager/src/main/terminalService.ts` — tmux exec command, `TERM=xterm-256color` env, idempotent `openTerminal`, `isDestroyed()` guard on `webContents.send`, export `closeTerminalSessionFor`.
- `window-manager/src/main/index.ts` — call `reconcileWindows()` during app startup.
- `window-manager/src/renderer/src/main.ts` — import `theme.css` alongside `app.css`.
- `window-manager/src/renderer/src/app.css` — drop wavy-lines background, body centering; keep reset.
- `window-manager/src/renderer/src/assets/main.css` — delete unused template styles (logo, creator, versions).
- `window-manager/src/renderer/src/App.svelte` — thin shell: holds `windows` + `selectedId` state, renders `Sidebar` + `MainPane`.
- `window-manager/src/renderer/src/components/CreateWindow.svelte` — add collapse/expand behavior so it fits in `Sidebar` header.
- `window-manager/tests/main/windowService.test.ts` — extend with status, reconcile, idempotent-delete tests.
- `window-manager/tests/main/ipcHandlers.test.ts` — fix fixtures for added `status` field; cover idempotent delete path.
- `window-manager/tests/renderer/CreateWindow.test.ts` — cover expand/collapse.
- `window-manager/tests/renderer/WindowCard.test.ts` — fix fixtures for added `status` (deleted later in Phase 3 when component is removed).
- `window-manager/tests/renderer/Terminal.test.ts` — fix fixtures for added `status` (deleted later in Phase 3 when component is removed).

### Deleted (Phase 3, after replacements are in place)
- `window-manager/src/renderer/src/components/Terminal.svelte`
- `window-manager/src/renderer/src/components/WindowCard.svelte`
- `window-manager/src/renderer/src/components/Versions.svelte`
- `window-manager/src/renderer/src/assets/wavy-lines.svg`
- `window-manager/tests/renderer/Terminal.test.ts`
- `window-manager/tests/renderer/WindowCard.test.ts`

---

## Phase 0 — Prep: dependency + shared types

Small, fast tasks that unblock the rest of the plan without changing behavior.

### Task 1: Install `@xterm/addon-web-links`

**Files:**
- Modify: `window-manager/package.json`
- Modify: `window-manager/package-lock.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
cd window-manager && npm install @xterm/addon-web-links@^0.12.0
```

Expected: `package.json` gains `"@xterm/addon-web-links": "^0.12.0"` under `dependencies`; `package-lock.json` is updated. The version must line up with the existing `@xterm/xterm@^6.0.0` major — addon-web-links 0.12 targets xterm 6.

- [ ] **Step 2: Verify install**

Run:
```bash
cd window-manager && node -e "require('@xterm/addon-web-links')"
```

Expected: no error output (successful require).

- [ ] **Step 3: Run existing tests to confirm nothing broke**

Run:
```bash
cd window-manager && npm run test
```

Expected: all existing main + renderer tests still pass.

- [ ] **Step 4: Commit**

```bash
git add window-manager/package.json window-manager/package-lock.json
git commit -m "deps: add @xterm/addon-web-links for URL handling"
```

---

### Task 2: Add `WindowStatus` and `status` field to `WindowRecord`

Update both copies of the type (main and renderer) and fix every existing test fixture that constructs a literal `WindowRecord` so it still compiles.

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/src/main/windowService.ts` (only the `WindowRecord` interface declaration at the top)
- Modify: `window-manager/tests/renderer/WindowCard.test.ts`
- Modify: `window-manager/tests/renderer/Terminal.test.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Update renderer types**

Replace the contents of `window-manager/src/renderer/src/types.ts` with:

```ts
export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
  status: WindowStatus
}

export interface Api {
  createWindow: (name: string) => Promise<WindowRecord>
  listWindows: () => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>
  openTerminal: (containerId: string) => Promise<void>
  sendTerminalInput: (containerId: string, data: string) => void
  resizeTerminal: (containerId: string, cols: number, rows: number) => void
  closeTerminal: (containerId: string) => void
  onTerminalData: (callback: (containerId: string, data: string) => void) => void
  offTerminalData: () => void
}

declare global {
  interface Window {
    api: Api
  }
}
```

- [ ] **Step 2: Update main service type**

In `window-manager/src/main/windowService.ts`, replace the existing `WindowRecord` interface at the top of the file with:

```ts
export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
  status: WindowStatus
}
```

Do not touch any function bodies in this task — the compiler will complain that existing function returns are missing `status`. We will fix those in Task 3. For now, add a TEMPORARY `as WindowRecord` cast on the return of `createWindow` and a `.map(r => ({ ...r, status: 'unknown' }))` on `listWindows`'s return so the file still compiles. Example diff for `listWindows`:

```ts
export function listWindows(): WindowRecord[] {
  return (getDb()
    .prepare('SELECT id, name, container_id, created_at FROM windows WHERE deleted_at IS NULL')
    .all() as Omit<WindowRecord, 'status'>[])
    .map(r => ({ ...r, status: 'unknown' as WindowStatus }))
}
```

And for `createWindow`, add `status: 'unknown' as WindowStatus` to the returned object literal. These are bridge values — Task 3 replaces them with real logic.

- [ ] **Step 3: Fix `WindowCard.test.ts` fixture**

In `window-manager/tests/renderer/WindowCard.test.ts`, update the `mockWindow` literal to include `status`:

```ts
const mockWindow: WindowRecord = {
  id: 42,
  name: 'My Test Window',
  container_id: 'abc123def456xyz',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}
```

- [ ] **Step 4: Fix `Terminal.test.ts` fixture**

In `window-manager/tests/renderer/Terminal.test.ts`, update the `mockWindow` literal to include `status`:

```ts
const mockWindow: WindowRecord = {
  id: 1,
  name: 'Test Terminal Window',
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}
```

- [ ] **Step 5: Fix `ipcHandlers.test.ts` fixtures**

In `window-manager/tests/main/ipcHandlers.test.ts`, update the two literal records to include `status: 'running' as const`:

```ts
const record = { id: 1, name: 'test', container_id: 'abc', created_at: '2026-01-01', status: 'running' as const }
```

```ts
const records = [{ id: 1, name: 'w', container_id: 'x', created_at: '2026-01-01', status: 'running' as const }]
```

- [ ] **Step 6: Run tests and typecheck**

Run:
```bash
cd window-manager && npm run test && npm run typecheck
```

Expected: all tests pass. Typecheck passes (Svelte + node). If typecheck fails complaining about missing `status` anywhere else, add the field there too — the only places currently constructing `WindowRecord` literals are the three tests listed above.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/renderer/src/types.ts \
        window-manager/src/main/windowService.ts \
        window-manager/tests/renderer/WindowCard.test.ts \
        window-manager/tests/renderer/Terminal.test.ts \
        window-manager/tests/main/ipcHandlers.test.ts
git commit -m "types: add WindowStatus + status field to WindowRecord"
```

---

## Phase 1 — Main process: status, reconcile, idempotent delete, tmux

### Task 3: Introduce `statusMap` and populate status in `listWindows` / `createWindow`

Write tests first, then update service.

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `window-manager/tests/main/windowService.test.ts` inside the top-level `describe('windowService', …)` block (place at the end, before the closing brace):

```ts
  describe('status field', () => {
    it('createWindow returns status "running"', async () => {
      const result = await createWindow('with-status')
      expect(result.status).toBe('running')
    })

    it('listWindows defaults status to "unknown" when not tracked', async () => {
      // Insert a row directly, bypassing createWindow, so statusMap has no entry.
      getDb()
        .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)')
        .run('ghost', 'ghost-container')
      const rows = listWindows()
      const ghost = rows.find(r => r.name === 'ghost')!
      expect(ghost.status).toBe('unknown')
    })

    it('listWindows returns status "running" for windows created through the service', async () => {
      await createWindow('live')
      const rows = listWindows()
      expect(rows[0].status).toBe('running')
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: the three new tests FAIL (the current bridge code sets `status: 'unknown'` unconditionally, so `createWindow returns status "running"` fails; the `live` test also fails).

- [ ] **Step 3: Implement `statusMap` and update `listWindows` / `createWindow`**

Replace the `listWindows` and `createWindow` function bodies in `window-manager/src/main/windowService.ts` and add the module-level `statusMap`. The whole section at the top of the file becomes:

```ts
import Dockerode from 'dockerode'
import { getDb } from './db'

export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
  status: WindowStatus
}

const statusMap = new Map<number, WindowStatus>()

let _docker: Dockerode | null = null

function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}

export async function createWindow(name: string): Promise<WindowRecord> {
  const container = await getDocker().createContainer({
    Image: 'cc',
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
  })
  await container.start()

  const db = getDb()
  const result = db
    .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)')
    .run(name, container.id)

  const id = result.lastInsertRowid as number
  statusMap.set(id, 'running')

  return {
    id,
    name,
    container_id: container.id,
    created_at: new Date().toISOString(),
    status: 'running',
  }
}

export function listWindows(): WindowRecord[] {
  const rows = getDb()
    .prepare('SELECT id, name, container_id, created_at FROM windows WHERE deleted_at IS NULL')
    .all() as Omit<WindowRecord, 'status'>[]
  return rows.map(r => ({ ...r, status: statusMap.get(r.id) ?? 'unknown' }))
}
```

Keep the existing `deleteWindow` function body unchanged in this task — we'll update it in Task 5.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: all `windowService` tests pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat(windowService): populate transient status via statusMap"
```

---

### Task 4: Add `reconcileWindows`

Add the startup reconciliation function: inspect each persisted container, soft-delete dead rows, record status.

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Extend the dockerode mock with `inspect`**

At the top of `window-manager/tests/main/windowService.test.ts`, update the mock container and add `mockInspect`:

```ts
const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockInspect = vi.fn().mockResolvedValue({ State: { Status: 'running' } })
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
  inspect: mockInspect,
}
```

And in `beforeEach`, reset it:

```ts
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockInspect.mockResolvedValue({ State: { Status: 'running' } })
    mockCreateContainer.mockResolvedValue(mockContainer)
    mockGetContainer.mockReturnValue(mockContainer)
  })
```

- [ ] **Step 2: Write failing tests**

Add a new `describe` block at the end of the main `describe('windowService', …)`:

```ts
  describe('reconcileWindows', () => {
    it('marks running containers as running', async () => {
      await createWindow('alive')
      await reconcileWindows()
      const rows = listWindows()
      expect(rows[0].status).toBe('running')
    })

    it('soft-deletes rows whose container is missing (404)', async () => {
      await createWindow('gone')
      const notFound = Object.assign(new Error('no such container'), { statusCode: 404 })
      mockInspect.mockRejectedValueOnce(notFound)
      await reconcileWindows()
      expect(listWindows()).toHaveLength(0)
    })

    it('soft-deletes rows whose container is exited', async () => {
      await createWindow('stopped')
      mockInspect.mockResolvedValueOnce({ State: { Status: 'exited' } })
      await reconcileWindows()
      expect(listWindows()).toHaveLength(0)
    })

    it('leaves rows alone and marks status unknown when docker is unreachable', async () => {
      await createWindow('docker-down')
      // First call succeeds (the createWindow above happened before we break docker),
      // the reconcile inspect fails with a non-404 error.
      mockInspect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      await reconcileWindows()
      const rows = listWindows()
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('unknown')
    })
  })
```

And extend the service import line at the top of the file:

```ts
import { createWindow, listWindows, deleteWindow, reconcileWindows } from '../../src/main/windowService'
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: compile error / test failure on `reconcileWindows` not exported.

- [ ] **Step 4: Implement `reconcileWindows`**

Add to `window-manager/src/main/windowService.ts`, after `listWindows`:

```ts
export async function reconcileWindows(): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, container_id FROM windows WHERE deleted_at IS NULL')
    .all() as { id: number; container_id: string }[]

  for (const row of rows) {
    try {
      const inspect = await getDocker().getContainer(row.container_id).inspect()
      if (inspect?.State?.Status === 'running') {
        statusMap.set(row.id, 'running')
      } else {
        db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(row.id)
        statusMap.delete(row.id)
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404) {
        db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(row.id)
        statusMap.delete(row.id)
      } else {
        statusMap.set(row.id, 'unknown')
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: all tests pass, including the four new `reconcileWindows` tests.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat(windowService): add reconcileWindows for startup sync"
```

---

### Task 5: Make `deleteWindow` idempotent

Change `deleteWindow` so it returns silently when the row is already gone instead of throwing. This is the bug-1 fix.

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Update existing test + add new tests**

In `window-manager/tests/main/windowService.test.ts`, **replace** the existing test `'throws when window id does not exist'` with:

```ts
    it('returns silently when the window id does not exist', async () => {
      await expect(deleteWindow(99999)).resolves.toBeUndefined()
    })

    it('does not throw when deleted twice in a row', async () => {
      await createWindow('twice')
      const [win] = listWindows()
      await deleteWindow(win.id)
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('does not throw when container.stop rejects', async () => {
      await createWindow('already-stopped')
      const [win] = listWindows()
      mockStop.mockRejectedValueOnce(new Error('already stopped'))
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('clears the statusMap entry for the deleted window', async () => {
      await createWindow('vanish')
      const [win] = listWindows()
      expect(listWindows()[0].status).toBe('running')
      await deleteWindow(win.id)
      // Recreate a row with the same id space to confirm the map is empty for that id.
      // Easiest assertion: insert a bare row and confirm its status is 'unknown'.
      getDb()
        .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)')
        .run('probe', 'probe-container')
      const probe = listWindows().find(r => r.name === 'probe')!
      expect(probe.status).toBe('unknown')
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: the new tests fail (current `deleteWindow` throws `'Window N not found'`).

- [ ] **Step 3: Update `deleteWindow`**

Replace the `deleteWindow` function body in `window-manager/src/main/windowService.ts` with:

```ts
export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string } | undefined

  if (!row) return // idempotent: no row to delete

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)
  statusMap.delete(id)

  try {
    await getDocker().getContainer(row.container_id).stop({ t: 1 })
  } catch {
    // Container may already be stopped or gone; ignore
  }
}
```

(We will add the `closeTerminalSessionFor(row.container_id)` call in Task 7 once the export exists.)

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "fix(windowService): make deleteWindow idempotent"
```

---

### Task 6: Terminal service — tmux exec, TERM env, idempotent open, `isDestroyed` guard, `closeTerminalSessionFor`

Create a new test file (none exists for `terminalService`) and update the service.

**Files:**
- Create: `window-manager/tests/main/terminalService.test.ts`
- Modify: `window-manager/src/main/terminalService.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/main/terminalService.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

const mockExecStart = vi.fn()
const mockExecResize = vi.fn().mockResolvedValue(undefined)
const mockExec = {
  start: mockExecStart,
  resize: mockExecResize,
}
const mockContainerExec = vi.fn().mockResolvedValue(mockExec)
const mockGetContainer = vi.fn().mockReturnValue({ exec: mockContainerExec })

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return { getContainer: mockGetContainer }
  })
}))

import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
  closeTerminalSessionFor,
} from '../../src/main/terminalService'

function makeFakeStream(): EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } {
  const stream = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  stream.write = vi.fn()
  stream.destroy = vi.fn()
  return stream
}

function makeFakeWin(isDestroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(isDestroyed),
    webContents: { send: vi.fn() },
  } as unknown as {
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn> }
  }
}

describe('terminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('openTerminal', () => {
    it('calls container.exec with tmux new-session -A -s cw and TERM=xterm-256color', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any)

      expect(mockGetContainer).toHaveBeenCalledWith('container-1')
      expect(mockContainerExec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['tmux', 'new-session', '-A', '-s', 'cw'],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Env: ['TERM=xterm-256color'],
        })
      )
      expect(mockExecStart).toHaveBeenCalledWith({ hijack: true, stdin: true })
    })

    it('forwards stream data to win.webContents.send on terminal:data channel', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-2', win as any)
      stream.emit('data', Buffer.from('hello'))

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-2', 'hello')
    })

    it('does not call webContents.send when win.isDestroyed() is true', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin(true)

      await openTerminal('container-3', win as any)
      stream.emit('data', Buffer.from('ignored'))

      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('is idempotent: a second open for the same container closes the previous session first', async () => {
      const stream1 = makeFakeStream()
      const stream2 = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream1).mockResolvedValueOnce(stream2)
      const win = makeFakeWin()

      await openTerminal('container-4', win as any)
      await openTerminal('container-4', win as any)

      expect(stream1.destroy).toHaveBeenCalled()
      expect(mockContainerExec).toHaveBeenCalledTimes(2)
    })

    it('cleans up the session when the stream ends', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-5', win as any)
      stream.emit('end')

      // Re-opening should now create a fresh exec (not close a prior session since it's gone).
      const stream2 = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream2)
      await openTerminal('container-5', win as any)
      expect(mockContainerExec).toHaveBeenCalledTimes(2)
      // The original stream should not have had destroy called twice
      expect(stream.destroy).not.toHaveBeenCalled()
    })
  })

  describe('writeInput', () => {
    it('writes input to the right session stream', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-write', makeFakeWin() as any)
      writeInput('container-write', 'ls\n')
      expect(stream.write).toHaveBeenCalledWith('ls\n')
    })

    it('is a no-op when no session exists', () => {
      expect(() => writeInput('missing', 'x')).not.toThrow()
    })
  })

  describe('resizeTerminal', () => {
    it('calls exec.resize with cols and rows mapped to w/h', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-resize', makeFakeWin() as any)
      await resizeTerminal('container-resize', 80, 24)
      expect(mockExecResize).toHaveBeenCalledWith({ w: 80, h: 24 })
    })
  })

  describe('closeTerminal', () => {
    it('destroys the stream and clears the session', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-close', makeFakeWin() as any)
      closeTerminal('container-close')
      expect(stream.destroy).toHaveBeenCalled()
    })
  })

  describe('closeTerminalSessionFor', () => {
    it('behaves identically to closeTerminal', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-csf', makeFakeWin() as any)
      closeTerminalSessionFor('container-csf')
      expect(stream.destroy).toHaveBeenCalled()
    })

    it('is a no-op when no session exists', () => {
      expect(() => closeTerminalSessionFor('ghost')).not.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd window-manager && npm run test:main -- terminalService
```

Expected: file doesn't compile — `closeTerminalSessionFor` isn't exported. Tests fail with import errors.

- [ ] **Step 3: Update `terminalService.ts`**

Replace the full contents of `window-manager/src/main/terminalService.ts` with:

```ts
import Dockerode from 'dockerode'
import type { BrowserWindow } from 'electron'

const docker = new Dockerode()

interface TerminalSession {
  stream: NodeJS.ReadWriteStream
  exec: Dockerode.Exec
}

const sessions = new Map<string, TerminalSession>()

export async function openTerminal(containerId: string, win: BrowserWindow): Promise<void> {
  // Idempotent: tear down any existing session for this container first.
  if (sessions.has(containerId)) {
    closeTerminal(containerId)
  }

  const container = docker.getContainer(containerId)

  const exec = await container.exec({
    Cmd: ['tmux', 'new-session', '-A', '-s', 'cw'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color'],
  })

  const stream = (await exec.start({ hijack: true, stdin: true })) as NodeJS.ReadWriteStream

  sessions.set(containerId, { stream, exec })

  stream.on('data', (chunk: Buffer) => {
    if (win.isDestroyed()) return
    win.webContents.send('terminal:data', containerId, chunk.toString())
  })

  stream.on('end', () => {
    sessions.delete(containerId)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:data', containerId, '\r\n[detached]\r\n')
    }
  })
}

export function writeInput(containerId: string, data: string): void {
  sessions.get(containerId)?.stream.write(data)
}

export async function resizeTerminal(
  containerId: string,
  cols: number,
  rows: number,
): Promise<void> {
  const session = sessions.get(containerId)
  if (session) await session.exec.resize({ w: cols, h: rows })
}

export function closeTerminal(containerId: string): void {
  const session = sessions.get(containerId)
  if (session) {
    session.stream.destroy()
    sessions.delete(containerId)
  }
}

export function closeTerminalSessionFor(containerId: string): void {
  closeTerminal(containerId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd window-manager && npm run test:main -- terminalService
```

Expected: all `terminalService` tests pass.

- [ ] **Step 5: Run the full main test suite**

Run:
```bash
cd window-manager && npm run test:main
```

Expected: all main-process tests pass (windowService, terminalService, ipcHandlers, db, placeholder).

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/terminalService.ts window-manager/tests/main/terminalService.test.ts
git commit -m "feat(terminalService): tmux exec, TERM env, idempotent open, isDestroyed guard"
```

---

### Task 7: Wire `closeTerminalSessionFor` into `deleteWindow`

Now that the export exists, make `deleteWindow` call it.

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Mock the terminalService inside windowService tests**

At the top of `window-manager/tests/main/windowService.test.ts`, add a `vi.mock` for `terminalService` directly after the `vi.mock('dockerode', …)` block. Use `vi.hoisted` so the mock function reference is created before `vi.mock` runs (vitest 4 hoists `vi.mock` above top-level `const`s, so a plain `const mockX = vi.fn()` referenced inside the factory hits the TDZ):

```ts
const { mockCloseTerminalSessionFor } = vi.hoisted(() => ({
  mockCloseTerminalSessionFor: vi.fn(),
}))

vi.mock('../../src/main/terminalService', () => ({
  closeTerminalSessionFor: mockCloseTerminalSessionFor,
}))
```

And add a reset in `beforeEach`:

```ts
    mockCloseTerminalSessionFor.mockClear()
```

- [ ] **Step 2: Add a failing test**

Inside `describe('deleteWindow', …)`, add:

```ts
    it('calls closeTerminalSessionFor with the container_id', async () => {
      await createWindow('with-terminal')
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockCloseTerminalSessionFor).toHaveBeenCalledWith('mock-container-abc123')
    })
```

- [ ] **Step 3: Run to verify it fails**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: the new test fails.

- [ ] **Step 4: Call `closeTerminalSessionFor` from `deleteWindow`**

In `window-manager/src/main/windowService.ts`, add the import at the top:

```ts
import { closeTerminalSessionFor } from './terminalService'
```

And update `deleteWindow` so the tail becomes:

```ts
export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string } | undefined

  if (!row) return

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)
  statusMap.delete(id)

  try {
    await getDocker().getContainer(row.container_id).stop({ t: 1 })
  } catch {
    // Container may already be stopped or gone; ignore
  }

  try {
    closeTerminalSessionFor(row.container_id)
  } catch {
    // Idempotent; ignore
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
cd window-manager && npm run test:main -- windowService
```

Expected: all tests pass, including the new one.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat(windowService): deleteWindow closes live terminal session"
```

---

### Task 8: Wire `reconcileWindows` into app startup

**Files:**
- Modify: `window-manager/src/main/index.ts`

- [ ] **Step 1: Update `main/index.ts`**

Replace the `app.whenReady().then(…)` block in `window-manager/src/main/index.ts` with:

```ts
app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'windows.db')
  initDb(dbPath)

  try {
    await reconcileWindows()
  } catch (err) {
    console.error('reconcileWindows failed; continuing with unknown statuses', err)
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
```

And add the import at the top of the file:

```ts
import { reconcileWindows } from './windowService'
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd window-manager && npm run typecheck:node
```

Expected: passes.

- [ ] **Step 3: Run full main suite**

Run:
```bash
cd window-manager && npm run test:main
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/main/index.ts
git commit -m "feat(main): call reconcileWindows on startup"
```

---

## Phase 2 — Renderer: theme, leaf components, then composition

### Task 9: Create `theme.css` and import it

**Files:**
- Create: `window-manager/src/renderer/src/theme.css`
- Modify: `window-manager/src/renderer/src/main.ts`
- Modify: `window-manager/src/renderer/src/app.css`

- [ ] **Step 1: Create `theme.css`**

Create `window-manager/src/renderer/src/theme.css` with:

```css
:root {
  --bg-0: #09090b;
  --bg-1: #18181b;
  --bg-2: #27272a;
  --bg-3: #3f3f46;
  --border: #3f3f46;
  --fg-0: #fafafa;
  --fg-1: #a1a1aa;
  --fg-2: #71717a;
  --accent: #8b5cf6;
  --accent-hi: #a78bfa;
  --danger: #ef4444;
  --ok: #22c55e;
  --radius: 8px;
  --font-ui: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

html,
body,
#app {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg-0);
  color: var(--fg-0);
  font-family: var(--font-ui);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Import `theme.css` from `main.ts`**

Replace `window-manager/src/renderer/src/main.ts` with:

```ts
import { mount } from 'svelte'

import './theme.css'
import './app.css'

import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
```

- [ ] **Step 3: Trim `app.css` to only contain the reset**

Replace `window-manager/src/renderer/src/app.css` with:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
```

We drop the old `body` background (dark navy), the `max-width: 1200px` centered `main`, the `.window-grid` rules, and the `.empty` rule. Those no longer apply — the new layout uses sidebar + main pane at full viewport.

- [ ] **Step 4: Run typecheck**

Run:
```bash
cd window-manager && npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Run renderer tests**

Run:
```bash
cd window-manager && npm run test:renderer
```

Expected: all existing renderer tests still pass.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/theme.css \
        window-manager/src/renderer/src/main.ts \
        window-manager/src/renderer/src/app.css
git commit -m "feat(theme): add dark zinc/violet theme variables"
```

---

### Task 10: `EmptyState.svelte`

Simple leaf component. Shown in main pane when no window is selected.

**Files:**
- Create: `window-manager/src/renderer/src/components/EmptyState.svelte`
- Create: `window-manager/tests/renderer/EmptyState.test.ts`

- [ ] **Step 1: Write failing test**

Create `window-manager/tests/renderer/EmptyState.test.ts`:

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('renders the heading text', () => {
    render(EmptyState)
    expect(screen.getByText('No window selected')).toBeDefined()
  })

  it('renders the hint text', () => {
    render(EmptyState)
    expect(screen.getByText(/Create or select a window from the sidebar/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd window-manager && npm run test:renderer -- EmptyState
```

Expected: fails — component doesn't exist.

- [ ] **Step 3: Implement `EmptyState.svelte`**

Create `window-manager/src/renderer/src/components/EmptyState.svelte`:

```svelte
<div class="empty-state">
  <div class="icon" aria-hidden="true">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </svg>
  </div>
  <h2 class="heading">No window selected</h2>
  <p class="hint">Create or select a window from the sidebar.</p>
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.75rem;
    background:
      radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
    color: var(--fg-1);
  }

  .icon {
    color: var(--accent);
    opacity: 0.85;
  }

  .heading {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .hint {
    font-size: 0.875rem;
    color: var(--fg-1);
    margin: 0;
  }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd window-manager && npm run test:renderer -- EmptyState
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/EmptyState.svelte \
        window-manager/tests/renderer/EmptyState.test.ts
git commit -m "feat(renderer): add EmptyState component"
```

---

### Task 11: `SidebarItem.svelte` with inline delete confirm

**Files:**
- Create: `window-manager/src/renderer/src/components/SidebarItem.svelte`
- Create: `window-manager/tests/renderer/SidebarItem.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/SidebarItem.test.ts`:

```ts
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarItem from '../../src/renderer/src/components/SidebarItem.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

const runningWindow: WindowRecord = {
  id: 7,
  name: 'alpha',
  container_id: 'abc123def456xyz',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('SidebarItem', () => {
  let onSelect: ReturnType<typeof vi.fn>
  let onDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSelect = vi.fn()
    onDelete = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the name and first 12 chars of container_id', () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('abc123def456')).toBeDefined()
  })

  it('renders a status dot with class reflecting status', () => {
    const { container } = render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    const dot = container.querySelector('[data-testid="status-dot"]')
    expect(dot).not.toBeNull()
    expect(dot!.classList.contains('status-running')).toBe(true)
  })

  it('applies a selected class when selected is true', () => {
    const { container } = render(SidebarItem, { win: runningWindow, selected: true, onSelect, onDelete })
    const row = container.querySelector('[data-testid="sidebar-item"]')
    expect(row!.classList.contains('selected')).toBe(true)
  })

  it('clicking the row calls onSelect with the window', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByTestId('sidebar-item'))
    expect(onSelect).toHaveBeenCalledWith(runningWindow)
  })

  it('first click on delete enters confirming state without calling onDelete', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    await fireEvent.click(deleteBtn)
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })

  it('clicking confirm calls onDelete with the window id', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    expect(onDelete).toHaveBeenCalledWith(7)
  })

  it('clicking cancel reverts to normal state and does not call onDelete', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDefined()
  })

  it('clicking delete does not trigger onSelect', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd window-manager && npm run test:renderer -- SidebarItem
```

Expected: fails — component doesn't exist.

- [ ] **Step 3: Implement `SidebarItem.svelte`**

Create `window-manager/src/renderer/src/components/SidebarItem.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    selected: boolean
    onSelect: (win: WindowRecord) => void
    onDelete: (id: number) => void
  }

  let { win, selected, onSelect, onDelete }: Props = $props()

  let confirming = $state(false)
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  function clearConfirmTimer(): void {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }

  function handleDeleteClick(e: MouseEvent): void {
    e.stopPropagation()
    confirming = true
    clearConfirmTimer()
    timeoutHandle = setTimeout(() => {
      confirming = false
      timeoutHandle = null
    }, 3000)
  }

  function handleConfirm(e: MouseEvent): void {
    e.stopPropagation()
    clearConfirmTimer()
    confirming = false
    onDelete(win.id)
  }

  function handleCancel(e: MouseEvent): void {
    e.stopPropagation()
    clearConfirmTimer()
    confirming = false
  }

  function handleRowClick(): void {
    onSelect(win)
  }

  function handleRowKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') onSelect(win)
  }

  onDestroy(clearConfirmTimer)
</script>

<div
  class="sidebar-item"
  class:selected
  data-testid="sidebar-item"
  role="button"
  tabindex="0"
  onclick={handleRowClick}
  onkeydown={handleRowKey}
>
  <span
    class="status-dot status-{win.status}"
    data-testid="status-dot"
    aria-label={`status: ${win.status}`}
  ></span>
  <div class="info">
    <span class="name">{win.name}</span>
    <span class="container-id">{win.container_id.slice(0, 12)}</span>
  </div>
  {#if confirming}
    <div class="confirm-group">
      <button
        type="button"
        class="confirm-btn"
        aria-label="confirm delete"
        onclick={handleConfirm}
      >Delete?</button>
      <button
        type="button"
        class="cancel-btn"
        aria-label="cancel"
        onclick={handleCancel}
      >×</button>
    </div>
  {:else}
    <button
      type="button"
      class="delete-btn"
      aria-label="delete"
      onclick={handleDeleteClick}
    >Delete</button>
  {/if}
</div>

<style>
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--fg-1);
    transition: background 120ms ease, color 120ms ease;
  }

  .sidebar-item:hover {
    background: var(--bg-1);
    color: var(--fg-0);
  }

  .sidebar-item.selected {
    background: var(--bg-2);
    color: var(--fg-0);
    border-left-color: var(--accent);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--fg-2);
  }

  .status-dot.status-running { background: var(--ok); }
  .status-dot.status-stopped { background: var(--fg-2); }
  .status-dot.status-unknown { background: var(--fg-2); }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 0.9rem;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .container-id {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
  }

  .delete-btn,
  .confirm-btn,
  .cancel-btn {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  }

  .sidebar-item:hover .delete-btn,
  .sidebar-item:hover .confirm-btn,
  .sidebar-item:hover .cancel-btn,
  .sidebar-item.selected .delete-btn,
  .sidebar-item.selected .confirm-btn,
  .sidebar-item.selected .cancel-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .confirm-group {
    display: flex;
    gap: 0.25rem;
    opacity: 1;
  }

  .confirm-btn {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
    opacity: 1;
  }

  .cancel-btn {
    opacity: 1;
  }
</style>
```

- [ ] **Step 4: Run to verify tests pass**

Run:
```bash
cd window-manager && npm run test:renderer -- SidebarItem
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/SidebarItem.svelte \
        window-manager/tests/renderer/SidebarItem.test.ts
git commit -m "feat(renderer): add SidebarItem with inline delete confirm"
```

---

### Task 12: Restyle `CreateWindow.svelte` with expand/collapse + extend its test

Before wiring into `Sidebar`, adjust `CreateWindow` so it fits in the sidebar header: a small `+` button that expands to an input row on click, collapses on create or Escape.

**Files:**
- Modify: `window-manager/src/renderer/src/components/CreateWindow.svelte`
- Modify: `window-manager/tests/renderer/CreateWindow.test.ts`

- [ ] **Step 1: Read existing test**

Open `window-manager/tests/renderer/CreateWindow.test.ts` and confirm what it asserts. Do not change existing test assertions except where they assume the input is always visible. (Existing tests render the component and interact with the input directly — we need the input to be present for them to pass, so start expanded by default in a test override, OR change the default to start expanded and only collapse on `+` toggle. We'll take the simpler path: keep `expanded` state but accept an optional `startExpanded` prop that tests pass in, defaulting to `false` in production.)

- [ ] **Step 2: Update the component**

Replace `window-manager/src/renderer/src/components/CreateWindow.svelte` with:

```svelte
<script lang="ts">
  import type { WindowRecord } from '../types'

  interface Props {
    onCreated?: (record: WindowRecord) => void
    startExpanded?: boolean
  }

  let { onCreated, startExpanded = false }: Props = $props()

  let expanded = $state(startExpanded)
  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || loading) return
    loading = true
    error = ''
    try {
      const record = await window.api.createWindow(trimmed)
      name = ''
      expanded = false
      onCreated?.(record)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') handleSubmit()
    else if (e.key === 'Escape') {
      expanded = false
      name = ''
      error = ''
    }
  }

  function toggle(): void {
    expanded = !expanded
    if (!expanded) {
      name = ''
      error = ''
    }
  }
</script>

<div class="create-window">
  {#if expanded}
    <div class="row">
      <input
        type="text"
        placeholder="window name"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
      />
      <button
        type="button"
        class="submit"
        aria-label="create window"
        onclick={handleSubmit}
        disabled={!name.trim() || loading}
      >Create</button>
      <button
        type="button"
        class="cancel"
        aria-label="cancel"
        onclick={toggle}
      >×</button>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {:else}
    <button
      type="button"
      class="expand"
      aria-label="new window"
      onclick={toggle}
    >+</button>
  {/if}
</div>

<style>
  .create-window {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .expand,
  .submit,
  .cancel {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .expand {
    font-size: 1rem;
    line-height: 1;
    padding: 0.15rem 0.5rem;
  }

  .expand:hover,
  .submit:hover:not(:disabled) {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error {
    font-size: 0.72rem;
    color: var(--danger);
  }
</style>
```

- [ ] **Step 3: Update `CreateWindow.test.ts`**

Open `window-manager/tests/renderer/CreateWindow.test.ts`. Where the test calls `render(CreateWindow, …)` and expects the input to be present, pass `startExpanded: true` in the props. Add a new test block at the end of the file (before the final closing brace) for the collapse/expand behavior:

```ts
  it('starts collapsed by default and shows a + button', () => {
    render(CreateWindow, {})
    expect(screen.getByRole('button', { name: /new window/i })).toBeDefined()
  })

  it('clicking + expands to show the input', async () => {
    render(CreateWindow, {})
    await fireEvent.click(screen.getByRole('button', { name: /new window/i }))
    expect(screen.getByPlaceholderText(/window name/i)).toBeDefined()
  })

  it('pressing Escape collapses back to the + button', async () => {
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText(/window name/i)
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /new window/i })).toBeDefined()
  })
```

Also update all prior tests in the file that render `CreateWindow` and expect the input to be present — add `startExpanded: true` to each `render` call so they continue to work:

```ts
    render(CreateWindow, { startExpanded: true, onCreated: mockOnCreated })
```

(Do this by inspection — every `render(CreateWindow, …)` in the file that then immediately queries for the input needs the flag.)

- [ ] **Step 4: Run the renderer test suite**

Run:
```bash
cd window-manager && npm run test:renderer -- CreateWindow
```

Expected: all `CreateWindow` tests pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/CreateWindow.svelte \
        window-manager/tests/renderer/CreateWindow.test.ts
git commit -m "feat(CreateWindow): collapse/expand button for sidebar header"
```

---

### Task 13: `Sidebar.svelte`

Composes header + list of `SidebarItem` + empty hint.

**Files:**
- Create: `window-manager/src/renderer/src/components/Sidebar.svelte`
- Create: `window-manager/tests/renderer/Sidebar.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/Sidebar.test.ts`:

```ts
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

function makeWin(id: number, name: string): WindowRecord {
  return {
    id,
    name,
    container_id: `container-${id}-xxxxxxxxxx`,
    created_at: '2026-01-01T00:00:00Z',
    status: 'running',
  }
}

describe('Sidebar', () => {
  let onSelect: ReturnType<typeof vi.fn>
  let onCreated: ReturnType<typeof vi.fn>
  let onDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSelect = vi.fn()
    onCreated = vi.fn()
    onDelete = vi.fn()
  })

  afterEach(() => cleanup())

  it('renders an item per window', () => {
    const windows = [makeWin(1, 'alpha'), makeWin(2, 'beta')]
    render(Sidebar, { windows, selectedId: null, onSelect, onCreated, onDelete })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
  })

  it('shows the empty hint when windows is empty', () => {
    render(Sidebar, { windows: [], selectedId: null, onSelect, onCreated, onDelete })
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('clicking an item forwards to onSelect with the window id', async () => {
    const w = makeWin(3, 'gamma')
    render(Sidebar, { windows: [w], selectedId: null, onSelect, onCreated, onDelete })
    await fireEvent.click(screen.getByText('gamma'))
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('passes selected state to the correct item', () => {
    const a = makeWin(1, 'a')
    const b = makeWin(2, 'b')
    const { container } = render(Sidebar, {
      windows: [a, b],
      selectedId: 2,
      onSelect,
      onCreated,
      onDelete,
    })
    const items = container.querySelectorAll('[data-testid="sidebar-item"]')
    expect(items[0].classList.contains('selected')).toBe(false)
    expect(items[1].classList.contains('selected')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd window-manager && npm run test:renderer -- Sidebar.test
```

Expected: fails — Sidebar doesn't exist.

- [ ] **Step 3: Implement `Sidebar.svelte`**

Create `window-manager/src/renderer/src/components/Sidebar.svelte`:

```svelte
<script lang="ts">
  import type { WindowRecord } from '../types'
  import SidebarItem from './SidebarItem.svelte'
  import CreateWindow from './CreateWindow.svelte'

  interface Props {
    windows: WindowRecord[]
    selectedId: number | null
    onSelect: (id: number) => void
    onCreated: (record: WindowRecord) => void
    onDelete: (id: number) => void
  }

  let { windows, selectedId, onSelect, onCreated, onDelete }: Props = $props()

  function handleItemSelect(win: WindowRecord): void {
    onSelect(win.id)
  }
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <h1>Windows</h1>
    <CreateWindow onCreated={onCreated} />
  </header>
  <nav class="sidebar-list">
    {#each windows as win (win.id)}
      <SidebarItem
        {win}
        selected={win.id === selectedId}
        onSelect={handleItemSelect}
        {onDelete}
      />
    {/each}
  </nav>
  {#if windows.length === 0}
    <p class="empty-hint">No windows. Click + to create one.</p>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    height: 100%;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }
</style>
```

- [ ] **Step 4: Run to verify pass**

Run:
```bash
cd window-manager && npm run test:renderer -- Sidebar.test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/Sidebar.svelte \
        window-manager/tests/renderer/Sidebar.test.ts
git commit -m "feat(renderer): add Sidebar component"
```

---

### Task 14: `TerminalHost.svelte` (replaces modal `Terminal.svelte`)

Inline terminal host that fills the main pane, with web-links addon.

**Files:**
- Create: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Create: `window-manager/tests/renderer/TerminalHost.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/TerminalHost.test.ts`:

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRecord } from '../../src/renderer/src/types'

const mockOpen = vi.fn()
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockOnData = vi.fn()
const mockOnResize = vi.fn()
const mockLoadAddon = vi.fn()
const mockFit = vi.fn()

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = mockOpen
    write = mockWrite
    dispose = mockDispose
    onData = mockOnData
    onResize = mockOnResize
    loadAddon = mockLoadAddon
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = mockFit
  }
  return { FitAddon }
})

const webLinksSentinel = { __kind: 'web-links' }
vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {
    constructor() {
      Object.assign(this, webLinksSentinel)
    }
  }
  return { WebLinksAddon }
})

import TerminalHost from '../../src/renderer/src/components/TerminalHost.svelte'

const mockWindow: WindowRecord = {
  id: 1,
  name: 'host-test',
  container_id: 'container123abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('TerminalHost', () => {
  let mockApi: {
    openTerminal: ReturnType<typeof vi.fn>
    sendTerminalInput: ReturnType<typeof vi.fn>
    resizeTerminal: ReturnType<typeof vi.fn>
    closeTerminal: ReturnType<typeof vi.fn>
    onTerminalData: ReturnType<typeof vi.fn>
    offTerminalData: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockApi = {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
    }
    vi.stubGlobal('api', mockApi)
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders window name and first 12 chars of container_id in the header', () => {
    render(TerminalHost, { win: mockWindow })
    expect(screen.getByText('host-test')).toBeDefined()
    expect(screen.getByText('container123')).toBeDefined()
  })

  it('loads fit and web-links addons on mount', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockLoadAddon).toHaveBeenCalledTimes(2)
    })
    const loaded = mockLoadAddon.mock.calls.map(call => call[0])
    // One should be a FitAddon (has fit()) and one should be the web-links sentinel.
    const hasFit = loaded.some(a => typeof (a as { fit?: unknown }).fit === 'function')
    const hasWebLinks = loaded.some(a => (a as { __kind?: string }).__kind === 'web-links')
    expect(hasFit).toBe(true)
    expect(hasWebLinks).toBe(true)
  })

  it('calls api.openTerminal with container_id on mount', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith('container123abc')
    })
  })

  it('subscribes to onTerminalData and writes only matching-container chunks', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.onTerminalData).toHaveBeenCalled()
    })
    const callback = mockApi.onTerminalData.mock.calls[0][0] as (c: string, d: string) => void
    callback('container123abc', 'hi')
    expect(mockWrite).toHaveBeenCalledWith('hi')
    mockWrite.mockClear()
    callback('some-other-container', 'nope')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('calls api.offTerminalData and api.closeTerminal on unmount', async () => {
    const { unmount } = render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalled()
    })
    unmount()
    expect(mockApi.offTerminalData).toHaveBeenCalled()
    expect(mockApi.closeTerminal).toHaveBeenCalledWith('container123abc')
    expect(mockDispose).toHaveBeenCalled()
  })

  it('forwards term.onData to sendTerminalInput', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockOnData).toHaveBeenCalled()
    })
    const dataHandler = mockOnData.mock.calls[0][0] as (s: string) => void
    dataHandler('ls\n')
    expect(mockApi.sendTerminalInput).toHaveBeenCalledWith('container123abc', 'ls\n')
  })

  it('forwards term.onResize to resizeTerminal', async () => {
    render(TerminalHost, { win: mockWindow })
    await vi.waitFor(() => {
      expect(mockOnResize).toHaveBeenCalled()
    })
    const resizeHandler = mockOnResize.mock.calls[0][0] as (d: { cols: number; rows: number }) => void
    resizeHandler({ cols: 120, rows: 40 })
    expect(mockApi.resizeTerminal).toHaveBeenCalledWith('container123abc', 120, 40)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd window-manager && npm run test:renderer -- TerminalHost
```

Expected: fails — component doesn't exist.

- [ ] **Step 3: Implement `TerminalHost.svelte`**

Create `window-manager/src/renderer/src/components/TerminalHost.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
  }

  let { win }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let resizeObserver: ResizeObserver | undefined

  onMount(() => {
    term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#8b5cf6',
        selectionBackground: '#3f3f46',
      },
      scrollback: 1000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(terminalEl)
    fitAddon.fit()

    resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalEl)

    window.api.openTerminal(win.container_id)

    window.api.onTerminalData((containerId: string, data: string) => {
      if (containerId === win.container_id) {
        term?.write(data)
      }
    })

    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data)
    })

    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows)
    })
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id)
    term?.dispose()
  })
</script>

<section class="terminal-host">
  <header class="terminal-host-header">
    <span class="name">{win.name}</span>
    <span class="container-id">{win.container_id.slice(0, 12)}</span>
  </header>
  <div class="terminal-body" bind:this={terminalEl}></div>
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .terminal-host-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }

  .name {
    font-family: var(--font-ui);
    font-weight: 600;
    color: var(--fg-0);
    font-size: 0.88rem;
  }

  .container-id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-2);
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
```

- [ ] **Step 4: Run to verify pass**

Run:
```bash
cd window-manager && npm run test:renderer -- TerminalHost
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte \
        window-manager/tests/renderer/TerminalHost.test.ts
git commit -m "feat(renderer): add TerminalHost with web-links addon"
```

---

### Task 15: `MainPane.svelte`

Keyed wrapper around `EmptyState` / `TerminalHost`.

**Files:**
- Create: `window-manager/src/renderer/src/components/MainPane.svelte`
- Create: `window-manager/tests/renderer/MainPane.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/MainPane.test.ts`:

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRecord } from '../../src/renderer/src/types'

// Stub xterm-related modules so TerminalHost imports don't fail at mount time.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    onResize = vi.fn()
    loadAddon = vi.fn()
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon }
})

import MainPane from '../../src/renderer/src/components/MainPane.svelte'

const winA: WindowRecord = {
  id: 1,
  name: 'alpha',
  container_id: 'abc123456789xxx',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('MainPane', () => {
  beforeEach(() => {
    vi.stubGlobal('api', {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
    })
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders EmptyState when selected is null', () => {
    render(MainPane, { selected: null })
    expect(screen.getByText('No window selected')).toBeDefined()
  })

  it('renders TerminalHost when selected is a record', () => {
    render(MainPane, { selected: winA })
    expect(screen.getByText('alpha')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd window-manager && npm run test:renderer -- MainPane
```

Expected: fails — component doesn't exist.

- [ ] **Step 3: Implement `MainPane.svelte`**

Create `window-manager/src/renderer/src/components/MainPane.svelte`:

```svelte
<script lang="ts">
  import type { WindowRecord } from '../types'
  import EmptyState from './EmptyState.svelte'
  import TerminalHost from './TerminalHost.svelte'

  interface Props {
    selected: WindowRecord | null
  }

  let { selected }: Props = $props()
</script>

<main class="main-pane">
  {#if selected}
    {#key selected.id}
      <TerminalHost win={selected} />
    {/key}
  {:else}
    <EmptyState />
  {/if}
</main>

<style>
  .main-pane {
    height: 100%;
    overflow: hidden;
    background: var(--bg-0);
  }
</style>
```

- [ ] **Step 4: Run to verify pass**

Run:
```bash
cd window-manager && npm run test:renderer -- MainPane
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/MainPane.svelte \
        window-manager/tests/renderer/MainPane.test.ts
git commit -m "feat(renderer): add MainPane component"
```

---

### Task 16: Rewrite `App.svelte` as thin shell

Switch the root to use `Sidebar` + `MainPane`. The old `Terminal.svelte` and `WindowCard.svelte` become orphaned (still in tree, cleaned up in Phase 3).

**Files:**
- Modify: `window-manager/src/renderer/src/App.svelte`

- [ ] **Step 1: Replace `App.svelte`**

Replace the full contents of `window-manager/src/renderer/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import type { WindowRecord } from './types'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane from './components/MainPane.svelte'

  let windows = $state<WindowRecord[]>([])
  let selectedId = $state<number | null>(null)

  onMount(async () => {
    windows = await window.api.listWindows()
    if (windows.length > 0) {
      selectedId = windows[0].id
    }
  })

  function handleCreated(record: WindowRecord): void {
    windows = [...windows, record]
    selectedId = record.id
  }

  function handleSelect(id: number): void {
    selectedId = id
  }

  async function handleDelete(id: number): Promise<void> {
    await window.api.deleteWindow(id)
    windows = windows.filter(w => w.id !== id)
    if (selectedId === id) {
      selectedId = windows[0]?.id ?? null
    }
  }

  let selected = $derived(windows.find(w => w.id === selectedId) ?? null)
</script>

<div class="app">
  <Sidebar
    {windows}
    {selectedId}
    onSelect={handleSelect}
    onCreated={handleCreated}
    onDelete={handleDelete}
  />
  <MainPane {selected} />
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 220px 1fr;
    height: 100vh;
    width: 100vw;
    background: var(--bg-0);
    color: var(--fg-0);
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd window-manager && npm run typecheck
```

Expected: passes.

- [ ] **Step 3: Run all renderer tests**

Run:
```bash
cd window-manager && npm run test:renderer
```

Expected: all tests pass. The old `WindowCard.test.ts` and `Terminal.test.ts` still exist and still pass (they test components that exist but are no longer imported anywhere).

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/renderer/src/App.svelte
git commit -m "feat(renderer): App.svelte now uses Sidebar + MainPane"
```

---

## Phase 3 — Cleanup: remove orphaned components + assets

### Task 17: Delete replaced components, tests, and the unused background image

**Files:**
- Delete: `window-manager/src/renderer/src/components/Terminal.svelte`
- Delete: `window-manager/src/renderer/src/components/WindowCard.svelte`
- Delete: `window-manager/src/renderer/src/components/Versions.svelte`
- Delete: `window-manager/src/renderer/src/assets/wavy-lines.svg`
- Delete: `window-manager/src/renderer/src/assets/electron.svg` (confirm unused first — see Step 1)
- Delete: `window-manager/src/renderer/src/assets/main.css` (confirm unused first — see Step 1)
- Delete: `window-manager/tests/renderer/Terminal.test.ts`
- Delete: `window-manager/tests/renderer/WindowCard.test.ts`

- [ ] **Step 1: Verify no imports reference the files to be deleted**

Use the Grep tool to search for each of these strings inside `window-manager/src` and `window-manager/tests`:

- `Terminal.svelte`
- `WindowCard.svelte`
- `Versions.svelte`
- `wavy-lines`
- `electron.svg`
- `assets/main.css`

Expected: no matches in `src/` for `Terminal.svelte`, `WindowCard.svelte`, `Versions.svelte`, `wavy-lines`. The only matches for `Terminal.svelte` / `WindowCard.svelte` should be inside the test files we are about to delete. If `electron.svg` or `assets/main.css` still have matches in `src/` or `index.html`, skip deleting those two files for this task and note it — they'll be handled separately.

- [ ] **Step 2: Delete files**

Run:
```bash
cd window-manager && \
  rm src/renderer/src/components/Terminal.svelte \
     src/renderer/src/components/WindowCard.svelte \
     src/renderer/src/components/Versions.svelte \
     src/renderer/src/assets/wavy-lines.svg \
     tests/renderer/Terminal.test.ts \
     tests/renderer/WindowCard.test.ts
```

If Step 1 confirmed `electron.svg` and `assets/main.css` are unused, also delete them:
```bash
cd window-manager && rm src/renderer/src/assets/electron.svg src/renderer/src/assets/main.css
```

- [ ] **Step 3: Run full test suite**

Run:
```bash
cd window-manager && npm run test
```

Expected: all main + renderer tests pass. No compile errors from missing files.

- [ ] **Step 4: Typecheck**

Run:
```bash
cd window-manager && npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore: remove replaced components and unused assets"
```

---

## Phase 4 — Verification: full test suite, build, manual checklist

### Task 18: Full automated verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run:
```bash
cd window-manager && npm run test
```

Expected: all tests pass — `db`, `windowService`, `terminalService`, `ipcHandlers`, `placeholder` (main); `CreateWindow`, `EmptyState`, `MainPane`, `Sidebar`, `SidebarItem`, `TerminalHost`, `placeholder` (renderer).

- [ ] **Step 2: Typecheck**

Run:
```bash
cd window-manager && npm run typecheck
```

Expected: passes (both `typecheck:node` and `svelte-check`).

- [ ] **Step 3: Lint**

Run:
```bash
cd window-manager && npm run lint
```

Expected: no errors. Warnings are acceptable if pre-existing; note any new ones.

- [ ] **Step 4: Build**

Run:
```bash
cd window-manager && npm run build
```

Expected: typecheck passes, Vite builds main + preload + renderer without errors.

- [ ] **Step 5: Commit any auto-fixed formatting (if needed)**

If `npm run lint` or `npm run build` produced any auto-fixes (e.g. via Prettier integration), stage and commit them:
```bash
git add -u
git commit -m "style: auto-format after implementation"
```

Otherwise, skip.

---

### Task 19: Manual verification checklist

This is a human-run checklist. **The agent must NOT run `npm start` / `npm run dev` / Electron itself** — per the repo's rules, the user launches the app and reports what they see. The agent's role is to hand the user this checklist and help diagnose any failures.

**Prerequisites:**
- Docker daemon running and reachable.
- `cc` Docker image built with `tmux` installed on `$PATH`.

**Steps (user runs the app, reports results):**

- [ ] **1. Launch the app** (user runs `npm start` from `window-manager/`). Sidebar renders with empty hint; no errors in DevTools console.
- [ ] **2. Create "alpha"**: click `+`, type `alpha`, Enter. Sidebar shows the item. It is auto-selected. Terminal attaches in the main pane.
- [ ] **3. Type `echo hello`** → output is clean: no `;;;;EEEE` garbage, no `H` prefix on the prompt.
- [ ] **4. URL copy test**: run `echo "https://anthropic.com/research"`. Click the URL (it should be underlined/clickable via the web-links addon). Select and copy the text with the mouse → paste elsewhere. The pasted text MUST match `https://anthropic.com/research` verbatim, not a URL-encoded version.
- [ ] **5. Second window**: create "beta". Switch to it in the sidebar. Type `echo beta`. Switch back to alpha — prior alpha pane state is visible (tmux replay).
- [ ] **6. Delete test**: click delete on beta, then click confirm. Beta disappears. Rapidly click delete + confirm on another window (or double-click before the UI removes the row). No error toast, no "Window N not found" error in DevTools console.
- [ ] **7. Restart persistence**: quit the app, relaunch. Alpha still shows in sidebar. Opening it shows the prior tmux state.
- [ ] **8. External stop reconcile**: from a separate shell, run `docker stop <alpha-container-id>` (take the id from the sidebar item). Relaunch the app. Alpha is gone from the sidebar.
- [ ] **9. Docker down**: stop the Docker daemon. Launch the app. No crash; the app opens with empty state (reconcile caught the error). Restart Docker when done.

If any step fails, halt and investigate — do not mark the task complete until every item is green.

- [ ] **Step 10: Final commit (if any fixes needed during manual verification)**

If manual verification surfaced a defect, fix it with a normal TDD loop (failing test → implementation → green → commit). Then re-run the manual checklist from Step 1.

---

## Self-Review Notes

Spec coverage check (done against `docs/superpowers/specs/2026-04-11-window-manager-fixes-and-modernize-design.md`):

| Spec section | Covered by |
|---|---|
| External requirements (tmux in `cc` image, optional fonts) | Documented in plan header; verified manually in Task 19 |
| `theme.css` | Task 9 |
| `App.svelte` thin shell | Task 16 |
| `Sidebar.svelte` | Task 13 |
| `SidebarItem.svelte` | Task 11 |
| `MainPane.svelte` | Task 15 |
| `EmptyState.svelte` | Task 10 |
| `TerminalHost.svelte` | Task 14 |
| `CreateWindow.svelte` restyle | Task 12 |
| `WindowRecord` type (both files) | Task 2 (bridge) + Task 3 (status logic) |
| `windowService` statusMap + `listWindows` / `createWindow` | Task 3 |
| `reconcileWindows` | Task 4 |
| `deleteWindow` idempotent | Task 5 |
| `terminalService` tmux + TERM + idempotent + isDestroyed | Task 6 |
| `closeTerminalSessionFor` export + integration | Tasks 6 + 7 |
| `main/index.ts` reconcile wiring | Task 8 |
| Remove old components + assets | Task 17 |
| `tests/main/terminalService.test.ts` (NEW) | Task 6 |
| `tests/renderer/*` new component tests | Tasks 10–15 |
| Bug 1 (delete "not found") | Task 5 |
| Bug 2 (copy URL-encoded) | Task 14 (web-links addon) + Task 6 (TERM env) |
| Bug 3 (garbage output) | Task 6 (tmux + TERM) |
| Bug 4 (weird prompt) | Task 6 (tmux + TERM) |
| Error handling: docker down | Task 4 (reconcile catch) + Task 8 (startup catch) |
| Manual verification checklist | Task 19 |

Placeholder scan: none found. Every step includes the actual code or command.

Type consistency: the `WindowRecord` and `WindowStatus` types are identical in the two declarations (`src/main/windowService.ts` and `src/renderer/src/types.ts`). Status values (`'running' | 'stopped' | 'unknown'`) are used consistently across tests, services, and the `SidebarItem` CSS classes (`.status-running`, `.status-stopped`, `.status-unknown`). The `closeTerminalSessionFor` function is defined once in Task 6 and referenced consistently in Task 7.

Scope check: single spec, single plan. Fits in one execution run.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-window-manager-fixes-and-modernize.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

