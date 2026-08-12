// src/components/StakingPlan.js
//
// The Parlay builder's Staking Plan: honest EV + risk for a slip of singles
// and a parlay, in two modes - "My stakes" (grade what you'd bet, then balance
// it to break-even) and "From budget" (recommend a break-even-or-better split).
//
// The parlay is optional. Untick it and every number below is re-derived for
// singles only, which is the common case: you want per-match stakes and the
// parlay is a separate decision. It stays on screen while switched off so you
// can see what you are leaving on the table.
//
// This table is also the page's only list of your selection - the picks link
// out to their match pages - so the slip above can stay a verdict on value
// while this answers what to actually stake.
// All the math lives in utils/staking; this is just the controls and readout.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lastName } from '../utils/names';
import { matchSlug } from '../utils/matchTime';
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
  const [useParlay, setUseParlay] = useState(true); // master switch: singles only when off
  const [parlayStake, setParlayStake] = useState(0);
  const [budget, setBudget] = useState(50);

  const oddsOf = (l) => (oddsOverride[l.id] != null ? oddsOverride[l.id] : defaultOdds(l));
  const isIn = (l) => (inParlay[l.id] != null ? inParlay[l.id] : true) && oddsOf(l) > 1;
  // Which legs the parlay WOULD cover, versus which it actually does. The
  // master switch only empties the second: the per-leg ticks stay live so
  // switching the parlay back on restores exactly the combination you built.
  // Both are memoised because analyzeSlip enumerates 2^n outcomes off them.
  const pickedLegIds = useMemo(
    () => legs.filter(isIn).map((l) => l.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legs, oddsOverride, inParlay]
  );
  const parlayLegIds = useMemo(
    () => (useParlay ? pickedLegIds : []),
    [useParlay, pickedLegIds]
  );

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
  }, [mode, budget, legs, oddsOverride, inParlay, useParlay]);

  const singleFor = (l) => (mode === 'budget' ? (rec?.singles[l.id] || 0) : (Number(stakes[l.id]) || 0));
  const bets = priceBets(singleFor);
  const parStake = useParlay
    ? (mode === 'budget' ? (rec?.parlay || 0) : (Number(parlayStake) || 0))
    : 0;
  const analysis = useMemo(
    () => analyzeSlip(bets, { stake: parStake, legs: parlayLegIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bets, parStake, parlayLegIds]
  );
  // Priced off the legs you ticked, not off what is switched on, so the row
  // can still show what the parlay is worth while it sits idle.
  const combo = parlayCombo(bets, pickedLegIds);

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

  // What the whole selection is worth, before any staking question. Computed
  // over EVERY selected leg (not just the ones ticked into the parlay) and off
  // the odds in the table, so editing a price moves this too. This used to be
  // a separate "Your selection" panel above the plan; same numbers, one place.
  const allProb = legs.reduce((m, l) => m * l.favProb, 1);
  const fairAll = allProb > 0 ? 1 / allProb : null;
  const allPriced = legs.length > 0 && legs.every((l) => oddsOf(l) > 1);
  const marketAll = allPriced ? legs.reduce((m, l) => m * oddsOf(l), 1) : null;
  const unpriced = legs.filter((l) => !(oddsOf(l) > 1)).length;
  // "About one in N" only earns its place once the number gets small; next to
  // 59% it says nothing.
  const oneIn = allProb > 0 && allProb < 0.4 ? Math.round(1 / allProb) : null;

  return (
    <div className="stake-plan">
      <div className="stake-value">
        <div className="stake-value-hero">
          <span className="stake-value-pct">{pct(allProb)}</span>
          <span className="stake-value-cap">
            {legs.length === 1 ? 'chance this lands' : `chance all ${legs.length} land`}
            {oneIn ? ` · about 1 in ${oneIn}` : ''}
          </span>
        </div>
        <dl className="stake-value-rows">
          <div>
            <dt>Our fair price</dt>
            <dd>{fairAll ? fairAll.toFixed(2) : '-'}</dd>
          </div>
          <div>
            <dt>The market's price</dt>
            <dd>{marketAll ? marketAll.toFixed(2) : <span className="muted">not fully priced</span>}</dd>
          </div>
          <div>
            <dt>$10 would return</dt>
            <dd>{marketAll ? money(10 * marketAll) : <span className="muted">-</span>}</dd>
          </div>
        </dl>
      </div>

      {marketAll != null && fairAll != null && (
        <p className={`stake-value-verdict ${marketAll > fairAll ? 'pos' : 'neg'}`}>
          {marketAll > fairAll
            ? `The market prices this longer than we do: worth ${fairAll.toFixed(2)} by our numbers, paying ${marketAll.toFixed(2)}.`
            : `The market prices this shorter than we do: worth ${fairAll.toFixed(2)} by our numbers, paying only ${marketAll.toFixed(2)}.`}
          {marketAll > fairAll && (
            <span className="stake-value-caveat">
              {' '}Expect to see that often, and read it carefully: we always show the player we
              favour, so our number sits about 2 points above the market's on a typical pick
              before anyone has been proved right. Only gaps past 10 points have historically
              meant anything.
            </span>
          )}
        </p>
      )}
      {unpriced > 0 && (
        <p className="stake-note muted">
          {unpriced} of these had no market price when we locked {unpriced === 1 ? 'it' : 'them'}, so
          only our own fair price is shown above. Enter the odds you are offered below to size them.
        </p>
      )}

      <div className="stake-head">
        <div>
          <div className="stake-cap">Staking plan</div>
          <p className="stake-sub">
            Size your singles and parlay so the slip's expected value is break-even or better.
            Edge is <strong>your odds × our win probability − 1</strong>; a bet is only worth
            staking when that's positive. Untick the parlay to size the singles on their own.
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
          <span className="stake-budget-note">
            Split across only the +EV {useParlay ? 'bets' : 'singles'}, by edge strength (Kelly).
            Guaranteed break-even or better.
          </span>
        </label>
      )}

      <div className={`stake-table${useParlay ? '' : ' no-parlay'}`} role="table">
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
                <strong><Link to={`/match/${matchSlug(l)}`}>{lastName(l.favName)}</Link></strong>
                <em>over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {pct(l.favProb)}</em>
              </span>
              <span className="stake-odds">
                <input type="number" min="1" step="0.01" value={o || ''} placeholder="–"
                  onChange={(e2) => setOddsOverride((s) => ({ ...s, [l.id]: parseFloat(e2.target.value) || 0 }))} />
              </span>
              <span className={`stake-edge ${e == null ? 'na' : e >= 0 ? 'pos' : 'neg'}`}>
                {e == null ? 'no price' : pctSigned(e)}
              </span>
              <span className="stake-single">
                {mode === 'budget'
                  ? <span className="stake-suggest">{stake > 0 ? money(stake) : '–'}</span>
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
          <div className={`stake-row stake-row-parlay${useParlay ? '' : ' off'}`} role="row">
            <span className="stake-pick">
              <strong>Parlay</strong>
              <em>
                {combo.n} legs · lands {pct(combo.p)} · fair {(1 / combo.p).toFixed(2)}
                {!useParlay && ' · not staked'}
              </em>
            </span>
            <span className="stake-odds fixed">{combo.o.toFixed(2)}</span>
            <span className={`stake-edge ${combo.edge >= 0 ? 'pos' : 'neg'}`}>{pctSigned(combo.edge)}</span>
            <span className="stake-single">
              {mode === 'budget'
                ? <span className="stake-suggest">{parStake > 0 ? money(parStake) : '–'}</span>
                : <input type="number" min="0" step="1" value={parlayStake || ''} placeholder="0"
                    disabled={!useParlay}
                    onChange={(e2) => setParlayStake(e2.target.value)} />}
            </span>
            <span className="stake-inpar">
              <input type="checkbox" aria-label="Include the parlay in this plan"
                checked={useParlay} onChange={() => setUseParlay((v) => !v)} />
            </span>
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
            <div className="stake-metric"><span className="stake-metric-v">{analysis.pProfit != null ? pct(analysis.pProfit) : '–'}</span><span className="stake-metric-l">chance you finish ahead</span></div>
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
              <span className="stake-verdict-txt">No +EV bets on this slate at these odds: the market prices all of them at or above our number, so nothing is worth staking.</span>
            )}
          </div>
        </div>
      ) : (
        <p className="stake-note muted">{mode === 'budget' ? 'Enter a budget above.' : 'Enter a stake on a pick, or a parlay stake, to see the numbers.'}</p>
      )}

      <p className="stake-fine">
        Expected value is a long-run average across many identical slips: any single slip can lose,
        and the worst case above is real. Odds default to the price we locked; edit them to your live
        book. Legs are treated as independent. A probability tool, not betting advice, see{' '}
        <a href="/disclaimer">responsible use</a>.
      </p>
    </div>
  );
}
