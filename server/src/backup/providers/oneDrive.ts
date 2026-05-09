/**
 * Microsoft OneDrive Backup Provider
 * Supports both Personal and Business (via SharePoint) accounts
 * Uses Microsoft Graph API
 */

import { Readable } from 'stream';
import { createReadStream, statSync } from 'fs';
import { IBackupProvider, UploadResult, DownloadResult } from '../provider';

interface GraphClientConfig {
  token: string; // Access token
  refreshToken: string;
  tenantId?: string; // For Business accounts
  siteId?: string; // For Business accounts
}

export class OneDriveProvider implements IBackupProvider {
  providerId: string; // 'onedrive-personal' or 'onedrive-business'
  private accessToken: string;
  private refreshToken: string;
  private tenantId?: string;
  private siteId?: string;
  private driveId?: string;
  private folderId?: string;
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;

  constructor(
    config: GraphClientConfig,
    clientId: string,
    clientSecret: string,
    isBusinessAccount: boolean = false
  ) {
    this.accessToken = config.token;
    this.refreshToken = config.refreshToken;
    this.tenantId = config.tenantId;
    this.siteId = config.siteId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    if (isBusinessAccount) {
      this.providerId = 'onedrive-business';
      this.baseUrl = `https://graph.microsoft.com/v1.0/sites/${this.siteId}/drive`;
    } else {
      this.providerId = 'onedrive-personal';
      this.baseUrl = 'https://graph.microsoft.com/v1.0/me/drive';
    }
  }

  async upload(filePath: string, metadata: Record<string, any>): Promise<UploadResult> {
    try {
      const fileName = filePath.split('/').pop() || 'backup.enc';
      const fileSize = statSync(filePath).size;

      console.log(`[OneDrive] Uploading ${fileName}...`);

      // Ensure folder exists
      await this.ensureFreeVaultFolder();

      const fileStream = createReadStream(filePath);
      const uploadUrl = `${this.baseUrl}/items/${this.folderId}:/${fileName}:/content`;

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: fileStream as any,
      });

      if (!response.ok) {
        throw new Error(`OneDrive upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      const fileId = result.id;

      // Get file details
      const detailsUrl = `${this.baseUrl}/items/${fileId}`;
      const detailsResponse = await fetch(detailsUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      const detailsData = await detailsResponse.json();
      const webUrl = detailsData.webUrl;

      console.log(`[OneDrive] ✓ Uploaded: ${webUrl}`);

      return {
        providerId: this.providerId,
        backupId: fileId,
        fileSize,
        checksum: metadata.checksum,
        uploadedAt: Date.now(),
        backupUrl: webUrl,
      };
    } catch (error) {
      console.error('[OneDrive] Upload failed:', error);
      throw error;
    }
  }

  async download(backupId: string): Promise<DownloadResult> {
    try {
      const url = `${this.baseUrl}/items/${backupId}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`OneDrive download failed: ${response.statusText}`);
      }

      const metadata = await response.json();

      // Get download URL
      const downloadUrl = metadata['@microsoft.graph.downloadUrl'];
      if (!downloadUrl) {
        throw new Error('Download URL not available');
      }

      const downloadResponse = await fetch(downloadUrl);
      const buffer = await downloadResponse.arrayBuffer();

      return {
        stream: Readable.from([Buffer.from(buffer)]),
        fileSize: metadata.size,
        metadata: {
          name: metadata.name,
          createdAt: metadata.createdDateTime,
        },
      };
    } catch (error) {
      console.error('[OneDrive] Download failed:', error);
      throw error;
    }
  }

  async delete(backupId: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/items/${backupId}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok && response.status !== 204) {
        throw new Error(`OneDrive delete failed: ${response.statusText}`);
      }

      console.log(`[OneDrive] ✓ Deleted: ${backupId}`);
    } catch (error) {
      console.error('[OneDrive] Delete failed:', error);
      throw error;
    }
  }

  async listBackups(): Promise<Array<{ id: string; createdAt: number; size: number; metadata?: Record<string, any> }>> {
    try {
      await this.ensureFreeVaultFolder();

      const url = `${this.baseUrl}/items/${this.folderId}/children`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) {
        console.error('[OneDrive] List failed:', response.statusText);
        return [];
      }

      const result = await response.json();

      return (result.value || []).map((item: any) => ({
        id: item.id,
        createdAt: new Date(item.createdDateTime).getTime(),
        size: item.size || 0,
        metadata: {
          name: item.name,
        },
      }));
    } catch (error) {
      console.error('[OneDrive] List failed:', error);
      return [];
    }
  }

  async verify(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[OneDrive] ✓ Authenticated (Drive: ${data.id})`);
        this.driveId = data.id;
        return true;
      }

      console.error('[OneDrive] Verification failed:', response.statusText);
      return false;
    } catch (error) {
      console.error('[OneDrive] Verification error:', error);
      return false;
    }
  }

  async getStatus(): Promise<string> {
    try {
      const isAuthenticated = await this.verify();
      if (!isAuthenticated) return 'Authentication failed';

      const quotaUrl = `${this.baseUrl}`;
      const response = await fetch(quotaUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      const data = await response.json();
      const quota = data.quota;

      if (!quota) return 'Authenticated | Quota info not available';

      const usedGB = (quota.used / 1024 / 1024 / 1024).toFixed(2);
      const limitGB = (quota.total / 1024 / 1024 / 1024).toFixed(2);

      return `Authenticated (${this.providerId}) | Storage: ${usedGB}GB / ${limitGB}GB`;
    } catch (error) {
      return 'Error retrieving status';
    }
  }

  private async ensureFreeVaultFolder() {
    if (this.folderId) return;

    try {
      // Check if folder exists
      const searchUrl = `${this.baseUrl}/root/children?$filter=name eq 'FreeVaultSync'`;

      const response = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      const result = await response.json();

      if (result.value && result.value.length > 0) {
        this.folderId = result.value[0].id;
        console.log(`[OneDrive] Using existing folder: ${this.folderId}`);
        return;
      }

      // Create folder
      const createUrl = `${this.baseUrl}/root/children`;

      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'FreeVaultSync',
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
      });

      if (!createResponse.ok) {
        throw new Error(`Folder creation failed: ${createResponse.statusText}`);
      }

      const createData = await createResponse.json();
      this.folderId = createData.id;
      console.log(`[OneDrive] Created folder: ${this.folderId}`);
    } catch (error) {
      console.error('[OneDrive] Folder management failed:', error);
      throw error;
    }
  }
}
