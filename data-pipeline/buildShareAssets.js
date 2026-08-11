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
 * adding it to package.json). Fonts: Barlow Condensed / Arial Narrow /
 * DejaVu Sans Condensed (CI installs fonts-dejavu-extra), else plain
 * DejaVu Sans. Every text element is sized via fitFS against DejaVu Sans
 * metrics (the widest possible fallback), so a missing font can shrink
 * type slightly but can never overflow the canvas or a photo panel.
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

// Deployed-call accessors for graded track-record rows: the pick made by
// the best engine for that match's tour x surface (annotated by
// buildTrackRecord), with a Smart Blend fallback for rows that predate the
// annotation. Every "we called it" claim on a card grades these.
const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
const pickFav = (m) => m.pickFavorite || m.smashFavorite;
const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);
const pickFavProb = (m) => Math.max(pickProbP1(m), 1 - pickProbP1(m));

// "UPSET PICK" means the model backs a materially worse-ranked player, not
// merely one ranking place back. Same test as buildDailyScorecard.js - the
// cards and the site must never disagree about what an upset is.
const UPSET_RATIO = 2, UPSET_MIN_GAP = 10;
const isUpsetPick = (favRank, oppRank) =>
  !!favRank && !!oppRank && favRank >= oppRank * UPSET_RATIO && favRank - oppRank >= UPSET_MIN_GAP;
const SQ = 1080;
const ST_W = 1080, ST_H = 1920;
const MAX_MATCH_CARDS = 8;
const SEASON_YEAR = new Date().getUTCFullYear();

// ════════════════════════════════════════════════════════════════════════════
// SMASH 2.0 design system: vector type (fontkit) + a layered "stage".
//
// Text is shaped by fontkit and emitted as SVG <path> outlines, so cards are
// pixel-identical on any machine (no dependence on which fonts the renderer
// happens to have) and every string has an exact width for layout. The type
// system: Anton (heavy condensed hero), Bebas Neue (kickers), Archivo Black
// (labels/wordmark/chips), Barlow (body/data). All SIL OFL, committed under
// data-pipeline/fonts/.
// ════════════════════════════════════════════════════════════════════════════
const fontkit = require('fontkit');
const FONT_DIR = path.join(__dirname, 'fonts');
const FK = {
  anton: fontkit.openSync(path.join(FONT_DIR, 'Anton-Regular.ttf')),
  bebas: fontkit.openSync(path.join(FONT_DIR, 'BebasNeue-Regular.ttf')),
  black: fontkit.openSync(path.join(FONT_DIR, 'ArchivoBlack-Regular.ttf')),
  body: fontkit.openSync(path.join(FONT_DIR, 'Barlow-SemiBold.ttf')),
  bodyMed: fontkit.openSync(path.join(FONT_DIR, 'Barlow-Medium.ttf')),
};
// Width of a shaped string in px (includes kerning; tracking = extra px/gap).
function measureT(fk, text, size, tracking = 0) {
  const f = FK[fk], run = f.layout(String(text));
  return run.positions.reduce((s, p) => s + p.xAdvance, 0) * size / f.unitsPerEm + tracking * Math.max(0, run.glyphs.length - 1);
}
// Text as one combined vector <path>. anchor start|middle|end; skew deg slant.
function T(fk, text, x, y, size, { anchor = 'start', tracking = 0, fill = '#fff', opacity = 1, skew = 0 } = {}) {
  const f = FK[fk], scale = size / f.unitsPerEm, run = f.layout(String(text));
  const width = run.positions.reduce((s, p) => s + p.xAdvance, 0) * scale + tracking * Math.max(0, run.glyphs.length - 1);
  let penX = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x, d = '';
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i];
    d += g.path.scale(scale, -scale).translate(penX + p.xOffset * scale, y - p.yOffset * scale).toSVG();
    penX += p.xAdvance * scale + tracking;
  });
  // Anchor the italic slant at the baseline (plain skewX shears about y=0, so a
  // slanted word low on the canvas would drift far left of its measured x).
  const sk = skew ? ` transform="translate(${(-Math.tan(skew * Math.PI / 180) * y).toFixed(2)} 0) skewX(${skew})"` : '';
  return { svg: `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"${sk}/>`, width };
}
// Largest size <= size that keeps the string within maxW.
const fitT = (fk, text, size, maxW, tracking = 0) => {
  const w = measureT(fk, text, size, tracking);
  return w <= maxW ? size : Math.max(10, Math.floor(size * maxW / w));
};

// ── Palette: Indigo default, per-slam overrides ─────────────────────────────
const C_WHITE = '#ffffff', C_MUTE = '#93a6c0', C_FAINT = 'rgba(255,255,255,0.5)';
const INK_INDIGO = ['#1a1640', '#0d0a22', '#060413']; // [mid, base, deep]
// Semantic accent swaps on the shared indigo ink (content colour-coding).
const PAL = {
  calls: { key: '#c8ff2e', sub: '#9b7bff', ink: INK_INDIGO, name: 'calls' },       // lime + violet
  receipts: { key: '#ffc24b', sub: '#c8ff2e', ink: INK_INDIGO, name: 'receipts' },  // gold + lime
  edge: { key: '#31e1ff', sub: '#c8ff2e', ink: INK_INDIGO, name: 'edge' },          // cyan + lime
  upset: { key: '#ff2e7e', sub: '#ffc24b', ink: INK_INDIGO, name: 'upset' },        // magenta + gold
};
// Grand slams get their own identity so a card FEELS like that event.
const SLAM_PAL = {
  'Australian Open': { key: '#3d9bff', sub: '#c8ff2e', ink: ['#0d2a5c', '#06152e', '#030a17'], name: 'ao' },
  'Roland Garros': { key: '#ff7a3d', sub: '#ffd98a', ink: ['#3a1c10', '#1d0d06', '#0e0603'], name: 'rg' },
  'French Open': { key: '#ff7a3d', sub: '#ffd98a', ink: ['#3a1c10', '#1d0d06', '#0e0603'], name: 'rg' },
  'Wimbledon': { key: '#3ddc84', sub: '#b06bff', ink: ['#221a3f', '#0e0b1f', '#060411'], name: 'wb' },
  'US Open': { key: '#4a90ff', sub: '#ffd54a', ink: ['#0b2a6b', '#04122e', '#020a17'], name: 'us' },
};
// kind is the semantic role for non-slam cards ('calls' default).
const paletteFor = (eventName, kind = 'calls') => SLAM_PAL[eventName] || PAL[kind] || PAL.calls;

// ── Stage: layered background (defs + fills + geometry + texture) ────────────
function sDefs(a) {
  const [mid, base, deep] = a.ink;
  return `
  <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="0.5" stop-color="${base}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${a.key}" stop-opacity="0.18"/><stop offset="1" stop-color="${a.key}" stop-opacity="0"/></radialGradient>
  <radialGradient id="bloom2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${a.sub}" stop-opacity="0.14"/><stop offset="1" stop-color="${a.sub}" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="0.5" cy="0.4" r="0.9"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>
  <linearGradient id="keyGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a.key}"/><stop offset="1" stop-color="${a.sub}"/></linearGradient>
  <pattern id="halftone" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.2" fill="${a.key}" fill-opacity="0.5"/></pattern>
  <filter id="glow" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur stdDeviation="11"/></filter>
  <filter id="pglow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="26"/></filter>`;
}
function sStage(a, w, h, { ghost = null } = {}) {
  return `
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${w * 0.22}" cy="${h * 0.15}" rx="${w * 0.62}" ry="${h * 0.46}" fill="url(#bloom)"/>
  <ellipse cx="${w * 0.9}" cy="${h * 0.92}" rx="${w * 0.52}" ry="${h * 0.4}" fill="url(#bloom2)"/>
  <g stroke="#ffffff" stroke-opacity="0.04" stroke-width="2.5" fill="none"><rect x="${w * 0.52}" y="${h * 0.12}" width="${w * 0.44}" height="${h * 0.74}"/><line x1="${w * 0.52}" y1="${h * 0.49}" x2="${w * 0.96}" y2="${h * 0.49}"/></g>
  <polygon points="${w},0 ${w},${h * 0.28} ${w * 0.66},0" fill="${a.key}" fill-opacity="0.08"/>
  <polygon points="${w},0 ${w},${h * 0.09} ${w * 0.84},0" fill="${a.key}"/>
  <g transform="rotate(-8 0 ${h * 0.72})"><rect x="-20" y="${h * 0.64}" width="${w * 0.32}" height="${h * 0.4}" fill="url(#halftone)" opacity="0.5"/></g>
  ${ghost ? T('anton', ghost, w / 2, h + 46, Math.min(w * 0.52, 560), { anchor: 'middle', fill: '#fff', opacity: 0.035 }).svg : ''}
  <rect width="${w}" height="${h}" fill="url(#vig)"/>`;
}
// Brand tick + wordmark left; context kicker right.
function sMast(w, kicker, a, { tour = null } = {}) {
  const tagW = tour ? 94 : 0;
  // Cap the kicker so it can never run left into the SMASH wordmark (~x230).
  const k = fitT('black', kicker.toUpperCase(), 25, w - 320 - tagW, 3);
  const tourTag = tour ? `<rect x="${w - 60 - 84}" y="52" width="84" height="44" rx="10" fill="${tour === 'wta' ? '#ff2e7e' : '#31e1ff'}"/>${T('black', tour.toUpperCase(), w - 60 - 42, 82, 22, { anchor: 'middle', fill: '#fff', tracking: 1 }).svg}` : '';
  return `
  <circle cx="62" cy="70" r="10" fill="${a.key}"/>${T('black', 'SMASH', 84, 82, 36, { fill: C_WHITE, tracking: 2 }).svg}
  ${T('black', kicker.toUpperCase(), w - 60 - tagW - (tour ? 14 : 0), 80, k, { anchor: 'end', fill: a.key, tracking: 3 }).svg}
  ${tourTag}
  <rect x="60" y="100" width="${w - 120}" height="2" fill="#ffffff" fill-opacity="0.1"/>`;
}
// Bold accent slab at the bottom - the brand signature CTA bar.
function sBar(w, h, text, a, { sub = 'EVERY CALL PUBLIC · GRADED DAILY' } = {}) {
  const barY = h - 150, tw = fitT('anton', text, 62, w - 130);
  return `
  <polygon points="0,${barY + 20} ${w},${barY - 20} ${w},${h} 0,${h}" fill="url(#keyGrad)"/>
  <polygon points="0,${barY + 20} ${w},${barY - 20} ${w},${barY - 8} 0,${barY + 32}" fill="#ffffff" fill-opacity="0.28"/>
  ${T('anton', text, 60, barY + 86, tw, { fill: a.ink[2] }).svg}
  ${T('black', sub, 62, barY + 122, 19, { fill: 'rgba(0,0,0,0.68)', tracking: 2 }).svg}`;
}
// Glass stat chip centered at cx, shrinking to stay within maxW.
function sChip(cx, y, text, a, maxW = 820) {
  const fs = fitT('black', text, 26, maxW - 64, 2), w = measureT('black', text, fs, 2) + 64;
  return `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="58" rx="14" fill="rgba(255,255,255,0.06)" stroke="${a.key}" stroke-width="2"/>${T('black', text, cx, y + 39, fs, { anchor: 'middle', fill: a.key, tracking: 2 }).svg}`;
}
// Name plate pill centered at cx, text baseline at y.
function sPlate(cx, y, text, color, filled, deep) {
  const fs = 26, w = measureT('black', text, fs, 1) + 44;
  return `<rect x="${cx - w / 2}" y="${y - 34}" width="${w}" height="48" rx="24" fill="${filled ? color : 'rgba(6,9,16,0.82)'}" stroke="${color}" stroke-width="3"/>${T('black', text, cx, y, fs, { anchor: 'middle', fill: filled ? deep : color, tracking: 1 }).svg}`;
}
// Label-left / value-right comparison row with an underline (edge + autopsy).
function statRow(y, label, txt, color = C_WHITE) {
  return `
    ${T('black', label, 140, y, 24, { fill: 'rgba(255,255,255,0.55)', tracking: 3 }).svg}
    ${T('anton', txt, SQ - 140, y, fitT('anton', txt, 44, 520), { anchor: 'end', fill: color }).svg}
    <line x1="140" y1="${y + 24}" x2="${SQ - 140}" y2="${y + 24}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
}

// Up/down delta chip drawn as SVG triangles (the display fonts have no ▲/▼).
// Right-anchored at xRight; number sits at the row's y+28.
function deltaTag(xRight, yTop, delta) {
  const col = delta > 0 ? '#3ddc84' : '#ff5c5c';
  const num = String(Math.abs(delta));
  const triR = xRight - measureT('black', num, 30) - 12, triL = triR - 22;
  const tri = delta > 0
    ? `<polygon points="${triL},${yTop + 26} ${triR},${yTop + 26} ${(triL + triR) / 2},${yTop + 4}" fill="${col}"/>`
    : `<polygon points="${triL},${yTop + 4} ${triR},${yTop + 4} ${(triL + triR) / 2},${yTop + 26}" fill="${col}"/>`;
  return `${tri}${T('black', num, xRight, yTop + 28, 30, { anchor: 'end', fill: col }).svg}`;
}

// Photo panel with a "spotlight" treatment that signals the model's pick:
//   'winner' -> graded natural COLOUR (pops)
//   'loser'  -> cool desaturated mono (filtered down)
//   'base'   -> neutral cool duotone (poll / no revealed pick)
// Rounded corners + a bottom shade so the name plate always sits on darkness.
async function duoPanel(file, w, h, mode = 'base', radius = 28) {
  const src = sharp(file).resize(w, h, { fit: 'cover', position: 'top' });
  let body;
  if (mode === 'winner') {
    body = await src.modulate({ brightness: 1.06, saturation: 1.12 }).linear(1.08, -8).png().toBuffer();
  } else {
    const [tint, bg, lin, bright] = mode === 'loser'
      ? ['#c9c9d2', '#0a0a12', [0.95, -18], 0.9]   // desaturated, darker
      : ['#fdf1df', '#0c1524', [1.06, -6], 1];      // neutral duotone
    const gray = await src.grayscale().normalise().linear(lin[0], lin[1]).modulate({ brightness: bright }).toBuffer();
    const hi = await sharp(gray).tint(tint).toBuffer();
    body = await sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite([{ input: hi, blend: 'screen' }]).png().toBuffer();
  }
  const shade = Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#04070e" stop-opacity="0.85"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#s)"/></svg>`);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  return sharp(body).composite([{ input: shade, blend: 'over' }, { input: mask, blend: 'dest-in' }]).png().toBuffer();
}
// Full-bleed duotone stadium, graded into the indigo ink so the photo cards
// sit in the same world as the typographic ones (highlights lean violet, not
// the neutral blue that reads green under a lime glow).
async function duoStage(surfaceKey, w, h) {
  const f = path.join(ROOT, 'src', 'assets', STADIUMS[surfaceKey] || STADIUMS.brand);
  const gray = await sharp(f).resize(w, h, { fit: 'cover' }).grayscale().normalise().linear(0.9, -4).blur(1.2).toBuffer();
  const hi = await sharp(gray).tint('#d7ccf6').toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: '#0a0818' } }).composite([{ input: hi, blend: 'screen' }]).png().toBuffer();
}

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

