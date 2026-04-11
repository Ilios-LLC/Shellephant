import Dockerode from 'dockerode'
import { getDb } from './db'

export interface WindowRecord {
  id: number
  name: string
  container_id: string
  created_at: string
}

let _docker: Dockerode | null = null

function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}

export async function createWindow(name: string): Promise<WindowRecord> {
  const container = await getDocker().createContainer({
    Image: 'cc',
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
  })
  await container.start()

  const db = getDb()
  const result = db
    .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)')
    .run(name, container.id)

  return {
    id: result.lastInsertRowid as number,
    name,
    container_id: container.id,
    created_at: new Date().toISOString(),
  }
}

export function listWindows(): WindowRecord[] {
  return getDb()
    .prepare('SELECT id, name, container_id, created_at FROM windows WHERE deleted_at IS NULL')
    .all() as WindowRecord[]
}

export async function deleteWindow(id: number): Promise<void> {
  const db = getDb()
  const row = db
    .prepare('SELECT container_id FROM windows WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { container_id: string } | undefined

  if (!row) throw new Error(`Window ${id} not found`)

  db.prepare("UPDATE windows SET deleted_at = datetime('now') WHERE id = ?").run(id)

  try {
    await getDocker().getContainer(row.container_id).stop({ t: 1 })
  } catch {
    // Container may already be stopped; ignore
  }
}
