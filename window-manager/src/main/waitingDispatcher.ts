import { BrowserWindow, Notification } from 'electron'
import { isUserWatching } from './focusState'
import { getWaitingInfoByContainerId } from './windowService'

export function dispatchWaiting(containerId: string): void {
  const info = getWaitingInfoByContainerId(containerId)
  if (!info) return
  const win = BrowserWindow.getAllWindows()[0]
  // Skip entirely when the user is already looking at this window — they
  // can see Claude went idle without any prompting.
  if (win && !win.isDestroyed() && isUserWatching(containerId, win)) return
  if (win && !win.isDestroyed()) {
    win.webContents.send('terminal:waiting', info)
  }
  // Notification is independent of window state — fires even if the app
  // window is closed (common on macOS where closing the window doesn't quit).
  new Notification({
    title: 'Claude is waiting',
    body: info.windowName
  }).show()
}
