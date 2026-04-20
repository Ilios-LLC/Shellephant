// Filter raw Claude Agent SDK stream-json events into three outputs:
//   display — short human-readable string (legacy fallback sink)
//   context — ultra-compact string fed back to Kimi as tool_result
//   events  — typed TimelineEvent objects for the rich UI timeline
// A null display/context means "drop this event for that sink".

import type { TimelineEvent } from '../shared/timelineEvent'

export type FilteredEvent = {
  display: string | null
  context: string | null
  sessionId?: string | null
}

type Json = Record<string, unknown>

const MAX_CONTEXT_RESULT_LEN = 500
const MAX_DISPLAY_RESULT_LEN = 2000
const MAX_EVENT_TEXT_LEN = 2000

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
  return []
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
      out.push({ kind: 'thinking', text: truncate(text, MAX_EVENT_TEXT_LEN), ts })
      continue
    }
    if (btype === 'text') {
      const text = (block.text as string) ?? ''
      if (text) out.push({ kind: 'assistant_text', text: truncate(text, MAX_EVENT_TEXT_LEN), ts })
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
      text: truncate(extractToolResultText(block.content), MAX_EVENT_TEXT_LEN),
      isError: block.is_error === true,
      ts
    })
  }
  return out
}

function parseResultEvent(event: Json, ts: number): TimelineEvent[] {
  const text = (event.result as string) ?? ''
  if (!text) return []
  return [{ kind: 'result', text: truncate(text, MAX_EVENT_TEXT_LEN), isError: event.is_error === true, ts }]
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

    displayParts.push(`${prefix} ${truncate(raw, MAX_DISPLAY_RESULT_LEN)}`)
    contextParts.push(`tool_result${isError ? '(error)' : ''}: ${truncate(raw, MAX_CONTEXT_RESULT_LEN)}`)
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
    context: `final: ${truncate(result, MAX_CONTEXT_RESULT_LEN)}`
  }
}

function summarizeToolInput(_name: string, input: Json | undefined): string {
  if (!input) return ''
  const keys = ['file_path', 'path', 'pattern', 'command', 'url', 'prompt', 'description']
  for (const key of keys) {
    const val = input[key]
    if (typeof val === 'string' && val) return truncate(val, 80)
  }
  const firstString = Object.values(input).find(v => typeof v === 'string') as string | undefined
  if (firstString) return truncate(firstString, 80)
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `…[+${text.length - max}b]`
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
      const filtered = filterSdkLine(line)
      if (filtered.display) displayChunks.push(filtered.display)
      if (filtered.context) contextChunks.push(filtered.context)
      if (filtered.sessionId) sessionId = filtered.sessionId
      events.push(...parseSdkLine(line))
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
    const filtered = filterSdkLine(line)
    return {
      displayChunks: filtered.display ? [filtered.display] : [],
      contextChunks: filtered.context ? [filtered.context] : [],
      events: parseSdkLine(line),
      sessionId: filtered.sessionId ?? null
    }
  }
}
