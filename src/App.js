import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Home from './pages/Home';
import FrenchOpen from './pages/FrenchOpen';
import Wimbledon from './pages/Wimbledon';
import USOpen from './pages/USOpen';
import About from './pages/About';
import './App.css';
import ball from './assets/ball.png';


function App() {
  return (
    <Router>
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div className="container">
          <NavLink to="/" className="navbar-brand d-flex align-items-center">
            <img
              src={ball}
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
            <ul className="navbar-nav ms-auto">
              {[
                ['/', 'Home'],
                ['/french-open', 'French Open'],
                ['/wimbledon', 'Wimbledon'],
                ['/us-open', 'US Open'],
                ['/about', 'About Us']
              ].map(([to, label]) => (
                <li className="nav-item" key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
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
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
    </Router>
  );
}

export default App;
