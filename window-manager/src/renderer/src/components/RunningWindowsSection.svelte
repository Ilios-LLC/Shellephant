<script lang="ts">
  import type { WindowRecord } from '../types'
  import { waitingWindows } from '../lib/waitingWindows'

  interface Props {
    allWindows: WindowRecord[]
    onWindowSelect: (win: WindowRecord) => void
  }

  let { allWindows, onWindowSelect }: Props = $props()

  let runningWindows = $derived(allWindows.filter((w) => w.status === 'running'))

  function projectLabel(win: WindowRecord): string {
    if (win.projects.length === 0) return 'unknown'
    return win.projects.map((p) => p.project_name ?? 'unknown').join(', ')
  }

  let waitingIds = $derived(new Set($waitingWindows.map((e) => e.containerId)))

  function handleClick(win: WindowRecord): void {
    waitingWindows.remove(win.container_id)
    onWindowSelect(win)
  }
</script>

{#if runningWindows.length > 0}
  <div class="running-section">
    <div class="running-header">Running</div>
    {#each runningWindows as win (win.id)}
      <button
        type="button"
        class="running-item"
        class:waiting={waitingIds.has(win.container_id)}
        onclick={() => handleClick(win)}
      >
        <span class="running-dot" aria-hidden="true">●</span>
        <span class="running-label">{projectLabel(win)} / {win.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .running-section {
    border-top: 1px solid var(--border);
    padding: 0.35rem 0;
  }

  .running-header {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    padding: 0.35rem 0.85rem 0.2rem;
  }

  .running-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    transition: background 0.1s;
  }

  .running-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .running-item.waiting {
    background: linear-gradient(135deg, hsla(210, 80%, 50%, 0.18), transparent);
    border-left: 2px solid hsla(210, 80%, 60%, 0.6);
    color: var(--fg-0);
  }

  .running-item.waiting:hover {
    background: linear-gradient(135deg, hsla(210, 80%, 50%, 0.28), transparent);
  }

  .running-dot {
    font-size: 0.5rem;
    color: var(--ok);
    flex-shrink: 0;
  }

  .running-item.waiting .running-dot {
    color: var(--accent-hi);
  }

  .running-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
