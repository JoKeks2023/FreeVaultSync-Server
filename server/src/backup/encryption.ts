/**
 * Backup Encryption (AES-256-GCM)
 * Encrypts/decrypts backup archives with authenticated encryption
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { Transform } from 'stream';
import * as path from 'path';

const ALGORITHM = 'aes-256-gcm';
const SCRYPT_N = 2 ** 16; // CPU/memory cost parameter
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const TAG_LENGTH = 16; // GCM tag length
const SALT_LENGTH = 32;
const IV_LENGTH = 12; // GCM requires 12-byte IV

export type EncryptionKeyDerivation = {
  salt: string; // Base64
  iv: string; // Base64
  authTag: string; // Base64
};

/**
 * Generate encryption key from password
 * @param password - User password
 * @param salt - Salt (generated if not provided)
 * @returns Derived 32-byte key + salt
 */
export function deriveKey(password: string, salt?: Buffer): { key: Buffer; salt: Buffer } {
  const saltBuffer = salt || randomBytes(SALT_LENGTH);
  const key = scryptSync(password, saltBuffer, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return { key, salt: saltBuffer };
}

/**
 * Generate a random encryption key (32 bytes = 256 bits)
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Encrypt file stream
 * @param inputPath - Path to plaintext file
 * @param outputPath - Path to encrypted output
 * @param key - Base64-encoded encryption key
 * @returns Encryption metadata needed for decryption (salt, IV, authTag)
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
  key: string
): Promise<EncryptionKeyDerivation> {
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  const inputStream = createReadStream(inputPath);
  const outputStream = createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    inputStream.pipe(cipher).pipe(outputStream);

    outputStream.on('finish', () => {
      const authTag = cipher.getAuthTag();
      resolve({
        salt: '', // Not used when key is pre-generated
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      });
    });

    outputStream.on('error', reject);
    inputStream.on('error', reject);
    cipher.on('error', reject);
  });
}

/**
 * Decrypt file stream
 * @param inputPath - Path to encrypted file
 * @param outputPath - Path to decrypted output
 * @param key - Base64-encoded encryption key
 * @param keyDerivation - IV and authTag from encryption
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  key: string,
  keyDerivation: EncryptionKeyDerivation
): Promise<void> {
  const keyBuffer = Buffer.from(key, 'base64');
  const iv = Buffer.from(keyDerivation.iv, 'base64');
  const authTag = Buffer.from(keyDerivation.authTag, 'base64');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const inputStream = createReadStream(inputPath);
  const outputStream = createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    inputStream.pipe(decipher).pipe(outputStream);

    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
    inputStream.on('error', reject);
    decipher.on('error', reject);
  });
}

/**
 * Create a transform stream that encrypts data on-the-fly
 */
export function createEncryptionStream(key: string): { stream: Transform; iv: string; getAuthTag: () => Buffer } {
  const keyBuffer = Buffer.from(key, 'base64');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  return {
    stream: cipher as Transform,
    iv: iv.toString('base64'),
    getAuthTag: () => cipher.getAuthTag(),
  };
}

/**
 * Create a transform stream that decrypts data on-the-fly
 */
export function createDecryptionStream(
  key: string,
  keyDerivation: EncryptionKeyDerivation
): { stream: Transform } {
  const keyBuffer = Buffer.from(key, 'base64');
  const iv = Buffer.from(keyDerivation.iv, 'base64');
  const authTag = Buffer.from(keyDerivation.authTag, 'base64');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  return { stream: decipher as Transform };
}
