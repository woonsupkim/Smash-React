// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';

import Home from './pages/Home';
import FrenchOpen from './pages/FrenchOpen';
import Wimbledon from './pages/Wimbledon';
import USOpen from './pages/USOpen';
import DreamBrackets from './pages/DreamBrackets';

import GATracker from './components/GATracker'; // <-- added this line
import { Analytics } from '@vercel/analytics/react';
import { motion } from 'framer-motion';

import logoHome from './assets/ball.png';

import './App.css';

// Maps the current pathname to its tour-mirrored counterpart, e.g.
// "/us-open" <-> "/women/us-open", "/" <-> "/women" — keeps whichever page
// you're on when switching tours instead of always bouncing back to Home.
function TourToggle() {
  const location = useLocation();
  const navigate = useNavigate();
  const isWomen = location.pathname.startsWith('/women');
  const menPath = isWomen ? (location.pathname.replace(/^\/women/, '') || '/') : location.pathname;
  const womenPath = isWomen ? location.pathname : `/women${location.pathname === '/' ? '' : location.pathname}`;

  return (
    <div className="tour-toggle" role="group" aria-label="Tour">
      <button
        type="button"
        className={`tour-toggle-btn${!isWomen ? ' active' : ''}`}
        onClick={() => navigate(menPath)}
      >
        ATP
      </button>
      <button
        type="button"
        className={`tour-toggle-btn${isWomen ? ' active' : ''}`}
        onClick={() => navigate(womenPath)}
      >
        WTA
      </button>
    </div>
  );
}

function App() {
  const navItems = [
    { to: '/', label: 'Home' },
    { to: '/french-open', label: 'Clay' },
    { to: '/wimbledon', label: 'Grass' },
    { to: '/us-open', label: 'Hard' },
    { to: '/dream-brackets', label: 'Brackets' },
    // { to: '/about', label: 'About Us' }
  ];

  return (
    <Router>
      <GATracker /> {/* <-- Google Analytics route change tracker */}
      <Analytics /> {/* <-- Vercel Web Analytics */}
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div className="container">
          <NavLink to="/" className="navbar-brand d-flex align-items-center">
            <span className="brand-dot"><motion.img layoutId="home-intro-logo" src={logoHome} alt="" /></span>
            Smash!
          </NavLink>
          <TourToggle />
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbarNav"
            aria-controls="navbarNav"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>
          <div className="collapse navbar-collapse" id="navbarNav">
            <ul className="navbar-nav ms-auto d-flex align-items-center">
              {navItems.map(({ to, label }) => (
                <li className="nav-item" key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `nav-link${isActive ? ' active' : ''}`
                    }
                  >
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<Home tour="atp" />} />
          <Route path="/french-open" element={<FrenchOpen tour="atp" />} />
          <Route path="/wimbledon" element={<Wimbledon tour="atp" />} />
          <Route path="/us-open" element={<USOpen tour="atp" />} />
          <Route path="/dream-brackets" element={<DreamBrackets tour="atp" />} />

          <Route path="/women" element={<Home tour="wta" />} />
          <Route path="/women/french-open" element={<FrenchOpen tour="wta" />} />
          <Route path="/women/wimbledon" element={<Wimbledon tour="wta" />} />
          <Route path="/women/us-open" element={<USOpen tour="wta" />} />
          <Route path="/women/dream-brackets" element={<DreamBrackets tour="wta" />} />
          {/* <Route path="/about" element={<About />} /> */}
        </Routes>
      </main>
    </Router>
  );
}

export default App;
