import Dockerode from 'dockerode'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { getDb } from './db'
import { extractRepoName, sshUrlToHttps } from './gitUrl'
import { getGitHubPat, getClaudeToken } from './settingsService'
import { closeTerminalSessionFor } from './terminalService'

const execFileP = promisify(execFile)

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

async function cloneOnHost(sshUrl: string, pat: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `cw-clone-${randomUUID()}`)
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  await execFileP('git', ['clone', httpsUrl, dir], { timeout: 60_000 })
  // Strip PAT from remote URL so it isn't embedded in .git/config.
  await execFileP('git', ['-C', dir, 'remote', 'set-url', 'origin', sshUrl], {
    timeout: 15_000
  })
  return dir
}

export type ProgressReporter = (step: string) => void

export async function createWindow(
  name: string,
  projectId: number,
  onProgress: ProgressReporter = () => {}
): Promise<WindowRecord> {
  const db = getDb()
  const project = db
    .prepare('SELECT git_url FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { git_url: string } | undefined

  if (!project) throw new Error('Project not found')

  const pat = getGitHubPat()
  if (!pat) throw new Error('GitHub PAT not configured. Open Settings to add one.')
  const claudeToken = getClaudeToken()
  if (!claudeToken) {
    throw new Error('Claude token not configured. Open Settings to add one.')
  }

  const repoName = extractRepoName(project.git_url)
  const clonePath = `/workspace/${repoName}`

  let tempDir: string | null = null
  try {
    onProgress('Cloning repository on host…')
    tempDir = await cloneOnHost(project.git_url, pat)

    onProgress('Starting dev container…')
    const container = await getDocker().createContainer({
      Image: 'cc',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`]
    })
    await container.start()

    onProgress('Copying files into container…')
    const mkdirExec = await container.exec({
      Cmd: ['mkdir', '-p', clonePath],
      AttachStdout: true,
      AttachStderr: true
    })
    await mkdirExec.start({})

    await execFileP('docker', ['cp', `${tempDir}/.`, `${container.id}:${clonePath}`], {
      timeout: 60_000
    })

    onProgress('Finalizing…')
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
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
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
