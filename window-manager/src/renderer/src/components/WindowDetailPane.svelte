<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord, WindowDependencyContainer, ContainerStatus, TurnRecord, LogEvent } from '../types'
  import type { ConversationSummary } from '../lib/conversationSummary'
  import { panelLayout, togglePanel } from '../lib/panelLayout'

  interface Props {
    win: WindowRecord
    project: ProjectRecord | null
    onCommit?: () => void
    onPush?: () => void
    onDelete?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
    deleteDisabled?: boolean
    summary?: ConversationSummary
    onGitStatus?: (status: { isDirty: boolean; added: number; deleted: number } | null) => void
    onCommitProject?: (projectId: number, clonePath: string) => void
    onPushProject?: (projectId: number, clonePath: string) => void
  }

  let {
    win,
    project,
    onCommit = () => {},
    onPush = () => {},
    onDelete,
    commitDisabled = true,
    pushDisabled = true,
    deleteDisabled = false,
    summary = undefined,
    onGitStatus = () => {},
    onCommitProject = undefined,
    onPushProject = undefined
  }: Props = $props()

  const isMulti = $derived(win.project_id === null && win.projects.length > 1)

  const panelVisible = $derived({
    claude:   $panelLayout.panels.find(p => p.id === 'claude')?.visible   ?? false,
    terminal: $panelLayout.panels.find(p => p.id === 'terminal')?.visible ?? false,
    editor:   $panelLayout.panels.find(p => p.id === 'editor')?.visible   ?? false
  })
  const visibleCount = $derived(
    Object.values(panelVisible).filter(Boolean).length
  )

  let deleteArmed = $state(false)
  let armTimer: ReturnType<typeof setTimeout> | undefined

  function handleDelete(): void {
    if (!deleteArmed) {
      deleteArmed = true
      if (armTimer) clearTimeout(armTimer)
      armTimer = setTimeout(() => {
        deleteArmed = false
        armTimer = undefined
      }, 3000)
      return
    }
    clearTimeout(armTimer)
    armTimer = undefined
    deleteArmed = false
    onDelete?.()
  }

  onDestroy(() => {
    if (armTimer) clearTimeout(armTimer)
  })

  let branch = $state('…')
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined
  let alive = true

  let depContainers = $state<WindowDependencyContainer[]>([])
  let depLogsVisible = $state(false)
  let selectedDepContainerId = $state<string | null>(null)
  let depLogs = $state('')
  let depLogEl = $state<HTMLElement | null>(null)
  const MAX_LOG_LINES = 500

  let depStatuses = $state<Record<string, ContainerStatus>>({})
  let statusTimer: ReturnType<typeof setInterval> | undefined

  let showTraces = $state(false)
  let turns = $state<TurnRecord[]>([])
  let expandedTurnId = $state<string | null>(null)
  let turnEvents = $state<Map<string, LogEvent[]>>(new Map())

  async function refreshDepStatuses(): Promise<void> {
    if (depContainers.length === 0) return
    try {
      const statuses = await window.api.getDepContainersStatus(depContainers.map(d => d.container_id))
      if (alive) depStatuses = statuses
    } catch {
      // keep last-known statuses on error
    }
  }

  function statusPrefix(containerId: string): string {
    const s = depStatuses[containerId]
    if (s === 'running') return '▶ '
    if (s === 'stopped') return '■ '
    return '? '
  }

  function parsePortsJson(raw: string | undefined): [string, string][] {
    if (!raw) return []
    try {
      return Object.entries(JSON.parse(raw)) as [string, string][]
    } catch {
      return []
    }
  }

  let parsedPorts: [string, string][] = $derived(parsePortsJson(win.ports))

  async function loadTurns(): Promise<void> {
    turns = await window.api.listTurns({ windowId: win.id, limit: 20 }) as TurnRecord[]
  }

  async function expandTurn(turnId: string): Promise<void> {
    if (expandedTurnId === turnId) { expandedTurnId = null; return }
    expandedTurnId = turnId
    if (!turnEvents.has(turnId)) {
      const events = await window.api.getTurnEvents(turnId) as LogEvent[]
      turnEvents = new Map(turnEvents).set(turnId, events)
    }
  }

  async function refreshBranch(): Promise<void> {
    if (isMulti) return
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error
    }
    if (alive && next) branch = next

    try {
      const status = await window.api.getGitStatus(win.id)
      if (alive) {
        gitStatus = status
        onGitStatus(status)
      }
    } catch {
      // keep last-known status on error
    }
  }

  async function toggleDepLogs(): Promise<void> {
    if (!selectedDepContainerId) return
    if (depLogsVisible) {
      window.api.stopDepLogs(selectedDepContainerId)
      depLogsVisible = false
    } else {
      depLogs = ''
      await window.api.startDepLogs(win.id, selectedDepContainerId)
      depLogsVisible = true
    }
  }

  async function switchDepContainer(containerId: string): Promise<void> {
    if (selectedDepContainerId && depLogsVisible) {
      window.api.stopDepLogs(selectedDepContainerId)
    }
    selectedDepContainerId = containerId
    depLogs = ''
    if (depLogsVisible) {
      await window.api.startDepLogs(win.id, containerId)
    }
  }

  onMount(async () => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
    const containers = await window.api.listWindowDeps(win.id)
    depContainers = containers
    if (containers.length > 0) {
      selectedDepContainerId = containers[0].container_id
      if (alive) {
        void refreshDepStatuses()
        statusTimer = setInterval(refreshDepStatuses, 5000)
      }
    }
    window.api.onDepLogsData((containerId: string, chunk: string) => {
      if (containerId === selectedDepContainerId) {
        const lines = (depLogs + chunk).split('\n')
        depLogs = lines.slice(-MAX_LOG_LINES).join('\n')
        if (depLogEl) depLogEl.scrollTop = depLogEl.scrollHeight
      }
    })
    const offStarted = window.api.onTurnStarted((t: unknown) => {
      const turn = t as TurnRecord
      if (turn.window_id === win.id) turns = [turn, ...turns]
    })
    const offUpdated = window.api.onTurnUpdated((patch: unknown) => {
      const p = patch as Partial<TurnRecord> & { id: string }
      turns = turns.map(t => t.id === p.id ? { ...t, ...p } : t)
    })
    const offEvent = window.api.onTurnEvent((e: unknown) => {
      const ev = e as LogEvent
      if (expandedTurnId === ev.turnId) {
        const existing = turnEvents.get(ev.turnId) ?? []
        turnEvents = new Map(turnEvents).set(ev.turnId, [...existing, ev])
      }
    })
    return () => {
      offStarted()
      offUpdated()
      offEvent()
    }
  })
  onDestroy(() => {
    alive = false
    if (timer) clearInterval(timer)
    if (statusTimer) clearInterval(statusTimer)
    window.api.offDepLogsData()
    if (depLogsVisible && selectedDepContainerId) {
      window.api.stopDepLogs(selectedDepContainerId)
    }
  })
