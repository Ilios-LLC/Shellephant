# Project Environment Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project environment variables that are injected into every Docker container created under that project, managed via a project settings panel opened from a gear icon in the sidebar.

**Architecture:** Add `env_vars TEXT DEFAULT NULL` column to `projects` table (JSON-serialized `Record<string, string>`), expose two new IPC handlers (`project:get`, `project:update-env-vars`), inject vars into Docker `Env` array at window creation, and wire up a `ProjectSettingsView` modal triggered by a gear icon on each project row in the sidebar.

**Tech Stack:** TypeScript, Electron (main + preload + renderer), Svelte 5 (runes), better-sqlite3, Dockerode, Vitest, @testing-library/svelte

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `window-manager/src/main/db.ts` | Add `env_vars` column migration |
| Modify | `window-manager/src/main/projectService.ts` | Add `getProject`, `updateProjectEnvVars` |
| Modify | `window-manager/src/renderer/src/types.ts` | Add `env_vars` to `ProjectRecord`; add `getProject`, `updateProjectEnvVars` to `Api` |
| Modify | `window-manager/src/main/ipcHandlers.ts` | Register `project:get` and `project:update-env-vars` |
| Modify | `window-manager/src/preload/index.ts` | Expose new IPC calls via context bridge |
| Modify | `window-manager/src/main/windowService.ts` | Inject env vars into Docker container |
| Create | `window-manager/src/renderer/src/components/ProjectSettingsView.svelte` | Key-value env vars editor modal |
| Modify | `window-manager/src/renderer/src/components/ProjectItem.svelte` | Add gear icon button |
| Modify | `window-manager/src/renderer/src/components/Sidebar.svelte` | Forward `onProjectSettingsClick` prop |
| Modify | `window-manager/src/renderer/src/App.svelte` | Manage settings modal state; wire handlers |
| Modify | `window-manager/tests/main/db.test.ts` | Add `env_vars` column tests |
| Modify | `window-manager/tests/main/projectService.test.ts` | Add `getProject`/`updateProjectEnvVars` tests |
| Modify | `window-manager/tests/main/ipcHandlers.test.ts` | Add handler registration tests |
| Modify | `window-manager/tests/main/windowService.test.ts` | Add env vars injection test |
| Create | `window-manager/tests/renderer/ProjectSettingsView.test.ts` | Component tests |
| Modify | `window-manager/tests/renderer/ProjectItem.test.ts` | Add gear icon tests |

---

## Task 1: DB Migration — Add `env_vars` Column