// Event identity: the slams get their own palette so a US Open card FEELS
// like the US Open, not just "a hard court". Unknown events (Masters etc.)
// fall back to their surface theme.
const EVENT_THEMES = {
  'Australian Open': { top: '#0e3f8c', bottom: '#04102a', accent: '#6f9dff' },
  'French Open':     { top: '#7a3315', bottom: '#1c0903', accent: '#ff7a52' },
  'Wimbledon':       { top: '#2d1f57', bottom: '#0a1a0d', accent: '#3ddc84' },
  'US Open':         { top: '#0b2a6b', bottom: '#040c1e', accent: '#ffd54a' },
};
const eventTheme = (eventName, surfaceKey) => EVENT_THEMES[eventName] || theme(surfaceKey);

// Metallic gold for champion / milestone moments (lime is for calls; gold
// is for trophies).
const GOLD = '#e9c96b';
const goldGrad = (id = 'gold') => `
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f6e2a2"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="#b98f2f"/>
  </linearGradient>`;
// Holographic foil for the trading-card frame.
const foilGrad = (id = 'foil') => `
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7ee8fa"/><stop offset="0.35" stop-color="${LIME}"/>
    <stop offset="0.65" stop-color="#e9c96b"/><stop offset="1" stop-color="#c77dff"/>
  </linearGradient>`;

// Hero numeral: tight tracking plus an offset outlined ghost twin behind it,
// the signature treatment every big stat shares.
const heroNum = (x, y, text, size, fill, anchor = 'middle', maxW = null) => {
  const s = maxW ? fitFS(text, size, maxW) : size;
  return `
  <text x="${x + 9}" y="${y + 9}" text-anchor="${anchor}" font-family="${D}" font-size="${s}" font-weight="800" letter-spacing="-0.02em" fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="2">${esc(text)}</text>
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${D}" font-size="${s}" font-weight="800" letter-spacing="-0.02em" fill="${fill}">${esc(text)}</text>`;
};

// ── Film grain: one deterministic RGBA noise tile, composited over every
// card with 'overlay' - the single cheapest "premium" upgrade there is.
let GRAIN_TILE = null;
async function grainTile() {
  if (GRAIN_TILE) return GRAIN_TILE;
  const S = 256;
  const px = Buffer.alloc(S * S * 4);
  let seed = 987654321;
  for (let i = 0; i < S * S; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const g = seed % 256;
    px[i * 4] = g; px[i * 4 + 1] = g; px[i * 4 + 2] = g; px[i * 4 + 3] = 15;
  }
  GRAIN_TILE = await sharp(px, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  return GRAIN_TILE;
}

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
const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const matchLink = (p) => `${SITE}/match/${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
const todayLink = () => `${SITE}/today`;

// ── Width-safe typography ──────────────────────────────────────────────────
// The font that actually renders these cards is whatever the machine has:
// Barlow Condensed when installed, plain DejaVu Sans when not. DejaVu is by
// far the widest face in the chain, so every layout measures against DejaVu
// metrics: a substituted font can only render NARROWER than planned, never
// spill off the canvas or under a photo panel. Per-glyph advance widths in
// em, rounded up (overestimating shrinks text a little; underestimating
// truncates it).
const CHAR_EM = (ch) => {
  if (ch === ' ') return 0.36;
  if (/[WM@%&]/.test(ch)) return 1.05;
  if (/[mw]/.test(ch)) return 0.98;
  if (/[A-Z0-9$#?]/.test(ch)) return 0.78;
  if (/[a-z]/.test(ch)) return 0.6;
  if (/[.,:;!'’|()[\]]/.test(ch)) return 0.38;
  if (/[·\-–_/]/.test(ch)) return 0.52;
  return 0.85;
};
const emW = (s) => [...String(s ?? '')].reduce((w, ch) => w + CHAR_EM(ch), 0);
// Estimated pixel width at font-size fs (+ letter-spacing in px).
const textWpx = (s, fs, ls = 0) => emW(s) * fs + Math.max(0, String(s ?? '').length - 1) * ls;
// Largest font size <= fs that keeps s inside maxW. Measure the PLAIN text
// (before esc/tspan markup).
const fitFS = (s, fs, maxW, ls = 0) => {
  const em = emW(s);
  if (!em) return fs;
  const spacing = Math.max(0, String(s).length - 1) * ls;
  if (em * fs + spacing <= maxW) return fs;
  return Math.max(12, Math.floor((maxW - spacing) / em));
};

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
  // canvas, not bleed off both edges, whichever font actually renders it.
  const gsRaw = ghostSize || Math.min(w * 0.62, 660);
  const gs = ghost ? fitFS(ghost, gsRaw, w * 0.94) : gsRaw;
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
  const up = text.toUpperCase();
  // Long kickers (event + tagline) shrink to fit; short ones keep 27px.
  const fs2 = fitFS(up, 27, w - 220, 6);
  const approx = textWpx(up, fs2, 6) + 40;
  return `
  <rect x="${w / 2 - approx / 2 - 34}" y="${y - 20}" width="16" height="16" fill="${color}"/>
  <text x="${w / 2 + 12}" y="${y - 5}" text-anchor="middle" font-family="${U}" font-size="${fs2}" font-weight="700" letter-spacing="6" fill="${color}">${esc(up)}</text>`;
}

// maxW (optional) caps the whole pill's width: the text shrinks to keep the
// pill inside its column (photo panels hand their own width here).
function pill(cx, y, text, color, filled = false, maxW = null) {
  const fs2 = maxW ? fitFS(text, 26, maxW - 50, 2) : 26;
  const w = Math.ceil(textWpx(text, fs2, 2)) + 50;
  return `
  <rect x="${cx - w / 2}" y="${y}" width="${w}" height="52" rx="26" fill="${filled ? color : 'rgba(0,0,0,0.45)'}" stroke="${color}" stroke-width="3"/>
  <text x="${cx}" y="${y + 36}" text-anchor="middle" font-family="${U}" font-size="${fs2}" font-weight="800" letter-spacing="2" fill="${filled ? INK : color}">${esc(text)}</text>`;
}

// Small filled tag, left-anchored (photo-card flag style).
function tag(x, y, text, color) {
  const w = Math.ceil(textWpx(text, 23, 2)) + 40;
  return {
    svg: `
  <rect x="${x}" y="${y}" width="${w}" height="46" fill="${color}"/>
  <text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" font-family="${U}" font-size="23" font-weight="800" letter-spacing="2" fill="${INK}">${esc(text)}</text>`,
    w,
  };
}

// Soft ambient glow behind a photo panel (replaces hard offset shadows with
// stage lighting). Unique id per use.
const glowSpot = (id, cx, cy, r, color, op = 0.2) => `
  <defs><radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </radialGradient></defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;

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
  // Unified treatment: every headshot gets the same slight desaturation and
  // contrast lift, so mixed-quality source photos read as one shoot.
  const ph = sharp(file)
    .flatten({ background: '#11161f' })
    .resize(w, h, { fit: 'cover', position: 'top' })
    .modulate({ brightness: dim, saturation: 0.85 })
    .linear(1.07, -9);
  const buf = await ph.png().toBuffer();
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function render(file, baseSvg, composites = []) {
  const grain = { input: await grainTile(), tile: true, blend: 'overlay' };
  if (!composites.length) {
    // Pure-SVG cards supersample: rasterize at 2x (density 144 vs the SVG
    // default 72), then downscale - noticeably crisper thin lines and type.
    const m = baseSvg.match(/width="(\d+)" height="(\d+)"/);
    const w = m ? +m[1] : SQ, h = m ? +m[2] : SQ;
    await sharp(Buffer.from(baseSvg), { density: 144 })
      .resize(w, h)
      .composite([grain])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, file));
  } else {
    await sharp(Buffer.from(baseSvg)).composite([...composites, grain]).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  }
  console.log('  wrote', file);
}

async function renderOn(file, bgBuf, composites) {
  const grain = { input: await grainTile(), tile: true, blend: 'overlay' };
  await sharp(bgBuf).composite([...composites, grain]).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
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

// The CTA-style bar at the bottom of photo cards (lime by default, gold for
// trophy moments).
function bottomBar(w, text, { y = null, filled = true, color = LIME, textColor = INK } = {}) {
  const by = y ?? 956;
  const fs2 = fitFS(text, 44, w - 200, 1);
  const ty = by + 42 + fs2 * 0.34; // keep the (possibly smaller) text centered in the bar
  return `
  <rect x="40" y="${by}" width="${w - 80}" height="84" rx="42" fill="${filled ? color : 'rgba(0,0,0,0.55)'}" ${filled ? '' : `stroke="${color}" stroke-width="3"`}/>
  <text x="${w / 2}" y="${ty.toFixed(0)}" text-anchor="middle" font-family="${D}" font-size="${fs2}" font-weight="800" letter-spacing="1" fill="${filled ? textColor : color}">${esc(text)}</text>`;
}

// ── DAILY: match card (photo treatment) ────────────────────────────────────
// `result` (optional): { winnerName, score } turns the prediction card into
// its receipt twin - same layout, stamped CALLED ✓, final score in the bar.
// `context` (optional): { h2h: {w1,w2}, pair: {n,correct} } adds the rivalry
// strip under the win probability.
async function matchCard(p, flags, file, result = null, context = null) {
  const favIsP1 = p.favorite === p.p1;
  const favPct = Math.round(p.favProb * 100);
  const a = paletteFor(p.event, flags.upset ? 'upset' : 'calls');
  const v = result ? { headline: 'WE CALLED IT' } : verdict(p.favProb, flags.upset);
  const [hl1, hl2] = splitHeadline(v.headline);
  const favName = favIsP1 ? p.name1 : p.name2;
  const dogName = favIsP1 ? p.name2 : p.name1;
  const favRank = favIsP1 ? flags.rank1 : flags.rank2;
  const dogRank = favIsP1 ? flags.rank2 : flags.rank1;
  const flagTxt = flags.upset ? 'UPSET PICK' : (flags.confidence === 'high' ? 'HIGH CONFIDENCE' : (flags.confidence === 'low' ? 'TOSS-UP' : 'OUR CALL'));

  const PW = 402, PH = 452, PY = 456, dogX = 60, favX = SQ - 60 - PW, midY = PY + PH / 2;
  const bg = await duoStage(p.surface, SQ, SQ);
  const [dogImg, favImg] = await Promise.all([
    duoPanel(photoPath(p.tour, favIsP1 ? p.p2 : p.p1), PW, PH, 'loser'),
    duoPanel(photoPath(p.tour, favIsP1 ? p.p1 : p.p2), PW, PH, 'winner'),
  ]);

  // Bottom scrim: darken stadium + brand blooms + shard + panel rim-glows.
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.36"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.24} ${SQ * 0.7},0" fill="${a.key}" fill-opacity="0.1"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${dogX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.sub}" fill-opacity="0.38" filter="url(#pglow)"/>
    <rect x="${favX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.key}" fill-opacity="0.42" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;

  const pctTop = T('anton', `${favPct}%`, SQ - 60, 300, 150, { anchor: 'end', fill: a.key });
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${p.event} · ${p.surface} · ${fmtDate(p.date)}`, a, { tour: p.tour })}
    ${T('bebas', flagTxt, 60, 180, 38, { fill: a.sub, tracking: 5 }).svg}
    ${T('anton', hl1, 60, 292, fitT('anton', hl1, 112, 520), { fill: C_WHITE }).svg}
    ${hl2 ? T('anton', hl2, 60, 388, fitT('anton', hl2, 112, 520), { fill: a.key, skew: -7 }).svg : ''}
    <g filter="url(#glow)" opacity="0.5">${pctTop.svg}</g>${pctTop.svg}
    ${T('black', `${last(favName).toUpperCase()} TO WIN`, SQ - 60, 344, 23, { anchor: 'end', fill: 'rgba(255,255,255,0.72)', tracking: 2 }).svg}
    <rect x="${dogX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
    <rect x="${favX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${a.key}" stroke-width="4"/>
    <circle cx="${SQ / 2}" cy="${midY}" r="46" fill="${a.ink[2]}" stroke="${a.key}" stroke-width="3"/>
    ${T('anton', 'VS', SQ / 2, midY + 16, 44, { anchor: 'middle', fill: C_WHITE }).svg}
    ${sPlate(dogX + PW / 2, PY + PH - 28, `${last(dogName).toUpperCase()}${dogRank ? ` · NO. ${dogRank}` : ''}`, C_WHITE, false, a.ink[2])}
    ${sPlate(favX + PW / 2, PY + PH - 28, `${last(favName).toUpperCase()}${favRank ? ` · NO. ${favRank}` : ''}`, a.key, true, a.ink[2])}
    ${result ? `<g transform="rotate(-9 ${SQ / 2} 300)"><rect x="330" y="242" width="420" height="104" rx="16" fill="rgba(0,0,0,0.55)" stroke="#3ddc84" stroke-width="8"/>${T('anton', 'CALLED ✓', SQ / 2, 316, 66, { anchor: 'middle', fill: '#3ddc84' }).svg}</g>` : ''}
    ${sBar(SQ, SQ, result
      ? `${last(result.winnerName).toUpperCase()} WON · WE SAID ${favPct}%`
      : `OUR CALL: ${last(favName).toUpperCase()} · ${favPct}%`, a)}
    </svg>`;

  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: dogImg, left: dogX, top: PY },
    { input: favImg, left: favX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
  ]);
}

// ── DAILY: poll card (photo treatment, no % revealed) ──────────────────────
async function pollCard(p, file) {
  const a = paletteFor(p.event, 'calls');
  const PW = 402, PH = 452, PY = 456, aX = 60, bX = SQ - 60 - PW, midY = PY + PH / 2;
  const bg = await duoStage(p.surface, SQ, SQ);
  const [aImg, bImg] = await Promise.all([
    duoPanel(photoPath(p.tour, p.p1), PW, PH, 'base'),
    duoPanel(photoPath(p.tour, p.p2), PW, PH, 'base'),
  ]);
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.36"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${aX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.sub}" fill-opacity="0.32" filter="url(#pglow)"/>
    <rect x="${bX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.sub}" fill-opacity="0.32" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${p.event} · ${fmtDate(p.date)}`, a, { tour: p.tour })}
    ${T('bebas', 'YOU MAKE THE CALL', 60, 180, 38, { fill: a.sub, tracking: 5 }).svg}
    ${T('anton', 'WHO', 60, 300, 118, { fill: C_WHITE }).svg}
    ${T('anton', 'WINS?', 60, 396, 118, { fill: a.key, skew: -7 }).svg}
    <rect x="${aX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
    <rect x="${bX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
    <circle cx="${SQ / 2}" cy="${midY}" r="46" fill="${a.ink[2]}" stroke="${a.key}" stroke-width="3"/>
    ${T('anton', 'VS', SQ / 2, midY + 16, 44, { anchor: 'middle', fill: C_WHITE }).svg}
    ${sPlate(aX + PW / 2, PY + PH - 28, last(p.name1).toUpperCase(), C_WHITE, false, a.ink[2])}
    ${sPlate(bX + PW / 2, PY + PH - 28, last(p.name2).toUpperCase(), C_WHITE, false, a.ink[2])}
    ${sBar(SQ, SQ, 'VOTE IN THE COMMENTS  →', a, { sub: 'WE ALREADY PICKED A SIDE · ANSWER TOMORROW' })}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: aImg, left: aX, top: PY },
    { input: bImg, left: bX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
  ]);
}

