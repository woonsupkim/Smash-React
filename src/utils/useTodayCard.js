// src/utils/useTodayCard.js
//
// Today's card, loaded once and owned in one place.
//
// The parlay builder and the risk lab both used to load this themselves, with
// forty identical lines each: the same fetch, the same no-call filter, the
// same "everything starts in and you take legs out" selection. Two copies of a
// filter is two chances for the pages to price different populations and
// quietly disagree about the same day, which is the one thing the staking
// surfaces must never do.
import { useEffect, useMemo, useState } from 'react';
import { isToday, stillUpcoming } from './matchTime';
import { ledgerNoCall } from './deployedPick';

export const legKey = (p) => `${p.tour}-${p.p1}-${p.p2}-${p.date}`;

export default function useTodayCard() {
  const [all, setAll] = useState(null);
  // Graded rows feed the reliability haircut, so every surface below describes
  // the same bets rather than two versions of them.
  const [graded, setGraded] = useState([]);
  const [awaiting, setAwaiting] = useState(0);
  // Everything is in by default and you take legs OUT: a page that starts
  // empty makes you click N times before it can tell you anything.
  const [dropped, setDropped] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        // Calls only, matching planSettle.ledgerGraded: we do not ask anyone
        // to stake a coin flip the model declined to call.
        const rows = (d.predictions || []).filter((p) => !ledgerNoCall(p));
        setGraded(rows.filter((p) => p.status === 'won' || p.status === 'lost'));
        // Every locked call with no result yet, which is what the receipt's
        // "still to settle" means: it exists to explain why a figure covering
        // settled days only has stopped moving.
        setAwaiting(rows.filter((p) => p.status === 'pending').length);
        setAll(rows
          .filter((p) => p.status === 'pending' && isToday(p.date) && stillUpcoming(p.date))
          .sort((a, b) => b.favProb - a.favProb));
      })
      .catch(() => { if (live) { setAll([]); setGraded([]); } });
    return () => { live = false; };
  }, []);

  const legs = useMemo(
    () => (all || []).filter((p) => !dropped.has(legKey(p))),
    [all, dropped]
  );

  const toggle = (l) => setDropped((prev) => {
    const next = new Set(prev);
    const k = legKey(l);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const restore = () => setDropped(new Set());

  // setDropped is exposed for the builder's "narrow the card to these"
  // suggestions, which replace the whole selection rather than nudging it.
  return { all, legs, graded, awaiting, dropped, setDropped, toggle, restore };
}
