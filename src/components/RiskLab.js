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
import { analyzeSlip, parlayCombo, reliability, adjustProb } from '../utils/staking';
import { lossExceedance, kellyCheck, simulateBankroll, expectedLosingStreak, outcomePairs } from '../utils/riskLab';
import './RiskLab.css';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v || 0).toFixed(2)}`;
const money0 = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v || 0))}`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v) => `${Math.round(v * 100)}%`;
const defaultOdds = (l) => Number(l.favorite === l.p1 ? l.lockOdd1 : l.lockOdd2) || 0;

// ── Charts ──────────────────────────────────────────────────────────────────

// Loss exceedance: "the chance you lose at least this much". A descending
// curve rather than a histogram, because the question is cumulative - nobody
// asks the odds of losing exactly $37.
function ExceedanceChart({ steps, staked }) {
  if (!steps || steps.length < 2) return null;
  const w = 300, h = 108, padL = 30, padB = 20, padT = 8, padR = 6;
  const maxP = Math.max(...steps.map((s) => s.prob), 0.01);
  const x = (i) => padL + (i / (steps.length - 1)) * (w - padL - padR);
  const y = (p) => padT + (1 - p / maxP) * (h - padT - padB);
  const pts = steps.map((s, i) => `${x(i).toFixed(1)},${y(s.prob).toFixed(1)}`).join(' ');
  return (
    <svg className="risk-chart" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Chance of losing at least a given amount, from ${money0(steps[0].loss)} at ${pct0(steps[0].prob)} down to ${money0(steps[steps.length - 1].loss)} at ${pct0(steps[steps.length - 1].prob)}.`}>
      <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="rgba(255,255,255,0.16)" />
      <polygon points={`${padL},${h - padB} ${pts} ${x(steps.length - 1)},${h - padB}`} fill="rgba(255,92,92,0.16)" />
      <polyline points={pts} fill="none" stroke="#ff8f8f" strokeWidth="2" strokeLinejoin="round" />
      {steps.map((s, i) => (
        <circle key={i} cx={x(i)} cy={y(s.prob)} r="2.5" fill="#ff8f8f">
          <title>{`${pct1(s.prob)} chance of losing ${money0(s.loss)} or more`}</title>
        </circle>
      ))}
      <text x={padL - 4} y={padT + 6} textAnchor="end" className="risk-axis">{pct0(maxP)}</text>
      <text x={padL - 4} y={h - padB} textAnchor="end" className="risk-axis">0</text>
      <text x={padL} y={h - 6} className="risk-axis">{money0(steps[0].loss)}</text>
      <text x={w - padR} y={h - 6} textAnchor="end" className="risk-axis">
        {money0(steps[steps.length - 1].loss)}{steps[steps.length - 1].loss >= staked - 0.01 ? ' (all of it)' : ''}
      </text>
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

export default function RiskLab({ legs, graded = [] }) {
  const [tab, setTab] = useState('slip');
  const [bankroll, setBankroll] = useState(500);
  const [flat, setFlat] = useState(10);
  const [parlayStake, setParlayStake] = useState(0);
  const [override, setOverride] = useState({});   // { id: stake }
  const [inParlay, setInParlay] = useState({});   // { id: bool }, default true
  const [days, setDays] = useState(30);

  // Same reliability haircut the plan uses: the panel must describe the same
  // bets the rest of the page prices, or the two disagree about one slip.
  const rel = useMemo(() => reliability(graded), [graded]);
  const stakeOf = (l) => (override[l.id] != null ? Number(override[l.id]) || 0 : Number(flat) || 0);
  const isIn = (l) => (inParlay[l.id] != null ? inParlay[l.id] : true) && defaultOdds(l) > 1;

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

  const ladder = useMemo(() => {
    if (!analysis.dist || staked <= 0) return [];
    const levels = [0.1, 0.25, 0.5, 0.75, 1].map((f) => +(staked * f).toFixed(2));
    return lossExceedance(analysis.dist, levels);
  }, [analysis.dist, staked]);

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
    <section className="risk-lab" aria-label="Size your risk">
      <div className="risk-head">
        <div>
          <div className="risk-cap">Size your risk</div>
          <p className="risk-sub">
            The plan above says what we would stake. This says what happens to <em>you</em> if you
            stake something else. Put in your own bankroll and stakes: nothing here is a
            recommendation, it is the consequence of the numbers you type.
          </p>
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
            onChange={(e) => { setFlat(e.target.value); setOverride({}); }} /></span>
        </label>
        <label className="risk-input">
          <span>Parlay stake</span>
          <span className="risk-money">$<input type="number" min="0" step="5" value={parlayStake}
            onChange={(e) => setParlayStake(e.target.value)} /></span>
        </label>
      </div>

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
        {[['slip', 'This slip'], ['repeat', 'Repeated'], ['limits', 'My limits']].map(([id, label]) => (
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
          </div>

          <div className="risk-chart-block">
            <div className="risk-chart-cap">How likely is a loss of at least this size</div>
            <ExceedanceChart steps={ladder} staked={staked} />
            <ul className="risk-ladder">
              {ladder.map((s) => (
                <li key={s.loss}>
                  <span>{money0(s.loss)} or worse</span>
                  <strong>{s.prob < 0.001 && s.prob > 0 ? '<0.1%' : pct1(s.prob)}</strong>
                </li>
              ))}
            </ul>
            <p className="risk-note">
              Losing everything staked means every match on the slip going against you at once,
              which is why that last figure is usually tiny. It is not zero.
            </p>
          </div>
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

      <details className="risk-legs">
        <summary>Per-match stakes ({legs.length})</summary>
        <div className="risk-legs-list">
          {legs.map((l) => {
            const o = defaultOdds(l);
            return (
              <div className="risk-leg" key={l.id}>
                <span className="risk-leg-name">
                  {lastName(l.favName)}
                  <em>over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {o > 1 ? o.toFixed(2) : 'no price'}</em>
                </span>
                <span className="risk-leg-stake">
                  $<input type="number" min="0" step="1" value={override[l.id] ?? flat}
                    onChange={(e) => setOverride((s) => ({ ...s, [l.id]: e.target.value }))} />
                </span>
                <span className="risk-leg-par">
                  <input type="checkbox" aria-label={`Include ${lastName(l.favName)} in the parlay`}
                    checked={isIn(l)} disabled={!(o > 1)}
                    onChange={() => setInParlay((s) => ({ ...s, [l.id]: !isIn(l) }))} />
                </span>
              </div>
            );
          })}
        </div>
      </details>

      <p className="risk-fine">
        Every figure here follows from your stakes and our probabilities, both of which can be
        wrong. A probability tool, not betting advice.
      </p>
    </section>
  );
}
