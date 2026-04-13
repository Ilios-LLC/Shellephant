export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  created_at: string
}

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  created_at: string
  status: WindowStatus
}

export interface Api {
  // Projects
  createProject: (name: string, gitUrl: string) => Promise<ProjectRecord>
  listProjects: () => Promise<ProjectRecord[]>
  deleteProject: (id: number) => Promise<void>

  // Windows
  createWindow: (name: string, projectId: number) => Promise<WindowRecord>
  listWindows: (projectId?: number) => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>

  // Terminal
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
