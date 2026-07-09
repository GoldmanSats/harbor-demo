import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEMO_ACCOUNT_XPUB } from "../config.js";
import {
  getSettings,
  insertDonation,
  insertIssuedAddress,
  listDonations,
  listIssuedAddresses,
  openDatabase,
  setAccountXpub,
} from "./schema.js";

const paths: string[] = [];

afterEach(() => {
  for (const dbPath of paths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        // Already removed.
      }
    }
  }
});

describe("wallet settings migration", () => {
  it("migrates a legacy account xpub without clearing registry or donations", () => {
    const dbPath = path.join(os.tmpdir(), `harbor-migration-${Date.now()}-${Math.random()}.db`);
    paths.push(dbPath);
    const legacy = openDatabase(dbPath);
    setAccountXpub(legacy, DEMO_ACCOUNT_XPUB);
    insertIssuedAddress(legacy, "bcrt1plegacy", 0, new Date(0));
    insertDonation(legacy, {
      txid: "aa".repeat(32),
      vout: 0,
      address: "bcrt1plegacy",
      amountSats: 750_000,
      confirmations: 1,
      fiatUsdAtReceipt: 750,
      status: "confirmed",
      firstSeenAt: new Date(0).toISOString(),
    });
    legacy.close();

    const migrated = openDatabase(dbPath);
    const settings = getSettings(migrated);
    expect(settings.walletDescriptor).toMatch(/^tr\(.+\)#[a-z0-9]{8}$/);
    expect(settings.walletSource).toBe("legacy");
    expect(settings.accountXpub).toBe(DEMO_ACCOUNT_XPUB);
    expect(listIssuedAddresses(migrated)).toHaveLength(1);
    expect(listDonations(migrated)).toHaveLength(1);
    migrated.close();
  });
});
