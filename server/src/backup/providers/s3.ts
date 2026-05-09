/**
 * AWS S3 Backup Provider
 * Uses AWS SDK v3 for S3 storage
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, statSync } from 'fs';
import { Readable } from 'stream';
import { IBackupProvider, UploadResult, DownloadResult } from '../provider';

export class S3Provider implements IBackupProvider {
  providerId = 's3';
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor(accessKeyId: string, secretAccessKey: string, bucketName: string, region: string = 'us-east-1') {
    this.bucketName = bucketName;
    this.region = region;

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async upload(filePath: string, metadata: Record<string, any>): Promise<UploadResult> {
    try {
      const fileName = filePath.split('/').pop() || 'backup.enc';
      const fileSize = statSync(filePath).size;
      const fileStream = createReadStream(filePath);

      const key = `freevault-backups/${fileName}`;

      console.log(`[S3] Uploading ${fileName} to s3://${this.bucketName}/${key}...`);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileStream,
        ContentType: 'application/octet-stream',
        Metadata: {
          backupId: metadata.backupId || 'unknown',
          checksum: metadata.checksum || '',
          encryptionEnabled: String(metadata.encryptionEnabled || false),
          createdAt: String(Date.now()),
        },
      });

      const response = await this.s3Client.send(command);

      const backupUrl = `s3://${this.bucketName}/${key}`;
      console.log(`[S3] ✓ Uploaded: ${backupUrl}`);

      return {
        providerId: this.providerId,
        backupId: key,
        fileSize,
        checksum: metadata.checksum,
        uploadedAt: Date.now(),
        backupUrl,
      };
    } catch (error) {
      console.error('[S3] Upload failed:', error);
      throw error;
    }
  }

  async download(backupId: string): Promise<DownloadResult> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: backupId,
      });

      const headResponse = await this.s3Client.send(headCommand);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: backupId,
      });

      const response = await this.s3Client.send(command);

      return {
        stream: response.Body as any as Readable,
        fileSize: headResponse.ContentLength || 0,
        metadata: headResponse.Metadata,
      };
    } catch (error) {
      console.error('[S3] Download failed:', error);
      throw error;
    }
  }

  async delete(backupId: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: backupId,
      });

      await this.s3Client.send(command);
      console.log(`[S3] ✓ Deleted: ${backupId}`);
    } catch (error) {
      console.error('[S3] Delete failed:', error);
      throw error;
    }
  }

  async listBackups(): Promise<Array<{ id: string; createdAt: number; size: number; metadata?: Record<string, any> }>> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: 'freevault-backups/',
      });

      const response = await this.s3Client.send(command);

      return (response.Contents || []).map((object) => ({
        id: object.Key || '',
        createdAt: object.LastModified?.getTime() || 0,
        size: object.Size || 0,
        metadata: {
          name: object.Key?.split('/').pop(),
        },
      }));
    } catch (error) {
      console.error('[S3] List failed:', error);
      return [];
    }
  }

  async verify(): Promise<boolean> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 1,
      });

      await this.s3Client.send(command);
      console.log(`[S3] ✓ Authenticated to bucket: ${this.bucketName}`);
      return true;
    } catch (error) {
      console.error('[S3] Verification failed:', error);
      return false;
    }
  }

  async getStatus(): Promise<string> {
    try {
      const isAuthenticated = await this.verify();
      if (!isAuthenticated) return 'Authentication failed';

      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: 'freevault-backups/',
      });

      const response = await this.s3Client.send(command);
      const backupCount = response.Contents?.length || 0;
      const totalSize = (response.Contents || []).reduce((sum, obj) => sum + (obj.Size || 0), 0);
      const totalSizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);

      return `Authenticated | Backups: ${backupCount} | Size: ${totalSizeGB}GB`;
    } catch (error) {
      return 'Error retrieving status';
    }
  }
}
