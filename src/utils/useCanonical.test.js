import { describe, it, expect } from 'vitest';
import { canonicalPathFor, CANONICAL_ALIASES } from './useCanonical';

// The app served several pages under two URLs with no canonical anywhere, so
// search engines were told about pairs with nothing to choose between them.
describe('the canonical path', () => {
  it('sends every alias to the URL that owns the content', () => {
    expect(canonicalPathFor('/women/track-record')).toBe('/track-record');
    expect(canonicalPathFor('/women/methodology')).toBe('/methodology');
    expect(canonicalPathFor('/women/draw')).toBe('/draw');
    expect(canonicalPathFor('/women')).toBe('/');
    expect(canonicalPathFor('/parlay')).toBe('/risk');
  });

  it('leaves a page that is genuinely different alone', () => {
    // These take a tour prop and render WTA content. If they ever land in the
    // alias map, the WTA studio stops being indexable at all.
    for (const p of ['/women/h2h', '/women/dream-brackets']) {
      expect(canonicalPathFor(p)).toBe(p);
      expect(CANONICAL_ALIASES[p]).toBeUndefined();
    }
  });

  it('normalises a trailing slash, so one page is not two', () => {
    expect(canonicalPathFor('/today/')).toBe('/today');
    expect(canonicalPathFor('/')).toBe('/');
  });

  it('never resolves to an alias, so no canonical points at another alias', () => {
    for (const target of Object.values(CANONICAL_ALIASES)) {
      expect(CANONICAL_ALIASES[target]).toBeUndefined();
    }
  });
});
