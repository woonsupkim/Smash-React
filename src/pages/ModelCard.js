// src/pages/ModelCard.js
//
// The public model card: exactly what the model is, what it's tuned on,
// how well calibrated it is, and where it falls short. Methodology explains
// the idea; this page proves the discipline. Everything here is generated
// from live config and data, never hand-maintained.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CONFIG from '../engineConfig.json';
import { MODEL_VERSION } from '../data/changelog';
import { pickCorrect, pickFavProb } from '../utils/deployedPick';
import './ModelCard.css';

const SURFACES = ['hard', 'clay', 'grass'];

// Stated-vs-actual calibration buckets from the graded record.
function calibrationBuckets(matches, tour) {
  const buckets = [
    { label: '50-60%', lo: 0.5, hi: 0.6 },
    { label: '60-70%', lo: 0.6, hi: 0.7 },
    { label: '70-80%', lo: 0.7, hi: 0.8 },
    { label: '80%+', lo: 0.8, hi: 1.01 },
  ];
  return buckets.map((b) => {
    // Bucketed on the DEPLOYED call's stated confidence (the number the
    // site actually showed), graded on the deployed pick.
    const list = matches.filter((m) => {
      if (m.tour !== tour) return false;
      const fav = pickFavProb(m);
      return fav >= b.lo && fav < b.hi;
    });
    const won = list.filter((m) => pickCorrect(m)).length;
    const stated = list.length
      ? list.reduce((s, m) => s + pickFavProb(m), 0) / list.length
      : null;
    return { ...b, n: list.length, actual: list.length ? won / list.length : null, stated };
  });
}

