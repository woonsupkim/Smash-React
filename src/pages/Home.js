// src/pages/Home.js

import React, { useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import logoHome from '../assets/ball.png';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, localStartTime, matchSlug, isToday, stillUpcoming } from '../utils/matchTime';
import { pickCorrect, pickFavorite, pickNoCall, ledgerNoCall } from '../utils/deployedPick';
import { planFrontier, reliability } from '../utils/staking';
import { nextSlam, prevSlam } from '../utils/slamCalendar';
import DigestSignup from '../components/DigestSignup';
import './Home.css';

// Recent-form window for the forward record, matching the guardrail board's
// own window so the two never disagree about what "lately" means.
const RECENT_WINDOW = 40;
// Sample bankroll the suggested plan splits. A round number so the shares
// read as proportions at a glance; the builder lets you set your own.
const PLAN_BUDGET = 100;

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
        // One population now. The board and the plan card used to differ:
        // the board showed calls, the plan priced the no-calls too because
        // the builder bet edges rather than calls. That split is gone - we
        // do not stake what we will not call - so both read the same list,
        // which is also the list /risk builds. The coin flips still show
        // on the Today page, as restraint.
        const pending = all.filter((p) => p.status === 'pending' && !ledgerNoCall(p));
        // TODAY, and only today. This filtered on `date >= startOfToday`,
        // which is every future day as well: on a quiet evening the board
        // filled up with tomorrow's matches under a heading that said
        // "Happening Now". It also never expired anything, so a match that
        // started at eleven was still on the board at midnight.
        const upcoming = pending
          .filter((p) => isToday(p.date) && stillUpcoming(p.date))
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        // Started or from an earlier day, still ungraded. Not "happening" by
        // any reading, so they get their own heading rather than sitting
        // silently among matches that have not begun.
        const awaiting = pending
          .filter((p) => !upcoming.includes(p) && new Date(p.date) < new Date())
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        const list = (upcoming.length > 0 ? upcoming : awaiting).slice(0, 6);
        // Today's calls that have started and have no result yet. The plan
        // needs them to tell "the day is over" from "nothing is worth
        // backing" - two very different sentences it used to answer with the
        // same silence.
        const inPlay = pending.filter((p) => isToday(p.date) && !stillUpcoming(p.date));
        // The suggested plan gets the FULL card and the graded history, not
        // the six-row display list: it must reproduce the Risk Lab's
        // recommendation exactly, and that page prices every pending call on
        // the viewer's calendar day using reliability measured on everything
        // graded so far. Feeding it the display slice quietly priced a
        // six-match "card" nobody would see anywhere else on the site.
        const card = pending.filter((p) => isToday(p.date) && stillUpcoming(p.date));
        // Calls only here too: the plan is sized on the population it bets,
        // exactly as /risk and planSettle.ledgerGraded do it.
        const gradedRows = all.filter((p) => (p.status === 'won' || p.status === 'lost') && !ledgerNoCall(p));
        setPicks({ state: 'ready', list, live: upcoming.length > 0, card, inPlay: inPlay.length, graded: gradedRows });
        // "Decided" means GRADED, not merely "not pending". A void is a call
        // that never resolved (walkover, retirement, an orphaned fixture the
        // pipeline retired), and p.correct is false on all of them - counting
        // those as misses understated the forward record by five points. Same
        // rule the Track Record page and the share cards already use.
        // No-calls (coin flips we declined to call, noCall: true) grade for
        // audit but are NOT calls: the forward record counts calls only.
        // Positive filter + explicit flag check - excluded-by-negation is
        // this file's documented bug class (the void-counting incident).
        const decided = all
          .filter((p) => (p.status === 'won' || p.status === 'lost') && !ledgerNoCall(p))
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

  // Does the graded split record still support the headline? null while
  // loading or below the sample floor, in which case the claim stands as
  // written rather than flip-flopping on thin evidence.
  //
  // The test is RETURN, not hit rate. On the matches where we and the
  // bookmakers back different players we land about as often as they do -
  // that race is level and the literature says it stays level from public
  // pre-match features. What differs is the price: our side pays when it
  // lands. Gating the headline on accuracy made the page claim something
  // the data does not support while ignoring the thing it does.
  //
  // Two bars, and the claim needs both: our side must clear BREAK-EVEN (a
  // flat stake at bookmakers' prices loses money by default, which is how
  // they stay open) and it must out-return theirs. Those are different
  // tests because the two sides are paid at different prices - we hold the
  // longer ticket on a split - so neither implies the other.
  const beatsMarket = proof.state === 'ready' && proof.edge
    ? proof.edge.usNet > 0 && proof.edge.usNet > proof.edge.mktNet
    : null;

  const upsetById = useMemo(
    () => new Map((scorecard?.upsetWatch || []).map((u) => [u.id, u])),
    [scorecard]
  );

  // Today's suggested plan: THE Risk Lab's recommendation, not a cousin
  // of it. This used to run the old recommendStakes recommender (+EV picks
  // only, sized by Kelly) over the six-match display list - so the home page
  // and /risk could show two different plans for the same day, and the home
  // one funded a policy the builder itself had moved away from. Same inputs
  // now: the full card, the same reliability haircut measured on everything
  // graded, the same budget the builder opens with, planFrontier end to end.
  // If the numbers here and on /risk ever disagree, one of them is wrong.
  const plan = useMemo(() => {
    const oddsOf = (p) => Number(p.favorite === p.p1 ? p.lockOdd1 : p.lockOdd2);
    const card = picks.card || [];
    const priced = card.filter((p) => oddsOf(p) > 1 && p.favProb > 0);
    // Too thin to price. If the day's matches have simply started, say that;
    // returning null here dropped the whole plan card off the page without a
    // word, which reads as broken rather than as finished.
    if (priced.length < 2) {
      return picks.inPlay > 0 ? { n: priced.length, done: true, awaiting: picks.inPlay } : null;
    }
    const bets = priced.map((p) => ({ key: p.id, p: p.favProb, o: oddsOf(p) }));
    const rel = reliability(picks.graded || []);
    const frontier = planFrontier(bets, PLAN_BUDGET, { lambda: rel.lambda });
    if (!frontier.plans.length) return { n: priced.length, none: true };
    const rec = frontier.plans.find((p) => p.id === frontier.recommendedId) || frontier.plans[0];
    const compose = (p) => {
      const singles = Object.values(p.singles).filter((v) => v > 0.005).length;
      const legs = (p.parlayLegs || []).length;
      return `${singles} singles${p.parlayStake > 0.005 ? ` + a ${legs}-leg parlay` : ''}`;
    };
    return {
      n: priced.length,
      recommendedId: rec.id,
      rec: { label: rec.label, composition: compose(rec), metrics: rec.metrics },
      menu: frontier.plans.map((p) => ({
        id: p.id, label: p.label, composition: compose(p),
        pProfit: p.metrics.pProfit, ev: p.metrics.ev,
      })),
    };
  }, [picks.card, picks.graded, picks.inPlay]);


  // Live proof stats from the graded track record - the credibility engine
  // that separates this from a "form with a number".
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then((d) => {
        // The benchmark speaks the call policy: rows the deployed pick would
        // not have called (pickNoCall) grade in the by-confidence table but
        // enter no published claim. Same rule the ledger locks under.
        const ms = (d.matches || []).filter((m) => !pickNoCall(m));
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
        // step. (Not betting advice: it settles at the locked price, after the
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
          {/* Leads with what the product became. "We Beat the Market on Price"
              was true and stayed true, but it sold only the first third of the
              site in a tipster's voice - the calls. Half of what is here now
              is the staking plan and the risk panel, and nobody else shows you
              what a bad day costs. Being a claim about the TOOL rather than
              about the ledger, it also needs no guard: it cannot come untrue
              on a bad week. The market claim moved to the sub-line, where it
              is gated on the record that has to support it. */}
          <h1 className="main-title">Know What to Stake,<br />and What It Risks</h1>
          {/* Two sentences. This ran to four, explaining the grading policy,
              the split record, the dollar comparison and the page layout
              before it had said what the product does - and a hero that
              describes its own methodology is a hero nobody finishes. The
              claim goes first, the proof is the numbers immediately below,
              and the mechanics moved to the pages that own them. */}
          {/* The trust the headline no longer carries. The market claim is
              made ONLY while the ledger supports it - and only when it is
              actually known, which the old guard got wrong: it tested
              `=== false`, so a null (still loading, or below the sample
              floor) fell through and asserted the claim before any data had
              arrived. */}
          <p className="sub-title">
            A simulation engine that calls every ATP and WTA match before play and grades
            every one of them in public. Then the part most tipsters skip: how much to
            stake, and what a bad day actually costs.
            {beatsMarket === true && proof.edge && (
              <> Where we split from the betting favorite, a flat stake on our side has
                returned {proof.edge.usNet >= 0 ? '+' : '-'}
                {Math.abs(Math.round((proof.edge.usNet / proof.edge.n) * 100))}% while the same
                money on theirs returned {proof.edge.mktNet >= 0 ? '+' : '-'}
                {Math.abs(Math.round((proof.edge.mktNet / proof.edge.n) * 100))}%.</>
            )}
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
              // 1. The thesis, and the thesis is RETURN. This slot used to
              //    lead with hit rate against the market, which is the claim
              //    the data does not support (that race is level) while the
              //    one it does support sat further down the page.
              //    BOTH SIDES, deliberately. I briefly cut the market's
              //    figure here believing the pair was forced - a split has
              //    one winner, so the two HIT RATES must sum to 100%. The
              //    money does not follow: the two sides are paid at
              //    different prices. On these splits our ticket averages
              //    2.23 and theirs 1.67, so identical hit rates would still
              //    pay differently and the gap between the returns is the
              //    entire claim. The sum landing near zero here is a
              //    coincidence of this season's odds, not arithmetic.
              proof.edge && {
                key: 'roi',
                val: (
                  <>
                    {proof.edge.usNet >= 0 ? '+' : '-'}{Math.abs(Math.round((proof.edge.usNet / proof.edge.n) * 100))}%
                    <span className="home-stat-vs"> vs {proof.edge.mktNet >= 0 ? '+' : '-'}{Math.abs(Math.round((proof.edge.mktNet / proof.edge.n) * 100))}%</span>
                  </>
                ),
                cap: `return on our side vs theirs · ${proof.edge.n} market disagreements`,
              },
              // 2. Hit rate, kept as context rather than as the claim: level
              //    with the market is the honest reading of this number.
              proof.marketAcc != null && {
                key: 'mkt',
                val: <>{proof.smashOnOdds}%<span className="home-stat-vs"> vs {proof.marketAcc}%</span></>,
                cap: 'winners called, same matches as the market',
              },
              // 2. Locked before play is the number that has moved most, so it
              //    carries its own recent form instead of a bare season figure.
              forward && forward.n >= 25 && {
                key: 'fwd',
                val: (
                  <>
                    {forward.acc}%
                    {/* Recent form is shown WHETHER OR NOT it flatters: it
                        used to appear only when it beat the season figure,
                        which is a stat rail that goes quiet exactly when the
                        reader most needs it. */}
                    {forward.recentAcc != null && (
                      <span className={`home-stat-trend${forward.recentAcc >= forward.acc ? '' : ' down'}`}>
                        {forward.recentAcc >= forward.acc ? ' ▲' : ' ▼'}{forward.recentAcc}% last {forward.recentN}
                      </span>
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
              { key: 'n', val: proof.n.toLocaleString(), cap: 'calls graded in public' },
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
            The stat rail claims we beat the market on price; this is the working.
            Only the matches where our pick and the bookmakers' favorite were
            different people, because agreeing with the market proves nothing. */}
        {proof.state === 'ready' && proof.edge && (
          <section className="home-edge">
            <div className="home-section-head">
              <h2 className="home-section-title">What our disagreements are worth</h2>
              <span className="home-section-sub">{proof.edge.n} graded splits this season</span>
            </div>
            <Link to="/edge" className="home-edge-card">
              {/* One figure, not a duel. The old "55% vs 45%" pair read as
                  two findings when a split has exactly one winner: whatever
                  share we take, the market takes the rest, by definition.
                  The number that carries information is the money, because
                  that depends on the PRICE we got, which is not forced. */}
              <div className="home-edge-split">
                <div className="home-edge-side">
                  <span className="home-edge-val">{proof.edge.usAcc}%</span>
                  <span className="home-edge-cap">of {proof.edge.n} disagreements, we named the winner</span>
                </div>
              </div>
              <div className="home-edge-body">
                {/* Was three paragraphs explaining why the hit rates are
                    forced to complement and the prices are not. True, and it
                    belongs on the Edge page, which this card links to. Here
                    it only has to land the number. */}
                <p className="home-edge-money">
                  A flat $1 on each of the {proof.edge.n} splits:{' '}
                  <strong className={proof.edge.usNet >= 0 ? 'pos' : 'neg'}>
                    {proof.edge.usNet >= 0 ? '+' : '-'}${Math.abs(proof.edge.usNet)}
                  </strong> on ours,{' '}
                  <strong className={proof.edge.mktNet >= 0 ? 'pos' : 'neg'}>
                    {proof.edge.mktNet >= 0 ? '+' : '-'}${Math.abs(proof.edge.mktNet)}
                  </strong> on theirs. Same hit rate, longer ticket.
                </p>
                <span className="home-edge-note">Settled at the price stamped before play. Not betting advice.</span>
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
              {picks.live ? 'Happening Today' : picks.list.length > 0 ? 'Awaiting Results' : 'Tournament Watch'}
            </h2>
            {picks.list.length > 0 && (
              <span className="home-section-sub">
                {new Set(picks.list.map((p) => p.event)).size === 1 ? picks.list[0].event : 'on tour this week'}
              </span>
            )}
            {/* The scorecard's "yesterday" is the day before the build only
                when the results feed has reached it; when it has not, the
                block still carries the last graded day and says so rather
                than calling three-day-old matches yesterday's. */}
            {scorecard?.yesterday?.n > 0 && (
              <Link to="/track-record" className="home-board-yday">
                {scorecard.yesterday.isYesterday === false
                  ? new Date(`${scorecard.yesterday.date}T12:00:00Z`)
                    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
                  : 'Yesterday'}: {scorecard.yesterday.correct}/{scorecard.yesterday.n} ✓
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
          <div className={`home-board-wrap${plan ? ' has-slip' : ''}`}>
            <div className="home-board-grid">
              {picks.list.map((p) => {
                const when = timeUntil(p.date);
                // The scheduled start, alongside how long until it. The
                // countdown alone answered "when" only for someone reading at
                // that exact minute, and its fallback label is the word
                // "today", which on a board of today's matches says nothing.
                const start = localStartTime(p.date);
                return (
                  <Link key={`${p.tour}-${p.p1}-${p.p2}-${p.date}`} to={`/match/${matchSlug(p)}`} className="home-board-card">
                    <div className="home-board-top">
                      <span className="home-board-tour">{p.tour === 'wta' ? 'WTA' : 'ATP'}</span>
                      <span className={`home-board-surface s-${p.surface}`}>{p.surface}</span>
                      {p.tier && p.tier !== 'slam' && (
                        <span className="home-board-event">{p.event}</span>
                      )}
                      <span className={`home-board-when${when && when.soon ? ' soon' : ''}${when && when.past ? ' past' : ''}`}>
                        {start || 'time TBD'}
                        {when && when.label !== 'today' ? ` · ${when.label}` : ''}
                      </span>
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

            {/* The Risk Lab's own recommendation, verbatim: same maths,
                same inputs, same numbers a visitor finds when they click
                through. The menu shows all the plans it offers today with the
                recommended one marked, so the choice is visible here too. */}
            {plan && (
              <Link to="/risk" className="home-plan" aria-label="Today's recommended plan: open the Risk Lab">
                <div className="home-plan-cap">Today&apos;s recommended plan</div>
                {plan.done ? (
                  <>
                    <p className="home-plan-none">
                      <strong>Today&apos;s card is done.</strong> All {plan.awaiting} of today&apos;s
                      calls have started, so there is nothing left to stake. They grade overnight
                      onto the Ledger, and tomorrow&apos;s lock as the order of play is published.
                    </p>
                    <span className="home-plan-cta">See how they land →</span>
                  </>
                ) : plan.none ? (
                  <>
                    <p className="home-plan-none">
                      Nothing on today's card returns what it costs to back, spread or
                      stacked, so the plan is to stake nothing. That is the answer more
                      often than anyone selling picks will admit.
                    </p>
                    <span className="home-plan-cta">See why for each call →</span>
                  </>
                ) : (
                  <>
                    <div className="home-plan-sub">
                      how the Risk Lab would stake a ${PLAN_BUDGET} budget on today&apos;s {plan.n} priced calls
                    </div>
                    <div className="home-plan-out">
                      <span className="home-plan-ev">
                        {Math.round((plan.rec.metrics.pProfit || 0) * 100)}%
                      </span>
                      <span className="home-plan-evcap">
                        chance you finish ahead · {plan.rec.metrics.ev >= 0 ? '+' : '-'}$
                        {Math.abs(plan.rec.metrics.ev).toFixed(2)} expected on {plan.rec.composition}
                      </span>
                    </div>
                    {/* The shape of the thing, not just its average. A plan
                        can carry positive EV and still lose on most days -
                        that is what a long-priced edge looks like - and a card
                        showing only "+$X expected" reads as "you make $X".
                        analyzeSlip already computes these percentiles for
                        every plan on the menu; they were being thrown away. */}
                    {plan.rec.metrics.pcts && (
                      <p className="home-plan-spread">
                        A typical day is{' '}
                        <strong className={plan.rec.metrics.pcts.p50 >= 0 ? 'pos' : 'neg'}>
                          {plan.rec.metrics.pcts.p50 >= 0 ? '+' : '-'}${Math.abs(plan.rec.metrics.pcts.p50).toFixed(2)}
                        </strong>
                        {plan.rec.metrics.pcts.p50 < 0 && plan.rec.metrics.ev > 0 && ', even though the average is positive'}
                        . A good one{' '}
                        <strong className="pos">+${Math.abs(plan.rec.metrics.pcts.p95).toFixed(2)}</strong>, a bad one{' '}
                        <strong className="neg">-${Math.abs(plan.rec.metrics.pcts.p05).toFixed(2)}</strong>.
                      </p>
                    )}
                    <div className="home-plan-rows">
                      {plan.menu.map((p) => (
                        <div className={`home-plan-row${p.id === plan.recommendedId ? ' parlay' : ''}`} key={p.id}>
                          <span className="home-plan-row-k">
                            {p.label}
                            {p.id === plan.recommendedId && <em> · recommended</em>}
                          </span>
                          <span className="home-plan-row-v">
                            {Math.round((p.pProfit || 0) * 100)}% · {p.ev >= 0 ? '+' : '-'}${Math.abs(p.ev).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* One link, not two. These pointed at the builder and
                        the risk lab back when those were separate pages; they
                        are one page now, so a second button under the first
                        just promised somewhere else to go. */}
                    <span className="home-plan-cta">Open the Risk Lab →</span>
                  </>
                )}
              </Link>
            )}
          </div>
          )}
        </section>

        {/* A primary CTA, so it sits at the page's high-water mark of
            interest rather than after it: the reader has just seen the proof
            (the split record) and today's actual card. Everything below this
            is supporting material, and the footer copy is a fallback, not the
            ask. Moved up from 67% page depth, where most visitors never got
            to it. */}
        <DigestSignup variant="band" />

        {titleOddsSection}

        {/* ── Engine health: the guardrail board, summarised ─────────────
            Five engines compete per surface and only one gets deployed; this
            says whether each is still earning it, without making anyone open
            the model card to find out. Sits last of the content sections: it
            is the "how do I know this is maintained" answer, not a headline. */}
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

        <section className="home-nav">
          <div className="home-section-head">
            <h2 className="home-section-title">Where to go next</h2>
            <span className="home-section-sub">the tools, then the proof</span>
          </div>
          {/* Ordered by what a visitor can DO, then by what backs it up.
              The Risk Lab leads because it is the thing that answers "so what
              do I do with this", and the two record pages that used to open
              the list are the last word rather than the first. */}
          <div className="home-nav-grid">
            <Link to="/risk" className="home-nav-card">
              <div className="home-nav-num">01</div>
              <div className="home-nav-name">Risk Lab</div>
              <p className="home-nav-desc">What to stake on today's card, and what a bad day costs.</p>
              <span className="home-nav-go">Size your day →</span>
            </Link>
            <Link to="/h2h" className="home-nav-card">
              <div className="home-nav-num">02</div>
              <div className="home-nav-name">H2H Studio</div>
              <p className="home-nav-desc">Any two players, any surface, played out point by point.</p>
              <span className="home-nav-go">Open the studio →</span>
            </Link>
            <Link to="/dream-brackets" className="home-nav-card">
              <div className="home-nav-num">03</div>
              <div className="home-nav-name">Dream Brackets</div>
              <p className="home-nav-desc">Seed your own draw and simulate it to a champion.</p>
              <span className="home-nav-go">Build yours →</span>
            </Link>
            <Link to="/draw" className="home-nav-card">
              <div className="home-nav-num">04</div>
              <div className="home-nav-name">The Draw</div>
              <p className="home-nav-desc">The bracket simulated 2,000 times, re-priced daily.</p>
              <span className="home-nav-go">Read the bracket →</span>
            </Link>
            <Link to="/edge" className="home-nav-card">
              <div className="home-nav-num">05</div>
              <div className="home-nav-name">The Edge</div>
              <p className="home-nav-desc">Where we split from the market, and who was right.</p>
              <span className="home-nav-go">See the splits →</span>
            </Link>
            <Link to="/track-record" className="home-nav-card">
              <div className="home-nav-num">06</div>
              <div className="home-nav-name">The Ledger</div>
              <p className="home-nav-desc">Every call, locked before play and scored after.</p>
              <span className="home-nav-go">View the record →</span>
            </Link>
          </div>
        </section>
      </motion.div>
    </div>
  );
}
