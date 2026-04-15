# Claude Inject Button + Port Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Claude" button to `WindowDetailPane` that injects `claude --dangerously-skip-permissions` into the active terminal, and allow projects to specify container ports that get mapped to ephemeral host ports when windows are created.

**Architecture:** Port configuration lives on the `projects` table as a JSON array of ints. `windowService.createWindow()` reads those ports, builds `ExposedPorts`/`PortBindings` for Docker, inspects the container after start to get assigned host ports, and stores the mapping on the `windows` record. `WindowDetailPane` reads `window.ports` for display. The Claude inject button calls the existing `sendTerminalInput` API directly from the component — no new IPC surface needed.

**Tech Stack:** Electron + Svelte 5 + Dockerode + better-sqlite3 + Vitest + @testing-library/svelte

---

## File Map

**Modified — backend:**
- `window-manager/src/main/db.ts` — add `ports TEXT DEFAULT NULL` to both tables; ALTER TABLE migrations for existing DBs
- `window-manager/src/main/projectService.ts` — `ProjectRecord` interface; `createProject` accepts `ports?: number[]`; `listProjects` SELECT includes `ports`
- `window-manager/src/main/windowService.ts` — `WindowRecord` interface; `createWindow` builds port config, inspects after start, stores mapping; `listWindows` SELECT includes `ports`
- `window-manager/src/main/ipcHandlers.ts` — `project:create` handler passes `ports` to service
- `window-manager/src/preload/index.ts` — `createProject` binding passes `ports`

**Modified — frontend:**
- `window-manager/src/renderer/src/types.ts` — `ports?: string` on `ProjectRecord`, `WindowRecord`; `Api.createProject` signature
- `window-manager/src/renderer/src/components/NewProjectWizard.svelte` — ports text input
- `window-manager/src/renderer/src/components/WindowDetailPane.svelte` — Claude button; port mapping display

**Modified — tests:**
- `window-manager/tests/main/db.test.ts`
- `window-manager/tests/main/projectService.test.ts`
- `window-manager/tests/main/windowService.test.ts`
- `window-manager/tests/renderer/NewProjectWizard.test.ts`
- `window-manager/tests/renderer/WindowDetailPane.test.ts`

---

## Task 1: DB migration — add ports columns

**Files:**
- Modify: `window-manager/src/main/db.ts`
- Test: `window-manager/tests/main/db.test.ts`

- [ ] **Step 1: Write failing tests**

Add inside the `'db'` describe block in `db.test.ts`, after the existing column tests:

```typescript
it('projects table has a ports column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('ports')
})

it('windows table has a ports column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
  expect(cols.map((c) => c.name)).toContain('ports')
})
```

Also add inside the `'db migrations'` describe block:

```typescript
it('adds ports column to projects and windows tables that lack it', async () => {
  const Database = (await import('better-sqlite3')).default
  const path = await import('path')
  const os = await import('os')
  const fs = await import('fs')

  const tmpPath = path.join(os.tmpdir(), `cw-db-ports-${Date.now()}.sqlite`)
  const pre = new Database(tmpPath)
  pre.exec(`
    CREATE TABLE projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  pre.exec(`
    CREATE TABLE windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      project_id   INTEGER NOT NULL,
      container_id TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at   DATETIME DEFAULT NULL
    )
  `)
  pre.close()

  initDb(tmpPath)
  const migrated = getDb()
  const projCols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  const winCols = migrated.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
  expect(projCols.map((c) => c.name)).toContain('ports')
  expect(winCols.map((c) => c.name)).toContain('ports')

  closeDb()
  fs.rmSync(tmpPath, { force: true })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: FAIL — "Expected array to contain 'ports'"

- [ ] **Step 3: Implement migration in `db.ts`**

Replace the entire `initDb` function with:

