import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject } from './projectService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'

export function registerIpcHandlers(): void {
  // Project handlers
  ipcMain.handle('project:create', (_, name: string, gitUrl: string) =>
    createProject(name, gitUrl)
  )
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:delete', (_, id: number) => deleteProject(id))

  // Window handlers
  ipcMain.handle('window:create', (_, name: string, projectId: number) =>
    createWindow(name, projectId)
  )
  ipcMain.handle('window:list', (_, projectId?: number) => listWindows(projectId))
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))

  // Terminal handlers
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
