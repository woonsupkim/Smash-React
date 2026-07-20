// src/pages/FormChart.js
//
// THE FORM CHART: the Elo alternative to the official rankings - who is
// actually playing the best tennis right now, and who is moving. Renders
// entirely from elo.json (current ratings) + elo_history.json (the curves),
// both already published per tour. The off-season's living page: ratings
// keep moving as long as anyone is playing anywhere.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { countryFlagUrl } from '../components/countryFlags';
import { lastName } from '../utils/names';
import useDocMeta from '../utils/useDocMeta';
import './FormChart.css';

const TOP_N = 25;
const MOVER_DAYS = 14;

// Rating change over the trailing window, from the player's history curve.
function delta(hist, days) {
  if (!hist || hist.length < 2) return null;
  const nowPoint = hist[hist.length - 1];
  const cutoff = new Date(Date.parse(`${nowPoint[0]}T00:00:00Z`) - days * 864e5);
  // Last point at or before the cutoff; if the player hasn't played since
  // before the window there is no move to report.
  let base = null;
  for (const [d, r] of hist) {
    if (new Date(d) <= cutoff) base = r;
    else break;
  }
  if (base == null) return null;
  return nowPoint[1] - base;
}

export default function FormChart() {
  useDocMeta(
    'The Form Chart: Elo Ratings & Movers | Smash',
    'Who is actually playing the best tennis right now: live Elo form ratings for ATP and WTA, with the biggest movers of the last two weeks.'
  );
  const [tour, setTour] = useState('atp');
  const [elo, setElo] = useState(null);
  const [hist, setHist] = useState(null);
  const [roster, setRoster] = useState(null);

  useEffect(() => {
    const dir = tour === 'wta' ? '/data/women' : '/data';
    setElo(null); setHist(null); setRoster(null);
    fetch(process.env.PUBLIC_URL + `${dir}/elo.json`).then((r) => r.json()).then(setElo).catch(() => setElo({}));
    fetch(process.env.PUBLIC_URL + `${dir}/elo_history.json`).then((r) => r.json()).then(setHist).catch(() => setHist({}));
    Papa.parse(process.env.PUBLIC_URL + `${dir}/smash_us.csv`, {
      header: true,
      download: true,
      complete: ({ data }) => setRoster(data.filter((r) => r.id && r.name)),
      error: () => setRoster([]),
    });
  }, [tour]);

  const rows = useMemo(() => {
    if (!elo || !roster) return null;
    const byId = new Map(roster.map((r) => [r.id, r]));
    return Object.entries(elo)
      .filter(([id, e]) => byId.has(id) && e.all)
      .map(([id, e]) => ({
        id,
        name: byId.get(id).name,
        country: byId.get(id).country || byId.get(id).country_acr || null,
        rank: Number(byId.get(id).us_seed) || null,
        elo: e.all,
        d14: hist ? delta(hist[id], MOVER_DAYS) : null,
      }))
      .sort((a, b) => b.elo - a.elo);
  }, [elo, hist, roster]);

  const movers = useMemo(() => {
    if (!rows) return { up: [], down: [] };
    const moved = rows.filter((r) => r.d14 != null && r.d14 !== 0);
    return {
      up: [...moved].sort((a, b) => b.d14 - a.d14).slice(0, 5).filter((r) => r.d14 > 0),
      down: [...moved].sort((a, b) => a.d14 - b.d14).slice(0, 5).filter((r) => r.d14 < 0),
    };
  }, [rows]);

  if (!rows) return <div className="form-page"><div className="skeleton form-skel" /></div>;

  const arrow = (d) => (d == null ? <span className="form-flat">·</span> : d > 0
    ? <span className="form-up">▲ {d}</span>
    : d < 0 ? <span className="form-down">▼ {Math.abs(d)}</span> : <span className="form-flat">=</span>);

  return (
    <div className="form-page">
      <div className="eyebrow">THE FORM CHART</div>
      <h1 className="form-title">Who's actually hot right now</h1>
      <p className="form-sub">
        The official rankings reward the last 52 weeks. Elo form rewards the last
        few matches, weighted by who they came against - this is the list our Form
        engine actually uses. Arrows are the last {MOVER_DAYS} days.
      </p>

      <div className="form-seg" role="group" aria-label="Tour">
        {[['atp', 'ATP'], ['wta', 'WTA']].map(([v, l]) => (
          <button key={v} type="button" className={`form-seg-btn${tour === v ? ' active' : ''}`} onClick={() => setTour(v)}>{l}</button>
        ))}
      </div>

      {(movers.up.length > 0 || movers.down.length > 0) && (
        <section className="form-movers">
          {[['Heating up', movers.up], ['Cooling off', movers.down]].map(([label, list]) => list.length > 0 && (
            <div className="form-mover-col" key={label}>
              <div className="form-section-label">{label}</div>
              {list.map((r) => (
                <Link key={r.id} to={`/player/${tour}/${r.id}`} className="form-mover">
                  <img className="form-face" src={playerPhoto(tour, r.id)} alt="" loading="lazy" />
                  <span className="form-mover-name">{lastName(r.name)}</span>
                  {arrow(r.d14)}
                </Link>
              ))}
            </div>
          ))}
        </section>
      )}

      <div className="form-section-label">The chart · top {TOP_N} by form</div>
      <div className="form-table" role="table" aria-label={`${tour.toUpperCase()} Elo form ratings`}>
        <div className="form-tr head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Player</span>
          <span role="columnheader">Form (Elo)</span>
          <span role="columnheader">{MOVER_DAYS}d</span>
          <span role="columnheader">Rank</span>
        </div>
        {rows.slice(0, TOP_N).map((r, i) => (
          <Link className="form-tr" role="row" key={r.id} to={`/player/${tour}/${r.id}`}>
            <span role="cell" className="form-pos">{i + 1}</span>
            <span role="cell" className="form-player">
              <img className="form-face" src={playerPhoto(tour, r.id)} alt="" loading="lazy" />
              {countryFlagUrl(r.country) && <img className="form-flag" src={countryFlagUrl(r.country)} alt="" />}
              {r.name}
            </span>
            <span role="cell" className="form-elo">{r.elo}</span>
            <span role="cell">{arrow(r.d14)}</span>
            <span role="cell" className="form-rank">{r.rank ? `#${r.rank}` : '-'}</span>
          </Link>
        ))}
      </div>

      <p className="form-foot">
        Ratings update with every refresh; surface-specific curves live on each{' '}
        player page. How Elo feeds the deployed model: <Link to="/model">the Engine Room</Link>.
      </p>
    </div>
  );
}
