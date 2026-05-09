# FreeVaultSync

FreeVaultSync — Server

Dieses Repository enthält ausschließlich den Server von FreeVaultSync (Dual-repo-Entscheidung). Der Server stellt die REST-API, SQLite-basierte Versionierung und die Backup-Orchestrierung bereit.

## Aktueller Stand

Der Server ist als TypeScript/Express-Projekt angelegt. Ein Health-Endpoint existiert unter `GET /health`.
Die Admin-UI wird aus `admin/` gebaut und läuft im selben Server-Port unter `GET /admin`.
Zusätzlich gibt es jetzt Geräte- und Stats-Endpunkte für das Admin-Panel: `GET /devices` und `GET /admin/stats`.

## Entwicklung

Installation und Dev-Start (im Projekt-Root):

```bash
npm install
npm run dev:server
npm run build:admin
```

Der Dev-Server startet `ts-node-dev` und lädt `server/src/index.ts`.

Hinweis: Das Projekt erwartet Node.js v20 (LTS). Ich habe eine `.nvmrc` und `.node-version` mit `20` hinzugefügt.

Wenn du `nvm` verwendest, wechsle mit:

```bash
nvm install
nvm use
```

Wenn du `fnm`/`volta`/`asdf` nutzt, verwende den jeweiligen Befehl, z.B. `fnm install 20` oder `volta install node@20`.

## Docker

Lokales Server-Image bauen:

```bash
docker build -t freevaultsync-server ./server
```

Container starten:

```bash
docker run --rm -p 3000:3000 \
  -e VAULT_DIR=/data/vault \
  -e DB_DIR=/data/db \
  -v $(pwd)/data/vault:/data/vault \
  -v $(pwd)/data/db:/data/db \
  freevaultsync-server
```

Oder mit Compose:

```bash
docker compose up -d
```

## GitHub Package / GHCR

Für Releases baut die Workflow-Datei [/.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) ein Docker-Image und veröffentlicht es in GitHub Container Registry.

Tagging-Beispiel:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Danach steht das Image typischerweise unter `ghcr.io/<owner>/freevaultsync-server` bereit.

## Nächste Schritte

- Implementiere die SQLite-Persistenz (`server/src/db.ts`) und die API-Endpunkte für Vault-Files und History.
- Backup-Integrationen und Auth folgen danach.
- Für die Plugin-Repo-Integration siehe [PLUGIN_CONNECTION_GUIDE.md](PLUGIN_CONNECTION_GUIDE.md).
- Die Admin-UI liegt in [admin/](admin) und wird im Browser unter `/admin` ausgeliefert.
