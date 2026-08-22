// src/utils/marketGap.js
//
// When our number sitting above the market's is worth pointing at, and the
// published record behind that claim.
//
// The Parlay builder tells the reader how often calls in this band actually
// landed, which makes it a factual claim about the ledger rather than framing.
// It had drifted badly: the page said 69% while the record said 55%, a
// 14-point overstatement that survived because the figure was typed into a
// sentence and never checked again.
//
// So the figures are DERIVED rather than written down. data-pipeline/
// buildMarketGap.js measures them from public/data/track_record.json into
// src/data/marketGap.json, `prebuild` runs it before every production build,
// and the refresh workflow runs it whenever the record changes.
//
// They were hand-maintained constants until a refresh regenerated the graded
// record with the match-identity dedupe applied. Every figure moved at once,
// and because the only guard was a test, the drift surfaced hours later on an
// unrelated pull request - while the wrong number sat on the live site. A test
// can tell you a figure is stale; deriving it at build time means it cannot be.
//
// Recompute: npm run build-market-gap

import FIGURES from '../data/marketGap.json';

// Bookmaker-implied probability for OUR pick, vig removed. Null when the row
// carries no usable price.
export function marketProbOf(row) {
  const o1 = Number(row.od1), o2 = Number(row.od2);
  if (!(o1 > 1) || !(o2 > 1)) return null;
  const q1 = 1 / o1, q2 = 1 / o2;
  const p1 = q1 / (q1 + q2);
  return row.favorite === row.p1 ? p1 : 1 - p1;
}

// How far our number must sit above the market's to be worth flagging, and
// where that stops being a good sign.
//
// We show OUR favourite on every row, so our probability naturally runs a
// little above the market's for that side - flagging "any gap at all" fires on
// about half the card and means nothing. From 10 points up it means something.
// Past 20 it inverts: those are the calls where the model is not brave, it is
// wrong. Hence a ceiling as well as a floor.
export const GAP_FLOOR = 0.10;
export const GAP_CEIL = 0.20;

/**
 * Hit rate and market-implied rate for a gap band, over graded priced rows.
 * @param {object[]} rows track_record matches
 */
export function bandStats(rows, lo = GAP_FLOOR, hi = GAP_CEIL) {
  const inBand = [];
  for (const r of rows || []) {
    const mk = marketProbOf(r);
    if (mk == null || typeof r.favProb !== 'number' || typeof r.correct !== 'boolean') continue;
    // Calls only: a coin flip under the call threshold is not a claim, so it
    // cannot be evidence for one. Mirrors deployedPick.pickNoCall on the
    // deployed pick's stated probability; pinned by noCall.test.js.
    const pp = r.pickProbP1 != null ? r.pickProbP1 : r.smashProbP1;
    if (pp != null && Math.max(pp, 1 - pp) < (FIGURES.gapCallThreshold ?? 0.6)) continue;
    const gap = r.favProb - mk;
    if (gap >= lo && gap < hi) inBand.push({ r, mk });
  }
  if (!inBand.length) return { n: 0, hitRate: null, marketImplied: null, stated: null };
  return {
    n: inBand.length,
    hitRate: inBand.filter((x) => x.r.correct).length / inBand.length,
    marketImplied: inBand.reduce((s, x) => s + x.mk, 0) / inBand.length,
    stated: inBand.reduce((s, x) => s + x.r.favProb, 0) / inBand.length,
  };
}

// Published figures for the band the builder suggests from, measured on the
// graded record. Generated - see the header.
//
// Full precision is kept in the file and rounded at the point of display, so
// the copy and the ledger can never disagree by a rounding step that was baked
// in months earlier.
export const BAND = {
  measuredAt: FIGURES.measuredAt,
  pricedGraded: FIGURES.band.pricedGraded,  // graded matches carrying a price
  n: FIGURES.band.n,                        // of those, how many in the 10-20pt band
  hitRate: FIGURES.band.hitRate,            // how often those calls actually landed
  marketImplied: FIGURES.band.marketImplied, // what the market gave them
  stated: FIGURES.band.stated,              // what we claimed for them
};

// Beyond the ceiling, for the record: the model's boldest disagreements, and
// the evidence for having a ceiling at all.
export const BEYOND_CEIL = {
  n: FIGURES.beyondCeil.n,
  hitRate: FIGURES.beyondCeil.hitRate,
  stated: FIGURES.beyondCeil.stated,
};
