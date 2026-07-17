# Season rollover (what happens every January 1)

The "season" is the current calendar year, computed dynamically everywhere
that matters. Nothing needs editing at new year, but the first weeks of
January LOOK different by design - this note is so that's expected, not
alarming.

## What rolls over automatically

- **Track record window** (`data-pipeline/buildTrackRecord.js`): matches are
  season-scoped by `SEASON_YEAR = current UTC year`. On Jan 1 the benchmark
  resets to zero and refills as matches complete (first real batch arrives
  with the Australian Open window crons, Jan 8).
- **UI copy** (`src/pages/TrackRecord.js`): the "MODEL PERFORMANCE · <year>
  SEASON" eyebrow and page intro read the current year.
- **Share kit** (`data-pipeline/buildShareAssets.js`): "the receipts ·
  <year> season", trading-card series line, and proof captions all use
  `SEASON_YEAR`.
- **Slam calendars** (Home countdown, pipeline `lib/slamCalendar.js`,
  motion-asset countdown): computed from date rules (nth Monday etc.), so
  they produce next year's dates automatically.
- **Lab tooling** (`data-pipeline/experiments.js`): the window/decay/
  calibration trials use `SEASON_START = <current year>-01-01`.

## What January looks like (expected, not broken)

- The season benchmark shows small n for a few weeks. The Track Record hero
  keeps whatever the forward test holds (the forward record does NOT reset -
  predictions.json is cumulative), so the headline stays earned.
- The rolling 24-month tuner is the reason there's no cold start: weights
  keep training on the prior season's matches via tuner_history.json.
- The engine selector (per tour x surface accuracy) starts the year thin;
  the deployed-picks annotation falls back sensibly, and the guardrail's
  'insufficient' status suppresses false alerts until cells reach 25 recent
  matches.
- Streak/moments share cards may go quiet until data accumulates.

## The one manual touch worth making

A short changelog entry ("the <year> season board is live") and a glance at
the Model Card in mid-January to confirm the engine-health board repopulated.

## Not season-scoped on purpose

- predictions.json (the forward test) - cumulative by design; the locked
  record is the product's spine and never resets.
- evalcases_* (the harness) - starts 2024, grows; EVAL_FROM in
  experiments.js can be advanced manually if the file gets heavy.
- Legal page "updated" dates - static until the text actually changes.
