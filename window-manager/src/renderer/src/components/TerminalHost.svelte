<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import type { WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
  }

  let { win }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let resizeObserver: ResizeObserver | undefined

  onMount(() => {
    term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#8b5cf6',
        selectionBackground: '#3f3f46',
      },
      scrollback: 1000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

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

<section class="terminal-host">
  <header class="terminal-host-header">
    <span class="name">{win.name}</span>
    <span class="container-id">{win.container_id.slice(0, 12)}</span>
  </header>
  <div class="terminal-body" bind:this={terminalEl}></div>
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .terminal-host-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }

  .name {
    font-family: var(--font-ui);
    font-weight: 600;
    color: var(--fg-0);
    font-size: 0.88rem;
  }

  .container-id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-2);
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
