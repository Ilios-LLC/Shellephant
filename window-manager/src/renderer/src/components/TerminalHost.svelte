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
  import { panelLayout, togglePanel, resizePanels, reorderPanels, savePanelLayout } from '../lib/panelLayout'
  import type { PanelId } from '../lib/panelLayout'

  interface Props {
    win: WindowRecord
    project: ProjectRecord | null
    onWindowDeleted?: (id: number) => void
  }

  let { win, project, onWindowDeleted = () => {} }: Props = $props()

  const editorRoots = $derived(
    win.projects.length > 0
      ? win.projects.map(wp => ({ rootPath: wp.clone_path, label: wp.project_name ?? wp.clone_path.split('/').pop() ?? wp.clone_path }))
      : project
        ? [{ rootPath: '/workspace/' + (project.git_url.split('/').pop() ?? 'unknown').replace(/\.git$/, ''), label: project.name }]
        : []
  )

  const panelVisible = $derived({
    claude:   $panelLayout.panels.find(p => p.id === 'claude')?.visible   ?? false,
    terminal: $panelLayout.panels.find(p => p.id === 'terminal')?.visible ?? false,
    editor:   $panelLayout.panels.find(p => p.id === 'editor')?.visible   ?? false
  })

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
  // Set in onMount so the first $effect run (which happens after onMount) skips reinit.
  let postMountClaudeEffectPending = false

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)
  let deleteBusy = $state(false)
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
  let commitProjectId = $state(null as number | null)
  let editorPaneRef = $state(null as InstanceType<typeof EditorPane> | null)

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
    scrollback: 5000,
    scrollSensitivity: 3,
    fastScrollSensitivity: 10,
    fastScrollModifier: 'shift' as const
  }

  function attachClaudeScrollInterceptor(): void {
    claudeTerminalEl.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      claudeTerm?.scrollLines(e.deltaY > 0 ? 3 : -3)
    }, { passive: false })
  }

  function attachTerminalScrollInterceptor(): void {
    terminalEl.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      term?.scrollLines(e.deltaY > 0 ? 3 : -3)
    }, { passive: false })
  }

  function reinitClaudeTerminal(): void {
    claudeResizeObserver?.disconnect()
    claudeResizeObserver = undefined
    claudeTerm?.dispose()
    claudeTerm = new XTerm(xtermOptions)
    claudeFitAddon = new FitAddon()
    claudeTerm.loadAddon(claudeFitAddon)
    claudeTerm.loadAddon(new WebLinksAddon())
    claudeTerm.open(claudeTerminalEl)
    attachClaudeScrollInterceptor()
    claudeFitAddon.fit()
    claudeTerm.focus()
    claudeResizeObserver = new ResizeObserver(() => claudeFitAddon?.fit())
    claudeResizeObserver.observe(claudeTerminalEl)
    claudeTerm.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'claude')
      waitingWindows.remove(win.container_id)
    })
    claudeTerm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'claude')
    })
  }

  function initTerminalSession(launchBackend = true): void {
    terminalOpened = true
    term = new XTerm(xtermOptions)
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(terminalEl)
    attachTerminalScrollInterceptor()
    fitAddon.fit()
    term.focus()
    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalEl)
    if (launchBackend) {
      term.reset()
      window.api.openTerminal(win.container_id, term.cols, term.rows, win.name, 'terminal')
    }
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
      const payload = { subject: v.subject, body: v.body || undefined }
      const res = commitProjectId !== null
        ? await window.api.commitProject(win.id, commitProjectId, payload)
        : await window.api.commit(win.id, payload)
      commitProjectId = null
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

  async function runPushProject(projectId: number, _clonePath: string): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.pushProject(win.id, projectId)
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
    attachClaudeScrollInterceptor()
    claudeFitAddon.fit()
    claudeTerm.reset()
    claudeResizeObserver = new ResizeObserver(() => claudeFitAddon?.fit())
    claudeResizeObserver.observe(claudeTerminalEl)
    postMountClaudeEffectPending = true
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

    // Re-attach when the DOM element was replaced by Svelte (panel hidden then re-shown creates a new node).
    // postMountClaudeEffectPending skips the first $effect run (which fires after onMount) to avoid
    // spurious reinit — in tests xterm mock never adds children so hasChildNodes() is always false.
    if (claudePanel?.visible && claudeTerminalEl && claudeTerm && !claudeTerminalEl.hasChildNodes()) {
      if (postMountClaudeEffectPending) {
        postMountClaudeEffectPending = false
      } else {
        reinitClaudeTerminal()
      }
    } else if (claudePanel?.visible) {
      claudeFitAddon?.fit()
    }

    if (termPanel?.visible) {
      if (!terminalOpened) {
        if (terminalEl) {
          initTerminalSession()
        } else {
          console.warn('[TerminalHost] terminal panel visible but terminalEl not bound')
        }
      } else if (terminalEl && term && !terminalEl.hasChildNodes()) {
        // Panel was hidden (DOM node destroyed) and re-shown (fresh node).
        // XTerm can't be re-opened on a new element — dispose and reinitialize
        // the renderer only; the backend tmux session stays alive.
        resizeObserver?.disconnect()
        resizeObserver = undefined
        term.dispose()
        term = undefined
        fitAddon = undefined
        terminalOpened = false
        initTerminalSession(false)
      } else {
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
            <EditorPane bind:this={editorPaneRef} containerId={win.container_id} roots={editorRoots} />
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
    commitDisabled={commitBusy || pushBusy || deleteBusy || (gitStatus !== null && !gitStatus.isDirty)}
    pushDisabled={commitBusy || pushBusy || deleteBusy}
    deleteDisabled={deleteBusy}
    onCommitProject={(projectId, _clonePath) => { commitProjectId = projectId; commitOpen = true }}
    onPushProject={runPushProject}
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
  }
</style>
