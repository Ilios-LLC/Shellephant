<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { AssistedMessage, TimelineEvent } from '../types'
  import { isTimelineMetadata } from '../types'
  import TimelineEventView from './TimelineEvent.svelte'

  interface Props {
    windowId: number
    containerId: string
  }

  let { windowId, containerId }: Props = $props()

  interface DisplayMessage {
    id: number
    role: 'user' | 'assistant' | 'tool_result' | 'tool_call' | 'ping_user'
    content: string
    metadata: string | null
    events?: TimelineEvent[]
    streaming?: boolean
    expanded?: boolean
  }

  let messages = $state<DisplayMessage[]>([])
  let input = $state('')
  let running = $state(false)
  let lastStats = $state<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null)
  let pingActive = $state(false)

  function hydrateEvents(metadata: string | null): TimelineEvent[] | undefined {
    if (!metadata) return undefined
    try {
      const parsed: unknown = JSON.parse(metadata)
      if (!isTimelineMetadata(parsed)) return undefined
      // Apply the same noise/dedup filtering used on live stream, so older rows
      // that were persisted before the filter tightened still render cleanly.
      const out: TimelineEvent[] = []
      for (const ev of parsed.events) {
        if (shouldDropEvent(ev, out[out.length - 1])) continue
        out.push(ev)
      }
      return out
    } catch {
      return undefined
    }
  }

  function shouldDropEvent(event: TimelineEvent, prev: TimelineEvent | undefined): boolean {
    // Session startup noise — parser already drops these at source, this is defence-in-depth
    // for legacy rows that were persisted with session_init / successful hook events.
    if (event.kind === 'session_init') return true
    if (event.kind === 'hook' && event.status !== 'failed') return true
    // Successful `result` echoes the preceding assistant_text; drop to avoid duplication.
    if (event.kind === 'result' && !event.isError && prev?.kind === 'assistant_text' && prev.text === event.text) return true
    return false
  }

  // Guards against stale IPC callbacks mutating state after the component unmounts
  // (e.g. a late event from docker exec arriving after the user switched windows).
  let mountActive = true

  // Monotonic counter for synthesized message ids during a single turn. Replaces
  // Date.now() which can collide when stream events fire within the same millisecond,
  // causing Svelte's keyed #each to reuse the wrong DOM node and skip updates.
  let syntheticIdSeq = 0
  function nextId(): number {
    syntheticIdSeq += 1
    return Date.now() * 1000 + (syntheticIdSeq % 1000)
  }

  onMount(() => {
    // Clear any stale listeners from a prior mount (defensive — removeAllListeners in
    // onDestroy should already handle this, but a race during {#key} teardown can leak).
    window.api.offAssistedStreamEvent()
    window.api.offAssistedKimiDelta()
    window.api.offAssistedToolCall()
    window.api.offAssistedPingUser()
    window.api.offAssistedTurnComplete()

    // Register IPC listeners synchronously — do NOT wait for the history fetch. Events
    // that arrive during the history await would otherwise be lost.
    window.api.onAssistedStreamEvent((wid: number, event: TimelineEvent) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      const prevEvents = last?.role === 'tool_result' && last.streaming ? last.events : undefined
      if (shouldDropEvent(event, prevEvents?.[prevEvents.length - 1])) return

      if (last?.role === 'tool_result' && last.streaming) {
        messages[messages.length - 1] = { ...last, events: [...(last.events ?? []), event] }
      } else {
        messages = [
          ...messages,
          { id: nextId(), role: 'tool_result', content: '', metadata: null, events: [event], streaming: true, expanded: false }
        ]
      }
    })

    window.api.onAssistedKimiDelta((wid: number, delta: string) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta }
      } else {
        messages = [...messages, { id: nextId(), role: 'assistant', content: delta, metadata: null, streaming: true }]
      }
    })

    window.api.onAssistedToolCall((wid: number, toolName: string, message: string) => {
      if (!mountActive || wid !== windowId) return
      messages = [...messages, { id: nextId(), role: 'tool_call', content: message, metadata: JSON.stringify({ tool_name: toolName }) }]
    })

    window.api.onAssistedPingUser((wid: number, message: string) => {
      if (!mountActive || wid !== windowId) return
      messages = [...messages, { id: nextId(), role: 'ping_user', content: message, metadata: null }]
      pingActive = true
    })

    window.api.onAssistedTurnComplete((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => {
      if (!mountActive || wid !== windowId) return
      running = false
      lastStats = stats
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (error) {
        messages = [...messages, { id: nextId(), role: 'assistant', content: `Error: ${error}`, metadata: JSON.stringify({ error: true }) }]
      }
    })

    // Load history after listeners are in place. If stream events arrived while we
    // awaited, they've already been pushed onto `messages`; prepend history in front
    // of any streaming items rather than overwriting them.
    void (async () => {
      const history = await window.api.assistedHistory(windowId)
      if (!mountActive) return
      const historyItems = history.map((m: AssistedMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        events: m.role === 'tool_result' ? hydrateEvents(m.metadata) : undefined,
        expanded: false
      }))
      // Any messages already in state are synthetic (from live stream). Keep them after history.
      const liveItems = messages.filter(m => !historyItems.some(h => h.id === m.id))
      messages = [...historyItems, ...liveItems]
    })()
  })

  onDestroy(() => {
    mountActive = false
    window.api.offAssistedStreamEvent()
    window.api.offAssistedKimiDelta()
    window.api.offAssistedToolCall()
    window.api.offAssistedPingUser()
    window.api.offAssistedTurnComplete()
  })

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: nextId(), role: 'user', content: trimmed, metadata: null }]
    await window.api.assistedSend(windowId, trimmed)
  }

  async function handleCancel(): Promise<void> {
    if (!confirm('Cancel current run? Conversation will be preserved.')) return
    await window.api.assistedCancel(windowId)
    running = false
    pingActive = false
    messages = messages.map(m => ({ ...m, streaming: false }))
  }

  async function handlePingReply(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed) return
    input = ''
    pingActive = false
    running = true
    messages = [...messages, { id: nextId(), role: 'user', content: trimmed, metadata: null }]
    await window.api.assistedResume(windowId, trimmed)
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (pingActive) handlePingReply()
      else send()
    }
  }

  // Auto-scroll: stick to the bottom while streaming, but back off if the user
  // has scrolled up to read history. Re-engages as soon as they return to bottom.
  let messagesEl: HTMLDivElement | null = $state(null)
  let stickToBottom = $state(true)
  const NEAR_BOTTOM_PX = 40

  function onMessagesScroll(): void {
    if (!messagesEl) return
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop
    stickToBottom = distanceFromBottom <= NEAR_BOTTOM_PX
  }

  $effect(() => {
    // Track anything that changes as content streams in or new messages arrive.
    const count = messages.length
    const last = messages[count - 1]
    const eventsLen = last?.events?.length ?? 0
    const contentLen = last?.content?.length ?? 0
    void count; void eventsLen; void contentLen

    if (!stickToBottom || !messagesEl) return
    const el = messagesEl
    // Wait for Svelte to paint the new DOM before measuring scrollHeight.
    queueMicrotask(() => { el.scrollTop = el.scrollHeight })
  })

  function toggleExpand(id: number): void {
    messages = messages.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m)
  }
