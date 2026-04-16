import Dockerode from 'dockerode'
import { getDb } from './db'
import { extractRepoName } from './gitUrl'
import { getGitHubPat, getClaudeToken } from './settingsService'
import { closeTerminalSessionFor } from './terminalService'
import { toSlug } from './slug'
import { remoteBranchExists, execInContainer, cloneInContainer, checkoutSlug } from './gitOps'
import { getDocker } from './docker'
import type { PortMapping } from './projectService'

export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  created_at: string
  status: WindowStatus
}

const statusMap = new Map<number, WindowStatus>()

// Test-only: reset in-memory statusMap between tests that re-init the DB.
export function __resetStatusMapForTests(): void {
  statusMap.clear()
}

export type ProgressReporter = (step: string) => void

export async function createWindow(
  name: string,
  projectId: number,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url, ports, env_vars FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string; ports: string | null; env_vars: string | null } | undefined
  if (!project) throw new Error('Project not found')

  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured. Open Settings to add one.')
  const claudeToken = getClaudeToken()
  if (!claudeToken) {
    throw new Error('Claude token not configured. Open Settings to add one.')
  }

  const slug = toSlug(name)
  const repoName = extractRepoName(project.git_url)
  const clonePath = `/workspace/${repoName}`

  const projectPorts: PortMapping[] = project.ports ? (JSON.parse(project.ports) as PortMapping[]) : []
  const exposedPorts: Record<string, Record<string, never>> = {}
  const portBindings: Record<string, { HostPort: string }[]> = {}
  for (const pm of projectPorts) {
    exposedPorts[`${pm.container}/tcp`] = {}
    portBindings[`${pm.container}/tcp`] = [{ HostPort: pm.host !== undefined ? String(pm.host) : '' }]
  }

  let projectEnvVars: string[] = []
  if (project.env_vars) {
    try {
      projectEnvVars = Object.entries(JSON.parse(project.env_vars) as Record<string, string>).map(
        ([k, v]) => `${k}=${v}`
      )
    } catch {
      throw new Error(`Project ${projectId} has malformed env_vars JSON`)
    }
  }

  onProgress('Probing remote for branch…')
  const remoteHasSlug = await remoteBranchExists(project.git_url, slug, pat)

  let container: Dockerode.Container | null = null
  try {
    onProgress('Starting dev container…')
    container = await getDocker().createContainer({
      Image: 'cc',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`, ...projectEnvVars],
      ...(projectPorts.length > 0 && {
        ExposedPorts: exposedPorts,
        HostConfig: { PortBindings: portBindings }
      })
    })
    await container.start()

    let portsJson: string | null = null
    if (projectPorts.length > 0) {
      try {
        const containerInfo = await container.inspect()
        const portMap: Record<string, string> = {}
        const netPorts = (containerInfo.NetworkSettings?.Ports ?? {}) as Record<
          string,
          { HostPort: string }[] | null
        >
        for (const [key, bindings] of Object.entries(netPorts)) {
          if (bindings && bindings.length > 0) {
            portMap[key.replace('/tcp', '')] = bindings[0].HostPort
          }
        }
        portsJson = Object.keys(portMap).length > 0 ? JSON.stringify(portMap) : null
      } catch {
        // inspect failure should not abort window creation; ports will be unknown
        portsJson = null
      }
    }

    onProgress('Preparing workspace…')
    const mkdir = await execInContainer(container, ['mkdir', '-p', clonePath])
    if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.stdout}`)

    onProgress('Cloning repository in container…')
    await cloneInContainer(container, project.git_url, pat, clonePath)

    onProgress('Checking out branch…')
    await checkoutSlug(container, clonePath, slug, remoteHasSlug)

    onProgress('Finalizing…')
    const result = db
      .prepare('INSERT INTO windows (name, project_id, container_id, ports) VALUES (?, ?, ?, ?)')
      .run(name, projectId, container.id, portsJson)

    const id = result.lastInsertRowid as number
    statusMap.set(id, 'running')

    return {
      id,
      name,
      project_id: projectId,
      container_id: container.id,
      ports: portsJson ?? undefined,
      created_at: new Date().toISOString(),
      status: 'running' as WindowStatus
    }
  } catch (err) {
    if (container) {
      await container.stop({ t: 1 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    }
    throw err
  }
}

export async function reconcileWindows(): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, container_id FROM windows WHERE deleted_at IS NULL')
    .all() as { id: number; container_id: string }[]

  for (const row of rows) {
    try {
      const inspect = await getDocker().getContainer(row.container_id).inspect()
      if (inspect?.State?.Status === 'running') {
        statusMap.set(row.id, 'running')
      } else {
        db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(row.id)
        statusMap.delete(row.id)
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404) {
        db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(row.id)
        statusMap.delete(row.id)
      } else {
        statusMap.set(row.id, 'unknown')
      }
    }
  }
}

export function listWindows(projectId?: number): WindowRecord[] {
  const db = getDb()
  let query =
    'SELECT id, name, project_id, container_id, ports, created_at FROM windows WHERE deleted_at IS NULL'
  const params: number[] = []

  if (projectId !== undefined) {
    query += ' AND project_id = ?'
    params.push(projectId)
  }

  return (db.prepare(query).all(...params) as Omit<WindowRecord, 'status'>[]).map((r) => ({
    ...r,
    status: statusMap.get(r.id) ?? ('unknown' as WindowStatus)
  }))
}

export interface WaitingWindowInfo {
  containerId: string
  windowId: number
  windowName: string
  projectId: number
  projectName: string
}

export function getWaitingInfoByContainerId(containerId: string): WaitingWindowInfo | null {
  const row = getDb()
    .prepare(
      `SELECT w.id AS windowId, w.name AS windowName, p.id AS projectId, p.name AS projectName
       FROM windows w JOIN projects p ON p.id = w.project_id
       WHERE w.container_id = ? AND w.deleted_at IS NULL
       LIMIT 1`
    )
    .get(containerId) as Omit<WaitingWindowInfo, 'containerId'> | undefined
  if (!row) return null
  return { containerId, ...row }
}

export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string } | undefined

  if (!row) return // idempotent: no row to delete

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)
  statusMap.delete(id)

  try {
    await getDocker().getContainer(row.container_id).stop({ t: 1 })
  } catch {
    // Container may already be stopped or gone; ignore
  }

  try {
    closeTerminalSessionFor(row.container_id)
  } catch {
    // Idempotent; ignore
  }
}
