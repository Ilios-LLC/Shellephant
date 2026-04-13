<!-- src/renderer/src/components/ProjectItem.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    project: ProjectRecord
    selected: boolean
    onSelect: (project: ProjectRecord) => void
  }

  let { project, selected, onSelect }: Props = $props()

  function extractPath(gitUrl: string): string {
    const match = gitUrl.match(/^git@[^:]+:(.+?)(?:\.git)?$/)
    return match ? match[1] : gitUrl
  }

  function handleClick(): void {
    onSelect(project)
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') onSelect(project)
  }
</script>

<div
  class="project-item"
  class:selected
  data-testid="project-item"
  role="button"
  tabindex="0"
  aria-label={`select ${project.name}`}
  onclick={handleClick}
  onkeydown={handleKey}
>
  <div class="info">
    <span class="name">{project.name}</span>
    <span class="url">{extractPath(project.git_url)}</span>
  </div>
</div>

<style>
  .project-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--fg-1);
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .project-item:hover {
    background: var(--bg-1);
    color: var(--fg-0);
  }

  .project-item.selected {
    background: var(--bg-2);
    color: var(--fg-0);
    border-left-color: var(--accent);
  }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 0.9rem;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .url {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
