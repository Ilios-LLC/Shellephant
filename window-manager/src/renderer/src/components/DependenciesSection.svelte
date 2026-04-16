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
    try {
      await window.api.createDependency(projectId, image, formTag.trim() || 'latest', {})
      showForm = false
      formImage = ''
      formTag = 'latest'
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

  function getDeleteLabel(dep: ProjectDependency): string {
    if (confirmDeleteId === dep.id) return `confirm delete ${dep.image}:${dep.tag}`
    return `delete ${dep.image}:${dep.tag}`
  }
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
          <button
            type="button"
            class="del-btn"
            class:confirming={confirmDeleteId === dep.id}
            aria-label={getDeleteLabel(dep)}
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
      {#if formError}<p class="error">{formError}</p>{/if}
      <div class="form-actions">
        <button
          type="button"
          onclick={() => { showForm = false; formError = '' }}
          disabled={formSaving}
        >Cancel</button>
        <button
          type="button"
          class="save-btn"
          onclick={handleSave}
          disabled={!formImage.trim() || formSaving}
          aria-label="save dependency"
        >{formSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="add-btn"
      aria-label="add dependency"
      onclick={() => { showForm = true; formError = '' }}
    >+ Add Dependency</button>
  {/if}
</div>

<style>
  .deps-section { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; }
  .hint { font-size: 0.82rem; color: var(--fg-2); margin: 0; }
  .dep-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .dep-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.65rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; }
  .dep-name { font-family: var(--font-mono); font-size: 0.82rem; flex: 1; }
  .del-btn { font-size: 0.78rem; padding: 0 0.4rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; }
  .del-btn.confirming { background: var(--danger); border-color: var(--danger); color: white; }
  .add-form { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.75rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; }
  .form-row { display: flex; gap: 0.5rem; }
  .form-row input { flex: 1; padding: 0.4rem 0.55rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-ui); font-size: 0.85rem; }
  .tag-input { flex: 0 0 80px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.25rem; }
  .form-actions button { font-family: var(--font-ui); font-size: 0.82rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; }
  .save-btn { background: var(--accent); border-color: var(--accent); color: white; }
  .save-btn:disabled, .form-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .add-btn { font-family: var(--font-ui); font-size: 0.8rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; align-self: flex-start; }
  .error { font-size: 0.78rem; color: var(--danger); margin: 0; }
</style>
