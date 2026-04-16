<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import EditorPane from './EditorPane.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import CommitModal from './CommitModal.svelte'
  import { pushToast, pushSuccessModal } from '../lib/toasts'
  import { waitingWindows } from '../lib/waitingWindows'
  import { conversationSummary } from '../lib/conversationSummary'
  import { panelLayout, resizePanels, reorderPanels, savePanelLayout } from '../lib/panelLayout'
  import type { PanelId } from '../lib/panelLayout'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onWindowDeleted?: (id: number) => void
  }

  let { win, project, onWindowDeleted = () => {} }: Props = $props()

  const rootPath = $derived('/workspace/' + (project.git_url.split('/').pop() ?? 'unknown').replace(/\.git$/, ''))

  // Claude terminal
  let claudeTerminalEl: HTMLDivElement
  let claudeTerm: XTerm | undefined
  let claudeFitAddon: FitAddon | undefined
  let claudeResizeObserver: ResizeObserver | undefined

  // Terminal session (lazy)
  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let resizeObserver: ResizeObserver | undefined
  let terminalOpened = false

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)
  let deleteBusy = $state(false)
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)

  let contentAreaWidth = $state(0)
  // Not $state — only read inside event handlers, no re-render needed
  let draggedPanelId: PanelId | null = null

  const visiblePanels = $derived($panelLayout.panels.filter(p => p.visible))

  const xtermOptions = {
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    theme: {
      background: '#09090b',
      foreground: '#fafafa',
      cursor: '#8b5cf6',
      selectionBackground: '#3f3f46'
    },
    scrollback: 1000
  }

  function initTerminalSession(): void {
    terminalOpened = true
    term = new XTerm(xtermOptions)
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(terminalEl)
    term.reset()
    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalEl)
    window.api.openTerminal(win.container_id, term.cols, term.rows, win.name, 'terminal')
    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'terminal')
      waitingWindows.remove(win.container_id)
    })
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'terminal')
    })
  }

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, {
        subject: v.subject,
        body: v.body || undefined
      })
      if (res.ok) {
        const subjectLine = res.stdout.split('\n').find((l: string) => /^\[.+\]/.test(l))
        pushToast({ level: 'success', title: 'Committed', body: subjectLine })
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
      if (res.ok) {
        pushSuccessModal(res.prUrl)
      } else {
        pushToast({ level: 'error', title: 'Push failed', body: res.stdout || undefined })
      }
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  async function runDelete(): Promise<void> {
    if (deleteBusy) return
    deleteBusy = true
    try {
      await window.api.deleteWindow(win.id)
      onWindowDeleted(win.id)
    } catch (err) {
      pushToast({ level: 'error', title: 'Delete failed', body: (err as Error).message })
      deleteBusy = false
    }
  }

  onMount(() => {
    if (!claudeTerminalEl) {
      console.warn('[TerminalHost] claudeTerminalEl not bound on mount; claude panel may be hidden')
      return
    }
    claudeTerm = new XTerm(xtermOptions)
    claudeFitAddon = new FitAddon()
    claudeTerm.loadAddon(claudeFitAddon)
    claudeTerm.loadAddon(new WebLinksAddon())
    claudeTerm.open(claudeTerminalEl)
    claudeFitAddon.fit()
    claudeTerm.reset()
    claudeResizeObserver = new ResizeObserver(() => claudeFitAddon?.fit())
    claudeResizeObserver.observe(claudeTerminalEl)
    window.api.openTerminal(win.container_id, claudeTerm.cols, claudeTerm.rows, win.name, 'claude')
    claudeTerm.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'claude')
      waitingWindows.remove(win.container_id)
    })
    claudeTerm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'claude')
    })

    window.api.onTerminalData((containerId: string, sessionType: string, data: string) => {
      if (containerId !== win.container_id) return
      if (sessionType === 'claude') claudeTerm?.write(data)
      else term?.write(data)
    })

    window.api.onTerminalSummary(({ containerId, title, bullets }: { containerId: string; title: string; bullets: string[] }) => {
      if (containerId === win.container_id) {
        conversationSummary.set(containerId, { title, bullets })
      }
    })
  })

  onDestroy(() => {
    claudeResizeObserver?.disconnect()
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id, 'claude')
    if (terminalOpened) window.api.closeTerminal(win.container_id, 'terminal')
    waitingWindows.remove(win.container_id)
    window.api.offTerminalSummary()
    conversationSummary.remove(win.container_id)
    claudeTerm?.dispose()
    term?.dispose()
  })

  $effect(() => {
    const panels = $panelLayout.panels
    const termPanel = panels.find(p => p.id === 'terminal')
    const claudePanel = panels.find(p => p.id === 'claude')

    // Re-attach xterm if the DOM element was re-created by Svelte (fresh element has no children).
    // xterm appends its canvas synchronously on open(), so no children = element is newly created.
    if (claudePanel?.visible && claudeTerminalEl && claudeTerm && !claudeTerminalEl.hasChildNodes()) {
      claudeTerm.open(claudeTerminalEl)
    }
    if (claudePanel?.visible) claudeFitAddon?.fit()

    if (termPanel?.visible) {
      if (!terminalOpened) {
        if (terminalEl) {
          initTerminalSession()
        } else {
          console.warn('[TerminalHost] terminal panel visible but terminalEl not bound')
        }
      } else {
        if (terminalEl && term && !terminalEl.hasChildNodes()) term.open(terminalEl)
        fitAddon?.fit()
      }
    }
  })
