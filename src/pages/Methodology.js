// src/pages/Methodology.js
//
// The "moat" page: a plain, honest write-up of how the prediction system
// works, what it's measured against, and where it falls short. Pulls a few
// live numbers from track_record.json so the claims stay in sync with the
// data instead of drifting into stale copy.
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import './Methodology.css';

function wilson(k, n) {
  if (!n) return { lo: 0, hi: 0, mid: 0 };
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { lo: center - half, hi: center + half, mid: p };
}

const CALIB_BUCKETS = [
  { label: '50–60%', lo: 0.5, hi: 0.6, mid: 55 },
  { label: '60–70%', lo: 0.6, hi: 0.7, mid: 65 },
  { label: '70–85%', lo: 0.7, hi: 0.85, mid: 77 },
  { label: '85%+', lo: 0.85, hi: 1.01, mid: 92 },
];

export default function Methodology() {
  const [data, setData] = useState(null);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => { if (!r.ok) throw new Error('bad response'); return r.json(); })
      .then(setData)
      .catch(() => { setData({ matches: [] }); setFailed(true); });
  }, []);

  const stats = useMemo(() => {
    const matches = data?.matches || [];
    const n = matches.length;
    const k = matches.filter((m) => m.smashCorrect).length;
    const ci = wilson(k, n);
    const acc = n ? Math.round((k / n) * 100) : 0;
    const ciHalf = Math.round(((ci.hi - ci.lo) / 2) * 100);

    const buckets = CALIB_BUCKETS.map((b) => {
      const fav = (m) => (m.smashProbP1 >= 0.5 ? m.smashProbP1 : 1 - m.smashProbP1);
      const inB = matches.filter((m) => fav(m) >= b.lo && fav(m) < b.hi);
      const won = inB.filter((m) => m.smashCorrect).length;
      return { ...b, n: inB.length, rate: inB.length ? Math.round((won / inB.length) * 100) : null };
    });

    const oddList = matches.filter((m) => m.oddCorrect != null);
    const marketAcc = oddList.length ? Math.round((oddList.filter((m) => m.oddCorrect).length / oddList.length) * 100) : null;
    const smashOnOdds = oddList.length ? Math.round((oddList.filter((m) => m.smashCorrect).length / oddList.length) * 100) : null;

    return { n, acc, ciHalf, buckets, marketAcc, smashOnOdds, oddsN: oddList.length };
  }, [data]);

  return (
    <div className="page-background method-bg">
      <div className="overlay method-overlay">
        <div className="method-page">
          <div className="method-header">
            <div className="eyebrow">HOW IT WORKS</div>
            <h1 className="method-title">Methodology</h1>
            <p className="method-sub">
              A tennis prediction is only as good as its scorecard. Here is exactly how
              the model makes a pick, what it is measured against, and where it falls short.
              No black box.
            </p>
          </div>

          {data === null && !failed && (
            <div className="skeleton method-headline-skeleton" aria-hidden="true" />
          )}
          {failed && (
            <div className="method-error" role="alert">
              Live scorecard numbers are temporarily unavailable. The methodology below still applies.
            </div>
          )}

          {stats.n > 0 && (
            <div className="method-headline">
              <div className="method-headline-stat">
                <span className="method-headline-val">{stats.acc}%</span>
                <span className="method-headline-cap">winners called · {stats.n.toLocaleString()} matches</span>
              </div>
              <div className="method-headline-stat">
                <span className="method-headline-val">±{stats.ciHalf}%</span>
                <span className="method-headline-cap">95% confidence interval</span>
              </div>
              {stats.marketAcc != null && (
                <div className="method-headline-stat">
                  <span className="method-headline-val">{stats.smashOnOdds}% <small>vs {stats.marketAcc}%</small></span>
                  <span className="method-headline-cap">us vs the market ({stats.oddsN})</span>
                </div>
              )}
            </div>
          )}

          <section className="method-section">
            <h2>How a single prediction is made</h2>
            <p>
              Every player carries six recency-weighted rates derived from real match history:
              first- and second-serve in%, first- and second-serve return%, rally win%, and ace rate.
              Recent matches count for more than old ones (exponential time decay), so form matters.
            </p>
            <p>
              The <strong>Point Sim</strong> engine plays out a full best-of-5 (ATP) or best-of-3 (WTA)
              match point by point, thousands of times, and counts how often each player wins. That
              gives both a win probability and a distribution of likely scorelines.
            </p>
            <p>
              Two other signals sharpen it: a <strong>surface Elo</strong> rating (how a player has
              actually been winning and losing on this surface) and a <strong>ranking-implied</strong>
              probability. The deployed <strong>Smart Blend</strong> combines all three with weights
              tuned separately for each tour and surface - clay rewards ranking and grind, grass rewards
              serve, and the mix reflects that.
            </p>
          </section>

          <section className="method-section">
            <h2>Is it calibrated?</h2>
            <p>
              Accuracy alone isn't enough - a stated 70% should win about 70% of the time. These bars
              show, for every confidence band, how often the favorite actually won across the season.
              Bars landing near their band mean the probabilities are honest, not just directional.
            </p>
            <div className="method-calib">
              {stats.buckets.map((b) => (
                <div className="method-calib-row" key={b.label}>
                  <div className="method-calib-said">Said {b.label}</div>
                  <div className="method-calib-track">
                    <div className="method-calib-ideal" style={{ left: `${b.mid}%` }} />
                    <div className="method-calib-fill" style={{ width: `${b.rate ?? 0}%` }} />
                  </div>
                  <div className="method-calib-actual">{b.rate == null ? '-' : `won ${b.rate}%`}</div>
                  <div className="method-calib-n">{b.n}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="method-section">
            <h2>In-sample vs. the forward test</h2>
            <p>
              The blend weights are fit on the 2026 season the retrospective page also displays. That
              is useful for comparing engines, but it flatters the model - it has, in a sense, seen the
              answers. The honest number is the <strong>locked forward record</strong>: a prediction is
              published <em>before</em> a match is played, then graded automatically when the result
              lands. No hindsight, no retuning. That record is the one that counts.
            </p>
            <p>
              The surface Elo used in the retrospective is also leak-free - ratings are replayed
              chronologically, so each match is scored with only what was known beforehand.
            </p>
          </section>

          <section className="method-section">
            <h2>What it's measured against</h2>
            <p>
              Two baselines keep the model honest. <strong>Higher rank wins</strong> is the naive pick
              - just take the better-ranked player. The much harder test is the
              <strong> bookmaker favorite</strong>: the market's shortest price already prices in
              everything public, so matching or beating the closing line is the most credible claim in
              sports prediction. Both are shown on the{' '}
              <Link to="/track-record">Track Record</Link> page over the exact same matches.
            </p>
          </section>

          <section className="method-section">
            <h2>Honest limitations</h2>
            <ul className="method-limits">
              <li>Weights are fit on a single season, so in-sample accuracy overstates real-world edge - read the locked forward record.</li>
              <li>Each player's cache holds only their recent matches, so a very old head-to-head can be missed.</li>
              <li>The forward record is Slam-focused and built on a top-50 roster, so it fills in gradually.</li>
              <li>Betting-market comparisons only cover matches that carried odds (about half the sample).</li>
              <li>This is a statistical model for entertainment and analysis. It is not betting advice.</li>
            </ul>
          </section>

          <div className="method-footer">
            <Link className="method-cta" to="/track-record">See the full track record →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
