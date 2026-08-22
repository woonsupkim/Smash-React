// src/pages/Parlay.js
//
// The parlay builder: stack today's locked calls and see what they're
// actually worth.
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
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isToday, stillUpcoming } from '../utils/matchTime';
import useDocMeta from '../utils/useDocMeta';
import StakingPlan from '../components/StakingPlan';
import { GAP_FLOOR, GAP_CEIL, BAND } from '../utils/marketGap';
import { planFrontier, reliability } from '../utils/staking';
import './Parlay.css';

// The budget the receipt below replays yesterday's plan on, matching the
// StakingPlan default so the number means the same thing on both.
const PLAN_BUDGET = 100;

const legKey = (p) => `${p.tour}-${p.p1}-${p.p2}-${p.date}`;
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

// The gap window and the record behind it now live in utils/marketGap, where
// a test recomputes every published figure from the graded ledger. They were
// inline here and had all drifted - the page claimed those calls came in 69%
// of the time when the record said 55%.

export default function Parlay() {
  useDocMeta(
    'Parlay Builder · Today\'s Calls | Smash',
    "Stack today's locked picks and see the real combined probability, our fair price, and what the market offers."
  );
  const [all, setAll] = useState(null);
  // The graded rows from the same file, kept so the staking plan can size
  // itself on the model's MEASURED accuracy rather than its stated confidence.
  const [graded, setGraded] = useState([]);
  // Today's whole card is in by default and you take legs OUT. Tracking the
  // REMOVALS rather than the selections is what makes that work: a set that
  // starts empty already means "everything", so the plan below is priced and
  // sized the moment the page loads instead of after N clicks.
  const [dropped, setDropped] = useState(() => new Set());

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        const rows = d.predictions || [];
        setGraded(rows.filter((p) => p.status === 'won' || p.status === 'lost'));
        setAll(rows
          .filter((p) => p.status === 'pending' && isToday(p.date) && stillUpcoming(p.date))
          .sort((a, b) => b.favProb - a.favProb));
      })
      .catch(() => { setAll([]); setGraded([]); });
  }, []);

  const legs = useMemo(
    () => (all || []).filter((p) => !dropped.has(legKey(p))),
    [all, dropped]
  );

  const toggle = (k) => setDropped((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

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
    // "Most confident" means calls: a no-call is priced by the plan below
    // (the builder bets edges), but it is nobody's idea of a confident pick.
    const byConfidence = [...all].filter((x) => !x.noCall).sort((a, b) => b.favProb - a.favProb);
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

  // Yesterday's plan, settled. The follower's first question is not "what is
  // today's plan" but "does following it work", and the page had no answer:
  // the digest carried this and the page did not. Same frontier the page
  // shows, reliability measured only on rows graded BEFORE that day, settled
  // at the price stamped before play. Wins and losses print identically.
  const yesterdayPlan = useMemo(() => {
    const rows = (graded || []).filter((m) => m.lockOdd1 > 1 && m.lockOdd2 > 1 && typeof m.favProb === 'number');
    if (rows.length < 2) return null;
    const day = rows.map((m) => String(m.date).slice(0, 10)).sort().pop();
    const card = rows.filter((m) => String(m.date).slice(0, 10) === day);
    if (card.length < 2) return null;
    const bets = card.map((m) => ({
      key: String(m.id), p: m.favProb,
      o: Number(m.favorite === m.p1 ? m.lockOdd1 : m.lockOdd2),
      won: !!m.correct,
    }));
    const before = (graded || []).filter((m) => String(m.date).slice(0, 10) < day);
    const rel = reliability(before);
    const f = planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), PLAN_BUDGET, { lambda: rel.lambda });
    const plan = f.plans.find((pl) => pl.id === f.recommendedId) || f.plans[0];
    if (!plan) return null;
    const byKey = new Map(bets.map((b) => [b.key, b]));
    let staked = 0, profit = 0, hits = 0, backed = 0;
    for (const [key, stake] of Object.entries(plan.singles || {})) {
      if (!(stake > 0.005)) continue;
      const b = byKey.get(key); if (!b) continue;
      backed++; staked += stake;
      if (b.won) { profit += stake * (b.o - 1); hits++; } else { profit -= stake; }
    }
    let parlayWon = null;
    if (plan.parlayStake > 0.005 && (plan.parlayLegs || []).length >= 2 && plan.parlayLegs.every((k) => byKey.has(k))) {
      staked += plan.parlayStake;
      parlayWon = plan.parlayLegs.every((k) => byKey.get(k).won);
      const o = plan.parlayLegs.reduce((m, k) => m * byKey.get(k).o, 1);
      profit += parlayWon ? plan.parlayStake * (o - 1) : -plan.parlayStake;
    }
    if (staked < 0.01) return null;
    return { day, label: plan.label, staked, profit, hits, backed, parlayWon };
  }, [graded]);

  // A suggestion narrows the card down to its own legs: everything not in the
  // set gets dropped.
  const applySuggestion = (keys) => {
    const keep = new Set(keys);
    setDropped(new Set((all || []).map(legKey).filter((k) => !keep.has(k))));
  };

  return (
    <div className="parlay-page">
      <div className="eyebrow">THE PARLAY BUILDER</div>
      <h1 className="parlay-title">Today's staking plan</h1>
      <p className="parlay-intro">
        One plan, ready to follow: exactly how much to put on which of today's matches,
        and whether a parlay earns a slice. It only backs calls priced better than we
        think they should be, so most days it stakes less than the full budget and the
        rest stays in your pocket. Every call was locked before play and is graded in
        public afterwards, wins and misses alike.
      </p>

      {yesterdayPlan && (
        <div className={`parlay-receipt${yesterdayPlan.profit >= 0 ? ' pos' : ' neg'}`}>
          <span className="parlay-receipt-cap">Yesterday, following this plan</span>
          <span className="parlay-receipt-val">
            {yesterdayPlan.profit >= 0 ? '+' : '-'}${Math.abs(yesterdayPlan.profit).toFixed(2)}
          </span>
          <span className="parlay-receipt-sub">
            on ${yesterdayPlan.staked.toFixed(2)} staked · {yesterdayPlan.hits} of {yesterdayPlan.backed} landed
            {yesterdayPlan.parlayWon != null ? `, parlay ${yesterdayPlan.parlayWon ? 'hit' : 'missed'}` : ''}
          </span>
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
              <button type="button" className="parlay-restore" onClick={() => setDropped(new Set())}>
                Put today's {all.length} calls back
              </button>
            </p>
          )}

          {/* ONE table, not two. There used to be a checkbox list of the same
              calls above this, which meant every match was on screen twice and
              you picked in one place then priced in another. The staking plan
              already names every leg, so it took over the dropping too. */}
          {legs.length > 0 && (
            <StakingPlan legs={legs} graded={graded} onDrop={(l) => toggle(legKey(l))} />
          )}

          {suggestions.length > 0 && (
            <div className="parlay-suggest">
              <div className="parlay-suggest-cap">Rather build your own? Start from one of these</div>
              <div className="parlay-suggest-row">
                {suggestions.map((s) => (
                  <button key={s.id} type="button" className="parlay-chip" onClick={() => applySuggestion(s.keys)}>
                    <span className="parlay-chip-title">{s.title}</span>
                    <span className="parlay-chip-sub">{s.sub}</span>
                  </button>
                ))}
                {dropped.size > 0 && (
                  <button type="button" className="parlay-chip parlay-chip-clear" onClick={() => setDropped(new Set())}>
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
  );
}
