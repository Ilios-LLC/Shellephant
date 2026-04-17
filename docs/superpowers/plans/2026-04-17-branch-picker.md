# Branch Picker for Window Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a window, each project shows a branch dropdown (loaded from the remote); picking a non-default branch checks it out directly instead of creating a slug branch.

**Architecture:** Add `listRemoteBranches` to gitOps.ts (host-side `git ls-remote --symref`), extend `createWindow` with optional `branchOverrides: Record<number, string>`, wire IPC, and update NewWindowWizard.svelte with per-project branch selects loaded in parallel on mount.

**Tech Stack:** TypeScript, Electron IPC, Svelte 5 runes, Vitest, Testing Library

---

## File Map

| File | Change |
|------|--------|
| `window-manager/src/main/gitOps.ts` | Add `listRemoteBranches` export |
| `window-manager/src/main/windowService.ts` | Add `branchOverrides` param + extract `setupProjectWorkspace` helper |
| `window-manager/src/main/ipcHandlers.ts` | Add `git:list-branches` handler, update `window:create` to pass `branchOverrides` |
| `window-manager/src/preload/index.ts` | Expose `listRemoteBranches`, update `createWindow` signature |
| `window-manager/src/renderer/src/components/NewWindowWizard.svelte` | Add branch fetch state + per-project selects |
| `window-manager/tests/main/gitOps.test.ts` | Add tests for `listRemoteBranches` |
| `window-manager/tests/main/windowService.test.ts` | Add tests for `branchOverrides` behavior |
| `window-manager/tests/renderer/NewWindowWizard.test.ts` | Add branch picker tests + update existing assertions |

---

## Task 1: `listRemoteBranches` in gitOps.ts

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Test: `window-manager/tests/main/gitOps.test.ts`

- [ ] **Step 1: Write failing tests for `listRemoteBranches`**

Append to `window-manager/tests/main/gitOps.test.ts`:

```typescript
import {
  remoteBranchExists,
  execInContainer,
  cloneInContainer,
  checkoutSlug,
  getCurrentBranch,
  listRemoteBranches
} from '../../src/main/gitOps'

// (add inside or after existing describe blocks)
describe('listRemoteBranches', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('parses defaultBranch from symref line', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'ref: refs/heads/main\tHEAD\nabc123\tHEAD\nabc123\trefs/heads/main\ndef456\trefs/heads/develop\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('main')
  })

  it('returns branch list sorted with default branch first', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'ref: refs/heads/main\tHEAD\nabc123\tHEAD\ndef456\trefs/heads/develop\nabc123\trefs/heads/main\nghi789\trefs/heads/feature/x\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.branches[0]).toBe('main')
    expect(result.branches).toContain('develop')
    expect(result.branches).toContain('feature/x')
  })

  it('falls back to first alphabetical branch when no symref line present', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'abc123\tHEAD\nabc123\trefs/heads/main\ndef456\trefs/heads/develop\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('develop')
  })

  it('returns defaultBranch "main" and empty branches for empty output', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('main')
    expect(result.branches).toEqual([])
  })

  it('uses HTTPS URL with PAT and passes --symref flag', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    const call = mockExecFile.mock.calls[0]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual([
      'ls-remote',
      '--symref',
      'https://PAT@github.com/org/repo.git',
      'HEAD',
      'refs/heads/*'
    ])
  })

  it('rejects with scrubbed error on git failure', async () => {
    const err = Object.assign(new Error('auth failed for https://PAT@github.com/org/repo.git'), { code: 128 })
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => cb(err, '', ''))
    const rejection = await listRemoteBranches('git@github.com:org/repo.git', 'PAT').catch(e => e)
    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.message).not.toContain('PAT')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd window-manager && npx vitest run tests/main/gitOps.test.ts
```

Expected: FAIL — `listRemoteBranches is not a function` or similar.

- [ ] **Step 3: Implement `listRemoteBranches` in gitOps.ts**

