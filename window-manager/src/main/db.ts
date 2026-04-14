import Database from 'better-sqlite3'

let _db: Database.Database | null = null

export function initDb(dbPath: string): void {
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      git_url    TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    )
  `)
  // Pre-project windows tables lack project_id. Drop so the CREATE below
  // applies the current schema. Containers are ephemeral so data loss is fine.
  const winCols = _db.pragma('table_info(windows)') as { name: string }[]
  if (winCols.length > 0 && !winCols.some((c) => c.name === 'project_id')) {
    _db.exec('DROP TABLE windows')
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      project_id   INTEGER NOT NULL REFERENCES projects(id),
      container_id TEXT NOT NULL,
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
