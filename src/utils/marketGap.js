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
// So the figures live here as data, and marketGap.test.js recomputes every one
// of them from public/data/track_record.json and fails if the copy no longer
// matches. A stale number is now a red build rather than a quiet lie.
//
// Recompute: npx vitest run src/utils/marketGap.test.js

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

// Published figures for the band the builder actually suggests from, measured
// on the graded record. Pinned by marketGap.test.js.
//
// Re-measured after the match-identity dedupe (#11) reached the data: the
// graded record carried the same fixture under several feed ids, so every
// figure below was counting a share of its matches more than once. The priced
// sample falls by a third and the band with it. The edge over the market
// survives the correction and is slightly larger, but on a smaller sample, so
// the honest reading is that it is less well established than it looked, not
// better.
export const BAND = {
  measuredAt: '2026-08-21',
  pricedGraded: 1570,   // graded matches carrying a market price (was 2419)
  n: 263,               // of those, how many fall in the 10-20pt band (was 385)
  hitRate: 0.56,        // how often those calls actually landed (was 0.55)
  marketImplied: 0.45,  // what the market gave them (was 0.44)
};

// Beyond the ceiling, for the record: the model's boldest disagreements.
// Also re-measured; these got materially worse, from 0.46 to 0.42, which
// strengthens rather than weakens the reason for having a ceiling at all.
export const BEYOND_CEIL = { n: 222, hitRate: 0.42, stated: 0.62 };
