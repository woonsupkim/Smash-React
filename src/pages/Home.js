// src/pages/Home.js

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import logoHome from '../assets/ball.png';
import './Home.css';

// /women/* mirrors every men's route 1:1 (see App.js) - prefixing here keeps
// this one Home component shared between both tours instead of forking it.
const withTourPrefix = (path, isWta) => (isWta ? `/women${path}` : path);

// The ball-drop intro plays once per browser (persisted), silently - a
// returning visitor gets straight to content. localStorage can throw in
// private browsing; treat any failure as "already seen".
const INTRO_SEEN_KEY = 'smash_intro_seen';
function introAlreadySeen() {
  try { return localStorage.getItem(INTRO_SEEN_KEY) === '1'; } catch { return true; }
}
function markIntroSeen() {
  try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* private browsing */ }
}

// Approximate grand slam start windows - used only for the empty-state copy
// ("next slam: ..."), so rough month/day boundaries are fine year over year.
function nextSlam(now = new Date()) {
  const y = now.getFullYear();
  const slams = [
    { name: 'Australian Open', start: new Date(y, 0, 12) },
    { name: 'French Open', start: new Date(y, 4, 24) },
    { name: 'Wimbledon', start: new Date(y, 5, 29) },
    { name: 'US Open', start: new Date(y, 7, 24) },
    { name: 'Australian Open', start: new Date(y + 1, 0, 12) },
  ];
  const next = slams.find((s) => s.start > now);
  return `${next.name} · ${next.start.toLocaleDateString('en-US', { month: 'long' })}`;
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
  // 'loading' | 'ready' | 'error' - drives skeleton vs content vs quiet omission
  const [proof, setProof] = useState({ state: 'loading' });
  const [picks, setPicks] = useState({ state: 'loading', list: [] });

  // Live-tournament surfacing: locked, not-yet-played predictions across BOTH
  // tours, so the landing board shows everything that's on right now.
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => {
        const list = (d.predictions || [])
          .filter((p) => p.status === 'pending')
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(0, 6);
        setPicks({ state: 'ready', list });
      })
      .catch(() => setPicks({ state: 'error', list: [] }));
  }, []);

  // Live proof stats from the graded track record - the credibility engine
  // that separates this from a "form with a number".
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => {
        const ms = d.matches || [];
        const n = ms.length;
        const k = ms.filter((m) => m.smashCorrect).length;
        const odds = ms.filter((m) => m.oddCorrect != null);
        setProof({
          state: 'ready',
          n,
          acc: n ? Math.round((k / n) * 100) : 0,
          ciHalf: wilsonHalf(k, n),
          smashOnOdds: odds.length ? Math.round((odds.filter((m) => m.smashCorrect).length / odds.length) * 100) : null,
          marketAcc: odds.length ? Math.round((odds.filter((m) => m.oddCorrect).length / odds.length) * 100) : null,
        });
      })
      .catch(() => setProof({ state: 'error' }));
  }, []);

  // Intro: first visit in this browser only, and never for reduced-motion
  // visitors. Silent by design - no audio without a user gesture.
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [showIntro, setShowIntro] = useState(() => !introAlreadySeen() && !prefersReducedMotion);

  useEffect(() => {
    if (!showIntro) return;
    markIntroSeen();
    // Hold on the revealed logo+title for a beat, then the logo morphs into
    // the nav's home button (0.7s layout animation via the shared layoutId).
    const tid = setTimeout(() => setShowIntro(false), 1600);
    return () => clearTimeout(tid);
  }, [showIntro]);

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
                transition={{ delay: 0.25, duration: 0.35, ease: 'easeOut' }}
              >
                SMASH
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <motion.div
        className="home-shell"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: showIntro ? 1.3 : 0 }}
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

        {/* ── Stat rail: the proof, one click from its receipts ──────────
            Skeleton while loading; quietly omitted on fetch failure (the
            Track Record card below still gets you there). */}
        {proof.state === 'loading' && <div className="skeleton home-stats-skel" aria-hidden="true" />}
        {proof.state === 'ready' && proof.n > 0 && (
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
                <span className="home-stat-cap">model vs betting market</span>
              </div>
            )}
            <div className="home-stat home-stat-link">
              <span aria-hidden="true">→</span>
              <span className="home-stat-cap">full record</span>
            </div>
          </Link>
        )}

        {/* ── Live board: what's on the tour right now ─────────────────── */}
        <section className="home-board">
          <div className="home-section-head">
            {picks.list.length > 0 && <span className="home-live-dot" />}
            <h2 className="home-section-title">{picks.list.length > 0 ? 'Happening Now' : 'Tournament Watch'}</h2>
            {picks.list.length > 0 && <span className="home-section-sub">{picks.list[0].event}</span>}
          </div>
          {picks.state === 'loading' && (
            <div className="home-board-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton home-board-skel" />)}
            </div>
          )}
          {picks.state !== 'loading' && picks.list.length === 0 && (
            <div className="home-board-empty">
              <span className="home-board-empty-title">No live predictions right now.</span>
              <span className="home-board-empty-sub">
                Predictions are locked when a grand slam draw is released.
                Next up: {nextSlam()}.
              </span>
            </div>
          )}
          {picks.list.length > 0 && (
            <div className="home-board-grid">
              {picks.list.map((p) => (
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
          )}
        </section>

        {/* ── Destinations ─────────────────────────────────────────────── */}
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
              <p className="home-nav-desc">Every prediction locked before the match and graded after it. Nothing edited, nothing removed.</p>
              <span className="home-nav-go">View the record →</span>
            </Link>
          </div>
        </section>
      </motion.div>
    </div>
  );
}
