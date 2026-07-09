import type { Db } from "../db/schema.js";
import {
  findDonationByOutpoint,
  getSettings,
  insertDonation,
  markAddressPaid,
  updateDonationConfirmations,
} from "../db/schema.js";
import type { BitcoinRpc } from "../bitcoin/rpc.js";
import type { DonationStatus } from "../config.js";
import { POLL_INTERVAL_MS } from "../config.js";

export type RateProvider = {
  getBtcUsd(): number;
};

export class MockRateProvider implements RateProvider {
  constructor(private rate: number) {}
  getBtcUsd(): number {
    return this.rate;
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
}

function classifyStatus(amountSats: number, confirmations: number, thresholdSats: number): DonationStatus {
  if (amountSats < thresholdSats) return "quarantined";
  if (confirmations >= 1) return "confirmed";
  return "pending";
}

/**
 * Poll Bitcoin for receives to watched addresses and upsert ledger rows.
 * Fiat-at-receipt is set only on first insert and never restated.
 */
export async function pollOnce(
  db: Db,
  rpc: BitcoinRpc,
  rateProvider: RateProvider,
): Promise<{ newDonations: number; updated: number }> {
  const settings = getSettings(db);
  const since = await rpc.listSinceBlock();
  let newDonations = 0;
  let updated = 0;

  for (const tx of since.transactions) {
    if (tx.category !== "receive" || !tx.address) continue;
    const amountSats = Math.round(tx.amount * 1e8);
    const existing = findDonationByOutpoint(db, tx.txid, tx.vout);

    if (!existing) {
      const status = classifyStatus(amountSats, tx.confirmations, settings.thresholdSats);
      const fiat = (amountSats / 1e8) * rateProvider.getBtcUsd();
      insertDonation(db, {
        txid: tx.txid,
        vout: tx.vout,
        address: tx.address,
        amountSats,
        confirmations: tx.confirmations,
        fiatUsdAtReceipt: Number(fiat.toFixed(2)),
        status,
        firstSeenAt: new Date().toISOString(),
        rail: "onchain",
      });
      markAddressPaid(db, tx.address);
      newDonations += 1;
    } else {
      // Never restate fiat. Quarantined stays quarantined.
      const nextStatus: DonationStatus =
        existing.status === "quarantined"
          ? "quarantined"
          : classifyStatus(existing.amountSats, tx.confirmations, settings.thresholdSats);
      if (existing.confirmations !== tx.confirmations || existing.status !== nextStatus) {
        updateDonationConfirmations(db, existing.id, tx.confirmations, nextStatus);
        updated += 1;
      }
    }
  }

  return { newDonations, updated };
}

export function startPoller(
  db: Db,
  rpc: BitcoinRpc,
  rateProvider: RateProvider,
  intervalMs: number = POLL_INTERVAL_MS,
): { stop: () => void } {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await pollOnce(db, rpc, rateProvider);
    } catch (err) {
      console.error("[poller]", err);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer: ReturnType<typeof setTimeout> = setTimeout(tick, intervalMs);
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
