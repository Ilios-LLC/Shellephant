# Bridge Network Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let projects store a default Docker bridge network; when creating a window, users pick auto-create, project default, or custom from a radio group.

**Architecture:** DB migration adds `default_network TEXT DEFAULT NULL` to `projects`. `listBridgeNetworks()` and `updateProjectDefaultNetwork()` wire through IPC to the renderer. `ProjectSettingsView` gains a network dropdown (immediate-save); `NewWindowWizard` replaces the free-text input with a three-way radio group locked out when `withDeps=true`.

**Tech Stack:** better-sqlite3, Dockerode, Electron IPC, Svelte 5 runes, Vitest, @testing-library/svelte

---

## File Map

| File | Change |
|---|---|
| `window-manager/src/main/docker.ts` | Add `listBridgeNetworks()` |
| `window-manager/src/main/db.ts` | Add `default_network` column migration |
| `window-manager/src/main/projectService.ts` | Add `default_network` to type + queries; add `updateProjectDefaultNetwork()` |
| `window-manager/src/main/ipcHandlers.ts` | Add two handlers |
| `window-manager/src/preload/index.ts` | Add two preload methods |
| `window-manager/src/renderer/src/types.ts` | Add `default_network` to `ProjectRecord`; add two methods to `Api` |
| `window-manager/src/renderer/src/components/ProjectSettingsView.svelte` | Add Default Bridge Network section |
| `window-manager/src/renderer/src/components/NewWindowWizard.svelte` | Replace text input with radio group |
| `window-manager/tests/main/docker.test.ts` | New — 3 tests |
| `window-manager/tests/main/projectService.test.ts` | Add 4 tests |
| `window-manager/tests/renderer/ProjectSettingsView.test.ts` | Add 6 tests |
| `window-manager/tests/renderer/NewWindowWizard.test.ts` | Add 9 tests |

---

### Task 1: `listBridgeNetworks` Docker utility

**Files:**
- Modify: `window-manager/src/main/docker.ts`
- Create: `window-manager/tests/main/docker.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `window-manager/tests/main/docker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListNetworks = vi.fn()

vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({ listNetworks: mockListNetworks }))
}))

import { listBridgeNetworks } from '../../src/main/docker'

