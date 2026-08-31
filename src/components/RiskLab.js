// src/components/RiskLab.js
//
// The sizing panel. Its one job is to describe exposure, and it deliberately
// recommends nothing: the staking plan above already answers "what should I
// stake", and answering the same question twice in two voices is how a tool
// stops being trusted. Here the stakes are the reader's, and every number is
// a consequence of what they typed.
//
// The three tabs are three different questions people actually ask, in the
// order they ask them:
//   This slip  - what can today do to me?
//   Repeated   - what does a season of this look like?
//   My limits  - am I betting too big for my bankroll?
//
// The last one carries the only genuinely load-bearing warning on the page.
// Past about 2x Kelly, expected growth turns NEGATIVE even with a real edge:
// you can be right about every price and still go broke by sizing. Nothing
// else in the app says that, and it is not a matter of taste.
import React, { useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { analyzeSlip, parlayCombo, reliability, adjustProb, planFrontier } from '../utils/staking';
import { lossExceedance, gainExceedance, twoSidedExceedance, amountAtExceedance, kellyCheck, simulateBankroll, expectedLosingStreak, outcomePairs } from '../utils/riskLab';
import './RiskLab.css';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v || 0).toFixed(2)}`;
const money0 = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v || 0))}`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v) => `${Math.round(v * 100)}%`;
// Five rungs for a ladder, distinct once rounded to whole dollars. Two rungs
// that print the same amount with two different probabilities read as a
// contradiction, which is exactly what a reader checking a figure will spot.
const rungs = (top, n = 5) => {
  if (!(top > 0)) return [];
  const out = [];
  for (let i = 1; i <= n; i++) {
    const v = Math.max(1, Math.round((top * i) / n));
    if (!out.length || v > out[out.length - 1]) out.push(v);
  }
  return out;
};

const defaultOdds = (l) => Number(l.favorite === l.p1 ? l.lockOdd1 : l.lockOdd2) || 0;

// Same figure the plan card, the parlay builder and the digest all use.
const DEFAULT_BANKROLL = 100;
// Where the panel opens: enough of the bankroll on the card to be worth
// looking at, nowhere near enough to be alarming. The reader moves it.
const OPENING_EXPOSURE = 0.15;
const openingStake = (bankroll, legCount) => (legCount > 0
  ? Math.max(1, Math.round((bankroll * OPENING_EXPOSURE) / legCount))
  : 1);

// ── Charts ──────────────────────────────────────────────────────────────────

