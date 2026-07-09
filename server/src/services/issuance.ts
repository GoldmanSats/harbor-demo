import type { Db } from "../db/schema.js";
import {
  findRecyclableAddress,
  insertIssuedAddress,
  nextDerivationIndex,
  recycleAddress,
} from "../db/schema.js";
import { deriveTaprootAddress, derivationNetworkFor } from "../bitcoin/derivation.js";
import type { NetworkName } from "../bitcoin/derivation.js";
import { ADDRESS_TTL_MS, DEMO_ACCOUNT_XPUB, type HarborNetwork } from "../config.js";
import type { IssuedAddress } from "../config.js";
import type { MockBitcoinRpc } from "../bitcoin/mock-rpc.js";
import type { BitcoinRpc } from "../bitcoin/rpc.js";

export type IssueResult = {
  address: IssuedAddress;
  recycled: boolean;
};

/**
 * Issue a fresh (or recycled unpaid) taproot address from the org xpub.
 * Guarantees: no active address is served twice.
 */
export function issueAddress(
  db: Db,
  opts: {
    accountXpub?: string;
    now?: Date;
    ttlMs?: number;
    rpc?: BitcoinRpc;
    network?: HarborNetwork | NetworkName;
  } = {},
): IssueResult {
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? ADDRESS_TTL_MS;
  const xpub = opts.accountXpub ?? DEMO_ACCOUNT_XPUB;
  const networkName: NetworkName = resolveIssueNetwork(opts.network);

  const recyclable = findRecyclableAddress(db, now.toISOString());
  if (recyclable) {
    const recycled = recycleAddress(db, recyclable.id, now, ttlMs);
    watchIfMock(opts.rpc, recycled.address);
    return { address: recycled, recycled: true };
  }

  const index = nextDerivationIndex(db);
  const address = deriveTaprootAddress(xpub, index, networkName);
  const issued = insertIssuedAddress(db, address, index, now, ttlMs);
  watchIfMock(opts.rpc, issued.address);
  return { address: issued, recycled: false };
}

function resolveIssueNetwork(network?: HarborNetwork | NetworkName): NetworkName {
  if (network === "signet" || network === "testnet" || network === "mainnet" || network === "regtest") {
    return network;
  }
  if (network === "mock") return "regtest";
  return derivationNetworkFor("mock");
}

function watchIfMock(rpc: BitcoinRpc | undefined, address: string): void {
  if (rpc && rpc.kind === "mock") {
    (rpc as MockBitcoinRpc).watchAddress(address);
  }
}