</script>

<section class="terminal-host">
  <div class="content-area" bind:clientWidth={contentAreaWidth}>
    {#each visiblePanels as panel, i (panel.id)}
      <div
        class="panel"
        data-panel-id={panel.id}
        style="width: {panel.width}%; min-width: 150px"
        ondragover={(e) => e.preventDefault()}
        ondrop={() => { if (draggedPanelId !== null && draggedPanelId !== panel.id) reorderPanels(draggedPanelId, panel.id) }}
        role="region"
        aria-label={panel.id}
      >
        <div class="panel-header">
          <span class="panel-title">{panel.id === 'claude' ? 'Claude' : panel.id === 'terminal' ? 'Terminal' : 'Editor'}</span>
          <span
            class="drag-handle"
            draggable="true"
            role="button"
            tabindex="0"
            aria-label="drag to reorder {panel.id}"
            ondragstart={() => { draggedPanelId = panel.id }}
            ondragend={() => { draggedPanelId = null }}
          >⠿</span>
        </div>
        <div class="panel-body">
          {#if panel.id === 'claude'}
            <div class="terminal-inner" bind:this={claudeTerminalEl}></div>
          {:else if panel.id === 'terminal'}
            <div class="terminal-inner" bind:this={terminalEl}></div>
          {:else if panel.id === 'editor'}
            <EditorPane containerId={win.container_id} {rootPath} />
          {/if}
        </div>
      </div>
      {#if i < visiblePanels.length - 1}
        <ResizeHandle
          containerWidth={contentAreaWidth}
          onResize={(delta) => resizePanels(panel.id, delta)}
          onResizeEnd={savePanelLayout}
        />
      {/if}
    {/each}
  </div>
  <WindowDetailPane
    {win}
    {project}
    summary={$conversationSummary.get(win.container_id)}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    onDelete={runDelete}
    onGitStatus={(s) => (gitStatus = s)}
    commitDisabled={commitBusy || pushBusy || deleteBusy || !gitStatus?.isDirty}
    pushDisabled={commitBusy || pushBusy || deleteBusy}
    deleteDisabled={deleteBusy}
  />
  {#if commitOpen}
    <CommitModal
      initialSubject={$conversationSummary.get(win.container_id)?.title ?? ''}
      initialBody={$conversationSummary.get(win.container_id)?.bullets.join('\n') ?? ''}
      onSubmit={runCommit}
      onCancel={() => (commitOpen = false)}
      busy={commitBusy}
    />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .content-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.2rem 0.5rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--fg-2);
    user-select: none;
  }

  .drag-handle {
    cursor: grab;
    padding: 0 0.2rem;
    color: var(--fg-3);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .panel-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .terminal-inner {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