// ── DAILY: cover / parlay / slate story / results (typographic) ────────────
async function coverCard(picks, sc, file) {
  const ev = picks[0]?.event || 'The Tour';
  const a = paletteFor(ev, 'calls');
  const upsets = picks.filter((p) => p._flags.upset).length;
  const hs = 212;
  const glowWord = T('anton', 'CALLS', 60, 592, hs, { fill: a.key });
  const subTxt = `${picks.length} match${picks.length > 1 ? 'es' : ''}, locked before a ball was struck${upsets ? ` · ${upsets} upset${upsets > 1 ? 's' : ''}` : ''}`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'CALLS' })}
  ${sMast(SQ, `${ev} · ${fmtDate(picks[0]?.date || Date.now())}`, a)}
  ${T('bebas', 'THE PICKS ARE IN', 62, 190, 42, { fill: a.sub, tracking: 6 }).svg}
  ${T('anton', "TODAY'S", 60, 392, hs, { fill: C_WHITE }).svg}
  <g filter="url(#glow)" opacity="0.55">${glowWord.svg}</g>
  ${T('anton', 'CALLS', 60, 592, hs, { fill: a.key, skew: -7 }).svg}
  ${T('body', subTxt, 64, 672, 34, { fill: C_MUTE }).svg}
  ${sChip(SQ / 2, 742, sc.proofPill.toUpperCase(), a)}
  ${sBar(SQ, SQ, 'SWIPE FOR EVERY PICK  →', a)}
  </svg>`;
  await render(file, base);
}

async function parlayCard(picks, file) {
  const a = paletteFor(picks[0]?.event, 'calls');
  const n = Math.min(picks.length, 8);
  const startY = 300 + Math.max(0, (6 - n)) * 24;
  const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
  const pAll = picks.reduce((m, p) => m * p.favProb, 1);
  const rows = picks.slice(0, 8).map((p, i) => {
    const y = startY + i * 58;
    const fav = last(p.favName), opp = last(p.favorite === p.p1 ? p.name2 : p.name1);
    const favW = measureT('body', fav + ' ', 32);
    return `
    ${T('body', fav, 130, y, 32, { fill: 'rgba(255,255,255,0.92)' }).svg}
    ${T('bodyMed', `over ${opp}`, 130 + favW, y, 30, { fill: 'rgba(255,255,255,0.42)' }).svg}
    ${T('black', pctTxt(p.favProb), SQ - 130, y, 36, { anchor: 'end', fill: a.key }).svg}`;
  }).join('');
  const lineY = startY + 6 + n * 58;
  const heroY = Math.min(lineY + 90, 852);
  const divY = Math.min(lineY, heroY - 92);
  const payTxt = `$10 → $${(10 * mult).toFixed(0)}`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: '$' })}
  ${sMast(SQ, 'If Every Call Hits', a)}
  ${T('anton', 'THE SLATE', 60, 252, 112, { fill: C_WHITE }).svg}
  ${rows}
  <line x1="130" y1="${divY}" x2="${SQ - 130}" y2="${divY}" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  ${T('anton', payTxt, SQ / 2, heroY, fitT('anton', payTxt, 128, SQ - 150), { anchor: 'middle', fill: a.key }).svg}
  ${T('body', `at fair odds · all ${picks.length} hit ${pctTxt(pAll)} · not betting advice`, SQ / 2, heroY + 42, 25, { anchor: 'middle', fill: 'rgba(255,255,255,0.6)' }).svg}
  ${sBar(SQ, SQ, 'SEE TODAY’S FULL SLATE  →', a)}
  </svg>`;
  await render(file, base);
}

async function slateStory(picks, sc, file) {
  const a = paletteFor(picks[0]?.event, 'calls');
  const shown = picks.slice(0, 8);
  const rowH = shown.length <= 4 ? 210 : 148;
  const startY = shown.length <= 4 ? 620 : 500;
  const rows = shown.map((p, i) => {
    const y = startY + i * rowH;
    const favIsP1 = p.favorite === p.p1;
    const flagTxt = p._flags.upset ? 'UPSET PICK' : (p._flags.confidence === 'high' ? 'HIGH CONFIDENCE' : (p._flags.confidence === 'low' ? 'TOSS-UP' : ''));
    const flagColor = p._flags.upset ? '#ff2e7e' : (p._flags.confidence === 'high' ? '#3ddc84' : a.sub);
    return `
    ${T('anton', last(p.name1).toUpperCase(), 90, y, 52, { fill: favIsP1 ? C_WHITE : 'rgba(255,255,255,0.5)' }).svg}
    ${T('anton', last(p.name2).toUpperCase(), 90, y + 58, 52, { fill: favIsP1 ? 'rgba(255,255,255,0.5)' : C_WHITE }).svg}
    ${T('anton', pctTxt(p.favProb), ST_W - 90, y + 26, 78, { anchor: 'end', fill: a.key }).svg}
    ${flagTxt ? T('black', flagTxt, ST_W - 90, y + 70, 22, { anchor: 'end', fill: flagColor, tracking: 2 }).svg : ''}
    <line x1="90" y1="${y + 92}" x2="${ST_W - 90}" y2="${y + 92}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
  }).join('');
  const mult = picks.reduce((m, p) => m * (1 / p.favProb), 1);
  const footY = (shown.length <= 4 ? 620 : 500) + shown.length * rowH + 24;
  const payTxt = `$10 → $${(10 * mult).toFixed(0)} IF EVERY CALL HITS`;
  const base = `<svg width="${ST_W}" height="${ST_H}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, ST_W, ST_H, { ghost: 'SMASH' })}
  ${sMast(ST_W, `${picks[0]?.event || ''} · ${fmtDate(picks[0]?.date || Date.now())}`, a)}
  ${T('anton', "TODAY'S CALLS", ST_W / 2, 300, fitT('anton', "TODAY'S CALLS", 150, ST_W - 120), { anchor: 'middle', fill: C_WHITE }).svg}
  ${T('body', 'locked before play · the number is our win probability', ST_W / 2, 360, 28, { anchor: 'middle', fill: C_MUTE }).svg}
  ${rows}
  <rect x="90" y="${footY}" width="${ST_W - 180}" height="150" rx="20" fill="url(#keyGrad)"/>
  ${T('anton', payTxt, ST_W / 2, footY + 74, fitT('anton', payTxt, 60, ST_W - 240), { anchor: 'middle', fill: a.ink[2] }).svg}
  ${T('black', `AT FAIR ODDS · ${sc.proofLine.toUpperCase()}`, ST_W / 2, footY + 118, fitT('black', `AT FAIR ODDS · ${sc.proofLine.toUpperCase()}`, 24, ST_W - 240, 1), { anchor: 'middle', fill: 'rgba(0,0,0,0.62)', tracking: 1 }).svg}
  </svg>`;
  await render(file, base);
}

async function resultsCard(sc, file) {
  const y = sc.yesterday;
  const a = PAL.receipts;
  const lines = [];
  if (y?.beatBookies?.length) lines.push({ txt: `Beat the bookies: ${y.beatBookies.map((b) => b.call).join(' · ')}`, color: a.sub });
  if (y?.boldest) lines.push({ txt: `Boldest hit: ${y.boldest.call} at ${y.boldest.prob}%`, color: C_WHITE });
  if (y?.worstMiss) lines.push({ txt: `The one we own: ${y.worstMiss.call} lost`, color: C_FAINT });
  const heroTxt = y ? `${y.correct} OF ${y.n}` : '';
  const hero = T('anton', heroTxt, SQ / 2, 452, fitT('anton', heroTxt, 268, SQ - 150), { anchor: 'middle', fill: a.key });
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'RECEIPTS' })}
  ${sMast(SQ, `Receipts · ${y?.date ? fmtDate(y.date) : ''}`, a)}
  ${T('bebas', 'YESTERDAY, GRADED IN PUBLIC', SQ / 2, 192, 40, { anchor: 'middle', fill: a.sub, tracking: 5 }).svg}
  ${y ? `<g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}` : ''}
  ${T('body', "winners called on yesterday's matches", SQ / 2, 524, 32, { anchor: 'middle', fill: C_MUTE }).svg}
  ${lines.map((l, i) => `<rect x="176" y="${596 + i * 60 - 23}" width="9" height="34" rx="2" fill="${l.color}"/>${T('body', l.txt, 208, 596 + i * 60, fitT('body', l.txt, 31, SQ - 260), { fill: l.color }).svg}`).join('')}
  ${sBar(SQ, SQ, 'SEE EVERY GRADED CALL  →', a)}
  </svg>`;
  await render(file, base);
}

// ── DAILY: title odds / champion ───────────────────────────────────────────
async function championCard(o, tour, file) {
  const a = PAL.receipts; // trophy gold
  const hist = (o.history || []).map((h) => h.odds?.[o.champion.name]).filter((v) => v != null);
  const start = (hist.length && hist[0] < 0.99) ? `We backed them from ${Math.round(hist[0] * 100)}%` : 'Tracked daily, graded in public';
  const PW = 424, PH = 600, PY = 300, PX = SQ - 60 - PW, colW = PX - 60 - 30;
  const bg = await duoStage(o.surface, SQ, SQ);
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.4"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.key}" fill-opacity="0.55" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const hlFs = fitT('anton', 'CHAMPION', 100, colW);
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${o.event} ${tour} · Champion`, a, { tour })}
    ${T('bebas', 'THE DRAW IS DECIDED', 60, 232, 38, { fill: a.sub, tracking: 5 }).svg}
    ${T('anton', 'YOUR', 60, 360, hlFs, { fill: C_WHITE }).svg}
    ${T('anton', 'CHAMPION', 60, 360 + Math.round(hlFs * 0.92), hlFs, { fill: a.key, skew: -6 }).svg}
    ${T('body', start, 62, 360 + Math.round(hlFs * 0.92) + 64, fitT('body', start, 30, colW), { fill: C_MUTE }).svg}
    <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${a.key}" stroke-width="5"/>
    ${sPlate(PX + PW / 2, PY + PH + 42, o.champion.name.toUpperCase(), a.key, true, a.ink[2])}
    ${sBar(SQ, SQ, 'THE CALL, GRADED IN PUBLIC', a, { sub: 'EVERY ROUND SIMULATED, EVERY DAY' })}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  const comps = [{ input: await rr(scrim), left: 0, top: 0 }];
  if (o.champion.id) comps.push({ input: await duoPanel(photoPath(tour, o.champion.id), PW, PH, 'winner'), left: PX, top: PY });
  comps.push({ input: await rr(top), left: 0, top: 0 });
  await renderOn(file, bg, comps);
}

async function titleOddsCard(o, tour, file) {
  if (o.status === 'final' && o.champion) { await championCard(o, tour, file); return; }
  const a = paletteFor(o.event, 'calls');
  const prevSnap = o.history?.length > 1 ? o.history[o.history.length - 2].odds : null;
  const top = o.odds.slice(0, 5);
  const maxProb = Math.max(...top.map((p) => p.prob), 0.01);
  const rowH = 122, startY = 348;
  const comps = [];
  let rowsSvg = '';
  for (let i = 0; i < top.length; i++) {
    const p = top[i], y = startY + i * rowH, pct = Math.round(p.prob * 100);
    const w = Math.max(16, (p.prob / maxProb) * 366);
    const prev = prevSnap?.[p.name];
    const delta = prev != null ? Math.round((p.prob - prev) * 100) : null;
    rowsSvg += `
    ${T('black', p.name.toUpperCase(), 214, y, fitT('black', p.name.toUpperCase(), 40, SQ - 214 - 210, 1), { fill: C_WHITE, tracking: 1 }).svg}
    <rect x="214" y="${y + 18}" width="${w.toFixed(0)}" height="24" rx="12" fill="url(#keyGrad)"/>
    ${T('anton', pct < 1 ? '<1%' : `${pct}%`, 214 + w + 18, y + 44, 46, { fill: a.key }).svg}
    ${delta ? deltaTag(SQ - 76, y - 6, delta) : ''}
    <line x1="80" y1="${y + 64}" x2="${SQ - 80}" y2="${y + 64}" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>`;
    if (p.id) comps.push({ input: await circlePhoto(photoPath(tour, p.id), 92), left: 92, top: y - 32 });
  }
  const hlW = measureT('anton', 'TITLE', 96) + 30;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'RACE' })}
  ${sMast(SQ, `${o.event} ${tour.toUpperCase()} · Who Wins It All`, a)}
  ${T('bebas', 'THE DRAW, SIMULATED 2,000× DAILY', 62, 200, 36, { fill: a.sub, tracking: 4 }).svg}
  ${T('anton', 'TITLE', 60, 300, 96, { fill: C_WHITE }).svg}${T('anton', 'RACE', 60 + hlW, 300, 96, { fill: a.key, skew: -6 }).svg}
  ${rowsSvg}
  ${sBar(SQ, SQ, 'SEE THE FULL DRAW  →', a, { sub: 'ARROWS = THE MOVE VS YESTERDAY' })}
  </svg>`;
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
  const a = paletteFor(o.event, 'calls');
  const cols = Math.min(4, nRounds);
  const colStart = nRounds - cols;
  const labels = [];
  for (let r = colStart; r < nRounds; r++) labels.push(roundLabel(field.length / Math.pow(2, r + 1)));
  const rows = field.map((p, i) => ({ ...p, surv: survival[i] || [] }))
    .sort((x, y2) => (y2.surv[nRounds - 1] || 0) - (x.surv[nRounds - 1] || 0))
    .slice(0, 8);
  const colX = (j) => 588 + j * 116;
  const comps = [];
  let grid = '';
  labels.forEach((l, j) => { grid += T('black', l, colX(j) + 48, 372, 22, { anchor: 'middle', fill: 'rgba(255,255,255,0.55)', tracking: 2 }).svg; });
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const y = 400 + i * 64;
    const ln = (p.name || '').split(' ').pop().toUpperCase();
    grid += T('black', ln, 176, y + 34, fitT('black', ln, 38, colX(0) - 176 - 24), { fill: C_WHITE }).svg;
    for (let j = 0; j < cols; j++) {
      const v = p.surv[colStart + j] ?? 0;
      const pct = v >= 0.995 ? '>99' : v < 0.005 ? '<1' : Math.round(v * 100);
      const alpha = Math.min(0.9, 0.08 + v * 0.82);
      grid += `<rect x="${colX(j)}" y="${y}" width="96" height="48" rx="10" fill="${a.key}" opacity="${alpha.toFixed(2)}"/>${T('black', `${pct}%`, colX(j) + 48, y + 32, 28, { anchor: 'middle', fill: v >= 0.4 ? a.ink[2] : C_WHITE }).svg}`;
    }
    if (p.id) comps.push({ input: await circlePhoto(photoPath(tour, p.id), 52), left: 108, top: y - 2 });
  }
  const foot = o.status === 'projection' ? "projected field · re-priced every refresh"
    : o.status === 'live' ? 'the remaining draw, simulated 2,000× daily'
      : 'our last look before the bracket was decided';
  const hlW = measureT('anton', 'THE ROAD TO', 84) + 28;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'DRAW' })}
  ${sMast(SQ, `${o.event} ${tour.toUpperCase()} · The Draw`, a)}
  ${T('anton', 'THE ROAD TO', 60, 268, fitT('anton', 'THE ROAD TO', 84, SQ - 120), { fill: C_WHITE }).svg}${T('anton', 'THE TITLE', 60 + hlW, 268, fitT('anton', 'THE TITLE', 84, SQ - 60 - hlW - 60), { fill: a.key, skew: -5 }).svg}
  ${grid}
  ${sBar(SQ, SQ, 'THE FULL DRAW  →', a, { sub: foot.toUpperCase() })}
  </svg>`;
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
  const a = paletteFor(o.event, 'calls');
  const PW = 420, PH = 558, PY = 300, PX = SQ - 60 - PW, colW = PX - 60 - 20;
  const bg = await duoStage(o.surface, SQ, SQ);
  let steps = '';
  for (let j = 0; j < cols; j++) {
    const v = fav.surv[colStart + j] ?? 0;
    const y = 500 + j * 96;
    const label = roundLabel(field.length / Math.pow(2, colStart + j + 1));
    const w = Math.max(14, v * (colW - 140));
    steps += `${T('black', label, 60, y, 26, { fill: 'rgba(255,255,255,0.65)', tracking: 3 }).svg}
      <rect x="60" y="${y + 14}" width="${w.toFixed(0)}" height="20" rx="10" fill="url(#keyGrad)"/>
      ${T('anton', `${v >= 0.995 ? '>99' : Math.round(v * 100)}%`, 60 + w + 16, y + 34, 44, { fill: C_WHITE }).svg}`;
  }
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.4"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.key}" fill-opacity="0.55" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${o.event} ${tour} · The Favorite`, a, { tour })}
    ${T('bebas', 'ROAD TO THE TITLE', 60, 232, 38, { fill: a.sub, tracking: 4 }).svg}
    ${T('anton', `${lastName}'S`, 60, 344, fitT('anton', `${lastName}'S`, 92, colW), { fill: C_WHITE }).svg}
    ${T('anton', 'PATH', 60, 432, fitT('anton', 'PATH', 92, colW), { fill: a.key, skew: -6 }).svg}
    ${steps}
    <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${a.key}" stroke-width="5"/>
    ${sPlate(PX + PW / 2, PY + PH + 40, lastName, a.key, true, a.ink[2])}
    ${sBar(SQ, SQ, 'THE FULL DRAW, ROUND BY ROUND', a)}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: await duoPanel(photoPath(tour, fav.p.id), PW, PH, 'winner'), left: PX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
  ]);
  return true;
}

