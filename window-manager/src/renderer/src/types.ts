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

export interface TokenStatus {
  configured: boolean
  hint: string | null
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
  onWindowCreateProgress: (callback: (step: string) => void) => void
  offWindowCreateProgress: () => void

  // Git
  getCurrentBranch: (windowId: number) => Promise<string>
  commit: (
    windowId: number,
    payload: { subject: string; body?: string }
  ) => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>
  push: (windowId: number) => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>

  // Settings
  getGitHubPatStatus: () => Promise<TokenStatus>
  setGitHubPat: (pat: string) => Promise<TokenStatus>
  clearGitHubPat: () => Promise<TokenStatus>
  getClaudeTokenStatus: () => Promise<TokenStatus>
  setClaudeToken: (token: string) => Promise<TokenStatus>
  clearClaudeToken: () => Promise<TokenStatus>

  // Terminal
  openTerminal: (containerId: string, cols: number, rows: number) => Promise<void>
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
