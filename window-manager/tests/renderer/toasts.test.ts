import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fire } = vi.hoisted(() => ({ fire: vi.fn() }))

vi.mock('sweetalert2', () => ({
  default: {
    mixin: () => ({ fire }),
    stopTimer: vi.fn(),
    resumeTimer: vi.fn()
  }
}))

import { pushToast } from '../../src/renderer/src/lib/toasts'

describe('pushToast', () => {
  beforeEach(() => {
    fire.mockReset()
  })

  it('fires a success toast with the given title', () => {
    pushToast({ level: 'success', title: 'OK' })
    expect(fire).toHaveBeenCalledWith(
      expect.objectContaining({ icon: 'success', title: 'OK' })
    )
  })

  it('fires an error toast with the given title', () => {
    pushToast({ level: 'error', title: 'nope' })
    expect(fire).toHaveBeenCalledWith(
      expect.objectContaining({ icon: 'error', title: 'nope' })
    )
  })

  it('renders the body into an escaped <pre> block when provided', () => {
    pushToast({ level: 'error', title: 'boom', body: '<script>alert(1)</script>' })
    const arg = fire.mock.calls[0][0]
    expect(arg.html).toContain('&lt;script&gt;')
    expect(arg.html).not.toContain('<script>')
  })

  it('omits html when body is absent', () => {
    pushToast({ level: 'success', title: 'clean' })
    expect(fire.mock.calls[0][0].html).toBeUndefined()
  })
})
