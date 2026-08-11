// src/pages/Today.js
//
// The link-in-bio page: today's calls, one tap from any social post. Faces,
// the pick, the number, kickoff countdowns, each row deep-linking to its
// match page - now with the controls a full slate day needs, because a
// Masters Thursday can put forty matches on this page and an undifferentiated
// list of forty is not a card, it's a wall.
//
// Scope is strictly the viewer's calendar day (see isToday): a page called
// Today that shows tomorrow night's matches is lying about its own name.
import React, { useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, matchSlug, isToday, isPlaceholderTime } from '../utils/matchTime';
import PushToggle from '../components/PushToggle';
import useDocMeta from '../utils/useDocMeta';
import './Today.css';

// A real-timed match that kicked off well over a match-length ago has already
// finished; drop it so already-played calls don't linger on today's board.
// Placeholder-timed matches carry no real clock, so they stay for their day.
const FINISHED_AFTER_MS = 5.5 * 60 * 60 * 1000; // a long best-of-five, plus a buffer
const stillUpcoming = (p) => isPlaceholderTime(p.date) || (Date.now() - new Date(p.date).getTime()) < FINISHED_AFTER_MS;

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
  const [season, setSeason] = useState(null);
  const [tour, setTour] = useState('all');
  const [event, setEvent] = useState('all');
  const [sort, setSort] = useState('time');

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setAll((d.predictions || []).filter((p) => p.status === 'pending' && isToday(p.date) && stillUpcoming(p))))
      .catch(() => setAll([]));
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

  // Only show a control when it can actually change something.
  const showFilters = !!all && all.length > 1 && (tours.length > 1 || events.length > 1);

  return (
    <div className="today-page">
      <div className="eyebrow">TODAY'S CALLS</div>
      <h1 className="today-title">Locked before play</h1>
      <PushToggle />
      {season && (
        <p className="today-season">
          Season benchmark: {season.correct.toLocaleString()} of {season.n.toLocaleString()} winners
          called ({season.acc}%), every one <Link to="/track-record">on the record</Link>.
          See where we <Link to="/edge">disagree with the bookmakers</Link>, and who was right.
        </p>
      )}

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

          <Link to="/parlay" className="today-parlay-cta">
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

      {shown && shown.length > 0 && (
        <div className="today-list">
          {shown.map((p) => {
            const when = timeUntil(p.date);
            const favIsP1 = p.favorite === p.p1;
            return (
              <Link key={`${p.tour}-${p.p1}-${p.p2}-${p.date}`} to={`/match/${matchSlug(p)}`} className="today-row">
                <span className="today-faces">
                  <img src={playerPhoto(p.tour, p.p1)} alt="" loading="lazy" />
                  <img src={playerPhoto(p.tour, p.p2)} alt="" loading="lazy" />
                </span>
                <span className="today-match">
                  <span className={favIsP1 ? 'fav' : ''}>{p.name1}</span>
                  <span className="today-vs"> vs </span>
                  <span className={!favIsP1 ? 'fav' : ''}>{p.name2}</span>
                  <span className="today-meta">
                    {p.tour.toUpperCase()} · {p.event} · {p.surface}{when ? ` · ${when.label}` : ''}
                  </span>
                </span>
                <span className="today-call">
                  <span className="today-pct">{Math.round(p.favProb * 100)}%</span>
                  <span className="today-pick">{lastName(p.favName)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="today-footer">
        <Link to="/">Explore the engine</Link>
        <Link to="/parlay">Parlay builder</Link>
        <Link to="/track-record">The receipts</Link>
      </div>
    </div>
  );
}
