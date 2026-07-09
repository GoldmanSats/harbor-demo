import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { DonatePage } from "./pages/DonatePage";
import { DashboardPage } from "./pages/DashboardPage";
import { fetchHealth, resetDemo, type HarborNetwork } from "./lib/api";

export function App() {
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [network, setNetwork] = useState<HarborNetwork>("mock");
  const [demoTools, setDemoTools] = useState(true);

  useEffect(() => {
    void fetchHealth()
      .then((h) => {
        setNetwork(h.network);
        setDemoTools(h.demoTools);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  async function onReset() {
    const msg =
      network === "signet"
        ? "Clear all donations, issued addresses, and the saved xpub?"
        : "Clear all demo donations and issued addresses?";
    if (!window.confirm(msg)) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await resetDemo();
      setResetMsg(res.message);
      window.dispatchEvent(new Event("harbor:demo-reset"));
    } catch (err) {
      setResetMsg((err as Error).message);
    } finally {
      setResetting(false);
    }
  }

  const isSignet = network === "signet";

  return (
    <div className="app-shell">
      <div className={`demo-banner ${isSignet ? "signet" : ""}`} role="status">
        {isSignet
          ? "Signet — real testnet coins. Funds only your wallet can spend."
          : "Simulated network — not real bitcoin. Fake money only."}
      </div>
      <nav className="nav">
        <div className="brand">Harbor</div>
        <span className={`pill ${isSignet ? "accent" : "warning"}`}>
          {isSignet ? "Signet" : "Simulated"}
        </span>
        <NavLink to="/donate" className={({ isActive }) => (isActive ? "active" : "")}>
          Donate
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
          Dashboard
        </NavLink>
        <button
          type="button"
          className="btn secondary"
          style={{ marginLeft: "auto", padding: "6px 12px", fontSize: "0.85rem" }}
          disabled={resetting}
          onClick={onReset}
        >
          {isSignet ? "Reset ledger" : "Reset demo"}
        </button>
      </nav>
      {resetMsg && (
        <p className="callout" style={{ marginTop: 0 }}>
          {resetMsg}
        </p>
      )}
      <Routes>
        <Route path="/" element={<DonatePage demoTools={demoTools} network={network} />} />
        <Route path="/donate" element={<DonatePage demoTools={demoTools} network={network} />} />
        <Route
          path="/dashboard"
          element={<DashboardPage demoTools={demoTools} network={network} />}
        />
      </Routes>
    </div>
  );
}
