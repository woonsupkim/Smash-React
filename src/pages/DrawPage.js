// src/pages/DrawPage.js
//
// The real tournament draw as a survival table: every line of the bracket
// with the model's round-by-round probabilities (make the QF, the semis,
// the final, the title), straight from the same simulation that prices the
// championship odds. Rows sit in draw order, so consecutive pairs are the
// actual current matchups.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil } from '../utils/matchTime';
import './DrawPage.css';

// Distinct line colors for the race chart, lime first (the leader).
const RACE_COLORS = ['#c6ff1c', '#5b8cff', '#e8694a', '#3ddc84', '#f2c14e', '#c792ea'];

// Column label from the field size a win puts you into: 8 left = you made
// the quarterfinals, and so on.
function roundLabel(resultingSize) {
  if (resultingSize === 1) return 'Title';
  if (resultingSize === 2) return 'Final';
  if (resultingSize === 4) return 'SF';
  if (resultingSize === 8) return 'QF';
  return `R${resultingSize}`;
}

function heat(p) {
  if (p == null) return {};
  // Lime wash scaled by probability; text brightens with it.
  const alpha = Math.min(0.55, p * 0.6);
  return { background: `rgba(198, 255, 28, ${alpha.toFixed(3)})`, color: p >= 0.35 ? '#0d1117' : undefined };
}

