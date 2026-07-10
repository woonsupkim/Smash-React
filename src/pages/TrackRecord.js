// src/pages/TrackRecord.js
//
// Retrospective model performance: every completed 2026 tour-level match
// between two ranked players, across all surfaces. Predictions are
// PRECOMPUTED offline (data-pipeline/buildTrackRecord.js runs the same Monte
// Carlo sim), so this page just reads track_record.json and renders — no
// client-side simulation, instant load.
import React, { useState, useEffect, useMemo } from 'react';
import { countryFlagUrl } from '../components/countryFlags';
import './TrackRecord.css';

const SURFACES = {
  hard: { label: 'Hard', accent: '#5b8cff' },
  clay: { label: 'Clay', accent: '#e8694a' },
  grass: { label: 'Grass', accent: '#3ddc84' },
};

const PAGE_SIZE = 10;

// Parse an ATP/WTA score string ("7-6(4) 3-6 6-3") into per-set games, from
// the match winner's perspective. tb = tiebreak loser's points (superscript).
function parseScore(score) {
  if (!score) return [];
  return score.trim().split(/\s+/).map((set) => {
    const m = set.match(/^(\d+)-(\d+)(?:\((\d+)\))?/);
    return m ? { w: +m[1], l: +m[2], tb: m[3] != null ? +m[3] : null } : null;
  }).filter(Boolean);
}

