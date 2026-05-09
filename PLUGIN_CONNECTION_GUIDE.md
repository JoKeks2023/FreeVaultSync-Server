# Plugin Connection Guide

This guide explains how the separate plugin repository connects to the FreeVaultSync server.

## Goal

The plugin repo is the client layer. The server repo owns:

- file storage on disk
- metadata and versioning in SQLite
- backup orchestration
- device identifiers for writes

The plugin should only talk to the HTTP API and never write files directly to the server filesystem.

## Base URL

Default local development URL:

```text
http://localhost:3000
```

The plugin should expose this as a user setting so it can point to:

- local development server
- LAN server
- Docker deployment
- hosted server later

For production, the plugin should use a single public origin such as:

```text
https://vault.example.com
```

The plugin should not hardcode `localhost` or `:3000`.

## Minimum Required Settings in the Plugin

The plugin should store these settings:

- `serverUrl` - base URL of the FreeVaultSync server
- `deviceId` - stable ID for the current device
- `deviceName` - human-readable device name
- `syncEnabled` - whether sync is active
- `autoSyncOnSave` - whether edits are pushed automatically
- `syncIntervalSeconds` - optional polling interval

Optional later settings:

- auth token
- conflict strategy
- backup destination selection

## API Contract

### Health check

Use this to test connectivity.

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "service": "freevaultsync-server"
}
```

### List files

```http
GET /vault/files
```

Response:

```json
{
  "files": [
    {
      "path": "Notes/demo.md",
      "checksum": "...",
      "size": 123,
      "updated_at": 1710000000000,
      "updated_by": "device-mac"
    }
  ]
}
```

Use this for initial sync and vault indexing.

### Get a file

```http
GET /vault/files/:path
```

Example:

```http
GET /vault/files/Notes%2Fdemo.md
```

Response:

```json
{
  "path": "Notes/demo.md",
  "checksum": "...",
  "size": 123,
  "updated_at": 1710000000000,
  "updated_by": "device-mac",
  "content": "# Hello"
}
```

### Save a file

```http
PUT /vault/files/:path
```

Body:

```json
{
  "content": "# My note\nHello world",
  "updatedBy": "device-mac"
}
```

Response:

```json
{
  "status": "ok",
  "path": "Notes/demo.md",
  "checksum": "...",
  "size": 24,
  "updated_at": 1710000000000,
  "updated_by": "device-mac"
}
```

The plugin should send the current device ID in `updatedBy`.

### Delete a file

```http
DELETE /vault/files/:path
```

Example:

```http
DELETE /vault/files/Notes%2Fdemo.md
```

Response:

```json
{
  "status": "ok",
  "path": "Notes/demo.md",
  "deleted_at": 1710000000000
}
```

### Version history

```http
GET /vault/history/:path
```

Use this when the plugin needs to inspect previous versions for conflict handling or restore UI.

## Path Rules

The plugin must always URL-encode file paths.

Examples:

- `Notes/demo.md` → `Notes%2Fdemo.md`
- `Projects/Idea 1.md` → `Projects%2FIdea%201.md`

The server rejects path traversal attempts like `../../etc/passwd`.

## Sync Flow Recommended for the Plugin

### Initial sync

1. Call `GET /health`.
2. Call `GET /vault/files`.
3. Compare the returned metadata with the plugin vault.
4. Download missing or newer files via `GET /vault/files/:path`.
5. Upload changed local files via `PUT /vault/files/:path`.

### Save flow

1. User edits a note in the plugin.
2. Plugin writes the local file first.
3. Plugin sends `PUT /vault/files/:path` with the new content.
4. Plugin stores the returned `checksum`, `updated_at`, and `updated_by` locally.

### Delete flow

1. User deletes a note in the plugin.
2. Plugin deletes the local file.
3. Plugin sends `DELETE /vault/files/:path`.

### Conflict handling

The server stores the latest write and version snapshots.

Recommended plugin behavior:

- compare `checksum` before overwriting
- if local and remote differ, create a conflict copy
- expose history to the user when a conflict happens

## Single-Port and Single-Domain Deployment

If your goal is to run everything behind one domain or one public port, do it with a reverse proxy in front of the server.

The important distinction is:

- the plugin repo is installed inside Obsidian or another client
- the server repo runs as the backend API
- the domain and public port belong to the proxy layer, not to the plugin itself

Recommended production shape:

```text
Internet
  -> https://vault.example.com (443)
  -> Reverse Proxy (Caddy / Nginx / Traefik)
  -> FreeVaultSync server on localhost:3000 or docker network
