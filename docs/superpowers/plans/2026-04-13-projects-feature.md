# Projects Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git-backed "projects" as first-class entities that serve as templates for creating windows, with SSH URL validation, remote verification, and auto-cloning into containers.

**Architecture:** New `projects` SQLite table with 1:many relationship to `windows`. New `projectService.ts` handles CRUD + validation. `windowService.ts` modified to require `projectId` and clone repo on creation. Sidebar restructured: projects list → click project → see windows + create new. `CreateProject` replaces `CreateWindow` in sidebar header.

**Tech Stack:** Electron, Svelte 5, TypeScript, better-sqlite3, dockerode, vitest

---

## File Structure

### New files
- `src/main/projectService.ts` — project CRUD, SSH URL validation, `git ls-remote` verification
- `src/main/gitUrl.ts` — SSH URL parsing/validation utilities (pure functions, easily testable)
- `tests/main/projectService.test.ts` — unit tests for project service
- `tests/main/gitUrl.test.ts` — unit tests for URL validation/parsing
- `src/renderer/src/components/CreateProject.svelte` — add project form (replaces CreateWindow in sidebar)
- `src/renderer/src/components/ProjectView.svelte` — main pane project detail view (window list + create window + delete project)
- `src/renderer/src/components/ProjectItem.svelte` — sidebar item for a project
- `tests/renderer/CreateProject.test.ts` — renderer tests for CreateProject
- `tests/renderer/ProjectView.test.ts` — renderer tests for ProjectView
- `tests/renderer/ProjectItem.test.ts` — renderer tests for ProjectItem

### Modified files
- `src/main/db.ts` — add `projects` table, add `project_id` column to `windows`
- `src/main/windowService.ts` — `createWindow` takes `projectId`, clones repo; `listWindows` filters by `projectId`; cascade delete helper
- `src/main/ipcHandlers.ts` — register project IPC channels, update window channel signatures
- `src/preload/index.ts` — expose project API methods
- `src/renderer/src/types.ts` — add `ProjectRecord` type, update `Api` interface, update `WindowRecord`
- `src/renderer/src/App.svelte` — project-based state management, new selection model
- `src/renderer/src/components/Sidebar.svelte` — project list instead of window list
- `src/renderer/src/components/MainPane.svelte` — handle project view vs terminal view
- `src/renderer/src/components/EmptyState.svelte` — update copy for projects
- `tests/main/db.test.ts` — test projects table schema
- `tests/main/windowService.test.ts` — update for projectId param
- `tests/main/ipcHandlers.test.ts` — add project handler tests
- `tests/renderer/Sidebar.test.ts` — update for project-based sidebar

### Removed files
- `src/renderer/src/components/CreateWindow.svelte` — replaced by CreateProject + inline window creation in ProjectView
- `tests/renderer/CreateWindow.test.ts` — no longer needed

---

### Task 1: Git URL Validation Utilities

**Files:**
- Create: `src/main/gitUrl.ts`
- Test: `tests/main/gitUrl.test.ts`

- [ ] **Step 1: Write failing tests for SSH URL validation**

```typescript
// tests/main/gitUrl.test.ts
import { describe, it, expect } from 'vitest'
import { isValidSshUrl, extractRepoName, sshUrlToHttps } from '../../src/main/gitUrl'

describe('isValidSshUrl', () => {
  it('accepts git@github.com:org/repo.git', () => {
    expect(isValidSshUrl('git@github.com:org/repo.git')).toBe(true)
  })

  it('accepts git@github.com:org/repo without .git suffix', () => {
    expect(isValidSshUrl('git@github.com:org/repo')).toBe(true)
  })

  it('accepts git@gitlab.com:org/repo.git', () => {
    expect(isValidSshUrl('git@gitlab.com:org/repo.git')).toBe(true)
  })

  it('accepts git@bitbucket.org:org/repo.git', () => {
    expect(isValidSshUrl('git@bitbucket.org:org/repo.git')).toBe(true)
  })

  it('accepts nested paths like git@github.com:org/sub/repo.git', () => {
    expect(isValidSshUrl('git@github.com:org/sub/repo.git')).toBe(true)
  })

  it('rejects HTTPS URLs', () => {
    expect(isValidSshUrl('https://github.com/org/repo.git')).toBe(false)
  })

  it('rejects HTTP URLs', () => {
    expect(isValidSshUrl('http://github.com/org/repo.git')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSshUrl('')).toBe(false)
  })

  it('rejects random text', () => {
    expect(isValidSshUrl('not a url at all')).toBe(false)
  })

  it('rejects URLs missing the colon separator', () => {
    expect(isValidSshUrl('git@github.com/org/repo.git')).toBe(false)
  })
})

describe('extractRepoName', () => {
  it('extracts repo name from git@github.com:org/repo.git', () => {
    expect(extractRepoName('git@github.com:org/repo.git')).toBe('repo')
  })

  it('extracts repo name without .git suffix', () => {
    expect(extractRepoName('git@github.com:org/repo')).toBe('repo')
  })

  it('extracts repo name from nested path', () => {
    expect(extractRepoName('git@github.com:org/sub/repo.git')).toBe('repo')
  })
})

describe('sshUrlToHttps', () => {
  it('converts git@github.com:org/repo.git to https URL with PAT', () => {
    expect(sshUrlToHttps('git@github.com:org/repo.git', 'mytoken')).toBe(
      'https://mytoken@github.com/org/repo.git'
    )
  })

  it('converts git@gitlab.com:org/repo to https URL with PAT', () => {
    expect(sshUrlToHttps('git@gitlab.com:org/repo', 'tok123')).toBe(
      'https://tok123@gitlab.com/org/repo'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/main/gitUrl.test.ts --config vitest.node.config.ts`
Expected: FAIL — module `../../src/main/gitUrl` not found

- [ ] **Step 3: Implement gitUrl.ts**

