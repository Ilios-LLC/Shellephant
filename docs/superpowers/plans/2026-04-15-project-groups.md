# Project Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project groups — users create named groups, assign projects to them, and filter the sidebar by clicking a group icon at the bottom.

**Architecture:** New `project_groups` SQLite table + `group_id` FK on `projects`. Backend service + IPC exposes CRUD. Frontend: `GroupStrip` component at sidebar bottom handles create/filter; `ProjectView` adds inline group dropdown.

**Tech Stack:** Svelte 5, TypeScript, better-sqlite3, Electron IPC, Vitest, @testing-library/svelte

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/main/db.ts` | Add `project_groups` table; migrate `projects.group_id` |
| Modify | `src/main/projectService.ts` | Add `updateProject`; include `group_id` in SELECT; add `group_id` to backend `ProjectRecord` |
| Create | `src/main/projectGroupService.ts` | `createGroup` / `listGroups` |
| Modify | `src/main/ipcHandlers.ts` | Register `group:create`, `group:list`, `project:update` |
| Modify | `src/preload/index.ts` | Expose three new API methods |
| Modify | `src/renderer/src/types.ts` | Add `ProjectGroupRecord`; add `group_id` to `ProjectRecord`; add 3 `Api` methods |
| Create | `src/renderer/src/components/GroupStrip.svelte` | Group icons + inline create input |
| Modify | `src/renderer/src/components/Sidebar.svelte` | Accept new props; render `GroupStrip` |
| Modify | `src/renderer/src/App.svelte` | `groups`, `activeGroupId`, `filteredProjects`; new handlers |
| Modify | `src/renderer/src/components/MainPane.svelte` | Thread `groups` + `onProjectUpdated` to `ProjectView` |
| Modify | `src/renderer/src/components/ProjectView.svelte` | Group `<select>` in header |
| Modify | `tests/main/db.test.ts` | Verify new table + column |
| Create | `tests/main/projectGroupService.test.ts` | Unit tests for `createGroup` / `listGroups` |
| Modify | `tests/main/projectService.test.ts` | Tests for `updateProject` + `group_id` in list |
| Create | `tests/renderer/GroupStrip.test.ts` | Component tests |
| Modify | `tests/renderer/Sidebar.test.ts` | Update `baseProps` for new props |
| Modify | `tests/renderer/ProjectView.test.ts` | Group dropdown tests |

All paths relative to `window-manager/`.

---

### Task 1: DB schema — project_groups table + group_id migration

**Files:**
- Modify: `src/main/db.ts`
- Modify: `tests/main/db.test.ts`

- [ ] **Step 1: Write failing tests for new schema**

Add to the end of the `describe('db', ...)` block in `tests/main/db.test.ts`:

```ts
it('creates the project_groups table on init', () => {
  const db = getDb()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_groups'")
    .all()
  expect(tables).toHaveLength(1)
})

it('project_groups table has expected columns', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(project_groups)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toEqual(
    expect.arrayContaining(['id', 'name', 'created_at'])
  )
})

it('projects table has a group_id column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('group_id')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: 3 new tests FAIL (table/column don't exist yet).

- [ ] **Step 3: Add project_groups table and group_id migration to db.ts**

In `src/main/db.ts`, after the settings table `_db.exec(...)` block, add:

