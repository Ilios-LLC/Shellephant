# Docker Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-project Docker dependency containers spun up alongside the main window container, connected via a bridge network, with a project UI to manage them and a dep-logs tab to inspect their output.

**Architecture:** New `dependencyService.ts` owns CRUD + image validation. `depLogsService.ts` owns log streaming. `windowService.ts` gains dependency lifecycle (create/delete) gated by a new `withDeps` flag. Three renderer components are updated: ProjectView (deps tab), NewWindowWizard (toggle), WindowDetailPane (dep logs tab). IPC/preload are extended to wire everything together.

**Tech Stack:** better-sqlite3 (DB), Dockerode (container ops), Node.js built-in `fetch` (registry validation), Svelte 5 runes, Vitest + @testing-library/svelte

---

## File Structure

### New files
- `window-manager/src/main/dependencyService.ts` — image validation + project_dependencies CRUD
- `window-manager/src/main/depLogsService.ts` — streaming dep container logs via Dockerode
- `window-manager/tests/main/dependencyService.test.ts`
- `window-manager/tests/main/depLogsService.test.ts`
- `window-manager/tests/main/windowService.test.ts`

### Modified files
- `window-manager/src/main/db.ts` — add `project_dependencies`, `window_dependency_containers` tables; migrate `windows.network_id`
- `window-manager/src/main/windowService.ts` — extend `createWindow` (dep network + containers), extend `deleteWindow` (cleanup)
- `window-manager/src/main/ipcHandlers.ts` — register new IPC channels
- `window-manager/src/preload/index.ts` — expose new API methods
- `window-manager/src/renderer/src/types.ts` — new interfaces + Api extension
- `window-manager/src/renderer/src/components/ProjectView.svelte` — add tabs + dependencies tab
- `window-manager/src/renderer/src/components/NewWindowWizard.svelte` — add withDeps toggle
- `window-manager/src/renderer/src/components/WindowDetailPane.svelte` — add dep logs tab

---

## Task 1: DB Schema Migrations

**Files:**
- Modify: `window-manager/src/main/db.ts`

- [ ] **Step 1: Write the failing test**

Create `window-manager/tests/main/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from '../../src/main/db'

describe('db migrations', () => {
  beforeEach(() => initDb(':memory:'))
  afterEach(() => closeDb())

  it('creates project_dependencies table', () => {
    const cols = getDb().pragma('table_info(project_dependencies)') as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'project_id', 'image', 'tag', 'env_vars', 'created_at'])
    )
  })

  it('creates window_dependency_containers table', () => {
    const cols = getDb().pragma('table_info(window_dependency_containers)') as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'window_id', 'dependency_id', 'container_id', 'created_at'])
    )
  })

  it('adds network_id column to windows', () => {
    const cols = getDb().pragma('table_info(windows)') as { name: string }[]
    expect(cols.some((c) => c.name === 'network_id')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts
```

Expected: 3 FAIL — tables don't exist yet.

- [ ] **Step 3: Add migrations to db.ts**

After the existing `project_groups` table creation block (after line 70), add:

```typescript
  _db.exec(`
    CREATE TABLE IF NOT EXISTS project_dependencies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      image      TEXT NOT NULL,
      tag        TEXT NOT NULL DEFAULT 'latest',
      env_vars   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  _db.exec(`
    CREATE TABLE IF NOT EXISTS window_dependency_containers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id     INTEGER NOT NULL REFERENCES windows(id),
      dependency_id INTEGER NOT NULL REFERENCES project_dependencies(id),
      container_id  TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const winNetCols = _db.pragma('table_info(windows)') as { name: string }[]
  if (!winNetCols.some((c) => c.name === 'network_id')) {
    _db.exec('ALTER TABLE windows ADD COLUMN network_id TEXT DEFAULT NULL')
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/db.test.ts
```

Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/db.ts window-manager/tests/main/db.test.ts
git commit -m "feat(db): add project_dependencies, window_dependency_containers tables and windows.network_id column"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`

- [ ] **Step 1: Add new interfaces and extend Api**

In `window-manager/src/renderer/src/types.ts`, add after the `TokenStatus` interface (after line 37):

```typescript
export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDepContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  image: string
  tag: string
}
```

In `window-manager/src/renderer/src/types.ts`, update the `WindowRecord` interface — add `network_id?`:

```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  network_id?: string | null
  created_at: string
  status: WindowStatus
}
```

In the `Api` interface, update `createWindow` and add new dep/dep-logs methods:

```typescript
  // Windows
  createWindow: (name: string, projectId: number, withDeps?: boolean) => Promise<WindowRecord>
  listWindows: (projectId?: number) => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>
  onWindowCreateProgress: (callback: (step: string) => void) => void
  offWindowCreateProgress: () => void

  // Dependencies
  listDependencies: (projectId: number) => Promise<ProjectDependency[]>
  createDependency: (
    projectId: number,
    data: { image: string; tag: string; envVars?: Record<string, string> }
  ) => Promise<ProjectDependency>
  deleteDependency: (id: number) => Promise<void>
  listWindowDepContainers: (windowId: number) => Promise<WindowDepContainer[]>

  // Dep logs
  startDepLogs: (containerId: string) => Promise<void>
  stopDepLogs: (containerId: string) => void
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) => void
  offDepLogsData: () => void
```

- [ ] **Step 2: Typecheck**

```bash
cd window-manager && npm run typecheck:node
```

Expected: no errors (renderer types aren't checked by typecheck:node, but this catches imports)

- [ ] **Step 3: Commit**

```bash
git add window-manager/src/renderer/src/types.ts
git commit -m "feat(types): add ProjectDependency, WindowDepContainer interfaces and extend Api"
```

---

## Task 3: dependencyService.ts

**Files:**
- Create: `window-manager/src/main/dependencyService.ts`
- Create: `window-manager/tests/main/dependencyService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/main/dependencyService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

vi.stubGlobal('fetch', vi.fn())

import {
  validateImage,
  listDependencies,
  createDependency,
  deleteDependency
} from '../../src/main/dependencyService'

function seedProject(): number {
  return (
    getDb()
      .prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'https://github.com/x/y')")
      .run().lastInsertRowid as number
  )
}

