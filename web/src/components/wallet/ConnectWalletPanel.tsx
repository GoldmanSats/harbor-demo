import { useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import {
  ApiError,
  previewWallet,
  saveWallet,
  type HarborNetwork,
  type SettingsPayload,
} from "../../lib/api";
import { LedgerWebHidAdapter } from "../../lib/wallet/ledger";
import { TrezorConnectAdapter } from "../../lib/wallet/trezor";
import type {
  HardwareWalletAdapter,
  HardwareWalletConnection,
  WalletCandidate,
  WalletPreview,
  WalletVerification,
} from "../../lib/wallet/types";

type ConnectWalletPanelProps = {
  settings: SettingsPayload | null;
  network: HarborNetwork;
  onConnected(): Promise<unknown> | void;
  adapters?: HardwareWalletAdapter[];
};

function importDescriptorFromText(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("Choose a wallet export or paste its watch-only text.");
  if (trimmed.startsWith("{")) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error("This JSON wallet export is not valid.");
    }
    for (const key of ["descriptor", "receiveDescriptor", "receive_descriptor"]) {
      if (typeof json[key] === "string") return String(json[key]).trim();
    }
    throw new Error("The JSON export does not contain a descriptor field.");
  }
  const descriptorLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("tr("));
  return descriptorLine ?? trimmed;
}

function sourceLabel(source: SettingsPayload["walletSource"]): string {
  switch (source) {
    case "trezor":
      return "Trezor";
    case "ledger":
      return "Ledger";
    case "import":
      return "Imported wallet";
    case "advanced":
      return "Advanced setup";
    case "legacy":
      return "Migrated wallet";
    default:
      return "Not connected";
  }
}

