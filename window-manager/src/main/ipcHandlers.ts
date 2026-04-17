import { ipcMain, BrowserWindow, shell } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars, updateProjectPorts, type PortMapping } from './projectService'
import { createGroup, listGroups } from './projectGroupService'
import { openTerminal, writeInput, resizeTerminal, closeTerminal, type SessionType } from './terminalService'
import { setActiveContainer } from './focusState'
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
import { extractRepoName, buildPrUrl } from './gitUrl'
import { getDocker } from './docker'
import { getCurrentBranch, stageAndCommit, push as gitPush, listContainerDir, readContainerFile, writeFileInContainer, getGitStatus, execInContainer } from './gitOps'
import { getIdentity } from './githubIdentity'
import { scrubPat } from './scrub'
import {
  listDependencies,
  createDependency,
  deleteDependency,
  listWindowDepContainers,
  updateDependency
} from './dependencyService'
import { startDepLogs, stopDepLogs } from './depLogsService'
import { getDepContainersStatus } from './containerStatusService'

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
  ipcMain.handle('project:create', (_, name: string, gitUrl: string, ports?: PortMapping[]) => createProject(name, gitUrl, ports))
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:delete', (_, id: number) => deleteProject(id))
  ipcMain.handle('project:update', (_, id: number, patch: { groupId: number | null }) =>
    updateProject(id, patch)
  )
  ipcMain.handle('project:get', (_, id: number) => getProject(id))
  ipcMain.handle('project:update-env-vars', (_, id: number, envVars: Record<string, string>) =>
    updateProjectEnvVars(id, envVars)
  )
  ipcMain.handle('project:update-ports', (_, id: number, ports: PortMapping[]) =>
    updateProjectPorts(id, ports)
  )

  // Group handlers
  ipcMain.handle('group:create', (_, name: string) => createGroup(name))
  ipcMain.handle('group:list', () => listGroups())

  // Window handlers
  ipcMain.handle('window:create', (event, name: string, projectId: number, withDeps = false) =>
    createWindow(name, projectId, withDeps, (step) => event.sender.send('window:create-progress', step))
  )
  ipcMain.handle('window:list', (_, projectId?: number) => listWindows(projectId))
  ipcMain.handle('window:delete', (_, id: number) => deleteWindow(id))

  // Dependency handlers
  ipcMain.handle('project:dep-list', (_, projectId: number) => listDependencies(projectId))
  ipcMain.handle(
    'project:dep-create',
    (_, projectId: number, image: string, tag: string, envVars?: Record<string, string>) =>
      createDependency(projectId, image, tag, envVars)
  )
  ipcMain.handle('project:dep-delete', (_, id: number) => deleteDependency(id))
  ipcMain.handle('project:dep-update', (_, id: number, envVars: Record<string, string> | null) =>
    updateDependency(id, envVars))
  ipcMain.handle('window:dep-containers-list', (_, windowId: number) =>
    listWindowDepContainers(windowId)
  )

  // Dep logs handlers
  ipcMain.handle('window:dep-logs-start', (event, containerId: string) => {
    const container = getDocker().getContainer(containerId)
    return startDepLogs(containerId, container, (chunk) =>
      event.sender.send('window:dep-logs-data', containerId, chunk)
    )
  })
  ipcMain.on('window:dep-logs-stop', (_, containerId: string) => stopDepLogs(containerId))
  ipcMain.handle('window:dep-containers-status', (_, containerIds: string[]) =>
    getDepContainersStatus(containerIds))

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
    const result = await gitPush(ctx.container, ctx.clonePath, branch, ctx.gitUrl, pat)
    return {
      ...result,
      prUrl: result.ok ? buildPrUrl(ctx.gitUrl, branch) : undefined
    }
  })

  ipcMain.handle('git:status', async (_, windowId: number) => {
    const ctx = resolveWindowGitContext(windowId)
    return getGitStatus(ctx.container, ctx.clonePath)
  })

  // Shell handlers
  ipcMain.handle('shell:openExternal', (_, url: string) => shell.openExternal(url))

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
  ipcMain.handle('terminal:open', (event, containerId: string, cols: number, rows: number, displayName: string, sessionType: SessionType = 'terminal') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window found for terminal:open')
    const row = getDb()
      .prepare(
        `SELECT p.git_url FROM windows w JOIN projects p ON p.id = w.project_id
         WHERE w.container_id = ? AND w.deleted_at IS NULL LIMIT 1`
      )
      .get(containerId) as { git_url: string } | undefined
    const workDir = row ? `/workspace/${extractRepoName(row.git_url)}` : undefined
    return openTerminal(containerId, win, cols, rows, displayName, workDir, sessionType)
  })
  ipcMain.on('terminal:input', (_, containerId: string, data: string, sessionType: SessionType = 'terminal') =>
    writeInput(containerId, data, sessionType)
  )
  ipcMain.on('terminal:resize', (_, containerId: string, cols: number, rows: number, sessionType: SessionType = 'terminal') =>
    resizeTerminal(containerId, cols, rows, sessionType)
  )
  ipcMain.on('terminal:close', (_, containerId: string, sessionType: SessionType = 'terminal') => closeTerminal(containerId, sessionType))

  // Focus handlers
  ipcMain.on('focus:active-container', (_, containerId: string | null) =>
    setActiveContainer(containerId)
  )

  // File system handlers (container exec bridge)
  ipcMain.handle('fs:list-dir', async (_, containerId: string, path: string) => {
    const container = getDocker().getContainer(containerId)
    return listContainerDir(container, path)
  })

  ipcMain.handle('fs:read-file', async (_, containerId: string, path: string) => {
    const container = getDocker().getContainer(containerId)
    return readContainerFile(container, path)
  })

  ipcMain.handle('fs:write-file', async (_, containerId: string, path: string, content: string) => {
    const container = getDocker().getContainer(containerId)
    return writeFileInContainer(container, path, content)
  })

  ipcMain.handle('fs:exec', async (_, containerId: string, cmd: string[]) => {
    const container = getDocker().getContainer(containerId)
    const result = await execInContainer(container, cmd)
    return { ok: result.ok, code: result.code, stdout: result.stdout }
  })
}
