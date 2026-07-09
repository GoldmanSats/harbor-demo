import { NavLink, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { DonatePage } from "./pages/DonatePage";
import { DashboardPage } from "./pages/DashboardPage";
import { resetDemo } from "./lib/api";

export function App() {
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function onReset() {
    if (!window.confirm("Clear all demo donations and issued addresses?")) return;
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

  return (
    <div className="app-shell">
      <div className="demo-banner" role="status">
        Simulated network — not real bitcoin. Fake money only.
      </div>
      <nav className="nav">
        <div className="brand">Harbor</div>
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
          Reset demo
        </button>
      </nav>
      {resetMsg && (
        <p className="callout" style={{ marginTop: 0 }}>
          {resetMsg}
        </p>
      )}
      <Routes>
        <Route path="/" element={<DonatePage />} />
        <Route path="/donate" element={<DonatePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