Add after the `remoteBranchExists` function (before `cloneInContainer`):

```typescript
export async function listRemoteBranches(
  sshUrl: string,
  pat: string
): Promise<{ defaultBranch: string; branches: string[] }> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      ['ls-remote', '--symref', httpsUrl, 'HEAD', 'refs/heads/*'],
      { timeout: 15_000 },
      (err, out) => {
        if (err) {
          const scrubbed = new Error(scrubPat(err.message, pat))
          const origCode = (err as NodeJS.ErrnoException).code
          if (origCode !== undefined) (scrubbed as NodeJS.ErrnoException).code = origCode
          reject(scrubbed)
        } else {
          resolve(String(out ?? ''))
        }
      }
    )
  })

  let defaultBranch = ''
  const branches: string[] = []

  for (const line of stdout.split('\n')) {
    const symrefMatch = line.match(/^ref: refs\/heads\/(\S+)\tHEAD$/)
    if (symrefMatch) { defaultBranch = symrefMatch[1]; continue }
    const refMatch = line.match(/^[0-9a-f]+\trefs\/heads\/(.+)$/)
    if (refMatch) branches.push(refMatch[1])
  }

  branches.sort()
  if (!defaultBranch) defaultBranch = branches[0] ?? 'main'

  return {
    defaultBranch,
    branches: [defaultBranch, ...branches.filter(b => b !== defaultBranch)]
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
cd window-manager && npx vitest run tests/main/gitOps.test.ts
```

Expected: all gitOps tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat: add listRemoteBranches to gitOps"
```

---

## Task 2: `createWindow` with `branchOverrides` in windowService.ts

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Test: `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write failing tests for `branchOverrides`**

Find the existing `describe('createWindow', ...)` block in `window-manager/tests/main/windowService.test.ts` and append these tests inside it (before the closing `}`). Also update the mock for `gitOps` in `windowServiceDeps.test.ts` (handled in Step 3).

In `window-manager/tests/main/windowService.test.ts`, the gitOps functions are called via `execFile` (mocked via `child_process`). The `checkoutSlug` call goes through `execInContainer`, which calls `container.exec`. To verify which checkout args were used, inspect `mockContainerExec` call args.

