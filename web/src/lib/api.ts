import type {
  WalletCandidate,
  WalletPreview,
  WalletVerification,
} from "./wallet/types";

export const DEFAULT_THRESHOLD = 500_000;
export const SIGNET_EXPLORER_TX = "https://mempool.space/signet/tx";
export const TESTNET4_EXPLORER_TX = "https://mempool.space/testnet4/tx";

export type HarborNetwork = "mock" | "regtest" | "signet" | "testnet4";

export type DonateResponse =
  | {
      rail: "lightning";
      preview: true;
      amountSats: number;
      thresholdSats: number;
      offer: string;
      message: string;
    }
  | {
      rail: "onchain";
      preview: false;
      amountSats: number;
      thresholdSats: number;
      address: string;
      derivationIndex: number;
      expiresAt: string;
      recycled: boolean;
      uri: string;
    };

export type Donation = {
  id: number;
  txid: string;
  vout: number;
  address: string;
  amountSats: number;
  confirmations: number;
  fiatUsdAtReceipt: number;
  status: "pending" | "confirmed" | "quarantined";
  firstSeenAt: string;
  rail: "onchain" | "lightning";
};

export type SettingsPayload = {
  thresholdSats: number;
  btcUsdRate: number;
  accountXpub: string | null;
  network: HarborNetwork;
  walletConnected: boolean;
  walletSource: WalletCandidate["source"] | "legacy" | null;
  walletFingerprint: string | null;
  walletAccountPath: string | null;
  walletConnectedAt: string | null;
  usingDemoWallet: boolean;
  usingDemoXpub: boolean;
  previewAddresses: string[];
};

export type DonationsPayload = {
  donations: Donation[];
  summary: {
    coldStorageSats: number;
    ecashSats: number;
    quarantinedSats: number;
    pendingSats: number;
    donationCount: number;
  };
  settings: SettingsPayload;
};

export type HealthPayload = {
  ok: boolean;
  bitcoin: string;
  network: HarborNetwork;
  chain: string;
  blocks: number;
  demoTools: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const json = JSON.parse(text) as { error?: string; code?: string };
      if (json.error) message = json.error;
      code = json.code;
    } catch {
      /* keep text */
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return res.text() as Promise<T>;
}

export function requestPayment(amountSats: number) {
  return api<DonateResponse>("/api/donate/address", {
    method: "POST",
    body: JSON.stringify({ amountSats }),
  });
}

export function fetchDonations() {
  return api<DonationsPayload>("/api/donations");
}

export function fetchSettings() {
  return api<SettingsPayload>("/api/settings");
}

export function fetchHealth() {
  return api<HealthPayload>("/api/health");
}

export function updateThreshold(thresholdSats: number) {
  return api<SettingsPayload>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ thresholdSats }),
  });
}

export function updateAccountXpub(accountXpub: string | null, resetAddresses = true) {
  return api<SettingsPayload>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ accountXpub, resetAddresses }),
  });
}

export function previewWallet(candidate: WalletCandidate) {
  return api<WalletPreview>("/api/wallet/preview", {
    method: "POST",
    body: JSON.stringify(candidate),
  });
}

export function saveWallet(
  candidate: WalletCandidate,
  verification: WalletVerification,
  confirmWalletChange = false,
) {
  return api<SettingsPayload>("/api/wallet", {
    method: "PUT",
    body: JSON.stringify({ ...candidate, verification, confirmWalletChange }),
  });
}

export type XpubPreviewPayload = {
  ok: true;
  normalized: string;
  depth: number;
  previewAddresses: string[];
  network: HarborNetwork;
};

/** Validate an xpub and return the first 3 addresses without saving. */
export function previewAccountXpub(accountXpub: string) {
  return api<XpubPreviewPayload>("/api/settings/xpub/preview", {
    method: "POST",
    body: JSON.stringify({ accountXpub }),
  });
}

export function simulateDonation(amountSats?: number) {
  return api<{
    ok: boolean;
    rail: "onchain" | "lightning";
    address: string;
    amountSats: number;
    txid: string;
    message?: string;
  }>("/api/demo/simulate", {
    method: "POST",
    body: JSON.stringify(amountSats ? { amountSats } : {}),
  });
}

export function resetDemo() {
  return api<{ ok: boolean; message: string }>("/api/demo/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function explorerTxUrl(network: HarborNetwork, txid: string): string | null {
  if (network === "signet") return `${SIGNET_EXPLORER_TX}/${txid}`;
  if (network === "testnet4") return `${TESTNET4_EXPLORER_TX}/${txid}`;
  return null;
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
