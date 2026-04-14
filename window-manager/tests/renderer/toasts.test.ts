import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { toasts, pushToast, dismissToast } from '../../src/renderer/src/lib/toasts'

describe('toasts store', () => {
  beforeEach(() => {
    for (const t of get(toasts)) dismissToast(t.id)
  })

  it('pushes a toast with level, title, and optional body', () => {
    const id = pushToast({ level: 'success', title: 'OK', body: 'all good' })
    const current = get(toasts)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ id, level: 'success', title: 'OK', body: 'all good' })
  })

  it('dismisses a toast by id', () => {
    const id = pushToast({ level: 'error', title: 'nope' })
    dismissToast(id)
    expect(get(toasts)).toEqual([])
  })

  it('assigns unique ids across pushes', () => {
    const a = pushToast({ level: 'success', title: 'a' })
    const b = pushToast({ level: 'success', title: 'b' })
    expect(a).not.toBe(b)
  })

  it('omits body when not provided', () => {
    pushToast({ level: 'success', title: 'no body' })
    const [t] = get(toasts)
    expect(t.body).toBeUndefined()
  })
})
