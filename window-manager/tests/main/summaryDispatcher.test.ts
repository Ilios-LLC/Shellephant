import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() }
}))

import { dispatchSummary } from '../../src/main/summaryDispatcher'

function fakeWin(opts: { destroyed?: boolean } = {}) {
  return {
    isDestroyed: vi.fn().mockReturnValue(opts.destroyed ?? false),
    webContents: { send: vi.fn() }
  }
}

const payload = { title: 'Fixed auth bug', bullets: ['updated middleware', 'added tests'] }

describe('dispatchSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllWindows.mockReturnValue([fakeWin()])
  })

  it('sends terminal:summary IPC with containerId, title, and bullets', () => {
    const win = fakeWin()
    mockGetAllWindows.mockReturnValue([win])
    dispatchSummary('cid-1', payload)
    expect(win.webContents.send).toHaveBeenCalledWith('terminal:summary', {
      containerId: 'cid-1',
      title: 'Fixed auth bug',
      bullets: ['updated middleware', 'added tests']
    })
  })

  it('no-ops when no windows exist', () => {
    mockGetAllWindows.mockReturnValue([])
    expect(() => dispatchSummary('cid-1', payload)).not.toThrow()
  })

  it('no-ops when the only window is destroyed', () => {
    const win = fakeWin({ destroyed: true })
    mockGetAllWindows.mockReturnValue([win])
    dispatchSummary('cid-1', payload)
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
