# Git Status Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll git status per container, display dirty/clean state + line counts in the footer, disable Commit when pristine, and refocus the summarizer prompt to produce commit-message style output.

**Architecture:** Extend the existing 5s branch poll in `WindowDetailPane` to also call a new `getGitStatus` IPC handler. `WindowDetailPane` holds local git status state for display and fires an `onGitStatus` callback so `TerminalHost` can update `commitDisabled`. The summarizer shell script prompt is updated in place; the JSON shape is preserved so no downstream changes are needed.

**Tech Stack:** TypeScript/Electron (main), Svelte 5 runes (renderer), Vitest

---

## File Map

| File | Change |
|------|--------|
| `window-manager/src/main/gitOps.ts` | Add `GitStatus` interface + `getGitStatus` function |
| `window-manager/src/main/ipcHandlers.ts` | Import + register `git:status` handler |
| `window-manager/src/preload/index.ts` | Expose `getGitStatus` in `window.api` |
| `window-manager/src/renderer/src/components/WindowDetailPane.svelte` | New prop + state + display + callback |
| `window-manager/src/renderer/src/components/TerminalHost.svelte` | `gitStatus` state + updated `commitDisabled` |
| `window-manager/files/claude-summarize.sh` | Updated Claude prompt |
| `window-manager/tests/main/gitOps.test.ts` | `getGitStatus` unit tests |
| `window-manager/tests/renderer/WindowDetailPane.test.ts` | Git status display + callback tests |

---

## Task 1: Add `getGitStatus` to `gitOps.ts`

**Files:**
- Modify: `window-manager/src/main/gitOps.ts`
- Test: `window-manager/tests/main/gitOps.test.ts`

- [ ] **Step 1.1: Write failing tests**

Append to `window-manager/tests/main/gitOps.test.ts`:

```typescript
function makeGitStatusContainer(
  porcelainOutput: string,
  porcelainExitCode: number,
  shortstatOutput: string,
  shortstatExitCode: number
) {
  let callCount = 0
  const responses = [
    { stdout: porcelainOutput, exitCode: porcelainExitCode },
    { stdout: shortstatOutput, exitCode: shortstatExitCode }
  ]
  const exec = vi.fn().mockImplementation(async () => {
    const resp = responses[callCount++] ?? { stdout: '', exitCode: 0 }
    return {
      start: vi.fn().mockResolvedValue({
        on(event: string, cb: (data?: Buffer) => void) {
          if (event === 'data' && resp.stdout) setImmediate(() => cb(Buffer.from(resp.stdout)))
          if (event === 'end') setImmediate(() => cb())
          return this
        }
      }),
      inspect: vi.fn().mockResolvedValue({ ExitCode: resp.exitCode })
    }
  })
  return { id: 'c', exec }
}

describe('getGitStatus', () => {
  it('returns isDirty=false with 0/0 when working tree is clean', async () => {
    const container = makeGitStatusContainer('', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: false, added: 0, deleted: 0 })
  })

  it('returns isDirty=true with parsed counts when tracked files are modified', async () => {
    const container = makeGitStatusContainer(
      ' M src/foo.ts\n',
      0,
      ' 1 file changed, 12 insertions(+), 5 deletions(-)\n',
      0
    )
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 12, deleted: 5 })
  })

  it('returns isDirty=true with 0/0 when only untracked files exist', async () => {
    const container = makeGitStatusContainer('?? newfile.ts\n', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 0, deleted: 0 })
  })

  it('returns isDirty=false with 0/0 when not a git repo (status fails)', async () => {
    const container = makeGitStatusContainer('', 128, '', 128)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: false, added: 0, deleted: 0 })
  })

  it('handles shortstat with only insertions (no deletions line)', async () => {
    const container = makeGitStatusContainer(
      'M  README.md\n',
      0,
      ' 1 file changed, 3 insertions(+)\n',
      0
    )
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 3, deleted: 0 })
  })

  it('passes git -C clonePath for both commands', async () => {
    const container = makeGitStatusContainer('', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await getGitStatus(container, '/workspace/myrepo')
    const cmds = container.exec.mock.calls.map((c: [{ Cmd: string[] }]) => c[0].Cmd)
    expect(cmds[0]).toContain('-C')
    expect(cmds[0]).toContain('/workspace/myrepo')
    expect(cmds[0]).toContain('--porcelain')
    expect(cmds[1]).toContain('--shortstat')
    expect(cmds[1]).toContain('HEAD')
  })
})
```

