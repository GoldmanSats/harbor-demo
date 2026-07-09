import {
  HardwareWalletError,
  type HardwareWalletAdapter,
  type HardwareWalletConnection,
} from "./types";
import type { HarborNetwork } from "../api";

const ACCOUNT_PATH = "m/86'/1'/0'";
const ADDRESS_PATH = `${ACCOUNT_PATH}/0/0`;

export type TrezorBridge = {
  getAccount(): Promise<{ accountPublicKey: string; fingerprint: string }>;
  displayAddress(): Promise<string>;
  disconnect(): Promise<void>;
};

type TrezorAdapterOptions = {
  loadBridge?: () => Promise<TrezorBridge>;
  supported?: () => boolean;
};

function mapTrezorError(error: unknown): HardwareWalletError {
  if (error instanceof HardwareWalletError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("cancel") || lower.includes("denied") || lower.includes("permission")) {
    return new HardwareWalletError("The Trezor request was declined. You can try again.", "denied");
  }
  if (lower.includes("disconnect") || lower.includes("device not found")) {
    return new HardwareWalletError(
      "Trezor disconnected. Reconnect it, unlock it, and try again.",
      "disconnected",
    );
  }
  if (lower.includes("popup") || lower.includes("blocked")) {
    return new HardwareWalletError(
      "Trezor Connect could not open its approval window. Allow popups and try again.",
      "popup",
    );
  }
  return new HardwareWalletError(`Trezor could not be connected: ${message}`, "unknown");
}

function fingerprintHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

let defaultBridgePromise: Promise<TrezorBridge> | null = null;

async function loadDefaultBridge(): Promise<TrezorBridge> {
  if (defaultBridgePromise) return defaultBridgePromise;
  defaultBridgePromise = (async () => {
    const email = import.meta.env.VITE_TREZOR_MANIFEST_EMAIL as string | undefined;
    const appUrl = import.meta.env.VITE_TREZOR_MANIFEST_URL as string | undefined;
    const appName =
      (import.meta.env.VITE_TREZOR_MANIFEST_APP_NAME as string | undefined) ?? "Harbor";
    if (!email || !appUrl) {
      throw new HardwareWalletError(
        "Trezor support needs VITE_TREZOR_MANIFEST_EMAIL and VITE_TREZOR_MANIFEST_URL.",
        "unsupported",
      );
    }

    const { default: TrezorConnect } = await import("@trezor/connect-web");
    await TrezorConnect.init({
      lazyLoad: true,
      manifest: { email, appUrl, appName },
    });

    return {
      async getAccount() {
        const response = await TrezorConnect.getPublicKey({
          path: ACCOUNT_PATH,
          coin: "Testnet",
          scriptType: "SPENDTAPROOT",
          crossChain: true,
          ignoreXpubMagic: true,
          showOnTrezor: false,
        });
        if (!response.success) throw new Error(response.payload.error);
        const descriptorFingerprint = response.payload.descriptor?.match(/\[([0-9a-fA-F]{8})\//)?.[1];
        return {
          accountPublicKey: response.payload.xpub,
          fingerprint:
            descriptorFingerprint?.toLowerCase() ?? fingerprintHex(response.payload.fingerprint),
        };
      },
      async displayAddress() {
        const response = await TrezorConnect.getAddress({
          path: ADDRESS_PATH,
          coin: "Testnet",
          scriptType: "SPENDTAPROOT",
          crossChain: true,
          showOnTrezor: true,
        });
        if (!response.success) throw new Error(response.payload.error);
        return response.payload.address;
      },
      async disconnect() {
        // Trezor Connect owns its transport lifecycle; each request closes its popup session.
      },
    };
  })().catch((error) => {
    defaultBridgePromise = null;
    throw error;
  });
  return defaultBridgePromise;
}

export class TrezorConnectAdapter implements HardwareWalletAdapter {
  readonly source = "trezor" as const;
  readonly label = "Trezor";
  private readonly loadBridge: () => Promise<TrezorBridge>;
  private readonly supported: () => boolean;

  constructor(options: TrezorAdapterOptions = {}) {
    this.loadBridge = options.loadBridge ?? loadDefaultBridge;
    this.supported =
      options.supported ?? (() => typeof window !== "undefined" && window.isSecureContext);
  }

  isSupported(): boolean {
    return this.supported();
  }

  async connect(_network: HarborNetwork): Promise<HardwareWalletConnection> {
    if (!this.isSupported()) {
      throw new HardwareWalletError(
        "Trezor requires a secure HTTPS page or localhost. Import a watch-only wallet instead.",
        "unsupported",
      );
    }
    try {
      const bridge = await this.loadBridge();
      const account = await bridge.getAccount();
      return {
        candidate: {
          source: "trezor",
          accountPublicKey: account.accountPublicKey,
          fingerprint: account.fingerprint,
          accountPath: ACCOUNT_PATH,
        },
        async verifyAddress(expectedAddress) {
          const displayed = await bridge.displayAddress();
          if (displayed !== expectedAddress) {
            throw new HardwareWalletError(
              "The address on your Trezor does not match Harbor. Do not connect this wallet.",
              "address-mismatch",
            );
          }
        },
        disconnect: () => bridge.disconnect(),
      };
    } catch (error) {
      throw mapTrezorError(error);
    }
  }
}
