<script lang="ts">
  import { onMount } from 'svelte'

  interface FileEntry {
    name: string
    isDir: boolean
  }

  interface RootConfig {
    rootPath: string
    label: string
  }

  interface Props {
    containerId: string
    roots: RootConfig[]
    onFileSelect: (path: string) => void
  }

  let { containerId, roots, onFileSelect }: Props = $props()

  let childrenMap = $state(new Map<string, FileEntry[]>())
  let expanded = $state(new Set<string>())
  let loading = $state(new Set<string>())
  let selectedPath = $state<string | null>(null)

  async function loadDir(dirPath: string): Promise<void> {
    if (childrenMap.has(dirPath) || loading.has(dirPath)) return
    loading = new Set([...loading, dirPath])
    try {
      const entries = await window.api.listContainerDir(containerId, dirPath)
      childrenMap = new Map([...childrenMap, [dirPath, entries]])
    } finally {
      loading = new Set([...loading].filter((p) => p !== dirPath))
    }
  }

  async function toggleDir(dirPath: string): Promise<void> {
    await loadDir(dirPath)
    if (expanded.has(dirPath)) {
      expanded = new Set([...expanded].filter((p) => p !== dirPath))
    } else {
      expanded = new Set([...expanded, dirPath])
    }
  }

  function handleFileClick(filePath: string): void {
    selectedPath = filePath
    onFileSelect(filePath)
  }

  interface RenderEntry {
    path: string
    name: string
    isDir: boolean
    depth: number
    isRootLabel?: boolean
    rootPath?: string
  }

  function flattenVisible(dirPath: string, depth: number): RenderEntry[] {
    const entries = childrenMap.get(dirPath) ?? []
    const result: RenderEntry[] = []
    for (const entry of entries) {
      const childPath = `${dirPath}/${entry.name}`
      result.push({ path: childPath, name: entry.name, isDir: entry.isDir, depth })
      if (entry.isDir && expanded.has(childPath)) {
        result.push(...flattenVisible(childPath, depth + 1))
      }
    }
    return result
  }

  function computeFlatList(): RenderEntry[] {
    if (roots.length === 1) {
      return flattenVisible(roots[0].rootPath, 0)
    }
    const result: RenderEntry[] = []
    for (const root of roots) {
      result.push({ path: root.rootPath, name: root.label, isDir: true, depth: 0, isRootLabel: true, rootPath: root.rootPath })
      if (expanded.has(root.rootPath)) {
        result.push(...flattenVisible(root.rootPath, 1))
      }
    }
    return result
  }

  const flatList = $derived(computeFlatList())

  export function scrollToRoot(rootPath: string): void {
    if (!expanded.has(rootPath)) {
      expanded = new Set([...expanded, rootPath])
    }
    const el = document.querySelector(`[data-root-path="${rootPath}"]`) as HTMLElement | null
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  onMount(() => {
    if (roots.length === 1) {
      expanded = new Set([roots[0].rootPath])
      void loadDir(roots[0].rootPath)
    } else {
      for (const root of roots) {
        expanded = new Set([...expanded, root.rootPath])
        void loadDir(root.rootPath)
      }
    }
  })
</script>

<div class="file-tree">
  {#each flatList as entry (entry.path)}
    {#if entry.isRootLabel}
      <button
        type="button"
        class="tree-entry dir root-label"
        class:expanded={expanded.has(entry.path)}
        data-root-path={entry.rootPath}
        style:padding-left="8px"
        onclick={() => toggleDir(entry.path)}
      >
        <span class="chevron" aria-hidden="true">{expanded.has(entry.path) ? '▾' : '▸'}</span>
        {entry.name}
      </button>
    {:else if entry.isDir}
      <button
        type="button"
        class="tree-entry dir"
        class:expanded={expanded.has(entry.path)}
        style:padding-left="{entry.depth * 12 + 8}px"
        onclick={() => toggleDir(entry.path)}
      >
        <span class="chevron" aria-hidden="true">{expanded.has(entry.path) ? '▾' : '▸'}</span>
        {entry.name}
        {#if loading.has(entry.path)}<span class="loading-dot" aria-hidden="true">…</span>{/if}
      </button>
    {:else}
      <button
        type="button"
        class="tree-entry file"
        class:selected={selectedPath === entry.path}
        style:padding-left="{entry.depth * 12 + 20}px"
        onclick={() => handleFileClick(entry.path)}
      >
        {entry.name}
      </button>
    {/if}
  {/each}
</div>

<style>
  .file-tree {
    height: 100%;
    overflow-y: auto;
    background: var(--bg-1);
    padding: 0.25rem 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .tree-entry {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding-top: 0.2rem;
    padding-bottom: 0.2rem;
    padding-right: 0.5rem;
    background: none;
    border: none;
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-entry:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .tree-entry.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--fg-0);
  }
  .root-label {
    font-weight: 600;
    color: var(--fg-0);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
  }
  .chevron {
    font-size: 0.65rem;
    width: 10px;
    flex-shrink: 0;
  }
  .loading-dot {
    color: var(--fg-3);
    margin-left: 0.2rem;
  }
</style>