```typescript
// src/main/gitUrl.ts

const SSH_URL_RE = /^git@([^:]+):(.+)$/

export function isValidSshUrl(url: string): boolean {
  if (!SSH_URL_RE.test(url)) return false
  const match = url.match(SSH_URL_RE)!
  const path = match[2]
  // Must have at least org/repo structure
  return path.includes('/')
}

export function extractRepoName(sshUrl: string): string {
  const match = sshUrl.match(SSH_URL_RE)
  if (!match) throw new Error(`Invalid SSH URL: ${sshUrl}`)
  const path = match[2]
  const lastSegment = path.split('/').pop()!
  return lastSegment.replace(/\.git$/, '')
}

export function sshUrlToHttps(sshUrl: string, pat: string): string {
  const match = sshUrl.match(SSH_URL_RE)
  if (!match) throw new Error(`Invalid SSH URL: ${sshUrl}`)
  const host = match[1]
  const path = match[2]
  return `https://${pat}@${host}/${path}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/main/gitUrl.test.ts --config vitest.node.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gitUrl.ts tests/main/gitUrl.test.ts
git commit -m "feat: add SSH URL validation and parsing utilities"
```

---

### Task 2: Database Schema — Add Projects Table

**Files:**
- Modify: `src/main/db.ts`
- Modify: `tests/main/db.test.ts`

- [ ] **Step 1: Write failing tests for projects table**

Add to `tests/main/db.test.ts`:

```typescript
it('creates the projects table on init', () => {
  const db = getDb()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    .all()
  expect(tables).toHaveLength(1)
})

it('projects table has all expected columns', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
  const names = cols.map((c) => c.name)
  expect(names).toContain('id')
  expect(names).toContain('name')
  expect(names).toContain('git_url')
  expect(names).toContain('created_at')
  expect(names).toContain('deleted_at')
})

it('windows table has project_id column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
  const names = cols.map((c) => c.name)
  expect(names).toContain('project_id')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/main/db.test.ts --config vitest.node.config.ts`
Expected: FAIL — no `projects` table, no `project_id` column

- [ ] **Step 3: Update db.ts to create both tables**

Replace the `initDb` function in `src/main/db.ts`:

```typescript
export function initDb(dbPath: string): void {
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      project_id   INTEGER NOT NULL REFERENCES projects(id),
      container_id TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at   DATETIME DEFAULT NULL
    )
  `)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/main/db.test.ts --config vitest.node.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add projects table and project_id to windows schema"
```

---

### Task 3: Project Service — CRUD Operations

**Files:**
- Create: `src/main/projectService.ts`
- Create: `tests/main/projectService.test.ts`

- [ ] **Step 1: Write failing tests for createProject and listProjects**

```typescript
// tests/main/projectService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

// Mock child_process for git ls-remote
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args)
}))

import {
  createProject,
  listProjects,
  deleteProject
} from '../../src/main/projectService'

describe('projectService', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    // Default: no GITHUB_PAT, skip remote validation
    delete process.env.GITHUB_PAT
  })

  afterEach(() => {
    closeDb()
  })

  describe('createProject', () => {
    it('creates a project with name and git URL', async () => {
      const result = await createProject('my-project', 'git@github.com:org/repo.git')
      expect(result.name).toBe('my-project')
      expect(result.git_url).toBe('git@github.com:org/repo.git')
      expect(result.id).toBeTypeOf('number')
    })

    it('derives name from URL when empty string provided', async () => {
      const result = await createProject('', 'git@github.com:org/my-repo.git')
      expect(result.name).toBe('my-repo')
    })

    it('rejects invalid SSH URLs', async () => {
      await expect(
        createProject('bad', 'https://github.com/org/repo.git')
      ).rejects.toThrow('Invalid SSH URL')
    })

    it('rejects duplicate git URLs', async () => {
      await createProject('first', 'git@github.com:org/repo.git')
      await expect(
        createProject('second', 'git@github.com:org/repo.git')
      ).rejects.toThrow('Project already exists')
    })

    it('runs git ls-remote when GITHUB_PAT is set', async () => {
      process.env.GITHUB_PAT = 'test-token'
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, '', '')
      })

      await createProject('verified', 'git@github.com:org/repo.git')

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['ls-remote', '--exit-code', 'https://test-token@github.com/org/repo.git'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('rejects when git ls-remote fails', async () => {
      process.env.GITHUB_PAT = 'test-token'
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(new Error('repository not found'), '', '')
      })

      await expect(
        createProject('bad-remote', 'git@github.com:org/nonexistent.git')
      ).rejects.toThrow('Repository not accessible')
    })

    it('skips remote check and succeeds when GITHUB_PAT is missing', async () => {
      const result = await createProject('no-pat', 'git@github.com:org/repo.git')
      expect(result.name).toBe('no-pat')
      expect(mockExecFile).not.toHaveBeenCalled()
    })
  })

  describe('listProjects', () => {
    it('returns empty array when no projects exist', () => {
      expect(listProjects()).toEqual([])
    })

    it('returns active projects only', async () => {
      await createProject('active', 'git@github.com:org/active.git')
      await createProject('deleted', 'git@github.com:org/deleted.git')
      const projects = listProjects()
      const deletedProject = projects.find((p) => p.name === 'deleted')!
      await deleteProject(deletedProject.id)
      expect(listProjects()).toHaveLength(1)
      expect(listProjects()[0].name).toBe('active')
    })
  })

  describe('deleteProject', () => {
    it('soft-deletes the project', async () => {
      const project = await createProject('to-delete', 'git@github.com:org/repo.git')
      await deleteProject(project.id)
      const row = getDb()
        .prepare('SELECT deleted_at FROM projects WHERE id = ?')
        .get(project.id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('is idempotent — no error when deleting twice', async () => {
      const project = await createProject('twice', 'git@github.com:org/repo.git')
      await deleteProject(project.id)
      await expect(deleteProject(project.id)).resolves.toBeUndefined()
    })

    it('is idempotent — no error when project id does not exist', async () => {
      await expect(deleteProject(99999)).resolves.toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/main/projectService.test.ts --config vitest.node.config.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement projectService.ts**

```typescript
// src/main/projectService.ts
import { execFile } from 'child_process'
import { getDb } from './db'
import { isValidSshUrl, extractRepoName, sshUrlToHttps } from './gitUrl'
import { deleteWindow, listWindows } from './windowService'

export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  created_at: string
}

