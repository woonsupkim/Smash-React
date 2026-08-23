// data-pipeline/tuneCallThreshold.js
//
// Derives the no-call threshold PER TOUR x SURFACE from the graded record,
// and writes them to src/data/callThresholds.json.
//
// Why per cell, and why derived at all. The threshold answers one question:
// below what stated confidence is our lean indistinguishable from a coin
// flip? That is a property of the model on a particular kind of tennis, and
// it is emphatically not one number. WTA clay is the noisiest cell we have
// and ATP clay is among the steadiest, so a single global cutoff either
// claims coin flips on one surface or throws away real calls on another.
// It was also a literal constant typed into engineConfig and never revisited,
// which meant "we do not call coin flips" was a promise backed by a number
// nobody had re-derived since the day it was guessed.
//
// THE RULE. For a candidate cutoff T, look at the MARGINAL band [T, T+BAND):
// the weakest calls that cutoff would still let us make. Compute the Wilson
// 95% lower bound on that band's hit rate. T is admissible when that lower
// bound clears 50% - i.e. we can say with 95% confidence that the weakest
// calls we are about to make beat a coin flip.
//
// We take the LOWEST T from which every higher cutoff is also admissible,
// scanning down from the top. Taking the first crossing on the way UP instead
// picks noise: on this data WTA clay crosses at 0.57, falls back under at
// 0.58, and crosses again at 0.65. A cutoff that only works until you move it
// one point is not a cutoff, it is a coincidence. Requiring the property to
// hold for the whole tail above T is what makes the answer stable.
//
// GUARDS. A cell needs MIN_CELL graded rows and each band needs MIN_BAND, or
// the cell keeps the global default - a threshold fitted on forty matches is
// worse than an honest constant. Results are clamped to [CLAMP_LO, CLAMP_HI]
// so a bad season cannot switch the product off or wave everything through.
//
// HONEST CAVEAT, and it is the same one the season benchmark carries: these
// are fitted on the same graded record they are then evaluated on. They are
// re-derived on every retune, so they track the model rather than a snapshot
// of it, but the forward record is the number that owes nobody an asterisk.
//
// Usage: node data-pipeline/tuneCallThreshold.js [--write]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRACK = path.join(ROOT, 'public', 'data', 'track_record.json');
const OUT = path.join(ROOT, 'src', 'data', 'callThresholds.json');

const BAND = 0.05;        // width of the marginal band under test
const STEP = 0.01;
const SWEEP_LO = 0.50;
const SWEEP_HI = 0.70;
const MIN_BAND = 40;      // rows needed before a band's rate means anything
const MIN_CELL = 250;     // rows needed before a cell earns its own threshold
const CLAMP_LO = 0.53;
const CLAMP_HI = 0.68;

const TOURS = ['atp', 'wta'];
const SURFACES = ['hard', 'clay', 'grass'];

const favProb = (m) => {
  const r = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1;
  return typeof r === 'number' ? Math.max(r, 1 - r) : null;
};
const correct = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);

// Wilson 95% lower bound on k successes in n trials.
function wilsonLo(k, n) {
  if (!n) return 0;
  const z = 1.96, p = k / n, z2 = z * z, d = 1 + z2 / n;
  return ((p + z2 / (2 * n)) / d) - (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / d;
}

function cellThreshold(rows) {
  const steps = [];
  for (let T = SWEEP_LO; T <= SWEEP_HI + 1e-9; T += STEP) steps.push(Number(T.toFixed(2)));
  const band = (T) => rows.filter((m) => {
    const p = favProb(m);
    return p != null && p >= T && p < T + BAND;
  });
  const admissible = (T) => {
    const b = band(T);
    if (b.length < MIN_BAND) return null; // unknown, not a failure
    return wilsonLo(b.filter(correct).length, b.length) > 0.5;
  };
  // Scan DOWN. Keep stepping while the band under test still clears the coin
  // flip; stop at the first cutoff that does not. Unknown bands (too thin to
  // judge) do not break the run - they are simply not evidence either way.
  let best = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    const verdict = admissible(steps[i]);
    if (verdict === false) break;
    if (verdict === true) best = steps[i];
  }
  return best;
}

function build() {
  if (!fs.existsSync(TRACK)) {
    console.error('tuneCallThreshold: no track_record.json; refusing to write.');
    process.exit(1);
  }
  const ENGINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'engineConfig.json'), 'utf8'));
  const fallback = ENGINE.callThreshold || 0.58;
  const all = (JSON.parse(fs.readFileSync(TRACK, 'utf8')).matches || [])
    .filter((m) => favProb(m) != null && typeof correct(m) === 'boolean');

  const cells = {};
  const report = [];
  for (const tour of TOURS) {
    for (const surface of SURFACES) {
      const rows = all.filter((m) => m.tour === tour && m.surface === surface);
      const key = `${tour}|${surface}`;
      if (rows.length < MIN_CELL) {
        report.push({ key, n: rows.length, chosen: null, used: fallback, why: 'too few graded rows' });
        continue;
      }
      const raw = cellThreshold(rows);
      if (raw == null) {
        report.push({ key, n: rows.length, chosen: null, used: fallback, why: 'no cutoff clears a coin flip' });
        continue;
      }
      const used = Math.min(CLAMP_HI, Math.max(CLAMP_LO, raw));
      cells[key] = used;
      report.push({ key, n: rows.length, chosen: raw, used, why: used !== raw ? 'clamped' : '' });
    }
  }

  // What the choice costs and buys, per cell, so the table is auditable
  // rather than a list of magic numbers.
  console.log('cell        graded   T     calls  call acc   passed  lean acc');
  for (const r of report) {
    const [tour, surface] = r.key.split('|');
    const rows = all.filter((m) => m.tour === tour && m.surface === surface);
    const T = r.used;
    const calls = rows.filter((m) => favProb(m) >= T);
    const passes = rows.filter((m) => favProb(m) < T);
    const pctOf = (l) => (l.length ? `${Math.round((l.filter(correct).length / l.length) * 100)}%` : '   -');
    console.log(
      r.key.padEnd(11),
      String(r.n).padStart(5),
      T.toFixed(2).padStart(6),
      String(calls.length).padStart(6),
      pctOf(calls).padStart(9),
      String(passes.length).padStart(8),
      pctOf(passes).padStart(9),
      r.why ? `  (${r.why}${r.chosen != null && r.chosen !== T ? `, raw ${r.chosen}` : ''})` : ''
    );
  }

  const out = {
    _comment: 'GENERATED by data-pipeline/tuneCallThreshold.js. Do not edit; re-run the tuner.',
    measuredAt: new Date().toISOString().slice(0, 10),
    method: `lowest cutoff from which every marginal ${BAND}-wide band above it clears a coin flip at 95% confidence`,
    fallback,
    minCellRows: MIN_CELL,
    minBandRows: MIN_BAND,
    clamp: [CLAMP_LO, CLAMP_HI],
    cells,
  };

  if (!process.argv.includes('--write')) {
    console.log('\n(dry run: pass --write to update src/data/callThresholds.json)');
    console.log(JSON.stringify(out.cells, null, 2));
    return out;
  }
  const same = fs.existsSync(OUT) && (() => {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    return JSON.stringify({ ...prev, measuredAt: null }) === JSON.stringify({ ...out, measuredAt: null });
  })();
  if (same) {
    console.log('\ncall thresholds: unchanged');
    return out;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\ncall thresholds -> ${path.relative(ROOT, OUT)}`);
  return out;
}

if (require.main === module) build();
module.exports = { build, cellThreshold, wilsonLo };