- [ ] **Step 1.2: Run tests, verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/gitOps.test.ts 2>&1 | tail -20
```

Expected: FAIL — `getGitStatus is not a function` or similar import error.

- [ ] **Step 1.3: Add `GitStatus` interface and `getGitStatus` to `gitOps.ts`**

Add after the `CommitInput` interface (around line 195 of `window-manager/src/main/gitOps.ts`):

```typescript
export interface GitStatus {
  isDirty: boolean
  added: number
  deleted: number
}

export async function getGitStatus(container: Container, clonePath: string): Promise<GitStatus> {
  const porcelainResult = await execInContainer(container, [
    'git', '-C', clonePath, 'status', '--porcelain'
  ])
  const isDirty = porcelainResult.ok && porcelainResult.stdout.trim().length > 0

  const shortstatResult = await execInContainer(container, [
    'git', '-C', clonePath, 'diff', '--shortstat', 'HEAD'
  ])

  let added = 0
  let deleted = 0
  if (shortstatResult.ok && shortstatResult.stdout.trim().length > 0) {
    const addedMatch = shortstatResult.stdout.match(/(\d+) insertion/)
    const deletedMatch = shortstatResult.stdout.match(/(\d+) deletion/)
    if (addedMatch) added = parseInt(addedMatch[1], 10)
    if (deletedMatch) deleted = parseInt(deletedMatch[1], 10)
  }

  return { isDirty, added, deleted }
}
```

- [ ] **Step 1.4: Run tests, verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.node.config.ts tests/main/gitOps.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 1.5: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/main/gitOps.ts tests/main/gitOps.test.ts
git commit -m "feat: add getGitStatus to gitOps"
```

---

## Task 2: Wire IPC Handler + Preload

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 2.1: Import `getGitStatus` in `ipcHandlers.ts`**

In `window-manager/src/main/ipcHandlers.ts`, update the import line for gitOps (currently line 19):

```typescript
import { getCurrentBranch, stageAndCommit, push as gitPush, listContainerDir, readContainerFile, writeFileInContainer, getGitStatus } from './gitOps'
```

- [ ] **Step 2.2: Register the IPC handler in `ipcHandlers.ts`**

In `window-manager/src/main/ipcHandlers.ts`, add after the `git:push` handler (after line 104):

```typescript
  ipcMain.handle('git:status', async (_, windowId: number) => {
    const ctx = resolveWindowGitContext(windowId)
    return getGitStatus(ctx.container, ctx.clonePath)
  })
```

- [ ] **Step 2.3: Expose `getGitStatus` in preload**

In `window-manager/src/preload/index.ts`, add after `getCurrentBranch` (after line 26):

```typescript
  getGitStatus: (windowId: number) => ipcRenderer.invoke('git:status', windowId),
```

- [ ] **Step 2.4: Run main tests to confirm no regressions**

```bash
cd /workspace/claude-window/window-manager && npm run test:main 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 2.5: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/main/ipcHandlers.ts src/preload/index.ts
git commit -m "feat: register git:status IPC handler and expose via preload"
```

---

## Task 3: Extend `WindowDetailPane` — Poll, Display, Callback

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 3.1: Write failing tests**

Append to `window-manager/tests/renderer/WindowDetailPane.test.ts` (before the final closing `}` of the describe block, after the existing summary tests):

