# Monaco Editor Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Monaco editor alongside the terminal in each window, toggled via buttons in the control panel, with full read/write access to the Docker container's workspace via IPC exec bridge.

**Architecture:** Three new IPC handlers (`fs:list-dir`, `fs:read-file`, `fs:write-file`) bridge Monaco to container files via `docker exec`; `TerminalHost` owns `viewMode` state and renders `EditorPane` (FileTree + MonacoEditor) conditionally; the terminal body is hidden (not unmounted) to preserve the Claude session.

**Tech Stack:** `monaco-editor` + `@monaco-editor/loader` (Vite worker config), Svelte 5 runes, Electron IPC, dockerode exec with stdin for writes.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `window-manager/package.json` | Modify | Add `monaco-editor`, `@monaco-editor/loader` |
| `src/renderer/src/lib/monacoConfig.ts` | Create | Worker setup, theme, `initMonaco()` export |
| `src/main/gitOps.ts` | Modify | Add `listContainerDir`, `readContainerFile`, `writeFileInContainer` |
| `src/main/ipcHandlers.ts` | Modify | Register `fs:list-dir`, `fs:read-file`, `fs:write-file` handlers |
| `src/preload/index.ts` | Modify | Expose 3 new API methods |
| `src/renderer/src/types.ts` | Modify | Add 3 new methods to `Api` interface |
| `src/renderer/src/components/WindowDetailPane.svelte` | Modify | Two-row layout with toggle buttons |
| `src/renderer/src/components/TerminalHost.svelte` | Modify | `viewMode` state, content-area wrapper, EditorPane integration |
| `src/renderer/src/components/FileTree.svelte` | Create | Lazy directory tree |
| `src/renderer/src/components/MonacoEditor.svelte` | Create | Monaco wrapper with IPC I/O, dirty tracking, polling |
| `src/renderer/src/components/EditorPane.svelte` | Create | Composes FileTree + MonacoEditor |
| `tests/main/gitOps.test.ts` | Modify | Tests for 3 new gitOps functions |
| `tests/main/ipcHandlers.test.ts` | Modify | Update mock + tests for 3 new handlers |
| `tests/renderer/WindowDetailPane.test.ts` | Modify | Tests for toggle buttons |
| `tests/renderer/TerminalHost.test.ts` | Modify | Tests for viewMode layout |
| `tests/renderer/FileTree.test.ts` | Create | Tests for FileTree component |
| `tests/renderer/MonacoEditor.test.ts` | Create | Tests for MonacoEditor component |
| `tests/renderer/EditorPane.test.ts` | Create | Tests for EditorPane component |

All paths are relative to `window-manager/`.

---

## Task 1: Install Monaco packages and configure workers

**Files:**
- Modify: `window-manager/package.json`
- Create: `window-manager/src/renderer/src/lib/monacoConfig.ts`

- [ ] **Step 1: Install packages**

From `window-manager/`:
```bash
npm install monaco-editor @monaco-editor/loader
```

Expected: packages added to `node_modules/`, `package.json` dependencies updated.

- [ ] **Step 2: Create `monacoConfig.ts`**

Create `window-manager/src/renderer/src/lib/monacoConfig.ts`:

```ts
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/loader'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// Configure Vite-bundled workers (runs once at module import time)
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

// Point @monaco-editor/loader at the locally bundled instance (no CDN)
loader.config({ monaco })

// Register app theme (matches xterm.js color scheme)
monaco.editor.defineTheme('claude-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#fafafa',
    'editorCursor.foreground': '#8b5cf6',
    'editor.selectionBackground': '#3f3f46'
  }
})

let initPromise: Promise<typeof monaco> | null = null

/** Call once per component mount. Idempotent — safe to call multiple times. */
export async function initMonaco(): Promise<typeof monaco> {
  if (!initPromise) {
    initPromise = loader.init().then(() => monaco)
  }
  return initPromise
}
```

- [ ] **Step 3: Verify TypeScript compiles**

From `window-manager/`:
```bash
npm run typecheck
```

Expected: no errors. If Vite worker imports fail with type errors, add `/// <reference types="vite/client" />` to the top of `monacoConfig.ts`.

- [ ] **Step 4: Commit**

```bash
git add window-manager/package.json window-manager/package-lock.json window-manager/src/renderer/src/lib/monacoConfig.ts
git commit -m "feat: install monaco-editor and configure Vite workers"
```

---