Instead of doing that (fragile), add a dedicated test file: `window-manager/tests/main/windowServiceBranch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/main/docker', () => ({ getDocker: vi.fn() }))
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: vi.fn(() => 'pat'),
  getClaudeToken: vi.fn(() => 'token')
}))

const mockCheckoutSlug = vi.fn(async () => {})
const mockRemoteBranchExists = vi.fn(async () => false)
const mockCloneInContainer = vi.fn(async () => {})
const mockExecInContainer = vi.fn(async () => ({ ok: true, stdout: '' }))
const mockApplyGitIdentityInContainer = vi.fn(async () => {})

vi.mock('../../src/main/gitOps', () => ({
  remoteBranchExists: (...args: unknown[]) => mockRemoteBranchExists(...args),
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args),
  cloneInContainer: (...args: unknown[]) => mockCloneInContainer(...args),
  checkoutSlug: (...args: unknown[]) => mockCheckoutSlug(...args),
  applyGitIdentityInContainer: (...args: unknown[]) => mockApplyGitIdentityInContainer(...args)
}))
vi.mock('../../src/main/terminalService', () => ({ closeTerminalSessionFor: vi.fn() }))
vi.mock('../../src/main/dependencyService', () => ({
  listDependencies: vi.fn(() => []),
  listWindowDepContainers: vi.fn(() => [])
}))
vi.mock('../../src/main/gitUrl', () => ({
  extractRepoName: vi.fn(() => 'repo'),
  sshUrlToHttps: vi.fn((url: string) => url),
  isValidSshUrl: vi.fn(() => true),
  buildPrUrl: vi.fn(() => '')
}))
vi.mock('../../src/main/githubIdentity', () => ({
  getIdentity: vi.fn(async () => ({ name: 'Test User', email: 'test@example.com' }))
}))

import { initDb, closeDb, getDb } from '../../src/main/db'
import { createWindow, __resetStatusMapForTests } from '../../src/main/windowService'
import { getDocker } from '../../src/main/docker'

function makeContainer(id = 'ctr-id') {
  return {
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({ NetworkSettings: { Ports: {} } })),
    exec: vi.fn(async () => ({
      start: vi.fn(async () => ({
        on: (event: string, cb: (...a: unknown[]) => void) => {
          if (event === 'end') setImmediate(() => cb())
          return { on: () => ({}) }
        }
      })),
      inspect: vi.fn(async () => ({ ExitCode: 0 }))
    }))
  }
}

function seedProject(gitUrl: string, name = 'test'): number {
  return (getDb()
    .prepare('INSERT INTO projects (name, git_url) VALUES (?, ?)')
    .run(name, gitUrl).lastInsertRowid) as number
}

describe('createWindow branchOverrides', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    vi.clearAllMocks()
    const ctr = makeContainer()
    ;(getDocker as ReturnType<typeof vi.fn>).mockReturnValue({
      createContainer: vi.fn(async () => ctr),
      getContainer: vi.fn(() => ctr)
    })
  })

  afterEach(() => { closeDb() })

  it('calls checkoutSlug with slug and remoteHasSlug when no override given', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    mockRemoteBranchExists.mockResolvedValue(true)
    await createWindow('my-win', id, false, {})
    expect(mockCheckoutSlug).toHaveBeenCalledWith(
      expect.anything(), '/workspace/repo', 'my-win', true
    )
  })

  it('calls checkoutSlug with override branch and remoteHasSlug=true when override given', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    await createWindow('my-win', id, false, { [id]: 'feature/existing' })
    expect(mockCheckoutSlug).toHaveBeenCalledWith(
      expect.anything(), '/workspace/repo', 'feature/existing', true
    )
  })

  it('does not call remoteBranchExists for projects with overrides', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    await createWindow('my-win', id, false, { [id]: 'feature/existing' })
    expect(mockRemoteBranchExists).not.toHaveBeenCalled()
  })

  it('handles mixed: override for one project, slug behavior for another', async () => {
    const id1 = seedProject('git@github.com:org/repo1.git', 'p1')
    const id2 = seedProject('git@github.com:org/repo2.git', 'p2')
    mockRemoteBranchExists.mockResolvedValue(false)
    await createWindow('my-win', [id1, id2], false, { [id1]: 'feature/pick' })
    const calls = mockCheckoutSlug.mock.calls
    const p1Call = calls.find(c => c[2] === 'feature/pick')
    const p2Call = calls.find(c => c[2] === 'my-win')
    expect(p1Call).toBeDefined()
    expect(p1Call![3]).toBe(true)
    expect(p2Call).toBeDefined()
    expect(p2Call![3]).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd window-manager && npx vitest run tests/main/windowServiceBranch.test.ts
```

Expected: FAIL — `createWindow` does not accept `branchOverrides`.

- [ ] **Step 3: Update `createWindow` signature and add `setupProjectWorkspace` helper**

In `window-manager/src/main/windowService.ts`:

**3a.** Change the `createWindow` signature (line 156-161) to:

```typescript
export async function createWindow(
  name: string,
  projectIds: number | number[],
  withDeps: boolean = false,
  branchOverrides: Record<number, string> = {},
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
```

**3b.** Add the `setupProjectWorkspace` helper function before `createWindow`:

```typescript
async function setupProjectWorkspace(
  container: Dockerode.Container,
  cfg: ProjectConfig,
  pat: string,
  remoteHasSlug: boolean,
  branchOverride: string | undefined,
  onProgress: ProgressReporter,
  isMulti: boolean
): Promise<void> {
  const repoLabel = cfg.gitUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo'
  onProgress(isMulti ? `Preparing ${repoLabel}…` : 'Preparing workspace…')
  const mkdir = await execInContainer(container, ['mkdir', '-p', cfg.clonePath])
  if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.stdout}`)
  onProgress(isMulti ? `Cloning ${repoLabel}…` : 'Cloning repository in container…')
  await cloneInContainer(container, cfg.gitUrl, pat, cfg.clonePath)
  onProgress('Checking out branch…')
  if (branchOverride) {
    await checkoutSlug(container, cfg.clonePath, branchOverride, true)
  } else {
    await checkoutSlug(container, cfg.clonePath, cfg.slug, remoteHasSlug)
  }
}
```

**3c.** Replace the `remoteChecks` computation in `createWindow` (currently lines 186-189):

```typescript
  onProgress('Probing remote for branch…')
  const remoteChecks = await Promise.all(
    projectConfigs.map((cfg, i) => {
      if (branchOverrides[ids[i]]) return Promise.resolve(false)
      return remoteBranchExists(cfg.gitUrl, cfg.slug, pat)
    })
  )
```

**3d.** Replace the inner project loop (currently lines 221-233):

```typescript
    for (let i = 0; i < projectConfigs.length; i++) {
      const cfg = projectConfigs[i]
      const branchOverride = branchOverrides[ids[i]]
      await setupProjectWorkspace(container, cfg, pat, remoteChecks[i], branchOverride, onProgress, isMulti)
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```
cd window-manager && npx vitest run tests/main/windowServiceBranch.test.ts
```

Expected: all 4 branch tests pass.

- [ ] **Step 5: Run full test suite to confirm nothing regressed**

```
cd window-manager && npx vitest run tests/main/windowService.test.ts tests/main/windowServiceDeps.test.ts tests/main/windowServiceBranch.test.ts
```

Expected: all tests pass. If `windowServiceDeps.test.ts` fails due to signature change, its mock already calls `createWindow(name, projectIds, withDeps)` — the new `branchOverrides` param has a default of `{}` so it's backward compatible.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowServiceBranch.test.ts
git commit -m "feat: add branchOverrides param to createWindow"
```

---

## Task 3: IPC Wiring

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

No new tests needed — IPC handlers are thin wiring; behavior tested via unit tests in Tasks 1–2 and UI tests in Task 4.

- [ ] **Step 1: Update `ipcHandlers.ts`**

**1a.** Add `listRemoteBranches` to the gitOps import (line 19):

```typescript
import { getCurrentBranch, stageAndCommit, push as gitPush, listContainerDir, readContainerFile, writeFileInContainer, getGitStatus, execInContainer, listRemoteBranches } from './gitOps'
```

**1b.** Update the `window:create` handler (line 85–87) to pass `branchOverrides`:

```typescript
  ipcMain.handle('window:create', (event, name: string, projectIds: number[], withDeps = false, branchOverrides: Record<number, string> = {}) =>
    createWindow(name, projectIds, withDeps, branchOverrides, (step) => event.sender.send('window:create-progress', step))
  )
```

**1c.** Add the `git:list-branches` handler after the existing `git:status-project` handler (after line 198):

```typescript
  ipcMain.handle('git:list-branches', async (_, gitUrl: string) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    return listRemoteBranches(gitUrl, pat)
  })
```

- [ ] **Step 2: Update `preload/index.ts`**

**2a.** Update `createWindow` in the `contextBridge.exposeInMainWorld` call (line 22–23):

```typescript
  createWindow: (name: string, projectIds: number[], withDeps: boolean = false, branchOverrides: Record<number, string> = {}) =>
    ipcRenderer.invoke('window:create', name, projectIds, withDeps, branchOverrides),
```

**2b.** Add `listRemoteBranches` after the `push` entry in the Git API section (after line 43):

```typescript
  listRemoteBranches: (gitUrl: string) =>
    ipcRenderer.invoke('git:list-branches', gitUrl),