describe('listBridgeNetworks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user bridge networks sorted by name', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'abc', Name: 'my-net', Driver: 'bridge' },
      { Id: 'mno', Name: 'alpha-net', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([
      { id: 'mno', name: 'alpha-net' },
      { id: 'abc', name: 'my-net' },
    ])
  })

  it('strips Docker internal networks (bridge, host, none)', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'a', Name: 'bridge', Driver: 'bridge' },
      { Id: 'b', Name: 'host', Driver: 'bridge' },
      { Id: 'c', Name: 'none', Driver: 'bridge' },
      { Id: 'd', Name: 'user-net', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([{ id: 'd', name: 'user-net' }])
  })

  it('returns empty array when no user bridge networks exist', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'a', Name: 'bridge', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/docker.test.ts
```

Expected: FAIL — `listBridgeNetworks is not a function` or similar.

- [ ] **Step 1.3: Implement `listBridgeNetworks` in `docker.ts`**

Add after the existing `getDocker` export in `window-manager/src/main/docker.ts`:

```typescript
const INTERNAL_NETWORKS = new Set(['bridge', 'host', 'none'])

export async function listBridgeNetworks(): Promise<{ id: string; name: string }[]> {
  const networks = await getDocker().listNetworks({ filters: { driver: ['bridge'] } })
  return (networks as { Id: string; Name: string }[])
    .filter(n => !INTERNAL_NETWORKS.has(n.Name))
    .map(n => ({ id: n.Id, name: n.Name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/docker.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add window-manager/src/main/docker.ts window-manager/tests/main/docker.test.ts
git commit -m "feat: add listBridgeNetworks Docker utility"
```

---

### Task 2: DB migration + `updateProjectDefaultNetwork`

**Files:**
- Modify: `window-manager/src/main/db.ts:13-31`
- Modify: `window-manager/src/main/projectService.ts`
- Modify: `window-manager/tests/main/projectService.test.ts`

- [ ] **Step 2.1: Write failing tests**

Add the import for `updateProjectDefaultNetwork` to the import block at lines 24-32 of `window-manager/tests/main/projectService.test.ts`:

```typescript
import {
  createProject,
  listProjects,
  deleteProject,
  updateProject,
  getProject,
  updateProjectEnvVars,
  updateProjectPorts,
  updateProjectDefaultNetwork
} from '../../src/main/projectService'
```

Add the following describe blocks inside the outer `describe('projectService', ...)` block at the bottom of the file:

```typescript
  describe('updateProjectDefaultNetwork', () => {
    it('sets a network name on the project', async () => {
      const proj = await createProject('net-test', 'git@github.com:org/net-test.git')
      updateProjectDefaultNetwork(proj.id, 'my-network')
      const updated = getProject(proj.id)!
      expect(updated.default_network).toBe('my-network')
    })

    it('clears the network to null', async () => {
      const proj = await createProject('net-test2', 'git@github.com:org/net-test2.git')
      updateProjectDefaultNetwork(proj.id, 'my-network')
      updateProjectDefaultNetwork(proj.id, null)
      const updated = getProject(proj.id)!
      expect(updated.default_network).toBeNull()
    })

    it('throws when project does not exist', () => {
      expect(() => updateProjectDefaultNetwork(9999, 'net')).toThrow('Project 9999 not found')
    })
  })

  describe('listProjects with default_network', () => {
    it('returns default_network for each project', async () => {
      const proj = await createProject('net-list', 'git@github.com:org/net-list.git')
      updateProjectDefaultNetwork(proj.id, 'test-net')
      const projects = listProjects()
      const found = projects.find(p => p.id === proj.id)!
      expect(found.default_network).toBe('test-net')
    })
  })
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: FAIL — `updateProjectDefaultNetwork is not a function`.

- [ ] **Step 2.3: Add DB migration for `default_network` column in `db.ts`**

In `window-manager/src/main/db.ts`, add inside `runColumnMigrations` after the `network_id` migration at lines 28-30:

```typescript
  if (!col(db, 'projects').includes('default_network')) {
    db.exec('ALTER TABLE projects ADD COLUMN default_network TEXT DEFAULT NULL')
  }
```

- [ ] **Step 2.4: Update `ProjectRecord` type and all SELECT queries in `projectService.ts`**

Replace the `ProjectRecord` interface (lines 12-21):

```typescript
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  env_vars?: string | null
  group_id?: number | null
  default_network?: string | null
  created_at: string
}
```

Replace the `listProjects` SELECT string (line 95):

```typescript
      'SELECT id, name, git_url, ports, env_vars, group_id, default_network, created_at FROM projects WHERE deleted_at IS NULL'
```

Replace the `updateProject` inner SELECT string (line 107-109):

```typescript
      'SELECT id, name, git_url, ports, env_vars, group_id, default_network, created_at FROM projects WHERE id = ? AND deleted_at IS NULL'
```

Replace the `getProject` SELECT string (line 136-138):

```typescript
      'SELECT id, name, git_url, ports, env_vars, group_id, default_network, created_at FROM projects WHERE id = ? AND deleted_at IS NULL'
```

- [ ] **Step 2.5: Add `updateProjectDefaultNetwork` to `projectService.ts`**

Add after `updateProjectPorts` (after line 167):

```typescript
export function updateProjectDefaultNetwork(id: number, network: string | null): void {
  const result = getDb()
    .prepare('UPDATE projects SET default_network = ? WHERE id = ? AND deleted_at IS NULL')
    .run(network, id)
  if (result.changes === 0) throw new Error(`Project ${id} not found`)
}
```

- [ ] **Step 2.6: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run --config vitest.node.config.ts tests/main/projectService.test.ts
```

Expected: PASS — all tests pass including the 4 new ones.

- [ ] **Step 2.7: Commit**

```bash
git add window-manager/src/main/db.ts window-manager/src/main/projectService.ts window-manager/tests/main/projectService.test.ts
git commit -m "feat: add default_network column and updateProjectDefaultNetwork"
```

---

### Task 3: IPC wiring + renderer types

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/renderer/src/types.ts`

No unit tests for IPC wiring — covered by integration of Tasks 4 and 5.

- [ ] **Step 3.1: Update imports and add handlers in `ipcHandlers.ts`**

Replace the `projectService` import line (line 3):

```typescript
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars, updateProjectPorts, updateProjectDefaultNetwork, type PortMapping } from './projectService'
```

Replace the `docker` import line (line 18):

```typescript
import { getDocker, listBridgeNetworks } from './docker'
```

Add two handlers after the `project:update-ports` handler (after line 79) inside `registerIpcHandlers`:

```typescript
  ipcMain.handle('project:update-default-network', (_, id: number, network: string | null) =>
    updateProjectDefaultNetwork(id, network)
  )
  ipcMain.handle('docker:list-bridge-networks', () => listBridgeNetworks())
```

- [ ] **Step 3.2: Add preload methods in `preload/index.ts`**

Add two methods after `updateProjectPorts` (after line 15):

```typescript
  updateProjectDefaultNetwork: (id: number, network: string | null) =>
    ipcRenderer.invoke('project:update-default-network', id, network),
  listDockerNetworks: () => ipcRenderer.invoke('docker:list-bridge-networks'),
```

- [ ] **Step 3.3: Update renderer `types.ts`**

Replace the `ProjectRecord` interface (lines 15-23):

```typescript
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  env_vars?: string | null
  group_id?: number | null
  default_network?: string | null
  created_at: string
}
```

Add two methods to the `Api` interface after `updateProjectPorts` (line 77):

```typescript
  updateProjectDefaultNetwork: (id: number, network: string | null) => Promise<void>
  listDockerNetworks: () => Promise<{ id: string; name: string }[]>
```

- [ ] **Step 3.4: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/src/renderer/src/types.ts
git commit -m "feat: wire IPC for bridge network default"
```

---

### Task 4: `ProjectSettingsView` network section

**Files:**
- Modify: `window-manager/src/renderer/src/components/ProjectSettingsView.svelte`
- Modify: `window-manager/tests/renderer/ProjectSettingsView.test.ts`

- [ ] **Step 4.1: Update test file with new mocks and failing tests**

In `window-manager/tests/renderer/ProjectSettingsView.test.ts`, add two variable declarations after the existing `let mockUpdatePorts` declaration:

```typescript
  let mockListDockerNetworks: ReturnType<typeof vi.fn>
  let mockUpdateProjectDefaultNetwork: ReturnType<typeof vi.fn>
```

Replace the entire `beforeEach` block to include the new mock methods:

```typescript
  beforeEach(() => {
    mockGetProject = vi.fn().mockResolvedValue(project)
    mockUpdateEnvVars = vi.fn().mockResolvedValue(undefined)
    mockUpdatePorts = vi.fn().mockResolvedValue(undefined)
    mockListDockerNetworks = vi.fn().mockResolvedValue([
      { id: 'abc', name: 'app-net' },
      { id: 'def', name: 'db-net' }
    ])
    mockUpdateProjectDefaultNetwork = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      getProject: mockGetProject,
      updateProjectEnvVars: mockUpdateEnvVars,
      updateProjectPorts: mockUpdatePorts,
      listDockerNetworks: mockListDockerNetworks,
      updateProjectDefaultNetwork: mockUpdateProjectDefaultNetwork
    })
  })
```

Add the following `describe` block inside `describe('ProjectSettingsView', ...)` at the bottom of the file:

```typescript
  describe('Default Bridge Network section', () => {
    it('renders the network section heading', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => expect(screen.getByText(/default bridge network/i)).toBeInTheDocument())
    })

    it('renders "None (no default)" option and selects it when project.default_network is null', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        const select = screen.getByRole('combobox', { name: /default bridge network/i }) as HTMLSelectElement
        expect(select.value).toBe('')
      })
    })

    it('populates dropdown with networks from listDockerNetworks', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'app-net' })).toBeDefined()
        expect(screen.getByRole('option', { name: 'db-net' })).toBeDefined()
      })
    })

    it('calls updateProjectDefaultNetwork when a network is selected', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => screen.getByRole('combobox', { name: /default bridge network/i }))
      await fireEvent.change(
        screen.getByRole('combobox', { name: /default bridge network/i }),
        { target: { value: 'app-net' } }
      )
      await waitFor(() =>
        expect(mockUpdateProjectDefaultNetwork).toHaveBeenCalledWith(1, 'app-net')
      )
    })

    it('calls listDockerNetworks again when refresh button is clicked', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => screen.getByRole('button', { name: /refresh networks/i }))
      await fireEvent.click(screen.getByRole('button', { name: /refresh networks/i }))
      expect(mockListDockerNetworks).toHaveBeenCalledTimes(2)
    })

    it('pre-selects the current default_network when set', async () => {
      const projectWithNet = { ...project, default_network: 'app-net' }
      mockGetProject.mockResolvedValue(projectWithNet)
      render(ProjectSettingsView, baseProps({ project: projectWithNet }))
      await waitFor(() => {
        const select = screen.getByRole('combobox', { name: /default bridge network/i }) as HTMLSelectElement
        expect(select.value).toBe('app-net')
      })
    })
  })
