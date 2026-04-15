import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Project API
  createProject: (name: string, gitUrl: string, ports?: number[]) =>
    ipcRenderer.invoke('project:create', name, gitUrl, ports),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: number) => ipcRenderer.invoke('project:delete', id),

  // Window API
  createWindow: (name: string, projectId: number) =>
    ipcRenderer.invoke('window:create', name, projectId),
  listWindows: (projectId?: number) => ipcRenderer.invoke('window:list', projectId),
  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),
  onWindowCreateProgress: (callback: (step: string) => void) =>
    ipcRenderer.on('window:create-progress', (_, step: string) => callback(step)),
  offWindowCreateProgress: () => ipcRenderer.removeAllListeners('window:create-progress'),

  // Git API
  getCurrentBranch: (windowId: number) => ipcRenderer.invoke('git:current-branch', windowId),
  commit: (windowId: number, payload: { subject: string; body?: string }) =>
    ipcRenderer.invoke('git:commit', windowId, payload),
  push: (windowId: number) => ipcRenderer.invoke('git:push', windowId),

  // Settings API
  getGitHubPatStatus: () => ipcRenderer.invoke('settings:get-github-pat-status'),
  setGitHubPat: (pat: string) => ipcRenderer.invoke('settings:set-github-pat', pat),
  clearGitHubPat: () => ipcRenderer.invoke('settings:clear-github-pat'),
  getClaudeTokenStatus: () => ipcRenderer.invoke('settings:get-claude-token-status'),
  setClaudeToken: (token: string) => ipcRenderer.invoke('settings:set-claude-token', token),
  clearClaudeToken: () => ipcRenderer.invoke('settings:clear-claude-token'),

  // Terminal API
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string) =>
    ipcRenderer.invoke('terminal:open', containerId, cols, rows, displayName),
  sendTerminalInput: (containerId: string, data: string) =>
    ipcRenderer.send('terminal:input', containerId, data),
  resizeTerminal: (containerId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows),
  closeTerminal: (containerId: string) => ipcRenderer.send('terminal:close', containerId),
  onTerminalData: (callback: (containerId: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, data) => callback(containerId, data)),
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
})
