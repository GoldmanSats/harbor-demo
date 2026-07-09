import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "infra", "docker-compose.yml");

function hasDocker(): boolean {
  const r = spawnSync("docker", ["info"], { encoding: "utf8" });
  return r.status === 0;
}

if (!hasDocker()) {
  console.log("Docker not available. Harbor will use the in-process mock Bitcoin RPC.");
  console.log("Set HARBOR_BITCOIN=mock (default for npm run demo) or install Docker + pull bitcoin/bitcoin:28.0.");
  process.exit(0);
}

const up = spawnSync("docker", ["compose", "-f", compose, "up", "-d"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(up.status ?? 1);
