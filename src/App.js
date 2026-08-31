// src/App.js
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';

import Home from './pages/Home';
import SiteFooter from './components/SiteFooter';
import TabBar from './components/TabBar';

import GATracker from './components/GATracker'; // <-- added this line
import ErrorBoundary from './components/ErrorBoundary';
import { initMonitoring } from './utils/monitoring';
import { CHANGELOG } from './data/changelog';
import { ToastHost } from './components/ui/Toast';
import { Analytics } from '@vercel/analytics/react';
import { motion } from 'framer-motion';
import { liveSlam } from './utils/slamCalendar';

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
const Parlay = lazy(() => import('./pages/Parlay'));
const RiskPage = lazy(() => import('./pages/RiskPage'));
const DrawPage = lazy(() => import('./pages/DrawPage'));
const ModelCard = lazy(() => import('./pages/ModelCard'));
const Rivalry = lazy(() => import('./pages/Rivalry'));
const EdgeBoard = lazy(() => import('./pages/EdgeBoard'));
const Compare = lazy(() => import('./pages/Compare'));
const CompareHub = lazy(() => import('./pages/Compare').then((m) => ({ default: m.CompareHub })));
const SeasonRewind = lazy(() => import('./pages/SeasonRewind'));
const BracketChallenge = lazy(() => import('./pages/BracketChallenge'));
const FormChart = lazy(() => import('./pages/FormChart'));
const EventPage = lazy(() => import('./pages/EventPage'));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Disclaimer = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Disclaimer })));

initMonitoring();

// Four pillars, each answering one question a visitor actually has:
//
//   Today    - "what's on right now?" (the daily card, the parlay, the live
//              title odds, who's hot) - everything whose value expires
//   Simulate - "what if?" (the tools you drive: any matchup, any set of
//              players, any rivalry, computed point by point)
//   Receipts - "why should I believe it?" (the market head-to-head, the
//              graded ledger, the engine internals) - the hero's "see the
//              receipts" CTA lands here
//   Brackets - "let me play with it" (build a draw, or take on the model)
//
// Today and Simulate were one pillar until it became clear they answer
// different questions on different clocks: Today's Calls and the title odds
// are perishable and change every refresh, while the H2H studio is a tool
// that is the same tool tomorrow. Named for the verb or the moment, never
// for an abstraction. Methodology and the model card also live in the
// footer's trust cluster.
const NAV_GROUPS = [
  {
    label: 'Today',
    items: [
      { to: '/today', label: "Today's Calls", tourAgnostic: true },
      { to: '/parlay', label: 'The Parlay Builder', tourAgnostic: true },
      // Straight after the builder: it answers what to stake, this answers
      // what that stake does to you.
      { to: '/risk', label: 'Size Your Risk', tourAgnostic: true },
      { to: '/draw', label: 'The Draw · Title Odds', tourAgnostic: true },
      { to: '/form', label: 'The Form Chart', tourAgnostic: true },
    ],
  },
  {
    // Three surfaces here take two players. The labels have to say what each
    // one is FOR, or they read as three doors to the same room: the studio
    // prices a matchup, Compare lines the numbers up (rivalries included).
    label: 'H2H',
    items: [
      { to: '/h2h', label: 'H2H Studio · Price Any Matchup' },
      { to: '/compare', label: 'Compare Players & Rivalries', tourAgnostic: true },
    ],
  },
  {
    label: 'Brackets',
    items: [
      { to: '/dream-brackets', label: 'Dream Brackets · Build One' },
      { to: '/challenge', label: 'Bracket Challenge · Beat the Model', tourAgnostic: true, slamOnly: true },
    ],
  },
  {
    label: 'The Receipts',
    items: [
      { to: '/edge', label: 'The Edge · Vs the Market', tourAgnostic: true },
      { to: '/track-record', label: 'The Ledger · Every Call Graded' },
      { to: '/model', label: 'The Engine Room · Model', tourAgnostic: true },
      { to: '/season', label: 'The Rewind · Season', tourAgnostic: true, slamOnly: true },
    ],
  },
];