```ts
  _db.exec(`
    CREATE TABLE IF NOT EXISTS project_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Migrate: add group_id to projects for databases created before this feature
  const projGroupCols = _db.pragma('table_info(projects)') as { name: string }[]
  if (!projGroupCols.some((c) => c.name === 'group_id')) {
    _db.exec(
      'ALTER TABLE projects ADD COLUMN group_id INTEGER REFERENCES project_groups(id) DEFAULT NULL'
    )
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Add migration test for group_id**

Add to the `describe('db migrations', ...)` block in `tests/main/db.test.ts`:

```ts
it('adds group_id column to projects table that lacks it', async () => {
  const Database = (await import('better-sqlite3')).default
  const path = await import('path')
  const os = await import('os')
  const fs = await import('fs')

  const tmpPath = path.join(os.tmpdir(), `cw-db-groupid-${Date.now()}.sqlite`)
  const pre = new Database(tmpPath)
  pre.exec(`
    CREATE TABLE project_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  pre.exec(`
    CREATE TABLE projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      ports      TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  pre.close()

  initDb(tmpPath)
  const migrated = getDb()
  const cols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('group_id')

  closeDb()
  fs.rmSync(tmpPath, { force: true })
})
```

- [ ] **Step 6: Run tests to confirm migration test passes**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add project_groups table and group_id migration"
```

---

### Task 2: Type definitions — ProjectGroupRecord + ProjectRecord.group_id + Api

**Files:**
- Modify: `src/renderer/src/types.ts`
- Modify: `src/main/projectService.ts` (backend `ProjectRecord` interface only)

- [ ] **Step 1: Add ProjectGroupRecord to frontend types.ts**

In `src/renderer/src/types.ts`, after the `WindowStatus` line and before `ProjectRecord`, add:

```ts
export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}
```

- [ ] **Step 2: Add group_id to ProjectRecord in types.ts**

Replace the `ProjectRecord` interface in `src/renderer/src/types.ts`:

```ts
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  group_id?: number | null
  created_at: string
}
```

- [ ] **Step 3: Add three new methods to the Api interface in types.ts**

In `src/renderer/src/types.ts`, add after `deleteProject`:

```ts
  updateProject: (id: number, patch: { groupId: number | null }) => Promise<ProjectRecord>
  createGroup: (name: string) => Promise<ProjectGroupRecord>
  listGroups: () => Promise<ProjectGroupRecord[]>
```

- [ ] **Step 4: Add group_id to backend ProjectRecord in projectService.ts**

In `src/main/projectService.ts`, update the `ProjectRecord` interface:

```ts
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  group_id?: number | null
  created_at: string
}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/types.ts src/main/projectService.ts
git commit -m "feat: add ProjectGroupRecord type and group_id to ProjectRecord"
```

---

### Task 3: projectGroupService — createGroup + listGroups

**Files:**
- Create: `src/main/projectGroupService.ts`
- Create: `tests/main/projectGroupService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/projectGroupService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db'
import { createGroup, listGroups } from '../../src/main/projectGroupService'

