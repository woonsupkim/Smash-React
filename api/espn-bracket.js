// Vercel serverless proxy for ESPN bracket data.
//
// ESPN's www pages are bot-protected (return a 202 challenge page to servers),
// but their public scoreboard JSON API is open and returns the FULL draw of a
// Grand Slam (all rounds, qualifying included) for any date during the event:
//   https://site.api.espn.com/apis/site/v2/sports/tennis/{league}/scoreboard?dates=YYYYMMDD
//
// Strategy: probe a few dates inside the tournament's usual window for the
// requested season until the event appears, pick the singles grouping for the
// requested tour, find the round whose match count equals slots/2, and return
// the competitors in draw order.
//
// Query params:
//   slug   — ESPN tournament slug: "wimbledon" | "french-open" | "us-open"
//   season — 4-digit year (e.g. "2026")
//   slots  — bracket size the client wants to fill: 16 | 8 | 4 | 2 (default 16)
//   tour   — "atp" (default) | "wta"

const TOURNEYS = {
  wimbledon: {
    namePattern: /wimbledon/i,
    // MMDD probe dates — draw is published a few days before play starts
    probes: ['0701', '0706', '0629', '0627', '0710'],
  },
  'french-open': {
    namePattern: /french open|roland garros/i,
    probes: ['0528', '0601', '0525', '0605', '0523'],
  },
  'us-open': {
    namePattern: /us open/i,
    probes: ['0901', '0828', '0826', '0905', '0908'],
  },
};

async function fetchScoreboard(league, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return null;
  return res.json();
}

module.exports = async function handler(req, res) {
  const { slug, season, slots: slotsParam, tour } = req.query || {};
  if (!slug) return res.status(400).json({ error: 'Missing required query param: slug' });

  const conf = TOURNEYS[slug];
  if (!conf) return res.status(400).json({ error: `Unsupported tournament slug: ${slug}` });

  const year = season || String(new Date().getFullYear());
  const slots = Math.max(2, Number(slotsParam) || 16);
  const league = tour === 'wta' ? 'wta' : 'atp';
  const groupingName = tour === 'wta' ? /women's singles/i : /men's singles/i;

  try {
    let event = null;
    for (const mmdd of conf.probes) {
      const data = await fetchScoreboard(league, `${year}${mmdd}`);
      const ev = data?.events?.find(e => conf.namePattern.test(e.name || ''));
      if (ev && ev.groupings?.length) { event = ev; break; }
    }

    if (!event) {
      return res.status(404).json({
        error: `Couldn't find ${slug} ${year} on ESPN. The draw may not be published yet.`,
      });
    }

    const grouping = event.groupings.find(g => groupingName.test(g.grouping?.displayName || ''));
    if (!grouping || !grouping.competitions?.length) {
      return res.status(404).json({ error: 'Singles draw not found in ESPN data.' });
    }

    // Exclude qualifying; find the main-draw round with slots/2 matches
    // (e.g. slots=16 → the 8-match round of 16).
    const mainDraw = grouping.competitions.filter(c => !/qualifying/i.test(c.round?.displayName || ''));
    const targetMatches = slots / 2;
    const byRound = new Map();
    for (const c of mainDraw) {
      const key = c.round?.displayName || '?';
      if (!byRound.has(key)) byRound.set(key, []);
      byRound.get(key).push(c);
    }

    let roundComps = null;
    for (const comps of byRound.values()) {
      if (comps.length === targetMatches) { roundComps = comps; break; }
    }
    if (!roundComps) {
      return res.status(404).json({
        error: `Couldn't find a round with ${targetMatches} matches in the ESPN draw.`,
      });
    }

    // Draw order: matches by date/id, competitors by their order field.
    roundComps.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    const players = [];
    for (const comp of roundComps) {
      const comps = [...(comp.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      for (const c of comps) {
        const name = c?.athlete?.displayName || c?.athlete?.fullName || '';
        players.push(name && !/^tbd$/i.test(name.trim()) ? name.trim() : 'TBD');
      }
    }

    if (players.every(p => p === 'TBD')) {
      return res.status(404).json({
        error: 'That round has no decided players yet — the tournament hasn\'t progressed that far.',
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
