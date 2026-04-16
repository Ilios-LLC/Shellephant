# Dependency Env Vars + Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add env var CRUD to project dependencies and show running/stopped status of dep containers in the Dep Logs dropdown.

**Architecture:** Two independent features sharing a single IPC extension pass. Feature 1 adds `updateDependency` to the service/IPC/preload/UI layers and wires KV-row editors into `DependenciesSection.svelte`. Feature 2 adds a new `containerStatusService.ts`, a batch IPC handler, and a 5-second polling loop in `WindowDetailPane.svelte` that prefixes dropdown options with unicode status glyphs.

**Tech Stack:** Electron IPC, better-sqlite3, Dockerode, Svelte 5 runes, Vitest, @testing-library/svelte

---

## File Map

| File | Change |
|------|--------|
| `src/main/dependencyService.ts` | Add `updateDependency()` |
| `src/main/containerStatusService.ts` | **Create** — `getDepContainersStatus()` |
| `src/main/ipcHandlers.ts` | Add `project:dep-update` and `window:dep-containers-status` handlers |
| `src/preload/index.ts` | Expose `updateDependency` and `getDepContainersStatus` |
| `src/renderer/src/types.ts` | Add `ContainerStatus` type; add two entries to `Api` interface |
| `src/renderer/src/components/DependenciesSection.svelte` | KV-row editor in add form + inline edit per dep |
| `src/renderer/src/components/WindowDetailPane.svelte` | `depStatuses` state, 5s poll, unicode prefix in dropdown |
| `tests/main/dependencyService.test.ts` | Add `updateDependency` tests |
| `tests/main/containerStatusService.test.ts` | **Create** — unit tests for `getDepContainersStatus` |
| `tests/renderer/DependenciesSection.test.ts` | Add env var form and inline edit tests |
| `tests/renderer/WindowDetailPane.test.ts` | Add status poll and dropdown prefix tests |

---

## Task 1: `updateDependency` — service layer + test

**Files:**
- Modify: `window-manager/src/main/dependencyService.ts`
- Test: `window-manager/tests/main/dependencyService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/dependencyService.test.ts` inside the outer `describe('dependencyService', ...)` block:

```typescript
  describe('updateDependency', () => {
    it('updates env_vars and returns the updated dep', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      const updated = updateDependency(dep.id, { DB_PASS: 'hunter2' })
      expect(updated.env_vars).toEqual({ DB_PASS: 'hunter2' })
      expect(updated.id).toBe(dep.id)
    })

    it('persists env_vars so listDependencies reflects the change', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      updateDependency(dep.id, { KEY: 'val' })
      expect(listDependencies(pid)[0].env_vars).toEqual({ KEY: 'val' })
    })

    it('sets env_vars to null when passed null', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', { EXISTING: 'x' })
      const updated = updateDependency(dep.id, null)
      expect(updated.env_vars).toBeNull()
    })
  })
```

Also add `updateDependency` to the import at the top of the test file:
```typescript
import {
  listDependencies,
  createDependency,
  deleteDependency,
  validateImage,
  listWindowDeps,
  updateDependency
} from '../../src/main/dependencyService'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 'updateDependency'
```

Expected: `updateDependency` tests fail with `updateDependency is not a function`.

- [ ] **Step 3: Implement `updateDependency`**

Add after the `deleteDependency` function in `src/main/dependencyService.ts`:

```typescript
export function updateDependency(
  id: number,
  envVars: Record<string, string> | null
): ProjectDependency {
  const envJson = envVars && Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
  getDb()
    .prepare('UPDATE project_dependencies SET env_vars = ? WHERE id = ?')
    .run(envJson, id)
  return parseDep(
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE id = ?')
      .get(id) as RawDep
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 'updateDependency'
```

Expected: all three `updateDependency` tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/dependencyService.ts window-manager/tests/main/dependencyService.test.ts
git commit -m "feat(deps): add updateDependency service function"
```

---

## Task 2: `containerStatusService.ts` — new service + test

**Files:**
- Create: `window-manager/src/main/containerStatusService.ts`
- Create: `window-manager/tests/main/containerStatusService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/containerStatusService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetContainer = vi.fn()
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: mockGetContainer })
}))

import { getDepContainersStatus } from '../../src/main/containerStatusService'

function makeContainer(status: string) {
  return { inspect: vi.fn().mockResolvedValue({ State: { Status: status } }) }
}

