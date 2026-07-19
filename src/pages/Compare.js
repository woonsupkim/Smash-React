// src/pages/Compare.js
//
// N-way player comparison: /compare/:tour/:slugs with full-name slugs
// ("jannik-sinner-vs-carlos-alcaraz-vs-novak-djokovic", 2-4 players).
// Overlaid Elo form curves, the season facts that matter, our graded record
// on each player, and the model's pairwise read on every surface - all from
// data files the pipeline already publishes. The /compare hub builds the
// URL; the URL is the shareable product (the "who's better" search intent).
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { slugify } from '../utils/slug';
import { lastName } from '../utils/names';
import { pickCorrect } from '../utils/deployedPick';
import { matchProb } from '../analyticProb';
import EloChart from '../components/EloChart';
import useDocMeta from '../utils/useDocMeta';
import './Compare.css';

const SURFACE_CSV = [
  ['hard', 'smash_us.csv', 'Hard'],
  ['clay', 'smash_fr.csv', 'Clay'],
  ['grass', 'smash_wb.csv', 'Grass'],
];
const SERIES_COLORS = ['var(--accent-brand)', 'rgba(255,255,255,0.85)', '#5b8cff', '#e8694a'];
const rowToProbs = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);
const hasStats = (r) => r && ['p1', 'p2', 'p3', 'p4', 'p5'].every((k) => Number(r[k]) > 0);

export function CompareHub() {
  useDocMeta(
    'Compare Any Players | Smash',
    'Pick two to four players and compare form curves, season records, and the model\'s read on every surface.'
  );
  const [tour, setTour] = useState('atp');
  const [roster, setRoster] = useState([]);
  const [picks, setPicks] = useState(['', '', '']);
  const navigate = useNavigate();

  useEffect(() => {
    const dir = tour === 'wta' ? '/data/women' : '/data';
    Papa.parse(process.env.PUBLIC_URL + `${dir}/smash_us.csv`, {
      header: true,
      download: true,
      complete: ({ data }) => setRoster(data.filter((r) => r.id && r.name).sort((a, b) => (Number(a.us_seed) || 999) - (Number(b.us_seed) || 999))),
    });
  }, [tour]);

  const chosen = picks.filter(Boolean);
  const go = () => {
    if (chosen.length < 2) return;
    navigate(`/compare/${tour}/${chosen.map((n) => slugify(n)).join('-vs-')}`);
  };

  return (
    <div className="compare-page">
      <div className="eyebrow">THE MEASURING TAPE</div>
      <h1 className="compare-title">Compare any players</h1>
      <p className="compare-sub">
        Two, three, or four players side by side: form curves, season records, and the
        model's read on every surface.
      </p>
      <div className="compare-hub-controls">
        <div className="compare-seg" role="group" aria-label="Tour">
          {[['atp', 'ATP'], ['wta', 'WTA']].map(([v, l]) => (
            <button key={v} type="button" className={`compare-seg-btn${tour === v ? ' active' : ''}`} onClick={() => { setTour(v); setPicks(['', '', '']); }}>{l}</button>
          ))}
        </div>
        {picks.map((p, i) => (
          <select
            key={i}
            className="compare-select"
            aria-label={`Player ${i + 1}`}
            value={p}
            onChange={(e) => setPicks((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))}
          >
            <option value="">{i < 2 ? `Player ${i + 1}` : `Player ${i + 1} (optional)`}</option>
            {roster.map((r) => <option key={r.id} value={r.name} disabled={picks.includes(r.name) && p !== r.name}>{r.name}</option>)}
          </select>
        ))}
        {picks.length < 4 && <button type="button" className="compare-add" onClick={() => setPicks((ps) => [...ps, ''])}>+ add a fourth</button>}
        <button type="button" className="compare-go" disabled={chosen.length < 2} onClick={go}>Compare →</button>
      </div>
    </div>
  );
}