export default function ModelCard() {
  const [tr, setTr] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setTr)
      .catch(() => setFailed(true));
  }, []);

  const calib = useMemo(() => {
    if (!tr?.matches) return null;
    return { atp: calibrationBuckets(tr.matches, 'atp'), wta: calibrationBuckets(tr.matches, 'wta') };
  }, [tr]);

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

  return (
    <div className="mc-page">
      <div className="eyebrow">MODEL CARD</div>
      <h1 className="mc-title">Smash v{MODEL_VERSION}</h1>
      <p className="mc-lede">
        The full spec sheet: what the model is, what it learns from, how honest its
        numbers are, and where it falls short. For the plain-English version,
        read the <Link to="/methodology">methodology</Link>.
      </p>

      <section className="mc-section">
        <h2>What it is</h2>
        <p>
          Five engines compete: an exact point-by-point match calculation built from
          serve and return stats (closed-form, not sampled), a surface-aware Elo
          rating, the official world rankings, a hot-form variant of the point
          calculation, and the Smart Blend that mixes the first three with weights
          tuned separately for each tour and surface. The site deploys whichever
          engine has been most accurate for each tour and surface. A one-parameter
          recalibration is refit at every retune; it can temper stated confidence
          but never changes a pick
          {(CONFIG.calibration?.atp?.a ?? 1) === 1 && (CONFIG.calibration?.wta?.a ?? 1) === 1
            ? ' (currently a=1 on both tours, meaning no adjustment is needed)'
            : ` (currently a=${CONFIG.calibration?.atp?.a ?? 1} ATP, a=${CONFIG.calibration?.wta?.a ?? 1} WTA)`}.
        </p>
        <div className="mc-weights">
          {['atp', 'wta'].map((tour) => (
            <div key={tour} className="mc-weights-card">
              <div className="mc-weights-tour">{tour.toUpperCase()}</div>
              <table className="mc-table">
                <thead>
                  <tr><th>Surface</th><th>Point sim</th><th>Form (Elo)</th><th>Rankings</th></tr>
                </thead>
                <tbody>
                  {SURFACES.map((s) => {
                    const w = CONFIG.weights?.[tour]?.[s] || {};
                    return (
                      <tr key={s}>
                        <td className="mc-td-label">{s}</td>
                        <td>{Math.round((w.ws || 0) * 100)}%</td>
                        <td>{Math.round((w.we || 0) * 100)}%</td>
                        <td>{Math.round((w.wr || 0) * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mc-calib-line">
                calibration a = {CONFIG.calibration?.[tour]?.a ?? 1}
                {CONFIG.calibration?.[tour]?.a < 1 ? ' (tempers confidence)' : ''}
              </div>
            </div>
          ))}
        </div>
        <p className="mc-fine">
          The Elo updates scale with match dominance (a straight-sets win moves ratings
          more than a deciding-set escape) and each player's rating blends their overall
          and surface-specific levels 50/50.
          {CONFIG.tunedAt ? ` Last retuned ${fmtDate(CONFIG.tunedAt)}.` : ''}
        </p>
      </section>

      <section className="mc-section">
        <h2>How it's tuned</h2>
        <p>
          The blend weights and the calibration are refit just before every grand slam,
          and every candidate change to the model has to win the same trial first:
          walk-forward evaluation (fit on everything before a date, predict what comes
          after, never the reverse) scored by log loss, which punishes overconfidence
          in a way accuracy can't. Nothing ships on in-sample numbers, and retunes open
          a reviewable pull request rather than changing the model silently.
        </p>
      </section>

      <section className="mc-section">
        <h2>Scorecard</h2>
        {failed && <p className="mc-fine">The graded record could not be loaded right now.</p>}
        {!tr && !failed && <div className="skeleton mc-skel" />}
        {tr?.logLoss && (
          <div className="mc-scoreboard">
            {['atp', 'wta'].map((tour) => {
              const ll = tr.logLoss[tour];
              if (!ll) return null;
              return (
                <div key={tour} className="mc-score-card">
                  <div className="mc-weights-tour">{tour.toUpperCase()}</div>
                  <div className="mc-score-row"><span>Graded matches this season</span><strong>{ll.n?.toLocaleString()}</strong></div>
                  <div className="mc-score-row"><span>Log loss (lower is better)</span><strong>{ll.model}</strong></div>
                  {ll.market != null && (
                    <>
                      <div className="mc-score-row"><span>Bookmakers on the same matches</span><strong>{ll.market}</strong></div>
                      <div className="mc-score-row">
                        <span>Gap to the market</span>
                        <strong className={ll.gap <= 0 ? 'mc-good' : ''}>
                          {ll.gap > 0 ? `+${ll.gap}` : ll.gap}{ll.gap <= 0 ? ' (ahead)' : ''}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mc-fine">
          The bookmakers' closing line is the strongest public predictor of a tennis
          match, so the gap to it is the honest measure of how much headroom the model
          has left. Odds are the market's, with the bookmaker's margin removed.
        </p>
      </section>

      <section className="mc-section">
        <h2>Calibration</h2>
        <p>
          When the model says 70%, it should win about 70% of the time. Stated
          confidence vs what actually happened, on every graded call this season:
        </p>
        {calib && (
          <div className="mc-calib-grid">
            {['atp', 'wta'].map((tour) => (
              <div key={tour} className="mc-calib-card">
                <div className="mc-weights-tour">{tour.toUpperCase()}</div>
                {calib[tour].map((b) => (
                  <div className="mc-bucket" key={b.label}>
                    <span className="mc-bucket-label">{b.label}</span>
                    <span className="mc-bucket-bars">
                      <span className="mc-bar stated" style={{ width: `${(b.stated || 0) * 100}%` }} />
                      <span className="mc-bar actual" style={{ width: `${(b.actual || 0) * 100}%` }} />
                    </span>
                    <span className="mc-bucket-val">
                      {b.n ? `${Math.round((b.actual || 0) * 100)}% won · n=${b.n}` : 'no calls'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="mc-legend">
          <span><span className="mc-dot stated" /> stated confidence</span>
          <span><span className="mc-dot actual" /> actually won</span>
        </div>
      </section>

      <section className="mc-section">
        <h2>Data</h2>
        <ul className="mc-list">
          <li>Per-match serve and return box scores for every rostered tour player, weighted by recency (a match from last month counts far more than one from last year; grass decays on its own clock because its season is six weeks long).</li>
          <li>Full match history for the Elo timeline, replayed in date order so every rating a prediction uses existed before the match was played.</li>
          <li>ESPN's public scoreboard for live draws, and bookmaker closing odds where available for benchmarking only. Market odds are never an input to the prediction.</li>
        </ul>
      </section>

      <section className="mc-section">
        <h2>Known limitations</h2>
        <ul className="mc-list">
          <li>Injuries, retirements, and mid-tournament withdrawals are invisible to the model until they show up in results.</li>
          <li>Qualifiers and wildcards without enough tour-level data get a conservative default rather than a real estimate.</li>
          <li>Rankings enter as they stand today; the model does not reconstruct historical rankings for old matches.</li>
          <li>Grass gets the fewest matches per season, so grass weights carry the widest error bars.</li>
          <li>It prices matches, not sets or games, and it does not model momentum within a match.</li>
        </ul>
      </section>

      <p className="mc-foot">
        Every graded call stays public on the <Link to="/track-record">track record</Link>.
        Changes ship through the <Link to="/changelog">changelog</Link>.
      </p>
    </div>
  );
}
