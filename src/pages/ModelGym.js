// src/pages/ModelGym.js
//
// THE MODEL GYM: build your own blend. The ledger ships every base engine's
// probability for every graded match, so the whole backtest runs in the
// browser: drag the weights, watch your blend's season accuracy re-score
// against the deployed model instantly. "Beat the Model" for the crowd that
// reads the methodology page.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useDocMeta from '../utils/useDocMeta';
import './ModelGym.css';

const ENGINES = [
  { key: 'sim', field: 'probP1', label: 'Point Engine', desc: 'serve/return stats played out point by point' },
  { key: 'elo', field: 'eloProbP1', label: 'Form (Elo)', desc: 'who has actually been winning lately' },
  { key: 'rank', field: 'rankProbP1', label: 'Rankings', desc: 'the official pecking order' },
  { key: 'upset', field: 'upsetProbP1', label: 'Upset Lens', desc: 'stats tilted toward volatility' },
];

const PRESETS = [
  { label: 'Even split', w: { sim: 25, elo: 25, rank: 25, upset: 25 } },
  { label: 'All form', w: { sim: 0, elo: 100, rank: 0, upset: 0 } },
  { label: 'Respect the seeds', w: { sim: 20, elo: 10, rank: 70, upset: 0 } },
  { label: 'Stat purist', w: { sim: 80, elo: 10, rank: 10, upset: 0 } },
  { label: 'Chaos theory', w: { sim: 10, elo: 20, rank: 0, upset: 70 } },
];

export default function ModelGym() {
  useDocMeta(
    'The Model Gym: Build Your Own Blend | Smash',
    'Weight the four engines yourself and backtest instantly against every graded match this season. Beat the deployed model if you can.'
  );
  const [rows, setRows] = useState(null);
  const [weights, setWeights] = useState({ sim: 25, elo: 25, rank: 25, upset: 25 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setRows((d.matches || []).filter((m) =>
        ENGINES.every((e) => m[e.field] != null) && typeof m.p1Won === 'boolean')))
      .catch(() => setRows([]));
  }, []);

  const result = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const total = ENGINES.reduce((s, e) => s + weights[e.key], 0);
    if (total === 0) return { zero: true };
    let hits = 0, logLoss = 0;
    let smashHits = 0, deployedHits = 0;
    for (const m of rows) {
      let p = 0;
      for (const e of ENGINES) p += (weights[e.key] / total) * m[e.field];
      if ((p >= 0.5) === m.p1Won) hits++;
      const pw = m.p1Won ? p : 1 - p;
      logLoss += -Math.log(Math.min(Math.max(pw, 1e-6), 1 - 1e-6));
      if (m.smashCorrect) smashHits++;
      if (m.pickCorrect ?? m.smashCorrect) deployedHits++;
    }
    const n = rows.length;
    return {
      n,
      acc: (hits / n) * 100,
      logLoss: logLoss / n,
      smashAcc: (smashHits / n) * 100,
      deployedAcc: (deployedHits / n) * 100,
    };
  }, [rows, weights]);

  const beat = result && !result.zero && result.acc > result.deployedAcc;
  const tied = result && !result.zero && Math.abs(result.acc - result.deployedAcc) < 0.05;

  const share = async () => {
    const line = beat
      ? `I built a blend that beats Smash: ${result.acc.toFixed(1)}% vs ${result.deployedAcc.toFixed(1)}% on ${result.n.toLocaleString()} graded matches.`
      : `The model survives another challenger: my blend ${result.acc.toFixed(1)}%, Smash ${result.deployedAcc.toFixed(1)}% on ${result.n.toLocaleString()} graded matches.`;
    const text = `${line}\nBuild yours: ${window.location.origin}/gym`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch { /* fall through */ }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* unavailable */ }
  };

  if (!rows) return <div className="gym-page"><div className="skeleton gym-skel" /></div>;

  return (
    <div className="gym-page">
      <div className="eyebrow">THE MODEL GYM</div>
      <h1 className="gym-title">Build your own blend</h1>
      <p className="gym-sub">
        Our deployed model is a weighted blend of four engines. Think you'd weight them
        better? Drag the sliders - your blend re-scores against every graded match this
        season, instantly, on the same public ledger we grade ourselves on.
      </p>

      {result && !result.zero && (
        <div className="gym-hero">
          <div className={`gym-hero-cell${beat ? ' winning' : ''}`}>
            <div className="gym-hero-val">{result.acc.toFixed(1)}%</div>
            <div className="gym-hero-label">YOUR BLEND</div>
          </div>
          <div className="gym-hero-vs">vs</div>
          <div className={`gym-hero-cell${!beat ? ' winning' : ''}`}>
            <div className="gym-hero-val">{result.deployedAcc.toFixed(1)}%</div>
            <div className="gym-hero-label">SMASH, DEPLOYED</div>
          </div>
        </div>
      )}
      {result?.zero && <div className="gym-zero">All weights at zero is not a model, it's a shrug. Give an engine some say.</div>}
      {result && !result.zero && (
        <div className={`gym-verdict${beat ? ' beat' : ''}`}>
          {beat
            ? `You're ahead by ${(result.acc - result.deployedAcc).toFixed(1)} points. In-sample, mind you - the model earned its number without peeking.`
            : tied
              ? 'Dead heat. The tiebreak goes to the one that called it before the matches were played.'
              : `The model survives another challenger - by ${(result.deployedAcc - result.acc).toFixed(1)} points across ${result.n.toLocaleString()} matches.`}
        </div>
      )}

      <div className="gym-presets">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="gym-preset" onClick={() => setWeights({ ...p.w })}>{p.label}</button>
        ))}
      </div>

      <div className="gym-sliders">
        {ENGINES.map((e) => (
          <div className="gym-slider-row" key={e.key}>
            <div className="gym-slider-head">
              <span className="gym-engine">{e.label}</span>
              <span className="gym-engine-desc">{e.desc}</span>
              <span className="gym-weight">{weights[e.key]}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={weights[e.key]}
              aria-label={`${e.label} weight`}
              onChange={(ev) => setWeights((w) => ({ ...w, [e.key]: Number(ev.target.value) }))}
            />
          </div>
        ))}
      </div>

      {result && !result.zero && (
        <div className="gym-stats">
          <span>log loss {result.logLoss.toFixed(3)}</span>
          <span>·</span>
          <span>{result.n.toLocaleString()} graded matches</span>
          <span>·</span>
          <span>weights normalize to 100%</span>
        </div>
      )}

      <button type="button" className="gym-share" onClick={share} disabled={!result || result.zero}>
        {copied ? 'Copied!' : beat ? 'Brag about it' : 'Share the attempt'}
      </button>

      <p className="gym-note">
        Fair-fight footnote: your blend is tuned with hindsight on the full season
        (in-sample); the deployed number was locked walk-forward, before each match.
        Beating it here is step one. Beating it <Link to="/pickem">before play</Link> is the game.
        How the real blend picks its weights: <Link to="/methodology">methodology</Link>.
      </p>
    </div>
  );
}