// ── PROMO cards ────────────────────────────────────────────────────────────
async function proofCard(track, file) {
  const ms = track.matches || [];
  const n = ms.length;
  const acc = n ? Math.round(ms.filter((m) => pickCorrect(m)).length / n * 100) : 0;
  const odds = ms.filter((m) => m.oddCorrect != null);
  const us = odds.length ? Math.round(odds.filter((m) => pickCorrect(m)).length / odds.length * 100) : null;
  const them = odds.length ? Math.round(odds.filter((m) => m.oddCorrect).length / odds.length * 100) : null;
  const dis = odds.filter((m) => pickFav(m) !== m.oddFav);
  const disWin = dis.length ? Math.round(dis.filter((m) => pickCorrect(m)).length / dis.length * 100) : null;
  const a = PAL.receipts;
  const subTxt = `of winners called correctly · ${n.toLocaleString()} matches, all public`;
  const hero = T('anton', `${acc}%`, SQ / 2, 392, 244, { anchor: 'middle', fill: a.key });
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'RECEIPTS' })}
  ${sMast(SQ, `The Receipts · ${SEASON_YEAR} Season`, a)}
  ${T('bebas', 'GRADED IN PUBLIC, NO TAKE-BACKS', SQ / 2, 188, 38, { anchor: 'middle', fill: a.sub, tracking: 4 }).svg}
  <g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}
  ${T('body', subTxt, SQ / 2, 462, fitT('body', subTxt, 31, SQ - 150), { anchor: 'middle', fill: C_MUTE }).svg}
  ${us != null ? `
  <line x1="200" y1="516" x2="${SQ - 200}" y2="516" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  ${T('anton', `${us}%`, SQ / 2 - 196, 632, 104, { anchor: 'middle', fill: C_WHITE }).svg}
  ${T('black', 'US', SQ / 2 - 196, 676, 24, { anchor: 'middle', fill: a.sub, tracking: 2 }).svg}
  ${T('anton', 'vs', SQ / 2, 622, 52, { anchor: 'middle', fill: 'rgba(255,255,255,0.45)' }).svg}
  ${T('anton', `${them}%`, SQ / 2 + 196, 632, 104, { anchor: 'middle', fill: 'rgba(255,255,255,0.62)' }).svg}
  ${T('black', 'THE BOOKIES', SQ / 2 + 196, 676, 24, { anchor: 'middle', fill: 'rgba(255,255,255,0.5)', tracking: 2 }).svg}` : ''}
  ${disWin != null ? T('body', `When we disagree with the book, we're right ${disWin}% of the time`, SQ / 2, 770, fitT('body', `When we disagree with the book, we're right ${disWin}% of the time`, 29, SQ - 150), { anchor: 'middle', fill: a.key }).svg : ''}
  ${sBar(SQ, SQ, 'SEE THE FULL LEDGER  →', a, { sub: 'NO CHERRY-PICKING · MISSES POSTED TOO' })}
  </svg>`;
  await render(file, base);
}

async function howItWorks(sc, file1, file2, file3) {
  const a = PAL.calls;
  const slide = (num, ghost, kicker, h1, h2, sub, note, cta) => `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sStage(a, SQ, SQ, { ghost })}
    ${sMast(SQ, `How It Works · ${num} of 3`, a)}
    ${T('bebas', kicker, SQ / 2, 262, 40, { anchor: 'middle', fill: a.sub, tracking: 5 }).svg}
    ${T('anton', h1, SQ / 2, 452, fitT('anton', h1, 108, SQ - 130), { anchor: 'middle', fill: C_WHITE }).svg}
    ${T('anton', h2, SQ / 2, 566, fitT('anton', h2, 108, SQ - 130), { anchor: 'middle', fill: a.key, skew: -6 }).svg}
    ${T('body', sub, SQ / 2, 646, fitT('body', sub, 33, SQ - 150), { anchor: 'middle', fill: C_MUTE }).svg}
    ${T('bodyMed', note, SQ / 2, 700, fitT('bodyMed', note, 27, SQ - 150), { anchor: 'middle', fill: 'rgba(255,255,255,0.42)' }).svg}
    ${sBar(SQ, SQ, cta, a)}
    </svg>`;
  await render(file1, slide(1, 'EXACT', 'STEP ONE', 'WE COMPUTE EVERY MATCH', 'POINT BY POINT', 'every path the match can take, before it happens', 'real serve + return stats, per surface, recency-weighted', 'HOW THE MODEL THINKS'));
  await render(file2, slide(2, 'PICK', 'STEP TWO', 'THEN WE CALL IT,', 'IN PUBLIC', 'win probability · exact score · upset risk', 'locked before play - no edits, no take-backs', 'CALLED BEFORE PLAY'));
  await render(file3, slide(3, `${sc.season.acc}%`, 'STEP THREE', 'THEN THE RESULTS', 'GRADE US', sc.proofLine, 'every hit and every miss on the record, updated daily', 'GRADED IN PUBLIC  →'));
}

async function poolPromoCard(file) {
  const a = PAL.calls;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'POOL' })}
  ${sMast(SQ, 'Dream Brackets · Free to Play', a)}
  ${T('bebas', 'BRACKET POOLS', 62, 200, 42, { fill: a.sub, tracking: 6 }).svg}
  ${T('anton', 'BEAT', 60, 396, 172, { fill: C_WHITE }).svg}
  ${T('anton', 'THE HOUSE', 60, 560, fitT('anton', 'THE HOUSE', 172, SQ - 120), { fill: a.key, skew: -7 }).svg}
  ${T('body', 'Build your bracket. Lock it before the draw plays out.', 64, 648, 32, { fill: C_MUTE }).svg}
  ${T('body', 'Our model enters every pool - beat it if you can.', 64, 692, 32, { fill: C_MUTE }).svg}
  ${sChip(SQ / 2, 752, 'FREE · DREAM BRACKETS', a)}
  ${sBar(SQ, SQ, 'BUILD YOUR BRACKET  →', a)}
  </svg>`;
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

  const a = PAL.receipts; // collectible gold
  const PW = 420, PH = 600, PY = 300, PX = SQ - 60 - PW, colW = PX - 60 - 30;
  const bg = await duoStage('brand', SQ, SQ);
  const fFs = fitT('anton', 'FIRE', 118, colW);
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.4"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${a.key}" fill-opacity="0.55" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, 'Hottest Racket Right Now', a, { tour })}
    ${T('bebas', 'FORM WATCH', 60, 232, 38, { fill: a.sub, tracking: 5 }).svg}
    ${T('anton', 'ON', 60, 366, fFs, { fill: C_WHITE }).svg}
    ${T('anton', 'FIRE', 60, 366 + Math.round(fFs * 0.92), fFs, { fill: a.key, skew: -7 }).svg}
    ${T('anton', `${hot.w}-${hot.l}`, 62, 636, 96, { fill: a.key }).svg}
    ${T('body', `recent matches${hot.rank ? ` · World No. ${hot.rank}` : ''}`, 62, 686, fitT('body', `recent matches${hot.rank ? ` · World No. ${hot.rank}` : ''}`, 26, colW), { fill: C_MUTE }).svg}
    <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${a.key}" stroke-width="5"/>
    ${sPlate(PX + PW / 2, PY + PH + 42, hot.name.toUpperCase(), a.key, true, a.ink[2])}
    ${sBar(SQ, SQ, 'FORM IS LOUD, RECEIPTS ARE LOUDER', a, { sub: `SMASH SERIES · ${SEASON_YEAR}` })}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: await duoPanel(photoPath(tour, hot.id), PW, PH, 'winner'), left: PX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
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
  const favWon = pickFav(m) === m.winner;
  const actualFav = favWon ? `${w}–${l}` : `${l}–${w}`;
  return m.predScore === actualFav;
}

// A period report card (tournament wrap / weekly recap share the layout).
// `accent` switches the headline metal: lime for calls, gold for trophies.
async function reportCard({ eyebrowText, headline1, headline2, stats, footNote, file, accent = PAL.calls.key, cta }) {
  const a = { key: accent, sub: accent === PAL.calls.key ? PAL.calls.sub : PAL.calls.key, ink: INK_INDIGO };
  const hFs = Math.min(fitT('anton', headline1, 130, SQ - 140), headline2 ? fitT('anton', headline2, 130, SQ - 140) : 130);
  const h2Y = 262 + Math.round(hFs * 0.9);
  const startY = (headline2 ? h2Y : 262) + 118;
  const step = stats.length >= 4 ? 104 : 118;
  const rows = stats.map((s, i) => {
    const y = startY + i * step;
    return `
    ${T('anton', s.value, 120, y, fitT('anton', s.value, 72, 560), { fill: i === 0 ? a.key : C_WHITE }).svg}
    ${T('body', s.label, SQ - 120, y - 6, fitT('body', s.label, 27, 400), { anchor: 'end', fill: 'rgba(255,255,255,0.72)' }).svg}
    <line x1="120" y1="${y + 24}" x2="${SQ - 120}" y2="${y + 24}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
  }).join('');
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: (headline2 || headline1 || '').split(' ')[0] })}
  ${sMast(SQ, eyebrowText, a)}
  ${T('anton', headline1, 60, 262, hFs, { fill: C_WHITE }).svg}
  ${headline2 ? T('anton', headline2, 60, h2Y, hFs, { fill: a.key, skew: -6 }).svg : ''}
  ${rows}
  ${sBar(SQ, SQ, cta || 'SEE EVERY GRADED CALL  →', a, footNote ? { sub: footNote.toUpperCase() } : {})}
  </svg>`;
  await render(file, base);
}

// Rivalry card: an upcoming pick where the pair has real history.
async function rivalryCard(p, h2hRec, ourRecord, file) {
  const a = paletteFor(p.event, 'calls');
  const favIsP1 = p.favorite === p.p1;
  const PW = 402, PH = 452, PY = 456, aX = 60, bX = SQ - 60 - PW, midY = PY + PH / 2;
  const bg = await duoStage(p.surface, SQ, SQ);
  const [aImg, bImg] = await Promise.all([
    duoPanel(photoPath(p.tour, p.p1), PW, PH, favIsP1 ? 'winner' : 'loser'),
    duoPanel(photoPath(p.tour, p.p2), PW, PH, favIsP1 ? 'loser' : 'winner'),
  ]);
  const meetings = h2hRec.w1 + h2hRec.w2;
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.36"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.18}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${aX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${favIsP1 ? a.key : a.sub}" fill-opacity="${favIsP1 ? 0.5 : 0.3}" filter="url(#pglow)"/>
    <rect x="${bX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${favIsP1 ? a.sub : a.key}" fill-opacity="${favIsP1 ? 0.3 : 0.5}" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${p.event} · ${fmtDate(p.date)}`, a, { tour: p.tour })}
    ${T('bebas', 'THEY MEET AGAIN', 60, 180, 38, { fill: a.sub, tracking: 5 }).svg}
    ${T('anton', 'THE RIVALRY,', 60, 296, fitT('anton', 'THE RIVALRY,', 92, SQ - 120), { fill: C_WHITE }).svg}
    ${T('anton', `ROUND ${meetings + 1}`, 60, 392, fitT('anton', `ROUND ${meetings + 1}`, 92, SQ - 120), { fill: a.key, skew: -6 }).svg}
    <rect x="${aX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${favIsP1 ? a.key : 'rgba(255,255,255,0.5)'}" stroke-width="${favIsP1 ? 4 : 3}"/>
    <rect x="${bX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${favIsP1 ? 'rgba(255,255,255,0.5)' : a.key}" stroke-width="${favIsP1 ? 3 : 4}"/>
    <circle cx="${SQ / 2}" cy="${midY}" r="54" fill="${a.ink[2]}" stroke="${a.key}" stroke-width="3"/>
    ${T('anton', `${h2hRec.w1}-${h2hRec.w2}`, SQ / 2, midY + 16, 46, { anchor: 'middle', fill: C_WHITE }).svg}
    ${sPlate(aX + PW / 2, PY + PH - 28, last(p.name1).toUpperCase(), favIsP1 ? a.key : C_WHITE, favIsP1, a.ink[2])}
    ${sPlate(bX + PW / 2, PY + PH - 28, last(p.name2).toUpperCase(), favIsP1 ? C_WHITE : a.key, !favIsP1, a.ink[2])}
    ${sBar(SQ, SQ, ourRecord && ourRecord.n > 0
      ? `WE'VE CALLED ${ourRecord.correct} OF ${ourRecord.n} MEETINGS`
      : `OUR CALL: ${last(p.favName).toUpperCase()} · ${pctTxt(p.favProb)}`, a)}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: aImg, left: aX, top: PY },
    { input: bImg, left: bX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
  ]);
}

