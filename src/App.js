// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';

import Home from './pages/Home';
import H2H from './pages/H2H';
import DreamBrackets from './pages/DreamBrackets';
import TrackRecord from './pages/TrackRecord';
import Methodology from './pages/Methodology';
import Changelog from './pages/Changelog';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';
import MatchPage from './pages/MatchPage';
import PlayerPage from './pages/PlayerPage';
import Today from './pages/Today';
import { Terms, Privacy, Disclaimer } from './pages/Legal';
import SiteFooter from './components/SiteFooter';
import TabBar from './components/TabBar';

import GATracker from './components/GATracker'; // <-- added this line
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './auth/AuthContext';
import AccountButton from './auth/AccountButton';
import { initMonitoring } from './utils/monitoring';
import { ToastHost } from './components/ui/Toast';
import { Analytics } from '@vercel/analytics/react';
import { motion } from 'framer-motion';

import logoHome from './assets/ball.png';

import './App.css';

initMonitoring();

// Methodology lives in the footer (a visit-once trust page); Today is the
// daily-habit page and earns the nav slot instead.
const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/today', label: 'Today', tourAgnostic: true },
  // No surface query: H2H itself defaults to the live/upcoming slam.
  { to: '/h2h', label: 'H2H' },
  { to: '/dream-brackets', label: 'Brackets' },
  { to: '/track-record', label: 'Track Record' },
];

// Prefixes a men's-side path with /women, or strips it back off - the single
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
  const isWomen = location.pathname.startsWith('/women');

  // NavLink's default isActive match ignores the query string, so "Clay",
  // "Grass", and "Hard" (all pointing at /h2h with a different ?surface=)
  // would otherwise all light up together regardless of which one is
  // actually selected - compare the query string too for items that have one.
  const isLinkActive = (to) => {
    const [toPath, toQuery] = to.split('?');
    if (location.pathname !== toPath) return false;
    return !toQuery || location.search === `?${toQuery}`;
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
      <div className="container">
        <NavLink to={withTour('/', isWomen)} className="navbar-brand d-flex align-items-center">
          <span className="brand-dot"><motion.img layoutId="home-intro-logo" src={logoHome} alt="" /></span>
          Smash
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
            {NAV_ITEMS.map(({ to, label, tourAgnostic }) => {
              const target = tourAgnostic ? to : withTour(to, isWomen);
              return (
                <li className="nav-item" key={to}>
                  <NavLink
                    to={target}
                    className={`nav-link${isLinkActive(target) ? ' active' : ''}`}
                  >
                    {label}
                  </NavLink>
                </li>
              );
            })}
            <li className="nav-item">
              <AccountButton />
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
      <GATracker /> {/* <-- Google Analytics route change tracker */}
      <Analytics /> {/* <-- Vercel Web Analytics */}
      <ToastHost />
      <a className="skip-link" href="#main">Skip to content</a>
      <NavBar />

      <main id="main" className="page-content">
        <ErrorBoundary>
        <Routes>
          {/* Home is tour-agnostic (covers ATP + WTA together); the /women
              mirror stays only so the tour toggle and old links keep working */}
          <Route path="/" element={<Home />} />
          <Route path="/h2h" element={<H2H tour="atp" />} />
          <Route path="/dream-brackets" element={<DreamBrackets tour="atp" />} />

          <Route path="/women" element={<Home />} />
          <Route path="/women/h2h" element={<H2H tour="wta" />} />
          <Route path="/women/dream-brackets" element={<DreamBrackets tour="wta" />} />

          {/* Track record covers both tours internally (ATP/WTA filter on
              the page itself); the /women mirror keeps nav links working */}
          <Route path="/track-record" element={<TrackRecord />} />
          <Route path="/women/track-record" element={<TrackRecord />} />

          {/* Methodology is tour-agnostic; the /women mirror keeps nav links working */}
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/women/methodology" element={<Methodology />} />

          {/* Pre-merge URLs - redirect rather than 404 for any existing
              bookmarks/links to the old per-tournament pages. */}
          <Route path="/french-open" element={<Navigate to="/h2h?surface=clay" replace />} />
          <Route path="/wimbledon" element={<Navigate to="/h2h?surface=grass" replace />} />
          <Route path="/us-open" element={<Navigate to="/h2h?surface=hard" replace />} />
          <Route path="/women/french-open" element={<Navigate to="/women/h2h?surface=clay" replace />} />
          <Route path="/women/wimbledon" element={<Navigate to="/women/h2h?surface=grass" replace />} />
          <Route path="/women/us-open" element={<Navigate to="/women/h2h?surface=hard" replace />} />
          {/* <Route path="/about" element={<About />} /> */}

          {/* Release notes and legal - tour-agnostic */}
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/disclaimer" element={<Disclaimer />} />

          {/* Deep links: per-match, per-player, and the link-in-bio page */}
          <Route path="/match/:slug" element={<MatchPage />} />
          <Route path="/player/:tour/:id" element={<PlayerPage />} />
          <Route path="/today" element={<Today />} />

          {/* Operations console - intentionally unlinked from the nav */}
          <Route path="/admin" element={<Admin />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <SiteFooter />
      <TabBar />
      </AuthProvider>
    </Router>
  );
}

export default App;
