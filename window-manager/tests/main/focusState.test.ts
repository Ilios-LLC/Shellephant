import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setActiveContainer,
  getActiveContainer,
  isUserWatching
} from '../../src/main/focusState'

function fakeWin(opts: { destroyed?: boolean; focused?: boolean } = {}) {
  return {
    isDestroyed: vi.fn().mockReturnValue(opts.destroyed ?? false),
    isFocused: vi.fn().mockReturnValue(opts.focused ?? true)
  } as unknown as Parameters<typeof isUserWatching>[1]
}

describe('focusState', () => {
  beforeEach(() => setActiveContainer(null))

  it('stores and returns the active container id', () => {
    setActiveContainer('cid-1')
    expect(getActiveContainer()).toBe('cid-1')
    setActiveContainer(null)
    expect(getActiveContainer()).toBeNull()
  })

  describe('isUserWatching', () => {
    it('returns true when the window is focused and shows this container', () => {
      setActiveContainer('cid-watch')
      expect(isUserWatching('cid-watch', fakeWin({ focused: true }))).toBe(true)
    })

    it('returns false when the user is viewing a different container', () => {
      setActiveContainer('cid-other')
      expect(isUserWatching('cid-watch', fakeWin({ focused: true }))).toBe(false)
    })

    it('returns false when the app window is not focused', () => {
      setActiveContainer('cid-watch')
      expect(isUserWatching('cid-watch', fakeWin({ focused: false }))).toBe(false)
    })

    it('returns false when the window is destroyed', () => {
      setActiveContainer('cid-watch')
      expect(isUserWatching('cid-watch', fakeWin({ destroyed: true }))).toBe(false)
    })

    it('returns false when no container is active', () => {
      setActiveContainer(null)
      expect(isUserWatching('cid-watch', fakeWin({ focused: true }))).toBe(false)
    })
  })
})