describe('projectGroupService', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  describe('createGroup', () => {
    it('creates a group and returns it', () => {
      const result = createGroup('frontend')
      expect(result.name).toBe('frontend')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('trims whitespace from name', () => {
      const result = createGroup('  backend  ')
      expect(result.name).toBe('backend')
    })

    it('creates multiple groups with distinct ids', () => {
      const a = createGroup('alpha')
      const b = createGroup('beta')
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('listGroups', () => {
    it('returns empty array when no groups exist', () => {
      expect(listGroups()).toEqual([])
    })

    it('returns all created groups', () => {
      createGroup('alpha')
      createGroup('beta')
      const groups = listGroups()
      expect(groups).toHaveLength(2)
      expect(groups.map((g) => g.name)).toContain('alpha')
      expect(groups.map((g) => g.name)).toContain('beta')
    })

    it('returns groups ordered by created_at ascending', () => {
      createGroup('first')
      createGroup('second')
      const groups = listGroups()
      expect(groups[0].name).toBe('first')
      expect(groups[1].name).toBe('second')
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectGroupService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement projectGroupService.ts**

Create `src/main/projectGroupService.ts`:

```ts
import { getDb } from './db'

export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}

export function createGroup(name: string): ProjectGroupRecord {
  const trimmed = name.trim()
  const db = getDb()
  const result = db.prepare('INSERT INTO project_groups (name) VALUES (?)').run(trimmed)
  return {
    id: result.lastInsertRowid as number,
    name: trimmed,
    created_at: new Date().toISOString()
  }
}

export function listGroups(): ProjectGroupRecord[] {
  return getDb()
    .prepare('SELECT id, name, created_at FROM project_groups ORDER BY created_at ASC')
    .all() as ProjectGroupRecord[]
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectGroupService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/projectGroupService.ts tests/main/projectGroupService.test.ts
git commit -m "feat: add projectGroupService with createGroup and listGroups"
```

---

### Task 4: updateProject + group_id in listProjects

**Files:**
- Modify: `src/main/projectService.ts`
- Modify: `tests/main/projectService.test.ts`

- [ ] **Step 1: Write failing tests for updateProject**

Add to `tests/main/projectService.test.ts`, inside `describe('projectService', ...)`, after the existing `describe('deleteProject', ...)` block:

```ts
describe('updateProject', () => {
  it('sets group_id on a project', async () => {
    const project = await createProject('my-project', 'git@github.com:org/repo.git')
    const { createGroup } = await import('../../src/main/projectGroupService')
    const group = createGroup('frontend')

    const updated = updateProject(project.id, { groupId: group.id })
    expect(updated.group_id).toBe(group.id)
  })

  it('clears group_id when null is passed', async () => {
    const project = await createProject('my-project', 'git@github.com:org/repo2.git')
    const { createGroup } = await import('../../src/main/projectGroupService')
    const group = createGroup('frontend')
    updateProject(project.id, { groupId: group.id })

    const cleared = updateProject(project.id, { groupId: null })
    expect(cleared.group_id).toBeNull()
  })
})
```

Also add to `describe('listProjects', ...)`:

```ts
it('includes group_id in returned records', async () => {
  await createProject('grouped', 'git@github.com:org/grouped.git')
  const projects = listProjects()
  expect('group_id' in projects[0]).toBe(true)
})
```

Add the `updateProject` import at the top of the import block:

```ts
import {
  createProject,
  listProjects,
  deleteProject,
  updateProject
} from '../../src/main/projectService'
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: 3 new tests FAIL — `updateProject` not exported.

- [ ] **Step 3: Add updateProject to projectService.ts and fix listProjects SELECT**

In `src/main/projectService.ts`, update the `listProjects` function SELECT to include `group_id`:

```ts
export function listProjects(): ProjectRecord[] {
  return getDb()
    .prepare(
      'SELECT id, name, git_url, ports, group_id, created_at FROM projects WHERE deleted_at IS NULL'
    )
    .all() as ProjectRecord[]
}
```

Add `updateProject` function after `listProjects`:

```ts
export function updateProject(id: number, patch: { groupId: number | null }): ProjectRecord {
  const db = getDb()
  db.prepare('UPDATE projects SET group_id = ? WHERE id = ? AND deleted_at IS NULL').run(
    patch.groupId ?? null,
    id
  )
  return db
    .prepare(
      'SELECT id, name, git_url, ports, group_id, created_at FROM projects WHERE id = ?'
    )
    .get(id) as ProjectRecord
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/projectService.ts tests/main/projectService.test.ts
git commit -m "feat: add updateProject and include group_id in listProjects"
```

---

### Task 5: IPC handlers + preload

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Update ipcHandlers.test.ts mocks and add handler tests**

In `tests/main/ipcHandlers.test.ts`:

Update the `projectService` mock to include `updateProject`:
```ts
vi.mock('../../src/main/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn()
}))
```

Add a new mock for `projectGroupService` after the projectService mock:
```ts
vi.mock('../../src/main/projectGroupService', () => ({
  createGroup: vi.fn(),
  listGroups: vi.fn()
}))
```

Add `updateProject` to the projectService import near line 70:
```ts
import { createProject, listProjects, deleteProject, updateProject } from '../../src/main/projectService'
```

Add imports for `createGroup` and `listGroups` after the projectService import:
```ts
import { createGroup, listGroups } from '../../src/main/projectGroupService'
```

Add three new tests at the end of `describe('registerIpcHandlers', ...)`:
```ts
  it('registers project:update handler that calls updateProject', async () => {
    const updated = { id: 1, name: 'p', git_url: 'git@github.com:org/r.git', group_id: 2, created_at: '2026-01-01' }
    vi.mocked(updateProject).mockReturnValue(updated)
    const result = await getHandler('project:update')({}, 1, { groupId: 2 })
    expect(updateProject).toHaveBeenCalledWith(1, { groupId: 2 })
    expect(result).toEqual(updated)
  })

  it('registers group:create handler that calls createGroup', async () => {
    const group = { id: 1, name: 'frontend', created_at: '2026-01-01' }
    vi.mocked(createGroup).mockReturnValue(group)
    const result = await getHandler('group:create')({}, 'frontend')
    expect(createGroup).toHaveBeenCalledWith('frontend')
    expect(result).toEqual(group)
  })

  it('registers group:list handler that calls listGroups', async () => {
    const groups = [{ id: 1, name: 'frontend', created_at: '2026-01-01' }]
    vi.mocked(listGroups).mockReturnValue(groups)
    const result = await getHandler('group:list')({})
    expect(listGroups).toHaveBeenCalled()
    expect(result).toEqual(groups)
  })
```

- [ ] **Step 2: Run tests to confirm new handler tests fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/ipcHandlers.test.ts
```

Expected: 3 new tests FAIL — channels not registered yet.

- [ ] **Step 3: Register new IPC handlers in ipcHandlers.ts**

In `src/main/ipcHandlers.ts`, update the import from `projectService` to include `updateProject`:

```ts
import { createProject, listProjects, deleteProject, updateProject } from './projectService'
```

Add the import for `projectGroupService` after the `projectService` import:

```ts
import { createGroup, listGroups } from './projectGroupService'
```

Inside `registerIpcHandlers()`, add after the existing `project:delete` handler:

```ts
  ipcMain.handle('project:update', (_, id: number, patch: { groupId: number | null }) =>
    updateProject(id, patch)
  )

  // Group handlers
  ipcMain.handle('group:create', (_, name: string) => createGroup(name))
  ipcMain.handle('group:list', () => listGroups())
```

- [ ] **Step 4: Run backend tests to confirm all pass**

```bash
cd window-manager && npm run test:main
```

Expected: all tests PASS.

- [ ] **Step 5: Expose new methods in preload/index.ts**

In `src/preload/index.ts`, add after the `deleteProject` line inside the `contextBridge.exposeInMainWorld` call:

```ts
  updateProject: (id: number, patch: { groupId: number | null }) =>
    ipcRenderer.invoke('project:update', id, patch),

  // Group API
  createGroup: (name: string) => ipcRenderer.invoke('group:create', name),
  listGroups: () => ipcRenderer.invoke('group:list'),
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts tests/main/ipcHandlers.test.ts
git commit -m "feat: register group and project:update IPC handlers"
```

---

### Task 6: GroupStrip component

**Files:**
- Create: `src/renderer/src/components/GroupStrip.svelte`
- Create: `tests/renderer/GroupStrip.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `tests/renderer/GroupStrip.test.ts`:

```ts
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupStrip from '../../src/renderer/src/components/GroupStrip.svelte'
import type { ProjectGroupRecord } from '../../src/renderer/src/types'

function makeGroup(id: number, name: string): ProjectGroupRecord {
  return { id, name, created_at: '2026-01-01T00:00:00Z' }
}

describe('GroupStrip', () => {
  let onGroupSelect: ReturnType<typeof vi.fn>
  let onGroupCreated: ReturnType<typeof vi.fn>
  let mockCreateGroup: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onGroupSelect = vi.fn()
    onGroupCreated = vi.fn()
    mockCreateGroup = vi.fn()
    vi.stubGlobal('api', { createGroup: mockCreateGroup })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      groups: [] as ProjectGroupRecord[],
      activeGroupId: null as number | null,
      onGroupSelect,
      onGroupCreated,
      ...overrides
    }
  }

  it('renders a "new group" button', () => {
    render(GroupStrip, baseProps())
    expect(screen.getByRole('button', { name: /new group/i })).toBeDefined()
  })

  it('renders one button per group showing first letter', () => {
    render(GroupStrip, baseProps({ groups: [makeGroup(1, 'Alpha'), makeGroup(2, 'Beta')] }))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeDefined()
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.getByText('B')).toBeDefined()
  })

  it('clicking a group button calls onGroupSelect with its id', async () => {
    render(GroupStrip, baseProps({ groups: [makeGroup(1, 'Alpha')] }))
    await fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onGroupSelect).toHaveBeenCalledWith(1)
  })

  it('active group button has "active" class', () => {
    const { container } = render(GroupStrip, baseProps({
      groups: [makeGroup(1, 'Alpha'), makeGroup(2, 'Beta')],
      activeGroupId: 2
    }))
    const icons = container.querySelectorAll('.group-icon:not(.add-btn)')
    expect(icons[0].classList.contains('active')).toBe(false)
    expect(icons[1].classList.contains('active')).toBe(true)
  })

  it('clicking "new group" button shows an input field', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    expect(screen.getByPlaceholderText(/name/i)).toBeDefined()
  })

  it('pressing Escape cancels input and restores the "+" button', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/name/i)).toBeNull()
    expect(screen.getByRole('button', { name: /new group/i })).toBeDefined()
  })

  it('pressing Enter with a name calls api.createGroup and onGroupCreated', async () => {
    const newGroup = makeGroup(3, 'Gamma')
    mockCreateGroup.mockResolvedValue(newGroup)
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.input(input, { target: { value: 'Gamma' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith('Gamma')
      expect(onGroupCreated).toHaveBeenCalledWith(newGroup)
    })
  })

  it('pressing Enter with empty name does not call api.createGroup', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockCreateGroup).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/GroupStrip.test.ts
```

Expected: FAIL — component not found.

- [ ] **Step 3: Create GroupStrip.svelte**

Create `src/renderer/src/components/GroupStrip.svelte`:

```svelte
<script lang="ts">
  import type { ProjectGroupRecord } from '../types'

  interface Props {
    groups: ProjectGroupRecord[]
    activeGroupId: number | null
    onGroupSelect: (id: number) => void
    onGroupCreated: (group: ProjectGroupRecord) => void
  }

  let { groups, activeGroupId, onGroupSelect, onGroupCreated }: Props = $props()

  let adding = $state(false)
  let newName = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (adding && inputEl) inputEl.focus()
  })

  function startAdd(): void {
    adding = true
    newName = ''
  }

  function cancelAdd(): void {
    adding = false
    newName = ''
  }

  async function submitAdd(): Promise<void> {
    const trimmed = newName.trim()
    if (!trimmed) {
      cancelAdd()
      return
    }
    const group = await window.api.createGroup(trimmed)
    onGroupCreated(group)
    cancelAdd()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') submitAdd()
    else if (e.key === 'Escape') cancelAdd()
  }
</script>

<div class="group-strip">
  {#each groups as group (group.id)}
    <button
      type="button"
      class="group-icon"
      class:active={group.id === activeGroupId}
      title={group.name}
      aria-label={group.name}
      onclick={() => onGroupSelect(group.id)}
    >
      {group.name[0].toUpperCase()}
    </button>
  {/each}
  {#if adding}
    <input
      bind:this={inputEl}
      class="group-input"
      bind:value={newName}
      placeholder="Name…"
      onkeydown={handleKeydown}
      onblur={cancelAdd}
    />
  {:else}
    <button
      type="button"
      class="group-icon add-btn"
      aria-label="new group"
      title="New group"
      onclick={startAdd}
    >+</button>
  {/if}
</div>

<style>
  .group-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--border);
  }

  .group-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .group-icon:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .group-icon.active {
    color: var(--accent-hi);
    border-color: var(--accent-hi);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .group-input {
    width: 5rem;
    height: 1.6rem;
    padding: 0 0.4rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    border: 1px solid var(--accent);
    background: var(--bg-1);
    color: var(--fg-0);
    border-radius: 4px;
    outline: none;
  }
</style>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/GroupStrip.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GroupStrip.svelte tests/renderer/GroupStrip.test.ts
git commit -m "feat: add GroupStrip component with inline group creation"
```

---

### Task 7: Wire up state — App.svelte + MainPane.svelte + Sidebar.svelte + Sidebar.test.ts

**Files:**
- Modify: `src/renderer/src/App.svelte`
- Modify: `src/renderer/src/components/MainPane.svelte`
- Modify: `src/renderer/src/components/Sidebar.svelte`
- Modify: `tests/renderer/Sidebar.test.ts`

- [ ] **Step 1: Update Sidebar.svelte to accept group props and render GroupStrip**

Replace the entire contents of `src/renderer/src/components/Sidebar.svelte`:

```svelte
<script lang="ts">
  import type { ProjectRecord, ProjectGroupRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import GroupStrip from './GroupStrip.svelte'
  import { waitingWindows, type WaitingEntry } from '../lib/waitingWindows'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    groups: ProjectGroupRecord[]
    activeGroupId: number | null
    onProjectSelect: (project: ProjectRecord) => void
    onRequestNewProject: () => void
    onRequestSettings: () => void
    onRequestHome: () => void
    onWaitingWindowSelect: (entry: WaitingEntry) => void
    onGroupSelect: (id: number) => void
    onGroupCreated: (group: ProjectGroupRecord) => void
  }

  let {
    projects,
    selectedProjectId,
    groups,
    activeGroupId,
    onProjectSelect,
    onRequestNewProject,
    onRequestSettings,
    onRequestHome,
    onWaitingWindowSelect,
    onGroupSelect,
    onGroupCreated
  }: Props = $props()
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <button type="button" class="home-link" onclick={onRequestHome}>Shellephant</button>
    <div class="header-actions">
      <button
        type="button"
        class="icon-btn"
        aria-label="settings"
        title="Settings"
        onclick={onRequestSettings}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="new project"
        title="New project"
        onclick={onRequestNewProject}>+</button
      >
    </div>
  </header>
  <nav class="sidebar-list">
    {#each projects as project (project.id)}
      <ProjectItem
        {project}
        selected={project.id === selectedProjectId}
        onSelect={onProjectSelect}
      />
    {/each}
  </nav>
  {#if projects.length === 0}
    <p class="empty-hint">No projects yet.</p>
  {/if}
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
  <GroupStrip {groups} {activeGroupId} {onGroupSelect} {onGroupCreated} />
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

  .home-link {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-ui);
  }

  .home-link:hover {
    color: var(--accent-hi);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
    min-width: 1.6rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }

  .waiting-section {
    border-top: 1px solid var(--border);
    padding: 0.35rem 0;
  }

  .waiting-header {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    padding: 0.35rem 0.85rem 0.2rem;
  }

  .waiting-item {
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
  }

  .waiting-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .waiting-dot {
    font-size: 0.5rem;
    color: var(--accent-hi);
    flex-shrink: 0;
  }

  .waiting-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

Note: `.sidebar-list` gains `flex: 1` so it expands to fill available space and the GroupStrip sits at the bottom.

- [ ] **Step 2: Update Sidebar.test.ts to pass required new props**

In `tests/renderer/Sidebar.test.ts`:

Add to imports:
```ts
import type { ProjectGroupRecord } from '../../src/renderer/src/types'
```

Add to `describe('Sidebar', ...)` body, alongside the other `let` declarations:
```ts
  let onGroupSelect: ReturnType<typeof vi.fn>
  let onGroupCreated: ReturnType<typeof vi.fn>
```

In `beforeEach`, add:
```ts
    onGroupSelect = vi.fn()
    onGroupCreated = vi.fn()
    vi.stubGlobal('api', { createGroup: vi.fn() })
```

Add `afterEach`:
```ts
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
```

(The existing `afterEach(() => cleanup())` inside `describe('waiting section', ...)` stays as-is; this new one goes at the top-level `describe` scope.)

Update `baseProps` to include the new props:
```ts
  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      projects: [] as ProjectRecord[],
      selectedProjectId: null as number | null,
      groups: [] as ProjectGroupRecord[],
      activeGroupId: null as number | null,
      onProjectSelect,
      onRequestNewProject,
      onRequestSettings,
      onRequestHome,
      onWaitingWindowSelect,
      onGroupSelect,
      onGroupCreated,
      ...overrides
    }
  }
```

- [ ] **Step 3: Run Sidebar tests to confirm they pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/Sidebar.test.ts
```

Expected: all existing tests PASS (new props have defaults).

- [ ] **Step 4: Update App.svelte — add group state, filteredProjects, and new handlers**

In `src/renderer/src/App.svelte`:

Update the types import to include `ProjectGroupRecord`:
```ts
  import type { ProjectRecord, ProjectGroupRecord, TokenStatus, WindowRecord } from './types'
```

Add new state declarations after `let settingsRequiredFor`:
```ts
  let groups = $state<ProjectGroupRecord[]>([])
  let activeGroupId = $state<number | null>(null)
```

Add `filteredProjects` derived after the existing derived declarations at the bottom of the script:
```ts
  let filteredProjects = $derived(
    activeGroupId !== null ? projects.filter((p) => p.group_id === activeGroupId) : projects
  )
```

In `onMount`, replace the current sequential project/window loads with parallel loading that also fetches groups:
```ts
  onMount(async () => {
    ;[patStatus, claudeStatus] = await Promise.all([
      window.api.getGitHubPatStatus(),
      window.api.getClaudeTokenStatus()
    ])
    ;[projects, allWindows, groups] = await Promise.all([
      window.api.listProjects(),
      window.api.listWindows(),
      window.api.listGroups()
    ])
    window.api.onTerminalWaiting((info) => {
      waitingWindows.add(info)
      pushToast({ level: 'info', title: 'Claude is waiting', body: info.windowName })
    })
  })
```

Add new handlers after `handleWaitingWindowSelect`:
```ts
  function handleGroupSelect(id: number): void {
    activeGroupId = activeGroupId === id ? null : id
  }

  function handleGroupCreated(group: ProjectGroupRecord): void {
    groups = [...groups, group]
  }

  function handleProjectUpdated(project: ProjectRecord): void {
    projects = projects.map((p) => (p.id === project.id ? project : p))
  }
```

Update the `<Sidebar>` usage in the template:
```svelte
  <Sidebar
    projects={filteredProjects}
    {selectedProjectId}
    {groups}
    {activeGroupId}
    onProjectSelect={handleProjectSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestSettings={handleRequestSettings}
    onRequestHome={handleRequestHome}
    onWaitingWindowSelect={handleWaitingWindowSelect}
    onGroupSelect={handleGroupSelect}
    onGroupCreated={handleGroupCreated}
  />
```

Update the `<MainPane>` usage in the template to pass groups and onProjectUpdated:
```svelte
  <MainPane
    project={selectedProject}
    {windows}
    {allWindows}
    {projects}
    {selectedWindow}
    {view}
    {patStatus}
    {claudeStatus}
    {settingsRequiredFor}
    {groups}
    onWindowSelect={handleWindowSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestNewWindow={handleRequestNewWindow}
    onProjectCreated={handleProjectCreated}
    onWindowCreated={handleWindowCreated}
    onProjectDeleted={handleProjectDeleted}
    onWindowDeleted={handleWindowDeleted}
    onPatStatusChange={handlePatStatusChange}
    onClaudeStatusChange={handleClaudeStatusChange}
    onWizardCancel={handleWizardCancel}
    onNavigateToWindow={handleNavigateToWindow}
    onProjectUpdated={handleProjectUpdated}
  />
```

- [ ] **Step 5: Update MainPane.svelte to thread groups + onProjectUpdated to ProjectView**

In `src/renderer/src/components/MainPane.svelte`:

Add to the imports:
```ts
  import type { ProjectRecord, ProjectGroupRecord, TokenStatus, WindowRecord } from '../types'
```

Add to the `Props` interface:
```ts
    groups: ProjectGroupRecord[]
    onProjectUpdated: (project: ProjectRecord) => void
```

Add to the destructured props:
```ts
    groups,
    onProjectUpdated,
```

Update the `<ProjectView>` usage in the template:
```svelte
    <ProjectView
      {project}
      {windows}
      {groups}
      {onWindowSelect}
      {onRequestNewWindow}
      {onProjectDeleted}
      {onWindowDeleted}
      {onProjectUpdated}
    />
```

- [ ] **Step 6: Run renderer test suite**

```bash
cd window-manager && npm run test:renderer
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.svelte src/renderer/src/components/MainPane.svelte src/renderer/src/components/Sidebar.svelte tests/renderer/Sidebar.test.ts
git commit -m "feat: wire group state through App, Sidebar, and MainPane"
```

---

### Task 8: ProjectView group dropdown

**Files:**
- Modify: `src/renderer/src/components/ProjectView.svelte`
- Modify: `tests/renderer/ProjectView.test.ts`

- [ ] **Step 1: Write failing tests for group dropdown**

In `tests/renderer/ProjectView.test.ts`:

Add to the imports:
```ts
import type { ProjectGroupRecord } from '../../src/renderer/src/types'
```

Add a helper after `const mockWindow`:
```ts
function makeGroup(id: number, name: string): ProjectGroupRecord {
  return { id, name, created_at: '2026-01-01T00:00:00Z' }
}
```

In `beforeEach`, add `updateProject` to the api mock and add `vi.unstubAllGlobals()` to afterEach:
```ts
  beforeEach(() => {
    mockDeleteProject = vi.fn().mockResolvedValue(undefined)
    mockDeleteWindow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      deleteProject: mockDeleteProject,
      deleteWindow: mockDeleteWindow,
      updateProject: vi.fn().mockResolvedValue({ ...project, group_id: null })
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
```

Update all existing `render(ProjectView, {...})` calls to include the two new required props (`groups` and `onProjectUpdated`). A helper makes this clean — add after `makeGroup`:

```ts
function baseProjectViewProps(overrides: Record<string, unknown> = {}) {
  return {
    project,
    windows: [],
    groups: [] as ProjectGroupRecord[],
    onWindowSelect: vi.fn(),
    onRequestNewWindow: vi.fn(),
    onProjectDeleted: vi.fn(),
    onWindowDeleted: vi.fn(),
    onProjectUpdated: vi.fn(),
    ...overrides
  }
}
```

Update every existing `render(ProjectView, {...})` call to use `baseProjectViewProps(...)` instead of the inline object. For example:

```ts
// Before:
render(ProjectView, {
  project,
  windows: [],
  onWindowSelect: vi.fn(),
  onRequestNewWindow: vi.fn(),
  onProjectDeleted: vi.fn(),
  onWindowDeleted: vi.fn()
})

// After:
render(ProjectView, baseProjectViewProps())
```

Apply this pattern to all existing render calls in the file. For calls that override specific props (e.g. `onWindowSelect: onWindowSelectSpy`), pass them as the overrides argument.

Add new tests at the end of `describe('ProjectView', ...)`:

```ts
  describe('group assignment', () => {
    it('shows a group select with "No group" when no groups exist', () => {
      render(ProjectView, baseProjectViewProps())
      expect(screen.getByRole('combobox', { name: /group/i })).toBeDefined()
      expect(screen.getByText('No group')).toBeDefined()
    })

    it('renders group names as options', () => {
      render(ProjectView, baseProjectViewProps({
        groups: [makeGroup(1, 'Frontend'), makeGroup(2, 'Backend')]
      }))
      expect(screen.getByText('Frontend')).toBeDefined()
      expect(screen.getByText('Backend')).toBeDefined()
    })

    it('changing the group select calls api.updateProject', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ ...project, group_id: 1 })
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: mockUpdate
      })
      render(ProjectView, baseProjectViewProps({
        groups: [makeGroup(1, 'Frontend')]
      }))
      const select = screen.getByRole('combobox', { name: /group/i })
      await fireEvent.change(select, { target: { value: '1' } })
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(project.id, { groupId: 1 })
      })
    })

    it('changing to "No group" calls api.updateProject with null', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ ...project, group_id: null })
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: mockUpdate
      })
      const projectWithGroup = { ...project, group_id: 1 }
      render(ProjectView, baseProjectViewProps({
        project: projectWithGroup,
        groups: [makeGroup(1, 'Frontend')]
      }))
      const select = screen.getByRole('combobox', { name: /group/i })
      await fireEvent.change(select, { target: { value: '' } })
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(project.id, { groupId: null })
      })
    })
  })
