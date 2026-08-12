// src/pages/Home.js

import React, { useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import logoHome from '../assets/ball.png';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, matchSlug } from '../utils/matchTime';
import { pickCorrect, pickFavorite } from '../utils/deployedPick';
import { edgePerDollar, parlayCombo } from '../utils/staking';
import './Home.css';

// Recent-form window for the forward record, matching the guardrail board's
// own window so the two never disagree about what "lately" means.
const RECENT_WINDOW = 40;

// Tiny inline sparkline for a player's title-odds history.
function Sparkline({ values }) {
  if (!values || values.length < 2) return <span className="home-odds-spark" aria-hidden="true" />;
  const w = 64, h = 22, pad = 2;
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values);
  const span = Math.max(max - min, 0.005);
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="home-odds-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent-brand)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

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

// Grand slam calendar rules (mirrors data-pipeline/lib/slamCalendar.js):
// AO = 3rd Monday of January, RG = last Sunday of May, Wimbledon = last
// Monday of June, US Open = last Monday of August. Good to within a day or
// two, which is all a countdown needs.
// UTC like the pipeline's slamCalendar, so the countdown can't drift a day
// from the rest of the app for viewers west of UTC.
function nthMonday(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1));
  const offset = (8 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}
function lastWeekday(year, month, weekday) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  const back = (d.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, d.getUTCDate() - back));
}
const slamsIn = (y) => [
  { name: 'Australian Open', surface: 'hard', start: nthMonday(y, 0, 3) },
  { name: 'French Open', surface: 'clay', start: lastWeekday(y, 4, 0) },
  { name: 'Wimbledon', surface: 'grass', start: lastWeekday(y, 5, 1) },
  { name: 'US Open', surface: 'hard', start: lastWeekday(y, 7, 1) },
];
function nextSlam(now = new Date()) {
  const all = [...slamsIn(now.getFullYear()), ...slamsIn(now.getFullYear() + 1)];
  return all.find((s) => s.start > now);
}
// The most recent slam already underway or finished. Slams start on a
// Monday and the final lands on the second Sunday (start + 13 days), so
// "ended" = the Monday after (start + 14 days). Everything dated from that
// Monday on is "between the slams": the summer/spring swings the weekly
// refresh feeds in.
function prevSlam(now = new Date()) {
  const all = [...slamsIn(now.getFullYear() - 1), ...slamsIn(now.getFullYear())];
  const past = all.filter((s) => s.start <= now);
  const last = past[past.length - 1];
  if (!last) return null;
  return { ...last, end: new Date(last.start.getTime() + 14 * 864e5) };
}

// Wilson 95% interval - same as the Track Record / Methodology headline, so
// the home stat rail shows the identical honest number.
function wilsonHalf(k, n) {
  if (!n) return 0;
  const z = 1.96, p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return Math.round(half * 100);
}

