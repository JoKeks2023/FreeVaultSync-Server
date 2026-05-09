/**
 * Google Drive Backup Provider
 * Uses OAuth2 for authentication and Google Drive API for storage
 */

import { google } from 'googleapis';
import { createReadStream, statSync } from 'fs';
import { OAuth2Client } from 'google-auth-library';
import { IBackupProvider, UploadResult, DownloadResult } from '../provider';

export class GoogleDriveProvider implements IBackupProvider {
  providerId = 'google-drive';
  private oauth2Client: OAuth2Client;
  private drive: ReturnType<typeof google.drive>;
  private folderId?: string; // FreeVaultSync folder on Google Drive

  constructor(clientId: string, clientSecret: string, refreshToken: string) {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost:3000/api/backup/oauth2callback' // Redirect URI
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  async upload(filePath: string, metadata: Record<string, any>): Promise<UploadResult> {
    try {
      await this.ensureFreeVaultFolder();

      const fileName = filePath.split('/').pop() || 'backup.enc';
      const fileSize = statSync(filePath).size;

      console.log(`[GoogleDrive] Uploading ${fileName} (${fileSize} bytes)...`);

      const response = await this.drive.files.create(
        {
          requestBody: {
            name: fileName,
            mimeType: 'application/octet-stream',
            parents: [this.folderId!],
            properties: {
              backupId: metadata.backupId || 'unknown',
              encryptionEnabled: String(metadata.encryptionEnabled || false),
              checksum: metadata.checksum || '',
              createdAt: String(Date.now()),
            },
          },
          media: {
            mimeType: 'application/octet-stream',
            body: createReadStream(filePath),
          },
          fields: 'id, size, webContentLink',
        },
        {
          onUploadProgress: (evt: any) => {
            const progress = Math.round((evt.bytesRead / fileSize) * 100);
            console.log(`[GoogleDrive] Upload progress: ${progress}%`);
          },
        }
      );

      const fileId = response.data.id ?? '';
      const backupUrl = `https://drive.google.com/file/d/${fileId}`;

      console.log(`[GoogleDrive] ✓ Uploaded: ${backupUrl}`);

      return {
        providerId: this.providerId,
        backupId: fileId || 'unknown',
        fileSize,
        checksum: metadata.checksum,
        uploadedAt: Date.now(),
        backupUrl,
      };
    } catch (error) {
      console.error('[GoogleDrive] Upload failed:', error);
      throw error;
    }
  }

  async download(backupId: string): Promise<DownloadResult> {
    try {
      const response = await this.drive.files.get(
        { fileId: backupId, alt: 'media' },
        { responseType: 'stream' }
      );

      const metadata = await this.drive.files.get({
        fileId: backupId,
        fields: 'size, createdTime, properties',
      });

      return {
        stream: response.data as any,
        fileSize: parseInt(metadata.data.size || '0'),
        metadata: {
          createdAt: metadata.data.createdTime ?? '',
          ...metadata.data.properties,
        },
      };
    } catch (error) {
      console.error('[GoogleDrive] Download failed:', error);
      throw error;
    }
  }

  async delete(backupId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId: backupId });
      console.log(`[GoogleDrive] ✓ Deleted: ${backupId}`);
    } catch (error) {
      console.error('[GoogleDrive] Delete failed:', error);
      throw error;
    }
  }

  async listBackups(): Promise<Array<{ id: string; createdAt: number; size: number; metadata?: Record<string, any> }>> {
    try {
      await this.ensureFreeVaultFolder();

      const response = await this.drive.files.list({
        q: `'${this.folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name, size, createdTime, properties)',
        pageSize: 100,
      });

      return (response.data.files || []).map((file: any) => ({
        id: file.id,
        createdAt: new Date(file.createdTime).getTime(),
        size: parseInt(file.size || '0'),
        metadata: {
          name: file.name,
          ...file.properties,
        },
      }));
    } catch (error) {
      console.error('[GoogleDrive] List failed:', error);
      return [];
    }
  }

  async verify(): Promise<boolean> {
    try {
      const response = await this.drive.about.get({ fields: 'user' });
      console.log(`[GoogleDrive] ✓ Authenticated as ${response.data.user?.emailAddress}`);
      return !!response.data.user;
    } catch (error) {
      console.error('[GoogleDrive] Verification failed:', error);
      return false;
    }
  }

  async getStatus(): Promise<string> {
    try {
      const isAuthenticated = await this.verify();
      if (!isAuthenticated) return 'Authentication failed';

      const response = await this.drive.about.get({ fields: 'storageQuota' });
      const quota = response.data.storageQuota as any;
      const usedGB = ((quota?.usedBytes || 0) / 1024 / 1024 / 1024).toFixed(2);
      const limitGB = ((quota?.limitBytes || 0) / 1024 / 1024 / 1024).toFixed(2);

      return `Authenticated | Storage: ${usedGB}GB / ${limitGB}GB`;
    } catch (error) {
      return 'Error retrieving status';
    }
  }

  private async ensureFreeVaultFolder() {
    if (this.folderId) return;

    try {
      // Check if folder exists
      const response = await this.drive.files.list({
        q: "name='FreeVaultSync' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        spaces: 'drive',
        fields: 'files(id)',
        pageSize: 1,
      });

      if (response.data.files && response.data.files.length > 0) {
        this.folderId = response.data.files[0].id ?? '';
        console.log(`[GoogleDrive] Using existing folder: ${this.folderId}`);
        return;
      }

      // Create folder
      const createResponse = await this.drive.files.create({
        requestBody: {
          name: 'FreeVaultSync',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });

      this.folderId = createResponse.data.id ?? '';
      console.log(`[GoogleDrive] Created folder: ${this.folderId}`);
    } catch (error) {
      console.error('[GoogleDrive] Folder management failed:', error);
      throw error;
    }
  }
}
