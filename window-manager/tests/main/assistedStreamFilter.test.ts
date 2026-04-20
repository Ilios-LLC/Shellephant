import { describe, it, expect } from 'vitest'
import { filterSdkLine, filterSdkEvent, parseSdkLine, parseSdkEvent, StreamFilterBuffer } from '../../src/main/assistedStreamFilter'

describe('filterSdkLine', () => {
  it('returns null pair for empty line', () => {
    expect(filterSdkLine('')).toEqual({ display: null, context: null })
    expect(filterSdkLine('   ')).toEqual({ display: null, context: null })
  })

  it('returns raw text when line is not JSON', () => {
    expect(filterSdkLine('not json here')).toEqual({
      display: 'not json here',
      context: 'not json here'
    })
  })
})

describe('filterSdkEvent — system events', () => {
  it('formats init with model name, no context', () => {
    const result = filterSdkEvent({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' })
    expect(result.display).toContain('session init')
    expect(result.display).toContain('claude-sonnet-4-6')
    expect(result.context).toBeNull()
  })

  it('drops task_progress entirely', () => {
    expect(filterSdkEvent({ type: 'system', subtype: 'task_progress' })).toEqual({ display: null, context: null })
  })

  it('drops rate_limit_event', () => {
    expect(filterSdkEvent({ type: 'rate_limit_event' })).toEqual({ display: null, context: null })
  })

  it('hook success shows display badge but no context', () => {
    const r = filterSdkEvent({ type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup', exit_code: 0 })
    expect(r.display).toBe('⚙ SessionStart:startup ok')
    expect(r.context).toBeNull()
  })

  it('hook failure appears in both sinks', () => {
    const r = filterSdkEvent({ type: 'system', subtype: 'hook_response', hook_name: 'PreCommit', exit_code: 1 })
    expect(r.display).toContain('failed')
    expect(r.context).toContain('PreCommit')
  })
})

describe('filterSdkEvent — assistant events', () => {
  it('assistant text flows into both sinks', () => {
    const r = filterSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] }
    })
    expect(r.display).toBe('Hello world')
    expect(r.context).toBe('Hello world')
  })

  it('thinking blocks surface in display only, collapsed', () => {
    const r = filterSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'secret crypto stuff', signature: 'x'.repeat(500) }] }
    })
    expect(r.display).toBe('🧠 (thinking)')
    expect(r.display).not.toContain('secret')
    expect(r.context).toBeNull()
  })

  it('tool_use renders name plus summarized input', () => {
    const r = filterSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/foo.ts' } }] }
    })
    expect(r.display).toBe('🔧 Read(/tmp/foo.ts)')
    expect(r.context).toBe('tool_use: Read(/tmp/foo.ts)')
  })

  it('tool_use input summary truncates long paths', () => {
    const longPath = '/' + 'a'.repeat(200)
    const r = filterSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: longPath } }] }
    })
    expect(r.display!.length).toBeLessThan(longPath.length)
    expect(r.display).toContain('…')
  })

  it('mixed block list: thinking + text + tool_use', () => {
    const r = filterSdkEvent({
      type: 'assistant',
      message: { content: [
        { type: 'thinking', thinking: 'x' },
        { type: 'text', text: 'Starting work' },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }
      ] }
    })
    expect(r.display).toContain('🧠')
    expect(r.display).toContain('Starting work')
    expect(r.display).toContain('🔧 Grep(TODO)')
    // thinking should NOT appear in context
    expect(r.context).not.toContain('🧠')
    expect(r.context).toContain('Starting work')
    expect(r.context).toContain('Grep(TODO)')
  })
})

describe('filterSdkEvent — user/tool_result events', () => {
  it('string tool_result content', () => {
    const r = filterSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'file contents here' }] }
    })
    expect(r.display).toContain('✓')
    expect(r.display).toContain('file contents here')
    expect(r.context).toContain('tool_result')
  })

  it('error tool_result uses ⛔ marker', () => {
    const r = filterSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'permission denied', is_error: true }] }
    })
    expect(r.display).toContain('⛔')
    expect(r.context).toContain('tool_result(error)')
  })

  it('block-array tool_result content extracts text', () => {
    const r = filterSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] }] }
    })
    expect(r.display).toContain('line one')
    expect(r.display).toContain('line two')
  })

  it('context variant truncates long tool_result to 500 chars', () => {
    const huge = 'x'.repeat(2000)
    const r = filterSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: huge }] }
    })
    expect(r.context!.length).toBeLessThan(huge.length)
    expect(r.context).toContain('…')
  })
})

