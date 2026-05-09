import fs from "fs";
import path from "path";

const DEFAULT_VAULT_DIR =
  process.env.VAULT_DIR ?? path.resolve(process.cwd(), "data/vault");

/**
 * Validates a file path to prevent directory traversal attacks
 * and ensure it's within the vault directory
 */
export function validatePath(filePath: string): boolean {
  if (!filePath || filePath.length === 0) return false;

  // Resolve to absolute path and check if it's within vault dir
  const vaultDir = path.resolve(DEFAULT_VAULT_DIR);
  const resolvedPath = path.resolve(vaultDir, filePath);

  // Ensure the resolved path is within the vault directory
  return resolvedPath.startsWith(vaultDir + path.sep) || resolvedPath === vaultDir;
}

/**
 * Ensures vault directory exists
 */
export function ensureVaultDir(): void {
  if (!fs.existsSync(DEFAULT_VAULT_DIR)) {
    fs.mkdirSync(DEFAULT_VAULT_DIR, { recursive: true });
  }
}

/**
 * Saves file content to disk with metadata
 * Returns metadata about the saved file
 */
export function saveFile(
  filePath: string,
  content: string,
  deviceId: string
): {
  path: string;
  size: number;
  savedAt: number;
  deviceId: string;
} {
  if (!validatePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  ensureVaultDir();

  const vaultDir = path.resolve(DEFAULT_VAULT_DIR);
  const fullPath = path.resolve(vaultDir, filePath);
  const dir = path.dirname(fullPath);

  // Create parent directories if needed
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file to disk
  fs.writeFileSync(fullPath, content, "utf8");

  const size = Buffer.byteLength(content, "utf8");
  const savedAt = Date.now();

  return {
    path: filePath,
    size,
    savedAt,
    deviceId,
  };
}

/**
 * Reads file content from disk
 */
export function readFile(filePath: string): string | null {
  if (!validatePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  const vaultDir = path.resolve(DEFAULT_VAULT_DIR);
  const fullPath = path.resolve(vaultDir, filePath);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, "utf8");
}

/**
 * Deletes a file from disk
 */
export function deleteFile(filePath: string): boolean {
  if (!validatePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  const vaultDir = path.resolve(DEFAULT_VAULT_DIR);
  const fullPath = path.resolve(vaultDir, filePath);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  fs.unlinkSync(fullPath);
  return true;
}

/**
 * Checks if a file exists on disk
 */
export function fileExists(filePath: string): boolean {
  if (!validatePath(filePath)) {
    return false;
  }

  const vaultDir = path.resolve(DEFAULT_VAULT_DIR);
  const fullPath = path.resolve(vaultDir, filePath);
  return fs.existsSync(fullPath);
}

/**
 * Gets the vault directory path
 */
export function getVaultDir(): string {
  return path.resolve(DEFAULT_VAULT_DIR);
}
