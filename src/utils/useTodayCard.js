// src/utils/useTodayCard.js
//
// Today's card, loaded once and owned in one place.
//
// The Risk Lab and the standalone risk page both used to load this, with
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
  // Today's matches the model declined to call. They are NOT part of the
  // staking universe and never will be - "if we will not call it, we will not
  // stake it" is a rule the whole product hangs on - but the card is the
  // card, and a table that silently omits a third of the day makes the reader
  // wonder what else is missing. They are carried separately so the two can
  // never be confused for one list.
  const [passes, setPasses] = useState([]);
  // Graded rows feed the reliability haircut, so every surface below describes
  // the same bets rather than two versions of them.
  const [graded, setGraded] = useState([]);
  const [awaiting, setAwaiting] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        // Calls only, matching planSettle.ledgerGraded: we do not ask anyone
        // to stake a coin flip the model declined to call.
        const rows = (d.predictions || []).filter((p) => !ledgerNoCall(p));
        const onToday = (p) => p.status === 'pending' && isToday(p.date) && stillUpcoming(p.date);
        setPasses((d.predictions || [])
          .filter((p) => ledgerNoCall(p) && onToday(p))
          .sort((a, b) => b.favProb - a.favProb));
        setGraded(rows.filter((p) => p.status === 'won' || p.status === 'lost'));
        // Every locked call with no result yet, which is what the receipt's
        // "still to settle" means: it exists to explain why a figure covering
        // settled days only has stopped moving.
        setAwaiting(rows.filter((p) => p.status === 'pending').length);
        setAll(rows.filter(onToday).sort((a, b) => b.favProb - a.favProb));
      })
      .catch(() => { if (live) { setAll([]); setGraded([]); setPasses([]); } });
    return () => { live = false; };
  }, []);

  // The whole day, both lists, unfiltered. Which of them a reader has picked
  // is the page's business, not this hook's: the selection model changed from
  // "everything is in, take legs out" to "these are my picks, the rest is on
  // the bench", and a loader that also owned a dropped-set would have had to
  // change with it. It loads the card. That is all it does.
  const legs = useMemo(() => all || [], [all]);
  const noCalls = useMemo(() => passes, [passes]);

  return { all, legs, noCalls, graded, awaiting };
}
