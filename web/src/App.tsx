import { NavLink, Route, Routes } from "react-router-dom";
import { DonatePage } from "./pages/DonatePage";
import { DashboardPage } from "./pages/DashboardPage";

export function App() {
  return (
    <div className="app-shell">
      <nav className="nav">
        <div className="brand">Harbor</div>
        <NavLink to="/donate" className={({ isActive }) => (isActive ? "active" : "")}>
          Donate
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
          Dashboard
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<DonatePage />} />
        <Route path="/donate" element={<DonatePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
