/**
 * Backup Configuration Storage
 * Manages provider credentials and backup settings
 */

import { listBackupDestinations, upsertBackupDestination, getBackupDestination } from './db';
import { GoogleDriveProvider } from './backup/providers/googleDrive';
import { S3Provider } from './backup/providers/s3';
import { OneDriveProvider } from './backup/providers/oneDrive';
import { IBackupProvider } from './backup/provider';
import { BackupDestination } from './backup/types';

export class BackupConfigStore {
  /**
   * Initialize provider from stored credentials
   */
  static initializeProvider(destination: BackupDestination): IBackupProvider | null {
    try {
      switch (destination.provider) {
        case 'google-drive':
          if (!destination.accessToken || !destination.refreshToken) {
            console.error('[BackupConfig] Google Drive: missing tokens');
            return null;
          }

          const clientId = process.env.GOOGLE_CLIENT_ID || '';
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

          if (!clientId || !clientSecret) {
            console.error('[BackupConfig] Google Drive: missing client credentials in env');
            return null;
          }

          return new GoogleDriveProvider(clientId, clientSecret, destination.refreshToken);

        case 's3':
          if (!destination.accessToken || !destination.secretAccessKey || !destination.bucketName) {
            console.error('[BackupConfig] S3: missing credentials');
            return null;
          }

          return new S3Provider(
            destination.accessToken,
            destination.secretAccessKey,
            destination.bucketName,
            destination.region || 'us-east-1'
          );

        case 'onedrive-personal':
        case 'onedrive-business':
          if (!destination.accessToken || !destination.refreshToken) {
            console.error(`[BackupConfig] OneDrive: missing tokens`);
            return null;
          }

          return new OneDriveProvider(
            {
              token: destination.accessToken,
              refreshToken: destination.refreshToken,
              tenantId: destination.tenantId,
              siteId: destination.siteId,
            },
            process.env.MICROSOFT_CLIENT_ID || '',
            process.env.MICROSOFT_CLIENT_SECRET || '',
            destination.provider === 'onedrive-business'
          );

        default:
          console.error(`[BackupConfig] Unknown provider: ${destination.provider}`);
          return null;
      }
    } catch (error) {
      console.error('[BackupConfig] Provider initialization failed:', error);
      return null;
    }
  }

  /**
   * Get all configured providers as Map
   */
  static getConfiguredProviders(): Map<string, IBackupProvider> {
    const providers = new Map<string, IBackupProvider>();

    const destinations = listBackupDestinations();

    for (const dest of destinations) {
      if (dest.enabled) {
        const provider = this.initializeProvider(dest as any);
        if (provider) {
          providers.set(dest.id, provider);
        }
      }
    }

    return providers;
  }

  /**
   * Save provider configuration
   */
  static saveProviderConfig(
    provider: 'google-drive' | 's3' | 'onedrive-personal' | 'onedrive-business',
    displayName: string,
    credentials: Record<string, any>
  ): string {
    const id = `${provider}-${Date.now()}`;

    const destRow: any = {
      id,
      provider,
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      enabled: 1,
    };

    upsertBackupDestination(destRow);

    console.log(`[BackupConfig] Saved: ${provider} (${displayName})`);
    return id;
  }
}

export default BackupConfigStore;
