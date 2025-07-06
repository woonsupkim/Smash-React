// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';

import Home          from './pages/Home';
import FrenchOpen    from './pages/FrenchOpen';
import Wimbledon     from './pages/Wimbledon';
import USOpen        from './pages/USOpen';
import DreamBrackets from './pages/DreamBrackets';
// import About         from './pages/About';

import './App.css';
import logoRG from './assets/logo_rg.png';
import logoWB from './assets/logo_wb.png';
import logoUS from './assets/logo_us.png';

function App() {
  const navItems = [
    { to: '/',              label: 'Home',       logo: null          },
    { to: '/french-open',   label: 'French Open',logo: logoRG       },
    { to: '/wimbledon',     label: 'Wimbledon',  logo: logoWB       },
    { to: '/us-open',       label: 'US Open',    logo: logoUS       },
    { to: '/dream-brackets',label: 'Brackets',   logo: null          }//,
    // { to: '/about',         label: 'About Us',   logo: null          }
  ];

  return (
    <Router>
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div className="container">
          <NavLink to="/" className="navbar-brand d-flex align-items-center">
            <img
              src={process.env.PUBLIC_URL + '/assets/ball.png'}
              height="40"
              alt="SMASH! logo"
              className="me-2"
            />
            SMASH!
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
              {navItems.map(({ to, label, logo }) => (
                <li className="nav-item" key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `nav-link d-flex align-items-center${isActive ? ' active' : ''}`
                    }
                  >
                    {logo && (
                      <img
                        src={logo}
                        alt={`${label} logo`}
                        className="nav-logo-icon me-1"
                      />
                    )}
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