// Both arms of the day on one axis: losses left of break-even, gains right,
// height = how likely you are to get at least that far in that direction.
//
// This replaced a pair of side-by-side charts. Two charts made the reader
// compare heights across a gap and hold two pictures at once, when it is
// really one shape - a tent peaking at break-even, falling away as the
// outcome gets more extreme. Nothing here needs subtracting to be read: each
// side answers its own question in its own direction.
function OutcomeCurve({ series, pcts, staked }) {
  if (!series || series.length < 4) return null;
  const w = 420, h = 178, padL = 34, padR = 10, padT = 24, padB = 30;
  const loss = series.filter((s) => s.side === 'loss');
  const gain = series.filter((s) => s.side === 'gain');
  const lo = loss[0].pl, hi = gain[gain.length - 1].pl;
  const span = Math.max(hi - lo, 1e-6);
  const maxP = Math.max(...series.map((s) => s.prob), 0.05);
  const x = (v) => padL + ((v - lo) / span) * (w - padL - padR);
  const y = (p) => padT + (1 - p / maxP) * (h - padT - padB);
  const path = (arr) => arr.map((s) => `${x(s.pl).toFixed(1)},${y(s.prob).toFixed(1)}`).join(' ');
  const zeroX = x(0);
  const base = h - padB;
  const pLose = loss[loss.length - 1].prob;
  const pWin = gain[0].prob;
  const tick = (v, label) => (
    <g key={label}>
      <line x1={x(v)} x2={x(v)} y1={base} y2={base + 4} stroke="rgba(255,255,255,0.3)" />
      <text x={x(v)} y={base + 15} textAnchor="middle" className="risk-axis">{label}</text>
    </g>
  );
  return (
    <svg className="risk-chart wide" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Outcome curve. Chance of losing anything ${pct0(pLose)}, chance of winning anything ${pct0(pWin)}. A bad day is ${money0(pcts ? pcts.p05 : lo)}, a typical day ${money0(pcts ? pcts.p50 : 0)}, a good day ${money0(pcts ? pcts.p95 : hi)}.`}>
      {/* Fills first, so the curves sit on top of their own shading. */}
      <polygon points={`${x(lo)},${base} ${path(loss)} ${zeroX},${base}`} fill="rgba(255,92,92,0.16)" />
      <polygon points={`${zeroX},${base} ${path(gain)} ${x(hi)},${base}`} fill="rgba(92,191,141,0.16)" />
      <polyline points={path(loss)} fill="none" stroke="#ff8f8f" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={path(gain)} fill="none" stroke="#5cbf8d" strokeWidth="2" strokeLinejoin="round" />

      {/* Break-even: the only line on the chart worth drawing full height. */}
      <line x1={zeroX} x2={zeroX} y1={padT - 4} y2={base} stroke="rgba(255,255,255,0.5)" strokeDasharray="3 3" />

      {/* The pair of numbers that make the shape legible without a legend. */}
      <text x={zeroX - 6} y={y(pLose) - 7} textAnchor="end" className="risk-axis strong loss">{pct0(pLose)} lose</text>
      <text x={zeroX + 6} y={y(pWin) - 7} className="risk-axis strong gain">{pct0(pWin)} win</text>

      {/* A typical day, where it actually falls. */}
      {pcts && (
        <g>
          <circle cx={x(pcts.p50)} cy={base} r="3" fill="var(--accent-brand, #c8f560)" />
          <text x={x(pcts.p50) + (pcts.p50 > 0 ? 7 : -7)} y={base - 6}
            textAnchor={pcts.p50 > 0 ? 'start' : 'end'} className="risk-axis strong">typical</text>
        </g>
      )}

      <line x1={padL} x2={w - padR} y1={base} y2={base} stroke="rgba(255,255,255,0.16)" />
      <text x={padL - 4} y={padT + 6} textAnchor="end" className="risk-axis">{pct0(maxP)}</text>
      <text x={padL - 4} y={base} textAnchor="end" className="risk-axis">0</text>
      {tick(lo, `${money0(lo)}${lo <= -staked + 0.01 ? ' (all)' : ''}`)}
      {tick(0, 'break even')}
      {tick(hi, `+${money0(hi).replace('-', '')}`)}
    </svg>
  );
}

// Bankroll fan: median path with a 5th-95th percentile band. One simulated
// path would be an anecdote; the band is the range you are actually signing
// up for.
function FanChart({ sim, bankroll }) {
  if (!sim) return null;
  const w = 320, h = 150, padL = 38, padB = 20, padT = 10, padR = 8;
  const all = [...sim.p05, ...sim.p95, bankroll];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, 1e-6);
  const x = (d) => padL + (d / sim.days) * (w - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB);
  const line = (arr) => arr.map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const bandPts = `${sim.p95.map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} ${
    [...sim.p05].reverse().map((v, i) => { const d = sim.days - i; return `${x(d).toFixed(1)},${y(v).toFixed(1)}`; }).join(' ')}`;
  return (
    <svg className="risk-chart" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Simulated bankroll over ${sim.days} days: median ends ${money0(sim.finalP50)}, with a range from ${money0(sim.finalP05)} to ${money0(sim.finalP95)}.`}>
      <polygon points={bandPts} fill="rgba(200,245,96,0.13)" />
      <line x1={padL} x2={w - padR} y1={y(bankroll)} y2={y(bankroll)}
        stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
      <polyline points={line(sim.p95)} fill="none" stroke="rgba(200,245,96,0.5)" strokeWidth="1.25" />
      <polyline points={line(sim.p05)} fill="none" stroke="#ff8f8f" strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline points={line(sim.p50)} fill="none" stroke="var(--accent-brand, #c8f560)" strokeWidth="2.25" strokeLinejoin="round" />
      <text x={padL - 4} y={y(hi) + 4} textAnchor="end" className="risk-axis">{money0(hi)}</text>
      <text x={padL - 4} y={y(bankroll) + 4} textAnchor="end" className="risk-axis">{money0(bankroll)}</text>
      <text x={padL - 4} y={y(lo) + 4} textAnchor="end" className="risk-axis">{money0(lo)}</text>
      <text x={padL} y={h - 6} className="risk-axis">day 0</text>
      <text x={w - padR} y={h - 6} textAnchor="end" className="risk-axis">day {sim.days}</text>
    </svg>
  );
}

