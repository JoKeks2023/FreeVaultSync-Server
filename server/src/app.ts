import express from "express";
import {
  getFile,
  insertVersion,
  listFiles,
  listVersions,
  upsertFile,
} from "./db";

type PutFileBody = {
  checksum?: string;
  content?: string;
  updatedBy?: string;
};

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "freevaultsync-server" });
  });

  app.get("/", (_request, response) => {
    response.json({
      name: "FreeVaultSync Server",
      status: "bootstrapped",
      endpoints: [
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

  app.get("/vault/files/:path(*)", (request, response) => {
    const filePath = decodePathParam(request.params.path);
    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    const file = getFile(filePath);
    if (!file) {
      response.status(404).json({ error: "File not found" });
      return;
    }

    response.json(file);
  });

  app.put("/vault/files/:path(*)", (request, response) => {
    const filePath = decodePathParam(request.params.path);
    const body = (request.body ?? {}) as PutFileBody;

    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    if (!body.checksum) {
      response.status(400).json({ error: "Missing checksum" });
      return;
    }

    const now = Date.now();
    const size = body.content ? Buffer.byteLength(body.content, "utf8") : 0;
    const updatedBy = body.updatedBy ?? "unknown";

    upsertFile({
      path: filePath,
      checksum: body.checksum,
      size,
      updated_at: now,
      updated_by: updatedBy,
    });

    insertVersion({
      path: filePath,
      checksum: body.checksum,
      diff: null,
      snapshot: 1,
      created_at: now,
      created_by: updatedBy,
    });

    response.status(200).json({
      status: "ok",
      path: filePath,
      checksum: body.checksum,
      updated_at: now,
    });
  });

  app.get("/vault/history/:path(*)", (request, response) => {
    const filePath = decodePathParam(request.params.path);
    if (!filePath) {
      response.status(400).json({ error: "Missing file path" });
      return;
    }

    response.json({
      path: filePath,
      versions: listVersions(filePath),
    });
  });

  return app;
}
