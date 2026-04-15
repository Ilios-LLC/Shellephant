<script lang="ts">
  import type { ProjectRecord, ProjectGroupRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import GroupStrip from './GroupStrip.svelte'
  import { waitingWindows, type WaitingEntry } from '../lib/waitingWindows'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    groups: ProjectGroupRecord[]
    activeGroupId: number | null
    onProjectSelect: (project: ProjectRecord) => void
    onRequestNewProject: () => void
    onRequestSettings: () => void
    onRequestHome: () => void
    onWaitingWindowSelect: (entry: WaitingEntry) => void
    onGroupSelect: (id: number) => void
    onGroupCreated: (group: ProjectGroupRecord) => void
  }

  let {
    projects,
    selectedProjectId,
    groups,
    activeGroupId,
    onProjectSelect,
    onRequestNewProject,
    onRequestSettings,
    onRequestHome,
    onWaitingWindowSelect,
    onGroupSelect,
    onGroupCreated
  }: Props = $props()
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <button type="button" class="home-link" onclick={onRequestHome}>Shellephant</button>
    <div class="header-actions">
      <button
        type="button"
        class="icon-btn"
        aria-label="settings"
        title="Settings"
        onclick={onRequestSettings}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="new project"
        title="New project"
        onclick={onRequestNewProject}>+</button
      >
    </div>
  </header>
  <nav class="sidebar-list">
    {#each projects as project (project.id)}
      <ProjectItem
        {project}
        selected={project.id === selectedProjectId}
        onSelect={onProjectSelect}
      />
    {/each}
  </nav>
  {#if projects.length === 0}
    <p class="empty-hint">{activeGroupId !== null ? 'No projects in this group.' : 'No projects yet.'}</p>
  {/if}
  {#if $waitingWindows.length > 0}
    <div class="waiting-section">
      <div class="waiting-header">Waiting</div>
      {#each $waitingWindows as entry (entry.containerId)}
        <button
          type="button"
          class="waiting-item"
          onclick={() => onWaitingWindowSelect(entry)}
        >
          <span class="waiting-dot" aria-hidden="true">●</span>
          <span class="waiting-label">{entry.projectName} / {entry.windowName}</span>
        </button>
      {/each}
    </div>
  {/if}
  <GroupStrip {groups} {activeGroupId} {onGroupSelect} {onGroupCreated} />
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    height: 100%;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  .home-link {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-ui);
  }

  .home-link:hover {
    color: var(--accent-hi);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.45rem;
    min-width: 1.6rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg-1);
    border-radius: 4px;
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--accent-hi);
    border-color: var(--accent);
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }

  .waiting-section {
    border-top: 1px solid var(--border);
    padding: 0.35rem 0;
  }

  .waiting-header {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    padding: 0.35rem 0.85rem 0.2rem;
  }

  .waiting-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 0.82rem;
  }

  .waiting-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .waiting-dot {
    font-size: 0.5rem;
    color: var(--accent-hi);
    flex-shrink: 0;
  }

  .waiting-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
