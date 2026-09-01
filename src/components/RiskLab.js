// src/components/RiskLab.js
//
// The sizing panel. Its one job is to describe exposure, and it deliberately
// recommends nothing: the staking plan above already answers "what should I
// stake", and answering the same question twice in two voices is how a tool
// stops being trusted.
//
// It is CONTROLLED by that plan. The panel used to own a second copy of the
// card, a second stake box, and a row of chips for loading the builder's
// plans into it, all because it lived on its own page. Merged into the
// builder, every one of those was a second place to set the same number, and
// two sets of stakes on one page is exactly the disagreement the panel exists
// to avoid. Stakes come in through `plan`; the only input still owned here is
// the bankroll, which is a fact about the reader rather than about the day.
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
import { analyzeSlip, parlayCombo, reliability, cappedProb } from '../utils/staking';
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

// Same figure the plan card, the Risk Lab and the digest all use.
const DEFAULT_BANKROLL = 100;
// ── Charts ──────────────────────────────────────────────────────────────────

// Both arms of the day on one axis: losses left of break-even, gains right,
// height = how likely you are to get at least that far in that direction.
//
// This replaced a pair of side-by-side charts. Two charts made the reader
// compare heights across a gap and hold two pictures at once, when it is
// really one shape - a tent peaking at break-even, falling away as the
// outcome gets more extreme. Nothing here needs subtracting to be read: each
// side answers its own question in its own direction.
// A ladder of round numbers covering [0, top], for an axis that should read
// in dollars people recognise rather than in whatever the extremes happened
// to be. Steps at 1-2-5 x a power of ten, the scale every chart axis uses.
function niceSteps(top, target = 4) {
  if (!(top > 0)) return [];
  const raw = top / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10;
  const out = [];
  for (let v = step; v <= top + 1e-9; v += step) out.push(+v.toFixed(4));
  return out;
}

