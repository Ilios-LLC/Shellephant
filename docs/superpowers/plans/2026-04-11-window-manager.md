# Window Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Svelte + Electron desktop app that manages named Docker containers ("windows") with embedded terminal access and SQLite persistence.

**Architecture:** electron-vite scaffold with main/preload/renderer separation. Main process owns Docker (dockerode) and SQLite (better-sqlite3). Renderer is a pure Svelte card dashboard. IPC bridges UI to backend.

**Tech Stack:** Electron, electron-vite, Svelte 4, TypeScript, dockerode, better-sqlite3, xterm.js (@xterm/xterm), Vitest, @testing-library/svelte

---

## File Map

```
window-manager/
├── electron.vite.config.ts          ← electron-vite build config (from scaffold, no changes)
├── vitest.node.config.ts            ← vitest config for main process tests (node env)
├── vitest.renderer.config.ts        ← vitest config for renderer tests (jsdom env)
├── package.json                     ← add deps + test scripts
├── src/
│   ├── main/
│   │   ├── index.ts                 ← Electron entry: app lifecycle, BrowserWindow, IPC init
│   │   ├── db.ts                    ← SQLite init/migration, getDb/initDb/closeDb
│   │   ├── windowService.ts         ← createWindow/listWindows/deleteWindow
│   │   ├── terminalService.ts       ← Docker exec session open/write/resize/close
│   │   └── ipcHandlers.ts           ← register all ipcMain.handle + ipcMain.on
│   ├── preload/
│   │   └── index.ts                 ← contextBridge API (replace scaffold default)
│   └── renderer/
│       └── src/
│           ├── types.ts             ← WindowRecord interface + window.api type declaration
│           ├── App.svelte           ← root: composes CreateWindow, WindowCard grid, Terminal modal
│           ├── app.css              ← global styles
│           └── components/
│               ├── CreateWindow.svelte
│               ├── WindowCard.svelte
│               └── Terminal.svelte
└── tests/
    ├── main/
    │   ├── db.test.ts
    │   ├── windowService.test.ts
    │   └── ipcHandlers.test.ts
    └── renderer/
        ├── setup.ts                 ← @testing-library/jest-dom import
        ├── CreateWindow.test.ts
        ├── WindowCard.test.ts
        └── Terminal.test.ts
```

---

## Phase 1: Foundation

### Task 1: Scaffold project and configure testing

**Files:**
- Create: `window-manager/` (scaffold)
- Create: `vitest.node.config.ts`
- Create: `vitest.renderer.config.ts`
- Create: `tests/renderer/setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Scaffold the project**

```bash
npm create electron-vite@latest window-manager -- --template svelte-ts
cd window-manager
npm install
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install dockerode better-sqlite3 @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D vitest @testing-library/svelte@^4 @testing-library/jest-dom jsdom \
  @types/dockerode @types/better-sqlite3 @electron/rebuild
```

- [ ] **Step 4: Add rebuild script and test scripts to package.json**

Open `package.json` and add to `"scripts"`:

```json
"rebuild": "electron-rebuild -f -w better-sqlite3",
"test:main": "vitest run --config vitest.node.config.ts",
"test:renderer": "vitest run --config vitest.renderer.config.ts",
"test": "npm run test:main && npm run test:renderer"
```

- [ ] **Step 5: Create vitest.node.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'main',
    include: ['tests/main/**/*.test.ts'],
    environment: 'node',
    globals: true,
  }
})
```

- [ ] **Step 6: Create vitest.renderer.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    name: 'renderer',
    include: ['tests/renderer/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/renderer/setup.ts'],
  }
})
```

- [ ] **Step 7: Create tests/renderer/setup.ts**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 8: Rebuild native modules for Electron**

```bash
npm run rebuild
```

Expected: completes without error, `better-sqlite3` is recompiled for the local Electron version.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: scaffold electron-vite svelte-ts project with vitest"
```

---

### Task 2: DB module

