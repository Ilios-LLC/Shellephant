# Monaco Editor Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Monaco editor panel with a tab bar (multiple open files), find-in-files search (grep via container exec), and a status bar (line/col/language/dirty).

**Architecture:** `EditorPane` becomes the tab-state owner. New `TabBar`, `StatusBar`, and `FindInFiles` Svelte 5 components slot into the editor layout. `MonacoEditor` gains prop callbacks (`onDirtyChange`, `onStatusChange`, keyboard delegates) and a bindable `ref` object for imperative `gotoLine`. A new `fs:exec` IPC handler exposes container exec to the renderer.

**Tech Stack:** Svelte 5 runes, Monaco Editor, Vitest + @testing-library/svelte, Electron IPC, Docker exec (grep).

---

## File Map

| Action | Path |
|--------|------|
| Modify | `window-manager/src/main/ipcHandlers.ts` |
| Modify | `window-manager/src/preload/index.ts` |
| Create | `window-manager/src/renderer/src/components/TabBar.svelte` |
| Create | `window-manager/tests/renderer/TabBar.test.ts` |
| Create | `window-manager/src/renderer/src/components/StatusBar.svelte` |
| Create | `window-manager/tests/renderer/StatusBar.test.ts` |
| Create | `window-manager/src/renderer/src/components/FindInFiles.svelte` |
| Create | `window-manager/tests/renderer/FindInFiles.test.ts` |
| Modify | `window-manager/src/renderer/src/components/MonacoEditor.svelte` |
| Modify | `window-manager/tests/renderer/MonacoEditor.test.ts` |
| Modify | `window-manager/src/renderer/src/components/EditorPane.svelte` |
| Modify | `window-manager/tests/renderer/EditorPane.test.ts` |

---

## Task 1: Add `fs:exec` IPC Handler

Exposes container exec to the renderer so `FindInFiles` can run `grep`.

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 1: Add handler to ipcHandlers.ts**

In `ipcHandlers.ts`, after the `fs:write-file` handler block (around line 214), add:

```ts
  ipcMain.handle('fs:exec', async (_, containerId: string, cmd: string[]) => {
    const container = getDocker().getContainer(containerId)
    const result = await execInContainer(container, cmd)
    return { ok: result.ok, code: result.code, stdout: result.stdout }
  })
```

- [ ] **Step 2: Expose in preload**

In `preload/index.ts`, after `writeContainerFile` (around line 83), add:

```ts
  execInContainer: (containerId: string, cmd: string[]) =>
    ipcRenderer.invoke('fs:exec', containerId, cmd),
```

- [ ] **Step 3: Commit**

```bash
cd window-manager
git add src/main/ipcHandlers.ts src/preload/index.ts
git commit -m "feat: expose fs:exec IPC handler for container grep"
```

---

## Task 2: TabBar Component

Renders a horizontal strip of open-file tabs with close buttons and dirty indicators.

**Files:**
- Create: `window-manager/src/renderer/src/components/TabBar.svelte`
- Create: `window-manager/tests/renderer/TabBar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/TabBar.test.ts`:

```ts
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabBar from '../../src/renderer/src/components/TabBar.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabBar', () => {
  const tabs = ['/workspace/r/foo.ts', '/workspace/r/bar.ts']

  it('renders basenames of open files', () => {
    render(TabBar, {
      tabs,
      activeTab: tabs[0],
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
    expect(screen.getByText('bar.ts')).toBeInTheDocument()
  })

  it('shows full path as title tooltip', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByTitle('/workspace/r/foo.ts')).toBeInTheDocument()
  })

  it('marks active tab with aria-selected=true', () => {
    render(TabBar, { tabs, activeTab: tabs[0], dirtyTabs: new Set<string>(), onActivate: vi.fn(), onClose: vi.fn() })
    expect(screen.getByTitle(tabs[0])).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTitle(tabs[1])).toHaveAttribute('aria-selected', 'false')
  })

  it('shows close button on non-dirty tab', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByRole('button', { name: /close foo\.ts/i })).toBeInTheDocument()
  })

  it('shows dirty dot instead of close button on dirty tab', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set(['/workspace/r/foo.ts']),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close foo\.ts/i })).not.toBeInTheDocument()
  })

  it('calls onActivate with path when tab is clicked', async () => {
    const onActivate = vi.fn()
    render(TabBar, { tabs, activeTab: null, dirtyTabs: new Set<string>(), onActivate, onClose: vi.fn() })
    await fireEvent.click(screen.getByTitle(tabs[0]))
    expect(onActivate).toHaveBeenCalledWith(tabs[0])
  })

  it('calls onClose with path when close button is clicked', async () => {
    const onClose = vi.fn()
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose
    })
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(onClose).toHaveBeenCalledWith('/workspace/r/foo.ts')
  })

  it('does not call onActivate when close button is clicked', async () => {
    const onActivate = vi.fn()
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate,
      onClose: vi.fn()
    })
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(onActivate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/TabBar.test.ts
```

Expected: FAIL — `TabBar.svelte` not found.

