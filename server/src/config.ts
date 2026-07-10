/** Shared Harbor constants and types. */

export const DEFAULT_THRESHOLD_SATS = 500_000;
export const ADDRESS_TTL_MS = 60 * 60 * 1000;
export const POLL_INTERVAL_MS = 2_000;
/** Public Esplora etiquette — slower than local mock/regtest. */
export const SIGNET_POLL_INTERVAL_MS = 30_000;
export const PUBLIC_NETWORK_POLL_INTERVAL_MS = 30_000;
export const MOCK_BTC_USD = 115_000;
export const RATE_CACHE_MS = 60_000;

export const SIGNET_ESPLORA_BASE = "https://mempool.space/signet/api";
export const TESTNET4_ESPLORA_BASE = "https://mempool.space/testnet4/api";
export const MEMPOOL_PRICES_URL = "https://mempool.space/api/v1/prices";
export const SIGNET_EXPLORER_TX = "https://mempool.space/signet/tx";
export const TESTNET4_EXPLORER_TX = "https://mempool.space/testnet4/tx";

/** BIP-86 account xpub for regtest (m/86'/1'/0') from BIP-39 test mnemonic
 * "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 * coin_type = 1' (testnet/regtest). Key material only — version bytes are xpub.
 */
export const DEMO_ACCOUNT_XPUB =
  "xpub6DJJUToomnxLc192dPF1RhY1YYYrc5BhnvoQmnM5CZH4ygBqaYWaMrNMLThrkYwsRGsjn3x5Aj9Yt8vrkDyUCwuBpjdscoqAqsPq2kz4rf8";

export type HarborNetwork = "mock" | "regtest" | "signet" | "testnet4";
export type DonationStatus = "pending" | "confirmed" | "quarantined";
export type AddressStatus = "issued" | "paid" | "expired" | "recycled";
export type PaymentRail = "onchain" | "lightning";

export type IssuedAddress = {
  id: number;
  address: string;
  derivationIndex: number;
  issuedAt: string;
  expiresAt: string;
  status: AddressStatus;
};

export type Donation = {
  id: number;
  txid: string;
  vout: number;
  address: string;
  amountSats: number;
  confirmations: number;
  fiatUsdAtReceipt: number;
  status: DonationStatus;
  firstSeenAt: string;
  rail: PaymentRail;
};

export type Settings = {
  thresholdSats: number;
  btcUsdRate: number;
  accountXpub: string | null;
  walletDescriptor: string | null;
  walletChangeDescriptor: string | null;
  walletSource: "trezor" | "ledger" | "import" | "advanced" | "legacy" | null;
  walletFingerprint: string | null;
  walletAccountPath: string | null;
  walletConnectedAt: string | null;
};

/** Resolve Harbor network from env. Hosted demos default to mock unless a public testnet is explicit. */
export function resolveHarborNetwork(env: NodeJS.ProcessEnv = process.env): HarborNetwork {
  const explicit = (env.HARBOR_NETWORK ?? "").toLowerCase();
  if (
    explicit === "signet" ||
    explicit === "testnet4" ||
    explicit === "regtest" ||
    explicit === "mock"
  ) {
    return explicit;
  }
  if (env.HARBOR_BITCOIN === "mock") return "mock";
  if (env.HARBOR_BITCOIN === "regtest") return "regtest";
  return "mock";
}

export function pollIntervalFor(network: HarborNetwork): number {
  return network === "signet" || network === "testnet4"
    ? PUBLIC_NETWORK_POLL_INTERVAL_MS
    : POLL_INTERVAL_MS;
}
