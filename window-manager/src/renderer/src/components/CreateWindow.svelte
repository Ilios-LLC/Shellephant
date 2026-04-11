<script lang="ts">
  import type { WindowRecord } from '../types'

  interface Props {
    onCreated?: (record: WindowRecord) => void
  }

  let { onCreated }: Props = $props()

  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed || loading) return

    loading = true
    error = ''

    try {
      const record = await window.api.createWindow(trimmed)
      name = ''
      onCreated?.(record)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }
</script>

<div class="create-window">
  <input
    type="text"
    placeholder="Window name"
    bind:value={name}
    disabled={loading}
  />
  <button
    onclick={handleSubmit}
    disabled={!name.trim() || loading}
  >
    Create Window
  </button>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>
