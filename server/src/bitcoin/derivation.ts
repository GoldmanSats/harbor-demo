import { HDKey } from "@scure/bip32";
import { Address, NETWORK, TEST_NETWORK, p2tr } from "@scure/btc-signer";

type NetworkParams = typeof NETWORK;

/** Regtest network params (bech32 HRP = bcrt). */
export const REGTEST_NETWORK: NetworkParams = {
  ...TEST_NETWORK,
  bech32: "bcrt",
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
};

export type NetworkName = "mainnet" | "testnet" | "regtest";

function networkFor(name: NetworkName): NetworkParams {
  switch (name) {
    case "mainnet":
      return NETWORK;
    case "testnet":
      return TEST_NETWORK;
    case "regtest":
      return REGTEST_NETWORK;
  }
}

/**
 * Derive a BIP-86 key-path taproot address from an account-level xpub.
 * Path from account: m / 0 / index  (external chain).
 */
export function deriveTaprootAddress(
  accountXpub: string,
  index: number,
  networkName: NetworkName = "regtest",
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  const account = HDKey.fromExtendedKey(accountXpub);
  const child = account.deriveChild(0).deriveChild(index);
  if (!child.publicKey) {
    throw new Error("Missing public key for derived child");
  }
  // Compressed pubkey → x-only (drop the 0x02/0x03 prefix byte)
  const xOnly = child.publicKey.slice(1);
  const payment = p2tr(xOnly, undefined, networkFor(networkName));
  if (!payment.address) {
    throw new Error("Failed to encode taproot address");
  }
  return payment.address;
}

/** Build a BIP-321-style bitcoin: URI with optional amount in BTC. */
export function buildBitcoinUri(address: string, amountSats?: number): string {
  if (amountSats === undefined) {
    return `bitcoin:${address}`;
  }
  const btc = (amountSats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
  return `bitcoin:${address}?amount=${btc}`;
}

/** Validate a bech32(m) address for the given network (best-effort decode). */
export function isValidAddress(address: string, networkName: NetworkName = "regtest"): boolean {
  try {
    Address(networkFor(networkName)).decode(address);
    return true;
  } catch {
    return false;
  }
}