```typescript
export function initDb(dbPath: string): void {
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      ports      TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  // Migrate: add ports column for databases created before this feature
  const projCols = _db.pragma('table_info(projects)') as { name: string }[]
  if (!projCols.some((c) => c.name === 'ports')) {
    _db.exec('ALTER TABLE projects ADD COLUMN ports TEXT DEFAULT NULL')
  }

  // Pre-project windows tables lack project_id. Drop so the CREATE below
  // applies the current schema. Containers are ephemeral so data loss is fine.
  const winCols = _db.pragma('table_info(windows)') as { name: string }[]
  if (winCols.length > 0 && !winCols.some((c) => c.name === 'project_id')) {
    _db.exec('DROP TABLE windows')
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      project_id   INTEGER NOT NULL REFERENCES projects(id),
      container_id TEXT NOT NULL,
      ports        TEXT DEFAULT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at   DATETIME DEFAULT NULL
    )
  `)
  // Migrate: add ports column for databases created before this feature
  const winPortCols = _db.pragma('table_info(windows)') as { name: string }[]
  if (!winPortCols.some((c) => c.name === 'ports')) {
    _db.exec('ALTER TABLE windows ADD COLUMN ports TEXT DEFAULT NULL')
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      BLOB NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: PASS (all db tests)

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/db.ts window-manager/tests/main/db.test.ts && git commit -m "feat: add ports columns to projects and windows tables"
```

---

## Task 2: Update type definitions and wiring

No tests for pure type changes — downstream tasks verify them. These changes are all mechanical — update every interface and every SELECT/IPC binding that touches project or window records.

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/src/main/projectService.ts` (interface + `listProjects` query)
- Modify: `window-manager/src/main/windowService.ts` (interface + `listWindows` query)
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/main/ipcHandlers.ts`

- [ ] **Step 1: Update `renderer/src/types.ts`**

Change `ProjectRecord`:
```typescript
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  created_at: string
}
```

Change `WindowRecord`:
```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  created_at: string
  status: WindowStatus
}
```

Change `Api.createProject` signature:
```typescript
createProject: (name: string, gitUrl: string, ports?: number[]) => Promise<ProjectRecord>
```

- [ ] **Step 2: Update `projectService.ts` — interface and `listProjects`**

Change the `ProjectRecord` interface (lines 7–12):
```typescript
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  created_at: string
}
```

Change the `listProjects` SELECT (line 69):
```typescript
'SELECT id, name, git_url, ports, created_at FROM projects WHERE deleted_at IS NULL'
```

- [ ] **Step 3: Update `windowService.ts` — interface and `listWindows`**

Change the `WindowRecord` interface (lines 10–19):
```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  created_at: string
  status: WindowStatus
}
```

Change the `listWindows` query string (line 132):
```typescript
let query =
  'SELECT id, name, project_id, container_id, ports, created_at FROM windows WHERE deleted_at IS NULL'
```

- [ ] **Step 4: Update `preload/index.ts` — `createProject` binding**

Change line 5–6:
```typescript
createProject: (name: string, gitUrl: string, ports?: number[]) =>
  ipcRenderer.invoke('project:create', name, gitUrl, ports),
```

- [ ] **Step 5: Update `ipcHandlers.ts` — `project:create` handler**

Change line 46:
```typescript
ipcMain.handle('project:create', (_, name: string, gitUrl: string, ports?: number[]) =>
  createProject(name, gitUrl, ports)
)
```

- [ ] **Step 6: Run full test suite to verify no regressions**

```bash
cd /workspace/claude-window/window-manager && npm test
```

Expected: PASS (all existing tests)

- [ ] **Step 7: Commit**

```bash
cd /workspace/claude-window && git add \
  window-manager/src/renderer/src/types.ts \
  window-manager/src/main/projectService.ts \
  window-manager/src/main/windowService.ts \
  window-manager/src/preload/index.ts \
  window-manager/src/main/ipcHandlers.ts && \
git commit -m "feat: add ports field to ProjectRecord, WindowRecord, Api, and IPC wiring"
```

---

## Task 3: projectService — accept, validate, and store ports

**Files:**
- Modify: `window-manager/src/main/projectService.ts`
- Test: `window-manager/tests/main/projectService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `projectService.test.ts` inside the `'createProject'` describe block:

```typescript
it('stores ports when provided', async () => {
  const result = await createProject('with-ports', 'git@github.com:org/repo2.git', [3000, 8080])
  expect(result.ports).toBe(JSON.stringify([3000, 8080]))
})

it('stores no ports when omitted', async () => {
  const result = await createProject('no-ports', 'git@github.com:org/repo3.git')
  expect(result.ports).toBeUndefined()
})

it('rejects port value 0', async () => {
  await expect(
    createProject('bad-ports', 'git@github.com:org/repo4.git', [0])
  ).rejects.toThrow(/Invalid port/)
})

it('rejects port value 65536', async () => {
  await expect(
    createProject('bad-ports2', 'git@github.com:org/repo5.git', [65536])
  ).rejects.toThrow(/Invalid port/)
})

it('rejects non-integer port value', async () => {
  await expect(
    createProject('bad-ports3', 'git@github.com:org/repo6.git', [NaN])
  ).rejects.toThrow(/Invalid port/)
})
```

Add inside the `'listProjects'` describe block:

```typescript
it('listProjects includes ports field', async () => {
  await createProject('list-ports', 'git@github.com:org/list-ports.git', [5432])
  const projects = listProjects()
  expect(projects[0].ports).toBe(JSON.stringify([5432]))
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: FAIL on the new tests

- [ ] **Step 3: Implement in `projectService.ts`**

Replace `createProject` (lines 28–65) with:

```typescript
export async function createProject(
  name: string,
  gitUrl: string,
  ports?: number[]
): Promise<ProjectRecord> {
  if (!isValidSshUrl(gitUrl)) {
    throw new Error('Invalid SSH URL format. Expected: git@host:org/repo.git')
  }

  if (ports && ports.length > 0) {
    for (const p of ports) {
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error(`Invalid port: ${p}. Must be integer between 1 and 65535.`)
      }
    }
  }

  const resolvedName = name.trim() || extractRepoName(gitUrl)

  const pat = getGitHubPat()
  if (!pat) {
    throw new Error('GitHub PAT not configured. Open Settings to add one.')
  }
  if (!getClaudeToken()) {
    throw new Error('Claude token not configured. Open Settings to add one.')
  }
  await verifyRemote(sshUrlToHttps(gitUrl, pat))

  const portsJson = ports && ports.length > 0 ? JSON.stringify(ports) : null
  const db = getDb()
  try {
    const result = db
      .prepare('INSERT INTO projects (name, git_url, ports) VALUES (?, ?, ?)')
      .run(resolvedName, gitUrl, portsJson)

    return {
      id: result.lastInsertRowid as number,
      name: resolvedName,
      git_url: gitUrl,
      ports: portsJson ?? undefined,
      created_at: new Date().toISOString()
    }
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE constraint failed')) {
      throw new Error('Project already exists for this git URL')
    }
    throw err
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: PASS (all projectService tests)

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/projectService.ts window-manager/tests/main/projectService.test.ts && git commit -m "feat: projectService accepts and validates port configuration"
```

---

## Task 4: NewProjectWizard — ports input field

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewProjectWizard.svelte`
- Test: `window-manager/tests/renderer/NewProjectWizard.test.ts`

- [ ] **Step 1: Update existing test that will break**

The existing test `'calls api.createProject with name and git url, then fires onCreated'` asserts `toHaveBeenCalledWith('alpha', 'git@github.com:org/alpha.git')`. After adding the ports field, the call becomes `(..., undefined)`. Update the assertion:

```typescript
expect(mockCreateProject).toHaveBeenCalledWith('alpha', 'git@github.com:org/alpha.git', undefined)
```

- [ ] **Step 2: Write new failing tests**

Add to `NewProjectWizard.test.ts`:

