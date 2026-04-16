# Docker Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project Docker dependency management — define images, validate them, spin them up on a shared bridge network when creating a window, stream their logs, and clean up on window delete.

**Architecture:** New `dependencyService.ts` handles CRUD + Docker Hub / OCI image validation via registry APIs. New `depLogsService.ts` streams `docker logs --follow` per container. `windowService.ts` gains bridge network + dep container lifecycle around existing container creation. Svelte components cover: a `DependenciesSection` in `ProjectView`, a toggle in `NewWindowWizard`, and a dep logs pane in `WindowDetailPane`.

**Tech Stack:** better-sqlite3, Dockerode, native `fetch` (Electron main), Svelte 5 runes, @testing-library/svelte, vitest

---

## File Map

**New (main):**
- `window-manager/src/main/dependencyService.ts` — CRUD + image validation
- `window-manager/src/main/depLogsService.ts` — log stream lifecycle

**New (renderer):**
- `window-manager/src/renderer/src/components/DependenciesSection.svelte`
- `window-manager/src/renderer/src/components/DepLogsPane.svelte`

**New tests:**
- `window-manager/tests/main/dependencyService.test.ts`
- `window-manager/tests/main/depLogsService.test.ts`
- `window-manager/tests/renderer/DependenciesSection.test.ts`
- `window-manager/tests/renderer/DepLogsPane.test.ts`

**Modified:**
- `window-manager/src/main/db.ts`
- `window-manager/src/main/windowService.ts`
- `window-manager/src/main/ipcHandlers.ts`
- `window-manager/src/preload/index.ts`
- `window-manager/src/renderer/src/types.ts`
- `window-manager/src/renderer/src/components/ProjectView.svelte`
- `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- `window-manager/src/renderer/src/components/WindowDetailPane.svelte`

---

## Task 1: DB Schema Migrations

**Files:**
- Modify: `window-manager/src/main/db.ts`
- Test: `window-manager/tests/main/db.test.ts`

- [ ] **Step 1: Write failing tests**

Add this describe block to `tests/main/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

