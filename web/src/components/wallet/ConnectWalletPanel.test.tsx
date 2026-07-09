import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectWalletPanel } from "./ConnectWalletPanel";
import type { HardwareWalletAdapter } from "../../lib/wallet/types";

const PREVIEW = [
  "tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8",
  "tb1p222222222222222222222222222222222222222222222222222222q77t0f",
  "tb1p333333333333333333333333333333333333333333333333333333q7zrlj",
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(walletChange = false) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return jsonResponse({
        ok: true,
        source: "trezor",
        fingerprint: "73c5da0a",
        accountPath: "m/86'/1'/0'",
        previewAddresses: PREVIEW,
        walletChange,
        network: "testnet4",
      });
    }
    return jsonResponse({
      thresholdSats: 500_000,
      btcUsdRate: 115_000,
      accountXpub: null,
      network: "testnet4",
      walletConnected: true,
      walletSource: "trezor",
      walletFingerprint: "73c5da0a",
      walletAccountPath: "m/86'/1'/0'",
      walletConnectedAt: new Date(0).toISOString(),
      usingDemoWallet: false,
      usingDemoXpub: false,
      previewAddresses: PREVIEW,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function adapter(): HardwareWalletAdapter {
  return {
    source: "trezor",
    label: "Trezor",
    isSupported: () => true,
    connect: vi.fn(async () => ({
      candidate: {
        source: "trezor" as const,
        accountPublicKey: "xpub-test",
        fingerprint: "73c5da0a",
        accountPath: "m/86'/1'/0'",
      },
      verifyAddress: vi.fn(async (address: string) => {
        expect(address).toBe(PREVIEW[0]);
      }),
      disconnect: vi.fn(async () => undefined),
    })),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectWalletPanel", () => {
  it("shows vendor-neutral methods with Advanced collapsed by default", () => {
    render(
      <ConnectWalletPanel
        settings={null}
        network="testnet4"
        adapters={[adapter()]}
        onConnected={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect Trezor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import watch-only wallet" })).toBeTruthy();
    const details = screen.getByText("Advanced setup").closest("details");
    expect(details?.open).toBe(false);
  });

  it("hides direct device connections off Signet/Testnet4 while keeping fallbacks", () => {
    render(
      <ConnectWalletPanel
        settings={null}
        network="mock"
        adapters={[adapter()]}
        onConnected={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect Trezor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Import watch-only wallet" })).toBeTruthy();
    expect(screen.getByText("Advanced setup")).toBeTruthy();
  });

  it("requires server preview and physical address verification before saving", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    const onConnected = vi.fn();
    render(
      <ConnectWalletPanel
        settings={null}
        network="testnet4"
        adapters={[adapter()]}
        onConnected={onConnected}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Connect Trezor" }));
    await screen.findByText(PREVIEW[0]);
    const save = screen.getByRole("button", { name: "Save wallet" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Verify address 0 on device" }));
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);

    await screen.findByText(/Wallet connected/);
    expect(onConnected).toHaveBeenCalledOnce();
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).verification).toEqual({
      method: "device",
      addresses: [PREVIEW[0]],
    });
  });

  it("keeps imported wallets gated on three-address comparison", async () => {
    mockApi();
    const user = userEvent.setup();
    render(
      <ConnectWalletPanel
        settings={null}
        network="testnet4"
        adapters={[adapter()]}
        onConnected={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Import watch-only wallet" }));
    await user.click(screen.getByLabelText(/Paste watch-only export/));
    await user.paste("tr([73c5da0a/86h/1h/0h]xpub/0/*)");
    await user.click(screen.getByRole("button", { name: "Preview wallet" }));
    await screen.findByText(PREVIEW[2]);

    const save = screen.getByRole("button", { name: "Save wallet" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /compared all three/i }));
    expect(save.disabled).toBe(false);
  });

  it("requires explicit confirmation before replacing a wallet with history", async () => {
    mockApi(true);
    const user = userEvent.setup();
    render(
      <ConnectWalletPanel
        settings={null}
        network="testnet4"
        adapters={[adapter()]}
        onConnected={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Connect Trezor" }));
    await screen.findByText(/This is a different wallet/);
    await user.click(screen.getByRole("button", { name: "Verify address 0 on device" }));
    const save = screen.getByRole("button", { name: "Save wallet" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /Replace the connected wallet/i }));
    expect(save.disabled).toBe(false);
  });
});