function verifyRemote(httpsUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['ls-remote', '--exit-code', httpsUrl], { timeout: 15_000 }, (err) => {
      if (err) reject(new Error('Repository not accessible'))
      else resolve()
    })
  })
}

export async function createProject(name: string, gitUrl: string): Promise<ProjectRecord> {
  if (!isValidSshUrl(gitUrl)) {
    throw new Error('Invalid SSH URL format. Expected: git@host:org/repo.git')
  }

  const resolvedName = name.trim() || extractRepoName(gitUrl)

  // Remote verification if PAT available
  const pat = process.env.GITHUB_PAT
  if (pat) {
    const httpsUrl = sshUrlToHttps(gitUrl, pat)
    await verifyRemote(httpsUrl)
  }

  const db = getDb()
  try {
    const result = db
      .prepare('INSERT INTO projects (name, git_url) VALUES (?, ?)')
      .run(resolvedName, gitUrl)

    return {
      id: result.lastInsertRowid as number,
      name: resolvedName,
      git_url: gitUrl,
      created_at: new Date().toISOString()
    }
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE constraint failed')) {
      throw new Error('Project already exists for this git URL')
    }
    throw err
  }
}

export function listProjects(): ProjectRecord[] {
  return getDb()
    .prepare('SELECT id, name, git_url, created_at FROM projects WHERE deleted_at IS NULL')
    .all() as ProjectRecord[]
}

