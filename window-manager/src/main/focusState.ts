import type { BrowserWindow } from 'electron'

// The container ID currently visible in the renderer's main pane. Set by
// the renderer whenever `selectedWindow` changes (via the focus:active-container
// IPC). Null means no window is selected (e.g., default view).
let activeContainerId: string | null = null

export function setActiveContainer(containerId: string | null): void {
  activeContainerId = containerId
}

export function getActiveContainer(): string | null {
  return activeContainerId
}

// True when the Electron app is focused AND the user is viewing this
// specific container's terminal. Used to suppress the OS notification
// for the very window the user is already staring at.
export function isUserWatching(containerId: string, win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  if (!win.isFocused()) return false
  return activeContainerId === containerId
}
