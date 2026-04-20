// Filter raw Claude Agent SDK stream-json events into three outputs:
//   display — short human-readable string (legacy fallback sink)
//   context — ultra-compact string fed back to Shellephant as tool_result
//   events  — typed TimelineEvent objects for the rich UI timeline
// A null display/context means "drop this event for that sink".

import type { TimelineEvent } from '../shared/timelineEvent'

export type FilteredEvent = {
  display: string | null
  context: string | null
  sessionId?: string | null
}

type Json = Record<string, unknown>


export function filterSdkLine(line: string): FilteredEvent {
  const trimmed = line.trim()
  if (!trimmed) return { display: null, context: null }

  let event: Json
  try {
    event = JSON.parse(trimmed) as Json
  } catch {
    return { display: trimmed, context: trimmed }
  }

  return filterSdkEvent(event)
}

export function filterSdkEvent(event: Json): FilteredEvent {
  const type = event.type as string | undefined
  const subtype = event.subtype as string | undefined

  if (type === 'system') return formatSystem(event, subtype)
  if (type === 'assistant') return formatAssistant(event)
  if (type === 'user') return formatUser(event)
  if (type === 'result') return formatResult(event)
  if (type === 'rate_limit_event') return { display: null, context: null }
  if (type === 'session_final') {
    const sid = event.session_id
    return { display: null, context: null, sessionId: typeof sid === 'string' && sid ? sid : null }
  }

  return { display: null, context: null }
}

export function parseSdkLine(line: string, ts: number = Date.now()): TimelineEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  try {
    return parseSdkEvent(JSON.parse(trimmed) as Json, ts)
  } catch {
    return []
  }
}

export function parseSdkEvent(event: Json, ts: number = Date.now()): TimelineEvent[] {
  const type = event.type as string | undefined
  const subtype = event.subtype as string | undefined

  if (type === 'system') return parseSystemEvent(event, subtype, ts)
  if (type === 'assistant') return parseAssistantEvent(event, ts)
  if (type === 'user') return parseUserEvent(event, ts)
  if (type === 'result') return parseResultEvent(event, ts)
  // stream_event is stateful and handled by StreamFilterBuffer; the module-level
  // parse is a no-op for it.
  return []
}

// How often (in ms of event ts) to emit a tool_use_progress for a single block
// while input_json_delta chunks stream in. Balances UI responsiveness against
// IPC chattiness for Write calls with multi-kB `content` arguments.
const TOOL_USE_PROGRESS_MIN_INTERVAL_MS = 100

type BlockState =
  | { type: 'text' | 'thinking'; index: number; buffer: string }
  | {
      type: 'tool_use'
      index: number
      id: string
      name: string
      buffer: string
      bytesSeen: number
      lastSummary: string
      lastEmitTs: number
    }

function firstTruthyString(input: Json, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = input[key]
    if (typeof val === 'string' && val) return val
  }
  return undefined
}

function tryExtractSummaryFromPartialJson(raw: string): string {
  // The model streams tool inputs as incrementally-valid JSON fragments. We
  // don't need the whole object — only the first recognisable identifier
  // (file_path, command, etc.). Try strict parse first (cheap), then a
  // permissive key-match fallback that handles half-finished JSON.
  const candidateKeys = ['file_path', 'path', 'pattern', 'command', 'url', 'prompt', 'description']
  try {
    const parsed = JSON.parse(raw) as Json
    const val = firstTruthyString(parsed, candidateKeys)
    if (val) return val
  } catch {
    /* fall through to regex scan */
  }
  for (const key of candidateKeys) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
    if (match && match[1]) return match[1]
  }
  return ''
}

function parseSystemEvent(event: Json, subtype: string | undefined, ts: number): TimelineEvent[] {
  // Session-startup noise (init, hook lifecycle on success) is filtered out entirely —
  // it clutters the timeline without adding signal. Only failed hooks surface.
  if (subtype === 'hook_response') {
    const exit = event.exit_code as number | undefined
    if (exit !== undefined && exit !== 0) {
      return [{ kind: 'hook', name: (event.hook_name as string) ?? 'hook', status: 'failed', exitCode: exit, ts }]
    }
  }
  return []
}

