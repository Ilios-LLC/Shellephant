<script lang="ts">
  import type { WindowRecord } from '../types'
  import SidebarItem from './SidebarItem.svelte'
  import CreateWindow from './CreateWindow.svelte'

  interface Props {
    windows: WindowRecord[]
    selectedId: number | null
    onSelect: (id: number) => void
    onCreated: (record: WindowRecord) => void
    onDelete: (id: number) => void
  }

  let { windows, selectedId, onSelect, onCreated, onDelete }: Props = $props()

  function handleItemSelect(win: WindowRecord): void {
    onSelect(win.id)
  }
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <h1>Windows</h1>
    <CreateWindow onCreated={onCreated} />
  </header>
  <nav class="sidebar-list">
    {#each windows as win (win.id)}
      <SidebarItem
        {win}
        selected={win.id === selectedId}
        onSelect={handleItemSelect}
        {onDelete}
      />
    {/each}
  </nav>
  {#if windows.length === 0}
    <p class="empty-hint">No windows. Click + to create one.</p>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    height: 100%;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }
</style>
