import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  createWindow: (name: string) => ipcRenderer.invoke('window:create', name),

  listWindows: () => ipcRenderer.invoke('window:list'),

  deleteWindow: (id: number) => ipcRenderer.invoke('window:delete', id),

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
