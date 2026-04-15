export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface PortMapping {
  container: number
  host?: number
}

export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}

export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  group_id?: number | null
  created_at: string
}

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  created_at: string
  status: WindowStatus
}

export interface TokenStatus {
  configured: boolean
  hint: string | null
}

export interface Api {
  // Projects
  createProject: (name: string, gitUrl: string, ports?: PortMapping[]) => Promise<ProjectRecord>
  listProjects: () => Promise<ProjectRecord[]>
  deleteProject: (id: number) => Promise<void>
  updateProject: (id: number, patch: { groupId: number | null }) => Promise<ProjectRecord>
  createGroup: (name: string) => Promise<ProjectGroupRecord>
  listGroups: () => Promise<ProjectGroupRecord[]>

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
  ) => Promise<{ ok: boolean; code: number; stdout: string }>
  push: (windowId: number) => Promise<{ ok: boolean; code: number; stdout: string; prUrl?: string }>

  // Settings
  getGitHubPatStatus: () => Promise<TokenStatus>
  setGitHubPat: (pat: string) => Promise<TokenStatus>
  clearGitHubPat: () => Promise<TokenStatus>
  getClaudeTokenStatus: () => Promise<TokenStatus>
  setClaudeToken: (token: string) => Promise<TokenStatus>
  clearClaudeToken: () => Promise<TokenStatus>

  // Terminal
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string) => Promise<void>
  sendTerminalInput: (containerId: string, data: string) => void
  resizeTerminal: (containerId: string, cols: number, rows: number) => void
  closeTerminal: (containerId: string) => void
  onTerminalData: (callback: (containerId: string, data: string) => void) => void
  offTerminalData: () => void
  onTerminalWaiting: (
    callback: (info: {
      containerId: string
      windowId: number
      windowName: string
      projectId: number
      projectName: string
    }) => void
  ) => void
  offTerminalWaiting: () => void
  onTerminalSummary: (
    callback: (data: { containerId: string; title: string; bullets: string[] }) => void
  ) => void
  offTerminalSummary: () => void

  // Focus
  setActiveContainer: (containerId: string | null) => void

  // File system (container exec bridge)
  listContainerDir: (containerId: string, path: string) => Promise<{ name: string; isDir: boolean }[]>
  readContainerFile: (containerId: string, path: string) => Promise<string>
  writeContainerFile: (containerId: string, path: string, content: string) => Promise<void>

  // Shell
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    api: Api
  }
}
