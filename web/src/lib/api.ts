export const DEFAULT_THRESHOLD = 500_000;
export const SIGNET_EXPLORER_TX = "https://mempool.space/signet/tx";

export type HarborNetwork = "mock" | "regtest" | "signet";

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* keep text */
    }
    throw new Error(message);
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
  if (network !== "signet") return null;
  return `${SIGNET_EXPLORER_TX}/${txid}`;
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
