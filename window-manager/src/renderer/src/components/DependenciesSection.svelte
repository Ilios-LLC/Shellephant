<script lang="ts">
  import type { ProjectDependency } from '../types'
  import { onMount, onDestroy } from 'svelte'

  interface Props { projectId: number }
  let { projectId }: Props = $props()

  let deps = $state<ProjectDependency[]>([])
  let loading = $state(true)
  let showForm = $state(false)
  let formImage = $state('')
  let formTag = $state('latest')
  let formError = $state('')
  let formSaving = $state(false)
  let formEnvRows = $state<{ key: string; value: string }[]>([])
  let confirmDeleteId = $state<number | null>(null)
  let deleteTimer: ReturnType<typeof setTimeout> | null = null

  onMount(async () => { await load() })
  onDestroy(() => { if (deleteTimer) clearTimeout(deleteTimer) })

  function addFormEnvRow(): void {
    formEnvRows = [...formEnvRows, { key: '', value: '' }]
  }

  function removeFormEnvRow(i: number): void {
    formEnvRows = formEnvRows.filter((_, idx) => idx !== i)
  }

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
      const envVars = Object.fromEntries(
        formEnvRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      )
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
    try {
      await window.api.deleteDependency(id)
      await load()
    } catch (e) {
      formError = e instanceof Error ? e.message : String(e)
    }
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
      {#if formError}<p class="error">{formError}</p>{/if}
      <div class="form-actions">
        <button
          type="button"
          onclick={() => { showForm = false; formError = ''; formEnvRows = [] }}
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
  .env-rows { display: flex; flex-direction: column; gap: 0.3rem; }
  .env-row { display: flex; align-items: center; gap: 0.3rem; }
  .env-key-input { flex: 1; padding: 0.35rem 0.45rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-mono); font-size: 0.8rem; }
  .env-val-input { flex: 2; padding: 0.35rem 0.45rem; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-mono); font-size: 0.8rem; }
  .env-eq { font-family: var(--font-mono); font-size: 0.82rem; color: var(--fg-3); }
  .env-remove-btn { font-size: 0.78rem; padding: 0 0.35rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; line-height: 1.6; }
  .env-add-btn { font-family: var(--font-ui); font-size: 0.75rem; padding: 0.2rem 0.5rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; align-self: flex-start; }
  .dep-item-wrap { display: flex; flex-direction: column; gap: 0.25rem; }
  .edit-env-btn { font-size: 0.72rem; padding: 0 0.4rem; border: 1px solid var(--border); background: transparent; color: var(--fg-2); border-radius: 4px; cursor: pointer; }
  .inline-edit { padding: 0.5rem 0.65rem; background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; display: flex; flex-direction: column; gap: 0.35rem; }
  .edit-actions { display: flex; justify-content: flex-end; gap: 0.4rem; }
  .edit-actions button { font-family: var(--font-ui); font-size: 0.8rem; padding: 0.3rem 0.65rem; border: 1px solid var(--border); background: transparent; color: var(--fg-1); border-radius: 4px; cursor: pointer; }
</style>
