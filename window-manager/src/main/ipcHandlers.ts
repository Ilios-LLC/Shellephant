import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'

export function registerIpcHandlers(): void {
  ipcMain.handle('window:create', (_, name: string) => createWindow(name))
  ipcMain.handle('window:list', () => listWindows())
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))
  ipcMain.handle('terminal:open', (event, containerId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    return openTerminal(containerId, win)
  })
  ipcMain.on('terminal:input', (_, containerId: string, data: string) =>
    writeInput(containerId, data)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number) =>
    resizeTerminal(containerId, cols, rows)
  )
  ipcMain.on('terminal:close', (_, containerId: string) => closeTerminal(containerId))
}
