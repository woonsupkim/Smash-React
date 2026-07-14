// src/pages/Today.js
//
// The link-in-bio page: today's calls, one tap from any social post. Kept
// deliberately minimal - faces, the pick, the number, kickoff countdowns,
// each row deep-linking to its match page.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, matchSlug } from '../utils/matchTime';
import './Today.css';

export default function Today() {
  const [picks, setPicks] = useState(null);
  const [season, setSeason] = useState(null);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setPicks((d.predictions || [])
        .filter((p) => p.status === 'pending')
        .sort((a, b) => new Date(a.date) - new Date(b.date))))
      .catch(() => setPicks([]));
    fetch(process.env.PUBLIC_URL + '/data/daily_scorecard.json')
      .then((r) => r.json())
      .then((d) => setSeason(d.season))
      .catch(() => setSeason(null));
  }, []);

  return (
    <div className="today-page">
      <div className="eyebrow">TODAY'S CALLS</div>
      <h1 className="today-title">Locked before play</h1>
      {season && (
        <p className="today-season">
          Season so far: {season.correct.toLocaleString()} of {season.n.toLocaleString()} winners
          called ({season.acc}%), every one <Link to="/track-record">on the record</Link>.
        </p>
      )}

      {picks === null && <div className="skeleton today-skel" />}
      {picks && picks.length === 0 && (
        <div className="today-empty">
          No calls on the board right now. Predictions lock when a grand slam
          draw drops - meanwhile, <Link to="/h2h">run any matchup yourself</Link>.
        </div>
      )}
      {picks && picks.length > 0 && (
        <div className="today-list">
          {picks.map((p) => {
            const when = timeUntil(p.date);
            const favIsP1 = p.favorite === p.p1;
            return (
              <Link key={p.id} to={`/match/${matchSlug(p)}`} className="today-row">
                <span className="today-faces">
                  <img src={playerPhoto(p.tour, p.p1)} alt="" loading="lazy" />
                  <img src={playerPhoto(p.tour, p.p2)} alt="" loading="lazy" />
                </span>
                <span className="today-match">
                  <span className={favIsP1 ? 'fav' : ''}>{p.name1}</span>
                  <span className="today-vs"> vs </span>
                  <span className={!favIsP1 ? 'fav' : ''}>{p.name2}</span>
                  <span className="today-meta">{p.event} · {p.surface}{when ? ` · ${when.label}` : ''}</span>
                </span>
                <span className="today-call">
                  <span className="today-pct">{Math.round(p.favProb * 100)}%</span>
                  <span className="today-pick">{p.favName.split(' ').pop()}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="today-footer">
        <Link to="/">Explore the engine</Link>
        <Link to="/dream-brackets">Bracket pools</Link>
        <Link to="/track-record">The receipts</Link>
      </div>
    </div>
  );
}
