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
 */
const EVENTS = [
  // Grand slams (tier 'slam': full product treatment - draws, title odds,
  // pools, hype kit)
  { pattern: /australian open/i, label: 'Australian Open', surface: 'hard', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /roland garros|french open/i, label: 'French Open', surface: 'clay', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /wimbledon/i, label: 'Wimbledon', surface: 'grass', tier: 'slam', bestOf: { atp: 5, wta: 3 } },
  { pattern: /us open/i, label: 'US Open', surface: 'hard', tier: 'slam', bestOf: { atp: 5, wta: 3 } },

  // Combined ATP/WTA 1000s (tier '1000': forward test + daily content only)
  { pattern: /indian wells|bnp paribas/i, label: 'Indian Wells', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /miami open|miami/i, label: 'Miami', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /madrid open|mutua madrid|madrid/i, label: 'Madrid', surface: 'clay', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /internazionali|italian open|rome masters|rome/i, label: 'Rome', surface: 'clay', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /national bank open|canadian open|canada masters|toronto|montreal/i, label: 'Canada', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
  { pattern: /cincinnati/i, label: 'Cincinnati', surface: 'hard', tier: '1000', bestOf: { atp: 3, wta: 3 } },
];

// Registry entry for an ESPN event name, or null if we don't cover it.
function matchEvent(eventName) {
  if (!eventName) return null;
  return EVENTS.find((e) => e.pattern.test(eventName)) || null;
}

module.exports = { EVENTS, matchEvent };