function parseAssistantEvent(event: Json, ts: number): TimelineEvent[] {
  const message = event.message as Json | undefined
  const content = message?.content as Json[] | undefined
  if (!Array.isArray(content)) return []

  const out: TimelineEvent[] = []
  for (const block of content) {
    const btype = block.type as string
    if (btype === 'thinking') {
      const text = (block.thinking as string) ?? ''
      out.push({ kind: 'thinking', text, ts })
      continue
    }
    if (btype === 'text') {
      const text = (block.text as string) ?? ''
      if (text) out.push({ kind: 'assistant_text', text, ts })
      continue
    }
    if (btype === 'tool_use') {
      const name = (block.name as string) ?? 'tool'
      const input = (block.input as Json) ?? {}
      out.push({
        kind: 'tool_use',
        id: (block.id as string) ?? '',
        name,
        input,
        summary: summarizeToolInput(name, input),
        ts
      })
      continue
    }
  }
  return out
}

function parseUserEvent(event: Json, ts: number): TimelineEvent[] {
  const message = event.message as Json | undefined
  const content = message?.content as Json[] | undefined
  if (!Array.isArray(content)) return []

  const out: TimelineEvent[] = []
  for (const block of content) {
    if (block.type !== 'tool_result') continue
    out.push({
      kind: 'tool_result',
      toolUseId: (block.tool_use_id as string) ?? '',
      text: extractToolResultText(block.content),
      isError: block.is_error === true,
      ts
    })
  }
  return out
}

function parseResultEvent(event: Json, ts: number): TimelineEvent[] {
  const text = (event.result as string) ?? ''
  if (!text) return []
  return [{ kind: 'result', text, isError: event.is_error === true, ts }]
}

function formatSystem(event: Json, subtype: string | undefined): FilteredEvent {
  if (subtype === 'init') {
    const model = (event.model as string) ?? 'unknown'
    return { display: `— session init (${model}) —`, context: null }
  }
  if (subtype === 'hook_started') {
    const name = (event.hook_name as string) ?? 'hook'
    return { display: `⚙ ${name} started`, context: null }
  }
  if (subtype === 'hook_response') {
    const name = (event.hook_name as string) ?? 'hook'
    const exit = event.exit_code as number | undefined
    if (exit !== undefined && exit !== 0) {
      return { display: `⚙ ${name} failed (${exit})`, context: `hook ${name} failed` }
    }
    return { display: `⚙ ${name} ok`, context: null }
  }
  if (subtype === 'task_started' || subtype === 'task_progress' || subtype === 'task_notification') {
    return { display: null, context: null }
  }
  return { display: null, context: null }
}

function formatAssistant(event: Json): FilteredEvent {
  const message = event.message as Json | undefined
  const content = message?.content as Json[] | undefined
  if (!Array.isArray(content)) return { display: null, context: null }

  const displayParts: string[] = []
  const contextParts: string[] = []

  for (const block of content) {
    const btype = block.type as string
    if (btype === 'thinking') {
      displayParts.push('🧠 (thinking)')
      continue
    }
    if (btype === 'text') {
      const text = (block.text as string) ?? ''
      if (text) {
        displayParts.push(text)
        contextParts.push(text)
      }
      continue
    }
    if (btype === 'tool_use') {
      const name = (block.name as string) ?? 'tool'
      const summary = summarizeToolInput(name, block.input as Json | undefined)
      displayParts.push(`🔧 ${name}(${summary})`)
      contextParts.push(`tool_use: ${name}(${summary})`)
      continue
    }
  }

  return {
    display: displayParts.length ? displayParts.join('\n') : null,
    context: contextParts.length ? contextParts.join('\n') : null
  }
}

