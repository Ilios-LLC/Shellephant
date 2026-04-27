# Running Windows Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's "Waiting" section with a persistent "Running Windows" section that shows all running windows across all projects, highlighting waiting windows with a blue gradient.

**Architecture:** New `RunningWindowsSection.svelte` component reads `$waitingWindows` store internally and accepts `allWindows` as a prop. Sidebar drops the old waiting section and renders the new component. App.svelte passes `allWindows` to Sidebar and replaces the waiting-select handler with a generic window-select handler.

**Tech Stack:** Svelte 5 runes, @testing-library/svelte, vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/renderer/src/components/RunningWindowsSection.svelte` | Renders running windows; highlights waiting ones |
| Create | `tests/renderer/RunningWindowsSection.test.ts` | Unit tests for new component |
| Modify | `src/renderer/src/components/Sidebar.svelte` | Swap out waiting section for RunningWindowsSection |
| Modify | `tests/renderer/Sidebar.test.ts` | Update tests to match new Sidebar props/behavior |
| Modify | `src/renderer/src/App.svelte` | Pass `allWindows` to Sidebar; new window-select handler |

All paths relative to `window-manager/`.

---

### Task 1: Create `RunningWindowsSection.svelte` with tests

**Files:**
- Create: `window-manager/src/renderer/src/components/RunningWindowsSection.svelte`
- Create: `window-manager/tests/renderer/RunningWindowsSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/RunningWindowsSection.test.ts`:

```typescript
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RunningWindowsSection from '../../src/renderer/src/components/RunningWindowsSection.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'

function makeWindow(id: number, name: string, projectId: number, projectName: string, status: 'running' | 'stopped' = 'running'): WindowRecord {
  return {
    id,
    name,
    project_id: projectId,
    container_id: `container-${id}`,
    window_type: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    status,
    projects: [{ id, window_id: id, project_id: projectId, clone_path: '/tmp', project_name: projectName }]
  }
}

