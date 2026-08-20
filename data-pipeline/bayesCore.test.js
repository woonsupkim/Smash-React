// Tests for the Bayesian player-strength filter. Run: node --test data-pipeline
//
// The properties pinned here are the ones a silent refactor could break
// without changing a single log-loss number in the backtest: antisymmetry,
// the direction of an update, and - the one worth guarding hardest - that the
// overall/offset split reproduces the exact closed-form marginal variance
// (updateSide's mean-field projection is easy to get subtly wrong).
const test = require('node:test');
const assert = require('node:assert');
const {
  BASE, DEFAULT_PARAMS, g, newState, priorMean, predict,
  winProbBayes, winProbBand, marginMult, buildBayesTimeline,
} = require('./bayesCore');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const match = (o) => ({ id: o.id || 'm', date: o.date, winnerId: o.w, loserId: o.l, surface: o.s || 'hard', setsW: o.sw ?? 2, setsL: o.sl ?? 0, bestOf: o.bo ?? 3 });

test('g flattens the logistic as variance grows', () => {
  near(g(0), 1);
  assert.ok(g(100 * 100) < 1);
  assert.ok(g(400 * 400) < g(100 * 100));
  assert.ok(g(1e9) > 0); // never degenerates
});

test('a fresh player is a 50/50 against another fresh player', () => {
  near(winProbBayes(newState(), newState(), 'hard'), 0.5);
});

test('win probability is antisymmetric in the two players', () => {
  const a = newState(1700), b = newState(1450);
  near(winProbBayes(a, b, 'hard') + winProbBayes(b, a, 'hard'), 1);
});

test('the same skill gap predicts closer to 50% when players are less known', () => {
  const known = { ...newState(1700), all: { m: 1700, v: 40 * 40 } };
  const knownOpp = { ...newState(1500), all: { m: 1500, v: 40 * 40 } };
  const vague = { ...newState(1700), all: { m: 1700, v: 300 * 300 } };
  const vagueOpp = { ...newState(1500), all: { m: 1500, v: 300 * 300 } };
  const pKnown = winProbBayes(known, knownOpp, 'hard');
  const pVague = winProbBayes(vague, vagueOpp, 'hard');
  assert.ok(pKnown > pVague, `${pKnown} should exceed ${pVague}`);
  assert.ok(pVague > 0.5);
});

test('priorMean is flat unless rankPrior is switched on', () => {
  near(priorMean(1), BASE);
  near(priorMean(200), BASE);
  const p = { ...DEFAULT_PARAMS, rankPrior: 250, rankRef: 30 };
  assert.ok(priorMean(1, p) > BASE);
  assert.ok(priorMean(300, p) < BASE);
  near(priorMean(30, p), BASE);
  near(priorMean(null, p), BASE); // unknown rank falls back to flat
});

test('winProbBand brackets the point estimate', () => {
  const b = winProbBand(newState(1650), newState(1500), 'hard');
  assert.ok(b.lower < b.p && b.p < b.upper);
});

test('an update moves the winner up, the loser down, and sharpens both', () => {
  const states = buildBayesTimeline([match({ date: '2026-01-01', w: 'a', l: 'b' })]);
  const a = states.get('a'), b = states.get('b');
  assert.ok(a.all.m > BASE, 'winner overall mean should rise');
  assert.ok(b.all.m < BASE, 'loser overall mean should fall');
  assert.ok(a.all.v < DEFAULT_PARAMS.v0, 'winner overall variance should shrink');
  assert.ok(b.all.v < DEFAULT_PARAMS.v0, 'loser overall variance should shrink');
  // Symmetric evidence: equal priors means equal and opposite movement.
  near(a.all.m - BASE, BASE - b.all.m, 1e-9);
  near(a.all.v, b.all.v, 1e-9);
});

test('the overall/offset split reproduces the exact closed-form marginals', () => {
  // For an observation on z = overall + offset carrying precision p, the exact
  // marginal posterior of each component is Var(x) - Var(x)^2*p/(1+p*V).
  // updateSide apportions the reduction by SQUARED variance share, which is
  // algebraically the same thing - this pins that it stays that way.
  //
  // The precision is derived here from the model's own definition rather than
  // read back out of the posterior: both players are fresh so the pre-match
  // expectation is exactly 0.5, and a 2-0 best-of-three carries the 1.3
  // dominance weight.
  const states = buildBayesTimeline([match({ date: '2026-01-01', w: 'a', l: 'b', s: 'clay' })]);
  const a = states.get('a');
  const v0 = DEFAULT_PARAMS.v0, v0s = DEFAULT_PARAMS.v0Surf, V = v0 + v0s;
  const Q = Math.log(10) / 400;
  const p = 1.3 * Q * Q * g(V) * g(V) * 0.25;

  near(a.all.v, v0 - (v0 * v0 * p) / (1 + p * V), 1e-6);
  near(a.clay.v, v0s - (v0s * v0s * p) / (1 + p * V), 1e-6);

  // The mean shift splits by (unsquared) variance share, so the two
  // components move in proportion to how uncertain each one was.
  near((a.all.m - BASE) / a.clay.m, v0 / v0s, 1e-9);

  // Documenting the one approximation on purpose: the kept marginals sum to
  // MORE than the joint posterior variance, because the correlation the
  // observation induces between overall and offset is deliberately dropped.
  assert.ok(a.all.v + a.clay.v > 1 / (1 / V + p));
});

