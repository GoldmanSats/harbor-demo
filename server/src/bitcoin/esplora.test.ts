import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EsploraBitcoinRpc } from "./esplora.js";
import { LiveRateProvider } from "./live-rate.js";
import { pollOnce } from "../services/detection.js";
import { openDatabase, listDonations } from "../db/schema.js";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/esplora-signet.json"), "utf8"),
) as {
  tipHeight: number;
  address: string;
  pendingTx: unknown;
  confirmedTx: unknown;
  dustTx: unknown;
  prices: { USD: number };
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("EsploraBitcoinRpc", () => {
  it("maps pending address txs to confirmations: 0", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/blocks/tip/height")) return jsonResponse(fixture.tipHeight);
      if (u.includes("/address/")) return jsonResponse([fixture.pendingTx]);
      throw new Error(`unexpected url ${u}`);
    });

    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/api",
      getWatchedAddresses: () => [fixture.address],
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await rpc.listSinceBlock();
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].confirmations).toBe(0);
    expect(result.transactions[0].amount).toBe(0.0075);
    expect(result.transactions[0].address).toBe(fixture.address);
  });

  it("computes confirmations from tip − height + 1", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/blocks/tip/height")) return jsonResponse(fixture.tipHeight);
      if (u.includes("/address/")) return jsonResponse([fixture.confirmedTx]);
      throw new Error(`unexpected url ${u}`);
    });

    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/api",
      getWatchedAddresses: () => [fixture.address],
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await rpc.listSinceBlock();
    // tip 150000, block 149999 → 2 confirmations
    expect(result.transactions[0].confirmations).toBe(2);
  });

  it("reports chain signet from tip height", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(42));
    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/api",
      getWatchedAddresses: () => [],
      fetchImpl: fetchImpl as typeof fetch,
    });
    const info = await rpc.getBlockchainInfo();
    expect(info).toEqual({ chain: "signet", blocks: 42 });
  });

  it("keeps Testnet4 as a distinct chain label", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(42));
    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/testnet4/api",
      chain: "testnet4",
      getWatchedAddresses: () => [],
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(rpc.getBlockchainInfo()).resolves.toEqual({ chain: "testnet4", blocks: 42 });
  });
});

describe("LiveRateProvider", () => {
  it("caches USD price and falls back on failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fixture.prices))
      .mockRejectedValueOnce(new Error("network down"));

    const provider = new LiveRateProvider({
      fallbackRate: 115_000,
      cacheMs: 60_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(provider.getBtcUsd()).toBe(115_000);
    await provider.refresh();
    expect(provider.getBtcUsd()).toBe(97_500);

    // Still within cache — second refresh should not call fetch again for stale miss path,
    // but we force a failed refresh after clearing cache by using a short-lived provider.
    const failing = new LiveRateProvider({
      fallbackRate: 111_000,
      cacheMs: 0,
      fetchImpl: vi.fn().mockRejectedValue(new Error("down")) as typeof fetch,
    });
    await failing.refresh();
    expect(failing.getBtcUsd()).toBe(111_000);
  });
});

describe("esplora → poller integration (stubbed fetch)", () => {
  it("pending then confirmed with correct fiat; dust quarantined", async () => {
    const dbPath = path.join(os.tmpdir(), `harbor-esplora-${Date.now()}.db`);
    const db = openDatabase(dbPath);

    let phase: "pending" | "confirmed" | "dust" = "pending";
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/blocks/tip/height")) return jsonResponse(fixture.tipHeight);
      if (u.includes("/address/")) {
        if (phase === "pending") return jsonResponse([fixture.pendingTx]);
        if (phase === "confirmed") return jsonResponse([fixture.confirmedTx]);
        return jsonResponse([fixture.dustTx]);
      }
      throw new Error(`unexpected ${u}`);
    });

    const rpc = new EsploraBitcoinRpc({
      baseUrl: "https://example.test/api",
      getWatchedAddresses: () => [fixture.address],
      fetchImpl: fetchImpl as typeof fetch,
    });

    const rate = { getBtcUsd: () => 100_000 };

    phase = "pending";
    await pollOnce(db, rpc, rate);
    let donations = listDonations(db);
    expect(donations).toHaveLength(1);
    expect(donations[0].status).toBe("pending");
    expect(donations[0].confirmations).toBe(0);
    expect(donations[0].fiatUsdAtReceipt).toBe(750); // 0.0075 * 100000

    phase = "confirmed";
    await pollOnce(db, rpc, rate);
    donations = listDonations(db);
    expect(donations).toHaveLength(1);
    expect(donations[0].status).toBe("confirmed");
    expect(donations[0].confirmations).toBe(2);
    expect(donations[0].fiatUsdAtReceipt).toBe(750); // never restated

    // Separate dust outpoint
    phase = "dust";
    await pollOnce(db, rpc, rate);
    donations = listDonations(db);
    const dust = donations.find((d) => d.txid.startsWith("bbbb"));
    expect(dust?.status).toBe("quarantined");
    expect(dust?.amountSats).toBe(12_000);

    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });
});