```typescript
  describe('git status display', () => {
    let getGitStatus: ReturnType<typeof vi.fn>

    beforeEach(() => {
      getGitStatus = vi.fn()
      // @ts-expect-error test bridge
      globalThis.window.api = { getCurrentBranch, sendTerminalInput, getGitStatus }
    })

    it('shows nothing extra before first poll resolves', () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      expect(document.querySelector('.git-stat')).toBeNull()
      expect(document.querySelector('.git-clean')).toBeNull()
    })

    it('shows (clean) when isDirty is false after poll', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      expect(await screen.findByText('(clean)')).toBeInTheDocument()
    })

    it('shows +N −N when isDirty with counts', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: true, added: 12, deleted: 5 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      expect(await screen.findByText('+12 −5')).toBeInTheDocument()
    })

    it('shows nothing extra when isDirty with 0/0 counts', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: true, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      await vi.runAllTimersAsync()
      expect(document.querySelector('.git-stat')).toBeNull()
      expect(document.querySelector('.git-clean')).toBeNull()
    })

    it('fires onGitStatus callback with status after each poll', async () => {
      getCurrentBranch.mockResolvedValue('main')
      const status = { isDirty: true, added: 3, deleted: 1 }
      getGitStatus.mockResolvedValue(status)
      const onGitStatus = vi.fn()
      render(WindowDetailPane, { props: { win, project, onGitStatus } })
      await vi.runOnlyPendingTimersAsync()
      expect(onGitStatus).toHaveBeenCalledWith(status)
    })
  })
```

- [ ] **Step 3.2: Run tests, verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -20
```

Expected: newly added tests FAIL (no `getGitStatus` call, no `.git-stat`/`.git-clean` elements).

- [ ] **Step 3.3: Add `onGitStatus` prop, `gitStatus` state to `WindowDetailPane.svelte`**

In `window-manager/src/renderer/src/components/WindowDetailPane.svelte`, update the `Props` interface (around line 8) to add:

```typescript
    onGitStatus?: (status: { isDirty: boolean; added: number; deleted: number } | null) => void
```

Update the destructured props (around line 22) to add the default:

```typescript
    onGitStatus = () => {}
```

Add `gitStatus` state after `let branch = $state('…')` (around line 59):

```typescript
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
```

- [ ] **Step 3.4: Extend `refreshBranch` to also poll git status**

Replace the existing `refreshBranch` function (lines 74–82 of `WindowDetailPane.svelte`) with:

```typescript
  async function refreshBranch(): Promise<void> {
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error; do not toast
    }
    if (alive && next) branch = next

    try {
      const status = await window.api.getGitStatus(win.id)
      if (alive) {
        gitStatus = status
        onGitStatus(status)
      }
    } catch {
      // keep last-known status on error
    }
  }
```

- [ ] **Step 3.5: Add git status display to the footer template**

In `window-manager/src/renderer/src/components/WindowDetailPane.svelte`, find the branch span in the template (around line 128):

```html
      <span class="branch" title="current branch">{branch}</span>
      <span class="sep">·</span>
      <span class="status {win.status}">{win.status}</span>
