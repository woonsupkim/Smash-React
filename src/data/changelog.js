// src/data/changelog.js
//
// Versioned history of the model and the product. The MODEL_VERSION is
// surfaced on the Track Record page so every accuracy claim is traceable to
// the engine revision that produced it. Add a new entry at the TOP whenever
// the model's behavior changes (weights, engines, data windows) - product-only
// changes bump the date, not the model version.

export const MODEL_VERSION = '2.5';

export const CHANGELOG = [
  {
    version: '2.5',
    date: '2026-07-13',
    type: 'model',
    title: 'Calibration fix, title odds, and scoreline grading',
    notes: [
      'WTA confidence recalibrated: the model was overstating its strongest calls (85%+ picks won just 72% of the time), so stated confidence above 75% is now compressed. Picks are unchanged; the percentages just tell the truth. ATP was already calibrated and is untouched.',
      'Championship odds: the live draw is simulated to completion 2,000 times each day, publishing every player\'s chance to win the title, with movement tracked round by round.',
      'Exact set-score accuracy is now graded and published on the track record, and each day\'s scorecard (yesterday\'s calls, upset watch) is generated automatically after the data refresh.',
    ],
  },
  {
    version: '2.4',
    date: '2026-07-12',
    type: 'ops',
    title: 'Automated slam-season refresh',
    notes: [
      'Data pipeline now runs automatically every day during grand slam windows (Australian Open, French Open, Wimbledon, US Open); manual refresh remains available off-season.',
      'Home page rebuilt on a single alignment grid; operational controls moved off the public surface.',
    ],
  },
  {
    version: '2.3',
    date: '2026-07-11',
    type: 'model',
    title: 'Simulation parity and roster hygiene',
    notes: [
      'Fixed ATP/WTA simulation parity so both tours run through identical engine code paths.',
      'Players without sufficient rated match history removed from the selectable roster instead of silently defaulting.',
      'Betting-return analysis added to the track record: every strategy staked $1 at closing odds on the same match set.',
    ],
  },
  {
    version: '2.2',
    date: '2026-07-09',
    type: 'model',
    title: 'Smart Blend and the forward test',
    notes: [
      'Smart Blend introduced: point simulation, surface Elo form rating, and world ranking mixed with weights tuned per tour and surface.',
      'Forward test launched: predictions are locked before play and graded automatically when results land - the leak-free record.',
      'Surface-specific Elo ratings recomputed on every data refresh.',
    ],
  },
  {
    version: '2.1',
    date: '2026-07-08',
    type: 'product',
    title: 'Reliability foundation',
    notes: [
      'Roster expanded across both tours.',
      'Continuous integration with unit tests on the simulator, engines, and credible-interval math.',
      'Client error tracking and monitoring enabled.',
    ],
  },
  {
    version: '2.0',
    date: '2026-07-05',
    type: 'model',
    title: 'Monte Carlo engine',
    notes: [
      'Point-by-point Monte Carlo simulation from serve/return statistics, per surface, with recency weighting.',
      'Upset engine: recent-form model with a tuned half-life for hot streaks.',
      'Public track record: every completed 2026 tour match between ranked players graded retrospectively.',
    ],
  },
];