// ── HYPE: the next grand slam, promoted ─────────────────────────────────────
// Photo countdown hero: the slam's own stadium, the day count, and the
// promise ("picks live the moment the draw drops").
async function hypeCountdownCard(next, days, file) {
  const a = SLAM_PAL[next.label] || PAL.calls;
  const bg = await duoStage(next.surface, SQ, SQ);
  const dateTxt = new Date(next.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const hero = T('anton', String(days), SQ / 2, 700, 300, { anchor: 'middle', fill: a.key });
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.42"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.2}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, 'The Next Major', a)}
    ${T('bebas', 'COUNTDOWN', SQ / 2, 250, 42, { anchor: 'middle', fill: a.sub, tracking: 7 }).svg}
    ${T('anton', next.label.toUpperCase(), SQ / 2, 360, fitT('anton', next.label.toUpperCase(), 120, SQ - 120), { anchor: 'middle', fill: C_WHITE }).svg}
    <g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}
    ${T('black', 'DAYS TO GO', SQ / 2, 770, 34, { anchor: 'middle', fill: C_WHITE, tracking: 6 }).svg}
    ${T('body', `first ball ${dateTxt} · ${next.surface} court`, SQ / 2, 828, fitT('body', `first ball ${dateTxt} · ${next.surface} court`, 27, SQ - 140), { anchor: 'middle', fill: C_MUTE }).svg}
    ${sBar(SQ, SQ, 'PICKS DROP WHEN THE DRAW DOES  →', a)}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [{ input: await rr(scrim), left: 0, top: 0 }, { input: await rr(top), left: 0, top: 0 }]);
}

// Projected favorites for the next slam - only when the off-season
// projection is live in title_odds.json (it replaces the last slam's final
// state once ESPN's event ages out).
async function hypeFavoritesCard(o, tour, file) {
  const top = (o.odds || []).filter((p) => p.prob > 0).slice(0, 5);
  if (top.length < 5) return false;
  const a = paletteFor(o.event, 'calls');
  const maxProb = Math.max(...top.map((p) => p.prob), 0.01);
  const rowH = 122, startY = 348;
  const comps = [];
  let rowsSvg = '';
  for (let i = 0; i < top.length; i++) {
    const p = top[i], y = startY + i * rowH, pct = Math.round(p.prob * 100);
    const w = Math.max(16, (p.prob / maxProb) * 380);
    rowsSvg += `
    ${T('black', p.name.toUpperCase(), 214, y, fitT('black', p.name.toUpperCase(), 40, SQ - 214 - 170, 1), { fill: C_WHITE, tracking: 1 }).svg}
    <rect x="214" y="${y + 18}" width="${w.toFixed(0)}" height="24" rx="12" fill="url(#keyGrad)"/>
    ${T('anton', pct < 1 ? '<1%' : `${pct}%`, 214 + w + 18, y + 44, 46, { fill: a.key }).svg}
    <line x1="80" y1="${y + 64}" x2="${SQ - 80}" y2="${y + 64}" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>`;
    if (p.id) comps.push({ input: await circlePhoto(photoPath(tour, p.id), 92), left: 92, top: y - 32 });
  }
  const hlW = measureT('anton', 'THE', 96) + 30;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'NEXT' })}
  ${sMast(SQ, `${o.event} ${tour.toUpperCase()} · Projected Field`, a)}
  ${T('bebas', 'PRICED FROM DAY ONE', 62, 200, 36, { fill: a.sub, tracking: 4 }).svg}
  ${T('anton', 'THE', 60, 300, 96, { fill: C_WHITE }).svg}${T('anton', 'FAVORITES', 60 + hlW, 300, fitT('anton', 'FAVORITES', 96, SQ - 60 - hlW - 60), { fill: a.key, skew: -6 }).svg}
  ${rowsSvg}
  ${sBar(SQ, SQ, 'RE-PRICED UNTIL THE DRAW DROPS  →', a, { sub: "FROM TODAY'S RANKINGS · SIMULATED 2,000×" })}
  </svg>`;
  await render(file, base, comps);
  return true;
}

// Story-format countdown: day count + the model's record on the slam's
// surface + the promise, sized for an Instagram story.
async function hypeStoryCard(next, days, recs, file) {
  const a = SLAM_PAL[next.label] || PAL.calls;
  const hero = T('anton', String(days), ST_W / 2, 900, 400, { anchor: 'middle', fill: a.key });
  const recRows = recs.map((r, i) => T('body', `${r.tour.toUpperCase()} on ${next.surface} this season: ${r.acc}% of winners called`, ST_W / 2, 1180 + i * 58, fitT('body', `${r.tour.toUpperCase()} on ${next.surface} this season: ${r.acc}% of winners called`, 30, ST_W - 140), { anchor: 'middle', fill: C_MUTE }).svg).join('');
  const base = `<svg width="${ST_W}" height="${ST_H}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, ST_W, ST_H, { ghost: 'MAJOR' })}
  ${sMast(ST_W, 'The Next Major', a)}
  ${T('bebas', 'COUNTDOWN', ST_W / 2, 320, 46, { anchor: 'middle', fill: a.sub, tracking: 8 }).svg}
  ${T('anton', next.label.toUpperCase(), ST_W / 2, 440, fitT('anton', next.label.toUpperCase(), 130, ST_W - 120), { anchor: 'middle', fill: C_WHITE }).svg}
  <g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}
  ${T('black', 'DAYS TO GO', ST_W / 2, 1000, 40, { anchor: 'middle', fill: C_WHITE, tracking: 8 }).svg}
  ${recRows}
  ${recs.length ? T('bodyMed', 'season benchmark, re-simulated daily', ST_W / 2, 1180 + recs.length * 58 + 12, 24, { anchor: 'middle', fill: 'rgba(255,255,255,0.42)' }).svg : ''}
  ${sBar(ST_W, ST_H, 'LOCKED BEFORE PLAY, GRADED IN PUBLIC', a, { sub: 'THE DRAW, PRICED FROM DAY ONE' })}
  </svg>`;
  await render(file, base);
}

// ── RECEIPTS: called-it as a ticket stub ───────────────────────────────────
// The "we called it" card reborn as a collectible: cream paper stub with a
// perforated edge, barcode, and serial. Pure SVG, so it supersamples.
function ticketBarcode(x, y, h, seedStr) {
  let seed = 0;
  for (const ch of String(seedStr)) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bars = '', bx = x;
  for (let i = 0; i < 26; i++) {
    const w = 3 + Math.floor(rand() * 8);
    if (i % 2 === 0) bars += `<rect x="${bx}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`;
    bx += w + 3;
  }
  return bars;
}

async function receiptTicket(p, file) {
  const opp = p.favorite === p.p1 ? p.name2 : p.name1;
  const hit = !!p.correct;
  const pct = Math.round(p.favProb * 100);
  const a = paletteFor(p.event, 'receipts');
  const INKT = '#141210'; // ticket ink
  const TX = 90, TY = 320, TW = 900, TH = 500, PERF = TX + 640;
  const stampColor = hit ? '#1c7a3f' : '#b3392e';
  const mark = hit
    ? `<polyline points="${TX + 556},${TY + 128} ${TX + 574},${TY + 146} ${TX + 604},${TY + 102}" fill="none" stroke="${stampColor}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<g stroke="${stampColor}" stroke-width="9" stroke-linecap="round"><line x1="${TX + 562}" y1="${TY + 106}" x2="${TX + 600}" y2="${TY + 144}"/><line x1="${TX + 600}" y1="${TY + 106}" x2="${TX + 562}" y2="${TY + 144}"/></g>`;
  const stamp = `<g transform="rotate(-9 ${TX + 470} ${TY + 122})">
    <rect x="${TX + 330}" y="${TY + 80}" width="300" height="86" rx="12" fill="none" stroke="${stampColor}" stroke-width="7"/>
    ${T('anton', hit ? 'CALLED' : 'MISSED', TX + 360, TY + 142, 52, { fill: stampColor }).svg}
    ${mark}</g>`;
  const result = `${p.winner === p.favorite ? 'WON' : 'LOST'}${p.score ? ` ${p.score}` : ''}`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: hit ? 'CALLED' : 'MISSED' })}
  ${sMast(SQ, 'The Receipts · Graded in Public', a)}
  ${T('bebas', hit ? 'WE CALLED IT' : 'THE ONE WE OWN', SQ / 2, 216, 40, { anchor: 'middle', fill: a.sub, tracking: 4 }).svg}
  <g transform="rotate(-2 ${SQ / 2} ${TY + TH / 2})">
    <rect x="${TX + 10}" y="${TY + 14}" width="${TW}" height="${TH}" rx="20" fill="rgba(0,0,0,0.45)"/>
    <rect x="${TX}" y="${TY}" width="${TW}" height="${TH}" rx="20" fill="#f2eee2"/>
    <line x1="${PERF}" y1="${TY + 14}" x2="${PERF}" y2="${TY + TH - 14}" stroke="#b9b2a0" stroke-width="3" stroke-dasharray="4 12"/>
    <circle cx="${PERF}" cy="${TY}" r="18" fill="${a.ink[1]}"/>
    <circle cx="${PERF}" cy="${TY + TH}" r="18" fill="${a.ink[2]}"/>
    ${T('black', 'SMASH · OFFICIAL CALL', TX + 44, TY + 60, 21, { fill: 'rgba(20,24,30,0.55)', tracking: 3 }).svg}
    ${T('body', `${p.event || 'Tour'} · ${fmtDate(p.date)}`, TX + 44, TY + 100, 24, { fill: 'rgba(20,24,30,0.72)' }).svg}
    ${T('anton', last(p.favName).toUpperCase(), TX + 44, TY + 206, fitT('anton', last(p.favName).toUpperCase(), 84, PERF - TX - 80), { fill: INKT }).svg}
    ${T('body', `over ${opp} · our number ${pct}%`, TX + 44, TY + 252, fitT('body', `over ${opp} · our number ${pct}%`, 26, PERF - TX - 80), { fill: 'rgba(20,24,30,0.7)' }).svg}
    ${T('anton', result, TX + 44, TY + 328, fitT('anton', result, 46, PERF - TX - 80), { fill: INKT }).svg}
    ${T('bodyMed', 'locked before play · no edits, no take-backs', TX + 44, TY + 372, 22, { fill: 'rgba(20,24,30,0.55)' }).svg}
    ${stamp}
    <g transform="rotate(90 ${PERF + 208} ${TY + 96})">${T('black', `CALL NO. ${String(p.id).slice(-6)}`, PERF + 208, TY + 96, 22, { anchor: 'middle', fill: 'rgba(20,24,30,0.6)', tracking: 3 }).svg}</g>
    ${T('anton', `${pct}%`, PERF + 44, TY + 250, 96, { fill: INKT }).svg}
    ${T('bodyMed', 'stated win chance', PERF + 44, TY + 292, 21, { fill: 'rgba(20,24,30,0.6)' }).svg}
    ${ticketBarcode(PERF + 44, TY + TH - 128, 76, p.id)}
  </g>
  ${sBar(SQ, SQ, hit ? 'EVERY CALL COLLECTS A RECEIPT  →' : 'WINS AND MISSES, BOTH POSTED  →', a)}
  </svg>`;
  await render(file, base);
}

// ── DAILY: title-odds movers (risers and fallers overnight) ────────────────
async function oddsMoversCard(o, tour, file) {
  const hist = o.history || [];
  if (hist.length < 2 || o.status !== 'live') return false;
  const cur = hist[hist.length - 1].odds || {};
  const prev = hist[hist.length - 2].odds || {};
  const deltas = (o.odds || [])
    .map((p) => ({ ...p, delta: prev[p.name] != null ? p.prob - prev[p.name] : 0 }))
    .filter((p) => Math.abs(p.delta) >= 0.02);
  if (!deltas.length) return false;
  const riser = [...deltas].sort((a, b) => b.delta - a.delta)[0];
  const faller = [...deltas].sort((a, b) => a.delta - b.delta)[0];
  if (!riser || riser.delta <= 0) return false;

  const a = paletteFor(o.event, 'calls');
  const spark = (name) => {
    const series = hist.map((h) => h.odds?.[name]).filter((v) => v != null);
    if (series.length < 2) return '';
    const maxV = Math.max(...series, 0.01);
    const pts = series.map((v, i) => `${(i / (series.length - 1)) * 240},${54 - (v / maxV) * 50}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${a.key}" stroke-opacity="0.7" stroke-width="4"/>`;
  };
  const comps = [];
  const row = (p, y, up) => {
    const pct = Math.round(p.prob * 100), d = Math.round(Math.abs(p.delta) * 100), col = up ? '#3ddc84' : '#ff5c5c';
    const numW = measureT('anton', String(d), 108), triR = SQ - 96 - numW - 18, triL = triR - 46, triC = (triL + triR) / 2;
    const tri = up
      ? `<polygon points="${triL},${y + 20} ${triR},${y + 20} ${triC},${y - 22}" fill="${col}"/>`
      : `<polygon points="${triL},${y - 22} ${triR},${y - 22} ${triC},${y + 20}" fill="${col}"/>`;
    return `
    ${T('anton', p.name.toUpperCase(), 250, y, fitT('anton', p.name.toUpperCase(), 58, SQ - 250 - 330), { fill: C_WHITE }).svg}
    ${T('body', `title chance today: ${pct < 1 ? '<1' : pct}%`, 250, y + 48, 27, { fill: C_MUTE }).svg}
    <g transform="translate(250 ${y + 72})">${spark(p.name)}</g>
    ${tri}${T('anton', String(d), SQ - 96, y + 16, 108, { anchor: 'end', fill: col }).svg}
    ${T('black', 'PTS OVERNIGHT', SQ - 96, y + 56, 22, { anchor: 'end', fill: 'rgba(255,255,255,0.6)', tracking: 2 }).svg}`;
  };
  if (riser.id) comps.push({ input: await circlePhoto(photoPath(tour, riser.id), 140), left: 84, top: 384 });
  if (faller?.id && faller.delta < 0) comps.push({ input: await circlePhoto(photoPath(tour, faller.id), 140), left: 84, top: 664 });
  const hlW = measureT('anton', 'ODDS', 96) + 30;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'ODDS' })}
  ${sMast(SQ, `${o.event} ${tour.toUpperCase()} · The Market Moved`, a)}
  ${T('anton', 'ODDS', 60, 300, 96, { fill: C_WHITE }).svg}${T('anton', 'MOVERS', 60 + hlW, 300, fitT('anton', 'MOVERS', 96, SQ - 60 - hlW - 60), { fill: a.key, skew: -6 }).svg}
  ${row(riser, 444, true)}
  ${faller && faller.delta < 0 ? row(faller, 724, false) : ''}
  ${sBar(SQ, SQ, 'THE DRAW, RE-PRICED DAILY  →', a, { sub: 'MOVES SINCE YESTERDAY · SIMULATED 2,000×' })}
  </svg>`;
  await render(file, base, comps);
  return true;
}

// ── MOMENTS: streak detector ───────────────────────────────────────────────
// Longest CURRENT run of consecutive correct deployed calls in any tour x
// surface cell. Only posts when it grows past the last posted mark.
function currentStreaks(track) {
  const cells = new Map();
  for (const m of track.matches || []) {
    const k = `${m.tour}|${m.surface}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(m);
  }
  const out = [];
  for (const [k, list] of cells) {
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    let n = 0;
    for (const m of list) { if (pickCorrect(m)) n++; else break; }
    out.push({ key: k, len: n, tour: k.split('|')[0], surface: k.split('|')[1] });
  }
  return out.sort((a, b) => b.len - a.len);
}

