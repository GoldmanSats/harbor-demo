import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children: ChildProcess[] = [];

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

fs.mkdirSync(path.join(root, "data"), { recursive: true });

console.log("\nHarbor demo starting…\n");

// Prefer mock on machines without Docker/bitcoind; override with HARBOR_BITCOIN=regtest
const bitcoinMode = process.env.HARBOR_BITCOIN ?? "mock";

run("npm", ["run", "dev", "-w", "server"], {
  HARBOR_BITCOIN: bitcoinMode,
  HARBOR_DB_PATH: path.join(root, "data", "harbor.db"),
  PORT: "3001",
});

run("npm", ["run", "dev", "-w", "web"]);

try {
  await waitForHealth("http://127.0.0.1:3001/api/health");
  console.log(`
Harbor is up (bitcoin backend: ${bitcoinMode})

  Donor page:   http://localhost:5173/donate
  Dashboard:    http://localhost:5173/dashboard

Simulate a donation in another terminal:
  npm run simulate-donor
  npm run simulate-donor -- --amount 750000

Press Ctrl+C to stop.
`);
} catch (err) {
  console.error(err);
  shutdown();
  process.exit(1);
}

// Keep process alive while children run
await new Promise(() => {
  /* hang until signal */
});
