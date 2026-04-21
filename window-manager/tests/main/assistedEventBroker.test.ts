import { describe, it, expect, beforeEach } from 'vitest'
import { publish, subscribe, __resetForTests } from '../../src/main/assistedEventBroker'

describe('assistedEventBroker', () => {
  beforeEach(() => __resetForTests())

  it('delivers published events to subscribers of the same windowId', () => {
    const received: Array<[string, unknown[]]> = []
    subscribe(1, (channel, args) => received.push([channel, args]))
    publish(1, 'claude:delta', [1, 'hello'])
    expect(received).toEqual([['claude:delta', [1, 'hello']]])
  })

  it('isolates events between windowIds', () => {
    const a: string[] = []
    const b: string[] = []
    subscribe(1, (ch) => a.push(ch))
    subscribe(2, (ch) => b.push(ch))
    publish(1, 'claude:delta', [])
    publish(2, 'claude:action', [])
    expect(a).toEqual(['claude:delta'])
    expect(b).toEqual(['claude:action'])
  })

  it('unsubscribe stops delivery', () => {
    const got: string[] = []
    const off = subscribe(1, (ch) => got.push(ch))
    publish(1, 'a', [])
    off()
    publish(1, 'b', [])
    expect(got).toEqual(['a'])
  })

  it('supports multiple subscribers per windowId', () => {
    const a: string[] = []
    const b: string[] = []
    subscribe(1, (ch) => a.push(ch))
    subscribe(1, (ch) => b.push(ch))
    publish(1, 'x', [])
    expect(a).toEqual(['x'])
    expect(b).toEqual(['x'])
  })
})
