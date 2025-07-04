import React from "react";
import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";

// these paths MUST match the files you created
import Home       from "./pages/Home";
import FrenchOpen from "./pages/FrenchOpen";
import Wimbledon  from "./pages/Wimbledon";
import USOpen     from "./pages/USOpen";
import AboutUs    from "./pages/AboutUs";

import "./index.css";    // this should be your cleaned-up CSS (above)

function App() {
  return (
    <Router>
      <nav className="navbar">
        <div className="nav-links">
          <NavItem to="/"        label="Home"       icon="ball.png" />
          <NavItem to="/french"  label="French Open" icon="logo_rg.png" />
          <NavItem to="/wimbledon" label="Wimbledon" icon="logo_wb.png" />
          <NavItem to="/usopen"    label="US Open"   icon="logo_us.png" />
          <NavItem to="/about"     label="About Us"  icon="lion.png" />
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/french"    element={<FrenchOpen />} />
          <Route path="/wimbledon" element={<Wimbledon />} />
          <Route path="/usopen"    element={<USOpen />} />
          <Route path="/about"     element={<AboutUs />} />
        </Routes>
      </main>
    </Router>
  );
}

function NavItem({ to, label, icon }) {
  return (
    <NavLink to={to} className="nav-item">
      <img src={`/assets/${icon}`} alt={label} className="nav-icon" />
      <span>{label}</span>
    </NavLink>
  );
}

export default App;
