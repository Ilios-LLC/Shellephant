<script lang="ts">
  import type { WindowRecord } from '../types'

  interface Props {
    onCreated?: (record: WindowRecord) => void
    startExpanded?: boolean
  }

  let { onCreated, startExpanded = false }: Props = $props()

  let expanded = $state(startExpanded)
  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || loading) return
    loading = true
    error = ''
    try {
      const record = await window.api.createWindow(trimmed)
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
      name = ''
      error = ''
    }
  }

  function toggle(): void {
    expanded = !expanded
    if (!expanded) {
      name = ''
      error = ''
    }
  }
</script>

<div class="create-window">
  {#if expanded}
    <div class="row">
      <input
        type="text"
        placeholder="window name"
        bind:value={name}
        disabled={loading}
        onkeydown={handleKey}
      />
      <button
        type="button"
        class="submit"
        aria-label="create window"
        onclick={handleSubmit}
        disabled={!name.trim() || loading}
      >Create</button>
      <button
        type="button"
        class="cancel"
        aria-label="cancel"
        onclick={toggle}
      >×</button>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {:else}
    <button
      type="button"
      class="expand"
      aria-label="new window"
      onclick={toggle}
    >+</button>
  {/if}
</div>

<style>
  .create-window {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    display: flex;
    align-items: center;
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