export async function deleteProject(id: number): Promise<void> {
  const db = getDb()
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { id: number } | undefined

  if (!project) return // idempotent

  // Cascade delete all windows belonging to this project
  const windows = listWindows(id)
  for (const win of windows) {
    await deleteWindow(win.id)
  }

  db.prepare("UPDATE projects SET deleted_at = datetime('now') WHERE id = ?").run(id)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/main/projectService.test.ts --config vitest.node.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/projectService.ts tests/main/projectService.test.ts
git commit -m "feat: add project service with CRUD, SSH validation, and remote verification"
```

---

### Task 4: Update Window Service — Require projectId and Clone Repo

**Files:**
- Modify: `src/main/windowService.ts`
- Modify: `tests/main/windowService.test.ts`

- [ ] **Step 1: Update WindowRecord type and add project_id**

In `src/main/windowService.ts`, update the `WindowRecord` interface:

```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  created_at: string
  status: WindowStatus
}
```

- [ ] **Step 2: Write failing tests for updated createWindow**

Replace the `createWindow` describe block in `tests/main/windowService.test.ts`. First update the mock setup at top of file to add exec mock and import `createProject`:

Add after existing dockerode mock setup (before the `vi.mock('../../src/main/terminalService')` block):

```typescript
const mockExec = vi.fn()
const mockExecStart = vi.fn()
const mockExecResize = vi.fn()
```

Update `mockContainer` to include exec:

```typescript
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
  inspect: mockInspect,
  exec: mockExec.mockResolvedValue({
    start: mockExecStart.mockResolvedValue({ on: vi.fn() }),
    resize: mockExecResize
  })
}
```

Mock child_process (for projectService's git ls-remote):

```typescript
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, '', ''))
}))
```

Import createProject:

```typescript
import { createProject } from '../../src/main/projectService'
```

Then update the `createWindow` tests:

```typescript
describe('createWindow', () => {
  it('returns a record with project_id and container_id', async () => {
    const project = await createProject('test', 'git@github.com:org/repo.git')
    const result = await createWindow('my-window', project.id)
    expect(result.name).toBe('my-window')
    expect(result.project_id).toBe(project.id)
    expect(result.container_id).toBe('mock-container-abc123')
  })

  it('creates a Docker container from the cc image', async () => {
    const project = await createProject('test', 'git@github.com:org/repo.git')
    await createWindow('test', project.id)
    expect(mockCreateContainer).toHaveBeenCalledWith(expect.objectContaining({ Image: 'cc' }))
  })

  it('execs git clone inside the container', async () => {
    const project = await createProject('test', 'git@github.com:org/my-repo.git')
    await createWindow('test', project.id)
    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['git', 'clone', 'git@github.com:org/my-repo.git', '/workspace/my-repo']
      })
    )
  })

  it('throws if project does not exist', async () => {
    await expect(createWindow('test', 99999)).rejects.toThrow('Project not found')
  })
})
```

- [ ] **Step 3: Update listWindows tests**

Update existing `listWindows` tests to create projects first:

```typescript
describe('listWindows', () => {
  it('returns empty array when no windows exist', () => {
    expect(listWindows()).toEqual([])
  })

  it('excludes soft-deleted windows', async () => {
    const project = await createProject('test', 'git@github.com:org/repo.git')
    await createWindow('active', project.id)
    await createWindow('to-delete', project.id)
    const id = listWindows().find((w) => w.name === 'to-delete')!.id
    await deleteWindow(id)
    const result = listWindows()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('active')
  })

  it('filters by projectId when provided', async () => {
    const p1 = await createProject('p1', 'git@github.com:org/repo1.git')
    const p2 = await createProject('p2', 'git@github.com:org/repo2.git')
    await createWindow('w1', p1.id)
    await createWindow('w2', p2.id)
    const result = listWindows(p1.id)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('w1')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/main/windowService.test.ts --config vitest.node.config.ts`
Expected: FAIL — createWindow signature mismatch, project_id not in schema

- [ ] **Step 5: Update createWindow implementation**

Update `createWindow` in `src/main/windowService.ts`:

```typescript
export async function createWindow(name: string, projectId: number): Promise<WindowRecord> {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string } | undefined

  if (!project) throw new Error('Project not found')

  const repoName = extractRepoName(project.git_url)
  const clonePath = `/workspace/${repoName}`

  const container = await getDocker().createContainer({
    Image: 'cc',
    Tty: true,
    OpenStdin: true,
    StdinOnce: false
  })
  await container.start()

  // Clone repo inside container
  const cloneExec = await container.exec({
    Cmd: ['git', 'clone', project.git_url, clonePath],
    AttachStdout: true,
    AttachStderr: true
  })
  await cloneExec.start({})

  const result = db
    .prepare('INSERT INTO windows (name, project_id, container_id) VALUES (?, ?, ?)')
    .run(name, projectId, container.id)

  const id = result.lastInsertRowid as number
  statusMap.set(id, 'running')

  return {
    id,
    name,
    project_id: projectId,
    container_id: container.id,
    created_at: new Date().toISOString(),
    status: 'running' as WindowStatus
  }
}
```

Add import at top of `windowService.ts`:

```typescript
import { extractRepoName } from './gitUrl'
```

- [ ] **Step 6: Update listWindows implementation**

Update `listWindows` in `src/main/windowService.ts`:

```typescript
export function listWindows(projectId?: number): WindowRecord[] {
  const db = getDb()
  let query = 'SELECT id, name, project_id, container_id, created_at FROM windows WHERE deleted_at IS NULL'
  const params: number[] = []

  if (projectId !== undefined) {
    query += ' AND project_id = ?'
    params.push(projectId)
  }

  return (db.prepare(query).all(...params) as Omit<WindowRecord, 'status'>[]).map((r) => ({
    ...r,
    status: statusMap.get(r.id) ?? ('unknown' as WindowStatus)
  }))
}
```

- [ ] **Step 7: Update deleteWindow and other tests that create windows**

Update remaining tests in `tests/main/windowService.test.ts` to use project creation first. Each test that calls `createWindow` needs a project:

In `deleteWindow` describe block, add a shared project setup:

```typescript
describe('deleteWindow', () => {
  let projectId: number

  beforeEach(async () => {
    const project = await createProject('del-test', 'git@github.com:org/del-repo.git')
    projectId = project.id
  })

  // Update all createWindow calls: createWindow('name') → createWindow('name', projectId)
  // ... (all existing delete tests, just add projectId as second arg)
})
```

Similarly update `status field` and `reconcileWindows` describe blocks.

For `reconcileWindows` tests that insert directly into DB, update the INSERT to include `project_id`:

```typescript
// Where direct DB inserts exist, add project_id column:
// OLD: .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)').run('probe', 'probe-container')
// NEW: .prepare('INSERT INTO windows (name, project_id, container_id) VALUES (?, ?, ?)').run('probe', projectId, 'probe-container')
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/main/windowService.test.ts --config vitest.node.config.ts`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/main/windowService.ts tests/main/windowService.test.ts
git commit -m "feat: update window service to require projectId and clone repo on creation"
```

---

### Task 5: IPC Handlers and Preload — Add Project Channels

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/main/ipcHandlers.test.ts`

- [ ] **Step 1: Write failing tests for project IPC handlers**

Add to `tests/main/ipcHandlers.test.ts`:

Add project service mock at top (alongside existing mocks):

```typescript
vi.mock('../../src/main/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn()
}))
```

Add import:

```typescript
import { createProject, listProjects, deleteProject } from '../../src/main/projectService'
```

Add tests:

```typescript
it('registers project:create handler that calls createProject', async () => {
  const record = { id: 1, name: 'test', git_url: 'git@github.com:org/repo.git', created_at: '2026-01-01' }
  vi.mocked(createProject).mockResolvedValue(record)
  const result = await getHandler('project:create')({}, 'test', 'git@github.com:org/repo.git')
  expect(createProject).toHaveBeenCalledWith('test', 'git@github.com:org/repo.git')
  expect(result).toEqual(record)
})

it('registers project:list handler that calls listProjects', async () => {
  const records = [{ id: 1, name: 'p', git_url: 'git@github.com:org/repo.git', created_at: '2026-01-01' }]
  vi.mocked(listProjects).mockReturnValue(records)
  const result = await getHandler('project:list')({})
  expect(listProjects).toHaveBeenCalled()
  expect(result).toEqual(records)
})

it('registers project:delete handler that calls deleteProject', async () => {
  vi.mocked(deleteProject).mockResolvedValue(undefined)
  await getHandler('project:delete')({}, 1)
  expect(deleteProject).toHaveBeenCalledWith(1)
})
```

Update existing `window:create` test to pass projectId:

```typescript
it('registers window:create handler that calls createWindow', async () => {
  const record = {
    id: 1,
    name: 'test',
    project_id: 1,
    container_id: 'abc',
    created_at: '2026-01-01',
    status: 'running' as const
  }
  vi.mocked(createWindow).mockResolvedValue(record)
  const result = await getHandler('window:create')({}, 'test', 1)
  expect(createWindow).toHaveBeenCalledWith('test', 1)
  expect(result).toEqual(record)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts --config vitest.node.config.ts`
Expected: FAIL — no `project:create` handler registered

- [ ] **Step 3: Update ipcHandlers.ts**

```typescript
// src/main/ipcHandlers.ts
import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject } from './projectService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'

export function registerIpcHandlers(): void {
  // Project handlers
  ipcMain.handle('project:create', (_, name: string, gitUrl: string) =>
    createProject(name, gitUrl)
  )
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:delete', (_, id: number) => deleteProject(id))

  // Window handlers
  ipcMain.handle('window:create', (_, name: string, projectId: number) =>
    createWindow(name, projectId)
  )
  ipcMain.handle('window:list', (_, projectId?: number) => listWindows(projectId))
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))

  // Terminal handlers
  ipcMain.handle('terminal:open', (event, containerId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    return openTerminal(containerId, win)
  })
  ipcMain.on('terminal:input', (_, containerId: string, data: string) =>
    writeInput(containerId, data)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number) =>
    resizeTerminal(containerId, cols, rows)
  )
  ipcMain.on('terminal:close', (_, containerId: string) => closeTerminal(containerId))
}
```

- [ ] **Step 4: Update preload/index.ts**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Project API
  createProject: (name: string, gitUrl: string) =>
    ipcRenderer.invoke('project:create', name, gitUrl),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: number) => ipcRenderer.invoke('project:delete', id),

  // Window API
  createWindow: (name: string, projectId: number) =>
    ipcRenderer.invoke('window:create', name, projectId),
  listWindows: (projectId?: number) => ipcRenderer.invoke('window:list', projectId),
  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),

  // Terminal API
  openTerminal: (containerId: string) => ipcRenderer.invoke('terminal:open', containerId),
  sendTerminalInput: (containerId: string, data: string) =>
    ipcRenderer.send('terminal:input', containerId, data),
  resizeTerminal: (containerId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows),
  closeTerminal: (containerId: string) => ipcRenderer.send('terminal:close', containerId),
  onTerminalData: (callback: (containerId: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, data) => callback(containerId, data)),
  offTerminalData: () => ipcRenderer.removeAllListeners('terminal:data')
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/main/ipcHandlers.test.ts --config vitest.node.config.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts tests/main/ipcHandlers.test.ts
git commit -m "feat: add project IPC handlers and preload API"
```