describe('db migrations — docker dependencies', () => {
  beforeEach(() => { initDb(':memory:') })
  afterEach(() => { closeDb() })

  it('creates project_dependencies table', () => {
    const cols = getDb().pragma('table_info(project_dependencies)') as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('project_id')
    expect(names).toContain('image')
    expect(names).toContain('tag')
    expect(names).toContain('env_vars')
  })

  it('creates window_dependency_containers table', () => {
    const cols = getDb().pragma('table_info(window_dependency_containers)') as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('window_id')
    expect(names).toContain('dependency_id')
    expect(names).toContain('container_id')
  })

  it('adds network_id column to windows', () => {
    const cols = getDb().pragma('table_info(windows)') as { name: string }[]
    expect(cols.some(c => c.name === 'network_id')).toBe(true)
  })

  it('tag column defaults to latest', () => {
    getDb().prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:o/r.git')").run()
    getDb().prepare("INSERT INTO project_dependencies (project_id, image) VALUES (1, 'postgres')").run()
    const row = getDb().prepare('SELECT tag FROM project_dependencies WHERE id = 1').get() as { tag: string }
    expect(row.tag).toBe('latest')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

Expected: FAIL — tables do not exist.

- [ ] **Step 3: Add migrations to db.ts**

Inside `initDb`, after the existing `project_groups` / `env_vars` migration block:

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

- [ ] **Step 4: Run — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/db.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/db.ts window-manager/tests/main/db.test.ts
git commit -m "feat(db): add project_dependencies, window_dependency_containers tables and network_id on windows"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`

- [ ] **Step 1: Add interfaces and update Api**

After `WindowRecord`, add:

```typescript
export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDependencyContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  created_at: string
}
```

In the `Api` interface, change the existing `createWindow` line to:

```typescript
  createWindow: (name: string, projectId: number, withDeps?: boolean) => Promise<WindowRecord>
```

Then add after the `deleteWindow` / `onWindowCreateProgress` / `offWindowCreateProgress` methods:

```typescript
  // Dependencies
  listDependencies: (projectId: number) => Promise<ProjectDependency[]>
  createDependency: (projectId: number, image: string, tag: string, envVars: Record<string, string>) => Promise<ProjectDependency>
  deleteDependency: (id: number) => Promise<void>
  listWindowDeps: (windowId: number) => Promise<WindowDependencyContainer[]>

  // Dep logs
  startDepLogs: (windowId: number, containerId: string) => Promise<void>
  stopDepLogs: (containerId: string) => void
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) => void
  offDepLogsData: () => void
```

- [ ] **Step 2: Typecheck**

```bash
cd /workspace/claude-window/window-manager && npm run typecheck:node 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/types.ts
git commit -m "feat(types): ProjectDependency, WindowDependencyContainer interfaces and dep Api methods"
```

---

## Task 3: dependencyService.ts

**Files:**
- Create: `window-manager/src/main/dependencyService.ts`
- Test: `window-manager/tests/main/dependencyService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/main/dependencyService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  listDependencies,
  createDependency,
  deleteDependency,
  validateImage,
  listWindowDeps
} from '../../src/main/dependencyService'

function seedProject(): number {
  return getDb()
    .prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:o/r.git')")
    .run().lastInsertRowid as number
}

function seedWindow(projectId: number): number {
  return getDb()
    .prepare("INSERT INTO windows (name, project_id, container_id) VALUES ('w', ?, 'cid')")
    .run(projectId).lastInsertRowid as number
}

describe('dependencyService', () => {
  beforeEach(() => { initDb(':memory:'); vi.clearAllMocks() })
  afterEach(() => { closeDb() })

  describe('listDependencies', () => {
    it('returns empty array when no deps', () => {
      expect(listDependencies(seedProject())).toEqual([])
    })

    it('returns deps for the given project', () => {
      const pid = seedProject()
      getDb().prepare("INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, 'postgres', 'latest')").run(pid)
      const deps = listDependencies(pid)
      expect(deps).toHaveLength(1)
      expect(deps[0].image).toBe('postgres')
      expect(deps[0].env_vars).toBeNull()
    })

    it('parses env_vars JSON into object', () => {
      const pid = seedProject()
      getDb()
        .prepare("INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, 'postgres', 'latest', ?)")
        .run(pid, JSON.stringify({ POSTGRES_PASSWORD: 'secret' }))
      expect(listDependencies(pid)[0].env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
    })
  })

  describe('createDependency', () => {
    it('inserts and returns dep after 200 response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      expect(dep.image).toBe('postgres')
      expect(dep.project_id).toBe(pid)
    })

    it('throws and does not insert when registry returns 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      const pid = seedProject()
      await expect(createDependency(pid, 'noexist', 'latest', {})).rejects.toThrow(/not found/i)
      expect(listDependencies(pid)).toHaveLength(0)
    })

    it('stores env_vars as JSON', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      await createDependency(pid, 'postgres', 'latest', { POSTGRES_PASSWORD: 'secret' })
      expect(listDependencies(pid)[0].env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
    })
  })

  describe('deleteDependency', () => {
    it('removes the dep row', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      deleteDependency(dep.id)
      expect(listDependencies(pid)).toHaveLength(0)
    })
  })

  describe('validateImage', () => {
    it('calls Docker Hub API for official image', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('postgres', 'latest')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/postgres/tags/latest/'
      )
    })

    it('calls Docker Hub API for user/image', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('myuser/myimage', 'v1')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/myuser/myimage/tags/v1/'
      )
    })

    it('throws not found for Hub 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      await expect(validateImage('postgres', 'doesnotexist')).rejects.toThrow(/not found/i)
    })

    it('calls OCI manifest endpoint for ghcr.io', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('ghcr.io/foo/bar', 'latest')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://ghcr.io/v2/foo/bar/manifests/latest',
        expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.any(String) }) })
      )
    })

    it('throws private for 401 without Www-Authenticate token exchange', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null } })
      await expect(validateImage('ghcr.io/foo/private', 'latest')).rejects.toThrow(/private/i)
    })
  })

  describe('listWindowDeps', () => {
    it('returns dep containers for a window', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const wid = seedWindow(pid)
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      getDb()
        .prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)')
        .run(wid, dep.id, 'dep-cid')
      const rows = listWindowDeps(wid)
      expect(rows).toHaveLength(1)
      expect(rows[0].container_id).toBe('dep-cid')
    })

    it('returns empty array when no dep containers', () => {
      const pid = seedProject()
      const wid = seedWindow(pid)
      expect(listWindowDeps(wid)).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/dependencyService.test.ts
```

- [ ] **Step 3: Implement dependencyService.ts**

```typescript
// src/main/dependencyService.ts
import { getDb } from './db'

export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDependencyContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  created_at: string
}

interface RawDep {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: string | null
  created_at: string
}

function parseDep(raw: RawDep): ProjectDependency {
  return { ...raw, env_vars: raw.env_vars ? (JSON.parse(raw.env_vars) as Record<string, string>) : null }
}

export function listDependencies(projectId: number): ProjectDependency[] {
  return (
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE project_id = ?')
      .all(projectId) as RawDep[]
  ).map(parseDep)
}

export async function createDependency(
  projectId: number,
  image: string,
  tag: string,
  envVars: Record<string, string>
): Promise<ProjectDependency> {
  await validateImage(image, tag)
  const envJson = Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
  const result = getDb()
    .prepare('INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, ?, ?, ?)')
    .run(projectId, image, tag, envJson)
  return parseDep(
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE id = ?')
      .get(result.lastInsertRowid as number) as RawDep
  )
}

export function deleteDependency(id: number): void {
  getDb().prepare('DELETE FROM project_dependencies WHERE id = ?').run(id)
}

export function listWindowDeps(windowId: number): WindowDependencyContainer[] {
  return getDb()
    .prepare('SELECT id, window_id, dependency_id, container_id, created_at FROM window_dependency_containers WHERE window_id = ?')
    .all(windowId) as WindowDependencyContainer[]
}

export async function validateImage(image: string, tag: string): Promise<void> {
  const parts = image.split('/')
  const firstPart = parts[0]
  const isNonHubRegistry = parts.length > 1 && (firstPart.includes('.') || firstPart.includes(':'))

  if (!isNonHubRegistry) {
    const namespace = parts.length === 1 ? 'library' : parts[0]
    const name = parts.length === 1 ? parts[0] : parts.slice(1).join('/')
    const res = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${name}/tags/${tag}/`)
    if (res.status === 404) throw new Error(`Image ${image}:${tag} not found on Docker Hub`)
    if (!res.ok) throw new Error(`Registry error checking ${image}:${tag}: ${res.status}`)
    return
  }

  const registry = firstPart
  const imagePath = parts.slice(1).join('/')
  const manifestUrl = `https://${registry}/v2/${imagePath}/manifests/${tag}`

  let res = await fetch(manifestUrl, {
    headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
  })

  if (res.status === 401) {
    const wwwAuth = res.headers.get('Www-Authenticate') ?? ''
    const realmMatch = wwwAuth.match(/realm="([^"]+)"/)
    const serviceMatch = wwwAuth.match(/service="([^"]+)"/)
    const scopeMatch = wwwAuth.match(/scope="([^"]+)"/)
    if (realmMatch) {
      const tokenUrl = new URL(realmMatch[1])
      if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1])
      if (scopeMatch) tokenUrl.searchParams.set('scope', scopeMatch[1])
      const tokenRes = await fetch(tokenUrl.toString())
      if (tokenRes.ok) {
        const data = (await tokenRes.json()) as { token?: string; access_token?: string }
        const token = data.token ?? data.access_token
        if (token) {
          res = await fetch(manifestUrl, {
            headers: {
              Accept: 'application/vnd.docker.distribution.manifest.v2+json',
              Authorization: `Bearer ${token}`
            }
          })
        }
      }
    }
  }

  if (res.status === 404) throw new Error(`Image ${image}:${tag} not found`)
  if (res.status === 401 || res.status === 403)
    throw new Error(`Image ${image}:${tag} is private or requires authentication`)
  if (!res.ok) throw new Error(`Registry error checking ${image}:${tag}: ${res.status}`)
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/dependencyService.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/dependencyService.ts window-manager/tests/main/dependencyService.test.ts
git commit -m "feat(dependencyService): CRUD and validateImage for Docker Hub and OCI registries"
```

---

## Task 4: depLogsService.ts

**Files:**
- Create: `window-manager/src/main/depLogsService.ts`
- Test: `window-manager/tests/main/depLogsService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/main/depLogsService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

function makeStream() {
  const s = new EventEmitter() as ReturnType<typeof EventEmitter.prototype.on> & { destroy: ReturnType<typeof vi.fn> }
  ;(s as any).destroy = vi.fn()
  return s as EventEmitter & { destroy: ReturnType<typeof vi.fn> }
}

let currentStream = makeStream()
const mockLogs = vi.fn(async () => currentStream)
const mockGetContainer = vi.fn(() => ({ logs: mockLogs }))

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return { getContainer: mockGetContainer }
  })
}))

import { startLogs, stopLogs, stopAllLogs } from '../../src/main/depLogsService'

