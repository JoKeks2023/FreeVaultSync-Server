/**
 * Backup System Types
 * Defines types for multi-provider cloud backup support
 */

export type BackupProvider = 'google-drive' | 's3' | 'onedrive-personal' | 'onedrive-business';

export type BackupDestination = {
  id: string;
  provider: BackupProvider;
  enabled: boolean;
  displayName: string;
  accessToken?: string;
  refreshToken?: string;
  tenantId?: string; // For OneDrive Business
  siteId?: string; // For OneDrive Business (optional)
  bucketName?: string; // For S3
  region?: string; // For S3
  secretAccessKey?: string; // For S3 (encrypted in DB)
  lastBackup?: number; // Unix timestamp (ms)
  createdAt: number;
  updatedAt: number;
};

export type BackupConfig = {
  enabled: boolean;
  destinationIds: string[]; // IDs of enabled BackupDestinations
  schedule?: string; // Cron expression (e.g., "0 2 * * *" = daily at 2am)
  retentionDays?: number; // Keep backups for N days (default: 30)
  includeVersionHistory: boolean; // Include all versions or just latest?
  encryptionEnabled: boolean;
  encryptionKey?: string; // Base64-encoded AES key (stored securely)
};

export type BackupMetadata = {
  backupId: string;
  vaultName: string;
  createdAt: number;
  createdBy: string;
  vaultSize: number;
  fileCount: number;
  includedVersions: boolean;
  encrypted: boolean;
  encryptionAlgorithm?: string;
  checksum: string; // SHA256 of backup file
};

export type BackupJob = {
  jobId: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  destinationId: string;
  destinationProvider: BackupProvider;
  backupId?: string;
  fileSize?: number;
  backupUrl?: string;
  error?: string;
  retries: number;
  maxRetries: number;
};

export type RestorePoint = {
  backupId: string;
  provider: BackupProvider;
  createdAt: number;
  vaultSize: number;
  fileCount: number;
  encrypted: boolean;
  checksum: string;
};
