<script lang="ts">
  import type { TimelineEvent } from '../../../shared/timelineEvent'

  interface Props {
    event: TimelineEvent
  }

  let { event }: Props = $props()
  let expanded = $state(false)

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    const kb = n / 1024
    if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} kB`
    return `${(kb / 1024).toFixed(1)} MB`
  }
</script>

{#if event.kind === 'session_init'}
  <div class="tl-row muted">
    <span class="tl-dot">●</span>
    session {event.model}{event.sessionId ? ` · ${event.sessionId.slice(0, 8)}` : ''}
  </div>

{:else if event.kind === 'hook'}
  <div class="tl-row hook hook-{event.status}">
    <span class="tl-dot">⚙</span>
    {event.name}
    {#if event.status === 'failed'}
      <span class="muted">· failed{event.exitCode !== undefined ? ` (${event.exitCode})` : ''}</span>
    {:else if event.status === 'started'}
      <span class="muted">· started</span>
    {:else}
      <span class="muted">· ok</span>
    {/if}
  </div>

{:else if event.kind === 'thinking'}
  <div class="tl-row thinking">
    <button class="tl-badge" type="button" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
      <span class="tl-dot">🧠</span>
      {expanded ? '▾' : '▸'} thinking
    </button>
    {#if expanded}
      <pre class="tl-detail">{event.text}</pre>
    {/if}
  </div>

{:else if event.kind === 'assistant_text'}
  <div class="tl-row assistant-text">{event.text}</div>

{:else if event.kind === 'text_delta'}
  <div class="tl-row assistant-text streaming">{event.text}<span class="tl-cursor">▍</span></div>

{:else if event.kind === 'tool_use_start'}
  <div class="tl-row tool-use streaming">
    <span class="tl-badge">
      <span class="tl-dot pulse">🔧</span>
      <strong>{event.name}</strong>(<span class="muted">…</span>)
      <span class="muted">· starting</span>
    </span>
  </div>

{:else if event.kind === 'tool_use_progress'}
  <div class="tl-row tool-use streaming">
    <span class="tl-badge">
      <span class="tl-dot pulse">🔧</span>
      <strong>{event.name}</strong>(<span class="muted">{event.summary || '…'}</span>)
      <span class="muted">· {formatBytes(event.bytesSeen)}</span>
    </span>
  </div>

{:else if event.kind === 'tool_use'}
  <div class="tl-row tool-use">
    <button class="tl-badge" type="button" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
      <span class="tl-dot">🔧</span>
      {expanded ? '▾' : '▸'} <strong>{event.name}</strong>(<span class="muted">{event.summary}</span>)
    </button>
    {#if expanded}
      <pre class="tl-detail">{JSON.stringify(event.input, null, 2)}</pre>
    {/if}
  </div>

{:else if event.kind === 'tool_result'}
  <div class="tl-row tool-result" class:error={event.isError}>
    <button class="tl-badge" type="button" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
      <span class="tl-dot">{event.isError ? '⛔' : '✓'}</span>
      {expanded ? '▾' : '▸'} result
      {#if !expanded}
        <span class="tl-preview">{event.text.split('\n')[0]}</span>
      {/if}
    </button>
    {#if expanded}
      <pre class="tl-detail">{event.text}</pre>
    {/if}
  </div>

{:else if event.kind === 'result'}
  <div class="tl-row result" class:error={event.isError}>
    <span class="tl-dot">{event.isError ? '⛔' : '💬'}</span>
    {event.text}
  </div>
{/if}

<style>
  .tl-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.82rem;
    line-height: 1.45;
    padding: 0.25rem 0.1rem;
  }

  .tl-dot {
    display: inline-block;
    width: 1.1em;
    text-align: center;
    margin-right: 0.25rem;
  }

  .muted {
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  .tl-badge {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    color: var(--fg-0);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .tl-badge:hover { color: var(--fg-0); filter: brightness(1.15); }

  .tl-preview {
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    margin-left: 0.35rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40ch;
  }

  .tl-detail {
    margin: 0.25rem 0 0 1.35rem;
    padding: 0.4rem 0.55rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
  }

  .tl-detail.clipped {
    max-height: 9em;
    overflow: hidden;
  }

  .tl-row.muted { color: var(--fg-2); font-size: 0.78rem; }

  .hook-started { color: var(--fg-2); }
  .hook-failed { color: var(--danger, #f87171); }

  .tl-row.assistant-text {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.45rem 0.65rem;
    white-space: pre-wrap;
  }

  .tl-row.result {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.35);
    border-radius: 6px;
    padding: 0.45rem 0.65rem;
    white-space: pre-wrap;
    font-weight: 500;
  }

  .tl-row.result.error,
  .tl-row.tool-result.error {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.35);
  }

  .tool-use strong { font-weight: 600; }

  .tl-row.streaming { opacity: 0.9; }

  .tl-cursor {
    display: inline-block;
    margin-left: 0.15em;
    color: var(--fg-2);
    animation: tl-cursor-blink 1s steps(2, start) infinite;
  }

  @keyframes tl-cursor-blink {
    to { visibility: hidden; }
  }

  .tl-dot.pulse {
    animation: tl-pulse 1.2s ease-in-out infinite;
  }

  @keyframes tl-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
</style>