</script>

<footer class="detail-pane">
  <div class="toggle-row">
    {#each (['claude', 'terminal', 'editor'] as const) as id}
      <button
        type="button"
        class="toggle-btn"
        class:active={panelVisible[id]}
        aria-pressed={panelVisible[id]}
        disabled={visibleCount <= 1 && panelVisible[id]}
        onclick={() => togglePanel(id)}
      >{id === 'claude' ? 'Claude' : id === 'terminal' ? 'Terminal' : 'Editor'}</button>
    {/each}
    {#if depContainers.length > 0}
      <button
        type="button"
        class="toggle-btn"
        class:active={depLogsVisible}
        aria-label="Dep Logs"
        onclick={toggleDepLogs}
      >Dep Logs</button>
    {/if}
    <button
      type="button"
      class="toggle-btn"
      class:active={showTraces}
      aria-pressed={showTraces}
      aria-label="Traces"
      onclick={() => { showTraces = !showTraces; if (showTraces) loadTurns() }}
    >Traces</button>
  </div>
  {#if depLogsVisible}
    <div class="dep-logs-section" role="region" aria-label="dep logs">
      {#if depContainers.length > 1}
        <select
          class="dep-selector"
          value={selectedDepContainerId}
          onchange={(e) => switchDepContainer((e.target as HTMLSelectElement).value)}
        >
          {#each depContainers as dc (dc.container_id)}
            <option value={dc.container_id}>{statusPrefix(dc.container_id)}{dc.image}:{dc.tag}</option>
          {/each}
        </select>
      {:else if depContainers.length === 1}
        <span class="dep-label">{statusPrefix(depContainers[0].container_id)}{depContainers[0].image}:{depContainers[0].tag}</span>
      {/if}
      <pre class="dep-log-output" bind:this={depLogEl}>{depLogs}</pre>
    </div>
  {/if}
  <div class="info-row">
    <div class="info">
      <span class="name">{win.name}</span>
      {#if !isMulti}
        <span class="sep">·</span>
        <span class="project">{project?.name ?? ''}</span>
        <span class="sep">·</span>
        <span class="branch" title="current branch">{branch}</span>
        {#if gitStatus !== null}
          {#if gitStatus.isDirty && (gitStatus.added > 0 || gitStatus.deleted > 0)}
            <span class="sep">·</span>
            <span class="git-stat">+{gitStatus.added} −{gitStatus.deleted}</span>
          {:else if !gitStatus.isDirty}
            <span class="sep">·</span>
            <span class="git-clean">(clean)</span>
          {/if}
        {/if}
      {/if}
      <span class="sep">·</span>
      <span class="status {win.status}">{win.status}</span>
      {#each parsedPorts as [container, host]}
        <span class="sep">·</span>
        <span class="port">:{container}→:{host}</span>
      {/each}
    </div>
    <div class="actions">
      {#if !isMulti}
        <button type="button" disabled={commitDisabled} onclick={onCommit}>Commit</button>
        <button type="button" disabled={pushDisabled} onclick={onPush}>Push</button>
      {/if}
      {#if onDelete}
        <button
          type="button"
          class="delete-btn"
          class:armed={deleteArmed}
          disabled={deleteDisabled}
          onclick={handleDelete}
        >{deleteArmed ? 'Confirm?' : 'Delete'}</button>
      {/if}
    </div>
  </div>
  {#if isMulti}
    {#each win.projects as wp}
      <div class="project-row">
        <span class="project-row-label">{wp.project_name ?? wp.clone_path.split('/').pop()}</span>
        <button type="button" disabled={commitDisabled} onclick={() => onCommitProject?.(wp.project_id, wp.clone_path)}>Commit</button>
        <button type="button" disabled={pushDisabled} onclick={() => onPushProject?.(wp.project_id, wp.clone_path)}>Push</button>
      </div>
    {/each}
  {/if}
  {#if summary}
    <div class="summary-row">
      <span class="summary-title">{summary.title}</span>
      <ul class="summary-bullets">
        {#each summary.bullets as b}<li>{b}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if showTraces}
  <div data-testid="traces-pane" class="traces-pane">
    {#if turns.length === 0}
      <p class="no-turns">No turns yet.</p>
    {:else}
      {#each turns as turn (turn.id)}
        <div class="turn-row" role="button" tabindex="0"
          onclick={() => expandTurn(turn.id)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') expandTurn(turn.id) }}>
          <span class="turn-type">{turn.turn_type === 'human-claude' ? 'human→claude' : 'shellephant→claude'}</span>
          <span class="turn-status {turn.status}">{turn.status}</span>
          {#if turn.duration_ms != null}
            <span class="turn-duration">{turn.duration_ms}ms</span>
          {:else}
            <span class="turn-duration">—</span>
          {/if}
          <span class="turn-ts">{new Date(turn.started_at).toLocaleTimeString()}</span>
        </div>
        {#if expandedTurnId === turn.id}
          <div class="turn-events">
            {#each turnEvents.get(turn.id) ?? [] as ev (ev.ts + ev.eventType)}
              <div class="event-row {ev.eventType.includes('error') ? 'error' : ''}">
                <span class="ev-type">{ev.eventType}</span>
                <span class="ev-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
                {#if ev.payload?.error}
                  <span class="ev-error">{ev.payload.error}</span>
                {/if}
                {#if ev.payload?.durationMs != null}
                  <span class="ev-dur">{ev.payload.durationMs}ms</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
  {/if}
</footer>

<style>
  .detail-pane {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.45rem 0.9rem 0.5rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-1);
  }
  .toggle-row {
    display: flex;
    gap: 0.3rem;
  }
  .toggle-btn {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.18rem 0.55rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-2);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .info {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
  }
  .name {
    font-weight: 600;
    color: var(--fg-0);
  }
  .sep {
    color: var(--fg-3);
  }
  .branch {
    font-family: var(--font-mono);
  }
  .git-stat {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--warning, #facc15);
  }
  .git-clean {
    font-size: 0.78rem;
    color: var(--fg-3);
  }
  .port {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--fg-2);
  }
  .status.running {
    color: var(--success, #4ade80);
  }
  .status.stopped {
    color: var(--fg-3);
  }
  .status.unknown {
    color: var(--warning, #facc15);
  }
  .actions {
    display: flex;
    gap: 0.4rem;
  }
  button:not(.toggle-btn) {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    border-radius: 4px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .delete-btn {
    border-color: var(--danger-border, #7f1d1d);
    color: var(--danger, #f87171);
  }
  .delete-btn.armed {
    background: var(--danger, #f87171);
    border-color: var(--danger, #f87171);
    color: #09090b;
  }
  .summary-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
  }
  .summary-title {
    color: var(--fg-1);
    font-weight: 500;
  }
  .summary-bullets {
    margin: 0;
    padding-left: 1rem;
    color: var(--fg-2);
    list-style: disc;
  }
  .summary-bullets li {
    line-height: 1.4;
  }
  .dep-logs-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .dep-selector {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    padding: 0.18rem 0.4rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-1);
    align-self: flex-start;
  }
  .dep-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-2);
  }
  .dep-log-output {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-1);
    max-height: 160px;
    overflow-y: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--bg-2);
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
  }
  .project-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.5rem;
    border-top: 1px solid var(--border);
  }
  .project-row-label {
    flex: 1;
    font-size: 0.75rem;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .traces-pane {
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    max-height: 200px;
    overflow-y: auto;
  }
  .no-turns {
    font-size: 0.75rem;
    color: var(--fg-3);
    margin: 0;
  }
  .turn-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.75rem;
    padding: 0.15rem 0.2rem;
    cursor: pointer;
    border-radius: 3px;
  }
  .turn-row:hover {
    background: var(--bg-2);
  }
  .turn-type {
    font-family: var(--font-mono);
    color: var(--fg-1);
  }
  .turn-status {
    font-size: 0.72rem;
    padding: 0 0.3rem;
    border-radius: 3px;
  }
  .turn-status.success { color: var(--success, #4ade80); }
  .turn-status.error   { color: var(--danger, #f87171); }
  .turn-status.running { color: var(--warning, #facc15); }
  .turn-duration {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-2);
  }
  .turn-ts {
    font-size: 0.7rem;
    color: var(--fg-3);
    margin-left: auto;
  }
  .turn-events {
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }
  .event-row {
    display: flex;
    gap: 0.4rem;
    font-size: 0.7rem;
    color: var(--fg-2);
  }
  .event-row.error { color: var(--danger, #f87171); }
  .ev-type { font-family: var(--font-mono); }
  .ev-ts { color: var(--fg-3); }
  .ev-error { color: var(--danger, #f87171); }
  .ev-dur { font-family: var(--font-mono); color: var(--fg-2); }

</style>
