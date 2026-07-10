import { describe, expect, it, vi } from "vitest";
import { LedgerWebHidAdapter, type LedgerBridge } from "./ledger";
import { TrezorConnectAdapter, type TrezorBridge } from "./trezor";

const ACCOUNT = {
  accountPublicKey: "xpub-account",
  fingerprint: "73c5da0a",
};
const ADDRESS = "tb1ptest-address";

function trezorBridge(overrides: Partial<TrezorBridge> = {}): TrezorBridge {
  return {
    getAccount: vi.fn(async () => ACCOUNT),
    displayAddress: vi.fn(async () => ADDRESS),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
}

function ledgerBridge(overrides: Partial<LedgerBridge> = {}): LedgerBridge {
  return {
    getAccount: vi.fn(async () => ACCOUNT),
    displayAddress: vi.fn(async () => ADDRESS),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("TrezorConnectAdapter", () => {
  it("returns BIP-86 public account data and verifies the displayed address", async () => {
    const adapter = new TrezorConnectAdapter({
      supported: () => true,
      loadBridge: async () => trezorBridge(),
    });
    const connection = await adapter.connect("testnet4");
    expect(connection.candidate).toEqual({
      source: "trezor",
      accountPublicKey: ACCOUNT.accountPublicKey,
      fingerprint: ACCOUNT.fingerprint,
      accountPath: "m/86'/1'/0'",
    });
    await expect(connection.verifyAddress(ADDRESS)).resolves.toBeUndefined();
  });

  it("reports unsupported browsers, denial, and address mismatch plainly", async () => {
    await expect(
      new TrezorConnectAdapter({ supported: () => false }).connect("testnet4"),
    ).rejects.toMatchObject({ code: "unsupported" });

    const denied = new TrezorConnectAdapter({
      supported: () => true,
      loadBridge: async () =>
        trezorBridge({
          getAccount: vi.fn(async () => {
            throw new Error("User cancelled popup");
          }),
        }),
    });
    await expect(denied.connect("testnet4")).rejects.toMatchObject({ code: "denied" });

    const mismatch = await new TrezorConnectAdapter({
      supported: () => true,
      loadBridge: async () => trezorBridge({ displayAddress: vi.fn(async () => "other") }),
    }).connect("testnet4");
    await expect(mismatch.verifyAddress(ADDRESS)).rejects.toMatchObject({
      code: "address-mismatch",
    });
  });
});

describe("LedgerWebHidAdapter", () => {
  it("returns public account data and verifies address 0", async () => {
    const adapter = new LedgerWebHidAdapter({
      supported: () => true,
      loadBridge: async () => ledgerBridge(),
    });
    const connection = await adapter.connect("signet");
    expect(connection.candidate.source).toBe("ledger");
    await expect(connection.verifyAddress(ADDRESS)).resolves.toBeUndefined();
  });

  it("maps unsupported, disconnect, wrong-app, and mismatch failures", async () => {
    await expect(
      new LedgerWebHidAdapter({ supported: () => false }).connect("testnet4"),
    ).rejects.toMatchObject({ code: "unsupported" });

    const disconnected = new LedgerWebHidAdapter({
      supported: () => true,
      loadBridge: async () =>
        ledgerBridge({
          getAccount: vi.fn(async () => {
            throw new Error("Device disconnected");
          }),
        }),
    });
    await expect(disconnected.connect("signet")).rejects.toMatchObject({ code: "disconnected" });

    const wrongApp = new LedgerWebHidAdapter({
      supported: () => true,
      loadBridge: async () => {
        throw new Error("Bitcoin app is not open");
      },
    });
    await expect(wrongApp.connect("signet")).rejects.toMatchObject({ code: "wrong-app" });

    const mismatch = await new LedgerWebHidAdapter({
      supported: () => true,
      loadBridge: async () => ledgerBridge({ displayAddress: vi.fn(async () => "other") }),
    }).connect("signet");
    await expect(mismatch.verifyAddress(ADDRESS)).rejects.toMatchObject({
      code: "address-mismatch",
    });
  });
});
