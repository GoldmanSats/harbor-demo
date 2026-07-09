import { useEffect, useMemo, useState } from "react";
import { QrImage } from "../components/QrImage";
import {
  DEFAULT_THRESHOLD,
  formatSats,
  requestPayment,
  simulateDonation,
  type DonateResponse,
  type HarborNetwork,
} from "../lib/api";

const PRESETS = [10_000, 100_000, 500_000, 2_000_000];

export function DonatePage({
  demoTools = true,
  network = "mock",
}: {
  demoTools?: boolean;
  network?: HarborNetwork;
}) {
  const [amountStr, setAmountStr] = useState("50000");
  const [payment, setPayment] = useState<DonateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [simMsg, setSimMsg] = useState<string | null>(null);

  const amount = useMemo(() => {
    const n = Number.parseInt(amountStr.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }, [amountStr]);

  useEffect(() => {
    if (amount <= 0) {
      setPayment(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await requestPayment(amount);
        if (!cancelled) setPayment(res);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount]);

  const threshold = payment?.thresholdSats ?? DEFAULT_THRESHOLD;

  async function onSimulate() {
    setSimMsg(null);
    try {
      const res = await simulateDonation(amount > 0 ? amount : undefined);
      if (res.rail === "lightning") {
        setSimMsg(
          `Simulated ${formatSats(res.amountSats)} over Lightning → e-cash wallet — check the dashboard.`,
        );
      } else {
        setSimMsg(
          `Simulated ${formatSats(res.amountSats)} on-chain to ${res.address.slice(0, 18)}… — check the dashboard.`,
        );
      }
    } catch (err) {
      setSimMsg((err as Error).message);
    }
  }

  return (
    <div>
      <h1 className="h1">Support our work</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        One permanent identifier. Enter an amount — Bitcoin is preferred. Below{" "}
        {formatSats(threshold)} you&apos;ll see Lightning (preview); at or above,
        a fresh on-chain address that lands in cold storage
        {network === "signet" ? " (signet)." : "."}
      </p>

      <div className="card">
        <div className="row" style={{ marginBottom: 16 }}>
          <strong>I want to give</strong>
          <input
            className="input"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="numeric"
            aria-label="Amount in sats"
          />
          <span className="muted">sats</span>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`preset ${amount === p ? "active" : ""}`}
              onClick={() => setAmountStr(String(p))}
            >
              {p.toLocaleString("en-US")}
            </button>
          ))}
          <span className="pill accent">Bitcoin — preferred</span>
        </div>

        {loading && <p className="muted">Preparing payment…</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {payment?.rail === "lightning" && (
          <div className="card watermark" style={{ background: "var(--surface-2)" }}>
            <div className="row">
              <strong>Lightning</strong>
              <span className="pill warning">preview · not live</span>
            </div>
            <p className="muted">{payment.message}</p>
            <p className="mono break muted" style={{ fontSize: "0.85rem" }}>
              {payment.offer}
            </p>
            <QrImage value={payment.offer} />
          </div>
        )}

        {payment?.rail === "onchain" && (
          <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
            <QrImage value={payment.uri} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="row">
                <strong>On-chain — fresh address</strong>
                <span className="pill success">works with every wallet</span>
              </div>
              <p className="muted">
                Used once. Funds are detected by Harbor&apos;s watch-only ledger and
                attributed to cold storage. No sweeps in this demo.
              </p>
              <p className="mono break" style={{ fontSize: "0.9rem" }}>
                {payment.address}
              </p>
              <p className="mono break muted" style={{ fontSize: "0.8rem" }}>
                {payment.uri}
              </p>
              {payment.recycled && (
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Recycled an expired unpaid address (gap-limit safe).
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {demoTools && (
        <div className="card">
          <div className="row">
            <strong>Dev tools</strong>
            <button type="button" className="btn secondary" onClick={onSimulate}>
              Simulate payment
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Follows the same routing as the QR above: below the threshold → Lightning
            e-cash; at or above → on-chain. Open the dashboard to see it appear.
          </p>
          {simMsg && <p className="callout" style={{ marginTop: 12 }}>{simMsg}</p>}
        </div>
      )}
    </div>
  );
}
