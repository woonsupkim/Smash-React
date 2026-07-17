import { pointProb, gameProb, setProb, setProbFrom, matchProb, matchProbLive, matchDetail } from './analyticProb';

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

  test('live probability from a fresh match equals the pre-match number', () => {
    expect(matchProbLive(SINNER, ALCARAZ, 5, {})).toBeCloseTo(matchProb(SINNER, ALCARAZ, 5), 9);
    const qA = pointProb(SINNER, ALCARAZ), qB = pointProb(ALCARAZ, SINNER);
    expect(setProbFrom(qA, qB, 0, 0, null)).toBeCloseTo(setProb(qA, qB), 9);
  });

  test('live probability responds to the score the right way', () => {
    const pre = matchProb(SINNER, ALCARAZ, 5);
    const upSet = matchProbLive(SINNER, ALCARAZ, 5, { setsA: 1, setsB: 0 });
    const downSet = matchProbLive(SINNER, ALCARAZ, 5, { setsA: 0, setsB: 1 });
    expect(upSet).toBeGreaterThan(pre);
    expect(downSet).toBeLessThan(pre);
    // Up a break inside the set beats level inside the set.
    const upBreak = matchProbLive(SINNER, ALCARAZ, 5, { gamesA: 3, gamesB: 1, serverNext: 0 });
    const level = matchProbLive(SINNER, ALCARAZ, 5, { gamesA: 2, gamesB: 2, serverNext: 0 });
    expect(upBreak).toBeGreaterThan(level);
    // Decided states are certainties.
    expect(matchProbLive(SINNER, ALCARAZ, 5, { setsA: 3, setsB: 1 })).toBe(1);
    expect(matchProbLive(SINNER, ALCARAZ, 5, { setsA: 0, setsB: 3 })).toBe(0);
  });

  test('in-set probabilities stay coherent at set point', () => {
    const qA = pointProb(SINNER, ALCARAZ), qB = pointProb(ALCARAZ, SINNER);
    // Serving for the set at 5-4 is a strong favorite to close.
    expect(setProbFrom(qA, qB, 5, 4, 0)).toBeGreaterThan(0.8);
    // Down 4-5 with the opponent serving next is the mirror image.
    expect(setProbFrom(qA, qB, 4, 5, 1)).toBeLessThan(0.5);
  });

  test('scoreline temperature reshapes the distribution but never the win prob', () => {
    const raw = matchDetail(SINNER, NEUTRAL, 5);
    const hot = matchDetail(SINNER, NEUTRAL, 5, 2.35);
    // Win probability is untouched by design.
    expect(hot.probP1).toBeCloseTo(raw.probP1, 9);
    // Sharpening shifts conditional mass toward the sweep for the favorite.
    const shareSweep = (d) => d.lossDist[0][0] / d.lossDist[0].reduce((s, v) => s + v, 0);
    expect(shareSweep(hot)).toBeGreaterThan(shareSweep(raw));
    // Temperature 1 is the identity.
    const t1 = matchDetail(SINNER, NEUTRAL, 5, 1);
    expect(t1.lossDist[0][1]).toBeCloseTo(raw.lossDist[0][1], 12);
  });
});
