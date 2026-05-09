export type HealthResponse = {
  status: string;
  service: string;
};

export type FileRow = {
  path: string;
  checksum: string;
  size: number;
  updated_at: number;
  updated_by?: string | null;
};

export type FileDetails = FileRow & {
  content?: string;
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

export type VersionRow = {
  id: number;
  path: string;
  checksum: string;
  diff?: string | null;
  snapshot: 0 | 1;
  created_at: number;
  created_by?: string | null;
};

export type BackupDestination = {
  id: string;
  provider: string;
  enabled: boolean;
  lastBackup?: number;
};

export type BackupStatusItem = {
  id: string;
  provider: string;
  status: 'ok' | 'error';
  message: string;
};

export type BackupStatusResponse = {
  status: string;
  providers: BackupStatusItem[];
};

export type AdminStats = {
  files: number;
  versions: number;
  devices: number;
  backup_destinations: number;
  sync_events: number;
  storage_bytes: number;
  last_file_update_at: number | null;
  last_sync_at: number | null;
};

export type AdminStatsResponse = {
  status: string;
  stats: AdminStats;
};

export type FilesResponse = {
  files: FileRow[];
};

export type HistoryResponse = {
  path: string;
  versions: VersionRow[];
};

export type DevicesResponse = {
  devices: DeviceRow[];
};
