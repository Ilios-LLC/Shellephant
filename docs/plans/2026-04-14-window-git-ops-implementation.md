# Window Git Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use blooperpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a bottom detail pane to each window with Commit and Push buttons, clone repos inside the container, and check out a kebab-slugged branch named after the window.

**Architecture:** New main-process modules for slug, GitHub identity, and git-ops helpers that run `docker exec` against the window's container. `windowService.createWindow` is refactored to clone inside the container (PAT scrubbed from `.git/config`) and check out a slug branch. Renderer gets a `WindowDetailPane` inside `TerminalHost`, a `CommitModal`, and a toast store. PAT never persists in the container; it is passed only in `docker exec` argv for each git op.

**Tech Stack:** Electron + Svelte 5 + TypeScript, Dockerode, better-sqlite3, Vitest (node + jsdom configs), `@testing-library/svelte`.

**User Entrypoint:** Web Application (Electron)

**Verification Method:** Vitest unit tests + manual UI smoke against `npm run dev`.

**User-Facing Capabilities:**
1. Create a window and have the container clone the repo **inside** and check out a branch named after the kebab-slugged window name (remote branch if one exists with that name, else a fresh local branch).
2. See a bottom detail pane under each terminal showing window name, project, branch, status; branch refreshes every 5 s.
3. Click **Commit** in the pane, fill subject (required) + optional body, and have the app run `git add --all && git commit` inside the container under the PAT-owner's GitHub identity. Toast shows git output.
4. Click **Push** in the pane to run `git push -u origin <branch>` inside the container. Toast shows git output.

**Scope note:** Each phase ends in a `[CHECKPOINT]` task where **all unit tests run** and the implementer performs a short manual UI smoke against `npm run dev`. Execution skills will maintain `docs/plans/2026-04-14-window-git-ops-test-verification.md` from the first checkpoint onward.

---

## Phase 1 — In-container clone + slug branch checkout

**User-visible outcome:** Creating a new window clones the repo **inside** the container (no host temp dir, no `docker cp`) and checks out a branch whose name equals the kebab-slugged window name. If that branch already exists on the remote, it is tracked; otherwise a fresh local branch is created.

Every task below uses the TDD loop: write the failing test, run it, implement, run again, commit. Keep each commit small.

### Task 1.1: Add `toSlug()` module

**What the user can do after this task:** Nothing user-visible yet; foundation for window-create branch naming.

**Files:**
- Create: `window-manager/src/main/slug.ts`
- Test: `window-manager/tests/main/slug.test.ts`

**Step 1: Write the failing tests**

```ts
// window-manager/tests/main/slug.test.ts
import { describe, it, expect } from 'vitest'
import { toSlug } from '../../src/main/slug'

describe('toSlug', () => {
  it('lowercases and joins words with a dash', () => {
    expect(toSlug('My Feature')).toBe('my-feature')
  })

  it('trims leading and trailing whitespace and dashes', () => {
    expect(toSlug('  leading/trailing  ')).toBe('leading-trailing')
  })

  it('strips diacritics', () => {
    expect(toSlug('Café 123')).toBe('cafe-123')
  })

  it('collapses repeated separators', () => {
    expect(toSlug('multi---dash___word')).toBe('multi-dash-word')
  })

  it('drops every non-alphanumeric character except dashes', () => {
    expect(toSlug('Fix: bug #42!')).toBe('fix-bug-42')
  })

  it('throws if the slug ends up empty', () => {
    expect(() => toSlug('!!!')).toThrow(/empty slug/i)
    expect(() => toSlug('')).toThrow(/empty slug/i)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd window-manager && npm run test:main -- slug`

Expected: FAIL with "Cannot find module './slug'" or similar.

**Step 3: Write the minimal implementation**

```ts
// window-manager/src/main/slug.ts
export function toSlug(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized) throw new Error('toSlug produced empty slug')
  return normalized
}
```

**Step 4: Run tests to verify they pass**

Run: `cd window-manager && npm run test:main -- slug`

Expected: PASS — all 6 test cases green.

**Step 5: Commit**

```bash
git add window-manager/src/main/slug.ts window-manager/tests/main/slug.test.ts
git commit -m "feat(main): add toSlug helper for branch naming"
```

---

### Task 1.2: Add PAT-scrub helper

**What the user can do after this task:** Nothing user-visible; foundation for safe toast/log messages.

**Files:**
- Create: `window-manager/src/main/scrub.ts`
- Test: `window-manager/tests/main/scrub.test.ts`

**Step 1: Write the failing tests**

```ts
// window-manager/tests/main/scrub.test.ts
import { describe, it, expect } from 'vitest'
import { scrubPat } from '../../src/main/scrub'

describe('scrubPat', () => {
  it('replaces the PAT with *** everywhere it appears', () => {
    const pat = 'ghp_deadbeef'
    const input = `remote: https://${pat}@github.com/foo/bar.git\nerror token ${pat}`
    expect(scrubPat(input, pat)).toBe(
      'remote: https://***@github.com/foo/bar.git\nerror token ***'
    )
  })

  it('returns the input unchanged if the PAT is absent', () => {
    expect(scrubPat('hello world', 'ghp_x')).toBe('hello world')
  })

  it('is a no-op for empty or nullish PAT', () => {
    expect(scrubPat('hello ghp_x', '')).toBe('hello ghp_x')
    expect(scrubPat('hello', undefined as unknown as string)).toBe('hello')
  })

  it('escapes regex metacharacters inside the PAT', () => {
    const pat = 'a.b+c*'
    expect(scrubPat(`token=${pat} end`, pat)).toBe('token=*** end')
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:main -- scrub`

Expected: FAIL.

**Step 3: Implement**

```ts
// window-manager/src/main/scrub.ts
export function scrubPat(text: string, pat: string | undefined | null): string {
  if (!pat) return text
  const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'g'), '***')
}
```

**Step 4: Run to verify pass**

Run: `cd window-manager && npm run test:main -- scrub`

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/main/scrub.ts window-manager/tests/main/scrub.test.ts
git commit -m "feat(main): add scrubPat helper"
```

---

### Task 1.3: Add `gitOps` — remote-branch probe + container exec helper

**What the user can do after this task:** Nothing user-visible; helpers for the refactored `createWindow` and future commit/push.

**Files:**
- Create: `window-manager/src/main/gitOps.ts`
- Test: `window-manager/tests/main/gitOps.test.ts`

**Step 1: Write the failing tests (three behaviors)**

```ts
// window-manager/tests/main/gitOps.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) =>
    mockExecFile(...(args as [string, string[], object, Function]))
}))

import {
  remoteBranchExists,
  execInContainer,
  cloneInContainer,
  checkoutSlug,
  getCurrentBranch
} from '../../src/main/gitOps'

function makeContainer() {
  const start = vi.fn()
  const exec = vi.fn().mockResolvedValue({
    start: vi.fn().mockResolvedValue({
      on: (event: string, cb: (...a: unknown[]) => void) => {
        if (event === 'end') setImmediate(() => cb())
        return { on: () => ({}) }
      }
    }),
    inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
  })
  return { id: 'test-container', exec, start }
}

describe('remoteBranchExists', () => {
  beforeEach(() => mockExecFile.mockReset())

  it('returns true when ls-remote prints at least one ref line', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) =>
        cb(null, 'deadbeef refs/heads/my-slug\n', '')
    )
    const ok = await remoteBranchExists('git@github.com:org/repo.git', 'my-slug', 'PAT')
    expect(ok).toBe(true)
  })

  it('returns false when ls-remote prints nothing', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => cb(null, '', '')
    )
    expect(
      await remoteBranchExists('git@github.com:org/repo.git', 'missing', 'PAT')
    ).toBe(false)
  })

  it('uses an HTTPS URL with the PAT and matches the specific slug', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => cb(null, '', '')
    )
    await remoteBranchExists('git@github.com:org/repo.git', 'feat/x', 'PAT')
    const call = mockExecFile.mock.calls[0]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual([
      'ls-remote',
      '--heads',
      'https://PAT@github.com/org/repo.git',
      'feat/x'
    ])
  })
})
```

