/**
 * The events the forward test covers: the four grand slams plus the six
 * combined 12-day ATP/WTA 1000s. This registry is the single source for
 * event detection, labeling, surface, format, and tier - and it doubles as
 * the allowlist (exhibitions, team events, and smaller tour stops don't
 * match anything here, so they never get locked calls).
 *
 * bestOf is per tour: slams are best-of-five for the men only; everything
 * else is best-of-three for everyone.
 *
 * Patterns match ESPN's event display names, which drift between sponsor
 * and city naming year to year - keep both forms in each pattern.
 *
 * Each pattern needs a QUALIFIER, never a bare city or sponsor word. A bare
 * /madrid/ swept in the "Grand Prix Open Villa de Madrid" (a small clay
 * event) and a bare /internazionali/ swept in the "Internazionali
 * Femminili"; a bare /bnp paribas/ would also catch the Paris indoor 1000,
 * which is not a combined event. Those strays are harmless as a label but
 * poisonous as a population: this registry now also defines which matches
 * the engine selector and the guardrails are allowed to learn from, so a
 * 250-level draw sneaking in here quietly biases what the site deploys.
 */
const EVENTS = [
  // Grand slams (tier 'slam': full product treatment - draws, title odds,
  // pools, hype kit)
  { pattern: /australian open/i, label: 'Australian Open', surface: 'hard', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /roland garros|french open/i, label: 'French Open', surface: 'clay', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /wimbledon/i, label: 'Wimbledon', surface: 'grass', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /us open/i, label: 'US Open', surface: 'hard', tier: 'slam', bestOf: { atp: 5, wta: 3 } },

  // Combined ATP/WTA 1000s (tier '1000': forward test + daily content only)
  { pattern: /indian wells|bnp paribas open/i, label: 'Indian Wells', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /miami open|miami masters/i, label: 'Miami', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /mutua madrid|madrid open|madrid masters/i, label: 'Madrid', surface: 'clay', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /internazionali bnl|italian open|rome masters/i, label: 'Rome', surface: 'clay', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /national bank open|canadian open|canada masters|rogers cup/i, label: 'Canada', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /cincinnati|western (&|and) southern/i, label: 'Cincinnati', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
];

// Registry entry for an ESPN event name, or null if we don't cover it.
function matchEvent(eventName) {
  if (!eventName) return null;
  return EVENTS.find((e) => e.pattern.test(eventName)) || null;
}

// Is this event one the site actually locks picks on? The same allowlist
// that gates the forward test gates model SELECTION and monitoring, so the
// engine deployed at the US Open is chosen on US-Open-like tennis rather
// than on the challengers and 250s that dominate the raw match archive.
const isDeployTier = (eventName) => matchEvent(eventName) != null;

module.exports = { EVENTS, matchEvent, isDeployTier };
