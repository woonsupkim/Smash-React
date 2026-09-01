// src/utils/useCanonical.js
//
// One authoritative URL per page.
//
// The app had no <link rel="canonical"> anywhere, and several routes render
// byte-identical content under two URLs. The /women prefix is real on the
// pages that take a tour prop (/women/h2h, /women/dream-brackets); on the
// rest it is a pure alias, and /women/track-record served the same markup and
// the same <title> as /track-record. Both were submitted in the sitemap, so
// search engines were told about pairs of URLs with nothing to choose between
// them - which splits ranking signals across both and lets the engine pick
// the winner for you.
//
// Lives at the router level rather than inside useDocMeta so it covers every
// route, including the handful of pages that never call useDocMeta at all.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Alias -> the URL that should own the content. Only pages that render the
// SAME thing belong here: /women/h2h is a genuinely different page and is
// deliberately absent.
export const CANONICAL_ALIASES = {
  '/women': '/',
  '/women/track-record': '/track-record',
  '/women/methodology': '/methodology',
  '/women/draw': '/draw',
  // The Risk Lab answers on both URLs: /parlay is what the page was called
  // for its whole life and is still linked from old share assets and sent
  // digests, so it must keep resolving - but only one of the two should be
  // indexed, and the sitemap already names /risk.
  '/parlay': '/risk',
};

// The query string is dropped on purpose. `?surface=hard` picks a view of the
// H2H studio, not a different page, and every share link that picks up a
// utm_* tag would otherwise become its own canonical.
export function canonicalPathFor(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return CANONICAL_ALIASES[clean] || clean || '/';
}

export default function useCanonical() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    el.setAttribute('href', window.location.origin + canonicalPathFor(pathname));
  }, [pathname]);
}
