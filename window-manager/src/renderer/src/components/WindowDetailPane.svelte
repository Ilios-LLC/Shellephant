<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord } from '../types'
  import type { ConversationSummary } from '../lib/conversationSummary'

  type ViewMode = 'claude' | 'terminal' | 'editor'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    viewMode?: ViewMode
    onViewChange?: (mode: ViewMode) => void
    onCommit?: () => void
    onPush?: () => void
    onDelete?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
    deleteDisabled?: boolean
    summary?: ConversationSummary
    onGitStatus?: (status: { isDirty: boolean; added: number; deleted: number } | null) => void
  }

  let {
    win,
    project,
    viewMode = 'claude',
    onViewChange = () => {},
    onCommit = () => {},
    onPush = () => {},
    onDelete,
    commitDisabled = true,
    pushDisabled = true,
    deleteDisabled = false,
    summary = undefined,
    onGitStatus = () => {}
  }: Props = $props()

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

  function parsePortsJson(raw: string | undefined): [string, string][] {
    if (!raw) return []
    try {
      return Object.entries(JSON.parse(raw)) as [string, string][]
    } catch {
      return []
    }
  }

  let parsedPorts: [string, string][] = $derived(parsePortsJson(win.ports))

  async function refreshBranch(): Promise<void> {
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error; do not toast
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

  onMount(() => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
  })
  onDestroy(() => {
    alive = false
    if (timer) clearInterval(timer)
  })

</script>

<footer class="detail-pane">
  <div class="toggle-row">
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'claude'}
      aria-pressed={viewMode === 'claude'}
      onclick={() => onViewChange('claude')}
    >Claude</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'terminal'}
      aria-pressed={viewMode === 'terminal'}
      onclick={() => onViewChange('terminal')}
    >Terminal</button>
    <button
      type="button"
      class="toggle-btn"
      class:active={viewMode === 'editor'}
      aria-pressed={viewMode === 'editor'}
      onclick={() => onViewChange('editor')}
    >Editor</button>
  </div>
  <div class="info-row">
    <div class="info">
      <span class="name">{win.name}</span>
      <span class="sep">·</span>
      <span class="project">{project.name}</span>
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
      <span class="sep">·</span>
      <span class="status {win.status}">{win.status}</span>
      {#each parsedPorts as [container, host]}
        <span class="sep">·</span>
        <span class="port">:{container}→:{host}</span>
      {/each}
    </div>
    <div class="actions">
      <button type="button" disabled={commitDisabled} onclick={onCommit}>Commit</button>
      <button type="button" disabled={pushDisabled} onclick={onPush}>Push</button>
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
  {#if summary}
    <div class="summary-row">
      <span class="summary-title">{summary.title}</span>
      <ul class="summary-bullets">
        {#each summary.bullets as b}<li>{b}</li>{/each}
      </ul>
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
</style>