```

- [ ] **Step 3: Verify TypeScript compiles**

```
cd window-manager && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts
git commit -m "feat: wire listRemoteBranches and branchOverrides IPC"
```

---

## Task 4: NewWindowWizard.svelte Branch Picker UI

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Modify: `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 1: Update tests — add `listRemoteBranches` mock and new branch picker tests**

Replace the `beforeEach` in `window-manager/tests/renderer/NewWindowWizard.test.ts` to include `listRemoteBranches`, and update existing `createWindow` assertions to include the 4th `branchOverrides` arg. Also add new tests.

The full updated file:

```typescript
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1, name: 'my-project', git_url: 'https://github.com/x/y', created_at: ''
}

const mockWindow: WindowRecord = {
  id: 10, name: 'dev', project_id: 1, container_id: 'abc', created_at: '', status: 'running', projects: []
}

function baseProps(overrides = {}) {
  return { project, onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
}

let mockListDeps: ReturnType<typeof vi.fn>
let mockCreateWindow: ReturnType<typeof vi.fn>
let mockOnProgress: ReturnType<typeof vi.fn>
let mockOffProgress: ReturnType<typeof vi.fn>
let mockListRemoteBranches: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDeps = vi.fn().mockResolvedValue([])
  mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
  mockOnProgress = vi.fn()
  mockOffProgress = vi.fn()
  mockListRemoteBranches = vi.fn().mockResolvedValue({
    defaultBranch: 'main',
    branches: ['main', 'develop', 'feature/x']
  })
  vi.stubGlobal('api', {
    listDependencies: mockListDeps,
    createWindow: mockCreateWindow,
    onWindowCreateProgress: mockOnProgress,
    offWindowCreateProgress: mockOffProgress,
    listRemoteBranches: mockListRemoteBranches
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

  it('shows branch select with options loaded from listRemoteBranches', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i })
      expect(select).toBeDefined()
      expect((select as HTMLSelectElement).options.length).toBe(3)
    })
  })

  it('default branch is pre-selected in branch select', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
      expect(select.value).toBe('main')
    })
  })

  it('shows disabled select with "(default)" text when branch fetch fails', async () => {
    mockListRemoteBranches.mockRejectedValue(new Error('network error'))
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
      expect(select.disabled).toBe(true)
    })
  })

  it('calls createWindow with empty branchOverrides when default branch selected', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, {})
    )
  })

  it('calls createWindow with branchOverrides when non-default branch selected', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.change(screen.getByRole('combobox', { name: /branch/i }), { target: { value: 'develop' } })
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, { 1: 'develop' })
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, {}))
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], true, {}))
  })
})

describe('multi-project mode', () => {
  const p1: ProjectRecord = { id: 1, name: 'project-one', git_url: 'https://github.com/x/a', created_at: '' }
  const p2: ProjectRecord = { id: 2, name: 'project-two', git_url: 'https://github.com/x/b', created_at: '' }
  const p3: ProjectRecord = { id: 3, name: 'project-three', git_url: 'https://github.com/x/c', created_at: '' }

  function multiProps(overrides = {}) {
    return { projects: [p1, p2, p3], onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
  }

  it('renders checkboxes for each project, all unchecked by default', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(3)
      checkboxes.forEach(cb => expect((cb as HTMLInputElement).checked).toBe(false))
    })
  })

  it('checking a project adds it to selection', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-three' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1, 3], false, {})
    )
  })

  it('Create button is disabled when no projects are selected', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    const createBtn = screen.getByRole('button', { name: /create window/i })
    expect((createBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls createWindow with selectedProjectIds when Create is clicked', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-two' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'multi-win' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('multi-win', [1, 2], false, {})
    )
  })

  it('each project row has a branch select loaded from listRemoteBranches', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox')
      expect(selects).toHaveLength(3)
    })
  })

  it('passes branchOverrides for project where non-default branch selected', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('combobox'))
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    await fireEvent.change(selects[1], { target: { value: 'develop' } })
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-two' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'multi-win' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('multi-win', [1, 2], false, { 2: 'develop' })
    )
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts
```

