import { getDb } from './db'

export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}

export function createGroup(name: string): ProjectGroupRecord {
  const trimmed = name.trim()
  const db = getDb()
  const result = db
    .prepare('INSERT INTO project_groups (name) VALUES (?)')
    .run(trimmed)

  return {
    id: result.lastInsertRowid as number,
    name: trimmed,
    created_at: new Date().toISOString()
  }
}

export function listGroups(): ProjectGroupRecord[] {
  return getDb()
    .prepare(
      'SELECT id, name, created_at FROM project_groups ORDER BY created_at ASC'
    )
    .all() as ProjectGroupRecord[]
}
