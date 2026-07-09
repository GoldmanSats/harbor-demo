import { createApp } from "./app.js";

// Hosted / production defaults (Render sets NODE_ENV=production).
if (process.env.NODE_ENV === "production" || process.env.RENDER === "true") {
  process.env.HARBOR_HOSTED ??= "1";
  process.env.HARBOR_BITCOIN ??= "mock";
  process.env.HARBOR_SERVE_WEB ??= "1";
  process.env.HARBOR_DB_PATH ??= "/tmp/harbor/harbor.db";
}

const harbor = await createApp({ listen: true });

const shutdown = async () => {
  await harbor.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