---

### Task 6: Types — Add ProjectRecord and Update Api Interface

**Files:**
- Modify: `src/renderer/src/types.ts`

- [ ] **Step 1: Update types.ts**

```typescript
// src/renderer/src/types.ts
export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  created_at: string
}

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  created_at: string
  status: WindowStatus
}

export interface Api {
  // Projects
  createProject: (name: string, gitUrl: string) => Promise<ProjectRecord>
  listProjects: () => Promise<ProjectRecord[]>
  deleteProject: (id: number) => Promise<void>

  // Windows
  createWindow: (name: string, projectId: number) => Promise<WindowRecord>
  listWindows: (projectId?: number) => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>

  // Terminal
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
git commit -m "feat: add ProjectRecord type and update Api interface"
```

---

### Task 7: UI — ProjectItem Component

**Files:**
- Create: `src/renderer/src/components/ProjectItem.svelte`
- Create: `tests/renderer/ProjectItem.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/renderer/ProjectItem.test.ts
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectItem from '../../src/renderer/src/components/ProjectItem.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('ProjectItem', () => {
  afterEach(() => cleanup())

  it('renders project name', () => {
    render(ProjectItem, { project, selected: false, onSelect: vi.fn() })
    expect(screen.getByText('my-project')).toBeDefined()
  })

  it('renders git URL snippet', () => {
    render(ProjectItem, { project, selected: false, onSelect: vi.fn() })
    expect(screen.getByText('org/my-project')).toBeDefined()
  })

  it('calls onSelect with project when clicked', async () => {
    const onSelect = vi.fn()
    render(ProjectItem, { project, selected: false, onSelect })
    await fireEvent.click(screen.getByText('my-project'))
    expect(onSelect).toHaveBeenCalledWith(project)
  })

  it('applies selected class when selected is true', () => {
    const { container } = render(ProjectItem, { project, selected: true, onSelect: vi.fn() })
    expect(container.querySelector('.selected')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/renderer/ProjectItem.test.ts --config vitest.renderer.config.ts`
Expected: FAIL — component not found

- [ ] **Step 3: Implement ProjectItem.svelte**

```svelte
<!-- src/renderer/src/components/ProjectItem.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    project: ProjectRecord
    selected: boolean
    onSelect: (project: ProjectRecord) => void
  }

  let { project, selected, onSelect }: Props = $props()

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
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/renderer/ProjectItem.test.ts --config vitest.renderer.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ProjectItem.svelte tests/renderer/ProjectItem.test.ts
git commit -m "feat: add ProjectItem sidebar component"
```

---

### Task 8: UI — CreateProject Component

**Files:**
- Create: `src/renderer/src/components/CreateProject.svelte`
- Create: `tests/renderer/CreateProject.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/renderer/CreateProject.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreateProject from '../../src/renderer/src/components/CreateProject.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const mockProject: ProjectRecord = {
  id: 1,
  name: 'my-repo',
  git_url: 'git@github.com:org/my-repo.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('CreateProject', () => {
  let mockCreateProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateProject = vi.fn().mockResolvedValue(mockProject)
    vi.stubGlobal('api', { createProject: mockCreateProject })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders SSH URL input with placeholder when expanded', () => {
    render(CreateProject, { startExpanded: true })
    expect(screen.getByPlaceholderText('git@github.com:org/repo.git')).toBeDefined()
  })

  it('renders optional name input', () => {
    render(CreateProject, { startExpanded: true })
    expect(screen.getByPlaceholderText('project name (optional)')).toBeDefined()
  })

  it('calls window.api.createProject with URL and name on submit', async () => {
    render(CreateProject, { startExpanded: true })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const nameInput = screen.getByPlaceholderText('project name (optional)')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'git@github.com:org/my-repo.git' } })
    await fireEvent.input(nameInput, { target: { value: 'My Project' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith('My Project', 'git@github.com:org/my-repo.git')
    })
  })

  it('calls onCreated callback with new project record', async () => {
    const onCreated = vi.fn()
    render(CreateProject, { startExpanded: true, onCreated })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'git@github.com:org/my-repo.git' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(mockProject)
    })
  })

  it('disables button when URL is empty', async () => {
    render(CreateProject, { startExpanded: true })
    const button = screen.getByRole('button', { name: /add project/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows error message if API call fails', async () => {
    mockCreateProject.mockRejectedValue(new Error('Invalid SSH URL'))
    render(CreateProject, { startExpanded: true })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'bad-url' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Invalid SSH URL')).toBeDefined()
    })
  })

  it('starts collapsed by default and shows + button', () => {
    render(CreateProject, {})
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined()
  })

  it('pressing Escape collapses the form', async () => {
    render(CreateProject, { startExpanded: true })
    const input = screen.getByPlaceholderText('git@github.com:org/repo.git')
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/renderer/CreateProject.test.ts --config vitest.renderer.config.ts`
Expected: FAIL — component not found

- [ ] **Step 3: Implement CreateProject.svelte**

