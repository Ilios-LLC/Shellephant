import Database from 'better-sqlite3'

let _db: Database.Database | null = null

function col(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
}

function tableExists(db: Database.Database, name: string): boolean {
  return (db.pragma('table_list') as { name: string }[]).some(t => t.name === name)
}

function runColumnMigrations(db: Database.Database): void {
  if (!col(db, 'projects').includes('ports')) {
    db.exec('ALTER TABLE projects ADD COLUMN ports TEXT DEFAULT NULL')
  }
  if (!col(db, 'windows').includes('ports')) {
    db.exec('ALTER TABLE windows ADD COLUMN ports TEXT DEFAULT NULL')
  }
  if (!col(db, 'projects').includes('group_id')) {
    db.exec(
      'ALTER TABLE projects ADD COLUMN group_id INTEGER REFERENCES project_groups(id) DEFAULT NULL'
    )
  }
  if (!col(db, 'projects').includes('env_vars')) {
    db.exec('ALTER TABLE projects ADD COLUMN env_vars TEXT DEFAULT NULL')
  }
  if (!col(db, 'windows').includes('network_id')) {
    db.exec('ALTER TABLE windows ADD COLUMN network_id TEXT DEFAULT NULL')
  }
  if (!col(db, 'windows').includes('window_type')) {
    db.exec("ALTER TABLE windows ADD COLUMN window_type TEXT NOT NULL DEFAULT 'manual'")
  }
  if (!col(db, 'projects').includes('kimi_system_prompt')) {
    db.exec('ALTER TABLE projects ADD COLUMN kimi_system_prompt TEXT DEFAULT NULL')
  }
}

function makeWindowProjectIdNullable(db: Database.Database): void {
  const cols = db.pragma('table_info(windows)') as { name: string; notnull: number }[]
  const projectIdCol = cols.find(c => c.name === 'project_id')
  if (!projectIdCol || projectIdCol.notnull === 0) return

  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`
      BEGIN;
      DROP TABLE IF EXISTS windows_new;
      CREATE TABLE windows_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        project_id   INTEGER REFERENCES projects(id),
        container_id TEXT NOT NULL,
        ports        TEXT DEFAULT NULL,
        network_id   TEXT DEFAULT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at   DATETIME DEFAULT NULL
      );
      INSERT INTO windows_new
        SELECT id, name, project_id, container_id, ports, network_id, created_at, deleted_at
        FROM windows;
      DROP TABLE windows;
      ALTER TABLE windows_new RENAME TO windows;
      COMMIT;
    `)
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(`FK violations after windows migration: ${JSON.stringify(violations)}`)
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function backfillWindowProjects(db: Database.Database): void {
  if (!tableExists(db, 'window_projects')) return
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM window_projects').get() as { cnt: number }).cnt
  if (count > 0) return

  const wins = db.prepare(`
    SELECT w.id AS window_id, w.project_id, p.git_url
    FROM windows w JOIN projects p ON p.id = w.project_id
    WHERE w.deleted_at IS NULL AND w.project_id IS NOT NULL
  `).all() as { window_id: number; project_id: number; git_url: string }[]

  const insert = db.prepare(
    'INSERT OR IGNORE INTO window_projects (window_id, project_id, clone_path) VALUES (?, ?, ?)'
  )
  for (const win of wins) {
    const repoName = win.git_url.split('/').pop()?.replace(/\.git$/, '') ?? 'unknown'
    insert.run(win.window_id, win.project_id, `/workspace/${repoName}`)
  }
}

export function initDb(dbPath: string): void {
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      ports      TEXT DEFAULT NULL,
      env_vars   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  // Pre-project windows tables lack project_id — drop so CREATE below applies current schema
  const legacyWinCols = col(_db, 'windows')
  if (legacyWinCols.length > 0 && !legacyWinCols.includes('project_id')) {
    _db.exec('DROP TABLE windows')
  }
  _db.exec(`
    CREATE TABLE IF NOT EXISTS windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      project_id   INTEGER REFERENCES projects(id),
      container_id TEXT NOT NULL,
      ports        TEXT DEFAULT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at   DATETIME DEFAULT NULL
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      BLOB NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS project_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS project_dependencies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      image      TEXT NOT NULL,
      tag        TEXT NOT NULL DEFAULT 'latest',
      env_vars   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS window_dependency_containers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id     INTEGER NOT NULL REFERENCES windows(id),
      dependency_id INTEGER NOT NULL REFERENCES project_dependencies(id),
      container_id  TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS window_projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id  INTEGER NOT NULL REFERENCES windows(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      clone_path TEXT NOT NULL,
      UNIQUE(window_id, project_id)
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS assisted_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id  INTEGER NOT NULL REFERENCES windows(id),
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  runColumnMigrations(_db)
  makeWindowProjectIdNullable(_db)
  backfillWindowProjects(_db)
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized')
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
