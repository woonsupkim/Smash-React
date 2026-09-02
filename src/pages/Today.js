// src/pages/Today.js
//
// The link-in-bio page: today's calls, one tap from any social post. Faces,
// the pick, the number, kickoff countdowns, each row deep-linking to its
// match page - now with the controls a full slate day needs, because a
// Masters Thursday can put forty matches on this page and an undifferentiated
// list of forty is not a card, it's a wall.
//
// Scope is strictly the tournament's calendar day (see isToday): a page called
// Today that shows tomorrow night's matches is lying about its own name.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, localStartTime, localDayLabel, localZoneLabel, matchSlug, isToday, stillUpcoming } from '../utils/matchTime';
import { ledgerNoCall } from '../utils/deployedPick';
import FollowCta from '../components/FollowCta';
import useDocMeta from '../utils/useDocMeta';
import { surfaceBgClass } from '../utils/surfaceBg';
import './Today.css';

const SORTS = {
  time: { label: 'Start time', fn: (a, b) => new Date(a.date) - new Date(b.date) },
  confident: { label: 'Most confident', fn: (a, b) => b.favProb - a.favProb },
  close: { label: 'Closest calls', fn: (a, b) => a.favProb - b.favProb },
};

export default function Today() {
  useDocMeta(
    "Today's Calls, Locked Before Play | Smash",
    "The model's picks for today's tennis, locked before play and graded in public."
  );
  const [all, setAll] = useState(null);
  const [inPlay, setInPlay] = useState([]);
  const [season, setSeason] = useState(null);
  const [tour, setTour] = useState('all');
  const [event, setEvent] = useState('all');
  const [sort, setSort] = useState('time');
  // Read once: the label must not flicker between renders, and a viewer does
  // not change timezone mid-session.
  const zone = useMemo(() => localZoneLabel(), []);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        const today = (d.predictions || []).filter((p) => p.status === 'pending' && isToday(p.date));
        setAll(today.filter((p) => stillUpcoming(p.date)));
        // Started, no result yet. These used to be filtered out and simply
        // vanish: from about half past four each afternoon the page emptied
        // match by match, and those calls sat nowhere on the site until
        // overnight grading put them on the Ledger. A call locked before play
        // is this page's whole claim, so it stays readable until it is graded.
        setInPlay(today.filter((p) => !stillUpcoming(p.date))
          .sort((a, b) => new Date(b.date) - new Date(a.date)));
      })
      .catch(() => { setAll([]); setInPlay([]); });
    fetch(process.env.PUBLIC_URL + '/data/daily_scorecard.json')
      .then((r) => r.json())
      .then((d) => setSeason(d.season))
      .catch(() => setSeason(null));
  }, []);

  // Filter options come from what's actually on today, so the controls can
  // never offer a choice that yields an empty list.
  const events = useMemo(
    () => [...new Set((all || []).map((p) => p.event).filter(Boolean))].sort(),
    [all]
  );
  const tours = useMemo(
    () => [...new Set((all || []).map((p) => p.tour))].sort(),
    [all]
  );

  const shown = useMemo(() => {
    if (!all) return null;
    return all
      .filter((p) => (tour === 'all' || p.tour === tour) && (event === 'all' || p.event === event))
      .sort(SORTS[sort].fn);
  }, [all, tour, event, sort]);

  // [['atp', rows], ['wta', rows]] when both tours are on the card and the
  // reader has not narrowed to one, otherwise null for the single list.
  // Shared by the main card and the in-play section below it, so the two
  // always agree about when a split is worth doing. Null means "render the
  // plain list": one tour on the card, or the reader has already filtered to
  // one, and a two-column grid with an empty side is worse than a list.
  const splitTours = useCallback((list) => {
    if (!list || tour !== 'all') return null;
    const byTour = new Map();
    for (const p of list) {
      if (!byTour.has(p.tour)) byTour.set(p.tour, []);
      byTour.get(p.tour).push(p);
    }
    if (byTour.size < 2) return null;
    return [...byTour.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tour]);

  const splitByTour = useMemo(() => splitTours(shown), [splitTours, shown]);
  const splitInPlay = useMemo(() => splitTours(inPlay), [splitTours, inPlay]);


  // One card, rendered either as two tour columns or as a plain list. Both the
  // main card and the in-play section use it, so a reader never meets two
  // different shapes for the same kind of list on one page.
  const renderCard = (rows, split, started) => (split ? (
    <div className="today-cols">
      {split.map(([tourKey, list]) => (
        <section className="today-col" key={tourKey} aria-label={`${tourKey.toUpperCase()} calls`}>
          <div className="today-col-head">
            <span className="today-col-tour">{tourKey.toUpperCase()}</span>
            <span className="today-col-n">{list.length} {list.length === 1 ? 'call' : 'calls'}</span>
          </div>
          <div className="today-list">{list.map((p) => renderRow(p, started, true))}</div>
        </section>
      ))}
    </div>
  ) : (
    <div className="today-list">{rows.map((p) => renderRow(p, started))}</div>
  ));

  // Only show a control when it can actually change something.
  const showFilters = !!all && all.length > 1 && (tours.length > 1 || events.length > 1);

  // One row, two lists. Extracted when the in-play section arrived: the
  // alternative was a second copy of forty lines that would drift.
  const renderRow = (p, started = false, compact = false) => {
    const when = timeUntil(p.date);
    const start = localStartTime(p.date);
    const favIsP1 = p.favorite === p.p1;
    return (
      <Link key={`${p.tour}-${p.p1}-${p.p2}-${p.date}`} to={`/match/${matchSlug(p)}`}
        className={`today-row${ledgerNoCall(p) ? ' nocall' : ''}${started ? ' started' : ''}`}>
        <span className="today-faces">
          <img src={playerPhoto(p.tour, p.p1)} alt="" loading="lazy" />
          <img src={playerPhoto(p.tour, p.p2)} alt="" loading="lazy" />
        </span>
        <span className="today-match">
          <span className={favIsP1 ? 'fav' : ''}>{p.name1}</span>
          <span className="today-vs"> vs </span>
          <span className={!favIsP1 ? 'fav' : ''}>{p.name2}</span>
          <span className="today-meta">
            {/* The tour is dropped when it is already the section heading:
                repeating "WTA" on thirteen consecutive WTA rows costs width
                the names need. The headings survive the narrow breakpoint
                where the two columns stack, so this stays right there too. */}
            {compact ? '' : `${p.tour.toUpperCase()} · `}{p.event} · {p.surface}
            {/* The scheduled start, then how long until it. The countdown
                alone answered "when" only for someone reading at that exact
                minute, and it says nothing at all once the match is under way. */}
            {' · '}
            <strong className="today-start">{start || 'time TBD'}</strong>
            {started
              ? ' · started'
              : (when && when.label !== 'today' ? ` · ${when.label}` : '')}
          </span>
        </span>
        {ledgerNoCall(p) ? (
          /* A coin flip we declined to call: the lean is on the record
             (locked, graded for audit) but it is not a claim. */
          <span className="today-call nocall">
            <span className="today-nocall-tag">NO CALL</span>
            <span className="today-pick">too close - we lean {lastName(p.favName)} {Math.round(p.favProb * 100)}%</span>
          </span>
        ) : (
          <span className="today-call">
            <span className="today-pct">{Math.round(p.favProb * 100)}%</span>
            <span className="today-pick">{lastName(p.favName)}</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className={`page-background ${surfaceBgClass()}`}>
      <div className="overlay">
        <div className="today-page">
      <div className="eyebrow">TODAY'S CALLS</div>
      <h1 className="today-title">Locked before play</h1>
      {/* Which today. The card is rebuilt through the day and served from a
          cache, so a reader landing on a stale copy had no way to tell what
          day they were looking at - and every start time below is printed in
          their own zone, which is worth naming rather than assuming. */}
      <p className="today-date">
        {localDayLabel()}{zone ? <> · all times {zone}</> : null}
      </p>
      {season && (
        <p className="today-season">
          Season benchmark: {season.correct.toLocaleString()} of {season.n.toLocaleString()} winners
          called ({season.acc}%), every one <Link to="/track-record">on the record</Link>.
          See where we <Link to="/edge">disagree with the bookmakers</Link>, and who was right.
        </p>
      )}

      {/* Above the card, not after it. This page is the landing target for
          every social post, so the reader who arrived another way should meet
          the follow while they still have the page's attention - underneath
          the record, which is the reason to want it. */}
      <div className="today-follow">
        <FollowCta variant="band"
          sub="Today's card and how yesterday's landed, posted every morning" />
      </div>

      {all === null && <div className="skeleton today-skel" />}

      {all && all.length > 0 && (
        <>
          <div className="today-controls">
            {(showFilters || all.length > 2) && (
              <>
                {tours.length > 1 && (
                  <div className="today-seg" role="group" aria-label="Filter by tour">
                    <button type="button" className={tour === 'all' ? 'active' : ''} onClick={() => setTour('all')}>Both</button>
                    {tours.map((t) => (
                      <button key={t} type="button" className={tour === t ? 'active' : ''} onClick={() => setTour(t)}>
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                {events.length > 1 && (
                  <label className="today-select">
                    <span className="today-select-cap">Event</span>
                    <select value={event} onChange={(e) => setEvent(e.target.value)}>
                      <option value="all">All events</option>
                      {events.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                    </select>
                  </label>
                )}
                <label className="today-select">
                  <span className="today-select-cap">Sort</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                </label>
              </>
            )}
            <span className="today-count">
              {shown.length} of {all.length} {all.length === 1 ? 'call' : 'calls'} today
            </span>
          </div>

          <Link to="/risk" className="today-parlay-cta">
            Stack today's calls into a parlay and see what the odds actually say →
          </Link>
        </>
      )}

      {all && all.length === 0 && (
        <div className="today-empty">
          Nothing on today's card. Predictions lock for the grand slams and the
          big combined events (Indian Wells through Cincinnati) as their matches
          are scheduled - meanwhile, <Link to="/h2h">run any matchup yourself</Link> or
          see <Link to="/edge">where we split with the bookmakers</Link>.
        </div>
      )}

      {shown && shown.length === 0 && all.length > 0 && (
        <div className="today-empty">
          No calls match those filters. <button type="button" className="today-reset" onClick={() => { setTour('all'); setEvent('all'); }}>Clear them</button>.
        </div>
      )}

      {/* Two tours, two columns. A slam Tuesday is forty rows in one stack,
          which is a long scroll to answer "what is on today" - and the two
          tours are separate cards a reader is rarely comparing across. Split
          only when BOTH are showing and there is room: filtered to one tour,
          or on a phone, a two-column grid with one empty side is worse than
          the list it replaced. The tour meta on each row stays, because the
          columns collapse and the row has to stand on its own. */}
      {shown && shown.length > 0 && renderCard(shown, splitByTour, false)}

      {/* Started, waiting on a result. The same rows, dimmed, under their own
          heading: the call was locked before play and stays readable, but
          nothing here is bettable any more and the section says so rather
          than letting the rows quietly disappear. */}
      {inPlay.length > 0 && (
        <section className="today-inplay">
          <div className="today-inplay-head">
            <span className="today-inplay-cap">In play, awaiting result</span>
            <span className="today-inplay-sub">
              {inPlay.length} {inPlay.length === 1 ? 'call' : 'calls'} locked before play and
              under way. {inPlay.length === 1 ? 'It grades' : 'They grade'} overnight, onto{' '}
              <Link to="/track-record">the Ledger</Link>.
            </span>
          </div>
          {renderCard(inPlay, splitInPlay, true)}
        </section>
      )}

      <div className="today-footer">
        <Link to="/">Explore the engine</Link>
        <Link to="/risk">Risk Lab</Link>
        <Link to="/track-record">The receipts</Link>
      </div>
        </div>
      </div>
    </div>
  );
}
