// Display-side twin of cleanEventName in data-pipeline/buildTrackRecord.js
// (keep the regex identical). ESPN tournament names carry a " - City"
// suffix ("Wimbledon - London"); the pipeline strips it at build time, but
// committed data generated before that fix still carries the suffix until
// the next refresh heals it. Normalizing again at ingest means the UI is
// clean regardless of which vintage of data it loaded.
// The same tournament arrives under two different names depending on which
// feed it came from: the schedule (forward predictions) uses short names like
// "Canada", while match history (the graded ledger) uses the sponsor's
// official name like "National Bank Open". Unfixed, the Ledger's event filter
// listed both as separate events and searching for the name you saw on
// Today's board found nothing.
//
// Both sides collapse onto the SHORT name: it is what the rest of the app
// already shows, it survives sponsor changes, and it is what anyone would
// actually type.
//
// Keys are exact strings, never patterns: "Madrid" alone matches two real and
// different events (the Mutua Madrid Open 1000 and the Grand Prix Open Villa
// de Madrid), so a regex here would merge tournaments that are not the same.
//
// ONLY add a pair after seeing BOTH spellings in the committed data. Guessing
// the schedule's short name can invent a brand new split instead of fixing
// one: check the event lists in predictions.json and track_record.json first.
const ALIASES = new Map([
  ['National Bank Open', 'Canada'],
  ['Cincinnati Open', 'Cincinnati'],
]);

export function cleanEventName(name) {
  if (!name) return name;
  // Cut at the first SPACED hyphen: cities can contain unspaced hyphens
  // ("Monte-Carlo", "'s-Hertogenbosch") that a match-the-last-segment
  // regex can't reach. Also drop a leading "The ": ESPN flips between
  // "HSBC Championships" and "The HSBC Championships" across days of the
  // same event, splitting it in filters.
  const cut = String(name).replace(/\s+-\s+.*$/, '').replace(/^The\s+/i, '').trim();
  if (!cut) return name;
  return ALIASES.get(cut) || cut;
}

// Normalize the event field across a list of rows (track record matches,
// forward predictions) without touching anything else.
export function cleanEvents(rows) {
  return (rows || []).map((r) => (r.event ? { ...r, event: cleanEventName(r.event) } : r));
}
