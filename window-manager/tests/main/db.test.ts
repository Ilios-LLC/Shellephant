import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from '../../src/main/db'

describe('db', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('creates the windows table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='windows'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('windows table has all expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('container_id')
    expect(names).toContain('created_at')
    expect(names).toContain('deleted_at')
  })

  it('getDb throws if initDb was not called', () => {
    closeDb()
    expect(() => getDb()).toThrow('Database not initialized')
  })

  it('creates the projects table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('projects table has all expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('git_url')
    expect(names).toContain('created_at')
    expect(names).toContain('deleted_at')
  })

  it('windows table has project_id column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('project_id')
  })

  it('creates the settings table on init', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['key', 'value', 'updated_at'])
    )
  })
})

describe('db migrations', () => {
  afterEach(() => {
    closeDb()
  })

  it('recreates a legacy windows table that lacks project_id', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, git_url TEXT)')
    pre.exec(`
      CREATE TABLE windows (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        container_id TEXT NOT NULL
      )
    `)
    pre.prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)').run('legacy', 'abc')
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const cols = migrated.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('project_id')
    const rows = migrated.prepare('SELECT * FROM windows').all()
    expect(rows).toHaveLength(0)

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })
})
