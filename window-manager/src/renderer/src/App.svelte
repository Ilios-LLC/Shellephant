<script lang="ts">
  import { onMount } from 'svelte'
  import type { WindowRecord } from './types'
  import CreateWindow from './components/CreateWindow.svelte'
  import WindowCard from './components/WindowCard.svelte'
  import Terminal from './components/Terminal.svelte'

  let windows = $state<WindowRecord[]>([])
  let activeTerminal = $state<WindowRecord | null>(null)

  onMount(async () => {
    windows = await window.api.listWindows()
  })

  function handleCreated(record: WindowRecord) {
    windows = [...windows, record]
  }

  function handleOpen(win: WindowRecord) {
    activeTerminal = win
  }

  async function handleDelete(id: number) {
    await window.api.deleteWindow(id)
    windows = windows.filter((w) => w.id !== id)
  }

  function handleClose() {
    activeTerminal = null
  }
</script>

<main>
  <header>
    <h1>Windows</h1>
    <CreateWindow onCreated={handleCreated} />
  </header>

  {#if windows.length === 0}
    <p class="empty">No windows yet. Create one above.</p>
  {:else}
    <div class="window-grid">
      {#each windows as win (win.id)}
        <WindowCard {win} onOpen={handleOpen} onDelete={handleDelete} />
      {/each}
    </div>
  {/if}

  {#if activeTerminal}
    <Terminal win={activeTerminal} onClose={handleClose} />
  {/if}
</main>