```svelte
<!-- src/renderer/src/components/CreateProject.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    onCreated?: (record: ProjectRecord) => void
    startExpanded?: boolean
  }

  let { onCreated, startExpanded = false }: Props = $props()

  let expanded = $state(startExpanded)
  let gitUrl = $state('')
  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmedUrl = gitUrl.trim()
    if (!trimmedUrl || loading) return
    loading = true
    error = ''
    try {
      const record = await window.api.createProject(name.trim(), trimmedUrl)
      gitUrl = ''
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
      gitUrl = ''
      name = ''
      error = ''
    }
  }

  function toggle(): void {
    expanded = !expanded
    if (!expanded) {
      gitUrl = ''
      name = ''
      error = ''
    }
  }
</script>

<div class="create-project">
  {#if expanded}
    <div class="fields">
      <input
        type="text"
        placeholder="git@github.com:org/repo.git"
        bind:value={gitUrl}
        disabled={loading}
        onkeydown={handleKey}
      />
      <input
        type="text"
        placeholder="project name (optional)"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
      />
      <div class="actions">
        <button
          type="button"
          class="submit"
          aria-label="add project"
          onclick={handleSubmit}
          disabled={!gitUrl.trim() || loading}>Add</button
        >
        <button type="button" class="cancel" aria-label="cancel" onclick={toggle}>×</button>
      </div>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {:else}
    <button type="button" class="expand" aria-label="new project" onclick={toggle}>+</button>
  {/if}
</div>

<style>
  .create-project {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actions {
    display: flex;
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/renderer/CreateProject.test.ts --config vitest.renderer.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CreateProject.svelte tests/renderer/CreateProject.test.ts
git commit -m "feat: add CreateProject form component"
```

---

### Task 9: UI — ProjectView Component (Main Pane)

**Files:**
- Create: `src/renderer/src/components/ProjectView.svelte`
- Create: `tests/renderer/ProjectView.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/renderer/ProjectView.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectView from '../../src/renderer/src/components/ProjectView.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z'
}

const mockWindow: WindowRecord = {
  id: 10,
  name: 'dev-window',
  project_id: 1,
  container_id: 'container-abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

describe('ProjectView', () => {
  let mockCreateWindow: ReturnType<typeof vi.fn>
  let mockDeleteProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
    mockDeleteProject = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      createWindow: mockCreateWindow,
      deleteProject: mockDeleteProject
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('displays project name and git URL', () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('my-project')).toBeDefined()
    expect(screen.getByText('git@github.com:org/my-project.git')).toBeDefined()
  })

  it('lists windows belonging to the project', () => {
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('dev-window')).toBeDefined()
  })

  it('shows empty state when no windows', () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('creates window with project id on form submit', async () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })

    const input = screen.getByPlaceholderText('window name')
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: 'new-win' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith('new-win', 1)
    })
  })

  it('calls onWindowSelect when a window is clicked', async () => {
    const onWindowSelect = vi.fn()
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect,
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    await fireEvent.click(screen.getByText('dev-window'))
    expect(onWindowSelect).toHaveBeenCalledWith(mockWindow)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd window-manager && npx vitest run tests/renderer/ProjectView.test.ts --config vitest.renderer.config.ts`
Expected: FAIL — component not found

- [ ] **Step 3: Implement ProjectView.svelte**

```svelte
<!-- src/renderer/src/components/ProjectView.svelte -->
<script lang="ts">
  import type { ProjectRecord, WindowRecord } from '../types'

  interface Props {
    project: ProjectRecord
    windows: WindowRecord[]
    onWindowSelect: (win: WindowRecord) => void
    onWindowCreated: (win: WindowRecord) => void
    onProjectDeleted: (id: number) => void
  }

  let { project, windows, onWindowSelect, onWindowCreated, onProjectDeleted }: Props = $props()

  let windowName = $state('')
  let creating = $state(false)
  let createError = $state('')
  let confirmingDelete = $state(false)
  let deleteTimeout: ReturnType<typeof setTimeout> | null = null

  async function handleCreateWindow(): Promise<void> {
    const trimmed = windowName.trim()
    if (!trimmed || creating) return
    creating = true
    createError = ''
    try {
      const record = await window.api.createWindow(trimmed, project.id)
      windowName = ''
      onWindowCreated(record)
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err)
    } finally {
      creating = false
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') handleCreateWindow()
  }

  function handleDeleteClick(): void {
    confirmingDelete = true
    if (deleteTimeout) clearTimeout(deleteTimeout)
    deleteTimeout = setTimeout(() => {
      confirmingDelete = false
      deleteTimeout = null
    }, 3000)
  }

  async function handleConfirmDelete(): Promise<void> {
    if (deleteTimeout) clearTimeout(deleteTimeout)
    confirmingDelete = false
    await window.api.deleteProject(project.id)
    onProjectDeleted(project.id)
  }

  function handleCancelDelete(): void {
    if (deleteTimeout) clearTimeout(deleteTimeout)
    confirmingDelete = false
  }
</script>

<div class="project-view">
  <header class="project-header">
    <div class="project-info">
      <h2 class="project-name">{project.name}</h2>
      <span class="project-url">{project.git_url}</span>
    </div>
    <div class="project-actions">
      {#if confirmingDelete}
        <button type="button" class="confirm-delete" onclick={handleConfirmDelete}>Delete?</button>
        <button type="button" class="cancel-delete" onclick={handleCancelDelete}>×</button>
      {:else}
        <button type="button" class="delete-btn" onclick={handleDeleteClick}>Delete Project</button>
      {/if}
    </div>
  </header>

  <section class="windows-section">
    <h3 class="section-title">Windows</h3>

    <div class="create-window-row">
      <input
        type="text"
        placeholder="window name"
        bind:value={windowName}
        disabled={creating}
        onkeydown={handleKey}
      />
      <button
        type="button"
        class="create-btn"
        aria-label="create window"
        onclick={handleCreateWindow}
        disabled={!windowName.trim() || creating}>Create</button
      >
    </div>
    {#if createError}
      <p class="error">{createError}</p>
    {/if}

    {#if windows.length === 0}
      <p class="empty-hint">No windows yet. Create one above.</p>
    {:else}
      <div class="window-list">
        {#each windows as win (win.id)}
          <button
            type="button"
            class="window-item"
            onclick={() => onWindowSelect(win)}
          >
            <span class="status-dot status-{win.status}"></span>
            <span class="window-name">{win.name}</span>
            <span class="container-id">{win.container_id.slice(0, 12)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .project-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
    overflow-y: auto;
  }

  .project-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.25rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }

  .project-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .project-name {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .project-url {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-2);
  }

  .project-actions {
    display: flex;
    gap: 0.25rem;
  }

  .delete-btn,
  .confirm-delete,
  .cancel-delete {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    cursor: pointer;
  }

  .delete-btn:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .confirm-delete {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  .windows-section {
    padding: 1rem 1.25rem;
  }

  .section-title {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0 0 0.75rem;
  }

  .create-window-row {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .create-btn {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .create-btn:hover:not(:disabled) {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .create-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error {
    font-size: 0.72rem;
    color: var(--danger);
    margin: 0 0 0.5rem;
  }

  .empty-hint {
    font-size: 0.85rem;
    color: var(--fg-2);
  }

  .window-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .window-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.65rem;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    text-align: left;
    width: 100%;
    transition: background 120ms ease;
  }

  .window-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--fg-2);
  }

  .status-dot.status-running {
    background: var(--ok);
  }

  .window-name {
    flex: 1;
    font-weight: 500;
  }

  .container-id {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd window-manager && npx vitest run tests/renderer/ProjectView.test.ts --config vitest.renderer.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ProjectView.svelte tests/renderer/ProjectView.test.ts
git commit -m "feat: add ProjectView main pane component"
```

