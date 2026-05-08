# FreeVaultSync — Projektplan

> Self-hosted Obsidian sync server with web editor, version history, cloud backup, and pluggable OIDC/SAML auth — all in one Docker Compose.

---

## Übersicht

FreeVaultSync ist ein Open-Source-Projekt das als Backend-Layer für Obsidian fungiert. Es ist kein Konkurrent zu Obsidian, sondern ein Add-on das folgende Probleme löst:

- Kein zuverlässiger, selbst gehosteter Sync für Obsidian (besonders auf Mobile)
- Keine Web-Editor-Möglichkeit ohne fremde Server
- Kein einheitliches Backup-System mit eigenen Cloud-Accounts
- Datenverlust durch inkonsistente Sync-Lösungen (z.B. Remotely Save + OneDrive)

---

## Ziele

- **Single-User fokussiert** (primär), Multi-Vault-Support später
- **Mobile-first Sync** — funktioniert zuverlässig auf iOS und Android ohne native Git-Binaries
- **Git-ähnliche History** — Änderungen pro File nachvollziehbar, gelöschte Files wiederherstellbar
- **Bring Your Own Cloud** — User verbinden ihren eigenen Google Drive / OneDrive als Backup-Ziel
- **Pluggable Auth** — OIDC/SAML, kompatibel mit ZITADEL, Keycloak, Authentik, Cloudflare Access
- **Vollständig selbst hostbar** — ein einziges `docker compose up`

---

## Architektur

### Repository-Struktur

Zwei separate Repositories:

**`freevaultsync-server`** — Server + Admin UI + Web Editor
```
freevaultsync-server/
├── server/           # Node.js REST API + Sync Logic + Backup
├── admin/            # React + Vite Admin UI
├── editor/           # React + Vite + CodeMirror Web Editor
├── docker-compose.yml
├── docker-compose.example.yml
└── README.md
```

**`freevaultsync-plugin`** — Obsidian Community Plugin
```
freevaultsync-plugin/
├── src/
│   ├── main.ts       # Plugin Entry Point
│   ├── sync.ts       # Sync Logic + Offline Queue
│   ├── auth.ts       # OIDC Login Flow
│   ├── conflict.ts   # Conflict Resolution (diff3)
│   └── statusbar.ts  # Statusbar Icon
├── manifest.json     # Obsidian Plugin Manifest
├── package.json
└── README.md
```

**Warum 2 Repos:**
- Plugin wird eigenständig im Obsidian Plugin Directory eingereicht — braucht ein sauberes, isoliertes Repo
- User die nur das Plugin installieren sehen keinen Server-Code
- Unabhängiges Versioning (Plugin v1.2 und Server v2.0 laufen unabhängig)
- Issues und PRs bleiben thematisch getrennt
- Admin UI und Web Editor bleiben im Server-Repo da sie direkt vom Server abhängen

### Stack

| Komponente | Technologie |
|---|---|
| Server | Node.js + TypeScript + Express |
| Datenbank | SQLite (via better-sqlite3) |
| File Storage | Lokales Filesystem |
| Plugin | TypeScript (Obsidian Plugin API) |
| Admin UI | React + Vite |
| Web Editor | React + Vite + CodeMirror 6 |
| Auth | OIDC/SAML via `openid-client` + `passport-saml` |
| Diff-Algorithmus | `diff3` (für Conflict Resolution) |
| Tunnel | Cloudflare Tunnel (empfohlen, nicht zwingend) |

### Datenfluss

```
Mobile / Desktop Obsidian Plugin
    → HTTPS (JWT Token)
        → Cloudflare Tunnel
            → REST API (Node.js)
                → Version Store (SQLite + Filesystem)
                    → Cloud Backup (Google Drive / OneDrive OAuth)

Web Editor
    → OIDC/SAML Login
        → Cloudflare Tunnel
            → REST API
                → Markdown Files (serverseitig entschlüsselt)
```

---

## Komponenten im Detail

### 1. Server (Node.js REST API)

**Verantwortlichkeiten:**
- File-Sync zwischen Clients (Push/Pull)
- Versionierung aller File-Änderungen
- Diff-Berechnung zwischen Versionen
- Conflict Resolution
- Cloud Backup Orchestrierung
- JWT-Validierung (OIDC)

**API Endpoints:**

```
GET    /health                    # Health Check (für Docker + Uptime Kuma)

POST   /auth/token               # OIDC Token Exchange

GET    /vault/files              # Liste aller Files + Checksums
GET    /vault/files/:path        # File-Inhalt abrufen
PUT    /vault/files/:path        # File pushen (mit Checksum)
DELETE /vault/files/:path        # File löschen

GET    /vault/history/:path      # Versionshistory eines Files
GET    /vault/history/:path/:id  # Bestimmte Version abrufen
POST   /vault/restore/:path/:id  # Version wiederherstellen

GET    /devices                  # Verbundene Geräte
POST   /devices/register         # Gerät registrieren

GET    /backup/destinations      # Konfigurierte Backup-Ziele
POST   /backup/destinations      # Backup-Ziel hinzufügen (OAuth Flow)
POST   /backup/run               # Manuelles Backup triggern
GET    /backup/status            # Letzter Backup-Status

GET    /admin/log                # Sync Log (Server-Sent Events)
GET    /admin/stats              # Storage Stats
```

