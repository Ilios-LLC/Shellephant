export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
}

export interface Api {
  createWindow: (name: string) => Promise<WindowRecord>
  listWindows: () => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>
  openTerminal: (containerId: string) => Promise<void>
  sendTerminalInput: (containerId: string, data: string) => void
  resizeTerminal: (containerId: string, cols: number, rows: number) => void
  closeTerminal: (containerId: string) => void
  onTerminalData: (callback: (containerId: string, data: string) => void) => void
  offTerminalData: () => void
}

declare global {
  interface Window {
    api: Api
  }
}
