import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "infra", "docker-compose.yml");

const r = spawnSync("docker", ["compose", "-f", compose, "down"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(r.status ?? 0);
