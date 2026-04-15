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

  it('projects table has a ports column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('ports')
  })

  it('windows table has a ports column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('ports')
  })

  it('creates the project_groups table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_groups'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('project_groups table has expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(project_groups)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'created_at'])
    )
  })

  it('projects table has a group_id column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('group_id')
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

  it('adds ports column to projects and windows tables that lack it', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-ports-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        git_url    TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.exec(`
      CREATE TABLE windows (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        project_id   INTEGER NOT NULL,
        container_id TEXT NOT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at   DATETIME DEFAULT NULL
      )
    `)
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const projCols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    const winCols = migrated.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    expect(projCols.map((c) => c.name)).toContain('ports')
    expect(winCols.map((c) => c.name)).toContain('ports')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })

  it('adds group_id column to projects table that lacks it', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-groupid-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec(`
      CREATE TABLE project_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    pre.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        git_url    TEXT NOT NULL UNIQUE,
        ports      TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const cols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('group_id')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })
})
