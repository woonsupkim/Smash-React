// Prediction engines shared by the H2H page (live) and Track Record (labels).
// Weights are tuned per tour x surface — see src/engineConfig.json and the
// backtest in data-pipeline/buildTrackRecord.js.
import CONFIG from './engineConfig.json';

export const ENGINES = [
  { id: 'smash', label: 'SMASH model', desc: 'Tuned blend — most accurate' },
  { id: 'sim', label: 'Simulation', desc: 'Point-by-point serve/return sim' },
  { id: 'elo', label: 'Form rating', desc: 'Surface Elo from recent results' },
  { id: 'rank', label: 'Ranking', desc: 'World-ranking implied odds' },
];

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
  const smash = w.ws * sim + w.we * eloVal + w.wr * rank;
  return { sim, elo: elo == null ? null : elo, rank, smash };
}