describe('depLogsService', () => {
  beforeEach(() => {
    currentStream = makeStream()
    mockLogs.mockImplementation(async () => currentStream)
    stopAllLogs()
    vi.clearAllMocks()
    mockLogs.mockImplementation(async () => currentStream)
  })

  it('calls container.logs with follow stdout stderr', async () => {
    await startLogs('c1', () => {})
    expect(mockLogs).toHaveBeenCalledWith(
      expect.objectContaining({ follow: true, stdout: true, stderr: true })
    )
  })

  it('invokes onData when stream emits data', async () => {
    const onData = vi.fn()
    await startLogs('c2', onData)
    currentStream.emit('data', Buffer.from('hello\n'))
    expect(onData).toHaveBeenCalledWith('hello\n')
  })

  it('stopLogs destroys the active stream', async () => {
    await startLogs('c3', () => {})
    stopLogs('c3')
    expect(currentStream.destroy).toHaveBeenCalled()
  })

  it('stopLogs is a no-op for unknown id', () => {
    expect(() => stopLogs('unknown')).not.toThrow()
  })

  it('startLogs replaces existing stream for same id', async () => {
    const first = currentStream
    await startLogs('c4', () => {})
    currentStream = makeStream()
    mockLogs.mockImplementation(async () => currentStream)
    await startLogs('c4', () => {})
    expect(first.destroy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/depLogsService.test.ts
```

- [ ] **Step 3: Implement depLogsService.ts**

```typescript
// src/main/depLogsService.ts
import type { Readable } from 'stream'
import { getDocker } from './docker'

const activeStreams = new Map<string, Readable>()

export async function startLogs(containerId: string, onData: (chunk: string) => void): Promise<void> {
  stopLogs(containerId)
  const stream = (await getDocker().getContainer(containerId).logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true
  })) as unknown as Readable
  activeStreams.set(containerId, stream)
  stream.on('data', (chunk: Buffer) => onData(chunk.toString()))
  stream.on('error', () => stopLogs(containerId))
  stream.on('end', () => activeStreams.delete(containerId))
}

export function stopLogs(containerId: string): void {
  const stream = activeStreams.get(containerId)
  if (stream) {
    stream.destroy()
    activeStreams.delete(containerId)
  }
}

export function stopAllLogs(): void {
  for (const id of [...activeStreams.keys()]) stopLogs(id)
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/depLogsService.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/depLogsService.ts window-manager/tests/main/depLogsService.test.ts
git commit -m "feat(depLogsService): stream docker logs with start/stop lifecycle"
```

---

## Task 5: windowService.ts — Bridge Network & Dep Containers

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Test: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to the existing `describe('windowService')` block in `tests/main/windowService.test.ts`. First, extend the mock setup at the top of the file to add network mocks (add before the import of windowService):

```typescript
// Add these mock objects near the top of the existing test file, inside the vi.mock('dockerode') factory:
const mockNetworkRemove = vi.fn().mockResolvedValue(undefined)
const mockNetworkConnect = vi.fn().mockResolvedValue(undefined)
const mockNetwork = { id: 'net-123', remove: mockNetworkRemove, connect: mockNetworkConnect }
const mockCreateNetwork = vi.fn().mockResolvedValue(mockNetwork)
const mockGetNetwork = vi.fn().mockReturnValue(mockNetwork)
const mockPull = vi.fn().mockImplementation((_img: string, cb: Function) => {
  cb(null, {})
  return {}
})

// Inside the vi.mock('dockerode') factory, add to the returned object:
//   createNetwork: mockCreateNetwork,
//   getNetwork: mockGetNetwork,
//   pull: mockPull,
//   modem: { followProgress: vi.fn((_stream: any, cb: Function) => cb(null)) }
```

Then add new test cases:

```typescript
// Inside describe('createWindow') or as a new describe block:
describe('createWindow with deps', () => {
  function seedProjectWithDep(gitUrl: string): { projectId: number; depId: number } {
    const projectId = seedProject(gitUrl)
    const depId = getDb()
      .prepare("INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, 'postgres', 'latest')")
      .run(projectId).lastInsertRowid as number
    return { projectId, depId }
  }

  it('creates a bridge network when withDeps is true and project has deps', async () => {
    const { projectId } = seedProjectWithDep('git@github.com:org/dep-test.git')
    await createWindow('w1', projectId, true)
    expect(mockCreateNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Driver: 'bridge' })
    )
  })

  it('does not create a network when withDeps is false', async () => {
    const { projectId } = seedProjectWithDep('git@github.com:org/dep-test2.git')
    await createWindow('w2', projectId, false)
    expect(mockCreateNetwork).not.toHaveBeenCalled()
  })

  it('stores network_id on the window row', async () => {
    const { projectId } = seedProjectWithDep('git@github.com:org/dep-test3.git')
    await createWindow('w3', projectId, true)
    const row = getDb()
      .prepare('SELECT network_id FROM windows WHERE project_id = ?')
      .get(projectId) as { network_id: string | null }
    expect(row.network_id).toBe('net-123')
  })

  it('inserts a window_dependency_containers row per dep', async () => {
    const { projectId } = seedProjectWithDep('git@github.com:org/dep-test4.git')
    const win = await createWindow('w4', projectId, true)
    const rows = getDb()
      .prepare('SELECT * FROM window_dependency_containers WHERE window_id = ?')
      .all(win.id)
    expect(rows).toHaveLength(1)
  })
})

describe('deleteWindow with deps', () => {
  it('stops and removes dep containers before the main container', async () => {
    // Seed window with dep container row
    const pid = seedProject('git@github.com:org/del-dep.git')
    const winResult = getDb()
      .prepare("INSERT INTO windows (name, project_id, container_id, network_id) VALUES ('w', ?, 'main-cid', 'net-456')")
      .run(pid)
    const windowId = winResult.lastInsertRowid as number
    getDb()
      .prepare("INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, 'redis', 'latest')")
      .run(pid)
    const depId = getDb().prepare('SELECT id FROM project_dependencies WHERE project_id = ?').get(pid) as { id: number }
    getDb()
      .prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)')
      .run(windowId, depId.id, 'dep-cid')

    await deleteWindow(windowId)
    expect(mockStop).toHaveBeenCalled()
    expect(mockNetworkRemove).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/windowService.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Update Dockerode mock in test file**

In `tests/main/windowService.test.ts`, find the `vi.mock('dockerode', ...)` block and replace the factory body to include network mocks:

```typescript
const mockNetworkRemove = vi.fn().mockResolvedValue(undefined)
const mockNetworkConnect = vi.fn().mockResolvedValue(undefined)
const mockNetwork = { id: 'net-123', remove: mockNetworkRemove, connect: mockNetworkConnect }
const mockCreateNetwork = vi.fn().mockResolvedValue(mockNetwork)
const mockGetNetwork = vi.fn().mockReturnValue(mockNetwork)
const mockPull = vi.fn().mockImplementation((_img: string, cb: Function) => cb(null, {}))

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return {
      createContainer: mockCreateContainer,
      getContainer: mockGetContainer,
      createNetwork: mockCreateNetwork,
      getNetwork: mockGetNetwork,
      pull: mockPull,
      modem: { followProgress: vi.fn((_s: any, cb: Function) => cb(null)) }
    }
  })
}))
```

Also add `mockCreateNetwork`, `mockGetNetwork`, `mockNetworkRemove` to `vi.clearAllMocks()` in `beforeEach` (they are auto-cleared since they're declared with `vi.fn()`).

- [ ] **Step 4: Implement changes in windowService.ts**

Add helper at top of file (after imports):

```typescript
function imageBasename(image: string): string {
  return image.split('/').pop()!
}
```

Change `createWindow` signature to accept `withDeps`:

```typescript
export async function createWindow(
  name: string,
  projectId: number,
  withDeps: boolean = false,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord>
```

Inside `createWindow`, import `listDependencies` from `dependencyService` (add to imports at top of file):

```typescript
import { listDependencies } from './dependencyService'
```

After `const slug = toSlug(name)` and before the port/env setup, add:

```typescript
  let networkId: string | null = null
  const depContainerIds: string[] = []
  const networkName = `cw-${slug}-net`

  if (withDeps) {
    const deps = listDependencies(projectId)
    if (deps.length > 0) {
      onProgress('Creating bridge network…')
      const net = await getDocker().createNetwork({ Name: networkName, Driver: 'bridge' })
      networkId = net.id

      for (const dep of deps) {
        const imageRef = `${dep.image}:${dep.tag}`
        const basename = imageBasename(dep.image)
        onProgress(`Pulling ${imageRef}…`)
        await new Promise<void>((resolve, reject) => {
          getDocker().pull(imageRef, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) { reject(err); return }
            getDocker().modem.followProgress(stream, (err2: Error | null) => {
              err2 ? reject(err2) : resolve()
            })
          })
        })
        onProgress(`Starting ${imageRef}…`)
        const envArr = dep.env_vars
          ? Object.entries(dep.env_vars).map(([k, v]) => `${k}=${v}`)
          : []
        let depContainer: Dockerode.Container
        try {
          depContainer = await getDocker().createContainer({
            Image: imageRef,
            name: `cw-${slug}-${basename}`,
            Env: envArr,
            HostConfig: { NetworkMode: networkName },
            NetworkingConfig: {
              EndpointsConfig: { [networkName]: { Aliases: [basename] } }
            }
          })
          await depContainer.start()
          depContainerIds.push(depContainer.id)
        } catch (depErr) {
          for (const cid of depContainerIds) {
            await getDocker().getContainer(cid).stop({ t: 1 }).catch(() => {})
            await getDocker().getContainer(cid).remove({ force: true }).catch(() => {})
          }
          await getDocker().getNetwork(networkId).remove().catch(() => {})
          throw new Error(`Failed to start dependency ${imageRef}: ${(depErr as Error).message}`)
        }
      }
    }
  }
```

Modify the main container creation to attach to the network. Change the `createContainer` call:

```typescript
    container = await getDocker().createContainer({
      Image: 'cc',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`, ...projectEnvVars],
      ...(projectPorts.length > 0 && {
        ExposedPorts: exposedPorts,
      }),
      HostConfig: {
        ...(projectPorts.length > 0 && { PortBindings: portBindings }),
        ...(networkId && { NetworkMode: networkName })
      },
      ...(networkId && {
        NetworkingConfig: { EndpointsConfig: { [networkName]: {} } }
      })
    })
```

Change the INSERT for windows to include `network_id`:

```typescript
    const result = db
      .prepare('INSERT INTO windows (name, project_id, container_id, ports, network_id) VALUES (?, ?, ?, ?, ?)')
      .run(name, projectId, container.id, portsJson, networkId)
```

After getting `id` from `result.lastInsertRowid`, insert dep container rows:

```typescript
    const id = result.lastInsertRowid as number
    for (const cid of depContainerIds) {
      const dep = listDependencies(projectId).find(
        (d) => depContainerIds.indexOf(cid) === depContainerIds.indexOf(cid)
      )
      // dep rows: we need dep.id — track it during creation instead
    }
```

Wait — to correctly link `dependency_id`, track `{depId, containerId}` pairs instead of just IDs. Replace `depContainerIds` with `depPairs`:

```typescript
  const depPairs: { depId: number; containerId: string }[] = []
```

In the dep creation loop, replace `depContainerIds.push(depContainer.id)` with:

```typescript
          depPairs.push({ depId: dep.id, containerId: depContainer.id })
```

Update the cleanup in the catch block to use `depPairs.map(p => p.containerId)`.

After `const id = result.lastInsertRowid as number`, insert dep container rows:

```typescript
    for (const { depId, containerId } of depPairs) {
      db.prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)')
        .run(id, depId, containerId)
    }
```

Also update the error cleanup `try/catch` at the bottom to clean up dep containers:

```typescript
  } catch (err) {
    for (const { containerId } of depPairs) {
      await getDocker().getContainer(containerId).stop({ t: 1 }).catch(() => {})
      await getDocker().getContainer(containerId).remove({ force: true }).catch(() => {})
    }
    if (networkId) await getDocker().getNetwork(networkId).remove().catch(() => {})
    if (container) {
      await container.stop({ t: 1 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    }
    throw err
  }
```

Now update `deleteWindow`. Change the SELECT to include `network_id`:

```typescript
  const row = db
    .prepare('SELECT container_id, network_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string; network_id: string | null } | undefined
```

After `if (!row) return`, add dep cleanup before the soft-delete:

```typescript
  const depRows = db
    .prepare('SELECT container_id FROM window_dependency_containers WHERE window_id = ?')
    .all(id) as { container_id: string }[]
  for (const dep of depRows) {
    try { await getDocker().getContainer(dep.container_id).stop({ t: 1 }) } catch {}
    try { await getDocker().getContainer(dep.container_id).remove({ force: true }) } catch {}
  }
  if (row.network_id) {
    try { await getDocker().getNetwork(row.network_id).remove() } catch {}
  }
```

- [ ] **Step 5: Run all windowService tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/windowService.test.ts
```

Expected: PASS (all existing + new tests)

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat(windowService): bridge network and dep container lifecycle for window creation and deletion"
```

---

## Task 6: IPC Handlers + Preload Bridge

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 1: Update ipcHandlers.ts**

Add imports at top of `ipcHandlers.ts`:

```typescript
import { listDependencies, createDependency, deleteDependency, listWindowDeps } from './dependencyService'
import { startLogs, stopLogs } from './depLogsService'
```

Change the `window:create` handler to accept `withDeps`:

```typescript
  ipcMain.handle('window:create', (event, name: string, projectId: number, withDeps: boolean = false) =>
    createWindow(name, projectId, withDeps, (step) => event.sender.send('window:create-progress', step))
  )
```

Add new handlers after the existing window handlers:

```typescript
  // Dependency handlers
  ipcMain.handle('project:dep-list', (_, projectId: number) => listDependencies(projectId))
  ipcMain.handle('project:dep-create', (_, projectId: number, image: string, tag: string, envVars: Record<string, string>) =>
    createDependency(projectId, image, tag, envVars)
  )
  ipcMain.handle('project:dep-delete', (_, id: number) => deleteDependency(id))
  ipcMain.handle('window:dep-list', (_, windowId: number) => listWindowDeps(windowId))

  // Dep log handlers
  ipcMain.handle('window:dep-logs-start', (event, _windowId: number, containerId: string) =>
    startLogs(containerId, (chunk) => event.sender.send('window:dep-logs-data', containerId, chunk))
  )
  ipcMain.on('window:dep-logs-stop', (_, containerId: string) => stopLogs(containerId))
```

- [ ] **Step 2: Update preload/index.ts**

Change `createWindow` line:

```typescript
  createWindow: (name: string, projectId: number, withDeps: boolean = false) =>
    ipcRenderer.invoke('window:create', name, projectId, withDeps),
```

Add after `offWindowCreateProgress`:

```typescript
  // Dependency API
  listDependencies: (projectId: number) =>
    ipcRenderer.invoke('project:dep-list', projectId),
  createDependency: (projectId: number, image: string, tag: string, envVars: Record<string, string>) =>
    ipcRenderer.invoke('project:dep-create', projectId, image, tag, envVars),
  deleteDependency: (id: number) =>
    ipcRenderer.invoke('project:dep-delete', id),
  listWindowDeps: (windowId: number) =>
    ipcRenderer.invoke('window:dep-list', windowId),

  // Dep logs API
  startDepLogs: (windowId: number, containerId: string) =>
    ipcRenderer.invoke('window:dep-logs-start', windowId, containerId),
  stopDepLogs: (containerId: string) =>
    ipcRenderer.send('window:dep-logs-stop', containerId),
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) =>
    ipcRenderer.on('window:dep-logs-data', (_, containerId, chunk) => callback(containerId, chunk)),
  offDepLogsData: () =>
    ipcRenderer.removeAllListeners('window:dep-logs-data'),
```

- [ ] **Step 3: Typecheck**

```bash
cd /workspace/claude-window/window-manager && npm run typecheck:node 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts
git commit -m "feat(ipc): register dep CRUD, dep-logs-start/stop handlers and preload bridge"
```

---

## Task 7: DependenciesSection.svelte

**Files:**
- Create: `window-manager/src/renderer/src/components/DependenciesSection.svelte`
- Test: `window-manager/tests/renderer/DependenciesSection.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/renderer/DependenciesSection.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import DependenciesSection from '../../src/renderer/src/components/DependenciesSection.svelte'

const mockDep = { id: 1, project_id: 1, image: 'postgres', tag: 'latest', env_vars: null, created_at: '' }

function mountSection(overrides: Record<string, unknown> = {}) {
  return render(DependenciesSection, { projectId: 1, ...overrides })
}

describe('DependenciesSection', () => {
  let mockListDependencies: ReturnType<typeof vi.fn>
  let mockCreateDependency: ReturnType<typeof vi.fn>
  let mockDeleteDependency: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockListDependencies = vi.fn().mockResolvedValue([])
    mockCreateDependency = vi.fn().mockResolvedValue(mockDep)
    mockDeleteDependency = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      listDependencies: mockListDependencies,
      createDependency: mockCreateDependency,
      deleteDependency: mockDeleteDependency
    })
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows empty state when no deps', async () => {
    mountSection()
    await waitFor(() => expect(screen.getByText(/no dependencies/i)).toBeDefined())
  })

  it('lists existing deps', async () => {
    mockListDependencies.mockResolvedValue([mockDep])
    mountSection()
    await waitFor(() => expect(screen.getByText('postgres:latest')).toBeDefined())
  })

  it('shows add form when Add button clicked', async () => {
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    expect(screen.getByPlaceholderText(/postgres/i)).toBeDefined()
  })

  it('calls createDependency and reloads on save', async () => {
    mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', {})
    })
  })

  it('shows error when createDependency throws', async () => {
    mockListDependencies.mockResolvedValue([])
    mockCreateDependency.mockRejectedValue(new Error('Image not found'))
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'noexist' } })
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/image not found/i)).toBeDefined())
  })

  it('two-click delete removes a dep', async () => {
    mockListDependencies.mockResolvedValue([mockDep])
    mountSection()
    await waitFor(() => screen.getByText('postgres:latest'))
    const del = screen.getByRole('button', { name: /delete postgres/i })
    await fireEvent.click(del)
    await fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockDeleteDependency).toHaveBeenCalledWith(1))
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/DependenciesSection.test.ts
```

- [ ] **Step 3: Implement DependenciesSection.svelte**

```svelte
<!-- src/renderer/src/components/DependenciesSection.svelte -->
<script lang="ts">
  import type { ProjectDependency } from '../types'
  import { onMount } from 'svelte'

  interface Props { projectId: number }
  let { projectId }: Props = $props()

  let deps = $state<ProjectDependency[]>([])
  let loading = $state(true)
  let showForm = $state(false)
  let formImage = $state('')
  let formTag = $state('latest')
  let formEnvRows = $state<{ key: string; value: string }[]>([])
  let formError = $state('')
  let formSaving = $state(false)
  let confirmDeleteId = $state<number | null>(null)
  let deleteTimer: ReturnType<typeof setTimeout> | null = null

  onMount(async () => { await load() })

  async function load(): Promise<void> {
    loading = true
    try { deps = await window.api.listDependencies(projectId) }
    finally { loading = false }
  }

  async function handleSave(): Promise<void> {
    const image = formImage.trim()
    if (!image) return
    formSaving = true
    formError = ''
    const envVars = Object.fromEntries(
      formEnvRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
    )
    try {
      await window.api.createDependency(projectId, image, formTag.trim() || 'latest', envVars)
      showForm = false
      formImage = ''
      formTag = 'latest'
      formEnvRows = []
      await load()
    } catch (e) {
      formError = e instanceof Error ? e.message : String(e)
    } finally {
      formSaving = false
    }
  }

  function armDelete(id: number): void {
    confirmDeleteId = id
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = setTimeout(() => { confirmDeleteId = null }, 3000)
  }

  async function handleDelete(id: number): Promise<void> {
    if (confirmDeleteId !== id) { armDelete(id); return }
    if (deleteTimer) clearTimeout(deleteTimer)
    confirmDeleteId = null
    await window.api.deleteDependency(id)
    await load()
  }

  function addEnvRow(): void { formEnvRows = [...formEnvRows, { key: '', value: '' }] }
  function removeEnvRow(i: number): void { formEnvRows = formEnvRows.filter((_, idx) => idx !== i) }