---

### Task 10: UI — Restructure Sidebar, App, and MainPane

**Files:**
- Modify: `src/renderer/src/components/Sidebar.svelte`
- Modify: `src/renderer/src/App.svelte`
- Modify: `src/renderer/src/components/MainPane.svelte`
- Modify: `src/renderer/src/components/EmptyState.svelte`
- Remove: `src/renderer/src/components/CreateWindow.svelte`
- Modify: `tests/renderer/Sidebar.test.ts`

- [ ] **Step 1: Update App.svelte — project-based state management**

```svelte
<!-- src/renderer/src/App.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord, WindowRecord } from './types'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane from './components/MainPane.svelte'

  let projects = $state<ProjectRecord[]>([])
  let windows = $state<WindowRecord[]>([])
  let selectedProjectId = $state<number | null>(null)
  let selectedWindowId = $state<number | null>(null)

  onMount(async () => {
    projects = await window.api.listProjects()
    if (projects.length > 0) {
      selectedProjectId = projects[0].id
      windows = await window.api.listWindows(projects[0].id)
    }
  })

  function handleProjectSelect(project: ProjectRecord): void {
    selectedProjectId = project.id
    selectedWindowId = null
    window.api.listWindows(project.id).then((wins) => {
      windows = wins
    })
  }

  function handleProjectCreated(project: ProjectRecord): void {
    projects = [...projects, project]
    selectedProjectId = project.id
    selectedWindowId = null
    windows = []
  }

  async function handleProjectDeleted(id: number): Promise<void> {
    projects = projects.filter((p) => p.id !== id)
    if (selectedProjectId === id) {
      selectedProjectId = projects[0]?.id ?? null
      selectedWindowId = null
      if (selectedProjectId) {
        windows = await window.api.listWindows(selectedProjectId)
      } else {
        windows = []
      }
    }
  }

  function handleWindowSelect(win: WindowRecord): void {
    selectedWindowId = win.id
  }

  function handleWindowCreated(win: WindowRecord): void {
    windows = [...windows, win]
    selectedWindowId = win.id
  }

  let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? null)
  let selectedWindow = $derived(windows.find((w) => w.id === selectedWindowId) ?? null)
</script>

<div class="app">
  <Sidebar
    {projects}
    selectedProjectId={selectedProjectId}
    onProjectSelect={handleProjectSelect}
    onProjectCreated={handleProjectCreated}
  />
  <MainPane
    project={selectedProject}
    {windows}
    selectedWindow={selectedWindow}
    onWindowSelect={handleWindowSelect}
    onWindowCreated={handleWindowCreated}
    onProjectDeleted={handleProjectDeleted}
  />
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

- [ ] **Step 2: Update Sidebar.svelte — project list**

```svelte
<!-- src/renderer/src/components/Sidebar.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import CreateProject from './CreateProject.svelte'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    onProjectSelect: (project: ProjectRecord) => void
    onProjectCreated: (project: ProjectRecord) => void
  }

  let { projects, selectedProjectId, onProjectSelect, onProjectCreated }: Props = $props()
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <h1>Projects</h1>
    <CreateProject onCreated={onProjectCreated} />
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
    <p class="empty-hint">No projects. Click + to add one.</p>
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

- [ ] **Step 3: Update MainPane.svelte — project view vs terminal view**

```svelte
<!-- src/renderer/src/components/MainPane.svelte -->
<script lang="ts">
  import type { ProjectRecord, WindowRecord } from '../types'
  import EmptyState from './EmptyState.svelte'
  import ProjectView from './ProjectView.svelte'
  import TerminalHost from './TerminalHost.svelte'

  interface Props {
    project: ProjectRecord | null
    windows: WindowRecord[]
    selectedWindow: WindowRecord | null
    onWindowSelect: (win: WindowRecord) => void
    onWindowCreated: (win: WindowRecord) => void
    onProjectDeleted: (id: number) => void
  }

  let { project, windows, selectedWindow, onWindowSelect, onWindowCreated, onProjectDeleted }: Props = $props()
</script>

<main class="main-pane">
  {#if selectedWindow}
    {#key selectedWindow.id}
      <TerminalHost win={selectedWindow} />
    {/key}
  {:else if project}
    <ProjectView
      {project}
      {windows}
      {onWindowSelect}
      onWindowCreated={onWindowCreated}
      onProjectDeleted={onProjectDeleted}
    />
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

- [ ] **Step 4: Update EmptyState.svelte — update copy**

```svelte
<!-- src/renderer/src/components/EmptyState.svelte -->
<div class="empty-state">
  <div class="icon" aria-hidden="true">
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </svg>
  </div>
  <h2 class="heading">No project selected</h2>
  <p class="hint">Add a project from the sidebar to get started.</p>
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.75rem;
    background: radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
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

