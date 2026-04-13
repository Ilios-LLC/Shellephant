<!-- src/renderer/src/components/CreateProject.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    onCreated?: (record: ProjectRecord) => void
    startExpanded?: boolean
  }

  let { onCreated, startExpanded = false }: Props = $props()

  let expanded = $state(startExpanded)
  let gitUrl = $state('')
  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmedUrl = gitUrl.trim()
    if (!trimmedUrl || loading) return
    loading = true
    error = ''
    try {
      const record = await window.api.createProject(name.trim(), trimmedUrl)
      gitUrl = ''
      name = ''
      expanded = false
      onCreated?.(record)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') handleSubmit()
    else if (e.key === 'Escape') {
      expanded = false
      gitUrl = ''
      name = ''
      error = ''
    }
  }

  function toggle(): void {
    expanded = !expanded
    if (!expanded) {
      gitUrl = ''
      name = ''
      error = ''
    }
  }
</script>

<div class="create-project">
  {#if expanded}
    <div class="fields">
      <input
        type="text"
        placeholder="git@github.com:org/repo.git"
        bind:value={gitUrl}
        disabled={loading}
        onkeydown={handleKey}
      />
      <input
        type="text"
        placeholder="project name (optional)"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
      />
      <div class="actions">
        <button
          type="button"
          class="submit"
          aria-label="add project"
          onclick={handleSubmit}
          disabled={!gitUrl.trim() || loading}>Add</button
        >
        <button type="button" class="cancel" aria-label="cancel" onclick={toggle}>×</button>
      </div>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {:else}
    <button type="button" class="expand" aria-label="new project" onclick={toggle}>+</button>
  {/if}
</div>

<style>
  .create-project {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actions {
    display: flex;
    gap: 0.25rem;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .expand,
  .submit,
  .cancel {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .expand {
    font-size: 1rem;
    line-height: 1;
    padding: 0.15rem 0.5rem;
  }

  .expand:hover,
  .submit:hover:not(:disabled) {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error {
    font-size: 0.72rem;
    color: var(--danger);
  }
</style>
