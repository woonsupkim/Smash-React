// src/pages/Home.js

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import logoHome from '../assets/ball.png';
import './Home.css';

const SURFACES = [
  { to: '/french-open', label: 'Clay',  city: 'Paris',    desc: 'Slow, high bounce. Grinders thrive.', className: 'surface-clay' },
  { to: '/wimbledon',   label: 'Grass', city: 'London',   desc: 'Fast, low skid. Big servers fly.', className: 'surface-grass' },
  { to: '/us-open',     label: 'Hard',  city: 'New York', desc: 'Balanced, true bounce. All-courters.', className: 'surface-hard' },
];

const INTRO_SESSION_KEY = 'smash-intro-played';

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Home() {
  const [refreshMeta, setRefreshMeta] = useState(null);
  // Plays once per browser session — a returning visitor navigating back to
  // Home from another page won't see it replay every time.
  const [showIntro, setShowIntro] = useState(() => !sessionStorage.getItem(INTRO_SESSION_KEY));

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/refresh-meta.json')
      .then(r => r.json())
      .then(setRefreshMeta)
      .catch(() => setRefreshMeta(null));
  }, []);

  useEffect(() => {
    if (!showIntro) return;
    // Hold on the fully-revealed logo+title for a beat before the logo
    // morphs into the nav's home button and the rest of the page fades in.
    const tid = setTimeout(() => {
      setShowIntro(false);
      sessionStorage.setItem(INTRO_SESSION_KEY, '1');
    }, 2200);
    return () => clearTimeout(tid);
  }, [showIntro]);

  const handleUpdateData = async () => {
    const { value: password } = await Swal.fire({
      title: 'Admin password',
      input: 'password',
      inputPlaceholder: 'Password',
      showCancelButton: true,
      confirmButtonText: 'Trigger refresh',
    });
    if (!password) return;

    try {
      const res = await fetch('/api/trigger-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      Swal.fire({ icon: 'success', title: 'Refresh triggered', text: data.message });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Could not trigger refresh', text: err.message });
    }
  };

  return (
    <div className="home-page">
      <AnimatePresence>
        {showIntro && (
          <motion.div
            className="home-intro"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="home-intro-title"
              initial={{ scale: 2.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.4, ease: 'easeOut' }}
            >
              SMASH!
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Separate from .home-intro's own fade so this can morph into the
          nav's home button (same layoutId) instead of just fading in place. */}
      <AnimatePresence>
        {showIntro && (
          <motion.img
            layoutId="home-intro-logo"
            src={logoHome}
            alt=""
            className="home-intro-logo"
            initial={{ scale: 0, rotate: -90, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, layout: { duration: 0.7, ease: 'easeInOut' } }}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: showIntro ? 1.9 : 0 }}
      >
        <div className="home-hero">
          <div className="eyebrow">GRAND SLAM MATCH ENGINE</div>
          <h1 className="main-title">Simulate the<br/>Slams in Seconds</h1>
          <p className="sub-title">
            Pick any two players, choose a surface, and run the matchup.<br/>
            Build full draws and crown a champion.
          </p>

          <div className="d-flex flex-wrap gap-3 hero-ctas">
            <Button as={Link} to="/us-open" className="cta-primary">
              Quick H2H
            </Button>
            <Button as={Link} to="/dream-brackets" className="cta-secondary">
              Build a Bracket
            </Button>
          </div>
        </div>

        <div className="surface-strip">
          {SURFACES.map(({ to, label, city, desc, className }) => (
            <Link key={to} to={to} className={`surface-tile ${className}`}>
              <div className="surface-tile-label">{label}</div>
              <div className="surface-tile-city">{city}</div>
              <div className="surface-tile-desc">{desc}</div>
              <div className="surface-tile-enter">ENTER →</div>
            </Link>
          ))}
        </div>

        <div className="home-footer">
          <span className="trust-signal">Powered by real ATP match data, not made-up numbers.</span>
          <button type="button" className="update-data-link" onClick={handleUpdateData}>
            Update Data
          </button>
          {refreshMeta && (
            <span className="refresh-meta">
              Data last refreshed {formatDate(refreshMeta.refreshedAt)}
              {refreshMeta.mostRecentMatchDate && ` · most recent match ${formatDate(refreshMeta.mostRecentMatchDate)}`}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