test('the surface played absorbs the offset; other surfaces stay put', () => {
  const states = buildBayesTimeline([match({ date: '2026-01-01', w: 'a', l: 'b', s: 'clay' })]);
  const a = states.get('a');
  assert.ok(a.clay.m > 0, 'clay offset should pick up the win');
  near(a.hard.m, 0);
  near(a.grass.m, 0);
  near(a.hard.v, DEFAULT_PARAMS.v0Surf); // untouched surfaces keep the prior
});

test('idle time re-widens the prior, capped at the cold-start width', () => {
  const wide = buildBayesTimeline([
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'b' }),
    match({ id: '2', date: '2026-01-08', w: 'a', l: 'c' }),
  ]);
  const tight = buildBayesTimeline([
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'b' }),
    match({ id: '2', date: '2026-01-02', w: 'a', l: 'c' }),
  ]);
  // Same two results; the player who waited a week arrives less certain, so
  // after the second match still carries at least as much variance.
  assert.ok(wide.get('a').all.v >= tight.get('a').all.v);
  // Cap: a five-year layoff must not exceed the debutant prior.
  const long = buildBayesTimeline([
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'b' }),
    match({ id: '2', date: '2031-01-01', w: 'a', l: 'c' }),
  ]);
  assert.ok(long.get('a').all.v <= DEFAULT_PARAMS.v0 + 1e-9);
});

test('margin weighting is bounded and ordered by dominance', () => {
  const p = { marginK: true };
  near(marginMult(null, null, 3, p), 1);       // unknown score -> neutral
  near(marginMult(2, 0, 3, p), 1.3);           // straight-sets sweep
  near(marginMult(2, 1, 3, p), 0.7);           // deciding-set escape
  assert.ok(marginMult(3, 0, 5, p) > marginMult(3, 2, 5, p));
  near(marginMult(2, 0, 3, { marginK: false }), 1); // switched off
});

test('a dominant win moves ratings more than a narrow one', () => {
  const sweep = buildBayesTimeline([match({ date: '2026-01-01', w: 'a', l: 'b', sw: 2, sl: 0 })]);
  const grind = buildBayesTimeline([match({ date: '2026-01-01', w: 'a', l: 'b', sw: 2, sl: 1 })]);
  assert.ok(sweep.get('a').all.m > grind.get('a').all.m);
});

test('the timeline skips unusable rows instead of corrupting state', () => {
  const states = buildBayesTimeline([
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'a' }),          // self-match
    match({ id: '2', date: '2026-01-01', w: 'b', l: 'c', s: 'mud' }), // unknown surface
    match({ id: '3', date: 'not-a-date', w: 'd', l: 'e' }),           // bad date
    match({ id: '4', date: '2026-01-02', w: 'f', l: 'g' }),           // the only good one
  ]);
  assert.deepStrictEqual([...states.keys()].sort(), ['f', 'g']);
});

test('replay order does not depend on input order', () => {
  const ms = [
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'b' }),
    match({ id: '2', date: '2026-02-01', w: 'b', l: 'c' }),
    match({ id: '3', date: '2026-03-01', w: 'c', l: 'a' }),
  ];
  const fwd = buildBayesTimeline(ms);
  const rev = buildBayesTimeline([...ms].reverse());
  for (const id of ['a', 'b', 'c']) {
    near(fwd.get(id).all.m, rev.get(id).all.m, 1e-9);
    near(fwd.get(id).all.v, rev.get(id).all.v, 1e-9);
  }
});

test('onMatch sees pre-match state, not post-match state', () => {
  const seen = [];
  buildBayesTimeline([
    match({ id: '1', date: '2026-01-01', w: 'a', l: 'b' }),
    match({ id: '2', date: '2026-01-15', w: 'a', l: 'c' }),
  ], (m, sw) => seen.push({ id: m.id, m: predict(sw, m.surface).m, seen: sw.seen }));
  near(seen[0].m, BASE);          // first look at 'a' is the untouched prior
  assert.strictEqual(seen[0].seen, 0);
  assert.ok(seen[1].m > BASE);    // by the second, the first result is in
  assert.strictEqual(seen[1].seen, 1);
});