Expected: FAIL — existing tests fail because `createWindow` is called without 4th arg, new tests fail because branch select doesn't exist.

- [ ] **Step 3: Update NewWindowWizard.svelte**

Replace the entire content of `window-manager/src/renderer/src/components/NewWindowWizard.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord, WindowRecord, ProjectDependency } from '../types'

  interface Props {
    project?: ProjectRecord
    projects?: ProjectRecord[]
    onCreated: (win: WindowRecord) => void
    onCancel: () => void
  }

  let { project, projects, onCreated, onCancel }: Props = $props()

  const isMultiMode = $derived((projects?.length ?? 0) > 0)

  let name = $state('')
  let loading = $state(false)
  let progress = $state('')
  let error = $state('')
  let hasDeps = $state(false)
  let withDeps = $state(false)
  let selectedProjectIds = $state<number[]>([])

  let branchOptions = $state<Record<number, string[]>>({})
  let branchLoading = $state<Record<number, boolean>>({})
  let branchSelections = $state<Record<number, string>>({})
  let defaultBranches = $state<Record<number, string>>({})

  async function fetchBranches(projectId: number, gitUrl: string): Promise<void> {
    branchLoading = { ...branchLoading, [projectId]: true }
    try {
      const result = await window.api.listRemoteBranches(gitUrl)
      branchOptions = { ...branchOptions, [projectId]: result.branches }
      defaultBranches = { ...defaultBranches, [projectId]: result.defaultBranch }
      branchSelections = { ...branchSelections, [projectId]: result.defaultBranch }
    } catch {
      branchOptions = { ...branchOptions, [projectId]: [] }
    } finally {
      branchLoading = { ...branchLoading, [projectId]: false }
    }
  }

  onMount(async () => {
    if (!isMultiMode && project) {
      const deps: ProjectDependency[] = await window.api.listDependencies(project.id)
      hasDeps = deps.length > 0
      fetchBranches(project.id, project.git_url)
    } else if (isMultiMode && projects) {
      for (const p of projects) fetchBranches(p.id, p.git_url)
    }
  })

  function toggleProject(id: number): void {
    if (selectedProjectIds.includes(id)) {
      selectedProjectIds = selectedProjectIds.filter(pid => pid !== id)
    } else {
      selectedProjectIds = [...selectedProjectIds, id]
    }
  }

  const createDisabled = $derived(
    !name.trim() || loading || (isMultiMode && selectedProjectIds.length === 0)
  )

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || loading) return
    if (isMultiMode && selectedProjectIds.length === 0) return
    loading = true
    error = ''
    progress = 'Preparing…'
    window.api.onWindowCreateProgress((step) => {
      progress = step
    })
    try {
      const ids = isMultiMode ? $state.snapshot(selectedProjectIds) : [project!.id]
      const branchOverrides: Record<number, string> = {}
      for (const id of ids) {
        const selected = branchSelections[id]
        const def = defaultBranches[id]
        if (selected && def && selected !== def) branchOverrides[id] = selected
      }
      const record = await window.api.createWindow(trimmed, ids, withDeps, branchOverrides)
      onCreated(record)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      window.api.offWindowCreateProgress()
      loading = false
      progress = ''
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') handleSubmit()
    else if (e.key === 'Escape') onCancel()
  }
</script>

<div class="wizard">
  <div class="wizard-card">
    <header class="wizard-header">
      <h2>New Window</h2>
      {#if isMultiMode}
        <p class="subtitle">Select projects for this window.</p>
      {:else}
        <p class="subtitle">Start a new container for <strong>{project?.name}</strong>.</p>
      {/if}
    </header>

    <div class="field">
      <label for="window-name">Name</label>
      <input
        id="window-name"
        type="text"
        placeholder="dev-window"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
        autofocus
      />
    </div>

    {#if !isMultiMode && project}
      <div class="field">
        <label for="branch-select-{project.id}" id="branch-label-{project.id}">Branch</label>
        {#if branchLoading[project.id]}
          <select id="branch-select-{project.id}" aria-label="Branch" disabled>
            <option>loading…</option>
          </select>
        {:else if branchOptions[project.id]?.length}
          <select
            id="branch-select-{project.id}"
            aria-label="Branch"
            value={branchSelections[project.id]}
            onchange={(e) => { branchSelections = { ...branchSelections, [project!.id]: (e.target as HTMLSelectElement).value } }}
            disabled={loading}
          >
            {#each branchOptions[project.id] as branch}
              <option value={branch}>{branch}</option>
            {/each}
          </select>
        {:else}
          <select id="branch-select-{project.id}" aria-label="Branch" disabled>
            <option>(default)</option>
          </select>
        {/if}
      </div>
    {/if}

    {#if isMultiMode}
      <div class="project-list">
        <span class="field-label">Projects</span>
        {#each projects as p}
          <div class="project-row">
            <label class="project-toggle">
              <input
                type="checkbox"
                checked={selectedProjectIds.includes(p.id)}
                onchange={() => toggleProject(p.id)}
                disabled={loading}
              />
              {p.name}
            </label>
            {#if branchLoading[p.id]}
              <select aria-label="Branch" disabled class="branch-select-inline">
                <option>loading…</option>
              </select>
            {:else if branchOptions[p.id]?.length}
              <select
                aria-label="Branch"
                value={branchSelections[p.id]}
                onchange={(e) => { branchSelections = { ...branchSelections, [p.id]: (e.target as HTMLSelectElement).value } }}
                disabled={loading}
                class="branch-select-inline"
              >
                {#each branchOptions[p.id] as branch}
                  <option value={branch}>{branch}</option>
                {/each}
              </select>
            {:else}
              <select aria-label="Branch" disabled class="branch-select-inline">
                <option>(default)</option>
              </select>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if !isMultiMode && hasDeps}
      <label class="dep-toggle">
        <input type="checkbox" bind:checked={withDeps} disabled={loading} aria-label="Start with dependencies" />
        Start with dependencies
      </label>
    {/if}

    {#if loading && progress}
      <p class="progress" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        {progress}
      </p>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel} disabled={loading}>Cancel</button>
      <button
        type="button"
        class="submit"
        onclick={handleSubmit}
        disabled={createDisabled}
      >
        {loading ? 'Creating…' : 'Create Window'}
      </button>
    </div>
  </div>
</div>

<style>
  .wizard {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    overflow-y: auto;
  }

  .wizard-card {
    width: 100%;
    max-width: 420px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .wizard-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .subtitle {
    font-size: 0.82rem;
    color: var(--fg-2);
    margin: 0;
  }

  strong {
    color: var(--fg-1);
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  input[type="text"] {
    width: 100%;
    padding: 0.5rem 0.65rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.9rem;
    outline: none;
  }

  input[type="text"]:focus {
    border-color: var(--accent);
  }

  select {
    width: 100%;
    padding: 0.5rem 0.65rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.9rem;
    outline: none;
  }

  select:focus {
    border-color: var(--accent);
  }

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .project-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .project-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .project-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    cursor: pointer;
    font-family: var(--font-ui);
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
    flex: 1;
  }

  .project-toggle input {
    width: auto;
    cursor: pointer;
  }

  .branch-select-inline {
    width: auto;
    flex: 0 0 130px;
    font-size: 0.78rem;
    padding: 0.3rem 0.5rem;
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
    padding: 0.45rem 0.9rem;
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

  .submit:disabled,
  .cancel:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    margin: 0;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

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
</style>
```

- [ ] **Step 4: Run renderer tests**

```
cd window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```
cd window-manager && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat: add per-project branch picker to NewWindowWizard"
```
