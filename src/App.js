// src/App.js
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';

import Home from './pages/Home';
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

// Route-level code splitting: Home stays eager (it IS the first paint);
// every other page loads on demand so the landing bundle stays small.
const H2H = lazy(() => import('./pages/H2H'));
const DreamBrackets = lazy(() => import('./pages/DreamBrackets'));
const TrackRecord = lazy(() => import('./pages/TrackRecord'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Changelog = lazy(() => import('./pages/Changelog'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));
const MatchPage = lazy(() => import('./pages/MatchPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const Today = lazy(() => import('./pages/Today'));
const DrawPage = lazy(() => import('./pages/DrawPage'));
const ModelCard = lazy(() => import('./pages/ModelCard'));
const Pickem = lazy(() => import('./pages/Pickem'));
const Rivalry = lazy(() => import('./pages/Rivalry'));
const Rivalries = lazy(() => import('./pages/Rivalries'));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Disclaimer = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Disclaimer })));

initMonitoring();

// Three product pillars instead of a flat list of pages: Predict is the
// daily habit, Prove is the trust surface, Play is the games. Methodology
// and the model card live in the footer's trust cluster; the Engine Room
// also appears under Prove because it earns it.
const NAV_GROUPS = [
  {
    label: 'Predict',
    items: [
      { to: '/today', label: 'Today', tourAgnostic: true },
      { to: '/h2h', label: 'H2H Studio' },
      { to: '/draw', label: 'Draw', tourAgnostic: true },
    ],
  },
  {
    label: 'Prove',
    items: [
      { to: '/track-record', label: 'The Ledger · Track Record' },
      { to: '/model', label: 'The Engine Room · Model', tourAgnostic: true },
    ],
  },
  {
    label: 'Play',
    items: [
      { to: '/pickem', label: "Pick'em", tourAgnostic: true },
      { to: '/dream-brackets', label: 'Brackets' },
    ],
  },
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
  // React-controlled collapse: the Bootstrap JS bundle was never loaded, so
  // the data-bs-toggle markup did nothing - the hamburger was inert on
  // mobile. State + the .show class (styled by Bootstrap's CSS) fixes it
  // without shipping Bootstrap's JS for one toggle.
  const [navOpen, setNavOpen] = useState(false);
  // Which pillar dropdown is open on desktop (click-to-open, esc/blur close).
  const [openGroup, setOpenGroup] = useState(null);

  // Close everything whenever navigation happens (link tap, back button).
  useEffect(() => { setNavOpen(false); setOpenGroup(null); }, [location.pathname, location.search]);

  // Click-away closes an open pillar menu.
  useEffect(() => {
    if (!openGroup) return undefined;
    const onDoc = (e) => { if (!e.target.closest('.nav-pillar')) setOpenGroup(null); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [openGroup]);

  const isLinkActive = (to) => {
    const [toPath, toQuery] = to.split('?');
    if (location.pathname !== toPath) return false;
    return !toQuery || location.search === `?${toQuery}`;
  };
  const groupActive = (group) =>
    group.items.some(({ to, tourAgnostic }) => isLinkActive(tourAgnostic ? to : withTour(to, isWomen)));

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top" onKeyDown={(e) => { if (e.key === 'Escape') setOpenGroup(null); }}>
      <div className="container">
        <NavLink to={withTour('/', isWomen)} className="navbar-brand d-flex align-items-center">
          <span className="brand-dot"><motion.img layoutId="home-intro-logo" src={logoHome} alt="" /></span>
          Smash
        </NavLink>
        <button
          className="navbar-toggler"
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          aria-controls="navbarNav"
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon" />
        </button>
        <div className={`collapse navbar-collapse${navOpen ? ' show' : ''}`} id="navbarNav">
          <ul className="navbar-nav ms-auto d-flex align-items-center">
            {NAV_GROUPS.map((group) => (
              <li className={`nav-item nav-pillar${openGroup === group.label ? ' open' : ''}`} key={group.label}>
                <button
                  type="button"
                  className={`nav-link nav-pillar-btn${groupActive(group) ? ' active' : ''}`}
                  aria-expanded={openGroup === group.label}
                  aria-haspopup="true"
                  onClick={() => setOpenGroup((g) => (g === group.label ? null : group.label))}
                >
                  {group.label}
                  <span className="nav-pillar-caret" aria-hidden="true">▾</span>
                </button>
                <ul className="nav-pillar-menu" hidden={openGroup !== group.label}>
                  {group.items.map(({ to, label, tourAgnostic }) => {
                    const target = tourAgnostic ? to : withTour(to, isWomen);
                    return (
                      <li key={to}>
                        <NavLink
                          to={target}
                          className={`nav-pillar-link${isLinkActive(target) ? ' active' : ''}`}
                        >
                          {label}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
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
        <Suspense fallback={<div className="route-loading" aria-hidden="true"><div className="skeleton route-loading-skel" /></div>}>
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
          <Route path="/pickem" element={<Pickem />} />
          <Route path="/rivalries" element={<Rivalries />} />
          <Route path="/rivalry/:tour/:slug" element={<Rivalry />} />

          {/* The live slam draw (both tours inside) and the model card */}
          <Route path="/draw" element={<DrawPage />} />
          <Route path="/women/draw" element={<DrawPage />} />
          <Route path="/model" element={<ModelCard />} />

          {/* Operations console - intentionally unlinked from the nav */}
          <Route path="/admin" element={<Admin />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <SiteFooter />
      <TabBar />
      </AuthProvider>
    </Router>
  );
}

export default App;
