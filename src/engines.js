// Prediction engines shared by the H2H page (live) and Track Record (labels).
// Weights are tuned per tour x surface - see src/engineConfig.json and the
// backtest in data-pipeline/buildTrackRecord.js.
import CONFIG from './engineConfig.json';

export const ENGINES = [
  { id: 'smash', label: 'Smart Blend', tag: 'Blended', desc: 'Our best pick: a mix of everything below.' },
  { id: 'sim',   label: 'Point Sim',   tag: 'Play-by-play', desc: 'Plays out every point from each player\'s serve & return stats.' },
  { id: 'elo',   label: 'Form',        tag: 'Recent results', desc: 'Who\'s been winning lately on this surface.' },
  { id: 'rank',  label: 'Rankings',    tag: 'World ranking', desc: 'Just trust the official world rankings.' },
  { id: 'upset', label: 'Hot Streak',  tag: 'Last few weeks', desc: 'Only the last few weeks of form. Great for spotting upsets.' },
];

export const ENGINE_LABELS = Object.fromEntries(ENGINES.map((e) => [e.id, e.label]));

// Ranking-implied P(player 1 wins) from the two world ranks (lower = better).
export function rankProb(rankA, rankB) {
  const a = Number(rankA) || 999, b = Number(rankB) || 999;
  return 1 / (1 + Math.pow(10, (Math.log10(a) - Math.log10(b)) * CONFIG.rankScale));
}

// Elo-implied P(player 1 wins) on a surface, from two elo.json entries.
export function eloProb(eloA, eloB, surfaceKey) {
  if (!eloA || !eloB) return null;
  const pred = (r) => 0.5 * r.all + 0.5 * (r[surfaceKey] ?? r.all);
  return 1 / (1 + Math.pow(10, (pred(eloB) - pred(eloA)) / 400));
}

// Calibration shrink on the blend's tail (see engineConfig tailShrink):
// compresses stated confidence above the knee without ever changing the pick.
export function shrinkTail(p, tour) {
  const s = CONFIG.tailShrink?.[tour];
  if (!s) return p;
  const fav = Math.max(p, 1 - p);
  if (fav <= s.knee) return p;
  const shrunk = s.knee + (fav - s.knee) * s.factor;
  return p >= 0.5 ? shrunk : 1 - shrunk;
}

// All engines' P(player 1 wins). `feats` = { sim, elo, rankA, rankB } where
// sim/elo are P(p1) in [0,1] (elo may be null). Returns { sim, elo, rank, smash }.
export function engineProbs(feats, tour, surfaceKey) {
  const sim = feats.sim;
  const elo = feats.elo;
  const rank = rankProb(feats.rankA, feats.rankB);
  const w = (CONFIG.weights[tour] && CONFIG.weights[tour][surfaceKey]) || { ws: 0.5, we: 0.5, wr: 0 };
  // If Elo is unavailable, fold its weight into the simulation so the blend
  // still sums to 1.
  const eloVal = elo == null ? sim : elo;
  const smash = shrinkTail(w.ws * sim + w.we * eloVal + w.wr * rank, tour);
  return { sim, elo: elo == null ? null : elo, rank, smash };
}

// The selected engine's P(player 1 wins). `feats` additionally carries
// `upsetSim` (point sim on hot-form stats) for the 'upset' engine.
export function pickEngineProb(engine, feats, tour, surfaceKey) {
  if (engine === 'upset') return feats.upsetSim != null ? feats.upsetSim : feats.sim;
  const probs = engineProbs(feats, tour, surfaceKey);
  const v = probs[engine];
  return v == null ? feats.sim : v;
}

// Engines whose scorelines come from the point simulation and which stat set
// that simulation should use ('upset' = hot-form stats, otherwise normal).
export const engineStatSource = (engine) => (engine === 'upset' ? 'upset' : 'normal');
