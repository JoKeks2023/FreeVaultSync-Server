# FreeVaultSync - Dateispeicher Konfiguration

FreeVaultSync speichert Dateien persistent auf der Festplatte und verwaltet **Metadaten in SQLite**.

## Speicher-Architektur

```
FreeVaultSync
├── Dateien                    (Disk-Speicher)
│  └── ./data/vault/           [konfigurierbar via VAULT_DIR]
│     ├── Notes/
│     │  ├── demo.md
│     │  └── thoughts.md
│     └── Docs/
│        ├── todo.txt
│        └── budget.xlsx
│
└── Metadaten & Versionierung  (SQLite-Datenbank)
   └── ./data/db/freevault.db  [konfigurierbar via DB_DIR + DB_FILE]
      ├── files (path, checksum, size, updated_at, updated_by)
      ├── versions (history snapshots & diffs)
      ├── devices (registrierte Clients)
      ├── sync_log (audit trail)
      └── backup_destinations (Cloud-Backups)
```

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|----------|------------|
| `VAULT_DIR` | `./data/vault` | Ordner für .md Datei-Speicher |
| `DB_DIR` | `./data/db` | Ordner für SQLite Datenbank |
| `DB_FILE` | `freevault.db` | Dateiname der SQLite DB |
| `PORT` | `3000` | Server Port |

## Lokal (ohne Docker)

### Installation

```bash
# Node 20+ erforderlich (Kompatibilität mit better-sqlite3)
nvm install 20
nvm use 20

# Dependencies
npm install

# Build
npm run build

# Run
npm run start
```

### Datenspeicher anpassen

```bash
# Option 1: Standard-Pfade
npm run start

# Option 2: Externe NAS
VAULT_DIR=/mnt/nas/vault npm run start

# Option 3: Tmpfs (flüchtig - nur für Tests!)
mkdir -p /tmp/vault /tmp/db
VAULT_DIR=/tmp/vault DB_DIR=/tmp/db npm run start
```

### Verzeichnisse manuell erstellen (falls needed)

```bash
mkdir -p data/vault data/db
chmod 755 data/vault data/db
```

## Docker (empfohlen für Produktion)

### Quick Start

```bash
# Mit Named Volumes (Docker verwaltet Storage)
docker-compose up -d

# Prüfe ob Volumes erstellt wurden
docker volume ls | grep freevault
```

### Storage-Optionen in Docker

#### Option 1: Named Volumes (Standard)

**Vorteil:** Docker verwaltet alles, automatische Backups möglich
**Nachteil:** Dateien sind im Docker-System-Storage (i.d.R. `/var/lib/docker/volumes/`)

```yaml
volumes:
  vault_data:
    driver: local
  db_data:
    driver: local

services:
  freevaultsync-server:
    volumes:
      - vault_data:/data/vault
      - db_data:/data/db
```

**Zugriff auf Daten:**

```bash
# Volumes auflisten
docker volume ls

# Volume-Pfad ermitteln (Linux/macOS mit Docker Desktop)
docker volume inspect freevaultsync_vault_data

# In den Volume kopieren
docker cp local-file.md <container-id>:/data/vault/Notes/
```

#### Option 2: Bind-Mounts (Host-Zugriff)

**Vorteil:** Dateien direkt im Host-Dateisystem verfügbar
**Nachteil:** Pfade müssen manuell erstellt und gepflegt werden

```yaml
# In docker-compose.yml:
services:
  freevaultsync-server:
    volumes:
      - /home/user/my-vault:/data/vault
      - /home/user/freevault-backups:/data/db
```

**Setup:**

```bash
# Ordner erstellen
mkdir -p ~/my-vault ~/freevault-backups

# Berechtigungen setzen (UID 1000 = standard user in Linux)
chmod 755 ~/my-vault ~/freevault-backups

# docker-compose.yml anpassen
# Dann starten
docker-compose up -d

# Dateien sind nun auf dem Host sichtbar
ls ~/my-vault/
```

### Docker-Compose mit Custom Paths

**Beispiel mit Bind-Mount:**

```yaml
version: '3.8'

services:
  freevaultsync-server:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      VAULT_DIR: /data/vault
      DB_DIR: /data/db
      NODE_ENV: production
    volumes:
      - /home/user/vault:/data/vault
      - /home/user/db-backups:/data/db
    restart: unless-stopped
```

