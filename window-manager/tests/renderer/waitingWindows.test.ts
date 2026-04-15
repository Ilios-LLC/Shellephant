import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'
import type { WaitingEntry } from '../../src/renderer/src/lib/waitingWindows'

function makeEntry(containerId: string, windowId: number = 1): WaitingEntry {
  return {
    containerId,
    windowId,
    windowName: `window-${windowId}`,
    projectId: 10,
    projectName: 'test-project'
  }
}

describe('waitingWindows', () => {
  beforeEach(() => waitingWindows._resetForTest())

  it('starts empty', () => {
    expect(get(waitingWindows)).toEqual([])
  })

  it('add inserts an entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].containerId).toBe('c1')
    expect(list[0].windowName).toBe('window-1')
  })

  it('add deduplicates by containerId, keeping the latest entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.add({ ...makeEntry('c1', 1), windowName: 'updated-name' })
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].windowName).toBe('updated-name')
  })

  it('remove clears the matching entry', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.add(makeEntry('c2', 2))
    waitingWindows.remove('c1')
    const list = get(waitingWindows)
    expect(list).toHaveLength(1)
    expect(list[0].containerId).toBe('c2')
  })

  it('remove is a no-op when entry does not exist', () => {
    waitingWindows.add(makeEntry('c1', 1))
    waitingWindows.remove('nonexistent')
    expect(get(waitingWindows)).toHaveLength(1)
  })

  it('store notifies subscribers on add', () => {
    const received: WaitingEntry[][] = []
    const unsubscribe = waitingWindows.subscribe((v) => received.push(v))
    waitingWindows.add(makeEntry('c1', 1))
    unsubscribe()
    expect(received.length).toBeGreaterThanOrEqual(2) // initial + after add
    expect(received[received.length - 1]).toHaveLength(1)
  })
})
