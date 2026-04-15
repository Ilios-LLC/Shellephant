<script lang="ts">
  import FileTree from './FileTree.svelte'
  import MonacoEditor from './MonacoEditor.svelte'

  interface Props {
    containerId: string
    rootPath: string
  }

  let { containerId, rootPath }: Props = $props()

  let selectedFile = $state<string | null>(null)
</script>

<div class="editor-pane">
  <div class="tree-panel">
    <FileTree {containerId} {rootPath} onFileSelect={(path) => (selectedFile = path)} />
  </div>
  <div class="editor-panel">
    {#if selectedFile}
      {#key selectedFile}
        <MonacoEditor {containerId} filePath={selectedFile} />
      {/key}
    {:else}
      <div class="placeholder">Select a file to edit</div>
    {/if}
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .tree-panel {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  .editor-panel {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    color: var(--fg-3);
  }
</style>