// One home page for both tours: the board, stat rail, scorecard, and title
// odds all cover ATP and WTA together, and the deep pages (H2H, Brackets)
// carry their own tour switchers.
export default function Home() {
  // 'loading' | 'ready' | 'error' - drives skeleton vs content vs quiet omission
  const [proof, setProof] = useState({ state: 'loading' });
  const [picks, setPicks] = useState({ state: 'loading', list: [] });

  // Live-tournament surfacing: locked, not-yet-played predictions across BOTH
  // tours, so the landing board shows everything that's on right now.
  // Forward-test record (locked before play, graded after): once it has
  // enough verified calls it takes over the stat rail's lead number, same
  // switch the Track Record hero makes.
  const [forward, setForward] = useState(null);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => {
        const all = d.predictions || [];
        // Order by what a visitor means by "now": the next matches to be
        // played, soonest first. Scheduled times are often midnight
        // placeholders that drift, so today counts as upcoming - but a pick
        // whose day has PASSED and still has no result is only awaiting a
        // scoreline, and must never lead a board with a live dot on it.
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const pending = all.filter((p) => p.status === 'pending');
        const upcoming = pending
          .filter((p) => new Date(p.date) >= startOfToday)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        const awaiting = pending
          .filter((p) => new Date(p.date) < startOfToday)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        const list = [...upcoming, ...awaiting].slice(0, 6);
        setPicks({ state: 'ready', list, live: upcoming.length > 0 });
        // "Decided" means GRADED, not merely "not pending". A void is a call
        // that never resolved (walkover, retirement, an orphaned fixture the
        // pipeline retired), and p.correct is false on all of them - counting
        // those as misses understated the forward record by five points. Same
        // rule the Track Record page and the share cards already use.
        const decided = all
          .filter((p) => p.status === 'won' || p.status === 'lost')
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        const correct = decided.filter((p) => p.correct).length;
        const recent = decided.slice(-RECENT_WINDOW);
        const recentCorrect = recent.filter((p) => p.correct).length;
        setForward({
          n: decided.length,
          correct,
          acc: decided.length ? Math.round((correct / decided.length) * 100) : 0,
          recentN: recent.length,
          recentAcc: recent.length >= 20 ? Math.round((recentCorrect / recent.length) * 100) : null,
        });
      })
      .catch(() => setPicks({ state: 'error', list: [] }));
  }, []);

  // Championship odds (the live slam's draw, simulated to completion) and
  // the daily scorecard (yesterday's graded calls + upset watch). Both are
  // regenerated by the pipeline after every data refresh.
  const [titleOdds, setTitleOdds] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/title_odds.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => setTitleOdds(d.events || null))
      .catch(() => setTitleOdds(null));
    fetch(process.env.PUBLIC_URL + '/data/daily_scorecard.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then(setScorecard)
      .catch(() => setScorecard(null));
  }, []);

  // Guardrail board: one status per tour x surface, plus any open alerts.
  // Summarised here so the front door can say the engines are being policed
  // without making anyone open the model card to find that out.
  const [health, setHealth] = useState(null);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/guardrails.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const upsetById = useMemo(
    () => new Map((scorecard?.upsetWatch || []).map((u) => [u.id, u])),
    [scorecard]
  );

  // Today's slip: the same edge math the Parlay builder runs, previewed next
  // to the live board so the staking tools are visible from the front door
  // instead of two clicks down. Only picks that carried a market price can be
  // graded for edge, so unpriced calls sit this section out.
  const slip = useMemo(() => {
    const oddsOf = (p) => Number(p.favorite === p.p1 ? p.lockOdd1 : p.lockOdd2);
    const priced = (picks.list || []).filter((p) => oddsOf(p) > 1 && p.favProb > 0);
    if (priced.length < 2) return null;
    const bets = priced.map((p) => ({ key: p.id, p: p.favProb, o: oddsOf(p) }));
    const plus = bets.filter((b) => edgePerDollar(b.p, b.o) > 0);
    const combo = parlayCombo(bets, plus.map((b) => b.key));
    const best = bets.reduce((m, b) => (edgePerDollar(b.p, b.o) > edgePerDollar(m.p, m.o) ? b : m), bets[0]);
    const bestPick = priced.find((p) => p.id === best.key);
    return {
      n: priced.length,
      plus: plus.length,
      combo: combo.priced ? combo : null,
      bestEdge: edgePerDollar(best.p, best.o),
      bestName: bestPick ? lastName(bestPick.favName) : null,
    };
  }, [picks.list]);

  // Live proof stats from the graded track record - the credibility engine
  // that separates this from a "form with a number".
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => {
        const ms = d.matches || [];
        const n = ms.length;
        const k = ms.filter((m) => pickCorrect(m)).length;
        const odds = ms.filter((m) => m.oddCorrect != null);
        // "Between the slams": everything graded since the last slam ended -
        // the proof strip for the quiet weeks (fed by the weekly refresh).
        const prev = prevSlam();
        const between = prev ? ms.filter((m) => new Date(m.date) >= prev.end) : [];
        const bCorrect = between.filter((m) => pickCorrect(m)).length;
        // The Edge, in one line: only the matches where our pick and the
        // bookmakers' favorite were DIFFERENT people. Agreeing with the
        // market proves nothing, so the splits are the only honest test of
        // whether the model adds anything - and the flat-stake payout is
        // what that difference is worth. Same math as EdgeBoard; keep in
        // step. (Not betting advice: it settles at closing odds, after the
        // fact, and it is on the record either way.)
        const splits = odds.filter((m) => m.oddFav && pickFavorite(m) !== m.oddFav && m.od1 > 1 && m.od2 > 1);
        let usReturn = 0, mktReturn = 0;
        for (const m of splits) {
          if (pickCorrect(m)) usReturn += pickFavorite(m) === m.p1 ? m.od1 : m.od2;
          if (m.oddCorrect) mktReturn += m.oddFav === m.p1 ? m.od1 : m.od2;
        }
        setProof({
          state: 'ready',
          n,
          acc: n ? Math.round((k / n) * 100) : 0,
          ciHalf: wilsonHalf(k, n),
          smashOnOdds: odds.length ? Math.round((odds.filter((m) => pickCorrect(m)).length / odds.length) * 100) : null,
          marketAcc: odds.length ? Math.round((odds.filter((m) => m.oddCorrect).length / odds.length) * 100) : null,
          edge: splits.length >= 40 ? {
            n: splits.length,
            usAcc: Math.round((splits.filter((m) => pickCorrect(m)).length / splits.length) * 100),
            mktAcc: Math.round((splits.filter((m) => m.oddCorrect).length / splits.length) * 100),
            usNet: Math.round(usReturn - splits.length),
            mktNet: Math.round(mktReturn - splits.length),
          } : null,
          between: between.length >= 5 ? {
            n: between.length,
            correct: bCorrect,
            acc: Math.round((bCorrect / between.length) * 100),
            since: prev.name,
          } : null,
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

  // Title odds, hoisted out of the JSX so the page order below stays readable.
  // It sits under the live board now: what is on court today matters more to a
  // first-time visitor than a field projected weeks out.
  const titleOddsSection = (titleOdds?.atp || titleOdds?.wta) ? (() => {
    // Heading/footer copy: the tours can briefly be in mixed states (one
    // final, one projecting the next slam), so lead with the most "alive"
    // status either tour is in.
    const entries = [titleOdds.atp, titleOdds.wta].filter(Boolean);
    const headStatus = ['live', 'projection', 'final'].find((s) => entries.some((e) => e.status === s));
    const headEntry = entries.find((e) => e.status === headStatus) || entries[0];
    return (
      <section className="home-odds">
        <div className="home-section-head">
          <h2 className="home-section-title">
            {headStatus === 'projection' ? `Road to the ${headEntry.event}` : 'Title Odds'}
          </h2>
          <span className="home-section-sub">
            {headStatus === 'projection'
              ? 'projected from current rankings · each player\'s chance to win it all'
              : `${headEntry.event} · each player's chance to win it all`}
          </span>
        </div>
        <div className="home-odds-tours">
          {['atp', 'wta'].map((t) => {
            const o = titleOdds[t];
            if (!o) return null;
            const prevSnap = o.history?.length > 1 ? o.history[o.history.length - 2].odds : null;
            return (
              <div className="home-odds-tour" key={t}>
                <div className="home-odds-tour-label">{t === 'wta' ? 'WTA' : 'ATP'}</div>
                {o.status === 'final' && o.champion ? (
                  <div className="home-odds-champion">
                    {o.champion.id && (
                      <img className="home-odds-champ-photo" src={playerPhoto(t, o.champion.id)} alt="" />
                    )}
                    <span className="home-odds-trophy" aria-hidden="true">🏆</span>
                    <span>
                      {o.champion.id
                        ? <Link className="home-odds-champ-link" to={`/player/${t}/${o.champion.id}`}><strong>{o.champion.name}</strong></Link>
                        : <strong>{o.champion.name}</strong>}
                      {' '}is the {o.event} champion.
                    </span>
                  </div>
                ) : (
                  <div className="home-odds-list">
                    {(o.odds || []).slice(0, 6).map((p, i) => {
                      const pct = Math.round(p.prob * 100);
                      const prev = prevSnap?.[p.name];
                      const delta = prev != null ? Math.round((p.prob - prev) * 100) : null;
                      const series = (o.history || []).map((hh) => hh.odds?.[p.name]).filter((v) => v != null);
                      return (
                        <div className="home-odds-row" key={p.name}>
                          <span className="home-odds-rank">{i + 1}</span>
                          {p.id ? (
                            <Link className="home-odds-name linked" to={`/player/${t}/${p.id}`}>
                              <img className="home-odds-photo" src={playerPhoto(t, p.id)} alt="" loading="lazy" />
                              {p.name}
                            </Link>
                          ) : (
                            <span className="home-odds-name">{p.name}</span>
                          )}
                          <div className="home-odds-track">
                            <div className="home-odds-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
                          </div>
                          <Sparkline values={series} />
                          <span className="home-odds-pct">{pct < 1 ? '<1' : pct}%</span>
                          <span className={`home-odds-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
                            {delta ? (delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`) : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="home-odds-note">
          {headStatus === 'live'
            ? "The remaining draw, played out 2,000 times before each day's play. Arrows show movement since yesterday."
            : headStatus === 'projection'
              ? <>A hypothetical seeded field from today's rankings, simulated 2,000 times. It re-prices with every refresh until the real draw drops. <Link to="/draw">See the full projected draw</Link>.</>
              : <>The champions are crowned. The road to the next slam appears here as rankings move. <Link to="/draw">Revisit the final bracket</Link>.</>}
        </div>
      </section>
    );
  })() : null;

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
          <div className="eyebrow">MODEL VS MARKET · ATP + WTA</div>
          <h1 className="main-title">We Beat the<br />Bookmakers</h1>
          <p className="sub-title">
            Every ATP and WTA match gets a call locked before play and graded in
            public after, wins and misses alike. When we split from the betting
            favorite, our pick lands more often than theirs
            {proof.state === 'ready' && proof.edge ? ` (${proof.edge.usAcc}% against their ${proof.edge.mktAcc}%)` : ''}.
            Today's card is live below, priced and ready to stack.
          </p>
          <div className="hero-ctas">
            <Button as={Link} to="/today" className="cta-primary">
              See today's calls
            </Button>
            <Button as={Link} to="/h2h" className="cta-secondary">
              Run any matchup
            </Button>
          </div>
        </header>

        {/* ── Stat rail: the proof, one click from its receipts ──────────
            Skeleton while loading; quietly omitted on fetch failure (the
            Track Record card below still gets you there). */}
        {proof.state === 'loading' && <div className="skeleton home-stats-skel" aria-hidden="true" />}
        {proof.state === 'ready' && proof.n > 0 && (
          <Link to="/track-record" className="home-stats">
            {[
              // 1. The thesis, when we have prices to compare against.
              proof.marketAcc != null && {
                key: 'mkt',
                val: <>{proof.smashOnOdds}%<span className="home-stat-vs"> vs {proof.marketAcc}%</span></>,
                cap: 'us vs the bookmakers',
              },
              // 2. Locked before play is the number that has moved most, so it
              //    carries its own recent form instead of a bare season figure.
              forward && forward.n >= 25 && {
                key: 'fwd',
                val: (
                  <>
                    {forward.acc}%
                    {forward.recentAcc != null && forward.recentAcc > forward.acc && (
                      <span className="home-stat-trend"> ▲{forward.recentAcc}% last {forward.recentN}</span>
                    )}
                  </>
                ),
                cap: `called before play · ${forward.n.toLocaleString()} verified`,
              },
              // 3. Season benchmark, only where it isn't already implied above.
              proof.marketAcc == null && {
                key: 'season',
                val: <>{proof.acc}%<span className="home-stat-ci"> ±{proof.ciHalf}</span></>,
                cap: 'winners called · season',
              },
              { key: 'n', val: proof.n.toLocaleString(), cap: 'matches graded in public' },
            ].filter(Boolean).map((s) => (
              <div className="home-stat" key={s.key}>
                <span className="home-stat-val">{s.val}</span>
                <span className="home-stat-cap">{s.cap}</span>
              </div>
            ))}
            <div className="home-stat home-stat-link">
              <span aria-hidden="true">→</span>
              <span className="home-stat-cap">full record</span>
            </div>
          </Link>
        )}

        {/* ── The Edge, directly under the numbers it explains ───────────
            The stat rail claims we beat the bookmakers; this is the working.
            Only the matches where our pick and the bookmakers' favorite were
            different people, because agreeing with the market proves nothing. */}
        {proof.state === 'ready' && proof.edge && (
          <section className="home-edge">
            <div className="home-section-head">
              <h2 className="home-section-title">When we disagree with the bookmakers</h2>
              <span className="home-section-sub">{proof.edge.n} graded splits this season</span>
            </div>
            <Link to="/edge" className="home-edge-card">
              <div className="home-edge-split">
                <div className="home-edge-side">
                  <span className="home-edge-val">{proof.edge.usAcc}%</span>
                  <span className="home-edge-cap">us</span>
                </div>
                <span className="home-edge-vs">vs</span>
                <div className="home-edge-side muted">
                  <span className="home-edge-val">{proof.edge.mktAcc}%</span>
                  <span className="home-edge-cap">the bookmakers</span>
                </div>
              </div>
              <div className="home-edge-body">
                <p className="home-edge-line">
                  Anyone can agree with the favorite. These are the {proof.edge.n} matches this season
                  where we named a different winner than the market did, and one of us had to be wrong.
                </p>
                <p className="home-edge-money">
                  Staking $1 on each: <strong className={proof.edge.usNet >= 0 ? 'pos' : 'neg'}>
                    {proof.edge.usNet >= 0 ? '+' : '-'}${Math.abs(proof.edge.usNet)}
                  </strong> backing our calls, <strong className={proof.edge.mktNet >= 0 ? 'pos' : 'neg'}>
                    {proof.edge.mktNet >= 0 ? '+' : '-'}${Math.abs(proof.edge.mktNet)}
                  </strong> backing theirs.
                </p>
                <span className="home-edge-note">Settled at closing odds, every split graded. Not betting advice.</span>
              </div>
              <span className="home-nav-go">See every split →</span>
            </Link>
          </section>
        )}

        {/* ── Live board: what's on the tour right now ─────────────────── */}
        <section className="home-board">
          <div className="home-section-head">
            {picks.live && <span className="home-live-dot" />}
            <h2 className="home-section-title">
              {picks.live ? 'Happening Now' : picks.list.length > 0 ? 'Awaiting Results' : 'Tournament Watch'}
            </h2>
            {picks.list.length > 0 && (
              <span className="home-section-sub">
                {new Set(picks.list.map((p) => p.event)).size === 1 ? picks.list[0].event : 'on tour this week'}
              </span>
            )}
            {scorecard?.yesterday?.n > 0 && (
              <Link to="/track-record" className="home-board-yday">
                Yesterday: {scorecard.yesterday.correct}/{scorecard.yesterday.n} ✓
              </Link>
            )}
          </div>
          {picks.state === 'loading' && (
            <div className="home-board-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton home-board-skel" />)}
            </div>
          )}
          {picks.state !== 'loading' && picks.list.length === 0 && (() => {
            // Off-season: the countdown, the season scoreboard, and where to
            // go while nothing is live - instead of a bare "come back later".
            const next = nextSlam();
            const days = next ? Math.max(1, Math.ceil((next.start - new Date()) / 864e5)) : null;
            const season = scorecard?.season;
            return (
              <div className="home-offseason">
                {next && (
                  <div className="home-off-count">
                    <span className="home-off-days">{days}</span>
                    <span className="home-off-days-cap">day{days === 1 ? '' : 's'} to the {next.name}</span>
                    <span className="home-off-date">
                      {next.start.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })} · {next.surface} court
                    </span>
                  </div>
                )}
                <div className="home-off-body">
                  {season?.n > 0 && (
                    <div className="home-off-season">
                      Season benchmark: <strong>{season.correct.toLocaleString()} of {season.n.toLocaleString()}</strong> winners
                      called ({season.acc}%), every match graded in public.
                    </div>
                  )}
                  <div className="home-off-sub">
                    Predictions return the moment the {next ? next.name : 'next big event'} draw drops,
                    and daily calls lock for the big combined events along the way.
                    Until then the projected field above re-prices with every refresh as rankings move.
                  </div>
                  <div className="home-off-links">
                    <Link to="/draw">Projected draw</Link>
                    <Link to="/h2h">Run any matchup</Link>
                    <Link to="/track-record">Season receipts</Link>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* Between-the-slams proof: the model keeps calling the summer and
              spring swings while the slams sleep. Shows once 5+ non-slam
              matches have graded since the last slam ended. */}
          {picks.state !== 'loading' && picks.list.length === 0 && proof.state === 'ready' && proof.between && (
            <Link to="/track-record" className="home-summer">
              <span className="home-summer-pct">{proof.between.acc}%</span>
              <span className="home-summer-body">
                <span className="home-summer-title">The model doesn't take summers off.</span>
                <span className="home-summer-sub">
                  {proof.between.correct} of {proof.between.n} winners called at the tour events
                  since {proof.between.since} ended, graded on the public record like everything else.
                </span>
              </span>
              <span className="home-summer-go" aria-hidden="true">→</span>
            </Link>
          )}
          {picks.list.length > 0 && (
          <div className={`home-board-wrap${slip ? ' has-slip' : ''}`}>
            <div className="home-board-grid">
              {picks.list.map((p) => {
                const when = timeUntil(p.date);
                return (
                  <Link key={`${p.tour}-${p.p1}-${p.p2}-${p.date}`} to={`/match/${matchSlug(p)}`} className="home-board-card">
                    <div className="home-board-top">
                      <span className="home-board-tour">{p.tour === 'wta' ? 'WTA' : 'ATP'}</span>
                      <span className={`home-board-surface s-${p.surface}`}>{p.surface}</span>
                      {p.tier && p.tier !== 'slam' && (
                        <span className="home-board-event">{p.event}</span>
                      )}
                      {when && (
                        <span className={`home-board-when${when.soon ? ' soon' : ''}${when.past ? ' past' : ''}`}>
                          {when.label}
                        </span>
                      )}
                    </div>
                    <div className="home-board-players">
                      <span className={`home-board-player${p.favorite === p.p1 ? ' fav' : ''}`}>
                        <img className="home-board-face" src={playerPhoto(p.tour, p.p1)} alt="" loading="lazy" />
                        {p.name1}
                      </span>
                      <span className={`home-board-player${p.favorite === p.p2 ? ' fav' : ''}`}>
                        <img className="home-board-face" src={playerPhoto(p.tour, p.p2)} alt="" loading="lazy" />
                        {p.name2}
                      </span>
                    </div>
                    <div className="home-board-call">
                      <span className="home-board-pct">{Math.round(p.favProb * 100)}%</span>
                      <span className="home-board-callsub">model backs {lastName(p.favName)}</span>
                    </div>
                    {upsetById.has(p.id) && (
                      <div className="home-board-upsetwatch">
                        <span className="home-board-upset-tag">🚨 Upset watch</span>
                        <span className="home-board-upset-reason">{upsetById.get(p.id).reason}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Today's slip: the Parlay builder's own edge math, previewed.
                It answers "is there anything worth backing today" before you
                commit a click, and hands off to the full staking plan. */}
            {slip && (
              <aside className="home-slip" aria-label="Today's slip">
                <div className="home-slip-cap">Today's slip</div>
                <div className="home-slip-hero">
                  <span className="home-slip-val">{slip.plus}</span>
                  <span className="home-slip-valcap">
                    of {slip.n} priced calls beat their price
                  </span>
                </div>
                {slip.bestName && slip.bestEdge > 0 && (
                  <div className="home-slip-row">
                    <span className="home-slip-row-k">Biggest edge</span>
                    <span className="home-slip-row-v pos">
                      +{Math.round(slip.bestEdge * 100)}% · {slip.bestName}
                    </span>
                  </div>
                )}
                {slip.combo && (
                  <div className="home-slip-row">
                    <span className="home-slip-row-k">All {slip.combo.n} together</span>
                    <span className="home-slip-row-v">
                      {Math.round(slip.combo.p * 100)}% at {slip.combo.o.toFixed(2)}
                    </span>
                  </div>
                )}
                <p className="home-slip-note">
                  {slip.plus > 0
                    ? 'Edge is our win probability times the price on offer, minus one. The builder sizes your stakes so the slip is break-even or better.'
                    : 'Nothing on today\'s card beats its price, so the honest answer is to stake nothing. The builder shows you why.'}
                </p>
                <Link to="/parlay" className="home-slip-cta">Build and size a slip →</Link>
              </aside>
            )}
          </div>
          )}
        </section>

        {/* ── Engine health: the guardrail board, summarised ─────────────
            Five engines compete per surface and only one gets deployed; this
            says whether each is still earning it, without making anyone open
            the model card to find out. */}
        {health?.cells?.length > 0 && (() => {
          const cells = health.cells;
          const passing = cells.filter((c) => c.status === 'ok').length;
          const alerts = (health.alerts || []).length;
          return (
            <section className="home-health">
              <div className="home-section-head">
                <h2 className="home-section-title">The engines, right now</h2>
                <span className="home-section-sub">
                  {passing === cells.length
                    ? `all ${cells.length} surfaces passing`
                    : `${cells.length - passing} of ${cells.length} under review`}
                </span>
              </div>
              <Link to="/model" className="home-health-card">
                <div className="home-health-grid">
                  {cells.map((c) => (
                    <div className={`home-health-cell ${c.status}`} key={c.label}>
                      <span className="home-health-top">
                        <span className="home-health-dot" aria-hidden="true" />
                        <span className="home-health-label">{c.label}</span>
                      </span>
                      <span className="home-health-acc">{c.recentAcc == null ? '--' : `${c.recentAcc}%`}</span>
                      <span className="home-health-sub">last {c.recentN}</span>
                    </div>
                  ))}
                </div>
                <p className="home-health-note">
                  Every surface runs five engines against each other and deploys the one earning the
                  job. A cell goes under review the moment its recent form slips behind its season
                  mark, and {alerts === 0 ? 'nothing is flagged today' : `${alerts} is flagged today`}.
                </p>
                <span className="home-nav-go">Look under the hood →</span>
              </Link>
            </section>
          );
        })()}

        {titleOddsSection}

        <section className="home-nav">
          <div className="home-section-head">
            <h2 className="home-section-title">Where to go next</h2>
            <span className="home-section-sub">start with the proof, then put the model to work</span>
          </div>
          <div className="home-nav-grid">
            <Link to="/edge" className="home-nav-card">
              <div className="home-nav-num">01</div>
              <div className="home-nav-name">The Edge</div>
              <p className="home-nav-desc">Where we disagree with the betting market, and who turned out to be right. Both sides graded, misses included.</p>
              <span className="home-nav-go">See the splits →</span>
            </Link>
            <Link to="/track-record" className="home-nav-card">
              <div className="home-nav-num">02</div>
              <div className="home-nav-name">The Ledger</div>
              <p className="home-nav-desc">Every call made before the match and scored after it. No take-backs, no quiet deletions.</p>
              <span className="home-nav-go">View the record →</span>
            </Link>
            <Link to="/h2h" className="home-nav-card">
              <div className="home-nav-num">03</div>
              <div className="home-nav-name">H2H Studio</div>
              <p className="home-nav-desc">Any two players, any surface. We compute the match point by point, every path it can take, and show you who wins, how often, and by what score.</p>
              <span className="home-nav-go">Open the studio →</span>
            </Link>
            <Link to="/draw" className="home-nav-card">
              <div className="home-nav-num">04</div>
              <div className="home-nav-name">The Draw</div>
              <p className="home-nav-desc">The whole bracket played out 2,000 times before each day's play, so you can see who the draw actually favors.</p>
              <span className="home-nav-go">Read the bracket →</span>
            </Link>
            <Link to="/dream-brackets" className="home-nav-card">
              <div className="home-nav-num">05</div>
              <div className="home-nav-name">Dream Brackets</div>
              <p className="home-nav-desc">Seed your own fantasy slam and let the engine play out every round to a champion.</p>
              <span className="home-nav-go">Build yours →</span>
            </Link>
            <Link to="/model" className="home-nav-card">
              <div className="home-nav-num">06</div>
              <div className="home-nav-name">The Engine Room</div>
              <p className="home-nav-desc">Five engines, one deployed per surface, and the health board that says when one stops earning the job.</p>
              <span className="home-nav-go">Look under the hood →</span>
            </Link>
          </div>
        </section>
      </motion.div>
    </div>
  );
}
