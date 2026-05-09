import express from "express";
import fs from "fs";
import path from "path";
import {
  getFile,
  insertVersion,
  listFiles,
  listDevices,
  listAdminStats,
  listVersions,
  markDeviceSync,
  touchDevice,
  upsertDevice,
  upsertFile,
  listBackupDestinations,
  updateBackupLastTime,
} from "./db";
import {
  saveFile,
  readFile,
  deleteFile,
  fileExists,
  validatePath,
  ensureVaultDir,
} from "./fileStore";
import { BackupOrchestrator } from "./backup/backup";
import BackupConfigStore from "./backupConfig";
import crypto from "crypto";

type PutFileBody = {
  checksum?: string;
  content?: string;
  updatedBy?: string;
};

type FileResponse = {
  path: string;
  checksum: string;
  size: number;
  updated_at: number;
  updated_by?: string | null;
  content?: string;
};

type DeviceBody = {
  id?: string;
  name?: string;
  platform?: string;
  deviceType?: string;
  model?: string;
  lastSeen?: number;
  lastSync?: number;
};

/**
 * Calculate SHA256 checksum of content
 */
function calculateChecksum(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function createApp() {
  const app = express();
  const adminDistDir = path.resolve(process.cwd(), "admin/dist");
  const adminIndexFile = path.join(adminDistDir, "index.html");

  app.use(express.json());

  if (fs.existsSync(adminDistDir)) {
    app.use("/admin", express.static(adminDistDir, { index: false, redirect: false }));
    app.get("/admin", (_request, response) => {
      response.sendFile(adminIndexFile);
    });
    app.get("/admin/*", (request, response, next) => {
      if (request.path === "/admin/stats") {
        next();
        return;
      }
      response.sendFile(adminIndexFile);
    });
  }

  // Ensure vault directory exists on startup
  ensureVaultDir();

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "freevaultsync-server" });
  });

  app.get("/", (_request, response) => {
    response.json({
      name: "FreeVaultSync Server",
      status: "bootstrapped",
      endpoints: [
        "/admin",
        "/admin/stats",
        "/devices",
        "/devices/register",
        "/health",
        "/vault/files",
        "/vault/files/*",
        "/vault/history/*",
      ],
    });
  });

  app.get("/vault/files", (_request, response) => {
    response.json({ files: listFiles() });
  });

  const decodePathParam = (rawPath?: string) => decodeURIComponent(rawPath ?? "");
  const getPathFromParams = (params: Record<string, string | undefined>) =>
    decodePathParam(params.path ?? params["path(*)"]);

  app.get("/vault/files/:path(*)", (request, response) => {
    const filePath = getPathFromParams(request.params as Record<string, string | undefined>);
    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    if (!validatePath(filePath)) {
      response.status(400).json({ error: "Invalid file path" });
      return;
    }

    const file = getFile(filePath);
    if (!file) {
      response.status(404).json({ error: "File not found" });
      return;
    }

    // Read file content from disk
    const content = readFile(filePath);

    const fileResponse: FileResponse = {
      ...file,
      content: content ?? undefined,
    };

    response.json(fileResponse);
  });

  app.put("/vault/files/:path(*)", (request, response) => {
    const filePath = getPathFromParams(request.params as Record<string, string | undefined>);
    const body = (request.body ?? {}) as PutFileBody;

    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    if (!validatePath(filePath)) {
      response.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!body.content) {
      response.status(400).json({ error: "Missing file content" });
      return;
    }

    const now = Date.now();
    const updatedBy = body.updatedBy ?? "unknown";

    // Calculate checksum from actual content if not provided
    const checksum = body.checksum ?? calculateChecksum(body.content);

    // Save file to disk
    try {
      const fileMetadata = saveFile(filePath, body.content, updatedBy);

      // Update database with metadata
      upsertFile({
        path: filePath,
        checksum: checksum,
        size: fileMetadata.size,
        updated_at: now,
        updated_by: updatedBy,
      });

      // Insert version entry
      insertVersion({
        path: filePath,
        checksum: checksum,
        diff: null,
        snapshot: 1,
        created_at: now,
        created_by: updatedBy,
      });

      response.status(200).json({
        status: "ok",
        path: filePath,
        checksum: checksum,
        size: fileMetadata.size,
        updated_at: now,
        updated_by: updatedBy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      response.status(500).json({
        error: "Failed to save file",
        detail: message,
      });
    }
  });

  app.delete("/vault/files/:path(*)", (request, response) => {
    const filePath = getPathFromParams(request.params as Record<string, string | undefined>);

    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    if (!validatePath(filePath)) {
      response.status(400).json({ error: "Invalid file path" });
      return;
    }

    try {
      const exists = fileExists(filePath);
      if (!exists) {
        response.status(404).json({ error: "File not found" });
        return;
      }

      deleteFile(filePath);

      response.status(200).json({
        status: "ok",
        path: filePath,
        deleted_at: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      response.status(500).json({
        error: "Failed to delete file",
        detail: message,
      });
    }
  });

  app.get("/vault/history/:path(*)", (request, response) => {
    const filePath = getPathFromParams(request.params as Record<string, string | undefined>);
    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    if (!validatePath(filePath)) {
      response.status(400).json({ error: "Invalid file path" });
      return;
    }

    response.json({
      path: filePath,
      versions: listVersions(filePath),
    });
  });

  app.get("/devices", (_request, response) => {
    response.json({ devices: listDevices() });
  });

  app.post("/devices/register", (request, response) => {
    const body = (request.body ?? {}) as DeviceBody;

    if (!body.id) {
      response.status(400).json({ error: "Missing device id" });
      return;
    }

    const now = Date.now();
    const deviceRow = {
      id: body.id,
      name: body.name ?? null,
      platform: body.platform ?? null,
      device_type: body.deviceType ?? null,
      model: body.model ?? null,
      last_seen: body.lastSeen ?? now,
      last_sync: body.lastSync ?? null,
    };

    upsertDevice(deviceRow);

    response.status(200).json({
      status: "ok",
      device: deviceRow,
    });
  });

  app.post("/devices/:id/heartbeat", (request, response) => {
    const deviceId = request.params.id;
    const now = Date.now();

    touchDevice(deviceId, now);

    response.json({
      status: "ok",
      id: deviceId,
      last_seen: now,
    });
  });

  app.post("/devices/:id/sync", (request, response) => {
    const deviceId = request.params.id;
    const now = Date.now();

    markDeviceSync(deviceId, now);

    response.json({
      status: "ok",
      id: deviceId,
      last_sync: now,
    });
  });

  // ========== BACKUP API ==========

  app.get("/api/backup/destinations", (_request, response) => {
    try {
      const destinations = listBackupDestinations();
      response.json({
        status: "ok",
        destinations: destinations.map((d) => ({
          id: d.id,
          provider: d.provider,
          enabled: d.enabled === 1,
          lastBackup: d.last_backup,
        })),
      });
    } catch (error) {
      response.status(500).json({ error: "Failed to list backup destinations" });
    }
  });

  app.post("/api/backup/test/:destinationId", async (request, response) => {
    try {
      const { destinationId } = request.params;
      const destinations = listBackupDestinations();
      const destination = destinations.find((d) => d.id === destinationId);

      if (!destination) {
        response.status(404).json({ error: "Destination not found" });
        return;
      }

      const provider = BackupConfigStore.initializeProvider(destination as any);
      if (!provider) {
        response.status(400).json({ error: "Failed to initialize provider" });
        return;
      }

      const isAuthenticated = await provider.verify();
      if (!isAuthenticated) {
        response.status(401).json({ error: "Authentication failed" });
        return;
      }

      const status = await provider.getStatus();
      response.json({ status: "ok", provider: destination.provider, message: status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      response.status(500).json({ error: message });
    }
  });

  app.post("/api/backup/execute", async (_request, response) => {
    try {
      console.log("[API] Starting manual backup...");

      const backupOrchestrator = new BackupOrchestrator();
      const providers = BackupConfigStore.getConfiguredProviders();

      if (providers.size === 0) {
        response.status(400).json({ error: "No backup providers configured" });
        return;
      }

      const encryptionEnabled = process.env.BACKUP_ENCRYPTION === "true";
      const results = await backupOrchestrator.executeBackup(providers, encryptionEnabled);

      // Update last backup timestamp
      for (const [destId] of providers) {
        updateBackupLastTime(destId, Date.now());
      }

      response.json({
        status: "ok",
        message: "Backup completed",
        results: Array.from(results.entries()).map(([providerId, result]) => ({
          provider: providerId,
          backupId: result.backupId,
          fileSize: result.fileSize,
          uploadedAt: result.uploadedAt,
          backupUrl: result.backupUrl,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[API] Backup failed:", message);
      response.status(500).json({ error: message });
    }
  });

  app.get("/api/backup/status", async (_request, response) => {
    try {
      const destinations = listBackupDestinations();
      const statusPromises = destinations.map(async (d) => {
        const provider = BackupConfigStore.initializeProvider(d as any);
        if (!provider) {
          return { id: d.id, provider: d.provider, status: "error", message: "Failed to initialize" };
        }

        try {
          const status = await provider.getStatus();
          return { id: d.id, provider: d.provider, status: "ok", message: status };
        } catch (error) {
          return { id: d.id, provider: d.provider, status: "error", message: (error as Error).message };
        }
      });

      const statuses = await Promise.all(statusPromises);
      response.json({ status: "ok", providers: statuses });
    } catch (error) {
      response.status(500).json({ error: "Failed to get backup status" });
    }
  });

  app.get("/admin/stats", (_request, response) => {
    const stats = listAdminStats();
    response.json({
      status: "ok",
      stats: {
        files: stats.files,
        versions: stats.versions,
        devices: stats.devices,
        backup_destinations: stats.backup_destinations,
        sync_events: stats.sync_events,
        storage_bytes: stats.storage_bytes,
        last_file_update_at: stats.last_file_update_at,
        last_sync_at: stats.last_sync_at,
      },
    });
  });

  return app;
}
