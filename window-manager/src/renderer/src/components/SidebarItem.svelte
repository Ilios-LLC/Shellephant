<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    selected: boolean
    onSelect: (win: WindowRecord) => void
    onDelete: (id: number) => void
  }

  let { win, selected, onSelect, onDelete }: Props = $props()

  let confirming = $state(false)
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  function clearConfirmTimer(): void {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }

  function handleDeleteClick(e: MouseEvent): void {
    e.stopPropagation()
    confirming = true
    clearConfirmTimer()
    timeoutHandle = setTimeout(() => {
      confirming = false
      timeoutHandle = null
    }, 3000)
  }

  function handleConfirm(e: MouseEvent): void {
    e.stopPropagation()
    clearConfirmTimer()
    confirming = false
    onDelete(win.id)
  }

  function handleCancel(e: MouseEvent): void {
    e.stopPropagation()
    clearConfirmTimer()
    confirming = false
  }

  function handleRowClick(): void {
    onSelect(win)
  }

  function handleRowKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') onSelect(win)
  }

  onDestroy(clearConfirmTimer)
</script>

<div
  class="sidebar-item"
  class:selected
  data-testid="sidebar-item"
  role="button"
  tabindex="0"
  aria-label={`select ${win.name}`}
  onclick={handleRowClick}
  onkeydown={handleRowKey}
>
  <span
    class="status-dot status-{win.status}"
    data-testid="status-dot"
    aria-label={`status: ${win.status}`}
  ></span>
  <div class="info">
    <span class="name">{win.name}</span>
    <span class="container-id">{win.container_id.slice(0, 12)}</span>
  </div>
  {#if confirming}
    <div class="confirm-group">
      <button type="button" class="confirm-btn" aria-label="confirm delete" onclick={handleConfirm}
        >Delete?</button
      >
      <button type="button" class="cancel-btn" aria-label="cancel" onclick={handleCancel}>×</button>
    </div>
  {:else}
    <button type="button" class="delete-btn" aria-label="delete" onclick={handleDeleteClick}
      >Delete</button
    >
  {/if}
</div>

<style>
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--fg-1);
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .sidebar-item:hover {
    background: var(--bg-1);
    color: var(--fg-0);
  }

  .sidebar-item.selected {
    background: var(--bg-2);
    color: var(--fg-0);
    border-left-color: var(--accent);
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
  .status-dot.status-stopped {
    background: var(--fg-2);
  }
  .status-dot.status-unknown {
    background: var(--fg-2);
  }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 0.9rem;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .container-id {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
  }

  .delete-btn,
  .confirm-btn,
  .cancel-btn {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 120ms ease,
      background 120ms ease,
      color 120ms ease;
  }

  .sidebar-item:hover .delete-btn,
  .sidebar-item:hover .confirm-btn,
  .sidebar-item:hover .cancel-btn,
  .sidebar-item.selected .delete-btn,
  .sidebar-item.selected .confirm-btn,
  .sidebar-item.selected .cancel-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .confirm-group {
    display: flex;
    gap: 0.25rem;
    opacity: 1;
  }

  .confirm-btn {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
    opacity: 1;
  }

  .cancel-btn {
    opacity: 1;
  }
</style>
