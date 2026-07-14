/**
 * Animated social assets - public/data/share/*.mp4.
 *
 * Renders frame sequences with sharp and stitches them with ffmpeg (present
 * on GitHub runners; skipped gracefully when ffmpeg is missing locally).
 * Runs AFTER buildShareAssets so it can append its entries to the manifest.
 *
 *   title-race-{tour}.mp4  the title-odds race: bars easing between daily
 *                          snapshots (needs 3+ live history snapshots)
 *   countdown.mp4          days-until-the-next-slam, with an animated ring
 *                          (within 75 days of a slam)
 *
 * Usage: node buildMotionAssets.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp is not installed. Run `npm install --no-save sharp` first.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'share');
const TMP = path.join(__dirname, 'tmp-frames');
const SQ = 1080;
const FPS = 12;

const D = 'Barlow Condensed, Arial Narrow, DejaVu Sans Condensed, DejaVu Sans, sans-serif';
const U = 'DejaVu Sans, Arial, Helvetica, sans-serif';
const LIME = '#c6ff1c';
const INK = '#0c0f14';
const THEMES = {
  clay: { top: '#5b2410', bottom: '#1c0903' },
  grass: { top: '#163a22', bottom: '#06140b' },
  hard: { top: '#103061', bottom: '#040c1e' },
  brand: { top: '#171c28', bottom: '#07090d' },
};
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function shell(w, h, t, inner) {
  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.top}"/>
      <stop offset="1" stop-color="${t.bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="10" fill="${LIME}"/>
  <polygon points="${w - 90},0 ${w},0 ${w},90" fill="${LIME}"/>
  ${inner}
  <line x1="60" y1="${h - 108}" x2="${w - 60}" y2="${h - 108}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
  <circle cx="70" cy="${h - 58}" r="9" fill="${LIME}"/>
  <text x="92" y="${h - 46}" font-family="${D}" font-size="40" font-weight="800" letter-spacing="2" fill="#ffffff">SMASH</text>
  <text x="${w - 60}" y="${h - 46}" text-anchor="end" font-family="${U}" font-size="21" fill="rgba(255,255,255,0.55)">every call public · graded daily</text>
</svg>`;
}

async function writeFrame(dir, idx, svg) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir, `f-${String(idx).padStart(4, '0')}.png`));
}

function stitch(dir, outFile) {
  const res = spawnSync('ffmpeg', [
    '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f-%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(OUT, outFile),
  ], { stdio: 'ignore' });
  return res.status === 0;
}

// ── Countdown: animated ring sweeping around the day count ────────────────
function nextSlamStart(now = new Date()) {
  const y = now.getFullYear();
  const starts = [
    { name: 'Australian Open', d: new Date(y, 0, 12), surface: 'hard' },
    { name: 'French Open', d: new Date(y, 4, 24), surface: 'clay' },
    { name: 'Wimbledon', d: new Date(y, 5, 29), surface: 'grass' },
    { name: 'US Open', d: new Date(y, 7, 24), surface: 'hard' },
    { name: 'Australian Open', d: new Date(y + 1, 0, 12), surface: 'hard' },
  ];
  return starts.find((s) => s.d > now);
}

function arcPath(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
}

async function countdownVideo() {
  const next = nextSlamStart();
  const days = Math.ceil((next.d - new Date()) / 864e5);
  if (days < 1 || days > 75) return null;
  const t = THEMES[next.surface] || THEMES.brand;
  const dir = path.join(TMP, 'cd');
  fs.mkdirSync(dir, { recursive: true });
  const N = 42; // 3.5s at 12fps
  for (let f = 0; f < N; f++) {
    const prog = easeInOut(Math.min(1, f / (N - 8))); // sweep completes, then holds
    const deg = Math.max(0.5, Math.min(359.5, prog * 360));
    const pulse = 1 + 0.015 * Math.sin((f / N) * Math.PI * 4);
    const svg = shell(SQ, SQ, t, `
  <text x="${SQ / 2}" y="200" text-anchor="middle" font-family="${U}" font-size="28" font-weight="700" letter-spacing="7" fill="${LIME}">THE NEXT MAJOR</text>
  <text x="${SQ / 2}" y="320" text-anchor="middle" font-family="${D}" font-size="110" font-weight="800" fill="#ffffff">${esc(next.name.toUpperCase())}</text>
  <g transform="translate(${SQ / 2} 620) scale(${pulse.toFixed(4)}) translate(${-SQ / 2} -620)">
    <circle cx="${SQ / 2}" cy="620" r="210" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.15)" stroke-width="4"/>
    <path d="${arcPath(SQ / 2, 620, 210, deg)}" fill="none" stroke="${LIME}" stroke-width="14" stroke-linecap="round"/>
    <text x="${SQ / 2}" y="672" text-anchor="middle" font-family="${D}" font-size="230" font-weight="800" fill="${LIME}">${days}</text>
  </g>
  <text x="${SQ / 2}" y="900" text-anchor="middle" font-family="${U}" font-size="32" font-weight="700" letter-spacing="6" fill="rgba(255,255,255,0.8)">DAYS</text>`);
    await writeFrame(dir, f, svg);
  }
  return { dir, file: 'countdown.mp4', caption: `${days} days until the ${next.name}. The model is warming up.`, type: 'countdown-video' };
}

// ── Title-odds race: bars easing between daily snapshots ──────────────────
async function raceVideo(tour) {
  const titleOdds = fs.existsSync(path.join(DATA, 'title_odds.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'title_odds.json'), 'utf8'))
    : { events: {} };
  const o = titleOdds.events?.[tour];
  if (!o) return null;
  const snaps = (o.history || []).filter((h) => h.fieldSize > 1);
  if (snaps.length < 3) return null;

  const t = THEMES[o.surface] || THEMES.brand;
  // Track the last snapshot's top 6, in that order.
  const names = Object.entries(snaps[snaps.length - 1].odds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([n]) => n);
  const valueAt = (snapIdx, name) => snaps[snapIdx].odds?.[name] ?? 0;
  const maxVal = Math.max(...snaps.flatMap((s) => names.map((n) => s.odds?.[n] ?? 0)), 0.01);

  const dir = path.join(TMP, `race-${tour}`);
  fs.mkdirSync(dir, { recursive: true });
  const PER = 10, HOLD = 14;
  let frame = 0;
  for (let s = 0; s < snaps.length - 1; s++) {
    for (let f = 0; f < PER; f++) {
      const tt = easeInOut(f / PER);
      const rows = names.map((n, i) => {
        const v = valueAt(s, n) + (valueAt(s + 1, n) - valueAt(s, n)) * tt;
        const w = Math.max(10, (v / maxVal) * 560);
        const y = 300 + i * 118;
        return `
    <text x="80" y="${y + 20}" font-family="${D}" font-size="46" font-weight="700" fill="#ffffff">${esc(n.toUpperCase())}</text>
    <rect x="80" y="${y + 38}" width="${w.toFixed(1)}" height="26" rx="13" fill="${LIME}" opacity="0.9"/>
    <text x="${(90 + w).toFixed(1)}" y="${y + 60}" font-family="${D}" font-size="46" font-weight="800" fill="#ffffff">${Math.round(v * 100)}%</text>`;
      }).join('');
      const svg = shell(SQ, SQ, t, `
  <text x="${SQ / 2}" y="130" text-anchor="middle" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="${LIME}">${esc(`${o.event} ${tour} · title race`.toUpperCase())}</text>
  <text x="${SQ / 2}" y="240" text-anchor="middle" font-family="${D}" font-size="96" font-weight="800" fill="#ffffff">WHO WINS IT ALL?</text>
  ${rows}
  <text x="${SQ / 2}" y="${SQ - 136}" text-anchor="middle" font-family="${U}" font-size="26" fill="rgba(255,255,255,0.6)">${esc(snaps[s + 1].date)} · the draw, played out 2,000 times daily</text>`);
      await writeFrame(dir, frame++, svg);
    }
  }
  // hold the final state
  for (let f = 0; f < HOLD; f++) {
    fs.copyFileSync(path.join(dir, `f-${String(frame - 1).padStart(4, '0')}.png`), path.join(dir, `f-${String(frame).padStart(4, '0')}.png`));
    frame++;
  }
  return { dir, file: `title-race-${tour}.mp4`, caption: `The ${o.event} ${tour.toUpperCase()} title race, day by day - the whole draw simulated 2,000 times every morning.`, type: 'race-video' };
}

// ── Result-day recap reel: yesterday's graded calls, vertical 1080x1920 ───
// Card-by-card hit/miss stamps and a season-record end frame - the format
// Instagram Reels and TikTok actually distribute.
async function recapReel() {
  const trPath = path.join(DATA, 'track_record.json');
  const scPath = path.join(DATA, 'daily_scorecard.json');
  if (!fs.existsSync(trPath) || !fs.existsSync(scPath)) return null;
  const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
  const day = sc.yesterday?.date;
  if (!day || !sc.yesterday.n) return null;
  const dayMatches = JSON.parse(fs.readFileSync(trPath, 'utf8')).matches
    .filter((m) => String(m.date).slice(0, 10) === day)
    .slice(0, 6);
  if (!dayMatches.length) return null;

  const W = SQ, H = 1920;
  // Theme by the day's dominant surface.
  const counts = {};
  for (const m of dayMatches) counts[m.surface] = (counts[m.surface] || 0) + 1;
  const surface = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const t = THEMES[surface] || THEMES.brand;

  const dir = path.join(TMP, 'recap');
  fs.mkdirSync(dir, { recursive: true });
  const dateLabel = new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  let frame = 0;

  // Intro (~1.2s)
  for (let f = 0; f < 14; f++) {
    const a = easeInOut(Math.min(1, f / 8));
    await writeFrame(dir, frame++, shell(W, H, t, `
  <text x="${W / 2}" y="560" text-anchor="middle" font-family="${U}" font-size="30" font-weight="700" letter-spacing="8" fill="${LIME}" opacity="${a.toFixed(2)}">${esc(dateLabel.toUpperCase())}</text>
  <text x="${W / 2}" y="720" text-anchor="middle" font-family="${D}" font-size="150" font-weight="800" fill="#ffffff" opacity="${a.toFixed(2)}">YESTERDAY,</text>
  <text x="${W / 2}" y="880" text-anchor="middle" font-family="${D}" font-size="150" font-weight="800" fill="${LIME}" opacity="${a.toFixed(2)}">GRADED.</text>
  <text x="${W / 2}" y="1010" text-anchor="middle" font-family="${U}" font-size="30" fill="rgba(255,255,255,0.7)" opacity="${a.toFixed(2)}">every call locked before play</text>`));
  }

  // One segment per match (~1.8s each)
  for (let i = 0; i < dayMatches.length; i++) {
    const m = dayMatches[i];
    const favIsP1 = m.smashFavorite === m.p1;
    const pickName = favIsP1 ? m.name1 : m.name2;
    const pct = Math.round(Math.max(m.smashProbP1, 1 - m.smashProbP1) * 100);
    const winName = m.winner === m.p1 ? m.name1 : m.name2;
    const hit = m.smashCorrect;
    const stampText = hit ? 'CALLED IT' : 'MISSED';
    const stampColor = hit ? LIME : '#ff5d5d';
    for (let f = 0; f < 22; f++) {
      const pop = f < 4 ? 0 : Math.min(1, (f - 4) / 5);
      const scale = 0.6 + 0.4 * easeInOut(pop);
      await writeFrame(dir, frame++, shell(W, H, t, `
  <text x="${W / 2}" y="380" text-anchor="middle" font-family="${U}" font-size="27" font-weight="700" letter-spacing="6" fill="rgba(255,255,255,0.65)">CALL ${i + 1} OF ${dayMatches.length} · ${esc(m.tour.toUpperCase())} · ${esc(m.surface.toUpperCase())}</text>
  <text x="${W / 2}" y="560" text-anchor="middle" font-family="${D}" font-size="86" font-weight="800" fill="#ffffff">${esc(m.name1.toUpperCase())}</text>
  <text x="${W / 2}" y="650" text-anchor="middle" font-family="${D}" font-size="52" font-weight="700" fill="rgba(255,255,255,0.55)">VS</text>
  <text x="${W / 2}" y="750" text-anchor="middle" font-family="${D}" font-size="86" font-weight="800" fill="#ffffff">${esc(m.name2.toUpperCase())}</text>
  <text x="${W / 2}" y="900" text-anchor="middle" font-family="${U}" font-size="32" font-weight="700" fill="${LIME}">WE SAID: ${esc(pickName.split(' ').pop().toUpperCase())} ${pct}%</text>
  <text x="${W / 2}" y="980" text-anchor="middle" font-family="${U}" font-size="30" fill="rgba(255,255,255,0.8)">${esc(winName.split(' ').pop())} won${m.score ? ` ${esc(m.score)}` : ''}</text>
  ${pop > 0 ? `
  <g transform="translate(${W / 2} 1220) rotate(-7) scale(${scale.toFixed(3)})">
    <rect x="-330" y="-86" width="660" height="172" rx="18" fill="none" stroke="${stampColor}" stroke-width="12" opacity="${easeInOut(pop).toFixed(2)}"/>
    <text x="0" y="42" text-anchor="middle" font-family="${D}" font-size="120" font-weight="800" fill="${stampColor}" opacity="${easeInOut(pop).toFixed(2)}">${stampText}</text>
  </g>` : ''}`));
    }
  }

  // Outro (~2.5s): the day tally + season record
  const season = sc.season;
  for (let f = 0; f < 30; f++) {
    const a = easeInOut(Math.min(1, f / 8));
    await writeFrame(dir, frame++, shell(W, H, t, `
  <text x="${W / 2}" y="600" text-anchor="middle" font-family="${U}" font-size="30" font-weight="700" letter-spacing="8" fill="rgba(255,255,255,0.65)" opacity="${a.toFixed(2)}">THE DAY</text>
  <text x="${W / 2}" y="800" text-anchor="middle" font-family="${D}" font-size="230" font-weight="800" fill="${LIME}" opacity="${a.toFixed(2)}">${sc.yesterday.correct} OF ${sc.yesterday.n}</text>
  <text x="${W / 2}" y="900" text-anchor="middle" font-family="${U}" font-size="34" font-weight="700" fill="#ffffff" opacity="${a.toFixed(2)}">WINNERS CALLED RIGHT</text>
  ${season?.n ? `<text x="${W / 2}" y="1060" text-anchor="middle" font-family="${U}" font-size="29" fill="rgba(255,255,255,0.75)" opacity="${a.toFixed(2)}">SEASON: ${season.correct.toLocaleString()} of ${season.n.toLocaleString()} (${season.acc}%)</text>` : ''}
  <text x="${W / 2}" y="1200" text-anchor="middle" font-family="${U}" font-size="30" font-weight="700" letter-spacing="4" fill="${LIME}" opacity="${a.toFixed(2)}">TOMORROW'S CALLS · LINK IN BIO</text>`));
  }

  return {
    dir, file: 'recap-reel.mp4',
    caption: `Yesterday, graded: ${sc.yesterday.correct} of ${sc.yesterday.n} winners called right. Every pick locked before play, receipts public.`,
    type: 'recap-video',
  };
}

async function run() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = [];
  const cd = await countdownVideo();
  if (cd) jobs.push(cd);
  for (const tour of ['atp', 'wta']) {
    const rv = await raceVideo(tour);
    if (rv) jobs.push(rv);
  }
  const rr = await recapReel();
  if (rr) jobs.push(rr);

  if (!jobs.length) {
    console.log('No motion assets to build right now (no countdown window, not enough odds history).');
    fs.rmSync(TMP, { recursive: true, force: true });
    return;
  }

  if (!hasFfmpeg()) {
    console.warn(`ffmpeg not found - ${jobs.length} video(s) skipped (frames rendered OK). CI has ffmpeg and will produce them.`);
    fs.rmSync(TMP, { recursive: true, force: true });
    return;
  }

  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { assets: [] };
  const tags = '#tennis #atp #wta #tennisprediction';
  for (const job of jobs) {
    if (stitch(job.dir, job.file)) {
      console.log('  wrote', job.file);
      manifest.assets = manifest.assets.filter((a) => a.file !== job.file);
      manifest.assets.push({ file: job.file, type: job.type, format: 'video', category: 'daily', caption: `${job.caption} ${tags}` });
    } else {
      console.warn(`  ! ffmpeg failed for ${job.file}`);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Motion assets done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