```

- [ ] **Step 4.2: Run tests to verify new ones fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectSettingsView.test.ts
```

Expected: Existing tests PASS. New network section tests FAIL — section not in component yet.

- [ ] **Step 4.3: Add state, helpers, and `onMount` change to `ProjectSettingsView.svelte`**

Add after `let error = $state('')` (line 31) in the `<script>` block:

```typescript
  let networks = $state<{ id: string; name: string }[]>([])
  let networksLoading = $state(false)
  let selectedNetwork = $state(project.default_network ?? '')

  async function loadNetworks(): Promise<void> {
    networksLoading = true
    try {
      networks = await window.api.listDockerNetworks()
    } catch {
      // best-effort; user can retry with refresh button
    } finally {
      networksLoading = false
    }
  }

  async function handleNetworkChange(e: Event): Promise<void> {
    const value = (e.target as HTMLSelectElement).value
    selectedNetwork = value
    await window.api.updateProjectDefaultNetwork(project.id, value || null)
  }
```

Replace the entire `onMount` block (lines 33-51) to call `loadNetworks` in parallel:

```typescript
  onMount(async () => {
    try {
      const [record] = await Promise.all([
        window.api.getProject(project.id),
        loadNetworks()
      ])
      if (record?.env_vars) {
        const parsed = JSON.parse(record.env_vars) as Record<string, string>
        rows = Object.entries(parsed).map(([key, value]) => ({ id: nextId++, key, value }))
      }
      if (record?.ports) {
        const parsedPorts = JSON.parse(record.ports) as PortMapping[]
        portRows = parsedPorts.map((pm) => ({
          id: nextPortId++,
          container: String(pm.container),
          host: pm.host !== undefined ? String(pm.host) : ''
        }))
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  })
```

