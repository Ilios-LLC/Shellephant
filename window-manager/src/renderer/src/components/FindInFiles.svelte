<script lang="ts">
  import { onDestroy } from 'svelte'

  interface Props {
    containerId: string
    rootPath: string
    onOpenFile: (path: string, line: number) => void
  }

  interface GrepMatch {
    line: number
    text: string
  }

  interface GrepGroup {
    path: string
    matches: GrepMatch[]
  }

  let { containerId, rootPath, onOpenFile }: Props = $props()

  let query = $state('')
  let glob = $state('*')
  let loading = $state(false)
  let results = $state<GrepGroup[]>([])
  let error = $state('')
  let searched = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function parseGrepOutput(stdout: string): GrepGroup[] {
    const groups = new Map<string, GrepMatch[]>()
    for (const raw of stdout.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const firstColon = line.indexOf(':')
      if (firstColon === -1) continue
      const secondColon = line.indexOf(':', firstColon + 1)
      if (secondColon === -1) continue
      const path = line.slice(0, firstColon)
      const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10)
      const text = line.slice(secondColon + 1)
      if (isNaN(lineNum)) continue
      if (!groups.has(path)) groups.set(path, [])
      groups.get(path)!.push({ line: lineNum, text })
    }
    return Array.from(groups.entries()).map(([path, matches]) => ({ path, matches }))
  }

  async function runSearch(q: string): Promise<void> {
    if (!q.trim()) {
      results = []
      searched = false
      return
    }
    loading = true
    error = ''
    searched = true
    try {
      const cmd = [
        'grep', '-rn', '--color=never',
        '--exclude-dir=node_modules', '--exclude-dir=.git',
        '--exclude-dir=.venv', '--exclude-dir=dist', '--exclude-dir=build',
        ...(glob && glob !== '*' ? [`--include=${glob}`] : []),
        q, rootPath
      ]
      const result = await window.api.execInContainer(containerId, cmd)
      results = parseGrepOutput(result.stdout)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      results = []
    } finally {
      loading = false
    }
  }

  function handleInput(): void {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void runSearch(query), 400)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer)
      void runSearch(query)
    }
  }

  onDestroy(() => clearTimeout(debounceTimer))
</script>

<div class="find-in-files">
  <div class="inputs">
    <input
      class="query-input"
      type="text"
      placeholder="Search..."
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      aria-label="search query"
    />
    <input
      class="glob-input"
      type="text"
      placeholder="*.ts"
      bind:value={glob}
      oninput={handleInput}
      aria-label="file filter"
    />
  </div>

  <div class="results">
    {#if loading}
      <div class="state-msg">Searching…</div>
    {:else if error}
      <div class="state-msg error">{error}</div>
    {:else if searched && results.length === 0}
      <div class="state-msg">No results for "{query}"</div>
    {:else if !searched}
      <div class="state-msg hint">Type to search</div>
    {:else}
      {#each results as group (group.path)}
        <div class="file-group">
          <div class="file-path">
            {group.path} ({group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'})
          </div>
          {#each group.matches as match (match.line)}
            <button
              type="button"
              class="match-line"
              aria-label="line {match.line}"
              onclick={() => onOpenFile(group.path, match.line)}
            >
              <span class="line-num">{match.line}</span>
              <span class="line-text">{match.text}</span>
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .find-in-files {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .inputs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .query-input,
  .glob-input {
    background: var(--bg-0);
    border: 1px solid var(--border);
    color: var(--fg-0);
    padding: 0.25rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    border-radius: 3px;
    width: 100%;
    box-sizing: border-box;
  }

  .glob-input { font-size: 0.7rem; color: var(--fg-2); }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .state-msg {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--fg-2);
    font-family: var(--font-mono);
  }

  .state-msg.error { color: #ff6b6b; }

  .file-group { margin-bottom: 0.5rem; }

  .file-path {
    padding: 0.2rem 0.75rem;
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-line {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0.1rem 0.75rem 0.1rem 1.25rem;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-0);
  }

  .match-line:hover { background: var(--bg-1); }

  .line-num {
    color: var(--fg-2);
    flex-shrink: 0;
    min-width: 2rem;
  }

  .line-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
