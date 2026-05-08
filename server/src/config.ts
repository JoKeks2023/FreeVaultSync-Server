export type ServerConfig = {
  port: number;
};

export function loadConfig(): ServerConfig {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  return {
    port: Number.isFinite(port) ? port : 3000,
  };
}