- [ ] **Step 4.4: Add network section to template in `ProjectSettingsView.svelte`**

Add after the Port Mappings `</section>` closing tag (after line 195):

```html
    <section class="section">
      <div class="section-title">Default Bridge Network</div>
      <p class="hint">Applies to new windows without dependencies.</p>
      <div class="network-row">
        {#if networksLoading}
          <span class="hint">Loading…</span>
        {:else}
          <select
            aria-label="Default bridge network"
            value={selectedNetwork}
            onchange={handleNetworkChange}
            disabled={busy}
          >
            <option value="">None (no default)</option>
            {#each networks as net (net.id)}
              <option value={net.name}>{net.name}</option>
            {/each}
          </select>
          <button
            type="button"
            aria-label="refresh networks"
            class="refresh-btn"
            onclick={loadNetworks}
            disabled={busy}
          >↺</button>
        {/if}
      </div>
    </section>
```

Add styles to the `<style>` block before the closing `</style>`:

```css
  .network-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .network-row select {
    flex: 1;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    outline: none;
  }

  .network-row select:focus {
    border-color: var(--accent);
  }

  .refresh-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-2);
    font-size: 0.9rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg-0);
    border-color: var(--fg-1);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
```

- [ ] **Step 4.5: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/ProjectSettingsView.test.ts
```

Expected: PASS — all tests pass including the 6 new network section tests.

- [ ] **Step 4.6: Commit**

```bash
git add window-manager/src/renderer/src/components/ProjectSettingsView.svelte window-manager/tests/renderer/ProjectSettingsView.test.ts
git commit -m "feat: add default bridge network section to ProjectSettingsView"
```

---

### Task 5: `NewWindowWizard` radio group

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Modify: `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 5.1: Write failing tests**

