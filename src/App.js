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

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/french-open', label: 'Clay' },
  { to: '/wimbledon', label: 'Grass' },
  { to: '/us-open', label: 'Hard' },
  { to: '/dream-brackets', label: 'Brackets' },
  // { to: '/about', label: 'About Us' }
];

// Prefixes a men's-side path with /women, or strips it back off — the single
// source of truth both the nav links and the toggle use for "which tour am I
// on" is the current URL itself (isWomen), so every link the navbar renders
// stays on whichever tour you're already viewing until you explicitly hit
// the toggle, instead of the static nav links silently bouncing you back to
// ATP whenever you click Home/Clay/Grass/Hard/Brackets from a /women/* page.
function withTour(path, isWomen) {
  if (!isWomen) return path;
  return path === '/' ? '/women' : `/women${path}`;
}

// Lives inside <Router> (unlike App itself) so it can read the current
// location to decide which tour every nav link/the brand logo should point
// at, and to compute the toggle's target paths.
function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isWomen = location.pathname.startsWith('/women');
  const menPath = isWomen ? (location.pathname.replace(/^\/women/, '') || '/') : location.pathname;
  const womenPath = withTour(menPath, true);

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
      <div className="container">
        <NavLink to={withTour('/', isWomen)} className="navbar-brand d-flex align-items-center">
          <span className="brand-dot"><motion.img layoutId="home-intro-logo" src={logoHome} alt="" /></span>
          Smash!
        </NavLink>
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
            {NAV_ITEMS.map(({ to, label }) => (
              <li className="nav-item" key={to}>
                <NavLink
                  to={withTour(to, isWomen)}
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
  );
}

function App() {
  return (
    <Router>
      <GATracker /> {/* <-- Google Analytics route change tracker */}
      <Analytics /> {/* <-- Vercel Web Analytics */}
      <NavBar />

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
