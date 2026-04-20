<!-- src/renderer/src/components/ProjectView.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../types'
  import { DEFAULT_KIMI_SYSTEM_PROMPT } from '../types'
  import DependenciesSection from './DependenciesSection.svelte'

  interface Props {
    project: ProjectRecord
    windows: WindowRecord[]
    groups: ProjectGroupRecord[]
    onWindowSelect: (win: WindowRecord) => void
    onRequestNewWindow: () => void
    onProjectDeleted: (id: number) => void
    onWindowDeleted: (id: number) => void
    onProjectUpdated: (project: ProjectRecord) => void
  }

  let {
    project,
    windows,
    groups,
    onWindowSelect,
    onRequestNewWindow,
    onProjectDeleted,
    onWindowDeleted,
    onProjectUpdated
  }: Props = $props()

  let confirmingDelete = $state(false)
  let deleteTimeout: ReturnType<typeof setTimeout> | null = null

  let confirmingWindowId = $state<number | null>(null)
  let winDeleteTimeout: ReturnType<typeof setTimeout> | null = null
  let deletingWindowId = $state<number | null>(null)

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

  async function handleGroupChange(e: Event): Promise<void> {
    const val = (e.target as HTMLSelectElement).value
    const groupId = val === '' ? null : Number(val)
    const updated = await window.api.updateProject(project.id, { groupId })
    onProjectUpdated(updated)
  }

  function armWindowDelete(id: number): void {
    confirmingWindowId = id
    if (winDeleteTimeout) clearTimeout(winDeleteTimeout)
    winDeleteTimeout = setTimeout(() => {
      confirmingWindowId = null
      winDeleteTimeout = null
    }, 3000)
  }

  async function handleWindowDelete(id: number): Promise<void> {
    if (deletingWindowId !== null) return
    if (confirmingWindowId !== id) {
      armWindowDelete(id)
      return
    }
    if (winDeleteTimeout) clearTimeout(winDeleteTimeout)
    confirmingWindowId = null
    deletingWindowId = id
    try {
      await window.api.deleteWindow(id)
      onWindowDeleted(id)
    } finally {
      deletingWindowId = null
    }
  }

  onDestroy(() => {
    if (deleteTimeout) clearTimeout(deleteTimeout)
    if (winDeleteTimeout) clearTimeout(winDeleteTimeout)
  })

  let activeTab = $state<'windows' | 'deps' | 'kimi'>('windows')

  let kimiPromptInput = $state('')
  let kimiBusy = $state(false)
  let kimiError = $state('')
  let kimiSaved = $state(false)
  let inheritedPrompt = $state(DEFAULT_KIMI_SYSTEM_PROMPT)
  let inheritedSource = $state<'global' | 'default'>('default')

  // Initialize from the incoming project and re-sync when the parent hands us
  // a refreshed record (e.g. after a group change or another save elsewhere).
  $effect(() => {
    kimiPromptInput = project.kimi_system_prompt ?? ''
    kimiSaved = false
  })

  // Resolve what "no project override" would fall back to, so the textarea
  // placeholder shows the prompt the assistant would actually use.
  onMount(async () => {
    try {
      const globalOverride = await window.api.getKimiSystemPrompt()
      if (globalOverride && globalOverride.trim()) {
        inheritedPrompt = globalOverride
        inheritedSource = 'global'
      } else {
        inheritedPrompt = DEFAULT_KIMI_SYSTEM_PROMPT
        inheritedSource = 'default'
      }
    } catch {
      // Leave the default in place if the fetch fails.
    }
  })

  async function saveProjectKimiPrompt(): Promise<void> {
    if (kimiBusy) return
    kimiBusy = true
    kimiError = ''
    kimiSaved = false
    try {
      const value = kimiPromptInput.trim() ? kimiPromptInput : null
      await window.api.setProjectKimiSystemPrompt(project.id, value)
      const refreshed = await window.api.getProject(project.id)
      if (refreshed) onProjectUpdated(refreshed)
      kimiSaved = true
    } catch (err) {
      kimiError = err instanceof Error ? err.message : String(err)
    } finally {
      kimiBusy = false
    }
  }

  async function clearProjectKimiPrompt(): Promise<void> {
    kimiPromptInput = ''
    await saveProjectKimiPrompt()
  }
</script>

