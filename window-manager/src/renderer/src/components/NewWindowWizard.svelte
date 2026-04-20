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
  let windowType = $state<'manual' | 'assisted'>('manual')
  let fireworksConfigured = $state(false)
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
    } catch (e) {
      console.warn(`Failed to fetch branches for project ${projectId}:`, e)
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
    const fwStatus = await window.api.getFireworksKeyStatus()
    fireworksConfigured = fwStatus.configured
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
      const record = await window.api.createWindow(trimmed, ids, withDeps, branchOverrides, windowType)
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

  function handleBranchChange(projectId: number, e: Event): void {
    const value = (e.target as HTMLSelectElement).value
    branchSelections = { ...branchSelections, [projectId]: value }
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

    <div class="field">
      <span class="field-label">Type</span>
      <div class="type-toggle">
        <label class="type-option">
          <input type="radio" name="window-type" value="manual" bind:group={windowType} disabled={loading} />
          Manual
        </label>
        <label class="type-option" title={!fireworksConfigured ? 'Set Fireworks API key in Settings' : ''}>
          <input
            type="radio"
            name="window-type"
            value="assisted"
            bind:group={windowType}
            disabled={loading || !fireworksConfigured}
            aria-label="Assisted"
          />
          Assisted
        </label>
      </div>
    </div>

    {#if !isMultiMode && project}
      <div class="field">
        <label for="branch-select-{project.id}">Branch</label>
        {#if branchLoading[project.id] !== false}
          <span class="branch-loading" aria-label="Branch">loading branches…</span>
        {:else if branchOptions[project.id]?.length}
          <select
            id="branch-select-{project.id}"
            aria-label="Branch"
            value={branchSelections[project.id]}
            onchange={(e) => handleBranchChange(project!.id, e)}
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
            {#if branchLoading[p.id] !== false}
              <span class="branch-loading branch-select-inline">loading…</span>
            {:else if branchOptions[p.id]?.length}
              <select
                aria-label="Branch"
                value={branchSelections[p.id]}
                onchange={(e) => handleBranchChange(p.id, e)}
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

  .type-toggle {
    display: flex;
    gap: 1rem;
  }

  .type-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    cursor: pointer;
    font-family: var(--font-ui);
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
  }

  .type-option input { width: auto; cursor: pointer; }
</style>
