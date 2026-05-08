# FreeVaultSync

FreeVaultSync — Server

Dieses Repository enthält ausschließlich den Server von FreeVaultSync (Dual-repo-Entscheidung). Der Server stellt die REST-API, SQLite-basierte Versionierung und die Backup-Orchestrierung bereit.

## Aktueller Stand

Der Server ist als TypeScript/Express-Projekt angelegt. Ein Health-Endpoint existiert unter `GET /health`.

## Entwicklung

Installation und Dev-Start (im Projekt-Root):

```bash
npm install
npm run dev:server
```

Der Dev-Server startet `ts-node-dev` und lädt `server/src/index.ts`.

Hinweis: Das Projekt erwartet Node.js v20 (LTS). Ich habe eine `.nvmrc` und `.node-version` mit `20` hinzugefügt.

Wenn du `nvm` verwendest, wechsle mit:

```bash
nvm install
nvm use
```

Wenn du `fnm`/`volta`/`asdf` nutzt, verwende den jeweiligen Befehl, z.B. `fnm install 20` oder `volta install node@20`.

## Nächste Schritte

- Implementiere die SQLite-Persistenz (`server/src/db.ts`) und die API-Endpunkte für Vault-Files und History.
- Backup-Integrationen und Auth folgen danach.
