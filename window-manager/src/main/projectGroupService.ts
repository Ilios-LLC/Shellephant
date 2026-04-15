import { getDb } from './db'

export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}

export function createGroup(name: string): ProjectGroupRecord {
  const trimmed = name.trim()
  const db = getDb()
  const { lastInsertRowid } = db
    .prepare('INSERT INTO project_groups (name) VALUES (?)')
    .run(trimmed)

  return db
    .prepare('SELECT id, name, created_at FROM project_groups WHERE id = ?')
    .get(lastInsertRowid) as ProjectGroupRecord
}

export function listGroups(): ProjectGroupRecord[] {
  return getDb()
    .prepare(
      'SELECT id, name, created_at FROM project_groups ORDER BY created_at ASC, id ASC'
    )
    .all() as ProjectGroupRecord[]
}
