// Display surname extraction. A bare "last word" split turns Alex de Minaur
// into "Minaur" and Luca Van Assche into "Assche" everywhere we shorten a
// name (verdicts, picks, tooltips). Walk back from the last word and keep
// the lowercase-style particles that are part of the surname.
// NOT for matching/joining logic (LiveWinProb keys on the raw last token on
// both sides on purpose).
const PARTICLES = new Set(['de', 'van', 'von', 'der', 'den', 'del', 'della', 'di', 'da', 'ter', 'ten', 'le', 'la']);

export function lastName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || '';
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i -= 1;
  return parts.slice(i).join(' ');
}