<div class="project-view">
  <header class="project-header">
    <div class="project-info">
      <h2 class="project-name">{project.name}</h2>
      <span class="project-url">{project.git_url}</span>
    </div>
    <div class="project-actions">
      <label class="group-label" for="project-group">Group</label>
      <select
        id="project-group"
        class="group-select"
        aria-label="group"
        value={project.group_id ?? ''}
        onchange={handleGroupChange}
      >
        <option value="">No group</option>
        {#each groups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
      {#if confirmingDelete}
        <button type="button" class="confirm-delete" onclick={handleConfirmDelete}>Delete?</button>
        <button type="button" class="cancel-delete" onclick={handleCancelDelete}>×</button>
      {:else}
        <button type="button" class="delete-btn" onclick={handleDeleteClick}>Delete Project</button>
      {/if}
    </div>
  </header>

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
      onclick={() => { activeTab = 'deps' }}
    >Dependencies</button>
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'kimi'}
      onclick={() => { activeTab = 'kimi' }}
    >Shellephant Prompt</button>
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
  {:else if activeTab === 'deps'}
  <DependenciesSection projectId={project.id} />
  {:else}
  <section class="kimi-section">
    <div class="section-header">
      <h3 class="section-title">Shellephant System Prompt (per-project)</h3>
    </div>
    <p class="kimi-help">
      Overrides the global Shellephant system prompt for windows attached to this project.
      Leave blank to fall back to the global override (Settings) or the built-in default.
    </p>
    <div class="kimi-status">
      {#if kimiPromptInput.trim()}
        <span class="status configured">Custom project prompt active</span>
      {:else if inheritedSource === 'global'}
        <span class="status unconfigured">No project override — inheriting global override (shown below)</span>
      {:else}
        <span class="status unconfigured">No project override — inheriting built-in default (shown below)</span>
      {/if}
    </div>
    <textarea
      class="kimi-textarea"
      rows="12"
      placeholder={inheritedPrompt}
      bind:value={kimiPromptInput}
      disabled={kimiBusy}
      oninput={() => { kimiSaved = false }}
    ></textarea>
    <div class="kimi-actions">
      {#if project.kimi_system_prompt}
        <button type="button" class="kimi-clear" onclick={clearProjectKimiPrompt} disabled={kimiBusy}>
          {kimiBusy ? '…' : 'Clear'}
        </button>
      {/if}
      <button type="button" class="kimi-submit" onclick={saveProjectKimiPrompt} disabled={kimiBusy}>
        {kimiBusy ? 'Saving…' : kimiSaved ? 'Saved ✓' : 'Save Prompt'}
      </button>
    </div>
    {#if kimiError}
      <p class="kimi-error">{kimiError}</p>
    {/if}
  </section>
  {/if}
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
    align-items: center;
  }

  .group-label {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--fg-2);
    align-self: center;
  }

  .group-select {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    background: var(--bg-1);
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .group-select:hover {
    border-color: var(--accent);
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

  .windows-section,
  .kimi-section {
    padding: 1rem 1.25rem;
  }

  .kimi-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .kimi-help {
    font-size: 0.78rem;
    color: var(--fg-2);
    margin: 0;
    line-height: 1.5;
  }

  .kimi-status .status.configured { color: var(--ok); font-size: 0.78rem; }
  .kimi-status .status.unconfigured { color: var(--fg-2); font-size: 0.78rem; }

  .kimi-textarea {
    width: 100%;
    min-height: 10em;
    padding: 0.6rem 0.75rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.5;
    resize: vertical;
    outline: none;
  }

  .kimi-textarea:focus {
    border-color: var(--accent);
  }

  .kimi-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .kimi-submit,
  .kimi-clear {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    border: 1px solid;
    cursor: pointer;
  }

  .kimi-submit {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .kimi-submit:hover:not(:disabled) {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .kimi-clear {
    background: transparent;
    border-color: var(--danger);
    color: var(--danger);
  }

  .kimi-clear:hover:not(:disabled) {
    background: var(--danger);
    color: white;
  }

  .kimi-submit:disabled,
  .kimi-clear:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .kimi-error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
  }

  .new-window-btn {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .new-window-btn:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .empty-windows {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem 0;
  }

  .empty-hint {
    font-size: 0.85rem;
    color: var(--fg-2);
    margin: 0;
  }

  .empty-cta {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    border-radius: 4px;
    cursor: pointer;
  }

  .empty-cta:hover {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .window-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .window-row {
    display: flex;
    align-items: stretch;
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
    flex: 1;
    min-width: 0;
    transition: background 120ms ease;
  }

  .window-item:hover:not(:disabled) {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .window-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .window-delete {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    padding: 0 0.65rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-2);
    border-radius: 4px;
    cursor: pointer;
    min-width: 2rem;
  }

  .window-delete:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
  }

  .window-delete.confirming {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  .window-delete:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

</style>
