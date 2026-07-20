/**
 * Sitemap + robots - public/sitemap.xml (and a Sitemap: line in robots.txt).
 *
 * Search engines can only index what they can discover, and most of this
 * site's long-tail surface (per-match pages, per-player pages) is only
 * reachable through client-side navigation. This script enumerates it all
 * explicitly from the committed data:
 *
 *   - Static routes that actually exist in src/App.js (admin and the legal
 *     fine-print pages are deliberately left out).
 *   - A player page per roster row, both tours (/player/<tour>/<id>).
 *   - A match page per forward-test prediction, pending and decided
 *     (/match/<slug1>-vs-<slug2>-<id>), using the same slugify as
 *     buildShareAssets.js so URLs match what the app links to.
 *
 * <lastmod> is set to today for the routes that change every refresh
 * (/, /today, /track-record) and omitted elsewhere - an honest signal beats
 * a fake one. robots.txt gets a Sitemap: line if it's missing one; existing
 * content is never clobbered.
 *
 * Degrades gracefully: any missing input just narrows the sitemap, and the
 * script still exits 0.
 *
 * Usage: node data-pipeline/buildSitemap.js
 * Env:   SITE_URL (optional; defaults to https://smash-react.vercel.app)
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(PUBLIC, 'data');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');

// Exact copy of the slugify in buildShareAssets.js (the ̀-ͯ range
// strips combining diacritics after NFD normalization) - keep in sync.
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const readRosterIds = (file) => {
  try {
    const parsed = Papa.parse(fs.readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true });
    return parsed.data.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
};

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function main() {
  const today = new Date().toISOString().slice(0, 10);

  // ── Static routes (mirrors src/App.js; skips /admin, redirects, and the
  // legal fine-print pages /terms /privacy /disclaimer).
  const FRESH = new Set(['/', '/today', '/track-record', '/edge', '/oddsle', '/season', '/form']); // regenerated every data refresh
  const staticRoutes = [
    '/',
    '/today',
    '/track-record',
    '/edge',
    '/oddsle',
    '/gym',
    '/compare',
    '/challenge',
    '/season',
    '/form',
    '/h2h',
    '/draw',
    '/dream-brackets',
    '/model',
    '/methodology',
    '/changelog',
    '/women',
    '/women/h2h',
    '/women/draw',
    '/women/dream-brackets',
    '/women/track-record',
    '/women/methodology',
  ];

  // Frozen season archives (public/data/seasons/<year>.json -> /season/<year>).
  try {
    for (const f of fs.readdirSync(path.join(DATA, 'seasons'))) {
      const y = f.match(/^(\d{4})\.json$/)?.[1];
      if (y) staticRoutes.push(`/season/${y}`);
    }
  } catch { /* no archives yet */ }

  const urls = staticRoutes.map((route) => ({ loc: `${SITE}${route}`, lastmod: FRESH.has(route) ? today : null }));

  // ── Player pages, both tours.
  const rosters = [
    { tour: 'atp', file: path.join(DATA, 'smash_us.csv') },
    { tour: 'wta', file: path.join(DATA, 'women', 'smash_us.csv') },
  ];
  for (const { tour, file } of rosters) {
    const ids = readRosterIds(file);
    if (!ids.length) {
      console.warn(`No roster ids found in ${path.relative(ROOT, file)}; skipping ${tour} player pages.`);
      continue;
    }
    for (const id of ids) urls.push({ loc: `${SITE}/player/${tour}/${id}`, lastmod: null });
    console.log(`Added ${ids.length} ${tour.toUpperCase()} player pages.`);
  }

  // ── Match pages: one per forward-test prediction, pending and decided.
  const predsFile = path.join(DATA, 'predictions.json');
  const preds = (readJson(predsFile) || {}).predictions || [];
  if (!preds.length) {
    console.warn('No predictions found in public/data/predictions.json; skipping match pages.');
  } else {
    const seen = new Set();
    for (const p of preds) {
      if (!p.id || !p.name1 || !p.name2) continue;
      const loc = `${SITE}/match/${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
      if (seen.has(loc)) continue;
      seen.add(loc);
      urls.push({ loc, lastmod: null });
    }
    console.log(`Added ${seen.size} match pages from ${preds.length} predictions.`);
  }

  // ── Rivalry pages: the hub plus the top pairings per tour (3+ meetings,
  // ranked by meetings and combined ranking - the SAME rule
  // src/pages/Rivalries.js uses, so the sitemap and the board agree).
  urls.push({ loc: `${SITE}/rivalries`, lastmod: today });
  const TOP_RIVALRIES = 25;
  for (const { tour, file } of rosters) {
    const h2h = readJson(path.join(DATA, tour === 'wta' ? 'women' : '', 'h2h.json')) || {};
    let roster = [];
    try {
      roster = Papa.parse(fs.readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true }).data.filter((r) => r.id && r.name);
    } catch { /* no roster, no rivalry pages */ }
    const byId = new Map(roster.map((r) => [r.id, r]));
    const pairs = [];
    for (const [key, rec] of Object.entries(h2h)) {
      const [ia, ib] = key.split('_');
      const a = byId.get(ia), b = byId.get(ib);
      if (!a || !b) continue;
      const meetings = (rec.winsA || 0) + (rec.winsB || 0);
      if (meetings < 3) continue;
      const rankSum = (Number(a.us_seed) || 200) + (Number(b.us_seed) || 200);
      pairs.push({ score: meetings * 10 - rankSum * 0.5, slug: `${slugify(a.name)}-vs-${slugify(b.name)}` });
    }
    const top = pairs.sort((x, y) => y.score - x.score).slice(0, TOP_RIVALRIES);
    for (const p of top) urls.push({ loc: `${SITE}/rivalry/${tour}/${p.slug}`, lastmod: null });
    console.log(`Added ${top.length} ${tour.toUpperCase()} rivalry pages.`);
  }

  // ── Event pages: one per tournament with a meaningful graded sample in
  // the ledger (40+ matches keeps out one-day exhibitions and thin labels).
  try {
    const track = readJson(path.join(DATA, 'track_record.json'));
    const counts = new Map();
    const cleanEvent = (n) => String(n || '').replace(/\s+-\s+.*$/, '').replace(/^The\s+/i, '').trim();
    for (const m of track?.matches || []) {
      const ev = cleanEvent(m.event);
      if (ev) counts.set(ev, (counts.get(ev) || 0) + 1);
    }
    let added = 0;
    for (const [ev, n] of counts) {
      if (n < 40) continue;
      urls.push({ loc: `${SITE}/event/${slugify(ev)}`, lastmod: null });
      added++;
    }
    console.log(`Added ${added} event pages (40+ graded matches).`);
  } catch { /* no ledger, no event pages */ }

  // ── Write sitemap.xml.
  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '';
      return `  <url><loc>${xmlEscape(u.loc)}</loc>${lastmod}</url>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  const outFile = path.join(PUBLIC, 'sitemap.xml');
  fs.writeFileSync(outFile, xml);
  console.log(`Wrote ${path.relative(ROOT, outFile)} with ${urls.length} urls.`);

  // ── robots.txt: create if absent; keep the Sitemap: line CORRECT if
  // present (a stale domain would otherwise be permanent - robots.txt is
  // committed and this used to refuse to touch an existing line). Other
  // content is never clobbered.
  const robotsFile = path.join(PUBLIC, 'robots.txt');
  const sitemapLine = `Sitemap: ${SITE}/sitemap.xml`;
  if (!fs.existsSync(robotsFile)) {
    fs.writeFileSync(robotsFile, `User-agent: *\nAllow: /\nDisallow: /admin\n\n${sitemapLine}\n`);
    console.log('Wrote public/robots.txt (did not exist).');
  } else {
    const existing = fs.readFileSync(robotsFile, 'utf8');
    if (/^\s*Sitemap:/im.test(existing)) {
      const updated = existing.replace(/^\s*Sitemap:.*$/gim, sitemapLine);
      if (updated !== existing) {
        fs.writeFileSync(robotsFile, updated);
        console.log('Corrected the Sitemap: line in public/robots.txt.');
      } else {
        console.log('public/robots.txt Sitemap: line already correct.');
      }
    } else {
      fs.writeFileSync(robotsFile, `${existing.replace(/\n*$/, '\n')}\n${sitemapLine}\n`);
      console.log('Appended Sitemap: line to existing public/robots.txt.');
    }
  }
}

main();
