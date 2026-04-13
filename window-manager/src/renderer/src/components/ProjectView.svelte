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
