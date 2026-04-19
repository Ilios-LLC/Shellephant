import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from '../../src/main/db'
import os from 'os'
import path from 'path'
import fs from 'fs'

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

  it('projects table has an env_vars column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('env_vars')
  })

  it('creates the project_dependencies table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_dependencies'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('project_dependencies table has expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(project_dependencies)').all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('project_id')
    expect(names).toContain('image')
    expect(names).toContain('tag')
    expect(names).toContain('env_vars')
    expect(names).toContain('created_at')
  })

  it('creates the window_dependency_containers table on init', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='window_dependency_containers'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('window_dependency_containers table has expected columns', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(window_dependency_containers)').all() as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('window_id')
    expect(names).toContain('dependency_id')
    expect(names).toContain('container_id')
    expect(names).toContain('created_at')
  })

  it('windows table has a network_id column', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('network_id')
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

  it('creates project_groups and adds group_id to a fully legacy database', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-fulllegacy-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        git_url    TEXT NOT NULL UNIQUE
      )
    `)
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const tables = migrated
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_groups'")
      .all()
    expect(tables).toHaveLength(1)
    const cols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('group_id')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })

  it('adds env_vars column to a projects table that lacks it', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-envvars-${Date.now()}.sqlite`)
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
        group_id   INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const cols = migrated.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('env_vars')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })

  it('adds network_id column to an existing windows table that lacks it', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-networkid-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec(`
      CREATE TABLE project_groups (id INTEGER PRIMARY KEY, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
    `)
    pre.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        git_url TEXT NOT NULL UNIQUE,
        ports TEXT DEFAULT NULL,
        group_id INTEGER DEFAULT NULL,
        env_vars TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.exec(`
      CREATE TABLE windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        project_id INTEGER NOT NULL,
        container_id TEXT NOT NULL,
        ports TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.close()

    initDb(tmpPath)
    const migrated = getDb()
    const cols = migrated.prepare('PRAGMA table_info(windows)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('network_id')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })
})

describe('db migrations — docker dependencies', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('tag column defaults to latest', () => {
    getDb().prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:o/r.git')").run()
    getDb().prepare("INSERT INTO project_dependencies (project_id, image) VALUES (1, 'postgres')").run()
    const row = getDb().prepare('SELECT tag FROM project_dependencies WHERE id = 1').get() as { tag: string }
    expect(row.tag).toBe('latest')
  })
})

describe('windows table — window_type', () => {
  let tmpPath: string

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `test-db-wtype-${Date.now()}.sqlite`)
    initDb(tmpPath)
  })

  afterEach(() => {
    closeDb()
    fs.unlinkSync(tmpPath)
  })

  it('has window_type column defaulting to manual', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w', ${projId}, 'c1')`)
    const row = db.prepare('SELECT window_type FROM windows WHERE container_id = ?').get('c1') as { window_type: string }
    expect(row.window_type).toBe('manual')
  })

  it('accepts assisted as window_type', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id, window_type) VALUES ('w', ${projId}, 'c2', 'assisted')`)
    const row = db.prepare('SELECT window_type FROM windows WHERE container_id = ?').get('c2') as { window_type: string }
    expect(row.window_type).toBe('assisted')
  })
})

describe('projects table — kimi_system_prompt', () => {
  let tmpPath: string

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `test-db-kimi-${Date.now()}.sqlite`)
    initDb(tmpPath)
  })

  afterEach(() => {
    closeDb()
    fs.unlinkSync(tmpPath)
  })

  it('has kimi_system_prompt column defaulting to null', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const row = db.prepare('SELECT kimi_system_prompt FROM projects WHERE name = ?').get('p') as { kimi_system_prompt: string | null }
    expect(row.kimi_system_prompt).toBeNull()
  })
})

describe('assisted_messages table', () => {
  let tmpPath: string

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `test-db-am-${Date.now()}.sqlite`)
    initDb(tmpPath)
  })

  afterEach(() => {
    closeDb()
    fs.unlinkSync(tmpPath)
  })

  it('stores messages with role and content', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w', ${projId}, 'c3')`)
    const winId = (db.prepare('SELECT id FROM windows WHERE container_id = ?').get('c3') as { id: number }).id
    db.exec(`INSERT INTO assisted_messages (window_id, role, content) VALUES (${winId}, 'user', 'hello')`)
    const row = db.prepare('SELECT role, content FROM assisted_messages WHERE window_id = ?').get(winId) as { role: string; content: string }
    expect(row.role).toBe('user')
    expect(row.content).toBe('hello')
  })

  it('stores metadata JSON', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p2', 'git@github.com:x/z.git')")
    const projId = (db.prepare("SELECT id FROM projects WHERE name='p2'").get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w2', ${projId}, 'c4')`)
    const winId = (db.prepare('SELECT id FROM windows WHERE container_id = ?').get('c4') as { id: number }).id
    const meta = JSON.stringify({ session_id: 'abc123', complete: true })
    db.exec(`INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (${winId}, 'tool_result', 'output', '${meta}')`)
    const row = db.prepare('SELECT metadata FROM assisted_messages WHERE window_id = ?').get(winId) as { metadata: string }
    expect(JSON.parse(row.metadata).session_id).toBe('abc123')
  })
})

