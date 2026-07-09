import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { MockBitcoinRpc } from "./bitcoin/mock-rpc.js";
import { listDonations } from "./db/schema.js";

describe("slice one integration", () => {
  let dbPath: string;
  let harbor: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `harbor-int-${Date.now()}-${Math.random()}.db`);
    harbor = await createApp({
      dbPath,
      rpc: new MockBitcoinRpc(),
      listen: false,
    });
    await harbor.app.ready();
  });

  afterEach(async () => {
    await harbor.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("routes small amounts to lightning preview", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 40_000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rail).toBe("lightning");
    expect(body.preview).toBe(true);
  });

  it("issues on-chain address for large amounts", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 750_000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rail).toBe("onchain");
    expect(body.address).toMatch(/^bcrt1p/);
    expect(body.uri).toContain("bitcoin:");
  });

  it("rejects invalid amounts", async () => {
    const res = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("issue → pay → mine → ledger + dashboard API", async () => {
    const issue = await harbor.app.inject({
      method: "POST",
      url: "/api/donate/address",
      payload: { amountSats: 800_000 },
    });
    const { address } = issue.json();

    const sim = await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { address, amountSats: 800_000, confirmations: 1 },
    });
    expect(sim.statusCode).toBe(200);

    const donations = listDonations(harbor.db);
    expect(donations.some((d) => d.address === address && d.amountSats === 800_000)).toBe(true);

    const dash = await harbor.app.inject({ method: "GET", url: "/api/donations" });
    expect(dash.statusCode).toBe(200);
    const body = dash.json();
    expect(body.summary.donationCount).toBeGreaterThanOrEqual(1);
    expect(body.donations.some((d: { address: string }) => d.address === address)).toBe(true);
  });

  it("exports CSV and registry", async () => {
    await harbor.app.inject({
      method: "POST",
      url: "/api/demo/simulate",
      payload: { amountSats: 600_000, confirmations: 1 },
    });
    const csv = await harbor.app.inject({ method: "GET", url: "/api/donations/export.csv" });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("amount_sats");

    const reg = await harbor.app.inject({ method: "GET", url: "/api/registry/export" });
    expect(reg.json().addresses.length).toBeGreaterThanOrEqual(1);
  });
});
