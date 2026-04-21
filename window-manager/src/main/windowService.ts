import Dockerode from 'dockerode'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import path from 'path'
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

const execFileAsync = promisify(execFile)

export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowProjectRecord {
  id: number
  window_id: number
  project_id: number
  clone_path: string
  project_name?: string
  git_url?: string
}

export interface WindowRecord {
  id: number
  name: string
  project_id: number | null
  container_id: string
  ports?: string
  network_id?: string
  window_type: 'manual' | 'assisted'
  created_at: string
  status: WindowStatus
  projects: WindowProjectRecord[]
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

// The wrapper script is baked into the `cc` image at build time
// (files/Dockerfile), but image rebuilds lag behind edits to files/cw-claude-sdk.js —
// running containers end up with a stale wrapper that breaks CC session
// persistence (session_id stops flowing through the stdout `session_final`
// event). Inject the current host copy after `container.start()` so every
// assisted window gets the wrapper that matches the checked-in worker.
function resolveClaudeSdkWrapperPath(): string {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'cw-claude-sdk.js')
    if (existsSync(packaged)) return packaged
  }
  return path.join(__dirname, '../../../files/cw-claude-sdk.js')
}

async function injectClaudeSdkWrapper(containerId: string): Promise<void> {
  const src = resolveClaudeSdkWrapperPath()
  if (!existsSync(src)) throw new Error(`cw-claude-sdk.js not found at ${src}`)
  await execFileAsync('docker', ['cp', src, `${containerId}:/usr/local/bin/cw-claude-sdk.js`])
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
    await container.remove({ force: true, v: true }).catch(() => {})
  }
  if (networkId) {
    await getDocker().getNetwork(networkId).remove().catch(() => {})
  }
}

interface ProjectConfig {
  gitUrl: string
  slug: string
  clonePath: string
  projectPorts: PortMapping[]
  projectEnvVars: string[]
}

async function setupProjectWorkspace(
  container: Dockerode.Container,
  cfg: ProjectConfig,
  pat: string,
  remoteHasSlug: boolean,
  branchOverride: string | undefined,
  onProgress: ProgressReporter,
  isMulti: boolean
): Promise<void> {
  const repoLabel = cfg.gitUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo'
  onProgress(isMulti ? `Preparing ${repoLabel}…` : 'Preparing workspace…')
  const mkdir = await execInContainer(container, ['mkdir', '-p', cfg.clonePath])
  if (!mkdir.ok) throw new Error(`mkdir failed: ${mkdir.stdout}`)
  onProgress(isMulti ? `Cloning ${repoLabel}…` : 'Cloning repository in container…')
  await cloneInContainer(container, cfg.gitUrl, pat, cfg.clonePath)
  onProgress('Checking out branch…')
  if (branchOverride) {
    await checkoutSlug(container, cfg.clonePath, branchOverride, true)
  } else {
    await checkoutSlug(container, cfg.clonePath, cfg.slug, remoteHasSlug)
  }
}

function loadProjectConfig(projectId: number, name: string): ProjectConfig {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url, ports, env_vars FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string; ports: string | null; env_vars: string | null } | undefined
  if (!project) throw new Error('Project not found')

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
    slug,
    clonePath: `/workspace/${repoName}`,
    projectPorts,
    projectEnvVars
  }
}

export async function createWindow(
  name: string,
  projectIds: number | number[],
  withDeps: boolean = false,
  branchOverrides: Record<number, string> = {},
  onProgress: ProgressReporter = () => {},
  windowType: 'manual' | 'assisted' = 'manual',
  networkName: string = ''
): Promise<WindowRecord> {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds]
  if (ids.length === 0) throw new Error('At least one project required')

  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured. Open Settings to add one.')
  const claudeToken = getClaudeToken()
  if (!claudeToken) throw new Error('Claude token not configured. Open Settings to add one.')

  const isMulti = ids.length > 1

  const projectConfigs = ids.map(id => loadProjectConfig(id, name))

  const primaryCfg = projectConfigs[0]
  const { projectPorts, projectEnvVars } = isMulti
    ? { projectPorts: [] as PortMapping[], projectEnvVars: [] as string[] }
    : { projectPorts: primaryCfg.projectPorts, projectEnvVars: primaryCfg.projectEnvVars }

  const exposedPorts: Record<string, Record<string, never>> = {}
  const portBindings: Record<string, { HostPort: string }[]> = {}
  for (const pm of projectPorts) {
    exposedPorts[`${pm.container}/tcp`] = {}
    portBindings[`${pm.container}/tcp`] = [{ HostPort: pm.host !== undefined ? String(pm.host) : '' }]
  }

  onProgress('Probing remote for branch…')
  const remoteChecks = await Promise.all(
    projectConfigs.map((cfg, i) => {
      if (branchOverrides[ids[i]]) return Promise.resolve(false) // unused when override present
      return remoteBranchExists(cfg.gitUrl, cfg.slug, pat)
    })
  )

  let networkId: string | null = null
  const depContainerRecords: DepContainerRecord[] = []
  let container: Dockerode.Container | null = null

  try {
    if (withDeps && !isMulti) {
      const result = await createDepContainers(primaryCfg.slug, ids[0], onProgress)
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

    if (windowType === 'assisted') {
      await injectClaudeSdkWrapper(container.id)
    }

    if (networkId) {
      await getDocker().getNetwork(networkId).connect({ Container: container.id })
    } else if (networkName) {
      await getDocker().getNetwork(networkName).connect({ Container: container.id })
      networkId = networkName
    }

    const portsJson = await resolvePortsJson(container, projectPorts)

    for (let i = 0; i < projectConfigs.length; i++) {
      const cfg = projectConfigs[i]
      const branchOverride = branchOverrides[ids[i]]
      await setupProjectWorkspace(container, cfg, pat, remoteChecks[i], branchOverride, onProgress, isMulti)
    }

    try {
      const { name: gitName, email } = await getIdentity(pat)
      await applyGitIdentityInContainer(container, gitName, email)
    } catch (err) {
      console.warn('Failed to set git identity in container:', err)
    }

    onProgress('Finalizing…')
    return persistWindow(name, ids, projectConfigs.map(c => c.clonePath), container, portsJson, networkId, depContainerRecords, windowType)
  } catch (err) {
    await cleanupDepContainers(depContainerRecords, networkId)
    if (container) {
      await container.stop({ t: 1 }).catch(() => {})
      await container.remove({ force: true, v: true }).catch(() => {})
    }
    throw err
  }
}

