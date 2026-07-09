import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, listIssuedAddresses, getSettings, setThreshold } from "../db/schema.js";
import { issueAddress } from "./issuance.js";
import { ADDRESS_TTL_MS } from "../config.js";

describe("issuance registry", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `harbor-test-${Date.now()}-${Math.random()}.db`);
    db = openDatabase(dbPath);
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

  it("never serves the same active address twice", () => {
    const a = issueAddress(db);
    const b = issueAddress(db);
    expect(a.address.address).not.toBe(b.address.address);
    expect(a.address.derivationIndex).toBe(0);
    expect(b.address.derivationIndex).toBe(1);
  });

  it("recycles expired unpaid addresses", () => {
    const past = new Date(Date.now() - ADDRESS_TTL_MS - 1000);
    const first = issueAddress(db, { now: past, ttlMs: 1 });
    expect(first.recycled).toBe(false);

    const second = issueAddress(db, { now: new Date() });
    expect(second.recycled).toBe(true);
    expect(second.address.address).toBe(first.address.address);
    expect(second.address.derivationIndex).toBe(first.address.derivationIndex);
  });

  it("persists every issued address", () => {
    issueAddress(db);
    issueAddress(db);
    expect(listIssuedAddresses(db)).toHaveLength(2);
  });

  it("settings threshold round-trips", () => {
    expect(getSettings(db).thresholdSats).toBe(500_000);
    setThreshold(db, 100_000);
    expect(getSettings(db).thresholdSats).toBe(100_000);
  });
});
