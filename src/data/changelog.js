// src/data/changelog.js
//
// Versioned history of the model and the product. The MODEL_VERSION is
// surfaced on the Track Record page so every accuracy claim is traceable to
// the engine revision that produced it. Add a new entry at the TOP whenever
// the model's behavior changes (weights, engines, data windows) - product-only
// changes bump the date, not the model version.

export const MODEL_VERSION = '3.3';

export const CHANGELOG = [
  {
    version: '3.4',
    date: '2026-07-17',
    type: 'product',
    title: 'Live win probability, pick\'em, and a faster, louder Smash',
    notes: [
      'Match pages now show a LIVE win probability while a match is in progress: the point model re-priced on the actual score every 45 seconds, with the locked number alongside for the receipts. It switches itself on at the Canada Masters.',
      'Pick\'em is live: pick winners on the same locked matches the model calls, under the same no-take-backs rules, and climb a public leaderboard graded against the same record that grades us.',
      'The H2H why-panel overlays both players\' Elo form curves - when the form lines crossed is now something you can see, not just read.',
      'Faster everywhere: pages load on demand (the first-visit bundle shrank by 60%) and images went on a diet (8MB lighter).',
      'For the crawlers and the inbox: a full sitemap of every match and player page, a weekly email digest, and an auto-posting bridge for the daily share cards.',
    ],
  },
  {
    version: '3.3',
    date: '2026-07-17',
    type: 'model',
    title: 'Sharper best-of-five scorelines, and the lab runs itself',
    notes: [
      'Exact-score calls in best-of-five got a real upgrade: sets inside a match are positively correlated (favorites close out in straight sets more often than independent-set math implies), so the score distribution now sharpens the set probability with a temperature fitted walk-forward. Best-of-five exact-score accuracy improved from 24.4% to 30.4% on 672 held-out matches. Win probabilities are untouched, and best-of-three is structurally insensitive to the fix, so it stays as is.',
      'The bench engines (form-tilted Elo for ATP grass, common-opponent for WTA clay) are now revalidated automatically at every pre-slam retune: the retune pull request carries their fresh walk-forward verdicts, so promotion is a review decision, not a research project.',
      'Player pages chart every player\'s Elo form curve match by match since January 2025, with grand slam starts marked - the Form engine\'s story, visible.',
      'Under the hood: the app moved from create-react-app to Vite (builds in seconds instead of minutes), and a Playwright smoke-plus-accessibility suite now guards the five key pages in CI on every push.',
    ],
  },
  {
    version: '3.2',
    date: '2026-07-15',
    type: 'model',
    title: 'Beyond the slams: the forward test covers the big combined events',
    notes: [
      'Locked-before-play predictions now cover the six combined ATP/WTA 1000s (Indian Wells, Miami, Madrid, Rome, Canada, Cincinnati) alongside the grand slams - on the Home board, Today\'s calls, match pages, and the forward record. Draws, title odds, bracket pools, and the promo kit stay grand-slam exclusive by design.',
      'Format fix: every match is now simulated in its real format. ATP is best-of-five at slams only; Masters and the rest of the tour are best-of-three. Previously the season benchmark priced all ATP matches as best-of-five, which never changed a pick (format only amplifies confidence) but overstated confidence on non-slam matches. Weights and calibration refit on the corrected probabilities.',
      'Daily data refreshes now run during the combined-1000 weeks too, so those calls lock and grade on the same rhythm as slam calls.',
      'Called-it receipt cards in the share kit include the new events; a Cincinnati receipt is US Open proof.',
      'One deployed call per match, everywhere: every prediction on the site (Home, Today, match pages, H2H, draws, brackets, share cards) is made by the most accurate engine for that tour and surface, and every headline number (the season benchmark, the market head-to-head, calibration, player and pair records) now grades exactly those deployed calls. The five-engine comparison panels stay per-engine so you can see the selection working.',
      'The tuner now trains on a rolling 24-month window with recency decay (nine-month half-life, chosen from a sweep where any decay beat a flat window and 180-270 days formed the best plateau) instead of the current season alone: better walk-forward accuracy and log loss on both tours, and no cold start each January. The calibration layer is auto-selected per retune between none and per-tour (finer schemes trialed and rejected); under the rolling window, none wins - the weighted fit is already calibrated.',
    ],
  },
  {
    version: '3.1',
    date: '2026-07-14',
    type: 'model',
    title: 'Exact math replaces simulation noise, plus what-if scenarios',
    notes: [
      'Match probabilities are now computed exactly (closed-form point-game-set-match math) instead of estimated from 1,000 simulated draws. Same model, zero noise: the roughly 1.5% random wobble that could flip a coin-flip pick is gone, and the locked number, the live H2H number, and the title odds all agree to the digit by construction.',
      'Validated head-to-head against 200,000-draw simulations and on 5,400+ held-out matches (walk-forward): the exact version is equal or better everywhere it was measured.',
      'New what-if scenarios in the H2H studio: court speed, off day, locked in, and playing hurt presets that shift the underlying stats in principled ways, fully reversible.',
      'Also trialed: a machine-learned stacker over all signals plus form and head-to-head features. It gained half a point of accuracy on ATP and nothing on WTA, below our bar for shipping model complexity, so it stays in the lab. The honest market check: when our picks disagree with the bookmakers\' favorite, we win 38% of those on ATP and 54% on WTA.',
    ],
  },
  {
    version: '3.0',
    date: '2026-07-14',
    type: 'model',
    title: 'Honest evaluation, sharper Elo, and self-updating calibration',
    notes: [
      'Tuning objective switched from accuracy to log loss, evaluated strictly walk-forward (fit on the past, score on the future, never the reverse). Every future model change has to win that trial before it ships.',
      'Elo now weighs wins by dominance: a straight-sets win moves ratings more than a deciding-set escape. Validated on 5,400+ held-out matches across both tours.',
      'The hand-fit confidence compression is replaced by a one-parameter recalibration refit automatically at every retune, on predictions the model never trained on. Picks never flip; stated confidence self-corrects.',
      'The bookmakers\' closing odds are now a permanent benchmark in every pipeline run. After this retune the model\'s log loss is ahead of the market on both tours for the season to date.',
      'Also trialed and rejected for no measurable gain: shrinking thin serve samples toward tour averages, and rest-day/fatigue adjustments. They stay out.',
      'New model card page publishes the current weights, calibration, and this scorecard from live data.',
    ],
  },
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
