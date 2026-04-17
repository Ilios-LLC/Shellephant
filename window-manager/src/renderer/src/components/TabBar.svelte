<script lang="ts">
  interface Props {
    tabs: string[]
    activeTab: string | null
    dirtyTabs: Set<string>
    onActivate: (path: string) => void
    onClose: (path: string) => void
  }

  let { tabs, activeTab, dirtyTabs, onActivate, onClose }: Props = $props()

  function basename(path: string): string {
    return path.split('/').pop() ?? path
  }
</script>

<div class="tab-bar" role="tablist">
  {#each tabs as tab (tab)}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div
      role="tab"
      class="tab"
      class:active={tab === activeTab}
      title={tab}
      aria-selected={tab === activeTab}
      tabindex="0"
      onclick={() => onActivate(tab)}
      onkeydown={(e) => e.key === 'Enter' && onActivate(tab)}
    >
      <span class="tab-name">{basename(tab)}</span>
      {#if dirtyTabs.has(tab)}
        <span class="dirty-dot" aria-label="unsaved changes">●</span>
      {:else}
        <button
          class="close-btn"
          aria-label="close {basename(tab)}"
          onclick={(e) => { e.stopPropagation(); onClose(tab) }}
        >×</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    background: var(--bg-0);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
    height: 35px;
    align-items: stretch;
  }

  .tab-bar::-webkit-scrollbar { height: 3px; }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0 0.75rem;
    cursor: pointer;
    border-right: 1px solid var(--border);
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-2);
    min-width: 80px;
    max-width: 180px;
    user-select: none;
  }

  .tab:hover { background: var(--bg-1); }

  .tab.active {
    background: #011627;
    color: var(--fg-0);
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .dirty-dot {
    font-size: 0.6rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 0 2px;
    font-size: 0.875rem;
    line-height: 1;
    flex-shrink: 0;
  }
</style>
