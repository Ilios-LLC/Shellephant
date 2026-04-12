<script lang="ts">
  import type { WindowRecord } from '../types'
  import EmptyState from './EmptyState.svelte'
  import TerminalHost from './TerminalHost.svelte'

  interface Props {
    selected: WindowRecord | null
  }

  let { selected }: Props = $props()
</script>

<main class="main-pane">
  {#if selected}
    {#key selected.id}
      <TerminalHost win={selected} />
    {/key}
  {:else}
    <EmptyState />
  {/if}
</main>

<style>
  .main-pane {
    height: 100%;
    overflow: hidden;
    background: var(--bg-0);
  }
</style>
