import { credibleInterval, confidenceLabel, sampleSizeFlag } from './credibleInterval';

describe('credibleInterval', () => {
  test('uniform prior with no data spans almost the whole range', () => {
    const { lower, upper } = credibleInterval(0, 0);
    // Beta(1,1) 95% CI is [0.025, 0.975]
    expect(lower).toBeCloseTo(0.025, 2);
    expect(upper).toBeCloseTo(0.975, 2);
  });

  test('50/50 brackets 0.5 and is reasonably wide', () => {
    const { lower, upper } = credibleInterval(50, 50);
    expect(lower).toBeLessThan(0.5);
    expect(upper).toBeGreaterThan(0.5);
    // ~[0.40, 0.60]
    expect(upper - lower).toBeGreaterThan(0.15);
    expect(upper - lower).toBeLessThan(0.24);
  });

  test('more samples tighten the interval', () => {
    const small = credibleInterval(50, 50);
    const large = credibleInterval(500, 500);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
    // 1000 trials: roughly [0.47, 0.53]
    expect(large.upper - large.lower).toBeLessThan(0.07);
  });

  test('the point estimate stays inside the interval', () => {
    const { lower, upper } = credibleInterval(620, 380);
    const p = 620 / 1000;
    expect(p).toBeGreaterThan(lower);
    expect(p).toBeLessThan(upper);
  });
});

describe('confidenceLabel', () => {
  test('buckets by favored probability', () => {
    expect(confidenceLabel(0.5, 0.45, 0.55)).toMatch(/Toss-up/);
    expect(confidenceLabel(0.62, 0.58, 0.66)).toMatch(/Slight favorite/);
    expect(confidenceLabel(0.72, 0.68, 0.76)).toMatch(/Likely/);
    expect(confidenceLabel(0.9, 0.87, 0.93)).toMatch(/Highly likely/);
    expect(confidenceLabel(0.98, 0.96, 0.99)).toMatch(/Near-certain/);
  });

  test('symmetric in prob (favored side is what matters)', () => {
    expect(confidenceLabel(0.28, 0.24, 0.32)).toMatch(/Likely/);
  });

  test('flags a wide interval as uncertain', () => {
    expect(confidenceLabel(0.72, 0.5, 0.9)).toMatch(/uncertain/);
    expect(confidenceLabel(0.72, 0.69, 0.75)).not.toMatch(/uncertain/);
  });
});

describe('sampleSizeFlag', () => {
  test('no data returns null', () => {
    expect(sampleSizeFlag(0, 0)).toBeNull();
  });
  test('a tiny lopsided sample is a coinflip (CI straddles 0.5)', () => {
    expect(sampleSizeFlag(6, 4)).toBe('coinflip');
  });
  test('a large lopsided sample is reliable', () => {
    expect(sampleSizeFlag(900, 100)).toBeNull();
  });
});
