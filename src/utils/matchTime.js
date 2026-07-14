// src/utils/matchTime.js
//
// Pre-match time helpers: "in 3h 20m" countdowns for the Happening Now
// cards and match pages, plus a viewer-local kickoff time.

export function timeUntil(iso, now = Date.now()) {
  const diff = new Date(iso) - now;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return { past: true, label: 'awaiting result' };
  const mins = Math.floor(diff / 6e4);
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return { past: false, label: `in ${d}d ${h % 24}h` };
  if (h >= 1) return { past: false, label: `in ${h}h ${mins % 60}m` };
  return { past: false, soon: true, label: mins <= 1 ? 'about to start' : `in ${mins}m` };
}

// "Sat, Jul 12 · 11:00 AM" in the visitor's own timezone.
export function localKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Stable, readable match-page slug: "jannik-sinner-vs-alexander-zverev-177491".
const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const matchSlug = (p) => `${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
export const idFromSlug = (slug) => String(slug || '').split('-').pop();