describe('db — window_projects', () => {
  afterEach(() => closeDb())

  it('creates window_projects table on init', () => {
    initDb(':memory:')
    const tables = (getDb().pragma('table_list') as { name: string }[]).map(t => t.name)
    expect(tables).toContain('window_projects')
  })

  it('window_projects has expected columns', () => {
    initDb(':memory:')
    const cols = (getDb().pragma('table_info(window_projects)') as { name: string }[]).map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['id', 'window_id', 'project_id', 'clone_path']))
  })

  it('windows.project_id is nullable on fresh init', () => {
    initDb(':memory:')
    const cols = getDb().pragma('table_info(windows)') as { name: string; notnull: number }[]
    const col = cols.find(c => c.name === 'project_id')
    expect(col).toBeDefined()
    expect(col!.notnull).toBe(0)
  })

  it('makeWindowProjectIdNullable migrates existing DB with NOT NULL project_id', async () => {
    const Database = (await import('better-sqlite3')).default
    const path = await import('path')
    const os = await import('os')
    const fs = await import('fs')

    const tmpPath = path.join(os.tmpdir(), `cw-db-nullable-${Date.now()}.sqlite`)
    const pre = new Database(tmpPath)
    pre.exec(`CREATE TABLE project_groups (id INTEGER PRIMARY KEY, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
    pre.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, git_url TEXT NOT NULL UNIQUE, ports TEXT DEFAULT NULL, group_id INTEGER DEFAULT NULL, env_vars TEXT DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted_at DATETIME DEFAULT NULL)`)
    pre.exec(`
      CREATE TABLE windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        container_id TEXT NOT NULL,
        ports TEXT DEFAULT NULL,
        network_id TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `)
    pre.exec(`CREATE TABLE project_dependencies (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, image TEXT NOT NULL, tag TEXT NOT NULL DEFAULT 'latest', env_vars TEXT DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
    pre.exec(`CREATE TABLE window_dependency_containers (id INTEGER PRIMARY KEY, window_id INTEGER NOT NULL, dependency_id INTEGER NOT NULL, container_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
    const projId = pre.prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:org/myrepo.git')").run().lastInsertRowid
    pre.prepare("INSERT INTO windows (name, project_id, container_id) VALUES ('w', ?, 'ctr1')").run(projId)
    pre.close()

    initDb(tmpPath)
    const cols = getDb().pragma('table_info(windows)') as { name: string; notnull: number }[]
    const projectIdCol = cols.find(c => c.name === 'project_id')
    expect(projectIdCol!.notnull).toBe(0)

    // Existing window data preserved
    const wins = getDb().prepare('SELECT * FROM windows').all()
    expect(wins).toHaveLength(1)

    // Backfill: window_projects row created
    const wps = getDb().prepare('SELECT * FROM window_projects').all() as { window_id: number; project_id: number; clone_path: string }[]
    expect(wps).toHaveLength(1)
    expect(wps[0].project_id).toBe(Number(projId))
    expect(wps[0].clone_path).toBe('/workspace/myrepo')

    closeDb()
    fs.rmSync(tmpPath, { force: true })
  })
})