**SQLite Schema:**

```sql
-- Files und ihre aktuelle Version
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  size INTEGER,
  updated_at INTEGER,
  updated_by TEXT  -- device_id
);

-- Versionshistory
CREATE TABLE versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  diff TEXT,           -- diff zum Vorgänger
  snapshot BOOLEAN,    -- TRUE = kompletter Snapshot, FALSE = nur Diff
  created_at INTEGER,
  created_by TEXT      -- device_id
);

-- Registrierte Geräte
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  platform TEXT,       -- ios / android / mac / windows / linux
  last_seen INTEGER,
  last_sync INTEGER
);

-- Sync Log
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT,          -- push / pull / conflict / error
  path TEXT,
  device_id TEXT,
  detail TEXT,
  created_at INTEGER
);

-- Backup Destinations
CREATE TABLE backup_destinations (
  id TEXT PRIMARY KEY,
  provider TEXT,       -- google_drive / onedrive
  access_token TEXT,   -- verschlüsselt gespeichert
  refresh_token TEXT,  -- verschlüsselt gespeichert
  last_backup INTEGER,
  enabled BOOLEAN
);
```

---

### 2. Obsidian Plugin

**Features:**
- Auto-Sync beim Öffnen (Pull) und Schließen (Push)
- Hintergrund-Sync in konfigurierbarem Intervall
- Offline Queue — Änderungen werden lokal gequeued und beim nächsten Connect gepusht
- Statusbar Icon:
  - ✓ Synced
  - ↑↓ Syncing
  - ⚡ Offline (queued changes)
  - ⚠ Conflict
- Manueller Sync Button in der Command Palette
- Konfigurierbares Ignore-Muster (wie `.gitignore`) für Ordner/Files
- OIDC Login Flow direkt im Plugin (öffnet Browser für Auth)
- Optionaler `.obsidian/` Sync (konfigurierbar)

**Sync-Logik:**

```
Beim Start:
1. GET /vault/files → Server-Checksums
2. Lokale Checksums berechnen
3. Diff: Was fehlt lokal? Was ist neuer auf dem Server?
4. Pull was fehlt / neuer ist
5. Push was lokal neuer ist
6. Bei Konflikt → Conflict Resolution

Im Hintergrund (Intervall, default: 30s):
1. Geänderte Files erkennen (Obsidian file-change events)
2. Sofort pushen
3. Bei Offline → in Queue schreiben
4. Bei Reconnect → Queue abarbeiten
```

**Conflict Resolution (diff3):**

Wenn dasselbe File auf zwei Geräten gleichzeitig geändert wurde:
1. Gemeinsamen Ancestor aus der History holen
2. `diff3` auf Ancestor + Version A + Version B
3. Wenn merge sauber → automatisch mergen
4. Wenn echter Konflikt → Conflict-Marker ins File schreiben (wie Git), User wird per Notice benachrichtigt

---

### 3. Admin UI (React + Vite)

**Seiten:**

**Dashboard**
- Anzahl Files, Gesamtgröße, letzter Sync
- Verbundene Geräte + Status
- Letzter Backup-Status

**Vault Overview**
- File-Browser mit Ordnerstruktur
- Größe, letzter Sync, welches Gerät zuletzt geändert hat
- Suche

**File History**
- Versionshistory pro File
- Diff View zwischen zwei Versionen (side-by-side)
- "Restore" Button für jede Version

**Devices**
- Liste aller registrierten Geräte
- Platform, letzter Sync-Zeitpunkt
- Gerät entfernen / deautorisieren

**Sync Log**
- Live-Feed aller Events (Server-Sent Events)
- Filter nach Event-Typ, Gerät, File
- Push / Pull / Conflict / Error

**Backup**
- Backup-Destinations verwalten
- Google Drive OAuth verbinden
- OneDrive OAuth verbinden
- Backup Schedule einstellen (Cron)
- Manuelles Backup triggern
- Restore aus Cloud-Snapshot

**Settings**
- OIDC/SAML Konfiguration (Metadata URL, Client ID, Secret)
- Sync-Intervall
- Ignore-Patterns
- `.obsidian/` Sync ein/ausschalten
- Encryption ein/ausschalten

---

### 4. Web Editor (React + Vite + CodeMirror 6)

**Features:**
- File-Browser (linke Sidebar)
- Markdown Editor mit CodeMirror 6 (gleiche Engine wie Obsidian)
- Live Preview (Split View: Editor | Rendered Markdown)
- Syntax Highlighting
- Speichern → direkt per API gepusht (erscheint sofort auf allen Geräten)
- OIDC/SAML Login (kein separater Key nötig)
- Mobile-optimiertes Layout