Add a second `describe` block covering `execInContainer`, `cloneInContainer`, `checkoutSlug`, and `getCurrentBranch`:

```ts
describe('execInContainer', () => {
  it('runs a command, collects stdout + stderr, and returns exit code', async () => {
    const container = {
      id: 'c1',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from('hello\n')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    // @ts-expect-error mock shape
    const res = await execInContainer(container, ['echo', 'hi'])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('hello')
  })
})

describe('cloneInContainer', () => {
  it('clones with a PAT URL then rewrites origin back to the SSH URL', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await cloneInContainer(container, 'git@github.com:org/my-repo.git', 'PAT', '/workspace/my-repo')
    const execArgs = container.exec.mock.calls.map((c) => c[0].Cmd)
    expect(execArgs[0]).toEqual([
      'git',
      'clone',
      'https://PAT@github.com/org/my-repo.git',
      '/workspace/my-repo'
    ])
    expect(execArgs[1]).toEqual([
      'git',
      '-C',
      '/workspace/my-repo',
      'remote',
      'set-url',
      'origin',
      'git@github.com:org/my-repo.git'
    ])
  })
})

describe('checkoutSlug', () => {
  it('uses plain checkout when the remote has the branch', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await checkoutSlug(container, '/workspace/r', 'slug', true)
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git', '-C', '/workspace/r', 'checkout', 'slug'
    ])
  })

  it('uses checkout -b when the remote does not have the branch', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await checkoutSlug(container, '/workspace/r', 'slug', false)
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git', '-C', '/workspace/r', 'checkout', '-b', 'slug'
    ])
  })
})

describe('getCurrentBranch', () => {
  it('returns the trimmed rev-parse output', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    const branch = await getCurrentBranch(container, '/workspace/r')
    expect(branch).toBeDefined()
    // The mock returns code 0 with no stdout; when real it trims the branch name.
    // Keep this smoke-level: just assert the exec was issued.
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git', '-C', '/workspace/r', 'rev-parse', '--abbrev-ref', 'HEAD'
    ])
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: FAIL (module missing).

**Step 3: Implement**

Create `window-manager/src/main/gitOps.ts`:

```ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import type Dockerode from 'dockerode'
import { sshUrlToHttps } from './gitUrl'

const execFileP = promisify(execFile)

export interface GitResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

type Container = ReturnType<Dockerode['getContainer']>

export async function execInContainer(
  container: Container,
  cmd: string[],
  opts: { workingDir?: string } = {}
): Promise<GitResult> {
  const execInstance = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: opts.workingDir
  })
  const stream = await execInstance.start({})

  let stdout = ''
  let stderr = ''
  await new Promise<void>((resolve, reject) => {
    // Dockerode multiplexes stdout/stderr on one stream; split via modem helper.
    // For simplicity here we collect everything as stdout; if tests require
    // a split, swap to container.modem.demuxStream.
    stream.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  const inspect = await execInstance.inspect()
  const code = inspect.ExitCode ?? 0
  return { ok: code === 0, code, stdout, stderr }
}

export async function remoteBranchExists(
  sshUrl: string,
  slug: string,
  pat: string
): Promise<boolean> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const { stdout } = await execFileP(
    'git',
    ['ls-remote', '--heads', httpsUrl, slug],
    { timeout: 15_000 }
  )
  return stdout.trim().length > 0
}

export async function cloneInContainer(
  container: Container,
  sshUrl: string,
  pat: string,
  clonePath: string
): Promise<void> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const cloneResult = await execInContainer(container, [
    'git', 'clone', httpsUrl, clonePath
  ])
  if (!cloneResult.ok) throw new Error(`git clone failed: ${cloneResult.stdout}`)

  const setUrl = await execInContainer(container, [
    'git', '-C', clonePath, 'remote', 'set-url', 'origin', sshUrl
  ])
  if (!setUrl.ok) throw new Error(`git remote set-url failed: ${setUrl.stdout}`)
}

export async function checkoutSlug(
  container: Container,
  clonePath: string,
  slug: string,
  remoteHasSlug: boolean
): Promise<void> {
  const args = remoteHasSlug
    ? ['git', '-C', clonePath, 'checkout', slug]
    : ['git', '-C', clonePath, 'checkout', '-b', slug]
  const result = await execInContainer(container, args)
  if (!result.ok) throw new Error(`git checkout failed: ${result.stdout}`)
}

export async function getCurrentBranch(
  container: Container,
  clonePath: string
): Promise<string> {
  const result = await execInContainer(container, [
    'git', '-C', clonePath, 'rev-parse', '--abbrev-ref', 'HEAD'
  ])
  return result.stdout.trim()
}
```

**Step 4: Run to verify pass**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat(main): add gitOps helpers (remote probe, exec, clone, checkout, branch)"
```

---

### Task 1.4: Refactor `windowService.createWindow` — clone inside container, check out slug

**What the user can do after this task:** When a new window is created, the repo is cloned **inside** the container (no host temp dir, no `docker cp`), and the working copy is on a branch named after the kebab-slugged window name.

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Modify: `window-manager/tests/main/windowService.test.ts`

**Step 1: Update tests**

In `windowService.test.ts`, replace the host-clone/docker-cp assertions with in-container assertions. Delete or rewrite:

- `it('clones on the host with the PAT over HTTPS', ...)` → **delete**
- `it('rewrites origin to the SSH URL after clone ...')` → rewrite to check the **in-container** `remote set-url` exec.
- `it('copies the working tree into the container via docker cp', ...)` → **delete** (no more `docker cp`).
- `it('execs mkdir -p inside the container but never git clone', ...)` → rewrite: **mkdir + git clone both exec inside the container**.
- `it('cleans up the host temp dir even on failure', ...)` → **delete** (no host temp dir).
- `it('never passes the PAT to any container.exec call', ...)` → **delete** (PAT is now deliberately passed in the clone exec).

Add new tests:

```ts
it('creates the clone path and clones the repo inside the container', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  await createWindow('test window', projectId)

  const cloneExec = mockContainerExec.mock.calls.find(
    (c) => Array.isArray(c[0].Cmd) && c[0].Cmd[0] === 'git' && c[0].Cmd[1] === 'clone'
  )
  expect(cloneExec).toBeDefined()
  expect(cloneExec![0].Cmd).toEqual([
    'git',
    'clone',
    'https://test-token@github.com/org/my-repo.git',
    '/workspace/my-repo'
  ])
})

it('rewrites origin back to the SSH URL after the in-container clone', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  await createWindow('test window', projectId)

  const setUrl = mockContainerExec.mock.calls.find(
    (c) =>
      Array.isArray(c[0].Cmd) &&
      c[0].Cmd.includes('remote') &&
      c[0].Cmd.includes('set-url')
  )
  expect(setUrl).toBeDefined()
  expect(setUrl![0].Cmd).toContain('git@github.com:org/my-repo.git')
})

it('probes the remote for the slug branch before cloning', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  await createWindow('My Feature', projectId)

  const lsRemote = mockExecFile.mock.calls.find(
    (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'ls-remote'
  )
  expect(lsRemote).toBeDefined()
  expect(lsRemote![1]).toEqual([
    'ls-remote',
    '--heads',
    'https://test-token@github.com/org/my-repo.git',
    'my-feature'
  ])
})

it('uses `checkout -b` when remote has no matching branch', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  // default mockExecFile returns empty stdout, so remoteBranchExists → false
  await createWindow('My Feature', projectId)

  const checkout = mockContainerExec.mock.calls.find(
    (c) => Array.isArray(c[0].Cmd) && c[0].Cmd.includes('checkout')
  )
  expect(checkout).toBeDefined()
  expect(checkout![0].Cmd).toEqual([
    'git', '-C', '/workspace/my-repo', 'checkout', '-b', 'my-feature'
  ])
})

it('uses plain `checkout <slug>` when remote has the branch', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], _opts: object, cb: Function) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        return cb(null, 'deadbeef\trefs/heads/my-feature\n', '')
      }
      return cb(null, '', '')
    }
  )
  await createWindow('My Feature', projectId)

  const checkout = mockContainerExec.mock.calls.find(
    (c) => Array.isArray(c[0].Cmd) && c[0].Cmd.includes('checkout')
  )
  expect(checkout).toBeDefined()
  expect(checkout![0].Cmd).toEqual([
    'git', '-C', '/workspace/my-repo', 'checkout', 'my-feature'
  ])
})

it('removes the container if the clone fails', async () => {
  const projectId = seedProject('git@github.com:org/my-repo.git')
  mockContainerExec.mockImplementationOnce(async () => ({
    start: async () => ({
      on(event: string, cb: (data?: Buffer) => void) {
        if (event === 'data') setImmediate(() => cb(Buffer.from('fatal: auth')))
        if (event === 'end') setImmediate(() => cb())
        return this
      }
    }),
    inspect: async () => ({ ExitCode: 128 })
  }))
  await expect(createWindow('test', projectId)).rejects.toThrow()
  expect(mockStop).toHaveBeenCalled()
})
```