function formatUser(event: Json): FilteredEvent {
  const message = event.message as Json | undefined
  const content = message?.content as Json[] | undefined
  if (!Array.isArray(content)) return { display: null, context: null }

  const displayParts: string[] = []
  const contextParts: string[] = []

  for (const block of content) {
    if (block.type !== 'tool_result') continue
    const isError = block.is_error === true
    const raw = extractToolResultText(block.content)
    const prefix = isError ? '⛔' : '✓'

    displayParts.push(`${prefix} ${raw}`)
    contextParts.push(`tool_result${isError ? '(error)' : ''}: ${raw}`)
  }

  return {
    display: displayParts.length ? displayParts.join('\n') : null,
    context: contextParts.length ? contextParts.join('\n') : null
  }
}

function formatResult(event: Json): FilteredEvent {
  const isError = event.is_error === true
  const result = (event.result as string) ?? ''
  if (!result) return { display: null, context: null }
  const prefix = isError ? '⛔ final' : '✓ final'
  return {
    display: `${prefix}: ${result}`,
    context: `final: ${result}`
  }
}

function summarizeToolInput(_name: string, input: Json | undefined): string {
  if (!input) return ''
  const keys = ['file_path', 'path', 'pattern', 'command', 'url', 'prompt', 'description']
  for (const key of keys) {
    const val = input[key]
    if (typeof val === 'string' && val) return val
  }
  const firstString = Object.values(input).find(v => typeof v === 'string') as string | undefined
  if (firstString) return firstString
  return Object.keys(input).join(',')
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && 'text' in block) {
      parts.push(String((block as { text: unknown }).text))
    }
  }
  return parts.join('\n')
}

// Line-buffered splitter. Each newline-terminated JSON line is parsed into
// { display, context, events }; partial trailing lines stay buffered until flush.
export type StreamFilterDrain = {
  displayChunks: string[]
  contextChunks: string[]
  events: TimelineEvent[]
  sessionId: string | null
}

export class StreamFilterBuffer {
  private buffer = ''
  // Per-content-block scratch state for stream_event partials. Keyed by the
  // block `index` the SDK emits on content_block_* events. Cleared on
  // content_block_stop. Not shared across sessions — each `new` session starts
  // a fresh filter instance.
  private blocks = new Map<number, BlockState>()
  private streamSessionId: string | null = null

