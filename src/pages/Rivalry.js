// src/pages/Rivalry.js
//
// One page per rivalry: career head-to-head, both form curves, the model's
// read on every surface, and our graded record on the pair. URL:
// /rivalry/:tour/:a-vs-:b with full-name slugs ("jannik-sinner-vs-...") -
// the shape people actually search. Everything renders from data files the
// pipeline already publishes; zero extra API cost.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { slugify } from '../utils/slug';
import { pickCorrect } from '../utils/deployedPick';
import { matchProb } from '../analyticProb';
import EloChart from '../components/EloChart';
import './Rivalry.css';

const SURFACE_CSV = [
  ['hard', 'smash_us.csv', 'Hard'],
  ['clay', 'smash_fr.csv', 'Clay'],
  ['grass', 'smash_wb.csv', 'Grass'],
];
const rowToProbs = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);
const hasStats = (r) => r && ['p1', 'p2', 'p3', 'p4', 'p5'].every((k) => Number(r[k]) > 0);

export default function Rivalry() {
  const { tour = 'atp', slug = '' } = useParams();
  const dataDir = tour === 'wta' ? '/data/women' : '/data';
  const [roster, setRoster] = useState(null);        // hard CSV rows (names, ranks)
  const [surfRows, setSurfRows] = useState({});      // surface -> csv rows
  const [h2hAll, setH2hAll] = useState(null);
  const [track, setTrack] = useState(null);
  const [eloHist, setEloHist] = useState(null);

  useEffect(() => {
    for (const [key, file] of [['hard', 'smash_us.csv'], ['clay', 'smash_fr.csv'], ['grass', 'smash_wb.csv']]) {
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
    fetch(process.env.PUBLIC_URL + `${dataDir}/h2h.json`).then((r) => r.json()).then(setH2hAll).catch(() => setH2hAll({}));
    fetch(process.env.PUBLIC_URL + '/data/track_record.json').then((r) => r.json()).then(setTrack).catch(() => setTrack({ matches: [] }));
    fetch(process.env.PUBLIC_URL + `${dataDir}/elo_history.json`).then((r) => r.json()).then(setEloHist).catch(() => setEloHist({}));
  }, [dataDir]);

  // Resolve the slug to two roster players.
  const [pA, pB] = useMemo(() => {
    if (!roster) return [undefined, undefined];
    const [sa, sb] = slug.split('-vs-');
    const find = (s) => roster.find((r) => slugify(r.name) === s) || null;
    return [find(sa), find(sb)];
  }, [roster, slug]);

  // SEO: title + description reflect the matchup.
  useEffect(() => {
    if (!pA || !pB) return undefined;
    const prev = document.title;
    document.title = `${pA.name} vs ${pB.name}: H2H Record & Prediction | Smash`;
    const desc = document.querySelector('meta[name="description"]');
    const prevDesc = desc?.getAttribute('content');
    desc?.setAttribute('content',
      `${pA.name} vs ${pB.name} head-to-head record, form curves, and a win prediction for every surface - from a model graded in public on every call.`);
    return () => { document.title = prev; if (prevDesc) desc?.setAttribute('content', prevDesc); };
  }, [pA, pB]);

  if (roster === null) return <div className="rivalry-page"><div className="skeleton rivalry-skel" /></div>;
  if (!pA || !pB) {
    return (
      <div className="rivalry-page">
        <div className="eyebrow">RIVALRY</div>
        <h1 className="rivalry-title">Matchup not found</h1>
        <p className="rivalry-sub">
          That pairing isn't in the current top-{roster?.length || 50} roster. The big ones
          all live on the <Link to="/rivalries">rivalries board</Link>, or run any two
          players in the <Link to={tour === 'wta' ? '/women/h2h' : '/h2h'}>H2H studio</Link>.
        </p>
      </div>
    );
  }

  const key = [pA.id, pB.id].sort().join('_');
  const rec = h2hAll?.[key];
  const aFirst = [pA.id, pB.id].sort()[0] === pA.id;
  const winsA = rec ? (aFirst ? rec.winsA : rec.winsB) : 0;
  const winsB = rec ? (aFirst ? rec.winsB : rec.winsA) : 0;
  const meetings = winsA + winsB;

  // The model's read on each surface (slam format for the tour).
  const bestOf = tour === 'wta' ? 3 : 5;
  const reads = SURFACE_CSV.map(([keyS, , label]) => {
    const rows = surfRows[keyS];
    if (!rows) return { label, p: null };
    const ra = rows.find((r) => r.id === pA.id);
    const rb = rows.find((r) => r.id === pB.id);
    if (!hasStats(ra) || !hasStats(rb)) return { label, p: null };
    return { label, p: matchProb(rowToProbs(ra), rowToProbs(rb), bestOf) };
  });

  // Our graded record on this exact pair, plus their recent meetings.
  const pairRows = (track?.matches || [])
    .filter((m) => (m.p1 === pA.id && m.p2 === pB.id) || (m.p1 === pB.id && m.p2 === pA.id))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const pairCalled = pairRows.filter((m) => pickCorrect(m)).length;

  const histA = eloHist?.[pA.id], histB = eloHist?.[pB.id];
  const lastA = pA.name.split(' ').pop(), lastB = pB.name.split(' ').pop();

  return (
    <div className="rivalry-page">
      <div className="eyebrow">THE RIVALRY · {tour.toUpperCase()}</div>
      <h1 className="rivalry-title">{pA.name} <span className="rivalry-vs">vs</span> {pB.name}</h1>
      <p className="rivalry-sub">
        Head-to-head record, current form, and the model's read - graded in public
        like every other call we make.
      </p>

      <div className="rivalry-hero">
        <div className="rivalry-face">
          <img src={playerPhoto(tour, pA.id)} alt={pA.name} loading="lazy" />
          <Link to={`/player/${tour}/${pA.id}`}>{lastA}</Link>
        </div>
        <div className="rivalry-h2h">
          <div className="rivalry-h2h-score">{winsA}<span className="rivalry-h2h-dash">–</span>{winsB}</div>
          <div className="rivalry-h2h-cap">{meetings > 0 ? `career meetings: ${meetings}` : 'no tour-level meetings yet'}</div>
        </div>
        <div className="rivalry-face">
          <img src={playerPhoto(tour, pB.id)} alt={pB.name} loading="lazy" />
          <Link to={`/player/${tour}/${pB.id}`}>{lastB}</Link>
        </div>
      </div>

      <div className="rivalry-section">
        <div className="rivalry-section-label">THE VERDICT · if they met tomorrow</div>
        <div className="rivalry-reads">
          {reads.map((r) => (
            <div className="rivalry-read" key={r.label}>
              <div className="rivalry-read-surface">{r.label}</div>
              {r.p != null ? (
                <>
                  <div className="rivalry-read-pct">{Math.round((r.p >= 0.5 ? r.p : 1 - r.p) * 100)}%</div>
                  <div className="rivalry-read-who">{r.p >= 0.5 ? lastA : lastB}</div>
                </>
              ) : (
                <div className="rivalry-read-na">not enough recent {r.label.toLowerCase()}-court data</div>
              )}
            </div>
          ))}
        </div>
        <p className="rivalry-note">
          Closed-form point model on each player's recent serve and return numbers,
          best of {bestOf}. Want to argue with it?{' '}
          <Link to={`${tour === 'wta' ? '/women' : ''}/h2h?a=${pA.id}&b=${pB.id}`}>Run it yourself in the studio</Link>.
        </p>
      </div>

      {histA && histB && histA.length >= 4 && histB.length >= 4 && (
        <div className="rivalry-section">
          <div className="rivalry-section-label">FORM CURVES · Elo, match by match</div>
          <EloChart
            series={[
              { points: histA, color: 'var(--accent-brand)', label: lastA },
              { points: histB, color: 'rgba(255,255,255,0.85)', label: lastB },
            ]}
          />
          <p className="rivalry-note">
            <span className="rivalry-key" style={{ color: 'var(--accent-brand)' }}>{lastA}</span>
            {' vs '}
            <span className="rivalry-key">{lastB}</span> since January 2025 · dashed lines mark grand slam starts
          </p>
        </div>
      )}

      <div className="rivalry-section">
        <div className="rivalry-section-label">THE LEDGER · this pair on our record</div>
        {pairRows.length === 0 ? (
          <p className="rivalry-note">
            They haven't met on our graded record yet. The first time they do, the
            call and the result land here automatically - no take-backs.
          </p>
        ) : (
          <>
            <p className="rivalry-note">
              We've called <strong>{pairCalled} of {pairRows.length}</strong> of their
              meetings correctly on the public record.
            </p>
            <div className="rivalry-meetings">
              {pairRows.slice(0, 6).map((m) => {
                const wName = m.winner === m.p1 ? m.name1 : m.name2;
                return (
                  <div className="rivalry-meeting" key={m.id}>
                    <span className="rivalry-meeting-date">
                      {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {m.event ? ` · ${m.event}` : ''}
                    </span>
                    <span className="rivalry-meeting-result">{wName.split(' ').pop()} won{m.score ? ` ${m.score}` : ''}</span>
                    <span className={`rivalry-meeting-call ${pickCorrect(m) ? 'hit' : 'miss'}`}>
                      {pickCorrect(m) ? '✓ called it' : '✗ missed'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="rivalry-ctas">
        <Link className="rivalry-cta" to={`${tour === 'wta' ? '/women' : ''}/h2h?a=${pA.id}&b=${pB.id}`}>Simulate this matchup →</Link>
        <Link className="rivalry-cta secondary" to="/rivalries">All rivalries</Link>
      </div>
    </div>
  );
}
