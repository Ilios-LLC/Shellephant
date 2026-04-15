<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    onCreated: (project: ProjectRecord) => void
    onCancel: () => void
  }

  let { onCreated, onCancel }: Props = $props()

  let gitUrl = $state('')
  let name = $state('')
  let loading = $state(false)
  let error = $state('')
  let ports = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmedUrl = gitUrl.trim()
    if (!trimmedUrl || loading) return
    loading = true
    error = ''
    try {
      const rawTokens = ports
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      let parsedPorts: number[] | undefined
      if (rawTokens.length > 0) {
        const nums = rawTokens.map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : NaN))
        if (nums.some((n) => isNaN(n))) {
          error = 'Ports must be comma-separated numbers (e.g. 3000, 8080)'
          loading = false
          return
        }
        if (nums.some((n) => n < 1 || n > 65535)) {
          error = 'Ports must be between 1 and 65535'
          loading = false
          return
        }
        parsedPorts = nums
      }

      const record = await window.api.createProject(name.trim(), trimmedUrl, parsedPorts)
      onCreated(record)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
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
      <h2>New Project</h2>
      <p class="subtitle">Clone a Git repository into a new project.</p>
    </header>

    <div class="field">
      <label for="git-url">Git URL</label>
      <input
        id="git-url"
        type="text"
        placeholder="git@github.com:org/repo.git"
        bind:value={gitUrl}
        disabled={loading}
        onkeydown={handleKey}
        autofocus
      />
    </div>

    <div class="field">
      <label for="project-name">Name <span class="muted">(optional)</span></label>
      <input
        id="project-name"
        type="text"
        placeholder="my-project"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
      />
    </div>

    <div class="field">
      <label for="ports">Ports <span class="muted">(optional)</span></label>
      <input
        id="ports"
        type="text"
        placeholder="3000, 8080"
        bind:value={ports}
        disabled={loading}
        onkeydown={handleKey}
      />
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel} disabled={loading}>Cancel</button>
      <button
        type="button"
        class="submit"
        onclick={handleSubmit}
        disabled={!gitUrl.trim() || loading}
      >
        {loading ? 'Creating…' : 'Create Project'}
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

  .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--fg-2);
    opacity: 0.8;
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
</style>
