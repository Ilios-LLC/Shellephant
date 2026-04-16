import Dockerode from 'dockerode'
import { getDb } from './db'
import { extractRepoName } from './gitUrl'
import { getGitHubPat, getClaudeToken } from './settingsService'
import { getIdentity } from './githubIdentity'
import { closeTerminalSessionFor } from './terminalService'
import { toSlug } from './slug'
import { remoteBranchExists, execInContainer, cloneInContainer, checkoutSlug, applyGitIdentityInContainer } from './gitOps'
import { getDocker } from './docker'
import { listDependencies, listWindowDepContainers } from './dependencyService'
import type { PortMapping } from './projectService'

export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  ports?: string
  network_id?: string
  created_at: string
  status: WindowStatus
}

const statusMap = new Map<number, WindowStatus>()

// Test-only: reset in-memory statusMap between tests that re-init the DB.
export function __resetStatusMapForTests(): void {
  statusMap.clear()
}

export type ProgressReporter = (step: string) => void

interface DepContainerRecord {
  depId: number
  containerId: string
  container: Dockerode.Container
}

async function pullImage(imageRef: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    getDocker().pull(imageRef, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) { reject(err); return }
      getDocker().modem.followProgress(stream, (err2: Error | null) => {
        if (err2) reject(err2); else resolve()
      })
    })
  })
}

async function createDepContainers(
  slug: string,
  projectId: number,
  onProgress: ProgressReporter
): Promise<{ networkId: string; depContainerRecords: DepContainerRecord[] }> {
  const deps = listDependencies(projectId)
  const depContainerRecords: DepContainerRecord[] = []

  if (deps.length === 0) return { networkId: '', depContainerRecords }

  onProgress('Creating bridge network…')
  const network = await getDocker().createNetwork({
    Name: `cw-${slug}-net`,
    Driver: 'bridge'
  })
  const networkId = network.id

  for (const dep of deps) {
    const imageRef = `${dep.image}:${dep.tag}`
    const basename = dep.image.split('/').pop()!
    onProgress(`Pulling ${imageRef}…`)
    await pullImage(imageRef)
    onProgress(`Starting ${imageRef}…`)
    const envVars: string[] = dep.env_vars
      ? Object.entries(dep.env_vars).map(([k, v]) => `${k}=${v}`)
      : []
    const depCtr = await getDocker().createContainer({
      Image: imageRef,
      name: `cw-${slug}-${basename}`,
      Env: envVars,
      HostConfig: { NetworkMode: `cw-${slug}-net` },
      NetworkingConfig: {
        EndpointsConfig: { [`cw-${slug}-net`]: { Aliases: [basename] } }
      }
    })
    await depCtr.start()
    depContainerRecords.push({ depId: dep.id, containerId: depCtr.id, container: depCtr })
  }

  return { networkId, depContainerRecords }
}

async function cleanupDepContainers(
  depContainerRecords: DepContainerRecord[],
  networkId: string | null
): Promise<void> {
  for (const { container } of depContainerRecords) {
    await container.stop({ t: 1 }).catch(() => {})
    await container.remove({ force: true }).catch(() => {})
  }
  if (networkId) {
    await getDocker().getNetwork(networkId).remove().catch(() => {})
  }
}

interface ProjectConfig {
  gitUrl: string
  pat: string
  claudeToken: string
  slug: string
  clonePath: string
  projectPorts: PortMapping[]
  projectEnvVars: string[]
}

function loadProjectConfig(projectId: number, name: string): ProjectConfig {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url, ports, env_vars FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string; ports: string | null; env_vars: string | null } | undefined
  if (!project) throw new Error('Project not found')

  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured. Open Settings to add one.')
  const claudeToken = getClaudeToken()
  if (!claudeToken) throw new Error('Claude token not configured. Open Settings to add one.')

  const slug = toSlug(name)
  const repoName = extractRepoName(project.git_url)
  const projectPorts: PortMapping[] = project.ports ? (JSON.parse(project.ports) as PortMapping[]) : []

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

  return {
    gitUrl: project.git_url,
    pat,
    claudeToken,
    slug,
    clonePath: `/workspace/${repoName}`,
    projectPorts,
    projectEnvVars
  }
}

