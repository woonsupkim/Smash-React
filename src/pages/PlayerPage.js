// src/pages/PlayerPage.js
//
// One page per player: photo, rank, recent form, the model's record when
// predicting them, live title odds if they're in the current draw, and
// their next locked match. Linked from match pages and anywhere a face
// appears. URL: /player/:tour/:id
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, matchSlug } from '../utils/matchTime';
import './PlayerPage.css';

export default function PlayerPage() {
  const { tour = 'atp', id } = useParams();
  const [row, setRow] = useState(undefined);
  const [record, setRecord] = useState(null);
  const [titleProb, setTitleProb] = useState(null);
  const [nextMatch, setNextMatch] = useState(null);

  useEffect(() => {
    const dir = tour === 'wta' ? '/data/women' : '/data';
    Papa.parse(process.env.PUBLIC_URL + dir + '/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => setRow(data.find((r) => r.id === id) || null),
      error: () => setRow(null),
    });
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => {
        const mine = (d.matches || []).filter((m) => m.tour === tour && (m.p1 === id || m.p2 === id));
        const won = mine.filter((m) => m.winner === id).length;
        const called = mine.filter((m) => m.smashCorrect).length;
        setRecord({ n: mine.length, won, called });
      })
      .catch(() => setRecord(null));
    fetch(process.env.PUBLIC_URL + '/data/title_odds.json')
      .then((r) => r.json())
      .then((d) => {
        const o = d.events?.[tour];
        if (!o || o.status !== 'live') { setTitleProb(null); return; }
        const entry = o.odds.find((e) => e.id === id);
        setTitleProb(entry ? { prob: entry.prob, event: o.event } : null);
      })
      .catch(() => setTitleProb(null));
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => {
        const next = (d.predictions || [])
          .filter((p) => p.status === 'pending' && p.tour === tour && (p.p1 === id || p.p2 === id))
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        setNextMatch(next || null);
      })
      .catch(() => setNextMatch(null));
  }, [tour, id]);

  if (row === undefined) return <div className="player-page"><div className="skeleton player-skel" /></div>;
  if (row === null) {
    return (
      <div className="player-page">
        <div className="eyebrow">PLAYER</div>
        <h1 className="player-name">Player not found</h1>
        <p className="player-sub">They may not be in the current rated roster.</p>
        <Link className="player-cta" to="/h2h">Browse the studio →</Link>
      </div>
    );
  }

  const when = nextMatch ? timeUntil(nextMatch.date) : null;
  const isFav = nextMatch && nextMatch.favorite === id;

  return (
    <div className="player-page">
      <div className="eyebrow">{tour.toUpperCase()} · PLAYER</div>
      <div className="player-head">
        <img className="player-photo" src={playerPhoto(tour, id)} alt={row.name} />
        <div>
          <h1 className="player-name">{row.name}</h1>
          <div className="player-meta">
            {row.us_seed && <span>World No. {row.us_seed}</span>}
            {row.recent_w !== '' && row.recent_w != null && <span>{row.recent_w}-{row.recent_l} recent form</span>}
            {row.age && <span>{row.age} yrs</span>}
          </div>
        </div>
      </div>

      <div className="player-facts">
        {record && record.n > 0 && (
          <div className="player-fact">
            <div className="player-fact-label">This season, on our record</div>
            <div className="player-fact-val">{record.won}-{record.n - record.won}</div>
            <div className="player-fact-sub">
              we called {record.called} of {record.n} of their matches right ({Math.round((record.called / record.n) * 100)}%)
            </div>
          </div>
        )}
        {titleProb && (
          <div className="player-fact">
            <div className="player-fact-label">{titleProb.event} title odds</div>
            <div className="player-fact-val">{Math.round(titleProb.prob * 100)}%</div>
            <div className="player-fact-sub">the remaining draw, played out 2,000 times</div>
          </div>
        )}
        {nextMatch && (
          <div className="player-fact">
            <div className="player-fact-label">Next locked match</div>
            <Link className="player-cta" to={`/match/${matchSlug(nextMatch)}`}>
              vs {(nextMatch.p1 === id ? nextMatch.name2 : nextMatch.name1)} →
            </Link>
            <div className="player-fact-sub">
              {isFav ? `our pick at ${Math.round(nextMatch.favProb * 100)}%` : `underdog by our math`}
              {when ? ` · ${when.label}` : ''}
            </div>
          </div>
        )}
      </div>

      <Link className="player-cta player-studio" to={`${tour === 'wta' ? '/women' : ''}/h2h?a=${id}`}>
        Put {row.name.split(' ').pop()} in the studio →
      </Link>
    </div>
  );
}