function OutcomeCurve({ series, pcts, staked }) {
  if (!series || series.length < 4) return null;
  const w = 420, h = 186, padL = 36, padR = 12, padT = 24, padB = 32;
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

  // Dollar ticks out from break-even in both directions, on the same round
  // step, so the two arms are read on one scale rather than two.
  const step = Math.max(
    niceSteps(Math.abs(lo), 3)[0] || 1,
    niceSteps(hi, 3)[0] || 1
  );
  const round = [{ v: 0, label: 'break even' }];
  for (let v = step; v <= hi + 1e-9; v += step) round.push({ v, label: `+${money0(v)}` });
  for (let v = step; v <= Math.abs(lo) + 1e-9; v += step) round.push({ v: -v, label: money0(-v) });

  // The extremes carry something the round ladder cannot: the worst case is
  // where you lose the lot, and the best is the whole card landing. They are
  // added as ticks in their own right, and where one lands on top of a round
  // tick the round one gives way - the ladder exists to convey scale, and one
  // rung of it is the cheaper thing to lose.
  const ends = [
    { v: lo, label: `${money0(lo)}${lo <= -staked + 0.01 ? ' (all)' : ''}`, anchor: 'start' },
    { v: hi, label: `+${money0(hi)}`, anchor: 'end' },
  ];
  const CLEAR = 34;   // viewBox units, about the width of one axis label
  const xTicks = [
    ...round.filter((t) => t.v === 0 || ends.every((e) => Math.abs(x(t.v) - x(e.v)) > CLEAR)),
    ...ends.filter((e) => Math.abs(x(e.v) - zeroX) > CLEAR),
  ];

  // Horizontal gridlines at round percentages. The curve's whole job is to be
  // read off at a height, and two labels at the ends made that guesswork.
  const yTicks = niceSteps(maxP, 6).filter((v) => v <= maxP + 1e-9);

  // The median, ON the curve rather than pinned to the axis. Its height is
  // the answer to "how often do you do at least this well", which for the
  // median is about half - so the marker lands where the curve crosses 50%
  // and says why it is there.
  const side = pcts && pcts.p50 > 0 ? gain : loss;
  const near = pcts
    ? side.reduce((best, q) => (Math.abs(q.pl - pcts.p50) < Math.abs(best.pl - pcts.p50) ? q : best), side[0])
    : null;

  return (
    <svg className="risk-chart wide" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Outcome curve. Chance of losing anything ${pct0(pLose)}, chance of winning anything ${pct0(pWin)}. A bad day is ${money0(pcts ? pcts.p05 : lo)}, a typical day ${money0(pcts ? pcts.p50 : 0)}, a good day ${money0(pcts ? pcts.p95 : hi)}.`}>
      {/* Gridlines under everything, so they read as paper rather than data. */}
      {yTicks.map((v) => (
        <line key={`g${v}`} x1={padL} x2={w - padR} y1={y(v)} y2={y(v)}
          stroke="rgba(255,255,255,0.07)" />
      ))}

      <polygon points={`${x(lo)},${base} ${path(loss)} ${zeroX},${base}`} fill="rgba(255,92,92,0.16)" />
      <polygon points={`${zeroX},${base} ${path(gain)} ${x(hi)},${base}`} fill="rgba(92,191,141,0.16)" />
      <polyline points={path(loss)} fill="none" stroke="#ff8f8f" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={path(gain)} fill="none" stroke="#5cbf8d" strokeWidth="2" strokeLinejoin="round" />

      {/* Break-even: the only line on the chart worth drawing full height. */}
      <line x1={zeroX} x2={zeroX} y1={padT - 4} y2={base} stroke="rgba(255,255,255,0.5)" strokeDasharray="3 3" />

      {/* The pair of numbers that make the shape legible without a legend. */}
      <text x={zeroX - 6} y={y(pLose) - 7} textAnchor="end" className="risk-axis strong loss">{pct0(pLose)} lose</text>
      <text x={zeroX + 6} y={y(pWin) - 7} className="risk-axis strong gain">{pct0(pWin)} win</text>

      {near && (
        <g>
          <line x1={x(near.pl)} x2={x(near.pl)} y1={y(near.prob)} y2={base}
            stroke="var(--accent-brand, #c8f560)" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.7" />
          <circle cx={x(near.pl)} cy={y(near.prob)} r="3.5" fill="var(--accent-brand, #c8f560)"
            stroke="#12151b" strokeWidth="1" />
          <text x={x(near.pl) + (near.pl > 0 ? 8 : -8)} y={y(near.prob) + 3}
            textAnchor={near.pl > 0 ? 'start' : 'end'} className="risk-axis strong">
            typical day {money0(pcts.p50)}
          </text>
        </g>
      )}

      <line x1={padL} x2={w - padR} y1={base} y2={base} stroke="rgba(255,255,255,0.16)" />
      {yTicks.map((v) => (
        <text key={`y${v}`} x={padL - 5} y={y(v) + 3} textAnchor="end" className="risk-axis">{pct0(v)}</text>
      ))}
      <text x={padL - 5} y={base + 3} textAnchor="end" className="risk-axis">0</text>
      {xTicks.map((t) => (
        <g key={t.label}>
          <line x1={x(t.v)} x2={x(t.v)} y1={base} y2={base + 4} stroke="rgba(255,255,255,0.3)" />
          <text x={x(t.v)} y={base + 15} textAnchor={t.anchor || 'middle'} className="risk-axis">
            {t.label}
          </text>
        </g>
      ))}
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
export default function RiskLab({ legs, graded = [], noCalls = [], plan = null }) {
  const [tab, setTab] = useState('slip');
  const [days, setDays] = useState(30);

  // Same reliability haircut the plan uses: the panel must describe the same
  // bets the rest of the page prices, or the two disagree about one slip.
  const rel = useMemo(() => reliability(graded), [graded]);
  // Straight off the plan on the table above. A leg the plan declines to back
  // is staked zero, not quietly given a default: a plan that skips a match is
  // making a statement, and inventing a stake for it would describe a slip
  // nobody proposed.
  const singles = useMemo(() => (plan && plan.singles) || {}, [plan]);
  const stakeOf = (l) => Number(singles[l.id]) || 0;

  // The card this panel prices. Normally the calls, because the plan above
  // never funds anything else. But Custom lets someone stake a match we
  // declined to call, and a risk read that silently ignored that money would
  // be describing a slip they are not holding. A pass joins the moment it
  // carries a stake, and not before.
  const card = useMemo(() => {
    const staked = noCalls.filter((l) => Number(singles[l.id]) > 0);
    return staked.length ? [...legs, ...staked] : legs;
  }, [legs, noCalls, singles]);
  const isIn = (l) => ((plan && plan.parlayLegs) || []).includes(l.id) && defaultOdds(l) > 1;

  const bets = useMemo(() => card.map((l) => ({
    key: l.id,
    p: cappedProb(l.favProb, defaultOdds(l), { lambda: rel.lambda }),
    o: defaultOdds(l),
    single: stakeOf(l),
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [card, singles, rel.lambda]);

  const parlayLegs = useMemo(() => card.filter(isIn).map((l) => l.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, plan]);

  const parStake = Number(plan && plan.parlayStake) || 0;
  const analysis = useMemo(
    () => analyzeSlip(bets, { stake: parStake, legs: parlayLegs }),
    [bets, parStake, parlayLegs]
  );
  const combo = useMemo(() => parlayCombo(bets, parlayLegs), [bets, parlayLegs]);

  // The budget from the plan above IS the bankroll. They were two inputs for
  // one idea: the money you have set aside to play with. Asking for it twice
  // invited them to disagree, and a Kelly reading is only as honest as the
  // number it is sized against.
  const bank = Number(plan && plan.budget) || DEFAULT_BANKROLL;
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

  const backedCount = useMemo(() => bets.filter((b) => (b.single || 0) > 0).length, [bets]);

  // The chance of the ceiling actually arriving: every bet in the slip wins at
  // once, so the product over every leg that carries money. Read off the
  // distribution at first, which returned zero whenever the best case landed
  // outside the p99 clip the chart is drawn across - and on a slip of short
  // favourites the best case is not a rare event at all.
  const pBest = useMemo(() => {
    const keys = new Set(bets.filter((b) => (b.single || 0) > 0).map((b) => b.key));
    if (parStake > 0) for (const k of parlayLegs) keys.add(k);
    if (!keys.size) return 0;
    return bets.filter((b) => keys.has(b.key)).reduce((s2, b) => s2 * b.p, 1);
  }, [bets, parStake, parlayLegs]);

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

  if (!card.length) return null;
  const nothingStaked = staked <= 0;

  return (
    <section className="risk-lab" aria-label="Risk Lab">
      <div className="risk-head">
        <div>
          <div className="risk-cap">What it does to you</div>
          {/* Names its input out loud. The panel is downstream of the table
              above, and a reader who cannot see why a number moved will not
              trust the number. */}
          <p className="risk-sub">
            {money0(staked)} of your {money0(bank)} on{' '}
            {card.filter((l) => stakeOf(l) > 0).length} of today&apos;s{' '}
            {legs.length + noCalls.length} matches
            {parStake > 0 ? `, ${money0(parStake)} of it on the parlay` : ''}.
            Change the plan above and everything here follows.
          </p>
        </div>
      </div>

      <div className="risk-exposure">
        <div className="risk-exposure-bar">
          <span style={{ width: `${Math.min(100, bank > 0 ? (staked / bank) * 100 : 0)}%` }}
            className={staked / Math.max(bank, 1) > 0.25 ? 'hot' : ''} />
        </div>
        <div className="risk-exposure-cap">
          <strong>{money(staked)}</strong> at risk today
          {bank > 0 && <> · {pct1(staked / bank)} of your {money0(bank)} budget</>}
          {/* Matches BACKED, not matches on the card. The plan above funds a
              handful and skips the rest, so counting the card claimed a
              fifteen-match exposure on a seven-match slip. */}
          {' '}· {backedCount} match{backedCount === 1 ? '' : 'es'}
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
                    {' '}({money(kelly.staked)} staked, growth-optimal is {money(kelly.kellyStake)} on a {money0(bank)} budget)
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
                  <span className="risk-metric-l">of your budget on the table today</span>
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

      <p className="risk-fine">
        Every figure here follows from your stakes and our probabilities, both of which can be
        wrong. A probability tool, not betting advice.
      </p>
    </section>
  );
}
