import { useCallback, useEffect, useState } from "react";
import {
  explorerTxUrl,
  fetchDonations,
  formatSats,
  formatUsd,
  previewAccountXpub,
  simulateDonation,
  updateAccountXpub,
  updateThreshold,
  type Donation,
  type DonationsPayload,
  type HarborNetwork,
} from "../lib/api";

function statusPill(status: Donation["status"], rail: Donation["rail"]) {
  if (rail === "lightning") return <span className="pill success">e-cash</span>;
  if (status === "confirmed") return <span className="pill success">confirmed</span>;
  if (status === "pending") return <span className="pill warning">pending</span>;
  return <span className="pill danger">quarantined</span>;
}

export function DashboardPage({
  demoTools = true,
  network = "mock",
}: {
  demoTools?: boolean;
  network?: HarborNetwork;
}) {
  const [data, setData] = useState<DonationsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thresholdInput, setThresholdInput] = useState("");
  const [xpubInput, setXpubInput] = useState("");
  const [draftPreview, setDraftPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await fetchDonations();
      setData(payload);
      setThresholdInput(String(payload.settings.thresholdSats));
      setError(null);
      return payload;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh().then((payload) => {
      if (payload?.settings.accountXpub) {
        setXpubInput(payload.settings.accountXpub);
      }
    });
    const id = setInterval(() => void refresh(), network === "signet" ? 10_000 : 3000);
    const onReset = () => {
      setXpubInput("");
      setDraftPreview(null);
      setWalletMsg(null);
      void refresh();
    };
    window.addEventListener("harbor:demo-reset", onReset);
    return () => {
      clearInterval(id);
      window.removeEventListener("harbor:demo-reset", onReset);
    };
  }, [refresh, network]);

  async function onSaveThreshold() {
    const n = Number.parseInt(thresholdInput, 10);
    if (!Number.isInteger(n) || n < 1) return;
    setBusy(true);
    try {
      await updateThreshold(n);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onPreviewXpub() {
    const trimmed = xpubInput.trim();
    if (!trimmed) return;
    setBusy(true);
    setWalletMsg(null);
    setDraftPreview(null);
    try {
      const res = await previewAccountXpub(trimmed);
      setDraftPreview(res.previewAddresses);
      setWalletMsg(
        "Compare these addresses with Sparrow receive #0–#2. If they match, click Save wallet.",
      );
    } catch (err) {
      setWalletMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveXpub() {
    const trimmed = xpubInput.trim();
    if (!trimmed) return;
    if (!draftPreview || draftPreview.length === 0) {
      setWalletMsg("Preview addresses first and confirm they match Sparrow before saving.");
      return;
    }
    const saved = data?.settings.accountXpub;
    const changing = Boolean(saved) && saved !== trimmed;
    if (changing) {
      const ok = window.confirm(
        "Changing the xpub will clear issued addresses and the donation ledger. Continue?",
      );
      if (!ok) return;
    }
    setBusy(true);
    setWalletMsg(null);
    try {
      const res = await updateAccountXpub(trimmed, true);
      setWalletMsg("Wallet connected. Harbor will derive donation addresses from this xpub only.");
      setXpubInput(res.accountXpub ?? trimmed);
      setDraftPreview(null);
      await refresh();
    } catch (err) {
      setWalletMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSimulate() {
    setBusy(true);
    try {
      await simulateDonation();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const savedPreview = data?.settings.previewAddresses ?? [];
  const preview = draftPreview ?? (data?.settings.usingDemoXpub ? [] : savedPreview);
  const activeNetwork = data?.settings.network ?? network;
  const showingDraft = draftPreview !== null;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 className="h1" style={{ margin: 0 }}>
          Org dashboard
        </h1>
        <span className="pill">watch-only</span>
        <span className={`pill ${activeNetwork === "signet" ? "accent" : "warning"}`}>
          {activeNetwork === "signet" ? "Signet" : "Simulated"}
        </span>
      </div>
      <p className="muted">
        {activeNetwork === "signet"
          ? "Ledger of donations detected on signet. Harbor never holds keys and never signs."
          : "Ledger of donations detected on the simulated chain. Harbor never holds keys and never signs."}
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card">
        <strong>Connect your wallet</strong>
        <p className="muted" style={{ marginTop: 8 }}>
          Paste the account xpub from Sparrow (signet taproot — often{" "}
          <span className="mono">tpub</span> / <span className="mono">vpub</span>). Preview the
          first three receive addresses and confirm they match Sparrow <em>before</em> saving.
        </p>
        <textarea
          className="input"
          value={xpubInput}
          onChange={(e) => {
            setXpubInput(e.target.value);
            setDraftPreview(null);
            setWalletMsg(null);
          }}
          placeholder="xpub… / tpub… / vpub…"
          rows={3}
          style={{ width: "100%", minWidth: 0, fontFamily: "inherit", resize: "vertical" }}
          aria-label="Account xpub"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !xpubInput.trim()}
            onClick={onPreviewXpub}
          >
            Preview addresses
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !xpubInput.trim() || !draftPreview}
            onClick={onSaveXpub}
          >
            Save wallet
          </button>
          {data?.settings.usingDemoXpub ? (
            <span className="pill warning">
              {activeNetwork === "signet" ? "wallet required" : "using demo xpub"}
            </span>
          ) : (
            <span className="pill success">org xpub saved</span>
          )}
        </div>
        {preview.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              {showingDraft
                ? "Draft preview — confirm these match Sparrow before saving:"
                : "Saved wallet — first 3 receive addresses:"}
            </div>
            <ol className="mono" style={{ margin: 0, paddingLeft: 20, fontSize: "0.85rem" }}>
              {preview.map((addr) => (
                <li key={addr} className="break" style={{ marginBottom: 4 }}>
                  {addr}
                </li>
              ))}
            </ol>
          </div>
        )}
        {walletMsg && <p className="callout" style={{ marginTop: 12 }}>{walletMsg}</p>}
      </div>

      <div className="grid" style={{ marginBottom: 16, marginTop: 16 }}>
        <div className="stat">
          <div className="value">{summary ? formatSats(summary.coldStorageSats) : "—"}</div>
          <div className="label">Cold storage (on-chain)</div>
        </div>
        <div className="stat">
          <div className="value">{summary ? formatSats(summary.ecashSats) : "—"}</div>
          <div className="label">E-cash / Lightning</div>
        </div>
        <div className="stat">
          <div className="value">{summary ? formatSats(summary.quarantinedSats) : "—"}</div>
          <div className="label">Quarantined on-chain dust</div>
        </div>
        <div className="stat">
          <div className="value">{summary ? String(summary.donationCount) : "—"}</div>
          <div className="label">Donations recorded</div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <strong>Routing threshold</strong>
          <input
            className="input"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            style={{ width: 140 }}
          />
          <span className="muted">sats</span>
          <button type="button" className="btn secondary" disabled={busy} onClick={onSaveThreshold}>
            Save
          </button>
          {demoTools && (
            <button type="button" className="btn" disabled={busy} onClick={onSimulate}>
              Simulate donation
            </button>
          )}
          <a className="btn secondary" href="/api/donations/export.csv">
            Export CSV
          </a>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
          {demoTools ? (
            <>
              Below the threshold, Simulate records a Lightning → e-cash receipt (not
              quarantine). Quarantine is only for under-threshold <em>on-chain</em>{" "}
              UTXOs.{" "}
            </>
          ) : (
            <>Quarantine applies to under-threshold on-chain UTXOs. </>
          )}
          Fiat is frozen at first sight — rate{" "}
          {data ? formatUsd(data.settings.btcUsdRate) : "—"} / BTC.
        </p>
      </div>

      <div className="card">
        <strong>Recent donations</strong>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Rail</th>
              <th>Amount</th>
              <th>Fiat at receipt</th>
              <th>Status</th>
              <th>Address / tx</th>
            </tr>
          </thead>
          <tbody>
            {(data?.donations ?? []).map((d) => {
              const txUrl = explorerTxUrl(activeNetwork, d.txid);
              return (
                <tr key={d.id}>
                  <td>{new Date(d.firstSeenAt).toLocaleString()}</td>
                  <td>{d.rail}</td>
                  <td>{formatSats(d.amountSats)}</td>
                  <td>{formatUsd(d.fiatUsdAtReceipt)}</td>
                  <td>{statusPill(d.status, d.rail)}</td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>
                    {d.rail === "lightning" ? (
                      <div>Settled to e-cash wallet (preview)</div>
                    ) : (
                      <>
                        <div className="break">{d.address}</div>
                        <div className="muted break">
                          {txUrl ? (
                            <a href={txUrl} target="_blank" rel="noreferrer">
                              {d.txid.slice(0, 16)}…
                            </a>
                          ) : (
                            <>{d.txid.slice(0, 16)}…</>
                          )}{" "}
                          · {d.confirmations} conf
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && data.donations.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {demoTools
                    ? "No donations yet. Use Simulate on this page or the donor page."
                    : "No donations yet. Connect a wallet, then send signet coins to an issued address."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