export default function Compare() {
  const { tour = 'atp', slugs = '' } = useParams();
  const dataDir = tour === 'wta' ? '/data/women' : '/data';
  const [roster, setRoster] = useState(null);
  const [surfRows, setSurfRows] = useState({});
  const [track, setTrack] = useState(null);
  const [eloHist, setEloHist] = useState(null);

  useEffect(() => {
    for (const [key, file] of SURFACE_CSV) {
      Papa.parse(process.env.PUBLIC_URL + `${dataDir}/${file}`, {
        header: true,
        download: true,
        complete: ({ data }) => {
          setSurfRows((s) => ({ ...s, [key]: data.filter((r) => r.id) }));
          if (key === 'hard') setRoster(data.filter((r) => r.id && r.name));
        },
        error: () => { if (key === 'hard') setRoster([]); },
      });
    }
    fetch(process.env.PUBLIC_URL + '/data/track_record.json').then((r) => r.json()).then(setTrack).catch(() => setTrack({ matches: [] }));
    fetch(process.env.PUBLIC_URL + `${dataDir}/elo_history.json`).then((r) => r.json()).then(setEloHist).catch(() => setEloHist({}));
  }, [dataDir]);

  const players = useMemo(() => {
    if (!roster) return null;
    const parts = slugs.split('-vs-').filter(Boolean).slice(0, 4);
    const found = parts.map((s) => roster.find((r) => slugify(r.name) === s) || null);
    return found.every(Boolean) && found.length >= 2 ? found : [];
  }, [roster, slugs]);

  useDocMeta(
    players?.length
      ? `${players.map((p) => lastName(p.name)).join(' vs ')}: Form, Record & The Model's Read | Smash`
      : null,
    players?.length
      ? `${players.map((p) => p.name).join(' vs ')} compared: Elo form curves, season records, and win probabilities on every surface.`
      : null
  );

  // Per-player season line from the ledger: W-L, our graded record on them.
  const ledger = useMemo(() => {
    if (!track || !players?.length) return {};
    const out = {};
    for (const p of players) {
      const mine = (track.matches || []).filter((m) => m.p1 === p.id || m.p2 === p.id);
      const wins = mine.filter((m) => m.winner === p.id).length;
      out[p.id] = {
        w: wins,
        l: mine.length - wins,
        n: mine.length,
        called: mine.filter((m) => pickCorrect(m)).length,
        bySurface: Object.fromEntries(['hard', 'clay', 'grass'].map((s) => {
          const ms = mine.filter((m) => m.surface === s);
          const w = ms.filter((m) => m.winner === p.id).length;
          return [s, { w, l: ms.length - w }];
        })),
      };
    }
    return out;
  }, [track, players]);

  // Pairwise model read per surface (closed-form, client-side - the same
  // math the H2H studio runs).
  const pairs = useMemo(() => {
    if (!players?.length) return [];
    const out = [];
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const reads = SURFACE_CSV.map(([key, , label]) => {
          const rows = surfRows[key] || [];
          const ra = rows.find((r) => r.id === a.id), rb = rows.find((r) => r.id === b.id);
          if (!hasStats(ra) || !hasStats(rb)) return { label, pA: null };
          const bestOf = tour === 'wta' ? 3 : 5;
          return { label, pA: matchProb(rowToProbs(ra), rowToProbs(rb), bestOf) };
        });
        out.push({ a, b, reads });
      }
    }
    return out;
  }, [players, surfRows, tour]);

  if (roster === null) return <div className="compare-page"><div className="skeleton compare-skel" /></div>;
  if (!players?.length) {
    return (
      <div className="compare-page">
        <div className="eyebrow">THE MEASURING TAPE</div>
        <h1 className="compare-title">Comparison not found</h1>
        <p className="compare-sub">One of those names isn't on the current roster. Build a fresh one:</p>
        <Link className="compare-cta" to="/compare">Open the comparison tool →</Link>
      </div>
    );
  }

  const series = players
    .map((p, i) => ({ points: eloHist?.[p.id] || null, color: SERIES_COLORS[i], label: lastName(p.name) }))
    .filter((s) => s.points && s.points.length >= 2);

  return (
    <div className="compare-page">
      <div className="eyebrow">THE MEASURING TAPE · {tour.toUpperCase()}</div>
      <h1 className="compare-title">{players.map((p) => lastName(p.name)).join(' vs ')}</h1>

      <div className="compare-faces">
        {players.map((p, i) => (
          <Link key={p.id} className="compare-face-card" to={`/player/${tour}/${p.id}`} style={{ '--pc': SERIES_COLORS[i] }}>
            <img className="compare-face" src={playerPhoto(tour, p.id)} alt={p.name} />
            <span className="compare-face-name">{p.name}</span>
            <span className="compare-face-sub">
              {p.us_seed ? `World No. ${p.us_seed}` : 'Unranked'}
              {ledger[p.id] ? ` · ${ledger[p.id].w}-${ledger[p.id].l} this season` : ''}
            </span>
          </Link>
        ))}
      </div>

      {series.length >= 2 && (
        <section className="compare-elo">
          <div className="compare-section-label">Form curves, head to head to head</div>
          <EloChart series={series} ariaLabel={`Elo form comparison: ${players.map((p) => p.name).join(', ')}`} />
          <div className="compare-elo-sub">
            Elo form since Jan {new Date().getUTCFullYear() - 1} · dashed lines mark grand slam starts
          </div>
        </section>
      )}

      <section>
        <div className="compare-section-label">This season, on our record</div>
        <div className="compare-table" role="table">
          <div className="compare-tr head" role="row">
            <span role="columnheader">Player</span>
            <span role="columnheader">Record</span>
            <span role="columnheader">Hard</span>
            <span role="columnheader">Clay</span>
            <span role="columnheader">Grass</span>
            <span role="columnheader">We called</span>
          </div>
          {players.map((p) => {
            const L = ledger[p.id];
            if (!L) return null;
            const cell = (s) => `${L.bySurface[s].w}-${L.bySurface[s].l}`;
            return (
              <div className="compare-tr" role="row" key={p.id}>
                <span role="cell" className="compare-td-name">{lastName(p.name)}</span>
                <span role="cell">{L.w}-{L.l}</span>
                <span role="cell">{cell('hard')}</span>
                <span role="cell">{cell('clay')}</span>
                <span role="cell">{cell('grass')}</span>
                <span role="cell">{L.n ? `${Math.round((L.called / L.n) * 100)}% of ${L.n}` : '-'}</span>
              </div>
            );
          })}
        </div>
        <div className="compare-table-note">Tour-level matches between ranked players, from the graded ledger.</div>
      </section>

      <section>
        <div className="compare-section-label">The model's read, pair by pair</div>
        {pairs.map(({ a, b, reads }) => (
          <div className="compare-pair" key={`${a.id}_${b.id}`}>
            <div className="compare-pair-names">
              <strong>{lastName(a.name)}</strong> vs <strong>{lastName(b.name)}</strong>
              <Link className="compare-pair-cta" to={`${tour === 'wta' ? '/women' : ''}/h2h?a=${a.id}&b=${b.id}`}>simulate →</Link>
            </div>
            <div className="compare-pair-reads">
              {reads.map((r) => (
                <span key={r.label} className="compare-read">
                  <span className={`compare-read-surface s-${r.label.toLowerCase()}`}>{r.label}</span>
                  {r.pA == null ? 'n/a' : `${lastName(r.pA >= 0.5 ? a.name : b.name)} ${Math.round(Math.max(r.pA, 1 - r.pA) * 100)}%`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <p className="compare-foot">
        Every number above comes from the same engines graded in public on{' '}
        <Link to="/track-record">the Ledger</Link>. Build another:{' '}
        <Link to="/compare">compare different players →</Link>
      </p>
    </div>
  );
}
