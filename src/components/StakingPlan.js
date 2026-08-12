// src/components/StakingPlan.js
//
// The Parlay builder's Staking Plan: honest EV + risk for a slip of singles
// and a parlay, in two modes - "My stakes" (grade what you'd bet, then balance
// it to break-even) and "From budget" (recommend a break-even-or-better split).
// All the math lives in utils/staking; this is just the controls and readout.
import React, { useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { analyzeSlip, recommendStakes, edgePerDollar, parlayCombo } from '../utils/staking';
import './StakingPlan.css';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v || 0).toFixed(2)}`;
const pctSigned = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const defaultOdds = (l) => Number(l.favorite === l.p1 ? l.lockOdd1 : l.lockOdd2) || 0;

export default function StakingPlan({ legs }) {
  const [mode, setMode] = useState('mine');
  const [stakes, setStakes] = useState({});        // { id: singleStake }
  const [oddsOverride, setOddsOverride] = useState({}); // { id: decimalOdds }
  const [inParlay, setInParlay] = useState({});    // { id: bool }, default true
  const [parlayStake, setParlayStake] = useState(0);
  const [budget, setBudget] = useState(50);

  const oddsOf = (l) => (oddsOverride[l.id] != null ? oddsOverride[l.id] : defaultOdds(l));
  const isIn = (l) => (inParlay[l.id] != null ? inParlay[l.id] : true) && oddsOf(l) > 1;
  const parlayLegIds = legs.filter(isIn).map((l) => l.id);

  // Bets carry the odds you'll actually get; singles come from your inputs
  // (My stakes) or from the recommender (From budget).
  const priceBets = (singleFor) => legs.map((l) => ({
    key: l.id, p: l.favProb, o: oddsOf(l), single: singleFor(l),
  }));

  const rec = useMemo(() => {
    if (mode !== 'budget') return null;
    const bets = priceBets(() => 0);
    return recommendStakes(bets, parlayLegIds, Number(budget) || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, budget, legs, oddsOverride, inParlay]);

  const singleFor = (l) => (mode === 'budget' ? (rec?.singles[l.id] || 0) : (Number(stakes[l.id]) || 0));
  const bets = priceBets(singleFor);
  const parStake = mode === 'budget' ? (rec?.parlay || 0) : (Number(parlayStake) || 0);
  const analysis = useMemo(
    () => analyzeSlip(bets, { stake: parStake, legs: parlayLegIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bets, parStake, parlayLegIds]
  );
  const combo = parlayCombo(bets, parlayLegIds);

  // "Balance to break-even": keep the same total on the table, but move it onto
  // the +EV bets only (a -EV leg can't be sized to break even, so it goes to 0).
  const balance = () => {
    const total = analysis.staked || Number(budget) || 0;
    const r = recommendStakes(priceBets(() => 0), parlayLegIds, total);
    setStakes(Object.fromEntries(legs.map((l) => [l.id, +(r.singles[l.id] || 0).toFixed(2)])));
    setParlayStake(+(r.parlay || 0).toFixed(2));
  };

  const anyPriced = legs.some((l) => oddsOf(l) > 1);
  const evClass = analysis.breakEven ? 'pos' : 'neg';

  return (
    <div className="stake-plan">
      <div className="stake-head">
        <div>
          <div className="stake-cap">Staking plan</div>
          <p className="stake-sub">
            Size your singles and parlay so the slip's expected value is break-even or better.
            Edge is <strong>your odds × our win probability − 1</strong>; a bet is only worth
            staking when that's positive.
          </p>
        </div>
        <div className="stake-modes" role="tablist" aria-label="Staking mode">
          <button type="button" role="tab" aria-selected={mode === 'mine'} className={mode === 'mine' ? 'on' : ''} onClick={() => setMode('mine')}>My stakes</button>
          <button type="button" role="tab" aria-selected={mode === 'budget'} className={mode === 'budget' ? 'on' : ''} onClick={() => setMode('budget')}>From budget</button>
        </div>
      </div>

      {mode === 'budget' && (
        <label className="stake-budget">
          Total to stake
          <span className="stake-budget-in">$<input type="number" min="0" step="5" value={budget} onChange={(e) => setBudget(e.target.value)} /></span>
          <span className="stake-budget-note">Split across only the +EV bets, by edge strength (Kelly). Guaranteed break-even or better.</span>
        </label>
      )}

      <div className="stake-table" role="table">
        <div className="stake-row stake-row-head" role="row">
          <span>Pick</span><span>Your odds</span><span>Edge</span><span>{mode === 'budget' ? 'Suggested' : 'Single $'}</span><span>Parlay</span>
        </div>
        {legs.map((l) => {
          const o = oddsOf(l);
          const e = edgePerDollar(l.favProb, o);
          const stake = singleFor(l);
          return (
            <div className={`stake-row${e != null && e < 0 ? ' neg' : ''}`} role="row" key={l.id}>
              <span className="stake-pick">
                <strong>{lastName(l.favName)}</strong>
                <em>over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {pct(l.favProb)}</em>
              </span>
              <span className="stake-odds">
                <input type="number" min="1" step="0.01" value={o || ''} placeholder="—"
                  onChange={(e2) => setOddsOverride((s) => ({ ...s, [l.id]: parseFloat(e2.target.value) || 0 }))} />
              </span>
              <span className={`stake-edge ${e == null ? 'na' : e >= 0 ? 'pos' : 'neg'}`}>
                {e == null ? 'no price' : pctSigned(e)}
              </span>
              <span className="stake-single">
                {mode === 'budget'
                  ? <span className="stake-suggest">{stake > 0 ? money(stake) : '—'}</span>
                  : <input type="number" min="0" step="1" value={stakes[l.id] ?? ''} placeholder="0"
                      disabled={!(o > 1)}
                      onChange={(e2) => setStakes((s) => ({ ...s, [l.id]: e2.target.value }))} />}
              </span>
              <span className="stake-inpar">
                <input type="checkbox" aria-label="Include in parlay" checked={isIn(l)} disabled={!(o > 1)}
                  onChange={() => setInParlay((s) => ({ ...s, [l.id]: !isIn(l) }))} />
              </span>
            </div>
          );
        })}

        {combo.priced && (
          <div className="stake-row stake-row-parlay" role="row">
            <span className="stake-pick"><strong>Parlay</strong><em>{combo.n} legs · lands {pct(combo.p)}</em></span>
            <span className="stake-odds fixed">{combo.o.toFixed(2)}</span>
            <span className={`stake-edge ${combo.edge >= 0 ? 'pos' : 'neg'}`}>{pctSigned(combo.edge)}</span>
            <span className="stake-single">
              {mode === 'budget'
                ? <span className="stake-suggest">{parStake > 0 ? money(parStake) : '—'}</span>
                : <input type="number" min="0" step="1" value={parlayStake || ''} placeholder="0"
                    onChange={(e2) => setParlayStake(e2.target.value)} />}
            </span>
            <span />
          </div>
        )}
      </div>

      {!anyPriced && (
        <p className="stake-note muted">None of these carry a market price, so there's no edge to size against. Enter the odds you're offered above.</p>
      )}

      {analysis.staked > 0 ? (
        <div className={`stake-out ${evClass}`}>
          <div className="stake-out-grid">
            <div className="stake-metric big">
              <span className="stake-metric-v">{money(analysis.ev)}</span>
              <span className="stake-metric-l">expected value {analysis.staked > 0 && <em>({pctSigned(analysis.roi)} of stake)</em>}</span>
            </div>
            <div className="stake-metric"><span className="stake-metric-v">{money(analysis.staked)}</span><span className="stake-metric-l">total staked</span></div>
            <div className="stake-metric"><span className="stake-metric-v">{analysis.pProfit != null ? pct(analysis.pProfit) : '—'}</span><span className="stake-metric-l">chance you finish ahead</span></div>
            <div className="stake-metric"><span className="stake-metric-v">{money(analysis.best)}</span><span className="stake-metric-l">best case</span></div>
            <div className="stake-metric"><span className="stake-metric-v">{money(analysis.worst)}</span><span className="stake-metric-l">worst case</span></div>
          </div>

          {analysis.dist && (() => {
            const { lo, hi, bins } = analysis.dist;
            const max = Math.max(...bins.map((b) => b.prob), 1e-9);
            const zeroPct = hi > lo ? ((0 - lo) / (hi - lo)) * 100 : 50;
            return (
              <div className="stake-dist">
                <div className="stake-dist-cap">Where you land, by our probabilities</div>
                <div className="stake-dist-plot">
                  <span className="stake-dist-zero" style={{ left: `${zeroPct}%` }} />
                  <div className="stake-dist-bars">
                    {bins.map((b, i) => (
                      <span key={i} className={`stake-dist-bar ${b.win ? 'win' : 'loss'}`}
                        style={{ height: `${Math.max(3, (b.prob / max) * 100)}%` }}
                        title={`${pct(b.prob)} chance`} />
                    ))}
                  </div>
                </div>
                <div className="stake-dist-axis">
                  <span>{money(lo)}</span>
                  <span className="stake-dist-mid">loss ← break-even → profit</span>
                  <span>+{money(hi).replace('-', '')}</span>
                </div>
              </div>
            );
          })()}

          <div className="stake-verdict">
            {analysis.breakEven
              ? <span className="stake-badge pos">✓ Break-even or better</span>
              : <span className="stake-badge neg">Below break-even</span>}
            {mode === 'mine' && !analysis.breakEven && (
              <>
                <span className="stake-verdict-txt">The slip is −EV. No stake fixes a −EV leg, so balancing moves your total onto the +EV bets only.</span>
                <button type="button" className="stake-balance" onClick={balance}>Balance to break-even</button>
              </>
            )}
            {mode === 'budget' && !rec?.anyPositive && (
              <span className="stake-verdict-txt">No +EV bets on this slate at these odds — the market prices all of them at or above our number, so nothing is worth staking.</span>
            )}
          </div>
        </div>
      ) : (
        <p className="stake-note muted">{mode === 'budget' ? 'Enter a budget above.' : 'Enter a stake on a pick, or a parlay stake, to see the numbers.'}</p>
      )}

      <p className="stake-fine">
        Expected value is a long-run average across many identical slips — any single slip can lose,
        and the worst case above is real. Odds default to the price we locked; edit them to your live
        book. Legs are treated as independent. A probability tool, not betting advice — see{' '}
        <a href="/disclaimer">responsible use</a>.
      </p>
    </div>
  );
}
