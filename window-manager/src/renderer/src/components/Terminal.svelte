<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    onClose: () => void
  }

  let { win, onClose }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let resizeObserver: ResizeObserver

  onMount(() => {
    term = new XTerm()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalEl)
    fitAddon.fit()

    resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalEl)

    window.api.openTerminal(win.container_id)

    window.api.onTerminalData((containerId: string, data: string) => {
      if (containerId === win.container_id) {
        term?.write(data)
      }
    })

    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data)
    })

    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows)
    })
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id)
    term?.dispose()
  })
</script>

<div class="terminal-overlay">
  <div class="terminal-container">
    <div class="terminal-header">
      <span class="terminal-title">{win.name}</span>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>
    <div class="terminal-body" bind:this={terminalEl}></div>
  </div>
</div>

<style>
  .terminal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .terminal-container {
    width: 90vw;
    height: 80vh;
    background: #1e1e1e;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: #2d2d2d;
    color: #fff;
  }

  .terminal-title {
    font-weight: bold;
    font-size: 0.95rem;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 1.25rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.25rem;
  }

  .close-btn:hover {
    color: #f88;
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
  }
</style>
