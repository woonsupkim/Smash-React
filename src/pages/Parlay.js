// src/pages/Parlay.js
//
// THE RISK LAB. Named for what the page became once the standalone risk page
// was folded into it: one card, one staking plan, and one honest account of
// what that plan can do to the money behind it. The file keeps its old name,
// and /parlay keeps answering, because the page has been linked that way from
// the sitemap, every share asset already posted and every digest already sent.
//
// The design brief this page refuses: "suggest a parlay that will land".
// Parlays multiply, so honesty means leading with the number that gets
// worse as you add legs, not the payout that gets bigger. Four 70% calls
// look like a lock and land 24% of the time. That decay IS the content -
// the page shows it in the headline, and the "best chance" suggestions are
// labelled by how often they land rather than by what they'd pay.
//
// Two prices per selection, which is the genuinely useful part:
//   - OUR fair price, 1 / (our combined probability)
//   - THE MARKET's price, the product of the lock-time decimal odds we
//     stamped on each pick before play
// When the market's price is longer than ours, the market rates our picks
// worse than we do. That is the same disagreement The Edge grades all
// season, priced per selection instead of per match.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useDocMeta from '../utils/useDocMeta';
import StakingPlan from '../components/StakingPlan';
import RiskLab from '../components/RiskLab';
import useTodayCard, { legKey } from '../utils/useTodayCard';
import DigestSignup from '../components/DigestSignup';
import { GAP_FLOOR, GAP_CEIL, BAND } from '../utils/marketGap';
import { planFrontier, reliability } from '../utils/staking';
import { surfaceBgClass } from '../utils/surfaceBg';
import './Parlay.css';

// The budget the receipt below replays yesterday's plan on, matching the
// StakingPlan default so the number means the same thing on both.
const PLAN_BUDGET = 100;
// How many settleable days the "how it has been going" strip replays.
const HISTORY_DAYS = 10;