// Where the stake sits against Kelly. The 1x and 2x marks are the only two
// numbers on this scale that mean anything, so they are the only two drawn.
function KellyGauge({ ratio }) {
  if (ratio == null) return null;
  const w = 300, h = 46, padL = 6, padR = 6;
  const MAX = 3;
  const shown = Math.min(ratio, MAX);
  const x = (r) => padL + (r / MAX) * (w - padL - padR);
  const colour = ratio <= 1.15 ? 'var(--accent-brand, #c8f560)' : ratio <= 2 ? '#ffb74d' : '#ff5c5c';
  return (
    <svg className="risk-gauge" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Your stake is ${ratio.toFixed(2)} times the growth-optimal size.`}>
      <rect x={padL} y="14" width={w - padL - padR} height="10" rx="5" fill="rgba(255,255,255,0.08)" />
      <rect x={padL} y="14" width={Math.max(2, x(shown) - padL)} height="10" rx="5" fill={colour} />
      {[1, 2].map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1="9" y2="29" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
          <text x={x(m)} y="41" textAnchor="middle" className="risk-axis">{m}x Kelly</text>
        </g>
      ))}
      <text x={padL} y="9" className="risk-axis">0</text>
      <text x={w - padR} y="9" textAnchor="end" className="risk-axis">{ratio > MAX ? `${ratio.toFixed(1)}x` : '3x'}</text>
    </svg>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

// onDrop(leg) takes a match off the card entirely. Supplied when this is the
// page's own control surface rather than a panel reading someone else's list.
export default function RiskLab({ legs, graded = [], onDrop = null }) {
  const [tab, setTab] = useState('slip');
  // $100, matching PLAN_BUDGET everywhere else on the site, so a reader
  // comparing this page with the plan card or the digest is comparing like
  // with like instead of silently rebasing.
  const [bankroll, setBankroll] = useState(DEFAULT_BANKROLL);
  // The opening stake is DERIVED, not a second hardcoded number. A fixed $10
  // against a $100 bankroll opens at 290% exposure on a full tour day, so the
  // panel would shout "ruinous" before the reader had typed anything - an
  // artifact of the defaults rather than a judgement about their betting.
  // Seeded to put roughly OPENING_EXPOSURE of the bankroll on the card, then
  // it is theirs. Runs once: dropping a match must not move the stake.
  const [flat, setFlat] = useState(() => openingStake(DEFAULT_BANKROLL, legs.length));
  const [parlayStake, setParlayStake] = useState(0);
  const [override, setOverride] = useState({});   // { id: stake }
  const [inParlay, setInParlay] = useState({});   // { id: bool }, default true
  const [days, setDays] = useState(30);
  // Which builder plan is currently loaded, or null for stakes you set
  // yourself. Cleared the moment any stake is edited, so the highlight can
  // never claim you are looking at a plan you have since changed.
  const [applied, setApplied] = useState(null);

  // Same reliability haircut the plan uses: the panel must describe the same
  // bets the rest of the page prices, or the two disagree about one slip.
  const rel = useMemo(() => reliability(graded), [graded]);
  const stakeOf = (l) => (override[l.id] != null ? Number(override[l.id]) || 0 : Number(flat) || 0);
  const isIn = (l) => (inParlay[l.id] != null ? inParlay[l.id] : true) && defaultOdds(l) > 1;

  // The builder's own plan menu, computed on YOUR bankroll rather than the
  // site's hypothetical $100. Same function the parlay builder runs, so these
  // are the same plans, sized to the money you actually have. Whether that
  // sizing is sane is the question the Kelly gauge below answers, which is
  // the point of being able to load them here at all.
  const frontier = useMemo(() => {
    const priced = legs
      .map((l) => ({ key: l.id, p: l.favProb, o: defaultOdds(l) }))
      .filter((b) => b.o > 1 && b.p > 0);
    if (priced.length < 2 || !(Number(bankroll) > 0)) return null;
    try {
      return planFrontier(priced, Number(bankroll), { lambda: rel.lambda });
    } catch { return null; }
  }, [legs, bankroll, rel.lambda]);

  // Load a plan's stakes in as if you had typed them. Every leg is written
  // explicitly, including the zeros: a plan that declines to back a match is
  // making a statement, and leaving those legs on the flat stake would show
  // a slip the builder never proposed.
  const applyPlan = (plan) => {
    const next = {};
    for (const l of legs) next[l.id] = +((plan.singles || {})[l.id] || 0).toFixed(2);
    setOverride(next);
    setParlayStake(+(plan.parlayStake || 0).toFixed(2));
    const inPar = {};
    for (const l of legs) inPar[l.id] = (plan.parlayLegs || []).includes(l.id);
    setInParlay(inPar);
    setApplied(plan.id);
  };

  const bets = useMemo(() => legs.map((l) => ({
    key: l.id,
    p: adjustProb(l.favProb, rel.lambda),
    o: defaultOdds(l),
    single: stakeOf(l),
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [legs, override, flat, rel.lambda]);

  const parlayLegs = useMemo(() => legs.filter(isIn).map((l) => l.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legs, inParlay]);

  const parStake = Number(parlayStake) || 0;
  const analysis = useMemo(
    () => analyzeSlip(bets, { stake: parStake, legs: parlayLegs }),
    [bets, parStake, parlayLegs]
  );
  const combo = useMemo(() => parlayCombo(bets, parlayLegs), [bets, parlayLegs]);

  const bank = Number(bankroll) || 0;
  const staked = analysis.staked;

  // Both ladders stop at the 2% outcome rather than at the theoretical
  // extreme. Anchoring the downside at the full stake, or the upside at
  // everything landing, spent most of the rungs printing 0.0%: those ends
  // need every leg to break the same way at once. The extremes are still
  // reported, as the two headline metrics above.
  const ladder = useMemo(() => {
    if (!analysis.dist || staked <= 0) return [];
    const levels = rungs(amountAtExceedance(analysis.dist, 0.02, 'loss'));
    return lossExceedance(analysis.dist, levels).map((s) => ({ ...s, amount: s.loss }));
  }, [analysis.dist, staked]);

  // The upside ladder is scaled to what can actually be WON, not to what is
  // staked: a slip of short-priced favourites risks far more than it can
  // return, so anchoring both ladders to the stake would leave the upside
  // curve flat on the floor and unreadable.
  const upLadder = useMemo(() => {
    if (!analysis.dist || staked <= 0 || !(analysis.best > 0)) return [];
    const levels = rungs(amountAtExceedance(analysis.dist, 0.02, 'gain'));
    return gainExceedance(analysis.dist, levels).map((s) => ({ ...s, amount: s.gain }));
  }, [analysis.dist, staked, analysis.best]);

  // The chance of the ceiling actually arriving. It used to be read off the
  // top rung of the upside ladder, which is no longer the extreme.
  const pBest = useMemo(
    () => (analysis.dist && analysis.best > 0
      ? gainExceedance(analysis.dist, [analysis.best])[0].prob : 0),
    [analysis.dist, analysis.best]
  );

  const curve = useMemo(
    () => (analysis.dist && staked > 0 ? twoSidedExceedance(analysis.dist, 24) : []),
    [analysis.dist, staked]
  );

  const kelly = useMemo(
    () => kellyCheck(bets, bank, combo.priced && parStake > 0 ? { stake: parStake, p: combo.p, o: combo.o } : null),
    [bets, bank, combo, parStake]
  );

  const sim = useMemo(
    () => (analysis.dist && bank > 0 && staked > 0
      ? simulateBankroll(analysis.dist, { bankroll: bank, days: Number(days) || 30, trials: 1500 })
      : null),
    [analysis.dist, bank, days, staked]
  );

  const pLoseDay = useMemo(() => {
    const pairs = outcomePairs(analysis.dist);
    const tot = pairs.reduce((s, x) => s + x.prob, 0) || 1;
    return pairs.filter((x) => x.pl < 0).reduce((s, x) => s + x.prob, 0) / tot;
  }, [analysis.dist]);
  const streak = expectedLosingStreak(pLoseDay, Number(days) || 30);

  if (!legs.length) return null;
  const nothingStaked = staked <= 0;

  return (
    <section className="risk-lab" aria-label="Risk Lab">
      <div className="risk-head">
        <div>
          <div className="risk-cap">Your money on today&apos;s card</div>
          {/* One line. This ran to three sentences explaining that the panel
              describes rather than recommends - which the interface can just
              show, by putting your inputs first and labelling every output as
              a consequence of them. */}
          <p className="risk-sub">Change the two numbers below and everything else follows.</p>
        </div>
      </div>

      <div className="risk-inputs">
        <label className="risk-input">
          <span>Your bankroll</span>
          <span className="risk-money">$<input type="number" min="0" step="50" value={bankroll}
            onChange={(e) => setBankroll(e.target.value)} /></span>
        </label>
        <label className="risk-input">
          <span>Stake per match</span>
          <span className="risk-money">$<input type="number" min="0" step="5" value={flat}
            onChange={(e) => { setFlat(e.target.value); setOverride({}); setApplied(null); }} /></span>
        </label>
      </div>

      {/* The builder's plans, loadable. Without these the page only ever
          describes stakes someone invented, and the most useful question a
          reader has is what the RECOMMENDED plan does to their bankroll. */}
      {frontier && frontier.plans.length > 0 && (
        <div className="risk-plans">
          <div className="risk-plans-cap">Load a plan from the builder</div>
          <div className="risk-plans-row">
            {frontier.plans.map((pl) => (
              <button key={pl.id} type="button"
                className={`risk-plan-chip${applied === pl.id ? ' on' : ''}`}
                onClick={() => applyPlan(pl)}>
                <span className="risk-plan-chip-title">
                  {pl.label}
                  {pl.id === frontier.recommendedId && <em> · recommended</em>}
                </span>
                <span className="risk-plan-chip-sub">
                  {money0(pl.metrics.staked)} staked · {Math.round((pl.metrics.pProfit || 0) * 100)}% to finish ahead
                </span>
              </button>
            ))}
            {applied && (
              <button type="button" className="risk-plan-chip clear"
                onClick={() => { setOverride({}); setParlayStake(0); setInParlay({}); setApplied(null); }}>
                <span className="risk-plan-chip-title">Back to my own</span>
                <span className="risk-plan-chip-sub">flat {money0(Number(flat) || 0)} a match</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="risk-exposure">
        <div className="risk-exposure-bar">
          <span style={{ width: `${Math.min(100, bank > 0 ? (staked / bank) * 100 : 0)}%` }}
            className={staked / Math.max(bank, 1) > 0.25 ? 'hot' : ''} />
        </div>
        <div className="risk-exposure-cap">
          <strong>{money(staked)}</strong> at risk today
          {bank > 0 && <> · {pct1(staked / bank)} of your bankroll</>}
          {' '}· {legs.length} match{legs.length === 1 ? '' : 'es'}
          {combo.priced && parStake > 0 ? ` + a ${combo.n}-leg parlay` : ''}
        </div>
      </div>

      <div className="risk-tabs" role="tablist" aria-label="Risk view">
        {/* Named as the questions themselves. "This slip / Repeated / My
            limits" were labels you had to open to understand, which is the
            same failure as explaining the page in a paragraph. */}
        {[['slip', 'Today'], ['repeat', 'If I did this all season'], ['limits', 'Am I betting too big?']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {nothingStaked && (
        <p className="risk-empty">
          Nothing staked, so there is nothing at risk. Put a stake per match above to see what
          today could do.
        </p>
      )}

      {!nothingStaked && tab === 'slip' && (
        <div className="risk-panel">
          <div className="risk-grid">
            <div className="risk-metric">
              <span className="risk-metric-v">{analysis.pcts ? money(analysis.pcts.p50) : '-'}</span>
              <span className="risk-metric-l">a typical day (median)</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v neg">{analysis.pcts ? money(analysis.pcts.p05) : '-'}</span>
              <span className="risk-metric-l">a bad day (1 in 20)</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v pos">{analysis.pcts ? money(analysis.pcts.p95) : '-'}</span>
              <span className="risk-metric-l">a good day (1 in 20)</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v">{analysis.pProfit != null ? pct0(analysis.pProfit) : '-'}</span>
              <span className="risk-metric-l">chance you finish ahead</span>
            </div>
            {/* The two numbers the panel was missing: what it is worth on
                average, and the ceiling. A page that only ever quantified the
                floor was answering half the question. */}
            <div className="risk-metric">
              <span className={`risk-metric-v ${analysis.ev >= 0 ? 'pos' : 'neg'}`}>{money(analysis.ev)}</span>
              <span className="risk-metric-l">
                expected profit ({analysis.staked > 0 ? `${analysis.roi >= 0 ? '+' : ''}${(analysis.roi * 100).toFixed(1)}% of stake` : 'per day'})
              </span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v pos">{money(analysis.best)}</span>
              <span className="risk-metric-l">
                if everything lands{pBest > 0 ? ` · ${pBest < 0.001 ? 'under 0.1' : (pBest * 100).toFixed(1)}% chance` : ''}
              </span>
            </div>
          </div>

          <div className="risk-chart-block">
            <div className="risk-chart-cap">How far the day can go, and how likely</div>
            <OutcomeCurve series={curve} pcts={analysis.pcts} staked={staked} />
            <div className="risk-legend">
              <span><i className="k-loss" /> chance of losing at least that much</span>
              <span><i className="k-gain" /> chance of winning at least that much</span>
            </div>
          </div>

          {/* The same curve as numbers. The chart shows the shape; people
              checking a specific figure want to read it, not measure it. */}
          <div className="risk-two-up">
            <div className="risk-ladder-col">
              <div className="risk-chart-cap up">If it goes your way</div>
              <ul className="risk-ladder">
              {upLadder.map((s) => (
                <li key={s.gain}>
                  <span>Win {money0(s.gain)} or more</span>
                  <strong className="gain">{s.prob < 0.001 && s.prob > 0 ? '<0.1%' : pct1(s.prob)}</strong>
                </li>
              ))}
              </ul>
            </div>
            <div className="risk-ladder-col">
              <div className="risk-chart-cap down">If it does not</div>
              <ul className="risk-ladder">
              {ladder.map((s) => (
                <li key={s.loss}>
                  <span>Lose {money0(s.loss)} or more</span>
                  <strong className="loss">{s.prob < 0.001 && s.prob > 0 ? '<0.1%' : pct1(s.prob)}</strong>
                </li>
              ))}
              </ul>
            </div>
          </div>

          <p className="risk-note">
            Both ends need everything to break the same way at once, which is why the curve
            flattens as it goes out. Neither end is zero. The tall part either side of
            break-even is where almost every day actually finishes.
          </p>
        </div>
      )}

      {!nothingStaked && tab === 'repeat' && sim && (
        <div className="risk-panel">
          <label className="risk-input risk-input-wide">
            <span>If you did this every day for</span>
            <span className="risk-money"><input type="number" min="5" max="180" step="5" value={days}
              onChange={(e) => setDays(e.target.value)} /> days</span>
          </label>

          <div className="risk-chart-block">
            <div className="risk-chart-cap">
              {sim.trials.toLocaleString()} simulated seasons: the middle path, and the band 9 in 10 land inside
            </div>
            <FanChart sim={sim} bankroll={bank} />
            <div className="risk-legend">
              <span><i className="k-mid" /> median</span>
              <span><i className="k-band" /> 5th to 95th percentile</span>
              <span><i className="k-low" /> the bad 1 in 20</span>
              <span><i className="k-zero" /> where you started</span>
            </div>
          </div>

          <div className="risk-grid">
            <div className="risk-metric">
              <span className="risk-metric-v">{money0(sim.finalP50)}</span>
              <span className="risk-metric-l">median bankroll after {sim.days} days</span>
            </div>
            <div className="risk-metric">
              <span className={`risk-metric-v ${sim.riskOfRuin > 0.01 ? 'neg' : ''}`}>{pct1(sim.riskOfRuin)}</span>
              <span className="risk-metric-l">chance of going broke</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v">{pct0(sim.avgMaxDrawdown)}</span>
              <span className="risk-metric-l">typical worst drop from a peak</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v">{streak ? `${streak} days` : '-'}</span>
              <span className="risk-metric-l">longest losing run to expect</span>
            </div>
            {/* The ceiling, next to the floor rather than instead of it. */}
            <div className="risk-metric">
              <span className="risk-metric-v pos">{money0(sim.finalP95)}</span>
              <span className="risk-metric-l">a good season (top 1 in 20)</span>
            </div>
            <div className="risk-metric">
              <span className="risk-metric-v pos">{pct0(sim.pUp)}</span>
              <span className="risk-metric-l">
                chance you finish up{sim.pDouble > 0.005 ? ` · ${pct0(sim.pDouble)} chance of doubling` : ''}
              </span>
            </div>
          </div>

          <p className="risk-note">
            {sim.pDown > 0.35
              ? `Even with the edge above, ${pct0(sim.pDown)} of these seasons finish below where they started. `
              : `${pct0(sim.pDown)} of these seasons finish below where they started. `}
            A losing run of {streak || 'several'} days is not a sign the model broke; it is what this
            slip looks like from the inside. Stakes are held flat in dollars here, which is what
            most people actually do and the least flattering assumption available.
          </p>
        </div>
      )}

      {!nothingStaked && tab === 'limits' && kelly && (
        <div className="risk-panel">
          {kelly.ratio == null ? (
            <p className="risk-verdict ruinous">
              Nothing in this slip beats the price it is offered at, so the growth-optimal stake is
              zero. Any amount staked here is expected to shrink your bankroll, however small.
            </p>
          ) : (
            <>
              <div className="risk-chart-block">
                <div className="risk-chart-cap">Your stake against the growth-optimal size</div>
                <KellyGauge ratio={kelly.ratio} />
                <div className="risk-kelly-read">
                  <strong>{kelly.ratio.toFixed(2)}x Kelly</strong>
                  <span>
                    {' '}({money(kelly.staked)} staked, growth-optimal is {money(kelly.kellyStake)} on a {money0(bank)} bankroll)
                  </span>
                </div>
              </div>

              <p className={`risk-verdict ${kelly.band}`}>
                {kelly.band === 'conservative' && 'Comfortably under the growth-optimal size. You give up some long-run growth for a much smoother ride, which is a perfectly reasonable trade and the one most people should take.'}
                {kelly.band === 'full' && 'About the growth-optimal size. This maximises long-run growth in theory, and in practice it is a wild ride: expect drawdowns of half your bankroll and keep going anyway.'}
                {kelly.band === 'aggressive' && 'Past the growth-optimal size. You are taking on more variance for LESS expected growth, which is the worst trade available. Coming down is free.'}
                {kelly.band === 'ruinous' && 'More than twice the growth-optimal size. Past this point expected growth is negative even though every bet has an edge: the arithmetic of compounding losses beats the edge, and staking this way goes broke given enough time.'}
              </p>

              <div className="risk-grid">
                <div className="risk-metric">
                  <span className={`risk-metric-v ${kelly.exposure > 0.25 ? 'neg' : ''}`}>{pct1(kelly.exposure)}</span>
                  <span className="risk-metric-l">of bankroll on the table today</span>
                </div>
                <div className="risk-metric">
                  <span className="risk-metric-v">{money(kelly.kellyStake)}</span>
                  <span className="risk-metric-l">growth-optimal total stake</span>
                </div>
                <div className="risk-metric">
                  <span className="risk-metric-v">{money(kelly.kellyStake / 2)}</span>
                  <span className="risk-metric-l">half Kelly, the usual compromise</span>
                </div>
                <div className="risk-metric">
                  <span className="risk-metric-v">{sim ? pct1(sim.riskOfRuin) : '-'}</span>
                  <span className="risk-metric-l">chance of ruin at this size</span>
                </div>
              </div>
            </>
          )}
          <p className="risk-note">
            Kelly assumes our probabilities are right. They are measured, not guaranteed, so the
            honest version of every number above is &quot;at best&quot;. That is the case for staking
            under it rather than at it.
          </p>
        </div>
      )}

      {/* The card itself, not tucked into a disclosure: on its own page this
          IS the control surface, and the parlay is assembled from the same
          ticks rather than in a separate widget. */}
      <div className={`risk-legs${onDrop ? ' has-drop' : ''}`}>
        <div className="risk-legs-head">
          <span>Today&apos;s card ({legs.length})</span>
          <span>Stake</span>
          <span>In parlay</span>
          {onDrop && <span className="sr-only">Remove</span>}
        </div>
        <div className="risk-legs-list">
          {legs.map((l) => {
            const o = defaultOdds(l);
            return (
              <div className="risk-leg" key={l.id}>
                <span className="risk-leg-name">
                  {lastName(l.favName)}
                  <em>
                    over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {pct0(adjustProb(l.favProb, rel.lambda))}
                    {' '}· {o > 1 ? o.toFixed(2) : 'no price'}{l.event ? ` · ${l.event}` : ''}
                  </em>
                </span>
                <span className="risk-leg-stake">
                  $<input type="number" min="0" step="1" value={override[l.id] ?? flat}
                    onChange={(e) => { setOverride((s) => ({ ...s, [l.id]: e.target.value })); setApplied(null); }} />
                </span>
                <span className="risk-leg-par">
                  <input type="checkbox" aria-label={`Include ${lastName(l.favName)} in the parlay`}
                    checked={isIn(l)} disabled={!(o > 1)}
                    onChange={() => { setInParlay((s) => ({ ...s, [l.id]: !isIn(l) })); setApplied(null); }} />
                </span>
                {onDrop && (
                  <span className="risk-leg-drop">
                    <button type="button" aria-label={`Take ${lastName(l.favName)} off the card`}
                      title={`Take ${lastName(l.favName)} off the card`}
                      onClick={() => onDrop(l)}>&times;</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {combo.priced && (
          <div className="risk-parlay-row">
            <span className="risk-leg-name">
              Parlay
              <em>
                {combo.n} legs · lands {pct1(combo.p)} · pays {combo.o.toFixed(2)}
                {parStake > 0 ? '' : ' · no stake yet'}
              </em>
            </span>
            <span className="risk-leg-stake">
              $<input type="number" min="0" step="1" value={parlayStake}
                onChange={(e) => { setParlayStake(e.target.value); setApplied(null); }} />
            </span>
            <span />
            {onDrop && <span />}
          </div>
        )}
      </div>

      <p className="risk-fine">
        Every figure here follows from your stakes and our probabilities, both of which can be
        wrong. A probability tool, not betting advice.
      </p>
    </section>
  );
}
