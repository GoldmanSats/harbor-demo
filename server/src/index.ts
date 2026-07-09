import { createApp } from "./app.js";

const harbor = await createApp({ listen: true });

const shutdown = async () => {
  await harbor.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