**Files:**
- Create: `src/main/db.ts`
- Create: `tests/main/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from '../../src/main/db'

describe('db', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('creates the windows table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='windows'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('windows table has all expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('container_id')
    expect(names).toContain('created_at')
    expect(names).toContain('deleted_at')
  })

  it('getDb throws if initDb was not called', () => {
    closeDb()
    expect(() => getDb()).toThrow('Database not initialized')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:main -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/main/db'`

- [ ] **Step 3: Implement src/main/db.ts**

```typescript
import Database from 'better-sqlite3'

let _db: Database.Database | null = null

export function initDb(dbPath: string): void {
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      container_id TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at   DATETIME DEFAULT NULL
    )
  `)
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized')
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:main -- --reporter=verbose
```

Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add SQLite db module with init/get/close"
```

---

### Task 3: Window service

**Files:**
- Create: `src/main/windowService.ts`
- Create: `tests/main/windowService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/windowService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
}
const mockCreateContainer = vi.fn().mockResolvedValue(mockContainer)
const mockGetContainer = vi.fn().mockReturnValue(mockContainer)

vi.mock('dockerode', () => ({
  default: vi.fn(() => ({
    createContainer: mockCreateContainer,
    getContainer: mockGetContainer,
  }))
}))

import { createWindow, listWindows, deleteWindow } from '../../src/main/windowService'

describe('windowService', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockCreateContainer.mockResolvedValue(mockContainer)
    mockGetContainer.mockReturnValue(mockContainer)
  })

  afterEach(() => {
    closeDb()
  })

  describe('createWindow', () => {
    it('returns a record with the given name and container_id', async () => {
      const result = await createWindow('my-window')
      expect(result.name).toBe('my-window')
      expect(result.container_id).toBe('mock-container-abc123')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('creates a Docker container from the cc image', async () => {
      await createWindow('test')
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Image: 'cc' })
      )
    })

    it('starts the container', async () => {
      await createWindow('test')
      expect(mockStart).toHaveBeenCalled()
    })

    it('persists the window to SQLite', async () => {
      await createWindow('persisted')
      expect(listWindows()).toHaveLength(1)
      expect(listWindows()[0].name).toBe('persisted')
    })
  })

  describe('listWindows', () => {
    it('returns empty array when no windows exist', () => {
      expect(listWindows()).toEqual([])
    })

    it('excludes soft-deleted windows', async () => {
      await createWindow('active')
      await createWindow('to-delete')
      const id = listWindows().find(w => w.name === 'to-delete')!.id
      await deleteWindow(id)
      const result = listWindows()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('active')
    })
  })

  describe('deleteWindow', () => {
    it('sets deleted_at in the database', async () => {
      await createWindow('to-delete')
      const [win] = listWindows()
      await deleteWindow(win.id)
      const row = getDb()
        .prepare('SELECT deleted_at FROM windows WHERE id = ?')
        .get(win.id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('stops the Docker container', async () => {
      await createWindow('to-stop')
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockStop).toHaveBeenCalled()
    })

    it('throws when window id does not exist', async () => {
      await expect(deleteWindow(99999)).rejects.toThrow('Window 99999 not found')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:main -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/main/windowService'`

- [ ] **Step 3: Implement src/main/windowService.ts**

```typescript
import Dockerode from 'dockerode'
import { getDb } from './db'

export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
}

const docker = new Dockerode()

export async function createWindow(name: string): Promise<WindowRecord> {
  const container = await docker.createContainer({
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

  return {
    id: result.lastInsertRowid as number,
    name,
    container_id: container.id,
    created_at: new Date().toISOString(),
  }
}

export function listWindows(): WindowRecord[] {
  return getDb()
    .prepare('SELECT id, name, container_id, created_at FROM windows WHERE deleted_at IS NULL')
    .all() as WindowRecord[]
}

export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string } | undefined

  if (!row) throw new Error(`Window ${id} not found`)

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)

  try {
    await docker.getContainer(row.container_id).stop({ t: 1 })
  } catch {
    // Container may already be stopped; ignore
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:main -- --reporter=verbose
```

