// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';

import Home from './pages/Home';
import FrenchOpen from './pages/FrenchOpen';
import Wimbledon from './pages/Wimbledon';
import USOpen from './pages/USOpen';
import DreamBrackets from './pages/DreamBrackets';

import GATracker from './components/GATracker'; // <-- added this line
import { Analytics } from '@vercel/analytics/react';

import logoHome from './assets/ball.png';

import './App.css';

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
            <span className="brand-dot"><img src={logoHome} alt="" /></span>
            Smash!
          </NavLink>
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
          <Route path="/" element={<Home />} />
          <Route path="/french-open" element={<FrenchOpen />} />
          <Route path="/wimbledon" element={<Wimbledon />} />
          <Route path="/us-open" element={<USOpen />} />
          <Route path="/dream-brackets" element={<DreamBrackets />} />
          {/* <Route path="/about" element={<About />} /> */}
        </Routes>
      </main>
    </Router>
  );
}

export default App;