**Files:**
- Modify: `window-manager/src/main/db.ts`
- Modify: `window-manager/tests/main/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `window-manager/tests/main/db.test.ts` inside the `describe('db')` block:

```ts
it('projects table has an env_vars column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('env_vars')
})
```

Add to `window-manager/tests/main/db.test.ts` inside the `describe('db migrations')` block:

```ts
it('adds env_vars column to a projects table that lacks it', async () => {
  const Database = (await import('better-sqlite3')).default
  const path = await import('path')
  const os = await import('os')
  const fs = await import('fs')

  const tmpPath = path.join(os.tmpdir(), `cw-db-envvars-${Date.now()}.sqlite`)
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
      group_id   INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  pre.close()

  initDb(tmpPath)
  const migrated = getDb()
  const cols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('env_vars')

  closeDb()
  fs.rmSync(tmpPath, { force: true })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: 2 failures — `env_vars` column not found.

- [ ] **Step 3: Add the migration to `db.ts`**

In `window-manager/src/main/db.ts`, add the column to the `CREATE TABLE projects` statement and add the migration check. Add `env_vars TEXT DEFAULT NULL` to the CREATE TABLE:

```ts
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      ports      TEXT DEFAULT NULL,
      env_vars   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
```

After the existing `group_id` migration block (around line 66), add:

```ts
  // Migrate: add env_vars column for databases created before this feature
  const projEnvCols = _db.pragma('table_info(projects)') as { name: string }[]
  if (!projEnvCols.some((c) => c.name === 'env_vars')) {
    _db.exec('ALTER TABLE projects ADD COLUMN env_vars TEXT DEFAULT NULL')
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add env_vars column to projects table with migration"
```

---

## Task 2: Service Functions — `getProject` and `updateProjectEnvVars`

**Files:**
- Modify: `window-manager/src/main/projectService.ts`
- Modify: `window-manager/tests/main/projectService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('projectService')` block in `window-manager/tests/main/projectService.test.ts`:

```ts
describe('getProject', () => {
  it('returns the project record by id', async () => {
    const created = await createProject('my-project', 'git@github.com:org/repo.git')
    const found = getProject(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('my-project')
  })

  it('returns undefined when project does not exist', () => {
    expect(getProject(99999)).toBeUndefined()
  })

  it('returns undefined for soft-deleted project', async () => {
    const created = await createProject('to-delete', 'git@github.com:org/repo.git')
    await deleteProject(created.id)
    expect(getProject(created.id)).toBeUndefined()
  })

  it('includes env_vars field in returned record', async () => {
    const created = await createProject('env-project', 'git@github.com:org/env.git')
    const found = getProject(created.id)
    expect('env_vars' in found!).toBe(true)
  })
})

describe('updateProjectEnvVars', () => {
  it('saves env vars as JSON and returns them on next getProject', async () => {
    const created = await createProject('my-project', 'git@github.com:org/repo.git')
    updateProjectEnvVars(created.id, { FOO: 'bar', BAZ: 'qux' })
    const found = getProject(created.id)
    expect(found!.env_vars).toBe(JSON.stringify({ FOO: 'bar', BAZ: 'qux' }))
  })

  it('overwrites existing env vars', async () => {
    const created = await createProject('my-project', 'git@github.com:org/repo.git')
    updateProjectEnvVars(created.id, { FIRST: '1' })
    updateProjectEnvVars(created.id, { SECOND: '2' })
    const found = getProject(created.id)
    expect(found!.env_vars).toBe(JSON.stringify({ SECOND: '2' }))
  })

  it('clears env vars when empty object passed', async () => {
    const created = await createProject('my-project', 'git@github.com:org/repo.git')
    updateProjectEnvVars(created.id, { FOO: 'bar' })
    updateProjectEnvVars(created.id, {})
    const found = getProject(created.id)
    expect(found!.env_vars).toBe(JSON.stringify({}))
  })
})
```

Add the import at the top of the test file (update the existing import line):

```ts
import {
  createProject,
  listProjects,
  deleteProject,
  updateProject,
  getProject,
  updateProjectEnvVars
} from '../../src/main/projectService'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/projectService.test.ts 2>&1 | tail -20
```

Expected: failures — `getProject` and `updateProjectEnvVars` not exported.

- [ ] **Step 3: Add functions to `projectService.ts`**

Add `env_vars` to the `ProjectRecord` interface in `projectService.ts`:

```ts
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  env_vars?: string | null
  group_id?: number | null
  created_at: string
}
```

Update `listProjects` SELECT to include `env_vars`:

```ts
export function listProjects(): ProjectRecord[] {
  return getDb()
    .prepare(
      'SELECT id, name, git_url, ports, env_vars, group_id, created_at FROM projects WHERE deleted_at IS NULL'
    )
    .all() as ProjectRecord[]
}
```

Update `updateProject` SELECT to include `env_vars`:

```ts
  const record = db
    .prepare(
      'SELECT id, name, git_url, ports, env_vars, group_id, created_at FROM projects WHERE id = ? AND deleted_at IS NULL'
    )
    .get(id) as ProjectRecord | undefined
```

Add the two new functions at the end of `projectService.ts`:

```ts
export function getProject(id: number): ProjectRecord | undefined {
  return getDb()
    .prepare(
      'SELECT id, name, git_url, ports, env_vars, group_id, created_at FROM projects WHERE id = ? AND deleted_at IS NULL'
    )
    .get(id) as ProjectRecord | undefined
}

export function updateProjectEnvVars(id: number, envVars: Record<string, string>): void {
  getDb()
    .prepare('UPDATE projects SET env_vars = ? WHERE id = ? AND deleted_at IS NULL')
    .run(JSON.stringify(envVars), id)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/projectService.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/projectService.ts tests/main/projectService.test.ts
git commit -m "feat: add getProject and updateProjectEnvVars to projectService"
```

---

## Task 3: Update Shared Types

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`

No separate tests — type changes are validated by TypeScript compilation and downstream tests.

- [ ] **Step 1: Add `env_vars` to `ProjectRecord` in `types.ts`**

In `window-manager/src/renderer/src/types.ts`, update the `ProjectRecord` interface:

```ts
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  env_vars?: string | null
  group_id?: number | null
  created_at: string
}
```

- [ ] **Step 2: Add `getProject` and `updateProjectEnvVars` to the `Api` interface**

In the `// Projects` section of the `Api` interface:

```ts
  // Projects
  createProject: (name: string, gitUrl: string, ports?: PortMapping[]) => Promise<ProjectRecord>
  listProjects: () => Promise<ProjectRecord[]>
  deleteProject: (id: number) => Promise<void>
  updateProject: (id: number, patch: { groupId: number | null }) => Promise<ProjectRecord>
  getProject: (id: number) => Promise<ProjectRecord | undefined>
  updateProjectEnvVars: (id: number, envVars: Record<string, string>) => Promise<void>
  createGroup: (name: string) => Promise<ProjectGroupRecord>
  listGroups: () => Promise<ProjectGroupRecord[]>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd window-manager && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd window-manager && git add src/renderer/src/types.ts
git commit -m "feat: add env_vars to ProjectRecord type and Api interface"
```

---

## Task 4: IPC Handlers + Preload Wiring

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Write the failing tests**

In `window-manager/tests/main/ipcHandlers.test.ts`, update the projectService mock to include the new functions:

```ts
vi.mock('../../src/main/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  getProject: vi.fn(),
  updateProjectEnvVars: vi.fn()
}))
```

Update the import line in the test file:

```ts
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars } from '../../src/main/projectService'
```

Add tests inside the `describe('registerIpcHandlers')` block:

```ts
it('registers project:get handler that calls getProject', async () => {
  const record = {
    id: 1,
    name: 'test',
    git_url: 'git@github.com:org/repo.git',
    created_at: '2026-01-01',
    env_vars: null
  }
  vi.mocked(getProject).mockReturnValue(record)
  const result = await getHandler('project:get')({}, 1)
  expect(getProject).toHaveBeenCalledWith(1)
  expect(result).toEqual(record)
})

it('registers project:update-env-vars handler that calls updateProjectEnvVars', async () => {
  vi.mocked(updateProjectEnvVars).mockReturnValue(undefined)
  await getHandler('project:update-env-vars')({}, 1, { FOO: 'bar' })
  expect(updateProjectEnvVars).toHaveBeenCalledWith(1, { FOO: 'bar' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts 2>&1 | tail -20
```

Expected: 2 failures — handlers not registered yet.

- [ ] **Step 3: Register handlers in `ipcHandlers.ts`**

Update the import at the top of `ipcHandlers.ts`:

```ts
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars, type PortMapping } from './projectService'
```

Add two handlers in the project handlers section:

```ts
  ipcMain.handle('project:get', (_, id: number) => getProject(id))
  ipcMain.handle('project:update-env-vars', (_, id: number, envVars: Record<string, string>) =>
    updateProjectEnvVars(id, envVars)
  )
```

- [ ] **Step 4: Add to preload `index.ts`**

In `window-manager/src/preload/index.ts`, add to the Project API section:

```ts
  getProject: (id: number) => ipcRenderer.invoke('project:get', id),
  updateProjectEnvVars: (id: number, envVars: Record<string, string>) =>
    ipcRenderer.invoke('project:update-env-vars', id, envVars),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/main/ipcHandlers.ts src/preload/index.ts tests/main/ipcHandlers.test.ts
git commit -m "feat: register project:get and project:update-env-vars IPC handlers"
```

---

## Task 5: Inject Env Vars in `windowService`

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write the failing test**

In `window-manager/tests/main/windowService.test.ts`, update `seedProject` to accept `envVars`:

```ts
function seedProject(gitUrl: string, name = 'test', ports?: PortMapping[], envVars?: Record<string, string>): number {
  const result = getDb()
    .prepare('INSERT INTO projects (name, git_url, ports, env_vars) VALUES (?, ?, ?, ?)')
    .run(name, gitUrl, ports ? JSON.stringify(ports) : null, envVars ? JSON.stringify(envVars) : null)
  return result.lastInsertRowid as number
}
```

Add test inside `describe('createWindow')`:

```ts
it('injects project env vars into container Env array', async () => {
  const projectId = seedProject(
    'git@github.com:org/env-repo.git',
    'env-test',
    undefined,
    { MY_VAR: 'hello', ANOTHER: 'world' }
  )
  await createWindow('test', projectId)
  expect(mockCreateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      Env: expect.arrayContaining([
        'CLAUDE_CODE_OAUTH_TOKEN=claude-oauth-token',
        'MY_VAR=hello',
        'ANOTHER=world'
      ])
    })
  )
})

it('creates container with only CLAUDE_CODE_OAUTH_TOKEN when no env vars set', async () => {
  const projectId = seedProject('git@github.com:org/no-env.git')
  await createWindow('test', projectId)
  expect(mockCreateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      Env: ['CLAUDE_CODE_OAUTH_TOKEN=claude-oauth-token']
    })
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/main/windowService.test.ts 2>&1 | tail -20
```

Expected: new tests fail — env vars not injected yet.

- [ ] **Step 3: Update `windowService.ts` to read and inject env vars**

Update the DB query in `createWindow` to also fetch `env_vars`:

```ts
  const project = db
    .prepare('SELECT git_url, ports, env_vars FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string; ports: string | null; env_vars: string | null } | undefined
```

Build the env var array before `createContainer`:

```ts
  const projectEnvVars: string[] = project.env_vars
    ? Object.entries(JSON.parse(project.env_vars) as Record<string, string>).map(
        ([k, v]) => `${k}=${v}`
      )
    : []
```

Update the `createContainer` call to spread `projectEnvVars`:

```ts
    container = await getDocker().createContainer({
      Image: 'cc',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`, ...projectEnvVars],
      ...(projectPorts.length > 0 && {
        ExposedPorts: exposedPorts,
        HostConfig: { PortBindings: portBindings }
      })
    })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/main/windowService.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/main/windowService.ts tests/main/windowService.test.ts