- [ ] **Step 3: Create TabBar.svelte**

Create `window-manager/src/renderer/src/components/TabBar.svelte`:

```svelte
<script lang="ts">
  interface Props {
    tabs: string[]
    activeTab: string | null
    dirtyTabs: Set<string>
    onActivate: (path: string) => void
    onClose: (path: string) => void
  }

  let { tabs, activeTab, dirtyTabs, onActivate, onClose }: Props = $props()

  function basename(path: string): string {
    return path.split('/').pop() ?? path
  }
</script>

<div class="tab-bar" role="tablist">
  {#each tabs as tab (tab)}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div
      role="tab"
      class="tab"
      class:active={tab === activeTab}
      title={tab}
      aria-selected={tab === activeTab}
      tabindex="0"
      onclick={() => onActivate(tab)}
      onkeydown={(e) => e.key === 'Enter' && onActivate(tab)}
    >
      <span class="tab-name">{basename(tab)}</span>
      {#if dirtyTabs.has(tab)}
        <span class="dirty-dot" aria-label="unsaved changes">●</span>
      {:else}
        <button
          class="close-btn"
          aria-label="close {basename(tab)}"
          onclick={(e) => { e.stopPropagation(); onClose(tab) }}
        >×</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    background: var(--bg-0);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
    height: 35px;
    align-items: stretch;
  }

  .tab-bar::-webkit-scrollbar { height: 3px; }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0 0.75rem;
    cursor: pointer;
    border-right: 1px solid var(--border);
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-2);
    min-width: 80px;
    max-width: 180px;
    user-select: none;
  }

  .tab:hover { background: var(--bg-1); }

  .tab.active {
    background: #011627;
    color: var(--fg-0);
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .dirty-dot {
    font-size: 0.6rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 0 2px;
    font-size: 0.875rem;
    line-height: 1;
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/TabBar.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.svelte tests/renderer/TabBar.test.ts
git commit -m "feat: add TabBar component with dirty indicators and close buttons"
```

---

## Task 3: StatusBar Component

Slim bottom bar showing cursor position, language, and dirty state.

**Files:**
- Create: `window-manager/src/renderer/src/components/StatusBar.svelte`
- Create: `window-manager/tests/renderer/StatusBar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/StatusBar.test.ts`:

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import StatusBar from '../../src/renderer/src/components/StatusBar.svelte'

afterEach(() => cleanup())