// Compact broadcast-style scoreboard for a completed match.
function MiniScore({ wName, lName, wFlag, lFlag, sets }) {
  const cell = (games, otherGames, tb) => (
    <>{games}{tb != null && games < otherGames && <sup className="ts-tb">{tb}</sup>}</>
  );
  return (
    <table className="track-scoreboard">
      <tbody>
        <tr className="ts-winner">
          <td className="ts-name">{wFlag && <img src={wFlag} alt="" />}{wName}</td>
          {sets.map((s, i) => <td key={i} className="ts-won">{cell(s.w, s.l, s.tb)}</td>)}
        </tr>
        <tr>
          <td className="ts-name">{lFlag && <img src={lFlag} alt="" />}{lName}</td>
          {sets.map((s, i) => <td key={i} className={s.l > s.w ? 'ts-won' : 'ts-lost'}>{cell(s.l, s.w, s.tb)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

export default function TrackRecord() {
  const [tour, setTour] = useState('atp');
  const [surface, setSurface] = useState('all');
  const [data, setData] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ matches: [] }));
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then(setPredictions)
      .catch(() => setPredictions({ predictions: [] }));
  }, []);

  const forward = useMemo(() => {
    const list = (predictions?.predictions || []).filter((p) => (tour === 'all' || p.tour === tour) && (surface === 'all' || p.surface === surface));
    const pending = list.filter((p) => p.status === 'pending').sort((a, b) => new Date(a.date) - new Date(b.date));
    const decided = list.filter((p) => p.status !== 'pending').sort((a, b) => new Date(b.date) - new Date(a.date));
    return { pending, decided, correct: decided.filter((p) => p.correct).length };
  }, [predictions, tour, surface]);

  // Reset pagination whenever the filters change
  useEffect(() => { setVisible(PAGE_SIZE); }, [tour, surface]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.matches
      .filter((m) => (tour === 'all' || m.tour === tour) && (surface === 'all' || m.surface === surface))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data, tour, surface]);

  const stats = useMemo(() => {
    const n = filtered.length;
    const pct = (k) => (n ? Math.round((filtered.filter((m) => m[k]).length / n) * 100) : 0);

    // Per-surface accuracy (for the whole tour, ignoring the surface filter)
    const perSurface = ['hard', 'clay', 'grass'].map((s) => {
      const list = (data?.matches || []).filter((m) => (tour === 'all' || m.tour === tour) && m.surface === s);
      const acc = list.length ? Math.round((list.filter((m) => m.smashCorrect).length / list.length) * 100) : 0;
      return { key: s, ...SURFACES[s], n: list.length, acc };
    });

    // Confidence calibration buckets on the favorite's modeled probability
    const buckets = [
      { label: '50–60%', lo: 0.5, hi: 0.6, mid: 55 },
      { label: '60–70%', lo: 0.6, hi: 0.7, mid: 65 },
      { label: '70–85%', lo: 0.7, hi: 0.85, mid: 77 },
      { label: '85%+', lo: 0.85, hi: 1.01, mid: 92 },
    ].map((b) => {
      // Calibrate on the blended probability the app actually shows
      const blendFav = (m) => (m.smashProbP1 >= 0.5 ? m.smashProbP1 : 1 - m.smashProbP1);
      const inB = filtered.filter((m) => blendFav(m) >= b.lo && blendFav(m) < b.hi);
      const won = inB.filter((m) => m.smashCorrect).length;
      return { ...b, n: inB.length, rate: inB.length ? Math.round((won / inB.length) * 100) : null };
    });

    const engines = {
      smash: pct('smashCorrect'),
      sim: pct('correct'),
      elo: pct('eloCorrect'),
      rank: pct('rankCorrect'),
      upset: pct('upsetCorrect'),
    };
    // Best selectable engine for this filter (Smart Blend wins ties).
    const bestEngine = ['smash', 'sim', 'elo', 'rank', 'upset']
      .reduce((b, id) => (engines[id] > engines[b] ? id : b), 'smash');

    return {
      n,
      correct: filtered.filter((m) => m.correct).length,
      smashCorrect: filtered.filter((m) => m.smashCorrect).length,
      smash: engines.smash,
      season: engines.sim,
      elo: engines.elo,
      upset: engines.upset,
      rank: engines.rank,
      engines,
      bestEngine,
      perSurface,
      buckets,
    };
  }, [filtered, data, tour]);

  const isLoading = !data;
  const shown = filtered.slice(0, visible);

  return (
    <div className="page-background track-bg">
      <div className="overlay track-overlay">
        <div className="track-page">
          <div className="track-header">
            <div className="eyebrow">MODEL PERFORMANCE · 2026 SEASON</div>
            <h1 className="track-title">Track Record</h1>
            <p className="track-sub">
              Every completed 2026 tour match between two ranked players, scored
              against the real result. No cherry-picking — every match counts.
            </p>
          </div>

          <div className="track-controls">
            <div className="track-seg" role="group" aria-label="Tour">
              {[['atp', 'ATP'], ['wta', 'WTA'], ['all', 'Both']].map(([t, label]) => (
                <button key={t} type="button" className={`track-seg-btn${tour === t ? ' active' : ''}`} onClick={() => setTour(t)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="track-seg" role="group" aria-label="Surface">
              {[['all', 'All surfaces'], ['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']].map(([v, label]) => (
                <button key={v} type="button" className={`track-seg-btn${surface === v ? ' active' : ''}`} onClick={() => setSurface(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Forward record — predictions LOCKED before the match was played.
              This is the leak-free, honest scoreboard (the retrospective below
              re-simulates finished matches). */}
          {(forward.pending.length > 0 || forward.decided.length > 0) && (
            <div className="track-panel track-forward">
              <div className="track-forward-head">
                <div className="track-section-label" style={{ margin: 0 }}>🔒 Locked predictions · called before play</div>
                {forward.decided.length > 0 && (
                  <div className="track-forward-record">
                    {Math.round((forward.correct / forward.decided.length) * 100)}% · {forward.correct}/{forward.decided.length} verified
                  </div>
                )}
              </div>
              {forward.pending.map((p) => (
                <div className="track-forward-row pending" key={p.id}>
                  <span className="track-forward-status">⏳ Upcoming</span>
                  <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                  <span className="track-forward-call">Backing {p.favName.split(' ').pop()} {Math.round(p.favProb * 100)}%</span>
                </div>
              ))}
              {forward.decided.slice(0, 5).map((p) => (
                <div className={`track-forward-row ${p.correct ? 'hit' : 'miss'}`} key={p.id}>
                  <span className="track-forward-status">{p.correct ? '✓' : '✗'}</span>
                  <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                  <span className="track-forward-call">Called {p.favName.split(' ').pop()} {Math.round(p.favProb * 100)}%</span>
                </div>
              ))}
              {forward.pending.length > 0 && forward.decided.length === 0 && (
                <div className="track-note" style={{ marginTop: '0.6rem' }}>
                  These picks are locked now and graded automatically when the results come in — a
                  true forward test with no hindsight.
                </div>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="track-skeletons">
              <div className="skeleton track-skel-hero" />
              <div className="skeleton track-skel-card" />
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton track-skel-row" />)}
            </div>
          ) : (
            <>
              {/* Headline: how often the model calls the winner */}
              <div className="track-hero-stat">
                <div className="track-hero-value">{stats.smash}%</div>
                <div className="track-hero-detail">
                  <div className="track-hero-label">of winners called correctly</div>
                  <div className="track-hero-sub">{stats.smashCorrect} of {stats.n} matches · {tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()}{surface !== 'all' ? ` · ${SURFACES[surface].label}` : ''}</div>
                </div>
              </div>

              {/* Per-surface accuracy */}
              <div className="track-surface-row">
                {stats.perSurface.map((s) => (
                  <button
                    key={s.key}
                    className={`track-surface-card${surface === s.key ? ' active' : ''}`}
                    style={{ '--surf': s.accent }}
                    onClick={() => setSurface(surface === s.key ? 'all' : s.key)}
                  >
                    <div className="track-surface-acc" style={{ color: s.accent }}>{s.acc}%</div>
                    <div className="track-surface-label">{s.label}</div>
                    <div className="track-surface-n">{s.n} matches</div>
                  </button>
                ))}
              </div>

              {/* Engine comparison — the best engine for this filter is highlighted */}
              <div className="track-panel">
                <div className="track-section-label">How the pick is made — {surface !== 'all' ? SURFACES[surface].label : 'all surfaces'}, same matches</div>
                <div className="track-compare">
                  {[
                    { id: 'smash', label: 'Smart Blend', desc: 'Tuned mix of the models below', acc: stats.smash },
                    { id: 'sim', label: 'Point Sim', desc: 'Point-by-point serve/return sim', acc: stats.season },
                    { id: 'elo', label: 'Form', desc: 'Surface rating (Elo)', acc: stats.elo },
                    { id: 'rank', label: 'Rankings', desc: 'World-ranking implied odds', acc: stats.rank },
                    { id: 'upset', label: 'Hot Streak', desc: 'Last-few-weeks hot form', acc: stats.upset },
                  ].map((mo) => (
                    <div className={`track-compare-row${mo.id === stats.bestEngine ? ' primary' : ''}`} key={mo.id}>
                      <div className="track-compare-name">
                        {mo.label}
                        {mo.id === stats.bestEngine && <span className="track-compare-best">Most accurate</span>}
                        <span className="track-compare-desc">{mo.desc}</span>
                      </div>
                      <div className="track-compare-bar-wrap">
                        <div className="track-compare-bar" style={{ width: `${mo.acc}%` }} />
                      </div>
                      <div className="track-compare-acc">{mo.acc}%</div>
                    </div>
                  ))}

                  {/* Baseline — deliberately set apart from the engines */}
                  <div className="track-compare-row baseline">
                    <div className="track-compare-name">
                      Higher rank wins
                      <span className="track-compare-baseline-tag">Baseline</span>
                      <span className="track-compare-desc">Just pick the higher-ranked player</span>
                    </div>
                    <div className="track-compare-bar-wrap">
                      <div className="track-compare-bar" style={{ width: `${stats.rank}%` }} />
                    </div>
                    <div className="track-compare-acc">{stats.rank}%</div>
                  </div>
                </div>
                <div className="track-note">
                  <em>Smart Blend</em> mixes the point simulation, a surface form rating (Elo), and
                  world ranking — with weights tuned per tour and surface, so it beats the baseline on
                  every surface. The <em>Rankings</em> engine makes the same picks as the baseline but
                  as graded odds. These weights are fit on this same season, so the honest read is the
                  locked forward record above.
                </div>
              </div>

              {/* Calibration — redesigned as compact horizontal reliability bars */}
              <div className="track-panel">
                <div className="track-section-label">Do the probabilities mean what they say?</div>
                <div className="track-calib">
                  {stats.buckets.map((b) => (
                    <div className="track-calib-row" key={b.label}>
                      <div className="track-calib-said">Said {b.label}</div>
                      <div className="track-calib-track">
                        <div className="track-calib-ideal" style={{ left: `${b.mid}%` }} title={`Ideal ≈ ${b.mid}%`} />
                        <div className="track-calib-fill" style={{ width: `${b.rate ?? 0}%` }} />
                      </div>
                      <div className="track-calib-actual">{b.rate == null ? '—' : `won ${b.rate}%`}</div>
                      <div className="track-calib-n">{b.n}</div>
                    </div>
                  ))}
                </div>
                <div className="track-note">
                  Each bar is how often the favorite actually won, for matches where the model
                  expressed that confidence. The tick marks the ideal — bars landing near their
                  ticks mean a stated 70% really is about a 70% chance.
                </div>
              </div>

              {/* Match log — paginated */}
              <div className="track-panel">
                <div className="track-section-label">Match log · newest first</div>
                {shown.map((m) => {
                  const winnerIsP1 = m.winner === m.p1;
                  const wName = winnerIsP1 ? m.name1 : m.name2;
                  const lName = winnerIsP1 ? m.name2 : m.name1;
                  const wFlag = countryFlagUrl(winnerIsP1 ? m.country1 : m.country2);
                  const lFlag = countryFlagUrl(winnerIsP1 ? m.country2 : m.country1);
                  const blendFavProb = m.smashProbP1 >= 0.5 ? m.smashProbP1 : 1 - m.smashProbP1;
                  const favName = (m.smashFavorite === m.p1 ? m.name1 : m.name2).split(' ').pop();
                  return (
                    <div className={`track-row${m.smashCorrect ? '' : ' miss'}`} key={m.id}>
                      <div className="track-row-meta">
                        <span className="track-row-surface" style={{ color: SURFACES[m.surface].accent }}>
                          {SURFACES[m.surface].label}
                        </span>
                        <span className="track-row-date">{new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                      <div className="track-row-matchup">
                        <MiniScore wName={wName} lName={lName} wFlag={wFlag} lFlag={lFlag} sets={parseScore(m.score)} />
                      </div>
                      <div className="track-row-model">
                        <span className={`track-verdict ${m.smashCorrect ? 'hit' : 'miss'}`}>
                          {m.smashCorrect ? '✓ Called it' : '✗ Missed'} · {favName} {Math.round(blendFavProb * 100)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && <div className="track-empty">No matches recorded yet for this filter.</div>}
                {visible < filtered.length && (
                  <button className="track-more" onClick={() => setVisible((v) => v + 20)}>
                    See more history ({filtered.length - visible} more)
                  </button>
                )}
              </div>

              <p className="track-footnote">
                Retrospective analysis: matchups are re-simulated with current recency-weighted
                stats, which already include these results. A live, locked-before-play track record
                begins with the next tournament.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
