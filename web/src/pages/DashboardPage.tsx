import { useCallback, useEffect, useState } from "react";
import {
  explorerTxUrl,
  fetchDonations,
  formatSats,
  formatUsd,
  simulateDonation,
  updateThreshold,
  type Donation,
  type DonationsPayload,
  type HarborNetwork,
} from "../lib/api";
import { ConnectWalletPanel } from "../components/wallet/ConnectWalletPanel";

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
  const [busy, setBusy] = useState(false);

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
    void refresh();
    const id = setInterval(
      () => void refresh(),
      network === "signet" || network === "testnet4" ? 10_000 : 3000,
    );
    const onReset = () => {
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
  const activeNetwork = data?.settings.network ?? network;
  const publicNetwork = activeNetwork === "signet" || activeNetwork === "testnet4";
  const networkLabel =
    activeNetwork === "testnet4" ? "Testnet4" : activeNetwork === "signet" ? "Signet" : "Simulated";

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 className="h1" style={{ margin: 0 }}>
          Org dashboard
        </h1>
        <span className="pill">watch-only</span>
        <span className={`pill ${publicNetwork ? "accent" : "warning"}`}>
          {networkLabel}
        </span>
      </div>
      <p className="muted">
        {publicNetwork
          ? `Ledger of donations detected on ${networkLabel}. Harbor never holds keys and never signs.`
          : "Ledger of donations detected on the simulated chain. Harbor never holds keys and never signs."}
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <ConnectWalletPanel
        settings={data?.settings ?? null}
        network={activeNetwork}
        onConnected={refresh}
      />

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
                    : `No donations yet. Connect a wallet, then send ${networkLabel} coins to an issued address.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
