import { describe, it, expect } from 'vitest'
import { getPhoneServerHtml } from '../../src/main/phoneServerHtml'

describe('getPhoneServerHtml', () => {
  it('returns HTML containing xterm script tag', () => {
    expect(getPhoneServerHtml()).toContain('xterm')
  })

  it('returns HTML containing WebSocket connection code', () => {
    expect(getPhoneServerHtml()).toContain('WebSocket')
  })

  it('returns HTML containing /api/windows fetch', () => {
    expect(getPhoneServerHtml()).toContain('/api/windows')
  })
})