Add the following `describe` block inside `describe('NewWindowWizard', ...)` at the bottom of `window-manager/tests/renderer/NewWindowWizard.test.ts`:

```typescript
  describe('network mode radio group', () => {
    it('renders auto-create, use-default, and custom radio options', async () => {
      render(NewWindowWizard, baseProps())
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: /auto-create/i })).toBeDefined()
        expect(screen.getByRole('radio', { name: /use project default/i })).toBeDefined()
        expect(screen.getByRole('radio', { name: /custom/i })).toBeDefined()
      })
    })

    it('"Use project default" is disabled when project has no default_network', async () => {
      render(NewWindowWizard, baseProps({ project: { ...project, default_network: null } }))
      await waitFor(() => {
        const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
        expect(radio.disabled).toBe(true)
      })
    })

    it('pre-selects "Use project default" when project.default_network is set', async () => {
      render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
      await waitFor(() => {
        const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
        expect(radio.checked).toBe(true)
      })
    })

    it('pre-selects "Auto-create" when project has no default_network', async () => {
      render(NewWindowWizard, baseProps({ project: { ...project, default_network: null } }))
      await waitFor(() => {
        const radio = screen.getByRole('radio', { name: /auto-create/i }) as HTMLInputElement
        expect(radio.checked).toBe(true)
      })
    })

    it('"Use project default" is disabled in multi-project mode', async () => {
      const p2: ProjectRecord = { id: 2, name: 'p2', git_url: 'git@github.com:x/p2.git', created_at: '', default_network: 'some-net' }
      render(NewWindowWizard, {
        projects: [{ ...project, default_network: 'my-net' }, p2],
        onCreated: vi.fn(),
        onCancel: vi.fn()
      })
      await waitFor(() => {
        const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
        expect(radio.disabled).toBe(true)
      })
    })

    it('Custom option reveals a network name text input', async () => {
      render(NewWindowWizard, baseProps())
      await waitFor(() => screen.getByRole('radio', { name: /custom/i }))
      await fireEvent.click(screen.getByRole('radio', { name: /custom/i }))
      await waitFor(() => expect(screen.getByPlaceholderText('network-name')).toBeDefined())
    })

    it('withDeps=true disables the network fieldset', async () => {
      mockListDeps.mockResolvedValue([
        { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
      ])
      render(NewWindowWizard, baseProps())
      await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
      await fireEvent.click(screen.getByRole('checkbox', { name: /start with dependencies/i }))
      await waitFor(() => {
        const fieldset = screen.getByRole('group', { name: /docker network/i })
        expect(fieldset).toBeDisabled()
      })
    })

    it('passes empty netArg when "Auto-create" is selected', async () => {
      render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
      await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
      await fireEvent.click(screen.getByRole('radio', { name: /auto-create/i }))
      await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w1' } })
      await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
      await waitFor(() =>
        expect(mockCreateWindow).toHaveBeenCalledWith('w1', [1], false, {}, '')
      )
    })

    it('passes project default_network as netArg for "Use project default"', async () => {
      render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
      await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
      await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w2' } })
      await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
      await waitFor(() =>
        expect(mockCreateWindow).toHaveBeenCalledWith('w2', [1], false, {}, 'my-net')
      )
    })

    it('passes trimmed custom input as netArg for "Custom"', async () => {
      render(NewWindowWizard, baseProps())
      await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
      await fireEvent.click(screen.getByRole('radio', { name: /custom/i }))
      await waitFor(() => screen.getByPlaceholderText('network-name'))
      await fireEvent.input(screen.getByPlaceholderText('network-name'), { target: { value: '  custom-net  ' } })
      await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w3' } })
      await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
      await waitFor(() =>
        expect(mockCreateWindow).toHaveBeenCalledWith('w3', [1], false, {}, 'custom-net')
      )
    })
  })
```