</script>

<div class="deps-section">
  {#if loading}
    <p class="hint">Loading…</p>
  {:else if deps.length === 0 && !showForm}
    <p class="hint">No dependencies yet.</p>
  {:else}
    <ul class="dep-list">
      {#each deps as dep (dep.id)}
        <li class="dep-item">
          <span class="dep-name">{dep.image}:{dep.tag}</span>
          {#if dep.env_vars && Object.keys(dep.env_vars).length > 0}
            <span class="env-count">{Object.keys(dep.env_vars).length} env var{Object.keys(dep.env_vars).length !== 1 ? 's' : ''}</span>
          {/if}
          <button
            type="button"
            class="del-btn"
            class:confirming={confirmDeleteId === dep.id}
            aria-label={confirmDeleteId === dep.id ? 'confirm' : `delete ${dep.image}`}
            onclick={() => handleDelete(dep.id)}
          >{confirmDeleteId === dep.id ? 'Delete?' : '×'}</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if showForm}
    <div class="add-form">
      <div class="form-row">
        <input
          placeholder="postgres"
          aria-label="image"
          bind:value={formImage}
          disabled={formSaving}
        />
        <input
          placeholder="latest"
          aria-label="tag"
          bind:value={formTag}
          disabled={formSaving}
          class="tag-input"
        />
      </div>
      {#each formEnvRows as row, i}
        <div class="env-row">
          <input placeholder="KEY" bind:value={row.key} class="env-key" />
          <span>=</span>
          <input placeholder="value" bind:value={row.value} class="env-val" />
          <button type="button" onclick={() => removeEnvRow(i)} aria-label="remove env row">×</button>
        </div>
      {/each}
      <button type="button" class="add-env-btn" onclick={addEnvRow}>+ env var</button>
      {#if formError}<p class="error">{formError}</p>{/if}
      <div class="form-actions">
        <button type="button" onclick={() => { showForm = false; formError = '' }} disabled={formSaving}>Cancel</button>
        <button type="button" class="save-btn" onclick={handleSave} disabled={!formImage.trim() || formSaving} aria-label="save">
          {formSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {:else}
    <button type="button" class="add-btn" aria-label="add dependency" onclick={() => { showForm = true; formError = '' }}>+ Add Dependency</button>
  {/if}
</div>

<style>
  .deps-section { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; }
  .hint { font-size: 0.82rem; color: var(--fg-2); margin: 0; }
  .dep-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .dep-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.65rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; }
  .dep-name { font-family: var(--font-mono); font-size: 0.82rem; flex: 1; }
  .env-count { font-size: 0.72rem; color: var(--fg-2); }
  .del-btn { font-size: 0.78rem; padding: 0 0.4rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; }
  .del-btn:hover { color: var(--danger); border-color: var(--danger); }
  .del-btn.confirming { background: var(--danger); border-color: var(--danger); color: white; }
  .add-form { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.75rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; }
  .form-row { display: flex; gap: 0.5rem; }
  .form-row input { flex: 1; padding: 0.4rem 0.55rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-ui); font-size: 0.85rem; }
  .tag-input { flex: 0 0 80px; }
  .env-row { display: flex; align-items: center; gap: 0.3rem; }
  .env-key { flex: 0 0 120px; }
  .env-val { flex: 1; }
  .env-row input { padding: 0.3rem 0.45rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-size: 0.8rem; }
  .add-env-btn { font-size: 0.75rem; padding: 0.2rem 0.5rem; border: 1px dashed var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; align-self: flex-start; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.25rem; }
  .form-actions button { font-family: var(--font-ui); font-size: 0.82rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; }
  .save-btn { background: var(--accent); border-color: var(--accent); color: white; }
  .save-btn:disabled, .form-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .add-btn { font-family: var(--font-ui); font-size: 0.8rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; align-self: flex-start; }
  .add-btn:hover { color: var(--accent-hi); border-color: var(--accent); }
  .error { font-size: 0.78rem; color: var(--danger); margin: 0; }
</style>
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/DependenciesSection.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/DependenciesSection.svelte window-manager/tests/renderer/DependenciesSection.test.ts
git commit -m "feat(DependenciesSection): add/delete deps with validation error display"
```

---

## Task 8: ProjectView.svelte — Tabs + DependenciesSection

**Files:**
- Modify: `window-manager/src/renderer/src/components/ProjectView.svelte`
- Test: `window-manager/tests/renderer/ProjectView.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the existing `describe('ProjectView')` block in `tests/renderer/ProjectView.test.ts`:

```typescript
  describe('tabs', () => {
    it('renders Windows tab button', () => {
      render(ProjectView, baseProjectViewProps())
      expect(screen.getByRole('button', { name: /windows/i })).toBeDefined()
    })

    it('renders Dependencies tab button', () => {
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: vi.fn().mockResolvedValue(project),
        listDependencies: vi.fn().mockResolvedValue([])
      })
      render(ProjectView, baseProjectViewProps())
      expect(screen.getByRole('button', { name: /dependencies/i })).toBeDefined()
    })

    it('clicking Dependencies tab shows dep section', async () => {
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: vi.fn().mockResolvedValue(project),
        listDependencies: vi.fn().mockResolvedValue([])
      })
      render(ProjectView, baseProjectViewProps())
      await fireEvent.click(screen.getByRole('button', { name: /dependencies/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /add dependency/i })).toBeDefined())
    })
  })
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectView.test.ts
```

- [ ] **Step 3: Add tabs to ProjectView.svelte**

In the `<script>` block, add:

```typescript
  import DependenciesSection from './DependenciesSection.svelte'
  let activeTab = $state<'windows' | 'deps'>('windows')
```

In the template, replace the `<section class="windows-section">` opening with a tab bar + conditional content:

```svelte
  <div class="tab-bar">
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'windows'}
      aria-label="windows"
      onclick={() => { activeTab = 'windows' }}
    >Windows</button>
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'deps'}
      aria-label="dependencies"
      onclick={() => { activeTab = 'deps' }}
    >Dependencies</button>
  </div>

  {#if activeTab === 'windows'}
  <section class="windows-section">
    <!-- existing windows content unchanged -->
  </section>
  {:else}
  <DependenciesSection projectId={project.id} />
  {/if}
```

Add to `<style>`:

```css
  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    padding: 0 1.25rem;
    background: var(--bg-1);
  }
  .tab-btn {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.55rem 0.9rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
  }
  .tab-btn.active {
    color: var(--fg-0);
    border-bottom-color: var(--accent);
  }
```

- [ ] **Step 4: Run all ProjectView tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectView.test.ts
```

Expected: PASS (update mock in beforeEach to include `listDependencies: vi.fn().mockResolvedValue([])` if tests fail due to missing api method)

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/ProjectView.svelte window-manager/tests/renderer/ProjectView.test.ts
git commit -m "feat(ProjectView): add Windows/Dependencies tab bar with DependenciesSection"
```

---

## Task 9: NewWindowWizard.svelte — Deps Toggle

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Test: `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the existing test file `tests/renderer/NewWindowWizard.test.ts`:

```typescript
  describe('deps toggle', () => {
    it('does not show toggle when project has no deps', async () => {
      vi.stubGlobal('api', {
        listDependencies: vi.fn().mockResolvedValue([]),
        createWindow: vi.fn().mockResolvedValue({ id: 1, name: 'w', project_id: 1, container_id: 'c', created_at: '', status: 'running' }),
        onWindowCreateProgress: vi.fn(),
        offWindowCreateProgress: vi.fn()
      })
      render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel: vi.fn() })
      await waitFor(() => {}) // let onMount settle
      expect(screen.queryByRole('checkbox', { name: /start with dependencies/i })).toBeNull()
    })

    it('shows toggle when project has deps', async () => {
      vi.stubGlobal('api', {
        listDependencies: vi.fn().mockResolvedValue([{ id: 1, project_id: 1, image: 'postgres', tag: 'latest', env_vars: null, created_at: '' }]),
        createWindow: vi.fn().mockResolvedValue({ id: 1, name: 'w', project_id: 1, container_id: 'c', created_at: '', status: 'running' }),
        onWindowCreateProgress: vi.fn(),
        offWindowCreateProgress: vi.fn()
      })
      render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel: vi.fn() })
      await waitFor(() => expect(screen.getByRole('checkbox', { name: /start with dependencies/i })).toBeDefined())
    })

    it('passes withDeps=true to createWindow when toggle checked', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 1, name: 'w', project_id: 1, container_id: 'c', created_at: '', status: 'running' })
      vi.stubGlobal('api', {
        listDependencies: vi.fn().mockResolvedValue([{ id: 1, project_id: 1, image: 'postgres', tag: 'latest', env_vars: null, created_at: '' }]),
        createWindow: mockCreate,
        onWindowCreateProgress: vi.fn(),
        offWindowCreateProgress: vi.fn()
      })
      render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel: vi.fn() })
      await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
      await fireEvent.click(screen.getByRole('checkbox', { name: /start with dependencies/i }))
      await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'my-window' } })
      await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
      await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('my-window', project.id, true))
    })
  })
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewWindowWizard.test.ts
```

- [ ] **Step 3: Update NewWindowWizard.svelte**

In the `<script>` block, add:

```typescript
  import type { ProjectDependency } from '../types'
  import { onMount } from 'svelte'

  let deps = $state<ProjectDependency[]>([])
  let withDeps = $state(false)

  onMount(async () => {
    deps = await window.api.listDependencies(project.id)
  })
