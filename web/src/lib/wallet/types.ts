import type { HarborNetwork } from "../api";

export type WalletSource = "trezor" | "ledger" | "import" | "advanced";

export type WalletCandidate = {
  descriptor?: string;
  changeDescriptor?: string;
  accountPublicKey?: string;
  changeAccountPublicKey?: string;
  fingerprint?: string;
  accountPath?: string;
  source: WalletSource;
};

export type WalletPreview = {
  ok: true;
  source: WalletSource;
  fingerprint: string;
  accountPath: string;
  previewAddresses: string[];
  walletChange: boolean;
  network: HarborNetwork;
};

export type WalletVerification =
  | { method: "device"; addresses: [string] }
  | { method: "addresses"; addresses: [string, string, string] };

export type HardwareWalletConnection = {
  candidate: WalletCandidate;
  verifyAddress(expectedAddress: string): Promise<void>;
  disconnect(): Promise<void>;
};

export interface HardwareWalletAdapter {
  readonly source: "trezor" | "ledger";
  readonly label: string;
  isSupported(): boolean;
  connect(network: HarborNetwork): Promise<HardwareWalletConnection>;
}

export class HardwareWalletError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unsupported"
      | "denied"
      | "disconnected"
      | "wrong-app"
      | "popup"
      | "address-mismatch"
      | "unknown",
  ) {
    super(message);
    this.name = "HardwareWalletError";
  }
}