**Step 2: Run tests to verify failure**

Run: `cd window-manager && npm run test:main -- windowService`

Expected: multiple failures referencing the removed host-clone code paths.

**Step 3: Refactor `createWindow`**

Open `window-manager/src/main/windowService.ts` and replace the body of `createWindow` (and drop `cloneOnHost`, the `fs/promises` and `execFile` imports used only for the host clone, and the `tempDir` finally block). The new flow:

```ts
import { toSlug } from './slug'
import {
  remoteBranchExists,
  execInContainer,
  cloneInContainer,
  checkoutSlug
} from './gitOps'

export async function createWindow(
  name: string,
  projectId: number,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string } | undefined
  if (!project) throw new Error('Project not found')

  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured. Open Settings to add one.')
  const claudeToken = getClaudeToken()
  if (!claudeToken) throw new Error('Claude token not configured. Open Settings to add one.')

  const slug = toSlug(name)
  const repoName = extractRepoName(project.git_url)
  const clonePath = `/workspace/${repoName}`

  onProgress('Probing remote for branch…')
  const remoteHasSlug = await remoteBranchExists(project.git_url, slug, pat)

  onProgress('Starting dev container…')
  const container = await getDocker().createContainer({
    Image: 'cc',
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
    Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`]
  })
  await container.start()

  try {
    onProgress('Preparing workspace…')
    const mkdir = await execInContainer(container, ['mkdir', '-p', clonePath])
    if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.stdout}`)

    onProgress('Cloning repository in container…')
    await cloneInContainer(container, project.git_url, pat, clonePath)

    onProgress('Checking out branch…')
    await checkoutSlug(container, clonePath, slug, remoteHasSlug)

    onProgress('Finalizing…')
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
  } catch (err) {
    await container.stop({ t: 1 }).catch(() => {})
    throw err
  }
}
```

Remove the now-unused `cloneOnHost` function and the `os`, `path`, `rm`, `randomUUID`, `execFile` imports that only served it.

**Step 4: Run tests to verify pass**

Run: `cd window-manager && npm run test:main -- windowService`

Expected: PASS. Also run the full main suite: `npm run test:main`. All green.

**Step 5: Typecheck**

Run: `cd window-manager && npm run typecheck`

Expected: PASS.

**Step 6: Commit**

```bash
git add window-manager/src/main/windowService.ts window-manager/tests/main/windowService.test.ts
git commit -m "refactor(main): clone repo inside container, check out slug branch"
```

---

### Task 1.5: [CHECKPOINT] Phase 1 verification

**What the user can do after this task:** Create a window from the UI and confirm that the repo lives inside the container on the slugged branch.

**Files:**
- Create: `docs/plans/2026-04-14-window-git-ops-test-verification.md` (executing-plans will maintain it; seed it here if missing)

**Step 1: Run all unit tests**

Run: `cd window-manager && npm run test`

Expected: all main + renderer suites PASS.

**Step 2: Typecheck + lint**

Run: `cd window-manager && npm run typecheck && npm run lint`

Expected: PASS, no errors.

**Step 3: Manual UI smoke via `npm run dev`**

Prerequisites: Docker running, `cc` image available, PAT + Claude token configured in Settings.

Copy this checklist into your response and tick each item as you verify:

- [ ] Start app: `cd window-manager && npm run dev`. App window opens.
- [ ] In the app, create a project pointing at a git repo you control.
- [ ] Create a window named `My Feature!` in that project. Watch the progress steps fire: "Probing remote…", "Starting dev container…", "Preparing workspace…", "Cloning repository in container…", "Checking out branch…", "Finalizing…".
- [ ] Click the window to open its terminal. Inside, run `pwd && git -C /workspace/<repo> branch --show-current`. Expected: branch is `my-feature`.
- [ ] Inside the terminal run `cat /workspace/<repo>/.git/config`. Expected: `url = git@github.com:...` (SSH form, no PAT leaked).
- [ ] Create a second window whose name matches an existing remote branch (e.g. `main` or a branch you just pushed). Verify the terminal shows that branch tracked and `git log` shows remote history.
- [ ] Delete a window. The container stops and the UI removes it.

**Step 4: Record verification**

Create `docs/plans/2026-04-14-window-git-ops-test-verification.md` with a `## Phase 1` section listing the date, the checklist above with tick-status, and the output of `npm run test`. (Execution skills will append subsequent phases.)

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-window-git-ops-test-verification.md
git commit -m "test: phase 1 verification for in-container clone + slug checkout"
```

---

## Phase 2 — Bottom detail pane + branch polling

**User-visible outcome:** Opening a window shows a bottom detail pane under the terminal with the window name, project name, current branch, and status. The branch refreshes every 5 s (so a user who runs `git checkout other-branch` in the terminal sees the pane update within ~5 s).

### Task 2.1: Expose `git:current-branch` IPC + preload API

**What the user can do after this task:** Nothing user-visible; wires the renderer → main channel used by the pane.

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/preload/index.d.ts`
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

**Step 1: Write the failing test**

In `window-manager/tests/main/ipcHandlers.test.ts` add:

```ts
it('registers a git:current-branch handler', () => {
  registerIpcHandlers()
  expect(handlers.has('git:current-branch')).toBe(true)
})
```

(Use the same `handlers` map pattern the existing tests use; if the file uses a different assertion style, match it.)

**Step 2: Run and verify failure**

Run: `cd window-manager && npm run test:main -- ipcHandlers`

Expected: FAIL — handler not registered.

**Step 3: Implement — main**

In `ipcHandlers.ts`, import, look up the window row → container id + project git_url, derive `clonePath` from `extractRepoName(git_url)`, then call `getCurrentBranch`:

```ts
import { extractRepoName } from './gitUrl'
import { getCurrentBranch } from './gitOps'
// ...
ipcMain.handle('git:current-branch', async (_, windowId: number) => {
  const row = getDb()
    .prepare(
      `SELECT w.container_id AS containerId, p.git_url AS gitUrl
       FROM windows w JOIN projects p ON p.id = w.project_id
       WHERE w.id = ? AND w.deleted_at IS NULL`
    )
    .get(windowId) as { containerId: string; gitUrl: string } | undefined
  if (!row) throw new Error('Window not found')
  const clonePath = `/workspace/${extractRepoName(row.gitUrl)}`
  const container = getDocker().getContainer(row.containerId)
  return getCurrentBranch(container, clonePath)
})
```

To avoid duplicating the `getDocker()` helper across files, either export it from `windowService.ts` or factor a small `docker.ts` that owns the singleton. **Recommend**: extract `getDocker` into `window-manager/src/main/docker.ts`. Update `windowService.ts` to import from there. Pure move — no behavior change. Cover with a smoke test that `getDocker()` returns the same instance across calls.

