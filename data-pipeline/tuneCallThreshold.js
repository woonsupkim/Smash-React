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

// ── HINDSIGHT GUARD ────────────────────────────────────────────────────────
//
// track_record.json is RESIMULATED: its probabilities are computed with
// end-of-season stats, so they know something about how the season went. The
// question is whether that knowledge leaks into the thing this tuner reads.
//
// It does, and the test uses the BOOKMAKERS as the referee. Their vig-free
// price is a probability fixed before the match, so on any subset chosen
// without knowledge of the outcome it should be roughly calibrated. Split the
// record by our own call/no-call classification and check:
//
//   resimulated   calls +7.2pt (5.1 sigma)   no-calls -6.8pt (-3.1 sigma)
//   forward ledger calls +4.6pt (1.2 sigma)  no-calls +4.2pt (0.8 sigma)
//
// On locked pre-match probabilities the two groups are indistinguishable, and
// both show the same mild favourite-longshot bias that every price band shows.
// On the resimulated record they pull 14 points apart. A market cannot be
// wrong in two opposite directions at once, so what differs is our sorting.
//
// The mechanism is specific and it is worse than a general inflation. On the
// same 209 matches the resimulated model is only 1.5 points more accurate and
// no more confident, so the LEVEL is roughly honest. What hindsight moves is
// the ordering near the boundary: probabilities nudge toward the eventual
// winner, and matches sitting either side of a cutoff get sorted by result.
// The average barely shifts. The boundary is corrupted. And this tuner reads
// nothing BUT the boundary - its whole rule is about the marginal band - so it
// is maximally exposed to the one thing the contamination touches.
//
// Hence a guard rather than a correction: there is no honest scalar haircut
// for "the ordering at the edge is wrong". When the input fails this test the
// tuner refuses to lower any cutoff below the global default, because the bias
// makes marginal bands look better than they are and so pushes cutoffs DOWN -
// the opposite of the safe direction.
function marketSplitCheck(rows, thresholdOf) {
  const impliedFav = (m) => {
    const o1 = Number(m.od1), o2 = Number(m.od2);
    if (!(o1 > 1) || !(o2 > 1)) return null;
    const q1 = 1 / o1, q2 = 1 / o2;
    return (o1 <= o2 ? q1 : q2) / (q1 + q2);
  };
  const favWon = (m) => (m.oddCorrect != null ? !!m.oddCorrect : null);
  const usable = rows.filter((m) => impliedFav(m) != null && favWon(m) != null);
  const group = (list) => {
    if (list.length < 60) return null;
    const e = list.reduce((s, m) => s + impliedFav(m), 0) / list.length;
    const a = list.filter(favWon).length / list.length;
    const sd = Math.sqrt((e * (1 - e)) / list.length);
    return { n: list.length, implied: e, actual: a, gap: a - e, sigma: sd > 0 ? (a - e) / sd : 0 };
  };
  const calls = group(usable.filter((m) => {
    const p = favProb(m);
    return p != null && p >= thresholdOf(m);
  }));
  const passes = group(usable.filter((m) => {
    const p = favProb(m);
    return p != null && p < thresholdOf(m);
  }));
  if (!calls || !passes) return { ok: true, reason: 'too few rows to judge', calls, passes };
  // The DIFFERENCE between the groups is the signal. A uniform bias across
  // both is the market's own; a split is ours.
  const spread = calls.gap - passes.gap;
  const sd = Math.sqrt(
    (calls.implied * (1 - calls.implied)) / calls.n + (passes.implied * (1 - passes.implied)) / passes.n
  );
  const sigma = sd > 0 ? spread / sd : 0;
  return { ok: Math.abs(sigma) < 3, spread, sigma, calls, passes };
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

  // Run the guard against the cutoffs we just derived, since it is those we
  // are asking to be trusted.
  const thresholdOf = (m) => {
    const c = cells[`${m.tour}|${m.surface}`];
    return typeof c === 'number' ? c : fallback;
  };
  const check = marketSplitCheck(all, thresholdOf);
  let floored = [];
  if (!check.ok) {
    // Bias direction: contaminated marginal bands look BETTER than they are,
    // so the sweep stops too low. Never let a cutoff sit under the global
    // default on evidence that failed this test - the default was not derived
    // from the boundary and so is not exposed to the same fault.
    for (const [key, v] of Object.entries(cells)) {
      if (v < fallback) { cells[key] = fallback; floored.push(`${key} ${v}->${fallback}`); }
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

  console.log();
  if (check.calls && check.passes) {
    const f = (g) => `implied ${(100 * g.implied).toFixed(1)}% / actual ${(100 * g.actual).toFixed(1)}% (${g.gap >= 0 ? '+' : ''}${(100 * g.gap).toFixed(1)}pt, ${g.sigma.toFixed(1)}s, n=${g.n})`;
    console.log('hindsight guard, bookmakers as referee:');
    console.log(`  calls    ${f(check.calls)}`);
    console.log(`  no-calls ${f(check.passes)}`);
    console.log(`  spread   ${(100 * check.spread).toFixed(1)}pt (${check.sigma.toFixed(1)} sigma)`);
  }
  if (check.ok) {
    console.log('  VERDICT: input looks clean; cutoffs stand as derived.');
  } else {
    console.warn('  VERDICT: FAILED. The record sorts calls and no-calls into groups the market');
    console.warn('  prices differently, which it cannot do on outcome-blind data. The marginal');
    console.warn('  bands this tuner reads are the part hindsight corrupts, so cutoffs are held');
    console.warn(`  at or above the ${fallback} default${floored.length ? `: ${floored.join(', ')}` : ' (none needed lifting)'}.`);
  }

  const out = {
    _comment: 'GENERATED by data-pipeline/tuneCallThreshold.js. Do not edit; re-run the tuner.',
    measuredAt: new Date().toISOString().slice(0, 10),
    // Provenance. These are derived from the RESIMULATED record, and the
    // guard says whether that record was fit to derive them from.
    source: 'track_record.json (resimulated, end-of-season stats)',
    hindsightGuard: check.calls && check.passes ? {
      passed: check.ok,
      callsGapPt: Number((100 * check.calls.gap).toFixed(2)),
      passesGapPt: Number((100 * check.passes.gap).toFixed(2)),
      spreadSigma: Number(check.sigma.toFixed(2)),
      note: check.ok
        ? 'market prices calibrate alike on both groups; cutoffs derived directly'
        : 'market prices split across our own classification, so cutoffs are floored at the global default rather than taken as measured',
      floored,
    } : { passed: null, note: 'too few priced rows to judge' },
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
