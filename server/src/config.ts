export type ServerConfig = {
  port: number;
  vaultDir: string;
  dbDir: string;
};

let cachedConfig: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;
  
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const vaultDir = process.env.VAULT_DIR ?? "./data/vault";
  const dbDir = process.env.DB_DIR ?? "./data/db";

  cachedConfig = {
    port: Number.isFinite(port) ? port : 3000,
    vaultDir,
    dbDir,
  };
  
  return cachedConfig;
}

export function getConfig(): ServerConfig {
  return loadConfig();
}