export function ConnectWalletPanel({
  settings,
  network,
  onConnected,
  adapters,
}: ConnectWalletPanelProps) {
  const defaultAdapters = useMemo(
    () => adapters ?? [new TrezorConnectAdapter(), new LedgerWebHidAdapter()],
    [adapters],
  );
  const [candidate, setCandidate] = useState<WalletCandidate | null>(null);
  const [preview, setPreview] = useState<WalletPreview | null>(null);
  const [connection, setConnection] = useState<HardwareWalletConnection | null>(null);
  const [verification, setVerification] = useState<WalletVerification | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [advancedText, setAdvancedText] = useState("");
  const [compared, setCompared] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | null>(null);

  useEffect(
    () => () => {
      scannerControls.current?.stop();
      void connection?.disconnect();
    },
    [connection],
  );

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let cancelled = false;
    void import("@zxing/browser")
      .then(async ({ BrowserQRCodeReader }) => {
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!result || cancelled) return;
            setImportText(result.getText());
            setMessage("QR read. Preview the wallet to continue.");
            setCameraOpen(false);
            scannerControls.current?.stop();
          },
        );
        if (cancelled) controls.stop();
        else scannerControls.current = controls;
      })
      .catch((error: unknown) => {
        setMessage(
          `Camera scanning is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        setCameraOpen(false);
      });
    return () => {
      cancelled = true;
      scannerControls.current?.stop();
      scannerControls.current = null;
    };
  }, [cameraOpen]);

  function resetDraft(): void {
    setCandidate(null);
    setPreview(null);
    setVerification(null);
    setCompared(false);
    setConfirmChange(false);
  }

  async function connectAdapter(adapter: HardwareWalletAdapter): Promise<void> {
    setBusy(true);
    setMessage(`Waiting for ${adapter.label} approval…`);
    resetDraft();
    if (connection) await connection.disconnect().catch(() => undefined);
    try {
      const nextConnection = await adapter.connect(network);
      const nextPreview = await previewWallet(nextConnection.candidate);
      setConnection(nextConnection);
      setCandidate(nextConnection.candidate);
      setPreview(nextPreview);
      setMessage(`Approve address 0 on your ${adapter.label} before saving.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function previewCandidate(nextCandidate: WalletCandidate): Promise<void> {
    setBusy(true);
    setMessage(null);
    resetDraft();
    if (connection) {
      await connection.disconnect().catch(() => undefined);
      setConnection(null);
    }
    try {
      const nextPreview = await previewWallet(nextCandidate);
      setCandidate(nextCandidate);
      setPreview(nextPreview);
      setMessage("Compare all three addresses with the wallet export before saving.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyDevice(): Promise<void> {
    if (!connection || !preview) return;
    setBusy(true);
    setMessage("Check the address shown on your hardware wallet…");
    try {
      await connection.verifyAddress(preview.previewAddresses[0]);
      setVerification({ method: "device", addresses: [preview.previewAddresses[0]] });
      setMessage("Device address matched Harbor's server preview.");
    } catch (error) {
      setVerification(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function persistWallet(): Promise<void> {
    if (!candidate || !preview || !verification) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveWallet(candidate, verification, confirmChange);
      await connection?.disconnect();
      setConnection(null);
      resetDraft();
      setImportOpen(false);
      setImportText("");
      setAdvancedText("");
      setMessage("Wallet connected. Harbor remains watch-only and cannot move funds.");
      await onConnected();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "wallet_change_confirmation_required"
      ) {
        setConfirmChange(false);
      }
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const direct = candidate?.source === "trezor" || candidate?.source === "ledger";
  const directAvailable = network === "signet" || network === "testnet4";
  const saveEnabled =
    Boolean(candidate && preview && verification) &&
    (!preview?.walletChange || confirmChange) &&
    !busy;

  return (
    <section className="card" aria-labelledby="connect-wallet-title">
      <div className="row">
        <strong id="connect-wallet-title">Connect hardware wallet</strong>
        {settings?.walletConnected ? (
          <span className="pill success">{sourceLabel(settings.walletSource)} connected</span>
        ) : (
          <span className="pill warning">
            {network === "signet" || network === "testnet4"
              ? "wallet required on public testnets"
              : "demo wallet active"}
          </span>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Harbor can see this donation account but cannot move funds. It never requests private keys
        or transaction approval.
      </p>

      <div className="row">
        {directAvailable &&
          defaultAdapters.map((adapter) => (
            <button
              key={adapter.source}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void connectAdapter(adapter)}
            >
              Connect {adapter.label}
            </button>
          ))}
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            setImportOpen((open) => !open);
            resetDraft();
          }}
        >
          Import watch-only wallet
        </button>
      </div>
      {!directAvailable && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Direct Trezor and Ledger connection is available on Signet and Testnet4. Import and
          Advanced setup remain available here.
        </p>
      )}

      {importOpen && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor="wallet-import" className="muted">
            Paste watch-only export text or choose a UTF-8 export file
          </label>
          <textarea
            id="wallet-import"
            className="input"
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              resetDraft();
            }}
            rows={4}
            style={{ width: "100%", minWidth: 0, resize: "vertical", marginTop: 6 }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <input
              aria-label="Choose watch-only wallet file"
              type="file"
              accept=".txt,.json,text/plain,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then(setImportText).catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error));
                });
              }}
            />
            <button
              type="button"
              className="btn secondary"
              onClick={() => setCameraOpen((open) => !open)}
            >
              {cameraOpen ? "Stop camera" : "Scan static QR"}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !importText.trim()}
              onClick={() => {
                try {
                  void previewCandidate({
                    source: "import",
                    descriptor: importDescriptorFromText(importText),
                  });
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              Preview wallet
            </button>
          </div>
          {cameraOpen && (
            <video
              ref={videoRef}
              aria-label="Wallet QR camera"
              style={{ width: "100%", maxWidth: 420, marginTop: 10 }}
            />
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Static QR codes are supported. Animated BBQr/UR is not yet supported. Direct
            Jade, Coldcard, and BitBox integrations are planned; use their watch-only export today.
          </p>
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary>Advanced setup</summary>
        <p className="muted">
          Paste a BIP-86 account xpub/tpub/vpub only if your wallet cannot export a watch-only file.
        </p>
        <textarea
          className="input"
          aria-label="Account xpub"
          value={advancedText}
          onChange={(event) => {
            setAdvancedText(event.target.value);
            resetDraft();
          }}
          placeholder="xpub… / tpub… / vpub…"
          rows={3}
          style={{ width: "100%", minWidth: 0, resize: "vertical" }}
        />
        <button
          type="button"
          className="btn secondary"
          style={{ marginTop: 8 }}
          disabled={busy || !advancedText.trim()}
          onClick={() =>
            void previewCandidate({
              source: "advanced",
              accountPublicKey: advancedText.trim(),
            })
          }
        >
          Preview addresses
        </button>
      </details>

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="muted">Server-derived receiving addresses:</div>
          <ol className="mono" style={{ paddingLeft: 20, fontSize: "0.85rem" }}>
            {preview.previewAddresses.map((address) => (
              <li key={address} className="break">
                {address}
              </li>
            ))}
          </ol>
          {direct ? (
            <button
              type="button"
              className="btn secondary"
              disabled={busy || Boolean(verification)}
              onClick={() => void verifyDevice()}
            >
              Verify address 0 on device
            </button>
          ) : (
            <label className="row" style={{ alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={compared}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setCompared(checked);
                  setVerification(
                    checked && preview.previewAddresses.length === 3
                      ? {
                          method: "addresses",
                          addresses: preview.previewAddresses as [string, string, string],
                        }
                      : null,
                  );
                }}
              />
              <span>I compared all three addresses with an independent wallet export.</span>
            </label>
          )}

          {preview.walletChange && (
            <div className="callout" role="alert" style={{ marginTop: 12 }}>
              <strong>This is a different wallet.</strong> Saving it will permanently clear issued
              addresses and donation history.
              <label className="row" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={confirmChange}
                  onChange={(event) => setConfirmChange(event.target.checked)}
                />
                <span>Replace the connected wallet and clear its Harbor history</span>
              </label>
            </div>
          )}

          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            disabled={!saveEnabled}
            onClick={() => void persistWallet()}
          >
            Save wallet
          </button>
        </div>
      )}

      {message && (
        <p className="callout" role={message.toLowerCase().includes("could not") ? "alert" : "status"}>
          {message}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          Working…
        </p>
      )}
    </section>
  );
}
