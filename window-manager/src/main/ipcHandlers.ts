import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject } from './projectService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal } from './terminalService'
import {
  getGitHubPat,
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
import { getCurrentBranch, stageAndCommit, push as gitPush } from './gitOps'
import { getIdentity } from './githubIdentity'
import { scrubPat } from './scrub'

interface WindowGitContext {
  container: ReturnType<ReturnType<typeof getDocker>['getContainer']>
  clonePath: string
  gitUrl: string
}

function resolveWindowGitContext(windowId: number): WindowGitContext {
  const row = getDb()
    .prepare(
      `SELECT w.container_id AS containerId, p.git_url AS gitUrl
       FROM windows w JOIN projects p ON p.id = w.project_id
       WHERE w.id = ? AND w.deleted_at IS NULL`
    )
    .get(windowId) as { containerId: string; gitUrl: string } | undefined
  if (!row) throw new Error('Window not found')
  return {
    container: getDocker().getContainer(row.containerId),
    clonePath: `/workspace/${extractRepoName(row.gitUrl)}`,
    gitUrl: row.gitUrl
  }
}

export function registerIpcHandlers(): void {
  // Project handlers
  ipcMain.handle('project:create', (_, name: string, gitUrl: string) => createProject(name, gitUrl))
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:delete', (_, id: number) => deleteProject(id))

  // Window handlers
  ipcMain.handle('window:create', (event, name: string, projectId: number) =>
    createWindow(name, projectId, (step) => event.sender.send('window:create-progress', step))
  )
  ipcMain.handle('window:list', (_, projectId?: number) => listWindows(projectId))
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))

  // Git handlers
  ipcMain.handle('git:current-branch', async (_, windowId: number) => {
    const ctx = resolveWindowGitContext(windowId)
    return getCurrentBranch(ctx.container, ctx.clonePath)
  })

  ipcMain.handle(
    'git:commit',
    async (_, windowId: number, payload: { subject: string; body?: string }) => {
      const pat = getGitHubPat()
      if (!pat) throw new Error('GitHub PAT not configured.')
      const ctx = resolveWindowGitContext(windowId)
      const identity = await getIdentity(pat)
      const result = await stageAndCommit(ctx.container, ctx.clonePath, {
        subject: payload.subject,
        body: payload.body,
        name: identity.name,
        email: identity.email
      })
      return {
        ...result,
        stdout: scrubPat(result.stdout, pat)
      }
    }
  )

  ipcMain.handle('git:push', async (_, windowId: number) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    const ctx = resolveWindowGitContext(windowId)
    const branch = await getCurrentBranch(ctx.container, ctx.clonePath)
    if (!branch || branch === 'HEAD') {
      throw new Error('Cannot push: detached HEAD or branch unknown')
    }
    return gitPush(ctx.container, ctx.clonePath, branch, ctx.gitUrl, pat)
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
  ipcMain.handle('terminal:open', (event, containerId: string, cols: number, rows: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    return openTerminal(containerId, win, cols, rows)
  })
  ipcMain.on('terminal:input', (_, containerId: string, data: string) =>
    writeInput(containerId, data)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number) =>
    resizeTerminal(containerId, cols, rows)
  )
  ipcMain.on('terminal:close', (_, containerId: string) => closeTerminal(containerId))
}