**Starten:**

```bash
docker-compose up -d
docker-compose logs -f  # Logs verfolgen
```

## Sicherheit & Best Practices

### Path Traversal Prevention

Alle Dateipfade werden validiert mit `validatePath()`:

```typescript
// ✅ Erlaubt
GET /vault/files/Notes%2Fdemo.md     → Notes/demo.md

// ❌ Blockiert (Directory Traversal)
GET /vault/files/..%2F..%2Fetc%2Fpasswd
```

### Backup-Strategie

```bash
# Option 1: SQLite Datenbank backup
docker cp <container-id>:/data/db/freevault.db ./freevault-backup.db

# Option 2: Alle Daten sichern
docker-compose down
cp -r data/ data-backup-$(date +%Y%m%d)/
docker-compose up -d

# Option 3: Named Volumes sichern
docker run --rm -v freevaultsync_vault_data:/data \
  -v $(pwd):/backup ubuntu tar czf /backup/vault.tar.gz /data
```

### Berechtigungen (Linux)

```bash
# Vault-Ordner nur für den User lesbar
chmod 700 data/vault
chmod 600 data/vault/*

# DB-Datei schreibgeschützt
chmod 600 data/db/freevault.db
```

## Metadaten-Struktur

Jede Datei speichert folgende Metadaten in der `files`-Tabelle:

```json
{
  "path": "Notes/demo.md",
  "checksum": "ebcd7d67c9251b26356e3b00421ec7e0c314562a744d1cebfed5a874ed32a922",
  "size": 25,
  "updated_at": 1778321675926,
  "updated_by": "device-mac"
}
```

**Bedeutung:**
- `path`: Relative Pfad zum Vault-Root
- `checksum`: SHA256-Hash des Datei-Inhalts (für Duplikat-Erkennung)
- `size`: Dateigröße in Bytes
- `updated_at`: Unix-Timestamp (ms) der letzten Änderung
- `updated_by`: Device-ID des bearbeitenden Clients

## API-Endpoints

### Datei speichern

```bash
curl -X PUT http://localhost:3000/vault/files/Notes%2Fdemo.md \
  -H "content-type: application/json" \
  -d '{
    "content": "# My Note\nHello!",
    "updatedBy": "device-macbook"
  }'
```

**Response:**

```json
{
  "status": "ok",
  "path": "Notes/demo.md",
  "checksum": "...",
  "size": 25,
  "updated_at": 1778321675926,
  "updated_by": "device-macbook"
}
```

### Datei laden

```bash
curl http://localhost:3000/vault/files/Notes%2Fdemo.md
```

**Response:**

```json
{
  "path": "Notes/demo.md",
  "checksum": "...",
  "size": 25,
  "updated_at": 1778321675926,
  "updated_by": "device-macbook",
  "content": "# My Note\nHello!"
}
```

### Alle Dateien auflisten

```bash
curl http://localhost:3000/vault/files
```

### Versionsverlauf

```bash
curl http://localhost:3000/vault/history/Notes%2Fdemo.md
```

**Response:**

```json
{
  "path": "Notes/demo.md",
  "versions": [
    {
      "id": 1,
      "checksum": "...",
      "snapshot": 1,
      "created_at": 1778321675926,
      "created_by": "device-macbook"
    }
  ]
}
```

### Datei löschen

```bash
curl -X DELETE http://localhost:3000/vault/files/Notes%2Fdemo.md
```

## Troubleshooting

### "Cannot access /data/vault"

```bash
# In Docker: Volumes prüfen
docker-compose ps
docker volume ls

# Volumes neu erstellen
docker volume rm freevaultsync_vault_data
docker-compose up -d
```

### "ENOSPC: no space left on device"

```bash
# Speicherplatz prüfen
df -h /data/vault
docker system df

# Cleanup
docker system prune -a
```

### Datei erscheint in API, nicht auf Disk

```bash
# Volumes auflisten
docker exec freevaultsync ls -la /data/vault/

# Container-Dateisystem prüfen
docker inspect freevaultsync | grep Mounts
```

## Nächste Schritte

- [ ] Cloud Backup (Google Drive, AWS S3)
- [ ] Sync-Log archivieren
- [ ] Automatische DB-Optimierung (VACUUM)
- [ ] Quota-Management (max. Vault-Größe)
