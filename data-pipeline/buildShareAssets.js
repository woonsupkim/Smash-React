/**
 * Shareable social assets - public/data/share/*.png + manifest.json.
 *
 * Two layers, regenerated after every data refresh:
 *
 * DAILY (category 'daily') - built from today's data:
 *   cover.png             1080x1080  carousel opener: today's slate teaser
 *   match-N.png           1080x1080  one card per locked upcoming pick
 *   parlay.png            1080x1080  carousel closer: "$10 if every call hits"
 *   slate-story.png       1080x1920  story format: the whole slate + payout
 *   title-odds-{tour}.png 1080x1080  championship race / champion card
 *   poll.png              1080x1080  engagement bait: WHO WINS? (no % shown)
 *   results.png           1080x1080  yesterday's receipts, misses included
 *
 * PROMO (category 'promo') - evergreen brand/marketing content:
 *   proof.png             1080x1080  the season receipts vs the bookies
 *   how-it-works-N.png    1080x1080  3-slide explainer carousel (live numbers)
 *   pool-promo.png        1080x1080  Dream Brackets pool play CTA
 *   hot-streak-{tour}.png 1080x1080  hottest player on tour right now
 *   countdown.png         1080x1080  days until the next slam (between slams)
 *
 * Photo cards use the "big-league promo" treatment: a darkened stadium shot
 * as the background, player cutouts with offset sticker outlines, stacked
 * left-aligned headlines, and a CTA-style bottom bar.
 *
 * manifest.json lists every asset with format, category, and a ready caption.
 *
 * Requires sharp (installed on the fly in CI; a local file lock prevents
 * adding it to package.json). Fonts: Barlow Condensed when available (CI
 * installs fonts-barlow), else Arial Narrow / DejaVu.
 *
 * Usage: node buildShareAssets.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { nextSlam } = require('./lib/slamCalendar');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp is not installed. Run `npm install --no-save sharp` (CI does this automatically), or set NODE_PATH to a node_modules that has it.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'share');
const SQ = 1080;
const ST_W = 1080, ST_H = 1920;
const MAX_MATCH_CARDS = 8;

// ── Design tokens ──────────────────────────────────────────────────────────
const D = 'Barlow Condensed, Arial Narrow, DejaVu Sans Condensed, DejaVu Sans, sans-serif';
const U = 'DejaVu Sans, Arial, Helvetica, sans-serif';
const LIME = '#c6ff1c';
const INK = '#0c0f14';
const POS = '#4caf7d';
const NEG = '#ff5c5c';
const AMBER = '#ffb74d';

const THEMES = {
  clay:  { top: '#5b2410', bottom: '#1c0903', accent: '#ff7a52' },
  grass: { top: '#163a22', bottom: '#06140b', accent: '#3ddc84' },
  hard:  { top: '#103061', bottom: '#040c1e', accent: '#6f9dff' },
  brand: { top: '#171c28', bottom: '#07090d', accent: LIME },
};
const theme = (s) => THEMES[s] || THEMES.hard;

const STADIUMS = {
  clay: 'bracket-clay.jpg',
  grass: 'bracket-grass.jpg',
  hard: 'bracket-hard.jpg',
  brand: 'smash1.jpg',
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const last = (n) => String(n || '').trim().split(' ').pop();
const pctTxt = (p) => `${Math.round(p * 100)}%`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Every caption ends with a destination. SITE_URL (repo variable / env) makes
// links absolute; without it they stay as site-relative paths.
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const matchLink = (p) => `${SITE}/match/${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
const todayLink = () => `${SITE}/today`;

// Split a short headline into two stacked lines at the middle word.
function splitHeadline(s) {
  const words = s.split(' ');
  if (words.length < 2) return [s, null];
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

// ── Chrome for TYPOGRAPHIC cards (gradient + court + ghost + vignette) ─────
function chrome(w, h, t, { ghost = null, ghostY = null, ghostSize = null } = {}) {
  // Width-aware ghost sizing: the watermark word must live INSIDE the
  // canvas, not bleed off both edges (0.58em/char covers the condensed
  // face in CI and the wider local fallback).
  const gsRaw = ghostSize || Math.min(w * 0.62, 660);
  const gs = ghost ? Math.min(gsRaw, Math.floor((w * 0.94) / (String(ghost).length * 0.58))) : gsRaw;
  const open = `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.top}"/>
      <stop offset="1" stop-color="${t.bottom}"/>
    </linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.42" r="0.85">
      <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
    </radialGradient>
    <radialGradient id="spot" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowL" cx="0.26" cy="0.44" r="0.42">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowR" cx="0.74" cy="0.44" r="0.42">
      <stop offset="0" stop-color="${LIME}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${LIME}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <g stroke="#ffffff" stroke-opacity="0.05" stroke-width="3" fill="none">
    <rect x="${w * 0.09}" y="${h * 0.16}" width="${w * 0.82}" height="${h * 0.68}"/>
    <line x1="${w * 0.09}" y1="${h * 0.5}" x2="${w * 0.91}" y2="${h * 0.5}"/>
    <line x1="${w / 2}" y1="${h * 0.16}" x2="${w / 2}" y2="${h * 0.84}"/>
  </g>
  <rect width="${w}" height="${h}" fill="url(#spot)"/>
  ${ghost ? `<text x="${w / 2}" y="${ghostY || h * 0.58}" text-anchor="middle" font-family="${D}" font-size="${gs}" font-weight="800" fill="#ffffff" fill-opacity="0.05">${esc(ghost)}</text>` : ''}
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="10" fill="${LIME}"/>
  <polygon points="${w - 170},0 ${w},0 ${w},170" fill="${LIME}" opacity="0.14"/>
  <polygon points="${w - 90},0 ${w},0 ${w},90" fill="${LIME}"/>`;
  const close = `
  <line x1="60" y1="${h - 108}" x2="${w - 60}" y2="${h - 108}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
  <circle cx="70" cy="${h - 58}" r="9" fill="${LIME}"/>
  <text x="92" y="${h - 46}" font-family="${D}" font-size="40" font-weight="800" letter-spacing="2" fill="#ffffff">SMASH</text>
  <text x="${w - 60}" y="${h - 46}" text-anchor="end" font-family="${U}" font-size="21" fill="rgba(255,255,255,0.55)">every call public · graded daily</text>
</svg>`;
  return { open, close };
}

function eyebrow(w, y, text, color) {
  const fs2 = 27;
  const approx = text.length * (fs2 * 0.8) + 40;
  return `
  <rect x="${w / 2 - approx / 2 - 34}" y="${y - 20}" width="16" height="16" fill="${color}"/>
  <text x="${w / 2 + 12}" y="${y - 5}" text-anchor="middle" font-family="${U}" font-size="${fs2}" font-weight="700" letter-spacing="6" fill="${color}">${esc(text.toUpperCase())}</text>`;
}

function pill(cx, y, text, color, filled = false) {
  const w = text.length * 17 + 70;
  return `
  <rect x="${cx - w / 2}" y="${y}" width="${w}" height="52" rx="26" fill="${filled ? color : 'rgba(0,0,0,0.45)'}" stroke="${color}" stroke-width="3"/>
  <text x="${cx}" y="${y + 36}" text-anchor="middle" font-family="${U}" font-size="26" font-weight="800" letter-spacing="2" fill="${filled ? INK : color}">${esc(text)}</text>`;
}

// Small filled tag, left-anchored (photo-card flag style).
function tag(x, y, text, color) {
  const w = text.length * 15 + 44;
  return {
    svg: `
  <rect x="${x}" y="${y}" width="${w}" height="46" fill="${color}"/>
  <text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" font-family="${U}" font-size="23" font-weight="800" letter-spacing="2" fill="${INK}">${esc(text)}</text>`,
    w,
  };
}

function verdict(favProb, isUpset) {
  if (isUpset) return { headline: 'UPSET ALERT', sub: 'The model defies the rankings' };
  if (favProb < 0.55) return { headline: 'COIN-FLIP CLASSIC', sub: 'Flip a coin. Seriously.' };
  if (favProb < 0.60) return { headline: 'TOO CLOSE TO CALL', sub: 'Somebody leaves heartbroken' };
  if (favProb >= 0.75) return { headline: 'STATEMENT INCOMING', sub: 'The numbers are not shy about this one' };
  return { headline: 'CLEAR FAVORITE', sub: 'The stats picked a side' };
}

// ── Photos + photo-card infrastructure ─────────────────────────────────────
function photoPath(tour, id) {
  const dir = tour === 'wta' ? 'players-women' : 'players';
  const p = path.join(ROOT, 'src', 'assets', dir, `${id}.png`);
  return fs.existsSync(p) ? p : path.join(ROOT, 'src', 'assets', 'player-default.png');
}

async function circlePhoto(file, d) {
  const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);
  return sharp(file)
    .resize(d, d, { fit: 'cover', position: 'top' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// Darkened stadium shot as a full-bleed background.
async function stadiumBg(surfaceKey, w, h) {
  const f = path.join(ROOT, 'src', 'assets', STADIUMS[surfaceKey] || STADIUMS.brand);
  return sharp(f)
    .resize(w, h, { fit: 'cover' })
    .modulate({ brightness: 0.52, saturation: 0.85 })
    .blur(1.4)
    .png()
    .toBuffer();
}

// Sticker-style cutout: the silhouette gets offset colored outline layers
// behind it (the die-cut look from big-league sports promos). Falls back to
// the bare photo when the source has no real transparency.
async function stickerCutout(file, targetW, outlines = [], { dim = 1 } = {}) {
  let ph = sharp(file).resize({ width: targetW });
  if (dim !== 1) ph = ph.modulate({ brightness: dim });
  const photo = await ph.png().toBuffer();
  const meta = await sharp(photo).metadata();
  const alphaStats = await sharp(photo).ensureAlpha().extractChannel('alpha').stats();
  const isCutout = alphaStats.channels[0].mean < 250;
  const layers = [];
  if (isCutout && outlines.length) {
    const grown = await sharp(photo).ensureAlpha().extractChannel('alpha').blur(5).threshold(36).png().toBuffer();
    const bw = await sharp(grown).toColourspace('b-w').raw().toBuffer();
    for (const o of outlines) {
      const colored = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: o.color } })
        .joinChannel(bw, { raw: { width: meta.width, height: meta.height, channels: 1 } })
        .png()
        .toBuffer();
      layers.push({ buf: colored, dx: o.dx, dy: o.dy });
    }
  }
  return { photo, layers, w: meta.width, h: meta.height };
}

// Composite a sticker cutout onto a composites list at (x, y): outline layers
// first (offset), then the photo.
function placeCutout(composites, cut, x, y) {
  for (const l of cut.layers) composites.push({ input: l.buf, left: Math.round(x + l.dx), top: Math.round(y + l.dy) });
  composites.push({ input: cut.photo, left: Math.round(x), top: Math.round(y) });
}

// Rounded photo panel: works for every photo in the library (many headshots
// are rectangular crops, not silhouette cutouts, so panels are the treatment
// that never breaks). Cutout PNGs get flattened onto a dark backing.
async function panelPhoto(file, w, h, { dim = 1, radius = 24 } = {}) {
  let ph = sharp(file)
    .flatten({ background: '#11161f' })
    .resize(w, h, { fit: 'cover', position: 'top' });
  if (dim !== 1) ph = ph.modulate({ brightness: dim });
  const buf = await ph.png().toBuffer();
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function render(file, baseSvg, composites = []) {
  await sharp(Buffer.from(baseSvg)).composite(composites).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log('  wrote', file);
}

async function renderOn(file, bgBuf, composites) {
  await sharp(bgBuf).composite(composites).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log('  wrote', file);
}

// Shared scrim + brand for photo cards (transparent overlay on the stadium).
function photoScrim(w, h) {
  return `
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.92"/>
      <stop offset="0.34" stop-color="${INK}" stop-opacity="0.55"/>
      <stop offset="0.7" stop-color="${INK}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#scrim)"/>
  <rect width="${w}" height="10" fill="${LIME}"/>
  <circle cx="70" cy="66" r="10" fill="${LIME}"/>
  <text x="94" y="80" font-family="${D}" font-size="44" font-weight="800" letter-spacing="2" fill="#ffffff">SMASH</text>`;
}

// The lime CTA-style bar at the bottom of photo cards.
function bottomBar(w, text, { y = null, filled = true } = {}) {
  const by = y ?? 956;
  return `
  <rect x="40" y="${by}" width="${w - 80}" height="84" rx="42" fill="${filled ? LIME : 'rgba(0,0,0,0.55)'}" ${filled ? '' : `stroke="${LIME}" stroke-width="3"`}/>
  <text x="${w / 2}" y="${by + 56}" text-anchor="middle" font-family="${D}" font-size="44" font-weight="800" letter-spacing="1" fill="${filled ? INK : LIME}">${esc(text)}</text>`;
}

// ── DAILY: match card (photo treatment) ────────────────────────────────────
// `result` (optional): { winnerName, score } turns the prediction card into
// its receipt twin - same layout, stamped CALLED ✓, final score in the bar.
// `context` (optional): { h2h: {w1,w2}, pair: {n,correct} } adds the rivalry
// strip under the win probability.
async function matchCard(p, flags, file, result = null, context = null) {
  const favIsP1 = p.favorite === p.p1;
  const favPct = Math.round(p.favProb * 100);
  const v = result
    ? { headline: 'WE CALLED IT', sub: 'Locked before play, graded after' }
    : verdict(p.favProb, flags.upset);
  const [hl1, hl2] = splitHeadline(v.headline);

  const favName = favIsP1 ? p.name1 : p.name2;
  const dogName = favIsP1 ? p.name2 : p.name1;
  const favRank = favIsP1 ? flags.rank1 : flags.rank2;
  const dogRank = favIsP1 ? flags.rank2 : flags.rank1;

  const bg = await stadiumBg(p.surface, SQ, SQ);
  const PW = 444, PH = 456, PY = 480;
  const dogX = 64, favX = SQ - 64 - PW;
  const [dogImg, favImg] = await Promise.all([
    panelPhoto(photoPath(p.tour, favIsP1 ? p.p2 : p.p1), PW, PH, { dim: 0.72 }),
    panelPhoto(photoPath(p.tour, favIsP1 ? p.p1 : p.p2), PW, PH),
  ]);

  // flags row between headline and panels; underline when no flags
  let tagsSvg = '';
  {
    let tx = 64;
    if (flags.upset) { const g = tag(tx, 420, 'UPSET PICK', NEG); tagsSvg += g.svg; tx += g.w + 14; }
    if (flags.confidence === 'high') { const g = tag(tx, 420, 'HIGH CONFIDENCE', POS); tagsSvg += g.svg; tx += g.w + 14; }
    if (flags.confidence === 'low') { const g = tag(tx, 420, 'TOSS-UP', AMBER); tagsSvg += g.svg; tx += g.w + 14; }
    if (tx === 64) tagsSvg = `<rect x="64" y="434" width="230" height="14" fill="${LIME}"/>`;
  }

  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <rect x="${SQ - 128}" y="40" width="88" height="48" fill="${p.tour === 'wta' ? '#8b5cf6' : '#2563eb'}"/>
  <text x="${SQ - 84}" y="74" text-anchor="middle" font-family="${U}" font-size="25" font-weight="800" letter-spacing="3" fill="#ffffff">${p.tour.toUpperCase()}</text>

  <text x="64" y="172" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${p.event} · ${p.surface} · ${fmtDate(p.date)}`.toUpperCase())}</text>
  <text x="60" y="292" font-family="${D}" font-size="116" font-weight="800" fill="#ffffff">${esc(hl1)}</text>
  ${hl2 ? `<text x="60" y="398" font-family="${D}" font-size="116" font-weight="800" fill="#ffffff">${esc(hl2)}</text>` : ''}
  ${tagsSvg}

  <text x="${SQ - 64}" y="322" text-anchor="end" font-family="${D}" font-size="168" font-weight="800" fill="${LIME}">${favPct}%</text>
  <text x="${SQ - 64}" y="374" text-anchor="end" font-family="${U}" font-size="25" font-weight="700" letter-spacing="4" fill="rgba(255,255,255,0.75)">${esc(last(favName).toUpperCase())} TO WIN</text>
  ${context?.h2h && (context.h2h.w1 + context.h2h.w2) > 0 ? `
  <text x="${SQ - 64}" y="420" text-anchor="end" font-family="${U}" font-size="23" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.6)">CAREER H2H ${context.h2h.w1}-${context.h2h.w2}${context.pair?.n ? ` · WE'RE ${context.pair.correct}/${context.pair.n} ON THIS PAIR` : ''}</text>` : ''}

  <!-- offset accent frames behind the panels (sticker energy, layout-safe) -->
  <rect x="${dogX - 12}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="rgba(255,255,255,0.30)"/>
  <rect x="${favX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="${LIME}"/>
</svg>`;

  const topSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${dogX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="3"/>
  <rect x="${favX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="${LIME}" stroke-width="6"/>
  <circle cx="${SQ / 2}" cy="${PY + PH / 2}" r="46" fill="rgba(0,0,0,0.65)" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
  <text x="${SQ / 2}" y="${PY + PH / 2 + 16}" text-anchor="middle" font-family="${D}" font-size="44" font-weight="800" fill="#ffffff">VS</text>
  ${pill(dogX + PW / 2, PY + PH - 74, `${last(dogName).toUpperCase()}${dogRank ? ` · NO. ${dogRank}` : ''}`, '#ffffff')}
  ${pill(favX + PW / 2, PY + PH - 74, `${last(favName).toUpperCase()}${favRank ? ` · NO. ${favRank}` : ''}`, LIME, true)}
  ${result ? `
  <g transform="rotate(-10 540 300)">
    <rect x="310" y="236" width="460" height="118" rx="16" fill="rgba(0,0,0,0.55)" stroke="${POS}" stroke-width="9"/>
    <text x="540" y="318" text-anchor="middle" font-family="${D}" font-size="82" font-weight="800" letter-spacing="4" fill="${POS}">CALLED &#10003;</text>
  </g>` : ''}
  ${bottomBar(SQ, result
    ? `${last(result.winnerName).toUpperCase()} WON${result.score ? ` ${result.score}` : ''} · WE SAID ${favPct}%`
    : `OUR CALL: ${last(favName).toUpperCase()} WINS · ${favPct}%`, { y: 968 })}
</svg>`;

  await renderOn(file, bg, [
    { input: Buffer.from(baseSvg), left: 0, top: 0 },
    { input: dogImg, left: dogX, top: PY },
    { input: favImg, left: favX, top: PY },
    { input: Buffer.from(topSvg), left: 0, top: 0 },
  ]);
}

// ── DAILY: poll card (photo treatment, no % revealed) ──────────────────────
async function pollCard(p, file) {
  const bg = await stadiumBg(p.surface, SQ, SQ);
  const PW = 444, PH = 456, PY = 480;
  const aX = 64, bX = SQ - 64 - PW;
  const [aImg, bImg] = await Promise.all([
    panelPhoto(photoPath(p.tour, p.p1), PW, PH),
    panelPhoto(photoPath(p.tour, p.p2), PW, PH),
  ]);
  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <text x="64" y="172" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${p.event} · ${fmtDate(p.date)}`.toUpperCase())}</text>
  <text x="60" y="330" font-family="${D}" font-size="200" font-weight="800" fill="#ffffff">WHO <tspan fill="${LIME}">WINS?</tspan></text>
  <rect x="64" y="366" width="230" height="14" fill="${LIME}"/>
  <rect x="${aX - 12}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="rgba(255,255,255,0.30)"/>
  <rect x="${bX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="rgba(255,255,255,0.30)"/>
</svg>`;
  const topSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${aX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="4"/>
  <rect x="${bX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="4"/>
  <circle cx="${SQ / 2}" cy="${PY + PH / 2}" r="46" fill="rgba(0,0,0,0.65)" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
  <text x="${SQ / 2}" y="${PY + PH / 2 + 16}" text-anchor="middle" font-family="${D}" font-size="44" font-weight="800" fill="#ffffff">VS</text>
  ${pill(aX + PW / 2, PY + PH - 74, last(p.name1).toUpperCase(), '#ffffff')}
  ${pill(bX + PW / 2, PY + PH - 74, last(p.name2).toUpperCase(), '#ffffff')}
  ${bottomBar(SQ, 'VOTE IN THE COMMENTS · ANSWER TOMORROW', { filled: false, y: 968 })}
</svg>`;
  await renderOn(file, bg, [
    { input: Buffer.from(baseSvg), left: 0, top: 0 },
    { input: aImg, left: aX, top: PY },
    { input: bImg, left: bX, top: PY },
    { input: Buffer.from(topSvg), left: 0, top: 0 },
  ]);
}

// ── DAILY: cover / parlay / slate story / results (typographic) ────────────
async function coverCard(picks, sc, file) {
  const ev = picks[0]?.event || 'The Tour';
  const t = theme(picks[0]?.surface);
  const c = chrome(SQ, SQ, t, { ghost: 'CALLS', ghostY: 700 });
  const upsets = picks.filter((p) => p._flags.upset).length;
  const base = `${c.open}
  ${eyebrow(SQ, 200, `${ev} · ${fmtDate(picks[0]?.date || Date.now())}`, t.accent)}
  <text x="${SQ / 2}" y="418" text-anchor="middle" font-family="${D}" font-size="196" font-weight="800" fill="#ffffff">TODAY'S</text>
  <text x="${SQ / 2}" y="588" text-anchor="middle" font-family="${D}" font-size="196" font-weight="800" fill="${LIME}">CALLS</text>
  <text x="${SQ / 2}" y="688" text-anchor="middle" font-family="${U}" font-size="35" font-weight="600" fill="rgba(255,255,255,0.85)">${picks.length} match${picks.length > 1 ? 'es' : ''}, locked before play${upsets ? ` · ${upsets} upset pick${upsets > 1 ? 's' : ''}` : ''}</text>
  ${pill(SQ / 2, 742, sc.proofPill, LIME)}
  <text x="${SQ / 2}" y="884" text-anchor="middle" font-family="${U}" font-size="29" font-weight="700" letter-spacing="5" fill="rgba(255,255,255,0.6)">SWIPE FOR THE PICKS &#8594;</text>
${c.close}`;
  await render(file, base);
}

async function parlayCard(picks, file) {
  const t = theme(picks[0]?.surface);
  const n = Math.min(picks.length, 8);
  const startY = 320 + Math.max(0, (5 - n)) * 30;
  const c = chrome(SQ, SQ, t, { ghost: '$', ghostY: 760 });
  const pAll = picks.reduce((m, p) => m * p.favProb, 1);
  const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
  const rows = picks.slice(0, 8).map((p, i) => {
    const y = startY + i * 62;
    return `
    <text x="130" y="${y}" font-family="${U}" font-size="30" fill="rgba(255,255,255,0.88)">${esc(last(p.favName))} <tspan fill="rgba(255,255,255,0.45)">over ${esc(last(p.favorite === p.p1 ? p.name2 : p.name1))}</tspan></text>
    <text x="${SQ - 130}" y="${y}" text-anchor="end" font-family="${D}" font-size="38" font-weight="800" fill="${LIME}">${pctTxt(p.favProb)}</text>`;
  }).join('');
  const lineY = startY + 14 + n * 62;
  const base = `${c.open}
  ${eyebrow(SQ, 140, 'if every call hits', t.accent)}
  <text x="${SQ / 2}" y="252" text-anchor="middle" font-family="${D}" font-size="104" font-weight="800" fill="#ffffff">THE SLATE</text>
  ${rows}
  <line x1="130" y1="${lineY}" x2="${SQ - 130}" y2="${lineY}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <text x="${SQ / 2}" y="${lineY + 118}" text-anchor="middle" font-family="${D}" font-size="124" font-weight="800" fill="${LIME}">$10 &#8594; $${(10 * mult).toFixed(0)}</text>
  <text x="${SQ / 2}" y="${lineY + 178}" text-anchor="middle" font-family="${U}" font-size="28" fill="rgba(255,255,255,0.7)">at fair odds · all ${picks.length} hit ${pctTxt(pAll)} of the time by our math</text>
  <text x="${SQ / 2}" y="${lineY + 224}" text-anchor="middle" font-family="${U}" font-size="22" fill="rgba(255,255,255,0.45)">not betting advice - probabilities, publicly graded</text>
${c.close}`;
  await render(file, base);
}

async function slateStory(picks, sc, file) {
  const t = theme(picks[0]?.surface);
  const c = chrome(ST_W, ST_H, t, { ghost: 'SMASH', ghostY: 1210, ghostSize: 470 });
  const shown = picks.slice(0, 8);
  const rowH = shown.length <= 4 ? 220 : 150;
  const startY = shown.length <= 4 ? 560 : 460;
  const rows = shown.map((p, i) => {
    const y = startY + i * rowH;
    const favIsP1 = p.favorite === p.p1;
    const flagTxt = p._flags.upset ? 'UPSET PICK' : (p._flags.confidence === 'high' ? 'HIGH CONFIDENCE' : (p._flags.confidence === 'low' ? 'TOSS-UP' : ''));
    const flagColor = p._flags.upset ? NEG : (p._flags.confidence === 'high' ? POS : AMBER);
    return `
    <text x="90" y="${y}" font-family="${D}" font-size="54" font-weight="${favIsP1 ? 800 : 500}" fill="${favIsP1 ? '#ffffff' : 'rgba(255,255,255,0.55)'}">${esc(last(p.name1).toUpperCase())}</text>
    <text x="90" y="${y + 60}" font-family="${D}" font-size="54" font-weight="${favIsP1 ? 500 : 800}" fill="${favIsP1 ? 'rgba(255,255,255,0.55)' : '#ffffff'}">${esc(last(p.name2).toUpperCase())}</text>
    <text x="${ST_W - 90}" y="${y + 28}" text-anchor="end" font-family="${D}" font-size="80" font-weight="800" fill="${LIME}">${pctTxt(p.favProb)}</text>
    ${flagTxt ? `<text x="${ST_W - 90}" y="${y + 70}" text-anchor="end" font-family="${U}" font-size="24" font-weight="800" letter-spacing="2" fill="${flagColor}">${flagTxt}</text>` : ''}
    <line x1="90" y1="${y + 96}" x2="${ST_W - 90}" y2="${y + 96}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
  }).join('');
  const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
  const footY = (shown.length <= 4 ? 580 : 480) + shown.length * rowH;
  const base = `${c.open}
  ${eyebrow(ST_W, 160, `${picks[0]?.event || ''} · ${fmtDate(picks[0]?.date || Date.now())}`, t.accent)}
  <text x="${ST_W / 2}" y="300" text-anchor="middle" font-family="${D}" font-size="136" font-weight="800" fill="#ffffff">TODAY'S CALLS</text>
  <text x="${ST_W / 2}" y="368" text-anchor="middle" font-family="${U}" font-size="29" fill="rgba(255,255,255,0.7)">locked before play · the number is our win probability</text>
  ${rows}
  <rect x="90" y="${footY}" width="${ST_W - 180}" height="176" rx="20" fill="rgba(0,0,0,0.4)" stroke="${LIME}" stroke-width="3"/>
  <text x="${ST_W / 2}" y="${footY + 76}" text-anchor="middle" font-family="${D}" font-size="66" font-weight="800" fill="${LIME}">$10 &#8594; $${(10 * mult).toFixed(0)} if every call hits</text>
  <text x="${ST_W / 2}" y="${footY + 132}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">at fair odds · ${esc(sc.proofLine)}</text>
${c.close}`;
  await render(file, base);
}

async function resultsCard(sc, file) {
  const y = sc.yesterday;
  const t = theme('brand');
  const c = chrome(SQ, SQ, t, { ghost: 'W', ghostY: 640 });
  const lines = [];
  if (y?.beatBookies?.length) lines.push({ txt: `Beat the bookies: ${y.beatBookies.map((b) => b.call).join(' · ')}`, color: LIME });
  if (y?.boldest) lines.push({ txt: `Boldest hit: ${y.boldest.call} at ${y.boldest.prob}%`, color: '#ffffff' });
  if (y?.worstMiss) lines.push({ txt: `The one we own: ${y.worstMiss.call} lost`, color: 'rgba(255,255,255,0.55)' });
  const base = `${c.open}
  ${eyebrow(SQ, 150, `receipts · ${y?.date || ''}`, t.accent)}
  <text x="${SQ / 2}" y="400" text-anchor="middle" font-family="${D}" font-size="238" font-weight="800" fill="#ffffff">${y ? `${y.correct} OF ${y.n}` : ''}</text>
  <text x="${SQ / 2}" y="478" text-anchor="middle" font-family="${U}" font-size="33" fill="rgba(255,255,255,0.75)">winners called before play</text>
  ${lines.map((l, i) => `<text x="${SQ / 2}" y="${592 + i * 60}" text-anchor="middle" font-family="${U}" font-size="29" font-weight="600" fill="${l.color}">${esc(l.txt)}</text>`).join('')}
  ${pill(SQ / 2, 812, sc.proofPill, LIME)}
${c.close}`;
  await render(file, base);
}

// ── DAILY: title odds / champion ───────────────────────────────────────────
async function championCard(o, tour, file) {
  const bg = await stadiumBg(o.surface, SQ, SQ);
  const hist = (o.history || []).map((h) => h.odds?.[o.champion.name]).filter((v) => v != null);
  const start = (hist.length && hist[0] < 0.99) ? `${Math.round(hist[0] * 100)}% when tracking began` : 'tracked daily, graded in public';
  const composites = [];
  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <text x="64" y="192" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${o.event} ${tour}`.toUpperCase())}</text>
  <text x="60" y="340" font-family="${D}" font-size="98" font-weight="800" fill="#ffffff">YOUR</text>
  <text x="60" y="442" font-family="${D}" font-size="98" font-weight="800" fill="${LIME}">CHAMPION</text>
  <rect x="64" y="470" width="200" height="14" fill="${LIME}"/>
  <text x="64" y="550" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.75)">${esc(start)}</text>
</svg>`;
  composites.push({ input: Buffer.from(baseSvg), left: 0, top: 0 });
  const PW = 440, PH = 620, PY = 300;
  const PX = SQ - 64 - PW;
  if (o.champion.id) {
    composites.push({
      input: Buffer.from(`<svg width="${SQ}" height="${SQ}"><rect x="${PX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="${LIME}"/></svg>`),
      left: 0, top: 0,
    });
    composites.push({ input: await panelPhoto(photoPath(tour, o.champion.id), PW, PH), left: PX, top: PY });
    composites.push({
      input: Buffer.from(`<svg width="${SQ}" height="${SQ}"><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="${LIME}" stroke-width="6"/></svg>`),
      left: 0, top: 0,
    });
  }
  const topSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${bottomBar(SQ, o.champion.name.toUpperCase(), { y: 968 })}
</svg>`;
  composites.push({ input: Buffer.from(topSvg), left: 0, top: 0 });
  await renderOn(file, bg, composites);
}

async function titleOddsCard(o, tour, file) {
  if (o.status === 'final' && o.champion) {
    await championCard(o, tour, file);
    return;
  }
  const t = theme(o.surface);
  const c = chrome(SQ, SQ, t, { ghost: '2000x', ghostY: 700 });
  const prevSnap = o.history?.length > 1 ? o.history[o.history.length - 2].odds : null;
  const top = o.odds.slice(0, 5);
  const maxProb = Math.max(...top.map((p) => p.prob), 0.01);
  let rowsSvg = '';
  const comps = [];
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const y = 306 + i * 138;
    const pct = Math.round(p.prob * 100);
    const w = Math.max(14, (p.prob / maxProb) * 400);
    const prev = prevSnap?.[p.name];
    const delta = prev != null ? Math.round((p.prob - prev) * 100) : null;
    rowsSvg += `
    <text x="236" y="${y + 24}" font-family="${D}" font-size="52" font-weight="700" fill="#ffffff">${esc(p.name.toUpperCase())}</text>
    <rect x="236" y="${y + 44}" width="${w}" height="26" rx="13" fill="${LIME}" opacity="0.9"/>
    <text x="${236 + w + 20}" y="${y + 66}" font-family="${D}" font-size="52" font-weight="800" fill="#ffffff">${pct < 1 ? '&lt;1' : pct}%</text>
    ${delta ? `<text x="${SQ - 96}" y="${y + 40}" text-anchor="end" font-family="${U}" font-size="36" font-weight="800" fill="${delta > 0 ? POS : NEG}">${delta > 0 ? '&#9650;' : '&#9660;'}${Math.abs(delta)}</text>` : ''}`;
    if (p.id) {
      const ph = await circlePhoto(photoPath(tour, p.id), 104);
      comps.push({ input: ph, left: 106, top: y - 12 });
    }
  }
  const base = `${c.open}
  ${eyebrow(SQ, 126, `${o.event} ${tour.toUpperCase()} · who wins it all?`, t.accent)}
  <text x="${SQ / 2}" y="244" text-anchor="middle" font-family="${D}" font-size="108" font-weight="800" fill="#ffffff">TITLE ODDS TODAY</text>
  ${rowsSvg}
  <text x="${SQ / 2}" y="${SQ - 136}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">the remaining draw, played out 2,000 times · arrows vs yesterday</text>
${c.close}`;
  await render(file, base, comps);
}

// ── DRAW & BRACKETS: the bracket itself as content ─────────────────────────
const roundLabel = (resulting) =>
  resulting === 1 ? 'TITLE' : resulting === 2 ? 'FINAL' : resulting === 4 ? 'SF' : resulting === 8 ? 'QF' : `R${resulting}`;

// Survival board: the top 8 title contenders with their round-by-round
// chances - the draw page's survival table as a square card.
async function drawRoadCard(o, tour, file) {
  const { field, survival } = o.draw;
  const nRounds = survival[0]?.length || 0;
  if (!nRounds || field.length < 4) return false;
  const cols = Math.min(4, nRounds);
  const colStart = nRounds - cols;
  const labels = [];
  for (let r = colStart; r < nRounds; r++) labels.push(roundLabel(field.length / Math.pow(2, r + 1)));

  const rows = field.map((p, i) => ({ ...p, surv: survival[i] || [] }))
    .sort((a, b) => (b.surv[nRounds - 1] || 0) - (a.surv[nRounds - 1] || 0))
    .slice(0, 8);

  const t = theme(o.surface);
  const c = chrome(SQ, SQ, t, { ghost: 'DRAW', ghostY: 700 });
  const colX = (j) => 588 + j * 116;
  let grid = '';
  labels.forEach((l, j) => {
    grid += `<text x="${colX(j) + 48}" y="330" text-anchor="middle" font-family="${U}" font-size="22" font-weight="800" letter-spacing="2" fill="rgba(255,255,255,0.55)">${esc(l)}</text>`;
  });
  const comps = [];
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const y = 368 + i * 70;
    const lastName = (p.name || '').split(' ').pop().toUpperCase();
    grid += `<text x="176" y="${y + 38}" font-family="${D}" font-size="42" font-weight="700" fill="#ffffff">${esc(lastName)}</text>`;
    for (let j = 0; j < cols; j++) {
      const v = p.surv[colStart + j] ?? 0;
      const pct = v >= 0.995 ? '&gt;99' : v < 0.005 ? '&lt;1' : Math.round(v * 100);
      const alpha = Math.min(0.85, 0.06 + v * 0.85);
      grid += `
      <rect x="${colX(j)}" y="${y}" width="96" height="52" rx="10" fill="${LIME}" opacity="${alpha.toFixed(2)}"/>
      <text x="${colX(j) + 48}" y="${y + 36}" text-anchor="middle" font-family="${D}" font-size="30" font-weight="800" fill="${v >= 0.4 ? INK : '#ffffff'}">${pct}%</text>`;
    }
    if (p.id) comps.push({ input: await circlePhoto(photoPath(tour, p.id), 56), left: 104, top: y - 2 });
  }
  const foot = o.status === 'projection'
    ? "projected field from today's rankings · re-priced with every refresh"
    : o.status === 'live'
      ? 'the remaining draw, simulated 2,000 times daily'
      : 'our last look at the bracket before it was decided';
  const base = `${c.open}
  ${eyebrow(SQ, 126, `${o.event} ${tour.toUpperCase()} · the draw`, t.accent)}
  <text x="${SQ / 2}" y="252" text-anchor="middle" font-family="${D}" font-size="104" font-weight="800" fill="#ffffff">THE ROAD TO <tspan fill="${LIME}">THE TITLE</tspan></text>
  ${grid}
  <text x="${SQ / 2}" y="${SQ - 136}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">${esc(foot)}</text>
${c.close}`;
  await render(file, base, comps);
  return true;
}

// The favorite's path: their chance at each remaining round, photo-panel
// treatment (championCard's layout family).
async function drawPathCard(o, tour, file) {
  const { field, survival } = o.draw;
  const nRounds = survival[0]?.length || 0;
  if (!nRounds) return false;
  const ranked = field.map((p, i) => ({ p, surv: survival[i] || [] }))
    .filter((x) => x.p.id)
    .sort((a, b) => (b.surv[nRounds - 1] || 0) - (a.surv[nRounds - 1] || 0));
  const fav = ranked[0];
  if (!fav || !(fav.surv[nRounds - 1] > 0.02)) return false;

  const cols = Math.min(4, nRounds);
  const colStart = nRounds - cols;
  const lastName = fav.p.name.split(' ').pop().toUpperCase();
  const bg = await stadiumBg(o.surface, SQ, SQ);
  const composites = [];

  let steps = '';
  for (let j = 0; j < cols; j++) {
    const v = fav.surv[colStart + j] ?? 0;
    const y = 470 + j * 108;
    const label = roundLabel(field.length / Math.pow(2, colStart + j + 1));
    const w = Math.max(12, v * 300);
    steps += `
  <text x="64" y="${y}" font-family="${U}" font-size="26" font-weight="800" letter-spacing="3" fill="rgba(255,255,255,0.65)">${esc(label)}</text>
  <rect x="64" y="${y + 14}" width="${w.toFixed(0)}" height="20" rx="10" fill="${LIME}" opacity="0.9"/>
  <text x="${64 + w + 18}" y="${y + 32}" font-family="${D}" font-size="44" font-weight="800" fill="#ffffff">${v >= 0.995 ? '&gt;99' : Math.round(v * 100)}%</text>`;
  }

  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <text x="64" y="192" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${o.event} ${tour} · the favorite`.toUpperCase())}</text>
  <text x="60" y="330" font-family="${D}" font-size="96" font-weight="800" fill="#ffffff">${esc(lastName)}'S</text>
  <text x="60" y="428" font-family="${D}" font-size="96" font-weight="800" fill="${LIME}">PATH</text>
  ${steps}
</svg>`;
  composites.push({ input: Buffer.from(baseSvg), left: 0, top: 0 });
  const PW = 420, PH = 590, PY = 300;
  const PX = SQ - 64 - PW;
  composites.push({
    input: Buffer.from(`<svg width="${SQ}" height="${SQ}"><rect x="${PX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="${LIME}"/></svg>`),
    left: 0, top: 0,
  });
  composites.push({ input: await panelPhoto(photoPath(tour, fav.p.id), PW, PH), left: PX, top: PY });
  composites.push({
    input: Buffer.from(`<svg width="${SQ}" height="${SQ}"><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="${LIME}" stroke-width="6"/></svg>`),
    left: 0, top: 0,
  });
  composites.push({
    input: Buffer.from(`<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">${bottomBar(SQ, 'THE FULL DRAW, ROUND BY ROUND', { y: 968 })}</svg>`),
    left: 0, top: 0,
  });
  await renderOn(file, bg, composites);
  return true;
}

// ── PROMO cards ────────────────────────────────────────────────────────────
async function proofCard(track, file) {
  const ms = track.matches || [];
  const n = ms.length;
  const acc = n ? Math.round(ms.filter((m) => m.smashCorrect).length / n * 100) : 0;
  const odds = ms.filter((m) => m.oddCorrect != null);
  const us = odds.length ? Math.round(odds.filter((m) => m.smashCorrect).length / odds.length * 100) : null;
  const them = odds.length ? Math.round(odds.filter((m) => m.oddCorrect).length / odds.length * 100) : null;
  const dis = odds.filter((m) => m.smashFavorite !== m.oddFav);
  const disWin = dis.length ? Math.round(dis.filter((m) => m.smashCorrect).length / dis.length * 100) : null;
  const t = theme('brand');
  const c = chrome(SQ, SQ, t, { ghost: `${acc}%`, ghostY: 680 });
  const base = `${c.open}
  ${eyebrow(SQ, 130, 'the receipts · 2026 season', LIME)}
  <text x="${SQ / 2}" y="360" text-anchor="middle" font-family="${D}" font-size="250" font-weight="800" fill="${LIME}">${acc}%</text>
  <text x="${SQ / 2}" y="438" text-anchor="middle" font-family="${U}" font-size="33" fill="#ffffff">of winners called correctly · ${n.toLocaleString()} matches, all public</text>
  ${us != null ? `
  <line x1="150" y1="510" x2="${SQ - 150}" y2="510" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
  <text x="${SQ / 2 - 190}" y="620" text-anchor="middle" font-family="${D}" font-size="110" font-weight="800" fill="#ffffff">${us}%</text>
  <text x="${SQ / 2 - 190}" y="668" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">US</text>
  <text x="${SQ / 2}" y="620" text-anchor="middle" font-family="${D}" font-size="60" font-weight="700" fill="rgba(255,255,255,0.5)">vs</text>
  <text x="${SQ / 2 + 190}" y="620" text-anchor="middle" font-family="${D}" font-size="110" font-weight="800" fill="rgba(255,255,255,0.65)">${them}%</text>
  <text x="${SQ / 2 + 190}" y="668" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">THE BOOKIES</text>` : ''}
  ${disWin != null ? `<text x="${SQ / 2}" y="772" text-anchor="middle" font-family="${U}" font-size="30" font-weight="600" fill="${LIME}">When we disagree with the bookies, we're right ${disWin}% of the time.</text>` : ''}
  <text x="${SQ / 2}" y="852" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">No cherry-picking. No deletions. Misses posted too.</text>
${c.close}`;
  await render(file, base);
}

async function howItWorks(sc, file1, file2, file3) {
  const t = theme('brand');
  // Width-aware headline size: long lines shrink to stay inside the frame
  // (0.62em/char covers both Barlow Condensed in CI and the wider DejaVu
  // local fallback), short lines keep the full 128px punch.
  const fit = (s, max = 128) => Math.min(max, Math.floor((SQ - 130) / (String(s).length * 0.62)));
  const slide = (num, ghost, headline1, headline2, sub, extra = '') => {
    const c = chrome(SQ, SQ, t, { ghost, ghostY: 700 });
    return `${c.open}
  ${eyebrow(SQ, 130, `how it works · ${num} of 3`, LIME)}
  <text x="${SQ / 2}" y="380" text-anchor="middle" font-family="${D}" font-size="${fit(headline1)}" font-weight="800" fill="#ffffff">${esc(headline1)}</text>
  <text x="${SQ / 2}" y="512" text-anchor="middle" font-family="${D}" font-size="${fit(headline2)}" font-weight="800" fill="${LIME}">${esc(headline2)}</text>
  <text x="${SQ / 2}" y="618" text-anchor="middle" font-family="${U}" font-size="32" fill="rgba(255,255,255,0.8)">${esc(sub)}</text>
  ${extra}
${c.close}`;
  };
  await render(file1, slide(1, '1000x', 'WE PLAY EVERY MATCH', '1,000 TIMES', 'point by point, serve by serve - before it happens',
    `<text x="${SQ / 2}" y="700" text-anchor="middle" font-family="${U}" font-size="27" fill="rgba(255,255,255,0.55)">real serve and return stats, per surface, recency-weighted</text>`));
  await render(file2, slide(2, 'PICK', 'THEN WE CALL IT,', 'IN PUBLIC', 'win probability · exact score · upset risk',
    `<text x="${SQ / 2}" y="700" text-anchor="middle" font-family="${U}" font-size="27" fill="rgba(255,255,255,0.55)">locked before play - no edits, no take-backs</text>`));
  await render(file3, slide(3, `${sc.season.acc}%`, 'THEN THE RESULTS', 'GRADE US', sc.proofLine,
    `<text x="${SQ / 2}" y="700" text-anchor="middle" font-family="${U}" font-size="27" fill="rgba(255,255,255,0.55)">every hit and every miss on the record, updated daily</text>`));
}

async function poolPromoCard(file) {
  const t = theme('brand');
  const c = chrome(SQ, SQ, t, { ghost: 'POOL', ghostY: 690 });
  const base = `${c.open}
  ${eyebrow(SQ, 150, 'bracket pools', LIME)}
  <text x="${SQ / 2}" y="380" text-anchor="middle" font-family="${D}" font-size="170" font-weight="800" fill="#ffffff">BEAT THE</text>
  <text x="${SQ / 2}" y="530" text-anchor="middle" font-family="${D}" font-size="170" font-weight="800" fill="${LIME}">HOUSE</text>
  <text x="${SQ / 2}" y="640" text-anchor="middle" font-family="${U}" font-size="33" fill="rgba(255,255,255,0.85)">Build your bracket. Lock it before the draw plays out.</text>
  <text x="${SQ / 2}" y="692" text-anchor="middle" font-family="${U}" font-size="33" fill="rgba(255,255,255,0.85)">Our model enters every pool - beat it if you can.</text>
  ${pill(SQ / 2, 750, 'FREE · DREAM BRACKETS', LIME)}
${c.close}`;
  await render(file, base);
}

async function hotStreakCard(tour, file) {
  const dir = tour === 'wta' ? path.join(DATA, 'women') : DATA;
  const p = path.join(dir, 'smash_us.csv');
  if (!fs.existsSync(p)) return false;
  const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data
    .filter((r) => r.id && Number(r.us_rd) === 2)
    .map((r) => ({ id: r.id, name: r.name, w: Number(r.recent_w) || 0, l: Number(r.recent_l) || 0, rank: Number(r.us_seed) || null }))
    .filter((r) => r.w + r.l >= 6)
    .sort((a, b) => (b.w / (b.w + b.l)) - (a.w / (a.w + a.l)) || b.w - a.w);
  const hot = rows[0];
  if (!hot) return false;

  const bg = await stadiumBg('brand', SQ, SQ);
  const PW = 440, PH = 620, PY = 290;
  const PX = SQ - 64 - PW;
  const img = await panelPhoto(photoPath(tour, hot.id), PW, PH);
  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <rect x="${SQ - 128}" y="40" width="88" height="48" fill="${tour === 'wta' ? '#8b5cf6' : '#2563eb'}"/>
  <text x="${SQ - 84}" y="74" text-anchor="middle" font-family="${U}" font-size="25" font-weight="800" letter-spacing="3" fill="#ffffff">${tour.toUpperCase()}</text>
  <text x="64" y="192" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">HOTTEST RACKET RIGHT NOW</text>
  <text x="60" y="368" font-family="${D}" font-size="180" font-weight="800" fill="#ffffff">ON</text>
  <text x="60" y="528" font-family="${D}" font-size="180" font-weight="800" fill="${LIME}">FIRE</text>
  <rect x="64" y="556" width="230" height="14" fill="${LIME}"/>
  <text x="64" y="680" font-family="${D}" font-size="96" font-weight="800" fill="#ffffff">${hot.w}-${hot.l}</text>
  <text x="64" y="730" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.7)">in recent matches${hot.rank ? ` · World No. ${hot.rank}` : ''}</text>
  <rect x="${PX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="${LIME}"/>
</svg>`;
  const topSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="${LIME}" stroke-width="6"/>
  ${bottomBar(SQ, hot.name.toUpperCase(), { y: 968 })}
</svg>`;
  await renderOn(file, bg, [
    { input: Buffer.from(baseSvg), left: 0, top: 0 },
    { input: img, left: PX, top: PY },
    { input: Buffer.from(topSvg), left: 0, top: 0 },
  ]);
  return { id: hot.id, name: hot.name, w: hot.w, l: hot.l };
}

// Did the model call the exact set score? (predScore is favorite-perspective)
function scorelineHit(m) {
  if (!m.predScore || !m.score) return null;
  const sets = m.score.trim().split(/\s+/).map((s) => s.match(/^(\d+)-(\d+)/)).filter(Boolean);
  if (!sets.length) return null;
  const w = sets.filter((x) => +x[1] > +x[2]).length;
  const l = sets.length - w;
  const favWon = m.smashFavorite === m.winner;
  const actualFav = favWon ? `${w}–${l}` : `${l}–${w}`;
  return m.predScore === actualFav;
}

// A period report card (tournament wrap / weekly recap share the layout).
async function reportCard({ eyebrowText, headline1, headline2, stats, footNote, themeKey, file }) {
  const t = theme(themeKey);
  const c = chrome(SQ, SQ, t, { ghost: stats[0]?.value || '', ghostY: 700 });
  const rows = stats.map((s, i) => {
    const y = 470 + i * 118;
    return `
  <text x="120" y="${y}" font-family="${D}" font-size="76" font-weight="800" fill="${i === 0 ? LIME : '#ffffff'}">${esc(s.value)}</text>
  <text x="${SQ - 120}" y="${y - 8}" text-anchor="end" font-family="${U}" font-size="27" font-weight="600" fill="rgba(255,255,255,0.75)">${esc(s.label)}</text>
  <line x1="120" y1="${y + 26}" x2="${SQ - 120}" y2="${y + 26}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
  }).join('');
  const base = `${c.open}
  ${eyebrow(SQ, 140, eyebrowText, t.accent)}
  <text x="${SQ / 2}" y="272" text-anchor="middle" font-family="${D}" font-size="104" font-weight="800" fill="#ffffff">${esc(headline1)}</text>
  ${headline2 ? `<text x="${SQ / 2}" y="376" text-anchor="middle" font-family="${D}" font-size="104" font-weight="800" fill="${LIME}">${esc(headline2)}</text>` : ''}
  ${rows}
  ${footNote ? `<text x="${SQ / 2}" y="${SQ - 130}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">${esc(footNote)}</text>` : ''}
${c.close}`;
  await render(file, base);
}

// Rivalry card: an upcoming pick where the pair has real history.
async function rivalryCard(p, h2hRec, ourRecord, file) {
  const bg = await stadiumBg(p.surface, SQ, SQ);
  const PW = 444, PH = 420, PY = 430;
  const aX = 64, bX = SQ - 64 - PW;
  const [aImg, bImg] = await Promise.all([
    panelPhoto(photoPath(p.tour, p.p1), PW, PH),
    panelPhoto(photoPath(p.tour, p.p2), PW, PH),
  ]);
  const meetings = h2hRec.w1 + h2hRec.w2;
  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <text x="64" y="172" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${p.event} · ${fmtDate(p.date)}`.toUpperCase())}</text>
  <text x="60" y="300" font-family="${D}" font-size="128" font-weight="800" fill="#ffffff">THE RIVALRY,</text>
  <text x="60" y="410" font-family="${D}" font-size="128" font-weight="800" fill="${LIME}">ROUND ${meetings + 1}</text>
  <rect x="${aX - 12}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="rgba(255,255,255,0.30)"/>
  <rect x="${bX + 14}" y="${PY + 12}" width="${PW}" height="${PH}" rx="24" fill="rgba(255,255,255,0.30)"/>
</svg>`;
  const topSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${aX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="4"/>
  <rect x="${bX}" y="${PY}" width="${PW}" height="${PH}" rx="24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="4"/>
  <circle cx="${SQ / 2}" cy="${PY + PH / 2}" r="58" fill="rgba(0,0,0,0.7)" stroke="${LIME}" stroke-width="4"/>
  <text x="${SQ / 2}" y="${PY + PH / 2 + 20}" text-anchor="middle" font-family="${D}" font-size="52" font-weight="800" fill="#ffffff">${h2hRec.w1}-${h2hRec.w2}</text>
  ${pill(aX + PW / 2, PY + PH - 74, last(p.name1).toUpperCase(), '#ffffff')}
  ${pill(bX + PW / 2, PY + PH - 74, last(p.name2).toUpperCase(), '#ffffff')}
  ${bottomBar(SQ, ourRecord && ourRecord.n > 0
    ? `WE'VE CALLED ${ourRecord.correct} OF ${ourRecord.n} OF THEIR MEETINGS`
    : `OUR CALL: ${last(p.favName).toUpperCase()} · ${pctTxt(p.favProb)}`, { y: 968 })}
</svg>`;
  await renderOn(file, bg, [
    { input: Buffer.from(baseSvg), left: 0, top: 0 },
    { input: aImg, left: aX, top: PY },
    { input: bImg, left: bX, top: PY },
    { input: Buffer.from(topSvg), left: 0, top: 0 },
  ]);
}

// ── HYPE: the next grand slam, promoted ─────────────────────────────────────
// Photo countdown hero: the slam's own stadium, the day count, and the
// promise ("picks live the moment the draw drops").
async function hypeCountdownCard(next, days, file) {
  const bg = await stadiumBg(next.surface, SQ, SQ);
  const nameFs = Math.min(150, Math.floor(950 / (next.label.length * 0.58)));
  const dateTxt = new Date(next.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const baseSvg = `
<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg">
  ${photoScrim(SQ, SQ)}
  <text x="${SQ / 2}" y="220" text-anchor="middle" font-family="${U}" font-size="28" font-weight="700" letter-spacing="7" fill="${LIME}">THE NEXT MAJOR</text>
  <text x="${SQ / 2}" y="${228 + nameFs}" text-anchor="middle" font-family="${D}" font-size="${nameFs}" font-weight="800" fill="#ffffff">${esc(next.label.toUpperCase())}</text>
  <text x="${SQ / 2}" y="700" text-anchor="middle" font-family="${D}" font-size="320" font-weight="800" fill="${LIME}">${days}</text>
  <text x="${SQ / 2}" y="778" text-anchor="middle" font-family="${U}" font-size="34" font-weight="700" letter-spacing="8" fill="rgba(255,255,255,0.85)">DAYS TO GO</text>
  <text x="${SQ / 2}" y="846" text-anchor="middle" font-family="${U}" font-size="27" fill="rgba(255,255,255,0.65)">${esc(`first ball ${dateTxt} · ${next.surface} court`)}</text>
  ${bottomBar(SQ, 'PICKS LIVE THE MOMENT THE DRAW DROPS', { y: 956 })}
</svg>`;
  await renderOn(file, bg, [{ input: Buffer.from(baseSvg), left: 0, top: 0 }]);
}

// Projected favorites for the next slam - only when the off-season
// projection is live in title_odds.json (it replaces the last slam's final
// state once ESPN's event ages out).
async function hypeFavoritesCard(o, tour, file) {
  const top = (o.odds || []).filter((p) => p.prob > 0).slice(0, 5);
  if (top.length < 5) return false;
  const t = theme(o.surface);
  const c = chrome(SQ, SQ, t, { ghost: 'NEXT', ghostY: 700 });
  const maxProb = Math.max(...top.map((p) => p.prob), 0.01);
  let rowsSvg = '';
  const comps = [];
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const y = 320 + i * 132;
    const pct = Math.round(p.prob * 100);
    const w = Math.max(14, (p.prob / maxProb) * 380);
    rowsSvg += `
    <text x="236" y="${y + 24}" font-family="${D}" font-size="50" font-weight="700" fill="#ffffff">${esc(p.name.toUpperCase())}</text>
    <rect x="236" y="${y + 42}" width="${w.toFixed(0)}" height="24" rx="12" fill="${LIME}" opacity="0.9"/>
    <text x="${(236 + w + 20).toFixed(0)}" y="${y + 62}" font-family="${D}" font-size="50" font-weight="800" fill="#ffffff">${pct < 1 ? '&lt;1' : pct}%</text>`;
    if (p.id) comps.push({ input: await circlePhoto(photoPath(tour, p.id), 100), left: 110, top: y - 10 });
  }
  const base = `${c.open}
  ${eyebrow(SQ, 126, `${o.event} ${tour.toUpperCase()} · projected field`, t.accent)}
  <text x="${SQ / 2}" y="248" text-anchor="middle" font-family="${D}" font-size="104" font-weight="800" fill="#ffffff">THE <tspan fill="${LIME}">FAVORITES</tspan></text>
  ${rowsSvg}
  <text x="${SQ / 2}" y="${SQ - 136}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">from today's rankings, simulated 2,000 times · re-priced weekly until the draw drops</text>
${c.close}`;
  await render(file, base, comps);
  return true;
}

// Story-format countdown: day count + the model's record on the slam's
// surface + the promise, sized for an Instagram story.
async function hypeStoryCard(next, days, recs, file) {
  const t = theme(next.surface);
  const c = chrome(ST_W, ST_H, t, { ghost: String(days), ghostY: 1210, ghostSize: 700 });
  const nameFs = Math.min(136, Math.floor(950 / (next.label.length * 0.58)));
  const recRows = recs.map((r, i) => `
  <text x="${ST_W / 2}" y="${1246 + i * 62}" text-anchor="middle" font-family="${U}" font-size="30" fill="rgba(255,255,255,0.8)">${esc(`${r.tour.toUpperCase()} on ${next.surface} this season: ${r.acc}% of winners called`)}</text>`).join('');
  const base = `${c.open}
  ${eyebrow(ST_W, 210, 'the next major', t.accent)}
  <text x="${ST_W / 2}" y="${218 + nameFs}" text-anchor="middle" font-family="${D}" font-size="${nameFs}" font-weight="800" fill="#ffffff">${esc(next.label.toUpperCase())}</text>
  <text x="${ST_W / 2}" y="820" text-anchor="middle" font-family="${D}" font-size="380" font-weight="800" fill="${LIME}">${days}</text>
  <text x="${ST_W / 2}" y="920" text-anchor="middle" font-family="${U}" font-size="38" font-weight="700" letter-spacing="10" fill="rgba(255,255,255,0.85)">DAYS TO GO</text>
  ${recRows}
  ${recs.length ? `<text x="${ST_W / 2}" y="${1246 + recs.length * 62 + 8}" text-anchor="middle" font-family="${U}" font-size="23" fill="rgba(255,255,255,0.45)">season benchmark, re-simulated daily</text>` : ''}
  ${pill(ST_W / 2, 1560, 'THE DRAW, PRICED FROM DAY ONE', LIME)}
  <text x="${ST_W / 2}" y="1690" text-anchor="middle" font-family="${U}" font-size="28" fill="rgba(255,255,255,0.7)">every pick locked before play · graded in public</text>
${c.close}`;
  await render(file, base);
}

// ── Main ───────────────────────────────────────────────────────────────────
function loadRanks(tour) {
  const dir = tour === 'wta' ? path.join(DATA, 'women') : DATA;
  const p = path.join(dir, 'smash_us.csv');
  if (!fs.existsSync(p)) return new Map();
  const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
  return new Map(rows.map((r) => [r.id, Number(r.us_seed) || null]));
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const sc = JSON.parse(fs.readFileSync(path.join(DATA, 'daily_scorecard.json'), 'utf8'));
  const track = JSON.parse(fs.readFileSync(path.join(DATA, 'track_record.json'), 'utf8'));
  const preds = fs.existsSync(path.join(DATA, 'predictions.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'predictions.json'), 'utf8'))
    : { predictions: [] };
  const titleOdds = fs.existsSync(path.join(DATA, 'title_odds.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'title_odds.json'), 'utf8'))
    : { events: {} };
  const ranks = { atp: loadRanks('atp'), wta: loadRanks('wta') };

  // Honest proof framing, mirroring the app's forward-test hero: once the
  // locked-before-play record has 25+ verified calls it IS the proof line;
  // until then the season number appears, labeled as the resimulated
  // benchmark it is. Cards and captions read these off sc.
  const fwdDecided = (preds.predictions || []).filter((p) => p.status !== 'pending');
  const fwd = { n: fwdDecided.length, correct: fwdDecided.filter((p) => p.correct).length };
  fwd.acc = fwd.n ? Math.round((fwd.correct / fwd.n) * 100) : 0;
  const fwdArmed = fwd.n >= 25;
  sc.proofPill = fwdArmed
    ? `BEFORE PLAY: ${fwd.correct}/${fwd.n} CALLED · ${fwd.acc}%`
    : `SEASON BENCHMARK: ${sc.season.acc}% OF WINNERS`;
  sc.proofLine = fwdArmed
    ? `${fwd.acc}% of winners called before play (${fwd.correct} of ${fwd.n} verified, no take-backs)`
    : `season benchmark: ${sc.season.acc}% of winners called across ${sc.season.n.toLocaleString()} matches, re-simulated daily`;
  sc.proofLabel = fwdArmed ? 'called before play, verified' : 'season benchmark · re-simulated daily';

  const assets = [];
  const add = (file, type, format, category, caption) => assets.push({ file, type, format, category, caption });
  const tags = '#tennis #atp #wta #tennisprediction';

  const decorate = (p) => {
    const favId = p.favorite;
    const oppId = favId === p.p1 ? p.p2 : p.p1;
    const favRank = ranks[p.tour]?.get(favId);
    const oppRank = ranks[p.tour]?.get(oppId);
    return {
      ...p,
      _flags: {
        upset: !!(favRank && oppRank && favRank > oppRank),
        confidence: p.favProb >= 0.70 ? 'high' : (p.favProb < 0.60 ? 'low' : null),
        rank1: ranks[p.tour]?.get(p.p1),
        rank2: ranks[p.tour]?.get(p.p2),
      },
    };
  };

  const picks = (preds.predictions || [])
    .filter((p) => p.status === 'pending')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, MAX_MATCH_CARDS)
    .map(decorate);

  // ── DAILY layer ─────────────────────────────────────────────────────────
  if (picks.length) {
    await coverCard(picks, sc, 'cover.png');
    add('cover.png', 'carousel-cover', 'square', 'daily', `Today's calls at the ${picks[0].event}: ${picks.length} matches, locked before play. Swipe for every pick. ${sc.proofLine[0].toUpperCase()}${sc.proofLine.slice(1)}. All of today: ${todayLink()} ${tags}`);

    // Career h2h + our pair record enrich every match card.
    const h2hAll = fs.existsSync(path.join(DATA, 'h2h.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'h2h.json'), 'utf8')) : {};
    const track2 = track.matches || [];
    const contextFor = (p) => {
      const key = [p.p1, p.p2].sort().join('_');
      const rec = h2hAll[key];
      const firstIsP1 = [p.p1, p.p2].sort()[0] === p.p1;
      const h2h = rec ? { w1: firstIsP1 ? rec.winsA : rec.winsB, w2: firstIsP1 ? rec.winsB : rec.winsA } : null;
      const pairMs = track2.filter((m) => (m.p1 === p.p1 && m.p2 === p.p2) || (m.p1 === p.p2 && m.p2 === p.p1));
      return { h2h, pair: { n: pairMs.length, correct: pairMs.filter((m) => m.smashCorrect).length } };
    };

    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const file = `match-${i + 1}.png`;
      await matchCard(p, p._flags, file, null, contextFor(p));
      const flagBit = p._flags.upset ? ' UPSET PICK:' : (p._flags.confidence === 'high' ? ' High confidence:' : '');
      add(file, 'match', 'square', 'daily', `${flagBit} ${p.favName} over ${p.favorite === p.p1 ? p.name2 : p.name1} at ${pctTxt(p.favProb)}, ${p.event} (${p.surface}). Full breakdown: ${matchLink(p)} ${tags}`);
    }

    // Rivalry angle: the pick whose pair has the most career history (3+ meetings).
    const withHistory = picks
      .map((p) => {
        const ctx = contextFor(p);
        if (!ctx.h2h) return null;
        return { p, h: ctx.h2h, pair: ctx.pair, meetings: ctx.h2h.w1 + ctx.h2h.w2 };
      })
      .filter((x) => x && x.meetings >= 3)
      .sort((a, b) => b.meetings - a.meetings)[0];
    if (withHistory) {
      const { p, h, pair } = withHistory;
      await rivalryCard(p, h, pair, 'rivalry.png');
      add('rivalry.png', 'rivalry', 'square', 'daily', `${last(p.name1)} vs ${last(p.name2)}, meeting number ${withHistory.meetings + 1}. Career: ${h.w1}-${h.w2}.${pair.n ? ` We've called ${pair.correct} of ${pair.n} of their matches right.` : ''} ${matchLink(p)} ${tags}`);
    }

    if (picks.length >= 2) {
      await parlayCard(picks, 'parlay.png');
      const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
      add('parlay.png', 'carousel-closer', 'square', 'daily', `If every call today hits, $10 at fair odds returns $${(10 * mult).toFixed(0)}. Every pick public, every result graded. Not betting advice. ${tags}`);
    }

    await slateStory(picks, sc, 'slate-story.png');
    add('slate-story.png', 'slate', 'story', 'daily', `The full slate for ${fmtDate(picks[0].date)}: every call with win probability and flags. All of today: ${todayLink()} ${tags}`);

    const pollPick = [...picks].sort((a, b) => a.favProb - b.favProb)[0];
    await pollCard(pollPick, 'poll.png');
    add('poll.png', 'poll', 'square', 'daily', `${last(pollPick.name1)} or ${last(pollPick.name2)} at the ${pollPick.event}? Our model already picked a side - drop yours below, answer tomorrow. ${matchLink(pollPick)} ${tags}`);
  }

  // ── Receipts: prediction cards reborn as CALLED ✓ twins ─────────────────
  const calledIt = (preds.predictions || [])
    .filter((p) => p.status !== 'pending' && p.correct && p.winner
      && (Date.now() - new Date(p.date).getTime()) < 3 * 864e5)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3)
    .map(decorate);
  for (let i = 0; i < calledIt.length; i++) {
    const p = calledIt[i];
    const file = `called-${i + 1}.png`;
    const winnerName = p.winner === p.p1 ? p.name1 : p.name2;
    await matchCard(p, p._flags, file, { winnerName, score: p.score });
    add(file, 'called-it', 'square', 'daily', `We called it: ${p.favName} over ${p.favorite === p.p1 ? p.name2 : p.name1} at ${pctTxt(p.favProb)}, locked before play. Final: ${winnerName} won${p.score ? ` ${p.score}` : ''}. Receipts: ${matchLink(p)} ${tags}`);
  }

  for (const tour of ['atp', 'wta']) {
    const o = titleOdds.events?.[tour];
    if (!o) continue;
    const file = `title-odds-${tour}.png`;
    await titleOddsCard(o, tour, file);
    if (o.status === 'final' && o.champion) {
      add(file, 'champion', 'square', 'daily', `${o.champion.name} wins the ${o.event}. We tracked the title odds every day of the tournament, in public. ${tags}`);
    } else {
      const topTxt = o.odds.slice(0, 3).map((p) => `${last(p.name)} ${pctTxt(p.prob)}`).join(', ');
      add(file, 'title-odds', 'square', 'daily', `${o.event} ${tour.toUpperCase()} title odds today: ${topTxt}. The whole draw, simulated 2,000 times, updated daily. ${tags}`);
    }
  }

  if (sc.yesterday?.n > 0) {
    await resultsCard(sc, 'results.png');
    add('results.png', 'results', 'square', 'daily', `Receipts from ${sc.yesterday.date}: called ${sc.yesterday.correct} of ${sc.yesterday.n} winners before play. Season benchmark: ${sc.season.acc}%. Wins and misses, all public. ${tags}`);
  }

  // ── WRAP: tournament report card (a few days after a slam ends) ─────────
  for (const tour of ['atp', 'wta']) {
    const o = titleOdds.events?.[tour];
    if (!o || o.status !== 'final' || !o.champion) continue;
    if (Date.now() - new Date(o.updatedAt).getTime() > 4 * 864e5) continue;
    const evMs = (track.matches || []).filter((m) =>
      m.tour === tour && m.surface === o.surface && (Date.now() - new Date(m.date).getTime()) < 16 * 864e5);
    if (evMs.length < 8) continue;
    const correct = evMs.filter((m) => m.smashCorrect).length;
    const beat = evMs.filter((m) => m.smashCorrect && m.oddCorrect === false).length;
    const exact = evMs.filter((m) => scorelineHit(m) === true).length;
    const file = `wrap-${tour}.png`;
    await reportCard({
      eyebrowText: `${o.event} ${tour} · tournament report card`,
      headline1: 'HOW WE',
      headline2: 'SCORED',
      stats: [
        { value: `${correct} OF ${evMs.length}`, label: 'winners called before play' },
        ...(beat ? [{ value: `${beat}`, label: 'times we beat the bookies' }] : []),
        { value: `${exact}`, label: 'exact set scores called' },
        { value: last(o.champion.name).toUpperCase(), label: 'your champion' },
      ],
      footNote: 'every call locked before play and graded in public',
      themeKey: o.surface,
      file,
    });
    add(file, 'wrap', 'square', 'wrap', `${o.event} ${tour.toUpperCase()} report card: ${correct} of ${evMs.length} winners called before play${beat ? `, ${beat} wins over the bookies` : ''}, ${exact} exact scorelines. ${o.champion.name} takes the title. ${SITE}/track-record ${tags}`);
  }

  // ── DRAW & BRACKETS: the bracket itself as content ──────────────────────
  for (const tour of ['atp', 'wta']) {
    const o = titleOdds.events?.[tour];
    if (!o?.draw?.field?.length || !o?.draw?.survival?.length) continue;
    const statusBit = o.status === 'projection'
      ? `The projected ${o.event} ${tour.toUpperCase()} field from today's rankings, re-priced with every refresh until the real draw drops.`
      : o.status === 'live'
        ? `The ${o.event} ${tour.toUpperCase()} draw: round-by-round survival odds from 2,000 simulated tournaments, re-priced daily.`
        : `Our last look at the ${o.event} ${tour.toUpperCase()} bracket before it was decided.`;
    const roadFile = `draw-road-${tour}.png`;
    if (await drawRoadCard(o, tour, roadFile)) {
      add(roadFile, 'draw-road', 'square', 'draw', `${statusBit} Every line of the bracket: ${SITE}/draw ${tags}`);
    }
    const pathFile = `draw-path-${tour}.png`;
    if (await drawPathCard(o, tour, pathFile)) {
      const fav = o.odds?.[0];
      add(pathFile, 'draw-path', 'square', 'draw', `${fav ? `${fav.name}'s path` : 'The favorite\'s path'}, round by round. ${statusBit} ${SITE}/draw ${tags}`);
    }
  }

  // Previous run's manifest: the weekly carry-over below and the MOMENTS
  // milestone check both need it. Parse defensively - a corrupt manifest
  // (e.g. committed merge-conflict markers, which happened once) must cost
  // us the carry-overs, not the whole share kit.
  let prevManifest = {};
  try {
    if (fs.existsSync(path.join(OUT, 'manifest.json'))) {
      prevManifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
    }
  } catch {
    console.warn('  ! previous manifest.json is unreadable - rebuilding without carry-overs');
  }

  // ── WEEKLY: the week in calls (fresh on Mondays or FORCE_WEEKLY=1; on
  // other days last Monday's card carries over so it lives in the kit all
  // week instead of vanishing on Tuesday) ──────────────────────────────────
  if (new Date().getUTCDay() !== 1 && process.env.FORCE_WEEKLY !== '1') {
    for (const a of (prevManifest.assets || [])) {
      if (a.category === 'weekly' && fs.existsSync(path.join(OUT, a.file))) assets.push(a);
    }
  }

  // Motion assets (.mp4) are appended by buildMotionAssets AFTER this script
  // runs. Carry the previous run's video entries forward so a standalone
  // share-assets run doesn't delete them in the stale-file cleanup; when
  // buildMotionAssets runs next it replaces these entries file-by-file.
  for (const a of (prevManifest.assets || [])) {
    if (a.format === 'video' && fs.existsSync(path.join(OUT, a.file))) assets.push(a);
  }
  if (new Date().getUTCDay() === 1 || process.env.FORCE_WEEKLY === '1') {
    const weekMs = (track.matches || []).filter((m) => (Date.now() - new Date(m.date).getTime()) < 7 * 864e5);
    if (weekMs.length >= 5) {
      const correct = weekMs.filter((m) => m.smashCorrect).length;
      const beat = weekMs.filter((m) => m.smashCorrect && m.oddCorrect === false).length;
      const bold = weekMs.filter((m) => m.smashCorrect)
        .sort((a, b) => Math.max(a.smashProbP1, 1 - a.smashProbP1) - Math.max(b.smashProbP1, 1 - b.smashProbP1))[0];
      const boldName = bold ? last(bold.smashFavorite === bold.p1 ? bold.name1 : bold.name2) : null;
      await reportCard({
        eyebrowText: 'the week in calls',
        headline1: 'WEEKLY',
        headline2: 'RECAP',
        stats: [
          { value: `${correct} OF ${weekMs.length}`, label: 'winners called this week' },
          ...(beat ? [{ value: `${beat}`, label: 'wins over the bookies' }] : []),
          ...(bold ? [{ value: `${boldName} · ${Math.round(Math.max(bold.smashProbP1, 1 - bold.smashProbP1) * 100)}%`, label: 'boldest call that hit' }] : []),
          { value: `${sc.season.acc}%`, label: 'season benchmark, all public' },
        ],
        footNote: 'new recap every Monday · every call graded',
        themeKey: 'brand',
        file: 'weekly.png',
      });
      add('weekly.png', 'weekly', 'square', 'weekly', `The week in calls: ${correct} of ${weekMs.length} winners called${beat ? `, ${beat} wins over the bookies` : ''}. Season benchmark: ${sc.season.acc}%. ${SITE}/track-record ${tags}`);
    }
  }

  // ── MOMENTS: milestone crossings + perfect days ─────────────────────────
  const prevN = prevManifest.seasonN || 0;
  if (Math.floor(sc.season.n / 250) > Math.floor(prevN / 250) && prevN > 0) {
    const mark = Math.floor(sc.season.n / 250) * 250;
    await reportCard({
      eyebrowText: 'milestone',
      headline1: `${mark.toLocaleString()}`,
      headline2: 'MATCHES GRADED',
      stats: [
        { value: `${sc.season.acc}%`, label: sc.proofLabel },
        { value: 'ZERO', label: 'deletions, edits, or excuses' },
      ],
      footNote: 'every prediction on the public record',
      themeKey: 'brand',
      file: 'milestone.png',
    });
    add('milestone.png', 'milestone', 'square', 'moments', `${mark.toLocaleString()} matches graded in public - season benchmark ${sc.season.acc}%, zero deletions. ${SITE}/track-record ${tags}`);
  }
  if (sc.yesterday && sc.yesterday.n >= 3 && sc.yesterday.correct === sc.yesterday.n) {
    await reportCard({
      eyebrowText: `perfect day · ${sc.yesterday.date}`,
      headline1: `${sc.yesterday.correct}/${sc.yesterday.n}`,
      headline2: 'FLAWLESS',
      stats: [
        { value: `${sc.yesterday.n}`, label: 'winners called before play' },
        { value: `${sc.season.acc}%`, label: 'season benchmark' },
      ],
      footNote: 'locked before play, graded after - no take-backs',
      themeKey: 'brand',
      file: 'perfect-day.png',
    });
    add('perfect-day.png', 'perfect-day', 'square', 'moments', `Perfect day: ${sc.yesterday.correct}/${sc.yesterday.n} winners called before play on ${sc.yesterday.date}. ${SITE}/track-record ${tags}`);
  }

  // ── PROMO layer ─────────────────────────────────────────────────────────
  await proofCard(track, 'proof.png');
  add('proof.png', 'proof', 'square', 'promo', `The 2026 receipts: ${sc.proofLine}, all graded in public. ${tags}`);

  await howItWorks(sc, 'how-it-works-1.png', 'how-it-works-2.png', 'how-it-works-3.png');
  add('how-it-works-1.png', 'explainer', 'square', 'promo', `How Smash works, 1 of 3: we play every match 1,000 times before it happens - point by point, from real serve and return stats. ${tags}`);
  add('how-it-works-2.png', 'explainer', 'square', 'promo', `How Smash works, 2 of 3: then we call it in public - win probability, exact score, upset risk. Locked before play. ${tags}`);
  add('how-it-works-3.png', 'explainer', 'square', 'promo', `How Smash works, 3 of 3: then the results grade us. ${sc.proofLine[0].toUpperCase()}${sc.proofLine.slice(1)}. ${tags}`);

  await poolPromoCard('pool-promo.png');
  add('pool-promo.png', 'feature', 'square', 'draw', `Bracket pools are live: build your bracket, lock it, and race your friends - our model enters every pool. Beat the house if you can. ${tags}`);

  for (const tour of ['atp', 'wta']) {
    const hot = await hotStreakCard(tour, `hot-streak-${tour}.png`);
    if (hot) add(`hot-streak-${tour}.png`, 'spotlight', 'square', 'promo', `Hottest racket on the ${tour.toUpperCase()} right now: ${hot.name}, ${hot.w}-${hot.l} in recent matches. Their full page: ${SITE}/player/${tour}/${hot.id} ${tags}`);
  }

  // ── HYPE: the next grand slam, promoted (within 75 days) ────────────────
  const nextMajor = nextSlam(new Date());
  const daysTo = nextMajor ? Math.ceil((new Date(nextMajor.startsAt) - Date.now()) / 864e5) : null;
  if (nextMajor && daysTo >= 1 && daysTo <= 75) {
    await hypeCountdownCard(nextMajor, daysTo, 'hype-countdown.png');
    add('hype-countdown.png', 'countdown', 'square', 'hype', `${daysTo} days until the ${nextMajor.label}. Picks live the moment the draw drops - every one locked before play and graded in public. ${tags}`);

    // The model's record on the slam's own surface (season benchmark).
    const surfRecs = ['atp', 'wta'].map((tour) => {
      const list = (track.matches || []).filter((m) => m.tour === tour && m.surface === nextMajor.surface);
      const correct = list.filter((m) => m.smashCorrect).length;
      return { tour, n: list.length, acc: list.length ? Math.round((correct / list.length) * 100) : 0 };
    }).filter((r) => r.n >= 30);
    if (surfRecs.length) {
      await reportCard({
        eyebrowText: `${nextMajor.label} · played on ${nextMajor.surface}`,
        headline1: 'WE KNOW',
        headline2: nextMajor.surface.toUpperCase(),
        stats: [
          ...surfRecs.map((r) => ({ value: `${r.acc}%`, label: `${r.tour.toUpperCase()} winners called on ${nextMajor.surface} · ${r.n} matches` })),
          { value: `${daysTo}`, label: 'days until first ball' },
        ],
        footNote: 'season benchmark, re-simulated daily · every call public',
        themeKey: nextMajor.surface,
        file: 'hype-surface.png',
      });
      add('hype-surface.png', 'surface-record', 'square', 'hype', `The ${nextMajor.label} is played on ${nextMajor.surface} - and ${nextMajor.surface} is where we've graded ${surfRecs.reduce((s, r) => s + r.n, 0)} matches this season. ${surfRecs.map((r) => `${r.tour.toUpperCase()} ${r.acc}%`).join(' · ')} (season benchmark). ${SITE}/track-record ${tags}`);
    }

    // Projected favorites, one card per tour, once the off-season projection
    // has replaced the last slam's final state.
    for (const tour of ['atp', 'wta']) {
      const o = titleOdds.events?.[tour];
      if (o?.status !== 'projection' || o.event !== nextMajor.label) continue;
      const f = `hype-favorites-${tour}.png`;
      if (await hypeFavoritesCard(o, tour, f)) {
        add(f, 'favorites', 'square', 'hype', `Projected ${nextMajor.label} ${tour.toUpperCase()} favorites from today's rankings - re-priced with every refresh until the draw drops. ${SITE}/draw ${tags}`);
      }
    }

    await hypeStoryCard(nextMajor, daysTo, surfRecs, 'hype-story.png');
    add('hype-story.png', 'countdown', 'story', 'hype', `${daysTo} days to the ${nextMajor.label}. The model is warming up - picks the moment the draw drops. ${tags}`);
  }

  // ── Ready-to-paste thread: the day's slate as a text thread ─────────────
  // One post per pick with its deep link, plus an opener and a closer, so a
  // webhook consumer (or a human) can publish the whole slate without
  // composing anything. Lives in the manifest next to the images.
  let thread = null;
  if (picks.length) {
    const posts = [];
    posts.push(
      `Today at the ${picks[0].event}: ${picks.length} call${picks.length === 1 ? '' : 's'}, every one locked before play. ` +
      `${sc.proofLine[0].toUpperCase()}${sc.proofLine.slice(1)}. Picks below.`
    );
    picks.forEach((p, i) => {
      const opp = p.favorite === p.p1 ? p.name2 : p.name1;
      const flag = p._flags.upset ? 'UPSET PICK. ' : (p._flags.confidence === 'high' ? 'High confidence. ' : '');
      posts.push(`${i + 1}/${picks.length} ${p.favName} over ${opp} at ${pctTxt(p.favProb)} on ${p.surface}. ${flag}${matchLink(p)}`);
    });
    if (picks.length >= 2) {
      const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
      posts.push(`If every call hits, $10 at fair odds returns $${(10 * mult).toFixed(0)}. Not betting advice, just the math on our own confidence.`);
    }
    posts.push(`Every call graded in public, wins and misses alike. Today's board: ${todayLink()} ${tags}`);
    thread = posts;
  }

  // ── Manifest + stale cleanup ────────────────────────────────────────────
  const manifest = { generatedAt: new Date().toISOString(), seasonN: sc.season.n, thread, assets };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const keep = new Set([...assets.map((a) => a.file), 'manifest.json']);
  for (const f of fs.readdirSync(OUT)) {
    if (!keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log('  removed stale', f); }
  }
  const byCat = assets.reduce((acc, a) => { acc[a.category] = (acc[a.category] || 0) + 1; return acc; }, {});
  console.log(`Share kit: ${assets.length} asset(s) (${Object.entries(byCat).map(([c, n]) => `${n} ${c}`).join(', ')}) -> ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
