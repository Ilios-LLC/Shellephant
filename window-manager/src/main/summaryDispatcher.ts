import { BrowserWindow } from 'electron'

export function dispatchSummary(
  containerId: string,
  summary: { title: string; bullets: string[] }
): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send('terminal:summary', { containerId, ...summary })
}
