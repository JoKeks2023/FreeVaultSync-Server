import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Use environment variables or defaults
const DEFAULT_DB_DIR = process.env.DB_DIR ?? path.resolve(process.cwd(), "data/db");
const DEFAULT_DB_FILE = process.env.DB_FILE ?? path.join(DEFAULT_DB_DIR, "freevault.db");

export type FileRow = {
  path: string;
  checksum: string;
  size: number;
  updated_at: number;
  updated_by?: string | null;
};

export type FileRowWithContent = FileRow & {
  content?: string;
};

export type VersionRow = {
  id: number;
  path: string;
  checksum: string;
  diff?: string | null;
  snapshot: 0 | 1;
  created_at: number;
  created_by?: string | null;
};

let db: any = null;

export function initDB() {
  if (db) return;

  if (!fs.existsSync(DEFAULT_DB_DIR)) {
    fs.mkdirSync(DEFAULT_DB_DIR, { recursive: true });
  }

  db = new Database(DEFAULT_DB_FILE);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      size INTEGER,
      updated_at INTEGER,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      checksum TEXT NOT NULL,
      diff TEXT,
      snapshot INTEGER DEFAULT 0,
      created_at INTEGER,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      platform TEXT,
      last_seen INTEGER,
      last_sync INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      path TEXT,
      device_id TEXT,
      detail TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS backup_destinations (
      id TEXT PRIMARY KEY,
      provider TEXT,
      access_token TEXT,
      refresh_token TEXT,
      last_backup INTEGER,
      enabled INTEGER DEFAULT 0
    );
  `);
}

export function listFiles(): FileRow[] {
  if (!db) initDB();
  const stmt = db!.prepare("SELECT path, checksum, size, updated_at, updated_by FROM files ORDER BY path ASC");
  return stmt.all();
}

export function getFile(pathName: string): FileRow | undefined {
  if (!db) initDB();
  const stmt = db!.prepare("SELECT path, checksum, size, updated_at, updated_by FROM files WHERE path = ?");
  return stmt.get(pathName);
}

export function upsertFile(row: Pick<FileRow, "path" | "checksum" | "size" | "updated_at" | "updated_by">) {
  if (!db) initDB();
  const insert = db!.prepare(`
    INSERT INTO files (path, checksum, size, updated_at, updated_by)
    VALUES (@path, @checksum, @size, @updated_at, @updated_by)
    ON CONFLICT(path) DO UPDATE SET
      checksum=excluded.checksum,
      size=excluded.size,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by
  `);
  return insert.run(row);
}

export function insertVersion(v: Omit<VersionRow, "id">) {
  if (!db) initDB();
  const stmt = db!.prepare(`
    INSERT INTO versions (path, checksum, diff, snapshot, created_at, created_by)
    VALUES (@path, @checksum, @diff, @snapshot, @created_at, @created_by)
  `);
  return stmt.run(v);
}

export function listVersions(pathName: string): VersionRow[] {
  if (!db) initDB();
  const stmt = db!.prepare("SELECT id, path, checksum, diff, snapshot, created_at, created_by FROM versions WHERE path = ? ORDER BY created_at DESC");
  return stmt.all(pathName);
}

// Backup destination management
export type BackupDestinationRow = {
  id: string;
  provider: string;
  access_token?: string;
  refresh_token?: string;
  tenant_id?: string;
  site_id?: string;
  bucket_name?: string;
  region?: string;
  secret_access_key?: string;
  last_backup?: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

export function upsertBackupDestination(row: Partial<BackupDestinationRow>) {
  if (!db) initDB();
  const stmt = db!.prepare(`
    INSERT INTO backup_destinations (id, provider, access_token, refresh_token, last_backup, enabled)
    VALUES (@id, @provider, @access_token, @refresh_token, @last_backup, @enabled)
    ON CONFLICT(id) DO UPDATE SET
      provider=excluded.provider,
      access_token=excluded.access_token,
      refresh_token=excluded.refresh_token,
      last_backup=excluded.last_backup,
      enabled=excluded.enabled
  `);
  return stmt.run(row);
}

export function getBackupDestination(id: string): BackupDestinationRow | undefined {
  if (!db) initDB();
  const stmt = db!.prepare("SELECT * FROM backup_destinations WHERE id = ?");
  return stmt.get(id);
}

export function listBackupDestinations(): BackupDestinationRow[] {
  if (!db) initDB();
  const stmt = db!.prepare("SELECT * FROM backup_destinations ORDER BY created_at DESC");
  return stmt.all();
}

export function deleteBackupDestination(id: string): void {
  if (!db) initDB();
  const stmt = db!.prepare("DELETE FROM backup_destinations WHERE id = ?");
  stmt.run(id);
}

export function updateBackupLastTime(id: string, timestamp: number): void {
  if (!db) initDB();
  const stmt = db!.prepare("UPDATE backup_destinations SET last_backup = ? WHERE id = ?");
  stmt.run(timestamp, id);
}

export default {
  initDB,
  listFiles,
  getFile,
  upsertFile,
  insertVersion,
  listVersions,
  upsertBackupDestination,
  getBackupDestination,
  listBackupDestinations,
  deleteBackupDestination,
  updateBackupLastTime,
};
