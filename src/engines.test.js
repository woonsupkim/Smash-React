import { rankProb, eloProb, engineProbs, pickEngineProb, calibrate } from './engines';
import CONFIG from './engineConfig.json';

describe('calibrate', () => {
  test('0.5 is a fixed point for every tour (a pick can never flip)', () => {
    expect(calibrate(0.5, 'atp')).toBeCloseTo(0.5, 9);
    expect(calibrate(0.5, 'wta')).toBeCloseTo(0.5, 9);
  });
  test('preserves which side is favored', () => {
    for (const tour of ['atp', 'wta']) {
      expect(calibrate(0.73, tour)).toBeGreaterThan(0.5);
      expect(calibrate(0.31, tour)).toBeLessThan(0.5);
    }
  });
  test('is monotone', () => {
    for (const tour of ['atp', 'wta']) {
      expect(calibrate(0.9, tour)).toBeGreaterThan(calibrate(0.7, tour));
      expect(calibrate(0.7, tour)).toBeGreaterThan(calibrate(0.55, tour));
    }
  });
  test('is symmetric: calibrate(p) + calibrate(1-p) = 1', () => {
    for (const tour of ['atp', 'wta']) {
      expect(calibrate(0.8, tour) + calibrate(0.2, tour)).toBeCloseTo(1, 9);
    }
  });
  test('a < 1 tempers confidence toward 0.5', () => {
    for (const tour of ['atp', 'wta']) {
      const a = CONFIG.calibration?.[tour]?.a;
      if (a && a < 1) {
        expect(calibrate(0.9, tour)).toBeLessThan(0.9);
        expect(calibrate(0.9, tour)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('rankProb', () => {
  test('the better-ranked (lower number) player is favored', () => {
    expect(rankProb(1, 100)).toBeGreaterThan(0.5);
    expect(rankProb(100, 1)).toBeLessThan(0.5);
  });
  test('equal ranks are a coin flip', () => {
    expect(rankProb(20, 20)).toBeCloseTo(0.5, 6);
  });
  test('stays within [0, 1] and is symmetric', () => {
    const p = rankProb(3, 40);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(rankProb(3, 40) + rankProb(40, 3)).toBeCloseTo(1, 6);
  });
  test('missing ranks fall back to 999 (treated as equal)', () => {
    expect(rankProb(undefined, undefined)).toBeCloseTo(0.5, 6);
  });
});

describe('eloProb', () => {
  const A = { all: 2000, hard: 2050, clay: 1900, grass: 1950 };
  const B = { all: 1800, hard: 1780, clay: 1850, grass: 1700 };
  test('null when either rating is missing', () => {
    expect(eloProb(null, B, 'hard')).toBeNull();
    expect(eloProb(A, null, 'hard')).toBeNull();
  });
  test('higher-rated player is favored on the surface', () => {
    expect(eloProb(A, B, 'hard')).toBeGreaterThan(0.5);
    expect(eloProb(B, A, 'hard')).toBeLessThan(0.5);
  });
  test('probabilities for the two sides sum to 1', () => {
    expect(eloProb(A, B, 'grass') + eloProb(B, A, 'grass')).toBeCloseTo(1, 6);
  });
});

describe('engineProbs', () => {
  test('returns all engine probabilities and a blend within component range', () => {
    const feats = { sim: 0.7, elo: 0.6, rankA: 5, rankB: 40 };
    const p = engineProbs(feats, 'atp', 'hard');
    expect(p.sim).toBe(0.7);
    expect(p.elo).toBe(0.6);
    expect(p.rank).toBeGreaterThan(0.5);
    // Convex blend can't fall outside the min/max of its components
    const comps = [p.sim, p.elo, p.rank];
    expect(p.smash).toBeGreaterThanOrEqual(Math.min(...comps) - 1e-9);
    expect(p.smash).toBeLessThanOrEqual(Math.max(...comps) + 1e-9);
  });
  test('folds elo weight into sim when elo is unavailable', () => {
    const p = engineProbs({ sim: 0.65, elo: null, rankA: 10, rankB: 10 }, 'atp', 'hard');
    expect(p.elo).toBeNull();
    // With rank a coin flip and elo folded into sim, the blend leans toward sim
    expect(p.smash).toBeGreaterThan(0.5);
  });
});

describe('pickEngineProb', () => {
  const feats = { sim: 0.7, upsetSim: 0.8, elo: 0.6, rankA: 5, rankB: 40 };
  test('selects the requested engine', () => {
    expect(pickEngineProb('sim', feats, 'atp', 'hard')).toBe(0.7);
    expect(pickEngineProb('upset', feats, 'atp', 'hard')).toBe(0.8);
    expect(pickEngineProb('rank', feats, 'atp', 'hard')).toBeGreaterThan(0.5);
  });
  test('falls back to sim for an unknown engine', () => {
    expect(pickEngineProb('nope', feats, 'atp', 'hard')).toBe(0.7);
  });
});