```

Replace with:

```html
      <span class="branch" title="current branch">{branch}</span>
      {#if gitStatus !== null}
        {#if gitStatus.isDirty && (gitStatus.added > 0 || gitStatus.deleted > 0)}
          <span class="sep">·</span>
          <span class="git-stat">+{gitStatus.added} −{gitStatus.deleted}</span>
        {:else if !gitStatus.isDirty}
          <span class="git-clean">(clean)</span>
        {/if}
      {/if}
      <span class="sep">·</span>
      <span class="status {win.status}">{win.status}</span>
```

- [ ] **Step 3.6: Add CSS for new elements**

In the `<style>` block of `WindowDetailPane.svelte`, add after the `.branch` rule:

```css
  .git-stat {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--warning, #facc15);
  }
  .git-clean {
    font-size: 0.78rem;
    color: var(--fg-3);
  }
```

- [ ] **Step 3.7: Run renderer tests, verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -20
```

Expected: all tests PASS including the new git status display tests.

- [ ] **Step 3.8: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/components/WindowDetailPane.svelte tests/renderer/WindowDetailPane.test.ts
git commit -m "feat: poll git status in WindowDetailPane and display in footer"
```

---

## Task 4: Wire `TerminalHost` — `gitStatus` State + `commitDisabled`

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`

No new tests needed — `TerminalHost` is an integration shell; the logic being tested is in `WindowDetailPane` (callback fires) and `gitOps` (getGitStatus). The `commitDisabled` prop behavior is already tested in `WindowDetailPane.test.ts`.

- [ ] **Step 4.1: Add `gitStatus` state to `TerminalHost.svelte`**

In `window-manager/src/renderer/src/components/TerminalHost.svelte`, add after `let deleteBusy = $state(false)` (line 33):

```typescript
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
```

- [ ] **Step 4.2: Wire `onGitStatus` callback and update `commitDisabled`**

In `TerminalHost.svelte`, find the `<WindowDetailPane` block (around line 164) and:

1. Add the `onGitStatus` prop:
```svelte
    onGitStatus={(s) => (gitStatus = s)}
```

2. Update the `commitDisabled` expression from:
```svelte
    commitDisabled={commitBusy || pushBusy || deleteBusy}
```
to:
```svelte
    commitDisabled={commitBusy || pushBusy || deleteBusy || !gitStatus?.isDirty}
```

- [ ] **Step 4.3: Run full renderer test suite**

```bash
cd /workspace/claude-window/window-manager && npm run test:renderer 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 4.4: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/components/TerminalHost.svelte
git commit -m "feat: disable commit button when working tree is clean"
```

---

## Task 5: Update Summarizer Prompt

**Files:**
- Modify: `window-manager/files/claude-summarize.sh`

- [ ] **Step 5.1: Replace the Claude prompt in `claude-summarize.sh`**

In `window-manager/files/claude-summarize.sh`, replace lines 10–12:

```bash
RESULT=$(claude --print \
  "Read this conversation transcript and output ONLY a JSON object with two fields: \"title\" (string, ≤60 chars, summarizes what was accomplished) and \"bullets\" (array of ≤5 strings, key points). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0
```

With:

```bash
RESULT=$(claude --print \
  "Read this conversation transcript. Focus only on code changes made — ignore discussion, questions, and explanations. Output ONLY a JSON object with two fields: \"title\" (string, ≤50 chars, conventional commit format e.g. 'feat: add retry logic', imperative mood, present tense) and \"bullets\" (array of ≤5 strings, each naming a specific code change: what file or behavior changed). No markdown, no explanation, no code fences." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0
```

- [ ] **Step 5.2: Verify the script is syntactically valid**

```bash
bash -n /workspace/claude-window/files/claude-summarize.sh && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 5.3: Run full test suite**

```bash
cd /workspace/claude-window/window-manager && npm run test 2>&1 | tail -15
```

Expected: all PASS.

- [ ] **Step 5.4: Commit**

```bash
cd /workspace/claude-window/window-manager && git add ../files/claude-summarize.sh
git commit -m "feat: refocus summarizer prompt to commit-message style code changes"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Git status polling → Task 1 (getGitStatus) + Task 2 (IPC) + Task 3 (poll extension)
  - Dirty/clean display in footer → Task 3 (display template + CSS)
  - Commit button disabled when pristine → Task 4 (commitDisabled expression)
  - Summarizer prompt → Task 5
- [x] **No placeholders** — all code blocks are complete
- [x] **Type consistency:**
  - `GitStatus` interface defined in Task 1 and referenced consistently as `{ isDirty: boolean; added: number; deleted: number }` in Tasks 2–4
  - `onGitStatus` prop type matches callback signature throughout
  - `git:status` IPC channel name consistent across handler (Task 2) and preload (Task 2)