```typescript
it('renders a ports input field', () => {
  render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })
  expect(screen.getByPlaceholderText('3000, 8080')).toBeInTheDocument()
})

it('passes parsed ports to createProject when ports field is filled', async () => {
  const onCreated = vi.fn()
  render(NewProjectWizard, { onCreated, onCancel: vi.fn() })

  await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
    target: { value: 'git@github.com:org/alpha.git' }
  })
  await fireEvent.input(screen.getByPlaceholderText('3000, 8080'), {
    target: { value: '3000, 8080' }
  })
  await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

  await waitFor(() => {
    expect(mockCreateProject).toHaveBeenCalledWith(
      '',
      'git@github.com:org/alpha.git',
      [3000, 8080]
    )
  })
})

it('passes undefined ports when ports field is empty', async () => {
  render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })

  await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
    target: { value: 'git@github.com:org/alpha.git' }
  })
  await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

  await waitFor(() => {
    expect(mockCreateProject).toHaveBeenCalledWith(
      '',
      'git@github.com:org/alpha.git',
      undefined
    )
  })
})
```

- [ ] **Step 3: Run tests — verify new tests fail (and existing updated test still works)**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewProjectWizard.test.ts
```

Expected: FAIL on the three new tests; existing tests should pass with the updated assertion

- [ ] **Step 4: Implement in `NewProjectWizard.svelte`**

Add `let ports = $state('')` after `let error = $state('')` in the script block.

Add the ports field in the form after the project-name field (before the `{#if error}` block):

```svelte
<div class="field">
  <label for="ports">Ports <span class="muted">(optional)</span></label>
  <input
    id="ports"
    type="text"
    placeholder="3000, 8080"
    bind:value={ports}
    disabled={loading}
    onkeydown={handleKey}
  />
</div>
```

Replace `handleSubmit` with:

```typescript
async function handleSubmit(): Promise<void> {
  const trimmedUrl = gitUrl.trim()
  if (!trimmedUrl || loading) return
  loading = true
  error = ''
  try {
    const parsedPorts = ports
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n))

    const record = await window.api.createProject(
      name.trim(),
      trimmedUrl,
      parsedPorts.length > 0 ? parsedPorts : undefined
    )
    onCreated(record)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    loading = false
  }
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewProjectWizard.test.ts
```

Expected: PASS (all NewProjectWizard tests)

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/NewProjectWizard.svelte window-manager/tests/renderer/NewProjectWizard.test.ts && git commit -m "feat: add ports input to NewProjectWizard"
```

---

## Task 5: windowService — port binding, inspection, storage

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Test: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Update `seedProject` helper in test file**

Replace the `seedProject` function in `windowService.test.ts` with:

```typescript
function seedProject(gitUrl: string, name = 'test', ports?: number[]): number {
  const result = getDb()
    .prepare('INSERT INTO projects (name, git_url, ports) VALUES (?, ?, ?)')
    .run(name, gitUrl, ports ? JSON.stringify(ports) : null)
  return result.lastInsertRowid as number
}
```

- [ ] **Step 2: Write failing tests**

Add to `windowService.test.ts` inside the `'createWindow'` describe block:

```typescript
it('passes ExposedPorts and PortBindings when project has ports', async () => {
  const projectId = seedProject('git@github.com:org/ports-repo.git', 'ports', [3000, 8080])
  mockInspect.mockResolvedValueOnce({
    State: { Status: 'running' },
    NetworkSettings: {
      Ports: {
        '3000/tcp': [{ HostPort: '54321' }],
        '8080/tcp': [{ HostPort: '54322' }]
      }
    }
  })

  await createWindow('port-window', projectId)

  expect(mockCreateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      ExposedPorts: { '3000/tcp': {}, '8080/tcp': {} },
      HostConfig: {
        PortBindings: {
          '3000/tcp': [{ HostPort: '' }],
          '8080/tcp': [{ HostPort: '' }]
        }
      }
    })
  )
})

