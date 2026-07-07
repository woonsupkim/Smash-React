// Vercel serverless proxy for ESPN bracket data.
// ESPN's internal bracket API varies by tournament and often returns HTML
// instead of JSON. Strategy:
//   1. Try the JSON API endpoint.
//   2. If the response isn't JSON, scrape the actual ESPN bracket page and
//      extract player names from the embedded __espnfitt__ page-data object.
// Returns { players: string[] } — ordered list of draw names for the client
// to fuzzy-match against our roster.
//
// Query params:
//   slug   — ESPN tournament slug  (e.g. "wimbledon", "french-open", "us-open")
//   season — 4-digit year          (e.g. "2026")

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Extract player display names from ESPN's embedded __espnfitt__ page-data
// object. ESPN embeds it in a <script> tag as:
//   window['__espnfitt__']={...huge JSON...}
// We scan the HTML by brace-counting rather than regex to handle large payloads.
function extractPlayersFromHtml(html) {
  const marker = "window['__espnfitt__']=";
  const start = html.indexOf(marker);
  if (start === -1) return [];

  let depth = 0, i = start + marker.length, jsonStart = -1;
  for (; i < html.length && i < start + marker.length + 2_000_000; i++) {
    const ch = html[i];
    if (ch === '{') {
      if (depth === 0) jsonStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  if (jsonStart === -1) return [];

  let data;
  try {
    data = JSON.parse(html.slice(jsonStart, i));
  } catch {
    return [];
  }

  // Walk the fitt object looking for bracket/draw data — ESPN's schema has
  // changed over the years so we try several known paths.
  const names = [];

  const searchBracket = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (Array.isArray(obj)) { obj.forEach(el => searchBracket(el, depth + 1)); return; }

    // ESPN bracket rounds structure
    const rounds = obj.rounds || obj.draws || obj.entries;
    if (rounds && Array.isArray(rounds)) {
      for (const round of rounds) {
        const matchups = round.matchups || round.matches || round.competitions || [];
        for (const mu of matchups) {
          const comps = mu.competitors || mu.players || mu.entries || [];
          for (const c of comps) {
            const name =
              c?.athlete?.displayName ||
              c?.player?.displayName ||
              c?.displayName ||
              c?.name || '';
            if (name && !/^(tbd|bye|qualifier|q\d+)$/i.test(name.trim())) {
              names.push(name.trim());
            }
          }
        }
      }
      if (names.length > 0) return; // found it
    }

    // Recurse into child objects
    for (const key of Object.keys(obj)) {
      if (['__proto__', 'constructor'].includes(key)) continue;
      searchBracket(obj[key], depth + 1);
    }
  };

  searchBracket(data);
  return names;
}

module.exports = async function handler(req, res) {
  const { slug, season } = req.query || {};
  if (!slug) {
    return res.status(400).json({ error: 'Missing required query param: slug' });
  }

  const year = season || String(new Date().getFullYear());
  const headers = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/html' };

  // ── Attempt 1: ESPN JSON bracket API ─────────────────────────────────────
  try {
    const apiUrl =
      `https://site.api.espn.com/apis/site/v2/sports/tennis/${encodeURIComponent(slug)}/bracket?season=${year}`;
    const apiRes = await fetch(apiUrl, { headers });
    const ct = apiRes.headers.get('content-type') || '';

    if (apiRes.ok && ct.includes('application/json')) {
      const data = await apiRes.json();
      // Pull player names from the JSON structure
      const names = [];
      const rounds = data?.bracket?.rounds || data?.rounds || [];
      for (const round of rounds) {
        const matchups = round.matchups || round.matches || [];
        for (const mu of matchups) {
          for (const c of (mu.competitors || [])) {
            const name = c?.athlete?.displayName || c?.displayName || '';
            if (name && !/^(tbd|bye)/i.test(name)) names.push(name);
          }
        }
        if (names.length >= 4) break;
      }
      if (names.length > 0) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
        return res.status(200).json({ players: names });
      }
    }
  } catch (_) { /* fall through to page scrape */ }

  // ── Attempt 2: Scrape the bracket page HTML ───────────────────────────────
  try {
    const pageUrl =
      `https://www.espn.com/tennis/${encodeURIComponent(slug)}/bracket/_/season/${year}`;
    const pageRes = await fetch(pageUrl, {
      headers: { ...headers, Accept: 'text/html' },
      redirect: 'follow',
    });
    const html = await pageRes.text();

    const players = extractPlayersFromHtml(html);
    if (players.length > 0) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ players });
    }

    // Couldn't find player data in the page — bracket may not be published yet
    return res.status(404).json({
      error:
        'Bracket data not found on ESPN. The draw may not have been published ' +
        'yet, or ESPN may have changed their page structure.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
