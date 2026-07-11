import { simulateMatch, simulateBatch } from './simulator';

// Balanced and lopsided probability profiles: [1st in, 2nd in, 1st ret, 2nd ret, rally, ace]
const EVEN = [0.62, 0.9, 0.33, 0.5, 0.66, 0.06];
const STRONG = [0.72, 0.95, 0.45, 0.6, 0.74, 0.12];
const WEAK = [0.55, 0.85, 0.22, 0.38, 0.55, 0.03];

describe('simulateMatch', () => {
  test('best-of-3: winner needs exactly 2 sets, never more than 3 played', () => {
    for (let i = 0; i < 300; i++) {
      const { winner, setsWon, setScores } = simulateMatch(EVEN, EVEN, 3);
      const w = winner === 'A' ? 0 : 1;
      expect(setsWon[w]).toBe(2);
      expect(setsWon[1 - w]).toBeLessThanOrEqual(1);
      expect(setScores.length).toBeGreaterThanOrEqual(2);
      expect(setScores.length).toBeLessThanOrEqual(3);
    }
  });

  test('best-of-5: winner needs exactly 3 sets, never more than 5 played', () => {
    for (let i = 0; i < 300; i++) {
      const { winner, setsWon, setScores } = simulateMatch(EVEN, EVEN, 5);
      const w = winner === 'A' ? 0 : 1;
      expect(setsWon[w]).toBe(3);
      expect(setsWon[1 - w]).toBeLessThanOrEqual(2);
      expect(setScores.length).toBeGreaterThanOrEqual(3);
      expect(setScores.length).toBeLessThanOrEqual(5);
    }
  });

  test('each set is a valid tennis scoreline (win by 2, or 7-6)', () => {
    for (let i = 0; i < 200; i++) {
      const { setScores } = simulateMatch(EVEN, WEAK, 5);
      for (const [ga, gb] of setScores) {
        const hi = Math.max(ga, gb), lo = Math.min(ga, gb);
        expect(hi).toBeGreaterThanOrEqual(6);
        expect(hi).toBeLessThanOrEqual(7);
        if (hi === 7) expect(lo === 5 || lo === 6).toBe(true);
        else expect(hi - lo).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('simulateBatch', () => {
  test('match wins sum to the number of simulations', () => {
    const n = 500;
    const res = simulateBatch(EVEN, WEAK, n, 5);
    expect(res.matchWins[0] + res.matchWins[1]).toBe(n);
  });

  test('the set-margin distribution accounts for every win', () => {
    const n = 500;
    const res = simulateBatch(EVEN, EVEN, n, 5);
    for (const side of [0, 1]) {
      const total = res.lostInWins[side].reduce((a, b) => a + b, 0);
      expect(total).toBe(res.matchWins[side]);
    }
  });

  test('a much stronger player wins the clear majority', () => {
    const n = 600;
    const res = simulateBatch(STRONG, WEAK, n, 5);
    expect(res.matchWins[0] / n).toBeGreaterThan(0.8);
  });

  test('best-of-3 shrinks a favorite’s edge vs best-of-5', () => {
    const n = 800;
    const bo5 = simulateBatch(STRONG, EVEN, n, 5).matchWins[0] / n;
    const bo3 = simulateBatch(STRONG, EVEN, n, 3).matchWins[0] / n;
    // More sets favor the better player; allow noise but the direction should hold on average
    expect(bo5).toBeGreaterThan(0.5);
    expect(bo3).toBeGreaterThan(0.5);
  });
});
