import { pointProb, gameProb, setProb, matchProb, matchDetail } from './analyticProb';

// Real roster stat lines (p1..p6): Sinner, Alcaraz, Zverev on hard.
const SINNER = [0.63, 0.94, 0.32, 0.52, 0.45, 0.19];
const ALCARAZ = [0.66, 0.92, 0.34, 0.49, 0.43, 0.11];
const ZVEREV = [0.72, 0.92, 0.28, 0.46, 0.41, 0.17];
const NEUTRAL = [0.60, 0.90, 0.30, 0.50, 0.40, 0.05];

describe('analytic match probability', () => {
  test('agrees with a 200k-draw Monte Carlo run (fixtures)', () => {
    // Reference values from data-pipeline validation against simulateBatch.
    expect(matchProb(SINNER, ALCARAZ, 5)).toBeCloseTo(0.5821, 3);
    expect(matchProb(ZVEREV, SINNER, 5)).toBeCloseTo(0.3701, 3);
  });

  test('identical players are an exact coin flip', () => {
    expect(matchProb(NEUTRAL, NEUTRAL, 3)).toBeCloseTo(0.5, 9);
    expect(matchProb(NEUTRAL, NEUTRAL, 5)).toBeCloseTo(0.5, 9);
  });

  test('probabilities for the two orientations sum to 1', () => {
    expect(matchProb(SINNER, ALCARAZ, 5) + matchProb(ALCARAZ, SINNER, 5)).toBeCloseTo(1, 9);
    expect(matchProb(ZVEREV, ALCARAZ, 3) + matchProb(ALCARAZ, ZVEREV, 3)).toBeCloseTo(1, 9);
  });

  test('longer format favors the stronger player', () => {
    const bo3 = matchProb(SINNER, NEUTRAL, 3);
    const bo5 = matchProb(SINNER, NEUTRAL, 5);
    expect(bo3).toBeGreaterThan(0.5);
    expect(bo5).toBeGreaterThan(bo3);
  });

  test('improving rally win rate improves the match probability', () => {
    const better = [...NEUTRAL];
    better[4] = 0.46;
    expect(matchProb(better, NEUTRAL, 3)).toBeGreaterThan(0.5);
  });

  test('point and game probabilities stay in (0, 1)', () => {
    const q = pointProb(SINNER, ALCARAZ);
    expect(q).toBeGreaterThan(0.5); // servers win most points in pro tennis
    expect(q).toBeLessThan(1);
    const g = gameProb(q);
    expect(g).toBeGreaterThan(q); // holding a game amplifies the point edge
    expect(g).toBeLessThan(1);
  });

  test('set probability amplifies the point edge further', () => {
    const qA = pointProb(SINNER, ALCARAZ);
    const qB = pointProb(ALCARAZ, SINNER);
    const s = setProb(qA, qB);
    expect(s).toBeGreaterThan(0.5);
    expect(setProb(qB, qA)).toBeCloseTo(1 - s, 9);
  });

  test('matchDetail distribution sums to 1 and matches matchProb', () => {
    const d = matchDetail(SINNER, ALCARAZ, 5);
    const total = d.lossDist[0].reduce((s, v) => s + v, 0) + d.lossDist[1].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(d.probP1).toBeCloseTo(matchProb(SINNER, ALCARAZ, 5), 9);
    expect(d.target).toBe(3);
    expect(d.lossDist[0]).toHaveLength(3);
  });
});