export default function DrawPage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tour, setTour] = useState('atp');

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/title_odds.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const entry = data?.events?.[tour];
  const rounds = useMemo(() => {
    if (!entry?.draw) return [];
    const n = entry.draw.field.length;
    const out = [];
    for (let s = n / 2; s >= 1; s /= 2) out.push(roundLabel(s));
    return out;
  }, [entry]);

  const startsIn = entry?.startsAt ? timeUntil(entry.startsAt) : null;

  // The title race: daily odds snapshots as lines, top 6 of the most recent
  // multi-player snapshot. Needs at least two days of history to be a chart.
  const race = useMemo(() => {
    const hist = (entry?.history || []).filter((h) => h.fieldSize > 1 && h.odds && Object.keys(h.odds).length > 1);
    if (hist.length < 2) return null;
    // Contenders by PEAK odds across the tournament, not just the latest
    // snapshot - an eliminated favorite's collapse is part of the story.
    const peak = new Map();
    for (const h of hist) {
      for (const [n, v] of Object.entries(h.odds)) peak.set(n, Math.max(peak.get(n) || 0, v));
    }
    const names = [...peak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
    const data = hist.map((h) => ({
      date: h.date.slice(5).replace('-', '/'),
      ...Object.fromEntries(names.map((n) => [n, h.odds[n] != null ? Math.round(h.odds[n] * 100) : null])),
    }));
    return { names, data };
  }, [entry]);

  return (
    <div className="draw-page">
      <div className="eyebrow">THE DRAW</div>
      <div className="draw-head">
        <h1 className="draw-title">{entry ? entry.event : 'Tournament draw'}</h1>
        <div className="draw-controls" role="group" aria-label="Tour">
          {[['atp', 'ATP'], ['wta', 'WTA']].map(([v, l]) => (
            <button key={v} type="button" className={`draw-seg-btn${tour === v ? ' active' : ''}`} onClick={() => setTour(v)}>{l}</button>
          ))}
        </div>
      </div>

      {failed && (
        <div className="draw-empty">
          The bracket isn't priced yet - the moment draw data lands, we simulate it
          2,000 times and publish every player's path here. Until then, the H2H studio
          will happily run any matchup you're curious about.
        </div>
      )}
      {!data && !failed && <div className="skeleton draw-skel" />}

      {entry && (
        <>
          <div className="draw-status-row">
            {entry.status === 'live' && <span className="draw-chip live">LIVE · {entry.fieldSize} LEFT</span>}
            {entry.status === 'final' && <span className="draw-chip final">FINAL</span>}
            {entry.status === 'projection' && (
              <span className="draw-chip projection">
                PROJECTION{startsIn && !startsIn.past ? ` · STARTS ${startsIn.label.toUpperCase()}` : ''}
              </span>
            )}
            <span className="draw-surface">{entry.surface} court</span>
            <span className="draw-updated">updated {new Date(entry.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>

          {entry.status === 'final' && entry.champion && (
            <div className="draw-champion">
              {entry.champion.id && (
                <img src={playerPhoto(tour, entry.champion.id)} alt="" className="draw-champion-face" />
              )}
              <span><strong>{entry.champion.name}</strong> took the title. The table below is our last look at the bracket before it was decided.</span>
            </div>
          )}
          {entry.status === 'projection' && (
            <p className="draw-note">
              No live draw right now, so this is the road to the {entry.event}: the top 16 by
              ranking, seeded the standard way, simulated on {entry.surface}. It re-prices with
              every data refresh until the real draw drops.
            </p>
          )}
          {entry.status === 'live' && (
            <p className="draw-note">
              Every remaining line of the draw, with the chance the model gives it round by
              round. Adjacent rows are the actual matchups.
            </p>
          )}

          {entry.draw ? (
            <div className="draw-table-wrap">
              <table className="draw-table">
                <thead>
                  <tr>
                    <th className="draw-th-player">Player</th>
                    {rounds.map((r) => <th key={r}>{r}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {entry.draw.field.map((p, i) => {
                    const surv = entry.draw.survival[i] || [];
                    const pairEnd = i % 2 === 1;
                    const quarter = entry.draw.field.length >= 8 && i > 0 && i % (entry.draw.field.length / 4) === 0;
                    return (
                      <tr key={`${p.name}-${i}`} className={`${pairEnd ? 'pair-end' : ''}${quarter ? ' quarter-start' : ''}`}>
                        <td className="draw-td-player">
                          {p.id ? (
                            <Link to={`/player/${tour}/${p.id}`} className="draw-player-link">
                              <img src={playerPhoto(tour, p.id)} alt="" className="draw-face" loading="lazy" />
                              <span className="draw-name">{p.name}</span>
                              {p.rank ? <span className="draw-rank">#{p.rank}</span> : null}
                            </Link>
                          ) : (
                            <span className="draw-player-link">
                              <span className="draw-face draw-face-empty" aria-hidden="true" />
                              <span className="draw-name unrostered">{p.name}</span>
                            </span>
                          )}
                        </td>
                        {surv.map((s, r) => (
                          <td key={r} className="draw-cell" style={heat(s)}>
                            {s >= 0.995 ? '>99' : s < 0.005 ? '<1' : Math.round(s * 100)}%
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="draw-empty">
              No bracket snapshot for this event yet - it lands with the next data
              refresh, already simulated 2,000 times. The projected field above
              re-prices with every refresh in the meantime.
            </div>
          )}

          {race && (
            <section className="draw-race">
              <h2 className="draw-race-title">The title race</h2>
              <p className="draw-note">
                Each line is a contender's chance to win it all, re-priced after every
                session of play. The story of the tournament in one picture.
              </p>
              <div className="draw-race-chart">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={race.data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#9aa1ab', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.15)' }} />
                    <YAxis unit="%" tick={{ fill: '#9aa1ab', fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip
                      formatter={(v) => [`${v}%`]}
                      contentStyle={{ background: '#141922', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, fontSize: 13 }}
                      labelStyle={{ color: '#ced2d8' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#ced2d8' }} />
                    {race.names.map((n, i) => (
                      <Line
                        key={n}
                        type="monotone"
                        dataKey={n}
                        stroke={RACE_COLORS[i % RACE_COLORS.length]}
                        strokeWidth={i === 0 ? 3 : 2}
                        dot={{ r: 2.5 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
          {!race && entry.status !== 'final' && (
            <p className="draw-race-pending">
              The title-race chart draws itself here as daily snapshots accumulate,
              one point per refresh.
            </p>
          )}

          <p className="draw-foot">
            Read it like a forecast: {rounds.length >= 2 ? `the "${rounds[rounds.length - 1]}" column is the championship odds on the Home page, the earlier columns are the steps to get there.` : ''} Numbers
            come from {(entry.status === 'projection' ? 2000 : 2000).toLocaleString()} simulated
            tournaments and re-price after every session of play. <Link to="/methodology">How the model works</Link>.
          </p>
        </>
      )}
    </div>
  );
}