```

Change the `createWindow` call in `handleSubmit`:

```typescript
      const record = await window.api.createWindow(trimmed, project.id, withDeps)
```

In the template, add the toggle between the name field and the progress/error section:

```svelte
    {#if deps.length > 0}
      <label class="dep-toggle">
        <input type="checkbox" bind:checked={withDeps} disabled={loading} aria-label="start with dependencies" />
        Start with dependencies ({deps.length})
      </label>
    {/if}
```

Add to `<style>`:

```css
  .dep-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    cursor: pointer;
  }
  .dep-toggle input { cursor: pointer; }
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewWindowWizard.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat(NewWindowWizard): show deps toggle when project has dependencies"
```

---

## Task 10: DepLogsPane.svelte + WindowDetailPane Integration

**Files:**
- Create: `window-manager/src/renderer/src/components/DepLogsPane.svelte`
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/DepLogsPane.test.ts`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts` (additions)

- [ ] **Step 1: Write failing DepLogsPane tests**

```typescript
// tests/renderer/DepLogsPane.test.ts
import { render, screen, waitFor, cleanup } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import DepLogsPane from '../../src/renderer/src/components/DepLogsPane.svelte'

const mockDep: import('../../src/renderer/src/types').WindowDependencyContainer = {
  id: 1, window_id: 10, dependency_id: 1, container_id: 'dep-cid', created_at: ''
}