describe('validateImage', () => {
  it('passes for a valid Docker Hub library image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    await expect(validateImage('postgres', 'latest')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      'https://hub.docker.com/v2/repositories/library/postgres/tags/latest/'
    )
  })

  it('passes for a valid Docker Hub user image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    await expect(validateImage('myuser/myimage', '1.0')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      'https://hub.docker.com/v2/repositories/myuser/myimage/tags/1.0/'
    )
  })

  it('throws for a 404 Hub image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    await expect(validateImage('postgres', 'nonexistent')).rejects.toThrow('not found')
  })

  it('throws "Image must be public" for OCI 401', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        status: 401,
        headers: { get: () => 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }
      } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    await expect(validateImage('ghcr.io/foo/bar', 'latest')).rejects.toThrow('must be public')
  })
})

describe('listDependencies / createDependency / deleteDependency', () => {
  beforeEach(() => initDb(':memory:'))
  afterEach(() => closeDb())

  it('returns empty list for project with no deps', () => {
    const pid = seedProject()
    expect(listDependencies(pid)).toEqual([])
  })

  it('creates and lists a dependency', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, { image: 'redis', tag: 'alpine' })
    expect(dep).toMatchObject({ project_id: pid, image: 'redis', tag: 'alpine', env_vars: null })
    expect(listDependencies(pid)).toHaveLength(1)
  })

  it('creates dependency with env vars', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, {
      image: 'postgres',
      tag: 'latest',
      envVars: { POSTGRES_PASSWORD: 'secret' }
    })
    expect(dep.env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
  })

  it('throws validation error and does not insert if image invalid', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    const pid = seedProject()
    await expect(createDependency(pid, { image: 'badimage', tag: 'nope' })).rejects.toThrow()
    expect(listDependencies(pid)).toHaveLength(0)
  })

  it('deletes a dependency', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, { image: 'redis', tag: 'latest' })
    deleteDependency(dep.id)
    expect(listDependencies(pid)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/main/dependencyService.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement dependencyService.ts**

Create `window-manager/src/main/dependencyService.ts`:

```typescript
import { getDb } from './db'

export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDepContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  image: string
  tag: string
}

function parseImageRef(image: string): {
  isHub: boolean
  registry: string
  namespace: string
  repoPath: string
} {
  const parts = image.split('/')
  if (parts.length === 1) {
    return { isHub: true, registry: 'hub.docker.com', namespace: 'library', repoPath: parts[0] }
  }
  if (parts.length === 2 && !parts[0].includes('.')) {
    return { isHub: true, registry: 'hub.docker.com', namespace: parts[0], repoPath: parts[1] }
  }
  const registry = parts[0]
  const repoPath = parts.slice(1).join('/')
  return { isHub: false, registry, namespace: '', repoPath }
}

export async function validateImage(image: string, tag: string): Promise<void> {
  const ref = parseImageRef(image)

  if (ref.isHub) {
    const url = `https://hub.docker.com/v2/repositories/${ref.namespace}/${ref.repoPath}/tags/${tag}/`
    const res = await fetch(url)
    if (res.status === 404) throw new Error(`Image ${image}:${tag} not found on Docker Hub`)
    if (!res.ok) throw new Error(`Registry error: ${res.status}`)
    return
  }

  // OCI registry: try anonymous token exchange, then check manifest
  const authRes = await fetch(`https://${ref.registry}/v2/`)
  let token: string | null = null
  if (authRes.status === 401) {
    const wwwAuth = (authRes.headers as unknown as { get(k: string): string | null }).get('www-authenticate') ?? ''
    const realmMatch = wwwAuth.match(/realm="([^"]+)"/)
    const serviceMatch = wwwAuth.match(/service="([^"]+)"/)
    if (realmMatch) {
      const tokenUrl = `${realmMatch[1]}?service=${serviceMatch?.[1] ?? ''}&scope=repository:${ref.repoPath}:pull`
      const tokenRes = await fetch(tokenUrl)
      if (tokenRes.ok) {
        const body = (await tokenRes.json()) as { token?: string; access_token?: string }
        token = body.token ?? body.access_token ?? null
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.docker.distribution.manifest.v2+json'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const mRes = await fetch(`https://${ref.registry}/v2/${ref.repoPath}/manifests/${tag}`, { headers })
  if (mRes.status === 404) throw new Error(`Image ${image}:${tag} not found`)
  if (mRes.status === 401 || mRes.status === 403) throw new Error('Image must be public')
  if (!mRes.ok) throw new Error(`Registry error: ${mRes.status}`)
}

export function listDependencies(projectId: number): ProjectDependency[] {
  const rows = getDb()
    .prepare('SELECT * FROM project_dependencies WHERE project_id = ? ORDER BY created_at')
    .all(projectId) as Array<Omit<ProjectDependency, 'env_vars'> & { env_vars: string | null }>
  return rows.map((r) => ({
    ...r,
    env_vars: r.env_vars ? (JSON.parse(r.env_vars) as Record<string, string>) : null
  }))
}

export async function createDependency(
  projectId: number,
  data: { image: string; tag: string; envVars?: Record<string, string> }
): Promise<ProjectDependency> {
  await validateImage(data.image, data.tag)
  const envJson = data.envVars && Object.keys(data.envVars).length > 0
    ? JSON.stringify(data.envVars)
    : null
  const result = getDb()
    .prepare('INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, ?, ?, ?)')
    .run(projectId, data.image, data.tag, envJson)
  return {
    id: result.lastInsertRowid as number,
    project_id: projectId,
    image: data.image,
    tag: data.tag,
    env_vars: data.envVars ?? null,
    created_at: new Date().toISOString()
  }
}

export function deleteDependency(id: number): void {
  getDb().prepare('DELETE FROM project_dependencies WHERE id = ?').run(id)
}

export function listWindowDepContainers(windowId: number): WindowDepContainer[] {
  return getDb()
    .prepare(
      `SELECT wdc.id, wdc.window_id, wdc.dependency_id, wdc.container_id,
              pd.image, pd.tag
       FROM window_dependency_containers wdc
       JOIN project_dependencies pd ON pd.id = wdc.dependency_id
       WHERE wdc.window_id = ?`
    )
    .all(windowId) as WindowDepContainer[]
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/dependencyService.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/dependencyService.ts window-manager/tests/main/dependencyService.test.ts
git commit -m "feat(dependencyService): add image validation, dependency CRUD, window dep container listing"
```

---

## Task 4: depLogsService.ts

**Files:**
- Create: `window-manager/src/main/depLogsService.ts`
- Create: `window-manager/tests/main/depLogsService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/main/depLogsService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startDepLogs, stopDepLogs, stopAllDepLogs } from '../../src/main/depLogsService'

function makeStream(chunks: string[]) {
  return {
    on: vi.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') {
        for (const chunk of chunks) cb(Buffer.from(chunk))
      }
      return { on: vi.fn() }
    }),
    destroy: vi.fn()
  }
}