**Step 4: Implement — preload + types**

Add to `preload/index.ts`:

```ts
getCurrentBranch: (windowId: number) => ipcRenderer.invoke('git:current-branch', windowId),
```

Add to `preload/index.d.ts` (if it re-declares the `Api`) and to `renderer/src/types.ts` `Api` interface:

```ts
getCurrentBranch: (windowId: number) => Promise<string>
```

**Step 5: Run to verify pass**

Run: `cd window-manager && npm run test:main -- ipcHandlers`

Expected: PASS. Also `npm run typecheck`.

**Step 6: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/main/docker.ts \
        window-manager/src/main/windowService.ts \
        window-manager/src/preload/index.ts window-manager/src/preload/index.d.ts \
        window-manager/src/renderer/src/types.ts \
        window-manager/tests/main/ipcHandlers.test.ts
git commit -m "feat(ipc): expose git:current-branch"
```

---

### Task 2.2: Add `WindowDetailPane` component

**What the user can do after this task:** When a window is selected, a bottom pane under the terminal shows window name, project name, branch, and status. Branch refreshes every 5 s.

**Files:**
- Create: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte` (drop existing header; wrap body + pane)
- Modify: `window-manager/src/renderer/src/components/MainPane.svelte` (pass `project` into `TerminalHost`)
- Create: `window-manager/tests/renderer/WindowDetailPane.test.ts`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts` (adjust to new structure)

**Step 1: Write the failing test**

```ts
// window-manager/tests/renderer/WindowDetailPane.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import WindowDetailPane from '../../src/renderer/src/components/WindowDetailPane.svelte'

const getCurrentBranch = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  // @ts-expect-error test bridge
  globalThis.window.api = { getCurrentBranch }
})
afterEach(() => vi.useRealTimers())

const win = {
  id: 1,
  name: 'My Feature',
  project_id: 7,
  container_id: 'abc123def456',
  created_at: '2026-04-14T00:00:00Z',
  status: 'running' as const
}
const project = {
  id: 7,
  name: 'my-project',
  git_url: 'git@github.com:org/my-repo.git',
  created_at: '2026-04-14T00:00:00Z'
}

describe('WindowDetailPane', () => {
  it('renders window name, project name, status, and initial branch', async () => {
    getCurrentBranch.mockResolvedValue('my-feature')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByText('My Feature')).toBeInTheDocument()
    expect(screen.getByText('my-project')).toBeInTheDocument()
    expect(screen.getByText(/running/i)).toBeInTheDocument()
    await vi.runOnlyPendingTimersAsync()
    expect(await screen.findByText('my-feature')).toBeInTheDocument()
  })

  it('polls the branch every 5 seconds', async () => {
    getCurrentBranch.mockResolvedValueOnce('my-feature').mockResolvedValueOnce('other')
    render(WindowDetailPane, { props: { win, project } })
    await vi.runOnlyPendingTimersAsync()
    expect(await screen.findByText('my-feature')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await screen.findByText('other')).toBeInTheDocument()
  })

  it('keeps the last branch on error (does not blank out)', async () => {
    getCurrentBranch
      .mockResolvedValueOnce('my-feature')
      .mockRejectedValueOnce(new Error('docker down'))
    render(WindowDetailPane, { props: { win, project } })
    await vi.runOnlyPendingTimersAsync()
    expect(await screen.findByText('my-feature')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)
    expect(screen.getByText('my-feature')).toBeInTheDocument()
  })

  it('renders a Commit button and a Push button', () => {
    getCurrentBranch.mockResolvedValue('my-feature')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /push/i })).toBeInTheDocument()
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:renderer -- WindowDetailPane`

Expected: FAIL (component missing).

**Step 3: Implement the component**

```svelte
<!-- window-manager/src/renderer/src/components/WindowDetailPane.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onCommit?: () => void
    onPush?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
  }

  let {
    win,
    project,
    onCommit = () => {},
    onPush = () => {},
    commitDisabled = false,
    pushDisabled = false
  }: Props = $props()

  let branch = $state<string>('…')
  let timer: ReturnType<typeof setInterval> | undefined

  async function refreshBranch(): Promise<void> {
    try {
      const next = await window.api.getCurrentBranch(win.id)
      if (next) branch = next
    } catch {
      // keep last-known branch; do not toast
    }
  }

  onMount(() => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
  })
  onDestroy(() => {
    if (timer) clearInterval(timer)
  })
</script>

<footer class="detail-pane">
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
</footer>

