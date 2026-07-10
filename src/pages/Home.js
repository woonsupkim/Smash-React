// src/pages/Home.js

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Form } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '../components/ui/Toast';
import AppModal from '../components/ui/AppModal';
import logoHome from '../assets/ball.png';
import { playSwoosh, playSmack, playServeWhoosh } from '../utils/introSounds';
import './Home.css';

const SURFACES = [
  { to: '/h2h?surface=clay',  label: 'Clay',  city: 'Paris',    desc: 'Slow, high bounce. Grinders thrive.', className: 'surface-clay' },
  { to: '/h2h?surface=grass', label: 'Grass', city: 'London',   desc: 'Fast, low skid. Big servers fly.', className: 'surface-grass' },
  { to: '/h2h?surface=hard',  label: 'Hard',  city: 'New York', desc: 'Balanced, true bounce. All-courters.', className: 'surface-hard' },
];

// /women/* mirrors every men's route 1:1 (see App.js) - prefixing here keeps
// this one Home component shared between both tours instead of forking it.
const withTourPrefix = (path, isWta) => (isWta ? `/women${path}` : path);

// Module-level flag: the ball-drop intro (and its sounds) plays once per
// full page load. It survives SPA navigation (so returning to Home from
// another page does NOT replay it) but resets on a real browser refresh.
let introHasPlayed = false;

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Wilson 95% interval — same as the Track Record / Methodology headline, so
// the home proof band shows the identical honest number.
function wilsonHalf(k, n) {
  if (!n) return 0;
  const z = 1.96, p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return Math.round(half * 100);
}

