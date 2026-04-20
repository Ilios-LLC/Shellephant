export type ContainerStatus = 'running' | 'stopped' | 'unknown'
export type WindowStatus = ContainerStatus

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
  env_vars?: string | null
  group_id?: number | null
  kimi_system_prompt?: string | null
  created_at: string
}

export interface WindowRecord {
  id: number
  name: string
  project_id: number | null
  container_id: string
  ports?: string
  network_id?: string | null
  window_type: 'manual' | 'assisted'
  created_at: string
  status: WindowStatus
  projects: WindowProjectRecord[]
}

export interface TokenStatus {
  configured: boolean
  hint: string | null
}

export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDependencyContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  image: string
  tag: string
}

export interface WindowProjectRecord {
  id: number
  window_id: number
  project_id: number
  clone_path: string
  project_name?: string
  git_url?: string
}

export interface AssistedMessage {
  id: number
  window_id: number
  role: 'user' | 'assistant' | 'tool_result' | 'ping_user'
  content: string
  metadata: string | null
  created_at: string
}

export interface Api {
  // Projects
  createProject: (name: string, gitUrl: string, ports?: PortMapping[]) => Promise<ProjectRecord>
  listProjects: () => Promise<ProjectRecord[]>
  deleteProject: (id: number) => Promise<void>
  updateProject: (id: number, patch: { groupId: number | null }) => Promise<ProjectRecord>
  getProject: (id: number) => Promise<ProjectRecord | undefined>
  updateProjectEnvVars: (id: number, envVars: Record<string, string>) => Promise<void>
  updateProjectPorts: (id: number, ports: PortMapping[]) => Promise<void>
  createGroup: (name: string) => Promise<ProjectGroupRecord>
  listGroups: () => Promise<ProjectGroupRecord[]>

  // Windows
  createWindow: (name: string, projectIds: number[], withDeps?: boolean, branchOverrides?: Record<number, string>, windowType?: 'manual' | 'assisted', networkName?: string) => Promise<WindowRecord>
  listWindows: (projectId?: number) => Promise<WindowRecord[]>
  deleteWindow: (id: number) => Promise<void>
  onWindowCreateProgress: (callback: (step: string) => void) => void
  offWindowCreateProgress: () => void

  // Dependencies
  listDependencies: (projectId: number) => Promise<ProjectDependency[]>
  createDependency: (projectId: number, image: string, tag: string, envVars?: Record<string, string>) => Promise<ProjectDependency>
  deleteDependency: (id: number) => Promise<void>
  listWindowDeps: (windowId: number) => Promise<WindowDependencyContainer[]>
  updateDependency: (id: number, envVars: Record<string, string> | null) => Promise<ProjectDependency>
  getDepContainersStatus: (ids: string[]) => Promise<Record<string, ContainerStatus>>

  // Dep logs
  startDepLogs: (windowId: number, containerId: string) => Promise<void>
  stopDepLogs: (containerId: string) => void
  onDepLogsData: (callback: (containerId: string, chunk: string) => void) => void
  offDepLogsData: () => void

  // Git
  getCurrentBranch: (windowId: number) => Promise<string>
  getGitStatus: (windowId: number) => Promise<{ isDirty: boolean; added: number; deleted: number } | null>
  commit: (
    windowId: number,
    payload: { subject: string; body?: string }
  ) => Promise<{ ok: boolean; code: number; stdout: string }>
  push: (windowId: number) => Promise<{ ok: boolean; code: number; stdout: string; prUrl?: string }>
  getCurrentBranchProject: (windowId: number, projectId: number) => Promise<string>
  getGitStatusProject: (windowId: number, projectId: number) => Promise<{ isDirty: boolean; added: number; deleted: number } | null>
  commitProject: (windowId: number, projectId: number, payload: { subject: string; body?: string }) => Promise<{ ok: boolean; code: number; stdout: string }>
  pushProject: (windowId: number, projectId: number) => Promise<{ ok: boolean; code: number; stdout: string; prUrl?: string }>

  // Settings
  getGitHubPatStatus: () => Promise<TokenStatus>
  setGitHubPat: (pat: string) => Promise<TokenStatus>
  clearGitHubPat: () => Promise<TokenStatus>
  getClaudeTokenStatus: () => Promise<TokenStatus>
  setClaudeToken: (token: string) => Promise<TokenStatus>
  clearClaudeToken: () => Promise<TokenStatus>

  // Assisted window API
  assistedSend: (windowId: number, message: string) => Promise<void>
  assistedCancel: (windowId: number) => Promise<void>
  assistedResume: (windowId: number, message: string) => Promise<void>
  assistedHistory: (windowId: number) => Promise<AssistedMessage[]>
  onAssistedStreamChunk: (callback: (windowId: number, chunk: string) => void) => void
  offAssistedStreamChunk: () => void
  onAssistedKimiDelta: (callback: (windowId: number, delta: string) => void) => void
  offAssistedKimiDelta: () => void
  onAssistedPingUser: (callback: (windowId: number, message: string) => void) => void
  offAssistedPingUser: () => void
  onAssistedTurnComplete: (callback: (windowId: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) => void
  offAssistedTurnComplete: () => void

  // Settings — Fireworks
  getFireworksKeyStatus: () => Promise<TokenStatus>
  setFireworksKey: (key: string) => Promise<TokenStatus>
  clearFireworksKey: () => Promise<TokenStatus>

  // Settings — Kimi system prompt
  getKimiSystemPrompt: () => Promise<string | null>
  setKimiSystemPrompt: (prompt: string) => Promise<void>
  setProjectKimiSystemPrompt: (projectId: number, prompt: string | null) => Promise<void>

  // Terminal
  openTerminal: (containerId: string, cols: number, rows: number, displayName: string, sessionType?: string) => Promise<void>
  sendTerminalInput: (containerId: string, data: string, sessionType?: string) => void
  resizeTerminal: (containerId: string, cols: number, rows: number, sessionType?: string) => void
  closeTerminal: (containerId: string, sessionType?: string) => void
  onTerminalData: (callback: (containerId: string, sessionType: string, data: string) => void) => void
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
