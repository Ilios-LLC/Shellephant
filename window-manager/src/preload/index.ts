import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Project API
  createProject: (name: string, gitUrl: string) =>
    ipcRenderer.invoke('project:create', name, gitUrl),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: number) => ipcRenderer.invoke('project:delete', id),

  // Window API
  createWindow: (name: string, projectId: number) =>
    ipcRenderer.invoke('window:create', name, projectId),
  listWindows: (projectId?: number) => ipcRenderer.invoke('window:list', projectId),
  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),

  // Terminal API
  openTerminal: (containerId: string) => ipcRenderer.invoke('terminal:open', containerId),
  sendTerminalInput: (containerId: string, data: string) =>
    ipcRenderer.send('terminal:input', containerId, data),
  resizeTerminal: (containerId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', containerId, cols, rows),
  closeTerminal: (containerId: string) => ipcRenderer.send('terminal:close', containerId),
  onTerminalData: (callback: (containerId: string, data: string) => void) =>
    ipcRenderer.on('terminal:data', (_, containerId, data) => callback(containerId, data)),
  offTerminalData: () => ipcRenderer.removeAllListeners('terminal:data')
})
