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
import { lastName } from '../utils/names';
import { playerPhoto } from '../utils/playerPhotos';
import { isToday, stillUpcoming } from '../utils/matchTime';
import useDocMeta from '../utils/useDocMeta';
import StakingPlan from '../components/StakingPlan';
import './Parlay.css';

const legKey = (p) => `${p.tour}-${p.p1}-${p.p2}-${p.date}`;
// Decimal odds offered on the player WE picked (lockOdd1/2 follow p1/p2).
const ourOdds = (p) => (p.favorite === p.p1 ? p.lockOdd1 : p.lockOdd2);
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
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setAll((d.predictions || [])
        .filter((p) => p.status === 'pending' && isToday(p.date) && stillUpcoming(p.date))
        .sort((a, b) => b.favProb - a.favProb)))
      .catch(() => setAll([]));
  }, []);

  const byKey = useMemo(() => new Map((all || []).map((p) => [legKey(p), p])), [all]);
  const legs = useMemo(
    () => [...picked].map((k) => byKey.get(k)).filter(Boolean),
    [picked, byKey]
  );

  const toggle = (k) => setPicked((prev) => {
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

  const applySuggestion = (keys) => setPicked(new Set(keys));

  return (
    <div className="parlay-page">
      <div className="eyebrow">THE PARLAY BUILDER</div>
      <h1 className="parlay-title">Stack today's calls</h1>
      <p className="parlay-intro">
        Every pick below is already locked and will be graded in public whatever happens.
        Combine them and the page shows the one number that matters: how often that exact
        set of results actually comes in, by our own probabilities. Adding legs always makes
        it smaller.
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
              <div className="parlay-suggest-cap">Start from one of ours</div>
              <div className="parlay-suggest-row">
                {suggestions.map((s) => (
                  <button key={s.id} type="button" className="parlay-chip" onClick={() => applySuggestion(s.keys)}>
                    <span className="parlay-chip-title">{s.title}</span>
                    <span className="parlay-chip-sub">{s.sub}</span>
                  </button>
                ))}
                {picked.size > 0 && (
                  <button type="button" className="parlay-chip parlay-chip-clear" onClick={() => setPicked(new Set())}>
                    <span className="parlay-chip-title">Clear</span>
                    <span className="parlay-chip-sub">start from scratch</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="parlay-body">
            <div className="parlay-list" role="group" aria-label="Today's calls">
              {all.map((p) => {
                const k = legKey(p);
                const on = picked.has(k);
                const mkt = marketProb(p);
                const o = ourOdds(p);
                return (
                  <label key={k} className={`parlay-leg${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(k)} />
                    <img className="parlay-leg-face" src={playerPhoto(p.tour, p.favorite)} alt="" loading="lazy" />
                    <span className="parlay-leg-main">
                      <span className="parlay-leg-pick">{lastName(p.favName)}</span>
                      <span className="parlay-leg-meta">
                        over {lastName(p.favorite === p.p1 ? p.name2 : p.name1)} · {p.tour.toUpperCase()} · {p.event}
                      </span>
                    </span>
                    <span className="parlay-leg-nums">
                      <span className="parlay-leg-pct">{pct(p.favProb)}</span>
                      <span className="parlay-leg-odds">
                        {o > 1 ? `market ${o.toFixed(2)}` : 'no market price'}
                        {mkt != null && p.favProb - mkt >= GAP_CEIL
                          ? <span className="parlay-leg-flag stretch"> big split</span>
                          : mkt != null && p.favProb - mkt >= GAP_FLOOR
                            ? <span className="parlay-leg-flag"> against the market</span>
                            : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

          </div>

          {/* Nothing ticked yet: the plan below is where every number lives,
              so this is the only prompt the page needs. */}
          {legs.length === 0 && (
            <p className="parlay-slip-empty">
              Tick any calls above, or start from one of our suggestions, and the
              plan will price the combination and size the stakes.
            </p>
          )}

          {/* One list, not two: the staking plan's table already names every
              leg (and links each to its match page), so it doubles as "in
              your selection" while answering what to actually stake. The slip
              above stays a verdict on value; this is the verdict on size. */}
          {legs.length > 0 && <StakingPlan legs={legs} />}
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