Expected: PASS — all tests in `db.test.ts` and `windowService.test.ts` pass

- [ ] **Step 5: Commit**

```bash
git add src/main/windowService.ts tests/main/windowService.test.ts
git commit -m "feat: add window service with create/list/delete"
```

---

## Phase 2: Main Process IPC Layer

### Task 4: Terminal service

**Files:**
- Create: `src/main/terminalService.ts`

No unit tests for this module — it depends tightly on live Docker exec streams. IPC handler tests in Task 5 verify the integration boundary.

- [ ] **Step 1: Create src/main/terminalService.ts**

```typescript
import Dockerode from 'dockerode'
import type { BrowserWindow } from 'electron'

const docker = new Dockerode()

interface TerminalSession {
  stream: NodeJS.ReadWriteStream
  exec: Dockerode.Exec
}

const sessions = new Map<string, TerminalSession>()

export async function openTerminal(containerId: string, win: BrowserWindow): Promise<void> {
  const container = docker.getContainer(containerId)

  const exec = await container.exec({
    Cmd: ['/bin/bash'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  })

  const stream = (await exec.start({ hijack: true, stdin: true })) as NodeJS.ReadWriteStream

  sessions.set(containerId, { stream, exec })

  stream.on('data', (chunk: Buffer) => {
    win.webContents.send('terminal:data', containerId, chunk.toString())
  })

  stream.on('end', () => {
    sessions.delete(containerId)
    win.webContents.send('terminal:data', containerId, '\r\n[Session ended]\r\n')
  })
}

export function writeInput(containerId: string, data: string): void {
  sessions.get(containerId)?.stream.write(data)
}

export async function resizeTerminal(containerId: string, cols: number, rows: number): Promise<void> {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main/terminalService.ts
git commit -m "feat: add terminal service for Docker exec sessions"
```

---

### Task 5: IPC handlers