// Cumulative profit across the replayed days. Deliberately plain: a zero
// line, one stroke, and the end point marked. It answers "is this thing
// going up or down" at a glance, which the P&L distribution below cannot -
// that chart describes one hypothetical day, this one describes the record.
function PlanCurve({ values, market }) {
  if (!values || values.length < 2) return null;
  const w = 168, h = 46, pad = 3;
  // Both series share one scale, or the comparison is decoration.
  const all = market && market.length === values.length ? [...values, ...market] : values;
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const span = Math.max(hi - lo, 1e-6);
  const x = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const line = (vals) => vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const end = values[values.length - 1];
  const up = end >= 0;
  const mEnd = market && market.length ? market[market.length - 1] : null;
  const money = (v) => `${v >= 0 ? 'up' : 'down'} $${Math.abs(v).toFixed(0)}`;
  return (
    <svg className="parlay-curve" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Cumulative profit over ${values.length} settled days: following the plan ends ${money(end)}${mEnd != null ? `, the same money on the bookmakers' favourites ends ${money(mEnd)}` : ''}.`}>
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="3 3" />
      {mEnd != null && (
        <>
          <polyline points={line(market)} fill="none" strokeWidth="1.75" strokeLinejoin="round"
            stroke="rgba(255,255,255,0.42)" strokeDasharray="4 3" />
          <circle cx={x(market.length - 1)} cy={y(mEnd)} r="2.5" fill="rgba(255,255,255,0.55)" />
        </>
      )}
      <polyline points={line(values)} fill="none" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round"
        stroke={up ? 'var(--accent-positive, #4caf7d)' : '#ff8f8f'} />
      <circle cx={x(values.length - 1)} cy={y(end)} r="3" fill={up ? 'var(--accent-positive, #4caf7d)' : '#ff8f8f'} />
    </svg>
  );
}

// The market's own view of our pick, with the bookmaker's margin divided
// out - the like-for-like comparison against our probability (same
// vig-stripping as the Edge board).
function marketProb(p) {
  if (!(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) return null;
  const q1 = 1 / p.lockOdd1, q2 = 1 / p.lockOdd2;
  const share = (p.favorite === p.p1 ? q1 : q2) / (q1 + q2);
  return share;
}
const pct = (v) => `${Math.round(v * 100)}%`;
// Return as a share of money staked. The dollar figure alone is unreadable
// without the stake beside it: the plan deliberately stakes a different
// amount every day, so "-$17" could be a rout or a rounding error.
const signedPct = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v * 100).toFixed(1)}%`;

// The gap window and the record behind it now live in utils/marketGap, where
// a test recomputes every published figure from the graded ledger. They were
// inline here and had all drifted - the page claimed those calls came in 69%
// of the time when the record said 55%.

export default function Parlay() {
  useDocMeta(
    "Risk Lab · Today's Calls | Smash",
    "How much to stake on today's calls, and what that plan does to your budget: the spread of outcomes, how often a bad day arrives, and whether you are betting past the size that grows a bankroll rather than shrinking it."
  );
  const { all, legs, noCalls, graded, awaiting, dropped, setDropped, toggle, restore } = useTodayCard();

  // Whatever the staking plan currently has on its table, published upward so
  // the risk lab below describes THIS plan. One allocation on the page, read
  // by both surfaces, so they can never disagree about the same day.
  const [plan, setPlan] = useState(null);

  // Which tour the page is working on. It lives HERE rather than inside the
  // table because it narrows the CARD, not just the view of it: the plan is
  // re-derived on whatever is showing, and the risk read follows the plan. A
  // control that scopes the money has to sit with the thing it scopes.
  const [tourView, setTourView] = useState('all');
  const viewLegs = useMemo(
    () => legs.filter((l) => tourView === 'all' || l.tour === tourView),
    [legs, tourView]
  );
  const viewNoCalls = useMemo(
    () => noCalls.filter((l) => tourView === 'all' || l.tour === tourView),
    [noCalls, tourView]
  );
  const tourCounts = useMemo(() => {
    const both = [...legs, ...noCalls];
    return {
      atp: both.filter((l) => l.tour === 'atp').length,
      wta: both.filter((l) => l.tour === 'wta').length,
    };
  }, [legs, noCalls]);

  // The combined maths (chance all land, our fair price, the market's price)
  // now lives in the staking plan, which owns the odds you can edit and so is
  // the only place those numbers can be right. Legs are treated as
  // independent, which is close enough for separate matches on one day and is
  // stated rather than buried: correlated legs would make the true number
  // LOWER, not higher, so the honest error is the conservative one.

  // ── Suggestions. Named for what they are, never for what they might win.
  const suggestions = useMemo(() => {
    if (!all || all.length < 2) return [];
    const out = [];
    // No no-call filter needed here any more: `all` is already calls only.
    const byConfidence = [...all].sort((a, b) => b.favProb - a.favProb);
    for (const n of [2, 3, 5]) {
      if (byConfidence.length < n) continue;
      const set = byConfidence.slice(0, n);
      const prob = set.reduce((m, x) => m * x.favProb, 1);
      out.push({
        id: `safe-${n}`,
        title: `Our ${n} most confident`,
        sub: `lands ${pct(prob)} of the time`,
        keys: set.map(legKey),
      });
    }
    // Legs inside the band where disagreeing with the market has actually
    // paid off historically - deliberately NOT the biggest gaps on the
    // board, which is where our record is worst (see GAP_CEIL).
    const disagreements = all
      .map((p) => ({ p, mkt: marketProb(p) }))
      .filter((x) => x.mkt != null && x.p.favProb - x.mkt >= GAP_FLOOR && x.p.favProb - x.mkt < GAP_CEIL)
      .sort((a, b) => (b.p.favProb - b.mkt) - (a.p.favProb - a.mkt))
      .slice(0, 3);
    if (disagreements.length >= 2) {
      const set = disagreements.map((x) => x.p);
      const prob = set.reduce((m, x) => m * x.favProb, 1);
      out.push({
        id: 'value',
        title: `Against the market (${set.length})`,
        sub: `lands ${pct(prob)}; calls like these have landed ${pct(BAND.hitRate)} of the time against a market that gave them ${pct(BAND.marketImplied)}`,
        keys: set.map(legKey),
      });
    }
    return out;
  }, [all]);

  // How the recommended plan has actually been doing, day by day.
  //
  // The follower's first question is not "what is today's plan" but "does
  // following it work", and the page had no answer: the digest carried this
  // and the page did not. So the last settleable days are replayed with the
  // same frontier the page shows - reliability measured only on rows graded
  // BEFORE each day, settled at the price stamped before play - and the
  // result is a cumulative curve plus the total. Losing days print exactly
  // like winning ones; that is the point of showing it at all.
  const planHistory = useMemo(() => {
    const rows = (graded || []).filter((m) => m.lockOdd1 > 1 && m.lockOdd2 > 1 && typeof m.favProb === 'number');
    if (rows.length < 2) return null;
    const days = [...new Set(rows.map((m) => String(m.date).slice(0, 10)))].sort();
    const out = [];
    for (const day of days) {
      const card = rows.filter((m) => String(m.date).slice(0, 10) === day);
      if (card.length < 2) continue;
      // Each bet also carries the MARKET's side of the same match: the
      // shorter of the two lock prices, and whether that player won. It is
      // what lets the same stakes be replayed on the bookmakers' favourites
      // without re-deriving anything - same matches, same money, same parlay
      // shape, different picks. Ties on price are vanishingly rare and fall
      // to p1; there is no favourite to speak of at identical odds.
      const bets = card.map((m) => {
        const mFav = Number(m.lockOdd1) <= Number(m.lockOdd2) ? m.p1 : m.p2;
        const isP1 = mFav === m.p1;
        const q1 = 1 / Number(m.lockOdd1), q2 = 1 / Number(m.lockOdd2);
        return {
          key: String(m.id), p: m.favProb,
          o: Number(m.favorite === m.p1 ? m.lockOdd1 : m.lockOdd2),
          won: !!m.correct,
          mo: Number(isP1 ? m.lockOdd1 : m.lockOdd2),
          mWon: m.winner === mFav,
          // The market's own vig-free chance for its own pick. Kept so the
          // baseline can be judged against its own prices instead of being
          // reported as though any return it posts were repeatable.
          mP: (isP1 ? q1 : q2) / (q1 + q2),
        };
      });
      // Reliability history is EVERY graded call before this day, priced or
      // not - matching planSettle.planReturns exactly. It used to be measured
      // on the priced rows only, which is a different population and a
      // different lambda, so the page and the digest built different plans
      // for the same day and reported different returns for the same
      // tournament (-26.3% here against -5.9% there).
      const before = (graded || []).filter((m) => String(m.date).slice(0, 10) < day);
      const rel = reliability(before);
      const f = planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), PLAN_BUDGET, { lambda: rel.lambda });
      const plan = f.plans.find((pl) => pl.id === f.recommendedId) || f.plans[0];
      if (!plan) continue;
      const byKey = new Map(bets.map((b) => [b.key, b]));
      let staked = 0, profit = 0, hits = 0, backed = 0;
      // The same money, on the market's favourites. Tracked alongside rather
      // than as a separate pass so it can never drift onto a different set of
      // matches or a different stake.
      let mktProfit = 0, mktExp = 0, mktHits = 0, mktN = 0;
      for (const [key, stake] of Object.entries(plan.singles || {})) {
        if (!(stake > 0.005)) continue;
        const b = byKey.get(key); if (!b) continue;
        backed++; staked += stake;
        if (b.won) { profit += stake * (b.o - 1); hits++; } else { profit -= stake; }
        mktProfit += b.mWon ? stake * (b.mo - 1) : -stake;
        mktExp += b.mP; mktHits += b.mWon ? 1 : 0; mktN++;
      }
      let parlayWon = null;
      if (plan.parlayStake > 0.005 && (plan.parlayLegs || []).length >= 2 && plan.parlayLegs.every((k) => byKey.has(k))) {
        staked += plan.parlayStake;
        parlayWon = plan.parlayLegs.every((k) => byKey.get(k).won);
        const o = plan.parlayLegs.reduce((m, k) => m * byKey.get(k).o, 1);
        profit += parlayWon ? plan.parlayStake * (o - 1) : -plan.parlayStake;
        // Same legs, same stake, market's picks. A parlay on the favourites
        // is short-priced and lands more often, which is exactly the trade
        // this comparison is meant to expose.
        const mWonAll = plan.parlayLegs.every((k) => byKey.get(k).mWon);
        const mOdds = plan.parlayLegs.reduce((m, k) => m * byKey.get(k).mo, 1);
        mktProfit += mWonAll ? plan.parlayStake * (mOdds - 1) : -plan.parlayStake;
        mktExp += plan.parlayLegs.reduce((m, k) => m * byKey.get(k).mP, 1);
        mktHits += mWonAll ? 1 : 0; mktN++;
      }
      if (staked < 0.01) continue;
      out.push({ day, staked, profit, hits, backed, parlayWon, mktProfit, mktExp, mktHits, mktN });
    }
    if (!out.length) return null;
    // Summarise any run of days the same way, so the whole record and one
    // tournament are never accidentally computed differently.
    const summarise = (list) => {
      if (!list.length) return null;
      let run = 0, mktRun = 0;
      const curve = list.map((d) => { run += d.profit; return run; });
      const mktCurve = list.map((d) => { mktRun += (d.mktProfit || 0); return mktRun; });
      const staked = list.reduce((t, d) => t + d.staked, 0);
      return {
        days: list,
        curve,
        mktCurve,
        total: run,
        mktTotal: mktRun,
        staked,
        roi: staked > 0 ? run / staked : 0,
        mktRoi: staked > 0 ? mktRun / staked : 0,
        // The baseline against its OWN prices. Reporting a return without it
        // lets a hot streak read as an edge, and this cuts both ways: it is
        // the same test our own calibration gets on the ledger page.
        mktExp: list.reduce((t, d) => t + (d.mktExp || 0), 0),
        mktHits: list.reduce((t, d) => t + (d.mktHits || 0), 0),
        mktN: list.reduce((t, d) => t + (d.mktN || 0), 0),
        up: list.filter((d) => d.profit > 0).length,
        last: list[list.length - 1],
      };
    };
    // The most recent tournament, whole. Ten arbitrary days is a window that
    // starts and ends mid-event, so it can open on a good run and close on a
    // bad one for no reason connected to the tennis - which is exactly how a
    // page ends up showing its worst possible face. A tournament is a unit a
    // reader recognises and cannot be accused of having been chosen after
    // seeing the result.
    // A day belongs to whichever event MOST of its graded calls belong to,
    // and only that one. Tournaments overlap at the changeover, a day is
    // staked as a single card, and taking the first row's event made the
    // label depend on array order. Mirrors planSettle.eventDayOwner.
    const owner = new Map();
    {
      const tally = new Map();
      for (const m of graded || []) {
        if (!m.event) continue;
        const day = String(m.date).slice(0, 10);
        if (!tally.has(day)) tally.set(day, new Map());
        const t = tally.get(day);
        t.set(m.event, (t.get(m.event) || 0) + 1);
      }
      for (const [day, t] of tally) {
        owner.set(day, [...t.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
      }
    }
    const latestEvent = owner.get(out[out.length - 1].day) || null;
    const eventDays = latestEvent ? out.filter((d) => owner.get(d.day) === latestEvent) : [];
    return {
      all: summarise(out),
      recent: summarise(out.slice(-HISTORY_DAYS)),
      event: eventDays.length >= 2 ? { name: latestEvent, ...summarise(eventDays) } : null,
    };
  }, [graded]);

  // A suggestion narrows the card down to its own legs  // A suggestion narrows the card down to its own legs: everything not in the
  // set gets dropped.
  const applySuggestion = (keys) => {
    const keep = new Set(keys);
    setDropped(new Set((all || []).map(legKey).filter((k) => !keep.has(k))));
    // Scroll the plan back into view. The chips sit BELOW the plan they
    // rewrite, so clicking one changed the page above the reader's viewport
    // and looked, from where they were sitting, like nothing had happened.
    // Reported as "clicking on it doesn't do anything"; the click always
    // worked, the feedback never arrived.
    if (typeof document !== 'undefined') {
      const target = document.querySelector('.stake-plan');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Which suggestion, if any, the current selection already matches. Without
  // this a chip gives no sign it is the one in force, and a chip that would
  // change nothing still looks like a live control.
  const activeSuggestionId = useMemo(() => {
    const inSlip = new Set(legs.map(legKey));
    const same = (keys) => keys.length === inSlip.size && keys.every((k) => inSlip.has(k));
    return (suggestions.find((s) => same(s.keys)) || {}).id || null;
  }, [legs, suggestions]);

  return (
    <div className={`page-background ${surfaceBgClass()}`}>
      <div className="overlay">
        <div className="parlay-page">
      <div className="eyebrow">RISK LAB</div>
      <h1 className="parlay-title">Today's staking plan</h1>
      {/* Two sentences. This was five, and the reader who came to place
          today's bets had to read a paragraph of policy before reaching the
          plan. What the plan does is now visible in the plan; the reasoning
          behind it is one click away inside it. */}
      <p className="parlay-intro">
        How much to put on which of today&apos;s matches, and whether a parlay earns a
        slice. It only backs calls priced better than we rate them, so most days it
        stakes well under the budget and the rest stays in your pocket. Then the
        part most tipsters skip: what that plan can actually do to your money, in
        both directions.
      </p>

      {/* The record, on two horizons, with percentages.
          A single ten-day window was the whole answer here, and ten days is
          both too short to mean anything and a window whose edges nobody
          chose on purpose - it opened and closed mid-tournament, so a bad
          fortnight could be the only thing a first-time reader ever saw. It
          now shows the complete settled record beside the most recent
          tournament, and the return as a percentage of money staked as well
          as in dollars, because "-$17" means nothing without knowing whether
          $50 or $500 went out to earn it. Red prints exactly like green. */}
      {planHistory?.all && (
        <div className={`parlay-receipt${planHistory.all.total >= 0 ? ' pos' : ' neg'}`}>
          <div className="parlay-receipt-main">
            <span className="parlay-receipt-cap">
              Following this plan, every settled day so far
            </span>
            <span className="parlay-receipt-val">
              {signedPct(planHistory.all.roi)}
              <span className="parlay-receipt-dollars">
                {' '}({planHistory.all.total >= 0 ? '+' : '-'}${Math.abs(planHistory.all.total).toFixed(2)} on ${planHistory.all.staked.toFixed(2)} staked)
              </span>
            </span>
            <span className="parlay-receipt-sub">
              {planHistory.all.days.length} days · {planHistory.all.up} up, {planHistory.all.days.length - planHistory.all.up} down
              {planHistory.all.last?.day && (
                <> · last settled {new Date(`${planHistory.all.last.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</>
              )}
              {awaiting > 0 && <> · {awaiting} call{awaiting === 1 ? '' : 's'} still to settle</>}
            </span>
          </div>
          {/* No market series any more: the line that explained the dashed
              stroke is gone, and an unlabelled second line on a 168px sparkline
              is decoration. The market comparison still lives on The Edge,
              where it has the room to be argued properly. */}
          <PlanCurve values={planHistory.all.curve} />
        </div>
      )}

      {all === null && <div className="skeleton parlay-skel" />}

      {all && all.length === 0 && (
        <div className="parlay-empty">
          Nothing on today's card to stack. Calls lock for the slams and the big
          combined events as their matches are scheduled - meanwhile,{' '}
          <Link to="/h2h">run any matchup yourself</Link> or see{' '}
          <Link to="/edge">where we split with the bookmakers</Link>.
        </div>
      )}

      {all && all.length > 0 && (
        <>
          {/* Everything is in by default, so an empty slip means you took the
              last leg out - offer the way back rather than a generic prompt. */}
          {legs.length === 0 && (
            <p className="parlay-slip-empty">
              You've taken every leg out, so there's nothing left to price.{' '}
              <button type="button" className="parlay-restore" onClick={restore}>
                Put today's {all.length} calls back
              </button>
            </p>
          )}

          {/* ONE table, not two. There used to be a checkbox list of the same
              calls above this, which meant every match was on screen twice and
              you picked in one place then priced in another. The staking plan
              already names every leg, so it took over the dropping too. */}
          {legs.length > 0 && (
            <StakingPlan legs={viewLegs} graded={graded} noCalls={viewNoCalls}
              tourView={tourView} tourCounts={tourCounts} onTourView={setTourView}
              onDrop={toggle} onPlanChange={setPlan}
              riskSlot={(
                <div className="parlay-risk" id="risk">
                  <RiskLab legs={viewLegs} graded={graded} plan={plan} />
                </div>
              )} />
          )}

          {/* The conversion point that actually makes sense on this page: the
              plan changes every morning and is worth nothing to someone who
              forgets to come back. Placed under the plan, not above it, so
              the page answers the question before it asks for anything. */}
          {legs.length > 0 && (
            <div className="parlay-signup">
              <DigestSignup variant="band" />
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="parlay-suggest">
              <div className="parlay-suggest-cap">
                Rather build your own? Narrow the card to one of these, then the plan above re-prices it
              </div>
              <div className="parlay-suggest-row">
                {suggestions.map((s) => {
                  const on = s.id === activeSuggestionId;
                  return (
                    <button key={s.id} type="button" aria-pressed={on}
                      className={`parlay-chip${on ? ' on' : ''}`}
                      onClick={() => applySuggestion(s.keys)}>
                      <span className="parlay-chip-title">{s.title}{on ? ' ✓' : ''}</span>
                      <span className="parlay-chip-sub">{on ? 'this is what the plan is priced on now' : s.sub}</span>
                    </button>
                  );
                })}
                {dropped.size > 0 && (
                  <button type="button" className="parlay-chip parlay-chip-clear" onClick={restore}>
                    <span className="parlay-chip-title">All {all.length} back</span>
                    <span className="parlay-chip-sub">put today's whole card in</span>
                  </button>
                )}
              </div>
            </div>
          )}

        </>
      )}

      <div className="parlay-footer">
        <Link to="/today">Today's calls</Link>
        <Link to="/edge">The Edge</Link>
        <Link to="/track-record">The Ledger</Link>
      </div>
        </div>
      </div>
    </div>
  );
}
