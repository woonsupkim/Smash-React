// src/components/StakingPlan.js
//
// The Parlay builder's Staking Plan.
//
// Lands on a RECOMMENDATION, because that is what the page is for: arrive and
// be told what to do with a budget. planFrontier returns a short menu of plans
// - safest, balanced, most profit - every one of which stakes so its expected
// return covers the total staked. Some include a parlay and some do not; that
// falls out of the objective rather than being a switch the user has to reason
// about. Picking a card re-derives every headline number.
//
// "Customise" then seeds the table FROM the chosen plan, so adjusting is
// editing a good answer rather than building one from nothing, and the same
// headline numbers keep following the edits.
//
// This table is also the page's only list of your selection - the picks link
// out to their match pages - so the slip above can stay a verdict on value
// while this answers what to actually stake.
// All the math lives in utils/staking; this is just the controls and readout.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lastName } from '../utils/names';
import { matchSlug } from '../utils/matchTime';
import { analyzeSlip, recommendStakes, edgePerDollar, parlayCombo, planFrontier, reliability, adjustProb } from '../utils/staking';
import BACKTEST from '../data/planBacktest.json';
import './StakingPlan.css';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v || 0).toFixed(2)}`;
const pctSigned = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const defaultOdds = (l) => Number(l.favorite === l.p1 ? l.lockOdd1 : l.lockOdd2) || 0;

// What a plan is actually made of, in words. "1 bet · incl. a 2-leg parlay"
// was self-contradictory on a parlay-only plan: the one bet WAS the parlay.
function composition(p) {
  const singles = Object.values(p.singles).filter((s) => s > 0).length;
  const legs = p.parlayLegs.length;
  if (!p.parlayStake) return singles === 1 ? '1 single, no parlay' : `${singles} singles, no parlay`;
  if (!singles) return `just a ${legs}-leg parlay`;
  return `${singles} single${singles === 1 ? '' : 's'} + a ${legs}-leg parlay`;
}

// onDrop(leg) removes a match from the slip entirely, which is the job the
// checkbox list above this table used to do before it was folded in here.
export default function StakingPlan({ legs, graded = [], onDrop = null }) {
  // 'budget' = show a recommendation, 'mine' = the user's own stakes. Opens on
  // the recommendation: it needs no input to be useful.
  const [mode, setMode] = useState('budget');
  const [stakes, setStakes] = useState({});        // { id: singleStake }
  const [oddsOverride, setOddsOverride] = useState({}); // { id: decimalOdds }
  const [inParlay, setInParlay] = useState({});    // { id: bool }, default true
  const [useParlay, setUseParlay] = useState(true); // master switch: singles only when off
  const [parlayStake, setParlayStake] = useState(0);
  const [budget, setBudget] = useState(100);

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

  // Bets carry the odds you'll actually get; singles come from your own inputs
  // in Custom, or from the chosen recommendation.
  const priceBets = (singleFor) => legs.map((l) => ({
    key: l.id, p: l.favProb, o: oddsOf(l), single: singleFor(l),
  }));

  // How far the model's stated confidence is actually borne out, measured on
  // its own graded forward record. This is a PLAN-level input: every leg's
  // probability is re-expressed at this reliability before anything is sized,
  // so the plan is built on what the model has been worth, not what it claims.
  const rel = useMemo(() => reliability(graded), [graded]);

  // The recommended plans, computed over the WHOLE day's card: the singles'
  // universe is every match on it, the parlay's universe is every combination
  // of those matches. Each plan stakes so that expected return >= total staked.
  // Not every match gets money, and a funded single need not be in the parlay -
  // both fall out of what clears its price. See utils/staking planFrontier.
  const frontier = useMemo(
    () => planFrontier(priceBets(() => 0), Number(budget) || 0, { lambda: rel.lambda }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legs, oddsOverride, budget, rel.lambda]
  );
  // Which recommendation is on screen. `null` means "whatever the frontier
  // recommends", so the default tracks the card instead of being frozen at
  // mount; an explicit click pins a choice until the card changes under it.
  //
  // This was `useState('safest')`, and no plan has ever had that id. The
  // lookup missed every time and fell through to plans[0], so the plan
  // labelled RECOMMENDED was just the first one pushed - on a full card, the
  // spread at 75.6%/$7.24 while "Best prices only" sat next to it at
  // 90.1%/$17.71, better on both axes and not recommended.
  const [planId, setPlanId] = useState(null);
  const rec = frontier.plans.find((p) => p.id === planId)
    || frontier.plans.find((p) => p.id === frontier.recommendedId)
    || frontier.plans[0]
    || null;

  const singleFor = (l) => (mode === 'budget' ? (rec?.singles[l.id] || 0) : (Number(stakes[l.id]) || 0));
  // The reliability adjustment belongs to the MODEL, not to a mode. Custom
  // stakes used to be scored on raw stated probabilities while the
  // recommendations were scored on adjusted ones, so "Customise this plan" then
  // reported different numbers for the very same allocation. planFrontier
  // adjusts internally off raw input, so the adjustment is applied here only
  // for the paths that score a slip directly.
  const bets = priceBets(singleFor).map((b) => ({ ...b, p: adjustProb(b.p, rel.lambda) }));
  const parStake = mode === 'budget'
    ? (rec?.parlayStake || 0)
    : (useParlay ? (Number(parlayStake) || 0) : 0);
  // A recommendation owns its own parlay legs (searching combinations is the
  // point of asking for one); in custom mode the manual ticks are in charge.
  const activeParlayLegs = useMemo(
    () => (mode === 'budget' ? (rec?.parlayLegs || []) : parlayLegIds),
    [mode, rec, parlayLegIds]
  );
  // The headline numbers are derived from whatever is currently on the table,
  // recommendation or custom, so editing anything moves them immediately.
  const analysis = useMemo(
    () => (mode === 'budget' && rec
      ? rec.metrics
      : analyzeSlip(bets, { stake: parStake, legs: activeParlayLegs })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, rec, bets, parStake, activeParlayLegs]
  );

  // Start a custom plan FROM the recommendation on screen rather than from
  // zero: the point is to adjust a good answer, not to rebuild one.
  const customise = () => {
    setStakes(Object.fromEntries(legs.map((l) => [l.id, +(rec?.singles[l.id] || 0).toFixed(2)])));
    setParlayStake(+(rec?.parlayStake || 0).toFixed(2));
    setInParlay(Object.fromEntries(legs.map((l) => [l.id, (rec?.parlayLegs || []).includes(l.id)])));
    setUseParlay((rec?.parlayStake || 0) > 0);
    setMode('mine');
  };
  // Priced off the legs you ticked, not off what is switched on, so the row
  // can still show what the parlay is worth while it sits idle.
  const combo = parlayCombo(bets, pickedLegIds);
  // In budget mode the parlay row must show the combination the optimiser
  // actually chose and funded, not the one the (now advisory) ticks describe.
  const showCombo = mode === 'budget' && rec?.combo
    ? { ...rec.combo, priced: true }
    : combo;
  // Probabilities everything below is sized on: always the reliability-adjusted
  // number, so the Edge column agrees with the money in both modes.
  const probOf = (l) => adjustProb(l.favProb, rel.lambda);
  const inActiveParlay = (l) => activeParlayLegs.includes(l.id);

  // "Balance to break-even": keep the same total on the table, but move it onto
  // the +EV bets only (a -EV leg can't be sized to break even, so it goes to 0).
  const balance = () => {
    const total = analysis.staked || Number(budget) || 0;
    const r = recommendStakes(priceBets(() => 0), parlayLegIds, total);
    setStakes(Object.fromEntries(legs.map((l) => [l.id, +(r.singles[l.id] || 0).toFixed(2)])));
    setParlayStake(+(r.parlay || 0).toFixed(2));
  };

  // The plan stated the way the question is actually asked: this many of the
  // matches we back are expected to land, and their return is what has to
  // cover the whole stake. Derived from whatever is on the table, so it holds
  // for a custom plan too.
  const backedSingles = bets.filter((b) => (b.single || 0) > 0);
  const expWinners = backedSingles.reduce((s, b) => s + b.p, 0);
  const stakedCount = backedSingles.length;
  const expReturn = analysis.ev + analysis.staked;

  const anyPriced = legs.some((l) => oddsOf(l) > 1);
  const evClass = analysis.breakEven ? 'pos' : 'neg';

  // The everything-lands accumulator - combined probability, our fair price,
  // the market's price, what $10 would return - used to sit here. It is gone
  // on purpose. Across a whole card it priced a bet nobody could place ("1 in
  // 594,237", "$10 would return $17,424,168.83") in the most prominent slot on
  // the page, and even on a short card it answered a question the plan above
  // already answers better. The per-leg parlay row still prices a real
  // accumulator over the legs actually ticked.
  const unpriced = legs.filter((l) => !(oddsOf(l) > 1)).length;

  return (
    <div className="stake-plan">
      {/* No plan clears its price. That IS the recommendation, and saying so
          plainly beats showing a losing plan dressed up as the best one. */}
      {mode === 'budget' && frontier.plans.length === 0 && anyPriced && (
        <div className="stake-best none">
          <div className="stake-best-head">
            <span className="stake-cap">No plan worth staking today</span>
          </div>
          <p className="stake-best-why">
            {frontier.reason}, and that covers every combination of today&apos;s matches as well as
            the picks on their own. Spread evenly or concentrated, these prices do not return what
            it costs to back them, so the honest plan is to sit today out. If your book prices any
            of them longer than ours, enter it below and the plan reappears.
          </p>
        </div>
      )}

      {analysis.staked > 0 && (
        <div className="stake-best">
          <div className="stake-best-head">
            <span className="stake-cap">{mode === 'budget' ? 'Recommended plan' : 'Your plan'}</span>
            <span className="stake-best-sub">
              {mode === 'budget'
                ? <>{composition(rec)}, from today&apos;s {legs.length} match{legs.length === 1 ? '' : 'es'} · {money(analysis.staked)} staked</>
                : <>{money(analysis.staked)} staked · edit anything below and these numbers follow</>}
            </span>
          </div>

          {/* The menu now leads with RETURN PER DOLLAR, and says what each
              plan stakes right next to it.
              Both of the old columns - chance of finishing ahead, and expected
              profit in dollars - mechanically reward shovelling the whole
              budget onto the table, because more bets means more ways to end
              the day up and more capital means more expected dollars. The
              recommended plan deliberately stakes about a third of the budget,
              so it lost on both columns and appeared, on the page's own
              numbers, to be the worst thing on the menu. It is not: it is the
              best return on the money actually at risk, which is the axis a
              follower with a fixed daily budget should be reading. */}
          {mode === 'budget' && frontier.plans.length > 1 && (
            <div className="stake-best-pick" role="radiogroup" aria-label="Which recommended plan">
              {frontier.plans.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === rec.id}
                  className={`stake-best-opt${p.id === rec.id ? ' on' : ''}`}
                  onClick={() => setPlanId(p.id)}>
                  <span className="stake-best-opt-l">
                    {p.label}
                    {p.id === frontier.recommendedId && <span className="stake-best-opt-rec">recommended</span>}
                  </span>
                  <span className="stake-best-opt-v">
                    {p.metrics.staked > 0 ? pctSigned(p.metrics.ev / p.metrics.staked) : '–'} on the money staked
                  </span>
                  <span className="stake-best-opt-k">
                    stakes {money(p.metrics.staked)} of {money(Number(budget) || 0)} · {composition(p)}
                    {/* Never `pProfit || 0`: a missing probability is not a
                        zero one, and printing "0.0%" for it stated the most
                        discouraging possible number with total confidence. */}
                    {p.metrics.pProfit != null ? ` · ${pct(p.metrics.pProfit)} to finish ahead` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="stake-best-grid">
            {/* Percentage first, dollars second. The raw dollar figure is
                not comparable between plans that stake different amounts,
                and it is the number a reader instinctively compares. */}
            <div className="stake-best-metric">
              <span className={`stake-best-v${analysis.ev >= 0 ? ' pos' : ' neg'}`}>{pctSigned(analysis.roi)}</span>
              <span className="stake-best-l">expected return <em>on the {money(analysis.staked)} staked</em></span>
            </div>
            <div className="stake-best-metric">
              <span className={`stake-best-v${analysis.ev >= 0 ? ' pos' : ' neg'}`}>{money(analysis.ev)}</span>
              <span className="stake-best-l">expected profit <em>in dollars</em></span>
            </div>
            <div className="stake-best-metric">
              <span className="stake-best-v">{analysis.pProfit != null ? pct(analysis.pProfit) : '–'}</span>
              <span className="stake-best-l">chance of finishing ahead <em>today</em></span>
            </div>
            {/* "matches we expect to land" used to sit here. It is decorative
                for someone following the plan - it does not change what they
                stake or what they can expect back - and it competed with the
                four numbers that do. The same figure still appears in the
                sentence below, where it reads as reasoning rather than as a
                headline metric. */}
            {/* The extremes are not the forecast. On a 40-match spread
                "everything lands" and "nothing does" both have probabilities
                with twenty zeros after the point, and leading with -$100 as
                the downside invited readers to plan around an outcome that
                will never happen. A 19-in-20 range is the honest answer to
                "how bad is a bad day". The true extremes stay in the note
                under the table for anyone who wants them. */}
            {analysis.pcts ? (
              <>
                <div className="stake-best-metric">
                  <span className="stake-best-v">{money(analysis.pcts.p95)}</span>
                  <span className="stake-best-l">a good day <em>(1 in 20 beats this)</em></span>
                </div>
                <div className="stake-best-metric">
                  <span className={`stake-best-v${analysis.pcts.p05 < 0 ? ' neg' : ''}`}>{money(analysis.pcts.p05)}</span>
                  <span className="stake-best-l">a bad day <em>(1 in 20 is worse)</em></span>
                </div>
              </>
            ) : (
              <>
                <div className="stake-best-metric">
                  <span className="stake-best-v">{money(analysis.best)}</span>
                  <span className="stake-best-l">if everything lands</span>
                </div>
                <div className="stake-best-metric">
                  <span className="stake-best-v neg">{money(analysis.worst)}</span>
                  <span className="stake-best-l">if nothing does</span>
                </div>
              </>
            )}
          </div>

          {mode === 'budget' && (
            <button type="button" className="stake-best-custom" onClick={customise}>
              Customise this plan →
            </button>
          )}
          {/* Trimmed to one claim per sentence. This paragraph had grown to
              six sentences of hedging above the fold; the reasoning that a
              curious reader wants is now in the disclosure below, and the
              reader who just wants to place the bets is not made to wade
              through it first. */}
          <p className="stake-best-why">
            <strong>
              {money(analysis.staked)} across {stakedCount} match{stakedCount === 1 ? '' : 'es'}.
              {mode === 'budget' && analysis.staked < (Number(budget) || 0) - 0.5
                ? ` The other ${money((Number(budget) || 0) - analysis.staked)} stays in your pocket, on purpose.`
                : ''}
            </strong>{' '}
            We expect {expWinners.toFixed(1)} to land, returning {money(expReturn)}
            {expReturn >= analysis.staked - 1e-9 ? ', which covers the stake.' : ', short of the stake.'}
          </p>

          {/* How the recommendation is made, in the reader's own words:
              "why this one?" was unanswerable on the page, and the plan that
              leads is the one that stakes least, which looks arbitrary
              without the reasoning. Collapsed so it informs without
              crowding. */}
          {mode === 'budget' && (
            <details className="stake-why">
              <summary>How this plan gets chosen{rec ? ` (and why it is ${rec.label.toLowerCase()})` : ''}</summary>
              <div className="stake-why-body">
                <p>
                  Every plan on the menu is scored on <strong>return per dollar staked</strong>, not on
                  total dollars. A plan that puts the whole budget down will almost always show a bigger
                  expected profit and a higher chance of finishing ahead, simply because more money is
                  on the table. That is not an edge, it is arithmetic, and comparing plans that way would
                  recommend the biggest bet every single day.
                </p>
                <p>
                  The lead plan is <strong>fixed policy, not a daily beauty contest</strong>. It was picked
                  by replaying {BACKTEST.windowDays} tournament days of graded calls through every
                  candidate rule, walk-forward, settled at the prices stamped before play. Funding only
                  calls priced better than we rate them, at a quarter of Kelly, staked on{' '}
                  {BACKTEST.edge.days} of those days and returned <strong>+{BACKTEST.edge.roi}%</strong> on
                  money staked, with a worst day of −${BACKTEST.edge.worst} and a ${BACKTEST.edge.maxDD}{' '}
                  deepest drawdown per $100 of budget. Backing the whole card returned{' '}
                  +{BACKTEST.spread.roi}% for {(BACKTEST.spread.staked / BACKTEST.edge.staked).toFixed(1)}× the
                  money at risk and {(BACKTEST.spread.maxDD / BACKTEST.edge.maxDD).toFixed(1)}× the drawdown.
                </p>
                <p>
                  Picking a different plan each morning based on that morning&apos;s numbers would be
                  fitting to noise, so the recommendation does not move. You can still override it: the
                  menu above switches the plan and every number on this page follows.
                </p>
                {rel.trusted && (
                  <p className="stake-why-cal">
                    Stakes are sized on what the model has actually done, not on what it claims:{' '}
                    {pct(rel.accuracy)} of {rel.n} graded calls landed while claiming {pct(rel.stated)}, and
                    the probabilities are shaded toward the truth by that gap before any money is sized.
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {unpriced > 0 && (
        <p className="stake-note muted">
          {unpriced} of these had no market price when we locked {unpriced === 1 ? 'it' : 'them'}, so
          the plan cannot stake {unpriced === 1 ? 'it' : 'them'}. Enter the odds you are offered
          below and {unpriced === 1 ? 'it joins' : 'they join'} the plan.
        </p>
      )}

      <div className="stake-head">
        <div>
          <div className="stake-cap">{mode === 'budget' ? 'The plan, bet by bet' : 'Your bets'}</div>
          <p className="stake-sub">
            {mode === 'budget'
              ? <>Every bet the recommendation funds, and what it puts on each. Edge is <strong>your odds × our win probability − 1</strong>. A match can carry a negative edge and still be worth backing here, so long as the spread as a whole still returns the stake. Switch to Custom to change any of it.</>
              : <>Set your own stakes, tick which matches go in the parlay, and edit any price to your book. Every number above updates as you go.</>}
          </p>
        </div>
        <div className="stake-modes" role="tablist" aria-label="Recommended plan or your own">
          <button type="button" role="tab" aria-selected={mode === 'budget'} className={mode === 'budget' ? 'on' : ''} onClick={() => setMode('budget')}>Recommended</button>
          {/* Seed from the recommendation, exactly as "Customise this plan"
              does. This tab used to only flip the mode, so it landed on an
              empty table: every stake blank, staked = 0, and the whole
              headline block unmounts because it is gated on staked > 0. The
              numbers did not go stale, they disappeared - directly under copy
              promising "edit anything below and these numbers follow". */}
          <button type="button" role="tab" aria-selected={mode === 'mine'} className={mode === 'mine' ? 'on' : ''} onClick={customise}>Custom</button>
        </div>
      </div>

      {mode === 'budget' && (
        <label className="stake-budget">
          Total to stake
          <span className="stake-budget-in">$<input type="number" min="0" step="5" value={budget} onChange={(e) => setBudget(e.target.value)} /></span>
          <span className="stake-budget-note">
            Split evenly across every match the plan backs.
          </span>
        </label>
      )}

      <div className={`stake-table${useParlay ? '' : ' no-parlay'}${onDrop ? ' has-drop' : ''}`} role="table">
        {/* role="row" requires columnheader/cell children, so every span in
            this grid carries one. Without them the table announces as a bare
            group and axe flags it critical. */}
        <div className="stake-row stake-row-head" role="row">
          <span role="columnheader">Pick</span>
          <span role="columnheader">Your odds</span>
          <span role="columnheader">Edge</span>
          <span role="columnheader">{mode === 'budget' ? 'Suggested' : 'Single $'}</span>
          <span role="columnheader">Parlay</span>
          {onDrop && <span role="columnheader"><span className="sr-only">Remove</span></span>}
        </div>
        {legs.map((l) => {
          const o = oddsOf(l);
          const e = edgePerDollar(probOf(l), o);
          const stake = singleFor(l);
          return (
            <div className={`stake-row${e != null && e < 0 ? ' neg' : ''}`} role="row" key={l.id}>
              <span className="stake-pick" role="cell">
                <strong><Link to={`/match/${matchSlug(l)}`}>{lastName(l.favName)}</Link></strong>
                <em>
                  over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {pct(l.favProb)}
                  {l.event ? ` · ${l.event}` : ''}
                  {/* The plan prices no-calls (it bets edges, not calls); the
                      ledger does not claim them. Both true, both said. */}
                  {l.noCall ? ' · no call - priced anyway' : ''}
                </em>
              </span>
              <span className="stake-odds" role="cell">
                <input type="number" min="1" step="0.01" value={o || ''} placeholder="–"
                  onChange={(e2) => setOddsOverride((s) => ({ ...s, [l.id]: parseFloat(e2.target.value) || 0 }))} />
              </span>
              <span role="cell" className={`stake-edge ${e == null ? 'na' : e >= 0 ? 'pos' : 'neg'}`}>
                {e == null ? 'no price' : pctSigned(e)}
              </span>
              <span className="stake-single" role="cell">
                {mode === 'budget'
                  ? <span className="stake-suggest">{stake > 0 ? money(stake) : '–'}</span>
                  : <input type="number" min="0" step="1" value={stakes[l.id] ?? ''} placeholder="0"
                      disabled={!(o > 1)}
                      onChange={(e2) => setStakes((s) => ({ ...s, [l.id]: e2.target.value }))} />}
              </span>
              <span className="stake-inpar" role="cell">
                {/* In budget mode the optimiser owns this choice, so the box
                    reports the plan instead of driving it. */}
                <input type="checkbox"
                  aria-label={mode === 'budget'
                    ? `${inActiveParlay(l) ? 'In' : 'Not in'} the plan's parlay`
                    : 'Include in parlay'}
                  checked={mode === 'budget' ? inActiveParlay(l) : isIn(l)}
                  disabled={mode === 'budget' || !(o > 1)}
                  onChange={() => setInParlay((s) => ({ ...s, [l.id]: !isIn(l) }))} />
              </span>
              {onDrop && (
                <span className="stake-drop" role="cell">
                  <button type="button" title={`Take ${lastName(l.favName)} out of the slip`}
                    aria-label={`Remove ${lastName(l.favName)} from the slip`}
                    onClick={() => onDrop(l)}>&times;</button>
                </span>
              )}
            </div>
          );
        })}

        {showCombo.priced && (
          <div className={`stake-row stake-row-parlay${useParlay ? '' : ' off'}`} role="row">
            <span className="stake-pick" role="cell">
              <strong>Parlay</strong>
              <em>
                {showCombo.n} legs · lands {pct(showCombo.p)} · fair {(1 / showCombo.p).toFixed(2)}
                {!useParlay && ' · not staked'}
              </em>
            </span>
            <span className="stake-odds fixed" role="cell">{showCombo.o.toFixed(2)}</span>
            <span role="cell" className={`stake-edge ${showCombo.edge >= 0 ? 'pos' : 'neg'}`}>{pctSigned(showCombo.edge)}</span>
            <span className="stake-single" role="cell">
              {mode === 'budget'
                ? <span className="stake-suggest">{parStake > 0 ? money(parStake) : '–'}</span>
                : <input type="number" min="0" step="1" value={parlayStake || ''} placeholder="0"
                    disabled={!useParlay}
                    onChange={(e2) => setParlayStake(e2.target.value)} />}
            </span>
            <span className="stake-inpar" role="cell">
              <input type="checkbox" aria-label="Include the parlay in this plan"
                checked={useParlay} onChange={() => setUseParlay((v) => !v)} />
            </span>
            {/* Empty, but still a cell: role="row" tolerates no bare children. */}
            {onDrop && <span role="cell" />}
          </div>
        )}
      </div>

      {!anyPriced && (
        <p className="stake-note muted">None of these carry a market price, so there's no edge to size against. Enter the odds you're offered above.</p>
      )}

      {analysis.staked > 0 ? (
        <div className={`stake-out ${evClass}`}>
          {analysis.dist && (() => {
            const { lo, hi, bins } = analysis.dist;
            const max = Math.max(...bins.map((b) => b.prob), 1e-9);
            const zeroPct = hi > lo ? ((0 - lo) / (hi - lo)) * 100 : 50;
            return (
              <div className="stake-dist">
                {/* The chart had a title and no instructions, so it looked
                    like decoration. One line on how to read it and one on
                    what to take from it costs nothing and turns it into the
                    honest centrepiece of the page: the spread IS the product,
                    and the losing half is not a disclaimer. */}
                <div className="stake-dist-cap">Every way today can finish, by our probabilities</div>
                <div className="stake-dist-how">
                  Each bar is one possible end-of-day result; taller means likelier. Red is
                  down on the day, green is up.
                  {analysis.pProfit != null && <> The green area is {pct(analysis.pProfit)} of it, so
                    roughly {Math.round((analysis.pProfit || 0) * 10)} days in 10 finish ahead
                    and the rest do not.</>}
                </div>
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
                  <span className="stake-dist-mid">down on the day ← break even → up on the day</span>
                  <span>+{money(hi).replace('-', '')}</span>
                </div>
              </div>
            );
          })()}

          {/* The badge used to read "Break-even or better", which is a
              promise this number cannot make: `breakEven` is `ev >= 0`, a
              statement about the AVERAGE of the distribution drawn directly
              above it - a distribution whose left half is losing days. A
              reader could see that badge, then see a negative running total
              on the same page, and reasonably conclude one of them was
              lying. Both were true; only the label was wrong. */}
          <div className="stake-verdict">
            {analysis.breakEven
              ? <span className="stake-badge pos">✓ Worth staking on average</span>
              : <span className="stake-badge neg">Not worth staking</span>}
            <span className="stake-verdict-txt">
              {analysis.breakEven
                ? `Averaged over many days like this one the plan comes out ahead. It says nothing about today: ${analysis.pProfit != null ? `today it finishes ahead ${pct(analysis.pProfit)} of the time` : 'plenty of individual days still lose'}, and a run of losing days is normal rather than a sign the plan has stopped working.`
                : 'At these prices the money going out is worth more than what it can be expected to bring back.'}
            </span>
            {mode === 'mine' && !analysis.breakEven && (
              <>
                <span className="stake-verdict-txt">The slip is −EV. No stake fixes a −EV leg, so balancing moves your total onto the +EV bets only.</span>
                <button type="button" className="stake-balance" onClick={balance}>Balance to break-even</button>
              </>
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
