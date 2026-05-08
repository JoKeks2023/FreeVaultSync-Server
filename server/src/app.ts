import express from "express";

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
      endpoints: ["/health"],
    });
  });

  return app;
}
