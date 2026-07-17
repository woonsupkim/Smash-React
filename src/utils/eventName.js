// Display-side twin of cleanEventName in data-pipeline/buildTrackRecord.js
// (keep the regex identical). ESPN tournament names carry a " - City"
// suffix ("Wimbledon - London"); the pipeline strips it at build time, but
// committed data generated before that fix still carries the suffix until
// the next refresh heals it. Normalizing again at ingest means the UI is
// clean regardless of which vintage of data it loaded.
export function cleanEventName(name) {
  if (!name) return name;
  // Cut at the first SPACED hyphen: cities can contain unspaced hyphens
  // ("Monte-Carlo", "'s-Hertogenbosch") that a match-the-last-segment
  // regex can't reach. Also drop a leading "The ": ESPN flips between
  // "HSBC Championships" and "The HSBC Championships" across days of the
  // same event, splitting it in filters.
  const cut = String(name).replace(/\s+-\s+.*$/, '').replace(/^The\s+/i, '').trim();
  return cut || name;
}

// Normalize the event field across a list of rows (track record matches,
// forward predictions) without touching anything else.
export function cleanEvents(rows) {
  return (rows || []).map((r) => (r.event ? { ...r, event: cleanEventName(r.event) } : r));
}
