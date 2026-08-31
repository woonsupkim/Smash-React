// src/pages/RiskPage.js
//
// SIZE YOUR RISK: the third page in the Today group, between the builder and
// the draw.
//
// The builder answers "what should I stake". This page answers the question
// that comes straight after and nowhere else on the site: "what happens to ME
// if I stake that, or something else entirely". It is deliberately its own
// page rather than a panel under the builder, because the two give different
// answers to the same input and reading them stacked invites people to treat
// the risk numbers as a second recommendation.
//
// It loads today's card itself rather than inheriting a selection, so it can
// be linked to directly and still make sense: every call on the day starts in,
// and you take out what you would not back. The parlay is built here too, from
// whatever is left in.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isToday, stillUpcoming } from '../utils/matchTime';
import { ledgerNoCall } from '../utils/deployedPick';
import useDocMeta from '../utils/useDocMeta';
import RiskLab from '../components/RiskLab';
import './Parlay.css';

const legKey = (p) => `${p.tour}-${p.p1}-${p.p2}-${p.date}`;

export default function RiskPage() {
  useDocMeta(
    'Size Your Risk · Today\'s Calls | Smash',
    "Put your own bankroll and stakes against today's card and see the exposure: the spread of outcomes, the chance of a bad run, and whether you are betting past the growth-optimal size."
  );

  const [all, setAll] = useState(null);
  // Graded rows feed the same reliability haircut the builder uses, so both
  // pages describe the same bets rather than two versions of them.
  const [graded, setGraded] = useState([]);
  // Everything is in by default and you take legs OUT - the same model the
  // builder uses, for the same reason: a page that starts empty makes you do
  // N clicks before it can tell you anything.
  const [dropped, setDropped] = useState(() => new Set());

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        // Calls only, matching the builder and planSettle.ledgerGraded: we do
        // not ask anyone to stake a coin flip we declined to call.
        const rows = (d.predictions || []).filter((p) => !ledgerNoCall(p));
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

  return (
    <div className="parlay-page">
      <div className="eyebrow">SIZE YOUR RISK</div>
      <h1 className="parlay-title">What today can do to you</h1>
      <p className="parlay-intro">
        Every call on today&apos;s card starts in. Set your bankroll and your stakes, take out
        anything you would not back, and this shows the exposure you are actually taking:
        the spread of outcomes, how often a bad day arrives, what a run of them looks like,
        and whether the stake is past the size that grows a bankroll rather than shrinking it.
        {' '}<Link to="/parlay">The builder</Link> says what we would stake. This says what
        happens if you stake something else.
      </p>

      {all === null && <div className="skeleton parlay-skel" />}

      {all && all.length === 0 && (
        <div className="parlay-empty">
          Nothing on today&apos;s card to size. Calls lock for the slams and the big combined
          events as their matches are scheduled - meanwhile,{' '}
          <Link to="/track-record">see how the calls have been landing</Link> or{' '}
          <Link to="/h2h">run any matchup yourself</Link>.
        </div>
      )}

      {all && all.length > 0 && (
        <>
          {legs.length === 0 && (
            <p className="parlay-slip-empty">
              You&apos;ve taken every match out, so there is no exposure left to size.{' '}
              <button type="button" className="parlay-restore" onClick={() => setDropped(new Set())}>
                Put today&apos;s {all.length} calls back
              </button>
            </p>
          )}

          {legs.length > 0 && (
            <RiskLab legs={legs} graded={graded} onDrop={(l) => toggle(legKey(l))} />
          )}
        </>
      )}

      <div className="parlay-footer">
        <Link to="/today">Today&apos;s calls</Link>
        <Link to="/parlay">The parlay builder</Link>
        <Link to="/track-record">The Ledger</Link>
      </div>
    </div>
  );
}
