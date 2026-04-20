import { contextBridge, ipcRenderer } from 'electron'
import type { TimelineEvent } from '../shared/timelineEvent'

contextBridge.exposeInMainWorld('api', {
  // Project API
  createProject: (name: string, gitUrl: string, ports?: number[]) =>
    ipcRenderer.invoke('project:create', name, gitUrl, ports),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: number) => ipcRenderer.invoke('project:delete', id),
  updateProject: (id: number, patch: { groupId: number | null }) =>
    ipcRenderer.invoke('project:update', id, patch),
  getProject: (id: number) => ipcRenderer.invoke('project:get', id),
  updateProjectEnvVars: (id: number, envVars: Record<string, string>) =>
    ipcRenderer.invoke('project:update-env-vars', id, envVars),
  updateProjectPorts: (id: number, ports: { container: number; host?: number }[]) =>
    ipcRenderer.invoke('project:update-ports', id, ports),
  updateProjectDefaultNetwork: (id: number, network: string | null) =>
    ipcRenderer.invoke('project:update-default-network', id, network),
  listDockerNetworks: () => ipcRenderer.invoke('docker:list-bridge-networks'),

  // Group API
  createGroup: (name: string) => ipcRenderer.invoke('group:create', name),
  listGroups: () => ipcRenderer.invoke('group:list'),

  // Window API
  createWindow: (name: string, projectIds: number[], withDeps: boolean = false, branchOverrides: Record<number, string> = {}, networkName: string = '') =>
    ipcRenderer.invoke('window:create', name, projectIds, withDeps, branchOverrides, networkName),
  listWindows: (projectId?: number) => ipcRenderer.invoke('window:list', projectId),
  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),
  onWindowCreateProgress: (callback: (step: string) => void) =>
    ipcRenderer.on('window:create-progress', (_, step: string) => callback(step)),
  offWindowCreateProgress: () => ipcRenderer.removeAllListeners('window:create-progress'),

  // Git API
  getCurrentBranch: (windowId: number) => ipcRenderer.invoke('git:current-branch', windowId),
  getGitStatus: (windowId: number) => ipcRenderer.invoke('git:status', windowId),
  commit: (windowId: number, payload: { subject: string; body?: string }) =>
    ipcRenderer.invoke('git:commit', windowId, payload),
  push: (windowId: number) => ipcRenderer.invoke('git:push', windowId),
  listRemoteBranches: (gitUrl: string) =>
    ipcRenderer.invoke('git:list-branches', gitUrl),
  getCurrentBranchProject: (windowId: number, projectId: number) =>
    ipcRenderer.invoke('git:current-branch-project', windowId, projectId),
  getGitStatusProject: (windowId: number, projectId: number) =>
    ipcRenderer.invoke('git:status-project', windowId, projectId),
  commitProject: (windowId: number, projectId: number, payload: { subject: string; body?: string }) =>
    ipcRenderer.invoke('git:commit-project', windowId, projectId, payload),
  pushProject: (windowId: number, projectId: number) =>
    ipcRenderer.invoke('git:push-project', windowId, projectId),

  // Settings API
  getGitHubPatStatus: () => ipcRenderer.invoke('settings:get-github-pat-status'),
  setGitHubPat: (pat: string) => ipcRenderer.invoke('settings:set-github-pat', pat),
  clearGitHubPat: () => ipcRenderer.invoke('settings:clear-github-pat'),
  getClaudeTokenStatus: () => ipcRenderer.invoke('settings:get-claude-token-status'),
  setClaudeToken: (token: string) => ipcRenderer.invoke('settings:set-claude-token', token),
  clearClaudeToken: () => ipcRenderer.invoke('settings:clear-claude-token'),

  // Fireworks API key
  getFireworksKeyStatus: () => ipcRenderer.invoke('settings:get-fireworks-key-status'),
  setFireworksKey: (key: string) => ipcRenderer.invoke('settings:set-fireworks-key', key),
  clearFireworksKey: () => ipcRenderer.invoke('settings:clear-fireworks-key'),

  // Kimi system prompt
  getKimiSystemPrompt: () => ipcRenderer.invoke('settings:get-kimi-system-prompt'),
  setKimiSystemPrompt: (prompt: string) => ipcRenderer.invoke('settings:set-kimi-system-prompt', prompt),
  setProjectKimiSystemPrompt: (projectId: number, prompt: string | null) =>
    ipcRenderer.invoke('project:set-kimi-system-prompt', projectId, prompt),

  // Terminal API
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string, sessionType: string = 'terminal') =>
    ipcRenderer.invoke('terminal:open', containerId, cols, rows, displayName, sessionType),
  sendTerminalInput: (containerId: string, data: string, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:input', containerId, data, sessionType),
  resizeTerminal: (containerId: string, cols: number, rows: number, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows, sessionType),
  closeTerminal: (containerId: string, sessionType: string = 'terminal') =>
    ipcRenderer.send('terminal:close', containerId, sessionType),
  onTerminalData: (callback: (containerId: string, sessionType: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, sessionType, data) => callback(containerId, sessionType, data)),
  offTerminalData: () => ipcRenderer.removeAllListeners('terminal:data'),
  onTerminalWaiting: (
    callback: (info: {
      containerId: string
      windowId: number
      windowName: string
      projectId: number
      projectName: string
    }) => void
  ) => ipcRenderer.on('terminal:waiting', (_, info) => callback(info)),
  offTerminalWaiting: () => ipcRenderer.removeAllListeners('terminal:waiting'),
  onTerminalSummary: (
    callback: (data: { containerId: string; title: string; bullets: string[] }) => void
  ) => ipcRenderer.on('terminal:summary', (_, data) => callback(data)),
  offTerminalSummary: () => ipcRenderer.removeAllListeners('terminal:summary'),

  // Focus API — tells main which container the user is currently viewing,
  // so OS notifications are suppressed for the window already on screen.
  setActiveContainer: (containerId: string | null) =>
    ipcRenderer.send('focus:active-container', containerId),

  // File system API (container exec bridge)
  listContainerDir: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:list-dir', containerId, path),
  readContainerFile: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:read-file', containerId, path),
  writeContainerFile: (containerId: string, path: string, content: string) =>
    ipcRenderer.invoke('fs:write-file', containerId, path, content),
  createContainerFile: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:create-file', containerId, path),
  createContainerDir: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:create-dir', containerId, path),
  deleteContainerPath: (containerId: string, path: string) =>
    ipcRenderer.invoke('fs:delete', containerId, path),
  renameContainerPath: (containerId: string, oldPath: string, newPath: string) =>
    ipcRenderer.invoke('fs:rename', containerId, oldPath, newPath),
  execInContainer: (containerId: string, cmd: string[]) =>
    ipcRenderer.invoke('fs:exec', containerId, cmd),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Dependency API
  listDependencies: (projectId: number) =>
    ipcRenderer.invoke('project:dep-list', projectId),
  createDependency: (
    projectId: number,
    image: string,
    tag: string,
    envVars?: Record<string, string>
  ) => ipcRenderer.invoke('project:dep-create', projectId, image, tag, envVars),
  deleteDependency: (id: number) => ipcRenderer.invoke('project:dep-delete', id),
  listWindowDeps: (windowId: number) =>
    ipcRenderer.invoke('window:dep-containers-list', windowId),
  updateDependency: (id: number, envVars: Record<string, string> | null) =>
    ipcRenderer.invoke('project:dep-update', id, envVars),
  getDepContainersStatus: (ids: string[]) =>
    ipcRenderer.invoke('window:dep-containers-status', ids),

  // Dep logs API
  startDepLogs: (_windowId: number, containerId: string) =>
    ipcRenderer.invoke('window:dep-logs-start', containerId),
  stopDepLogs: (containerId: string) =>
    ipcRenderer.send('window:dep-logs-stop', containerId),
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) =>
    ipcRenderer.on('window:dep-logs-data', (_, containerId, chunk) => callback(containerId, chunk)),
  offDepLogsData: () => ipcRenderer.removeAllListeners('window:dep-logs-data'),

  // Phone server API
  startPhoneServer: (): Promise<{ url: string }> =>
    ipcRenderer.invoke('phone-server:start'),
  stopPhoneServer: (): Promise<void> =>
    ipcRenderer.invoke('phone-server:stop'),
  getPhoneServerStatus: (): Promise<{ active: boolean; url?: string }> =>
    ipcRenderer.invoke('phone-server:status'),

  // Assisted window
  assistedSend: (windowId: number, message: string) =>
    ipcRenderer.invoke('assisted:send', windowId, message),
  assistedCancel: (windowId: number) => ipcRenderer.invoke('assisted:cancel', windowId),
  assistedHistory: (windowId: number) => ipcRenderer.invoke('assisted:history', windowId),
  onAssistedKimiDelta: (callback: (windowId: number, delta: string) => void) =>
    ipcRenderer.on('assisted:kimi-delta', (_, windowId, delta) => callback(windowId, delta)),
  offAssistedKimiDelta: () => ipcRenderer.removeAllListeners('assisted:kimi-delta'),
  onAssistedTurnComplete: (callback: (windowId: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) =>
    ipcRenderer.on('assisted:turn-complete', (_, windowId, stats, error) => callback(windowId, stats, error)),
  offAssistedTurnComplete: () => ipcRenderer.removeAllListeners('assisted:turn-complete'),
  onShellephantToClaude: (callback: (windowId: number, message: string) => void) =>
    ipcRenderer.on('shellephant:to-claude', (_, windowId, message) => callback(windowId, message)),
  offShellephantToClaude: () => ipcRenderer.removeAllListeners('shellephant:to-claude'),

  // Direct Claude window
  claudeSend: (windowId: number, message: string, permissionMode?: 'bypassPermissions' | 'plan') =>
    ipcRenderer.invoke('claude:send', windowId, message, permissionMode),
  claudeCancel: (windowId: number) => ipcRenderer.invoke('claude:cancel', windowId),
  onClaudeDelta: (callback: (windowId: number, chunk: string) => void) =>
    ipcRenderer.on('claude:delta', (_, windowId, chunk) => callback(windowId, chunk)),
  offClaudeDelta: () => ipcRenderer.removeAllListeners('claude:delta'),
  onClaudeAction: (callback: (windowId: number, action: { actionType: string; summary: string; detail: string }) => void) =>
    ipcRenderer.on('claude:action', (_, windowId, action) => callback(windowId, action)),
  offClaudeAction: () => ipcRenderer.removeAllListeners('claude:action'),
  onClaudeTurnComplete: (callback: (windowId: number) => void) =>
    ipcRenderer.on('claude:turn-complete', (_, windowId) => callback(windowId)),
  offClaudeTurnComplete: () => ipcRenderer.removeAllListeners('claude:turn-complete'),
  onClaudeError: (callback: (windowId: number, error: string) => void) =>
    ipcRenderer.on('claude:error', (_, windowId, error) => callback(windowId, error)),
  offClaudeError: () => ipcRenderer.removeAllListeners('claude:error'),
  onClaudeToShellephantDelta: (callback: (windowId: number, chunk: string) => void) =>
    ipcRenderer.on('claude-to-shellephant:delta', (_, windowId, chunk) => callback(windowId, chunk)),
  offClaudeToShellephantDelta: () => ipcRenderer.removeAllListeners('claude-to-shellephant:delta'),
  onClaudeToShellephantAction: (callback: (windowId: number, action: { actionType: string; summary: string; detail: string }) => void) =>
    ipcRenderer.on('claude-to-shellephant:action', (_, windowId, action) => callback(windowId, action)),
  offClaudeToShellephantAction: () => ipcRenderer.removeAllListeners('claude-to-shellephant:action'),
  onClaudeToShellephantTurnComplete: (callback: (windowId: number) => void) =>
    ipcRenderer.on('claude-to-shellephant:turn-complete', (_, windowId) => callback(windowId)),
  offClaudeToShellephantTurnComplete: () => ipcRenderer.removeAllListeners('claude-to-shellephant:turn-complete'),

  // Observability / Logs
  listTurns: (filter?: {
    windowId?: number
    status?: string
    turnType?: string
    limit?: number
    offset?: number
  }) => ipcRenderer.invoke('logs:list-turns', filter),

  getTurnEvents: (turnId: string) =>
    ipcRenderer.invoke('logs:get-turn-events', turnId),

  onTurnStarted: (cb: (turn: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, turn: unknown) => cb(turn)
    ipcRenderer.on('logs:turn-started', handler)
    return () => ipcRenderer.off('logs:turn-started', handler)
  },

  onTurnUpdated: (cb: (patch: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, patch: unknown) => cb(patch)
    ipcRenderer.on('logs:turn-updated', handler)
    return () => ipcRenderer.off('logs:turn-updated', handler)
  },

  onTurnEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, logEvent: unknown) => cb(logEvent)
    ipcRenderer.on('logs:turn-event', handler)
    return () => ipcRenderer.off('logs:turn-event', handler)
  }
})
