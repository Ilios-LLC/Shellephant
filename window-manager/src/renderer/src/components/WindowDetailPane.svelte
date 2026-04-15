<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord } from '../types'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onCommit?: () => void
    onPush?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
  }

  let {
    win,
    project,
    onCommit = () => {},
    onPush = () => {},
    commitDisabled = true,
    pushDisabled = true
  }: Props = $props()

  let branch = $state('…')
  let timer: ReturnType<typeof setInterval> | undefined
  let alive = true

  let parsedPorts: [string, string][] = $derived(
    win.ports
      ? (Object.entries(JSON.parse(win.ports)) as [string, string][])
      : []
  )

  async function refreshBranch(): Promise<void> {
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error; do not toast
    }
    if (alive && next) branch = next
  }

  onMount(() => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
  })
  onDestroy(() => {
    alive = false
    if (timer) clearInterval(timer)
  })

  function injectClaude(): void {
    window.api.sendTerminalInput(win.container_id, '\x15claude --dangerously-skip-permissions\n')
  }
</script>

<footer class="detail-pane">
  <div class="info">
    <span class="name">{win.name}</span>
    <span class="sep">·</span>
    <span class="project">{project.name}</span>
    <span class="sep">·</span>
    <span class="branch" title="current branch">{branch}</span>
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
    <button type="button" disabled={win.status !== 'running'} onclick={injectClaude}>Claude</button>
  </div>
</footer>

<style>
  .detail-pane {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-1);
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
  button {
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
</style>
