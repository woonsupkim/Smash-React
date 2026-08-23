// src/utils/deployedPick.js
//
// Accessors for a track-record row's DEPLOYED call: the pick made by the
// best predicting engine for that match's tour x surface (annotated by
// buildTrackRecord). Every headline stat grades these, so what the site
// claims is exactly what the site would have called. Falls back to the
// Smart Blend for rows that predate the annotation.
import CONFIG from '../engineConfig.json';
import THRESHOLDS from '../data/callThresholds.json';

export const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
export const pickFavorite = (m) => m.pickFavorite || m.smashFavorite;
export const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);
export const pickEngine = (m) => m.pickEngine || 'smash';
export const pickFavProb = (m) => {
  const p = pickProbP1(m);
  return p >= 0.5 ? p : 1 - p;
};

// The threshold is PER TOUR x SURFACE, and derived rather than typed.
// "Below what confidence is our lean indistinguishable from a coin flip" is
// a property of the model on a particular kind of tennis, and it is not one
// number: WTA clay needs 0.64 before its weakest calls beat a coin flip at
// 95% confidence, while ATP clay clears it at 0.54. One global cutoff either
// claims coin flips on one surface or discards real calls on another - and
// the global one was a constant nobody had re-derived since it was guessed.
// The table is written by data-pipeline/tuneCallThreshold.js on every retune;
// cells with too little evidence fall back to engineConfig.callThreshold.
export const CALL_THRESHOLD = CONFIG.callThreshold || 0;

export const thresholdFor = (tour, surface) => {
  const cell = THRESHOLDS.cells
    && THRESHOLDS.cells[`${String(tour).toLowerCase()}|${String(surface).toLowerCase()}`];
  return typeof cell === 'number' ? cell : CALL_THRESHOLD;
};

// The no-call rule, applied retrospectively: a graded row whose deployed
// pick sat under its cell's threshold is a coin flip we would not have
// called, and no published claim counts it. Derived from stored fields on
// every read (never written to track rows), so the whole history speaks the
// policy currently in force and a retune moves the history with it. The
// by-confidence table still grades these - restraint stays auditable.
export const pickNoCall = (m) => pickFavProb(m) < thresholdFor(m.tour, m.surface);

// The same rule for a LEDGER row (predictions.json), whose stated
// probability lives in `favProb`. Derived, not read off the stored flag:
// buildPredictions writes `noCall: true` at lock time, but only onto rows
// locked after that shipped and only against the threshold in force that
// day. Every row locked before it - the entire graded history at the time
// of writing - carried no flag at all, so `!p.noCall` silently passed the
// whole ledger through and 74 of 278 graded coin flips were still being
// counted as calls. Deriving on read means one threshold governs the
// record, and moving it moves the history with it.
export const ledgerNoCall = (p) => (
  p.noCall === true
  || (typeof p.favProb === 'number' && p.favProb < thresholdFor(p.tour, p.surface))
);

// The whole table, for the surfaces that show what the policy currently is
// rather than just applying it.
export const CALL_THRESHOLDS = THRESHOLDS;
