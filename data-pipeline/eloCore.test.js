// Tests for the Elo core's parameter resolution.
// Run: node --test data-pipeline/*.test.js data-pipeline/lib/*.test.js
//
// The K-factor schedule is now tuned PER TOUR, and three separate pipeline
// scripts replay both tours in a single process. That makes parameter
// resolution the failure mode worth pinning: if a caller forgets to switch
// tours, whichever tour ran first silently sets the schedule for both and the
// ratings are quietly wrong with nothing to notice.
const test = require('node:test');
const assert = require('node:assert');
const { kFactor, setEloParams, eloParamsFor, DEFAULT_PARAMS } = require('./eloCore');
const CONFIG = require('../src/engineConfig.json');

test('per-tour blocks never leak into the shared defaults', () => {
  assert.ok(!('atp' in DEFAULT_PARAMS), 'DEFAULT_PARAMS must not carry an atp block');
  assert.ok(!('wta' in DEFAULT_PARAMS), 'DEFAULT_PARAMS must not carry a wta block');
});

test('eloParamsFor layers the tour block over the root values', () => {
  for (const tour of ['atp', 'wta']) {
    const p = eloParamsFor(tour);
    const block = CONFIG.elo[tour] || {};
    // Tour-specific keys win...
    for (const [k, v] of Object.entries(block)) assert.strictEqual(p[k], v, `${tour}.${k}`);
    // ...and shared keys are inherited, not dropped.
    assert.strictEqual(p.rho, CONFIG.elo.rho);
    assert.strictEqual(p.marginK, CONFIG.elo.marginK);
    assert.ok(Number.isFinite(p.kScale) && Number.isFinite(p.kExp));
  }
});

test('rho stays shared across tours - the client reads it as one global', () => {
  // src/engines.js eloProb has no `tour` argument, so a per-tour rho would
  // silently desync the live prediction from the graded record.
  assert.strictEqual(eloParamsFor('atp').rho, eloParamsFor('wta').rho);
});

test('an unknown tour falls back to the root schedule', () => {
  const p = eloParamsFor('itf');
  assert.strictEqual(p.kScale, DEFAULT_PARAMS.kScale);
  assert.strictEqual(p.kExp, DEFAULT_PARAMS.kExp);
});

test('switching tours actually changes the K-factor curve', () => {
  setEloParams(eloParamsFor('atp'));
  const atpK = [0, 20, 200].map(kFactor);
  setEloParams(eloParamsFor('wta'));
  const wtaK = [0, 20, 200].map(kFactor);
  assert.notDeepStrictEqual(atpK, wtaK, 'the two tours ship different schedules, so K must differ');
  // WTA ships kExp = 0, i.e. a constant K that ignores experience.
  if (eloParamsFor('wta').kExp === 0) {
    assert.strictEqual(wtaK[0], wtaK[2]);
    assert.strictEqual(wtaK[0], eloParamsFor('wta').kScale);
  }
  // ATP keeps a decaying schedule: big early swings, settling with experience.
  setEloParams(eloParamsFor('atp'));
  assert.ok(kFactor(0) > kFactor(20) && kFactor(20) > kFactor(200));
});

test('setEloParams({}) restores the shared defaults', () => {
  setEloParams(eloParamsFor('wta'));
  setEloParams({});
  assert.strictEqual(kFactor(20), DEFAULT_PARAMS.kScale / Math.pow(25, DEFAULT_PARAMS.kExp));
});