async function streakCard(streak, file) {
  const a = PAL.calls;
  const hero = T('anton', String(streak.len), SQ / 2, 476, 300, { anchor: 'middle', fill: a.key });
  const sub = `${streak.tour.toUpperCase()} ${streak.surface}-court winners called in a row`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'HOT' })}
  ${sMast(SQ, 'The Model Is Rolling', a)}
  ${T('bebas', 'ON A HEATER', SQ / 2, 200, 40, { anchor: 'middle', fill: a.sub, tracking: 5 }).svg}
  <g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}
  ${T('anton', 'STRAIGHT', SQ / 2, 572, fitT('anton', 'STRAIGHT', 100, SQ - 140), { anchor: 'middle', fill: C_WHITE, skew: -5 }).svg}
  ${T('body', sub, SQ / 2, 644, fitT('body', sub, 32, SQ - 150), { anchor: 'middle', fill: C_MUTE }).svg}
  ${sBar(SQ, SQ, 'STREAKS END, RECEIPTS DON’T  →', a)}
  </svg>`;
  await render(file, base);
}

// ── MOMENTS: upset autopsy ─────────────────────────────────────────────────
// After a seed falls: what we said, what the market said, side by side.
async function upsetAutopsyCard(m, wRank, lRank, tour, file) {
  const wName = m.winner === m.p1 ? m.name1 : m.name2;
  const lName = m.winner === m.p1 ? m.name2 : m.name1;
  const weCalled = pickFav(m) === m.winner;
  const wePct = Math.round(pickFavProb(m) * 100);
  const marketCalled = m.oddFav != null ? m.oddFav === m.winner : null;
  const a = PAL.upset;
  const wid = m.winner === m.p1 ? m.p1 : m.p2;
  const comps = [{ input: await circlePhoto(photoPath(tour, wid), 156), left: SQ / 2 - 78, top: 262 }];
  const matchup = `${last(wName).toUpperCase()} D. ${last(lName).toUpperCase()}`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'UPSET' })}
  ${sMast(SQ, `${m.event || 'Tour'} · Seed Down`, a)}
  ${T('anton', 'UPSET', SQ / 2, 232, 116, { anchor: 'middle', fill: a.key }).svg}
  ${T('anton', matchup, SQ / 2, 494, fitT('anton', matchup, 58, SQ - 140), { anchor: 'middle', fill: C_WHITE }).svg}
  ${T('body', `No. ${wRank} beats No. ${lRank}${m.score ? ` · ${m.score}` : ''}`, SQ / 2, 540, fitT('body', `No. ${wRank} beats No. ${lRank}${m.score ? ` · ${m.score}` : ''}`, 28, SQ - 160), { anchor: 'middle', fill: C_MUTE }).svg}
  ${statRow(632, 'OUR CALL', weCalled ? `CALLED IT · ${wePct}% ${last(wName).toUpperCase()}` : `MISSED · ${wePct}% ${last(lName).toUpperCase()}`, weCalled ? '#3ddc84' : '#ff5c5c')}
  ${statRow(712, 'THE MARKET', marketCalled == null ? 'NO LINE' : marketCalled ? 'SAW IT COMING' : 'FOOLED TOO', marketCalled == null ? C_WHITE : marketCalled ? '#3ddc84' : '#ff5c5c')}
  ${statRow(792, 'THE RANKINGS', 'NEVER SAW IT', '#ff5c5c')}
  ${sBar(SQ, SQ, 'GRADED EITHER WAY  →', a, { sub: "THAT'S THE WHOLE POINT" })}
  </svg>`;
  await render(file, base, comps);
}

// ── EDGE: us vs the betting market, graded ─────────────────────────────────
// Vig-stripped implied probability for p1 from decimal closing odds (same
// math as src/pages/EdgeBoard.js - keep in step).
function impliedP1(od1, od2) {
  const r1 = 1 / od1, r2 = 1 / od2;
  return r1 / (r1 + r2);
}

// The biggest recent SPLIT: a graded match where our pick and the market's
// favorite differed. Both calls on the card, both graded - the honesty is
// the aesthetic.
async function edgeSplitCard(m, tour, file) {
  const ourFavIsP1 = pickFav(m) === m.p1;
  const ourName = ourFavIsP1 ? m.name1 : m.name2;
  const mktName = m.oddFav === m.p1 ? m.name1 : m.name2;
  const ourPct = Math.round(pickFavProb(m) * 100);
  const mktP1 = impliedP1(m.od1, m.od2);
  const mktPct = Math.round((m.oddFav === m.p1 ? mktP1 : 1 - mktP1) * 100);
  const weWon = pickCorrect(m);
  const a = PAL.edge;
  const wName = m.winner === m.p1 ? m.name1 : m.name2;
  const comps = [{ input: await circlePhoto(photoPath(tour, m.winner), 156), left: SQ / 2 - 78, top: 268 }];
  const wonLine = `${last(wName).toUpperCase()} WON`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'SPLIT' })}
  ${sMast(SQ, `${m.event || 'Tour'} · The Split`, a)}
  ${centerLine(SQ, 236, fitT('anton', 'THE EDGE', 110, SQ - 140), [{ t: 'THE ', c: C_WHITE }, { t: weWon ? 'EDGE' : 'MISS', c: weWon ? a.key : '#ff5c5c', skew: -6 }])}
  ${T('anton', wonLine, SQ / 2, 508, fitT('anton', wonLine, 56, SQ - 140), { anchor: 'middle', fill: C_WHITE }).svg}
  ${m.score ? T('body', m.score, SQ / 2, 550, 30, { anchor: 'middle', fill: C_MUTE }).svg : ''}
  ${statRow(640, 'WE SAID', `${last(ourName).toUpperCase()} · ${ourPct}%`, weWon ? '#3ddc84' : '#ff5c5c')}
  ${statRow(720, 'MARKET SAID', `${last(mktName).toUpperCase()} · ${mktPct}%`, m.oddCorrect ? '#3ddc84' : '#ff5c5c')}
  ${sBar(SQ, SQ, 'EVERY SPLIT, GRADED  →', a, { sub: 'ONE SIDE IS RIGHT · BOTH GET GRADED' })}
  </svg>`;
  await render(file, base, comps);
}

// The $1 test: flat-stake payout of our picks vs the market's own favorites
// across every graded split, settled at the closing odds. The honesty
// footnote is non-negotiable - this card flirts with betting language.
async function dollarTestCard(edge, file) {
  const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;
  await reportCard({
    eyebrowText: 'The Edge · The $1 Test',
    headline1: '$1 ON EVERY',
    headline2: 'SPLIT',
    stats: [
      { value: money(edge.usNet), label: `our picks, net of $${edge.n} staked` },
      { value: money(edge.mktNet), label: "the market's own favorites, same stakes" },
      { value: `${edge.usAcc}% VS ${edge.mktAcc}%`, label: `winners called on the ${edge.n} splits` },
    ],
    footNote: 'hypothetical · settled at closing odds · not betting advice',
    file,
    accent: edge.usNet >= 0 ? PAL.edge.key : '#ff5c5c',
    cta: 'THE EDGE BOARD  →',
  });
}

// A FORWARD split: a still-pending pick where we back the market's underdog
// at lock time. The receipt is written before the match - that's the brag.
async function forwardEdgeCard(p, mktPct, file) {
  const a = PAL.edge;
  const oppName = p.favorite === p.p1 ? p.name2 : p.name1;
  const comps = [{ input: await circlePhoto(photoPath(p.tour, p.favorite), 160), left: SQ / 2 - 80, top: 268 }];
  const matchup = `${last(p.favName).toUpperCase()} OVER ${last(oppName).toUpperCase()}`;
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'LOCKED' })}
  ${sMast(SQ, `${p.event || 'Tour'} · Locked, Not Yet Played`, a)}
  ${centerLine(SQ, 234, fitT('anton', 'WE TOOK THE DOG', 92, SQ - 140), [{ t: 'WE TOOK THE ', c: C_WHITE }, { t: 'DOG', c: a.key, skew: -6 }])}
  ${T('anton', matchup, SQ / 2, 516, fitT('anton', matchup, 56, SQ - 140), { anchor: 'middle', fill: C_WHITE }).svg}
  ${statRow(636, 'WE SAY', `${last(p.favName).toUpperCase()} · ${Math.round(p.favProb * 100)}%`, a.key)}
  ${statRow(716, 'MARKET SAYS', `${last(p.favName).toUpperCase()} · ONLY ${mktPct}%`, C_WHITE)}
  ${sBar(SQ, SQ, 'THE FORWARD BOARD  →', a, { sub: 'ODDS CAUGHT AT LOCK · GRADED IN DAYS' })}
  </svg>`;
  await render(file, base, comps);
}