**Files:**
- Create: `src/main/ipcHandlers.ts`
- Create: `tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/ipcHandlers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('../../src/main/windowService', () => ({
  createWindow: vi.fn(),
  listWindows: vi.fn(),
  deleteWindow: vi.fn(),
}))

vi.mock('../../src/main/terminalService', () => ({
  openTerminal: vi.fn(),
  writeInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
}))

import { ipcMain } from 'electron'
import {
  createWindow,
  listWindows,
  deleteWindow,
} from '../../src/main/windowService'
import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
} from '../../src/main/terminalService'
import { registerIpcHandlers } from '../../src/main/ipcHandlers'

const mockWin = { webContents: {} } as any

function getHandler(channel: string) {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

function getListener(channel: string) {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`No listener registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers(mockWin)
  })

  it('registers window:create handler that calls createWindow', async () => {
    const record = { id: 1, name: 'test', container_id: 'abc', created_at: '2026-01-01' }
    vi.mocked(createWindow).mockResolvedValue(record)
    const result = await getHandler('window:create')({}, 'test')
    expect(createWindow).toHaveBeenCalledWith('test')
    expect(result).toEqual(record)
  })

  it('registers window:list handler that calls listWindows', async () => {
    const records = [{ id: 1, name: 'w', container_id: 'x', created_at: '2026-01-01' }]
    vi.mocked(listWindows).mockReturnValue(records)
    const result = await getHandler('window:list')({})
    expect(listWindows).toHaveBeenCalled()
    expect(result).toEqual(records)
  })

  it('registers window:delete handler that calls deleteWindow', async () => {
    vi.mocked(deleteWindow).mockResolvedValue(undefined)
    await getHandler('window:delete')({}, 1)
    expect(deleteWindow).toHaveBeenCalledWith(1)
  })

  it('registers terminal:open handler that calls openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    await getHandler('terminal:open')({}, 'container-abc')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin)
  })

  it('registers terminal:input listener that calls writeInput', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n')
  })

  it('registers terminal:resize listener that calls resizeTerminal', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24)
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24)
  })

  it('registers terminal:close listener that calls closeTerminal', () => {
    getListener('terminal:close')({}, 'container-abc')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:main -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/main/ipcHandlers'`

- [ ] **Step 3: Implement src/main/ipcHandlers.ts**

```typescript
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle('window:create', (_, name: string) => createWindow(name))
  ipcMain.handle('window:list', () => listWindows())
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))
  ipcMain.handle('terminal:open', (_, containerId: string) => openTerminal(containerId, win))
  ipcMain.on('terminal:input', (_, containerId: string, data: string) => writeInput(containerId, data))
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number) => resizeTerminal(containerId, cols, rows))
  ipcMain.on('terminal:close', (_, containerId: string) => closeTerminal(containerId))
}
```

- [ ] **Step 4: Run all main tests to verify they pass**

```bash
npm run test:main -- --reporter=verbose
```

Expected: PASS — all tests in db, windowService, ipcHandlers

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcHandlers.ts tests/main/ipcHandlers.test.ts
git commit -m "feat: add IPC handlers for window and terminal channels"
```

---

### Task 6: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Replace src/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  createWindow: (name: string) =>
    ipcRenderer.invoke('window:create', name),

  listWindows: () =>
    ipcRenderer.invoke('window:list'),

  deleteWindow: (id: number) =>
    ipcRenderer.invoke('window:delete', id),

  openTerminal: (containerId: string) =>
    ipcRenderer.invoke('terminal:open', containerId),

  sendTerminalInput: (containerId: string, data: string) =>
    ipcRenderer.send('terminal:input', containerId, data),

  resizeTerminal: (containerId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows),

  closeTerminal: (containerId: string) =>
    ipcRenderer.send('terminal:close', containerId),

  onTerminalData: (callback: (containerId: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, data) => callback(containerId, data)),

  offTerminalData: () =>
    ipcRenderer.removeAllListeners('terminal:data'),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose window and terminal API via contextBridge"
```

---

### Task 7: Main entry

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace src/main/index.ts**

```typescript
import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { initDb } from './db'
import { registerIpcHandlers } from './ipcHandlers'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'windows.db')
  initDb(dbPath)

  const win = createWindow()
  registerIpcHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      registerIpcHandlers(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: Run main tests to confirm nothing regressed**

```bash
npm run test:main -- --reporter=verbose
```

Expected: PASS — all main tests still pass

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire up Electron main entry with db and IPC"
```

---

## Phase 3: Renderer UI

### Task 8: Types and renderer entry

**Files:**
- Create: `src/renderer/src/types.ts`
- Modify: `src/renderer/src/main.ts` (verify scaffold import of App.svelte — no change needed)

- [ ] **Step 1: Create src/renderer/src/types.ts**

```typescript
export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
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

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/types.ts
git commit -m "feat: add shared renderer types and window.api declaration"
```

---

### Task 9: CreateWindow component

**Files:**
- Create: `src/renderer/src/components/CreateWindow.svelte`
- Create: `tests/renderer/CreateWindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/CreateWindow.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import CreateWindow from '../../src/renderer/src/components/CreateWindow.svelte'

const mockCreateWindow = vi.fn()

beforeEach(() => {
  vi.stubGlobal('api', { createWindow: mockCreateWindow })
  mockCreateWindow.mockResolvedValue({
    id: 1,
    name: 'test-window',
    container_id: 'abc123',
    created_at: '2026-04-11T00:00:00.000Z',
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('CreateWindow', () => {
  it('renders a text input and create button', () => {
    render(CreateWindow)
    expect(screen.getByPlaceholderText('Window name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Window' })).toBeInTheDocument()
  })

  it('calls api.createWindow with trimmed name on button click', async () => {
    render(CreateWindow)
    await fireEvent.input(screen.getByPlaceholderText('Window name'), {
      target: { value: '  my-window  ' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create Window' }))
    expect(mockCreateWindow).toHaveBeenCalledWith('my-window')
  })

  it('clears input after successful creation', async () => {
    render(CreateWindow)
    const input = screen.getByPlaceholderText('Window name') as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'my-window' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create Window' }))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('disables button when input is empty', () => {
    render(CreateWindow)
    expect(screen.getByRole('button', { name: 'Create Window' })).toBeDisabled()
  })

  it('dispatches created event with the new window record', async () => {
    const { component } = render(CreateWindow)
    const handler = vi.fn()
    component.$on('created', handler)
    await fireEvent.input(screen.getByPlaceholderText('Window name'), {
      target: { value: 'dispatched-window' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create Window' }))
    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.objectContaining({ name: 'test-window' }) })
      )
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/renderer/src/components/CreateWindow.svelte'`

- [ ] **Step 3: Create src/renderer/src/components/CreateWindow.svelte**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { WindowRecord } from '../types'

  const dispatch = createEventDispatcher<{ created: WindowRecord }>()

  let name = ''
  let loading = false
  let error = ''

  async function handleSubmit() {
    if (!name.trim()) return
    loading = true
    error = ''
    try {
      const record = await window.api.createWindow(name.trim())
      dispatch('created', record)
      name = ''
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create window'
    } finally {
      loading = false
    }
  }
</script>

<div class="create-window">
  <input
    type="text"
    placeholder="Window name"
    bind:value={name}
    disabled={loading}
    on:keydown={(e) => e.key === 'Enter' && handleSubmit()}
  />
  <button on:click={handleSubmit} disabled={loading || !name.trim()}>
    {loading ? 'Creating...' : 'Create Window'}
  </button>
  {#if error}<p class="error">{error}</p>{/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: PASS — all 5 CreateWindow tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CreateWindow.svelte tests/renderer/CreateWindow.test.ts
git commit -m "feat: add CreateWindow component with tests"
```

---

### Task 10: WindowCard component

**Files:**
- Create: `src/renderer/src/components/WindowCard.svelte`
- Create: `tests/renderer/WindowCard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/WindowCard.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import WindowCard from '../../src/renderer/src/components/WindowCard.svelte'

const mockWindow = {
  id: 1,
  name: 'my-window',
  container_id: 'abcdef123456789',
  created_at: '2026-04-11T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WindowCard', () => {
  it('renders the window name', () => {
    render(WindowCard, { props: { win: mockWindow } })
    expect(screen.getByText('my-window')).toBeInTheDocument()
  })

  it('renders first 12 chars of container_id', () => {
    render(WindowCard, { props: { win: mockWindow } })
    expect(screen.getByText('abcdef123456')).toBeInTheDocument()
  })

  it('renders a delete button', () => {
    render(WindowCard, { props: { win: mockWindow } })
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('dispatches open event with window record when card clicked', async () => {
    const { component } = render(WindowCard, { props: { win: mockWindow } })
    const handler = vi.fn()
    component.$on('open', handler)
    await fireEvent.click(screen.getByRole('button', { name: 'my-window' }))
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: mockWindow })
    )
  })

  it('dispatches delete event with window id when delete clicked', async () => {
    const { component } = render(WindowCard, { props: { win: mockWindow } })
    const handler = vi.fn()
    component.$on('delete', handler)
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 1 })
    )
  })

  it('delete click does not also trigger open', async () => {
    const { component } = render(WindowCard, { props: { win: mockWindow } })
    const openHandler = vi.fn()
    component.$on('open', openHandler)
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(openHandler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/renderer/src/components/WindowCard.svelte'`

- [ ] **Step 3: Create src/renderer/src/components/WindowCard.svelte**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { WindowRecord } from '../types'

  export let win: WindowRecord

  const dispatch = createEventDispatcher<{ open: WindowRecord; delete: number }>()

  function handleOpen() {
    dispatch('open', win)
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation()
    dispatch('delete', win.id)
  }
</script>

<div class="window-card">
  <button class="card-body" aria-label={win.name} on:click={handleOpen}>
    <h3>{win.name}</h3>
    <p class="container-id">{win.container_id.slice(0, 12)}</p>
  </button>
  <button class="delete-btn" on:click={handleDelete}>Delete</button>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: PASS — all 6 WindowCard tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WindowCard.svelte tests/renderer/WindowCard.test.ts
git commit -m "feat: add WindowCard component with tests"
```

---

### Task 11: Terminal component

**Files:**
- Create: `src/renderer/src/components/Terminal.svelte`
- Create: `tests/renderer/Terminal.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/Terminal.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import Terminal from '../../src/renderer/src/components/Terminal.svelte'

const mockWin = {
  id: 1,
  name: 'test-win',
  container_id: 'container-abc',
  created_at: '2026-04-11T00:00:00.000Z',
}

const mockOpenTerminal = vi.fn().mockResolvedValue(undefined)
const mockSendTerminalInput = vi.fn()
const mockResizeTerminal = vi.fn()
const mockCloseTerminal = vi.fn()
const mockOnTerminalData = vi.fn()
const mockOffTerminalData = vi.fn()

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    dispose: vi.fn(),
  }))
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  }))
}))