describe('filterSdkEvent — result', () => {
  it('success final answer', () => {
    const r = filterSdkEvent({ type: 'result', subtype: 'success', result: 'All done.', is_error: false })
    expect(r.display).toContain('✓ final')
    expect(r.display).toContain('All done.')
    expect(r.context).toContain('final:')
  })

  it('error final answer', () => {
    const r = filterSdkEvent({ type: 'result', subtype: 'error_max_turns', result: 'hit limit', is_error: true })
    expect(r.display).toContain('⛔ final')
  })

  it('empty result is dropped', () => {
    expect(filterSdkEvent({ type: 'result', result: '' })).toEqual({ display: null, context: null })
  })
})

describe('StreamFilterBuffer', () => {
  it('handles single complete line', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n'
    const { displayChunks, contextChunks } = buf.push(line)
    expect(displayChunks).toEqual(['hi'])
    expect(contextChunks).toEqual(['hi'])
  })

  it('holds partial line across chunks then emits on newline', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } })
    const a = buf.push(line.slice(0, 20))
    expect(a.displayChunks).toEqual([])

    const b = buf.push(line.slice(20) + '\n')
    expect(b.displayChunks).toEqual(['hello'])
  })

  it('handles multiple lines in one chunk', () => {
    const buf = new StreamFilterBuffer()
    const l1 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'one' }] } })
    const l2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] } })
    const { displayChunks } = buf.push(l1 + '\n' + l2 + '\n')
    expect(displayChunks).toEqual(['one', 'two'])
  })

  it('flush drains trailing partial line', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'tail' }] } })
    buf.push(line) // no newline
    const { displayChunks } = buf.flush()
    expect(displayChunks).toEqual(['tail'])
  })

  it('flush on empty buffer returns empty', () => {
    const buf = new StreamFilterBuffer()
    expect(buf.flush()).toEqual({ displayChunks: [], contextChunks: [], events: [], sessionId: null })
  })

  it('noise-heavy transcript collapses hard', () => {
    const buf = new StreamFilterBuffer()
    const lines = [
      { type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' },
      { type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup', exit_code: 0, output: 'huge context blob', stdout: 'huge context blob' },
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'long internal', signature: 'sig...' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }] } },
      { type: 'system', subtype: 'task_progress', description: 'Reading a.ts' },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'file body' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'result', subtype: 'success', result: 'Done.', is_error: false }
    ]
    const raw = lines.map(l => JSON.stringify(l)).join('\n') + '\n'
    const { displayChunks, contextChunks } = buf.push(raw)

    // display: session init + tool_use + tool_result + final text + final result — thinking collapsed, hooks badged, task_progress dropped
    expect(displayChunks.length).toBeGreaterThan(0)
    // context should be MUCH tighter than raw
    const contextSize = contextChunks.join('\n').length
    expect(contextSize).toBeLessThan(raw.length / 3)
    // context should NOT contain thinking or hook noise
    const ctx = contextChunks.join('\n')
    expect(ctx).not.toContain('thinking')
    expect(ctx).not.toContain('signature')
    expect(ctx).not.toContain('huge context blob')
    // context MUST contain final answer
    expect(ctx).toContain('Done.')
  })
})