describe('StatusBar', () => {
  it('renders line and column numbers', () => {
    render(StatusBar, { line: 12, column: 4, language: 'typescript', isDirty: false })
    expect(screen.getByText('Ln 12, Col 4')).toBeInTheDocument()
  })

  it('renders language name', () => {
    render(StatusBar, { line: 1, column: 1, language: 'python', isDirty: false })
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('shows dirty dot when isDirty is true', () => {
    render(StatusBar, { line: 1, column: 1, language: 'ts', isDirty: true })
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
  })

  it('hides dirty dot when isDirty is false', () => {
    render(StatusBar, { line: 1, column: 1, language: 'ts', isDirty: false })
    expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/StatusBar.test.ts
```

Expected: FAIL — `StatusBar.svelte` not found.

- [ ] **Step 3: Create StatusBar.svelte**

Create `window-manager/src/renderer/src/components/StatusBar.svelte`:

```svelte
<script lang="ts">
  interface Props {
    line: number
    column: number
    language: string
    isDirty: boolean
  }

  let { line, column, language, isDirty }: Props = $props()
</script>

<div class="status-bar">
  <span class="position">Ln {line}, Col {column}</span>
  <span class="right">
    <span class="language">{language}</span>
    {#if isDirty}
      <span class="dirty-dot" aria-label="unsaved changes">●</span>
    {/if}
  </span>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    padding: 0 0.75rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
</style>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/StatusBar.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/StatusBar.svelte tests/renderer/StatusBar.test.ts
git commit -m "feat: add StatusBar component"
```

---

## Task 4: FindInFiles Component

Collapsible search panel that runs `grep -rn` in the container and renders grouped results.

**Files:**
- Create: `window-manager/src/renderer/src/components/FindInFiles.svelte`
- Create: `window-manager/tests/renderer/FindInFiles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/FindInFiles.test.ts`:

```ts
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FindInFiles from '../../src/renderer/src/components/FindInFiles.svelte'

const mockExecInContainer = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('api', { execInContainer: mockExecInContainer })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('FindInFiles', () => {
  it('renders query input and file filter input', () => {
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    expect(screen.getByLabelText('search query')).toBeInTheDocument()
    expect(screen.getByLabelText('file filter')).toBeInTheDocument()
  })

  it('does not search on empty query', async () => {
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await vi.advanceTimersByTimeAsync(500)
    expect(mockExecInContainer).not.toHaveBeenCalled()
  })

  it('debounces search — does not call exec immediately on input', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    const input = screen.getByLabelText('search query')
    await fireEvent.input(input, { target: { value: 'foo' } })
    expect(mockExecInContainer).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(mockExecInContainer).toHaveBeenCalledWith('ctr', expect.arrayContaining(['grep', '-rn']))
  })

  it('passes rootPath and query to grep command', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'findMe' } })
    await vi.advanceTimersByTimeAsync(400)
    const cmd: string[] = mockExecInContainer.mock.calls[0][1]
    expect(cmd).toContain('findMe')
    expect(cmd).toContain('/workspace/r')
  })

  it('fires search immediately on Enter without waiting for debounce', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    const input = screen.getByLabelText('search query')
    await fireEvent.input(input, { target: { value: 'bar' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockExecInContainer).toHaveBeenCalled()
  })

  it('shows grouped results with file paths and match counts', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: [
        '/workspace/r/src/foo.ts:12:const foo = 1',
        '/workspace/r/src/foo.ts:45:foo()',
        '/workspace/r/bar.ts:7:foo bar'
      ].join('\n') + '\n'
    })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText('/workspace/r/src/foo.ts (2 matches)')).toBeInTheDocument()
    })
    expect(screen.getByText('/workspace/r/bar.ts (1 match)')).toBeInTheDocument()
  })

  it('shows line numbers and text snippets for each match', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: '/workspace/r/src/foo.ts:12:const foo = 1\n'
    })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
    expect(screen.getByText('const foo = 1')).toBeInTheDocument()
  })

  it('calls onOpenFile with path and line when a result is clicked', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: '/workspace/r/src/foo.ts:12:const foo = 1\n'
    })
    const onOpenFile = vi.fn()
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'line 12' })).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: 'line 12' }))
    expect(onOpenFile).toHaveBeenCalledWith('/workspace/r/src/foo.ts', 12)
  })

  it('shows no-results message when grep returns empty stdout', async () => {
    mockExecInContainer.mockResolvedValue({ ok: false, code: 1, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'xyz' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText(/no results for/i)).toBeInTheDocument()
    })
  })

  it('shows error message when execInContainer throws', async () => {
    mockExecInContainer.mockRejectedValue(new Error('exec failed'))
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText('exec failed')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/FindInFiles.test.ts
```

Expected: FAIL — `FindInFiles.svelte` not found.

- [ ] **Step 3: Create FindInFiles.svelte**

Create `window-manager/src/renderer/src/components/FindInFiles.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'

  interface Props {
    containerId: string
    rootPath: string
    onOpenFile: (path: string, line: number) => void
  }

  interface GrepMatch {
    line: number
    text: string
  }

  interface GrepGroup {
    path: string
    matches: GrepMatch[]
  }

  let { containerId, rootPath, onOpenFile }: Props = $props()

  let query = $state('')
  let glob = $state('*')
  let loading = $state(false)
  let results = $state<GrepGroup[]>([])
  let error = $state('')
  let searched = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function parseGrepOutput(stdout: string): GrepGroup[] {
    const groups = new Map<string, GrepMatch[]>()
    for (const raw of stdout.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const firstColon = line.indexOf(':')
      if (firstColon === -1) continue
      const secondColon = line.indexOf(':', firstColon + 1)
      if (secondColon === -1) continue
      const path = line.slice(0, firstColon)
      const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10)
      const text = line.slice(secondColon + 1)
      if (isNaN(lineNum)) continue
      if (!groups.has(path)) groups.set(path, [])
      groups.get(path)!.push({ line: lineNum, text })
    }
    return Array.from(groups.entries()).map(([path, matches]) => ({ path, matches }))
  }

  async function runSearch(q: string): Promise<void> {
    if (!q.trim()) {
      results = []
      searched = false
      return
    }
    loading = true
    error = ''
    searched = true
    try {
      const cmd = [
        'grep', '-rn', '--color=never',
        '--exclude-dir=node_modules', '--exclude-dir=.git',
        '--exclude-dir=.venv', '--exclude-dir=dist', '--exclude-dir=build',
        ...(glob && glob !== '*' ? [`--include=${glob}`] : []),
        q, rootPath
      ]
      const result = await window.api.execInContainer(containerId, cmd)
      results = parseGrepOutput(result.stdout)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      results = []
    } finally {
      loading = false
    }
  }

  function handleInput(): void {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void runSearch(query), 400)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer)
      void runSearch(query)
    }
  }

  onDestroy(() => clearTimeout(debounceTimer))
</script>

