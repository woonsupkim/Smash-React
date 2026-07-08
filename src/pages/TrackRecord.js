// src/pages/TrackRecord.js
//
// Retrospective model performance: every completed 2026 French Open and
// Wimbledon main-draw match between two roster players, re-simulated with
// the current surface stats and compared against the real result.
import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { simulateBatch } from '../simulator';
import { STAT_KEYS } from '../components/AdvancedSimPanel';
import { countryFlagUrl } from '../components/countryFlags';
import './TrackRecord.css';

const SIMS = 300;

const TOURNEYS = {
  fr: { label: 'French Open', csv: 'smash_fr.csv', accent: '#e8694a' },
  wb: { label: 'Wimbledon', csv: 'smash_wb.csv', accent: '#3ddc84' },
};

function probsFromRow(row) {
  return STAT_KEYS.map(([k]) => Number(row[k]) || 0);
}

function loadCsv(url) {
  return new Promise((resolve) => {
    Papa.parse(url, {
      header: true,
      download: true,
      complete: ({ data }) => resolve(data.filter((r) => r.id)),
      error: () => resolve([]),
    });
  });
}

export default function TrackRecord() {
  const [tour, setTour] = useState('atp');
  const [tourney, setTourney] = useState('all');
  const [results, setResults] = useState(null); // evaluated matches
  const [isLoading, setIsLoading] = useState(true);

  // Load the match log + both tours' surface CSVs, then re-simulate every
  // matchup once. ~200 matches x 300 sims runs in a couple of seconds.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [track, ...pools] = await Promise.all([
        fetch(process.env.PUBLIC_URL + '/data/track_record.json').then((r) => r.json()).catch(() => ({ matches: [] })),
        loadCsv(process.env.PUBLIC_URL + '/data/smash_fr.csv'),
        loadCsv(process.env.PUBLIC_URL + '/data/smash_wb.csv'),
        loadCsv(process.env.PUBLIC_URL + '/data/women/smash_fr.csv'),
        loadCsv(process.env.PUBLIC_URL + '/data/women/smash_wb.csv'),
      ]);
      if (cancelled) return;

      const poolBy = {
        'atp-fr': pools[0], 'atp-wb': pools[1],
        'wta-fr': pools[2], 'wta-wb': pools[3],
      };
      const rowLookup = {};
      for (const [k, rows] of Object.entries(poolBy)) {
        rowLookup[k] = new Map(rows.map((r) => [r.id, r]));
      }

      const evaluated = [];
      for (const m of track.matches || []) {
        const lookup = rowLookup[`${m.tour}-${m.tourney}`];
        const rowA = lookup?.get(m.p1);
        const rowB = lookup?.get(m.p2);
        if (!rowA || !rowB || !m.winner) continue;
        const bestOf = m.tour === 'wta' ? 3 : 5;
        const res = simulateBatch(probsFromRow(rowA), probsFromRow(rowB), SIMS, bestOf);
        const probP1 = res.matchWins[0] / SIMS;
        const favorite = probP1 >= 0.5 ? m.p1 : m.p2;
        const favProb = probP1 >= 0.5 ? probP1 : 1 - probP1;
        evaluated.push({
          ...m,
          probP1,
          favorite,
          favProb,
          correct: favorite === m.winner,
          countryA: rowA.country,
          countryB: rowB.country,
        });
      }
      if (!cancelled) {
        setResults(evaluated);
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!results) return [];
    return results.filter((m) =>
      m.tour === tour && (tourney === 'all' || m.tourney === tourney)
    ).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [results, tour, tourney]);

  const stats = useMemo(() => {
    const compute = (list) => {
      const n = list.length;
      const correct = list.filter((m) => m.correct).length;
      return { n, correct, acc: n ? Math.round((correct / n) * 100) : 0 };
    };
    const cur = compute(filtered);
    // Calibration buckets on the favorite's modeled probability
    const buckets = [
      { label: '50–60%', lo: 0.5, hi: 0.6 },
      { label: '60–70%', lo: 0.6, hi: 0.7 },
      { label: '70–85%', lo: 0.7, hi: 0.85 },
      { label: '85%+', lo: 0.85, hi: 1.01 },
    ].map((b) => {
      const inB = filtered.filter((m) => m.favProb >= b.lo && m.favProb < b.hi);
      const won = inB.filter((m) => m.correct).length;
      return { ...b, n: inB.length, rate: inB.length ? Math.round((won / inB.length) * 100) : null };
    });
    return { ...cur, buckets };
  }, [filtered]);

  const perTourney = useMemo(() => {
    if (!results) return [];
    return ['fr', 'wb'].map((t) => {
      const list = results.filter((m) => m.tour === tour && m.tourney === t);
      const correct = list.filter((m) => m.correct).length;
      return { key: t, label: TOURNEYS[t].label, n: list.length, acc: list.length ? Math.round((correct / list.length) * 100) : 0 };
    });
  }, [results, tour]);

  return (
    <div className="page-background track-bg">
      <div className="overlay track-overlay">
        <div className="track-page">
          <div className="track-header">
            <div className="eyebrow">MODEL PERFORMANCE · 2026 SEASON</div>
            <h1 className="track-title">Track Record</h1>
            <p className="track-sub">
              Every completed Grand Slam main-draw match between two ranked players,
              re-simulated {SIMS} times and scored against the real result.
            </p>
          </div>

          <div className="track-controls">
            <div className="track-seg" role="group" aria-label="Tour">
              {['atp', 'wta'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`track-seg-btn${tour === t ? ' active' : ''}`}
                  onClick={() => setTour(t)}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="track-seg" role="group" aria-label="Tournament">
              {[['all', 'All'], ['fr', 'French Open'], ['wb', 'Wimbledon']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`track-seg-btn${tourney === v ? ' active' : ''}`}
                  onClick={() => setTourney(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="track-skeletons">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton track-skel-card" />)}
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={`r${i}`} className="skeleton track-skel-row" />)}
            </div>
          ) : (
            <>
              <div className="track-summary">
                <div className="track-stat-card">
                  <div className="track-stat-value">{stats.acc}%</div>
                  <div className="track-stat-label">Correct picks</div>
                  <div className="track-stat-sub">{stats.correct} of {stats.n} matches</div>
                </div>
                {perTourney.map((t) => (
                  <div className="track-stat-card" key={t.key}>
                    <div className="track-stat-value" style={{ color: TOURNEYS[t.key].accent }}>{t.acc}%</div>
                    <div className="track-stat-label">{t.label}</div>
                    <div className="track-stat-sub">{t.n} matches</div>
                  </div>
                ))}
              </div>

              <div className="track-calibration">
                <div className="track-section-label">Calibration — when the model says X%, does it win X% of the time?</div>
                <div className="track-cal-row">
                  {stats.buckets.map((b) => (
                    <div className="track-cal-bucket" key={b.label}>
                      <div className="track-cal-bars">
                        <div className="track-cal-bar expected" style={{ height: `${((b.lo + Math.min(b.hi, 1)) / 2) * 100}%` }} title="Expected" />
                        <div className="track-cal-bar actual" style={{ height: `${b.rate ?? 0}%` }} title="Actual" />
                      </div>
                      <div className="track-cal-rate">{b.rate == null ? '—' : `${b.rate}%`}</div>
                      <div className="track-cal-label">{b.label}</div>
                      <div className="track-cal-n">{b.n} matches</div>
                    </div>
                  ))}
                  <div className="track-cal-legend">
                    <span><i className="dot expected" /> Modeled</span>
                    <span><i className="dot actual" /> Actual win rate</span>
                  </div>
                </div>
              </div>

              <div className="track-list">
                <div className="track-section-label">Match log · newest first</div>
                {filtered.map((m) => {
                  const favIsP1 = m.favorite === m.p1;
                  const favName = favIsP1 ? m.name1 : m.name2;
                  const winnerIsP1 = m.winner === m.p1;
                  const wName = winnerIsP1 ? m.name1 : m.name2;
                  const lName = winnerIsP1 ? m.name2 : m.name1;
                  const wFlag = countryFlagUrl(winnerIsP1 ? m.countryA : m.countryB);
                  const lFlag = countryFlagUrl(winnerIsP1 ? m.countryB : m.countryA);
                  return (
                    <div className={`track-row${m.correct ? '' : ' miss'}`} key={m.id}>
                      <div className="track-row-meta">
                        <span className="track-row-tourney" style={{ color: TOURNEYS[m.tourney].accent }}>
                          {TOURNEYS[m.tourney].label}
                        </span>
                        <span className="track-row-round">{m.round}</span>
                      </div>
                      <div className="track-row-matchup">
                        <span className="track-player won">
                          {wFlag && <img src={wFlag} alt="" />}
                          {wName}
                        </span>
                        <span className="track-vs">d.</span>
                        <span className="track-player">
                          {lFlag && <img src={lFlag} alt="" />}
                          {lName}
                        </span>
                        <span className="track-score">{m.score}</span>
                      </div>
                      <div className="track-row-model">
                        <div className="track-prob-bar" title={`Model: ${favName} ${Math.round(m.favProb * 100)}%`}>
                          <div
                            className={`track-prob-fill ${m.correct ? 'hit' : 'miss'}`}
                            style={{ width: `${m.favProb * 100}%` }}
                          />
                        </div>
                        <span className={`track-verdict ${m.correct ? 'hit' : 'miss'}`}>
                          {m.correct
                            ? `✓ Called it · ${favName.split(' ').pop()} ${Math.round(m.favProb * 100)}%`
                            : `✗ Upset · had ${favName.split(' ').pop()} ${Math.round(m.favProb * 100)}%`}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="track-empty">No matches recorded yet for this filter.</div>
                )}
              </div>

              <p className="track-footnote">
                Retrospective analysis: matchups are re-simulated with current recency-weighted
                stats, which include results from these tournaments. A live, locked-before-play
                track record begins with the 2026 US Open.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