export default function Home({ tour = 'atp' }) {
  const isWta = tour === 'wta';
  const dataDir = isWta ? '/data/women' : '/data';
  const [refreshMeta, setRefreshMeta] = useState(null);
  const [proof, setProof] = useState(null);

  // Live proof stats from the graded track record — the credibility engine
  // that separates this from a "form with a number".
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => {
        const ms = d.matches || [];
        const n = ms.length;
        const k = ms.filter((m) => m.smashCorrect).length;
        const odds = ms.filter((m) => m.oddCorrect != null);
        setProof({
          n,
          acc: n ? Math.round((k / n) * 100) : 0,
          ciHalf: wilsonHalf(k, n),
          smashOnOdds: odds.length ? Math.round((odds.filter((m) => m.smashCorrect).length / odds.length) * 100) : null,
          marketAcc: odds.length ? Math.round((odds.filter((m) => m.oddCorrect).length / odds.length) * 100) : null,
        });
      })
      .catch(() => setProof(null));
  }, []);
  // Only on the very first Home mount of a page load - not when navigating
  // back to Home later in the session (see introHasPlayed above).
  const [showIntro, setShowIntro] = useState(!introHasPlayed);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + dataDir + '/refresh-meta.json')
      .then(r => r.json())
      .then(setRefreshMeta)
      .catch(() => setRefreshMeta(null));
  }, [dataDir]);

  useEffect(() => {
    if (!showIntro) return;
    introHasPlayed = true; // don't replay on subsequent Home mounts this session
    // Air-cutting swoosh as the ball spins in; hold on the fully-revealed
    // logo+title for a beat, then the logo morphs into the nav's home button
    // (0.7s layout animation) - an airy serve-flight whoosh covers the
    // travel, capped by the smack when it hits the top corner.
    const entryTid = setTimeout(playSwoosh, 100);
    const tid = setTimeout(() => setShowIntro(false), 2200);
    const travelSwooshTid = setTimeout(playServeWhoosh, 2200);
    const smackTid = setTimeout(playSmack, 2200 + 650);
    return () => { clearTimeout(tid); clearTimeout(entryTid); clearTimeout(travelSwooshTid); clearTimeout(smackTid); };
  }, [showIntro]);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  const handleUpdateData = () => {
    setAdminPassword('');
    setAdminModalOpen(true);
  };

  const confirmUpdateData = async () => {
    if (!adminPassword) return;
    setAdminModalOpen(false);
    try {
      const res = await fetch('/api/trigger-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      toast({ type: 'success', title: 'Refresh triggered', message: data.message });
    } catch (err) {
      toast({ type: 'error', title: 'Could not trigger refresh', message: err.message });
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
          />
        )}
      </AnimatePresence>

      {/* Logo and title each live in their own plain (non-animated) fixed
          row so they share one exact horizontal centerline and a fixed gap
          - the motion components inside only animate scale/rotate/opacity,
          never position, so nothing fights the row's own centering. The
          logo is kept out of .home-intro's own fade (above) so it can morph
          into the nav's home button (same layoutId) instead of fading. */}
      <AnimatePresence>
        {showIntro && (
          <>
            <div className="home-intro-logo-row">
              <motion.img
                layoutId="home-intro-logo"
                src={logoHome}
                alt=""
                className="home-intro-logo"
                initial={{ scale: 0, rotate: -90, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 14, layout: { duration: 0.7, ease: 'easeInOut' } }}
              />
            </div>
            <div className="home-intro-title-row">
              <motion.div
                className="home-intro-title"
                initial={{ scale: 2.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 0.35, duration: 0.4, ease: 'easeOut' }}
              >
                SMASH!
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: showIntro ? 1.9 : 0 }}
      >
        <div className="home-hero">
          <div className="eyebrow">GRAND SLAM PREDICTION ENGINE{isWta ? ' · WTA' : ''}</div>
          <h1 className="main-title">Simulate the<br/>Slams in Seconds</h1>
          <p className="sub-title">
            Pick two players, choose a surface, and run a real point-by-point
            Monte Carlo matchup — the same model we grade in public, match after match.
          </p>

          <div className="d-flex flex-wrap gap-3 hero-ctas">
            <Button as={Link} to={withTourPrefix('/h2h', isWta)} className="cta-primary">
              Quick H2H
            </Button>
            <Button as={Link} to={withTourPrefix('/dream-brackets', isWta)} className="cta-secondary">
              Build a Bracket
            </Button>
          </div>

          {/* Proof band: the moat, front and center. Links straight to the
              graded record so the headline number is one click from its receipts. */}
          {proof && proof.n > 0 && (
            <Link to={withTourPrefix('/track-record', isWta)} className="home-proof">
              <div className="home-proof-stats">
                <div className="home-proof-item">
                  <span className="hp-val">{proof.acc}%<span className="hp-ci"> ±{proof.ciHalf}</span></span>
                  <span className="hp-cap">winners called correctly</span>
                </div>
                <div className="home-proof-item">
                  <span className="hp-val">{proof.n.toLocaleString()}</span>
                  <span className="hp-cap">matches graded in public</span>
                </div>
                {proof.marketAcc != null && (
                  <div className="home-proof-item">
                    <span className="hp-val">{proof.smashOnOdds}<small>%</small> <span className="hp-vs">vs {proof.marketAcc}%</span></span>
                    <span className="hp-cap">us vs the betting market</span>
                  </div>
                )}
              </div>
              <span className="home-proof-cta">See the track record →</span>
            </Link>
          )}
        </div>

        <div className="surface-strip">
          {SURFACES.map(({ to, label, city, desc, className }) => (
            <Link key={to} to={withTourPrefix(to, isWta)} className={`surface-tile ${className}`}>
              <div className="surface-tile-label">{label}</div>
              <div className="surface-tile-city">{city}</div>
              <div className="surface-tile-desc">{desc}</div>
              <div className="surface-tile-enter">ENTER →</div>
            </Link>
          ))}
        </div>

        <div className="home-footer">
          <span className="trust-signal">
            Real ATP &amp; WTA match data · calibrated probabilities · <Link to="/methodology" className="trust-method-link">how it works</Link>
          </span>
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

      <AppModal
        show={adminModalOpen}
        onHide={() => setAdminModalOpen(false)}
        title="Admin: refresh data"
        confirmText="Trigger refresh"
        onConfirm={confirmUpdateData}
        confirmDisabled={!adminPassword}
      >
        <Form.Group>
          <Form.Label>Admin password</Form.Label>
          <Form.Control
            type="password"
            value={adminPassword}
            onChange={e => setAdminPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmUpdateData(); }}
            placeholder="Password"
            autoFocus
          />
        </Form.Group>
      </AppModal>
    </div>
  );
}