- [ ] **Step 5.2: Run tests to verify new ones fail**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewWindowWizard.test.ts
```

Expected: Existing tests PASS. New radio group tests FAIL — radio group not in component yet.

- [ ] **Step 5.3: Update script block in `NewWindowWizard.svelte`**

Remove `let networkName = $state('')` (line 22).

Add after `let withDeps = $state(false)`:

```typescript
  let networkMode = $state<'auto' | 'default' | 'custom'>(
    !isMultiMode && project?.default_network ? 'default' : 'auto'
  )
  let customNetwork = $state('')

  const defaultNetworkAvailable = $derived(!isMultiMode && !!project?.default_network)
```

Replace the `netArg` line in `handleSubmit` (currently line 85):

```typescript
      const netArg = withDeps ? '' :
        networkMode === 'default' ? (project?.default_network ?? '') :
        networkMode === 'custom' ? customNetwork.trim() : ''
```

- [ ] **Step 5.4: Replace the Docker Network field in the template**

Replace the entire `<div class="field">` Docker Network block (lines 202-217) with:

```html
    <fieldset
      class="network-fieldset"
      role="group"
      aria-label="Docker network"
      disabled={withDeps || loading}
    >
      <legend class="field-label">Docker Network</legend>
      {#if withDeps}
        <span class="hint">Network auto-created when dependencies enabled.</span>
      {:else}
        <label class="radio-label">
          <input type="radio" name="network-mode" value="auto" bind:group={networkMode} />
          Auto-create
        </label>
        <label
          class="radio-label"
          title={!defaultNetworkAvailable ? 'No default set' : ''}
        >
          <input
            type="radio"
            name="network-mode"
            value="default"
            bind:group={networkMode}
            disabled={!defaultNetworkAvailable}
          />
          Use project default{project?.default_network ? ` (${project.default_network})` : ''}
        </label>
        <label class="radio-label">
          <input type="radio" name="network-mode" value="custom" bind:group={networkMode} />
          Custom
        </label>
        {#if networkMode === 'custom'}
          <input
            type="text"
            class="network-custom-input"
            placeholder="network-name"
            bind:value={customNetwork}
            disabled={loading}
          />
        {/if}
      {/if}
    </fieldset>
```

- [ ] **Step 5.5: Add styles to `NewWindowWizard.svelte`**

Add to the `<style>` block before closing `</style>`:

```css
  .network-fieldset {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.65rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .network-fieldset legend {
    padding: 0 0.25rem;
  }

  .network-fieldset:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .radio-label {
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
  }

  .radio-label input[type="radio"] {
    width: auto;
    cursor: pointer;
  }

  .radio-label input[type="radio"]:disabled {
    cursor: not-allowed;
  }

  .network-custom-input {
    margin-top: 0.2rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    outline: none;
  }

  .network-custom-input:focus {
    border-color: var(--accent);
  }
```

- [ ] **Step 5.6: Run tests to verify they pass**

```bash
cd window-manager && npx vitest run --config vitest.renderer.config.ts tests/renderer/NewWindowWizard.test.ts
```

Expected: PASS — all tests pass including the 9 new radio group tests.

- [ ] **Step 5.7: Run the full test suite**

```bash
cd window-manager && npm test
```

Expected: PASS — all tests pass.

- [ ] **Step 5.8: Commit**

```bash
git add window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat: replace Docker network text input with radio group in NewWindowWizard"
```
