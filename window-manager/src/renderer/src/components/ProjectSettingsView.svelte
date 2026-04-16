<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord } from '../types'

  interface EnvRow {
    key: string
    value: string
  }

  interface Props {
    project: ProjectRecord
    onSave: () => void
    onCancel: () => void
  }

  let { project, onSave, onCancel }: Props = $props()

  let rows = $state<EnvRow[]>([])
  let busy = $state(false)
  let error = $state('')

  onMount(async () => {
    const record = await window.api.getProject(project.id)
    if (record?.env_vars) {
      const parsed = JSON.parse(record.env_vars) as Record<string, string>
      rows = Object.entries(parsed).map(([key, value]) => ({ key, value }))
    }
  })

  function addRow(): void {
    rows = [...rows, { key: '', value: '' }]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const envVars: Record<string, string> = {}
      for (const row of rows) {
        if (row.key.trim()) envVars[row.key.trim()] = row.value
      }
      await window.api.updateProjectEnvVars(project.id, envVars)
      onSave()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Project Settings">
  <div class="modal-card">
    <header class="modal-header">
      <h2>Project Settings — {project.name}</h2>
    </header>

    <section class="section">
      <div class="section-title">Environment Variables</div>
      <div class="env-table">
        {#each rows as row, i (i)}
          <div class="env-row">
            <input
              type="text"
              placeholder="KEY"
              bind:value={row.key}
              disabled={busy}
              aria-label="key"
            />
            <span class="eq">=</span>
            <input
              type="text"
              placeholder="value"
              bind:value={row.value}
              disabled={busy}
              aria-label="value"
            />
            <button
              type="button"
              class="remove-btn"
              aria-label="remove"
              onclick={() => removeRow(i)}
              disabled={busy}
            >×</button>
          </div>
        {/each}
      </div>
      <button type="button" class="add-btn" onclick={addRow} disabled={busy}>
        + Add Variable
      </button>
    </section>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" class="submit" onclick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-card {
    width: 100%;
    max-width: 540px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-header h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  .env-table {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .env-row input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    outline: none;
    min-width: 0;
  }

  .env-row input:focus {
    border-color: var(--accent);
  }

  .eq {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .remove-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-2);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .remove-btn:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
  }

  .add-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.3rem 0.65rem;
    cursor: pointer;
    margin-top: 0.15rem;
  }

  .add-btn:hover:not(:disabled) {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
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
    padding: 0.4rem 0.8rem;
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

  .cancel:disabled,
  .submit:disabled,
  .remove-btn:disabled,
  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
