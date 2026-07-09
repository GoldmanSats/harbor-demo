import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  ADDRESS_TTL_MS,
  DEFAULT_THRESHOLD_SATS,
  MOCK_BTC_USD,
  type AddressStatus,
  type Donation,
  type DonationStatus,
  type IssuedAddress,
  type PaymentRail,
  type Settings,
} from "../config.js";

export type Db = DatabaseSync;

export function openDatabase(dbPath: string): Db {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issued_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      derivation_index INTEGER NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL,
      address TEXT NOT NULL,
      amount_sats INTEGER NOT NULL,
      confirmations INTEGER NOT NULL DEFAULT 0,
      fiat_usd_at_receipt REAL NOT NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      rail TEXT NOT NULL DEFAULT 'onchain',
      UNIQUE(txid, vout)
    );

    CREATE INDEX IF NOT EXISTS idx_issued_status ON issued_addresses(status);
    CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
  `);

  const get = db.prepare("SELECT value FROM settings WHERE key = ?");
  if (!get.get("threshold_sats")) {
    const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    set.run("threshold_sats", String(DEFAULT_THRESHOLD_SATS));
    set.run("btc_usd_rate", String(MOCK_BTC_USD));
  }
}

function mapIssued(row: Record<string, unknown>): IssuedAddress {
  return {
    id: Number(row.id),
    address: String(row.address),
    derivationIndex: Number(row.derivation_index),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    status: String(row.status) as AddressStatus,
  };
}

function mapDonation(row: Record<string, unknown>): Donation {
  return {
    id: Number(row.id),
    txid: String(row.txid),
    vout: Number(row.vout),
    address: String(row.address),
    amountSats: Number(row.amount_sats),
    confirmations: Number(row.confirmations),
    fiatUsdAtReceipt: Number(row.fiat_usd_at_receipt),
    status: String(row.status) as DonationStatus,
    firstSeenAt: String(row.first_seen_at),
    rail: String(row.rail) as PaymentRail,
  };
}

export function getSettings(db: Db): Settings {
  const get = db.prepare("SELECT value FROM settings WHERE key = ?");
  const threshold = get.get("threshold_sats");
  const rate = get.get("btc_usd_rate");
  const xpub = get.get("account_xpub") as { value: string } | undefined;
  return {
    thresholdSats: Number((threshold as { value: string } | undefined)?.value ?? DEFAULT_THRESHOLD_SATS),
    btcUsdRate: Number((rate as { value: string } | undefined)?.value ?? MOCK_BTC_USD),
    accountXpub: xpub?.value && xpub.value.length > 0 ? xpub.value : null,
  };
}

export function setThreshold(db: Db, thresholdSats: number): Settings {
  if (!Number.isInteger(thresholdSats) || thresholdSats < 1) {
    throw new Error("thresholdSats must be a positive integer");
  }
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("threshold_sats", String(thresholdSats));
  return getSettings(db);
}

export function setBtcUsdRate(db: Db, rate: number): Settings {
  if (!(rate > 0)) throw new Error("btcUsdRate must be positive");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("btc_usd_rate", String(rate));
  return getSettings(db);
}

export function setAccountXpub(db: Db, accountXpub: string | null): Settings {
  const value = accountXpub?.trim() ? accountXpub.trim() : "";
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("account_xpub", value);
  return getSettings(db);
}

/** Clear issued addresses (and optionally donations) when the org changes xpub. */
export function clearAddressRegistry(db: Db, clearDonations = true): void {
  if (clearDonations) db.exec("DELETE FROM donations;");
  db.exec("DELETE FROM issued_addresses;");
}

export function nextDerivationIndex(db: Db): number {
  const row = db.prepare("SELECT MAX(derivation_index) AS max_idx FROM issued_addresses").get() as
    | { max_idx: number | null }
    | undefined;
  return (row?.max_idx ?? -1) + 1;
}

export function findRecyclableAddress(db: Db, nowIso: string): IssuedAddress | null {
  const row = db
    .prepare(
      `SELECT * FROM issued_addresses
       WHERE status = 'issued' AND expires_at < ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(nowIso) as Record<string, unknown> | undefined;
  return row ? mapIssued(row) : null;
}

export function recycleAddress(db: Db, id: number, now: Date, ttlMs: number = ADDRESS_TTL_MS): IssuedAddress {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.prepare(
    `UPDATE issued_addresses
     SET status = 'issued', issued_at = ?, expires_at = ?
     WHERE id = ?`,
  ).run(issuedAt, expiresAt, id);
  const row = db.prepare("SELECT * FROM issued_addresses WHERE id = ?").get(id) as Record<string, unknown>;
  return mapIssued(row);
}

