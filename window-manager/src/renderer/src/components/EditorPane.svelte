<script lang="ts">
  import FileTree from './FileTree.svelte'
  import MonacoEditor from './MonacoEditor.svelte'
  import TabBar from './TabBar.svelte'
  import StatusBar from './StatusBar.svelte'
  import FindInFiles from './FindInFiles.svelte'

  interface RootConfig {
    rootPath: string
    label: string
  }

  interface Props {
    containerId: string
    roots: RootConfig[]
  }

  let { containerId, roots }: Props = $props()

  let fileTreeRef = $state(null as InstanceType<typeof FileTree> | null)
  let openTabs = $state<string[]>([])
  let activeTab = $state<string | null>(null)
  let dirtyTabs = $state(new Set<string>())
  let showFindInFiles = $state(false)
  let editorRef = $state<{ gotoLine: (n: number) => void } | null>(null)
  let status = $state({ line: 1, column: 1, language: '' })

  export function scrollToRoot(rootPath: string): void {
    fileTreeRef?.scrollToRoot(rootPath)
  }

  function openTab(path: string): void {
    if (!openTabs.includes(path)) {
      openTabs = [...openTabs, path]
    }
    activeTab = path
  }

  function closeTab(path: string): void {
    const idx = openTabs.indexOf(path)
    if (idx === -1) return
    const newTabs = openTabs.filter((t) => t !== path)
    openTabs = newTabs
    const next = new Set(dirtyTabs)
    next.delete(path)
    dirtyTabs = next
    if (activeTab === path) {
      activeTab = newTabs[idx] ?? newTabs[idx - 1] ?? null
    }
  }

  function handleDirtyChange(path: string, dirty: boolean): void {
    const next = new Set(dirtyTabs)
    if (dirty) next.add(path)
    else next.delete(path)
    dirtyTabs = next
  }

  function handleStatusChange(s: { line: number; column: number; language: string }): void {
    status = s
  }

  function handleOpenFile(path: string, line: number): void {
    openTab(path)
    setTimeout(() => editorRef?.gotoLine(line), 100)
  }

  function cycleTab(delta: 1 | -1): void {
    if (!activeTab || openTabs.length === 0) return
    const idx = openTabs.indexOf(activeTab)
    activeTab = openTabs[(idx + delta + openTabs.length) % openTabs.length]
  }
</script>

<div class="editor-pane">
  <div class="tree-panel">
    {#if showFindInFiles}
      <div class="panel-header">
        <span>Find in Files</span>
        <button
          class="header-btn"
          aria-label="close find"
          onclick={() => (showFindInFiles = false)}
        >✕</button>
      </div>
      <FindInFiles {containerId} rootPath={roots[0]?.rootPath ?? ''} onOpenFile={handleOpenFile} />
    {:else}
      <div class="panel-header">
        <span>Files</span>
        <button
          class="header-btn"
          aria-label="toggle find in files"
          onclick={() => (showFindInFiles = true)}
        >⌕</button>
      </div>
      <FileTree bind:this={fileTreeRef} {containerId} {roots} onFileSelect={openTab} />
    {/if}
  </div>

  <div class="editor-panel">
    <TabBar
      tabs={openTabs}
      {activeTab}
      {dirtyTabs}
      onActivate={(path) => (activeTab = path)}
      onClose={closeTab}
    />
    <div class="editor-body">
      {#if activeTab}
        <MonacoEditor
          {containerId}
          filePath={activeTab}
          tabDirty={dirtyTabs.has(activeTab)}
          onDirtyChange={handleDirtyChange}
          onStatusChange={handleStatusChange}
          onCloseTab={() => activeTab && closeTab(activeTab)}
          onCycleNext={() => cycleTab(1)}
          onCyclePrev={() => cycleTab(-1)}
          onToggleFind={() => (showFindInFiles = !showFindInFiles)}
          bind:ref={editorRef}
        />
      {:else}
        <div class="editor-default">
          <svg
            class="logo"
            viewBox="1500 1200 1700 1470"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="ele-purple-editor" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#d8b4fe" />
                <stop offset="50%" stop-color="#a855f7" />
                <stop offset="100%" stop-color="#5b21b6" />
              </linearGradient>
            </defs>
            <g transform="translate(4688 0) scale(-1 1)">
              <path
                fill="url(#ele-purple-editor)"
                fill-rule="evenodd"
                d="M 2937.660156 2054.851562 C 2937.660156 2207.878906 2849.660156 2344.238281 2716.210938 2408.941406 L 2716.210938 2250.351562 L 2459.25 2250.351562 C 2337.851562 2250.351562 2235.839844 2334.980469 2209.109375 2448.328125 L 1954.730469 2448.328125 L 1954.730469 2228.199219 C 2051.21875 2224.890625 2234.851562 2198.03125 2367.96875 2053.648438 C 2498.261719 1912.328125 2544.058594 1698.730469 2504.570312 1418.171875 L 2937.660156 1418.171875 Z M 1750.210938 1811.648438 C 1750.210938 1594.679688 1926.730469 1418.171875 2143.699219 1418.171875 L 2385.410156 1418.171875 C 2423.730469 1669.671875 2389 1856.179688 2281.921875 1972.949219 C 2137.941406 2129.96875 1903.820312 2109.730469 1901.628906 2109.539062 L 1836.769531 2103.03125 L 1836.769531 2448.328125 L 1750.210938 2448.328125 Z M 2992.289062 1300.210938 L 2143.699219 1300.210938 C 1861.691406 1300.210938 1632.261719 1529.640625 1632.261719 1811.648438 L 1632.261719 2502.960938 C 1632.261719 2537.878906 1660.671875 2566.289062 1695.589844 2566.289062 L 2320.238281 2566.289062 L 2320.238281 2507.308594 C 2320.238281 2430.660156 2382.601562 2368.300781 2459.25 2368.300781 L 2598.25 2368.300781 L 2598.25 2569.148438 L 2671.929688 2550.191406 C 2897.839844 2492.078125 3055.621094 2288.390625 3055.621094 2054.851562 L 3055.621094 1363.539062 C 3055.621094 1328.621094 3027.210938 1300.210938 2992.289062 1300.210938 Z"
              />
            </g>
            <circle cx="2660" cy="1640" r="60" fill="#ffffff" />
          </svg>
        </div>
      {/if}
    </div>
    <StatusBar
      line={status.line}
      column={status.column}
      language={status.language}
      isDirty={activeTab ? dirtyTabs.has(activeTab) : false}
    />
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .tree-panel {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .header-btn {
    background: none;
    border: none;
    color: var(--fg-2);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 0.8rem;
  }

  .editor-panel {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .editor-default {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
  }

  .logo {
    width: 120px;
    height: auto;
    filter: drop-shadow(0 8px 24px rgba(168, 85, 247, 0.25));
  }
</style>