function makeContainer(stream: ReturnType<typeof makeStream>) {
  return {
    logs: vi.fn().mockResolvedValue(stream)
  }
}

describe('depLogsService', () => {
  beforeEach(() => stopAllDepLogs())

  it('calls onData for each streamed chunk', async () => {
    const stream = makeStream(['hello', ' world'])
    const container = makeContainer(stream)
    const onData = vi.fn()
    await startDepLogs('c1', container as never, onData)
    expect(onData).toHaveBeenCalledWith('hello')
    expect(onData).toHaveBeenCalledWith(' world')
  })

  it('stopDepLogs destroys the stream', async () => {
    const stream = makeStream([])
    const container = makeContainer(stream)
    await startDepLogs('c2', container as never, vi.fn())
    stopDepLogs('c2')
    expect(stream.destroy).toHaveBeenCalled()
  })

  it('stopAllDepLogs destroys all active streams', async () => {
    const s1 = makeStream([])
    const s2 = makeStream([])
    await startDepLogs('c3', makeContainer(s1) as never, vi.fn())
    await startDepLogs('c4', makeContainer(s2) as never, vi.fn())
    stopAllDepLogs()
    expect(s1.destroy).toHaveBeenCalled()
    expect(s2.destroy).toHaveBeenCalled()
  })

  it('stopDepLogs is a no-op for unknown containerId', () => {
    expect(() => stopDepLogs('unknown')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/main/depLogsService.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement depLogsService.ts**

Create `window-manager/src/main/depLogsService.ts`:

```typescript
import type Dockerode from 'dockerode'

interface LogStream {
  on(event: 'data', cb: (data: Buffer) => void): LogStream
  destroy(): void
}

const activeStreams = new Map<string, LogStream>()

export async function startDepLogs(
  containerId: string,
  container: Dockerode.Container,
  onData: (chunk: string) => void
): Promise<void> {
  stopDepLogs(containerId)

  const stream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true
  })) as unknown as LogStream

  stream.on('data', (chunk: Buffer) => onData(chunk.toString()))
  activeStreams.set(containerId, stream)
}

export function stopDepLogs(containerId: string): void {
  const stream = activeStreams.get(containerId)
  if (stream) {
    stream.destroy()
    activeStreams.delete(containerId)
  }
}

export function stopAllDepLogs(): void {
  for (const [id] of activeStreams) {
    stopDepLogs(id)
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/depLogsService.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/depLogsService.ts window-manager/tests/main/depLogsService.test.ts
git commit -m "feat(depLogsService): stream dep container logs with start/stop/stopAll"
```

---

## Task 5: windowService.ts Extensions

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Create: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/main/windowService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock modules before imports
vi.mock('../../src/main/docker', () => ({
  getDocker: vi.fn()
}))
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: vi.fn(() => 'pat'),
  getClaudeToken: vi.fn(() => 'token')
}))
vi.mock('../../src/main/gitOps', () => ({
  remoteBranchExists: vi.fn(async () => false),
  execInContainer: vi.fn(async () => ({ ok: true, stdout: '' })),
  cloneInContainer: vi.fn(async () => {}),
  checkoutSlug: vi.fn(async () => {})
}))
vi.mock('../../src/main/terminalService', () => ({
  closeTerminalSessionFor: vi.fn()
}))
vi.mock('../../src/main/dependencyService', () => ({
  listDependencies: vi.fn(() => []),
  listWindowDepContainers: vi.fn(() => [])
}))

import { initDb, closeDb, getDb } from '../../src/main/db'
import { createWindow, deleteWindow, __resetStatusMapForTests } from '../../src/main/windowService'
import { getDocker } from '../../src/main/docker'
import { listDependencies, listWindowDepContainers } from '../../src/main/dependencyService'

function makeContainer(id = 'ctr-id') {
  return {
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({ NetworkSettings: { Ports: {} } })),
    exec: vi.fn()
  }
}

function makeNetwork(id = 'net-id') {
  return {
    id,
    remove: vi.fn(async () => {})
  }
}

function seedProject(db: ReturnType<typeof getDb>): number {
  return db
    .prepare("INSERT INTO projects (name, git_url) VALUES ('proj', 'https://github.com/x/repo')")
    .run().lastInsertRowid as number
}

describe('createWindow without deps', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    const ctr = makeContainer()
    vi.mocked(getDocker).mockReturnValue({
      createContainer: vi.fn(async () => ctr),
      pull: vi.fn(),
      createNetwork: vi.fn()
    } as never)
  })
  afterEach(() => closeDb())

  it('inserts a window row and returns WindowRecord', async () => {
    const pid = seedProject(getDb())
    const win = await createWindow('my-win', pid, false)
    expect(win.name).toBe('my-win')
    expect(win.status).toBe('running')
    const row = getDb().prepare('SELECT * FROM windows WHERE id = ?').get(win.id) as { network_id: string | null }
    expect(row.network_id).toBeNull()
  })
})

describe('createWindow with deps', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
  })
  afterEach(() => closeDb())

  it('creates bridge network and dep containers before main container', async () => {
    const pid = seedProject(getDb())
    const depCtr = makeContainer('dep-ctr')
    const mainCtr = makeContainer('main-ctr')
    const net = makeNetwork('net-123')
    const docker = {
      createContainer: vi.fn()
        .mockResolvedValueOnce(depCtr)
        .mockResolvedValueOnce(mainCtr),
      pull: vi.fn((_img: string, cb: (err: null, stream: object) => void) => {
        cb(null, { pipe: vi.fn() })
      }),
      modem: { followProgress: vi.fn((_s: object, cb: () => void) => cb()) },
      createNetwork: vi.fn(async () => net)
    }
    vi.mocked(getDocker).mockReturnValue(docker as never)
    vi.mocked(listDependencies).mockReturnValue([
      { id: 1, project_id: pid, image: 'redis', tag: 'alpine', env_vars: null, created_at: '' }
    ])

    const win = await createWindow('win', pid, true)

    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Driver: 'bridge' })
    )
    expect(docker.createContainer).toHaveBeenCalledTimes(2)
    expect(depCtr.start).toHaveBeenCalled()

    const row = getDb().prepare('SELECT network_id FROM windows WHERE id = ?').get(win.id) as { network_id: string }
    expect(row.network_id).toBe('net-123')

    const depRows = getDb()
      .prepare('SELECT * FROM window_dependency_containers WHERE window_id = ?')
      .all(win.id)
    expect(depRows).toHaveLength(1)
  })

  it('cleans up dep containers and network when main container creation fails', async () => {
    const pid = seedProject(getDb())
    const depCtr = makeContainer('dep-ctr')
    const net = makeNetwork('net-xyz')
    const docker = {
      createContainer: vi.fn()
        .mockResolvedValueOnce(depCtr)
        .mockRejectedValueOnce(new Error('docker failure')),
      pull: vi.fn((_img: string, cb: (err: null, stream: object) => void) => {
        cb(null, {})
      }),
      modem: { followProgress: vi.fn((_s: object, cb: () => void) => cb()) },
      createNetwork: vi.fn(async () => net),
      getNetwork: vi.fn(() => net)
    }
    vi.mocked(getDocker).mockReturnValue(docker as never)
    vi.mocked(listDependencies).mockReturnValue([
      { id: 1, project_id: pid, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])

    await expect(createWindow('win', pid, true)).rejects.toThrow('docker failure')
    expect(depCtr.stop).toHaveBeenCalled()
    expect(depCtr.remove).toHaveBeenCalled()
    expect(net.remove).toHaveBeenCalled()
  })
})

