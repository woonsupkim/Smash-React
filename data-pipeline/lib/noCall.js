// data-pipeline/lib/noCall.js
//
// The no-call rule for the CommonJS pipeline, mirroring
// src/utils/deployedPick.js for the browser bundle. Pinned in step by
// src/noCall.test.js.
//
// THE THRESHOLD IS PER TOUR x SURFACE, and derived rather than typed. "Below
// what confidence is our lean indistinguishable from a coin flip" is a
// property of the model on a particular kind of tennis, and it is not one
// number: WTA clay needs 0.64 before its weakest calls beat a coin flip at
// 95% confidence, while ATP clay clears it at 0.54. A single global cutoff
// therefore either claims coin flips on one surface or throws away real calls
// on another - and the global one was a constant nobody had re-derived since
// the day it was guessed. src/data/callThresholds.json is written by
// data-pipeline/tuneCallThreshold.js on every retune; cells with too little
// evidence fall back to engineConfig.callThreshold.
//
// Both forms derive the answer from the stored probability rather than
// trusting a stored flag. buildPredictions does write `noCall: true` at lock
// time, but only onto rows locked after that shipped and only against the
// threshold in force that day - so every earlier row carried no flag, and a
// `!row.noCall` filter passed the entire graded history through untouched.
// Deriving on read means the current policy governs the whole record and
// re-tuning moves the history with it.
const ENGINE = require('../../src/engineConfig.json');
const TABLE = require('../../src/data/callThresholds.json');

const FALLBACK = ENGINE.callThreshold || 0;

// The cutoff in force for a row's tour and surface. Unknown or thinly
// evidenced cells use the global default; nothing is ever left without one.
const thresholdFor = (tour, surface) => {
  const cell = TABLE.cells && TABLE.cells[`${String(tour).toLowerCase()}|${String(surface).toLowerCase()}`];
  return typeof cell === 'number' ? cell : FALLBACK;
};

// track_record.json row: the deployed pick's probability, oriented to p1.
const rowNoCall = (m) => {
  const r = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1;
  if (typeof r !== 'number') return false;
  return Math.max(r, 1 - r) < thresholdFor(m.tour, m.surface);
};

// predictions.json row: the stated probability is already favourite-side.
const ledgerNoCall = (p) => (
  p.noCall === true
  || (typeof p.favProb === 'number' && p.favProb < thresholdFor(p.tour, p.surface))
);

module.exports = { FALLBACK, THRESHOLD: FALLBACK, thresholdFor, rowNoCall, ledgerNoCall, TABLE };