## Task 2: Add `listContainerDir` to gitOps.ts

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Modify: `window-manager/tests/main/gitOps.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `window-manager/tests/main/gitOps.test.ts`:

```ts
describe('listContainerDir', () => {
  it('parses ls -1p output into name/isDir pairs', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data')
              setImmediate(() => cb(Buffer.from('src/\nREADME.md\npackage.json\n')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    expect(entries).toEqual([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
      { name: 'package.json', isDir: false }
    ])
  })

  it('filters out blocked directories', async () => {
    const blocked = 'node_modules/\n.venv/\nvenv/\n__pycache__/\n.git/\ndist/\nbuild/\n.next/\n.nuxt/\ntarget/\ncoverage/\nout/\n'
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from(`src/\n${blocked}index.ts\n`)))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    const names = entries.map((e: { name: string }) => e.name)
    expect(names).toContain('src')
    expect(names).toContain('index.ts')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.venv')
    expect(names).not.toContain('dist')
  })

  it('returns empty array when exec fails', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 1 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    expect(entries).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "listContainerDir"
```

Expected: FAIL — `listContainerDir is not a function` or similar.

- [ ] **Step 3: Implement `listContainerDir` in `gitOps.ts`**

Add after the existing imports and before `execInContainer` in `window-manager/src/main/gitOps.ts`:

```ts
const BLOCKED_DIRS = new Set([
  'node_modules', '.venv', 'venv', '__pycache__', '.git',
  'dist', 'build', '.next', '.nuxt', 'target', 'coverage', 'out'
])

export async function listContainerDir(
  container: Container,
  dirPath: string
): Promise<{ name: string; isDir: boolean }[]> {
  const result = await execInContainer(container, ['ls', '-1p', dirPath])
  if (!result.ok) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((entry) => {
      const isDir = entry.endsWith('/')
      const name = isDir ? entry.slice(0, -1) : entry
      return { name, isDir }
    })
    .filter(({ name, isDir }) => !(isDir && BLOCKED_DIRS.has(name)))
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "listContainerDir"
```

Expected: all 3 `listContainerDir` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat: add listContainerDir to gitOps"
```

---

## Task 3: Add `readContainerFile` to gitOps.ts

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Modify: `window-manager/tests/main/gitOps.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `window-manager/tests/main/gitOps.test.ts`:

```ts
describe('readContainerFile', () => {
  it('returns the file content as a string', async () => {
    const content = 'console.log("hello")\n'
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from(content)))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { readContainerFile } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await readContainerFile(container, '/workspace/r/index.ts')
    expect(result).toBe(content)
  })

  it('issues cat with the exact file path', async () => {
    const container = makeContainer()
    const { readContainerFile } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await readContainerFile(container, '/workspace/r/src/app.ts')
    expect(container.exec.mock.calls[0][0].Cmd).toEqual(['cat', '/workspace/r/src/app.ts'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "readContainerFile"
```

Expected: FAIL — `readContainerFile is not a function`.

- [ ] **Step 3: Implement `readContainerFile` in `gitOps.ts`**

Add to `window-manager/src/main/gitOps.ts` (after `listContainerDir`):

```ts
export async function readContainerFile(
  container: Container,
  filePath: string
): Promise<string> {
  const result = await execInContainer(container, ['cat', filePath])
  return result.stdout
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "readContainerFile"
```

Expected: both `readContainerFile` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat: add readContainerFile to gitOps"
```

---

## Task 4: Add `writeFileInContainer` to gitOps.ts

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Modify: `window-manager/tests/main/gitOps.test.ts`

**Background:** `execInContainer` uses `Tty: true` and has no stdin support. `writeFileInContainer` needs a separate exec call with `AttachStdin: true, Tty: false` and dockerode's `hijack: true` start mode, which returns a duplex stream we write content to.

- [ ] **Step 1: Write the failing test**

Append to `window-manager/tests/main/gitOps.test.ts`:

```ts
describe('writeFileInContainer', () => {
  it('execs tee with the target path and AttachStdin: true', async () => {
    const mockStream = {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn()
    }
    // Simulate 'finish' event firing after end()
    mockStream.on.mockImplementation(function (
      this: typeof mockStream,
      event: string,
      cb: () => void
    ) {
      if (event === 'finish') setImmediate(() => cb())
      return this
    })

    const execInstance = {
      start: vi.fn().mockResolvedValue(mockStream)
    }
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue(execInstance)
    }

    const { writeFileInContainer } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await writeFileInContainer(container, '/workspace/r/file.ts', 'content here')

    expect(container.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['tee', '/workspace/r/file.ts'],
        AttachStdin: true,
        Tty: false
      })
    )
    expect(execInstance.start).toHaveBeenCalledWith({ hijack: true, stdin: true })
    expect(mockStream.write).toHaveBeenCalledWith(Buffer.from('content here', 'utf8'))
    expect(mockStream.end).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "writeFileInContainer"
```

Expected: FAIL — `writeFileInContainer is not a function`.

- [ ] **Step 3: Implement `writeFileInContainer` in `gitOps.ts`**

Add to `window-manager/src/main/gitOps.ts` (after `readContainerFile`):

```ts
export async function writeFileInContainer(
  container: Container,
  filePath: string,
  content: string
): Promise<void> {
  const execInstance = await container.exec({
    Cmd: ['tee', filePath],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false
  })
  const stream = await execInstance.start({ hijack: true, stdin: true })
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    stream.on('finish', resolve)
    stream.write(Buffer.from(content, 'utf8'))
    stream.end()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 "writeFileInContainer"
```

Expected: `writeFileInContainer` test PASS.

- [ ] **Step 5: Run full main test suite**

```bash
cd window-manager && npm run test:main
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat: add writeFileInContainer to gitOps"
```

---

## Task 5: Wire IPC handlers, preload, and types

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Update the gitOps mock in `ipcHandlers.test.ts`**

Find this block in `window-manager/tests/main/ipcHandlers.test.ts`:

```ts
vi.mock('../../src/main/gitOps', () => ({
  getCurrentBranch: vi.fn(),
  stageAndCommit: vi.fn(),
  push: vi.fn()
}))
```

Replace with:

```ts
vi.mock('../../src/main/gitOps', () => ({
  getCurrentBranch: vi.fn(),
  stageAndCommit: vi.fn(),
  push: vi.fn(),
  listContainerDir: vi.fn(),
  readContainerFile: vi.fn(),
  writeFileInContainer: vi.fn()
}))
```

- [ ] **Step 2: Write failing tests for the 3 new handlers**

Find the import block near the top of `ipcHandlers.test.ts` that imports from gitOps:

```ts
import { getCurrentBranch, stageAndCommit, push } from '../../src/main/gitOps'
```

Replace with:

```ts
import { getCurrentBranch, stageAndCommit, push, listContainerDir, readContainerFile, writeFileInContainer } from '../../src/main/gitOps'
```

Then append these tests inside the `describe('registerIpcHandlers', ...)` block:

```ts
  it('registers fs:list-dir handler that calls listContainerDir', async () => {
    const entries = [{ name: 'src', isDir: true }, { name: 'README.md', isDir: false }]
    vi.mocked(listContainerDir).mockResolvedValue(entries)
    const result = await getHandler('fs:list-dir')({}, 'container-xyz', '/workspace/r')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(listContainerDir).toHaveBeenCalledWith(mockContainer, '/workspace/r')
    expect(result).toEqual(entries)
  })

  it('registers fs:read-file handler that calls readContainerFile', async () => {
    vi.mocked(readContainerFile).mockResolvedValue('file content')
    const result = await getHandler('fs:read-file')({}, 'container-xyz', '/workspace/r/file.ts')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(readContainerFile).toHaveBeenCalledWith(mockContainer, '/workspace/r/file.ts')
    expect(result).toBe('file content')
  })

  it('registers fs:write-file handler that calls writeFileInContainer', async () => {
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined)
    await getHandler('fs:write-file')({}, 'container-xyz', '/workspace/r/file.ts', 'new content')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(writeFileInContainer).toHaveBeenCalledWith(mockContainer, '/workspace/r/file.ts', 'new content')
  })
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -E "(fs:list-dir|fs:read-file|fs:write-file)"
```

Expected: FAIL — `No handler registered for fs:list-dir`.

- [ ] **Step 4: Add 3 handlers to `ipcHandlers.ts`**

In `window-manager/src/main/ipcHandlers.ts`, update the gitOps import:

```ts
import { getCurrentBranch, stageAndCommit, push as gitPush, listContainerDir, readContainerFile, writeFileInContainer } from './gitOps'
```

Then inside `registerIpcHandlers()`, add after the focus handler at the end:

```ts
  // File system handlers (container exec bridge)
  ipcMain.handle('fs:list-dir', async (_, containerId: string, path: string) => {
    const container = getDocker().getContainer(containerId)
    return listContainerDir(container, path)
  })

  ipcMain.handle('fs:read-file', async (_, containerId: string, path: string) => {
    const container = getDocker().getContainer(containerId)
    return readContainerFile(container, path)
  })

  ipcMain.handle('fs:write-file', async (_, containerId: string, path: string, content: string) => {
    const container = getDocker().getContainer(containerId)
    return writeFileInContainer(container, path, content)
  })
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -E "(fs:list-dir|fs:read-file|fs:write-file)"
```

Expected: all 3 handler tests PASS.

- [ ] **Step 6: Update preload**

In `window-manager/src/preload/index.ts`, add after the `setActiveContainer` entry:

```ts
  // File system API (container exec bridge)
  listContainerDir: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:list-dir', containerId, path),
  readContainerFile: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:read-file', containerId, path),
  writeContainerFile: (containerId: string, path: string, content: string) =>
    ipcRenderer.invoke('fs:write-file', containerId, path, content),
```

- [ ] **Step 7: Update `types.ts`**

In `window-manager/src/renderer/src/types.ts`, add to the `Api` interface after `setActiveContainer`:

```ts
  // File system (container exec bridge)
  listContainerDir: (containerId: string, path: string) => Promise<{ name: string; isDir: boolean }[]>
  readContainerFile: (containerId: string, path: string) => Promise<string>
  writeContainerFile: (containerId: string, path: string, content: string) => Promise<void>
```

- [ ] **Step 8: Run full test suite**

```bash
cd window-manager && npm run test:main
```

Expected: all tests PASS.

- [ ] **Step 9: Typecheck**

```bash
cd window-manager && npm run typecheck
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/src/renderer/src/types.ts window-manager/tests/main/ipcHandlers.test.ts
git commit -m "feat: wire fs IPC handlers, preload, and types"
```

---

## Task 6: WindowDetailPane — toggle row

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

**Background:** `WindowDetailPane` currently has a single-row footer. Add a toggle row above the existing info row. The footer grows taller naturally with the second row. New props: `viewMode` (default `'terminal'`) and `onViewChange`.

- [ ] **Step 1: Write failing tests**

Append to the `describe('WindowDetailPane', ...)` block in `window-manager/tests/renderer/WindowDetailPane.test.ts`:

```ts
  it('renders Terminal, Editor, and Both toggle buttons', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /terminal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /both/i })).toBeInTheDocument()
  })

  it('marks the active viewMode button with aria-pressed', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project, viewMode: 'editor' } })
    expect(screen.getByRole('button', { name: /editor/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /terminal/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onViewChange with the clicked mode', async () => {
    getCurrentBranch.mockResolvedValue('main')
    const onViewChange = vi.fn()
    render(WindowDetailPane, { props: { win, project, viewMode: 'terminal', onViewChange } })
    await fireEvent.click(screen.getByRole('button', { name: /editor/i }))
    expect(onViewChange).toHaveBeenCalledWith('editor')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "toggle"
```

Expected: FAIL — toggle buttons not found.

- [ ] **Step 3: Update `WindowDetailPane.svelte`**

Replace the entire contents of `window-manager/src/renderer/src/components/WindowDetailPane.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord } from '../types'

  type ViewMode = 'terminal' | 'editor' | 'both'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    viewMode?: ViewMode
    onViewChange?: (mode: ViewMode) => void
    onCommit?: () => void
    onPush?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
  }

  let {
    win,
    project,
    viewMode = 'terminal',
    onViewChange = () => {},
    onCommit = () => {},
    onPush = () => {},
    commitDisabled = true,
    pushDisabled = true
  }: Props = $props()

  let branch = $state('…')
  let timer: ReturnType<typeof setInterval> | undefined
  let alive = true

  async function refreshBranch(): Promise<void> {
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error; do not toast
    }
    if (alive && next) branch = next
  }

  onMount(() => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
  })
  onDestroy(() => {
    alive = false
    if (timer) clearInterval(timer)
  })
</script>

<footer class="detail-pane">
  <div class="toggle-row">
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'terminal'}
      aria-pressed={viewMode === 'terminal'}
      onclick={() => onViewChange('terminal')}
    >Terminal</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'editor'}
      aria-pressed={viewMode === 'editor'}
      onclick={() => onViewChange('editor')}
    >Editor</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'both'}
      aria-pressed={viewMode === 'both'}
      onclick={() => onViewChange('both')}
    >Both</button>
  </div>
  <div class="info-row">
    <div class="info">
      <span class="name">{win.name}</span>
      <span class="sep">·</span>
      <span class="project">{project.name}</span>
      <span class="sep">·</span>
      <span class="branch" title="current branch">{branch}</span>
      <span class="sep">·</span>
      <span class="status {win.status}">{win.status}</span>
    </div>
    <div class="actions">
      <button type="button" disabled={commitDisabled} onclick={onCommit}>Commit</button>
      <button type="button" disabled={pushDisabled} onclick={onPush}>Push</button>
    </div>
  </div>
</footer>

<style>
  .detail-pane {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.45rem 0.9rem 0.5rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-1);
  }
  .toggle-row {
    display: flex;
    gap: 0.3rem;
  }
  .toggle-btn {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.18rem 0.55rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-2);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .info {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
  }
  .name {
    font-weight: 600;
    color: var(--fg-0);
  }
  .sep {
    color: var(--fg-3);
  }
  .branch {
    font-family: var(--font-mono);
  }
  .status.running {
    color: var(--success, #4ade80);
  }
  .status.stopped {
    color: var(--fg-3);
  }
  .status.unknown {
    color: var(--warning, #facc15);
  }
  .actions {
    display: flex;
    gap: 0.4rem;
  }
  button:not(.toggle-btn) {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    border-radius: 4px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E "(WindowDetailPane|toggle|viewMode)"
```

Expected: all `WindowDetailPane` tests PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat: add view toggle row to WindowDetailPane"
```

---

## Task 7: TerminalHost — viewMode state and layout

> ⚠️ **Dependency:** This task requires `EditorPane.svelte` to already exist. If running tasks in strict order, skip to Tasks 8–10 first to build the component tree (FileTree → MonacoEditor → EditorPane), then return here for Task 7. The File Map lists the correct logical order; task numbers reflect build sequence but TerminalHost must run last among the UI tasks.

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts`

**Background:** `TerminalHost` must manage `viewMode` and render `EditorPane` in editor/both modes. The terminal body is hidden (not unmounted) when in editor mode to keep the Claude session alive. A `ResizeObserver` already watches `terminalEl`, so `fitAddon` automatically refits when the element becomes visible again. `rootPath` is derived from `project.git_url` via an inline regex (same logic as main process `extractRepoName`).

- [ ] **Step 1: Write failing tests**

Append to the `describe('TerminalHost', ...)` block in `window-manager/tests/renderer/TerminalHost.test.ts`:

```ts
  it('renders a content-area div that wraps the terminal', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // The terminal-body must be inside a content-area
    const body = document.querySelector('.terminal-body')
    expect(body?.closest('.content-area')).not.toBeNull()
  })

  it('passes viewMode and onViewChange to WindowDetailPane (terminal default)', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // Terminal toggle button should be active (aria-pressed true)
    const termBtn = screen.getByRole('button', { name: /terminal/i })
    expect(termBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides terminal-body (adds .hidden) when Editor mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    const editorBtn = screen.getByRole('button', { name: /^editor$/i })
    await fireEvent.click(editorBtn)
    const body = document.querySelector('.terminal-body')
    expect(body?.classList.contains('hidden')).toBe(true)
  })

  it('shows terminal-body when Terminal mode is active', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    // Switch to editor then back to terminal
    await fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    await fireEvent.click(screen.getByRole('button', { name: /terminal/i }))
    const body = document.querySelector('.terminal-body')
    expect(body?.classList.contains('hidden')).toBe(false)
  })
```

The `TerminalHost.test.ts` needs `screen` and `fireEvent` imported. Check that the existing imports include them:

```ts
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte'
```

If `screen` and `fireEvent` are not currently imported, add them.

- [ ] **Step 2: Add mock for EditorPane in TerminalHost test**

`TerminalHost` imports `EditorPane`. Even though `EditorPane.svelte` exists by the time this task runs (see dependency note above), mock it to prevent its child components (FileTree, MonacoEditor) from running in TerminalHost tests. Add near the top of `TerminalHost.test.ts` after existing `vi.mock` calls:

```ts
vi.mock('../../src/renderer/src/components/EditorPane.svelte', () => ({
  default: { render: () => ({ html: '<div class="editor-pane-mock"></div>', css: { code: '', map: null } }) }
}))
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E "(content-area|viewMode|hidden|Editor mode)"
```

Expected: FAIL — `.content-area` not found, etc.

- [ ] **Step 4: Update `TerminalHost.svelte`**

Replace the entire contents of `window-manager/src/renderer/src/components/TerminalHost.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import CommitModal from './CommitModal.svelte'
  import EditorPane from './EditorPane.svelte'
  import { waitingWindows } from '../lib/waitingWindows'

  type ViewMode = 'terminal' | 'editor' | 'both'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
  }

  let { win, project }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let resizeObserver: ResizeObserver | undefined

  let viewMode = $state<ViewMode>('terminal')
  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)

  // Derive workspace path from git URL (e.g. git@github.com:org/my-repo.git → /workspace/my-repo)
  const repoName = project.git_url.split('/').pop()!.replace(/\.git$/, '')
  const rootPath = `/workspace/${repoName}`

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, {
        subject: v.subject,
        body: v.body || undefined
      })
      if (res.ok) {
        const subjectLine = res.stdout.split('\n').find((l) => /^\[.+\]/.test(l))
        pushToast({ level: 'success', title: 'Committed', body: subjectLine })
      } else {
        const nothing = /nothing to commit/i.test(res.stdout)
        pushToast({
          level: nothing ? 'success' : 'error',
          title: nothing ? 'Nothing to commit' : 'Commit failed',
          body: nothing ? undefined : res.stdout
        })
      }
      commitOpen = false
    } catch (err) {
      pushToast({ level: 'error', title: 'Commit error', body: (err as Error).message })
    } finally {
      commitBusy = false
    }
  }

  async function runPush(): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.push(win.id)
      pushToast({
        level: res.ok ? 'success' : 'error',
        title: res.ok ? 'Pushed' : 'Push failed',
        body: res.stdout || undefined
      })
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  onMount(() => {
    term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#8b5cf6',
        selectionBackground: '#3f3f46'
      },
      scrollback: 1000
    })

    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(terminalEl)
    fitAddon.fit()
    term.reset()

    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalEl)

    window.api.openTerminal(win.container_id, term.cols, term.rows, win.name)

    window.api.onTerminalData((containerId: string, data: string) => {
      if (containerId === win.container_id) {
        term?.write(data)
      }
    })

    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data)
      waitingWindows.remove(win.container_id)
    })

    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows)
    })
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id)
    waitingWindows.remove(win.container_id)
    term?.dispose()
  })
</script>

<section class="terminal-host">
  <div class="content-area" class:split={viewMode === 'both'}>
    {#if viewMode !== 'terminal'}
      <div class="editor-wrap">
        <EditorPane containerId={win.container_id} {rootPath} />
      </div>
    {/if}
    <div class="terminal-body" class:hidden={viewMode === 'editor'} bind:this={terminalEl}></div>
  </div>
  <WindowDetailPane
    {win}
    {project}
    {viewMode}
    onViewChange={(mode) => (viewMode = mode)}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    commitDisabled={commitBusy || pushBusy}
    pushDisabled={commitBusy || pushBusy}
  />
  {#if commitOpen}
    <CommitModal onSubmit={runCommit} onCancel={() => (commitOpen = false)} busy={commitBusy} />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .content-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-wrap {
    flex: 1;
    overflow: hidden;
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }

  .terminal-body.hidden {
    display: none;
  }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E "(TerminalHost|content-area|hidden)"
```

Expected: all `TerminalHost` tests PASS.

- [ ] **Step 6: Run full renderer suite**

```bash
cd window-manager && npm run test:renderer
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte window-manager/tests/renderer/TerminalHost.test.ts
git commit -m "feat: add viewMode state and EditorPane layout to TerminalHost"

---

## Task 8: FileTree component

**Files:**
- Create: `window-manager/src/renderer/src/components/FileTree.svelte`
- Create: `window-manager/tests/renderer/FileTree.test.ts`

**Background:** Lazy directory tree. Only fetches children when user expands a folder. Filtering is done on the main process (`listContainerDir` already strips blocked dirs). Renders a flat list of visible entries derived from expanded state.

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/renderer/FileTree.test.ts`:

```ts
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileTree from '../../src/renderer/src/components/FileTree.svelte'

const mockListDir = vi.fn()

beforeEach(() => {
  vi.stubGlobal('api', { listContainerDir: mockListDir })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FileTree', () => {
  it('loads root directory on mount and renders its entries', async () => {
    mockListDir.mockResolvedValue([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false }
    ])
    render(FileTree, {
      containerId: 'ctr1',
      rootPath: '/workspace/myrepo',
      onFileSelect: vi.fn()
    })
    expect(mockListDir).toHaveBeenCalledWith('ctr1', '/workspace/myrepo')
    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('expands a directory and loads its children on click', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn)
    expect(mockListDir).toHaveBeenCalledWith('c', '/workspace/r/src')
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
  })

  it('calls onFileSelect with the full path when a file is clicked', async () => {
    mockListDir.mockResolvedValue([{ name: 'app.ts', isDir: false }])
    const onFileSelect = vi.fn()
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect })
    await fireEvent.click(await screen.findByText('app.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('/workspace/r/app.ts')
  })

  it('does not re-fetch a directory that is already loaded when clicked again', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn) // expand (fetches children)
    await fireEvent.click(srcBtn) // collapse
    await fireEvent.click(srcBtn) // re-expand (should NOT fetch again)
    expect(mockListDir).toHaveBeenCalledTimes(2) // root + src once
  })

  it('collapses an expanded directory on second click', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn) // expand
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    await fireEvent.click(srcBtn) // collapse
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "FileTree"
```

Expected: FAIL — `FileTree` module not found.

- [ ] **Step 3: Create `FileTree.svelte`**

Create `window-manager/src/renderer/src/components/FileTree.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  interface FileEntry {
    name: string
    isDir: boolean
  }

  interface Props {
    containerId: string
    rootPath: string
    onFileSelect: (path: string) => void
  }

  let { containerId, rootPath, onFileSelect }: Props = $props()

  // childrenMap: dirPath → loaded entries (undefined = not yet loaded)
  let childrenMap = $state(new Map<string, FileEntry[]>())
  let expanded = $state(new Set<string>([rootPath]))
  let loading = $state(new Set<string>())
  let selectedPath = $state<string | null>(null)

  async function loadDir(dirPath: string): Promise<void> {
    if (childrenMap.has(dirPath)) return
    loading = new Set([...loading, dirPath])
    try {
      const entries = await window.api.listContainerDir(containerId, dirPath)
      childrenMap = new Map([...childrenMap, [dirPath, entries]])
    } finally {
      loading = new Set([...loading].filter((p) => p !== dirPath))
    }
  }

  async function toggleDir(dirPath: string): Promise<void> {
    await loadDir(dirPath)
    if (expanded.has(dirPath)) {
      expanded = new Set([...expanded].filter((p) => p !== dirPath))
    } else {
      expanded = new Set([...expanded, dirPath])
    }
  }

  function handleFileClick(filePath: string): void {
    selectedPath = filePath
    onFileSelect(filePath)
  }

  interface RenderEntry {
    path: string
    name: string
    isDir: boolean
    depth: number
  }

  function flattenVisible(dirPath: string, depth: number): RenderEntry[] {
    const entries = childrenMap.get(dirPath) ?? []
    const result: RenderEntry[] = []
    for (const entry of entries) {
      const childPath = `${dirPath}/${entry.name}`
      result.push({ path: childPath, name: entry.name, isDir: entry.isDir, depth })
      if (entry.isDir && expanded.has(childPath)) {
        result.push(...flattenVisible(childPath, depth + 1))
      }
    }
    return result
  }

  const flatList = $derived(flattenVisible(rootPath, 0))

  onMount(() => {
    void loadDir(rootPath)
  })
</script>

<div class="file-tree">
  {#each flatList as entry (entry.path)}
    {#if entry.isDir}
      <button
        type="button"
        class="tree-entry dir"
        class:expanded={expanded.has(entry.path)}
        style:padding-left="{entry.depth * 12 + 8}px"
        onclick={() => toggleDir(entry.path)}
      >
        <span class="chevron" aria-hidden="true">{expanded.has(entry.path) ? '▾' : '▸'}</span>
        {entry.name}
        {#if loading.has(entry.path)}<span class="loading-dot" aria-hidden="true">…</span>{/if}
      </button>
    {:else}
      <button
        type="button"
        class="tree-entry file"
        class:selected={selectedPath === entry.path}
        style:padding-left="{entry.depth * 12 + 20}px"
        onclick={() => handleFileClick(entry.path)}
      >
        {entry.name}
      </button>
    {/if}
  {/each}
</div>

<style>
  .file-tree {
    height: 100%;
    overflow-y: auto;
    background: var(--bg-1);
    padding: 0.25rem 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .tree-entry {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding-top: 0.2rem;
    padding-bottom: 0.2rem;
    padding-right: 0.5rem;
    background: none;
    border: none;
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-entry:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .tree-entry.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--fg-0);
  }

  .chevron {
    font-size: 0.65rem;
    width: 10px;
    flex-shrink: 0;
  }

  .loading-dot {
    color: var(--fg-3);
    margin-left: 0.2rem;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "FileTree"
```

Expected: all 5 `FileTree` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/FileTree.svelte window-manager/tests/renderer/FileTree.test.ts
git commit -m "feat: add FileTree component with lazy loading"
```

---

## Task 9: MonacoEditor component

**Files:**
- Create: `window-manager/src/renderer/src/components/MonacoEditor.svelte`
- Create: `window-manager/tests/renderer/MonacoEditor.test.ts`

**Background:** Wraps Monaco editor. Loads file content via IPC on mount and on `filePath` prop change. Tracks dirty state. Saves on Ctrl/Cmd+S. Polls every 2s — skips update if dirty. Uses `initMonaco()` from `monacoConfig.ts`. In tests, `monacoConfig` is mocked with a fake Monaco instance.

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/renderer/MonacoEditor.test.ts`:

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock monacoConfig ---
const mockAddCommand = vi.fn()
const mockGetPosition = vi.fn().mockReturnValue({ lineNumber: 1, column: 1 })
const mockSetPosition = vi.fn()
const mockGetValue = vi.fn().mockReturnValue('')
const mockSetValue = vi.fn()
const mockGetFullModelRange = vi.fn().mockReturnValue({})
const mockPushEditOperations = vi.fn()
const mockDispose = vi.fn()
let didChangeContentCb: (() => void) | null = null

const mockModel = {
  getValue: mockGetValue,
  setValue: mockSetValue,
  getFullModelRange: mockGetFullModelRange,
  pushEditOperations: mockPushEditOperations,
  onDidChangeContent: (cb: () => void) => {
    didChangeContentCb = cb
    return { dispose: vi.fn() }
  }
}

const mockEditor = {
  getModel: vi.fn().mockReturnValue(mockModel),
  getValue: mockGetValue,
  getPosition: mockGetPosition,
  setPosition: mockSetPosition,
  addCommand: mockAddCommand,
  dispose: mockDispose
}

const mockMonaco = {
  editor: {
    create: vi.fn().mockReturnValue(mockEditor)
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 }
}

vi.mock('../../src/renderer/src/lib/monacoConfig', () => ({
  initMonaco: vi.fn().mockResolvedValue(mockMonaco)
}))

// --- Import component after mocks ---
import MonacoEditor from '../../src/renderer/src/components/MonacoEditor.svelte'

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockGetValue.mockReturnValue('')
  mockPushEditOperations.mockReset()
  didChangeContentCb = null
  vi.stubGlobal('api', {
    readContainerFile: mockReadFile,
    writeContainerFile: mockWriteFile
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('MonacoEditor', () => {
  it('loads file content on mount', async () => {
    mockReadFile.mockResolvedValue('const x = 1\n')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/index.ts' })
    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('ctr', '/workspace/r/index.ts')
    })
    await vi.waitFor(() => {
      expect(mockSetValue).toHaveBeenCalledWith('const x = 1\n')
    })
  })

  it('renders the file path in the header bar', async () => {
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/app.ts' })
    expect(await screen.findByText('/workspace/r/app.ts')).toBeInTheDocument()
  })

  it('marks dirty when Monaco content changes', async () => {
    mockReadFile.mockResolvedValue('original')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(didChangeContentCb).not.toBeNull())
    // Simulate editor content change
    didChangeContentCb!()
    // Poll tick — dirty, so should NOT call readContainerFile again
    mockReadFile.mockClear()
    await vi.advanceTimersByTimeAsync(2100)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('registers Ctrl+S keybinding on mount', async () => {
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    const [keybinding] = mockAddCommand.mock.calls[0]
    expect(keybinding).toBe(2048 | 49) // CtrlCmd | KeyS
  })

  it('saves file when Ctrl+S command fires', async () => {
    mockReadFile.mockResolvedValue('hello')
    mockGetValue.mockReturnValue('hello edited')
    mockWriteFile.mockResolvedValue(undefined)
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // Trigger the save command callback
    const saveCallback = mockAddCommand.mock.calls[0][1] as () => void
    didChangeContentCb?.() // mark dirty
    saveCallback()
    await vi.waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith('ctr', '/workspace/r/file.ts', 'hello edited')
    })
  })

  it('polls file every 2 seconds and updates model when not dirty', async () => {
    mockReadFile.mockResolvedValueOnce('v1').mockResolvedValue('v2')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockSetValue).toHaveBeenCalledWith('v1'))
    mockReadFile.mockClear()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('ctr', '/workspace/r/file.ts')
      expect(mockPushEditOperations).toHaveBeenCalled()
    })
  })

  it('disposes editor on unmount', async () => {
    mockReadFile.mockResolvedValue('')
    const { unmount } = render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockMonaco.editor.create).toHaveBeenCalled())
    unmount()
    expect(mockDispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "MonacoEditor"
```

Expected: FAIL — `MonacoEditor` module not found.

- [ ] **Step 3: Create `MonacoEditor.svelte`**

Create `window-manager/src/renderer/src/components/MonacoEditor.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { initMonaco } from '../lib/monacoConfig'

  interface Props {
    containerId: string
    filePath: string
  }

  let { containerId, filePath }: Props = $props()

  let editorEl: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editor: any | undefined
  let isDirty = $state(false)
  let lastContent = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let mounted = false

  async function loadFile(path: string): Promise<void> {
    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    editor?.getModel()?.setValue(content)
    isDirty = false
  }

  async function saveFile(): Promise<void> {
    if (!editor || !isDirty) return
    const content = editor.getValue()
    await window.api.writeContainerFile(containerId, filePath, content)
    lastContent = content
    isDirty = false
  }

  async function pollFile(): Promise<void> {
    if (isDirty) return
    try {
      const content = await window.api.readContainerFile(containerId, filePath)
      if (content !== lastContent) {
        lastContent = content
        const model = editor?.getModel()
        if (model) {
          const pos = editor?.getPosition()
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
          if (pos) editor?.setPosition(pos)
        }
      }
    } catch {
      // Ignore transient poll errors (e.g. container busy)
    }
  }

  onMount(async () => {
    const monaco = await initMonaco()

    editor = monaco.editor.create(editorEl, {
      theme: 'claude-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13
    })

    editor.getModel()?.onDidChangeContent(() => {
      isDirty = true
    })

    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => { void saveFile() }
    )

    await loadFile(filePath)
    mounted = true
    pollTimer = setInterval(() => void pollFile(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    editor?.dispose()
  })

  // Reload when filePath prop changes after initial mount
  $effect(() => {
    const path = filePath
    if (mounted && editor && path) {
      void loadFile(path)
    }
  })
</script>

<div class="monaco-wrap">
  <div class="file-path-bar" title={filePath}>{filePath}</div>
  <div class="editor-body" bind:this={editorEl}></div>
</div>

<style>
  .monaco-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #09090b;
  }

  .file-path-bar {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-2);
    padding: 0.25rem 0.75rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "MonacoEditor"
```

Expected: all `MonacoEditor` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/MonacoEditor.svelte window-manager/tests/renderer/MonacoEditor.test.ts
git commit -m "feat: add MonacoEditor component with IPC file I/O and polling"
```

---

## Task 10: EditorPane component

**Files:**
- Create: `window-manager/src/renderer/src/components/EditorPane.svelte`
- Create: `window-manager/tests/renderer/EditorPane.test.ts`

**Background:** Composes `FileTree` (fixed 240px) and `MonacoEditor` (fills rest). Shows a placeholder when no file is selected.

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/renderer/EditorPane.test.ts`:

```ts
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child components to isolate EditorPane logic
vi.mock('../../src/renderer/src/components/FileTree.svelte', () => ({
  default: { render: () => ({ html: '<div class="file-tree-mock"></div>', css: { code: '', map: null } }) }
}))

vi.mock('../../src/renderer/src/components/MonacoEditor.svelte', () => ({
  default: { render: () => ({ html: '<div class="monaco-editor-mock"></div>', css: { code: '', map: null } }) }
}))

import EditorPane from '../../src/renderer/src/components/EditorPane.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorPane', () => {
  it('shows a placeholder when no file is selected', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByText(/select a file/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "EditorPane"
```

Expected: FAIL — `EditorPane` module not found.

- [ ] **Step 3: Create `EditorPane.svelte`**

Create `window-manager/src/renderer/src/components/EditorPane.svelte`:

```svelte
<script lang="ts">
  import FileTree from './FileTree.svelte'
  import MonacoEditor from './MonacoEditor.svelte'

  interface Props {
    containerId: string
    rootPath: string
  }

  let { containerId, rootPath }: Props = $props()

  let selectedFile = $state<string | null>(null)
</script>

<div class="editor-pane">
  <div class="tree-panel">
    <FileTree {containerId} {rootPath} onFileSelect={(path) => (selectedFile = path)} />
  </div>
  <div class="editor-panel">
    {#if selectedFile}
      {#key selectedFile}
        <MonacoEditor {containerId} filePath={selectedFile} />
      {/key}
    {:else}
      <div class="placeholder">Select a file to edit</div>
    {/if}
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .tree-panel {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  .editor-panel {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    color: var(--fg-3);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -A3 "EditorPane"
```

Expected: `EditorPane` placeholder test PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd window-manager && npm run test
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck**

```bash
cd window-manager && npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/renderer/src/components/EditorPane.svelte window-manager/tests/renderer/EditorPane.test.ts
git commit -m "feat: add EditorPane component"
```
```
