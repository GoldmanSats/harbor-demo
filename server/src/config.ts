/** Shared Harbor constants and types (Slice One). */

export const DEFAULT_THRESHOLD_SATS = 500_000;
export const ADDRESS_TTL_MS = 60 * 60 * 1000;
export const POLL_INTERVAL_MS = 2_000;
export const MOCK_BTC_USD = 115_000;

/** BIP-86 account xpub for regtest (m/86'/1'/0') from BIP-39 test mnemonic
 * "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 * coin_type = 1' (testnet/regtest). Key material only — version bytes are xpub.
 */
export const DEMO_ACCOUNT_XPUB =
  "xpub6DJJUToomnxLc192dPF1RhY1YYYrc5BhnvoQmnM5CZH4ygBqaYWaMrNMLThrkYwsRGsjn3x5Aj9Yt8vrkDyUCwuBpjdscoqAqsPq2kz4rf8";

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
};
