import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  mockIsUserWatching,
  mockGetWaitingInfo,
  mockGetAllWindows,
  MockNotification,
  mockNotificationShow
} = vi.hoisted(() => {
  const mockNotificationShow = vi.fn()
  const MockNotification = vi.fn().mockImplementation(function () {
    return { show: mockNotificationShow }
  })
  return {
    mockIsUserWatching: vi.fn(),
    mockGetWaitingInfo: vi.fn(),
    mockGetAllWindows: vi.fn(),
    MockNotification,
    mockNotificationShow
  }
})

vi.mock('electron', () => ({
  Notification: MockNotification,
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() }
}))
vi.mock('../../src/main/focusState', () => ({
  isUserWatching: (id: string, win: unknown) => mockIsUserWatching(id, win)
}))
vi.mock('../../src/main/windowService', () => ({
  getWaitingInfoByContainerId: (id: string) => mockGetWaitingInfo(id)
}))

import { dispatchWaiting } from '../../src/main/waitingDispatcher'

function fakeWin(opts: { destroyed?: boolean } = {}) {
  return {
    isDestroyed: vi.fn().mockReturnValue(opts.destroyed ?? false),
    webContents: { send: vi.fn() }
  }
}

const fullInfo = {
  containerId: 'cid-1',
  windowId: 7,
  windowName: 'alpha',
  projectId: 2,
  projectName: 'beta'
}

describe('dispatchWaiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsUserWatching.mockReturnValue(false)
    mockGetWaitingInfo.mockReturnValue(fullInfo)
    mockGetAllWindows.mockReturnValue([fakeWin()])
  })

  it('no-ops when the container is not in the DB', () => {
    mockGetWaitingInfo.mockReturnValue(null)
    dispatchWaiting('cid-gone')
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('suppresses both IPC and notification when the user is watching', () => {
    const win = fakeWin()
    mockGetAllWindows.mockReturnValue([win])
    mockIsUserWatching.mockReturnValue(true)
    dispatchWaiting('cid-1')
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('fires IPC + notification when the user is not watching and the window exists', () => {
    const win = fakeWin()
    mockGetAllWindows.mockReturnValue([win])
    dispatchWaiting('cid-1')
    expect(win.webContents.send).toHaveBeenCalledWith('terminal:waiting', fullInfo)
    expect(MockNotification).toHaveBeenCalledWith({
      title: 'Claude is waiting',
      body: 'alpha'
    })
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('fires the OS notification even when the app has no window open', () => {
    mockGetAllWindows.mockReturnValue([])
    dispatchWaiting('cid-1')
    expect(MockNotification).toHaveBeenCalled()
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('fires the OS notification when the window exists but is destroyed', () => {
    mockGetAllWindows.mockReturnValue([fakeWin({ destroyed: true })])
    dispatchWaiting('cid-1')
    expect(mockNotificationShow).toHaveBeenCalled()
  })
})
