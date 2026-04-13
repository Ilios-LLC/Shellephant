<script lang="ts">
  import type { ProjectRecord } from '../types'
  import ProjectItem from './ProjectItem.svelte'
  import CreateProject from './CreateProject.svelte'

  interface Props {
    projects: ProjectRecord[]
    selectedProjectId: number | null
    onProjectSelect: (project: ProjectRecord) => void
    onProjectCreated: (project: ProjectRecord) => void
  }

  let { projects, selectedProjectId, onProjectSelect, onProjectCreated }: Props = $props()
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    <h1>Projects</h1>
    <CreateProject onCreated={onProjectCreated} />
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
    <p class="empty-hint">No projects. Click + to add one.</p>
  {/if}
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

  h1 {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin: 0;
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0.35rem 0;
  }

  .empty-hint {
    padding: 1rem 0.85rem;
    font-size: 0.78rem;
    color: var(--fg-2);
  }
</style>