export function insertIssuedAddress(
  db: Db,
  address: string,
  derivationIndex: number,
  now: Date,
  ttlMs: number = ADDRESS_TTL_MS,
): IssuedAddress {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const result = db
    .prepare(
      `INSERT INTO issued_addresses (address, derivation_index, issued_at, expires_at, status)
       VALUES (?, ?, ?, ?, 'issued')`,
    )
    .run(address, derivationIndex, issuedAt, expiresAt);
  return {
    id: Number(result.lastInsertRowid),
    address,
    derivationIndex,
    issuedAt,
    expiresAt,
    status: "issued",
  };
}

export function markAddressPaid(db: Db, address: string): void {
  db.prepare(`UPDATE issued_addresses SET status = 'paid' WHERE address = ? AND status IN ('issued', 'recycled')`)
    .run(address);
}

export function listIssuedAddresses(db: Db): IssuedAddress[] {
  const rows = db.prepare("SELECT * FROM issued_addresses ORDER BY derivation_index ASC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapIssued);
}

export function getActiveIssuedAddresses(db: Db): IssuedAddress[] {
  const rows = db
    .prepare(`SELECT * FROM issued_addresses WHERE status IN ('issued', 'paid')`)
    .all() as Record<string, unknown>[];
  return rows.map(mapIssued);
}

export function findDonationByOutpoint(db: Db, txid: string, vout: number): Donation | null {
  const row = db.prepare("SELECT * FROM donations WHERE txid = ? AND vout = ?").get(txid, vout) as
    | Record<string, unknown>
    | undefined;
  return row ? mapDonation(row) : null;
}

export function insertDonation(
  db: Db,
  input: {
    txid: string;
    vout: number;
    address: string;
    amountSats: number;
    confirmations: number;
    fiatUsdAtReceipt: number;
    status: DonationStatus;
    firstSeenAt: string;
    rail?: PaymentRail;
  },
): Donation {
  const result = db
    .prepare(
      `INSERT INTO donations
        (txid, vout, address, amount_sats, confirmations, fiat_usd_at_receipt, status, first_seen_at, rail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.txid,
      input.vout,
      input.address,
      input.amountSats,
      input.confirmations,
      input.fiatUsdAtReceipt,
      input.status,
      input.firstSeenAt,
      input.rail ?? "onchain",
    );
  return {
    id: Number(result.lastInsertRowid),
    txid: input.txid,
    vout: input.vout,
    address: input.address,
    amountSats: input.amountSats,
    confirmations: input.confirmations,
    fiatUsdAtReceipt: input.fiatUsdAtReceipt,
    status: input.status,
    firstSeenAt: input.firstSeenAt,
    rail: input.rail ?? "onchain",
  };
}

export function updateDonationConfirmations(
  db: Db,
  id: number,
  confirmations: number,
  status: DonationStatus,
): void {
  db.prepare(`UPDATE donations SET confirmations = ?, status = ? WHERE id = ?`).run(confirmations, status, id);
}

export function listDonations(db: Db): Donation[] {
  const rows = db.prepare("SELECT * FROM donations ORDER BY first_seen_at DESC, id DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapDonation);
}

export function donationSummary(db: Db): {
  coldStorageSats: number;
  ecashSats: number;
  quarantinedSats: number;
  pendingSats: number;
  donationCount: number;
} {
  const donations = listDonations(db);
  let coldStorageSats = 0;
  let ecashSats = 0;
  let quarantinedSats = 0;
  let pendingSats = 0;
  for (const d of donations) {
    if (d.rail === "lightning") {
      ecashSats += d.amountSats;
      continue;
    }
    if (d.status === "quarantined") quarantinedSats += d.amountSats;
    else if (d.status === "pending") {
      pendingSats += d.amountSats;
      coldStorageSats += d.amountSats;
    } else coldStorageSats += d.amountSats;
  }
  return {
    coldStorageSats,
    ecashSats,
    quarantinedSats,
    pendingSats,
    donationCount: donations.length,
  };
}

/** Clear donation ledger and address registry; restore default settings. */
export function resetDemoData(db: Db): void {
  db.exec("DELETE FROM donations;");
  db.exec("DELETE FROM issued_addresses;");
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("threshold_sats", String(DEFAULT_THRESHOLD_SATS));
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("btc_usd_rate", String(MOCK_BTC_USD));
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("account_xpub", "");
}
