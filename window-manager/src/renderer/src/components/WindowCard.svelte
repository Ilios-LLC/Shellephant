<script lang="ts">
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    onOpen: (win: WindowRecord) => void
    onDelete: (id: number) => void
  }

  let { win, onOpen, onDelete }: Props = $props()
</script>

<div class="window-card">
  <div
    class="window-card-open"
    role="button"
    tabindex="0"
    data-testid="window-card-open"
    onclick={() => onOpen(win)}
    onkeydown={(e) => e.key === 'Enter' && onOpen(win)}
  >
    <span class="window-name">{win.name}</span>
    <span class="window-container">{win.container_id.slice(0, 12)}</span>
  </div>
  <button
    class="delete-btn"
    onclick={(e) => {
      e.stopPropagation()
      onDelete(win.id)
    }}
  >
    Delete
  </button>
</div>

<style>
  .window-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  .window-card-open {
    display: flex;
    flex-direction: column;
    flex: 1;
    cursor: pointer;
  }

  .window-name {
    font-weight: bold;
  }

  .window-container {
    font-size: 0.8rem;
    color: #666;
    font-family: monospace;
  }

  .delete-btn {
    margin-left: 1rem;
    padding: 0.25rem 0.75rem;
    background: #e55;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .delete-btn:hover {
    background: #c33;
  }
</style>
