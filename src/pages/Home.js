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

// Wilson 95% interval - same as the Track Record / Methodology headline, so
// the home stat rail shows the identical honest number.
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
  const [livePicks, setLivePicks] = useState([]);

  // Live-tournament surfacing: locked, not-yet-played predictions across BOTH
  // tours, so the landing board shows everything that's on right now.
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        const picks = (d.predictions || [])
          .filter((p) => p.status === 'pending')
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(0, 6);
        setLivePicks(picks);
      })
      .catch(() => setLivePicks([]));
  }, []);

  // Live proof stats from the graded track record - the credibility engine
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
  // back to Home later in the session (see introHasPlayed above). Skipped
  // entirely for visitors who prefer reduced motion.
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [showIntro, setShowIntro] = useState(!introHasPlayed && !prefersReducedMotion);

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
        className="home-shell"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: showIntro ? 1.9 : 0 }}
      >
        {/* ── Hero: one centered column, everything on the same axis ───── */}
        <header className="home-hero">
          <div className="eyebrow">GRAND SLAM PREDICTION ENGINE{isWta ? ' · WTA' : ' · ATP'}</div>
          <h1 className="main-title">Simulate the Slams<br />in Seconds</h1>
          <p className="sub-title">
            Pick two players, choose a surface, and run a real point-by-point
            Monte Carlo matchup - the same model we grade in public, match after match.
          </p>
          <div className="hero-ctas">
            <Button as={Link} to={withTourPrefix('/h2h', isWta)} className="cta-primary">
              Simulate a Match
            </Button>
            <Button as={Link} to={withTourPrefix('/dream-brackets', isWta)} className="cta-secondary">
              Build a Bracket
            </Button>
          </div>
        </header>

        {/* ── Stat rail: the proof, one click from its receipts ────────── */}
        {proof && proof.n > 0 && (
          <Link to={withTourPrefix('/track-record', isWta)} className="home-stats">
            <div className="home-stat">
              <span className="home-stat-val">{proof.acc}%<span className="home-stat-ci"> ±{proof.ciHalf}</span></span>
              <span className="home-stat-cap">winners called correctly</span>
            </div>
            <div className="home-stat">
              <span className="home-stat-val">{proof.n.toLocaleString()}</span>
              <span className="home-stat-cap">matches graded in public</span>
            </div>
            {proof.marketAcc != null && (
              <div className="home-stat">
                <span className="home-stat-val">{proof.smashOnOdds}%<span className="home-stat-vs"> vs {proof.marketAcc}%</span></span>
                <span className="home-stat-cap">us vs the betting market</span>
              </div>
            )}
            <div className="home-stat home-stat-link">
              <span aria-hidden="true">→</span>
              <span className="home-stat-cap">see the full record</span>
            </div>
          </Link>
        )}

        {/* ── Live board: what's on the tour right now ─────────────────── */}
        {livePicks.length > 0 && (
          <section className="home-board">
            <div className="home-section-head">
              <span className="home-live-dot" />
              <h2 className="home-section-title">Happening Now</h2>
              <span className="home-section-sub">{livePicks[0].event}</span>
            </div>
            <div className="home-board-grid">
              {livePicks.map((p) => (
                <Link
                  key={p.id}
                  to={`${p.tour === 'wta' ? '/women' : ''}/h2h?surface=${p.surface}&a=${p.p1}&b=${p.p2}`}
                  className="home-board-card"
                >
                  <div className="home-board-top">
                    <span className="home-board-tour">{p.tour === 'wta' ? 'WTA' : 'ATP'}</span>
                    <span className={`home-board-surface s-${p.surface}`}>{p.surface}</span>
                  </div>
                  <div className="home-board-players">
                    <span className={`home-board-player${p.favorite === p.p1 ? ' fav' : ''}`}>{p.name1}</span>
                    <span className={`home-board-player${p.favorite === p.p2 ? ' fav' : ''}`}>{p.name2}</span>
                  </div>
                  <div className="home-board-call">
                    <span className="home-board-pct">{Math.round(p.favProb * 100)}%</span>
                    <span className="home-board-callsub">model backs {p.favName.split(' ').pop()}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Destinations: replaces the old Paris/London/NY tiles ─────── */}
        <section className="home-nav">
          <div className="home-section-head">
            <h2 className="home-section-title">Explore</h2>
          </div>
          <div className="home-nav-grid">
            <Link to={withTourPrefix('/h2h', isWta)} className="home-nav-card">
              <div className="home-nav-num">01</div>
              <div className="home-nav-name">Head to Head</div>
              <p className="home-nav-desc">Any two players, any surface. Full point-by-point simulation with win probability, score lines, and momentum.</p>
              <span className="home-nav-go">Open the studio →</span>
            </Link>
            <Link to={withTourPrefix('/dream-brackets', isWta)} className="home-nav-card">
              <div className="home-nav-num">02</div>
              <div className="home-nav-name">Dream Brackets</div>
              <p className="home-nav-desc">Seed your own fantasy slam and let the engine play out every round to a champion.</p>
              <span className="home-nav-go">Build yours →</span>
            </Link>
            <Link to={withTourPrefix('/track-record', isWta)} className="home-nav-card">
              <div className="home-nav-num">03</div>
              <div className="home-nav-name">Track Record</div>
              <p className="home-nav-desc">Every prediction locked before the match and graded after it. No cherry-picking, no memory-holing.</p>
              <span className="home-nav-go">Check the receipts →</span>
            </Link>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="home-footer">
          <span className="trust-signal">
            Real ATP &amp; WTA match data · calibrated probabilities · <Link to="/methodology" className="trust-method-link">how it works</Link>
          </span>
          {refreshMeta && (
            <span className="refresh-meta">
              Data last refreshed {formatDate(refreshMeta.refreshedAt)}
              {refreshMeta.mostRecentMatchDate && ` · most recent match ${formatDate(refreshMeta.mostRecentMatchDate)}`}
            </span>
          )}
          <button type="button" className="update-data-link" onClick={handleUpdateData}>
            Update Data
          </button>
        </footer>
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
