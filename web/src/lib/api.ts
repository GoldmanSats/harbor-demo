export const DEFAULT_THRESHOLD = 500_000;

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

export type DonationsPayload = {
  donations: Donation[];
  summary: {
    coldStorageSats: number;
    quarantinedSats: number;
    pendingSats: number;
    donationCount: number;
  };
  settings: { thresholdSats: number; btcUsdRate: number };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
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

export function updateThreshold(thresholdSats: number) {
  return api<{ thresholdSats: number }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ thresholdSats }),
  });
}

export function simulateDonation(amountSats?: number) {
  return api<{ ok: boolean; address: string; amountSats: number; txid: string }>(
    "/api/demo/simulate",
    {
      method: "POST",
      body: JSON.stringify(amountSats ? { amountSats } : {}),
    },
  );
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
