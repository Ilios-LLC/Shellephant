<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  interface Props {
    windowId: number
    containerId: string
  }

  let { windowId, containerId }: Props = $props()

  type Recipient = 'claude' | 'shellephant'

  interface DisplayMessage {
    id: number
    role: 'user' | 'shellephant' | 'claude' | 'claude-action'
    content: string
    metadata: string | null
    streaming?: boolean
    expanded?: boolean
  }

  let messages = $state<DisplayMessage[]>([])
  let input = $state('')
  let running = $state(false)
  let lastStats = $state<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null)
  let currentRecipient = $state<Recipient>('claude')
  let fireworksConfigured = $state(false)

  let mountActive = true
  let syntheticIdSeq = 0
  function nextId(): number {
    syntheticIdSeq += 1
    return Date.now() * 1000 + (syntheticIdSeq % 1000)
  }

  function mapLegacyRole(role: string): DisplayMessage['role'] | null {
    switch (role) {
      case 'user': return 'user'
      case 'shellephant': return 'shellephant'
      case 'assistant': return 'shellephant'
      case 'claude': return 'claude'
      case 'claude-action': return 'claude-action'
      case 'tool_result': return 'claude'
      default: return null
    }
  }

  onMount(() => {
    void window.api.getFireworksKeyStatus().then((s: { configured: boolean }) => {
      if (!mountActive) return
      fireworksConfigured = s.configured
    })

    window.api.offAssistedKimiDelta?.()
    window.api.offAssistedTurnComplete?.()
    window.api.offClaudeDelta?.()
    window.api.offClaudeAction?.()
    window.api.offClaudeTurnComplete?.()

    window.api.onAssistedKimiDelta((wid: number, delta: string) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'shellephant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta }
      } else {
        messages = [...messages, { id: nextId(), role: 'shellephant', content: delta, metadata: null, streaming: true }]
      }
    })

    window.api.onAssistedTurnComplete((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => {
      if (!mountActive || wid !== windowId) return
      if (currentRecipient === 'shellephant') {
        running = false
        lastStats = stats
      }
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (error) {
        messages = [...messages, { id: nextId(), role: 'shellephant', content: `Error: ${error}`, metadata: null }]
      }
    })

    window.api.onClaudeDelta((wid: number, chunk: string) => {
      if (!mountActive || wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'claude' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      } else {
        messages = [...messages, { id: nextId(), role: 'claude', content: chunk, metadata: null, streaming: true }]
      }
    })

    window.api.onClaudeAction((wid: number, action: { actionType: string; summary: string; detail: string }) => {
      if (!mountActive || wid !== windowId) return
      messages = [...messages, {
        id: nextId(),
        role: 'claude-action',
        content: '',
        metadata: JSON.stringify(action),
        expanded: false
      }]
    })

    window.api.onClaudeTurnComplete((wid: number) => {
      if (!mountActive || wid !== windowId) return
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (currentRecipient === 'claude') {
        running = false
      }
    })

    void (async () => {
      const history = await window.api.assistedHistory(windowId)
      if (!mountActive) return
      const historyItems: DisplayMessage[] = []
      for (const m of history as Array<{ id: number; role: string; content: string; metadata: string | null }>) {
        const role = mapLegacyRole(m.role)
        if (!role) continue
        historyItems.push({ id: m.id, role, content: m.content, metadata: m.metadata, expanded: false })
      }
      const liveItems = messages.filter(m => !historyItems.some(h => h.id === m.id))
      messages = [...historyItems, ...liveItems]
    })()
  })

  onDestroy(() => {
    mountActive = false
    window.api.offAssistedKimiDelta?.()
    window.api.offAssistedTurnComplete?.()
    window.api.offClaudeDelta?.()
    window.api.offClaudeAction?.()
    window.api.offClaudeTurnComplete?.()
  })

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: nextId(), role: 'user', content: trimmed, metadata: null }]
    if (currentRecipient === 'claude') {
      await window.api.claudeSend(windowId, trimmed)
    } else {
      await window.api.assistedSend(windowId, trimmed)
    }
  }

  async function handleCancel(): Promise<void> {
    if (!confirm('Cancel current run? Conversation will be preserved.')) return
    if (currentRecipient === 'claude') {
      await window.api.claudeCancel(windowId)
    } else {
      await window.api.assistedCancel(windowId)
    }
    running = false
    messages = messages.map(m => ({ ...m, streaming: false }))
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  function toggleExpand(id: number): void {
    messages = messages.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m)
  }

  function getActionLabel(metadata: string | null): string {
    if (!metadata) return 'action'
    try {
      const m = JSON.parse(metadata) as { actionType?: string; summary?: string }
      return `${m.actionType ?? 'action'}${m.summary ? ' \u2014 ' + m.summary : ''}`
    } catch {
      return 'action'
    }
  }

  function getActionDetail(metadata: string | null): string {
    if (!metadata) return ''
    try {
      const m = JSON.parse(metadata) as { detail?: string }
      return m.detail ?? ''
    } catch {
      return ''
    }
  }

  let messagesEl = $state<HTMLDivElement | null>(null)
  let stickToBottom = $state(true)
  const NEAR_BOTTOM_PX = 40

  function onMessagesScroll(): void {
    if (!messagesEl) return
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop
    stickToBottom = distanceFromBottom <= NEAR_BOTTOM_PX
  }

  $effect(() => {
    const count = messages.length
    const last = messages[count - 1]
    const contentLen = last?.content?.length ?? 0
    void count; void contentLen
    if (!stickToBottom || !messagesEl) return
    const el = messagesEl
    queueMicrotask(() => { el.scrollTop = el.scrollHeight })
  })