export async function createWindow(
  name: string,
  projectId: number,
  withDeps: boolean = false,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
  const cfg = loadProjectConfig(projectId, name)
  const { gitUrl, pat, claudeToken, slug, clonePath, projectPorts, projectEnvVars } = cfg

  const exposedPorts: Record<string, Record<string, never>> = {}
  const portBindings: Record<string, { HostPort: string }[]> = {}
  for (const pm of projectPorts) {
    exposedPorts[`${pm.container}/tcp`] = {}
    portBindings[`${pm.container}/tcp`] = [{ HostPort: pm.host !== undefined ? String(pm.host) : '' }]
  }

  onProgress('Probing remote for branch…')
  const remoteHasSlug = await remoteBranchExists(gitUrl, slug, pat)

  let networkId: string | null = null
  const depContainerRecords: DepContainerRecord[] = []
  let container: Dockerode.Container | null = null

  try {
    if (withDeps) {
      const result = await createDepContainers(slug, projectId, onProgress)
      if (result.networkId) {
        networkId = result.networkId
        depContainerRecords.push(...result.depContainerRecords)
      }
    }

    onProgress('Starting dev container…')
    container = await getDocker().createContainer({
      Image: 'cc',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`, ...projectEnvVars],
      ...(projectPorts.length > 0 && { ExposedPorts: exposedPorts, HostConfig: { PortBindings: portBindings } })
    })
    await container.start()

    const portsJson = await resolvePortsJson(container, projectPorts)

    onProgress('Preparing workspace…')
    const mkdir = await execInContainer(container, ['mkdir', '-p', clonePath])
    if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.stdout}`)

    onProgress('Cloning repository in container…')
    await cloneInContainer(container, gitUrl, pat, clonePath)

    onProgress('Checking out branch…')
    await checkoutSlug(container, clonePath, slug, remoteHasSlug)

    try {
      const { name, email } = await getIdentity(pat)
      await applyGitIdentityInContainer(container, name, email)
    } catch (err) {
      console.warn('Failed to set git identity in container:', err)
    }

    onProgress('Finalizing…')
    return persistWindow(name, projectId, container, portsJson, networkId, depContainerRecords)
  } catch (err) {
    await cleanupDepContainers(depContainerRecords, networkId)
    if (container) {
      await container.stop({ t: 1 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    }
    throw err
  }
}

function persistWindow(
  name: string,
  projectId: number,
  container: Dockerode.Container,
  portsJson: string | null,
  networkId: string | null,
  depContainerRecords: DepContainerRecord[]
): WindowRecord {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO windows (name, project_id, container_id, ports, network_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, projectId, container.id, portsJson, networkId)
  const id = result.lastInsertRowid as number
  statusMap.set(id, 'running')

  for (const { depId, containerId } of depContainerRecords) {
    db.prepare(
      'INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)'
    ).run(id, depId, containerId)
  }

  return {
    id,
    name,
    project_id: projectId,
    container_id: container.id,
    ports: portsJson ?? undefined,
    created_at: new Date().toISOString(),
    status: 'running' as WindowStatus
  }
}

async function resolvePortsJson(
  container: Dockerode.Container,
  projectPorts: PortMapping[]
): Promise<string | null> {
  if (projectPorts.length === 0) return null
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
    return Object.keys(portMap).length > 0 ? JSON.stringify(portMap) : null
  } catch {
    // inspect failure should not abort window creation; ports will be unknown
    return null
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
    'SELECT id, name, project_id, container_id, ports, network_id, created_at FROM windows WHERE deleted_at IS NULL'
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
    .prepare('SELECT container_id, network_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string; network_id: string | null } | undefined

  if (!row) return

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)
  statusMap.delete(id)

  const depContainers = listWindowDepContainers(id)
  for (const dep of depContainers) {
    const c = getDocker().getContainer(dep.container_id)
    await c.stop({ t: 1 }).catch(() => {})
    await c.remove({ force: true }).catch(() => {})
  }

  if (row.network_id) {
    await getDocker().getNetwork(row.network_id).remove().catch(() => {})
  }

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