it('stores the host port mapping on the window record', async () => {
  const projectId = seedProject('git@github.com:org/ports-repo2.git', 'ports2', [3000])
  mockInspect.mockResolvedValueOnce({
    State: { Status: 'running' },
    NetworkSettings: {
      Ports: {
        '3000/tcp': [{ HostPort: '54321' }]
      }
    }
  })

  const win = await createWindow('port-window2', projectId)

  expect(win.ports).toBe(JSON.stringify({ '3000': '54321' }))
  const row = getDb()
    .prepare('SELECT ports FROM windows WHERE id = ?')
    .get(win.id) as { ports: string | null }
  expect(row.ports).toBe(JSON.stringify({ '3000': '54321' }))
})

it('does not set ExposedPorts when project has no ports', async () => {
  const projectId = seedProject('git@github.com:org/no-ports-repo.git')
  await createWindow('no-ports-window', projectId)
  expect(mockCreateContainer).toHaveBeenCalledWith(
    expect.not.objectContaining({ ExposedPorts: expect.anything() })
  )
})

it('listWindows includes ports from the database', async () => {
  const projectId = seedProject('git@github.com:org/list-ports-repo.git', 'lp', [4000])
  mockInspect.mockResolvedValueOnce({
    State: { Status: 'running' },
    NetworkSettings: { Ports: { '4000/tcp': [{ HostPort: '55000' }] } }
  })
  await createWindow('list-ports-win', projectId)
  const windows = listWindows()
  expect(windows[0].ports).toBe(JSON.stringify({ '4000': '55000' }))
})
```

- [ ] **Step 3: Run tests — verify new tests fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/windowService.test.ts
```

Expected: FAIL on the four new tests

- [ ] **Step 4: Implement in `windowService.ts`**

Update the project query (line 37) to include `ports`:

```typescript
const project = db
  .prepare('SELECT git_url, ports FROM projects WHERE id = ? AND deleted_at IS NULL')
  .get(projectId) as { git_url: string; ports: string | null } | undefined
if (!project) throw new Error('Project not found')
```

Add port config building after `const clonePath = ...` (line 50):

```typescript
const projectPorts: number[] = project.ports ? (JSON.parse(project.ports) as number[]) : []
const exposedPorts: Record<string, Record<string, never>> = {}
const portBindings: Record<string, { HostPort: string }[]> = {}
for (const p of projectPorts) {
  exposedPorts[`${p}/tcp`] = {}
  portBindings[`${p}/tcp`] = [{ HostPort: '' }]
}
```

Replace `createContainer` call (lines 58–64) with:

```typescript
container = await getDocker().createContainer({
  Image: 'cc',
  Tty: true,
  OpenStdin: true,
  StdinOnce: false,
  Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`],
  ...(projectPorts.length > 0 && {
    ExposedPorts: exposedPorts,
    HostConfig: { PortBindings: portBindings }
  })
})
await container.start()
```

Add port inspection immediately after `container.start()`:

```typescript
let portsJson: string | null = null
if (projectPorts.length > 0) {
  const containerInfo = await container.inspect()
  const portMap: Record<string, string> = {}
  const netPorts = (containerInfo.NetworkSettings?.Ports ?? {}) as Record<
    string,
    { HostPort: string }[] | null
  >
  for (const [key, bindings] of Object.entries(netPorts)) {
    if (bindings && bindings.length > 0) {
      portMap[key.replace('/tcp', '')] = bindings[0].HostPort
    }
  }
  portsJson = JSON.stringify(portMap)
}
```

Update the INSERT statement (line 79) to include `ports`:

```typescript
const result = db
  .prepare('INSERT INTO windows (name, project_id, container_id, ports) VALUES (?, ?, ?, ?)')
  .run(name, projectId, container.id, portsJson)