git commit -m "feat: inject project env vars into Docker container at window creation"
```

---

## Task 6: `ProjectSettingsView` Component

**Files:**
- Create: `window-manager/src/renderer/src/components/ProjectSettingsView.svelte`
- Create: `window-manager/tests/renderer/ProjectSettingsView.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/ProjectSettingsView.test.ts`:

```ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSettingsView from '../../src/renderer/src/components/ProjectSettingsView.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z',
  env_vars: null
}

const projectWithVars: ProjectRecord = {
  ...project,
  env_vars: JSON.stringify({ FOO: 'bar', BAZ: 'qux' })
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
}

describe('ProjectSettingsView', () => {
  let mockGetProject: ReturnType<typeof vi.fn>
  let mockUpdateEnvVars: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetProject = vi.fn().mockResolvedValue(project)
    mockUpdateEnvVars = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      getProject: mockGetProject,
      updateProjectEnvVars: mockUpdateEnvVars
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the project name in the header', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => expect(screen.getByText(/my-project/i)).toBeDefined())
  })

  it('renders Environment Variables section heading', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => expect(screen.getByText(/environment variables/i)).toBeDefined())
  })

  it('loads existing env vars from the project prop', async () => {
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars }))
    await waitFor(() => {
      expect(screen.getByDisplayValue('FOO')).toBeDefined()
      expect(screen.getByDisplayValue('bar')).toBeDefined()
    })
  })

  it('Add Variable button appends an empty row', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /add variable/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add variable/i }))
    const keyInputs = screen.getAllByPlaceholderText(/key/i)
    expect(keyInputs.length).toBeGreaterThanOrEqual(1)
  })

  it('remove button deletes a row', async () => {
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars }))
    await waitFor(() => screen.getAllByRole('button', { name: /remove/i }))
    const removeBtns = screen.getAllByRole('button', { name: /remove/i })
    await fireEvent.click(removeBtns[0])
    // FOO row removed, BAZ row remains
    await waitFor(() => {
      expect(screen.queryByDisplayValue('FOO')).toBeNull()
      expect(screen.getByDisplayValue('BAZ')).toBeDefined()
    })
  })

  it('Save calls updateProjectEnvVars with non-empty key rows and fires onSave', async () => {
    const onSave = vi.fn()
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars, onSave }))
    await waitFor(() => screen.getByRole('button', { name: /save/i }))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdateEnvVars).toHaveBeenCalledWith(1, { FOO: 'bar', BAZ: 'qux' })
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('Cancel fires onCancel without saving', async () => {
    const onCancel = vi.fn()
    render(ProjectSettingsView, baseProps({ onCancel }))
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockUpdateEnvVars).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('rows with empty key are excluded from save', async () => {
    const onSave = vi.fn()
    render(ProjectSettingsView, baseProps({ onSave }))
    await waitFor(() => screen.getByRole('button', { name: /add variable/i }))
    // Add a row but leave key empty
    await fireEvent.click(screen.getByRole('button', { name: /add variable/i }))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdateEnvVars).toHaveBeenCalledWith(1, {})
      expect(onSave).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectSettingsView.test.ts 2>&1 | tail -20
```

Expected: failures — component does not exist.

- [ ] **Step 3: Create `ProjectSettingsView.svelte`**

Create `window-manager/src/renderer/src/components/ProjectSettingsView.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord } from '../types'

  interface EnvRow {
    key: string
    value: string
  }

  interface Props {
    project: ProjectRecord
    onSave: () => void
    onCancel: () => void
  }

  let { project, onSave, onCancel }: Props = $props()

  let rows = $state<EnvRow[]>([])
  let busy = $state(false)
  let error = $state('')

  onMount(async () => {
    const record = await window.api.getProject(project.id)
    if (record?.env_vars) {
      const parsed = JSON.parse(record.env_vars) as Record<string, string>
      rows = Object.entries(parsed).map(([key, value]) => ({ key, value }))
    }
  })

  function addRow(): void {
    rows = [...rows, { key: '', value: '' }]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const envVars: Record<string, string> = {}
      for (const row of rows) {
        if (row.key.trim()) envVars[row.key.trim()] = row.value
      }
      await window.api.updateProjectEnvVars(project.id, envVars)
      onSave()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Project Settings">
  <div class="modal-card">
    <header class="modal-header">
      <h2>Project Settings — {project.name}</h2>
    </header>

    <section class="section">
      <div class="section-title">Environment Variables</div>
      <div class="env-table">
        {#each rows as row, i (i)}
          <div class="env-row">
            <input
              type="text"
              placeholder="KEY"
              bind:value={row.key}
              disabled={busy}
              aria-label="key"
            />
            <span class="eq">=</span>
            <input
              type="text"
              placeholder="value"
              bind:value={row.value}
              disabled={busy}
              aria-label="value"
            />
            <button
              type="button"
              class="remove-btn"
              aria-label="remove"
              onclick={() => removeRow(i)}
              disabled={busy}
            >×</button>
          </div>
        {/each}
      </div>
      <button type="button" class="add-btn" onclick={addRow} disabled={busy}>
        + Add Variable
      </button>
    </section>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" class="submit" onclick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-card {
    width: 100%;
    max-width: 540px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-header h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  .env-table {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .env-row input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    outline: none;
    min-width: 0;
  }

  .env-row input:focus {
    border-color: var(--accent);
  }

  .eq {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .remove-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-2);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .remove-btn:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
  }

  .add-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.3rem 0.65rem;
    cursor: pointer;
    margin-top: 0.15rem;
  }

  .add-btn:hover:not(:disabled) {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .cancel,
  .submit {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
  }

  .cancel {
    background: transparent;
    color: var(--fg-1);
  }

  .cancel:hover:not(:disabled) {
    color: var(--fg-0);
    border-color: var(--fg-1);
  }

  .submit {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .submit:hover:not(:disabled) {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .cancel:disabled,
  .submit:disabled,
  .remove-btn:disabled,
  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectSettingsView.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/renderer/src/components/ProjectSettingsView.svelte tests/renderer/ProjectSettingsView.test.ts
git commit -m "feat: add ProjectSettingsView component with env vars key-value editor"
```

---

## Task 7: `ProjectItem` Gear Icon

**Files:**
- Modify: `window-manager/src/renderer/src/components/ProjectItem.svelte`
- Modify: `window-manager/tests/renderer/ProjectItem.test.ts`

- [ ] **Step 1: Write the failing tests**

First, update all existing `render(ProjectItem, ...)` calls in `window-manager/tests/renderer/ProjectItem.test.ts` to include `onSettingsClick: vi.fn()` so they keep passing after the prop is added:

```ts
// Update all four existing render calls like this:
render(ProjectItem, { project, selected: false, onSelect: vi.fn(), onSettingsClick: vi.fn() })
```

Then add the three new tests:

```ts
it('renders a gear icon button', () => {
  render(ProjectItem, { project, selected: false, onSelect: vi.fn(), onSettingsClick: vi.fn() })
  expect(screen.getByRole('button', { name: /project settings/i })).toBeDefined()
})

it('calls onSettingsClick with project when gear icon clicked', async () => {
  const onSettingsClick = vi.fn()
  render(ProjectItem, { project, selected: false, onSelect: vi.fn(), onSettingsClick })
  await fireEvent.click(screen.getByRole('button', { name: /project settings/i }))
  expect(onSettingsClick).toHaveBeenCalledWith(project)
})

it('gear icon click does not also call onSelect', async () => {
  const onSelect = vi.fn()
  const onSettingsClick = vi.fn()
  render(ProjectItem, { project, selected: false, onSelect, onSettingsClick })
  await fireEvent.click(screen.getByRole('button', { name: /project settings/i }))
  expect(onSelect).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectItem.test.ts 2>&1 | tail -20
```

Expected: 3 new failures — gear button not present.

- [ ] **Step 3: Update `ProjectItem.svelte`**

Replace the full content of `window-manager/src/renderer/src/components/ProjectItem.svelte`:

```svelte
<!-- src/renderer/src/components/ProjectItem.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    project: ProjectRecord
    selected: boolean
    onSelect: (project: ProjectRecord) => void
    onSettingsClick: (project: ProjectRecord) => void
  }

  let { project, selected, onSelect, onSettingsClick }: Props = $props()

  function extractPath(gitUrl: string): string {
    const match = gitUrl.match(/^git@[^:]+:(.+?)(?:\.git)?$/)
    return match ? match[1] : gitUrl
  }

  function handleClick(): void {
    onSelect(project)
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') onSelect(project)
  }

  function handleGearClick(e: MouseEvent): void {
    e.stopPropagation()
    onSettingsClick(project)
  }
</script>

<div
  class="project-item"
  class:selected
  data-testid="project-item"
  role="button"
  tabindex="0"
  aria-label={`select ${project.name}`}
  onclick={handleClick}
  onkeydown={handleKey}
>
  <div class="info">
    <span class="name">{project.name}</span>
    <span class="url">{extractPath(project.git_url)}</span>
  </div>
  <button
    type="button"
    class="gear-btn"
    aria-label="project settings"
    title="Project settings"
    onclick={handleGearClick}
  >
    <svg
      width="12"
      height="12"
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
</div>

<style>
  .project-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--fg-1);
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .project-item:hover {
    background: var(--bg-1);
    color: var(--fg-0);
  }

  .project-item.selected {
    background: var(--bg-2);
    color: var(--fg-0);
    border-left-color: var(--accent);
  }

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

  .url {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 3px;
    opacity: 0;
    flex-shrink: 0;
  }

  .project-item:hover .gear-btn {
    opacity: 1;
  }

  .gear-btn:hover {
    color: var(--accent-hi);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectItem.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd window-manager && git add src/renderer/src/components/ProjectItem.svelte tests/renderer/ProjectItem.test.ts
git commit -m "feat: add gear icon to ProjectItem for project settings"
```

---

## Task 8: Wire Up `Sidebar` and `App.svelte`

**Files:**
- Modify: `window-manager/src/renderer/src/components/Sidebar.svelte`
- Modify: `window-manager/src/renderer/src/App.svelte`

No additional tests required for this wiring task — `ProjectItem`, `ProjectSettingsView`, `Sidebar` are each tested in isolation, and App-level integration is covered by the existing test suite.

- [ ] **Step 1: Update `Sidebar.test.ts` to include the new prop in `baseProps`**

In `window-manager/tests/renderer/Sidebar.test.ts`, add `onProjectSettingsClick: vi.fn()` to the `baseProps()` function and to the `beforeEach` declarations:

```ts
  let onProjectSettingsClick: ReturnType<typeof vi.fn>
  // (alongside the other vi.fn() declarations)
```

In `beforeEach`:
```ts
    onProjectSettingsClick = vi.fn()
```

In `baseProps()`:
```ts
      onProjectSettingsClick,
      // (alongside the other props)
```

- [ ] **Step 2: Update `Sidebar.svelte` to forward the settings click prop**

In `window-manager/src/renderer/src/components/Sidebar.svelte`, add `onProjectSettingsClick` to the `Props` interface and destructuring:

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
    onProjectSettingsClick: (project: ProjectRecord) => void
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
    onProjectSettingsClick,
    onRequestNewProject,
    onRequestSettings,
    onRequestHome,
    onWaitingWindowSelect,
    onGroupSelect,
    onGroupCreated
  }: Props = $props()
</script>
```

In the template, update each `<ProjectItem>` call to pass the new prop:

```svelte
    {#each projects as project (project.id)}
      <ProjectItem
        {project}
        selected={project.id === selectedProjectId}
        onSelect={onProjectSelect}
        onSettingsClick={onProjectSettingsClick}
      />
    {/each}
```

- [ ] **Step 3: Update `App.svelte` to manage the settings modal**

In `window-manager/src/renderer/src/App.svelte`, add the import and state:

In the `<script>` imports, add:
```ts
  import ProjectSettingsView from './components/ProjectSettingsView.svelte'
```

After the existing `$state` declarations, add:
```ts
  let settingsProject = $state<ProjectRecord | null>(null)
```

Add the handler function after `handleProjectUpdated`:
```ts
  function handleProjectSettingsClick(project: ProjectRecord): void {
    settingsProject = project
  }

  function handleProjectSettingsSave(): void {
    settingsProject = null
  }

  function handleProjectSettingsCancel(): void {
    settingsProject = null
  }
```

In the template, pass `onProjectSettingsClick` to `<Sidebar>`:

```svelte
  <Sidebar
    projects={filteredProjects}
    {selectedProjectId}
    {groups}
    {activeGroupId}
    onProjectSelect={handleProjectSelect}
    onProjectSettingsClick={handleProjectSettingsClick}
    onRequestNewProject={handleRequestNewProject}
    onRequestSettings={handleRequestSettings}
    onRequestHome={handleRequestHome}
    onWaitingWindowSelect={handleWaitingWindowSelect}
    onGroupSelect={handleGroupSelect}
    onGroupCreated={handleGroupCreated}
  />
```

After the `<MainPane>` closing tag, add the modal:

```svelte
  {#if settingsProject}
    <ProjectSettingsView
      project={settingsProject}
      onSave={handleProjectSettingsSave}
      onCancel={handleProjectSettingsCancel}
    />
  {/if}
```

- [ ] **Step 4: Run the full test suite**

```bash
cd window-manager && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass with no regressions.

- [ ] **Step 5: Check TypeScript**

```bash
cd window-manager && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd window-manager && git add src/renderer/src/components/Sidebar.svelte src/renderer/src/App.svelte
git commit -m "feat: wire up project settings modal in Sidebar and App"
```