</script>

<div class="assisted-panel">
  <div class="messages" bind:this={messagesEl} onscroll={onMessagesScroll}>
    {#each messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user">{msg.content}</div>
      {:else if msg.role === 'shellephant'}
        <div class="msg sender-bubble shellephant">
          <div class="sender-tag">Shellephant</div>
          <div class="bubble-content">{msg.content}</div>
        </div>
      {:else if msg.role === 'claude'}
        <div class="msg sender-bubble claude">
          <div class="sender-tag">Claude</div>
          <div class="bubble-content">{msg.content}</div>
        </div>
      {:else if msg.role === 'claude-action'}
        <div class="msg claude-action">
          <button class="action-toggle" onclick={() => toggleExpand(msg.id)} type="button">
            {msg.expanded ? '▾' : '▸'} {getActionLabel(msg.metadata)}
          </button>
          {#if msg.expanded}
            <pre class="action-detail">{getActionDetail(msg.metadata)}</pre>
          {/if}
        </div>
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

  <div class="recipient-toggle">
    <label>
      <input type="radio" name="recipient-{windowId}" value="claude" bind:group={currentRecipient} />
      Claude
    </label>
    <label title={!fireworksConfigured ? 'Set Fireworks API key in Settings' : ''}>
      <input
        type="radio"
        name="recipient-{windowId}"
        value="shellephant"
        disabled={!fireworksConfigured}
        bind:group={currentRecipient}
      />
      Shellephant
    </label>
  </div>

  <div class="input-row">
    <textarea
      placeholder={currentRecipient === 'claude' ? 'Ask Claude…' : 'Ask Shellephant…'}
      bind:value={input}
      disabled={running}
      onkeydown={handleKey}
      rows={2}
    ></textarea>
    <div class="input-actions">
      {#if running}
        <button type="button" class="cancel-btn" onclick={handleCancel} aria-label="Cancel">Cancel</button>
      {:else}
        <button type="button" class="send-btn" onclick={send} disabled={!input.trim()} aria-label="Send">
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

  .sender-bubble {
    align-self: stretch;
    max-width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .sender-bubble.shellephant {
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: var(--fg-0);
  }

  .sender-bubble.claude {
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: var(--fg-0);
  }

  .sender-tag {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .shellephant .sender-tag { color: rgb(96, 165, 250); }
  .claude .sender-tag { color: rgb(52, 211, 153); }

  .bubble-content { white-space: pre-wrap; }

  .claude-action {
    align-self: stretch;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
  }

  .action-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--fg-2);
    padding: 0;
    text-align: left;
    width: 100%;
    font-family: var(--font-mono);
  }

  .action-toggle:hover { color: var(--fg-0); }

  .action-detail {
    margin: 0.4rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
  }

  .stats-bar {
    padding: 0.3rem 0.75rem;
    font-size: 0.72rem;
    color: var(--fg-2);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
  }

  .recipient-toggle {
    display: flex;
    gap: 1rem;
    padding: 0.35rem 0.75rem;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
  }

  .recipient-toggle label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    color: var(--fg-1);
  }

  .recipient-toggle label:has(input:checked) { color: var(--fg-0); }
  .recipient-toggle label:has(input:disabled) { opacity: 0.4; cursor: not-allowed; }

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