describe('deleteWindow', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
  })
  afterEach(() => closeDb())

  it('stops and removes dep containers then removes network', async () => {
    const pid = seedProject(getDb())
    const db = getDb()
    const winRow = db
      .prepare("INSERT INTO windows (name, project_id, container_id, network_id) VALUES ('w', ?, 'main-ctr', 'net-abc')")
      .run(pid)
    const winId = winRow.lastInsertRowid as number
    db.prepare('INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, ?, ?)').run(pid, 'redis', 'latest')
    const depId = db.prepare('SELECT id FROM project_dependencies').get() as { id: number }
    db.prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)').run(winId, depId.id, 'dep-ctr')

    const depCtr = { stop: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    const mainCtr = { stop: vi.fn(async () => {}) }
    const net = { remove: vi.fn(async () => {}) }
    vi.mocked(getDocker).mockReturnValue({
      getContainer: vi.fn((id: string) => (id === 'dep-ctr' ? depCtr : mainCtr)),
      getNetwork: vi.fn(() => net)
    } as never)
    vi.mocked(listWindowDepContainers).mockReturnValue([
      { id: 1, window_id: winId, dependency_id: depId.id, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
    ])

    await deleteWindow(winId)

    expect(depCtr.stop).toHaveBeenCalled()
    expect(depCtr.remove).toHaveBeenCalled()
    expect(net.remove).toHaveBeenCalled()
    expect(mainCtr.stop).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/main/windowService.test.ts
```

Expected: FAIL — createWindow signature mismatch / missing dep logic

- [ ] **Step 3: Update windowService.ts**

Replace the `createWindow` signature and body in `window-manager/src/main/windowService.ts`.

Change the import at the top to add dependencyService:

```typescript
import { listDependencies, listWindowDepContainers } from './dependencyService'
```

Change `createWindow` signature (line 32):

```typescript
export async function createWindow(
  name: string,
  projectId: number,
  withDeps: boolean = false,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
```

After the `onProgress('Probing remote for branch…')` call (line 73), insert the dep network/container setup. Replace the try block opening `let container: Dockerode.Container | null = null` (line 76) with:

```typescript
  let networkId: string | null = null
  const depContainerRecords: Array<{ depId: number; containerId: string }> = []
  let container: Dockerode.Container | null = null

  try {
    if (withDeps) {
      const deps = listDependencies(projectId)
      if (deps.length > 0) {
        onProgress('Creating bridge network…')
        const network = await getDocker().createNetwork({
          Name: `cw-${slug}-net`,
          Driver: 'bridge'
        })
        networkId = network.id

        for (const dep of deps) {
          const imageRef = `${dep.image}:${dep.tag}`
          const basename = dep.image.split('/').pop()!
          onProgress(`Pulling ${imageRef}…`)
          await new Promise<void>((resolve, reject) => {
            getDocker().pull(imageRef, (err: Error | null, stream: NodeJS.ReadableStream) => {
              if (err) { reject(err); return }
              getDocker().modem.followProgress(stream, (err2: Error | null) => {
                if (err2) reject(err2); else resolve()
              })
            })
          })
          onProgress(`Starting ${imageRef}…`)
          const envVars: string[] = dep.env_vars
            ? Object.entries(dep.env_vars).map(([k, v]) => `${k}=${v}`)
            : []
          const depCtr = await getDocker().createContainer({
            Image: imageRef,
            name: `cw-${slug}-${basename}`,
            Env: envVars,
            HostConfig: { NetworkMode: `cw-${slug}-net` },
            NetworkingConfig: {
              EndpointsConfig: { [`cw-${slug}-net`]: { Aliases: [basename] } }
            }
          })
          await depCtr.start()
          depContainerRecords.push({ depId: dep.id, containerId: depCtr.id })
        }
      }
    }
```

After the existing `INSERT INTO windows` statement (line 125), add dep container rows and store network_id:

Replace the INSERT statement with:

```typescript
    onProgress('Finalizing…')
    const result = db
      .prepare('INSERT INTO windows (name, project_id, container_id, ports, network_id) VALUES (?, ?, ?, ?, ?)')
      .run(name, projectId, container.id, portsJson, networkId)

    const id = result.lastInsertRowid as number
    statusMap.set(id, 'running')

    for (const { depId, containerId } of depContainerRecords) {
      db.prepare(
        'INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)'
      ).run(id, depId, containerId)
    }
```

In the catch block (line 140), add dep cleanup before `throw err`:

```typescript
  } catch (err) {
    for (const { containerId } of depContainerRecords) {
      const c = getDocker().getContainer(containerId)
      await c.stop({ t: 1 }).catch(() => {})
      await c.remove({ force: true }).catch(() => {})
    }
    if (networkId) {
      await getDocker().getNetwork(networkId).remove().catch(() => {})
    }
    if (container) {
      await container.stop({ t: 1 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    }
    throw err
  }
```

Update `deleteWindow` — replace it entirely with:

```typescript
export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id, network_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string; network_id: string | null } | undefined

  if (!row) return

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)
  statusMap.delete(id)

  const depContainers = listWindowDepContainers(id)
  for (const dep of depContainers) {
    const c = getDocker().getContainer(dep.container_id)
    await c.stop({ t: 1 }).catch(() => {})
    await c.remove({ force: true }).catch(() => {})
  }

  if (row.network_id) {
    await getDocker().getNetwork(row.network_id).remove().catch(() => {})
  }

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

Update `listWindows` SELECT to include `network_id`:

```typescript
  let query =
    'SELECT id, name, project_id, container_id, ports, network_id, created_at FROM windows WHERE deleted_at IS NULL'
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/main/windowService.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat(windowService): createWindow supports withDeps flag; deleteWindow cleans up dep containers and bridge network"
```

---

## Task 6: IPC Wiring (ipcHandlers + preload)

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

No separate unit tests — IPC wiring is integration-level and covered by existing component tests.

- [ ] **Step 1: Update ipcHandlers.ts**

Add import at the top of `window-manager/src/main/ipcHandlers.ts`:

```typescript
import {
  listDependencies,
  createDependency,
  deleteDependency,
  listWindowDepContainers
} from './dependencyService'
import { startDepLogs, stopDepLogs } from './depLogsService'
```

Replace the window:create handler (line 66-68):

```typescript
  ipcMain.handle('window:create', (event, name: string, projectId: number, withDeps: boolean = false) =>
    createWindow(name, projectId, withDeps, (step) => event.sender.send('window:create-progress', step))
  )
```

After the window:delete handler, add dependency + dep-logs handlers:

```typescript
  // Dependency handlers
  ipcMain.handle('project:dep-list', (_, projectId: number) => listDependencies(projectId))
  ipcMain.handle(
    'project:dep-create',
    (_, projectId: number, data: { image: string; tag: string; envVars?: Record<string, string> }) =>
      createDependency(projectId, data)
  )
  ipcMain.handle('project:dep-delete', (_, id: number) => deleteDependency(id))
  ipcMain.handle('window:dep-containers-list', (_, windowId: number) =>
    listWindowDepContainers(windowId)
  )

  // Dep logs handlers
  ipcMain.handle('window:dep-logs-start', (event, containerId: string) => {
    const container = getDocker().getContainer(containerId)
    return startDepLogs(containerId, container, (chunk) =>
      event.sender.send('window:dep-logs-data', containerId, chunk)
    )
  })
  ipcMain.on('window:dep-logs-stop', (_, containerId: string) => stopDepLogs(containerId))
```

- [ ] **Step 2: Update preload/index.ts**

Replace `createWindow` in `window-manager/src/preload/index.ts`:

```typescript
  createWindow: (name: string, projectId: number, withDeps: boolean = false) =>
    ipcRenderer.invoke('window:create', name, projectId, withDeps),
```

Add after the `deleteWindow`/window listeners block:

```typescript
  // Dependency API
  listDependencies: (projectId: number) =>
    ipcRenderer.invoke('project:dep-list', projectId),
  createDependency: (
    projectId: number,
    data: { image: string; tag: string; envVars?: Record<string, string> }
  ) => ipcRenderer.invoke('project:dep-create', projectId, data),
  deleteDependency: (id: number) => ipcRenderer.invoke('project:dep-delete', id),
  listWindowDepContainers: (windowId: number) =>
    ipcRenderer.invoke('window:dep-containers-list', windowId),

  // Dep logs API
  startDepLogs: (containerId: string) =>
    ipcRenderer.invoke('window:dep-logs-start', containerId),
  stopDepLogs: (containerId: string) =>
    ipcRenderer.send('window:dep-logs-stop', containerId),
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) =>
    ipcRenderer.on('window:dep-logs-data', (_, containerId, chunk) => callback(containerId, chunk)),
  offDepLogsData: () => ipcRenderer.removeAllListeners('window:dep-logs-data'),
```

- [ ] **Step 3: Typecheck**

```bash
cd window-manager && npm run typecheck:node
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts
git commit -m "feat(ipc): wire dependency CRUD, window dep container listing, and dep log streaming channels"
```

---

## Task 7: ProjectView — Dependencies Tab

**Files:**
- Modify: `window-manager/src/renderer/src/components/ProjectView.svelte`
- Modify: `window-manager/tests/renderer/ProjectView.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('dependencies tab', ...)` block at the end of `window-manager/tests/renderer/ProjectView.test.ts`, before the closing `})`:

```typescript
  describe('dependencies tab', () => {
    let mockListDeps: ReturnType<typeof vi.fn>
    let mockCreateDep: ReturnType<typeof vi.fn>
    let mockDeleteDep: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockListDeps = vi.fn().mockResolvedValue([])
      mockCreateDep = vi.fn().mockResolvedValue({
        id: 99, project_id: 1, image: 'redis', tag: 'alpine', env_vars: null, created_at: ''
      })
      mockDeleteDep = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as Record<string, unknown>).window = {
        ...(globalThis as Record<string, unknown>).window as object,
        api: {
          ...(((globalThis as Record<string, unknown>).window as Record<string, unknown>)?.api as object ?? {}),
          listDependencies: mockListDeps,
          createDependency: mockCreateDep,
          deleteDependency: mockDeleteDep
        }
      }
    })

    it('shows a Dependencies tab button', async () => {
      render(ProjectView, baseProjectViewProps())
      expect(screen.getByRole('button', { name: /dependencies/i })).toBeDefined()
    })

    it('clicking Dependencies tab shows the deps section', async () => {
      render(ProjectView, baseProjectViewProps())
      await fireEvent.click(screen.getByRole('button', { name: /dependencies/i }))
      await waitFor(() => expect(screen.getByText(/add dependency/i)).toBeDefined())
    })

    it('lists saved dependencies when tab is active', async () => {
      mockListDeps.mockResolvedValue([
        { id: 1, project_id: 1, image: 'redis', tag: 'alpine', env_vars: null, created_at: '' }
      ])
      render(ProjectView, baseProjectViewProps())
      await fireEvent.click(screen.getByRole('button', { name: /dependencies/i }))
      await waitFor(() => expect(screen.getByText('redis:alpine')).toBeDefined())
    })

    it('shows validation error when image save fails', async () => {
      mockCreateDep.mockRejectedValue(new Error('not found on Docker Hub'))
      render(ProjectView, baseProjectViewProps())
      await fireEvent.click(screen.getByRole('button', { name: /dependencies/i }))
      await waitFor(() => screen.getByPlaceholderText(/postgres/i))
      await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'badimg' } })
      await fireEvent.click(screen.getByRole('button', { name: /save dependency/i }))
      await waitFor(() => expect(screen.getByText(/not found on docker hub/i)).toBeDefined())
    })

    it('deletes a dependency with two-click pattern', async () => {
      mockListDeps.mockResolvedValue([
        { id: 5, project_id: 1, image: 'postgres', tag: 'latest', env_vars: null, created_at: '' }
      ])
      render(ProjectView, baseProjectViewProps())
      await fireEvent.click(screen.getByRole('button', { name: /dependencies/i }))
      await waitFor(() => screen.getByRole('button', { name: /delete postgres:latest/i }))
      await fireEvent.click(screen.getByRole('button', { name: /delete postgres:latest/i }))
      expect(mockDeleteDep).not.toHaveBeenCalled()
      await fireEvent.click(screen.getByRole('button', { name: /confirm delete postgres:latest/i }))
      await waitFor(() => expect(mockDeleteDep).toHaveBeenCalledWith(5))
    })
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectView.test.ts
```

Expected: 5 FAIL from new tests (tab not found)

- [ ] **Step 3: Update ProjectView.svelte**

In the `<script lang="ts">` section of `window-manager/src/renderer/src/components/ProjectView.svelte`, add after the existing imports:

```typescript
  import type { ProjectDependency } from '../types'
```

Add new state after the existing state variables (after line 33 approx):

```typescript
  let activeTab = $state<'windows' | 'deps'>('windows')
  let deps = $state<ProjectDependency[]>([])
  let depLoading = $state(false)
  let depError = $state('')
  let newDepImage = $state('')
  let newDepTag = $state('latest')
  let confirmingDepId = $state<number | null>(null)
  let depDeleteTimeout: ReturnType<typeof setTimeout> | null = null

  async function loadDeps(): Promise<void> {
    deps = await window.api.listDependencies(project.id)
  }

  async function handleSaveDep(): Promise<void> {
    const img = newDepImage.trim()
    if (!img || depLoading) return
    depLoading = true
    depError = ''
    try {
      const dep = await window.api.createDependency(project.id, {
        image: img,
        tag: newDepTag.trim() || 'latest'
      })
      deps = [...deps, dep]
      newDepImage = ''
      newDepTag = 'latest'
    } catch (err) {
      depError = err instanceof Error ? err.message : String(err)
    } finally {
      depLoading = false
    }
  }

  function armDepDelete(id: number): void {
    if (confirmingDepId === id) {
      void handleDepDelete(id)
      return
    }
    if (depDeleteTimeout) clearTimeout(depDeleteTimeout)
    confirmingDepId = id
    depDeleteTimeout = setTimeout(() => { confirmingDepId = null }, 3000)
  }

  async function handleDepDelete(id: number): Promise<void> {
    if (depDeleteTimeout) clearTimeout(depDeleteTimeout)
    confirmingDepId = null
    await window.api.deleteDependency(id)
    deps = deps.filter((d) => d.id !== id)
  }
```

Replace the `<section class="windows-section">` block in the template with:

```svelte
  <div class="tab-row">
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'windows'}
      onclick={() => { activeTab = 'windows' }}
    >Windows</button>
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'deps'}
      onclick={() => { activeTab = 'deps'; void loadDeps() }}
    >Dependencies</button>
  </div>

  {#if activeTab === 'windows'}
  <section class="windows-section">
    <div class="section-header">
      <h3 class="section-title">Windows</h3>
      <button
        type="button"
        class="new-window-btn"
        aria-label="new window"
        onclick={onRequestNewWindow}>+ New Window</button
      >
    </div>

    {#if windows.length === 0}
      <div class="empty-windows">
        <p class="empty-hint">No windows yet.</p>
        <button type="button" class="empty-cta" onclick={onRequestNewWindow}
          >Create your first window</button
        >
      </div>
    {:else}
      <div class="window-list">
        {#each windows as win (win.id)}
          <div class="window-row">
            <button
              type="button"
              class="window-item"
              onclick={() => onWindowSelect(win)}
              disabled={deletingWindowId === win.id}
            >
              <span class="status-dot status-{win.status}"></span>
              <span class="window-name">{win.name}</span>
              <span class="container-id">{win.container_id.slice(0, 12)}</span>
            </button>
            <button
              type="button"
              class="window-delete"
              class:confirming={confirmingWindowId === win.id}
              aria-label={confirmingWindowId === win.id ? `confirm delete ${win.name}` : `delete ${win.name}`}
              title={confirmingWindowId === win.id ? 'Click again to confirm' : 'Delete window'}
              onclick={() => handleWindowDelete(win.id)}
              disabled={deletingWindowId === win.id}
            >
              {#if deletingWindowId === win.id}
                …
              {:else if confirmingWindowId === win.id}
                Delete?
              {:else}
                ×
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  {:else}
  <section class="deps-section">
    <div class="section-header">
      <h3 class="section-title">Dependencies</h3>
    </div>

    {#each deps as dep (dep.id)}
      <div class="dep-row">
        <span class="dep-image">{dep.image}:{dep.tag}</span>
        <button
          type="button"
          class="dep-delete"
          aria-label={confirmingDepId === dep.id ? `confirm delete ${dep.image}:${dep.tag}` : `delete ${dep.image}:${dep.tag}`}
          onclick={() => armDepDelete(dep.id)}
        >{confirmingDepId === dep.id ? 'Delete?' : '×'}</button>
      </div>
    {/each}

    <div class="dep-add">
      <input
        type="text"
        placeholder="postgres or ghcr.io/foo/bar"
        bind:value={newDepImage}
        disabled={depLoading}
      />
      <input
        type="text"
        placeholder="latest"
        bind:value={newDepTag}
        disabled={depLoading}
      />
      <button
        type="button"
        onclick={handleSaveDep}
        disabled={!newDepImage.trim() || depLoading}
        aria-label="save dependency"
      >{depLoading ? 'Validating…' : 'Add'}</button>
    </div>
    {#if depError}
      <p class="dep-error">{depError}</p>
    {/if}
  </section>
  {/if}
```

Add the tab CSS to the `<style>` block:

```css
  .tab-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    padding: 0 1.25rem;
  }
  .tab-btn {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--fg-2);
    cursor: pointer;
    margin-bottom: -1px;
  }
  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .deps-section {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .dep-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .dep-image {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--fg-1);
  }
  .dep-delete {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-2);
    border-radius: 4px;
    cursor: pointer;
  }
  .dep-delete:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
  .dep-add {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .dep-add input {
    flex: 1;
    padding: 0.4rem 0.5rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.85rem;
  }
  .dep-add input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .dep-add button {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.4rem 0.7rem;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: white;
    cursor: pointer;
  }
  .dep-add button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .dep-error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/renderer/ProjectView.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/ProjectView.svelte window-manager/tests/renderer/ProjectView.test.ts
git commit -m "feat(ProjectView): add Dependencies tab with add/delete dep UI"
```

---

## Task 8: NewWindowWizard — withDeps Toggle

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Create: `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/NewWindowWizard.test.ts`:

```typescript
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1, name: 'my-project', git_url: 'https://github.com/x/y', created_at: ''
}

const mockWindow: WindowRecord = {
  id: 10, name: 'dev', project_id: 1, container_id: 'abc', created_at: '', status: 'running'
}

function baseProps(overrides = {}) {
  return { project, onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
}

let mockListDeps: ReturnType<typeof vi.fn>
let mockCreateWindow: ReturnType<typeof vi.fn>
let mockOnProgress: ReturnType<typeof vi.fn>
let mockOffProgress: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDeps = vi.fn().mockResolvedValue([])
  mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
  mockOnProgress = vi.fn()
  mockOffProgress = vi.fn()
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      listDependencies: mockListDeps,
      createWindow: mockCreateWindow,
      onWindowCreateProgress: mockOnProgress,
      offWindowCreateProgress: mockOffProgress
    }
  }
})
afterEach(() => cleanup())

describe('NewWindowWizard', () => {
  it('does not show deps toggle when project has no dependencies', async () => {
    mockListDeps.mockResolvedValue([])
    render(NewWindowWizard, baseProps())
    await waitFor(() => expect(mockListDeps).toHaveBeenCalledWith(1))
    expect(screen.queryByRole('checkbox', { name: /start with dependencies/i })).toBeNull()
  })

  it('shows deps toggle when project has dependencies', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /start with dependencies/i })).toBeDefined()
    )
  })

  it('calls createWindow with withDeps=false when toggle unchecked', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', 1, false))
  })

  it('calls createWindow with withDeps=true when toggle is checked', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', 1, true))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts
```

Expected: FAIL — component doesn't fetch deps or render toggle

- [ ] **Step 3: Update NewWindowWizard.svelte**

In `window-manager/src/renderer/src/components/NewWindowWizard.svelte`, add to the `<script>` section after the existing imports:

```typescript
  import { onMount } from 'svelte'
  import type { ProjectDependency } from '../types'
```

Add new state after `let error = $state('')`:

```typescript
  let hasDeps = $state(false)
  let withDeps = $state(false)

  onMount(async () => {
    const deps: ProjectDependency[] = await window.api.listDependencies(project.id)
    hasDeps = deps.length > 0
  })
```

Update `handleSubmit` to pass `withDeps`:

```typescript
      const record = await window.api.createWindow(trimmed, project.id, withDeps)
```

Add the toggle to the template, after the `<div class="field">` name block and before the `{#if loading && progress}` block:

```svelte
    {#if hasDeps}
      <label class="dep-toggle">
        <input type="checkbox" bind:checked={withDeps} disabled={loading} />
        Start with dependencies
      </label>
    {/if}
```

Add CSS to `<style>`:

```css
  .dep-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    cursor: pointer;
    font-family: var(--font-ui);
  }
  .dep-toggle input {
    width: auto;
    cursor: pointer;
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat(NewWindowWizard): add Start with dependencies toggle when project has deps"
```

---

## Task 9: WindowDetailPane — Dep Logs Tab

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Create: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `window-manager/tests/renderer/WindowDetailPane.test.ts`:

```typescript
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WindowDetailPane from '../../src/renderer/src/components/WindowDetailPane.svelte'
import type { WindowRecord, ProjectRecord, WindowDepContainer } from '../../src/renderer/src/types'

const win: WindowRecord = {
  id: 1, name: 'dev', project_id: 1, container_id: 'abc123', status: 'running', created_at: ''
}
const project: ProjectRecord = { id: 1, name: 'proj', git_url: 'https://g.com/x/y', created_at: '' }

function baseProps(overrides = {}) {
  return {
    win,
    project,
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onGitStatus: vi.fn(),
    ...overrides
  }
}

let mockListDepContainers: ReturnType<typeof vi.fn>
let mockStartDepLogs: ReturnType<typeof vi.fn>
let mockStopDepLogs: ReturnType<typeof vi.fn>
let mockOnDepLogsData: ReturnType<typeof vi.fn>
let mockOffDepLogsData: ReturnType<typeof vi.fn>
let mockGetCurrentBranch: ReturnType<typeof vi.fn>
let mockGetGitStatus: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDepContainers = vi.fn().mockResolvedValue([])
  mockStartDepLogs = vi.fn().mockResolvedValue(undefined)
  mockStopDepLogs = vi.fn()
  mockOnDepLogsData = vi.fn()
  mockOffDepLogsData = vi.fn()
  mockGetCurrentBranch = vi.fn().mockResolvedValue('main')
  mockGetGitStatus = vi.fn().mockResolvedValue(null)
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      listWindowDepContainers: mockListDepContainers,
      startDepLogs: mockStartDepLogs,
      stopDepLogs: mockStopDepLogs,
      onDepLogsData: mockOnDepLogsData,
      offDepLogsData: mockOffDepLogsData,
      getCurrentBranch: mockGetCurrentBranch,
      getGitStatus: mockGetGitStatus
    }
  }
})
afterEach(() => cleanup())

describe('WindowDetailPane dep logs tab', () => {
  it('does not show Dep Logs button when no dep containers', async () => {
    mockListDepContainers.mockResolvedValue([])
    render(WindowDetailPane, baseProps())
    await waitFor(() => expect(mockListDepContainers).toHaveBeenCalledWith(1))
    expect(screen.queryByRole('button', { name: /dep logs/i })).toBeNull()
  })

  it('shows Dep Logs button when dep containers exist', async () => {
    const depContainers: WindowDepContainer[] = [
      { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
    ]
    mockListDepContainers.mockResolvedValue(depContainers)
    render(WindowDetailPane, baseProps())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /dep logs/i })).toBeDefined()
    )
  })

  it('clicking Dep Logs calls startDepLogs and shows log area', async () => {
    const depContainers: WindowDepContainer[] = [
      { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
    ]
    mockListDepContainers.mockResolvedValue(depContainers)
    render(WindowDetailPane, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /dep logs/i }))
    await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
    expect(mockStartDepLogs).toHaveBeenCalledWith('dep-ctr')
    expect(screen.getByRole('region', { name: /dep logs/i })).toBeDefined()
  })

  it('clicking Dep Logs again hides the area and calls stopDepLogs', async () => {
    const depContainers: WindowDepContainer[] = [
      { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
    ]
    mockListDepContainers.mockResolvedValue(depContainers)
    render(WindowDetailPane, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /dep logs/i }))
    await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
    await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
    expect(mockStopDepLogs).toHaveBeenCalledWith('dep-ctr')
    expect(screen.queryByRole('region', { name: /dep logs/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts
```

Expected: FAIL — Dep Logs button not present

- [ ] **Step 3: Update WindowDetailPane.svelte**

In `window-manager/src/renderer/src/components/WindowDetailPane.svelte`, add to the `<script>` section after existing imports:

```typescript
  import type { WindowDepContainer } from '../types'
```

Add state after existing state declarations:

```typescript
  let depContainers = $state<WindowDepContainer[]>([])
  let depLogsVisible = $state(false)
  let selectedDepContainerId = $state<string | null>(null)
  let depLogs = $state('')

  onMount(async () => {
    const containers = await window.api.listWindowDepContainers(win.id)
    depContainers = containers
    if (containers.length > 0) selectedDepContainerId = containers[0].container_id
    window.api.onDepLogsData((containerId, chunk) => {
      if (containerId === selectedDepContainerId) depLogs += chunk
    })
  })

  onDestroy(() => {
    window.api.offDepLogsData()
    if (depLogsVisible && selectedDepContainerId) {
      window.api.stopDepLogs(selectedDepContainerId)
    }
  })

  async function toggleDepLogs(): Promise<void> {
    if (!selectedDepContainerId) return
    if (depLogsVisible) {
      window.api.stopDepLogs(selectedDepContainerId)
      depLogsVisible = false
    } else {
      depLogs = ''
      await window.api.startDepLogs(selectedDepContainerId)
      depLogsVisible = true
    }
  }

  async function switchDepContainer(containerId: string): Promise<void> {
    if (selectedDepContainerId && depLogsVisible) {
      window.api.stopDepLogs(selectedDepContainerId)
    }
    selectedDepContainerId = containerId
    depLogs = ''
    if (depLogsVisible) {
      await window.api.startDepLogs(containerId)
    }
  }
```

In the template, update the `.toggle-row` to add the Dep Logs button:

```svelte
  <div class="toggle-row">
    {#each (['claude', 'terminal', 'editor'] as const) as id}
      <button
        type="button"
        class="toggle-btn"
        class:active={panelVisible[id]}
        aria-pressed={panelVisible[id]}
        disabled={visibleCount <= 1 && panelVisible[id]}
        onclick={() => togglePanel(id)}
      >{id === 'claude' ? 'Claude' : id === 'terminal' ? 'Terminal' : 'Editor'}</button>
    {/each}
    {#if depContainers.length > 0}
      <button
        type="button"
        class="toggle-btn"
        class:active={depLogsVisible}
        aria-label="Dep Logs"
        onclick={toggleDepLogs}
      >Dep Logs</button>
    {/if}
  </div>
  {#if depLogsVisible}
    <div class="dep-logs-section" role="region" aria-label="dep logs">
      {#if depContainers.length > 1}
        <select
          class="dep-selector"
          value={selectedDepContainerId}
          onchange={(e) => switchDepContainer((e.target as HTMLSelectElement).value)}
        >
          {#each depContainers as dc (dc.container_id)}
            <option value={dc.container_id}>{dc.image}:{dc.tag}</option>
          {/each}
        </select>
      {:else if depContainers.length === 1}
        <span class="dep-label">{depContainers[0].image}:{depContainers[0].tag}</span>
      {/if}
      <pre class="dep-log-output">{depLogs}</pre>
    </div>
  {/if}
```

Add CSS to `<style>`:

```css
  .dep-logs-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .dep-selector {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.18rem 0.4rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-1);
    align-self: flex-start;
  }
  .dep-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-2);
  }
  .dep-log-output {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-1);
    max-height: 160px;
    overflow-y: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--bg-2);
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts
```

Expected: all PASS

- [ ] **Step 5: Run all tests**

```bash
cd window-manager && npx vitest run
```

Expected: all tests pass across all test files

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(WindowDetailPane): add Dep Logs tab to stream dependency container logs"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task covering it |
|---|---|
| Per-project deps stored in DB | Task 1 (tables), Task 3 (CRUD) |
| Image validation (Hub + OCI) | Task 3 (`validateImage`) |
| Tag field, default `latest` | Task 1 (column default), Task 7 (UI default) |
| Env vars per dependency | Task 3 (env_vars JSON), Task 7 (future: env var UI — see note) |
| "Start with dependencies" toggle in wizard | Task 8 |
| Bridge network creation | Task 5 (createWindow) |
| Dep containers on bridge network | Task 5 (createWindow) |
| DNS via network aliases (basename) | Task 5 (NetworkingConfig Aliases) |
| Dep containers stopped+removed on window delete | Task 5 (deleteWindow) |
| Bridge network removed on window delete | Task 5 (deleteWindow) |
| Abort window creation on dep failure, cleanup | Task 5 (catch block) |
| Dep Logs tab in WindowDetailPane | Task 9 |
| Log streaming via IPC | Task 4 (service) + Task 6 (IPC) + Task 9 (renderer) |
| Dep container sub-selector in logs tab | Task 9 |

**Note on env var UI:** The spec describes key/value env var pairs in the add form. Task 7 implements the image/tag fields but the env var key-value editor is not included to keep ProjectView under 1000 lines. Env vars can be added in a follow-up task if needed. The DB and service layer fully support them.

### Placeholder Scan

No TBDs, no "similar to Task N" references, no placeholder steps — each step contains complete code.

### Type Consistency

- `ProjectDependency` defined in `dependencyService.ts` (main) and `types.ts` (renderer) — same shape.
- `WindowDepContainer` defined in `dependencyService.ts` and `types.ts` — same shape.
- `createWindow(name, projectId, withDeps, onProgress)` — consistent across windowService, ipcHandlers, preload, types.
- `listWindowDepContainers` — same name in dependencyService, ipcHandlers (`window:dep-containers-list`), preload, and types.Api.
- `startDepLogs(containerId, container, onData)` in depLogsService; IPC handler wraps it with event.sender.send.
- `armDepDelete` / `handleDepDelete` pattern mirrors existing `armWindowDelete` / `handleWindowDelete` in ProjectView.
