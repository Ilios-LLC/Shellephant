import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { conversationSummary } from '../../src/renderer/src/lib/conversationSummary'
import type { ConversationSummary } from '../../src/renderer/src/lib/conversationSummary'

function makeSummary(title: string): ConversationSummary {
  return { title, bullets: [`bullet for ${title}`] }
}

describe('conversationSummary', () => {
  beforeEach(() => conversationSummary._resetForTest())

  it('starts empty', () => {
    expect(get(conversationSummary).size).toBe(0)
  })

  it('set stores a summary keyed by containerId', () => {
    conversationSummary.set('cid-1', makeSummary('Built login'))
    const m = get(conversationSummary)
    expect(m.get('cid-1')).toEqual({ title: 'Built login', bullets: ['bullet for Built login'] })
  })

  it('set overwrites an existing entry for the same containerId', () => {
    conversationSummary.set('cid-1', makeSummary('first'))
    conversationSummary.set('cid-1', makeSummary('second'))
    expect(get(conversationSummary).get('cid-1')?.title).toBe('second')
    expect(get(conversationSummary).size).toBe(1)
  })

  it('remove deletes the matching entry', () => {
    conversationSummary.set('cid-1', makeSummary('one'))
    conversationSummary.set('cid-2', makeSummary('two'))
    conversationSummary.remove('cid-1')
    const m = get(conversationSummary)
    expect(m.has('cid-1')).toBe(false)
    expect(m.has('cid-2')).toBe(true)
  })

  it('remove is a no-op when entry does not exist', () => {
    conversationSummary.set('cid-1', makeSummary('one'))
    conversationSummary.remove('nonexistent')
    expect(get(conversationSummary).size).toBe(1)
  })

  it('store notifies subscribers on set', () => {
    const received: Map<string, ConversationSummary>[] = []
    const unsubscribe = conversationSummary.subscribe((v) => received.push(v))
    conversationSummary.set('cid-1', makeSummary('title'))
    unsubscribe()
    expect(received.length).toBeGreaterThanOrEqual(2) // initial + after set
    expect(received[received.length - 1].size).toBe(1)
  })
})
