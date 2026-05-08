import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  // Keep startup visible while the real sync stack is added.
  console.log(`FreeVaultSync server listening on port ${config.port}`);
});
