import Database from 'better-sqlite3'

let _db: Database.Database | null = null

function col(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
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
      project_id   INTEGER NOT NULL REFERENCES projects(id),
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
  runColumnMigrations(_db)
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