</script>

<div class="assisted-panel">
  <div class="messages" bind:this={messagesEl} onscroll={onMessagesScroll}>
    {#each messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user">{msg.content}</div>
      {:else if msg.role === 'assistant'}
        <div class="msg assistant">
          <div class="assistant-tag">Kimi</div>
          <div class="assistant-content">{msg.content}</div>
        </div>
      {:else if msg.role === 'tool_call'}
        <div class="msg tool-call">
          <span class="tool-call-tag">@claude-code</span> {msg.content}
        </div>
      {:else if msg.role === 'tool_result'}
        <div class="msg tool-result">
          {#if msg.events && msg.events.length}
            <div class="timeline" class:streaming={msg.streaming}>
              {#if msg.streaming}
                <div class="timeline-header">Claude Code · running…</div>
              {/if}
              {#each msg.events as ev, idx (ev.ts + '-' + idx)}
                <TimelineEventView event={ev} />
              {/each}
            </div>
          {:else}
            <button class="expand-toggle" onclick={() => toggleExpand(msg.id)} type="button">
              {msg.expanded ? '▾' : '▸'} Claude Code output {msg.streaming ? '(running…)' : ''}
            </button>
            {#if msg.expanded}
              <pre class="tool-output">{msg.content}</pre>
            {/if}
          {/if}
        </div>
      {:else if msg.role === 'ping_user'}
        <div class="msg ping-user" role="alert">{msg.content}</div>
      {/if}
    {/each}
  </div>

  {#if lastStats}
    <div class="stats-bar">
      ↑ {lastStats.inputTokens.toLocaleString()} tokens
      ↓ {lastStats.outputTokens.toLocaleString()} tokens
      ~${lastStats.costUsd.toFixed(3)}
    </div>
  {/if}

  <div class="input-row">
    <textarea
      placeholder={pingActive ? 'Reply to Kimi…' : 'Ask Kimi…'}
      bind:value={input}
      disabled={running && !pingActive}
      onkeydown={handleKey}
      rows={2}
    ></textarea>
    <div class="input-actions">
      {#if running && !pingActive}
        <button type="button" class="cancel-btn" onclick={handleCancel} aria-label="Cancel">Cancel</button>
      {:else}
        <button type="button" class="send-btn" onclick={pingActive ? handlePingReply : send} disabled={!input.trim()} aria-label="Send">
          Send
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .assisted-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
    overflow: hidden;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .msg {
    max-width: 85%;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .msg.user {
    align-self: flex-end;
    background: var(--accent);
    color: white;
  }

  .msg.assistant {
    align-self: stretch;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: var(--fg-0);
    max-width: 100%;
  }

  .assistant-tag {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: rgb(96, 165, 250);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .assistant-content {
    white-space: pre-wrap;
  }

  .msg.tool-call {
    align-self: stretch;
    background: rgba(139, 92, 246, 0.08);
    border: 1px solid rgba(139, 92, 246, 0.35);
    color: var(--fg-0);
    max-width: 100%;
    font-size: 0.8rem;
  }

  .tool-call-tag {
    font-family: var(--font-mono);
    color: rgb(167, 139, 250);
    font-weight: 600;
    margin-right: 0.35rem;
  }

  .msg.tool-result {
    align-self: stretch;
    background: var(--bg-1);
    border: 1px solid var(--border);
    max-width: 100%;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .timeline-header {
    font-size: 0.72rem;
    color: var(--fg-2);
    font-family: var(--font-mono);
    margin-bottom: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .timeline.streaming .timeline-header::after {
    content: ' ·';
    animation: blink 1s steps(1) infinite;
  }

  @keyframes blink {
    50% { opacity: 0.3; }
  }

  .msg.ping-user {
    align-self: stretch;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgb(245, 158, 11);
    color: var(--fg-0);
    max-width: 100%;
  }

  .expand-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--fg-2);
    padding: 0;
    text-align: left;
    width: 100%;
  }

  .expand-toggle:hover { color: var(--fg-0); }

  .tool-output {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
  }

  .stats-bar {
    padding: 0.3rem 0.75rem;
    font-size: 0.72rem;
    color: var(--fg-2);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
  }

  textarea {
    flex: 1;
    resize: none;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    outline: none;
  }

  textarea:focus { border-color: var(--accent); }
  textarea:disabled { opacity: 0.5; }

  .input-actions {
    display: flex;
    align-items: flex-end;
  }

  .send-btn, .cancel-btn {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid;
    cursor: pointer;
  }

  .send-btn {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .cancel-btn {
    background: transparent;
    border-color: var(--danger);
    color: var(--danger);
  }

  .cancel-btn:hover {
    background: var(--danger);
    color: white;
  }
</style>
