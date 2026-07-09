import { HDKey } from "@scure/bip32";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2";
import { Address, NETWORK, TEST_NETWORK, p2tr } from "@scure/btc-signer";

type NetworkParams = typeof NETWORK;

/** Regtest network params (bech32 HRP = bcrt). */
export const REGTEST_NETWORK: NetworkParams = {
  ...TEST_NETWORK,
  bech32: "bcrt",
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
};

/**
 * Network names Harbor derives for.
 * Signet and Testnet4 share testnet address params (`tb1…`).
 */
export type NetworkName = "mainnet" | "testnet" | "regtest" | "signet" | "testnet4";

const XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);
const b58c = base58check(sha256);

function networkFor(name: NetworkName): NetworkParams {
  switch (name) {
    case "mainnet":
      return NETWORK;
    case "testnet":
    case "signet":
    case "testnet4":
      return TEST_NETWORK;
    case "regtest":
      return REGTEST_NETWORK;
  }
}

/**
 * Normalize Sparrow/testnet extended public keys (`tpub` / `vpub`) to BIP-32 `xpub`
 * version bytes so `@scure/bip32` can parse them. Key material is unchanged.
 */
export function normalizeAccountXpub(extendedKey: string): string {
  const trimmed = extendedKey.trim();
  if (!trimmed) throw new Error("Extended key is empty");
  let decoded: Uint8Array;
  try {
    decoded = b58c.decode(trimmed);
  } catch {
    throw new Error("Invalid extended public key encoding");
  }
  if (decoded.length !== 78) {
    throw new Error("Invalid extended public key length");
  }
  const normalized = new Uint8Array(decoded);
  normalized.set(XPUB_VERSION, 0);
  return b58c.encode(normalized);
}

export type ValidatedAccountXpub = {
  normalized: string;
  depth: number;
  previewAddresses: string[];
};

/**
 * Validate an account-level xpub/tpub/vpub and derive the first few receive addresses
 * so the org can verify them against Sparrow before saving.
 */
export function validateAccountXpub(
  extendedKey: string,
  networkName: NetworkName,
  previewCount = 3,
): ValidatedAccountXpub {
  const normalized = normalizeAccountXpub(extendedKey);
  const account = HDKey.fromExtendedKey(normalized);
  // BIP-86 account path m/86'/coin'/account' → depth 3
  if (account.depth !== 3) {
    throw new Error(`Expected account-level key (depth 3), got depth ${account.depth}`);
  }
  const previewAddresses: string[] = [];
  for (let i = 0; i < previewCount; i++) {
    previewAddresses.push(deriveTaprootAddress(normalized, i, networkName));
  }
  return { normalized, depth: account.depth, previewAddresses };
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
  const account = HDKey.fromExtendedKey(normalizeAccountXpub(accountXpub));
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

/** Map Harbor runtime network to derivation network (mock uses regtest params). */
export function derivationNetworkFor(
  harborNetwork: "mock" | "regtest" | "signet" | "testnet4",
): NetworkName {
  if (harborNetwork === "signet") return "signet";
  if (harborNetwork === "testnet4") return "testnet4";
  return "regtest";
}
