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

export type DeviceRow = {
  id: string;
  name?: string | null;
  platform?: string | null;
  device_type?: string | null;
  model?: string | null;
  last_seen?: number | null;
  last_sync?: number | null;
};

export type AdminStatsRow = {
  files: number;
  versions: number;
  devices: number;
  backup_destinations: number;
  sync_events: number;
  storage_bytes: number;
  last_file_update_at: number | null;
  last_sync_at: number | null;
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
      device_type TEXT,
      model TEXT,
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

  const deviceColumns = [
    ["device_type", "TEXT"],
    ["model", "TEXT"],
  ] as const;

  for (const [columnName, columnType] of deviceColumns) {
    try {
      db!.prepare(`ALTER TABLE devices ADD COLUMN ${columnName} ${columnType}`).run();
    } catch {
      // Column already exists or migration was applied earlier.
    }
  }
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

export function listDevices(): DeviceRow[] {
  if (!db) initDB();
  const stmt = db!.prepare(`
    SELECT id, name, platform, device_type, model, last_seen, last_sync
    FROM devices
    ORDER BY COALESCE(last_seen, 0) DESC, id ASC
  `);
  return stmt.all();
}

export function getDevice(id: string): DeviceRow | undefined {
  if (!db) initDB();
  const stmt = db!.prepare(`
    SELECT id, name, platform, device_type, model, last_seen, last_sync
    FROM devices
    WHERE id = ?
  `);
  return stmt.get(id);
}

export function upsertDevice(row: DeviceRow) {
  if (!db) initDB();
  const stmt = db!.prepare(`
    INSERT INTO devices (id, name, platform, device_type, model, last_seen, last_sync)
    VALUES (@id, @name, @platform, @device_type, @model, @last_seen, @last_sync)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      platform=excluded.platform,
      device_type=excluded.device_type,
      model=excluded.model,
      last_seen=excluded.last_seen,
      last_sync=excluded.last_sync
  `);
  return stmt.run(row);
}

export function touchDevice(id: string, timestamp: number = Date.now()) {
  if (!db) initDB();
  const stmt = db!.prepare(`
    UPDATE devices
    SET last_seen = ?
    WHERE id = ?
  `);
  return stmt.run(timestamp, id);
}

export function markDeviceSync(id: string, timestamp: number = Date.now()) {
  if (!db) initDB();
  const stmt = db!.prepare(`
    UPDATE devices
    SET last_sync = ?, last_seen = ?
    WHERE id = ?
  `);
  return stmt.run(timestamp, timestamp, id);
}

export function listAdminStats(): AdminStatsRow {
  if (!db) initDB();

  const filesCount = db!.prepare("SELECT COUNT(*) AS value FROM files").get() as { value: number };
  const versionsCount = db!.prepare("SELECT COUNT(*) AS value FROM versions").get() as { value: number };
  const devicesCount = db!.prepare("SELECT COUNT(*) AS value FROM devices").get() as { value: number };
  const backupCount = db!.prepare("SELECT COUNT(*) AS value FROM backup_destinations").get() as { value: number };
  const syncEventsCount = db!.prepare("SELECT COUNT(*) AS value FROM sync_log").get() as { value: number };
  const storageBytes = db!.prepare("SELECT COALESCE(SUM(size), 0) AS value FROM files").get() as { value: number };
  const lastFileUpdate = db!.prepare("SELECT MAX(updated_at) AS value FROM files").get() as { value: number | null };
  const lastSyncAt = db!.prepare("SELECT MAX(last_sync) AS value FROM devices").get() as { value: number | null };

  return {
    files: filesCount.value ?? 0,
    versions: versionsCount.value ?? 0,
    devices: devicesCount.value ?? 0,
    backup_destinations: backupCount.value ?? 0,
    sync_events: syncEventsCount.value ?? 0,
    storage_bytes: storageBytes.value ?? 0,
    last_file_update_at: lastFileUpdate.value ?? null,
    last_sync_at: lastSyncAt.value ?? null,
  };
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
  listDevices,
  getDevice,
  upsertDevice,
  touchDevice,
  markDeviceSync,
  listAdminStats,
  upsertBackupDestination,
  getBackupDestination,
  listBackupDestinations,
  deleteBackupDestination,
  updateBackupLastTime,
};
