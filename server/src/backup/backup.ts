/**
 * Backup Orchestration
 * Coordinates backup creation, encryption, and upload to multiple cloud providers
 */

import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import archiver from 'archiver';
import { getConfig } from '../config';
import { listFiles } from '../db';
import { encryptFile, generateEncryptionKey, EncryptionKeyDerivation } from './encryption';
import { IBackupProvider, UploadResult } from './provider';
import { BackupMetadata, BackupJob } from './types';

export class BackupOrchestrator {
  private vaultDir: string;
  private dbDir: string;
  private backupDir: string;

  constructor() {
    const config = getConfig();
    this.vaultDir = config.vaultDir;
    this.dbDir = config.dbDir;
    this.backupDir = path.join(process.cwd(), 'data', 'backups');
    this.ensureBackupDir();
  }

  private ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create a backup archive (ZIP) containing vault files + database
   * @returns Path to created backup file
   */
  async createBackupArchive(): Promise<string> {
    const backupId = this.generateBackupId();
    const backupPath = path.join(this.backupDir, `${backupId}.zip`);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(backupPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      output.on('close', () => {
        console.log(`[Backup] Archive created: ${backupPath} (${archive.pointer()} bytes)`);
        resolve(backupPath);
      });

      output.on('error', (err) => {
        console.error('[Backup] Archive error:', err);
        reject(err);
      });

      archive.on('error', (err) => {
        console.error('[Backup] Archiver error:', err);
        reject(err);
      });

      archive.pipe(output);

      // Add vault files
      console.log('[Backup] Adding vault files...');
      if (fs.existsSync(this.vaultDir)) {
        archive.directory(this.vaultDir, 'vault');
      }

      // Add database
      console.log('[Backup] Adding database...');
      const dbFile = path.join(this.dbDir, 'freevault.db');
      if (fs.existsSync(dbFile)) {
        archive.file(dbFile, { name: 'freevault.db' });
      }

      // Add backup metadata file
      const metadata: BackupMetadata = {
        backupId,
        vaultName: 'FreeVaultSync',
        createdAt: Date.now(),
        createdBy: 'backup-system',
        vaultSize: this.getVaultSize(),
        fileCount: this.getFileCount(),
        includedVersions: false,
        encrypted: false,
        checksum: '', // Will be set after creation
      };

      const metadataJson = JSON.stringify(metadata, null, 2);
      archive.append(metadataJson, { name: 'backup-metadata.json' });

      archive.finalize();
    });
  }

  /**
   * Encrypt backup archive
   * @param archivePath - Path to unencrypted ZIP
   * @returns Path to encrypted file + encryption metadata
   */
  async encryptBackup(
    archivePath: string
  ): Promise<{ encryptedPath: string; key: string; keyDerivation: EncryptionKeyDerivation }> {
    const encryptedPath = archivePath.replace('.zip', '.enc');
    const encryptionKey = generateEncryptionKey();

    console.log('[Backup] Encrypting archive...');
    const keyDerivation = await encryptFile(archivePath, encryptedPath, encryptionKey);

    // Delete plaintext archive
    fs.unlinkSync(archivePath);

    console.log(`[Backup] Encrypted: ${encryptedPath}`);
    return { encryptedPath, key: encryptionKey, keyDerivation };
  }

  /**
   * Calculate SHA256 checksum of file
   */
  calculateChecksum(filePath: string): string {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    }) as any;
  }

  /**
   * Execute full backup: Archive → Encrypt → Upload to all providers
   * @param providers - Array of configured backup providers
   * @param encryptionEnabled - Whether to encrypt before upload
   * @returns Array of upload results per provider
   */
  async executeBackup(
    providers: Map<string, IBackupProvider>,
    encryptionEnabled: boolean = true
  ): Promise<Map<string, UploadResult>> {
    const results = new Map<string, UploadResult>();

    try {
      console.log('[Backup] Creating archive...');
      let backupPath = await this.createBackupArchive();

      let encryptionKey: string | undefined;
      let keyDerivation: EncryptionKeyDerivation | undefined;

      if (encryptionEnabled && providers.size > 0) {
        console.log('[Backup] Encrypting backup...');
        const encrypted = await this.encryptBackup(backupPath);
        backupPath = encrypted.encryptedPath;
        encryptionKey = encrypted.key;
        keyDerivation = encrypted.keyDerivation;
      }

      // Calculate checksum
      const checksum = await this.calculateChecksum(backupPath);
      console.log(`[Backup] Checksum: ${checksum}`);

      // Upload to all providers
      for (const [providerId, provider] of providers) {
        try {
          console.log(`[Backup] Uploading to ${providerId}...`);
          const uploadResult = await provider.upload(backupPath, {
            checksum,
            encryptionKey,
            keyDerivation,
            encryptionEnabled,
          });

          results.set(providerId, uploadResult);
          console.log(`[Backup] ✓ Uploaded to ${providerId}`);
        } catch (error) {
          console.error(`[Backup] ✗ Failed to upload to ${providerId}:`, error);
        }
      }

      // Cleanup backup file
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }

      return results;
    } catch (error) {
      console.error('[Backup] Backup execution failed:', error);
      throw error;
    }
  }

  private generateBackupId(): string {
    return `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getVaultSize(): number {
    if (!fs.existsSync(this.vaultDir)) return 0;
    return this.getDirectorySize(this.vaultDir);
  }

  private getDirectorySize(dirPath: string): number {
    let size = 0;
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }

    return size;
  }

  private getFileCount(): number {
    const files = listFiles();
    return files.length;
  }
}

export default new BackupOrchestrator();
