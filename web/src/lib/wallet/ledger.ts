import { filter, firstValueFrom, type Observable } from "rxjs";
import {
  HardwareWalletError,
  type HardwareWalletAdapter,
  type HardwareWalletConnection,
} from "./types";
import type { HarborNetwork } from "../api";

const ACCOUNT_PATH = "m/86'/1'/0'";
const LEDGER_ACCOUNT_PATH = "86'/1'/0'";

type ActionState<T> =
  | { status: "not-started" | "pending" }
  | { status: "stopped" }
  | { status: "completed"; output: T }
  | { status: "error"; error: unknown };

type ActionRequest<T> = {
  observable: Observable<ActionState<T>>;
  cancel(): void;
};

export type LedgerBridge = {
  getAccount(): Promise<{ accountPublicKey: string; fingerprint: string }>;
  displayAddress(): Promise<string>;
  disconnect(): Promise<void>;
};

type LedgerAdapterOptions = {
  loadBridge?: () => Promise<LedgerBridge>;
  supported?: () => boolean;
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown Ledger error";
    }
  }
  return String(error);
}

function mapLedgerError(error: unknown): HardwareWalletError {
  if (error instanceof HardwareWalletError) return error;
  const message = describeError(error);
  const lower = message.toLowerCase();
  if (lower.includes("denied") || lower.includes("permission") || lower.includes("cancel")) {
    return new HardwareWalletError("Ledger access was declined. You can try again.", "denied");
  }
  if (lower.includes("disconnect") || lower.includes("not found") || lower.includes("no device")) {
    return new HardwareWalletError(
      "Ledger disconnected. Reconnect it, unlock it, and try again.",
      "disconnected",
    );
  }
  if (lower.includes("app") || lower.includes("6e00") || lower.includes("6511")) {
    return new HardwareWalletError(
      "Open the Bitcoin app on your Ledger, then try again.",
      "wrong-app",
    );
  }
  return new HardwareWalletError(`Ledger could not be connected: ${message}`, "unknown");
}

async function actionOutput<T>(request: ActionRequest<T>): Promise<T> {
  const state = await firstValueFrom(
    request.observable.pipe(
      filter(
        (value) =>
          value.status === "completed" || value.status === "error" || value.status === "stopped",
      ),
    ),
  );
  if (state.status === "completed") return state.output;
  if (state.status === "error") throw state.error;
  throw new Error("Ledger request stopped before completion");
}

async function loadDefaultBridge(): Promise<LedgerBridge> {
  const [
    { DeviceManagementKitBuilder },
    { webHidTransportFactory },
    { DefaultDescriptorTemplate, DefaultWallet, SignerBtcBuilder },
  ] = await Promise.all([
    import("@ledgerhq/device-management-kit"),
    import("@ledgerhq/device-transport-kit-web-hid"),
    import("@ledgerhq/device-signer-kit-bitcoin"),
  ]);

  const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
  let sessionId: string | null = null;
  try {
    const device = await firstValueFrom(dmk.startDiscovering({}));
    await dmk.stopDiscovering();
    sessionId = await dmk.connect({ device });
    const signer = new SignerBtcBuilder({ dmk, sessionId }).build();
    const fingerprintResult = await actionOutput(
      signer.getMasterFingerprint() as unknown as ActionRequest<{ masterFingerprint: Uint8Array }>,
    );
    const publicKeyResult = await actionOutput(
      signer.getExtendedPublicKey(LEDGER_ACCOUNT_PATH, {
        checkOnDevice: false,
      }) as unknown as ActionRequest<{ extendedPublicKey: string }>,
    );
    const wallet = new DefaultWallet(LEDGER_ACCOUNT_PATH, DefaultDescriptorTemplate.TAPROOT);

    return {
      async getAccount() {
        return {
          accountPublicKey: publicKeyResult.extendedPublicKey,
          fingerprint: Array.from(fingerprintResult.masterFingerprint, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      },
      async displayAddress() {
        const result = await actionOutput(
          signer.getWalletAddress(wallet, 0, {
            checkOnDevice: true,
            change: false,
          }) as unknown as ActionRequest<{ address: string }>,
        );
        return result.address;
      },
      async disconnect() {
        if (sessionId) await dmk.disconnect({ sessionId }).catch(() => undefined);
        dmk.close();
      },
    };
  } catch (error) {
    if (sessionId) await dmk.disconnect({ sessionId }).catch(() => undefined);
    dmk.close();
    throw error;
  }
}

function defaultSupportCheck(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    "hid" in navigator
  );
}

export class LedgerWebHidAdapter implements HardwareWalletAdapter {
  readonly source = "ledger" as const;
  readonly label = "Ledger";
  private readonly loadBridge: () => Promise<LedgerBridge>;
  private readonly supported: () => boolean;

  constructor(options: LedgerAdapterOptions = {}) {
    this.loadBridge = options.loadBridge ?? loadDefaultBridge;
    this.supported = options.supported ?? defaultSupportCheck;
  }

  isSupported(): boolean {
    return this.supported();
  }

  async connect(_network: HarborNetwork): Promise<HardwareWalletConnection> {
    if (!this.isSupported()) {
      throw new HardwareWalletError(
        "Ledger requires Chromium WebHID on a secure HTTPS page or localhost. Import a watch-only wallet instead.",
        "unsupported",
      );
    }
    try {
      const bridge = await this.loadBridge();
      const account = await bridge.getAccount();
      return {
        candidate: {
          source: "ledger",
          accountPublicKey: account.accountPublicKey,
          fingerprint: account.fingerprint,
          accountPath: ACCOUNT_PATH,
        },
        async verifyAddress(expectedAddress) {
          const displayed = await bridge.displayAddress();
          if (displayed !== expectedAddress) {
            throw new HardwareWalletError(
              "The address on your Ledger does not match Harbor. Do not connect this wallet.",
              "address-mismatch",
            );
          }
        },
        disconnect: () => bridge.disconnect(),
      };
    } catch (error) {
      throw mapLedgerError(error);
    }
  }
}
