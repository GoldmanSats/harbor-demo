import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { openDatabase } from "./db/schema.js";
import { registerRoutes } from "./routes/api.js";
import { HttpBitcoinRpc } from "./bitcoin/rpc.js";
import { MockBitcoinRpc } from "./bitcoin/mock-rpc.js";
import type { BitcoinRpc } from "./bitcoin/rpc.js";
import { MockRateProvider, startPoller } from "./services/detection.js";
import {
  DEMO_ACCOUNT_XPUB,
  MOCK_BTC_USD,
  POLL_INTERVAL_MS,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type HarborApp = {
  app: ReturnType<typeof Fastify>;
  db: ReturnType<typeof openDatabase>;
  rpc: BitcoinRpc;
  stop: () => Promise<void>;
};

function shouldServeWeb(): boolean {
  return (
    process.env.HARBOR_SERVE_WEB === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.HARBOR_HOSTED === "1"
  );
}

function isHostedMode(): boolean {
  return (
    process.env.HARBOR_HOSTED === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true"
  );
}

function resolveWebDist(): string | null {
  const candidates = [
    process.env.HARBOR_WEB_DIST,
    path.join(path.resolve(__dirname, "../../.."), "web", "dist"),
    path.join(path.resolve(__dirname, "../.."), "web", "dist"),
    path.join(path.resolve(__dirname, ".."), "public"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

export async function createApp(options: {
  dbPath?: string;
  rpc?: BitcoinRpc;
  port?: number;
  host?: string;
  listen?: boolean;
  serveWeb?: boolean;
  webDist?: string;
} = {}): Promise<HarborApp> {
  const defaultDbDir = isHostedMode()
    ? path.join("/tmp", "harbor")
    : path.join(path.resolve(__dirname, "../../.."), "data");
  const dbPath =
    options.dbPath ??
    process.env.HARBOR_DB_PATH ??
    path.join(defaultDbDir, "harbor.db");
  const db = openDatabase(dbPath);

  const rpc = options.rpc ?? (await connectBitcoin());
  const rateProvider = new MockRateProvider(
    Number(process.env.HARBOR_BTC_USD ?? MOCK_BTC_USD),
  );

  const app = Fastify({ logger: Boolean(options.listen ?? true) });
  await app.register(cors, { origin: true });
  await registerRoutes(app, {
    db,
    rpc,
    rateProvider,
    accountXpub: process.env.HARBOR_XPUB ?? DEMO_ACCOUNT_XPUB,
  });

  const serveWeb = options.serveWeb ?? shouldServeWeb();
  if (serveWeb) {
    const webDist = options.webDist ?? resolveWebDist();
    if (!webDist) {
      throw new Error(
        "HARBOR_SERVE_WEB/production mode requires web/dist (run npm run build first)",
      );
    }
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  const poller = startPoller(db, rpc, rateProvider, POLL_INTERVAL_MS);

  if (options.listen !== false) {
    const port = options.port ?? Number(process.env.PORT ?? 3001);
    const host =
      options.host ??
      process.env.HOST ??
      (isHostedMode() || serveWeb ? "0.0.0.0" : "127.0.0.1");
    await app.listen({ port, host });
  }

  return {
    app,
    db,
    rpc,
    stop: async () => {
      poller.stop();
      await app.close();
      db.close();
    },
  };
}

async function connectBitcoin(): Promise<BitcoinRpc> {
  // Hosted / production demos always use the in-process mock (fake money).
  if (isHostedMode() || process.env.HARBOR_BITCOIN === "mock") {
    console.log("[harbor] Using in-process mock Bitcoin RPC");
    return new MockBitcoinRpc();
  }

  const mode = process.env.HARBOR_BITCOIN ?? "auto";
  if (mode === "mock") {
    console.log("[harbor] Using in-process mock Bitcoin RPC");
    return new MockBitcoinRpc();
  }

  const url = process.env.BITCOIN_RPC_URL ?? "http://127.0.0.1:18443";
  const username = process.env.BITCOIN_RPC_USER ?? "harbor";
  const password = process.env.BITCOIN_RPC_PASSWORD ?? "harbor-regtest";
  const http = new HttpBitcoinRpc({ url, username, password });

  try {
    await http.getBlockchainInfo();
    console.log("[harbor] Connected to Bitcoin Core at", url);
    await ensureWatchOnlyWallet(http);
    return http.withWallet("harbor-watch");
  } catch (err) {
    if (mode === "regtest") throw err;
    console.warn(
      "[harbor] Bitcoin Core unavailable, falling back to mock RPC:",
      (err as Error).message,
    );
    return new MockBitcoinRpc();
  }
}

async function ensureWatchOnlyWallet(rpc: HttpBitcoinRpc): Promise<void> {
  const walletName = "harbor-watch";
  try {
    await rpc.loadWallet(walletName);
  } catch {
    try {
      await rpc.createWallet(walletName, { disablePrivateKeys: true, blank: true });
    } catch {
      try {
        await rpc.loadWallet(walletName);
      } catch {
        /* ignore */
      }
    }
  }

  const walletRpc = rpc.withWallet(walletName);
  const xpub = process.env.HARBOR_XPUB ?? DEMO_ACCOUNT_XPUB;
  const desc = `tr(${xpub}/0/*)`;
  try {
    const info = await walletRpc.getDescriptorInfo(desc);
    await walletRpc.importDescriptors([
      {
        desc: `${desc}#${info.checksum}`,
        timestamp: "now",
        active: true,
        range: [0, 1000],
        watchonly: true,
      },
    ]);
  } catch (err) {
    console.warn("[harbor] importdescriptors warning:", (err as Error).message);
  }

  try {
    await rpc.createWallet("harbor-miner");
  } catch {
    try {
      await rpc.loadWallet("harbor-miner");
    } catch {
      /* ignore */
    }
  }
  const miner = rpc.withWallet("harbor-miner");
  try {
    const info = await miner.getBlockchainInfo();
    if (info.blocks < 101) {
      const addr = await miner.getNewAddress("mining");
      await miner.generateToAddress(101, addr);
    }
  } catch (err) {
    console.warn("[harbor] miner setup:", (err as Error).message);
  }
}

export { DEMO_ACCOUNT_XPUB, MOCK_BTC_USD, isHostedMode, shouldServeWeb, resolveWebDist };