describe('parseSdkEvent — typed events', () => {
  it('session_init is dropped (startup noise)', () => {
    expect(parseSdkEvent({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6', session_id: 'sess-abc' }, 1000)).toEqual([])
  })

  it('hook_started is dropped', () => {
    expect(parseSdkEvent({ type: 'system', subtype: 'hook_started', hook_name: 'pre' }, 1)).toEqual([])
  })

  it('successful hook_response is dropped', () => {
    expect(parseSdkEvent({ type: 'system', subtype: 'hook_response', hook_name: 'pre', exit_code: 0 }, 2)).toEqual([])
  })

  it('failed hook_response surfaces', () => {
    const [c] = parseSdkEvent({ type: 'system', subtype: 'hook_response', hook_name: 'pre', exit_code: 3 }, 3)
    expect(c).toEqual({ kind: 'hook', name: 'pre', status: 'failed', exitCode: 3, ts: 3 })
  })

  it('task_progress and similar drop to empty array', () => {
    expect(parseSdkEvent({ type: 'system', subtype: 'task_progress' })).toEqual([])
    expect(parseSdkEvent({ type: 'rate_limit_event' })).toEqual([])
  })

  it('assistant thinking yields thinking event (full text preserved up to cap)', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'inner monologue' }] }
    }, 10)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ kind: 'thinking', text: 'inner monologue', ts: 10 })
  })

  it('assistant text becomes assistant_text', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi there' }] }
    }, 20)
    expect(events).toEqual([{ kind: 'assistant_text', text: 'Hi there', ts: 20 }])
  })

  it('empty assistant text is skipped', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '' }] }
    })
    expect(events).toEqual([])
  })

  it('tool_use yields structured event with summary + id', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } }] }
    }, 30)
    expect(events).toHaveLength(1)
    const ev = events[0]
    if (ev.kind !== 'tool_use') throw new Error('wrong kind')
    expect(ev.id).toBe('tu_1')
    expect(ev.name).toBe('Read')
    expect(ev.summary).toBe('/x')
    expect(ev.input).toEqual({ file_path: '/x' })
  })

  it('tool_use summary falls back when no known key present', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't', name: 'Oddball', input: { foo: 'bar-value' } }] }
    })
    const ev = events[0]
    if (ev.kind !== 'tool_use') throw new Error('wrong kind')
    expect(ev.summary).toBe('bar-value')
  })

  it('mixed block list yields events in order', () => {
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [
        { type: 'thinking', thinking: 'a' },
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 't', name: 'Grep', input: { pattern: 'x' } }
      ] }
    }, 40)
    expect(events.map(e => e.kind)).toEqual(['thinking', 'assistant_text', 'tool_use'])
  })

  it('tool_result string content', () => {
    const events = parseSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] }
    }, 50)
    expect(events).toEqual([{ kind: 'tool_result', toolUseId: 'tu_1', text: 'ok', isError: false, ts: 50 }])
  })

  it('tool_result block-array content flattens', () => {
    const events = parseSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }] }
    })
    const ev = events[0]
    if (ev.kind !== 'tool_result') throw new Error('wrong kind')
    expect(ev.text).toBe('line1\nline2')
  })

  it('tool_result error flag preserved', () => {
    const events = parseSdkEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'boom', is_error: true }] }
    })
    const ev = events[0]
    if (ev.kind !== 'tool_result') throw new Error('wrong kind')
    expect(ev.isError).toBe(true)
  })

  it('result success + error + empty', () => {
    expect(parseSdkEvent({ type: 'result', result: 'ok', is_error: false }, 60))
      .toEqual([{ kind: 'result', text: 'ok', isError: false, ts: 60 }])
    expect(parseSdkEvent({ type: 'result', result: 'bad', is_error: true }, 61))
      .toEqual([{ kind: 'result', text: 'bad', isError: true, ts: 61 }])
    expect(parseSdkEvent({ type: 'result', result: '' })).toEqual([])
  })

  it('text capped at MAX_EVENT_TEXT_LEN', () => {
    const huge = 'x'.repeat(5000)
    const events = parseSdkEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: huge }] }
    })
    const ev = events[0]
    if (ev.kind !== 'assistant_text') throw new Error('wrong kind')
    expect(ev.text.length).toBeLessThan(huge.length)
    expect(ev.text).toContain('…')
  })

  it('unknown event type returns empty array', () => {
    expect(parseSdkEvent({ type: 'weird' })).toEqual([])
  })
})

describe('parseSdkLine', () => {
  it('handles valid JSON line', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    expect(parseSdkLine(line, 99)).toEqual([{ kind: 'assistant_text', text: 'hi', ts: 99 }])
  })

  it('returns empty array for blank line', () => {
    expect(parseSdkLine('')).toEqual([])
    expect(parseSdkLine('   ')).toEqual([])
  })

  it('returns empty array for malformed JSON', () => {
    expect(parseSdkLine('not json')).toEqual([])
  })
})

describe('StreamFilterBuffer — typed events', () => {
  it('push emits events array alongside strings', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n'
    const { events } = buf.push(line)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('assistant_text')
  })

  it('multi-line chunk preserves event order (session_init dropped)', () => {
    const buf = new StreamFilterBuffer()
    const l1 = JSON.stringify({ type: 'system', subtype: 'init', model: 'x' })
    const l2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    const l3 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/y' } }] } })
    const l4 = JSON.stringify({ type: 'result', result: 'done', is_error: false })
    const { events } = buf.push(l1 + '\n' + l2 + '\n' + l3 + '\n' + l4 + '\n')
    expect(events.map(e => e.kind)).toEqual(['assistant_text', 'tool_use', 'result'])
  })

  it('events split across chunk boundary still parsed once line completes', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'split' }] } })
    const first = buf.push(line.slice(0, 15))
    expect(first.events).toEqual([])
    const second = buf.push(line.slice(15) + '\n')
    expect(second.events).toHaveLength(1)
  })

  it('flush emits events for trailing partial line', () => {
    const buf = new StreamFilterBuffer()
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'end' }] } })
    buf.push(line)
    const { events } = buf.flush()
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('assistant_text')
  })
})
