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
import './Parlay.css';

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

// How far our number has to sit above the market's before it is worth
// pointing at, and where that stops being a good sign.
//
// Both numbers come from the graded record (2,051 priced matches), not from
// taste. We show OUR favourite on every row, so our probability naturally
// runs a couple of points above the market's for that side - a flag at "any
// gap at all" fired on 61% of matches and meant nothing. From 10 points up
// it means a lot: those calls came in 69% of the time while the market
// implied 49%.
//
// Past 20 points it inverts. Our most extreme disagreements won just 47% of
// the time against a stated 62% - the zone where the model is not brave,
// it is wrong. So the flag has a ceiling as well as a floor, and the
// suggestion below is built from the band that has actually paid rather
// than from the biggest numbers on the page.
const GAP_FLOOR = 0.10;
const GAP_CEIL = 0.20;

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
        sub: `lands ${pct(prob)}; calls like these came in 69% of the time`,
        keys: set.map(legKey),
      });
    }
    return out;
  }, [all]);

  // A suggestion narrows the card down to its own legs: everything not in the
  // set gets dropped.
  const applySuggestion = (keys) => {
    const keep = new Set(keys);
    setDropped(new Set((all || []).map(legKey).filter((k) => !keep.has(k))));
  };

  return (
    <div className="parlay-page">
      <div className="eyebrow">THE PARLAY BUILDER</div>
      <h1 className="parlay-title">Stack today's calls</h1>
      <p className="parlay-intro">
        Every call on today's card is already locked, graded in public whatever happens, and
        in the plan below by default. Drop the ones you don't want with the × on the right,
        and it re-prices as you go: the honest number is how often that exact set of results
        actually comes in, and every leg you keep makes it smaller.
      </p>

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
          {suggestions.length > 0 && (
            <div className="parlay-suggest">
              <div className="parlay-suggest-cap">Or narrow it to one of ours</div>
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