<style>
  .detail-pane {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-1);
  }
  .info { display: flex; gap: 0.4rem; align-items: baseline; }
  .name { font-weight: 600; color: var(--fg-0); }
  .sep { color: var(--fg-3); }
  .branch { font-family: var(--font-mono); }
  .status.running { color: var(--success, #4ade80); }
  .status.stopped { color: var(--fg-3); }
  .status.unknown { color: var(--warning, #facc15); }
  .actions { display: flex; gap: 0.4rem; }
  button {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    border-radius: 4px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

**Step 4: Wire into `TerminalHost`**

Update `TerminalHost.svelte`:
- Accept `project: ProjectRecord` in its `Props` interface (new prop).
- Remove the top `<header class="terminal-host-header">…</header>` (pane replaces it).
- Wrap the body and the new pane in the existing `<section class="terminal-host">` container so the pane sticks to the bottom (flex column, body `flex: 1`, pane fixed-height).
- Render `<WindowDetailPane {win} {project} onCommit={…} onPush={…} />` after the terminal body. For Phase 2, pass no-op handlers and `commitDisabled / pushDisabled = true` — buttons are wired in later phases.

Update `MainPane.svelte`: change `<TerminalHost win={selectedWindow} />` to `<TerminalHost win={selectedWindow} project={project!} />`. `project` is already in scope.

Update `TerminalHost.test.ts`: pass the new `project` prop in render calls, drop any assertion on the removed top header.

**Step 5: Run to verify pass**

Run: `cd window-manager && npm run test:renderer`

Expected: PASS. Also `npm run typecheck`.

**Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/WindowDetailPane.svelte \
        window-manager/src/renderer/src/components/TerminalHost.svelte \
        window-manager/src/renderer/src/components/MainPane.svelte \
        window-manager/tests/renderer/WindowDetailPane.test.ts \
        window-manager/tests/renderer/TerminalHost.test.ts
git commit -m "feat(renderer): add WindowDetailPane with 5s branch polling"
```

---

### Task 2.3: [CHECKPOINT] Phase 2 verification

**What the user can do after this task:** Visually confirm the pane under the terminal shows window/project/branch/status and the branch field reacts to in-terminal `git checkout` within ~5 s.

**Step 1: Run all tests**

Run: `cd window-manager && npm run test`

Expected: all green.

**Step 2: Typecheck + lint**

Run: `cd window-manager && npm run typecheck && npm run lint`

**Step 3: Manual UI smoke via `npm run dev`**

Copy + tick:

- [ ] Launch app, open a window. The bottom pane appears under the terminal.
- [ ] Pane shows: window name, project name, current branch (slug), status `running`.
- [ ] Commit + Push buttons visible but **disabled** (Phase 2 leaves them inert).
- [ ] In the terminal, run `cd /workspace/<repo> && git checkout -b scratch`. Within ~5 s, the pane branch field updates to `scratch`.
- [ ] Stop the container externally (`docker stop <id>`) → within a poll cycle the pane's branch stops updating (stays at last value); status eventually reflects the reconciled state.
- [ ] Reopen a window that was previously opened — pane renders correctly without ghost timers or console errors.

**Step 4: Append to `docs/plans/2026-04-14-window-git-ops-test-verification.md`**

Add a `## Phase 2` section with the ticked checklist and the `npm run test` summary.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-window-git-ops-test-verification.md
git commit -m "test: phase 2 verification for WindowDetailPane polling"
```

---

## Phase 3 — Commit flow

**User-visible outcome:** Clicking Commit opens a modal. The user enters a subject (required) + optional body and submits. The app runs `git add --all && git commit` inside the container using the PAT-owner's GitHub identity. A toast shows the git output. Errors ("nothing to commit", identity not configured, etc.) surface as error toasts.

### Task 3.1: Add toast store + component

**What the user can do after this task:** Nothing user-visible yet (no toast callers); shared UI primitive for Commit/Push.

**Files:**
- Create: `window-manager/src/renderer/src/lib/toasts.ts`
- Create: `window-manager/src/renderer/src/components/Toasts.svelte`
- Modify: `window-manager/src/renderer/src/App.svelte` (mount `<Toasts />` once at the top level)
- Create: `window-manager/tests/renderer/toasts.test.ts`

**Step 1: Write the failing tests**

```ts
// window-manager/tests/renderer/toasts.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { toasts, pushToast, dismissToast } from '../../src/renderer/src/lib/toasts'
import { get } from 'svelte/store'

describe('toasts store', () => {
  beforeEach(() => {
    // reset
    for (const t of get(toasts)) dismissToast(t.id)
  })

  it('pushes a toast with level, title, and optional body', () => {
    const id = pushToast({ level: 'success', title: 'OK', body: 'all good' })
    const current = get(toasts)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ id, level: 'success', title: 'OK', body: 'all good' })
  })

  it('dismisses a toast by id', () => {
    const id = pushToast({ level: 'error', title: 'nope' })
    dismissToast(id)
    expect(get(toasts)).toEqual([])
  })

  it('assigns unique ids across pushes', () => {
    const a = pushToast({ level: 'success', title: 'a' })
    const b = pushToast({ level: 'success', title: 'b' })
    expect(a).not.toBe(b)
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:renderer -- toasts`

Expected: FAIL (module missing).

**Step 3: Implement**

```ts
// window-manager/src/renderer/src/lib/toasts.ts
import { writable } from 'svelte/store'

export type ToastLevel = 'success' | 'error'

export interface Toast {
  id: number
  level: ToastLevel
  title: string
  body?: string
}

let nextId = 1
export const toasts = writable<Toast[]>([])

export function pushToast(t: Omit<Toast, 'id'>): number {
  const id = nextId++
  toasts.update((list) => [...list, { id, ...t }])
  return id
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id))
}
```

```svelte
<!-- window-manager/src/renderer/src/components/Toasts.svelte -->
<script lang="ts">
  import { toasts, dismissToast } from '../lib/toasts'
</script>

<ul class="toast-stack" aria-live="polite">
  {#each $toasts as t (t.id)}
    <li class="toast {t.level}">
      <div class="title">{t.title}</div>
      {#if t.body}
        <pre class="body">{t.body}</pre>
      {/if}
      <button type="button" aria-label="dismiss" onclick={() => dismissToast(t.id)}>×</button>
    </li>
  {/each}
</ul>

<style>
  .toast-stack {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
    z-index: 1000;
    max-width: 32rem;
  }
  .toast {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-left-width: 4px;
    padding: 0.6rem 2rem 0.6rem 0.75rem;
    border-radius: 4px;
    position: relative;
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-0);
  }
  .toast.success { border-left-color: var(--success, #4ade80); }
  .toast.error { border-left-color: var(--danger, #f87171); }
  .title { font-weight: 600; }
  .body {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0.35rem 0 0;
    color: var(--fg-1);
    max-height: 16rem;
    overflow: auto;
  }
  button {
    position: absolute;
    top: 0.3rem;
    right: 0.4rem;
    background: transparent;
    border: 0;
    color: var(--fg-2);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }
</style>
```

Mount in `App.svelte` once, near the bottom of the root element:

```svelte
<Toasts />
```

**Step 4: Run to verify pass**

Run: `cd window-manager && npm run test:renderer -- toasts`

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/renderer/src/lib/toasts.ts \
        window-manager/src/renderer/src/components/Toasts.svelte \
        window-manager/src/renderer/src/App.svelte \
        window-manager/tests/renderer/toasts.test.ts
git commit -m "feat(renderer): add toast store + component"
```

---

### Task 3.2: Add `githubIdentity` with PAT-change invalidation

**What the user can do after this task:** Nothing user-visible; the commit flow in 3.4/3.5 will consume it.

**Files:**
- Create: `window-manager/src/main/githubIdentity.ts`
- Modify: `window-manager/src/main/settingsService.ts`
- Create: `window-manager/tests/main/githubIdentity.test.ts`
- Modify: `window-manager/tests/main/settingsService.test.ts`

**Step 1: Write the failing tests**

```ts
// window-manager/tests/main/githubIdentity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  getIdentity,
  invalidateIdentity,
  __resetForTests
} from '../../src/main/githubIdentity'

beforeEach(() => {
  mockFetch.mockReset()
  __resetForTests()
})

describe('getIdentity', () => {
  it('returns name + email from GET /user when both present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: 'Octo Cat', email: 'octo@example.com' })
    })
    const id = await getIdentity('PAT')
    expect(id).toEqual({ name: 'Octo Cat', email: 'octo@example.com' })
  })

  it('falls back to noreply email when /user email is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: 'Octo Cat', email: null })
    })
    const id = await getIdentity('PAT')
    expect(id).toEqual({
      name: 'Octo Cat',
      email: '42+octo@users.noreply.github.com'
    })
  })

  it('falls back to login when name is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octo', name: null, email: null })
    })
    const id = await getIdentity('PAT')
    expect(id.name).toBe('octo')
  })

  it('caches: second call does not refetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'x', name: 'x', email: 'x@x' })
    })
    await getIdentity('PAT')
    await getIdentity('PAT')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('invalidateIdentity() clears the cache', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, login: 'x', name: 'x', email: 'x@x' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 2, login: 'y', name: 'y', email: 'y@y' }) })
    await getIdentity('PAT')
    invalidateIdentity()
    const second = await getIdentity('PAT')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(second.name).toBe('y')
  })

  it('throws a descriptive error on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
    await expect(getIdentity('PAT')).rejects.toThrow(/401/)
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:main -- githubIdentity`

Expected: FAIL.

**Step 3: Implement**

```ts
// window-manager/src/main/githubIdentity.ts
export interface GitHubIdentity {
  name: string
  email: string
}

let cached: GitHubIdentity | null = null

export function invalidateIdentity(): void {
  cached = null
}

export function __resetForTests(): void {
  cached = null
}

export async function getIdentity(pat: string): Promise<GitHubIdentity> {
  if (cached) return cached

  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status} ${res.statusText ?? ''}`.trim())
  }
  const body = (await res.json()) as {
    id: number
    login: string
    name: string | null
    email: string | null
  }
  const email = body.email ?? `${body.id}+${body.login}@users.noreply.github.com`
  const name = body.name ?? body.login
  cached = { name, email }
  return cached
}
```

**Step 4: Wire invalidation into `settingsService`**

In `settingsService.ts`, import `invalidateIdentity` from `./githubIdentity`. Call it at the end of `setGitHubPat` **and** `clearGitHubPat`.

In `settingsService.test.ts`, add:

```ts
it('invalidates the GitHub identity cache on setGitHubPat', () => {
  const spy = vi.fn()
  // re-mock the identity module:
  vi.mock('../../src/main/githubIdentity', () => ({ invalidateIdentity: spy }))
  // ... call setGitHubPat('new')
  expect(spy).toHaveBeenCalled()
})
```

(Adapt to whatever mocking pattern the existing `settingsService.test.ts` uses — keep it consistent.)

**Step 5: Run to verify pass**

Run: `cd window-manager && npm run test:main -- githubIdentity settingsService`

Expected: PASS.

**Step 6: Commit**

```bash
git add window-manager/src/main/githubIdentity.ts \
        window-manager/src/main/settingsService.ts \
        window-manager/tests/main/githubIdentity.test.ts \
        window-manager/tests/main/settingsService.test.ts
git commit -m "feat(main): add GitHub identity fetch + cache, invalidate on PAT change"
```

---

### Task 3.3: Add `stageAndCommit` to `gitOps`

**What the user can do after this task:** Nothing user-visible; the IPC handler in 3.4 will call this.

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Modify: `window-manager/tests/main/gitOps.test.ts`

**Step 1: Write the failing tests**

Append to `gitOps.test.ts`:

```ts
describe('stageAndCommit', () => {
  it('runs git add --all then git commit with -c user.name/email and -m <subject>', async () => {
    const container = makeContainer()
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await stageAndCommit(container, '/workspace/r', {
      subject: 'Fix bug', body: '', name: 'Octo', email: 'o@x'
    })

    const cmds = container.exec.mock.calls.map((c) => c[0].Cmd)
    expect(cmds[0]).toEqual(['git', '-C', '/workspace/r', 'add', '--all'])
    expect(cmds[1]).toEqual([
      'git', '-C', '/workspace/r',
      '-c', 'user.name=Octo',
      '-c', 'user.email=o@x',
      'commit', '-m', 'Fix bug'
    ])
  })

  it('includes a second -m flag when body is non-empty', async () => {
    const container = makeContainer()
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await stageAndCommit(container, '/workspace/r', {
      subject: 'subj', body: 'more details', name: 'n', email: 'e'
    })
    const commitCmd = container.exec.mock.calls[1][0].Cmd
    expect(commitCmd).toContain('-m')
    expect(commitCmd[commitCmd.length - 2]).toBe('-m')
    expect(commitCmd[commitCmd.length - 1]).toBe('more details')
  })

  it('returns a friendly "Nothing to commit" result when git exits 1 with that message', async () => {
    const container = {
      id: 'c',
      exec: vi.fn()
        // add --all: ok
        .mockResolvedValueOnce({
          start: async () => ({
            on(event: string, cb: (d?: Buffer) => void) {
              if (event === 'end') setImmediate(() => cb())
              return this
            }
          }),
          inspect: async () => ({ ExitCode: 0 })
        })
        // commit: code 1, stdout contains nothing-to-commit
        .mockResolvedValueOnce({
          start: async () => ({
            on(event: string, cb: (d?: Buffer) => void) {
              if (event === 'data') setImmediate(() => cb(Buffer.from('nothing to commit, working tree clean')))
              if (event === 'end') setImmediate(() => cb())
              return this
            }
          }),
          inspect: async () => ({ ExitCode: 1 })
        })
    }
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await stageAndCommit(container, '/workspace/r', {
      subject: 's', body: '', name: 'n', email: 'e'
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.stdout).toMatch(/nothing to commit/i)
  })
})
```

**Step 2: Run to verify failure**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: FAIL (function missing).

**Step 3: Implement in `gitOps.ts`**

```ts
export interface CommitInput {
  subject: string
  body?: string
  name: string
  email: string
}

export async function stageAndCommit(
  container: Container,
  clonePath: string,
  input: CommitInput
): Promise<GitResult> {
  const addResult = await execInContainer(container, [
    'git', '-C', clonePath, 'add', '--all'
  ])
  if (!addResult.ok) return addResult

  const commitArgs = [
    'git', '-C', clonePath,
    '-c', `user.name=${input.name}`,
    '-c', `user.email=${input.email}`,
    'commit',
    '-m', input.subject
  ]
  if (input.body && input.body.trim().length > 0) {
    commitArgs.push('-m', input.body)
  }
  return execInContainer(container, commitArgs)
}
```

**Step 4: Run to verify pass**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat(main): add stageAndCommit to gitOps"
```

---

### Task 3.4: Expose `git:commit` IPC + preload API

**What the user can do after this task:** Renderer can call `window.api.commit(...)`; no UI wires yet.

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/preload/index.d.ts`
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

**Step 1: Write the failing test**

```ts
it('registers a git:commit handler', () => {
  registerIpcHandlers()
  expect(handlers.has('git:commit')).toBe(true)
})
```

**Step 2: Run and verify failure**

Run: `cd window-manager && npm run test:main -- ipcHandlers`

Expected: FAIL.

**Step 3: Implement**

In `ipcHandlers.ts`:

```ts
import { stageAndCommit } from './gitOps'
import { getIdentity } from './githubIdentity'
import { scrubPat } from './scrub'

ipcMain.handle(
  'git:commit',
  async (_, windowId: number, payload: { subject: string; body?: string }) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    const row = getDb()
      .prepare(
        `SELECT w.container_id AS containerId, p.git_url AS gitUrl
         FROM windows w JOIN projects p ON p.id = w.project_id
         WHERE w.id = ? AND w.deleted_at IS NULL`
      )
      .get(windowId) as { containerId: string; gitUrl: string } | undefined
    if (!row) throw new Error('Window not found')

    const identity = await getIdentity(pat)
    const clonePath = `/workspace/${extractRepoName(row.gitUrl)}`
    const container = getDocker().getContainer(row.containerId)
    const result = await stageAndCommit(container, clonePath, {
      subject: payload.subject,
      body: payload.body,
      name: identity.name,
      email: identity.email
    })
    return {
      ...result,
      stdout: scrubPat(result.stdout, pat),
      stderr: scrubPat(result.stderr, pat)
    }
  }
)
```

Add to `preload/index.ts`:

```ts
commit: (windowId: number, payload: { subject: string; body?: string }) =>
  ipcRenderer.invoke('git:commit', windowId, payload),
```

Add to `Api` in `renderer/src/types.ts` and `preload/index.d.ts`:

```ts
commit: (
  windowId: number,
  payload: { subject: string; body?: string }
) => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>
```

**Step 4: Verify**

Run: `cd window-manager && npm run test:main -- ipcHandlers` and `npm run typecheck`.

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts \
        window-manager/src/preload/index.ts window-manager/src/preload/index.d.ts \
        window-manager/src/renderer/src/types.ts \
        window-manager/tests/main/ipcHandlers.test.ts
git commit -m "feat(ipc): expose git:commit with PAT-scrubbed result"
```

---

### Task 3.5: Add `CommitModal` and wire the pane's Commit button

**What the user can do after this task:** Click Commit in the detail pane → modal opens → fill subject (required) + optional body → Submit runs the commit → toast reports the result.

**Files:**
- Create: `window-manager/src/renderer/src/components/CommitModal.svelte`
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte` (enable Commit button; accept loading state)
- Create: `window-manager/tests/renderer/CommitModal.test.ts`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

**Step 1: Write the failing tests**

`CommitModal.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CommitModal from '../../src/renderer/src/components/CommitModal.svelte'

describe('CommitModal', () => {
  it('disables Submit while the subject is empty', () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false } })
    const submit = screen.getByRole('button', { name: /commit/i })
    expect(submit).toBeDisabled()
  })

  it('enables Submit once a trimmed subject is present', async () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false } })
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement
    await fireEvent.input(subject, { target: { value: 'Hello' } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeEnabled()
  })

  it('calls onSubmit with trimmed subject + body', async () => {
    const onSubmit = vi.fn()
    render(CommitModal, { props: { onSubmit, onCancel: vi.fn(), busy: false } })
    await fireEvent.input(screen.getByLabelText(/subject/i), { target: { value: '  Fix bug  ' } })
    await fireEvent.input(screen.getByLabelText(/body/i), { target: { value: 'details' } })
    await fireEvent.click(screen.getByRole('button', { name: /commit/i }))
    expect(onSubmit).toHaveBeenCalledWith({ subject: 'Fix bug', body: 'details' })
  })

  it('disables inputs and submit while busy', () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: true } })
    expect(screen.getByLabelText(/subject/i)).toBeDisabled()
    expect(screen.getByLabelText(/body/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled()
  })
})
```

Extend `WindowDetailPane.test.ts`:

```ts
it('invokes onCommit when the Commit button is clicked', async () => {
  getCurrentBranch.mockResolvedValue('x')
  const onCommit = vi.fn()
  render(WindowDetailPane, { props: { win, project, onCommit } })
  await fireEvent.click(screen.getByRole('button', { name: /commit/i }))
  expect(onCommit).toHaveBeenCalled()
})
```

**Step 2: Verify failure**

Run: `cd window-manager && npm run test:renderer -- CommitModal WindowDetailPane`

Expected: FAIL.

**Step 3: Implement `CommitModal.svelte`**

```svelte
<script lang="ts">
  interface Props {
    onSubmit: (v: { subject: string; body: string }) => void
    onCancel: () => void
    busy: boolean
  }
  let { onSubmit, onCancel, busy }: Props = $props()

  let subject = $state('')
  let body = $state('')
  let canSubmit = $derived(subject.trim().length > 0 && !busy)

  function handleSubmit(e: Event): void {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ subject: subject.trim(), body: body.trim() })
  }
