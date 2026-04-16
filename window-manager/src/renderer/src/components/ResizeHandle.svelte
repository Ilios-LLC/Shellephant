<script lang="ts">
  interface Props {
    containerWidth: number
    onResize: (deltaPercent: number) => void
    onResizeEnd: () => void
  }

  let { containerWidth, onResize, onResizeEnd }: Props = $props()

  let dragging = false
  let startX = 0

  function handlePointerDown(e: PointerEvent): void {
    dragging = true
    startX = e.clientX
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!dragging) return
    const dx = e.clientX - startX
    startX = e.clientX
    if (containerWidth > 0) onResize((dx / containerWidth) * 100)
  }

  function handlePointerUp(): void {
    if (!dragging) return
    dragging = false
    onResizeEnd()
  }
</script>

<div
  class="resize-handle"
  role="separator"
  aria-orientation="vertical"
  aria-label="resize panels"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
></div>

<style>
  .resize-handle {
    width: 4px;
    flex-shrink: 0;
    background: var(--border);
    cursor: col-resize;
    transition: background 0.1s;
  }
  .resize-handle:hover {
    background: var(--accent);
  }
</style>
