import type {
  AdminStatsResponse,
  BackupDestination,
  BackupStatusResponse,
  DevicesResponse,
  FileDetails,
  FilesResponse,
  HealthResponse,
  HistoryResponse,
} from './types';

const API_BASE = import.meta.env.DEV
  ? (import.meta.env.VITE_FREEVAULT_API_URL ?? 'http://localhost:3000')
  : window.location.origin;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export function health() {
  return requestJson<HealthResponse>('/health');
}

export function listFiles() {
  return requestJson<FilesResponse>('/vault/files');
}

export function getFile(path: string) {
  return requestJson<FileDetails>(`/vault/files/${encodeURIComponent(path)}`);
}

export function getHistory(path: string) {
  return requestJson<HistoryResponse>(`/vault/history/${encodeURIComponent(path)}`);
}

export function listBackupStatus() {
  return requestJson<BackupStatusResponse>('/api/backup/status');
}

export function listBackupDestinations() {
  return requestJson<{ status: string; destinations: BackupDestination[] }>('/api/backup/destinations');
}

export function listDevices() {
  return requestJson<DevicesResponse>('/devices');
}

export function getAdminStats() {
  return requestJson<AdminStatsResponse>('/admin/stats');
}
