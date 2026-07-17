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
import { pickCorrect } from '../utils/deployedPick';
import EloChart from '../components/EloChart';
import './PlayerPage.css';

// Tiny lime polyline of a value series (same visual family as the Home
// odds sparklines).
function Spark({ values, w = 110, h = 26 }) {
  if (!values || values.length < 2) return null;
  const pad = 2;
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values);
  const span = Math.max(max - min, 0.005);
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent-brand)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function PlayerPage() {
  const { tour = 'atp', id } = useParams();
  const [row, setRow] = useState(undefined);
  const [record, setRecord] = useState(null);
  const [titleProb, setTitleProb] = useState(null);
  const [nextMatch, setNextMatch] = useState(null);
  const [form, setForm] = useState(null);      // last 10 tracked results, oldest first
  const [surfaces, setSurfaces] = useState(null); // per-surface splits
  const [oddsHist, setOddsHist] = useState(null); // title-odds history series
  const [eloHist, setEloHist] = useState(null);   // form-rating curve

  useEffect(() => {
    const dir = tour === 'wta' ? '/data/women' : '/data';
    fetch(process.env.PUBLIC_URL + dir + '/elo_history.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((h) => setEloHist(h[id] || null))
      .catch(() => setEloHist(null));
    Papa.parse(process.env.PUBLIC_URL + dir + '/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => setRow(data.find((r) => r.id === id) || null),
      error: () => setRow(null),
    });
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => {
        const mine = (d.matches || [])
          .filter((m) => m.tour === tour && (m.p1 === id || m.p2 === id))
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        const won = mine.filter((m) => m.winner === id).length;
        const called = mine.filter((m) => pickCorrect(m)).length;
        setRecord({ n: mine.length, won, called });

        // Last 10 tracked results, with the opponent for tooltips.
        setForm(mine.slice(-10).map((m) => ({
          won: m.winner === id,
          opp: (m.p1 === id ? m.name2 : m.name1).split(' ').pop(),
          score: m.score,
          date: m.date,
        })));

        // Surface splits: their W-L plus how well we read them there.
        const splits = ['hard', 'clay', 'grass'].map((s) => {
          const list = mine.filter((m) => m.surface === s);
          if (!list.length) return null;
          const w = list.filter((m) => m.winner === id).length;
          const c = list.filter((m) => pickCorrect(m)).length;
          return { surface: s, w, l: list.length - w, calledPct: Math.round((c / list.length) * 100) };
        }).filter(Boolean);
        setSurfaces(splits);
      })
      .catch(() => setRecord(null));
    fetch(process.env.PUBLIC_URL + '/data/title_odds.json')
      .then((r) => r.json())
      .then((d) => {
        const o = d.events?.[tour];
        if (!o) { setTitleProb(null); return; }
        if (o.status === 'live') {
          const entry = o.odds.find((e) => e.id === id);
          setTitleProb(entry ? { prob: entry.prob, event: o.event } : null);
        } else {
          setTitleProb(null);
        }
        // Title-odds history line: this player's chance to win it all, day
        // by day across the event's snapshots (history is keyed by name).
        const roster = o.odds || [];
        const name = roster.find((e) => e.id === id)?.name;
        if (name && o.history) {
          const series = o.history
            .filter((h) => h.fieldSize > 1 && h.odds)
            .map((h) => h.odds[name])
            .filter((v) => v != null);
          setOddsHist(series.length >= 2 ? { series, event: o.event } : null);
        } else {
          setOddsHist(null);
        }
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

      {form && form.length >= 3 && (
        <div className="player-form">
          <div className="player-fact-label">Last {form.length} tracked matches</div>
          <div className="player-form-dots">
            {form.map((f, i) => (
              <span
                key={i}
                className={`player-form-dot ${f.won ? 'w' : 'l'}`}
                title={`${f.won ? 'def.' : 'lost to'} ${f.opp}${f.score ? ` ${f.score}` : ''}`}
              >
                {f.won ? 'W' : 'L'}
              </span>
            ))}
          </div>
          <div className="player-form-sub">oldest to newest · hover a result for the opponent</div>
        </div>
      )}

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
        {oddsHist && (
          <div className="player-fact">
            <div className="player-fact-label">{oddsHist.event} title odds, day by day</div>
            <div className="player-fact-spark">
              <Spark values={oddsHist.series} />
              <span className="player-fact-val player-fact-val-sm">
                {Math.round(oddsHist.series[oddsHist.series.length - 1] * 100)}%
              </span>
            </div>
            <div className="player-fact-sub">one point per refresh, from the tournament sim</div>
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

      {eloHist && eloHist.length >= 8 && (
        <div className="player-elo">
          <div className="player-fact-label">Form rating, match by match</div>
          <EloChart series={[{ points: eloHist, color: 'var(--accent-brand)', label: row?.name || id }]} />
          <div className="player-fact-sub">
            the Elo curve behind the Form engine · one point per match since Jan 2025 · dashed lines mark grand slam starts
          </div>
        </div>
      )}

      {surfaces && surfaces.length > 0 && (
        <div className="player-surfaces">
          <div className="player-fact-label">By surface, this season</div>
          <div className="player-surfaces-grid">
            {surfaces.map((s) => (
              <div className="player-surface-cell" key={s.surface}>
                <span className={`player-surface-tag s-${s.surface}`}>{s.surface}</span>
                <span className="player-surface-rec">{s.w}-{s.l}</span>
                <span className="player-surface-sub">we read them right {s.calledPct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Link className="player-cta player-studio" to={`${tour === 'wta' ? '/women' : ''}/h2h?a=${id}`}>
        Put {row.name.split(' ').pop()} in the studio →
      </Link>
    </div>
  );
}