// ── DAILY: tale of the tape for the marquee matchup ────────────────────────
async function taleOfTheTape(p, ctx, forms, file) {
  const a = paletteFor(p.event, 'calls');
  const favIsP1 = p.favorite === p.p1;
  const PW = 330, PH = 430, PY = 356, aX = 64, bX = SQ - 64 - PW;
  const bg = await duoStage(p.surface, SQ, SQ);
  const [aImg, bImg] = await Promise.all([
    duoPanel(photoPath(p.tour, p.p1), PW, PH, favIsP1 ? 'winner' : 'loser'),
    duoPanel(photoPath(p.tour, p.p2), PW, PH, favIsP1 ? 'loser' : 'winner'),
  ]);
  const f1 = forms.get(p.p1), f2 = forms.get(p.p2);
  const midRow = (y, label, va, vb) => `
    ${T('black', label, SQ / 2, y, 22, { anchor: 'middle', fill: 'rgba(255,255,255,0.5)', tracking: 3 }).svg}
    ${T('anton', va, SQ / 2 - 94, y + 48, 46, { anchor: 'middle', fill: favIsP1 ? a.key : C_WHITE }).svg}
    ${T('anton', vb, SQ / 2 + 94, y + 48, 46, { anchor: 'middle', fill: favIsP1 ? C_WHITE : a.key }).svg}`;
  const hlW = measureT('anton', 'TALE OF', 96) + 50;
  const scrim = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    <rect width="${SQ}" height="${SQ}" fill="#000" fill-opacity="0.36"/>
    <ellipse cx="${SQ * 0.5}" cy="${SQ * 0.16}" rx="${SQ * 0.7}" ry="${SQ * 0.4}" fill="url(#bloom2)"/>
    <polygon points="${SQ},0 ${SQ},${SQ * 0.08} ${SQ * 0.86},0" fill="${a.key}"/>
    <rect x="${aX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${favIsP1 ? a.key : a.sub}" fill-opacity="${favIsP1 ? 0.5 : 0.3}" filter="url(#pglow)"/>
    <rect x="${bX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="34" fill="${favIsP1 ? a.sub : a.key}" fill-opacity="${favIsP1 ? 0.3 : 0.5}" filter="url(#pglow)"/>
    <rect width="${SQ}" height="${SQ}" fill="url(#vig)"/></svg>`;
  const top = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
    ${sMast(SQ, `${p.event} · ${fmtDate(p.date)} · The Marquee`, a, { tour: p.tour })}
    ${T('anton', 'TALE OF ', 60, 296, 96, { fill: C_WHITE }).svg}
    ${T('anton', 'THE TAPE', 60 + hlW, 296, 96, { fill: a.key, skew: -6 }).svg}
    <rect x="${aX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${favIsP1 ? a.key : 'rgba(255,255,255,0.45)'}" stroke-width="${favIsP1 ? 4 : 3}"/>
    <rect x="${bX}" y="${PY}" width="${PW}" height="${PH}" rx="28" fill="none" stroke="${favIsP1 ? 'rgba(255,255,255,0.45)' : a.key}" stroke-width="${favIsP1 ? 3 : 4}"/>
    ${sPlate(aX + PW / 2, PY + PH + 40, last(p.name1).toUpperCase(), favIsP1 ? a.key : C_WHITE, favIsP1, a.ink[2])}
    ${sPlate(bX + PW / 2, PY + PH + 40, last(p.name2).toUpperCase(), favIsP1 ? C_WHITE : a.key, !favIsP1, a.ink[2])}
    ${midRow(452, 'RANK', p.rank1 ? `#${p.rank1}` : '–', p.rank2 ? `#${p.rank2}` : '–')}
    ${midRow(556, 'RECENT FORM', f1 ? `${f1.w}-${f1.l}` : '–', f2 ? `${f2.w}-${f2.l}` : '–')}
    ${midRow(660, 'CAREER H2H', ctx?.h2h ? String(ctx.h2h.w1) : '–', ctx?.h2h ? String(ctx.h2h.w2) : '–')}
    ${sBar(SQ, SQ, `OUR CALL: ${last(p.favName).toUpperCase()} · ${Math.round(p.favProb * 100)}%`, a)}
    </svg>`;
  const rr = async (svg) => sharp(Buffer.from(svg), { density: 144 }).resize(SQ, SQ).png().toBuffer();
  await renderOn(file, bg, [
    { input: await rr(scrim), left: 0, top: 0 },
    { input: aImg, left: aX, top: PY },
    { input: bImg, left: bX, top: PY },
    { input: await rr(top), left: 0, top: 0 },
  ]);
}

// ── PROMO: the trust card (monthly calibration receipt) ────────────────────
async function trustCard(track, file) {
  const ms = (track.matches || []);
  const buckets = [
    { label: '50-60%', lo: 0.5, hi: 0.6 },
    { label: '60-70%', lo: 0.6, hi: 0.7 },
    { label: '70-85%', lo: 0.7, hi: 0.85 },
    { label: '85%+', lo: 0.85, hi: 1.01 },
  ].map((b) => {
    const list = ms.filter((m) => pickFavProb(m) >= b.lo && pickFavProb(m) < b.hi);
    const won = list.filter((m) => pickCorrect(m)).length;
    return { ...b, n: list.length, won: list.length ? Math.round((won / list.length) * 100) : null };
  }).filter((b) => b.n >= 30);
  if (buckets.length < 3) return false;
  const a = PAL.receipts;
  const startY = buckets.length >= 4 ? 486 : 512;
  const step = buckets.length >= 4 ? 104 : 118;
  const rows = buckets.map((b, i) => {
    const y = startY + i * step;
    return `
    ${T('body', 'we said', 130, y - 8, 26, { fill: 'rgba(255,255,255,0.7)' }).svg}${T('anton', b.label, 130 + measureT('body', 'we said ', 26), y, 40, { fill: C_WHITE }).svg}
    ${T('anton', `WON ${b.won}%`, SQ - 130, y, 50, { anchor: 'end', fill: a.key }).svg}
    ${T('bodyMed', `${b.n.toLocaleString()} calls`, SQ - 130, y + 32, 22, { anchor: 'end', fill: 'rgba(255,255,255,0.5)' }).svg}
    <line x1="130" y1="${y + 50}" x2="${SQ - 130}" y2="${y + 50}" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>`;
  }).join('');
  const base = `<svg width="${SQ}" height="${SQ}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, SQ, SQ, { ghost: 'TRUST' })}
  ${sMast(SQ, 'Calibration Check · Updated Monthly', a)}
  ${T('anton', 'WHEN WE SAY IT,', 60, 268, fitT('anton', 'WHEN WE SAY IT,', 100, SQ - 120), { fill: C_WHITE }).svg}
  ${T('anton', 'WE MEAN IT', 60, 366, fitT('anton', 'WE MEAN IT', 100, SQ - 120), { fill: a.key, skew: -6 }).svg}
  ${rows}
  ${sBar(SQ, SQ, 'DO THE ODDS MEAN IT?  →', a, { sub: 'STATED CONFIDENCE VS WHAT HAPPENED' })}
  </svg>`;
  await render(file, base);
  return true;
}

// ── FORMATS: 4:5 portrait variants + 16:9 banner ───────────────────────────
const PT_W = 1080, PT_H = 1350;

// Centered multi-part line (mixed colours) via exact fontkit widths. Parts are
// trimmed and separated by an explicit gap (fontkit drops trailing spaces, and
// a skewed accent word would otherwise lean into the previous word).
function centerLine(w, y, size, parts) {
  const gap = size * 0.32;
  const widths = parts.map((pp) => measureT('anton', pp.t.trim(), size));
  const total = widths.reduce((s, x) => s + x, 0) + gap * (parts.length - 1);
  let x = w / 2 - total / 2, out = '';
  parts.forEach((pp, i) => { out += T('anton', pp.t.trim(), x, y, size, { fill: pp.c, skew: pp.skew || 0 }).svg; x += widths[i] + gap; });
  return out;
}

async function coverPortrait(picks, sc, file) {
  const ev = picks[0]?.event || 'The Tour';
  const a = paletteFor(ev, 'calls');
  const upsets = picks.filter((p) => p._flags.upset).length;
  const hs = 212;
  const glowWord = T('anton', 'CALLS', 60, 724, hs, { fill: a.key });
  const subTxt = `${picks.length} match${picks.length > 1 ? 'es' : ''}, locked before a ball was struck${upsets ? ` · ${upsets} upset${upsets > 1 ? 's' : ''}` : ''}`;
  const base = `<svg width="${PT_W}" height="${PT_H}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, PT_W, PT_H, { ghost: 'CALLS' })}
  ${sMast(PT_W, `${ev} · ${fmtDate(picks[0]?.date || Date.now())}`, a)}
  ${T('bebas', 'THE PICKS ARE IN', 62, 320, 44, { fill: a.sub, tracking: 6 }).svg}
  ${T('anton', "TODAY'S", 60, 524, hs, { fill: C_WHITE }).svg}
  <g filter="url(#glow)" opacity="0.55">${glowWord.svg}</g>
  ${T('anton', 'CALLS', 60, 724, hs, { fill: a.key, skew: -7 }).svg}
  ${T('body', subTxt, 64, 806, 34, { fill: C_MUTE }).svg}
  ${sChip(PT_W / 2, 878, sc.proofPill.toUpperCase(), a)}
  ${sBar(PT_W, PT_H, 'SWIPE FOR EVERY PICK  →', a)}
  </svg>`;
  await render(file, base);
}

async function proofPortrait(track, sc, file) {
  const ms = track.matches || [];
  const n = ms.length;
  const acc = n ? Math.round(ms.filter((m) => pickCorrect(m)).length / n * 100) : 0;
  const a = PAL.receipts;
  const hero = T('anton', `${acc}%`, PT_W / 2, 640, 300, { anchor: 'middle', fill: a.key });
  const base = `<svg width="${PT_W}" height="${PT_H}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, PT_W, PT_H, { ghost: 'RECEIPTS' })}
  ${sMast(PT_W, `The Receipts · ${SEASON_YEAR} Season`, a)}
  ${T('bebas', 'GRADED IN PUBLIC, ALL SEASON', PT_W / 2, 330, 42, { anchor: 'middle', fill: a.sub, tracking: 5 }).svg}
  <g filter="url(#glow)" opacity="0.5">${hero.svg}</g>${hero.svg}
  ${T('body', 'of winners called correctly', PT_W / 2, 726, 34, { anchor: 'middle', fill: C_WHITE }).svg}
  ${T('bodyMed', `${n.toLocaleString()} matches, every one public`, PT_W / 2, 772, 28, { anchor: 'middle', fill: C_MUTE }).svg}
  ${sChip(PT_W / 2, 836, sc.proofPill.toUpperCase(), a)}
  ${T('bodyMed', 'no cherry-picking · no deletions · misses posted too', PT_W / 2, 968, 27, { anchor: 'middle', fill: C_MUTE }).svg}
  ${sBar(PT_W, PT_H, 'SEE THE FULL LEDGER  →', a)}
  </svg>`;
  await render(file, base);
}

async function bannerWide(sc, file) {
  const W = 1600, H = 900, a = PAL.calls;
  const fs = fitT('anton', 'EVERY CALL PUBLIC.', 150, W - 200);
  const sub = sc.proofLine[0].toUpperCase() + sc.proofLine.slice(1);
  const base = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs>${sDefs(a)}</defs>
  ${sStage(a, W, H, { ghost: 'SMASH' })}
  ${sMast(W, 'Grand Slam Prediction Engine', a)}
  ${centerLine(W, 420, fs, [{ t: 'EVERY CALL ', c: C_WHITE }, { t: 'PUBLIC.', c: a.key }])}
  ${centerLine(W, 560, fs, [{ t: 'EVERY MISS ', c: C_WHITE }, { t: 'TOO.', c: a.sub, skew: -6 }])}
  ${T('body', sub, W / 2, 660, fitT('body', sub, 34, W - 260) || 34, { anchor: 'middle', fill: C_MUTE }).svg}
  </svg>`;
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

// Recent W-L per player, for the tale-of-the-tape form row.
function loadForms(tour) {
  const dir = tour === 'wta' ? path.join(DATA, 'women') : DATA;
  const p = path.join(dir, 'smash_us.csv');
  if (!fs.existsSync(p)) return new Map();
  const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
  return new Map(rows.map((r) => [r.id, { w: Number(r.recent_w) || 0, l: Number(r.recent_l) || 0 }]));
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
  const fwdDecided = (preds.predictions || []).filter((p) => p.status === 'won' || p.status === 'lost');
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
  // alt: accessibility text for the image (defaults to the caption's first
  // sentence so every asset ships with SOMETHING usable).
  const add = (file, type, format, category, caption, alt = null) =>
    assets.push({ file, type, format, category, caption, alt: alt || `${caption.split('.')[0]}.` });
  const tags = '#tennis #atp #wta #tennisprediction';

  const decorate = (p) => {
    const favId = p.favorite;
    const oppId = favId === p.p1 ? p.p2 : p.p1;
    const favRank = ranks[p.tour]?.get(favId);
    const oppRank = ranks[p.tour]?.get(oppId);
    return {
      ...p,
      _flags: {
        upset: isUpsetPick(favRank, oppRank),
        confidence: p.favProb >= 0.70 ? 'high' : (p.favProb < 0.60 ? 'low' : null),
        rank1: ranks[p.tour]?.get(p.p1),
        rank2: ranks[p.tour]?.get(p.p2),
      },
    };
  };

  // The daily kit covers everything the forward test covers: the slams AND
  // the six combined 1000s (their weeks get the same daily treatment, and a
  // Cincinnati carousel is US Open marketing). Draws, brackets, and the hype
  // collection stay slam-exclusive by design.
  //
  // Only matches that HAVEN'T STARTED YET are eligible - the daily cards are a
  // "called before play" showcase, so they must feature tonight's marquee
  // slate, not yesterday's straggler that finished but hasn't been graded
  // (result not yet fetched). Without the date gate, the sort-ascending below
  // surfaces the oldest ungraded pending row first, and the flagship cover /
  // match / parlay / tape cards end up built around days-old #100-ranked
  // coin-flips instead of the day's real headliners.
  const NOW = Date.now();
  const picks = (preds.predictions || [])
    .filter((p) => p.status === 'pending' && ['slam', '1000'].includes(p.tier || 'slam')
      && new Date(p.date).getTime() >= NOW)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, MAX_MATCH_CARDS)
    .map(decorate);

  // ── DAILY layer ─────────────────────────────────────────────────────────
  if (picks.length) {
    await coverCard(picks, sc, 'cover.png');
    add('cover.png', 'carousel-cover', 'square', 'daily', `Today's calls at the ${picks[0].event}: ${picks.length} matches, locked before play. Swipe for every pick. ${sc.proofLine[0].toUpperCase()}${sc.proofLine.slice(1)}. All of today: ${todayLink()} ${tags}`,
      `Today's Calls cover card: ${picks.length} locked predictions at the ${picks[0].event}.`);
    await coverPortrait(picks, sc, 'cover-45.png');
    add('cover-45.png', 'carousel-cover', 'portrait', 'daily', `Today's calls at the ${picks[0].event}, 4:5 feed format. ${todayLink()} ${tags}`,
      `Today's Calls cover card in portrait format for the ${picks[0].event}.`);

    // Career h2h + our pair record enrich every match card.
    const h2hAll = fs.existsSync(path.join(DATA, 'h2h.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'h2h.json'), 'utf8')) : {};
    const track2 = track.matches || [];
    const contextFor = (p) => {
      const key = [p.p1, p.p2].sort().join('_');
      const rec = h2hAll[key];
      const firstIsP1 = [p.p1, p.p2].sort()[0] === p.p1;
      const h2h = rec ? { w1: firstIsP1 ? rec.winsA : rec.winsB, w2: firstIsP1 ? rec.winsB : rec.winsA } : null;
      const pairMs = track2.filter((m) => (m.p1 === p.p1 && m.p2 === p.p2) || (m.p1 === p.p2 && m.p2 === p.p1));
      return { h2h, pair: { n: pairMs.length, correct: pairMs.filter((m) => pickCorrect(m)).length } };
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

    // Tale of the tape: the marquee matchup (best combined ranking) gets the
    // full split-screen stat treatment.
    const marquee = [...picks]
      .filter((p) => p._flags.rank1 && p._flags.rank2)
      .sort((a, b) => (a._flags.rank1 + a._flags.rank2) - (b._flags.rank1 + b._flags.rank2))[0];
    if (marquee) {
      const forms = loadForms(marquee.tour);
      await taleOfTheTape({ ...marquee, rank1: marquee._flags.rank1, rank2: marquee._flags.rank2 }, contextFor(marquee), forms, 'tape.png');
      add('tape.png', 'tale-of-the-tape', 'square', 'daily', `Tale of the tape: ${last(marquee.name1)} vs ${last(marquee.name2)} at the ${marquee.event}. Rank, form, career head-to-head, and our call. ${matchLink(marquee)} ${tags}`,
        `Tale of the tape stat comparison for ${marquee.name1} vs ${marquee.name2}.`);
    }
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
    await receiptTicket(p, file);
    add(file, 'called-it', 'square', 'daily', `We called it: ${p.favName} over ${p.favorite === p.p1 ? p.name2 : p.name1} at ${pctTxt(p.favProb)}, locked before play. Final: ${winnerName} won${p.score ? ` ${p.score}` : ''}. Receipts: ${matchLink(p)} ${tags}`,
      `Ticket-stub receipt: our ${pctTxt(p.favProb)} call on ${p.favName}, graded ${p.correct ? 'correct' : 'wrong'}.`);
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
    // Overnight risers and fallers, from the same daily snapshots.
    const mv = `odds-movers-${tour}.png`;
    if (await oddsMoversCard(o, tour, mv)) {
      add(mv, 'odds-movers', 'square', 'daily', `${o.event} ${tour.toUpperCase()} odds movers: who rose and who slid overnight in our 2,000-run title simulation. ${SITE}/draw ${tags}`,
        `Title odds movers card: overnight risers and fallers at the ${o.event}.`);
    }
  }

  if (sc.yesterday?.n > 0) {
    await resultsCard(sc, 'results.png');
    add('results.png', 'results', 'square', 'daily', `Receipts from ${sc.yesterday.date}: called ${sc.yesterday.correct} of ${sc.yesterday.n} winners. Season benchmark: ${sc.season.acc}%. Wins and misses, all public. ${tags}`);
  }

  // ── WRAP: tournament report card (a few days after a slam ends) ─────────
  for (const tour of ['atp', 'wta']) {
    const o = titleOdds.events?.[tour];
    if (!o || o.status !== 'final' || !o.champion) continue;
    if (Date.now() - new Date(o.updatedAt).getTime() > 4 * 864e5) continue;
    // Same tour + surface within the slam window, EXCLUDING rows labeled as a
    // different event (warm-up finals share the surface; unlabeled rows pass
    // because the names cache backfills labels gradually).
    const evMs = (track.matches || []).filter((m) =>
      m.tour === tour && m.surface === o.surface && (Date.now() - new Date(m.date).getTime()) < 16 * 864e5
      && (!m.event || m.event === o.event));
    if (evMs.length < 8) continue;
    const correct = evMs.filter((m) => pickCorrect(m)).length;
    const beat = evMs.filter((m) => pickCorrect(m) && m.oddCorrect === false).length;
    const exact = evMs.filter((m) => scorelineHit(m) === true).length;
    const file = `wrap-${tour}.png`;
    await reportCard({
      eyebrowText: `${o.event} ${tour} · tournament report card`,
      headline1: 'HOW WE',
      headline2: 'SCORED',
      stats: [
        { value: `${correct} OF ${evMs.length}`, label: 'winners called across the event' },
        ...(beat ? [{ value: `${beat}`, label: 'times we beat the bookies' }] : []),
        { value: `${exact}`, label: 'exact set scores called' },
        { value: last(o.champion.name).toUpperCase(), label: 'your champion' },
      ],
      footNote: 'every match graded in public · wins and misses both',
      themeKey: o.surface,
      file,
    });
    add(file, 'wrap', 'square', 'wrap', `${o.event} ${tour.toUpperCase()} report card: ${correct} of ${evMs.length} winners called${beat ? `, ${beat} wins over the bookies` : ''}, ${exact} exact scorelines. ${o.champion.name} takes the title. ${SITE}/track-record ${tags}`);
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
      const correct = weekMs.filter((m) => pickCorrect(m)).length;
      const beat = weekMs.filter((m) => pickCorrect(m) && m.oddCorrect === false).length;
      const bold = weekMs.filter((m) => pickCorrect(m))
        .sort((a, b) => pickFavProb(a) - pickFavProb(b))[0];
      const boldName = bold ? last(pickFav(bold) === bold.p1 ? bold.name1 : bold.name2) : null;
      await reportCard({
        eyebrowText: 'the week in calls',
        headline1: 'WEEKLY',
        headline2: 'RECAP',
        stats: [
          { value: `${correct} OF ${weekMs.length}`, label: 'winners called this week' },
          ...(beat ? [{ value: `${beat}`, label: 'wins over the bookies' }] : []),
          ...(bold ? [{ value: `${boldName} · ${Math.round(pickFavProb(bold) * 100)}%`, label: 'boldest call that hit' }] : []),
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
      accent: GOLD,
    });
    add('milestone.png', 'milestone', 'square', 'moments', `${mark.toLocaleString()} matches graded in public - season benchmark ${sc.season.acc}%, zero deletions. ${SITE}/track-record ${tags}`);
  }
  if (sc.yesterday && sc.yesterday.n >= 3 && sc.yesterday.correct === sc.yesterday.n) {
    await reportCard({
      eyebrowText: `perfect day · ${sc.yesterday.date}`,
      headline1: `${sc.yesterday.correct}/${sc.yesterday.n}`,
      headline2: 'FLAWLESS',
      stats: [
        { value: `${sc.yesterday.n}`, label: 'matches called, all graded' },
        { value: `${sc.season.acc}%`, label: 'season benchmark' },
      ],
      footNote: 'every match graded in public - wins and misses both',
      themeKey: 'brand',
      file: 'perfect-day.png',
    });
    add('perfect-day.png', 'perfect-day', 'square', 'moments', `Perfect day: ${sc.yesterday.correct}/${sc.yesterday.n} winners called on ${sc.yesterday.date}. ${SITE}/track-record ${tags}`);
  }

  // Streak detector: the longest current run of correct deployed calls in
  // any tour x surface cell. Posts when it reaches 6 and only re-posts when
  // it GROWS (the manifest remembers the last posted mark).
  const bestStreak = currentStreaks(track)[0];
  const prevStreak = prevManifest.lastStreak || null;
  let lastStreak = prevStreak;
  const STREAK_MIN = process.env.FORCE_STREAK === '1' ? 1 : 6;
  if (bestStreak && bestStreak.len >= STREAK_MIN && (process.env.FORCE_STREAK === '1' || !prevStreak || prevStreak.key !== bestStreak.key || bestStreak.len > prevStreak.len)) {
    await streakCard(bestStreak, 'streak.png');
    add('streak.png', 'streak', 'square', 'moments', `${bestStreak.len} straight ${bestStreak.tour.toUpperCase()} ${bestStreak.surface}-court winners called. Deployed calls, graded in public - streaks end, receipts don't. ${SITE}/track-record ${tags}`,
      `Streak card: ${bestStreak.len} consecutive correct calls on ${bestStreak.tour.toUpperCase()} ${bestStreak.surface}.`);
    lastStreak = { key: bestStreak.key, len: bestStreak.len };
  }

  // Upset autopsy: when a top seed fell in the last 3 days, own the result
  // either way - what we said vs what the market said.
  const recentGraded = (track.matches || []).filter((m) => (Date.now() - new Date(m.date).getTime()) < 3 * 864e5);
  let biggestUpset = null;
  for (const m of recentGraded) {
    const loserId = m.winner === m.p1 ? m.p2 : m.p1;
    const wR = ranks[m.tour]?.get(m.winner), lR = ranks[m.tour]?.get(loserId);
    if (!wR || !lR || lR > 12 || wR - lR < 10) continue;
    if (!biggestUpset || (wR - lR) > biggestUpset.gap) biggestUpset = { m, wR, lR, gap: wR - lR };
  }
  if (biggestUpset) {
    await upsetAutopsyCard(biggestUpset.m, biggestUpset.wR, biggestUpset.lR, biggestUpset.m.tour, 'autopsy.png');
    const bu = biggestUpset;
    const wName = bu.m.winner === bu.m.p1 ? bu.m.name1 : bu.m.name2;
    add('autopsy.png', 'upset-autopsy', 'square', 'moments', `Upset autopsy: No. ${bu.wR} ${last(wName)} takes down No. ${bu.lR}. What we said, what the market said, graded in public either way. ${SITE}/track-record ${tags}`,
      `Upset autopsy card: rank ${bu.wR} beat rank ${bu.lR}, with our call and the market's.`);
  }

  // ── EDGE: us vs the betting market (new collection) ─────────────────────
  // Splits = graded matches where our deployed pick and the market's
  // favorite differed, per the closing odds already on the ledger rows.
  const edgeRows = (track.matches || [])
    .filter((m) => m.od1 > 1 && m.od2 > 1 && m.oddFav && pickFav(m))
    .map((m) => ({ ...m, _mktP1: impliedP1(m.od1, m.od2) }))
    .filter((m) => pickFav(m) !== m.oddFav);
  if (edgeRows.length >= 20) {
    let usReturn = 0, mktReturn = 0, usRight = 0, mktRight = 0;
    for (const m of edgeRows) {
      const ourOdds = pickFav(m) === m.p1 ? m.od1 : m.od2;
      const mktOdds = m.oddFav === m.p1 ? m.od1 : m.od2;
      if (pickCorrect(m)) { usReturn += ourOdds; usRight++; }
      if (m.oddCorrect) { mktReturn += mktOdds; mktRight++; }
    }
    const edge = {
      n: edgeRows.length,
      usNet: usReturn - edgeRows.length,
      mktNet: mktReturn - edgeRows.length,
      usAcc: Math.round((usRight / edgeRows.length) * 100),
      mktAcc: Math.round((mktRight / edgeRows.length) * 100),
    };
    await dollarTestCard(edge, 'edge-dollar.png');
    add('edge-dollar.png', 'edge-dollar-test', 'square', 'edge',
      `The $1 test: $1 on every one of the ${edge.n} matches where we and the betting market picked different winners. Our picks: ${edge.usNet >= 0 ? '+' : '-'}$${Math.abs(edge.usNet).toFixed(0)}. The market's own favorites: ${edge.mktNet >= 0 ? '+' : '-'}$${Math.abs(edge.mktNet).toFixed(0)}. Hypothetical, settled at closing odds, not betting advice. Every split graded: ${SITE}/edge ${tags}`,
      `The $1 test card: flat-stake payout of our picks versus the market's on ${edge.n} disagreements.`);

    // The freshest big split (last 7 days), else the season's biggest gap -
    // the board always has a story to tell.
    const ourP1 = (m) => m.pickProbP1 ?? m.smashProbP1 ?? m.probP1;
    const gap = (m) => Math.abs(ourP1(m) - m._mktP1);
    const bySize = [...edgeRows].sort((a, b) => gap(b) - gap(a));
    const recent = edgeRows
      .filter((m) => (Date.now() - new Date(m.date).getTime()) < 7 * 864e5)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const split = recent[0] || bySize[0];
    if (split) {
      await edgeSplitCard(split, split.tour, 'edge-split.png');
      const weWon = pickCorrect(split);
      add('edge-split.png', 'edge-split', 'square', 'edge',
        `We disagreed with the market on ${last(split.name1)} vs ${last(split.name2)}${split.event ? ` at the ${split.event}` : ''} - ${weWon ? 'and the model was right' : 'and the market took this one'}. Both calls graded in public, like every split this season: ${SITE}/edge ${tags}`,
        `Edge split card: our call versus the market's on ${split.name1} vs ${split.name2}, graded.`);
    }
  }
  // Forward split: a pending pick where we hold the underdog ticket per the
  // lock-time odds (Phase 1 capture). Rendered only when one exists.
  const fwdSplit = (preds.predictions || [])
    .filter((p) => p.status === 'pending' && p.lockOdd1 > 1 && p.lockOdd2 > 1 && new Date(p.date) > new Date())
    .map((p) => {
      const mktP1 = impliedP1(p.lockOdd1, p.lockOdd2);
      return { p, mktOurs: p.favorite === p.p1 ? mktP1 : 1 - mktP1 };
    })
    .filter((x) => x.mktOurs < 0.5)
    .sort((a, b) => a.mktOurs - b.mktOurs)[0];
  if (fwdSplit) {
    await forwardEdgeCard(fwdSplit.p, Math.round(fwdSplit.mktOurs * 100), 'edge-forward.png');
    add('edge-forward.png', 'edge-forward', 'square', 'edge',
      `Locked before play: we're backing ${fwdSplit.p.favName} at ${Math.round(fwdSplit.p.favProb * 100)}% while the market has them at ${Math.round(fwdSplit.mktOurs * 100)}%. Graded within days, no take-backs. ${SITE}/edge ${tags}`,
      `Forward edge card: our underdog call on ${fwdSplit.p.favName}, locked with the market price attached.`);
  }

  // ── PROMO layer ─────────────────────────────────────────────────────────
  await proofCard(track, 'proof.png');
  add('proof.png', 'proof', 'square', 'promo', `The ${SEASON_YEAR} receipts: ${sc.proofLine}, all graded in public. ${tags}`,
    'Season receipts card: overall accuracy versus the bookmakers.');
  await proofPortrait(track, sc, 'proof-45.png');
  add('proof-45.png', 'proof', 'portrait', 'promo', `The ${SEASON_YEAR} receipts in 4:5: ${sc.proofLine}. ${tags}`,
    'Season receipts card, portrait format.');
  await bannerWide(sc, 'banner.png');
  add('banner.png', 'banner', 'wide', 'promo', `Every call public. Every miss too. ${sc.proofLine[0].toUpperCase()}${sc.proofLine.slice(1)}. ${SITE}/track-record ${tags}`,
    'Wide banner: every call public, every miss too.');

  // Monthly trust card: stated confidence vs reality (first week of the
  // month, or force with FORCE_TRUST=1).
  if ((new Date().getUTCDate() <= 7 && new Date().getUTCDay() === 1) || process.env.FORCE_TRUST === '1') {
    if (await trustCard(track, 'trust.png')) {
      add('trust.png', 'trust', 'square', 'promo', `Calibration check: when we say 70%, do we win 70%? Stated confidence vs reality on every graded call this season. ${SITE}/model ${tags}`,
        'Calibration trust card: stated confidence versus actual win rates by band.');
    }
  }

  await howItWorks(sc, 'how-it-works-1.png', 'how-it-works-2.png', 'how-it-works-3.png');
  add('how-it-works-1.png', 'explainer', 'square', 'promo', `How Smash works, 1 of 3: we compute every match point by point before it happens - every path it can take, from real serve and return stats. ${tags}`);
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
      const correct = list.filter((m) => pickCorrect(m)).length;
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
  const manifest = { generatedAt: new Date().toISOString(), seasonN: sc.season.n, lastStreak, thread, assets };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const keep = new Set([...assets.map((a) => a.file), 'manifest.json']);
  for (const f of fs.readdirSync(OUT)) {
    if (!keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log('  removed stale', f); }
  }
  const byCat = assets.reduce((acc, a) => { acc[a.category] = (acc[a.category] || 0) + 1; return acc; }, {});
  console.log(`Share kit: ${assets.length} asset(s) (${Object.entries(byCat).map(([c, n]) => `${n} ${c}`).join(', ')}) -> ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
