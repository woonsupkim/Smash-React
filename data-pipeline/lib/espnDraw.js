// Fetching + reconstruction of a grand slam draw from ESPN's open scoreboard
// API, shared by buildTitleOdds.js (championship simulation) and
// buildShareAssets.js (bracket share cards).

const BROWSER_UA = 'Mozilla/5.0';

const SLAMS = [
  { pattern: /australian open/i, label: 'Australian Open', surface: 'hard' },
  { pattern: /roland garros|french open/i, label: 'French Open', surface: 'clay' },
  { pattern: /wimbledon/i, label: 'Wimbledon', surface: 'grass' },
  { pattern: /us open/i, label: 'US Open', surface: 'hard' },
];

async function fetchScoreboard(league, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${yyyymmdd}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// Probes recent dates for the slam that's live or just finished.
async function findSlamEvent(league, backDays = 16) {
  const today = new Date();
  for (let back = 0; back <= backDays; back++) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const data = await fetchScoreboard(league, ymd(d));
    const ev = data?.events?.find((e) => SLAMS.some((s) => s.pattern.test(e.name || '')) && e.groupings?.length);
    if (ev) return ev;
  }
  return null;
}

// Draw-ordered rounds from ESPN's grouping (feeder-chaining, same trick as
// api/espn-bracket.js): returns { fields: Map(size -> [names in draw order,
// 'TBD' for unknown]), champion: name|null } or null when no singles draw.
function extractDraw(event, tour) {
  const groupingName = tour === 'wta' ? /women's singles/i : /men's singles/i;
  const grouping = event.groupings.find((g) => groupingName.test(g.grouping?.displayName || ''));
  if (!grouping?.competitions?.length) return null;
  const mainDraw = grouping.competitions.filter((c) => !/qualifying/i.test(c.round?.displayName || ''));

  const byRound = new Map();
  for (const c of mainDraw) {
    const key = c.round?.displayName || '?';
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(c);
  }
  const sortedComps = (m) => [...(m.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const compName = (c) => (c?.athlete?.displayName || c?.athlete?.fullName || '').trim();

  const orderRound = (current, orderedNext) => {
    if (!orderedNext) return current;
    const used = new Set();
    const slots = new Array(current.length).fill(null);
    orderedNext.forEach((nm, k) => {
      if (!nm) return;
      sortedComps(nm).forEach((c, j) => {
        const name = compName(c);
        if (!name || /^tbd$/i.test(name)) return;
        const feeder = current.find((m) => !used.has(m.id) && sortedComps(m).some((x) => compName(x) === name));
        if (feeder && 2 * k + j < slots.length) { slots[2 * k + j] = feeder; used.add(feeder.id); }
      });
    });
    const rest = current.filter((m) => !used.has(m.id));
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = rest.shift();
    return slots;
  };

  const roundsBySize = [...byRound.values()].sort((a, b) => a.length - b.length);
  const fields = new Map();
  let champion = null;
  let ordered = null;
  for (const round of roundsBySize) {
    ordered = orderRound(round, ordered);
    const names = [];
    for (const m of ordered) {
      for (const c of sortedComps(m)) {
        const nm = compName(c);
        names.push(nm && !/^tbd$/i.test(nm) ? nm : 'TBD');
      }
    }
    fields.set(names.length, names);
    if (round.length === 1) {
      const w = sortedComps(round[0]).find((c) => c.winner === true || c.winner === 'true');
      if (w) champion = compName(w);
    }
  }
  return { fields, champion };
}

module.exports = { SLAMS, fetchScoreboard, findSlamEvent, extractDraw, ymd };
