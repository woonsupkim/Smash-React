// data-pipeline/lib/noCall.js
//
// The no-call rule for the CommonJS pipeline, mirroring
// src/utils/deployedPick.js for the browser bundle. Pinned in step by
// src/noCall.test.js.
//
// Both forms derive from the stated probability rather than trusting a
// stored flag. buildPredictions does write `noCall: true` at lock time,
// but only onto rows locked after that shipped and only against the
// threshold in force that day - so every earlier row carried no flag, and
// a `!row.noCall` filter passed the entire graded history through
// untouched. Deriving on read means one threshold governs the whole
// record and moving it moves the history with it.
const ENGINE = require('../../src/engineConfig.json');

const THRESHOLD = ENGINE.callThreshold || 0;

// track_record.json row: the deployed pick's probability, oriented to p1.
const rowNoCall = (m) => {
  const r = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1;
  if (typeof r !== 'number') return false;
  return Math.max(r, 1 - r) < THRESHOLD;
};

// predictions.json row: the stated probability is already favourite-side.
const ledgerNoCall = (p) => (
  p.noCall === true || (typeof p.favProb === 'number' && p.favProb < THRESHOLD)
);

module.exports = { THRESHOLD, rowNoCall, ledgerNoCall };
