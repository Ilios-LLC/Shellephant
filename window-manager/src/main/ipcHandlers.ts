import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject } from './projectService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'
import {
  getGitHubPatStatus,
  setGitHubPat,
  clearGitHubPat,
  getClaudeTokenStatus,
  setClaudeToken,
  clearClaudeToken
} from './settingsService'
import { getDb } from './db'
import { extractRepoName } from './gitUrl'
import { getDocker } from './docker'
import { getCurrentBranch } from './gitOps'

export function registerIpcHandlers(): void {
  // Project handlers
  ipcMain.handle('project:create', (_, name: string, gitUrl: string) =>
    createProject(name, gitUrl)
  )
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:delete', (_, id: number) => deleteProject(id))

  // Window handlers
  ipcMain.handle('window:create', (event, name: string, projectId: number) =>
    createWindow(name, projectId, (step) =>
      event.sender.send('window:create-progress', step)
    )
  )
  ipcMain.handle('window:list', (_, projectId?: number) => listWindows(projectId))
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))

  // Git handlers
  ipcMain.handle('git:current-branch', async (_, windowId: number) => {
    const row = getDb()
      .prepare(
        `SELECT w.container_id AS containerId, p.git_url AS gitUrl
         FROM windows w JOIN projects p ON p.id = w.project_id
         WHERE w.id = ? AND w.deleted_at IS NULL`
      )
      .get(windowId) as { containerId: string; gitUrl: string } | undefined
    if (!row) throw new Error('Window not found')
    const clonePath = `/workspace/${extractRepoName(row.gitUrl)}`
    const container = getDocker().getContainer(row.containerId)
    return getCurrentBranch(container, clonePath)
  })

  // Settings handlers
  ipcMain.handle('settings:get-github-pat-status', () => getGitHubPatStatus())
  ipcMain.handle('settings:set-github-pat', (_, pat: string) => {
    setGitHubPat(pat)
    return getGitHubPatStatus()
  })
  ipcMain.handle('settings:clear-github-pat', () => {
    clearGitHubPat()
    return getGitHubPatStatus()
  })
  ipcMain.handle('settings:get-claude-token-status', () => getClaudeTokenStatus())
  ipcMain.handle('settings:set-claude-token', (_, token: string) => {
    setClaudeToken(token)
    return getClaudeTokenStatus()
  })
  ipcMain.handle('settings:clear-claude-token', () => {
    clearClaudeToken()
    return getClaudeTokenStatus()
  })

  // Terminal handlers
  ipcMain.handle(
    'terminal:open',
    (event, containerId: string, cols: number, rows: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found for terminal:open')
      return openTerminal(containerId, win, cols, rows)
    }
  )
  ipcMain.on('terminal:input', (_, containerId: string, data: string) =>
    writeInput(containerId, data)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number) =>
    resizeTerminal(containerId, cols, rows)
  )
  ipcMain.on('terminal:close', (_, containerId: string) => closeTerminal(containerId))
}