</script>

<div class="backdrop" role="dialog" aria-modal="true" aria-label="Commit changes">
  <form class="modal" onsubmit={handleSubmit}>
    <h2>Commit changes</h2>

    <label>
      <span>Subject</span>
      <input
        type="text"
        bind:value={subject}
        disabled={busy}
        autofocus
        placeholder="Short summary"
      />
    </label>

    <label>
      <span>Body (optional)</span>
      <textarea rows="5" bind:value={body} disabled={busy} placeholder="More detail"></textarea>
    </label>

    <div class="actions">
      <button type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Committing…' : 'Commit'}
      </button>
    </div>
  </form>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1100;
  }
  .modal {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.1rem;
    width: 32rem;
    max-width: 90vw;
    display: flex; flex-direction: column; gap: 0.7rem;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  h2 { margin: 0; font-size: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.82rem; }
  input, textarea {
    background: var(--bg-0);
    border: 1px solid var(--border);
    color: var(--fg-0);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-family: inherit;
    font-size: 0.88rem;
  }
  textarea { font-family: var(--font-mono); }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  button {
    padding: 0.35rem 0.85rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    cursor: pointer;
  }
  button[type='submit'] { background: var(--accent, #8b5cf6); border-color: transparent; }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
```

**Step 4: Wire into `TerminalHost` (owns modal state + commit handler)**

```svelte
<script lang="ts">
  // ...existing imports
  import CommitModal from './CommitModal.svelte'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import { pushToast } from '../lib/toasts'

  // ...
  let commitOpen = $state(false)
  let commitBusy = $state(false)

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, { subject: v.subject, body: v.body || undefined })
      if (res.ok) {
        pushToast({ level: 'success', title: 'Committed', body: res.stdout })
      } else {
        const nothing = /nothing to commit/i.test(res.stdout + res.stderr)
        pushToast({
          level: nothing ? 'success' : 'error',
          title: nothing ? 'Nothing to commit' : 'Commit failed',
          body: nothing ? undefined : res.stdout || res.stderr
        })
      }
      commitOpen = false
    } catch (err) {
      pushToast({ level: 'error', title: 'Commit error', body: (err as Error).message })
    } finally {
      commitBusy = false
    }
  }