describe('RunningWindowsSection', () => {
  let onWindowSelect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onWindowSelect = vi.fn()
    waitingWindows._resetForTest()
  })

  afterEach(() => {
    cleanup()
    waitingWindows._resetForTest()
  })

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      allWindows: [] as WindowRecord[],
      onWindowSelect,
      ...overrides
    }
  }

  it('renders nothing when no running windows', () => {
    const { container } = render(RunningWindowsSection, baseProps())
    expect(container.querySelector('.running-section')).toBeNull()
  })

  it('renders nothing when all windows are stopped', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1', 'stopped')
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(container.querySelector('.running-section')).toBeNull()
  })

  it('renders running windows with project / window label', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText('proj1 / win1')).toBeDefined()
  })

  it('shows Running section header when running windows exist', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText(/running/i)).toBeDefined()
  })

  it('waiting window gets waiting class', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    waitingWindows.add({
      containerId: 'container-1',
      windowId: 1,
      windowName: 'win1',
      projectId: 1,
      projectName: 'proj1'
    })
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    const btn = container.querySelector('.running-item')
    expect(btn?.classList.contains('waiting')).toBe(true)
  })

  it('non-waiting running window does not get waiting class', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    const btn = container.querySelector('.running-item')
    expect(btn?.classList.contains('waiting')).toBe(false)
  })

  it('clicking a waiting item calls onWindowSelect and removes from store', async () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    waitingWindows.add({
      containerId: 'container-1',
      windowId: 1,
      windowName: 'win1',
      projectId: 1,
      projectName: 'proj1'
    })
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    await fireEvent.click(screen.getByText('proj1 / win1'))
    expect(onWindowSelect).toHaveBeenCalledWith(w)
    let storeValue: typeof waitingWindows extends { subscribe: (fn: (v: infer V) => void) => void } ? V : never
    waitingWindows.subscribe((v) => { storeValue = v })()
    // @ts-ignore
    expect(storeValue.find((e) => e.containerId === 'container-1')).toBeUndefined()
  })

  it('clicking a non-waiting item calls onWindowSelect only', async () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    await fireEvent.click(screen.getByText('proj1 / win1'))
    expect(onWindowSelect).toHaveBeenCalledWith(w)
  })

  it('uses project name from win.projects when available', () => {
    const w: WindowRecord = {
      id: 2,
      name: 'mywin',
      project_id: null,
      container_id: 'container-2',
      window_type: 'manual',
      created_at: '2026-01-01T00:00:00Z',
      status: 'running',
      projects: [
        { id: 1, window_id: 2, project_id: 10, clone_path: '/tmp', project_name: 'alpha' },
        { id: 2, window_id: 2, project_id: 11, clone_path: '/tmp', project_name: 'beta' }
      ]
    }
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText('alpha, beta / mywin')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager
npx vitest run tests/renderer/RunningWindowsSection.test.ts
```

Expected: FAIL — "Cannot find module '../../src/renderer/src/components/RunningWindowsSection.svelte'"

- [ ] **Step 3: Create `RunningWindowsSection.svelte`**

Create `window-manager/src/renderer/src/components/RunningWindowsSection.svelte`:

```svelte
<script lang="ts">
  import type { WindowRecord } from '../types'
  import { waitingWindows } from '../lib/waitingWindows'

  interface Props {
    allWindows: WindowRecord[]
    onWindowSelect: (win: WindowRecord) => void
  }

  let { allWindows, onWindowSelect }: Props = $props()

  let runningWindows = $derived(allWindows.filter((w) => w.status === 'running'))

  function projectLabel(win: WindowRecord): string {
    if (win.projects.length === 0) return 'unknown'
    return win.projects.map((p) => p.project_name ?? 'unknown').join(', ')
  }

  function isWaiting(win: WindowRecord): boolean {
    return $waitingWindows.some((e) => e.containerId === win.container_id)
  }

  function handleClick(win: WindowRecord): void {
    waitingWindows.remove(win.container_id)
    onWindowSelect(win)
  }
</script>

{#if runningWindows.length > 0}
  <div class="running-section">
    <div class="running-header">Running</div>
    {#each runningWindows as win (win.id)}
      <button
        type="button"
        class="running-item"
        class:waiting={isWaiting(win)}
        onclick={() => handleClick(win)}
      >
        <span class="running-dot" aria-hidden="true">●</span>
        <span class="running-label">{projectLabel(win)} / {win.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .running-section {
    border-top: 1px solid var(--border);
    padding: 0.35rem 0;
  }

  .running-header {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    padding: 0.35rem 0.85rem 0.2rem;
  }

  .running-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    transition: background 0.1s;
  }

  .running-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .running-item.waiting {
    background: linear-gradient(135deg, hsla(210, 80%, 50%, 0.18), transparent);
    border-left: 2px solid hsla(210, 80%, 60%, 0.6);
    color: var(--fg-0);
  }

  .running-item.waiting:hover {
    background: linear-gradient(135deg, hsla(210, 80%, 50%, 0.28), transparent);
  }

  .running-dot {
    font-size: 0.5rem;
    color: var(--ok);
    flex-shrink: 0;
  }

  .running-item.waiting .running-dot {
    color: var(--accent-hi);
  }

  .running-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager
npx vitest run tests/renderer/RunningWindowsSection.test.ts
```

Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window/window-manager
git add src/renderer/src/components/RunningWindowsSection.svelte tests/renderer/RunningWindowsSection.test.ts
git commit -m "feat: add RunningWindowsSection component"
```

---

### Task 2: Update `Sidebar.svelte` and its tests

**Files:**
- Modify: `window-manager/src/renderer/src/components/Sidebar.svelte`
- Modify: `window-manager/tests/renderer/Sidebar.test.ts`

- [ ] **Step 1: Update Sidebar tests first**

Replace the `waiting section` describe block and update `baseProps` in `window-manager/tests/renderer/Sidebar.test.ts`.

Remove the `onWaitingWindowSelect` mock and the `waiting section` describe block. Add `allWindows` and `onWindowSelect` props. Add a smoke test that `RunningWindowsSection` renders when running windows exist.

The new imports at the top of `Sidebar.test.ts`:

```typescript
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../../src/renderer/src/types'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'
```

Replace `baseProps` function (remove `onWaitingWindowSelect`, add `allWindows` and `onWindowSelect`):

```typescript
function makeWindow(id: number, status: 'running' | 'stopped' = 'running'): WindowRecord {
  return {
    id,
    name: `win${id}`,
    project_id: 1,
    container_id: `container-${id}`,
    window_type: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    status,
    projects: [{ id, window_id: id, project_id: 1, clone_path: '/tmp', project_name: 'proj1' }]
  }
}
```

Update `baseProps`:

```typescript
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    projects: [] as ProjectRecord[],
    selectedProjectId: null as number | null,
    groups: [] as ProjectGroupRecord[],
    activeGroupId: null as number | null,
    allWindows: [] as WindowRecord[],
    onProjectSelect,
    onRequestNewProject,
    onRequestSettings,
    onRequestHome,
    onWindowSelect,
    onGroupSelect,
    onGroupCreated,
    onProjectSettingsClick,
    ...overrides
  }
}
```

Remove `onWaitingWindowSelect` from `beforeEach` mocks and add `onWindowSelect`:

```typescript
let onWindowSelect: ReturnType<typeof vi.fn>
// ... in beforeEach:
onWindowSelect = vi.fn()
```

Replace the entire `waiting section` describe block with:

```typescript
describe('running windows section', () => {
  beforeEach(() => waitingWindows._resetForTest())
  afterEach(() => waitingWindows._resetForTest())

  it('does not render running section when no running windows', () => {
    render(Sidebar, baseProps())
    expect(screen.queryByText(/^running$/i)).toBeNull()
  })

  it('renders running section when running windows exist', () => {
    const w = makeWindow(1)
    render(Sidebar, baseProps({ allWindows: [w] }))
    expect(screen.getByText(/^running$/i)).toBeDefined()
    expect(screen.getByText('proj1 / win1')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run Sidebar tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager
npx vitest run tests/renderer/Sidebar.test.ts
```

Expected: multiple FAIL — `onWaitingWindowSelect` prop unknown, `allWindows`/`onWindowSelect` missing

- [ ] **Step 3: Update `Sidebar.svelte`**

Replace the contents of `window-manager/src/renderer/src/components/Sidebar.svelte` script and template:

In the `<script>` block, replace imports and Props interface:

```svelte
<script lang="ts">
  import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import GroupStrip from './GroupStrip.svelte'
  import RunningWindowsSection from './RunningWindowsSection.svelte'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    groups: ProjectGroupRecord[]
    activeGroupId: number | 'ungrouped' | null
    allWindows: WindowRecord[]
    onProjectSelect: (project: ProjectRecord) => void
    onRequestNewProject: () => void
    onRequestSettings: () => void
    onRequestHome: () => void
    onWindowSelect: (win: WindowRecord) => void
    onGroupSelect: (id: number | 'ungrouped') => void
    onGroupCreated: (group: ProjectGroupRecord) => void
    onProjectSettingsClick: (project: ProjectRecord) => void
    onRequestMultiWindow?: () => void
    onRequestTraces?: () => void
  }

  let {
    projects,
    selectedProjectId,
    groups,
    activeGroupId,
    allWindows,
    onProjectSelect,
    onRequestNewProject,
    onRequestSettings,
    onRequestHome,
    onWindowSelect,
    onGroupSelect,
    onGroupCreated,
    onProjectSettingsClick,
    onRequestMultiWindow,
    onRequestTraces
  }: Props = $props()
</script>
```

In the template, replace the `{#if $waitingWindows.length > 0}` block with `<RunningWindowsSection>`:

Remove this block:
```svelte
{#if $waitingWindows.length > 0}
  <div class="waiting-section">
    <div class="waiting-header">Waiting</div>
    {#each $waitingWindows as entry (entry.containerId)}
      <button
        type="button"
        class="waiting-item"
        onclick={() => onWaitingWindowSelect(entry)}
      >
        <span class="waiting-dot" aria-hidden="true">●</span>
        <span class="waiting-label">{entry.projectName} / {entry.windowName}</span>
      </button>
    {/each}
  </div>
{/if}
```

Replace with:
```svelte
<RunningWindowsSection {allWindows} {onWindowSelect} />
```

Also remove the `.waiting-section`, `.waiting-header`, `.waiting-item`, `.waiting-dot`, `.waiting-label` CSS rules from `<style>` since they are now in `RunningWindowsSection.svelte`.

- [ ] **Step 4: Run Sidebar tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager
npx vitest run tests/renderer/Sidebar.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window/window-manager
git add src/renderer/src/components/Sidebar.svelte tests/renderer/Sidebar.test.ts
git commit -m "feat: replace waiting section with RunningWindowsSection in Sidebar"
```

---

### Task 3: Update `App.svelte`

**Files:**
- Modify: `window-manager/src/renderer/src/App.svelte`

- [ ] **Step 1: Add `handleSidebarWindowSelect` and update Sidebar props**

In `App.svelte`, add a new handler after `handleWaitingWindowSelect` (keep `handleWaitingWindowSelect` for now as internal logic — we'll inline it):

```typescript
async function handleSidebarWindowSelect(win: WindowRecord): Promise<void> {
  const projectId = win.project_id ?? win.projects[0]?.project_id ?? null
  waitingWindows.remove(win.container_id)
  selectedProjectId = projectId
  selectedWindowId = null
  view = 'default'
  windows = projectId === null ? [] : await window.api.listWindows(projectId)
  selectedWindowId = win.id
  chatFocusSignal.set(win.id)
}
```

Then remove `handleWaitingWindowSelect` (its logic is absorbed above).

- [ ] **Step 2: Update Sidebar props in the template**

In the `<Sidebar>` element in App.svelte, replace:
```svelte
onWaitingWindowSelect={handleWaitingWindowSelect}
```
with:
```svelte
{allWindows}
onWindowSelect={handleSidebarWindowSelect}
```

The full updated `<Sidebar>` call:

```svelte
<Sidebar
  projects={filteredProjects}
  {selectedProjectId}
  {groups}
  {activeGroupId}
  {allWindows}
  onProjectSelect={handleProjectSelect}
  onRequestNewProject={handleRequestNewProject}
  onRequestSettings={handleRequestSettings}
  onRequestHome={handleRequestHome}
  onWindowSelect={handleSidebarWindowSelect}
  onGroupSelect={handleGroupSelect}
  onGroupCreated={handleGroupCreated}
  onProjectSettingsClick={handleProjectSettingsClick}
  onRequestMultiWindow={handleRequestMultiWindow}
  onRequestTraces={handleRequestTraces}
/>
```

- [ ] **Step 3: Run full renderer test suite to verify no regressions**

```bash
cd /workspace/claude-window/window-manager
npx vitest run tests/renderer/
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
cd /workspace/claude-window/window-manager
git add src/renderer/src/App.svelte
git commit -m "feat: wire allWindows and onWindowSelect through App to Sidebar"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /workspace/claude-window/window-manager
npx vitest run
```

Expected: all tests PASS, no regressions

- [ ] **Step 2: Update CLAUDE.md**

Add entry for `RunningWindowsSection.svelte` to the `## Codebase Structure` section in `/home/node/.claude/CLAUDE.md` following the same format as existing component entries.

- [ ] **Step 3: Final commit**

```bash
cd /workspace/claude-window
git add /home/node/.claude/CLAUDE.md
git commit -m "docs: document RunningWindowsSection in CLAUDE.md"
```