// Seasonal items (`slamOnly`) drop out of the top nav between slams, when
// there is no bracket to pick and no season to look back on. The pages and
// their URLs stay live and stay listed in the footer - this only stops two of
// fourteen nav slots being dead weight for most of the year.
function visibleGroups(now) {
  const live = liveSlam(now) != null;
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.slamOnly || live) }))
    .filter((g) => g.items.length > 0);
}

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

  // What's-new pulse: a one-time dot whenever a release ships that this
  // browser hasn't seen. It rides the Receipts pillar now - releases here are
  // mostly changes to how calls are made and graded, and that pillar is
  // where the changelog link lives to explain them.
  const releaseKey = `${CHANGELOG[0]?.version}-${CHANGELOG[0]?.date}`;
  const [unseenRelease, setUnseenRelease] = useState(() => {
    try { return localStorage.getItem('smash_whatsnew_seen') !== releaseKey; } catch { return false; }
  });
  const markReleaseSeen = () => {
    try { localStorage.setItem('smash_whatsnew_seen', releaseKey); } catch { /* private mode */ }
    setUnseenRelease(false);
  };

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

  // Recomputed per render rather than memoised: it only changes when a slam
  // starts or ends, and this is a handful of date comparisons.
  const groups = visibleGroups(new Date());

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
            {groups.map((group) => {
              const showPulse = unseenRelease && group.label === 'The Receipts';
              // A pillar left with one item is a dropdown that costs a click to
              // reveal a single link, so it renders as that link instead.
              if (group.items.length === 1 && group.label !== 'The Receipts') {
                const only = group.items[0];
                const target = only.tourAgnostic ? only.to : withTour(only.to, isWomen);
                return (
                  <li className="nav-item nav-pillar" key={group.label}>
                    <NavLink to={target} className={`nav-link nav-pillar-btn${isLinkActive(target) ? ' active' : ''}`}>
                      {group.label}
                    </NavLink>
                  </li>
                );
              }
              return (
                <li className={`nav-item nav-pillar${openGroup === group.label ? ' open' : ''}`} key={group.label}>
                  <button
                    type="button"
                    className={`nav-link nav-pillar-btn${groupActive(group) ? ' active' : ''}`}
                    aria-expanded={openGroup === group.label}
                    aria-haspopup="true"
                    onClick={() => {
                      if (showPulse) markReleaseSeen();
                      setOpenGroup((g) => (g === group.label ? null : group.label));
                    }}
                  >
                    {group.label}
                    {showPulse && <span className="nav-pillar-pulse" aria-label="new features" />}
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
                    {group.label === 'The Receipts' && (
                      <li>
                        <NavLink to="/changelog" className="nav-pillar-link nav-pillar-whatsnew">
                          What's new in v{CHANGELOG[0]?.version} →
                        </NavLink>
                      </li>
                    )}
                  </ul>
                </li>
              );
            })}
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

          {/* Release notes and legal - tour-agnostic */}
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/disclaimer" element={<Disclaimer />} />

          {/* Deep links: per-match, per-player, and the link-in-bio page */}
          <Route path="/match/:slug" element={<MatchPage />} />
          <Route path="/player/:tour/:id" element={<PlayerPage />} />
          <Route path="/today" element={<Today />} />
          <Route path="/parlay" element={<Parlay />} />
          <Route path="/risk" element={<RiskPage />} />
          {/* Merged into /compare: a rivalry is a comparison with history,
              and two hubs for that job was one too many. Redirect keeps every
              existing link and search result working. */}
          <Route path="/rivalries" element={<Navigate to="/compare" replace />} />
          <Route path="/rivalry/:tour/:slug" element={<Rivalry />} />

          {/* v3.5: the Edge board, the daily game, the gym, comparisons,
              season rewinds, and the slam bracket challenge */}
          <Route path="/edge" element={<EdgeBoard />} />
          <Route path="/compare" element={<CompareHub />} />
          <Route path="/compare/:tour/:slugs" element={<Compare />} />
          <Route path="/season" element={<SeasonRewind />} />
          <Route path="/season/:year" element={<SeasonRewind />} />
          <Route path="/challenge" element={<BracketChallenge />} />
          <Route path="/form" element={<FormChart />} />
          <Route path="/event/:slug" element={<EventPage />} />

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
    </Router>
  );
}

export default App;