  private processLine(line: string, ts: number): {
    events: TimelineEvent[]
    filtered: FilteredEvent
  } {
    const filtered = filterSdkLine(line)
    const events: TimelineEvent[] = parseSdkLine(line, ts)

    const trimmed = line.trim()
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as Json
        if ((parsed.type as string | undefined) === 'stream_event') {
          if (typeof parsed.session_id === 'string') this.streamSessionId = parsed.session_id
          events.push(...this.processStreamEvent(parsed.event as Json | undefined, ts))
        }
      } catch {
        /* filterSdkLine already handled the unparseable case */
      }
    }

    return { events, filtered }
  }

  private processStreamEvent(event: Json | undefined, ts: number): TimelineEvent[] {
    if (!event || typeof event !== 'object') return []
    const type = event.type as string | undefined
    if (type === 'content_block_start') return this.onContentBlockStart(event, ts)
    if (type === 'content_block_delta') return this.onContentBlockDelta(event, ts)
    if (type === 'content_block_stop') return this.onContentBlockStop(event)
    // message_start / message_delta / message_stop carry no user-facing signal
    // beyond what the terminal `assistant` event already provides.
    return []
  }

  private onContentBlockStart(event: Json, ts: number): TimelineEvent[] {
    const index = event.index as number | undefined
    if (typeof index !== 'number') return []
    const block = event.content_block as Json | undefined
    const blockType = block?.type as string | undefined

    if (blockType === 'tool_use') {
      const id = (block?.id as string) ?? ''
      const name = (block?.name as string) ?? 'tool'
      this.blocks.set(index, {
        type: 'tool_use',
        index,
        id,
        name,
        buffer: '',
        bytesSeen: 0,
        lastSummary: '',
        // Sentinel: guarantees the first input_json_delta emits regardless of
        // how close in ts it arrives to content_block_start.
        lastEmitTs: Number.NEGATIVE_INFINITY
      })
      return [{ kind: 'tool_use_start', id, name, ts }]
    }

    if (blockType === 'text' || blockType === 'thinking') {
      this.blocks.set(index, { type: blockType, index, buffer: '' })
    }
    return []
  }

  private onContentBlockDelta(event: Json, ts: number): TimelineEvent[] {
    const index = event.index as number | undefined
    if (typeof index !== 'number') return []
    const block = this.blocks.get(index)
    if (!block) return []
    const delta = event.delta as Json | undefined
    const deltaType = delta?.type as string | undefined

    if (deltaType === 'text_delta' && block.type === 'text') {
      const chunk = (delta?.text as string) ?? ''
      if (!chunk) return []
      block.buffer += chunk
      return [{ kind: 'text_delta', blockKey: this.blockKey(index), text: chunk, ts }]
    }

    if (deltaType === 'input_json_delta' && block.type === 'tool_use') {
      const partial = (delta?.partial_json as string) ?? ''
      if (!partial) return []
      block.buffer += partial
      block.bytesSeen = block.buffer.length
      const summary = tryExtractSummaryFromPartialJson(block.buffer) || block.lastSummary
      const summaryChanged = summary !== block.lastSummary
      const timeSince = ts - block.lastEmitTs
      // First delta always emits; otherwise emit on summary change or throttle
      // window elapsed — this keeps IPC volume bounded for multi-kB Write inputs.
      if (summaryChanged || timeSince >= TOOL_USE_PROGRESS_MIN_INTERVAL_MS) {
        block.lastSummary = summary
        block.lastEmitTs = ts
        return [{ kind: 'tool_use_progress', id: block.id, name: block.name, summary, bytesSeen: block.bytesSeen, ts }]
      }
    }

    return []
  }

  private onContentBlockStop(event: Json): TimelineEvent[] {
    const index = event.index as number | undefined
    if (typeof index === 'number') this.blocks.delete(index)
    // The terminal `assistant` message (still emitted with partials on) carries
    // the authoritative tool_use / assistant_text event; the renderer upgrades
    // in-place from the _start / _delta rows.
    return []
  }

  private blockKey(index: number): string {
    return `${this.streamSessionId ?? 'nosession'}:${index}`
  }

  push(chunk: string): StreamFilterDrain {
    this.buffer += chunk
    const displayChunks: string[] = []
    const contextChunks: string[] = []
    const events: TimelineEvent[] = []
    let sessionId: string | null = null

    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      const { events: lineEvents, filtered } = this.processLine(line, Date.now())
      if (filtered.display) displayChunks.push(filtered.display)
      if (filtered.context) contextChunks.push(filtered.context)
      if (filtered.sessionId) sessionId = filtered.sessionId
      events.push(...lineEvents)
    }

    return { displayChunks, contextChunks, events, sessionId }
  }

  flush(): StreamFilterDrain {
    if (!this.buffer.trim()) {
      this.buffer = ''
      return { displayChunks: [], contextChunks: [], events: [], sessionId: null }
    }
    const line = this.buffer
    this.buffer = ''
    const { events, filtered } = this.processLine(line, Date.now())
    return {
      displayChunks: filtered.display ? [filtered.display] : [],
      contextChunks: filtered.context ? [filtered.context] : [],
      events,
      sessionId: filtered.sessionId ?? null
    }
  }

  // Test seam: drive stream_event processing with a controlled ts, bypassing
  // the line-buffered stdin path.
  ingestEvent(event: Json, ts: number): TimelineEvent[] {
    if (typeof event.session_id === 'string') this.streamSessionId = event.session_id
    const type = event.type as string | undefined
    if (type === 'stream_event') {
      return this.processStreamEvent(event.event as Json | undefined, ts)
    }
    return parseSdkEvent(event, ts)
  }
}
