<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import CommitModal from './CommitModal.svelte'
  import { pushToast } from '../lib/toasts'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
  }

  let { win, project }: Props = $props()

  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let resizeObserver: ResizeObserver | undefined

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, {
        subject: v.subject,
        body: v.body || undefined
      })
      if (res.ok) {
        pushToast({ level: 'success', title: 'Committed', body: res.stdout })
      } else {
        const nothing = /nothing to commit/i.test(res.stdout)
        pushToast({
          level: nothing ? 'success' : 'error',
          title: nothing ? 'Nothing to commit' : 'Commit failed',
          body: nothing ? undefined : res.stdout
        })
      }
      commitOpen = false
    } catch (err) {
      pushToast({ level: 'error', title: 'Commit error', body: (err as Error).message })
    } finally {
      commitBusy = false
    }
  }

  async function runPush(): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.push(win.id)
      pushToast({
        level: res.ok ? 'success' : 'error',
        title: res.ok ? 'Pushed' : 'Push failed',
        body: res.stdout || undefined
      })
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  onMount(() => {
    term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#8b5cf6',
        selectionBackground: '#3f3f46'
      },
      scrollback: 1000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(terminalEl)
    fitAddon.fit()
    // Clear any mode/charset state from xterm's own boot sequence so the
    // first thing the remote shell paints starts from a known blank slate.
    term.reset()

    resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalEl)

    window.api.openTerminal(win.container_id, term.cols, term.rows)

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
  <div class="terminal-body" bind:this={terminalEl}></div>
  <WindowDetailPane
    {win}
    {project}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    commitDisabled={commitBusy || pushBusy}
    pushDisabled={commitBusy || pushBusy}
  />
  {#if commitOpen}
    <CommitModal onSubmit={runCommit} onCancel={() => (commitOpen = false)} busy={commitBusy} />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .terminal-body {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