```

- [ ] **Step 2: Run tests to confirm new tests fail and existing tests still pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectView.test.ts
```

Expected: new group tests FAIL; existing tests PASS (they now use `baseProjectViewProps` with default empty groups).

- [ ] **Step 3: Add groups prop and group dropdown to ProjectView.svelte**

In `src/renderer/src/components/ProjectView.svelte`:

Update the script block imports and props. Add `ProjectGroupRecord` to the type import:

```ts
  import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../types'
```

Add to the `Props` interface:
```ts
    groups: ProjectGroupRecord[]
    onProjectUpdated: (project: ProjectRecord) => void
```

Add to the destructured props:
```ts
    groups,
    onProjectUpdated
```

Add the group change handler function after `handleCancelDelete`:

```ts
  async function handleGroupChange(e: Event): Promise<void> {
    const val = (e.target as HTMLSelectElement).value
    const groupId = val === '' ? null : Number(val)
    const updated = await window.api.updateProject(project.id, { groupId })
    onProjectUpdated(updated)
  }
```

In the template, add the group `<select>` inside `.project-actions`, before the delete buttons:

```svelte
      <label class="group-label" for="project-group">Group</label>
      <select
        id="project-group"
        class="group-select"
        aria-label="group"
        value={project.group_id ?? ''}
        onchange={handleGroupChange}
      >
        <option value="">No group</option>
        {#each groups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
```

Add CSS for `.group-label` and `.group-select` in the `<style>` block:

```css
  .group-label {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--fg-2);
    align-self: center;
  }

  .group-select {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    background: var(--bg-1);
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .group-select:hover {
    border-color: var(--accent);
  }
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectView.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd window-manager && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ProjectView.svelte tests/renderer/ProjectView.test.ts
git commit -m "feat: add group assignment dropdown to ProjectView"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite one more time**

```bash
cd window-manager && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Verify no file exceeds 100 lines for functions or 1000 lines total**

```bash
cd window-manager && wc -l src/main/projectGroupService.ts src/main/db.ts src/renderer/src/components/GroupStrip.svelte src/renderer/src/components/Sidebar.svelte src/renderer/src/App.svelte
```

If any file exceeds 1000 lines, flag for review.
