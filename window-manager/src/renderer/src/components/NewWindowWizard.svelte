<script lang="ts">
  import type { ProjectRecord, WindowRecord } from '../types'

  interface Props {
    project: ProjectRecord
    onCreated: (win: WindowRecord) => void
    onCancel: () => void
  }

  let { project, onCreated, onCancel }: Props = $props()

  let name = $state('')
  let loading = $state(false)
  let progress = $state('')
  let error = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || loading) return
    loading = true
    error = ''
    progress = 'Preparing…'
    window.api.onWindowCreateProgress((step) => {
      progress = step
    })
    try {
      const record = await window.api.createWindow(trimmed, project.id)
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
</script>

<div class="wizard">
  <div class="wizard-card">
    <header class="wizard-header">
      <h2>New Window</h2>
      <p class="subtitle">Start a new container for <strong>{project.name}</strong>.</p>
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
        disabled={!name.trim() || loading}
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

  label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  input {
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

  input:focus {
    border-color: var(--accent);
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
    to {
      transform: rotate(360deg);
    }
  }
</style>
