<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { AssistedMessage } from '../types'

  interface Props {
    windowId: number
    containerId: string
  }

  let { windowId, containerId }: Props = $props()

  interface DisplayMessage {
    id: number
    role: 'user' | 'assistant' | 'tool_result' | 'ping_user'
    content: string
    metadata: string | null
    streaming?: boolean
    expanded?: boolean
  }

  let messages = $state<DisplayMessage[]>([])
  let input = $state('')
  let running = $state(false)
  let lastStats = $state<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null)
  let pingActive = $state(false)

  onMount(async () => {
    const history = await window.api.assistedHistory(windowId)
    messages = history.map((m: AssistedMessage) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      expanded: false
    }))

    window.api.onAssistedStreamChunk((wid: number, chunk: string) => {
      if (wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'tool_result' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      } else {
        messages = [...messages, { id: Date.now(), role: 'tool_result', content: chunk, metadata: null, streaming: true, expanded: true }]
      }
    })

    window.api.onAssistedKimiDelta((wid: number, delta: string) => {
      if (wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta }
      } else {
        messages = [...messages, { id: Date.now(), role: 'assistant', content: delta, metadata: null, streaming: true }]
      }
    })

    window.api.onAssistedPingUser((wid: number, message: string) => {
      if (wid !== windowId) return
      messages = [...messages, { id: Date.now(), role: 'ping_user', content: message, metadata: null }]
      pingActive = true
    })

    window.api.onAssistedTurnComplete((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => {
      if (wid !== windowId) return
      running = false
      pingActive = false
      lastStats = stats
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (error) {
        messages = [...messages, { id: Date.now(), role: 'assistant', content: `Error: ${error}`, metadata: JSON.stringify({ error: true }) }]
      }
    })
  })

  onDestroy(() => {
    window.api.offAssistedStreamChunk()
    window.api.offAssistedKimiDelta()
    window.api.offAssistedPingUser()
    window.api.offAssistedTurnComplete()
  })

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: Date.now(), role: 'user', content: trimmed, metadata: null }]
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
    messages = [...messages, { id: Date.now(), role: 'user', content: trimmed, metadata: null }]
    await window.api.assistedResume(windowId, trimmed)
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (pingActive) handlePingReply()
      else send()
    }
  }

  function toggleExpand(id: number): void {
    messages = messages.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m)
  }
</script>

<div class="assisted-panel">
  <div class="messages">
    {#each messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user">{msg.content}</div>
      {:else if msg.role === 'assistant'}
        <div class="msg assistant">{msg.content}</div>
      {:else if msg.role === 'tool_result'}
        <div class="msg tool-result">
          <button class="expand-toggle" onclick={() => toggleExpand(msg.id)} type="button">
            {msg.expanded ? '▾' : '▸'} Claude Code output {msg.streaming ? '(running…)' : ''}
          </button>
          {#if msg.expanded}
            <pre class="tool-output">{msg.content}</pre>
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
      ~${lastStats.costUsd.toFixed(4)}
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
    align-self: flex-start;
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--fg-0);
  }

  .msg.tool-result {
    align-self: stretch;
    background: var(--bg-1);
    border: 1px solid var(--border);
    max-width: 100%;
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
