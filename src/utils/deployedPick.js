// src/utils/deployedPick.js
//
// Accessors for a track-record row's DEPLOYED call: the pick made by the
// best predicting engine for that match's tour x surface (annotated by
// buildTrackRecord). Every headline stat grades these, so what the site
// claims is exactly what the site would have called. Falls back to the
// Smart Blend for rows that predate the annotation.
export const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
export const pickFavorite = (m) => m.pickFavorite || m.smashFavorite;
export const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);
export const pickEngine = (m) => m.pickEngine || 'smash';
export const pickFavProb = (m) => {
  const p = pickProbP1(m);
  return p >= 0.5 ? p : 1 - p;
};
