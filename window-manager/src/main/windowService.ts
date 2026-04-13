import Dockerode from 'dockerode'
import { getDb } from './db'
import { extractRepoName } from './gitUrl'
import { closeTerminalSessionFor } from './terminalService'

export type WindowStatus = 'running' | 'stopped' | 'unknown'

export interface WindowRecord {
  id: number
  name: string
  project_id: number
  container_id: string
  created_at: string
  status: WindowStatus
}

let _docker: Dockerode | null = null
const statusMap = new Map<number, WindowStatus>()

// Test-only: reset in-memory statusMap between tests that re-init the DB.
export function __resetStatusMapForTests(): void {
  statusMap.clear()
}

function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}

export async function createWindow(name: string, projectId: number): Promise<WindowRecord> {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string } | undefined

  if (!project) throw new Error('Project not found')

  const repoName = extractRepoName(project.git_url)
  const clonePath = `/workspace/${repoName}`

  const container = await getDocker().createContainer({
    Image: 'cc',
    Tty: true,
    OpenStdin: true,
    StdinOnce: false
  })
  await container.start()

  // Clone repo inside container
  const cloneExec = await container.exec({
    Cmd: ['git', 'clone', project.git_url, clonePath],
    AttachStdout: true,
    AttachStderr: true
  })
  await cloneExec.start({})

  const result = db
    .prepare('INSERT INTO windows (name, project_id, container_id) VALUES (?, ?, ?)')
    .run(name, projectId, container.id)

  const id = result.lastInsertRowid as number
  statusMap.set(id, 'running')

  return {
    id,
    name,
    project_id: projectId,
    container_id: container.id,
    created_at: new Date().toISOString(),
    status: 'running' as WindowStatus
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
  let query = 'SELECT id, name, project_id, container_id, created_at FROM windows WHERE deleted_at IS NULL'
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
