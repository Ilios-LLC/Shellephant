<script lang="ts">
  import { onMount } from 'svelte'
  import type { WindowRecord } from './types'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane from './components/MainPane.svelte'

  let windows = $state<WindowRecord[]>([])
  let selectedId = $state<number | null>(null)

  onMount(async () => {
    windows = await window.api.listWindows()
    if (windows.length > 0) {
      selectedId = windows[0].id
    }
  })

  function handleCreated(record: WindowRecord): void {
    windows = [...windows, record]
    selectedId = record.id
  }

  function handleSelect(id: number): void {
    selectedId = id
  }

  async function handleDelete(id: number): Promise<void> {
    await window.api.deleteWindow(id)
    windows = windows.filter(w => w.id !== id)
    if (selectedId === id) {
      selectedId = windows[0]?.id ?? null
    }
  }

  let selected = $derived(windows.find(w => w.id === selectedId) ?? null)
</script>

<div class="app">
  <Sidebar
    {windows}
    {selectedId}
    onSelect={handleSelect}
    onCreated={handleCreated}
    onDelete={handleDelete}
  />
  <MainPane {selected} />
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 220px 1fr;
    height: 100vh;
    width: 100vw;
    background: var(--bg-0);
    color: var(--fg-0);
  }
</style>