<div class="find-in-files">
  <div class="inputs">
    <input
      class="query-input"
      type="text"
      placeholder="Search..."
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      aria-label="search query"
    />
    <input
      class="glob-input"
      type="text"
      placeholder="*.ts"
      bind:value={glob}
      aria-label="file filter"
    />
  </div>

  <div class="results">
    {#if loading}
      <div class="state-msg">Searching…</div>
    {:else if error}
      <div class="state-msg error">{error}</div>
    {:else if searched && results.length === 0}
      <div class="state-msg">No results for "{query}"</div>
    {:else if !searched}
      <div class="state-msg hint">Type to search</div>
    {:else}
      {#each results as group (group.path)}
        <div class="file-group">
          <div class="file-path">
            {group.path} ({group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'})
          </div>
          {#each group.matches as match (match.line)}
            <button
              class="match-line"
              aria-label="line {match.line}"
              onclick={() => onOpenFile(group.path, match.line)}
            >
              <span class="line-num">{match.line}</span>
              <span class="line-text">{match.text}</span>
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .find-in-files {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .inputs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .query-input,
  .glob-input {
    background: var(--bg-0);
    border: 1px solid var(--border);
    color: var(--fg-0);
    padding: 0.25rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    border-radius: 3px;
    width: 100%;
    box-sizing: border-box;
  }

  .glob-input { font-size: 0.7rem; color: var(--fg-2); }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .state-msg {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--fg-2);
    font-family: var(--font-mono);
  }

  .state-msg.error { color: #ff6b6b; }

  .file-group { margin-bottom: 0.5rem; }

  .file-path {
    padding: 0.2rem 0.75rem;
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-line {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0.1rem 0.75rem 0.1rem 1.25rem;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-0);
  }

  .match-line:hover { background: var(--bg-1); }

  .line-num {
    color: var(--fg-2);
    flex-shrink: 0;
    min-width: 2rem;
  }

  .line-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/FindInFiles.test.ts
```

Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FindInFiles.svelte tests/renderer/FindInFiles.test.ts
git commit -m "feat: add FindInFiles component with grep-powered search"
```

---

## Task 5: Extend MonacoEditor

Add `onDirtyChange`, `onStatusChange`, `ref` (bindable), `tabDirty`, and keyboard delegate callbacks. Change `loadFile` to not reload from disk when model already exists (tab was previously opened).

**Files:**
- Modify: `window-manager/src/renderer/src/components/MonacoEditor.svelte`
- Modify: `window-manager/tests/renderer/MonacoEditor.test.ts`

### 5a — Update the test file

- [ ] **Step 1: Update MonacoEditor.test.ts to add new mock capabilities**

Replace the entire `vi.hoisted(...)` block and mocks in `MonacoEditor.test.ts` with the following (the new mock adds `revealLineInCenter`, `onDidChangeCursorPosition`, `onDidChangeModelLanguage` to the editor, and `getLanguageId` to the model):

```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAddCommand,
  mockGetPosition,
  mockSetPosition,
  mockGetValue,
  mockSetValue,
  mockGetFullModelRange,
  mockPushEditOperations,
  mockRevealLineInCenter,
  mockDispose,
  mockModel,
  mockEditor,
  mockMonaco,
  getDidChangeContentCb,
  setDidChangeContentCb,
  getCursorPositionCb,
  setCursorPositionCb
} = vi.hoisted(() => {
  const mockAddCommand = vi.fn()
  const mockGetPosition = vi.fn().mockReturnValue({ lineNumber: 1, column: 1 })
  const mockSetPosition = vi.fn()
  const mockGetValue = vi.fn().mockReturnValue('')
  const mockSetValue = vi.fn()
  const mockGetFullModelRange = vi.fn().mockReturnValue({})
  const mockPushEditOperations = vi.fn()
  const mockRevealLineInCenter = vi.fn()
  const mockDispose = vi.fn()
  let didChangeContentCb: (() => void) | null = null
  let cursorPositionCb: ((e: { position: { lineNumber: number; column: number } }) => void) | null = null

  const mockModel = {
    getValue: mockGetValue,
    setValue: mockSetValue,
    getFullModelRange: mockGetFullModelRange,
    pushEditOperations: mockPushEditOperations,
    getLanguageId: vi.fn().mockReturnValue('typescript'),
    dispose: vi.fn(),
    onDidChangeContent: (cb: () => void) => {
      didChangeContentCb = cb
      return { dispose: vi.fn() }
    }
  }

  const mockEditor = {
    getModel: vi.fn().mockReturnValue(mockModel),
    setModel: vi.fn(),
    getValue: mockGetValue,
    getPosition: mockGetPosition,
    setPosition: mockSetPosition,
    addCommand: mockAddCommand,
    revealLineInCenter: mockRevealLineInCenter,
    dispose: mockDispose,
    onDidChangeCursorPosition: vi.fn().mockImplementation((cb) => {
      cursorPositionCb = cb
      return { dispose: vi.fn() }
    }),
    onDidChangeModelLanguage: vi.fn().mockReturnValue({ dispose: vi.fn() })
  }

  const mockMonaco = {
    editor: {
      create: vi.fn().mockReturnValue(mockEditor),
      getModel: vi.fn().mockReturnValue(undefined),
      createModel: vi.fn().mockReturnValue(mockModel),
      getModels: vi.fn().mockReturnValue([])
    },
    Uri: { parse: vi.fn().mockImplementation((s: string) => ({ toString: () => s })) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyS: 49, KeyW: 47, Tab: 2, KeyF: 33 }
  }

  return {
    mockAddCommand, mockGetPosition, mockSetPosition, mockGetValue, mockSetValue,
    mockGetFullModelRange, mockPushEditOperations, mockRevealLineInCenter, mockDispose,
    mockModel, mockEditor, mockMonaco,
    getDidChangeContentCb: () => didChangeContentCb,
    setDidChangeContentCb: (cb: (() => void) | null) => { didChangeContentCb = cb },
    getCursorPositionCb: () => cursorPositionCb,
    setCursorPositionCb: (cb: typeof cursorPositionCb) => { cursorPositionCb = cb }
  }
})

vi.mock('../../src/renderer/src/lib/monacoConfig', () => ({
  initMonaco: vi.fn().mockResolvedValue(mockMonaco)
}))

import MonacoEditor from '../../src/renderer/src/components/MonacoEditor.svelte'

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockGetValue.mockReturnValue('')
  mockPushEditOperations.mockReset()
  mockRevealLineInCenter.mockReset()
  mockAddCommand.mockReset()
  setDidChangeContentCb(null)
  setCursorPositionCb(null)
  mockMonaco.editor.getModel.mockReturnValue(undefined)
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
```

Then keep all the existing `describe('MonacoEditor', ...)` tests unchanged, and ADD these new tests at the end of the describe block:

```ts
  it('calls onDirtyChange(path, true) when content changes', async () => {
    const onDirtyChange = vi.fn()
    mockReadFile.mockResolvedValue('original')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onDirtyChange })
    await vi.waitFor(() => expect(getDidChangeContentCb()).not.toBeNull())
    getDidChangeContentCb()!()
    expect(onDirtyChange).toHaveBeenCalledWith('/workspace/r/file.ts', true)
  })

  it('calls onDirtyChange(path, false) after save', async () => {
    const onDirtyChange = vi.fn()
    mockReadFile.mockResolvedValue('hello')
    mockGetValue.mockReturnValue('hello edited')
    mockWriteFile.mockResolvedValue(undefined)
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onDirtyChange })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    getDidChangeContentCb()?.()
    const saveCallback = mockAddCommand.mock.calls[0][1] as () => void
    saveCallback()
    await vi.waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith('/workspace/r/file.ts', false)
    })
  })

  it('calls onStatusChange with line and column on cursor move', async () => {
    const onStatusChange = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onStatusChange })
    await vi.waitFor(() => expect(getCursorPositionCb()).not.toBeNull())
    getCursorPositionCb()!({ position: { lineNumber: 5, column: 10 } })
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ line: 5, column: 10 }))
  })

  it('populates ref.gotoLine which calls revealLineInCenter and setPosition', async () => {
    mockReadFile.mockResolvedValue('')
    let capturedRef: { gotoLine: (n: number) => void } | null = null
    render(MonacoEditor, {
      containerId: 'ctr',
      filePath: '/workspace/r/file.ts',
      get ref() { return capturedRef },
      set ref(v) { capturedRef = v }
    })
    await vi.waitFor(() => expect(capturedRef).not.toBeNull())
    capturedRef!.gotoLine(42)
    expect(mockRevealLineInCenter).toHaveBeenCalledWith(42)
    expect(mockSetPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 1 })
  })

  it('does not reload from disk when filePath changes to a path with existing Monaco model', async () => {
    mockReadFile.mockResolvedValue('original content')
    mockMonaco.editor.getModel.mockReturnValue(mockModel)
    const { rerender } = render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/foo.ts' })
    await vi.waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1))
    mockReadFile.mockClear()
    await rerender({ containerId: 'ctr', filePath: '/workspace/r/bar.ts' })
    await vi.waitFor(() => expect(mockEditor.setModel).toHaveBeenCalledTimes(2))
    expect(mockReadFile).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run updated tests to confirm new tests fail (existing ones still pass)**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/MonacoEditor.test.ts
```

Expected: existing 7 tests PASS, new 5 tests FAIL.

### 5b — Update MonacoEditor.svelte

- [ ] **Step 3: Rewrite MonacoEditor.svelte**

Replace the full contents of `window-manager/src/renderer/src/components/MonacoEditor.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { initMonaco } from '../lib/monacoConfig'

  interface EditorStatus {
    line: number
    column: number
    language: string
  }

  interface EditorRef {
    gotoLine: (n: number) => void
  }

  interface Props {
    containerId: string
    filePath: string
    tabDirty?: boolean
    onDirtyChange?: (path: string, dirty: boolean) => void
    onStatusChange?: (status: EditorStatus) => void
    onCloseTab?: () => void
    onCycleNext?: () => void
    onCyclePrev?: () => void
    onToggleFind?: () => void
    ref?: EditorRef | null
  }

  let {
    containerId, filePath, tabDirty = false,
    onDirtyChange, onStatusChange,
    onCloseTab, onCycleNext, onCyclePrev, onToggleFind,
    ref = $bindable(null)
  }: Props = $props()

  let editorEl: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let monacoRef: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editor: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contentListener: any | undefined
  let isDirty = $state(false)
  let lastContent = ''
  let statusLine = $state(1)
  let statusCol = $state(1)
  let statusLang = $state('')
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let mounted = false

  // Build or retrieve a Monaco model for the given path.
  // If the model already exists (previously opened tab), swap to it without
  // reloading from disk — preserving any unsaved edits in that model.
  async function loadFile(path: string): Promise<void> {
    if (!editor || !monacoRef) return
    const uri = monacoRef.Uri.parse(`inmemory://container/${containerId}${path}`)
    const existingModel = monacoRef.editor.getModel(uri)

    contentListener?.dispose()

    if (existingModel) {
      editor.setModel(existingModel)
      isDirty = tabDirty
      statusLang = existingModel.getLanguageId?.() ?? ''
      contentListener = existingModel.onDidChangeContent(() => {
        if (!isDirty) {
          isDirty = true
          onDirtyChange?.(path, true)
        }
      })
      lastContent = existingModel.getValue?.() ?? ''
      return
    }

    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    const model = monacoRef.editor.createModel('', undefined, uri)
    model.setValue(content)
    editor.setModel(model)
    statusLang = model.getLanguageId?.() ?? ''
    isDirty = false
    onDirtyChange?.(path, false)
    contentListener = model.onDidChangeContent(() => {
      if (!isDirty) {
        isDirty = true
        onDirtyChange?.(path, true)
      }
    })
  }

  async function saveFile(): Promise<void> {
    if (!editor || !isDirty) return
    const content = editor.getValue()
    await window.api.writeContainerFile(containerId, filePath, content)
    lastContent = content
    isDirty = false
    onDirtyChange?.(filePath, false)
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
      // Ignore transient poll errors
    }
  }

  onMount(async () => {
    const monaco = await initMonaco()
    monacoRef = monaco

    editor = monaco.editor.create(editorEl, {
      theme: 'material-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveFile() })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => onCloseTab?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, () => onCycleNext?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => onCyclePrev?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => onToggleFind?.())

    editor.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
      statusLine = e.position.lineNumber
      statusCol = e.position.column
      onStatusChange?.({ line: statusLine, column: statusCol, language: statusLang })
    })

    editor.onDidChangeModelLanguage((e: { newLanguage: string }) => {
      statusLang = e.newLanguage
      onStatusChange?.({ line: statusLine, column: statusCol, language: statusLang })
    })

    ref = {
      gotoLine: (n: number) => {
        editor?.revealLineInCenter(n)
        editor?.setPosition({ lineNumber: n, column: 1 })
      }
    }

    await loadFile(filePath)
    mounted = true
    pollTimer = setInterval(() => void pollFile(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    contentListener?.dispose()
    monacoRef?.editor.getModels().forEach((m: any) => m.dispose())
    editor?.dispose()
  })

  $effect(() => {
    const path = filePath
    if (mounted && editor && path) {
      void loadFile(path)
    }
  })
</script>

<div class="monaco-wrap">
  <div class="editor-body" bind:this={editorEl}></div>
</div>

<style>
  .monaco-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #011627;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }
</style>
```

Note: the `.file-path-bar` div is removed — EditorPane's `TabBar` replaces it.

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/MonacoEditor.test.ts
```

Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MonacoEditor.svelte tests/renderer/MonacoEditor.test.ts
git commit -m "feat: extend MonacoEditor with dirty/status callbacks, gotoLine ref, tab keyboard shortcuts"
```

---

## Task 6: Refactor EditorPane

Rewrites `EditorPane` to own tab state and integrate `TabBar`, `StatusBar`, and `FindInFiles`.

**Files:**
- Modify: `window-manager/src/renderer/src/components/EditorPane.svelte`
- Modify: `window-manager/tests/renderer/EditorPane.test.ts`

### 6a — Update the test file

- [ ] **Step 1: Rewrite EditorPane.test.ts**

Replace the full contents of `window-manager/tests/renderer/EditorPane.test.ts`:

```ts
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture FileTree's onFileSelect so tests can simulate file selection.
// Svelte 5 calls components as Component(anchor, props).
const shared = vi.hoisted(() => ({
  fileTreeOnFileSelect: null as ((path: string) => void) | null,
  monacoOnDirtyChange: null as ((path: string, dirty: boolean) => void) | null
}))

vi.mock('../../src/renderer/src/components/FileTree.svelte', () => ({
  default: vi.fn((_anchor: unknown, props: { onFileSelect: (path: string) => void }) => {
    shared.fileTreeOnFileSelect = props.onFileSelect
    return {}
  })
}))

vi.mock('../../src/renderer/src/components/MonacoEditor.svelte', () => ({
  default: vi.fn((_anchor: unknown, props: { onDirtyChange?: (path: string, dirty: boolean) => void }) => {
    shared.monacoOnDirtyChange = props.onDirtyChange ?? null
    return {}
  })
}))

vi.mock('../../src/renderer/src/components/FindInFiles.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import EditorPane from '../../src/renderer/src/components/EditorPane.svelte'

beforeEach(() => {
  shared.fileTreeOnFileSelect = null
  shared.monacoOnDirtyChange = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorPane', () => {
  it('renders the file tree panel by default', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByLabelText('toggle find in files')).toBeInTheDocument()
  })

  it('opens a tab when a file is selected', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    expect(await screen.findByText('foo.ts')).toBeInTheDocument()
  })

  it('does not duplicate tab when same file selected twice', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(screen.getAllByText('foo.ts')).toHaveLength(1))
  })

  it('activates a tab when its button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/bar.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    await fireEvent.click(screen.getByTitle('/workspace/r/foo.ts'))
    expect(screen.getByTitle('/workspace/r/foo.ts')).toHaveAttribute('aria-selected', 'true')
  })

  it('closes a tab when its close button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(screen.queryByText('foo.ts')).not.toBeInTheDocument()
  })

  it('activates right neighbor when active tab is closed and right neighbor exists', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/bar.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    // Activate foo.ts first
    await fireEvent.click(screen.getByTitle('/workspace/r/foo.ts'))
    // Close foo.ts — bar.ts is right neighbor
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    await vi.waitFor(() => {
      expect(screen.getByTitle('/workspace/r/bar.ts')).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('adds to dirtyTabs when onDirtyChange fires with dirty=true', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(shared.monacoOnDirtyChange).not.toBeNull())
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', true)
    await vi.waitFor(() => {
      expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
    })
  })

  it('removes from dirtyTabs when onDirtyChange fires with dirty=false', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(shared.monacoOnDirtyChange).not.toBeNull())
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', true)
    await vi.waitFor(() => expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument())
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', false)
    await vi.waitFor(() => {
      expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument()
    })
  })

  it('toggles find-in-files panel when toggle button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await fireEvent.click(screen.getByLabelText('toggle find in files'))
    expect(screen.getByLabelText('close find')).toBeInTheDocument()
    await fireEvent.click(screen.getByLabelText('close find'))
    expect(screen.getByLabelText('toggle find in files')).toBeInTheDocument()
  })

  it('renders StatusBar', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByText('Ln 1, Col 1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run updated tests to confirm new tests fail**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/EditorPane.test.ts
```

Expected: some PASS, most FAIL (EditorPane doesn't have tabs yet).

### 6b — Rewrite EditorPane.svelte

- [ ] **Step 3: Rewrite EditorPane.svelte**

Replace full contents of `window-manager/src/renderer/src/components/EditorPane.svelte`:

```svelte
<script lang="ts">
  import FileTree from './FileTree.svelte'
  import MonacoEditor from './MonacoEditor.svelte'
  import TabBar from './TabBar.svelte'
  import StatusBar from './StatusBar.svelte'
  import FindInFiles from './FindInFiles.svelte'

  interface Props {
    containerId: string
    rootPath: string
  }

  let { containerId, rootPath }: Props = $props()

  let openTabs = $state<string[]>([])
  let activeTab = $state<string | null>(null)
  let dirtyTabs = $state(new Set<string>())
  let showFindInFiles = $state(false)
  let editorRef = $state<{ gotoLine: (n: number) => void } | null>(null)
  let status = $state({ line: 1, column: 1, language: '' })

  function openTab(path: string): void {
    if (!openTabs.includes(path)) {
      openTabs = [...openTabs, path]
    }
    activeTab = path
  }

  function closeTab(path: string): void {
    const idx = openTabs.indexOf(path)
    if (idx === -1) return
    const newTabs = openTabs.filter((t) => t !== path)
    openTabs = newTabs
    const next = new Set(dirtyTabs)
    next.delete(path)
    dirtyTabs = next
    if (activeTab === path) {
      activeTab = newTabs[idx] ?? newTabs[idx - 1] ?? null
    }
  }

  function handleDirtyChange(path: string, dirty: boolean): void {
    const next = new Set(dirtyTabs)
    if (dirty) next.add(path)
    else next.delete(path)
    dirtyTabs = next
  }

  function handleStatusChange(s: { line: number; column: number; language: string }): void {
    status = s
  }

  function handleOpenFile(path: string, line: number): void {
    openTab(path)
    setTimeout(() => editorRef?.gotoLine(line), 100)
  }

  function cycleTab(delta: 1 | -1): void {
    if (!activeTab || openTabs.length === 0) return
    const idx = openTabs.indexOf(activeTab)
    activeTab = openTabs[(idx + delta + openTabs.length) % openTabs.length]
  }
</script>

<div class="editor-pane">
  <div class="tree-panel">
    {#if showFindInFiles}
      <div class="panel-header">
        <span>Find in Files</span>
        <button
          class="header-btn"
          aria-label="close find"
          onclick={() => (showFindInFiles = false)}
        >✕</button>
      </div>
      <FindInFiles {containerId} {rootPath} onOpenFile={handleOpenFile} />
    {:else}
      <div class="panel-header">
        <span>Files</span>
        <button
          class="header-btn"
          aria-label="toggle find in files"
          onclick={() => (showFindInFiles = true)}
        >⌕</button>
      </div>
      <FileTree {containerId} {rootPath} onFileSelect={openTab} />
    {/if}
  </div>

  <div class="editor-panel">
    <TabBar
      tabs={openTabs}
      {activeTab}
      {dirtyTabs}
      onActivate={(path) => (activeTab = path)}
      onClose={closeTab}
    />
    <div class="editor-body">
      {#if activeTab}
        <MonacoEditor
          {containerId}
          filePath={activeTab}
          tabDirty={dirtyTabs.has(activeTab)}
          onDirtyChange={handleDirtyChange}
          onStatusChange={handleStatusChange}
          onCloseTab={() => activeTab && closeTab(activeTab)}
          onCycleNext={() => cycleTab(1)}
          onCyclePrev={() => cycleTab(-1)}
          onToggleFind={() => (showFindInFiles = !showFindInFiles)}
          bind:ref={editorRef}
        />
      {:else}
        <div class="editor-default">
          <svg
            class="logo"
            viewBox="1500 1200 1700 1470"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="ele-purple-editor" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#d8b4fe" />
                <stop offset="50%" stop-color="#a855f7" />
                <stop offset="100%" stop-color="#5b21b6" />
              </linearGradient>
            </defs>
            <g transform="translate(4688 0) scale(-1 1)">
              <path
                fill="url(#ele-purple-editor)"
                fill-rule="evenodd"
                d="M 2937.660156 2054.851562 C 2937.660156 2207.878906 2849.660156 2344.238281 2716.210938 2408.941406 L 2716.210938 2250.351562 L 2459.25 2250.351562 C 2337.851562 2250.351562 2235.839844 2334.980469 2209.109375 2448.328125 L 1954.730469 2448.328125 L 1954.730469 2228.199219 C 2051.21875 2224.890625 2234.851562 2198.03125 2367.96875 2053.648438 C 2498.261719 1912.328125 2544.058594 1698.730469 2504.570312 1418.171875 L 2937.660156 1418.171875 Z M 1750.210938 1811.648438 C 1750.210938 1594.679688 1926.730469 1418.171875 2143.699219 1418.171875 L 2385.410156 1418.171875 C 2423.730469 1669.671875 2389 1856.179688 2281.921875 1972.949219 C 2137.941406 2129.96875 1903.820312 2109.730469 1901.628906 2109.539062 L 1836.769531 2103.03125 L 1836.769531 2448.328125 L 1750.210938 2448.328125 Z M 2992.289062 1300.210938 L 2143.699219 1300.210938 C 1861.691406 1300.210938 1632.261719 1529.640625 1632.261719 1811.648438 L 1632.261719 2502.960938 C 1632.261719 2537.878906 1660.671875 2566.289062 1695.589844 2566.289062 L 2320.238281 2566.289062 L 2320.238281 2507.308594 C 2320.238281 2430.660156 2382.601562 2368.300781 2459.25 2368.300781 L 2598.25 2368.300781 L 2598.25 2569.148438 L 2671.929688 2550.191406 C 2897.839844 2492.078125 3055.621094 2288.390625 3055.621094 2054.851562 L 3055.621094 1363.539062 C 3055.621094 1328.621094 3027.210938 1300.210938 2992.289062 1300.210938 Z"
              />
            </g>
            <circle cx="2660" cy="1640" r="60" fill="#ffffff" />
          </svg>
        </div>
      {/if}
    </div>
    <StatusBar
      line={status.line}
      column={status.column}
      language={status.language}
      isDirty={activeTab ? dirtyTabs.has(activeTab) : false}
    />
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
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .header-btn {
    background: none;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 0.8rem;
  }

  .editor-panel {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .editor-default {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
  }

  .logo {
    width: 120px;
    height: auto;
    filter: drop-shadow(0 8px 24px rgba(168, 85, 247, 0.25));
  }
</style>
```

- [ ] **Step 4: Run all EditorPane tests**

```bash
cd window-manager && npm run test:renderer -- tests/renderer/EditorPane.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run the full renderer test suite**

```bash
cd window-manager && npm run test:renderer
```

Expected: all tests PASS. If any tests fail due to the MonacoEditor `file-path-bar` removal (test `renders the file path in the header bar`), remove that test from `MonacoEditor.test.ts` since the path is now shown in TabBar.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/EditorPane.svelte tests/renderer/EditorPane.test.ts
git commit -m "feat: refactor EditorPane with tab management, FindInFiles, and StatusBar integration"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** fs:exec IPC (Task 1) ✓, TabBar (Task 2) ✓, StatusBar (Task 3) ✓, FindInFiles (Task 4) ✓, MonacoEditor callbacks + ref (Task 5) ✓, EditorPane tab state (Task 6) ✓, keyboard shortcuts Ctrl+W/Tab/Shift+Tab/Shift+F (Task 5 addCommand) ✓
- [x] **No placeholders:** all steps have real code
- [x] **Type consistency:** `EditorStatus { line, column, language }` used in Task 5 and referenced in Task 6. `EditorRef { gotoLine }` used in Task 5 and Task 6. `onDirtyChange(path, dirty)` signature consistent across Task 5 (MonacoEditor) and Task 6 (EditorPane).
- [x] **One removed existing test:** `renders the file path in the header bar` in MonacoEditor.test.ts — the `.file-path-bar` element is removed from MonacoEditor in Task 5. This test must be removed in Step 5 of Task 5 (or in Task 6 Step 5 cleanup).
