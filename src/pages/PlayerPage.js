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

// Grand slam start dates (same calendar rules as Home/pipeline) for the
// Elo chart's event markers.
function slamMarks(fromMs, toMs) {
  const nthMonday = (y, mo, n) => {
    const d = new Date(Date.UTC(y, mo, 1));
    return Date.UTC(y, mo, 1 + ((8 - d.getUTCDay()) % 7) + (n - 1) * 7);
  };
  const lastWeekday = (y, mo, wd) => {
    const d = new Date(Date.UTC(y, mo + 1, 0));
    return Date.UTC(y, mo, d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7));
  };
  const out = [];
  for (let y = new Date(fromMs).getUTCFullYear(); y <= new Date(toMs).getUTCFullYear(); y++) {
    out.push(
      { t: nthMonday(y, 0, 3), label: 'AO' },
      { t: lastWeekday(y, 4, 0), label: 'RG' },
      { t: lastWeekday(y, 5, 1), label: 'W' },
      { t: lastWeekday(y, 7, 1), label: 'UO' },
    );
  }
  return out.filter((s) => s.t >= fromMs && s.t <= toMs);
}

// Full-width Elo form curve with slam markers - the Form engine's visible
// story. Same hand-rolled SVG family as Spark, just bigger.
function EloChart({ points }) {
  if (!points || points.length < 8) return null;
  const W = 640, H = 190, PAD = { l: 46, r: 54, t: 14, b: 26 };
  const series = points.map(([d, r]) => ({ t: new Date(d + 'T00:00:00Z').getTime(), r }));
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const rMin = Math.min(...series.map((p) => p.r)), rMax = Math.max(...series.map((p) => p.r));
  const span = Math.max(rMax - rMin, 40);
  const lo = rMin - span * 0.12, hi = rMax + span * 0.12;
  const x = (t) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD.l - PAD.r);
  const y = (r) => H - PAD.b - ((r - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const pts = series.map((p) => `${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  const marks = slamMarks(t0, t1);
  const last = series[series.length - 1];
  const grid = [Math.round(rMin / 50) * 50, Math.round(((rMin + rMax) / 2) / 50) * 50, Math.round(rMax / 50) * 50];
  return (
    <svg
      className="player-elo-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Form rating over time, from ${series[0].r} to ${last.r}, with grand slam starts marked`}
    >
      {grid.map((g) => (
        <g key={g}>
          <line x1={PAD.l} y1={y(g)} x2={W - PAD.r} y2={y(g)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">{g}</text>
        </g>
      ))}
      {marks.map((s) => (
        <g key={s.t}>
          <line x1={x(s.t)} y1={PAD.t} x2={x(s.t)} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 4" />
          <text x={x(s.t)} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="var(--text-3)">{s.label}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke="var(--accent-brand)" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(last.t)} cy={y(last.r)} r="3.5" fill="var(--accent-brand)" />
      <text x={Math.min(x(last.t) + 8, W - 4)} y={y(last.r) + 4} fontSize="12" fontWeight="700" fill="var(--accent-brand)">{last.r}</text>
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
          <EloChart points={eloHist} />
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
