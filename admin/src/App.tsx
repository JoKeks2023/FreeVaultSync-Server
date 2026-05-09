import { useEffect, useMemo, useState } from 'react';
import { getAdminStats, getApiBaseUrl, getHistory, health, listBackupDestinations, listBackupStatus, listDevices, listFiles } from './api';
import type { AdminStats, BackupDestination, BackupStatusItem, DeviceRow, FileRow, HistoryResponse } from './types';

type LoadState = {
  loading: boolean;
  error: string | null;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'n/a';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function relativeTime(timestamp?: number): string {
  if (!timestamp) return 'n/a';
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} d`;
}

function fileFolder(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'google-drive':
      return 'Google Drive';
    case 's3':
      return 'Amazon S3';
    case 'onedrive-personal':
      return 'OneDrive Personal';
    case 'onedrive-business':
      return 'OneDrive Business';
    default:
      return provider;
  }
}

export default function App() {
  const [state, setState] = useState<LoadState>({ loading: true, error: null });
  const [healthy, setHealthy] = useState(false);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [backupItems, setBackupItems] = useState<BackupStatusItem[]>([]);
  const [destinations, setDestinations] = useState<BackupDestination[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [
        healthResponse,
        filesResponse,
        backupStatusResponse,
        backupDestinationsResponse,
        devicesResponse,
        statsResponse,
      ] = await Promise.all([
        health(),
        listFiles(),
        listBackupStatus().catch(() => ({ status: 'error', providers: [] as BackupStatusItem[] })),
        listBackupDestinations().catch(() => ({ status: 'error', destinations: [] as BackupDestination[] })),
        listDevices().catch(() => ({ devices: [] as DeviceRow[] })),
        getAdminStats().catch(() => null),
      ]);

      setHealthy(healthResponse.status === 'ok');
      setFiles(filesResponse.files);
      setBackupItems(backupStatusResponse.providers);
      setDestinations(backupDestinationsResponse.destinations);
      setDevices(devicesResponse.devices);
      setStats(statsResponse?.stats ?? null);
      setState({ loading: false, error: null });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      });
      setHealthy(false);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setHistory(null);
      setSelectedHistoryVersion(null);
      return;
    }

    let cancelled = false;
    getHistory(selectedPath)
      .then((response) => {
        if (cancelled) return;
        setHistory(response);
        setSelectedHistoryVersion(response.versions[0]?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setHistory(null);
        setSelectedHistoryVersion(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const metrics = useMemo(() => {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const latestUpdatedAt = files.reduce((latest, file) => Math.max(latest, file.updated_at ?? 0), 0);
    const activeBackups = backupItems.filter((item) => item.status === 'ok').length;
    const latestSyncAt = stats?.last_sync_at ?? devices.reduce((latest, device) => Math.max(latest, device.last_sync ?? 0), 0);

    return [
      { label: 'Dateien', value: files.length.toString(), hint: `${files.length === 0 ? 'Keine Inhalte' : 'im Vault'}` },
      { label: 'Speicher', value: formatBytes(totalSize), hint: 'Gesamtgröße' },
      { label: 'Letzte Änderung', value: relativeTime(latestUpdatedAt), hint: formatDate(latestUpdatedAt) },
      { label: 'Geräte', value: devices.length.toString(), hint: `letzter Sync ${relativeTime(latestSyncAt)}` },
      { label: 'Versionen', value: (stats?.versions ?? 0).toString(), hint: 'History-Einträge' },
      { label: 'Sync Events', value: (stats?.sync_events ?? 0).toString(), hint: 'Audit Trail' },
      { label: 'Backup Ziele', value: `${activeBackups}/${destinations.length}`, hint: 'verbunden' },
    ];
  }, [backupItems, destinations.length, devices, files, stats?.last_sync_at, stats?.versions, stats?.sync_events]);

  const selectedFile = history?.versions.find((entry) => entry.id === selectedHistoryVersion) ?? history?.versions[0] ?? null;

  return (
    <div className="app-shell">
      <div className="background-glow background-glow-left" />
      <div className="background-glow background-glow-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">FreeVaultSync Admin</p>
          <h1>Server Control Room</h1>
          <p className="subtitle">
            Ein Port, ein Server, ein Vault. API-Basis: <span>{getApiBaseUrl()}</span>
          </p>
        </div>

        <div className="topbar-actions">
          <div className={`status-pill ${healthy ? 'status-ok' : 'status-error'}`}>
            <span className="status-dot" />
            {healthy ? 'API online' : 'API offline'}
          </div>
          <button type="button" className="primary-button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Aktualisiere...' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="content-grid">
        <section className="hero-card panel">
          <div className="hero-copy">
            <p className="section-label">Server Status</p>
            <h2>Admin UI für Vault, History und Backups</h2>
            <p>
              Die UI liest direkt die vorhandenen Server-Endpunkte und zeigt dir den Zustand des Vaults,
              die Versionen und den Backup-Status an. Alles läuft über denselben Port wie die API.
            </p>
          </div>

          <div className="metrics-grid">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel devices-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Devices</p>
              <h3>Registrierte Geräte</h3>
            </div>
            <span className="panel-meta">{devices.length} Geräte</span>
          </div>

          <div className="list-stack">
            {devices.length === 0 ? (
              <div className="empty-state">Noch keine Geräte registriert.</div>
            ) : (
              devices.map((device) => (
                <article className="device-item" key={device.id}>
                  <div>
                    <strong>{device.name ?? device.id}</strong>
                    <p>
                      {device.device_type ?? 'unknown'} · {device.model ?? 'n/a'} · {device.platform ?? 'n/a'}
                    </p>
                  </div>
                  <div className="device-meta">
                    <span>{device.last_sync ? `Sync ${relativeTime(device.last_sync)}` : 'No sync yet'}</span>
                    <small>{device.last_seen ? `Seen ${relativeTime(device.last_seen)}` : 'n/a'}</small>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <aside className="panel side-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Backup Targets</p>
              <h3>Konfigurierte Ziele</h3>
            </div>
          </div>

          <div className="list-stack">
            {destinations.length === 0 ? (
              <div className="empty-state">Noch keine Backup-Ziele eingerichtet.</div>
            ) : (
              destinations.map((destination) => (
                <article className="list-item" key={destination.id}>
                  <div>
                    <strong>{providerLabel(destination.provider)}</strong>
                    <p>{destination.enabled ? 'Aktiv' : 'Deaktiviert'}</p>
                  </div>
                  <span>{destination.lastBackup ? relativeTime(destination.lastBackup) : 'Kein Backup'}</span>
                </article>
              ))
            )}
          </div>

          <div className="backup-status-block">
            <p className="section-label">Provider Health</p>
            {backupItems.length === 0 ? (
              <div className="empty-state">Keine Statusdaten verfügbar.</div>
            ) : (
              backupItems.map((item) => (
                <article className="status-row" key={item.id}>
                  <div>
                    <strong>{providerLabel(item.provider)}</strong>
                    <p>{item.message}</p>
                  </div>
                  <span className={`mini-pill ${item.status === 'ok' ? 'mini-pill-ok' : 'mini-pill-error'}`}>
                    {item.status}
                  </span>
                </article>
              ))
            )}
          </div>
        </aside>

        <section className="panel vault-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Vault Overview</p>
              <h3>Dateien im Server-Vault</h3>
            </div>
            <span className="panel-meta">{files.length} Einträge</span>
          </div>

          {state.error ? <div className="error-banner">{state.error}</div> : null}

          <div className="table-wrap">
            <table className="vault-table">
              <thead>
                <tr>
                  <th>Pfad</th>
                  <th>Ordner</th>
                  <th>Größe</th>
                  <th>Bearbeitet</th>
                  <th>Gerät</th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      Noch keine Dateien vorhanden.
                    </td>
                  </tr>
                ) : (
                  files.map((file) => (
                    <tr key={file.path} onClick={() => setSelectedPath(file.path)} className={selectedPath === file.path ? 'row-active' : ''}>
                      <td>
                        <button type="button" className="link-button" onClick={() => setSelectedPath(file.path)}>
                          {file.path}
                        </button>
                      </td>
                      <td>{fileFolder(file.path)}</td>
                      <td>{formatBytes(file.size)}</td>
                      <td>{relativeTime(file.updated_at)}</td>
                      <td>{file.updated_by ?? 'unknown'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel history-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">File History</p>
              <h3>{selectedPath ?? 'Datei auswählen'}</h3>
            </div>
            {history ? <span className="panel-meta">{history.versions.length} Versionen</span> : null}
          </div>

          {!selectedPath ? (
            <div className="empty-state">Klicke auf eine Datei, um Versionen und Metadaten zu sehen.</div>
          ) : history?.versions.length ? (
            <div className="history-layout">
              <div className="history-list">
                {history.versions.map((version) => (
                  <button
                    type="button"
                    key={version.id}
                    className={`history-entry ${selectedHistoryVersion === version.id ? 'history-entry-active' : ''}`}
                    onClick={() => setSelectedHistoryVersion(version.id)}
                  >
                    <strong>Version {version.id}</strong>
                    <span>{formatDate(version.created_at)}</span>
                    <small>{version.created_by ?? 'unknown'}</small>
                  </button>
                ))}
              </div>

              <div className="history-detail">
                {selectedFile ? (
                  <>
                    <div className="detail-grid">
                      <div>
                        <span>Checksum</span>
                        <strong>{selectedFile.checksum}</strong>
                      </div>
                      <div>
                        <span>Snapshot</span>
                        <strong>{selectedFile.snapshot ? 'Ja' : 'Nein'}</strong>
                      </div>
                      <div>
                        <span>Erstellt</span>
                        <strong>{formatDate(selectedFile.created_at)}</strong>
                      </div>
                      <div>
                        <span>Gerät</span>
                        <strong>{selectedFile.created_by ?? 'unknown'}</strong>
                      </div>
                    </div>
                    <div className="code-view">
                      <pre>{selectedFile.diff ?? 'Kein Diff gespeichert.'}</pre>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Keine Version ausgewählt.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Keine Historie vorhanden.</div>
          )}
        </section>
      </main>
    </div>
  );
}
