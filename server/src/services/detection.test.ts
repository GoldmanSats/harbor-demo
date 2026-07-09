import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, listDonations, setBtcUsdRate } from "../db/schema.js";
import { MockBitcoinRpc } from "../bitcoin/mock-rpc.js";
import { MockRateProvider, pollOnce } from "./detection.js";
import { issueAddress } from "./issuance.js";

describe("detection & ledger", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;
  let rpc: MockBitcoinRpc;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `harbor-det-${Date.now()}-${Math.random()}.db`);
    db = openDatabase(dbPath);
    rpc = new MockBitcoinRpc();
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("records a confirmed large donation", async () => {
    const { address } = issueAddress(db, { rpc });
    const rates = new MockRateProvider(100_000);
    await rpc.sendToAddress(address.address, 0.01); // 1_000_000 sats
    await rpc.generateToAddress(1, await rpc.getNewAddress());
    await pollOnce(db, rpc, rates);

    const donations = listDonations(db);
    expect(donations).toHaveLength(1);
    expect(donations[0].amountSats).toBe(1_000_000);
    expect(donations[0].status).toBe("confirmed");
    expect(donations[0].fiatUsdAtReceipt).toBe(1000);
  });

  it("quarantines under-threshold on-chain dust", async () => {
    const { address } = issueAddress(db, { rpc });
    const rates = new MockRateProvider(100_000);
    await rpc.sendToAddress(address.address, 0.0001); // 10_000 sats
    await rpc.generateToAddress(1, await rpc.getNewAddress());
    await pollOnce(db, rpc, rates);

    const donations = listDonations(db);
    expect(donations[0].status).toBe("quarantined");
  });

  it("never restates fiat after rate change", async () => {
    const { address } = issueAddress(db, { rpc });
    const rates = new MockRateProvider(100_000);
    await rpc.sendToAddress(address.address, 0.01);
    await rpc.generateToAddress(1, await rpc.getNewAddress());
    await pollOnce(db, rpc, rates);

    rates.setRate(200_000);
    setBtcUsdRate(db, 200_000);
    await rpc.generateToAddress(1, await rpc.getNewAddress());
    await pollOnce(db, rpc, rates);

    const donations = listDonations(db);
    expect(donations[0].fiatUsdAtReceipt).toBe(1000);
    expect(donations[0].confirmations).toBeGreaterThanOrEqual(2);
  });

  it("keeps quarantined status after more confirmations", async () => {
    const { address } = issueAddress(db, { rpc });
    const rates = new MockRateProvider(100_000);
    await rpc.sendToAddress(address.address, 0.00005);
    await pollOnce(db, rpc, rates);
    expect(listDonations(db)[0].status).toBe("quarantined");

    await rpc.generateToAddress(3, await rpc.getNewAddress());
    await pollOnce(db, rpc, rates);
    expect(listDonations(db)[0].status).toBe("quarantined");
  });
});
