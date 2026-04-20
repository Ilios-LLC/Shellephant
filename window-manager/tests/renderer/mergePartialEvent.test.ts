import { describe, it, expect } from 'vitest'
import { mergePartialEvent } from '../../src/renderer/src/lib/mergePartialEvent'
import type { TimelineEvent } from '../../src/shared/timelineEvent'

describe('mergePartialEvent', () => {
  it('appends a tool_use_start with no predecessors', () => {
    const result = mergePartialEvent([], {
      kind: 'tool_use_start',
      id: 'tu_1',
      name: 'Write',
      ts: 1
    })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool_use_start')
  })

  it('tool_use_progress replaces matching tool_use_start in place', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_use_start', id: 'tu_1', name: 'Write', ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'tool_use_progress',
      id: 'tu_1',
      name: 'Write',
      summary: '/tmp/foo.md',
      bytesSeen: 64,
      ts: 2
    })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool_use_progress')
    if (result[0].kind !== 'tool_use_progress') throw new Error('unreachable')
    expect(result[0].bytesSeen).toBe(64)
  })

  it('tool_use_progress replaces an earlier tool_use_progress for the same id', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_use_progress', id: 'tu_1', name: 'Write', summary: '/a', bytesSeen: 10, ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'tool_use_progress',
      id: 'tu_1',
      name: 'Write',
      summary: '/a',
      bytesSeen: 100,
      ts: 2
    })
    expect(result).toHaveLength(1)
    if (result[0].kind !== 'tool_use_progress') throw new Error('unreachable')
    expect(result[0].bytesSeen).toBe(100)
  })

  it('terminal tool_use replaces matching partial in place', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_use_start', id: 'tu_1', name: 'Write', ts: 1 },
      { kind: 'tool_use_progress', id: 'tu_1', name: 'Write', summary: '/a.md', bytesSeen: 50, ts: 2 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'tool_use',
      id: 'tu_1',
      name: 'Write',
      input: { file_path: '/a.md', content: 'hello' },
      summary: '/a.md',
      ts: 3
    })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool_use')
  })

  it('tool_use for unknown id appends (no match to replace)', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_use_start', id: 'tu_A', name: 'Write', ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'tool_use',
      id: 'tu_B',
      name: 'Read',
      input: { file_path: '/x' },
      summary: '/x',
      ts: 2
    })
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('tool_use_start')
    expect(result[1].kind).toBe('tool_use')
  })

  it('text_delta for the same block concatenates onto the previous text_delta', () => {
    const prev: TimelineEvent[] = [
      { kind: 'text_delta', blockKey: 'sess:0', text: 'Hello, ', ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'text_delta',
      blockKey: 'sess:0',
      text: 'world.',
      ts: 2
    })
    expect(result).toHaveLength(1)
    if (result[0].kind !== 'text_delta') throw new Error('unreachable')
    expect(result[0].text).toBe('Hello, world.')
  })

  it('text_delta for a different block appends a new entry', () => {
    const prev: TimelineEvent[] = [
      { kind: 'text_delta', blockKey: 'sess:0', text: 'A', ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'text_delta',
      blockKey: 'sess:2',
      text: 'B',
      ts: 2
    })
    expect(result).toHaveLength(2)
  })

  it('terminal assistant_text replaces the trailing text_delta', () => {
    const prev: TimelineEvent[] = [
      { kind: 'text_delta', blockKey: 'sess:0', text: 'Hello, world.', ts: 2 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'assistant_text',
      text: 'Hello, world.',
      ts: 3
    })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('assistant_text')
  })

  it('assistant_text appends normally when no matching text_delta precedes', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_result', toolUseId: 'x', text: 'ok', isError: false, ts: 1 }
    ]
    const result = mergePartialEvent(prev, {
      kind: 'assistant_text',
      text: 'Done.',
      ts: 2
    })
    expect(result).toHaveLength(2)
  })

  it('unrelated event types pass through unchanged', () => {
    const prev: TimelineEvent[] = []
    const result = mergePartialEvent(prev, {
      kind: 'tool_result',
      toolUseId: 'tu_1',
      text: 'output',
      isError: false,
      ts: 1
    })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool_result')
  })

  it('does not mutate the input array', () => {
    const prev: TimelineEvent[] = [
      { kind: 'tool_use_start', id: 'tu_1', name: 'Write', ts: 1 }
    ]
    const snapshot = [...prev]
    mergePartialEvent(prev, {
      kind: 'tool_use_progress',
      id: 'tu_1',
      name: 'Write',
      summary: '/a',
      bytesSeen: 20,
      ts: 2
    })
    expect(prev).toEqual(snapshot)
  })
})
