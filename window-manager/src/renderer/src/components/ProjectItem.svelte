<!-- src/renderer/src/components/ProjectItem.svelte -->
<script lang="ts">
  import type { ProjectRecord } from '../types'

  interface Props {
    project: ProjectRecord
    selected: boolean
    onSelect: (project: ProjectRecord) => void
    onSettingsClick?: (project: ProjectRecord) => void
  }

  let { project, selected, onSelect, onSettingsClick = () => {} }: Props = $props()

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

  function handleGearClick(e: MouseEvent): void {
    e.stopPropagation()
    onSettingsClick(project)
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
  <button
    type="button"
    class="gear-btn"
    aria-label="project settings"
    title="Project settings"
    onclick={handleGearClick}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  </button>
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
    transition: background 120ms ease, color 120ms ease;
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

  .gear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 3px;
    opacity: 0;
    flex-shrink: 0;
  }

  .project-item:hover .gear-btn {
    opacity: 1;
  }

  .gear-btn:hover {
    color: var(--accent-hi);
  }

  .gear-btn:focus-visible {
    opacity: 1;
  }
</style>