- [ ] **Step 5: Delete CreateWindow.svelte and its test**

```bash
rm src/renderer/src/components/CreateWindow.svelte
rm tests/renderer/CreateWindow.test.ts
```

- [ ] **Step 6: Update Sidebar.test.ts**

```typescript
// tests/renderer/Sidebar.test.ts
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

function makeProject(id: number, name: string): ProjectRecord {
  return {
    id,
    name,
    git_url: `git@github.com:org/${name}.git`,
    created_at: '2026-01-01T00:00:00Z'
  }
}

describe('Sidebar', () => {
  let onProjectSelect: ReturnType<typeof vi.fn>
  let onProjectCreated: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onProjectSelect = vi.fn()
    onProjectCreated = vi.fn()
  })

  afterEach(() => cleanup())

  it('renders an item per project', () => {
    const projects = [makeProject(1, 'alpha'), makeProject(2, 'beta')]
    render(Sidebar, { projects, selectedProjectId: null, onProjectSelect, onProjectCreated })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
  })

  it('shows empty hint when projects is empty', () => {
    render(Sidebar, { projects: [], selectedProjectId: null, onProjectSelect, onProjectCreated })
    expect(screen.getByText(/no projects/i)).toBeDefined()
  })

  it('clicking a project forwards to onProjectSelect', async () => {
    const p = makeProject(3, 'gamma')
    render(Sidebar, { projects: [p], selectedProjectId: null, onProjectSelect, onProjectCreated })
    await fireEvent.click(screen.getByText('gamma'))
    expect(onProjectSelect).toHaveBeenCalledWith(p)
  })

  it('passes selected state to the correct item', () => {
    const a = makeProject(1, 'a')
    const b = makeProject(2, 'b')
    const { container } = render(Sidebar, {
      projects: [a, b],
      selectedProjectId: 2,
      onProjectSelect,
      onProjectCreated
    })
    const items = container.querySelectorAll('[data-testid="project-item"]')
    expect(items[0].classList.contains('selected')).toBe(false)
    expect(items[1].classList.contains('selected')).toBe(true)
  })
})
```

- [ ] **Step 7: Run all tests**

Run: `cd window-manager && npx vitest run --config vitest.renderer.config.ts`
Expected: all renderer tests PASS (some old tests like SidebarItem.test.ts may need updating — see Task 11)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: restructure UI for project-based navigation

- Sidebar shows projects instead of windows
- MainPane switches between ProjectView and TerminalHost
- App.svelte manages project + window selection state
- Remove standalone CreateWindow component
- Update EmptyState copy"
```

---

### Task 11: Fix Remaining Tests and Clean Up

**Files:**
- Modify: `tests/renderer/SidebarItem.test.ts` — may need removal or update if SidebarItem is no longer used directly in sidebar
- Modify: `tests/renderer/MainPane.test.ts` — update for new props
- Modify: `tests/renderer/EmptyState.test.ts` — update for new copy

- [ ] **Step 1: Update MainPane.test.ts for new props**

Read current `tests/renderer/MainPane.test.ts` and update to match new `MainPane` props (project, windows, selectedWindow, callbacks). Example:

```typescript
// tests/renderer/MainPane.test.ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MainPane from '../../src/renderer/src/components/MainPane.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'test',
  git_url: 'git@github.com:org/test.git',
  created_at: '2026-01-01'
}

describe('MainPane', () => {
  afterEach(() => cleanup())

  it('renders EmptyState when no project selected', () => {
    render(MainPane, {
      project: null,
      windows: [],
      selectedWindow: null,
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText(/no project selected/i)).toBeDefined()
  })

  it('renders ProjectView when project selected but no window', () => {
    vi.stubGlobal('api', { createWindow: vi.fn(), deleteProject: vi.fn() })
    render(MainPane, {
      project,
      windows: [],
      selectedWindow: null,
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('test')).toBeDefined()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Update EmptyState.test.ts for new copy**

```typescript
// tests/renderer/EmptyState.test.ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('renders the heading', () => {
    render(EmptyState)
    expect(screen.getByText(/no project selected/i)).toBeDefined()
  })

  it('renders the hint', () => {
    render(EmptyState)
    expect(screen.getByText(/add a project/i)).toBeDefined()
  })
})
```

- [ ] **Step 3: Decide on SidebarItem**

`SidebarItem.svelte` is no longer used in Sidebar (replaced by `ProjectItem`). However, it might still be useful inside `ProjectView` for window items. Check if `ProjectView` imports it — if not, remove `SidebarItem.svelte` and `tests/renderer/SidebarItem.test.ts`.

If `ProjectView` uses inline window items (as shown in Task 9), then:

```bash
rm src/renderer/src/components/SidebarItem.svelte
rm tests/renderer/SidebarItem.test.ts
```

- [ ] **Step 4: Run full test suite**

Run: `cd window-manager && npx vitest run --config vitest.node.config.ts && npx vitest run --config vitest.renderer.config.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: update tests for project-based UI, remove unused components"
```

---

### Task 12: E2E Verification — Manual Browser Testing

- [ ] **Step 1: Build the app**

Run: `cd window-manager && npm run build`
Expected: no TypeScript errors, clean build

- [ ] **Step 2: Start dev server and verify in browser**

Start: `cd window-manager && npm run dev`

Verify:
1. Sidebar shows "Projects" header with + button
2. Click + → form with SSH URL input + optional name
3. Enter valid SSH URL → project appears in sidebar
4. Click project → ProjectView shows in main pane with project name, URL, and window creation form
5. Enter window name → click Create → window appears in list (loading state while cloning)
6. Click window → terminal opens, user is in `/workspace/{repo-name}`
7. Delete project → cascade deletes windows, sidebar updates
8. Empty state shows when no projects exist

- [ ] **Step 3: Commit any fixes found during E2E testing**

```bash
git add -A
git commit -m "fix: address issues found during E2E verification"
```
