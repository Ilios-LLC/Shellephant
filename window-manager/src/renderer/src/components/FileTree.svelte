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
    onFileCreated?: (path: string) => void
    onPathDeleted?: (path: string) => void
    onPathRenamed?: (oldPath: string, newPath: string) => void
  }

  let { containerId, roots, onFileSelect, onFileCreated, onPathDeleted, onPathRenamed }: Props =
    $props()

  let childrenMap = $state(new Map<string, FileEntry[]>())
  let expanded = $state(new Set<string>())
  let loading = $state(new Set<string>())
  let selectedPath = $state<string | null>(null)

  // Inline create state
  let pendingCreate = $state<{ parentPath: string; type: 'file' | 'dir' } | null>(null)
  let pendingInputEl = $state<HTMLInputElement | null>(null)

  // Inline rename state
  let pendingRename = $state<{ path: string; currentName: string; isDir: boolean } | null>(null)
  let renameInputEl = $state<HTMLInputElement | null>(null)

  // Context menu state
  interface ContextMenuState {
    x: number
    y: number
    entry: RenderEntry
  }
  let contextMenu = $state<ContextMenuState | null>(null)

  // Auto-focus inline inputs when they mount
  $effect(() => {
    if (pendingInputEl) pendingInputEl.focus()
  })
  $effect(() => {
    if (renameInputEl) {
      renameInputEl.focus()
      renameInputEl.select()
    }
  })

  // ── Directory loading ──────────────────────────────────────────────────────

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

  async function refreshDir(dirPath: string): Promise<void> {
    childrenMap = new Map([...childrenMap].filter(([k]) => k !== dirPath))
    await loadDir(dirPath)
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

  // ── Context menu ──────────────────────────────────────────────────────────

  function showContextMenu(e: MouseEvent, entry: RenderEntry): void {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 168
    const menuHeight = 140
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
    contextMenu = { x, y, entry }
  }

  function dismissContextMenu(): void {
    contextMenu = null
  }

  // ── Create operations ─────────────────────────────────────────────────────

  async function startNewFile(parentPath: string): Promise<void> {
    contextMenu = null
    if (!expanded.has(parentPath)) {
      await loadDir(parentPath)
      expanded = new Set([...expanded, parentPath])
    }
    pendingCreate = { parentPath, type: 'file' }
  }

  async function startNewDir(parentPath: string): Promise<void> {
    contextMenu = null
    if (!expanded.has(parentPath)) {
      await loadDir(parentPath)
      expanded = new Set([...expanded, parentPath])
    }
    pendingCreate = { parentPath, type: 'dir' }
  }

  function startRename(entry: RenderEntry): void {
    contextMenu = null
    pendingRename = { path: entry.path, currentName: entry.name, isDir: entry.isDir }
  }

  async function handleDelete(entry: RenderEntry): Promise<void> {
    contextMenu = null
    const label = entry.isDir
      ? `directory "${entry.name}" and all its contents`
      : `"${entry.name}"`
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      await window.api.deleteContainerPath(containerId, entry.path)
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'))
      await refreshDir(parentPath)
      if (selectedPath === entry.path) selectedPath = null
      onPathDeleted?.(entry.path)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  // ── Inline input handlers ─────────────────────────────────────────────────

  function isValidName(name: string): boolean {
    if (!name || !name.trim()) return false
    if (name.includes('/')) return false
    if (name === '.' || name === '..') return false
    return true
  }

  async function handlePendingKeydown(e: KeyboardEvent): Promise<void> {
    e.stopPropagation()
    if (e.key === 'Escape') {
      pendingCreate = null
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!pendingCreate || !pendingInputEl) return
      const name = pendingInputEl.value.trim()
      if (!isValidName(name)) {
        pendingCreate = null
        return
      }
      const { parentPath, type } = pendingCreate
      const newPath = `${parentPath}/${name}`
      pendingCreate = null // clear before async so blur is a no-op
      try {
        if (type === 'file') {
          await window.api.createContainerFile(containerId, newPath)
          await refreshDir(parentPath)
          onFileCreated?.(newPath)
        } else {
          await window.api.createContainerDir(containerId, newPath)
          await refreshDir(parentPath)
        }
      } catch (err) {
        console.error('Create failed:', err)
      }
    }
  }

  async function handleRenameKeydown(e: KeyboardEvent): Promise<void> {
    e.stopPropagation()
    if (e.key === 'Escape') {
      pendingRename = null
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!pendingRename || !renameInputEl) return
      const newName = renameInputEl.value.trim()
      if (!isValidName(newName) || newName === pendingRename.currentName) {
        pendingRename = null
        return
      }
      const snapshot = { ...pendingRename }
      pendingRename = null // clear before async so blur is a no-op
      const parentPath = snapshot.path.substring(0, snapshot.path.lastIndexOf('/'))
      const newPath = `${parentPath}/${newName}`
      try {
        await window.api.renameContainerPath(containerId, snapshot.path, newPath)
        await refreshDir(parentPath)
        if (selectedPath === snapshot.path) selectedPath = newPath
        onPathRenamed?.(snapshot.path, newPath)
      } catch (err) {
        console.error('Rename failed:', err)
      }
    }
  }

  // ── Public methods ────────────────────────────────────────────────────────

  export function startNewFileAt(parentPath?: string): void {
    const path = parentPath ?? roots[0]?.rootPath
    if (path) void startNewFile(path)
  }

  export function startNewDirAt(parentPath?: string): void {
    const path = parentPath ?? roots[0]?.rootPath
    if (path) void startNewDir(path)
  }

  export function scrollToRoot(rootPath: string): void {
    if (!expanded.has(rootPath)) {
      expanded = new Set([...expanded, rootPath])
    }
    const el = document.querySelector(`[data-root-path="${rootPath}"]`) as HTMLElement | null
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  // ── Flat list computation ─────────────────────────────────────────────────

  interface RenderEntry {
    path: string
    name: string
    isDir: boolean
    depth: number
    isRootLabel?: boolean
    rootPath?: string
    isPendingCreate?: boolean
    pendingType?: 'file' | 'dir'
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
    // Insert pending-create row at the end of this directory's children
    if (pendingCreate?.parentPath === dirPath) {
      result.push({
        path: `${dirPath}/__pending_create__`,
        name: '',
        isDir: pendingCreate.type === 'dir',
        depth,
        isPendingCreate: true,
        pendingType: pendingCreate.type
      })
    }
    return result
  }

  function computeFlatList(): RenderEntry[] {
    if (roots.length === 1) {
      return flattenVisible(roots[0].rootPath, 0)
    }
    const result: RenderEntry[] = []
    for (const root of roots) {
      result.push({
        path: root.rootPath,
        name: root.label,
        isDir: true,
        depth: 0,
        isRootLabel: true,
        rootPath: root.rootPath
      })
      if (expanded.has(root.rootPath)) {
        result.push(...flattenVisible(root.rootPath, 1))
      }
    }
    return result
  }

  const flatList = $derived(computeFlatList())

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

<!-- Dismiss context menu when clicking anywhere outside it -->
<svelte:window
  onclick={dismissContextMenu}
  onkeydown={(e) => {
    if (e.key === 'Escape' && (contextMenu || pendingCreate || pendingRename)) {
      contextMenu = null
      pendingCreate = null
      pendingRename = null
    }
  }}
/>

<div class="file-tree">
  {#each flatList as entry (entry.path)}
    {#if entry.isPendingCreate}
      <!-- Inline new-file / new-folder input -->
      <div
        class="tree-entry pending-input"
        style:padding-left="{entry.depth * 12 + 20}px"
      >
        <span class="type-icon" aria-hidden="true">{entry.pendingType === 'dir' ? '▸' : ''}</span>
        <input
          bind:this={pendingInputEl}
          class="inline-input"
          type="text"
          placeholder={entry.pendingType === 'dir' ? 'folder name' : 'file name'}
          onkeydown={handlePendingKeydown}
          onblur={() => { pendingCreate = null }}
        />
      </div>
    {:else if entry.isRootLabel}
      <button
        type="button"
        class="tree-entry dir root-label"
        class:expanded={expanded.has(entry.path)}
        data-root-path={entry.rootPath}
        style:padding-left="8px"
        onclick={() => toggleDir(entry.path)}
        oncontextmenu={(e) => showContextMenu(e, entry)}
      >
        <span class="chevron" aria-hidden="true">{expanded.has(entry.path) ? '▾' : '▸'}</span>
        {entry.name}
      </button>
    {:else if entry.isDir}
      {#if pendingRename?.path === entry.path}
        <!-- Inline rename for directory -->
        <div class="tree-entry dir" style:padding-left="{entry.depth * 12 + 8}px">
          <span class="chevron" aria-hidden="true">▸</span>
          <input
            bind:this={renameInputEl}
            class="inline-input"
            type="text"
            value={entry.name}
            onkeydown={handleRenameKeydown}
            onblur={() => { pendingRename = null }}
          />
        </div>
      {:else}
        <button
          type="button"
          class="tree-entry dir"
          class:expanded={expanded.has(entry.path)}
          style:padding-left="{entry.depth * 12 + 8}px"
          onclick={() => toggleDir(entry.path)}
          oncontextmenu={(e) => showContextMenu(e, entry)}
        >
          <span class="chevron" aria-hidden="true">{expanded.has(entry.path) ? '▾' : '▸'}</span>
          {entry.name}
          {#if loading.has(entry.path)}<span class="loading-dot" aria-hidden="true">…</span>{/if}
        </button>
      {/if}
    {:else}
      {#if pendingRename?.path === entry.path}
        <!-- Inline rename for file -->
        <div class="tree-entry file" style:padding-left="{entry.depth * 12 + 20}px">
          <input
            bind:this={renameInputEl}
            class="inline-input"
            type="text"
            value={entry.name}
            onkeydown={handleRenameKeydown}
            onblur={() => { pendingRename = null }}
          />
        </div>
      {:else}
        <button
          type="button"
          class="tree-entry file"
          class:selected={selectedPath === entry.path}
          style:padding-left="{entry.depth * 12 + 20}px"
          onclick={() => handleFileClick(entry.path)}
          oncontextmenu={(e) => showContextMenu(e, entry)}
        >
          {entry.name}
        </button>
      {/if}
    {/if}
  {/each}
</div>

<!-- Context menu overlay + popup -->
{#if contextMenu}
  <div
    class="ctx-overlay"
    role="presentation"
    onclick={(e) => { e.stopPropagation(); dismissContextMenu() }}
    oncontextmenu={(e) => { e.preventDefault(); dismissContextMenu() }}
  ></div>
  <div
    class="ctx-menu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
    role="menu"
  >
    {#if contextMenu.entry.isDir}
      <button
        class="ctx-item"
        role="menuitem"
        onclick={() => startNewFile(contextMenu!.entry.path)}
      >New File</button>
      <button
        class="ctx-item"
        role="menuitem"
        onclick={() => startNewDir(contextMenu!.entry.path)}
      >New Folder</button>
      {#if !contextMenu.entry.isRootLabel}
        <div class="ctx-sep"></div>
        <button
          class="ctx-item"
          role="menuitem"
          onclick={() => startRename(contextMenu!.entry)}
        >Rename</button>
        <div class="ctx-sep"></div>
        <button
          class="ctx-item danger"
          role="menuitem"
          onclick={() => handleDelete(contextMenu!.entry)}
        >Delete</button>
      {/if}
    {:else}
      <button
        class="ctx-item"
        role="menuitem"
        onclick={() => {
          const parent = contextMenu!.entry.path.substring(0, contextMenu!.entry.path.lastIndexOf('/'))
          void startNewFile(parent)
        }}
      >New File Here</button>
      <div class="ctx-sep"></div>
      <button
        class="ctx-item"
        role="menuitem"
        onclick={() => startRename(contextMenu!.entry)}
      >Rename</button>
      <div class="ctx-sep"></div>
      <button
        class="ctx-item danger"
        role="menuitem"
        onclick={() => handleDelete(contextMenu!.entry)}
      >Delete</button>
    {/if}
  </div>
{/if}

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

  /* Inline input rows */
  .pending-input {
    cursor: default;
  }
  .pending-input:hover {
    background: none;
  }
  .type-icon {
    font-size: 0.65rem;
    width: 10px;
    flex-shrink: 0;
    color: var(--fg-3);
  }
  .inline-input {
    flex: 1;
    min-width: 0;
    background: var(--bg-3, #2a2a3a);
    border: 1px solid var(--accent);
    border-radius: 2px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 1px 4px;
    outline: none;
  }

  /* Context menu */
  .ctx-overlay {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ctx-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 0;
    min-width: 148px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    font-family: var(--font-ui);
    font-size: 0.8rem;
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 5px 14px;
    background: none;
    border: none;
    color: var(--fg-1);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .ctx-item:hover {
    background: var(--bg-3, #2a2a3a);
    color: var(--fg-0);
  }
  .ctx-item.danger:hover {
    background: color-mix(in srgb, #ef4444 18%, transparent);
    color: #f87171;
  }
  .ctx-sep {
    height: 1px;
    background: var(--border);
    margin: 3px 0;
  }
</style>