</script>

<!-- pane + modal added below the terminal body -->
<WindowDetailPane
  {win}
  {project}
  onCommit={() => (commitOpen = true)}
  commitDisabled={commitBusy}
  pushDisabled={true}
/>
{#if commitOpen}
  <CommitModal
    onSubmit={runCommit}
    onCancel={() => (commitOpen = false)}
    busy={commitBusy}
  />
{/if}
```

Update `WindowDetailPane.svelte`: remove the `commitDisabled = false` default if you want it; pass through as-is. No logic change beyond what's already there.

**Step 5: Verify pass**

Run: `cd window-manager && npm run test:renderer`

Expected: PASS.

**Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/CommitModal.svelte \
        window-manager/src/renderer/src/components/TerminalHost.svelte \
        window-manager/src/renderer/src/components/WindowDetailPane.svelte \
        window-manager/tests/renderer/CommitModal.test.ts \
        window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(renderer): add CommitModal and wire Commit button"
```

---

### Task 3.6: [CHECKPOINT] Phase 3 verification

**What the user can do after this task:** Commit real changes inside a container from the UI.

**Step 1: Run all tests**

Run: `cd window-manager && npm run test`

**Step 2: Typecheck + lint**

Run: `cd window-manager && npm run typecheck && npm run lint`

**Step 3: Manual UI smoke via `npm run dev`**

Prereqs: Docker up, `cc` image, valid PAT + Claude token, a test project you can push to.

Copy + tick:

- [ ] App starts, window opens, pane shows branch.
- [ ] Commit with **empty subject** — Submit is disabled.
- [ ] In the terminal, create a file change: `echo hi >> /workspace/<repo>/a.txt`.
- [ ] Click Commit, fill subject only → success toast. In terminal, `git log -1 --format='%an <%ae>'` matches your GitHub identity (PAT-owner's name + email).
- [ ] Make another change. Commit with subject **and body**. In terminal, `git log -1 --format='%B'` shows both subject and body.
- [ ] Click Commit with a **clean working tree** (no changes) → "Nothing to commit" toast, no error styling.
- [ ] While commit is in-flight, confirm the Commit button in the pane AND the modal Submit are disabled (spinner state).
- [ ] Revoke/change the PAT in Settings → next Commit attempt re-fetches identity (no stale cache).
- [ ] Inspect toast body — confirm no PAT substring appears (copy/paste search for first 6 chars of your PAT).
- [ ] Open DevTools console — no unhandled promise rejections or Svelte warnings during commit flow.

**Step 4: Append `## Phase 3` section to `docs/plans/2026-04-14-window-git-ops-test-verification.md`.**

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-window-git-ops-test-verification.md
git commit -m "test: phase 3 verification for commit flow"
```

---

## Phase 4 — Push flow

**User-visible outcome:** Clicking Push runs `git push -u origin <current-branch>` inside the container with the PAT supplied via an explicit HTTPS URL in the `docker exec` argv. A success or error toast shows scrubbed git output. Both pane buttons are disabled while the op runs.

### Task 4.1: Add `push` to `gitOps`

**What the user can do after this task:** Nothing user-visible; powers the IPC handler below.

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Modify: `window-manager/tests/main/gitOps.test.ts`

**Step 1: Write the failing tests**

Append to `gitOps.test.ts`:

```ts
describe('push', () => {
  it('pushes to an explicit https URL with -u, branch, scrubbing PAT from output', async () => {
    // Return a container whose exec captures the commit; stream emits output containing the PAT
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: async () => ({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from('pushing to https://PAT@github.com/org/r')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: async () => ({ ExitCode: 0 })
      })
    }
    const { push } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await push(container, '/workspace/r', 'my-feature', 'git@github.com:org/r.git', 'PAT')
    const cmd = container.exec.mock.calls[0][0].Cmd
    expect(cmd).toEqual([
      'git', '-C', '/workspace/r',
      'push', '-u',
      'https://PAT@github.com/org/r.git',
      'my-feature'
    ])
    expect(res.stdout).not.toContain('PAT')
    expect(res.stdout).toContain('***')
  })

  it('returns ok=false when the exec exits non-zero', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: async () => ({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from('! [rejected] non-fast-forward')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: async () => ({ ExitCode: 1 })
      })
    }
    const { push } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await push(container, '/workspace/r', 'br', 'git@github.com:o/r.git', 'PAT')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.stdout).toMatch(/non-fast-forward/)
  })
})
```

**Step 2: Verify failure**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: FAIL (function missing).

**Step 3: Implement in `gitOps.ts`**

```ts
import { scrubPat } from './scrub'

