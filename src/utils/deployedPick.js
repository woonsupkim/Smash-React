// src/utils/deployedPick.js
//
// Accessors for a track-record row's DEPLOYED call: the pick made by the
// best predicting engine for that match's tour x surface (annotated by
// buildTrackRecord). Every headline stat grades these, so what the site
// claims is exactly what the site would have called. Falls back to the
// Smart Blend for rows that predate the annotation.
import CONFIG from '../engineConfig.json';

export const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
export const pickFavorite = (m) => m.pickFavorite || m.smashFavorite;
export const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);
export const pickEngine = (m) => m.pickEngine || 'smash';
export const pickFavProb = (m) => {
  const p = pickProbP1(m);
  return p >= 0.5 ? p : 1 - p;
};

// The no-call rule, applied retrospectively: a graded row whose deployed
// pick sat under engineConfig.callThreshold is a coin flip we would not
// have called, and no published claim counts it. Derived from stored
// fields on every read (never written to track rows), so the whole
// history speaks the same policy the ledger now locks under. The
// by-confidence table still grades these - restraint stays auditable.
export const pickNoCall = (m) => pickFavProb(m) < (CONFIG.callThreshold || 0);

// The same rule for a LEDGER row (predictions.json), whose stated
// probability lives in `favProb`. Derived, not read off the stored flag:
// buildPredictions writes `noCall: true` at lock time, but only onto rows
// locked after that shipped and only against the threshold in force that
// day. Every row locked before it - the entire graded history at the time
// of writing - carried no flag at all, so `!p.noCall` silently passed the
// whole ledger through and 74 of 278 graded coin flips were still being
// counted as calls. Deriving on read means one threshold governs the
// record, and moving it moves the history with it.
// The cutoff itself, for copy that needs to state it. Exported so no page
// types the number into a sentence where it can go stale.
export const CALL_THRESHOLD = CONFIG.callThreshold || 0;

export const ledgerNoCall = (p) => (
  p.noCall === true
  || (typeof p.favProb === 'number' && p.favProb < (CONFIG.callThreshold || 0))
);
