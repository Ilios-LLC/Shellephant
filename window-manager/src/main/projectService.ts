import { execFile } from 'child_process'
import { getDb } from './db'
import { isValidSshUrl, extractRepoName, sshUrlToHttps } from './gitUrl'
import { deleteWindow, listWindows } from './windowService'
import { getGitHubPat, getClaudeToken } from './settingsService'

export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  group_id?: number | null
  created_at: string
}

function verifyRemote(httpsUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['ls-remote', '--exit-code', httpsUrl],
      { timeout: 15_000 },
      (err) => {
        if (err) reject(new Error('Repository not accessible'))
        else resolve()
      }
    )
  })
}

export async function createProject(
  name: string,
  gitUrl: string,
  ports?: number[]
): Promise<ProjectRecord> {
  if (!isValidSshUrl(gitUrl)) {
    throw new Error('Invalid SSH URL format. Expected: git@host:org/repo.git')
  }

  if (ports && ports.length > 0) {
    for (const p of ports) {
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error(`Invalid port: ${p}. Must be integer between 1 and 65535.`)
      }
    }
  }

  const resolvedName = name.trim() || extractRepoName(gitUrl)

  const pat = getGitHubPat()
  if (!pat) {
    throw new Error('GitHub PAT not configured. Open Settings to add one.')
  }
  if (!getClaudeToken()) {
    throw new Error('Claude token not configured. Open Settings to add one.')
  }
  await verifyRemote(sshUrlToHttps(gitUrl, pat))

  const portsJson = ports && ports.length > 0 ? JSON.stringify(ports) : null
  const db = getDb()
  try {
    const result = db
      .prepare('INSERT INTO projects (name, git_url, ports) VALUES (?, ?, ?)')
      .run(resolvedName, gitUrl, portsJson)

    return {
      id: result.lastInsertRowid as number,
      name: resolvedName,
      git_url: gitUrl,
      ports: portsJson ?? undefined,
      group_id: null,
      created_at: new Date().toISOString()
    }
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE constraint failed')) {
      throw new Error('Project already exists for this git URL')
    }
    throw err
  }
}

export function listProjects(): ProjectRecord[] {
  return getDb()
    .prepare(
      'SELECT id, name, git_url, ports, group_id, created_at FROM projects WHERE deleted_at IS NULL'
    )
    .all() as ProjectRecord[]
}

export function updateProject(id: number, patch: { groupId: number | null }): ProjectRecord {
  const db = getDb()
  db.prepare('UPDATE projects SET group_id = ? WHERE id = ? AND deleted_at IS NULL').run(
    patch.groupId,
    id
  )
  const record = db
    .prepare(
      'SELECT id, name, git_url, ports, group_id, created_at FROM projects WHERE id = ? AND deleted_at IS NULL'
    )
    .get(id) as ProjectRecord | undefined
  if (!record) throw new Error(`Project ${id} not found`)
  return record
}

export async function deleteProject(id: number): Promise<void> {
  const db = getDb()
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { id: number } | undefined

  if (!project) return // idempotent

  // Cascade delete all windows belonging to this project
  const windows = listWindows(id)
  for (const win of windows) {
    await deleteWindow(win.id)
  }

  db.prepare("UPDATE projects SET deleted_at = datetime('now') WHERE id = ?").run(
    id
  )
}