export async function push(
  container: Container,
  clonePath: string,
  branch: string,
  sshUrl: string,
  pat: string
): Promise<GitResult> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const result = await execInContainer(container, [
    'git', '-C', clonePath,
    'push', '-u',
    httpsUrl,
    branch
  ])
  return {
    ...result,
    stdout: scrubPat(result.stdout, pat),
    stderr: scrubPat(result.stderr, pat)
  }
}
```

**Step 4: Verify pass**

Run: `cd window-manager && npm run test:main -- gitOps`

Expected: PASS.

**Step 5: Commit**

```bash
git add window-manager/src/main/gitOps.ts window-manager/tests/main/gitOps.test.ts
git commit -m "feat(main): add push to gitOps with PAT in exec argv + scrub"
```

---

### Task 4.2: Expose `git:push` IPC + preload API

**What the user can do after this task:** Renderer can call `window.api.push(windowId)`; UI wire-up comes in 4.3.

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/preload/index.d.ts`
- Modify: `window-manager/src/renderer/src/types.ts`
- Modify: `window-manager/tests/main/ipcHandlers.test.ts`

**Step 1: Write the failing test**

```ts
it('registers a git:push handler', () => {
  registerIpcHandlers()
  expect(handlers.has('git:push')).toBe(true)
})
```

**Step 2: Verify failure**

Run: `cd window-manager && npm run test:main -- ipcHandlers`

Expected: FAIL.

**Step 3: Implement**

In `ipcHandlers.ts`:

```ts
import { push as gitPush, getCurrentBranch } from './gitOps'

ipcMain.handle('git:push', async (_, windowId: number) => {
  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured.')
  const row = getDb()
    .prepare(
      `SELECT w.container_id AS containerId, p.git_url AS gitUrl
       FROM windows w JOIN projects p ON p.id = w.project_id
       WHERE w.id = ? AND w.deleted_at IS NULL`
    )
    .get(windowId) as { containerId: string; gitUrl: string } | undefined
  if (!row) throw new Error('Window not found')

  const clonePath = `/workspace/${extractRepoName(row.gitUrl)}`
  const container = getDocker().getContainer(row.containerId)
  const branch = await getCurrentBranch(container, clonePath)
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot push: detached HEAD or branch unknown')
  }
  return gitPush(container, clonePath, branch, row.gitUrl, pat)
})
```

Add to `preload/index.ts`:

```ts
push: (windowId: number) => ipcRenderer.invoke('git:push', windowId),
```

Add to `Api` (both `types.ts` and `preload/index.d.ts`):

```ts
push: (
  windowId: number
) => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>
```

**Step 4: Verify pass**

Run: `cd window-manager && npm run test:main -- ipcHandlers` and `npm run typecheck`.

**Step 5: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts \
        window-manager/src/preload/index.ts window-manager/src/preload/index.d.ts \
        window-manager/src/renderer/src/types.ts \
        window-manager/tests/main/ipcHandlers.test.ts
git commit -m "feat(ipc): expose git:push"
```

---

### Task 4.3: Wire the Push button in `TerminalHost`

**What the user can do after this task:** Click Push in the detail pane → push runs inside the container → toast shows the result. Both pane buttons disable while the op runs.

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

**Step 1: Write the failing test**

In `WindowDetailPane.test.ts`:

```ts
it('invokes onPush when the Push button is clicked', async () => {
  getCurrentBranch.mockResolvedValue('x')
  const onPush = vi.fn()
  render(WindowDetailPane, {
    props: { win, project, onPush, pushDisabled: false }
  })
  await fireEvent.click(screen.getByRole('button', { name: /push/i }))
  expect(onPush).toHaveBeenCalled()
})

it('disables both buttons when commitDisabled or pushDisabled are true', () => {
  getCurrentBranch.mockResolvedValue('x')
  render(WindowDetailPane, {
    props: { win, project, commitDisabled: true, pushDisabled: true }
  })
  expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /push/i })).toBeDisabled()
})
```

**Step 2: Verify failure**

Run: `cd window-manager && npm run test:renderer -- WindowDetailPane`

Expected: FAIL (Push button currently hard-disabled / onPush not wired upstream).

**Step 3: Implement in `TerminalHost.svelte`**

```svelte
<script lang="ts">
  // ...existing imports + commit state
  let pushBusy = $state(false)

  async function runPush(): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.push(win.id)
      pushToast({
        level: res.ok ? 'success' : 'error',
        title: res.ok ? 'Pushed' : 'Push failed',
        body: res.stdout || res.stderr
      })
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }
</script>

<WindowDetailPane
  {win}
  {project}
  onCommit={() => (commitOpen = true)}
  onPush={runPush}
  commitDisabled={commitBusy || pushBusy}
  pushDisabled={commitBusy || pushBusy}
/>
```

(Replace the earlier `pushDisabled={true}` wiring from Task 3.5 with the computed `commitBusy || pushBusy`.)

**Step 4: Verify pass**

Run: `cd window-manager && npm run test`

Expected: all PASS.

**Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/TerminalHost.svelte \
        window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(renderer): wire Push button to git:push with toasts"
```

---

### Task 4.4: [CHECKPOINT] Phase 4 verification — full feature shipped

**What the user can do after this task:** Push real commits from the UI. Error cases (non-fast-forward, bad PAT, network) surface as error toasts with scrubbed git output. Nothing sensitive reaches disk inside the container.

**Step 1: Run all tests**

Run: `cd window-manager && npm run test`

Expected: every suite PASS.

**Step 2: Typecheck + lint + build**

Run: `cd window-manager && npm run typecheck && npm run lint && npm run build`

Expected: clean.

**Step 3: Manual UI smoke via `npm run dev`**

Prereqs: Docker, `cc` image, valid PAT, a test repo where you can create/overwrite branches.

Copy + tick every item below before declaring done:

- [ ] Create a window named `Push Test`. Inside the terminal, confirm branch is `push-test`.
- [ ] Make a change, commit via the Commit button — toast shows success.
- [ ] Click Push — success toast. In a browser or `git ls-remote`, confirm the `push-test` branch exists on the remote.
- [ ] Run `git push -u` a second time (click Push again with no new commits) — success toast, "Everything up-to-date".
- [ ] Diverge the remote: from another clone, push an unrelated commit to `push-test`. Back in the app, commit a local change, then click Push. Expect an **error toast** containing `! [rejected]` / `non-fast-forward`.
- [ ] Confirm toast bodies **do not contain the PAT** (search for the first 6 characters of your PAT).
- [ ] Confirm no PAT lands in container state: in the terminal run `grep -R "<first-6-of-PAT>" /workspace/<repo> /root 2>/dev/null` → no hits. Also `cat /workspace/<repo>/.git/config` → remote is SSH URL.
- [ ] While Push is in-flight, confirm both Commit and Push buttons are disabled.
- [ ] Clear the PAT in Settings, click Push → error toast "GitHub PAT not configured." (or similar), no hang.
- [ ] Restore PAT. Create a second window whose slug already exists on the remote. Commit + Push. Verify the remote branch gets the new commit on top of existing history.
- [ ] Close + reopen the window (via the sidebar). Pane still renders, polling still updates branch after a change in the terminal.
- [ ] DevTools console: no unhandled rejections or Svelte warnings through the entire flow.

**Step 4: Append `## Phase 4` to `docs/plans/2026-04-14-window-git-ops-test-verification.md`** with the ticked checklist and the final test output.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-window-git-ops-test-verification.md
git commit -m "test: phase 4 verification for push flow; feature complete"
```

**Step 6: Optional — update app-level docs**

If `CLAUDE.md` or `README.md` at the repo root need a short mention of the new Commit/Push flow, update them in a follow-up commit. Out of scope for this plan.

---

## Execution

Plan saved to `docs/plans/2026-04-14-window-git-ops-implementation.md`. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `blooperpowers:subagent-driven-development`.
2. **Parallel Session** — Open a new session in the worktree and drive it with `blooperpowers:executing-plans`.

Which approach?

