<script lang="ts">
  import type { ProjectRecord, WindowRecord } from '../types'
  import EmptyState from './EmptyState.svelte'
  import ProjectView from './ProjectView.svelte'
  import TerminalHost from './TerminalHost.svelte'

  interface Props {
    project: ProjectRecord | null
    windows: WindowRecord[]
    selectedWindow: WindowRecord | null
    onWindowSelect: (win: WindowRecord) => void
    onWindowCreated: (win: WindowRecord) => void
    onProjectDeleted: (id: number) => void
  }

  let { project, windows, selectedWindow, onWindowSelect, onWindowCreated, onProjectDeleted }: Props = $props()
</script>

<main class="main-pane">
  {#if selectedWindow}
    {#key selectedWindow.id}
      <TerminalHost win={selectedWindow} />
    {/key}
  {:else if project}
    <ProjectView
      {project}
      {windows}
      {onWindowSelect}
      onWindowCreated={onWindowCreated}
      onProjectDeleted={onProjectDeleted}
    />
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
