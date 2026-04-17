<script lang="ts">
  import type { ProjectGroupRecord } from '../types'

  interface Props {
    groups: ProjectGroupRecord[]
    activeGroupId: number | 'ungrouped' | null
    onGroupSelect: (id: number | 'ungrouped') => void
    onGroupCreated: (group: ProjectGroupRecord) => void
  }

  let { groups, activeGroupId, onGroupSelect, onGroupCreated }: Props = $props()

  let adding = $state(false)
  let newName = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (adding && inputEl) inputEl.focus()
  })

  function startAdd(): void {
    adding = true
    newName = ''
  }

  function cancelAdd(): void {
    adding = false
    newName = ''
  }

  async function submitAdd(): Promise<void> {
    const trimmed = newName.trim()
    if (!trimmed) {
      cancelAdd()
      return
    }
    const group = await window.api.createGroup(trimmed)
    onGroupCreated(group)
    cancelAdd()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') submitAdd()
    else if (e.key === 'Escape') cancelAdd()
  }
</script>

<div class="group-strip">
  <button
    type="button"
    class="group-icon"
    class:active={activeGroupId === 'ungrouped'}
    title="No group"
    aria-label="no group"
    onclick={() => onGroupSelect('ungrouped')}
  >∅</button>
  {#each groups as group (group.id)}
    <button
      type="button"
      class="group-icon"
      class:active={group.id === activeGroupId}
      title={group.name}
      aria-label={group.name}
      onclick={() => onGroupSelect(group.id)}
    >
      {group.name[0].toUpperCase()}
    </button>
  {/each}
  {#if adding}
    <input
      bind:this={inputEl}
      class="group-input"
      bind:value={newName}
      placeholder="Name…"
      onkeydown={handleKeydown}
    />
  {:else}
    <button
      type="button"
      class="group-icon add-btn"
      aria-label="new group"
      title="New group"
      onclick={startAdd}
    >+</button>
  {/if}
</div>

<style>
  .group-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--border);
  }

  .group-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .group-icon:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .group-icon.active {
    color: var(--accent-hi);
    border-color: var(--accent-hi);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .group-input {
    width: 5rem;
    height: 1.6rem;
    padding: 0 0.4rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    border: 1px solid var(--accent);
    background: var(--bg-1);
    color: var(--fg-0);
    border-radius: 4px;
    outline: none;
  }
</style>
