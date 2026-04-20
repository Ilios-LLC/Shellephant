import { ipcMain, BrowserWindow, shell } from 'electron'
import { createWindow, listWindows, deleteWindow } from './windowService'
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars, updateProjectPorts, updateProjectDefaultNetwork, type PortMapping } from './projectService'
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
import { buildPrUrl } from './gitUrl'
import { getDocker, listBridgeNetworks } from './docker'
import { getCurrentBranch, stageAndCommit, push as gitPush, listContainerDir, readContainerFile, writeFileInContainer, getGitStatus, execInContainer, listRemoteBranches } from './gitOps'
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
import { startPhoneServer, stopPhoneServer, getPhoneServerStatus } from './phoneServer'

interface WindowGitContext {
  container: ReturnType<ReturnType<typeof getDocker>['getContainer']>
  clonePath: string
  gitUrl: string
}

function resolveWindowProjectGitContext(windowId: number, projectId: number): WindowGitContext {
  const row = getDb()
    .prepare(
      `SELECT w.container_id AS containerId, p.git_url AS gitUrl, wp.clone_path AS clonePath
       FROM windows w
       JOIN window_projects wp ON wp.window_id = w.id AND wp.project_id = ?
       JOIN projects p ON p.id = wp.project_id
       WHERE w.id = ? AND w.deleted_at IS NULL`
    )
    .get(projectId, windowId) as { containerId: string; gitUrl: string; clonePath: string } | undefined
  if (!row) throw new Error('Window/project not found')
  return {
    container: getDocker().getContainer(row.containerId),
    clonePath: row.clonePath,
    gitUrl: row.gitUrl
  }
}

function resolveWindowGitContext(windowId: number): WindowGitContext {
  const row = getDb()
    .prepare(`SELECT project_id FROM window_projects WHERE window_id = ? LIMIT 1`)
    .get(windowId) as { project_id: number } | undefined
  if (!row) throw new Error('Window not found')
  return resolveWindowProjectGitContext(windowId, row.project_id)
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
  ipcMain.handle('project:update-default-network', (_, id: number, network: string | null) =>
    updateProjectDefaultNetwork(id, network)
  )
  ipcMain.handle('docker:list-bridge-networks', () => listBridgeNetworks())

  // Group handlers
  ipcMain.handle('group:create', (_, name: string) => createGroup(name))
  ipcMain.handle('group:list', () => listGroups())

  // Window handlers
  ipcMain.handle('window:create', (event, name: string, projectIds: number[], withDeps = false, branchOverrides: Record<number, string> = {}, networkName = '') =>
    createWindow(name, projectIds, withDeps, branchOverrides, (step) => event.sender.send('window:create-progress', step), networkName)
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
    console.log('[git-push]', { windowId, projectId: null, clonePath: ctx.clonePath, gitUrl: ctx.gitUrl, branch })
    const result = await gitPush(ctx.container, ctx.clonePath, branch, ctx.gitUrl, pat)
    console.log('[git-push:done]', { windowId, projectId: null, clonePath: ctx.clonePath, ok: result.ok, code: result.code })
    return {
      ...result,
      prUrl: result.ok ? buildPrUrl(ctx.gitUrl, branch) : undefined
    }
  })

  ipcMain.handle('git:status', async (_, windowId: number) => {
    const ctx = resolveWindowGitContext(windowId)
    return getGitStatus(ctx.container, ctx.clonePath)
  })

  ipcMain.handle('git:current-branch-project', async (_, windowId: number, projectId: number) => {
    const ctx = resolveWindowProjectGitContext(windowId, projectId)
    return getCurrentBranch(ctx.container, ctx.clonePath)
  })

  ipcMain.handle('git:commit-project', async (_, windowId: number, projectId: number, payload: { subject: string; body?: string }) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    const ctx = resolveWindowProjectGitContext(windowId, projectId)
    const identity = await getIdentity(pat)
    const result = await stageAndCommit(ctx.container, ctx.clonePath, {
      subject: payload.subject,
      body: payload.body,
      name: identity.name,
      email: identity.email
    })
    return { ...result, stdout: scrubPat(result.stdout, pat) }
  })

  ipcMain.handle('git:push-project', async (_, windowId: number, projectId: number) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    const ctx = resolveWindowProjectGitContext(windowId, projectId)
    const branch = await getCurrentBranch(ctx.container, ctx.clonePath)
    if (!branch || branch === 'HEAD') throw new Error('Cannot push: detached HEAD or branch unknown')
    console.log('[git-push]', { windowId, projectId, clonePath: ctx.clonePath, gitUrl: ctx.gitUrl, branch })
    const result = await gitPush(ctx.container, ctx.clonePath, branch, ctx.gitUrl, pat)
    console.log('[git-push:done]', { windowId, projectId, clonePath: ctx.clonePath, ok: result.ok, code: result.code })
    return { ...result, prUrl: result.ok ? buildPrUrl(ctx.gitUrl, branch) : undefined }
  })

  ipcMain.handle('git:status-project', async (_, windowId: number, projectId: number) => {
    const ctx = resolveWindowProjectGitContext(windowId, projectId)
    return getGitStatus(ctx.container, ctx.clonePath)
  })

  ipcMain.handle('git:list-branches', async (_, gitUrl: string) => {
    const pat = getGitHubPat()
    if (!pat) throw new Error('GitHub PAT not configured.')
    return listRemoteBranches(gitUrl, pat)
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

    const wpRows = getDb()
      .prepare(
        `SELECT wp.clone_path FROM windows w
         JOIN window_projects wp ON wp.window_id = w.id
         WHERE w.container_id = ? AND w.deleted_at IS NULL
         ORDER BY wp.id`
      )
      .all(containerId) as { clone_path: string }[]

    const clonePaths = wpRows.map(r => r.clone_path)
    const workDir = clonePaths.length === 1 ? clonePaths[0] : (clonePaths.length > 1 ? '/workspace' : undefined)

    return openTerminal(containerId, win, cols, rows, displayName, workDir, sessionType, clonePaths)
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
    const ALLOWED_CMDS = new Set(['grep'])
    if (!cmd[0] || !ALLOWED_CMDS.has(cmd[0])) {
      throw new Error(`fs:exec: command '${cmd[0]}' not permitted`)
    }
    const container = getDocker().getContainer(containerId)
    const result = await execInContainer(container, cmd)
    return { ok: result.ok, code: result.code, stdout: result.stdout }
  })

  // Phone server handlers
  ipcMain.handle('phone-server:start', () => startPhoneServer())
  ipcMain.handle('phone-server:stop', () => stopPhoneServer())
  ipcMain.handle('phone-server:status', () => getPhoneServerStatus())
}