**Auth-Modell:**
- Web Editor authentifiziert via OIDC/SAML
- Server entschlüsselt Files serverseitig für die Web-Session
- Server ist "trusted" — kein echtes E2E für die Web-Session (by design)

---

### 5. Auth

**Strategie:**
- Einzige Auth-Schicht: OIDC/SAML
- Kompatibel mit: ZITADEL, Keycloak, Authentik, Authelia, Cloudflare Access
- Nach Login: JWT Token mit konfigurierbarer Expiry
- Plugin speichert JWT Token lokal, schickt es bei jedem API-Call mit
- Fallback für Quickstart: einfacher Username/Password Mode (kein externer IdP nötig)

**Empfohlene Setups im README:**
- ZITADEL (selbst gehostet)
- Cloudflare Access (managed)
- Authentik (selbst gehostet)

---

### 6. Cloud Backup

**Provider:**
- Google Drive (OAuth2 + Google Drive API)
- OneDrive (OAuth2 + Microsoft Graph API)

**Backup-Format:**
- Verschlüsseltes ZIP des gesamten Vaults + SQLite DB (Version History)
- AES-256 mit einem Backup-Key der in der Admin UI konfiguriert wird
- Dateiname: `freevaultsync-backup-2026-05-07T12-00-00.zip`

**Schedule:**
- Cron-basiert, einstellbar in der Admin UI
- Default: täglich um 03:00 Uhr

**Restore:**
- Aus der Admin UI: Cloud-Snapshots listen, auswählen, wiederherstellen
- Einzelne Files oder kompletten Vault

---

### 7. Encryption (optional, konfigurierbar)

**Encryption at Rest:**
- AES-256-GCM
- Key wird beim Setup generiert, in der Admin UI angezeigt (einmalig)
- Key wird als Passphrase eingegeben und via Argon2 zum AES-Key abgeleitet
- Server speichert den Key **nicht** — nur den Argon2-Salt
- Web Editor Session: Key wird für die Session im Server-Memory gehalten (nach Login via Passphrase eingeben)
- Bei Geräteverlust: Recovery via Passphrase (da Key aus Passphrase abgeleitet)

---

## Docker Compose

```yaml
services:
  server:
    build: ./server
    volumes:
      - ./data/vault:/data/vault
      - ./data/db:/data/db
    environment:
      - OIDC_ISSUER_URL=https://your-idp.com
      - OIDC_CLIENT_ID=freevaultsync
      - OIDC_CLIENT_SECRET=secret
      - ENCRYPTION_ENABLED=false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  admin:
    build: ./admin
    environment:
      - VITE_API_URL=http://server:3000

  editor:
    build: ./editor
    environment:
      - VITE_API_URL=http://server:3000
```

---

## Deployment (empfohlen)

```
Cloudflare Tunnel
├── freevaultsync.deinedomain.com     → admin UI (Port 5173)
├── editor.freevaultsync.deinedomain.com → web editor (Port 5174)
└── api.freevaultsync.deinedomain.com → REST API (Port 3000)
```

---

## OSS & Plugin Directory

- **Lizenz:** MIT
- **GitHub:** unter persönlichem Account (`github.com/joconpany/freevaultsync` o.ä.)
- **Obsidian Plugin Directory:** Early einreichen (Review dauert Wochen)
  - Plugin muss Plugin-Guidelines erfüllen
  - Repo muss public sein
  - Kein obfuscated Code
- **README Quickstart:** Docker Compose + ZITADEL Beispiel-Config als Copy-Paste

---

## Roadmap

### Phase 1 — MVP
- [ ] Server: REST API + SQLite + File Storage
- [ ] Server: Push/Pull Sync Logic + Checksums
- [ ] Server: Version History + Diff
- [ ] Plugin: Auto-Sync (Push/Pull)
- [ ] Plugin: Offline Queue
- [ ] Plugin: Statusbar Icon
- [ ] Plugin: OIDC Login
- [ ] Auth: OIDC/SAML Integration
- [ ] Docker Compose Setup
- [ ] README + Quickstart Guide

### Phase 2 — Admin UI
- [ ] Dashboard
- [ ] Vault Overview + File Browser
- [ ] File History + Diff View + Restore
- [ ] Device Management
- [ ] Live Sync Log
- [ ] Settings

### Phase 3 — Web Editor
- [ ] CodeMirror 6 Editor
- [ ] Split View (Editor + Preview)
- [ ] OIDC Login im Browser
- [ ] Mobile-optimiertes Layout

### Phase 4 — Cloud Backup
- [ ] Google Drive OAuth + Backup
- [ ] OneDrive OAuth + Backup
- [ ] Backup Schedule (Cron)
- [ ] Restore aus Cloud

### Phase 5 — Later
- [ ] Conflict Resolution UI
- [ ] Multi-Vault Support
- [ ] Storage Analytics
- [ ] Encryption at Rest (optional)
- [ ] Obsidian Plugin Directory Submission