beforeEach(() => {
  vi.stubGlobal('api', {
    openTerminal: mockOpenTerminal,
    sendTerminalInput: mockSendTerminalInput,
    resizeTerminal: mockResizeTerminal,
    closeTerminal: mockCloseTerminal,
    onTerminalData: mockOnTerminalData,
    offTerminalData: mockOffTerminalData,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Terminal', () => {
  it('renders the window name in the header', async () => {
    render(Terminal, { props: { win: mockWin } })
    expect(screen.getByText('test-win')).toBeInTheDocument()
  })

  it('renders a close button', () => {
    render(Terminal, { props: { win: mockWin } })
    expect(screen.getByRole('button', { name: '×' })).toBeInTheDocument()
  })

  it('calls api.openTerminal with container_id on mount', async () => {
    render(Terminal, { props: { win: mockWin } })
    await vi.waitFor(() =>
      expect(mockOpenTerminal).toHaveBeenCalledWith('container-abc')
    )
  })

  it('registers terminal data listener on mount', async () => {
    render(Terminal, { props: { win: mockWin } })
    await vi.waitFor(() => expect(mockOnTerminalData).toHaveBeenCalled())
  })

  it('dispatches close event when close button clicked', async () => {
    const { component } = render(Terminal, { props: { win: mockWin } })
    const handler = vi.fn()
    component.$on('close', handler)
    await fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(handler).toHaveBeenCalled()
  })

  it('calls api.offTerminalData and api.closeTerminal on destroy', async () => {
    const { unmount } = render(Terminal, { props: { win: mockWin } })
    unmount()
    expect(mockOffTerminalData).toHaveBeenCalled()
    expect(mockCloseTerminal).toHaveBeenCalledWith('container-abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: FAIL — `Cannot find module '../../src/renderer/src/components/Terminal.svelte'`

- [ ] **Step 3: Create src/renderer/src/components/Terminal.svelte**

```svelte
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import type { WindowRecord } from '../types'

  export let win: WindowRecord

  const dispatch = createEventDispatcher<{ close: void }>()

  let terminalEl: HTMLDivElement
  let term: XTerm
  let fitAddon: FitAddon

  onMount(async () => {
    term = new XTerm({ cursorBlink: true, fontSize: 14 })
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalEl)
    fitAddon.fit()

    await window.api.openTerminal(win.container_id)

    window.api.onTerminalData((containerId, data) => {
      if (containerId === win.container_id) term.write(data)
    })

    term.onData((data) => {
      window.api.sendTerminalInput(win.container_id, data)
    })

    term.onResize(({ cols, rows }) => {
      window.api.resizeTerminal(win.container_id, cols, rows)
    })
  })

  onDestroy(() => {
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id)
    term?.dispose()
  })
</script>

<div class="terminal-overlay">
  <div class="terminal-container">
    <div class="terminal-header">
      <span>{win.name}</span>
      <button on:click={() => dispatch('close')}>×</button>
    </div>
    <div bind:this={terminalEl} class="terminal-body"></div>
  </div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:renderer -- --reporter=verbose
```

Expected: PASS — all Terminal tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Terminal.svelte tests/renderer/Terminal.test.ts
git commit -m "feat: add Terminal component with xterm.js and IPC wiring"
```

---

### Task 12: App.svelte, styles, and final wiring

**Files:**
- Modify: `src/renderer/src/App.svelte`
- Modify: `src/renderer/src/app.css`

- [ ] **Step 1: Replace src/renderer/src/App.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import CreateWindow from './components/CreateWindow.svelte'
  import WindowCard from './components/WindowCard.svelte'
  import Terminal from './components/Terminal.svelte'
  import type { WindowRecord } from './types'

  let windows: WindowRecord[] = []
  let activeTerminal: WindowRecord | null = null

  onMount(async () => {
    windows = await window.api.listWindows()
  })

  function handleCreated(e: CustomEvent<WindowRecord>) {
    windows = [...windows, e.detail]
  }

  function handleOpen(e: CustomEvent<WindowRecord>) {
    activeTerminal = e.detail
  }

  async function handleDelete(e: CustomEvent<number>) {
    await window.api.deleteWindow(e.detail)
    windows = windows.filter(w => w.id !== e.detail)
  }

  function handleTerminalClose() {
    activeTerminal = null
  }
</script>

<main>
  <header>
    <h1>Windows</h1>
    <CreateWindow on:created={handleCreated} />
  </header>
  <section class="window-grid">
    {#each windows as win (win.id)}
      <WindowCard {win} on:open={handleOpen} on:delete={handleDelete} />
    {/each}
    {#if windows.length === 0}
      <p class="empty">No windows yet. Create one above.</p>
    {/if}
  </section>
  {#if activeTerminal}
    <Terminal win={activeTerminal} on:close={handleTerminalClose} />
  {/if}
</main>
```

- [ ] **Step 2: Replace src/renderer/src/app.css**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  min-height: 100vh;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

h1 { font-size: 1.75rem; }

.create-window { display: flex; gap: 0.5rem; align-items: center; }

.create-window input {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #444;
  background: #16213e;
  color: #e0e0e0;
  font-size: 0.95rem;
  width: 220px;
}

.create-window button, .delete-btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
}

.create-window button { background: #0f3460; color: #e0e0e0; }
.create-window button:disabled { opacity: 0.4; cursor: not-allowed; }
.create-window .error { color: #ff6b6b; font-size: 0.85rem; }

.window-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.window-card {
  background: #16213e;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
}

.card-body {
  all: unset;
  cursor: pointer;
  padding: 1rem;
  flex: 1;
  display: block;
  width: 100%;
}

.card-body:hover { background: #1e2a50; }
.card-body h3 { font-size: 1rem; margin-bottom: 0.25rem; }
.container-id { font-size: 0.75rem; color: #888; font-family: monospace; }

.delete-btn {
  background: #3a1a1a;
  color: #ff6b6b;
  border-top: 1px solid #2a2a4a;
  border-radius: 0;
  width: 100%;
  padding: 0.4rem;
}

.delete-btn:hover { background: #5a1a1a; }

.empty { color: #666; margin-top: 1rem; }

.terminal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.terminal-container {
  background: #0d0d0d;
  border-radius: 10px;
  overflow: hidden;
  width: 900px;
  height: 600px;
  display: flex;
  flex-direction: column;
  border: 1px solid #333;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  font-size: 0.9rem;
}

.terminal-header button {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.2rem;
  cursor: pointer;
  line-height: 1;
}

.terminal-header button:hover { color: #fff; }

.terminal-body { flex: 1; overflow: hidden; padding: 4px; }
```

- [ ] **Step 3: Run all tests to confirm everything passes**

```bash
npm test
```

Expected: PASS — all main and renderer tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.svelte src/renderer/src/app.css
git commit -m "feat: wire up App.svelte dashboard with card grid and terminal modal"
```
