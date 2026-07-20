/**
 * Self-publishing bridge - posts the day's best share cards to a webhook.
 *
 * buildShareAssets.js renders the cards and writes captions into
 * public/data/share/manifest.json; this script closes the loop by handing a
 * small, curated set to an automation webhook (Buffer, Zapier, Make, or
 * anything that accepts JSON) that does the actual social publishing.
 *
 * Pick order, max 3 assets per run:
 *   1. Today's carousel cover (category 'daily', type 'carousel-cover')
 *   2. Yesterday's results card (category 'daily', type 'results')
 *   3. Any 'moments' card (milestone / perfect day / streak / autopsy)
 *
 * For each picked asset it POSTs:
 *   { text, alt, imageUrl, category, format }
 * where imageUrl points at the deployed copy under /data/share/. A 500ms
 * pause between posts keeps rate-limit-happy consumers comfortable.
 *
 * This is deliberately separate from the scorecard webhook
 * (SOCIAL_WEBHOOK_URL in refresh-data.yml): that one ships a text one-liner,
 * this one ships an image-centric feed. Different secrets, different
 * consumers, no overlap.
 *
 * Without AUTOPOST_WEBHOOK_URL it prints the picked set as a dry run.
 * Nothing here ever exits non-zero - a failed post is a log line, not a
 * broken pipeline.
 *
 * Usage: node data-pipeline/postSocial.js
 * Env:   AUTOPOST_WEBHOOK_URL (optional), SITE_URL (optional; defaults to
 *        https://smash-react.vercel.app)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'public', 'data', 'share', 'manifest.json');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
const WEBHOOK = process.env.AUTOPOST_WEBHOOK_URL;
const MAX_POSTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickAssets(assets) {
  const picked = [];
  const take = (pred) => {
    if (picked.length >= MAX_POSTS) return;
    const hit = assets.find((a) => !picked.includes(a) && pred(a));
    if (hit) picked.push(hit);
  };
  // Prefer the square cover when both square and 4:5 exist - one post, not two.
  take((a) => a.category === 'daily' && a.type === 'carousel-cover' && a.format === 'square');
  take((a) => a.category === 'daily' && a.type === 'carousel-cover');
  take((a) => a.category === 'daily' && a.type === 'results');
  take((a) => a.category === 'moments');
  return picked.slice(0, MAX_POSTS);
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    console.log('No share manifest at public/data/share/manifest.json; nothing to post.');
    return;
  }

  const assets = (manifest.assets || []).filter((a) => a && a.file);
  const picked = pickAssets(assets);
  if (!picked.length) {
    console.log(`Manifest has ${assets.length} assets but none match the pick order (daily carousel-cover, daily results, moments); nothing to post.`);
    return;
  }

  const payloads = picked.map((a) => ({
    text: a.caption || '',
    alt: a.alt || '',
    imageUrl: `${SITE}/data/share/${a.file}`,
    category: a.category,
    format: a.format,
  }));

  if (!WEBHOOK) {
    console.log(`AUTOPOST_WEBHOOK_URL not set; dry run. Would post ${payloads.length} asset(s):`);
    for (const p of payloads) {
      console.log(`  would post: ${p.imageUrl} [${p.category}/${p.format}] ${p.text.slice(0, 100)}${p.text.length > 100 ? '...' : ''}`);
    }
    return;
  }

  let ok = 0;
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    try {
      const res = await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      console.log(`Posted ${picked[i].file}: HTTP ${res.status}`);
      if (res.ok) ok++;
    } catch (err) {
      console.log(`Post failed for ${picked[i].file} (non-fatal): ${err.message}`);
    }
    if (i < payloads.length - 1) await sleep(500);
  }
  console.log(`Done: ${ok} of ${payloads.length} posts accepted.`);
}

main().catch((err) => {
  // Belt and braces: publishing must never fail the data pipeline.
  console.log(`postSocial error (non-fatal): ${err.message}`);
});