```

### Recommended routing

Keep the API at the root of the domain if possible:

- `GET /health`
- `GET /vault/files`
- `PUT /vault/files/:path`
- `DELETE /vault/files/:path`
- `GET /api/backup/*`

That keeps the plugin simple because it can use one base URL without extra path rewriting.

### Caddy example

```caddyfile
vault.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

### Nginx example

```nginx
server {
  listen 80;
  server_name vault.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Docker deployment pattern

If the server runs in Docker, keep it private on the Docker network and only expose the proxy:

```yaml
services:
  proxy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      - server

  server:
    build: ./server
    expose:
      - "3000"
    environment:
      PORT: 3000
      VAULT_DIR: /data/vault
      DB_DIR: /data/db
    volumes:
      - vault_data:/data/vault
      - db_data:/data/db
```

In that setup, the plugin still uses only one URL:

```text
https://vault.example.com
```

## Connection Strategy For The Plugin Repo

In the second repo, the plugin should implement one thin API client and one sync engine.

### Split responsibilities

- API client: HTTP calls, retries, auth headers, path encoding
- Sync engine: compare checksums, decide upload or download, handle conflicts
- UI/settings: server URL, device ID, sync toggles

### Connection sequence

1. Store the server URL in plugin settings.
2. Call `GET /health` on startup.
3. If healthy, call `GET /vault/files`.
4. Compare remote metadata with local vault state.
5. Use `GET /vault/files/:path` for remote reads.
6. Use `PUT /vault/files/:path` for local writes.
7. Use `DELETE /vault/files/:path` for deletions.

### Recommended client behavior

- Always URL-encode file paths before sending them.
- Always send a stable `updatedBy` device ID.
- Use `checksum` to detect conflicts.
- Treat `updated_at` as the last server-side write timestamp.
- Keep local files as the source of truth inside the plugin until sync confirms success.

### Minimal connection test in the plugin repo

Before building the full sync engine, test these calls in order:

```ts
await client.health();
await client.listFiles();
await client.saveFile('Notes/demo.md', '# Hello from plugin');
await client.getFile('Notes/demo.md');
await client.deleteFile('Notes/demo.md');
```

If this roundtrip works, the transport layer is correct.

## Device ID Handling

`updatedBy` is treated as a stable device identifier.

The plugin should:

- generate a UUID on first start
- persist it in plugin settings or secure storage
- reuse the same ID for all writes from the same device

Example values:

- `device-macbook-pro`
- `device-iphone`
- `device-linux-workstation`

## Suggested TypeScript Client Wrapper

The plugin repo should centralize all HTTP calls in one client class.

```ts
export type FreeVaultFile = {
  path: string;
  checksum: string;
  size: number;
  updated_at: number;
  updated_by?: string | null;
  content?: string;
};

export type SaveFileRequest = {
  content: string;
  updatedBy: string;
};

export class FreeVaultClient {
  constructor(
    private readonly serverUrl: string,
    private readonly deviceId: string,
  ) {}

  private endpoint(path: string) {
    return `${this.serverUrl.replace(/\/$/, '')}${path}`;
  }

  async health() {
    const response = await fetch(this.endpoint('/health'));
    return response.json();
  }

  async listFiles(): Promise<{ files: FreeVaultFile[] }> {
    const response = await fetch(this.endpoint('/vault/files'));
    return response.json();
  }

  async getFile(path: string): Promise<FreeVaultFile> {
    const response = await fetch(this.endpoint(`/vault/files/${encodeURIComponent(path)}`));
    return response.json();
  }

  async saveFile(path: string, content: string): Promise<FreeVaultFile> {
    const response = await fetch(this.endpoint(`/vault/files/${encodeURIComponent(path)}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, updatedBy: this.deviceId }),
    });
    return response.json();
  }

  async deleteFile(path: string) {
    const response = await fetch(this.endpoint(`/vault/files/${encodeURIComponent(path)}`), {
      method: 'DELETE',
    });
    return response.json();
  }
}
```

## OneDrive and Google Drive Are Server-Side Only

The plugin does not connect directly to Google Drive, S3, or OneDrive.

Those providers are backup targets managed by the server.

So the plugin only needs to talk to the FreeVaultSync server API.

## Suggested Plugin Repo Layout

```text
plugin/
├── src/
│   ├── api/
│   │   └── freevault-client.ts
│   ├── settings/
│   │   └── sync-settings.ts
│   ├── sync/
│   │   ├── sync-engine.ts
│   │   └── conflict-resolver.ts
│   └── main.ts
└── manifest.json
```

## Local Development Setup

For the plugin repo:

- run the server locally on port 3000
- point the plugin to `http://localhost:3000`
- test one file roundtrip first before adding full sync

Recommended test sequence:

1. `GET /health`
2. `PUT /vault/files/Test%2Fhello.md`
3. `GET /vault/files/Test%2Fhello.md`
4. `DELETE /vault/files/Test%2Fhello.md`

## Authentication Note

The current server implementation does not enforce auth yet.

For the plugin repo, assume one of these later options:

- shared secret / bearer token
- OIDC login
- local trusted network only

If auth is added later, the plugin client should be updated in one place only.

## Practical Recommendation

Keep the plugin repository thin:

- UI and editor integration stay in the plugin
- all file sync logic goes through the API client
- keep provider credentials out of the plugin
- let the server own backups, versioning, and storage

## What To Wire First In The Plugin Repo

If you want the fastest reliable implementation path, build it in this order:

1. Settings UI for `serverUrl` and `deviceId`.
2. `FreeVaultClient` wrapper around the server API.
3. Health check and file listing.
4. Single-file roundtrip upload/download.
5. Conflict detection based on `checksum`.
6. Auto-sync and manual sync commands.
7. Optional auth once the base flow is stable.