describe('containerStatusService', () => {
  beforeEach(() => { mockGetContainer.mockReset() })

  it('returns running for a running container', async () => {
    mockGetContainer.mockReturnValue(makeContainer('running'))
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('running')
  })

  it('returns stopped for an exited container', async () => {
    mockGetContainer.mockReturnValue(makeContainer('exited'))
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('stopped')
  })

  it('returns unknown when inspect throws', async () => {
    mockGetContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('not found'))
    })
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('unknown')
  })

  it('handles multiple container IDs in one call', async () => {
    mockGetContainer
      .mockReturnValueOnce(makeContainer('running'))
      .mockReturnValueOnce(makeContainer('exited'))
    const result = await getDepContainersStatus(['c1', 'c2'])
    expect(result['c1']).toBe('running')
    expect(result['c2']).toBe('stopped')
  })

  it('returns empty object for empty input', async () => {
    const result = await getDepContainersStatus([])
    expect(result).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 'containerStatusService'
```

Expected: fail with `Cannot find module '../../src/main/containerStatusService'`.

- [ ] **Step 3: Implement `containerStatusService.ts`**

Create `src/main/containerStatusService.ts`:

```typescript
import { getDocker } from './docker'

export type ContainerStatus = 'running' | 'stopped' | 'unknown'

export async function getDepContainersStatus(
  containerIds: string[]
): Promise<Record<string, ContainerStatus>> {
  const entries = await Promise.all(
    containerIds.map(async (id) => {
      try {
        const info = await getDocker().getContainer(id).inspect()
        const status: ContainerStatus = info.State.Status === 'running' ? 'running' : 'stopped'
        return [id, status] as const
      } catch {
        return [id, 'unknown' as ContainerStatus] as const
      }
    })
  )
  return Object.fromEntries(entries)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:main -- --reporter=verbose 2>&1 | grep -A3 'containerStatusService'
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/containerStatusService.ts window-manager/tests/main/containerStatusService.test.ts
git commit -m "feat(deps): add containerStatusService with getDepContainersStatus"
```

---

## Task 3: IPC handlers + preload + types

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`

No new tests for this task — the IPC layer is an integration bridge; correctness is verified by the UI tests in Tasks 4–6.

- [ ] **Step 1: Add import + handler for `updateDependency` in `ipcHandlers.ts`**

Change the existing dependency service import (line 23–27):

```typescript
import {
  listDependencies,
  createDependency,
  deleteDependency,
  listWindowDepContainers,
  updateDependency
} from './dependencyService'
```

Then add the handler after the `project:dep-delete` handler (after line 86):

```typescript
  ipcMain.handle('project:dep-update', (_, id: number, envVars: Record<string, string> | null) =>
    updateDependency(id, envVars))
```

- [ ] **Step 2: Add import + handler for `getDepContainersStatus` in `ipcHandlers.ts`**

Add a new import after the `startDepLogs` import (line 28):

```typescript
import { getDepContainersStatus } from './containerStatusService'
```

Add handler after the `window:dep-logs-stop` handler (after line 98):

```typescript
  ipcMain.handle('window:dep-containers-status', (_, containerIds: string[]) =>
    getDepContainersStatus(containerIds))
```

- [ ] **Step 3: Expose both new APIs in `preload/index.ts`**

In the Dependency API section (after `deleteDependency`, before Dep logs API), add:

```typescript
  updateDependency: (id: number, envVars: Record<string, string> | null) =>
    ipcRenderer.invoke('project:dep-update', id, envVars),
  getDepContainersStatus: (ids: string[]) =>
    ipcRenderer.invoke('window:dep-containers-status', ids),
```

- [ ] **Step 4: Add `ContainerStatus` type and update `Api` interface in `types.ts`**

Add after the `WindowDependencyContainer` interface:

```typescript
export type ContainerStatus = 'running' | 'stopped' | 'unknown'
```

In the `Api` interface, add to the Dependencies section (after `listWindowDeps`):

```typescript
  updateDependency: (id: number, envVars: Record<string, string> | null) => Promise<ProjectDependency>
  getDepContainersStatus: (ids: string[]) => Promise<Record<string, ContainerStatus>>
```

- [ ] **Step 5: Type-check**

```bash
cd window-manager && npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/src/renderer/src/types.ts
git commit -m "feat(deps): wire updateDependency and getDepContainersStatus through IPC + preload"
```

---

## Task 4: `DependenciesSection.svelte` — env var rows in add form

**Files:**
- Modify: `window-manager/src/renderer/src/components/DependenciesSection.svelte`
- Test: `window-manager/tests/renderer/DependenciesSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('add form env vars', ...)` block inside the outer describe in `tests/renderer/DependenciesSection.test.ts`.

First, add `mockUpdateDependency` to the `beforeEach` setup:

```typescript
  let mockUpdateDependency: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockListDependencies = vi.fn().mockResolvedValue([])
    mockCreateDependency = vi.fn().mockResolvedValue(mockDep)
    mockDeleteDependency = vi.fn().mockResolvedValue(undefined)
    mockUpdateDependency = vi.fn().mockResolvedValue(mockDep)
    vi.stubGlobal('api', {
      listDependencies: mockListDependencies,
      createDependency: mockCreateDependency,
      deleteDependency: mockDeleteDependency,
      updateDependency: mockUpdateDependency
    })
  })
```

Then add these tests:

```typescript
  describe('add form env vars', () => {
    async function openForm() {
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
      await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    }

    it('shows Add Env Var button in add form', async () => {
      await openForm()
      expect(screen.getByRole('button', { name: /add env var/i })).toBeDefined()
    })

    it('clicking Add Env Var renders KEY and VALUE inputs', async () => {
      await openForm()
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      expect(screen.getByPlaceholderText(/^KEY$/i)).toBeDefined()
      expect(screen.getByPlaceholderText(/^VALUE$/i)).toBeDefined()
    })

    it('clicking × removes the env var row', async () => {
      await openForm()
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      expect(screen.getByPlaceholderText(/^KEY$/i)).toBeDefined()
      await fireEvent.click(screen.getByRole('button', { name: /remove env var/i }))
      expect(screen.queryByPlaceholderText(/^KEY$/i)).toBeNull()
    })

    it('passes env vars to createDependency on save', async () => {
      mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
      await openForm()
      await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      await fireEvent.input(screen.getByPlaceholderText(/^KEY$/i), { target: { value: 'DB_PASS' } })
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'secret' } })
      await fireEvent.click(screen.getByRole('button', { name: /save dependency/i }))
      await waitFor(() => {
        expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', { DB_PASS: 'secret' })
      })
    })

    it('skips rows with blank KEY on save', async () => {
      mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
      await openForm()
      await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      // leave KEY blank, fill VALUE
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'ignored' } })
      await fireEvent.click(screen.getByRole('button', { name: /save dependency/i }))
      await waitFor(() => {
        expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', {})
      })
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E '(FAIL|add env var|env vars)' | head -20
```

Expected: new tests fail.

- [ ] **Step 3: Add `formEnvRows` state and KV-row UI to `DependenciesSection.svelte`**

In the `<script>` block, add after `let formSaving`:

```typescript
  let formEnvRows = $state<{ key: string; value: string }[]>([])

  function addFormEnvRow(): void {
    formEnvRows = [...formEnvRows, { key: '', value: '' }]
  }

  function removeFormEnvRow(i: number): void {
    formEnvRows = formEnvRows.filter((_, idx) => idx !== i)
  }
```

Update `handleSave` to pass env vars — replace the `createDependency` call:

```typescript
      const envVars = Object.fromEntries(
        formEnvRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      )
      await window.api.createDependency(projectId, image, formTag.trim() || 'latest', envVars)
      showForm = false
      formImage = ''
      formTag = 'latest'
      formEnvRows = []
```

In the template, add the env var section inside `.add-form`, between the tag input row and the error/actions:

```svelte
      <div class="env-rows">
        {#each formEnvRows as row, i (i)}
          <div class="env-row">
            <input
              placeholder="KEY"
              aria-label="env key"
              bind:value={row.key}
              disabled={formSaving}
              class="env-key-input"
            />
            <span class="env-eq">=</span>
            <input
              placeholder="VALUE"
              aria-label="env value"
              bind:value={row.value}
              disabled={formSaving}
              class="env-val-input"
            />
            <button
              type="button"
              aria-label="remove env var"
              onclick={() => removeFormEnvRow(i)}
              disabled={formSaving}
              class="env-remove-btn"
            >×</button>
          </div>
        {/each}
        <button
          type="button"
          aria-label="add env var"
          onclick={addFormEnvRow}
          disabled={formSaving}
          class="env-add-btn"
        >+ Env Var</button>
      </div>
```

Add styles to the `<style>` block:

```css
  .env-rows { display: flex; flex-direction: column; gap: 0.3rem; }
  .env-row { display: flex; align-items: center; gap: 0.3rem; }
  .env-key-input { flex: 1; padding: 0.35rem 0.45rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-mono); font-size: 0.8rem; }
  .env-val-input { flex: 2; padding: 0.35rem 0.45rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-mono); font-size: 0.8rem; }
  .env-eq { font-family: var(--font-mono); font-size: 0.82rem; color: var(--fg-3); }
  .env-remove-btn { font-size: 0.78rem; padding: 0 0.35rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; line-height: 1.6; }
  .env-add-btn { font-family: var(--font-ui); font-size: 0.75rem; padding: 0.2rem 0.5rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; align-self: flex-start; }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E '(PASS|FAIL|add env var|env vars)' | head -20
```

Expected: all new tests pass, existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/renderer/src/components/DependenciesSection.svelte window-manager/tests/renderer/DependenciesSection.test.ts
git commit -m "feat(deps): add env var KV-row editor to dependency add form"
```

---

## Task 5: `DependenciesSection.svelte` — inline edit for existing deps

**Files:**
- Modify: `window-manager/src/renderer/src/components/DependenciesSection.svelte`
- Test: `window-manager/tests/renderer/DependenciesSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe('inline env var edit', ...)` block in `DependenciesSection.test.ts`:

```typescript
  describe('inline env var edit', () => {
    const depWithEnv = {
      id: 2,
      project_id: 1,
      image: 'redis',
      tag: '7',
      env_vars: { REDIS_PASS: 'pw' },
      created_at: ''
    }

    it('shows Edit Env Vars button per dep', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByText('postgres:latest'))
      expect(screen.getByRole('button', { name: /edit env vars/i })).toBeDefined()
    })

    it('expanding edit shows pre-populated KEY and VALUE inputs', async () => {
      mockListDependencies.mockResolvedValue([depWithEnv])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      expect((screen.getByPlaceholderText(/^KEY$/i) as HTMLInputElement).value).toBe('REDIS_PASS')
      expect((screen.getByPlaceholderText(/^VALUE$/i) as HTMLInputElement).value).toBe('pw')
    })

    it('save calls updateDependency with new values', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      await fireEvent.input(screen.getByPlaceholderText(/^KEY$/i), { target: { value: 'FOO' } })
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'bar' } })
      await fireEvent.click(screen.getByRole('button', { name: /save env vars/i }))
      await waitFor(() => expect(mockUpdateDependency).toHaveBeenCalledWith(1, { FOO: 'bar' }))
    })

    it('cancel collapses editor without calling updateDependency', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /cancel env vars/i }))
      expect(mockUpdateDependency).not.toHaveBeenCalled()
      expect(screen.queryByPlaceholderText(/^KEY$/i)).toBeNull()
    })

    it('opening a second edit collapses the first', async () => {
      const dep2 = { ...depWithEnv, id: 3, image: 'mysql', tag: '8' }
      mockListDependencies.mockResolvedValue([depWithEnv, dep2])
      mountSection()
      await waitFor(() => {
        const btns = screen.getAllByRole('button', { name: /edit env vars/i })
        expect(btns).toHaveLength(2)
      })
      const [btn1, btn2] = screen.getAllByRole('button', { name: /edit env vars/i })
      await fireEvent.click(btn1)
      expect(screen.getAllByPlaceholderText(/^KEY$/i)).toHaveLength(1)
      await fireEvent.click(btn2)
      expect(screen.getAllByPlaceholderText(/^KEY$/i)).toHaveLength(1)
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E '(FAIL|inline env var|edit env)' | head -20
```

Expected: new tests fail.

- [ ] **Step 3: Add inline edit state and functions to `DependenciesSection.svelte`**

In the `<script>` block, add after `formEnvRows`/`addFormEnvRow`/`removeFormEnvRow`:

```typescript
  let editingDepId = $state<number | null>(null)
  let editRows = $state<{ key: string; value: string }[]>([])
  let editSaving = $state(false)
  let editError = $state('')

  function openEdit(dep: ProjectDependency): void {
    editingDepId = dep.id
    editRows = dep.env_vars
      ? Object.entries(dep.env_vars).map(([key, value]) => ({ key, value }))
      : []
    editError = ''
  }

  function closeEdit(): void {
    editingDepId = null
    editRows = []
    editError = ''
  }

  function addEditRow(): void {
    editRows = [...editRows, { key: '', value: '' }]
  }

  function removeEditRow(i: number): void {
    editRows = editRows.filter((_, idx) => idx !== i)
  }

  async function handleEditSave(depId: number): Promise<void> {
    editSaving = true
    editError = ''
    try {
      const envVars = Object.fromEntries(
        editRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      )
      await window.api.updateDependency(depId, Object.keys(envVars).length > 0 ? envVars : null)
      closeEdit()
      await load()
    } catch (e) {
      editError = e instanceof Error ? e.message : String(e)
    } finally {
      editSaving = false
    }
  }
```

- [ ] **Step 4: Add inline edit UI to the dep list template**

Replace the existing `<li class="dep-item">` block with:

```svelte
        <li class="dep-item-wrap">
          <div class="dep-item">
            <span class="dep-name">{dep.image}:{dep.tag}</span>
            <button
              type="button"
              class="edit-env-btn"
              aria-label="edit env vars"
              onclick={() => editingDepId === dep.id ? closeEdit() : openEdit(dep)}
            >Env</button>
            <button
              type="button"
              class="del-btn"
              class:confirming={confirmDeleteId === dep.id}
              aria-label={getDeleteLabel(dep)}
              onclick={() => handleDelete(dep.id)}
            >{confirmDeleteId === dep.id ? 'Delete?' : '×'}</button>
          </div>
          {#if editingDepId === dep.id}
            <div class="inline-edit">
              <div class="env-rows">
                {#each editRows as row, i (i)}
                  <div class="env-row">
                    <input
                      placeholder="KEY"
                      aria-label="env key"
                      bind:value={row.key}
                      disabled={editSaving}
                      class="env-key-input"
                    />
                    <span class="env-eq">=</span>
                    <input
                      placeholder="VALUE"
                      aria-label="env value"
                      bind:value={row.value}
                      disabled={editSaving}
                      class="env-val-input"
                    />
                    <button
                      type="button"
                      aria-label="remove env var"
                      onclick={() => removeEditRow(i)}
                      disabled={editSaving}
                      class="env-remove-btn"
                    >×</button>
                  </div>
                {/each}
                <button
                  type="button"
                  aria-label="add env var"
                  onclick={addEditRow}
                  disabled={editSaving}
                  class="env-add-btn"
                >+ Env Var</button>
              </div>
              {#if editError}<p class="error">{editError}</p>{/if}
              <div class="edit-actions">
                <button
                  type="button"
                  aria-label="cancel env vars"
                  onclick={closeEdit}
                  disabled={editSaving}
                >Cancel</button>
                <button
                  type="button"
                  class="save-btn"
                  aria-label="save env vars"
                  onclick={() => handleEditSave(dep.id)}
                  disabled={editSaving}
                >{editSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          {/if}
        </li>
```

Add to the `<style>` block:

```css
  .dep-item-wrap { display: flex; flex-direction: column; gap: 0.25rem; }
  .edit-env-btn { font-size: 0.72rem; padding: 0 0.4rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; }
  .inline-edit { padding: 0.5rem 0.65rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; display: flex; flex-direction: column; gap: 0.35rem; }
  .edit-actions { display: flex; justify-content: flex-end; gap: 0.4rem; }
  .edit-actions button { font-family: var(--font-ui); font-size: 0.8rem; padding: 0.3rem 0.65rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; }
```

- [ ] **Step 5: Run all DependenciesSection tests**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E 'DependenciesSection' | head -30
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/DependenciesSection.svelte window-manager/tests/renderer/DependenciesSection.test.ts
git commit -m "feat(deps): add inline env var editor for existing dependencies"
```

---

## Task 6: `WindowDetailPane.svelte` — dep status poll + dropdown prefix

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `mockGetDepContainersStatus` to the `beforeEach` setup in `WindowDetailPane.test.ts`:

```typescript
let mockGetDepContainersStatus: ReturnType<typeof vi.fn>

// inside beforeEach, after the existing mocks:
  mockGetDepContainersStatus = vi.fn().mockResolvedValue({})
  // @ts-expect-error test bridge
  globalThis.window.api = {
    getCurrentBranch,
    sendTerminalInput,
    getGitStatus,
    listWindowDeps: mockListWindowDeps,
    startDepLogs: mockStartDepLogs,
    stopDepLogs: mockStopDepLogs,
    onDepLogsData: mockOnDepLogsData,
    offDepLogsData: mockOffDepLogsData,
    getDepContainersStatus: mockGetDepContainersStatus
  }
```

Add a new describe block for status indicator tests:

```typescript
  describe('dep container status indicator', () => {
    const depContainers: WindowDependencyContainer[] = [
      { id: 1, window_id: 1, dependency_id: 1, container_id: 'ctr-1', image: 'redis', tag: 'latest' },
      { id: 2, window_id: 1, dependency_id: 2, container_id: 'ctr-2', image: 'postgres', tag: '15' }
    ]

    it('does not call getDepContainersStatus when no dep containers', async () => {
      mockListWindowDeps.mockResolvedValue([])
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).not.toHaveBeenCalled()
    })

    it('calls getDepContainersStatus on mount when dep containers exist', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'stopped' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).toHaveBeenCalledWith(['ctr-1', 'ctr-2'])
    })

    it('shows ▶ prefix for running container in dropdown', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'stopped' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      // Toggle dep logs to show the dropdown
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      // The select options should have status prefixes
      const options = document.querySelectorAll('.dep-selector option')
      expect(options[0].textContent).toContain('▶')
      expect(options[1].textContent).toContain('■')
    })

    it('polls getDepContainersStatus every 5 seconds', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'running' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockGetDepContainersStatus).toHaveBeenCalledTimes(2)
    })

    it('shows ? prefix for unknown status', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'unknown', 'ctr-2': 'unknown' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      const options = document.querySelectorAll('.dep-selector option')
      expect(options[0].textContent).toContain('?')
      expect(options[1].textContent).toContain('?')
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E '(FAIL|status indicator|dep container status)' | head -20
```

Expected: new tests fail.

- [ ] **Step 3: Add `depStatuses` state and polling to `WindowDetailPane.svelte`**

First, update the existing types import at the top of `<script>` (currently line 3) to add `ContainerStatus`:

```typescript
  import type { ProjectRecord, WindowRecord, WindowDependencyContainer, ContainerStatus } from '../types'
```

Then, in the `<script>` block, add after `const MAX_LOG_LINES = 500`:

```typescript
  let depStatuses = $state<Record<string, ContainerStatus>>({})
  let statusTimer: ReturnType<typeof setInterval> | undefined

  async function refreshDepStatuses(): Promise<void> {
    if (depContainers.length === 0) return
    try {
      const statuses = await window.api.getDepContainersStatus(depContainers.map(d => d.container_id))
      if (alive) depStatuses = statuses
    } catch {
      // keep last-known statuses on error
    }
  }
```

In `onMount`, after setting `selectedDepContainerId`, add the status fetch and poll:

```typescript
    if (containers.length > 0) {
      selectedDepContainerId = containers[0].container_id
      void refreshDepStatuses()
      statusTimer = setInterval(refreshDepStatuses, 5000)
    }
```

In `onDestroy`, add cleanup:

```typescript
    if (statusTimer) clearInterval(statusTimer)
```

- [ ] **Step 4: Add a helper and update the dropdown template**

Add this helper function in the `<script>` block:

```typescript
  function statusPrefix(containerId: string): string {
    const s = depStatuses[containerId]
    if (s === 'running') return '▶ '
    if (s === 'stopped') return '■ '
    return '? '
  }
```

Update the dropdown `<option>` in the template from:

```svelte
            <option value={dc.container_id}>{dc.image}:{dc.tag}</option>
```

to:

```svelte
            <option value={dc.container_id}>{statusPrefix(dc.container_id)}{dc.image}:{dc.tag}</option>
```

Update the single-dep label from:

```svelte
        <span class="dep-label">{depContainers[0].image}:{depContainers[0].tag}</span>
```

to:

```svelte
        <span class="dep-label">{statusPrefix(depContainers[0].container_id)}{depContainers[0].image}:{depContainers[0].tag}</span>
```

- [ ] **Step 5: Run all WindowDetailPane tests**

```bash
cd window-manager && npm run test:renderer -- --reporter=verbose 2>&1 | grep -E 'WindowDetailPane' | head -30
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

```bash
cd window-manager && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat(deps): poll dep container status and show ▶/■/? prefix in dropdown"
```