function persistWindow(
  name: string,
  projectIds: number[],
  clonePaths: string[],
  container: Dockerode.Container,
  portsJson: string | null,
  networkId: string | null,
  depContainerRecords: DepContainerRecord[],
  windowType: 'manual' | 'assisted' = 'manual'
): WindowRecord {
  const db = getDb()
  const isMulti = projectIds.length > 1
  const projectId = isMulti ? null : projectIds[0]

  const result = db
    .prepare('INSERT INTO windows (name, project_id, container_id, ports, network_id, window_type) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, projectId, container.id, portsJson, networkId, windowType)
  const id = result.lastInsertRowid as number
  statusMap.set(id, 'running')

  const insertWp = db.prepare(
    'INSERT INTO window_projects (window_id, project_id, clone_path) VALUES (?, ?, ?)'
  )
  const wpRows: WindowProjectRecord[] = []
  for (let i = 0; i < projectIds.length; i++) {
    insertWp.run(id, projectIds[i], clonePaths[i])
    wpRows.push({ id: 0, window_id: id, project_id: projectIds[i], clone_path: clonePaths[i] })
  }

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
    window_type: windowType,
    created_at: new Date().toISOString(),
    status: 'running' as WindowStatus,
    projects: wpRows
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
  let windowQuery =
    'SELECT id, name, project_id, container_id, ports, network_id, window_type, created_at FROM windows WHERE deleted_at IS NULL'
  const params: number[] = []

  if (projectId !== undefined) {
    windowQuery += ' AND (project_id = ? OR id IN (SELECT window_id FROM window_projects WHERE project_id = ?))'
    params.push(projectId, projectId)
  }

  const windows = (db.prepare(windowQuery).all(...params) as Omit<WindowRecord, 'status' | 'projects'>[])

  const wpRows = db.prepare(`
    SELECT wp.id, wp.window_id, wp.project_id, wp.clone_path, p.name AS project_name, p.git_url
    FROM window_projects wp JOIN projects p ON p.id = wp.project_id
  `).all() as (WindowProjectRecord & { project_name: string; git_url: string })[]

  const wpByWindow = new Map<number, WindowProjectRecord[]>()
  for (const wp of wpRows) {
    const arr = wpByWindow.get(wp.window_id) ?? []
    arr.push(wp)
    wpByWindow.set(wp.window_id, arr)
  }

  return windows.map((r) => ({
    ...r,
    status: statusMap.get(r.id) ?? ('unknown' as WindowStatus),
    projects: wpByWindow.get(r.id) ?? []
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
      `SELECT w.id AS windowId, w.name AS windowName,
              COALESCE(p.id, p2.id) AS projectId,
              COALESCE(p.name, p2.name) AS projectName
       FROM windows w
       LEFT JOIN projects p ON p.id = w.project_id
       LEFT JOIN window_projects wp ON wp.window_id = w.id AND p.id IS NULL
       LEFT JOIN projects p2 ON p2.id = wp.project_id
       WHERE w.container_id = ? AND w.deleted_at IS NULL
       LIMIT 1`
    )
    .get(containerId) as Omit<WaitingWindowInfo, 'containerId'> | undefined
  if (!row || row.projectId == null) return null
  return { containerId, ...row }
}

export function getWindowTypeByContainerId(containerId: string): 'manual' | 'assisted' | null {
  const row = getDb()
    .prepare('SELECT window_type FROM windows WHERE container_id = ? AND deleted_at IS NULL LIMIT 1')
    .get(containerId) as { window_type: string } | undefined
  if (!row) return null
  return row.window_type as 'manual' | 'assisted'
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
    await c.remove({ force: true, v: true }).catch(() => {})
  }

  if (row.network_id) {
    const net = getDocker().getNetwork(row.network_id)
    await net.disconnect({ Container: row.container_id, Force: true }).catch(() => {})
    if (depContainers.length > 0) {
      await net.remove().catch(() => {})
    }
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