describe('DepLogsPane', () => {
  let mockStartDepLogs: ReturnType<typeof vi.fn>
  let mockStopDepLogs: ReturnType<typeof vi.fn>
  let mockOnDepLogsData: ReturnType<typeof vi.fn>
  let mockOffDepLogsData: ReturnType<typeof vi.fn>
  let mockListWindowDeps: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockStartDepLogs = vi.fn().mockResolvedValue(undefined)
    mockStopDepLogs = vi.fn()
    mockOnDepLogsData = vi.fn()
    mockOffDepLogsData = vi.fn()
    mockListWindowDeps = vi.fn().mockResolvedValue([mockDep])
    vi.stubGlobal('api', {
      listWindowDeps: mockListWindowDeps,
      startDepLogs: mockStartDepLogs,
      stopDepLogs: mockStopDepLogs,
      onDepLogsData: mockOnDepLogsData,
      offDepLogsData: mockOffDepLogsData
    })
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('calls startDepLogs for the first dep container on mount', async () => {
    render(DepLogsPane, { windowId: 10 })
    await waitFor(() => expect(mockStartDepLogs).toHaveBeenCalledWith(10, 'dep-cid'))
  })

  it('shows container id as tab label', async () => {
    render(DepLogsPane, { windowId: 10 })
    await waitFor(() => expect(screen.getByText('dep-cid')).toBeDefined())
  })

  it('calls stopDepLogs and offDepLogsData on destroy', async () => {
    const { unmount } = render(DepLogsPane, { windowId: 10 })
    await waitFor(() => expect(mockStartDepLogs).toHaveBeenCalled())
    unmount()
    expect(mockStopDepLogs).toHaveBeenCalledWith('dep-cid')
    expect(mockOffDepLogsData).toHaveBeenCalled()
  })

  it('shows empty message when no dep containers', async () => {
    mockListWindowDeps.mockResolvedValue([])
    render(DepLogsPane, { windowId: 10 })
    await waitFor(() => expect(screen.getByText(/no dependency containers/i)).toBeDefined())
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/DepLogsPane.test.ts
```

- [ ] **Step 3: Implement DepLogsPane.svelte**

```svelte
<!-- src/renderer/src/components/DepLogsPane.svelte -->
<script lang="ts">
  import type { WindowDependencyContainer } from '../types'
  import { onMount, onDestroy } from 'svelte'

  interface Props { windowId: number }
  let { windowId }: Props = $props()

  let deps = $state<WindowDependencyContainer[]>([])
  let selectedId = $state<string | null>(null)
  let logs = $state('')
  let logEl = $state<HTMLElement | null>(null)

  onMount(async () => {
    deps = await window.api.listWindowDeps(windowId)
    window.api.onDepLogsData((containerId, chunk) => {
      if (containerId === selectedId) {
        logs += chunk
        if (logEl) logEl.scrollTop = logEl.scrollHeight
      }
    })
    if (deps.length > 0) await selectDep(deps[0].container_id)
  })

  onDestroy(() => {
    if (selectedId) window.api.stopDepLogs(selectedId)
    window.api.offDepLogsData()
  })

  async function selectDep(containerId: string): Promise<void> {
    if (selectedId && selectedId !== containerId) window.api.stopDepLogs(selectedId)
    logs = ''
    selectedId = containerId
    await window.api.startDepLogs(windowId, containerId)
  }
</script>

<div class="dep-logs">
  {#if deps.length === 0}
    <p class="empty">No dependency containers for this window.</p>
  {:else}
    <div class="sub-tabs">
      {#each deps as dep (dep.container_id)}
        <button
          type="button"
          class="sub-tab"
          class:active={selectedId === dep.container_id}
          onclick={() => selectDep(dep.container_id)}
        >{dep.container_id.slice(0, 12)}</button>
      {/each}
    </div>
    <pre class="log-output" bind:this={logEl}>{logs || '(no output yet)'}</pre>
  {/if}
</div>

<style>
  .dep-logs { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .empty { font-size: 0.82rem; color: var(--fg-2); padding: 0.5rem; margin: 0; }
  .sub-tabs { display: flex; gap: 0.25rem; padding: 0.35rem 0.5rem; background: var(--bg-1); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .sub-tab { font-family: var(--font-mono); font-size: 0.72rem; padding: 0.18rem 0.5rem; border: 1px solid var(--border); background: var(--bg-2); color: var(--fg-2); border-radius: 4px; cursor: pointer; }
  .sub-tab.active { background: var(--accent); border-color: var(--accent); color: white; }
  .log-output { flex: 1; margin: 0; padding: 0.5rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--fg-1); background: var(--bg-0); overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
</style>
```

- [ ] **Step 4: Run DepLogsPane tests — expect pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/DepLogsPane.test.ts
```

- [ ] **Step 5: Add dep logs tab to WindowDetailPane.svelte**

In the `<script>` block, add:

```typescript
  import type { WindowDependencyContainer } from '../types'
  import DepLogsPane from './DepLogsPane.svelte'

  let depContainers = $state<WindowDependencyContainer[]>([])
  let showDepLogs = $state(false)

  // Load dep containers alongside branch refresh
```

In `onMount`, add after `void refreshBranch()`:

```typescript
    window.api.listWindowDeps(win.id).then(rows => { depContainers = rows }).catch(() => {})
```

In the template, add a 4th toggle button in `.toggle-row` after the existing three:

```svelte
    {#if depContainers.length > 0}
      <button
        type="button"
        class="toggle-btn"
        class:active={showDepLogs}
        aria-pressed={showDepLogs}
        onclick={() => { showDepLogs = !showDepLogs }}
      >Dep Logs</button>
    {/if}
```

After the `{#if summary}` block, add:

```svelte
  {#if showDepLogs && depContainers.length > 0}
    <div class="dep-logs-row">
      <DepLogsPane windowId={win.id} />
    </div>
  {/if}
```

Add to `<style>`:

```css
  .dep-logs-row {
    border-top: 1px solid var(--border);
    height: 200px;
    overflow: hidden;
  }
```

- [ ] **Step 6: Add WindowDetailPane tests for dep logs tab**

In `tests/renderer/WindowDetailPane.test.ts`, add a new describe block (check what the existing mock structure looks like and match it):

```typescript
  describe('dep logs tab', () => {
    it('does not show Dep Logs button when no dep containers', async () => {
      vi.stubGlobal('api', {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getGitStatus: vi.fn().mockResolvedValue(null),
        listWindowDeps: vi.fn().mockResolvedValue([])
      })
      render(WindowDetailPane, { win, project })
      await waitFor(() => {})
      expect(screen.queryByRole('button', { name: /dep logs/i })).toBeNull()
    })

    it('shows Dep Logs button when window has dep containers', async () => {
      vi.stubGlobal('api', {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getGitStatus: vi.fn().mockResolvedValue(null),
        listWindowDeps: vi.fn().mockResolvedValue([{ id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-cid', created_at: '' }])
      })
      render(WindowDetailPane, { win, project })
      await waitFor(() => expect(screen.getByRole('button', { name: /dep logs/i })).toBeDefined())
    })
  })
```

- [ ] **Step 7: Run all renderer tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/DepLogsPane.test.ts tests/renderer/WindowDetailPane.test.ts
```

Expected: PASS

- [ ] **Step 8: Run full test suite**

```bash
cd /workspace/claude-window/window-manager && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/DepLogsPane.svelte window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/DepLogsPane.test.ts window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(DepLogsPane, WindowDetailPane): dep logs streaming tab with container sub-selector"
```

---

## Task 11: Update CLAUDE.md

- [ ] **Step 1: Update the Codebase Structure section in `/home/node/.claude/CLAUDE.md`**

Add entries for the new files:
- `dependencyService.ts`: exports `listDependencies`, `createDependency`, `deleteDependency`, `listWindowDeps`, `validateImage`
- `depLogsService.ts`: exports `startLogs`, `stopLogs`, `stopAllLogs`
- `DependenciesSection.svelte`: props `projectId: number`; handles dep CRUD with inline form
- `DepLogsPane.svelte`: props `windowId: number`; streams logs for selected dep container

- [ ] **Step 2: Commit**

```bash
cd /workspace/claude-window && git add /home/node/.claude/CLAUDE.md
git commit -m "docs(CLAUDE.md): add dependencyService, depLogsService, DependenciesSection, DepLogsPane entries"
```
