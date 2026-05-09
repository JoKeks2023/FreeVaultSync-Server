/**
 * Cloud Backup Provider Interface
 * Abstract interface for all backup providers
 */

import { Readable } from 'stream';

export type UploadResult = {
  providerId: string;
  backupId: string;
  fileSize: number;
  checksum: string;
  uploadedAt: number;
  backupUrl?: string;
};

export type DownloadResult = {
  stream: Readable;
  fileSize: number;
  metadata?: Record<string, string>;
};

export interface IBackupProvider {
  /**
   * Provider identifier
   */
  readonly providerId: string;

  /**
   * Upload backup to provider storage
   * @param filePath - Path to backup file (local)
   * @param metadata - Backup metadata (stored with backup)
   * @returns Upload result with remote details
   */
  upload(filePath: string, metadata: Record<string, any>): Promise<UploadResult>;

  /**
   * Download backup from provider storage
   * @param backupId - Backup identifier on provider
   * @returns Download stream and file info
   */
  download(backupId: string): Promise<DownloadResult>;

  /**
   * Delete backup from provider storage
   * @param backupId - Backup identifier on provider
   */
  delete(backupId: string): Promise<void>;

  /**
   * List all backups from provider
   * @returns Array of backup IDs with metadata
   */
  listBackups(): Promise<Array<{ id: string; createdAt: number; size: number; metadata?: Record<string, any> }>>;

  /**
   * Verify provider authentication & connectivity
   * @returns true if authenticated and provider is accessible
   */
  verify(): Promise<boolean>;

  /**
   * Get human-readable status string
   */
  getStatus(): Promise<string>;
}