```

Update the return statement (lines 85–92) to include `ports`:

```typescript
return {
  id,
  name,
  project_id: projectId,
  container_id: container.id,
  ports: portsJson ?? undefined,
  created_at: new Date().toISOString(),
  status: 'running' as WindowStatus
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/windowService.test.ts
```

Expected: PASS (all windowService tests)

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts && git commit -m "feat: windowService binds container ports and stores host port mapping"
```

---

## Task 6: Claude inject button in WindowDetailPane

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Update api mock in test file to include `sendTerminalInput`**

Replace the mock setup at the top of `WindowDetailPane.test.ts`:

```typescript
const getCurrentBranch = vi.fn()
const sendTerminalInput = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  sendTerminalInput.mockReset()
  // @ts-expect-error test bridge
  globalThis.window.api = { getCurrentBranch, sendTerminalInput }
})
```

- [ ] **Step 2: Write failing tests**

Add to `WindowDetailPane.test.ts`:

```typescript
it('renders a Claude button', () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, { props: { win, project } })
  expect(screen.getByRole('button', { name: /claude/i })).toBeInTheDocument()
})

it('Claude button is disabled when container is not running', () => {
  getCurrentBranch.mockResolvedValue('x')
  const stoppedWin = { ...win, status: 'stopped' as const }
  render(WindowDetailPane, { props: { win: stoppedWin, project } })
  expect(screen.getByRole('button', { name: /claude/i })).toBeDisabled()
})

it('Claude button is enabled when container is running', () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, { props: { win, project } })
  expect(screen.getByRole('button', { name: /claude/i })).not.toBeDisabled()
})

it('clicking Claude button sends the inject command to the terminal', async () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, { props: { win, project } })
  await fireEvent.click(screen.getByRole('button', { name: /claude/i }))
  expect(sendTerminalInput).toHaveBeenCalledWith(
    'abc123def456',
    '\x15claude --dangerously-skip-permissions\n'
  )
})
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: FAIL — Claude button not found

- [ ] **Step 4: Implement in `WindowDetailPane.svelte`**

Add `injectClaude` function in the `<script>` block, after the `onDestroy` block:

```typescript
function injectClaude(): void {
  window.api.sendTerminalInput(win.container_id, '\x15claude --dangerously-skip-permissions\n')
}
```

Add Claude button in the `.actions` div, after the Push button:

```svelte
<button
  type="button"
  disabled={win.status !== 'running'}
  onclick={injectClaude}
>Claude</button>
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: PASS (all WindowDetailPane tests)

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts && git commit -m "feat: add Claude inject button to WindowDetailPane"
```

---

## Task 7: Port display in WindowDetailPane

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write failing tests**

Add `winWithPorts` fixture near the top of `WindowDetailPane.test.ts`, after the existing `win` fixture:

```typescript
const winWithPorts = {
  ...win,
  ports: JSON.stringify({ '3000': '54321', '8080': '54322' })
}
```

Add tests:

```typescript
it('does not render port arrows when window has no ports', () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, { props: { win, project } })
  expect(screen.queryByText(/→/)).not.toBeInTheDocument()
})

it('renders port mappings when window has ports', () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, { props: { win: winWithPorts, project } })
  expect(screen.getByText(':3000→:54321')).toBeInTheDocument()
  expect(screen.getByText(':8080→:54322')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: FAIL — port text not rendered

- [ ] **Step 3: Implement in `WindowDetailPane.svelte`**

Add derived ports value in the `<script>` block, after the `alive` declaration:

```typescript
let parsedPorts: [string, string][] = $derived(
  win.ports
    ? (Object.entries(JSON.parse(win.ports)) as [string, string][])
    : []
)
```

In the template, add port display inside the `.info` div, after the status `<span>`:

```svelte
{#each parsedPorts as [container, host]}
  <span class="sep">·</span>
  <span class="port">:{container}→:{host}</span>
{/each}
```

Add `.port` style in the `<style>` block:

```css
.port {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--fg-2);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: PASS (all WindowDetailPane tests)

- [ ] **Step 5: Run full test suite**

```bash
cd /workspace/claude-window/window-manager && npm test
```

Expected: PASS (all tests across both suites)

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts && git commit -m "feat: display port mappings in WindowDetailPane"
```
