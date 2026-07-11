// Pure parsing/normalization helpers for the ESPN schedule -> roster matching
// used by buildPredictions.js. Extracted so the logic that has broken before
// (name normalization, surface inference, Slam detection) is unit-testable
// without running the whole forward-prediction pipeline.

// Lowercase, strip accents, collapse punctuation/whitespace so ESPN's display
// names line up with our roster names regardless of diacritics or hyphenation.
function normName(s) {
  return (s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-–]/g, ' ').replace(/[^a-z\s']/g, '').replace(/\s+/g, ' ').trim();
}

// Map a raw API surface label to our three canonical surfaces.
function normSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
}

// Forward predictions are locked only for Grand Slams.
function isGrandSlam(name) {
  return /wimbledon|roland garros|french open|us open|australian open/i.test(name || '');
}

// Best-effort surface from an ESPN event name (schedule doesn't expose it
// directly). Falls back to hard, the most common surface.
function surfaceFromEventName(name) {
  const n = (name || '').toLowerCase();
  if (/wimbledon|newport|hall of fame|grass|halle|queen|s-hertogenbosch|eastbourne|mallorca|stuttgart/.test(n)) return 'grass';
  if (/roland garros|french open|madrid|rome|monte|bastad|gstaad|hamburg|kitzbuhel|umag|bucharest|clay|barcelona|estoril|munich/.test(n)) return 'clay';
  return 'hard';
}

// Resolve an ESPN display name to a roster entry: exact normalized match first,
// then a unique last-name match (avoids guessing when two players share one).
function matchRoster(espnName, roster) {
  const norm = normName(espnName);
  const hit = roster.find((p) => p.norm === norm);
  if (hit) return hit;
  const last = norm.split(' ').pop();
  const lastHits = roster.filter((p) => p.norm.split(' ').pop() === last);
  return lastHits.length === 1 ? lastHits[0] : null;
}

module.exports = { normName, normSurface, isGrandSlam, surfaceFromEventName, matchRoster };
